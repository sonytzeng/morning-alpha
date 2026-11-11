-- LOCAL ROLLBACK CANDIDATE: disable only the new encoded-source admission.
-- Retain all immutable original bytes, captures, evidence, reviews and editions.
-- Existing V1 objects and the base whole-market reader are not replaced.
begin;
do $$begin
 if to_regprocedure('public.stage_daily_ai_market_encoded_capture_v2(text,text,text)') is null
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.validate_packet(jsonb,text,text)'))
   is distinct from 'e2c9c3472685027640a271e8a070552d' then raise exception 'MARKET_ENCODED_ROLLBACK_BASELINE_MISMATCH';end if;
end $$;
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
  select id,source_id,source_url,body_sha256,body_bytes,received_at into strict cap
   from vnext_market.captures where id=binding->>'capture_id';
  if binding->>'source_id' is distinct from cap.source_id or binding->>'source_url' is distinct from cap.source_url
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

drop function public.stage_daily_ai_market_encoded_capture_v2(text,text,text);
drop function vnext_market.source_metadata(text);
drop function vnext_market.csv_matrix(text);
drop function vnext_market.decode_big5_exact(bytea);
commit;
