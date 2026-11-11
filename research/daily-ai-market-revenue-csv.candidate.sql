-- LOCAL CANDIDATE. Exact UTF8 monthly revenue CSV admission, after base V2
-- and the financial CSV extension. Original BOM/bytes remain in body_text.
begin;
do $$begin
 if to_regprocedure('vnext_market.csv_matrix(text)') is null or to_regclass('vnext_market.encoded_origins') is null
  or to_regprocedure('public.stage_daily_ai_market_revenue_capture_v2(text,text,text)') is not null
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_packet(jsonb,text,text)'))
   is distinct from 'e2c9c3472685027640a271e8a070552d' then raise exception 'MARKET_REVENUE_BASELINE_MISMATCH';end if;
end $$;
alter table vnext_market.encoded_origins drop constraint encoded_origins_source_encoding_check;
alter table vnext_market.encoded_origins add constraint encoded_origins_source_encoding_check check(source_encoding in('CP950','UTF8'));
alter table vnext_market.encoded_origins drop constraint encoded_origins_decoder_check;
alter table vnext_market.encoded_origins add constraint encoded_origins_decoder_check check(decoder in('POSTGRES_BIG5_LOSSLESS_V1','POSTGRES_UTF8_LOSSLESS_V1'));
alter table vnext_market.encoded_origins add constraint market_origin_encoding_decoder_pair check(
 (source_encoding='CP950' and decoder='POSTGRES_BIG5_LOSSLESS_V1') or (source_encoding='UTF8' and decoder='POSTGRES_UTF8_LOSSLESS_V1'));

