-- LOCAL CANDIDATE. Bounded transport for the existing immutable input pool.
-- Raw source/row/symbol/time checks run once per distinct binding in a plan.
-- Finalization recreates the exact original canonical body and keeps all
-- existing pool constraints, review, source-rights and publication gates.
begin;
do $$begin
 if to_regclass('vnext_market.price_input_pools') is null
  or to_regclass('vnext_market.price_input_chunk_sets') is not null
  or to_regprocedure('vnext_market.source_metadata(text)') is null
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_inputs_v2(text,text,text)'))
   is distinct from 'a8e5ee899c3231d5b70fd3e19178069b'
  or (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.price_capture_bindings(jsonb,integer)'))
   is distinct from '8af789f42f275a7bc380955458d36d2b'
  then raise exception 'MARKET_REFERENCE_CHUNKS_BASELINE_MISMATCH';end if;
end $$;

create table vnext_market.price_input_chunk_sets(
 plan_id text primary key references vnext_market.work_plans(id),
 input_pool_hash text not null check(input_pool_hash~'^[a-f0-9]{64}$'),
 chunk_count integer not null check(chunk_count between 1 and 1024),
 stored_at timestamptz not null default clock_timestamp()
);
create table vnext_market.price_input_chunks(
 plan_id text not null references vnext_market.price_input_chunk_sets(plan_id),
 chunk_index integer not null check(chunk_index between 0 and 1023),
 body_hash text not null check(body_hash~'^[a-f0-9]{64}$'),
 body_text text not null check(octet_length(body_text) between 2 and 1000000 and body_hash=vnext_market.digest(body_text)),
 stored_at timestamptz not null default clock_timestamp(),primary key(plan_id,chunk_index)
);
create table vnext_market.price_input_nodes(
 plan_id text not null references vnext_market.price_input_chunk_sets(plan_id),
 node_hash text not null check(node_hash~'^[a-f0-9]{64}$'),
 node_text text not null check(node_hash=vnext_market.digest(node_text)),
 node_bytes integer not null check(node_bytes=octet_length(node_text) and node_bytes between 1 and 1000000),
 stored_at timestamptz not null default clock_timestamp(),primary key(plan_id,node_hash)
);
create table vnext_market.price_input_raw_bindings(
 plan_id text not null references vnext_market.price_input_chunk_sets(plan_id),
 binding_hash text not null check(binding_hash~'^[a-f0-9]{64}$'),
 binding_text text not null check(binding_hash=vnext_market.digest(binding_text)),
 security_id text not null check(security_id~'^(TWSE|TPEX|EMERGING):[0-9]{4,6}$'),
 source_capture_id text not null references vnext_market.captures(id),source_url text not null,
 stored_at timestamptz not null default clock_timestamp(),primary key(plan_id,binding_hash)
);

-- Same ordinary row-binding checks as validate_packet, without rebuilding a
-- synthetic packet and repeatedly loading the whole immutable work plan.
-- This helper records no approval or public evidence. Its caller retains the
-- full binding and source URL privately before accepting the input chunk.
create function vnext_market.price_validate_raw_binding_v2(
 p_universe_id text,p_cutoff timestamptz,p_security_id text,p_binding jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare c record;cap record;raw_row jsonb;raw_hash text;path_parts text[];field text;source_symbol text;
begin
 if coalesce(p_security_id,'')!~'^(TWSE|TPEX|EMERGING):[0-9]{4,6}$'
  or jsonb_typeof(p_binding) is distinct from 'object'
  or coalesce(p_binding->>'capture_id','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_binding->'row_path') is distinct from 'array'
  or jsonb_array_length(p_binding->'row_path') not between 1 and 8
  or exists(select from jsonb_array_elements(p_binding->'row_path')x
   where jsonb_typeof(x) not in('string','number') or length(x#>>'{}') not between 1 and 100)
  or jsonb_typeof(p_binding->'symbol_field') is distinct from 'string'
  or length(p_binding->>'symbol_field') not between 1 and 100
  or jsonb_typeof(p_binding->'received_at') is distinct from 'string'
  or jsonb_typeof(p_binding->'source_bytes') is distinct from 'number'
  or coalesce(p_binding->>'source_bytes','')!~'^[0-9]{1,8}$'
  or jsonb_typeof(p_binding->'row_index') is distinct from 'number'
  or coalesce(p_binding->>'row_index','')!~'^[0-9]{1,5}$'
  then raise exception 'MARKET_EVIDENCE_BINDING';end if;
 select symbol,market into strict c from vnext_market.companies
  where universe_id=p_universe_id and security_id=p_security_id;
 select * into strict cap from vnext_market.source_metadata(p_binding->>'capture_id');
 if (exists(select from vnext_market.encoded_origins where capture_id=cap.id)
   and split_part(cap.source_id,'_',3) is distinct from c.market)
  or p_binding->>'source_id' is distinct from cap.source_id
  or p_binding->>'source_url' is distinct from cap.source_url
  or p_binding->>'source_sha256' is distinct from cap.body_sha256
  or (p_binding->>'source_bytes')::integer is distinct from cap.body_bytes
  or (p_binding->>'received_at')::timestamptz is distinct from cap.received_at
  or not isfinite(cap.received_at) or cap.received_at>p_cutoff
  then raise exception 'MARKET_EVIDENCE_TIME_OR_SOURCE';end if;
 path_parts:=array(select x#>>'{}' from jsonb_array_elements(p_binding->'row_path')x);
 if path_parts[cardinality(path_parts)]!~'^[0-9]{1,5}$'
  or (p_binding->>'row_index')::integer is distinct from path_parts[cardinality(path_parts)]::integer
  then raise exception 'MARKET_EVIDENCE_ROW_PATH';end if;
 select cr.row_body,cr.row_hash into raw_row,raw_hash from vnext_market.capture_rows cr
  where cr.capture_id=cap.id and cr.row_path=path_parts;
 if raw_row is null or raw_hash is distinct from p_binding->>'source_row_hash'
  then raise exception 'MARKET_EVIDENCE_RAW_ROW';end if;
 field:=p_binding->>'symbol_field';
 source_symbol:=case when jsonb_typeof(raw_row)='array' and field~'^[0-9]{1,3}$' then raw_row->>(field::integer)
  when jsonb_typeof(raw_row)='object' then raw_row->>field else null end;
 if btrim(source_symbol) is distinct from c.symbol then raise exception 'MARKET_EVIDENCE_SYMBOL';end if;
 return cap.source_url;
end $$;

create function public.stage_daily_ai_market_price_input_chunk_v2(p_plan_hash text,p_body_text text,p_body_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;p record;manifest vnext_market.price_input_chunk_sets;prior vnext_market.price_input_chunks;
 pool record;item record;binding jsonb;encoded text;h text;sid text;prior_text text;prior_sid text;source_url text;
 urls text[]:='{}';n integer:=0;node_count integer;binding_count integer;idx integer;total integer;
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 1000000
  or p_body_hash is distinct from vnext_market.digest(p_body_text)
  then raise exception 'MARKET_REFERENCE_CHUNK_HASH';end if;
 b:=p_body_text::jsonb;
 if not coalesce(vnext_market.exact(b,array['schema','plan_hash','input_pool_hash','chunk_index','chunk_count','inputs','bindings']),false)
  or b->>'schema' is distinct from 'TAIWAN_MARKET_PRICE_INPUT_CHUNK_V1'
  or coalesce(p_plan_hash,'')!~'^[a-f0-9]{64}$' or b->>'plan_hash' is distinct from p_plan_hash
  or coalesce(b->>'input_pool_hash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(b->'inputs') is distinct from 'object' or jsonb_typeof(b->'bindings') is distinct from 'object'
  or jsonb_typeof(b->'chunk_index') is distinct from 'number' or coalesce(b->>'chunk_index','')!~'^[0-9]{1,4}$'
  or jsonb_typeof(b->'chunk_count') is distinct from 'number' or coalesce(b->>'chunk_count','')!~'^[0-9]{1,4}$'
  then raise exception 'MARKET_REFERENCE_CHUNK_CONTRACT';end if;
 idx:=(b->>'chunk_index')::integer;total:=(b->>'chunk_count')::integer;
 node_count:=(select count(*) from jsonb_object_keys(b->'inputs'));
 binding_count:=(select count(*) from jsonb_object_keys(b->'bindings'));
 if total not between 1 and 1024 or idx not between 0 and total-1 or node_count not between 0 and 256
  or (node_count=0 and (total<>1 or idx<>0 or binding_count<>0))
  or binding_count>10000 then raise exception 'MARKET_REFERENCE_CHUNK_COUNT';end if;
 select id,universe_id,cutoff into strict p from vnext_market.work_plans where id=p_plan_hash for update;
 select * into manifest from vnext_market.price_input_chunk_sets where plan_id=p.id;
 if found and (manifest.input_pool_hash is distinct from b->>'input_pool_hash' or manifest.chunk_count is distinct from total)
  then raise exception 'MARKET_REFERENCE_CHUNK_SET_CONFLICT';end if;
 select * into prior from vnext_market.price_input_chunks where plan_id=p.id and chunk_index=idx;
 if found then
  if prior.body_hash is distinct from p_body_hash or prior.body_text is distinct from p_body_text
   then raise exception 'MARKET_REFERENCE_CHUNK_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_PRICE_INPUT_CHUNK_STAGED_V1','plan_hash',p.id,
   'input_pool_hash',manifest.input_pool_hash,'chunk_index',idx,'chunk_count',total,'body_hash',p_body_hash,'replayed',true);
 end if;
 select input_pool_hash,body into pool from vnext_market.price_input_pools where plan_id=p.id;
 if found then
  if pool.input_pool_hash is distinct from b->>'input_pool_hash'
   or not((pool.body->'inputs')@>(b->'inputs')) or not((pool.body->'bindings')@>(b->'bindings'))
   then raise exception 'MARKET_REFERENCE_INPUT_REPLAY';end if;
 elsif exists(select from vnext_market.editions where plan_id=p.id) then raise exception 'MARKET_REFERENCE_EDITION_SEALED';end if;
 if manifest.plan_id is null then
  insert into vnext_market.price_input_chunk_sets(plan_id,input_pool_hash,chunk_count) values(p.id,b->>'input_pool_hash',total);
 end if;
 for item in select k,v from jsonb_each(b->'inputs')t(k,v) loop
  encoded:=vnext_market.canonical(item.v);
  if item.k is distinct from vnext_market.digest(encoded) then raise exception 'MARKET_REFERENCE_INPUT_NODE_HASH';end if;
  select node_text into prior_text from vnext_market.price_input_nodes where plan_id=p.id and node_hash=item.k;
  if found then
   if prior_text is distinct from encoded then raise exception 'MARKET_REFERENCE_CHUNK_NODE_CONFLICT';end if;
  else
   insert into vnext_market.price_input_nodes(plan_id,node_hash,node_text,node_bytes) values(p.id,item.k,encoded,octet_length(encoded));
  end if;
 end loop;
 for binding in select distinct value from vnext_market.price_capture_bindings(b->'inputs')t(value) loop
  n:=n+1;encoded:=vnext_market.canonical(binding);h:=vnext_market.digest(encoded);sid:=b->'bindings'->>h;
  if jsonb_typeof(b->'bindings'->h) is distinct from 'string' or coalesce(sid,'')!~'^(TWSE|TPEX|EMERGING):[0-9]{4,6}$'
   then raise exception 'MARKET_REFERENCE_SOURCE_BINDING';end if;
  if length('{"schema":"TAIWAN_PRICE_SOURCE_BINDING_V1","source_capture":'||encoded
    ||',"symbol":'||to_jsonb(split_part(sid,':',2))::text||'}') not between 2 and 200000
   then raise exception 'MARKET_EVIDENCE_HASH';end if;
  select binding_text,security_id into prior_text,prior_sid from vnext_market.price_input_raw_bindings where plan_id=p.id and binding_hash=h;
  if found then
   if prior_text is distinct from encoded or prior_sid is distinct from sid then raise exception 'MARKET_REFERENCE_CHUNK_BINDING_CONFLICT';end if;
  else
   source_url:=vnext_market.price_validate_raw_binding_v2(p.universe_id,p.cutoff,sid,binding);
   insert into vnext_market.price_input_raw_bindings(plan_id,binding_hash,binding_text,security_id,source_capture_id,source_url)
    values(p.id,h,encoded,sid,binding->>'capture_id',source_url);
   urls:=array_append(urls,source_url);
  end if;
 end loop;
 if n is distinct from binding_count then raise exception 'MARKET_REFERENCE_EXTRA_BINDING';end if;
 if (select count(*) from vnext_market.price_input_raw_bindings where plan_id=p.id)>60000
  or (select coalesce(sum(node_bytes+68),0) from vnext_market.price_input_nodes where plan_id=p.id)>32000000
  then raise exception 'MARKET_REFERENCE_INPUT_COUNT';end if;
 insert into vnext_market.plan_sources(plan_id,source_url) select p.id,u from (select distinct unnest(urls)u)t on conflict do nothing;
 insert into vnext_market.price_input_chunks(plan_id,chunk_index,body_hash,body_text) values(p.id,idx,p_body_hash,p_body_text);
 return jsonb_build_object('schema','DAILY_AI_MARKET_PRICE_INPUT_CHUNK_STAGED_V1','plan_hash',p.id,
  'input_pool_hash',b->>'input_pool_hash','chunk_index',idx,'chunk_count',total,'body_hash',p_body_hash,'replayed',false);
end $$;

create function public.finalize_daily_ai_market_price_inputs_v2(p_plan_hash text,p_body_text text,p_body_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;p record;manifest vnext_market.price_input_chunk_sets;prior record;
 inputs_text text;bindings_text text;body_text text;pool_body jsonb;body_hash text;nodes integer;bindings integer;chunks integer;
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 2000
  or p_body_hash is distinct from vnext_market.digest(p_body_text) then raise exception 'MARKET_REFERENCE_FINALIZE_HASH';end if;
 b:=p_body_text::jsonb;
 if not coalesce(vnext_market.exact(b,array['schema','plan_hash','input_pool_hash','chunk_count','input_count','binding_count','expected_body_hash']),false)
  or b->>'schema' is distinct from 'TAIWAN_MARKET_PRICE_INPUT_FINALIZE_V1'
  or coalesce(p_plan_hash,'')!~'^[a-f0-9]{64}$' or b->>'plan_hash' is distinct from p_plan_hash
  or coalesce(b->>'input_pool_hash','')!~'^[a-f0-9]{64}$' or coalesce(b->>'expected_body_hash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(b->'chunk_count') is distinct from 'number' or coalesce(b->>'chunk_count','')!~'^[0-9]{1,4}$'
  or jsonb_typeof(b->'input_count') is distinct from 'number' or coalesce(b->>'input_count','')!~'^[0-9]{1,6}$'
  or jsonb_typeof(b->'binding_count') is distinct from 'number' or coalesce(b->>'binding_count','')!~'^[0-9]{1,5}$'
  then raise exception 'MARKET_REFERENCE_FINALIZE_CONTRACT';end if;
 select id into strict p from vnext_market.work_plans where id=p_plan_hash for update;
 select * into strict manifest from vnext_market.price_input_chunk_sets where plan_id=p.id;
 select count(*) into chunks from vnext_market.price_input_chunks where plan_id=p.id;
 select count(*) into nodes from vnext_market.price_input_nodes where plan_id=p.id;
 select count(*) into bindings from vnext_market.price_input_raw_bindings where plan_id=p.id;
 if manifest.input_pool_hash is distinct from b->>'input_pool_hash' or manifest.chunk_count is distinct from (b->>'chunk_count')::integer
  or chunks is distinct from manifest.chunk_count or nodes is distinct from (b->>'input_count')::integer
  or bindings is distinct from (b->>'binding_count')::integer or bindings>60000
  then raise exception 'MARKET_REFERENCE_FINALIZE_INCOMPLETE';end if;
 select ip.input_pool_hash,ip.body_hash,
  (select count(*) from jsonb_object_keys(ip.body->'inputs')) input_count,
  (select count(*) from jsonb_object_keys(ip.body->'bindings')) binding_count
  into prior from vnext_market.price_input_pools ip where ip.plan_id=p.id;
 if found and prior.input_pool_hash is distinct from manifest.input_pool_hash then raise exception 'MARKET_REFERENCE_INPUT_REPLAY';end if;
 -- A saved complete pool can only acknowledge the exact same original body.
 -- Chunk rows still have to be complete, immutable and identically scoped.
 if found then
  if prior.body_hash is distinct from b->>'expected_body_hash' or prior.input_count is distinct from nodes::bigint
   or prior.binding_count is distinct from bindings::bigint then raise exception 'MARKET_REFERENCE_INPUT_REPLAY';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_PRICE_INPUTS_STAGED_V1','plan_hash',p.id,
   'input_pool_hash',prior.input_pool_hash,'replayed',true);
 end if;
 if exists(select from vnext_market.editions where plan_id=p.id) then raise exception 'MARKET_REFERENCE_EDITION_SEALED';end if;
 -- Canonicalize each node only in its bounded chunk. Concatenate verified
 -- canonical strings here instead of recursively rehashing the entire pool.
 select '{'||coalesce(string_agg(to_jsonb(node_hash)::text||':'||node_text,',' order by node_hash collate "C"),'')||'}'
  into inputs_text from vnext_market.price_input_nodes where plan_id=p.id;
 if vnext_market.digest(inputs_text) is distinct from manifest.input_pool_hash then raise exception 'MARKET_REFERENCE_FINALIZE_POOL_HASH';end if;
 select '{'||coalesce(string_agg(to_jsonb(binding_hash)::text||':'||to_jsonb(security_id)::text,',' order by binding_hash collate "C"),'')||'}'
  into bindings_text from vnext_market.price_input_raw_bindings where plan_id=p.id;
 body_text:='{"bindings":'||bindings_text||',"input_pool_hash":'||to_jsonb(manifest.input_pool_hash)::text||',"inputs":'||inputs_text
  ||',"plan_hash":'||to_jsonb(p.id)::text||',"schema":"TAIWAN_MARKET_PRICE_INPUT_POOL_V1"}';
 body_hash:=vnext_market.digest(body_text);
 if octet_length(body_text)>32000000 or body_hash is distinct from b->>'expected_body_hash'
  then raise exception 'MARKET_REFERENCE_FINALIZE_BODY_HASH';end if;
 pool_body:=body_text::jsonb;
 insert into vnext_market.price_input_pools(plan_id,input_pool_hash,body_hash,body_text,body)
  values(p.id,manifest.input_pool_hash,body_hash,body_text,pool_body);
 return jsonb_build_object('schema','DAILY_AI_MARKET_PRICE_INPUTS_STAGED_V1','plan_hash',p.id,
  'input_pool_hash',manifest.input_pool_hash,'replayed',false);
end $$;

do $$declare name text;begin
 foreach name in array array['price_input_chunk_sets','price_input_chunks','price_input_nodes','price_input_raw_bindings'] loop
  execute format('alter table vnext_market.%I enable row level security',name);
  execute format('alter table vnext_market.%I force row level security',name);
  execute format('revoke all on vnext_market.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger immutable before update or delete on vnext_market.%I for each row execute function vnext_market.immutable()',name);
 end loop;
end $$;
revoke all on function vnext_market.price_validate_raw_binding_v2(text,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_price_input_chunk_v2(text,text,text),
 public.finalize_daily_ai_market_price_inputs_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_price_input_chunk_v2(text,text,text),
 public.finalize_daily_ai_market_price_inputs_v2(text,text,text) to service_role;
commit;
