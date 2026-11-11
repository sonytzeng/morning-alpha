-- LOCAL CANDIDATE. Apply only after the exact market V2 base candidate.
-- Original CP950/BIG5 response bytes and decoded UTF8 text have separate
-- hashes. This adds source preparation only: no review, license or publication.
begin;
do $$begin
 if to_regclass('vnext_market.captures') is null or to_regclass('vnext_market.encoded_origins') is not null
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_packet(jsonb,text,text)'))
   is distinct from '43e0301367218b994d84ae5fb24bcacd'
  then raise exception 'MARKET_ENCODED_BASELINE_MISMATCH';end if;
end $$;

create table vnext_market.encoded_origins(
 capture_id text primary key references vnext_market.captures(id),
 raw_bytes bytea not null,raw_sha256 text not null check(raw_sha256=encode(sha256(raw_bytes),'hex')),
 raw_byte_count integer not null check(raw_byte_count=octet_length(raw_bytes) and raw_byte_count between 1 and 8000000),
 source_encoding text not null check(source_encoding='CP950'),
 decoded_utf8_sha256 text not null check(decoded_utf8_sha256~'^[a-f0-9]{64}$'),
 decoder text not null check(decoder='POSTGRES_BIG5_LOSSLESS_V1'),
 stored_at timestamptz not null default clock_timestamp()
);
alter table vnext_market.encoded_origins enable row level security;
alter table vnext_market.encoded_origins force row level security;
revoke all on table vnext_market.encoded_origins from public,anon,authenticated,service_role;
create trigger market_encoded_immutable before update or delete on vnext_market.encoded_origins
 for each row execute function vnext_market.immutable();

create function vnext_market.decode_big5_exact(p_raw bytea) returns text
language plpgsql immutable set search_path='' as $$
declare decoded text;begin
 decoded:=convert_from(p_raw,'BIG5');
 if convert_to(decoded,'BIG5') is distinct from p_raw then raise exception 'MARKET_ENCODED_LOSSY_CONVERSION';end if;
 return decoded;
end $$;

-- Same strict byte-offset CSV scanner as the base parser, but preserves the
-- original arrays including the header. First data row has row_path [1].
create function vnext_market.csv_matrix(p_text text) returns setof jsonb
language plpgsql immutable set search_path='' as $$
declare input bytea:=convert_to(ltrim(p_text,chr(65279)),'UTF8');i integer:=0;n integer:=octet_length(input);c integer;
 field_start integer:=0;closing_at integer;field text;fields text[]:='{}';width integer;
 quoted boolean:=false;was_quoted boolean:=false;closed boolean:=false;ended boolean;row_count integer:=0;
begin
 if n>16000000 then raise exception 'MARKET_CSV_SIZE';end if;
 while i<=n loop
  c:=case when i<n then get_byte(input,i) else 10 end;ended:=false;
  if i-field_start>65536 then raise exception 'MARKET_CSV_FIELD_SIZE';end if;
  if quoted then
   if i=n then raise exception 'MARKET_CSV_QUOTE';end if;
   if c=34 then
    if i+1<n and get_byte(input,i+1)=34 then i:=i+1;else quoted:=false;closed:=true;closing_at:=i;end if;
   end if;
  elsif c=34 then
   if i<>field_start or closed then raise exception 'MARKET_CSV_QUOTE';end if;
   quoted:=true;was_quoted:=true;field_start:=i+1;
  elsif c in(44,13,10) then
   field:=convert_from(substring(input from field_start+1 for (case when was_quoted then closing_at else i end)-field_start),'UTF8');
   if was_quoted then field:=replace(field,'""','"');end if;
   fields:=array_append(fields,field);closed:=false;was_quoted:=false;closing_at:=null;
   if cardinality(fields)>128 then raise exception 'MARKET_CSV_COLUMNS';end if;
   if c<>44 then
    if c=13 and i+1<n and get_byte(input,i+1)=10 then i:=i+1;end if;ended:=true;
   end if;field_start:=i+1;
  elsif closed then raise exception 'MARKET_CSV_TRAILING_DATA';end if;
  if ended then
   if exists(select from unnest(fields)v where v<>'') then
    if width is null then width:=cardinality(fields);
    elsif cardinality(fields)<>width then raise exception 'MARKET_CSV_ROW_WIDTH';end if;
    row_count:=row_count+1;if row_count>10001 then raise exception 'MARKET_CSV_ROWS';end if;
    return next to_jsonb(fields);
   end if;fields:='{}';
  end if;i:=i+1;
 end loop;
 if row_count=0 then raise exception 'MARKET_CSV_HEADER';end if;return;