create function public.stage_daily_ai_market_revenue_capture_v2(p_receipt_text text,p_receipt_hash text,p_body_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;parts text[];year integer;month integer;period_end date;row_day date;header jsonb;row_body jsonb;
 parsed jsonb;raw bytea;cid text;prior record;at_time timestamptz:=clock_timestamp();
begin
 if p_receipt_text is null or octet_length(p_receipt_text) not between 2 and 20000
  or p_receipt_hash is null or p_receipt_hash is distinct from vnext_market.digest(p_receipt_text)
  or p_body_text is null or octet_length(p_body_text) not between 1 and 8000000 then raise exception 'MARKET_REVENUE_SCOPE';end if;
 r:=p_receipt_text::jsonb;raw:=convert_to(p_body_text,'UTF8');
 if r->>'schema' is distinct from 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' or r->>'state' is distinct from 'CAPTURED'
  or r->'status' is distinct from '200'::jsonb or r->>'format' is distinct from 'csv' or r->>'encoding' is distinct from 'UTF8'
  or r->>'row_layout' is distinct from 'HEADER_AND_DATA_ARRAYS_V1'
  or r->>'url' is distinct from 'https://mopsov.twse.com.tw/server-java/FileDownLoad'
  or r->>'request_method' is distinct from 'POST' or r->>'sha256' is distinct from vnext_market.digest(p_body_text)
  or r->>'decoded_text_sha256' is distinct from r->>'sha256' or (r->>'bytes')::integer is distinct from octet_length(raw)
  or jsonb_typeof(r->'started_at') is distinct from 'string' or jsonb_typeof(r->'received_at') is distinct from 'string'
  or not isfinite((r->>'started_at')::timestamptz) or not isfinite((r->>'received_at')::timestamptz)
  or (r->>'started_at')::timestamptz>(r->>'received_at')::timestamptz or (r->>'received_at')::timestamptz>at_time
  then raise exception 'MARKET_REVENUE_RECEIPT';end if;
 -- Only the normal official TWSE monthly download observed in this release.
 parts:=regexp_match(r->>'source_id','^MOPS_REVENUE_TWSE_(20[0-9]{2})(0[1-9]|1[0-2])_CSV$');
 if parts is null then raise exception 'MARKET_REVENUE_SOURCE';end if;
 year:=parts[1]::integer;month:=parts[2]::integer;
 period_end:=(make_date(year,month,1)+interval '1 month'-interval '1 day')::date;
 if not coalesce(vnext_market.exact(r->'request_form',array['step','functionName','filePath','fileName']),false)
  or r->'request_form'->>'step' is distinct from '9' or r->'request_form'->>'functionName' is distinct from 'show_file2'
  or r->'request_form'->>'filePath' is distinct from '/t21/sii/'
  or r->'request_form'->>'fileName' is distinct from 't21sc03_'||(year-1911)::text||'_'||month::text||'.csv'
  or period_end>((r->>'received_at')::timestamptz at time zone 'Asia/Taipei')::date then raise exception 'MARKET_REVENUE_REQUEST_BINDING';end if;
 cid:=vnext_market.hash(jsonb_build_object('source_id',r->>'source_id','url',r->>'url','source_sha256',r->>'sha256','received_at',r->>'received_at'));
 perform pg_advisory_xact_lock(hashtextextended('market-revenue:'||cid,0));
 select c.receipt_hash,o.raw_bytes,o.source_encoding into prior from vnext_market.captures c
  join vnext_market.encoded_origins o on o.capture_id=c.id where c.id=cid;
 if found then
  if prior.receipt_hash is distinct from p_receipt_hash or prior.raw_bytes is distinct from raw or prior.source_encoding<>'UTF8'
   then raise exception 'MARKET_REVENUE_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',p_receipt_hash,'replayed',true);
 end if;
 select jsonb_agg(t.row_body order by t.ord) into parsed from vnext_market.csv_matrix(p_body_text) with ordinality t(row_body,ord);
 if jsonb_array_length(parsed) is distinct from (r->>'row_count')::integer
  or jsonb_array_length(parsed)-1 is distinct from (r->>'data_row_count')::integer then raise exception 'MARKET_REVENUE_ROW_COUNT';end if;
 header:=parsed->0;
 if header->>0 is distinct from '出表日期' or header->>1 is distinct from '資料年月' or header->>2 is distinct from '公司代號'
  or header->>3 is distinct from '公司名稱' or header->>4 is distinct from '產業別'
  or not (header ?& array['營業收入-當月營收','營業收入-去年當月營收','營業收入-去年同月增減(%)'])
  then raise exception 'MARKET_REVENUE_HEADER';end if;
 for row_body in select x from jsonb_array_elements(parsed) with ordinality t(x,ord) where ord>1 loop
  if coalesce(btrim(row_body->>1),'')!~'^[0-9]{3}/[0-9]{1,2}$'
   or coalesce(btrim(row_body->>2),'')!~'^[0-9]{4,6}$' or length(btrim(coalesce(row_body->>3,''))) not between 1 and 100
   or coalesce(btrim(row_body->>0),'')!~'^[0-9]{3}/[0-9]{1,2}/[0-9]{1,2}$' then raise exception 'MARKET_REVENUE_ROW_SCOPE';end if;
  if split_part(row_body->>1,'/',1)::integer<>year-1911 or split_part(row_body->>1,'/',2)::integer<>month
   then raise exception 'MARKET_REVENUE_ROW_PERIOD';end if;
  row_day:=make_date(split_part(row_body->>0,'/',1)::integer+1911,split_part(row_body->>0,'/',2)::integer,split_part(row_body->>0,'/',3)::integer);
  if row_day<period_end or row_day>((r->>'received_at')::timestamptz at time zone 'Asia/Taipei')::date then raise exception 'MARKET_REVENUE_ROW_DATE';end if;
 end loop;
 if (select count(distinct btrim(x->>2)) from jsonb_array_elements(parsed) with ordinality t(x,ord) where ord>1)<>jsonb_array_length(parsed)-1
  then raise exception 'MARKET_REVENUE_DUPLICATE_COMPANY';end if;
 insert into vnext_market.captures(id,source_id,source_url,receipt_text,receipt_hash,receipt,body_text,body_sha256,body_bytes,parsed,received_at)
 values(cid,r->>'source_id',r->>'url',p_receipt_text,p_receipt_hash,r,p_body_text,vnext_market.digest(p_body_text),octet_length(raw),parsed,(r->>'received_at')::timestamptz);
 insert into vnext_market.encoded_origins(capture_id,raw_bytes,raw_sha256,raw_byte_count,source_encoding,decoded_utf8_sha256,decoder)
 values(cid,raw,r->>'sha256',octet_length(raw),'UTF8',r->>'sha256','POSTGRES_UTF8_LOSSLESS_V1');
 insert into vnext_market.capture_rows(capture_id,row_index,row_path,row_hash,row_body)
  select cid,(ord-1)::integer,array[(ord-1)::text],vnext_market.hash(x),x from jsonb_array_elements(parsed) with ordinality t(x,ord);
 return jsonb_build_object('schema','DAILY_AI_MARKET_CAPTURE_STAGED_V2','capture_id',cid,'receipt_hash',p_receipt_hash,'replayed',false);
end $$;
revoke all on function public.stage_daily_ai_market_revenue_capture_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_revenue_capture_v2(text,text,text) to service_role;
commit;
