-- Corrective source-use policy only; retains all existing records and gates.
-- Treasury XML is rate context, never an equity close. No review/permission is inserted.
-- Replaces market admission, COMPLETE seal, primary documents and watchdog prompt identity.
-- Requires the previously approved intake + use-review schema; no Cron changes.
begin;
create or replace function vnext_runtime.validate_daily_ai_market_v1(p_market jsonb,p_cutoff timestamptz,p_business_date date) returns boolean
language plpgsql immutable set search_path='' as $$
declare e jsonb;c jsonb;native_symbol text;seen text[]:='{}';tenor text;source_month text;prior_month text;ny_receipt date;
begin
 if jsonb_typeof(p_market) is distinct from 'array' or jsonb_array_length(p_market)>2 or octet_length(p_market::text)>60000
  or (select count(distinct m->>'id') from jsonb_array_elements(p_market)m)<>jsonb_array_length(p_market) then return false;end if;
 for e in select * from jsonb_array_elements(p_market) loop
  if (select count(*) from jsonb_object_keys(e))<>11 or jsonb_typeof(e->'id') is distinct from 'string'
   or coalesce(btrim(e->>'id'),'')='' or length(e->>'id')>200 or jsonb_typeof(e->'source') is distinct from 'string'
   or e->>'kind' is distinct from 'MARKET' or e->'symbol' is distinct from 'null'::jsonb
   or e->'published_at' is distinct from 'null'::jsonb or e->>'time_basis' is distinct from 'OBSERVED_AFTER_RECEIPT'
   or coalesce(e->>'available_at','') !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$'
   or not isfinite((e->>'available_at')::timestamptz) or (e->>'available_at')::timestamptz>p_cutoff
   or e->>'first_seen_at' is distinct from e->>'available_at' or e->>'as_of' is distinct from e->>'available_at'
   or jsonb_typeof(e->'content') is distinct from 'string' or length(e->>'content') not between 1 and 12000
   or e->>'evidence_hash' is distinct from encode(sha256(convert_to(e->>'content','UTF8')),'hex') then return false;end if;
  c:=(e->>'content')::jsonb;
  if jsonb_typeof(c) is distinct from 'object' or c->>'schema' is distinct from 'DAILY_AI_GLOBAL_MARKET_FACT_V1'
   or c->>'research_business_date' is distinct from p_business_date::text
   or c->>'timestamp_basis' is distinct from 'RECEIPT_ONLY_PUBLICATION_UNKNOWN'
   or c->>'received_at' is distinct from e->>'available_at'
   or coalesce(c->>'source_response_sha256','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(c->'source_response_bytes') is distinct from 'number' or (c->>'source_response_bytes')::numeric not between 1 and 2000000
   or coalesce(c->>'comparison_basis','')='' or coalesce(c->>'calendar_version','')=''
   or coalesce(c->>'session_date','') !~ '^\d{4}-\d\d-\d\d$' or (c->>'session_date')::date>p_business_date
   or coalesce(c->>'trading_date','') !~ '^\d{4}-\d\d-\d\d$' then return false;end if;
  native_symbol:=c->>'native_symbol';
  if native_symbol=any(seen) then return false;end if;seen:=array_append(seen,native_symbol);
  if c->>'kind'='US_TREASURY_PAR_YIELD_CURVE' then
   source_month:=replace(substring(c->>'session_date' from 1 for 7),'-','');
   prior_month:=to_char(date_trunc('month',p_business_date::timestamp)-interval '1 month','YYYYMM');
   ny_receipt:=((e->>'available_at')::timestamptz at time zone 'America/New_York')::date;
   if native_symbol is distinct from 'UST_PAR_YIELD_CURVE' or c->>'market' is distinct from 'US' or c->>'session' is distinct from 'DAILY_OBSERVATION'
    or c->>'currency' is distinct from 'USD' or c->>'unit' is distinct from 'PERCENT'
    or c->>'freshness' is distinct from 'LATEST_AVAILABLE_TREASURY_OBSERVATION'
    or c->>'calendar_version' is distinct from 'TREASURY_XML_ACTUAL_DATES_V1'
    or c->>'comparison_basis' is distinct from 'PREVIOUS_AVAILABLE_TREASURY_OBSERVATION'
    or c->>'rate_model' is distinct from 'NOMINAL_CONSTANT_MATURITY_PAR_YIELD'
    or c->>'source_row_date_basis' is distinct from 'NEW_DATE_DATE_COORDINATE_NOT_PUBLICATION'
    or c->>'observation_date_coordinate' is distinct from (c->>'session_date')||'T00:00:00'
    or c->>'trading_date' is distinct from c->>'session_date' or (c->>'session_date')::date>ny_receipt
    or ny_receipt-(c->>'session_date')::date not between 0 and 7
    or jsonb_typeof(c->'observation_age_calendar_days') is distinct from 'number'
    or (c->>'observation_age_calendar_days')::numeric<>ny_receipt-(c->>'session_date')::date
    or source_month not in(to_char(p_business_date,'YYYYMM'),prior_month)
    or e->>'source' is distinct from 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month='||source_month
    or c ?| array['close','change_points','change_percent','prior_close','source_bar_at','prior_bar_at','bar_timestamp_basis']
    or not(c?'prior_session_date') then return false;end if;
   foreach tenor in array array['2y','10y','30y'] loop
    if jsonb_typeof(c->('yield_'||tenor)) is distinct from 'number' or abs((c->>('yield_'||tenor))::numeric)>100 then return false;end if;
    if c->'prior_session_date'='null'::jsonb then
     if c->('prior_yield_'||tenor) is distinct from 'null'::jsonb or c->('change_'||tenor||'_bp') is distinct from 'null'::jsonb then return false;end if;
    else
     if coalesce(c->>'prior_session_date','') !~ '^\d{4}-\d\d-\d\d$' or (c->>'prior_session_date')::date>=(c->>'session_date')::date
      or replace(substring(c->>'prior_session_date' from 1 for 7),'-','')<>source_month
      or jsonb_typeof(c->('prior_yield_'||tenor)) is distinct from 'number' or abs((c->>('prior_yield_'||tenor))::numeric)>100
      or jsonb_typeof(c->('change_'||tenor||'_bp')) is distinct from 'number'
      or abs((c->>('change_'||tenor||'_bp'))::numeric-((c->>('yield_'||tenor))::numeric-(c->>('prior_yield_'||tenor))::numeric)*100)>0.000001 then return false;end if;
    end if;
   end loop;
  elsif c->>'kind'='TAIWAN_NIGHT_FUTURE' then
   -- Friday night can be attributed by the exchange to Monday. It remains a
   -- received AFTERHOURS observation; do not relabel that native trading date.
   if native_symbol is distinct from 'TX' or c->>'market' is distinct from 'TW' or c->>'session' is distinct from 'AFTERHOURS'
    or c->>'unit' is distinct from 'INDEX_POINTS' or c->>'freshness' is distinct from 'LATEST_COMPLETED_SESSION'
    or jsonb_typeof(c->'close') is distinct from 'number' or (c->>'close')::numeric<=0
    or jsonb_typeof(c->'change_points') is distinct from 'number' or jsonb_typeof(c->'change_percent') is distinct from 'number'
    or c->>'currency' is distinct from 'TWD' or not(coalesce(e->>'source','')='https://openapi.taifex.com.tw/v1/DailyMarketReportFut'
     or coalesce(e->>'source','')='https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&queryDate='||replace(c->>'trading_date','-','%2F')||'&commodity_id=TX') then return false;end if;
  else return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function vnext_runtime.validate_daily_ai_market_v1(jsonb,timestamptz,date) from public,anon,authenticated,service_role;

create or replace function vnext_runtime.seal_daily_stock_ai_intake_v1() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.state='COMPLETE' then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='UPDATE' and old.state='SOURCED' and new.state='COMPLETE'
  and not vnext_runtime.validate_daily_ai_market_v1(new.market,new.cutoff,new.business_date) then raise exception 'AI_INTAKE_MARKET_POLICY';end if;
 if old.state='SOURCED' and (tg_op='DELETE' or new.state<>'COMPLETE'
  or (to_jsonb(new)-array['state','batch_id','updated_at']) is distinct from (to_jsonb(old)-array['state','batch_id','updated_at']))
  then raise exception 'AI_INTAKE_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function vnext_runtime.seal_daily_stock_ai_intake_v1() from public,anon,authenticated,service_role;

create or replace function vnext_private.ai_use_primary_documents_v1(p_basis text,p_urls text[],p_sources text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(cardinality(p_urls) between 1 and 20
  and (select count(distinct u) from unnest(p_urls)u)=cardinality(p_urls)
  and not exists(select from unnest(p_sources)src where src ~* '^https://([a-z0-9-]+\.)*yahoo[.]com([/:]|$)')
  and not exists(select from unnest(p_urls)u where u is null or length(u) not between 12 and 3000
   or u !~ '^https://([a-z0-9-]+\.)*(twse\.com\.tw|tpex\.org\.tw|taifex\.com\.tw|treasury\.gov|catalog\.data\.gov|data\.gov\.tw|tipo\.gov\.tw|tsmc\.com|honhai\.com|mediatek\.com|realtek\.com|wistron\.com|esmt\.com\.tw|udngroup\.com|udn\.com|cna\.com\.tw|ltn\.com\.tw)/[^#[:space:]]*$'
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

create or replace function public.resume_daily_stock_ai_intake_v1(p_intake_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q vnext_runtime.ai_stock_intakes;b vnext_runtime.ai_stock_batches;done integer;retryable integer;keys text[];receipt jsonb;
 target_revision constant text:='gpt-4o-mini:DAILY_AI_STOCK_ANALYSIS_V1:prompt-5';at_time timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended('daily-ai-resume:'||p_intake_id::text,0));
 select * into strict q from vnext_runtime.ai_stock_intakes where id=p_intake_id;
 if q.state<>'COMPLETE' then return public.dispatch_daily_stock_ai_intake_v1(q.id);end if;
 if exists(select from vnext_private.ai_research_editions e where e.batch_id=q.batch_id) then
  return jsonb_build_object('state','EDITION_STAGED','intake_id',q.id,'batch_id',q.batch_id);end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=q.batch_id;
 if b.cutoff+interval '72 hours'<=at_time then return jsonb_build_object('state','BATCH_EXPIRED','intake_id',q.id,'batch_id',b.id);end if;
 select count(*),array_agg(j.id order by j.id) into done,keys from jsonb_each_text(b.payload->'packet_hashes')p
  join vnext_runtime.ai_stock_jobs j on j.symbol=p.key and j.input_hash=p.value and j.cutoff=b.cutoff
   and j.model_revision=target_revision and j.state='COMPLETE';
 if done=72 then
  -- SQL staging cannot incur a model call. It also recovers a failed final
  -- stage even if the 216 transport dispatches have already been consumed.
  begin
   receipt:=public.stage_daily_ai_research_edition_v1(b.id,keys,b.cutoff+interval '72 hours');
   return jsonb_build_object('state','EDITION_STAGED','intake_id',q.id,'batch_id',b.id,'edition_id',receipt->>'edition_id','member_published',false);
  exception when others then return jsonb_build_object('state','STAGING_PENDING','intake_id',q.id,'batch_id',b.id,'member_published',false);end;
 end if;
 if exists(select from jsonb_each_text(b.payload->'packet_hashes')p join vnext_runtime.ai_stock_jobs j
  on j.symbol=p.key and j.input_hash=p.value and j.cutoff=b.cutoff and j.model_revision=target_revision
  where j.state='RUNNING' and j.lease_until>at_time) then return jsonb_build_object('state','BUSY','intake_id',q.id,'batch_id',b.id);end if;
 select count(*) into retryable from jsonb_each_text(b.payload->'packet_hashes')p left join vnext_runtime.ai_stock_jobs j
  on j.symbol=p.key and j.input_hash=p.value and j.cutoff=b.cutoff and j.model_revision=target_revision
  where j.id is null or j.state<>'COMPLETE' and j.attempts<3;
 if retryable=0 then return jsonb_build_object('state','EXHAUSTED','intake_id',q.id,'batch_id',b.id);end if;
 if exists(select from vnext_runtime.ai_stock_dispatches where batch_id=b.id and created_at>at_time-interval '5 minutes') then
  return jsonb_build_object('state','COOLDOWN','intake_id',q.id,'batch_id',b.id);end if;
 receipt:=public.dispatch_daily_stock_ai_batch_v1(b.id);
 return jsonb_build_object('state',receipt->>'state','intake_id',q.id,'batch_id',b.id,'member_published',false);
end $$;
revoke all on function public.resume_daily_stock_ai_intake_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.resume_daily_stock_ai_intake_v1(uuid) to service_role;
commit;