end $$;

create function vnext_market.source_metadata(p_capture_id text)
returns table(id text,source_id text,source_url text,body_sha256 text,body_bytes integer,received_at timestamptz)
language sql stable security definer set search_path='' as $$
 select c.id,c.source_id,c.source_url,coalesce(o.raw_sha256,c.body_sha256),coalesce(o.raw_byte_count,c.body_bytes),c.received_at
 from vnext_market.captures c left join vnext_market.encoded_origins o on o.capture_id=c.id where c.id=p_capture_id
$$;

create function public.stage_daily_ai_market_encoded_capture_v2(p_receipt_text text,p_receipt_hash text,p_source_bytes_base64 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;parts text[];family text;market text;year integer;quarter integer;filename text;parent_url text;
 raw bytea;decoded text;parsed jsonb;cid text;prior record;header jsonb;row_body jsonb;row_ord bigint;
 row_day date;file_day date;period_end date;at_time timestamptz:=clock_timestamp();
begin
 if p_receipt_text is null or octet_length(p_receipt_text) not between 2 and 20000
  or p_receipt_hash is null or p_receipt_hash<>vnext_market.digest(p_receipt_text)
  or p_source_bytes_base64 is null or length(p_source_bytes_base64) not between 4 and 10666668
  or p_source_bytes_base64!~'^[A-Za-z0-9+/]*={0,2}$' then raise exception 'MARKET_ENCODED_SCOPE';end if;
 raw:=decode(p_source_bytes_base64,'base64');r:=p_receipt_text::jsonb;
 if octet_length(raw) not between 1 and 8000000 or replace(encode(raw,'base64'),E'\n','')<>p_source_bytes_base64
  or r->>'schema' is distinct from 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' or r->>'state' is distinct from 'CAPTURED'
  or r->'status' is distinct from '200'::jsonb or r->>'format' is distinct from 'csv'
  or r->>'encoding' is distinct from 'CP950' or r->>'row_layout' is distinct from 'HEADER_AND_DATA_ARRAYS_V1'
  or r->>'url' is distinct from 'https://mopsov.twse.com.tw/server-java/t105sb02' or r->>'request_method' is distinct from 'POST'
  or (r->>'bytes')::integer is distinct from octet_length(raw) or r->>'sha256' is distinct from encode(sha256(raw),'hex')
  or coalesce(r->>'decoded_text_sha256','')!~'^[a-f0-9]{64}$' or coalesce(r->>'parent_html_sha256','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(r->'started_at') is distinct from 'string' or jsonb_typeof(r->'received_at') is distinct from 'string'
  or not isfinite((r->>'started_at')::timestamptz) or not isfinite((r->>'received_at')::timestamptz)
  or (r->>'started_at')::timestamptz>(r->>'received_at')::timestamptz or (r->>'received_at')::timestamptz>at_time
  then raise exception 'MARKET_ENCODED_RECEIPT';end if;
 parts:=regexp_match(r->>'source_id','^MOPS_(INCOME|BALANCE|CASHFLOW)_(TWSE|TPEX|EMERGING)_(20[0-9]{2})Q([1-4])_CSV_([0-9]{8})_([0-9]{6,12})$');
 if parts is null then raise exception 'MARKET_ENCODED_SOURCE';end if;
 family:=parts[1];market:=parts[2];year:=parts[3]::integer;quarter:=parts[4]::integer;
 file_day:=make_date(substr(parts[5],1,4)::integer,substr(parts[5],5,2)::integer,substr(parts[5],7,2)::integer);
 period_end:=(make_date(year,quarter*3,1)+interval '1 month'-interval '1 day')::date;
 filename:=(case when family='CASHFLOW' then 't163sb20_' else 't163sb04_' end)||parts[5]||'_'||parts[6]||'.csv';
 parent_url:='https://mopsov.twse.com.tw/mops/web/ajax_'||case family when 'INCOME' then 't163sb04' when 'BALANCE' then 't163sb05' else 't163sb20' end;
 if not (coalesce(vnext_market.exact(r->'request_form',array['firstin','step','filename']),false)
   or coalesce(vnext_market.exact(r->'request_form',array['firstin','step','filename','saveCSV']),false))
  or r->'request_form'->>'firstin' is distinct from 'true' or r->'request_form'->>'step' is distinct from '10'
  or r->'request_form'->>'filename' is distinct from filename
  or (r->'request_form' ? 'saveCSV' and r->'request_form'->>'saveCSV' is distinct from 'Y')
  or r->>'parent_request_url' is distinct from parent_url
  or jsonb_typeof(r->'parent_request_form') is distinct from 'object'
  or r->'parent_request_form'->>'TYPEK' is distinct from (case market when 'TWSE' then 'sii' when 'TPEX' then 'otc' else 'rotc' end)
  or r->'parent_request_form'->>'year' is distinct from (year-1911)::text
  or r->'parent_request_form'->>'season' is distinct from lpad(quarter::text,2,'0')
  or file_day>((r->>'received_at')::timestamptz at time zone 'Asia/Taipei')::date or file_day<period_end
  then raise exception 'MARKET_ENCODED_REQUEST_BINDING';end if;
 cid:=vnext_market.hash(jsonb_build_object('source_id',r->>'source_id','url',r->>'url','source_sha256',r->>'sha256','received_at',r->>'received_at'));
 perform pg_advisory_xact_lock(hashtextextended('market-encoded:'||cid,0));
 select c.receipt_hash,o.raw_bytes,o.decoded_utf8_sha256 into prior from vnext_market.captures c
  join vnext_market.encoded_origins o on o.capture_id=c.id where c.id=cid;
 if found then
  if prior.receipt_hash is distinct from p_receipt_hash or prior.raw_bytes is distinct from raw
   or prior.decoded_utf8_sha256 is distinct from r->>'decoded_text_sha256' then raise exception 'MARKET_ENCODED_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',p_receipt_hash,'replayed',true);
 end if;
 decoded:=vnext_market.decode_big5_exact(raw);
 if vnext_market.digest(decoded) is distinct from r->>'decoded_text_sha256' or octet_length(decoded)>16000000 then raise exception 'MARKET_ENCODED_DECODED_HASH';end if;
 select jsonb_agg(t.row_body order by t.ord) into parsed from vnext_market.csv_matrix(decoded) with ordinality t(row_body,ord);
 if jsonb_array_length(parsed) is distinct from (r->>'row_count')::integer
  or jsonb_array_length(parsed)-1 is distinct from (r->>'data_row_count')::integer then raise exception 'MARKET_ENCODED_ROW_COUNT';end if;
 header:=parsed->0;
 if header->>0 is distinct from '出表日期' or header->>1 is distinct from '年度' or header->>2 is distinct from '季別'
  or header->>3 is distinct from '公司代號' or header->>4 is distinct from '公司名稱'
  or (family='INCOME' and not exists(select from jsonb_array_elements_text(header)x where x like '%每股盈餘%'))
  or (family='BALANCE' and not exists(select from jsonb_array_elements_text(header)x where regexp_replace(x,'\s','','g') in('資產總計','資產總額')))
  or (family='CASHFLOW' and not exists(select from jsonb_array_elements_text(header)x where x like '%營業活動%現金%'))
  then raise exception 'MARKET_ENCODED_HEADER';end if;
 for row_body,row_ord in select x,ord-1 from jsonb_array_elements(parsed) with ordinality t(x,ord) where ord>1 loop
  if btrim(row_body->>1) is distinct from (year-1911)::text or btrim(row_body->>2) is distinct from quarter::text
   or coalesce(btrim(row_body->>3),'')!~'^[0-9]{4,6}$' or length(btrim(coalesce(row_body->>4,''))) not between 1 and 100
   or coalesce(btrim(row_body->>0),'')!~'^[0-9]{3}/[0-9]{1,2}/[0-9]{1,2}$' then raise exception 'MARKET_ENCODED_ROW_PERIOD';end if;
  row_day:=make_date(split_part(row_body->>0,'/',1)::integer+1911,split_part(row_body->>0,'/',2)::integer,split_part(row_body->>0,'/',3)::integer);
  if row_day is distinct from file_day or row_day<period_end then raise exception 'MARKET_ENCODED_ROW_DATE';end if;
 end loop;
 if (select count(distinct btrim(x->>3)) from jsonb_array_elements(parsed) with ordinality t(x,ord) where ord>1)<>jsonb_array_length(parsed)-1
  then raise exception 'MARKET_ENCODED_DUPLICATE_COMPANY';end if;
 insert into vnext_market.captures(id,source_id,source_url,receipt_text,receipt_hash,receipt,body_text,body_sha256,body_bytes,parsed,received_at)
 values(cid,r->>'source_id',r->>'url',p_receipt_text,p_receipt_hash,r,decoded,vnext_market.digest(decoded),octet_length(decoded),parsed,(r->>'received_at')::timestamptz);
 insert into vnext_market.encoded_origins(capture_id,raw_bytes,raw_sha256,raw_byte_count,source_encoding,decoded_utf8_sha256,decoder)
 values(cid,raw,r->>'sha256',octet_length(raw),'CP950',r->>'decoded_text_sha256','POSTGRES_BIG5_LOSSLESS_V1');
 insert into vnext_market.capture_rows(capture_id,row_index,row_path,row_hash,row_body)
  select cid,(ord-1)::integer,array[(ord-1)::text],vnext_market.hash(x),x from jsonb_array_elements(parsed) with ordinality t(x,ord);
 return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',p_receipt_hash,'replayed',false);
end $$;

revoke all on function vnext_market.decode_big5_exact(bytea),vnext_market.csv_matrix(text),vnext_market.source_metadata(text)
 from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_encoded_capture_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_encoded_capture_v2(text,text,text) to service_role;

-- The following validator retains the complete base contract. Its only source
-- change is the encoded-origin metadata lookup and the explicit issuer market.
create or replace function vnext_market.validate_packet(p_packet jsonb,p_security_id text,p_plan_id text) returns void
language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;c vnext_market.companies;e jsonb;content jsonb;binding jsonb;
 cap record;raw_row jsonb;raw_hash text;path_parts text[];field text;source_symbol text;old_e vnext_market.evidence;
begin
 select * into strict p from vnext_market.work_plans where id=p_plan_id;
 select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=p_security_id;
 if jsonb_typeof(p_packet) is distinct from 'object' or p_packet->>'symbol' is distinct from c.symbol
  or p_packet->>'company' not in(c.company,coalesce(c.body->>'short_name',c.company))
  or (p_packet->>'cutoff')::timestamptz is distinct from p.cutoff
  or jsonb_typeof(p_packet->'evidence') is distinct from 'array' or jsonb_array_length(p_packet->'evidence') not between 1 and 100
  or jsonb_typeof(p_packet->'data_gaps') is distinct from 'array' or jsonb_array_length(p_packet->'data_gaps')>100
  or (p_packet->>'data_through')::date>p.business_date
  or (select count(distinct x->>'id') from jsonb_array_elements(p_packet->'evidence')x)<>jsonb_array_length(p_packet->'evidence')
  then raise exception 'MARKET_PACKET_SCOPE';end if;
 for e in select * from jsonb_array_elements(p_packet->'evidence') loop
  if not coalesce(vnext_market.exact(e,array['id','symbol','kind','source','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash','content']),false)
   or e->>'symbol' is distinct from c.symbol or coalesce(e->>'kind','') not in('MARKET','PRICE','FINANCIAL','NEWS')
   or jsonb_typeof(e->'available_at') is distinct from 'string' or jsonb_typeof(e->'first_seen_at') is distinct from 'string'
   or jsonb_typeof(e->'as_of') is distinct from 'string'
   or length(e->>'content') not between 2 and 200000 or e->>'evidence_hash' is distinct from vnext_market.digest(e->>'content')
   or e->>'id' is distinct from 'market-'||left(e->>'evidence_hash',40)
   then raise exception 'MARKET_EVIDENCE_HASH';end if;
  content:=(e->>'content')::jsonb;binding:=content->'source_capture';
  if jsonb_typeof(binding) is distinct from 'object' or coalesce(binding->>'capture_id','')!~'^[a-f0-9]{64}$'
   or jsonb_typeof(binding->'row_path') is distinct from 'array' or jsonb_array_length(binding->'row_path') not between 1 and 8
   or exists(select from jsonb_array_elements(binding->'row_path')x where jsonb_typeof(x) not in('string','number')
    or length(x#>>'{}') not between 1 and 100)
   or length(binding->>'symbol_field') not between 1 and 100 then raise exception 'MARKET_EVIDENCE_BINDING';end if;
  select * into strict cap from vnext_market.source_metadata(binding->>'capture_id');
  if (exists(select from vnext_market.encoded_origins where capture_id=cap.id) and split_part(cap.source_id,'_',3) is distinct from c.market)
   or binding->>'source_id' is distinct from cap.source_id or binding->>'source_url' is distinct from cap.source_url
   or e->>'source' is distinct from cap.source_url or binding->>'source_sha256' is distinct from cap.body_sha256
   or (binding->>'source_bytes')::integer is distinct from cap.body_bytes
   or (binding->>'received_at')::timestamptz is distinct from cap.received_at
   or (e->>'first_seen_at')::timestamptz is distinct from cap.received_at
   or (e->>'available_at')::timestamptz<cap.received_at or (e->>'available_at')::timestamptz>p.cutoff
   or (e->>'as_of')::timestamptz is distinct from cap.received_at
   or not isfinite((e->>'available_at')::timestamptz)
   or not((e->'published_at'='null'::jsonb and e->>'time_basis'='OBSERVED_AFTER_RECEIPT')
    or (e->>'published_at' is not null and e->>'time_basis'='PUBLISHED'
     and isfinite((e->>'published_at')::timestamptz) and (e->>'published_at')::timestamptz<=(e->>'available_at')::timestamptz))
   then raise exception 'MARKET_EVIDENCE_TIME_OR_SOURCE';end if;
  path_parts:=array(select x#>>'{}' from jsonb_array_elements(binding->'row_path')x);
  if path_parts[cardinality(path_parts)]!~'^[0-9]{1,5}$'
   or (binding->>'row_index')::integer is distinct from path_parts[cardinality(path_parts)]::integer then raise exception 'MARKET_EVIDENCE_ROW_PATH';end if;
  select cr.row_body,cr.row_hash into raw_row,raw_hash from vnext_market.capture_rows cr
   where cr.capture_id=cap.id and cr.row_path=path_parts;
  field:=binding->>'symbol_field';
  if raw_row is null or raw_hash is distinct from binding->>'source_row_hash'
   then raise exception 'MARKET_EVIDENCE_RAW_ROW';end if;
  source_symbol:=case when jsonb_typeof(raw_row)='array' and field~'^[0-9]{1,3}$' then raw_row->>(field::integer)
    when jsonb_typeof(raw_row)='object' then raw_row->>field else null end;
  if btrim(source_symbol) is distinct from c.symbol then raise exception 'MARKET_EVIDENCE_SYMBOL';end if;
  select * into old_e from vnext_market.evidence where evidence_hash=e->>'evidence_hash';
  if found then
   if old_e.content_text is distinct from e->>'content' or old_e.body is distinct from e then raise exception 'MARKET_EVIDENCE_REPLAY_CONFLICT';end if;
  else
   insert into vnext_market.evidence(evidence_hash,content_text,source_capture_id,source_row_hash,first_seen_at,body)
    values(e->>'evidence_hash',e->>'content',cap.id,binding->>'source_row_hash',cap.received_at,e);
  end if;
  insert into vnext_market.plan_sources(plan_id,source_url) values(p.id,cap.source_url) on conflict do nothing;
 end loop;
end $$;

commit;
