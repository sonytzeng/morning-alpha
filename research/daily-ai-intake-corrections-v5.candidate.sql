-- V5 source-policy corrections. Apply after intake-performance-v4.
-- Old intakes, batches, completed jobs and staged research remain immutable.
-- This migration grants no license, content review or member publication.
begin;

alter table vnext_runtime.ai_stock_intakes add column revision integer not null default 1 check(revision between 1 and 3);
alter table vnext_runtime.ai_stock_intakes add column policy_reason text;
alter table vnext_runtime.ai_stock_intakes add column correction_request_key uuid unique;
alter table vnext_runtime.ai_stock_intakes add constraint ai_intake_revision_reason_v5 check(
 (revision=1 and policy_reason is null and correction_request_key is null)
 or (revision>1 and policy_reason='SOURCE_POLICY_CORRECTION' and correction_request_key is not null));
alter table vnext_runtime.ai_stock_intakes drop constraint ai_stock_intakes_business_date_key;
alter table vnext_runtime.ai_stock_intakes add constraint ai_intake_business_revision_v5 unique(business_date,revision);

create function vnext_runtime.seal_daily_ai_intake_revision_v5() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.business_date is distinct from old.business_date or new.requested_at is distinct from old.requested_at
  or new.revision is distinct from old.revision or new.policy_reason is distinct from old.policy_reason
  or new.correction_request_key is distinct from old.correction_request_key then raise exception 'AI_INTAKE_REVISION_IMMUTABLE';end if;
 return new;
end $$;
revoke all on function vnext_runtime.seal_daily_ai_intake_revision_v5() from public,anon,authenticated,service_role;
create trigger ai_intake_revision_seal_v5 before update on vnext_runtime.ai_stock_intakes
 for each row execute function vnext_runtime.seal_daily_ai_intake_revision_v5();

create or replace function public.enqueue_daily_stock_ai_intake_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;receipt jsonb;at_time timestamptz:=clock_timestamp();day date;
begin
 day:=(at_time at time zone 'Asia/Taipei')::date;
 perform pg_advisory_xact_lock(hashtextextended('daily-ai-intake-day:'||day::text,0));
 select * into q from vnext_runtime.ai_stock_intakes where business_date=day order by revision desc limit 1;
 if not found then insert into vnext_runtime.ai_stock_intakes(business_date,requested_at) values(day,at_time) returning * into q;end if;
 begin receipt:=public.resume_daily_stock_ai_intake_v1(q.id);exception when others then receipt:='{"state":"DISPATCH_PENDING"}';end;
 return jsonb_build_object('state',q.state,'intake_id',q.id,'business_date',q.business_date,'revision',q.revision,
  'policy_reason',q.policy_reason,'dispatch',receipt,'member_published',false);
end $$;
revoke all on function public.enqueue_daily_stock_ai_intake_v1() from public,anon,authenticated,service_role;
grant execute on function public.enqueue_daily_stock_ai_intake_v1() to service_role;

create function public.enqueue_corrected_daily_stock_ai_intake_v5(p_reason text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;latest vnext_runtime.ai_stock_intakes;receipt jsonb;
 at_time timestamptz:=clock_timestamp();day date;replayed boolean:=false;
begin
 if p_reason is distinct from 'SOURCE_POLICY_CORRECTION' or p_request_key is null then raise exception 'AI_INTAKE_CORRECTION_SCOPE';end if;
 day:=(at_time at time zone 'Asia/Taipei')::date;
 perform pg_advisory_xact_lock(hashtextextended('daily-ai-intake-day:'||day::text,0));
 select * into q from vnext_runtime.ai_stock_intakes where correction_request_key=p_request_key;
 if found then
  if q.business_date<>day or q.policy_reason<>p_reason then raise exception 'AI_INTAKE_CORRECTION_REPLAY_CONFLICT';end if;
  replayed:=true;
 else
  select * into latest from vnext_runtime.ai_stock_intakes where business_date=day order by revision desc limit 1;
  if not found then raise exception 'AI_INTAKE_CORRECTION_BASE_REQUIRED';end if;
  if latest.revision>=3 then raise exception 'AI_INTAKE_REVISION_LIMIT';end if;
  insert into vnext_runtime.ai_stock_intakes(business_date,requested_at,revision,policy_reason,correction_request_key)
   values(day,at_time,latest.revision+1,p_reason,p_request_key) returning * into q;
 end if;
 begin receipt:=public.resume_daily_stock_ai_intake_v1(q.id);exception when others then receipt:='{"state":"DISPATCH_PENDING"}';end;
 return jsonb_build_object('state',q.state,'intake_id',q.id,'business_date',q.business_date,'revision',q.revision,
  'policy_reason',q.policy_reason,'replayed',replayed,'dispatch',receipt,'member_published',false);
end $$;
revoke all on function public.enqueue_corrected_daily_stock_ai_intake_v5(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_corrected_daily_stock_ai_intake_v5(text,uuid) to service_role;

-- New private captures retain their real ingestion record independently of the
-- source's publication or fetch receipt. No rights or review state is implied.
create table vnext_private.ai_news_captures_v5(
 id text primary key check(id ~ '^[a-f0-9]{64}$'),
 capture_kind text not null check(capture_kind in('OFFICIAL_FEED','RETAINED_OWN_FACT')),
 proof jsonb not null,recorded_at timestamptz not null default clock_timestamp()
);
create table vnext_private.ai_verified_news_v5(
 capture_id text not null references vnext_private.ai_news_captures_v5(id),
 evidence_id text not null,evidence jsonb not null,
 primary key(capture_id,evidence_id),check(evidence_id=evidence->>'id'),check(evidence->>'kind'='NEWS')
);
create index ai_verified_news_receipt_v5 on vnext_private.ai_verified_news_v5((evidence->>'available_at'),evidence_id);
create index ai_verified_news_identity_v5 on vnext_private.ai_verified_news_v5(evidence_id);
alter table vnext_private.ai_news_captures_v5 enable row level security;
alter table vnext_private.ai_news_captures_v5 force row level security;
alter table vnext_private.ai_verified_news_v5 enable row level security;
alter table vnext_private.ai_verified_news_v5 force row level security;
revoke all on vnext_private.ai_news_captures_v5,vnext_private.ai_verified_news_v5 from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_private.ai_news_captures_v5
 for each row execute function vnext_private.immutable_record();
create trigger immutable before update or delete on vnext_private.ai_verified_news_v5
 for each row execute function vnext_private.immutable_record();

create function vnext_runtime.daily_ai_trim_v5(p_text text) returns text
language sql immutable strict set search_path='' as $$
 select btrim(p_text,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
  chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||
  chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
revoke all on function vnext_runtime.daily_ai_trim_v5(text) from public,anon,authenticated,service_role;

create function vnext_runtime.daily_ai_roc_day_v5(p_raw text) returns date
language plpgsql immutable set search_path='' as $$
begin
 if coalesce(p_raw,'') !~ '^\d{7}$' or substring(p_raw,1,3)::integer not between 80 and 300 then return null;end if;
 return make_date(substring(p_raw,1,3)::integer+1911,substring(p_raw,4,2)::integer,substring(p_raw,6,2)::integer);
exception when others then return null;
end $$;
revoke all on function vnext_runtime.daily_ai_roc_day_v5(text) from public,anon,authenticated,service_role;

-- XPath returns serialized XML text. Decode exactly that serialization layer;
-- an original CDATA literal '&lt;' remains '&lt;', not a second decoded '<'.
create function vnext_runtime.daily_ai_rss_text_v5(p_item xml,p_key text) returns text
language plpgsql immutable set search_path='' as $$
declare values xml[];result text;
begin
 if p_key not in('title','link','description','pubDate') then return null;end if;
 if cardinality(xpath('/*/'||p_key,p_item))<>1 then return null;end if;
 values:=xpath('string(/*/'||p_key||')',p_item);result:=values[1]::text;
 return vnext_runtime.daily_ai_trim_v5(replace(replace(replace(replace(replace(result,'&lt;','<'),'&gt;','>'),'&quot;','"'),'&apos;',''''),'&amp;','&'));
end $$;
revoke all on function vnext_runtime.daily_ai_rss_text_v5(xml,text) from public,anon,authenticated,service_role;

create function vnext_runtime.daily_ai_official_news_evidence_v5(p_row jsonb,p_response jsonb,p_row_text text,p_business_date date,p_window_start timestamptz) returns jsonb
language plpgsql immutable set search_path='' as $$
declare source text:=p_response->>'source';provider text;symbol text;title text;excerpt text;metadata jsonb;content jsonb;
 published timestamptz;published_text text;spoken date;exported date;time_raw text;time_value text;twse boolean;
begin
 if source='https://www.federalreserve.gov/feeds/press_all.xml' then
  if (select count(*) from jsonb_object_keys(p_row))<>4 or not(p_row ?& array['title','link','description','pubDate'])
   or p_row->>'link' !~ '^https://www[.]federalreserve[.]gov/newsevents/pressreleases/[a-z0-9]+[.]htm$'
   or coalesce(p_row->>'pubDate','') !~ '^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d\d:\d\d:\d\d GMT$' then return null;end if;
  published:=(p_row->>'pubDate')::timestamptz;
  if to_char(published at time zone 'UTC','Dy, DD Mon YYYY HH24:MI:SS')||' GMT'<>p_row->>'pubDate'
   or published<p_window_start or published>(p_response->>'received_at')::timestamptz then return null;end if;
  published_text:=to_char(published at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')||'.000Z';
  provider:='FEDERAL_RESERVE_RSS';symbol:=null;title:=vnext_runtime.daily_ai_trim_v5(p_row->>'title');excerpt:=vnext_runtime.daily_ai_trim_v5(p_row->>'description');source:=p_row->>'link';
  metadata:=jsonb_build_object('rss_pub_date_raw',p_row->'pubDate','window_basis','EXPLICIT_RSS_GMT_PUBLICATION_TIME');
 elsif source in('https://openapi.twse.com.tw/v1/opendata/t187ap04_L','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O') then
  twse:=source='https://openapi.twse.com.tw/v1/opendata/t187ap04_L';symbol:=p_row->>case when twse then '公司代號' else 'SecuritiesCompanyCode' end;
  if coalesce(symbol,'') !~ '^\d{4,6}$' then return null;end if;
  spoken:=vnext_runtime.daily_ai_roc_day_v5(p_row->>'發言日期');exported:=vnext_runtime.daily_ai_roc_day_v5(p_row->>case when twse then '出表日期' else 'Date' end);
  time_raw:=p_row->>'發言時間';
  if spoken is null or exported is null or spoken<(p_window_start at time zone 'Asia/Taipei')::date or spoken>p_business_date
   or exported>p_business_date or exported<spoken or coalesce(time_raw,'') !~ '^\d{5,6}$' then return null;end if;
  time_value:=lpad(time_raw,6,'0');
  if substring(time_value,1,2)::integer>23 or substring(time_value,3,2)::integer>59 or substring(time_value,5,2)::integer>59 then return null;end if;
  provider:=case when twse then 'TWSE_MOPS_OPEN_DATA' else 'TPEX_MOPS_OPEN_DATA' end;
  title:=vnext_runtime.daily_ai_trim_v5(p_row->>case when twse then '主旨 ' else '主旨' end);excerpt:=vnext_runtime.daily_ai_trim_v5(p_row->>'說明');
  if length(vnext_runtime.daily_ai_trim_v5(coalesce(p_row->>case when twse then '公司名稱' else 'CompanyName' end,''))) not between 1 and 200 then return null;end if;
  metadata:=jsonb_build_object('company_code',symbol,'company_name',vnext_runtime.daily_ai_trim_v5(p_row->>case when twse then '公司名稱' else 'CompanyName' end),
   'source_export_date_raw',p_row->case when twse then '出表日期' else 'Date' end,'spoken_date_raw',p_row->'發言日期','spoken_time_raw',p_row->'發言時間',
   'spoken_date_coordinate',spoken::text,'spoken_time_coordinate',substring(time_value,1,2)||':'||substring(time_value,3,2)||':'||substring(time_value,5,2),
   'fact_event_date_raw',case when jsonb_typeof(p_row->'事實發生日')='string' then p_row->>'事實發生日' else '' end,
   'publication_timezone','NOT_DECLARED_BY_SOURCE','window_basis','SOURCE_DECLARED_DAY_COORDINATE_NOT_EXACT_PUBLICATION_TIME');
 else return null;end if;
 if coalesce(length(title),0) not between 1 and 1500 or coalesce(length(excerpt),0) not between 1 and 100000
  or title ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' or excerpt ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' then return null;end if;
 content:=jsonb_build_object('schema','DAILY_AI_OFFICIAL_NEWS_FACT_V1','provider',provider,
  'coverage',case when published_text is null then 'OFFICIAL_ANNOUNCEMENT_EXCERPT' else 'OFFICIAL_RSS_TITLE_AND_DESCRIPTION' end,
  'title',title,'excerpt',left(excerpt,2000),'excerpt_truncated',length(excerpt)>2000,
  'source_response_sha256',p_response->>'source_sha256','source_response_bytes',p_response->'source_bytes',
  'source_received_at',p_response->>'received_at','source_metadata',metadata);
 return jsonb_build_object('id','official-news:'||provider||':'||encode(sha256(convert_to(p_row_text,'UTF8')),'hex'),
  'symbol',symbol,'kind','NEWS','source',source,'published_at',published_text,'available_at',p_response->>'received_at',
  'first_seen_at',p_response->>'received_at','as_of',p_response->>'received_at',
  'time_basis',case when published_text is null then 'OBSERVED_AFTER_RECEIPT' else 'PUBLISHED' end,'content_object',content);
exception when others then return null;
end $$;
revoke all on function vnext_runtime.daily_ai_official_news_evidence_v5(jsonb,jsonb,text,date,timestamptz) from public,anon,authenticated,service_role;

create function public.import_daily_stock_ai_official_news_v1(p_proof jsonb) returns jsonb
language plpgsql security definer set search_path='' set work_mem='16MB' as $$
declare response jsonb;addition jsonb;row jsonb;rows jsonb;e jsonb;expected jsonb;content jsonb;raw text;item xml;rss xml;matched boolean;
 at_time timestamptz:=clock_timestamp();observed timestamptz;window_start timestamptz;day date;capture_id text;
 allowed constant text[]:=array['https://openapi.twse.com.tw/v1/opendata/t187ap04_L','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O','https://www.federalreserve.gov/feeds/press_all.xml'];
begin
 if p_proof->>'schema' is distinct from 'DAILY_AI_OFFICIAL_NEWS_PROOF_V1' or octet_length(p_proof::text)>12000000
  or jsonb_typeof(p_proof->'responses') is distinct from 'array' or jsonb_array_length(p_proof->'responses')<>3
  or jsonb_typeof(p_proof->'additions') is distinct from 'array' or jsonb_array_length(p_proof->'additions')>200 then raise exception 'AI_OFFICIAL_NEWS_PROOF';end if;
 observed:=(p_proof->>'observed_at')::timestamptz;window_start:=(p_proof->>'window_start')::timestamptz;day:=(p_proof->>'business_date')::date;
 if observed is null or window_start is null or day is null or not isfinite(observed) or not isfinite(window_start) or observed>at_time or day<>(observed at time zone 'Asia/Taipei')::date
  or observed-window_start not between interval '48 hours' and interval '48 hours 60 seconds'
  or (select count(distinct r->>'source') from jsonb_array_elements(p_proof->'responses')r)<>3
  or (select count(distinct a->'evidence'->>'id') from jsonb_array_elements(p_proof->'additions')a)<>jsonb_array_length(p_proof->'additions') then raise exception 'AI_OFFICIAL_NEWS_SCOPE';end if;
 for response in select * from jsonb_array_elements(p_proof->'responses') loop
  if not(coalesce(response->>'source','')=any(allowed)) then raise exception 'AI_OFFICIAL_NEWS_SOURCE';end if;
  if response->>'state'='CAPTURED' then
   raw:=response->>'response_text';
   if response->'error' is distinct from 'null'::jsonb or jsonb_typeof(response->'response_text') is distinct from 'string'
    or octet_length(raw) not between 2 and 2000000 or response->>'source_sha256' is distinct from encode(sha256(convert_to(raw,'UTF8')),'hex')
    or jsonb_typeof(response->'source_bytes') is distinct from 'number' or (response->>'source_bytes')::numeric<>octet_length(raw)
    or response->>'received_at' is null or not isfinite((response->>'received_at')::timestamptz)
    or (response->>'received_at')::timestamptz not between window_start+interval '48 hours' and observed
    or ((response->>'received_at')::timestamptz at time zone 'Asia/Taipei')::date<>day then raise exception 'AI_OFFICIAL_NEWS_RESPONSE';end if;
   if response->>'source'=allowed[3] then
    if raw ~* '<!DOCTYPE|<!ENTITY' then raise exception 'AI_OFFICIAL_NEWS_XML';end if;
    rss:=ltrim(raw,chr(65279))::xml;if cardinality(xpath('/rss[@version="2.0"]/channel',rss))<>1 or cardinality(xpath('/rss/channel/item',rss))>500 then raise exception 'AI_OFFICIAL_NEWS_XML';end if;
   else rows:=raw::jsonb;if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>5000
    or exists(select from jsonb_array_elements(rows)x where jsonb_typeof(x)<>'object') then raise exception 'AI_OFFICIAL_NEWS_RESPONSE';end if;end if;
  elsif response->>'state'='UNAVAILABLE' then
   if response->'received_at' is distinct from 'null'::jsonb or response->'source_sha256' is distinct from 'null'::jsonb
    or response->'source_bytes' is distinct from 'null'::jsonb or response->'response_text' is distinct from 'null'::jsonb
    or coalesce(response->>'error','') !~ '^AI_OFFICIAL_NEWS_[A-Z_]{1,80}$' then raise exception 'AI_OFFICIAL_NEWS_RESPONSE';end if;
  else raise exception 'AI_OFFICIAL_NEWS_RESPONSE';end if;
 end loop;
 for addition in select * from jsonb_array_elements(p_proof->'additions') loop
  e:=addition->'evidence';row:=(addition->>'row_text')::jsonb;content:=(e->>'content')::jsonb;
  if jsonb_typeof(addition->'row_text') is distinct from 'string' or octet_length(addition->>'row_text')>150000
   or jsonb_typeof(e) is distinct from 'object' or (select count(*) from jsonb_object_keys(e))<>11
   or jsonb_typeof(e->'content') is distinct from 'string' or length(e->>'content') not between 1 and 12000
   or e->>'evidence_hash' is distinct from encode(sha256(convert_to(e->>'content','UTF8')),'hex') then raise exception 'AI_OFFICIAL_NEWS_EVIDENCE';end if;
  select r into strict response from jsonb_array_elements(p_proof->'responses')r where r->>'state'='CAPTURED'
   and r->>'source'=case content->>'provider' when 'TWSE_MOPS_OPEN_DATA' then allowed[1] when 'TPEX_MOPS_OPEN_DATA' then allowed[2] when 'FEDERAL_RESERVE_RSS' then allowed[3] end;
  raw:=response->>'response_text';matched:=false;
  if response->>'source'=allowed[3] then
   rss:=ltrim(raw,chr(65279))::xml;
   foreach item in array xpath('/rss/channel/item',rss) loop
    if row=jsonb_build_object('title',vnext_runtime.daily_ai_rss_text_v5(item,'title'),'link',vnext_runtime.daily_ai_rss_text_v5(item,'link'),
     'description',vnext_runtime.daily_ai_rss_text_v5(item,'description'),'pubDate',vnext_runtime.daily_ai_rss_text_v5(item,'pubDate')) then matched:=true;exit;end if;
   end loop;
  else matched:=exists(select from jsonb_array_elements(raw::jsonb)actual_row where actual_row=row);end if;
  if not matched then raise exception 'AI_OFFICIAL_NEWS_ROW';end if;
  expected:=vnext_runtime.daily_ai_official_news_evidence_v5(row,response,addition->>'row_text',day,window_start);
  if expected is null or e-array['content','evidence_hash'] is distinct from expected-'content_object'
   or content is distinct from expected->'content_object' then raise exception 'AI_OFFICIAL_NEWS_MAPPING';end if;
 end loop;
 capture_id:=encode(sha256(convert_to(p_proof::text,'UTF8')),'hex');
 insert into vnext_private.ai_news_captures_v5(id,capture_kind,proof) values(capture_id,'OFFICIAL_FEED',p_proof) on conflict do nothing;
 insert into vnext_private.ai_verified_news_v5(capture_id,evidence_id,evidence)
  select capture_id,a->'evidence'->>'id',a->'evidence' from jsonb_array_elements(p_proof->'additions')a on conflict do nothing;
 return jsonb_build_object('state','STORED','capture_id',capture_id,'records',jsonb_array_length(p_proof->'additions'),'member_published',false);
end $$;
revoke all on function public.import_daily_stock_ai_official_news_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.import_daily_stock_ai_official_news_v1(jsonb) to service_role;

-- This manual importer records the actual independent web-tool verification.
-- It never calls that text capture a raw HTTP body, repairs a historical hash,
-- or changes the historical receipt. A new derived observation keeps both the
-- original claimed hash and the computed original-content hash as trace.
create function public.import_daily_stock_ai_own_news_v5(p_proof jsonb) returns jsonb
language plpgsql security definer set search_path='' set work_mem='16MB' as $$
declare doc jsonb;capture jsonb;r jsonb;body jsonb;e jsonb;content text;capture_id text;at_time timestamptz:=clock_timestamp();
 doc_hash text;capture_hash text;reviewed timestamptz;original_hash text;expected_source text;expected_symbol text;
begin
 if p_proof->>'schema' is distinct from 'DAILY_AI_RETAINED_OWN_NEWS_PROOF_V5'
  or octet_length(p_proof::text)>1000000 or jsonb_typeof(p_proof->'verification_document_text') is distinct from 'string'
  or jsonb_typeof(p_proof->'capture_document_text') is distinct from 'string' then raise exception 'AI_OWN_NEWS_PROOF';end if;
 doc_hash:=encode(sha256(convert_to(p_proof->>'verification_document_text','UTF8')),'hex');
 capture_hash:=encode(sha256(convert_to(p_proof->>'capture_document_text','UTF8')),'hex');
 if p_proof->>'verification_document_sha256' is distinct from doc_hash or p_proof->>'capture_document_sha256' is distinct from capture_hash then raise exception 'AI_OWN_NEWS_HASH';end if;
 doc:=(p_proof->>'verification_document_text')::jsonb;capture:=(p_proof->>'capture_document_text')::jsonb;reviewed:=(doc->>'reviewed_at')::timestamptz;
 if doc->>'schema_version' is distinct from 'OWN_RETAINED_FACT_VERIFICATION_V1'
  or doc->>'status' is distinct from 'VERIFIED_OWN_FACT_CONTENT_WITH_EXPLICIT_PROVENANCE_LIMITS'
  or doc->>'capture_type' is distinct from 'ACTUAL_WEB_TOOL_TEXT_RESPONSE_NOT_RAW_HTTP_BODY' or doc->>'capture_sha256' is distinct from capture_hash
  or coalesce(length(vnext_runtime.daily_ai_trim_v5(doc->>'reviewer')),0) not between 1 and 200 or reviewed is null or not isfinite(reviewed) or reviewed>at_time
  or jsonb_typeof(capture->'content') is distinct from 'array' or capture->'isError' is distinct from 'false'::jsonb
  or jsonb_typeof(doc->'rows') is distinct from 'array' or jsonb_array_length(doc->'rows')<>4
  or (select count(distinct x->>'id') from jsonb_array_elements(doc->'rows')x)<>4 then raise exception 'AI_OWN_NEWS_VERIFICATION';end if;
 capture_id:=encode(sha256(convert_to(p_proof::text,'UTF8')),'hex');
 insert into vnext_private.ai_news_captures_v5(id,capture_kind,proof) values(capture_id,'RETAINED_OWN_FACT',p_proof) on conflict do nothing;
 for r in select * from jsonb_array_elements(doc->'rows') loop
  expected_source:=case r->>'id' when 'news-ltn-us-close-20261030' then 'https://ec.ltn.com.tw/article/breakingnews/5624480'
   when 'news-ltn-tsm-adr-20261030' then 'https://ec.ltn.com.tw/article/breakingnews/5624480'
   when 'news-2330-factory-acquisition-20261029' then 'https://www.cna.com.tw/news/afe/202610290197.aspx'
   when 'news-3006-confirmed-upcoming-ir-20261027' then 'https://www.esmt.com.tw/en/press-room/2026102703' end;
  expected_symbol:=case r->>'id' when 'news-ltn-tsm-adr-20261030' then '2330' when 'news-2330-factory-acquisition-20261029' then '2330'
   when 'news-3006-confirmed-upcoming-ir-20261027' then '3006' end;
  original_hash:=encode(sha256(convert_to(r->>'content','UTF8')),'hex');
  if expected_source is null or r->>'source' is distinct from expected_source or r->>'fact_verdict' is distinct from 'VERIFIED'
   or r->>'original_content_sha256' is distinct from original_hash or coalesce(r->>'original_evidence_hash','') !~ '^[a-f0-9]{64}$'
   or r->'original_hash_matches_content' is distinct from to_jsonb(r->>'original_evidence_hash'=original_hash)
   or jsonb_typeof(r->'content') is distinct from 'string' or length(r->>'content') not between 1 and 5000
   or (r->>'content')::jsonb->>'classification' is distinct from 'REPORTED_CLAIM'
   or coalesce(length(vnext_runtime.daily_ai_trim_v5(r->>'method')),0) not between 1 and 500
   or jsonb_typeof(r->'limitations') is distinct from 'array' or jsonb_array_length(r->'limitations') not between 1 and 30
   or exists(select from jsonb_array_elements(r->'limitations')x where jsonb_typeof(x)<>'string' or length(vnext_runtime.daily_ai_trim_v5(x#>>'{}')) not between 1 and 1500)
   or jsonb_typeof(r->'verification_urls') is distinct from 'array' or jsonb_array_length(r->'verification_urls') not between 1 and 30
   or exists(select from jsonb_array_elements(r->'verification_urls')u where jsonb_typeof(u) is distinct from 'string')
   or exists(select from jsonb_array_elements_text(r->'verification_urls')u where u !~ '^https://(www[.]cna[.]com[.]tw/news/afe/[0-9]+[.]aspx|ec[.]ltn[.]com[.]tw/(article/breakingnews/[0-9]+|topic/[^?#[:space:]]+)|www[.]esmt[.]com[.]tw/en/press-room/[0-9]+)$')
   or r->>'original_available_at' is null or r->>'original_published_at' is null
   or not isfinite((r->>'original_available_at')::timestamptz) or not isfinite((r->>'original_published_at')::timestamptz)
   or (r->>'original_published_at')::timestamptz>(r->>'original_available_at')::timestamptz
   or (r->>'original_available_at')::timestamptz>reviewed
   or (r->>'original_available_at')::timestamptz<at_time-interval '7 days' then raise exception 'AI_OWN_NEWS_ROW';end if;
  body:=jsonb_build_object('schema','DAILY_AI_RETAINED_OWN_NEWS_FACT_V1','classification','REPORTED_CLAIM','scope','RETAINED_BACKGROUND_NOT_FRESH_SOURCE_CAPTURE',
   'capture_method','INDEPENDENT_WEB_TOOL_FACT_VERIFICATION','original_evidence_id',r->>'id','original_evidence_hash',r->>'original_evidence_hash',
   'original_content_hash',original_hash,'original_content_text',r->>'content','original_content',(r->>'content')::jsonb,
   'original_published_at',r->>'original_published_at','original_available_at',r->>'original_available_at','original_first_seen_at',r->>'original_available_at',
   'verification_document_hash',doc_hash,'reviewer_ref',doc->>'reviewer','reviewed_at',doc->>'reviewed_at','source_document_sha256',doc_hash,
   'provenance_document_sha256',capture_hash,'verification_method',r->>'method','verification_limits',r->'limitations','verification_urls',r->'verification_urls');
  content:=body::text;
  if length(content)>12000 then raise exception 'AI_OWN_NEWS_CONTENT_LIMIT';end if;
  e:=jsonb_build_object('id','retained-own-news:'||encode(sha256(convert_to(content,'UTF8')),'hex'),'symbol',expected_symbol,'kind','NEWS','source',expected_source,
   'published_at',r->>'original_published_at','available_at',r->>'original_available_at','first_seen_at',r->>'original_available_at','as_of',r->>'original_available_at',
   'time_basis','PUBLISHED','content',content,'evidence_hash',encode(sha256(convert_to(content,'UTF8')),'hex'));
  insert into vnext_private.ai_verified_news_v5(capture_id,evidence_id,evidence) values(capture_id,e->>'id',e) on conflict do nothing;
 end loop;
 return jsonb_build_object('state','STORED','capture_id',capture_id,'records',4,'member_published',false);
end $$;
revoke all on function public.import_daily_stock_ai_own_news_v5(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.import_daily_stock_ai_own_news_v5(jsonb) to service_role;

create function vnext_runtime.freeze_daily_stock_ai_verified_news_v5(p_inputs jsonb) returns jsonb
language plpgsql security definer set search_path='' set work_mem='16MB' as $$
declare at_time timestamptz:=clock_timestamp();frozen jsonb;cutoff_text text;
begin
 -- A source receipt remains its actual original receipt. recorded_at prevents
 -- an imported capture from appearing in any earlier frozen knowledge set.
 with symbols as materialized(select i->>'symbol' symbol from jsonb_array_elements(p_inputs)i),candidates as materialized(
  select distinct on(n.evidence_id) n.evidence_id,n.evidence,c.capture_kind from vnext_private.ai_verified_news_v5 n
   join vnext_private.ai_news_captures_v5 c on c.id=n.capture_id
  where c.recorded_at<=at_time and (n.evidence->>'available_at')::timestamptz<=at_time
   and (n.evidence->>'published_at' is null or (n.evidence->>'published_at')::timestamptz<=at_time)
   and (n.evidence->'symbol'='null'::jsonb or exists(select from symbols i where i.symbol=n.evidence->>'symbol'))
   and case when c.capture_kind='RETAINED_OWN_FACT' then (n.evidence->>'available_at')::timestamptz>=at_time-interval '7 days'
    when n.evidence->>'published_at' is not null then (n.evidence->>'published_at')::timestamptz>=at_time-interval '48 hours'
    else (n.evidence->>'available_at')::timestamptz>=at_time-interval '48 hours'
     and ((n.evidence->>'content')::jsonb->'source_metadata'->>'spoken_date_coordinate')::date>=((at_time-interval '48 hours') at time zone 'Asia/Taipei')::date end
  order by n.evidence_id,(n.evidence->>'available_at')::timestamptz desc,c.recorded_at desc,c.id
 ),ranked as materialized(select *,row_number() over(partition by evidence->>'symbol' order by coalesce((evidence->>'published_at')::timestamptz,(evidence->>'available_at')::timestamptz) desc,evidence_id) rank from candidates),
 selected as materialized(select * from ranked where rank<=case when evidence->'symbol'='null'::jsonb then 4 else 12 end),
 budgeted as(select *,sum(octet_length(evidence::text)) over(order by coalesce((evidence->>'published_at')::timestamptz,(evidence->>'available_at')::timestamptz) desc,evidence_id) bytes from selected)
 select coalesce(jsonb_agg(evidence order by coalesce((evidence->>'published_at')::timestamptz,(evidence->>'available_at')::timestamptz) desc,evidence_id),'[]'::jsonb) into frozen from budgeted where bytes<=1490000;
 cutoff_text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 return jsonb_build_object('cutoff',cutoff_text,'news',frozen);
end $$;
revoke all on function vnext_runtime.freeze_daily_stock_ai_verified_news_v5(jsonb) from public,anon,authenticated,service_role;


-- Prioritize new verified official observations within the unchanged quotas.
create or replace function vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare projected jsonb;
begin
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 then raise exception 'AI_HANDOFF_PROJECTION_SCOPE';end if;
 select jsonb_agg(i.value||jsonb_build_object('expected_sessions',sessions.dates,'bars',bars.rows,'facts',facts.rows) order by i.ordinality)
 into projected from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality)
 cross join lateral(select coalesce(jsonb_agg(s.value order by s.ordinality),'[]'::jsonb) dates
  from jsonb_array_elements(i.value->'expected_sessions') with ordinality s(value,ordinality)
  where s.ordinality>greatest(jsonb_array_length(i.value->'expected_sessions')-25,0)) sessions
 cross join lateral(select coalesce(jsonb_agg(b.value order by b.ordinality),'[]'::jsonb) rows
  from jsonb_array_elements(i.value->'bars') with ordinality b(value,ordinality)
  where sessions.dates @> jsonb_build_array(b.value->>'date')) bars
 cross join lateral(select coalesce(jsonb_agg(f.value order by f.kind_rank,f.kind,f.period,f.id),'[]'::jsonb) rows from(
  select value,value->>'kind' kind,coalesce(value->>'period','') period,value->>'id' id,
   case value->>'kind' when 'REVENUE' then 0 when 'INSTITUTIONAL' then 1 when 'EPS_AS_REPORTED' then 2
    when 'FINANCIAL_AS_REPORTED' then 3 when 'VALUATION_AS_REPORTED' then 4 when 'EPS' then 5 when 'MARGIN' then 6
    when 'CAPEX' then 7 when 'DEMAND' then 8 when 'MOAT' then 9 when 'VALUATION' then 10 else 11 end kind_rank,
   row_number() over(partition by value->>'kind' order by coalesce(value->>'period','') desc,value->>'id' desc) rn
  from jsonb_array_elements(i.value->'facts')) f
  where f.rn<=case f.kind when 'REVENUE' then 36 when 'INSTITUTIONAL' then 10 when 'EPS' then 4 when 'MARGIN' then 4
   when 'CAPEX' then 4 when 'DEMAND' then 1 when 'MOAT' then 1 when 'VALUATION' then 1 else 2 end) facts;
 if octet_length(projected::text)>8000000 then raise exception 'AI_HANDOFF_PROJECTION_SIZE';end if;
 return projected;
end $$;
revoke all on function vnext_runtime.project_daily_stock_ai_inputs_v1(jsonb) from public,anon,authenticated,service_role;


-- Recognize this exact actual primary policy document; create no review/grant.
create or replace function vnext_private.ai_use_primary_documents_v1(p_basis text,p_urls text[],p_sources text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(cardinality(p_urls) between 1 and 20
  and (select count(distinct u) from unnest(p_urls)u)=cardinality(p_urls)
  and not exists(select from unnest(p_sources)src where src ~* '^https://([a-z0-9-]+\.)*yahoo[.]com([/:]|$)')
  and not exists(select from unnest(p_urls)u where u is null or length(u) not between 12 and 3000
   or (u<>'https://www.federalreserve.gov/disclaimer.htm' and u !~ '^https://([a-z0-9-]+\.)*(twse\.com\.tw|tpex\.org\.tw|taifex\.com\.tw|treasury\.gov|catalog\.data\.gov|data\.gov\.tw|tipo\.gov\.tw|tsmc\.com|honhai\.com|mediatek\.com|realtek\.com|wistron\.com|esmt\.com\.tw|udngroup\.com|udn\.com|cna\.com\.tw|ltn\.com\.tw)/[^#[:space:]]*$')
   or u ~* '[?&][^=]*(token|secret|key|auth|email)[^=]*=')
  and case p_basis
   when 'FACT_ONLY_OWN_ANALYSIS' then exists(select from unnest(p_urls)u where u in(
    'https://www.tipo.gov.tw/tw/copyright/692-16653.html',
    'https://www.tipo.gov.tw/tw/copyright/774-5043.html',
    'https://www.tipo.gov.tw/tw/copyright/692-13930.html',
    'https://www.tipo.gov.tw/tw/copyright/694-17733.html'))
   when 'OPEN_LICENSE' then ('https://data.gov.tw/license'=any(p_urls)
    and exists(select from unnest(p_urls)u where u ~ '^https://data\.gov\.tw/dataset/[0-9]+$'))
    or ('https://catalog.data.gov/dataset/interest-rate-statistics-daily-treasury-yield-curve-rates'=any(p_urls)
     and 'https://home.treasury.gov/treasury-daily-interest-rate-xml-feed'=any(p_urls))
   when 'EXPLICIT_PERMISSION' then cardinality(p_sources)>0 and not exists(
    select from unnest(p_sources)src where not exists(select from unnest(p_urls)doc where exists(
     select from unnest(array['twse.com.tw','tpex.org.tw','taifex.com.tw','treasury.gov','tsmc.com','honhai.com','mediatek.com','realtek.com',
      'wistron.com','esmt.com.tw','udngroup.com','udn.com','cna.com.tw','ltn.com.tw'])publisher(root)
      where src ~ ('^https://([a-z0-9-]+\.)*'||replace(publisher.root,'.','[.]')||'/')
       and doc ~ ('^https://([a-z0-9-]+\.)*'||replace(publisher.root,'.','[.]')||'/'))))
   else false end,false);
$$;
revoke all on function vnext_private.ai_use_primary_documents_v1(text,text[],text[]) from public,anon,authenticated,service_role;

-- Fixed official financial/valuation mappings and audited display names.
-- Additive V5 private financial proof helpers. Load after V3 helpers.
-- No table grants, production writes, automatic licenses or model calls.
create or replace function vnext_runtime.daily_ai_financial_valuation_report_v5(p_row jsonb,p_received timestamptz,p_source text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare is_tpex boolean:=p_source='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis';keys text[];
 raw_date text:=p_row->>'Date';fiscal text;dividend_year text;quote_date date;report_end date;age integer;
begin
 if p_source not in('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis') then return null;end if;
 keys:=case when is_tpex then array['Date','SecuritiesCompanyCode','CompanyName','PriceEarningRatio','DividendPerShare','YieldRatio','PriceBookRatio']
  else array['Date','Code','Name','ClosePrice','DividendYield','DividendYear','PEratio','PBratio','FiscalYearQuarter'] end;
 if jsonb_typeof(p_row) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_row))<>cardinality(keys)
  or exists(select from unnest(keys)k where jsonb_typeof(p_row->k) is distinct from 'string') then return null;end if;
 if is_tpex then
  if coalesce(raw_date,'') !~ '^\d{7}$' or substring(raw_date from 1 for 3)::integer not between 80 and 300 then return null;end if;
  quote_date:=make_date(substring(raw_date from 1 for 3)::integer+1911,substring(raw_date from 4 for 2)::integer,substring(raw_date from 6 for 2)::integer);
 else
  fiscal:=p_row->>'FiscalYearQuarter';dividend_year:=p_row->>'DividendYear';
  if coalesce(raw_date,'') !~ '^\d{8}$' or coalesce(fiscal,'') !~ '^\d{4}Q[1-4]$' or coalesce(dividend_year,'') !~ '^\d{3,4}$' then return null;end if;
  quote_date:=make_date(substring(raw_date from 1 for 4)::integer,substring(raw_date from 5 for 2)::integer,substring(raw_date from 7 for 2)::integer);
  report_end:=(make_date(substring(fiscal from 1 for 4)::integer,right(fiscal,1)::integer*3,1)+interval '1 month'-interval '1 day')::date;
  if substring(fiscal from 1 for 4)::integer<1991 or report_end>quote_date then return null;end if;
 end if;
 age:=(p_received at time zone 'Asia/Taipei')::date-quote_date;if age not between 0 and 7 then return null;end if;
 return jsonb_build_object('period',to_char(quote_date,'YYYY-MM-DD'),'raw',raw_date,'fiscal',fiscal,'dividendYear',dividend_year);
exception when others then return null;
end $$;
revoke all on function vnext_runtime.daily_ai_financial_valuation_report_v5(jsonb,timestamptz,text) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.daily_ai_financial_latest_v5(p_rows jsonb,p_symbol text,p_received timestamptz,p_source text,p_kind text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare row jsonb;label jsonb;winner jsonb;best_date text:='';ties integer:=0;code_key text;
begin
 if p_kind<>'VALUATION_AS_REPORTED' then return vnext_runtime.daily_ai_financial_latest_v3(p_rows,p_symbol,p_received);end if;
 if p_source='https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d' then code_key:='Code';
 elsif p_source='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis' then code_key:='SecuritiesCompanyCode';else return null;end if;
 for row in select r from jsonb_array_elements(p_rows)r where r->>code_key=p_symbol loop
  label:=vnext_runtime.daily_ai_financial_valuation_report_v5(row,p_received,p_source);if label is null then return null;end if;
  if label->>'period'>best_date then winner:=row;best_date:=label->>'period';ties:=1;
  elsif label->>'period'=best_date then ties:=ties+1;end if;
 end loop;
 if ties<>1 then return null;end if;return winner;
exception when others then return null;
end $$;
revoke all on function vnext_runtime.daily_ai_financial_latest_v5(jsonb,text,timestamptz,text,text) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.daily_ai_financial_body_v5(p_symbol text,p_kind text,p_row jsonb,p_response jsonb,p_row_hash text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare source text:=p_response->>'source';is_tpex boolean:=source='https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis';label jsonb;values jsonb;
 close_value double precision;pe double precision;pb double precision;yield_value double precision;dividend double precision;raw jsonb;key text;
begin
 if p_kind<>'VALUATION_AS_REPORTED' then return vnext_runtime.daily_ai_financial_body_v3(p_symbol,p_kind,p_row,p_response,p_row_hash);end if;
 label:=vnext_runtime.daily_ai_financial_valuation_report_v5(p_row,(p_response->>'received_at')::timestamptz,source);if label is null then return null;end if;
 if (case when is_tpex then p_row->>'SecuritiesCompanyCode' else p_row->>'Code' end) is distinct from p_symbol then return null;end if;
 foreach key in array case when is_tpex then array['PriceEarningRatio','PriceBookRatio','YieldRatio','DividendPerShare'] else array['PEratio','PBratio','DividendYield'] end loop
  raw:=p_row->key;
  if vnext_runtime.daily_ai_financial_number_v3(raw) is null and btrim(raw#>>'{}') not in('','-','--','N/A') then return null;end if;
 end loop;
 pe:=vnext_runtime.daily_ai_financial_number_v3(p_row->case when is_tpex then 'PriceEarningRatio' else 'PEratio' end);
 pb:=vnext_runtime.daily_ai_financial_number_v3(p_row->case when is_tpex then 'PriceBookRatio' else 'PBratio' end);
 yield_value:=vnext_runtime.daily_ai_financial_number_v3(p_row->case when is_tpex then 'YieldRatio' else 'DividendYield' end);
 if is_tpex then dividend:=vnext_runtime.daily_ai_financial_number_v3(p_row->'DividendPerShare');
 else close_value:=vnext_runtime.daily_ai_financial_number_v3(p_row->'ClosePrice');if close_value is null or close_value<=0 then return null;end if;end if;
 if pe<=0 or yield_value<0 or dividend<0 then return null;end if;
 values:=jsonb_build_object('quote_date',label->>'period','close_price',close_value,'pe_ratio',pe,'pb_ratio',pb,'dividend_yield_percent',yield_value,
  'dividend_year_as_reported',label->'dividendYear','financial_year_quarter_as_reported',label->'fiscal','price_unit','SOURCE_REPORTED_PRICE_PER_SHARE','ratio_unit','TIMES','yield_unit','PERCENT',
  'calculation_basis',case when is_tpex then 'OFFICIAL_TPEX_PUBLISHED_RATIOS_NOT_RECONSTRUCTED' else 'OFFICIAL_TWSE_PUBLISHED_RATIOS_NOT_RECONSTRUCTED' end,
  'earnings_reference_basis',case when is_tpex then 'TPEX_REPORTED_FOUR_QUARTER_EARNINGS' else 'TWSE_PREVIOUSLY_FILED_NEAR_FOUR_FULL_QUARTERS' end,
  'yield_basis',case when is_tpex then 'TPEX_OFFICIAL_REPORTED_YIELD_COMPONENTS_NOT_FORWARD_OR_CASH_ONLY' else 'TWSE_DECLARED_DISTRIBUTION_COMPONENTS_NOT_FORWARD_OR_CASH_ONLY' end,'no_eps_or_forward_yield_inference','TRUE');
 if is_tpex then values:=values||jsonb_build_object('dividend_per_share_as_reported',dividend,'unpublished_fields','CLOSE_PRICE_FINANCIAL_YEAR_QUARTER_DIVIDEND_YEAR_NOT_PUBLISHED_BY_THIS_API');end if;
 return jsonb_build_object('symbol',p_symbol,'kind',p_kind,'period',label->>'period','basis','AS_REPORTED','values',values,'source',source,'published_at',null,
  'first_seen_at',p_response->>'received_at','available_at',p_response->>'received_at','as_of',p_response->>'received_at','source_sha256',p_response->>'source_sha256',
  'source_bytes',p_response->'source_bytes','source_received_at',p_response->>'received_at','source_locator',jsonb_build_object('company_code',p_symbol,
   'quote_date_as_reported',p_row->'Date','financial_year_quarter_as_reported',coalesce(p_row->'FiscalYearQuarter','null'::jsonb),'dividend_year_as_reported',coalesce(p_row->'DividendYear','null'::jsonb),'row_sha256',p_row_hash),
  'data_quality_status','OFFICIAL_OPEN_API_OBSERVED_AFTER_RECEIPT_PUBLICATION_UNKNOWN_AS_REPORTED_VALUATION','actual_only',true,'historical_knowledge',false,'source_admitted',false,'member_publication_approved',false);
exception when others then return null;
end $$;
revoke all on function vnext_runtime.daily_ai_financial_body_v5(text,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.daily_ai_financial_company_v5(p_old jsonb,p_new jsonb,p_proof jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare audit jsonb;response jsonb;row jsonb;name text;source constant text:='https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O';
begin
 if p_old->>'symbol' is distinct from p_new->>'symbol' then return false;end if;
 if p_old->'company' is not distinct from p_new->'company' then return true;end if;
 if p_old->>'company' is distinct from p_old->>'symbol' or jsonb_typeof(p_proof->'company_names') is distinct from 'array' then return false;end if;
 select x into strict audit from jsonb_array_elements(p_proof->'company_names')x where x->>'symbol'=p_old->>'symbol';
 if jsonb_typeof(audit) is distinct from 'object' or (select count(*) from jsonb_object_keys(audit))<>5
  or audit->>'previous_company' is distinct from p_old->>'company' or audit->>'company' is distinct from p_new->>'company'
  or audit->>'source' is distinct from source or jsonb_typeof(audit->'row_text') is distinct from 'string' or octet_length(audit->>'row_text')>30000 then return false;end if;
 select x into strict response from jsonb_array_elements(p_proof->'responses')x where x->>'source'=source and x->>'state'='CAPTURED';
 if response->>'source_sha256' is distinct from encode(sha256(convert_to(response->>'response_text','UTF8')),'hex')
  or (response->>'source_bytes')::numeric is distinct from octet_length(response->>'response_text')::numeric then return false;end if;
 row:=(audit->>'row_text')::jsonb;name:=row->>'CompanyName';
 if jsonb_typeof(row->'CompanyName') is distinct from 'string' or name is null or name<>btrim(name) or length(name) not between 1 and 100
  or name ~ '[[:cntrl:]]' or name=p_old->>'symbol' or name is distinct from p_new->>'company' or row->>'SecuritiesCompanyCode' is distinct from p_old->>'symbol'
  or row is distinct from vnext_runtime.daily_ai_financial_latest_v5((response->>'response_text')::jsonb,p_old->>'symbol',(response->>'received_at')::timestamptz,source,'EPS_AS_REPORTED')
  or vnext_runtime.daily_ai_financial_body_v3(p_old->>'symbol','EPS_AS_REPORTED',row,response,encode(sha256(convert_to(audit->>'row_text','UTF8')),'hex')) is null then return false;end if;
 if not exists(select from jsonb_array_elements(p_proof->'additions')a where a->>'symbol'=p_old->>'symbol' and a->>'row_text'=audit->>'row_text'
  and (a->>'body_text')::jsonb->>'kind'='EPS_AS_REPORTED' and (a->>'body_text')::jsonb->>'source'=source) then return false;end if;
 return true;
exception when others then return false;
end $$;
revoke all on function vnext_runtime.daily_ai_financial_company_v5(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.validate_daily_ai_financial_refresh_v5(p_base_inputs jsonb,p_inputs jsonb,p_refresh jsonb,p_cutoff timestamptz,p_business_date date) returns jsonb
language plpgsql immutable set search_path='' as $$
declare proof jsonb:=p_refresh;response jsonb;rows jsonb;addition jsonb;body jsonb;row jsonb;expected jsonb;fact jsonb;
 stock jsonb;incoming jsonb;old_fact jsonb;new_fact jsonb;kept jsonb;fresh jsonb:='[]';removed jsonb:='[]';actual_removed jsonb;expected_removed jsonb;kind text;hash text;source text;prior_response jsonb;reason text;audit jsonb;old_company jsonb;new_company jsonb;prior_row jsonb;
 allowed_sources constant text[]:=array['https://openapi.twse.com.tw/v1/opendata/t187ap14_L','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O','https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis'];
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72 or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 then raise exception 'AI_INTAKE_FINANCIAL_SCOPE';end if;
 if proof is null then
  proof:=jsonb_build_object('schema','DAILY_AI_FINANCIAL_REFRESH_V1','observed_at',to_char(p_cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'responses','[]'::jsonb,'additions','[]'::jsonb,'removals','[]'::jsonb,'company_names','[]'::jsonb);
 end if;
 if jsonb_typeof(proof) is distinct from 'object' then raise exception 'AI_INTAKE_FINANCIAL_PROOF';end if;
 if proof->'company_names' is null and jsonb_typeof(proof->'responses')='array' and jsonb_array_length(proof->'responses')=0 then proof:=proof||jsonb_build_object('company_names','[]'::jsonb);end if;
 if proof->>'schema' is distinct from 'DAILY_AI_FINANCIAL_REFRESH_V1' or octet_length(proof::text)>7000000
  or proof->>'observed_at' is null or not isfinite((proof->>'observed_at')::timestamptz) or (proof->>'observed_at')::timestamptz>p_cutoff
  or ((proof->>'observed_at')::timestamptz at time zone 'Asia/Taipei')::date<>p_business_date
  or jsonb_typeof(proof->'responses') is distinct from 'array' or jsonb_array_length(proof->'responses') not in(0,3,4,5)
  or jsonb_typeof(proof->'additions') is distinct from 'array' or jsonb_array_length(proof->'additions')>216
  or jsonb_typeof(proof->'removals') is distinct from 'array' or jsonb_array_length(proof->'removals')>72000 then raise exception 'AI_INTAKE_FINANCIAL_PROOF';end if;
 if jsonb_typeof(coalesce(proof->'company_names','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(proof->'company_names','[]'::jsonb))>72
  or (select count(distinct x->>'symbol') from jsonb_array_elements(coalesce(proof->'company_names','[]'::jsonb))x)<>jsonb_array_length(coalesce(proof->'company_names','[]'::jsonb))
  or (select count(distinct x->>'symbol') from jsonb_array_elements(p_base_inputs)x)<>72 or (select count(distinct x->>'symbol') from jsonb_array_elements(p_inputs)x)<>72 then raise exception 'AI_INTAKE_FINANCIAL_COMPANY';end if;
 if jsonb_array_length(proof->'responses')>0 and exists(select from unnest(allowed_sources[1:3])u where not exists(select from jsonb_array_elements(proof->'responses')r where r->>'source'=u)) then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
 if (select count(distinct x->>'source') from jsonb_array_elements(proof->'responses')x)<>jsonb_array_length(proof->'responses') then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
 for response in select * from jsonb_array_elements(proof->'responses') loop
  if jsonb_typeof(response) is distinct from 'object' or (select count(*) from jsonb_object_keys(response))<>7 then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
  if not(coalesce(response->>'source','')=any(allowed_sources)) then raise exception 'AI_INTAKE_FINANCIAL_SOURCE';end if;
  if response->>'state'='CAPTURED' then
   if response->'error' is distinct from 'null'::jsonb or jsonb_typeof(response->'response_text') is distinct from 'string'
    or octet_length(response->>'response_text') not between 2 and 2000000
    or response->>'source_sha256' is distinct from encode(sha256(convert_to(response->>'response_text','UTF8')),'hex')
    or jsonb_typeof(response->'source_bytes') is distinct from 'number' or (response->>'source_bytes')::numeric<>octet_length(response->>'response_text')
    or response->>'received_at' is null or not isfinite((response->>'received_at')::timestamptz)
    or (response->>'received_at')::timestamptz>(proof->>'observed_at')::timestamptz
    or ((response->>'received_at')::timestamptz at time zone 'Asia/Taipei')::date<>p_business_date then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
   rows:=(response->>'response_text')::jsonb;
   if jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)>5000 or exists(select from jsonb_array_elements(rows)x where jsonb_typeof(x)<>'object') then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
  elsif response->>'state'='UNAVAILABLE' then
   if response->'received_at' is distinct from 'null'::jsonb or response->'source_sha256' is distinct from 'null'::jsonb
    or response->'source_bytes' is distinct from 'null'::jsonb or response->'response_text' is distinct from 'null'::jsonb
    or coalesce(response->>'error','') !~ '^AI_FINANCIAL_REFRESH_[A-Z_]{1,80}$' then raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
  else raise exception 'AI_INTAKE_FINANCIAL_RESPONSE';end if;
 end loop;
 if (select count(distinct (a->>'symbol')||':'||((a->>'body_text')::jsonb->>'kind')) from jsonb_array_elements(proof->'additions')a)<>jsonb_array_length(proof->'additions') then raise exception 'AI_INTAKE_FINANCIAL_ADDITION';end if;
 for addition in select * from jsonb_array_elements(proof->'additions') loop
  if not exists(select from jsonb_array_elements(p_base_inputs)i where i->>'symbol'=addition->>'symbol') or jsonb_typeof(addition->'body_text') is distinct from 'string'
   or jsonb_typeof(addition->'row_text') is distinct from 'string' or octet_length(addition->>'body_text')>12000 or octet_length(addition->>'row_text')>30000 then raise exception 'AI_INTAKE_FINANCIAL_ADDITION';end if;
  body:=(addition->>'body_text')::jsonb;row:=(addition->>'row_text')::jsonb;kind:=body->>'kind';source:=body->>'source';
  select x into strict response from jsonb_array_elements(proof->'responses')x where x->>'source'=source and x->>'state'='CAPTURED';
  rows:=(response->>'response_text')::jsonb;
  if row is distinct from vnext_runtime.daily_ai_financial_latest_v5(rows,addition->>'symbol',(response->>'received_at')::timestamptz,source,kind) then raise exception 'AI_INTAKE_FINANCIAL_ROW';end if;
  if kind='EPS_AS_REPORTED' and source=allowed_sources[3] then
   select x into prior_response from jsonb_array_elements(proof->'responses')x where x->>'source'=allowed_sources[1] and x->>'state'='CAPTURED';
   if prior_response is not null and vnext_runtime.daily_ai_financial_latest_v3((prior_response->>'response_text')::jsonb,addition->>'symbol',(prior_response->>'received_at')::timestamptz) is not null then raise exception 'AI_INTAKE_FINANCIAL_PRIORITY';end if;
  end if;
  if kind='VALUATION_AS_REPORTED' and source=allowed_sources[5] then
   select x into prior_response from jsonb_array_elements(proof->'responses')x where x->>'source'=allowed_sources[4] and x->>'state'='CAPTURED';
   if prior_response is not null then
    prior_row:=vnext_runtime.daily_ai_financial_latest_v5((prior_response->>'response_text')::jsonb,addition->>'symbol',(prior_response->>'received_at')::timestamptz,allowed_sources[4],kind);
    if prior_row is not null and vnext_runtime.daily_ai_financial_body_v5(addition->>'symbol',kind,prior_row,prior_response,repeat('0',64)) is not null then raise exception 'AI_INTAKE_FINANCIAL_PRIORITY';end if;
   end if;
  end if;
  expected:=vnext_runtime.daily_ai_financial_body_v5(addition->>'symbol',kind,row,response,encode(sha256(convert_to(addition->>'row_text','UTF8')),'hex'));
  hash:=encode(sha256(convert_to(addition->>'body_text','UTF8')),'hex');
  if expected is null or body is distinct from expected or addition->>'fact_id' is distinct from 'official-open-api:'||(addition->>'symbol')||':'||kind||':'||(body->>'period')||':'||hash then raise exception 'AI_INTAKE_FINANCIAL_MAPPING';end if;
  fact:=body||jsonb_build_object('id',addition->>'fact_id','evidence_hash',hash);fresh:=fresh||jsonb_build_array(fact);
 end loop;
 for audit in select * from jsonb_array_elements(coalesce(proof->'company_names','[]'::jsonb)) loop
  select x into strict old_company from jsonb_array_elements(p_base_inputs)x where x->>'symbol'=audit->>'symbol';
  select x into strict new_company from jsonb_array_elements(p_inputs)x where x->>'symbol'=audit->>'symbol';
  if old_company->'company' is not distinct from new_company->'company' or not vnext_runtime.daily_ai_financial_company_v5(old_company,new_company,proof) then raise exception 'AI_INTAKE_FINANCIAL_COMPANY';end if;
 end loop;
 for stock in select * from jsonb_array_elements(p_base_inputs) loop
  select x into strict incoming from jsonb_array_elements(p_inputs)x where x->>'symbol'=stock->>'symbol';kept:='[]';
  if not vnext_runtime.daily_ai_financial_company_v5(stock,incoming,proof) then raise exception 'AI_INTAKE_FINANCIAL_COMPANY';end if;
  for old_fact in select * from jsonb_array_elements(stock->'facts') loop
   reason:=null;
   if vnext_runtime.daily_ai_financial_restricted_v3(old_fact->>'source') then reason:='RESTRICTED_COMPANY_WEBSITE_FACT_REMOVED_WITHOUT_RELABEL';
   elsif old_fact->>'id' like 'official-open-api:%' and exists(select from jsonb_array_elements(fresh)f where f->>'symbol'=stock->>'symbol' and f->>'kind'=old_fact->>'kind' and f->>'period'=old_fact->>'period' and f->>'source'=old_fact->>'source') then reason:='OFFICIAL_API_SAME_REPORTED_PERIOD_SUPERSEDED_BY_NEW_RECEIPT';end if;
   if reason is null then kept:=kept||jsonb_build_array(old_fact);else removed:=removed||jsonb_build_array(jsonb_build_object('symbol',stock->>'symbol','id',old_fact->>'id','source',old_fact->>'source','kind',old_fact->>'kind','period',old_fact->'period','evidence_hash',old_fact->>'evidence_hash','reason',reason));end if;
  end loop;
  for new_fact in select f from jsonb_array_elements(fresh)f where f->>'symbol'=stock->>'symbol' loop kept:=kept||jsonb_build_array(new_fact);end loop;
  if incoming->'facts' is distinct from kept then raise exception 'AI_INTAKE_FINANCIAL_RETAINED_BYTES';end if;
 end loop;
 if p_refresh is null then proof:=proof||jsonb_build_object('removals',removed);else
  select coalesce(jsonb_agg(jsonb_strip_nulls(x) order by x->>'symbol',x->>'id',x->>'reason'),'[]') into actual_removed from jsonb_array_elements(proof->'removals')x;
  select coalesce(jsonb_agg(jsonb_strip_nulls(x) order by x->>'symbol',x->>'id',x->>'reason'),'[]') into expected_removed from jsonb_array_elements(removed)x;
  if actual_removed is distinct from expected_removed then raise exception 'AI_INTAKE_FINANCIAL_REMOVALS';end if;
 end if;
 return proof;
end $$;
revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_v5(jsonb,jsonb,jsonb,timestamptz,date) from public,anon,authenticated,service_role;



create or replace function vnext_runtime.daily_stock_ai_intake_view_v1(p_id uuid,p_state text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema','DAILY_AI_INTAKE_SOURCE_V1','state',p_state,'intake_id',q.id,'lease',q.lease,
  'business_date',q.business_date,'revision',q.revision,'policy_reason',q.policy_reason,'requested_at',to_char(q.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1','source_kind',q.source_kind,'source_id',q.source_id,
  'source_revision',q.source_revision,'source_cutoff',q.source_cutoff,'source_business_date',q.source_business_date,'snapshot_hash',q.snapshot_hash,
  'companies',q.companies,'inputs',case when q.state in('SOURCED','COMPLETE') then q.inputs else q.base_inputs end,
  'source_issues',q.source_issues,'cutoff',q.cutoff_text,'news',coalesce(q.news,'[]'::jsonb),'market',q.market,'financial_refresh',case when q.financial_refresh is null then null else jsonb_build_object(
   'schema','DAILY_AI_FINANCIAL_RECEIPT_SUMMARY_V1','observed_at',q.financial_refresh->>'observed_at',
   'responses',(select coalesce(jsonb_agg(r-'response_text'),'[]') from jsonb_array_elements(q.financial_refresh->'responses')r),
   'additions',jsonb_array_length(q.financial_refresh->'additions'),'removals',jsonb_array_length(q.financial_refresh->'removals'),
   'proof_hash',encode(sha256(convert_to(q.financial_refresh::text,'UTF8')),'hex'))end,
  'intake_gaps',q.intake_gaps,'gaps_by_symbol',q.gaps_by_symbol,'member_published',false)
 from vnext_runtime.ai_stock_intakes q where q.id=p_id;
$$;
revoke all on function vnext_runtime.daily_stock_ai_intake_view_v1(uuid,text) from public,anon,authenticated,service_role;


create or replace function vnext_runtime.seal_daily_stock_ai_intake_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.state='COMPLETE' then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE'
  and not vnext_runtime.validate_daily_ai_market_v1(new.market,new.cutoff,new.business_date) then raise exception 'AI_INTAKE_MARKET_POLICY';end if;
 if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE' and exists(
  select from jsonb_array_elements(new.inputs)i,jsonb_array_elements(i->'facts')f
   where vnext_runtime.daily_ai_financial_restricted_v3(f->>'source')) then raise exception 'AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE';end if;
 if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE' and exists(
  select from jsonb_array_elements(new.news)n where not exists(select from vnext_private.ai_verified_news_v5 v
   where v.evidence_id=n->>'id' and v.evidence=n)) then raise exception 'AI_INTAKE_NEWS_POLICY';end if;
 if old.state='SOURCED' and (tg_op='DELETE' or new.state<>'COMPLETE'
  or (to_jsonb(new)-array['state','batch_id','updated_at']) is distinct from (to_jsonb(old)-array['state','batch_id','updated_at']))
  then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function vnext_runtime.seal_daily_stock_ai_intake_v1() from public,anon,authenticated,service_role;


create or replace function public.daily_stock_ai_intake_v1(p_op text,p_intake_id uuid,p_lease uuid default null,
 p_inputs jsonb default null,p_gaps jsonb default null,p_batch_id text default null,p_code text default null,p_symbol_gaps jsonb default null,p_market jsonb default null,p_financial_refresh jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set work_mem='16MB' as $$
declare q vnext_runtime.ai_stock_intakes;prior vnext_runtime.ai_stock_intakes;r vnext_runtime.runs;
 base jsonb;dirs jsonb;companies jsonb;frozen jsonb;final_inputs jsonb;gaps jsonb;item jsonb;old_item jsonb;b vnext_runtime.ai_stock_batches;
 at_time timestamptz:=clock_timestamp();cutoff_value timestamptz;financial_proof jsonb;
begin
 if p_op is null or p_op not in('CLAIM','SOURCE','COMPLETE','FAIL') or p_intake_id is null then raise exception 'AI_INTAKE_SCOPE';end if;
 select * into strict q from vnext_runtime.ai_stock_intakes where id=p_intake_id for update;
 if q.state='COMPLETE' then
  if p_op='COMPLETE' and p_batch_id is distinct from q.batch_id then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  return jsonb_build_object('state','CACHED','intake_id',q.id,'batch_id',q.batch_id,'member_published',false);
 end if;
 if p_op='CLAIM' then
  if q.state='SOURCED' then return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');end if;
  if q.business_date<>(at_time at time zone 'Asia/Taipei')::date then return jsonb_build_object('state','EXPIRED','intake_id',q.id,'member_published',false);end if;
  if q.state='RUNNING' and q.lease_until>at_time then return jsonb_build_object('state','BUSY','intake_id',q.id,'member_published',false);end if;
  if q.attempts>=3 then return jsonb_build_object('state','EXHAUSTED','intake_id',q.id,'member_published',false);end if;
  if q.base_inputs is null then
   select * into prior from vnext_runtime.ai_stock_intakes where id<>q.id and state in('SOURCED','COMPLETE')
    and cutoff<=at_time and (business_date<q.business_date or business_date=q.business_date and revision<q.revision) order by cutoff desc limit 1;
   select * into r from vnext_runtime.runs where source_revision ~ '^[a-f0-9]{64}$'
    and checkpoint->'acquired'->>'snapshot_hash'=source_revision and jsonb_typeof(checkpoint->'acquired'->'inputs')='array'
    and jsonb_array_length(checkpoint->'acquired'->'inputs')=72
    and (checkpoint->'acquired'->>'evidence_cutoff')::timestamptz<=at_time order by business_date desc,updated_at desc limit 1;
   if prior.id is not null and (r.id is null or prior.cutoff>=(r.checkpoint->'acquired'->>'evidence_cutoff')::timestamptz) then
    q.source_kind:='ASOF_INTAKE';q.source_id:=prior.id;q.source_revision:=prior.snapshot_hash;
    q.source_cutoff:=prior.cutoff_text;q.source_business_date:=prior.business_date;
    base:=vnext_runtime.project_daily_stock_ai_inputs_v1(prior.inputs);companies:=prior.companies;q.source_issues:=prior.source_issues;
   elsif r.id is not null then
    q.source_kind:='VNEXT_ACQUIRED';q.source_id:=r.id;q.source_revision:=r.source_revision;
    q.source_cutoff:=r.checkpoint->'acquired'->>'evidence_cutoff';q.source_business_date:=r.business_date;
    base:=vnext_runtime.project_daily_stock_ai_inputs_v1(r.checkpoint->'acquired'->'inputs');
    q.source_issues:=coalesce(r.checkpoint->'acquired'->'source_issues','[]'::jsonb);
    select coalesce(jsonb_agg(x),'[]'::jsonb) into dirs from vnext_runtime.run_sources rs
     join vnext_runtime.source_revisions sr on sr.id=rs.source_id,
     lateral jsonb_array_elements(sr.receipt->'payload'->'rows')x
     where rs.run_id=r.id and sr.receipt->'task'->>'kind'='DIRECTORY' and sr.receipt->>'status'='OK';
    select jsonb_agg(jsonb_build_object('symbol',i->>'symbol','company',i->>'company','exchange',d.exchange) order by i->>'symbol') into companies
     from jsonb_array_elements(base)i cross join lateral(select min(x->>'exchange') exchange from jsonb_array_elements(dirs)x
      where x->>'symbol'=i->>'symbol' having count(distinct x->>'exchange')=1 and min(x->>'exchange') in('TWSE','TPEX'))d;
   else return jsonb_build_object('state','SOURCE_UNAVAILABLE','intake_id',q.id,'member_published',false);end if;
   if jsonb_array_length(companies) is distinct from 72 or (select count(distinct x->>'symbol') from jsonb_array_elements(base)x)<>72 then raise exception 'AI_INTAKE_BASE_UNIVERSE';end if;
   q.base_inputs:=base;q.companies:=companies;
  end if;
  update vnext_runtime.ai_stock_intakes set state='RUNNING',attempts=attempts+1,lease=gen_random_uuid(),lease_until=at_time+interval '120 seconds',
   source_kind=q.source_kind,source_id=q.source_id,source_revision=q.source_revision,source_cutoff=q.source_cutoff,source_business_date=q.source_business_date,
   base_inputs=q.base_inputs,companies=q.companies,source_issues=q.source_issues,intake_gaps='["RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED","FINANCIAL_RETAINED_OBSERVATIONS_MAY_BE_STALE","INSTITUTIONAL_FLOW_NOT_REFRESHED","CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY"]',
   last_code=null,updated_at=at_time where id=q.id;
  return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'ACQUIRED');
 end if;
 if p_lease is null or p_lease is distinct from q.lease then raise exception 'AI_INTAKE_LEASE';end if;
 if p_op='COMPLETE' then
  if q.state<>'SOURCED' or p_batch_id is null then raise exception 'AI_INTAKE_NOT_SOURCED';end if;
  select * into strict b from vnext_runtime.ai_stock_batches where id=p_batch_id;
  if b.cutoff<>q.cutoff or jsonb_array_length(b.payload->'packets')<>72 or b.payload->>'through' is distinct from q.inputs->0->>'through'
   or b.payload->'source_handoff' is not null
   or b.payload->'source_intake' is distinct from jsonb_build_object('intake_id',q.id,'snapshot_hash',q.snapshot_hash,
    'source_kind',q.source_kind,'source_id',q.source_id,'source_revision',q.source_revision,'source_cutoff',q.source_cutoff,
    'source_business_date',q.source_business_date,'projection','DAILY_AI_RETAINED_INPUT_PROJECTION_V1')
   then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  -- Keep the original scope/error contract, but expand the wide retained input
  -- once into a compact identity relation instead of spilling it 72 times.
  if exists(with input_scope as materialized(select i->>'symbol' symbol,i->>'company' company,i->>'cutoff' cutoff from jsonb_array_elements(q.inputs)i)
   select from jsonb_array_elements(b.payload->'packets')p where not exists(select from input_scope i
    where i.symbol=p->>'symbol' and i.company=p->>'company' and i.cutoff=p->>'cutoff')) then raise exception 'AI_INTAKE_BATCH_CONFLICT';end if;
  if exists(select from jsonb_array_elements(b.payload->'packets')p where jsonb_typeof(p->'data_gaps') is distinct from 'array'
   or not(p->'data_gaps' @> q.intake_gaps) or not(p->'data_gaps' @> coalesce(q.gaps_by_symbol->(p->>'symbol'),'[]'::jsonb))) then raise exception 'AI_INTAKE_GAPS_OMITTED';end if;
  if not vnext_runtime.validate_daily_ai_intake_batch_evidence_v4(q.inputs,q.news,q.market,q.intake_gaps,q.gaps_by_symbol,b.payload->'packets')
   then raise exception 'AI_INTAKE_EVIDENCE_CONFLICT';end if;
  update vnext_runtime.ai_stock_intakes set state='COMPLETE',batch_id=b.id,updated_at=clock_timestamp() where id=q.id;
  return jsonb_build_object('state','COMPLETE','intake_id',q.id,'batch_id',b.id,'member_published',false);
 end if;
 if q.state='SOURCED' and p_op='SOURCE' then return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');end if;
 if q.state<>'RUNNING' or q.lease_until<=at_time then raise exception 'AI_INTAKE_LEASE';end if;
 if p_op='FAIL' then
  if p_code is null or p_code !~ '^AI_INTAKE_[A-Z0-9_]{1,80}$' then raise exception 'AI_INTAKE_CODE';end if;
  update vnext_runtime.ai_stock_intakes set state='FAILED',last_code=p_code,lease_until=at_time,updated_at=at_time where id=q.id;
  return jsonb_build_object('state','FAILED','intake_id',q.id,'member_published',false);
 end if;
 if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72 or octet_length(p_inputs::text)>8000000
  or (select count(distinct x->>'symbol') from jsonb_array_elements(p_inputs)x)<>72
  or jsonb_typeof(coalesce(p_gaps,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_gaps,'[]'::jsonb))>30
  or exists(select from jsonb_array_elements(coalesce(p_gaps,'[]'::jsonb))g where jsonb_typeof(g)<>'string' or (g#>>'{}') !~ '^[A-Z][A-Z0-9_]{0,99}$')
  or jsonb_typeof(coalesce(p_symbol_gaps,'{}'::jsonb))<>'object' then raise exception 'AI_INTAKE_INPUTS';end if;
 if p_symbol_gaps is not null and p_symbol_gaps<>'{}'::jsonb and ((select count(*) from jsonb_object_keys(p_symbol_gaps))<>72
  or exists(select from jsonb_each(p_symbol_gaps)sg where not exists(select from jsonb_array_elements(q.base_inputs)i where i->>'symbol'=sg.key)
   or jsonb_typeof(sg.value)<>'array' or jsonb_array_length(sg.value)>20 or exists(select from jsonb_array_elements(sg.value)g
    where jsonb_typeof(g)<>'string' or (g#>>'{}') !~ '^[A-Z][A-Z0-9_]{0,99}$'))) then raise exception 'AI_INTAKE_SYMBOL_GAPS';end if;
 for item in select * from jsonb_array_elements(p_inputs) loop
  select x into strict old_item from jsonb_array_elements(q.base_inputs)x where x->>'symbol'=item->>'symbol';
  if not vnext_runtime.daily_ai_financial_company_v5(old_item,item,p_financial_refresh)
   or coalesce(item->>'through','') !~ '^\d{4}-\d\d-\d\d$' or item->>'through'<old_item->>'through' or item->>'through'>(q.business_date::text)
   or jsonb_typeof(item->'expected_sessions') is distinct from 'array' or jsonb_array_length(item->'expected_sessions')>250
   or jsonb_typeof(item->'bars') is distinct from 'array' or jsonb_array_length(item->'bars')>250
   or exists(select from jsonb_array_elements(old_item->'bars')ob where item->'expected_sessions' ? (ob->>'date')
    and not exists(select from jsonb_array_elements(item->'bars')nb where nb=ob)) then raise exception 'AI_INTAKE_RETAINED_BYTES';end if;
 end loop;
 if (select count(distinct i->>'through') from jsonb_array_elements(p_inputs)i)<>1 then raise exception 'AI_INTAKE_THROUGH';end if;
 frozen:=vnext_runtime.freeze_daily_stock_ai_verified_news_v5(p_inputs);cutoff_value:=(frozen->>'cutoff')::timestamptz;
 if (cutoff_value at time zone 'Asia/Taipei')::date<>q.business_date then raise exception 'AI_INTAKE_DATE_EXPIRED';end if;
 financial_proof:=vnext_runtime.validate_daily_ai_financial_refresh_v5(q.base_inputs,p_inputs,p_financial_refresh,cutoff_value,q.business_date);
 if not vnext_runtime.validate_daily_ai_market_v1(coalesce(p_market,'[]'::jsonb),cutoff_value,q.business_date) then raise exception 'AI_INTAKE_MARKET';end if;
 if exists(select from jsonb_array_elements(p_inputs)i,jsonb_array_elements((i->'bars')||(i->'facts'))tr
  where tr->>'available_at' is null or not isfinite((tr->>'available_at')::timestamptz) or (tr->>'available_at')::timestamptz>cutoff_value)
  then raise exception 'AI_INTAKE_FUTURE_RECEIPT';end if;
 select jsonb_agg(i||jsonb_build_object('cutoff',frozen->>'cutoff') order by i->>'symbol') into final_inputs from jsonb_array_elements(p_inputs)i;
 final_inputs:=vnext_runtime.project_daily_stock_ai_inputs_v1(final_inputs);
 select jsonb_agg(to_jsonb(code) order by code) into gaps from(select distinct value#>>'{}' code from jsonb_array_elements(q.intake_gaps||coalesce(p_gaps,'[]'::jsonb)||
  '["NEWS_SOURCE_POLICY_GNEWS_EXCLUDED","OFFICIAL_NEWS_FIXED_FEEDS_NOT_ALL_COMPANY_OR_MARKET_NEWS","MOPS_PUBLICATION_TIMEZONE_UNDECLARED_RECEIPT_BASIS_ONLY","OFFICIAL_NEWS_EXCERPT_NOT_FULL_DISCLOSURE","FED_RSS_NOT_EQUITY_CLOSE_OR_COMPLETE_MACRO_COVERAGE","OFFICIAL_NEWS_SNAPSHOT_COMPANY_LIMIT_12_GLOBAL_LIMIT_4","NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES"]'::jsonb||
  case when jsonb_array_length(coalesce(p_market,'[]'::jsonb))=0 then '["MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE"]'::jsonb else '[]'::jsonb end||
  case when exists(select from jsonb_array_elements(frozen->'news')n where n->>'id' like 'retained-own-news:%') then '["OWN_FACTS_RETAINED_BACKGROUND_NOT_FRESH_NEWS"]'::jsonb else '[]'::jsonb end||
  case when jsonb_array_length(frozen->'news')=0 then '["NEWS_NONE_AVAILABLE_WITHIN_48H"]'::jsonb else '[]'::jsonb end))all_gaps;
 select jsonb_agg(c||jsonb_build_object('company',i->>'company') order by c->>'symbol') into dirs
  from jsonb_array_elements(q.companies)c join jsonb_array_elements(p_inputs)i on i->>'symbol'=c->>'symbol';
 if jsonb_array_length(dirs) is distinct from 72 then raise exception 'AI_INTAKE_COMPANY_DIRECTORY';end if;
 update vnext_runtime.ai_stock_intakes set state='SOURCED',companies=dirs,financial_refresh=financial_proof,inputs=final_inputs,news=frozen->'news',market=coalesce(p_market,'[]'::jsonb),cutoff=cutoff_value,cutoff_text=frozen->>'cutoff',intake_gaps=gaps,
  gaps_by_symbol=coalesce(p_symbol_gaps,'{}'::jsonb),snapshot_hash=encode(sha256(convert_to(jsonb_build_object(
   'schema','DAILY_AI_INTAKE_SNAPSHOT_V1','financial_refresh',financial_proof,'inputs',final_inputs,'news',frozen->'news','market',coalesce(p_market,'[]'::jsonb),'cutoff',frozen->>'cutoff',
   'intake_gaps',gaps,'gaps_by_symbol',coalesce(p_symbol_gaps,'{}'::jsonb),'source_issues',q.source_issues,
   'source_kind',q.source_kind,'source_id',q.source_id,'source_revision',q.source_revision,'source_cutoff',q.source_cutoff)::text,'UTF8')),'hex'),updated_at=clock_timestamp() where id=q.id;
 return vnext_runtime.daily_stock_ai_intake_view_v1(q.id,'SOURCED');
end $$;
revoke all on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb) to service_role;

commit;
