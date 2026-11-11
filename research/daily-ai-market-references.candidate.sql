-- Exact local candidate: shared immutable inputs -> calculated references ->
-- atomic shard -> the existing edition review/publication/rights gates.
-- These are observed ranges and peer rerating references, never order plans.
begin;
do $$begin
 if to_regprocedure('vnext_market.source_metadata(text)') is null
  or to_regprocedure('public.stage_daily_ai_market_shard_v2(text,text,uuid,text,text)') is null
  or to_regclass('vnext_market.price_input_pools') is not null then raise exception 'MARKET_REFERENCES_PREREQUISITES';end if;
end $$;
create table vnext_market.price_input_pools(
 plan_id text primary key references vnext_market.work_plans(id),input_pool_hash text not null,
 body_hash text not null,body_text text not null,body jsonb not null,
 check(body=body_text::jsonb and body_hash=vnext_market.digest(body_text)),
 check(input_pool_hash=vnext_market.hash(body->'inputs')),
 stored_at timestamptz not null default clock_timestamp()
);
create table vnext_market.price_references(
 plan_id text not null references vnext_market.price_input_pools(plan_id),security_id text not null,
 horizon text not null check(horizon in('SHORT','MEDIUM','LONG')),
 reference_hash text not null,reference_text text not null,summary jsonb not null,
 stored_at timestamptz not null default clock_timestamp(),primary key(plan_id,security_id,horizon)
);
create function vnext_market.price_capture_bindings(value jsonb,depth integer default 0) returns setof jsonb
language plpgsql immutable set search_path='' as $$
declare child jsonb;begin
 if depth>40 then raise exception 'MARKET_REFERENCE_DEPTH';end if;
 if jsonb_typeof(value)='object' then
  if value?'capture_id' or value?'source_row_hash' then
   if not(value?'capture_id' and value?'source_row_hash') then raise exception 'MARKET_REFERENCE_SOURCE_PARTIAL';end if;
   return next value;return;
  end if;
  for child in select v from jsonb_each(value)t(k,v) loop return query select * from vnext_market.price_capture_bindings(child,depth+1);end loop;
 elsif jsonb_typeof(value)='array' then
  for child in select * from jsonb_array_elements(value) loop return query select * from vnext_market.price_capture_bindings(child,depth+1);end loop;
 end if;return;
end $$;
create function vnext_market.price_validate_reference_sources(value jsonb,bindings jsonb,security_id text,depth integer default 0) returns integer
language plpgsql immutable set search_path='' as $$
declare child jsonb;bound_security text:=security_id;n integer:=0;begin
 if depth>40 then raise exception 'MARKET_REFERENCE_DEPTH';end if;
 if jsonb_typeof(value)='object' then
  if value?'security_id' then bound_security:=value->>'security_id';end if;
  if coalesce(bound_security,'')!~'^(TWSE|TPEX|EMERGING):[0-9]{4,6}$' then raise exception 'MARKET_REFERENCE_SOURCE_IDENTITY';end if;
  if value?'capture_id' or value?'source_row_hash' then
   if not(value?'capture_id' and value?'source_row_hash')
    or bindings->>vnext_market.hash(value) is distinct from bound_security then raise exception 'MARKET_REFERENCE_SOURCE_BINDING';end if;
   return 1;
  end if;
  for child in select v from jsonb_each(value)t(k,v) loop n:=n+vnext_market.price_validate_reference_sources(child,bindings,bound_security,depth+1);end loop;
 elsif jsonb_typeof(value)='array' then
  for child in select * from jsonb_array_elements(value) loop n:=n+vnext_market.price_validate_reference_sources(child,bindings,bound_security,depth+1);end loop;
 end if;
 if n>60000 then raise exception 'MARKET_REFERENCE_INPUT_COUNT';end if;return n;
end $$;
create function vnext_market.price_expand(value jsonb,pool jsonb,depth integer default 0) returns jsonb
language plpgsql immutable set search_path='' as $$
declare answer jsonb;ref text;begin
 if depth>40 then raise exception 'MARKET_REFERENCE_DEPTH';end if;
 if jsonb_typeof(value)='object' and value?'$price_input_ref' then
  ref:=value->>'$price_input_ref';
  if not coalesce(vnext_market.exact(value,array['$price_input_ref']),false) or ref!~'^[a-f0-9]{64}$'
   or pool->ref is null or vnext_market.hash(pool->ref) is distinct from ref then raise exception 'MARKET_REFERENCE_POOL_BINDING';end if;
  return vnext_market.price_expand(pool->ref,pool,depth+1);
 elsif jsonb_typeof(value)='object' then
  select coalesce(jsonb_object_agg(k,vnext_market.price_expand(v,pool,depth+1)),'{}') into answer from jsonb_each(value)t(k,v);return answer;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(vnext_market.price_expand(v,pool,depth+1) order by ord),'[]') into answer from jsonb_array_elements(value) with ordinality t(v,ord);return answer;
 end if;return value;
end $$;
create function public.stage_daily_ai_market_price_inputs_v2(p_plan_hash text,p_body_text text,p_body_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;prior vnext_market.price_input_pools;b jsonb;binding jsonb;h text;sid text;
 c vnext_market.companies;content_text text;e jsonb;packet jsonb;n integer:=0;
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 32000000 or p_body_hash is distinct from vnext_market.digest(p_body_text) then raise exception 'MARKET_REFERENCE_INPUT_HASH';end if;
 select * into strict p from vnext_market.work_plans where id=p_plan_hash for update;
 b:=p_body_text::jsonb;
 if not coalesce(vnext_market.exact(b,array['schema','plan_hash','input_pool_hash','inputs','bindings']),false)
  or b->>'schema' is distinct from 'TAIWAN_MARKET_PRICE_INPUT_POOL_V1' or b->>'plan_hash' is distinct from p.id
  or jsonb_typeof(b->'inputs') is distinct from 'object' or jsonb_typeof(b->'bindings') is distinct from 'object'
  or b->>'input_pool_hash' is distinct from vnext_market.hash(b->'inputs') then raise exception 'MARKET_REFERENCE_INPUT_CONTRACT';end if;
 select * into prior from vnext_market.price_input_pools where plan_id=p.id;
 if found then
  if prior.body_text is distinct from p_body_text or prior.body_hash is distinct from p_body_hash then raise exception 'MARKET_REFERENCE_INPUT_REPLAY';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_PRICE_INPUTS_STAGED_V1','plan_hash',p.id,'input_pool_hash',prior.input_pool_hash,'replayed',true);
 end if;
 if exists(select from vnext_market.editions where plan_id=p.id) then raise exception 'MARKET_REFERENCE_EDITION_SEALED';end if;
 if exists(select from jsonb_each(b->'inputs')t(k,v) where k is distinct from vnext_market.hash(v)) then raise exception 'MARKET_REFERENCE_INPUT_NODE_HASH';end if;
 for binding in select distinct value from vnext_market.price_capture_bindings(b->'inputs')t(value) loop
  n:=n+1;if n>60000 then raise exception 'MARKET_REFERENCE_INPUT_COUNT';end if;
  h:=vnext_market.hash(binding);sid:=b->'bindings'->>h;
  select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=sid;
  content_text:=vnext_market.canonical(jsonb_build_object('schema','TAIWAN_PRICE_SOURCE_BINDING_V1','symbol',c.symbol,'source_capture',binding));
  e:=jsonb_build_object('id','market-'||left(vnext_market.digest(content_text),40),'symbol',c.symbol,'kind','FINANCIAL',
   'source',binding->>'source_url','published_at',null,'available_at',binding->>'received_at','first_seen_at',binding->>'received_at',
   'as_of',binding->>'received_at','time_basis','OBSERVED_AFTER_RECEIPT','evidence_hash',vnext_market.digest(content_text),'content',content_text);
  packet:=jsonb_build_object('symbol',c.symbol,'company',c.company,'cutoff',vnext_market.iso(p.cutoff),'evidence',jsonb_build_array(e),'data_gaps','[]'::jsonb);
  perform vnext_market.validate_packet(packet,c.security_id,p.id);
 end loop;
 if n is distinct from (select count(*) from jsonb_object_keys(b->'bindings')) then raise exception 'MARKET_REFERENCE_EXTRA_BINDING';end if;
 insert into vnext_market.price_input_pools values(p.id,b->>'input_pool_hash',p_body_hash,p_body_text,b,clock_timestamp());
 return jsonb_build_object('schema','DAILY_AI_MARKET_PRICE_INPUTS_STAGED_V1','plan_hash',p.id,'input_pool_hash',b->>'input_pool_hash','replayed',false);
end $$;
create function public.stage_daily_ai_market_price_references_v2(p_plan_hash text,p_body_text text,p_body_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;pool vnext_market.price_input_pools;b jsonb;item jsonb;encoded jsonb;full_ref jsonb;expected jsonb;
c vnext_market.companies;prior vnext_market.price_references;ref_horizon text;method text;version text;observed boolean;seen text[]:='{}';identity text;sealed boolean;source_count integer;
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 16000000 or p_body_hash is distinct from vnext_market.digest(p_body_text) then raise exception 'MARKET_REFERENCE_BATCH_HASH';end if;
 select * into strict p from vnext_market.work_plans where id=p_plan_hash for update;
 select * into strict pool from vnext_market.price_input_pools where plan_id=p.id;
 sealed:=exists(select from vnext_market.editions where plan_id=p.id);
 b:=p_body_text::jsonb;
 if not coalesce(vnext_market.exact(b,array['schema','plan_hash','input_pool_hash','items']),false)
  or b->>'schema' is distinct from 'TAIWAN_MARKET_PRICE_REFERENCE_BATCH_V1' or b->>'plan_hash' is distinct from p.id
  or b->>'input_pool_hash' is distinct from pool.input_pool_hash or jsonb_typeof(b->'items') is distinct from 'array'
  or jsonb_array_length(b->'items') not between 1 and 192 then raise exception 'MARKET_REFERENCE_BATCH_CONTRACT';end if;
 for item in select * from jsonb_array_elements(b->'items') loop
  if not coalesce(vnext_market.exact(item,array['security_id','horizon','reference_text','reference_hash','summary']),false)
   or jsonb_typeof(item->'reference_text') is distinct from 'string'
   or octet_length(item->>'reference_text') not between 2 and 1500000 then raise exception 'MARKET_REFERENCE_ITEM';end if;
  ref_horizon:=item->>'horizon';identity:=item->>'security_id'||':'||ref_horizon;
  if coalesce(ref_horizon,'') not in('SHORT','MEDIUM','LONG') or identity=any(seen) then raise exception 'MARKET_REFERENCE_SCOPE';end if;seen:=array_append(seen,identity);
  select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=item->>'security_id';
  encoded:=(item->>'reference_text')::jsonb;
  if encoded->>'input_encoding' is distinct from 'SHARED_PRICE_INPUTS_V1'
   or encoded->>'encoded_hash' is distinct from vnext_market.hash(encoded-'input_encoding'-'encoded_hash') then raise exception 'MARKET_REFERENCE_ENCODED_HASH';end if;
  full_ref:=vnext_market.price_expand(encoded-'input_encoding'-'encoded_hash',pool.body->'inputs');
  if item->>'reference_hash' is distinct from full_ref->>'reference_hash' or full_ref->>'reference_hash' is distinct from vnext_market.hash(full_ref-'reference_hash')
   or full_ref->>'security_id' is distinct from c.security_id or full_ref->'buy_ready' is distinct from 'false'::jsonb
   or full_ref->'forecast' is distinct from 'false'::jsonb or full_ref->'production_eligible' is distinct from 'false'::jsonb then raise exception 'MARKET_REFERENCE_FULL_HASH';end if;
  observed:=ref_horizon='SHORT';
  source_count:=vnext_market.price_validate_reference_sources(full_ref,pool.body->'bindings',c.security_id);
  if observed then
   if full_ref->>'schema' is distinct from 'TAIWAN_OBSERVED_PRICE_RANGE_V1'
    or jsonb_typeof(full_ref->'range') is distinct from 'array' or jsonb_array_length(full_ref->'range') is distinct from 2
    or coalesce(full_ref->>'input_packet_hash','')!~'^[a-f0-9]{64}$'
    or jsonb_typeof(full_ref->'source_capture_ids') is distinct from 'array' or jsonb_array_length(full_ref->'source_capture_ids') not between 1 and 100
    or exists(select from jsonb_array_elements(full_ref->'source_capture_ids')x where jsonb_typeof(x) is distinct from 'string' or (x#>>'{}')!~'^[a-f0-9]{64}$')
    then raise exception 'MARKET_REFERENCE_SHORT_METHOD';end if;
   method:='OBSERVED_UNADJUSTED_20_SESSION_RANGE';version:='TAIWAN_OBSERVED_RANGE_V1';
  else
   method:=full_ref->>'method';version:=coalesce(full_ref->>'method_version','TAIWAN_PEER_RERATING_V1');
   if source_count<1 then raise exception 'MARKET_REFERENCE_SOURCE_REQUIRED';end if;
   if full_ref->>'state' is distinct from 'CALCULATED_RESEARCH_ONLY'
    or jsonb_typeof(full_ref->'method') is distinct from 'string'
    or (full_ref?'method_version' and jsonb_typeof(full_ref->'method_version') is distinct from 'string')
    or jsonb_typeof(full_ref->'peer_count') is distinct from 'number' or coalesce(full_ref->>'peer_count','')!~'^[0-9]+$' or (full_ref->>'peer_count')::integer<5
    or jsonb_typeof(full_ref->'price_scenarios') is distinct from 'array' or jsonb_array_length(full_ref->'price_scenarios') is distinct from 3
    or (ref_horizon='MEDIUM' and (coalesce(method,'') not in('CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE','CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB') or version is distinct from 'TAIWAN_PEER_RERATING_V1'))
    or (ref_horizon='LONG' and (method is distinct from 'CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB' or version is distinct from 'TAIWAN_LONG_QUALITY_PEER_PB_V1')) then raise exception 'MARKET_REFERENCE_METHOD';end if;
  end if;
  expected:=jsonb_build_object('schema','DAILY_AI_MARKET_RESEARCH_REFERENCE_V1','status','CALCULATED_RESEARCH_ONLY','symbol',c.symbol,'horizon',ref_horizon,
   'method_id',method,'method_version',version,'quote_date',case when observed then full_ref->>'through' else full_ref->>'quote_date' end,
   'current_price',full_ref->'current_price','lower',case when observed then full_ref->'range'->0 else full_ref->'price_scenarios'->0 end,
   'median',case when observed then 'null'::jsonb else full_ref->'price_scenarios'->1 end,'upper',case when observed then full_ref->'range'->1 else full_ref->'price_scenarios'->2 end,
   'peer_count',case when observed then 'null'::jsonb else full_ref->'peer_count' end,'reference_hash',item->>'reference_hash','input_pool_hash',pool.input_pool_hash,
   'forecast',false,'buy_ready',false,'methodology_approved',false);
  if item->'summary' is distinct from expected or coalesce(expected->>'quote_date','')!~'^\d{4}-\d{2}-\d{2}$' or (expected->>'quote_date')::date>p.business_date
   or ((expected->>'quote_date')||'T13:30:00+08:00')::timestamptz>p.cutoff
   or jsonb_typeof(expected->'current_price') is distinct from 'number' or jsonb_typeof(expected->'lower') is distinct from 'number' or jsonb_typeof(expected->'upper') is distinct from 'number'
   or (not observed and (jsonb_typeof(expected->'median') is distinct from 'number' or jsonb_typeof(expected->'peer_count') is distinct from 'number' or (expected->>'peer_count')::integer<5))
   or (expected->>'current_price')::numeric<=0 or (expected->>'lower')::numeric<=0 or (expected->>'upper')::numeric<(expected->>'lower')::numeric
   or (not observed and ((expected->>'median')::numeric<(expected->>'lower')::numeric or (expected->>'median')::numeric>(expected->>'upper')::numeric)) then raise exception 'MARKET_REFERENCE_SUMMARY';end if;
  select * into prior from vnext_market.price_references where plan_id=p.id and security_id=c.security_id and price_references.horizon=ref_horizon;
  if found then
   if prior.reference_text is distinct from item->>'reference_text' or prior.reference_hash is distinct from item->>'reference_hash' or prior.summary is distinct from expected then raise exception 'MARKET_REFERENCE_REPLAY';end if;
  else
   if sealed then raise exception 'MARKET_REFERENCE_EDITION_SEALED';end if;
   if exists(select from vnext_market.stock_results where plan_id=p.id and security_id=c.security_id) then raise exception 'MARKET_REFERENCE_STOCK_SEALED';end if;
   insert into vnext_market.price_references values(p.id,c.security_id,ref_horizon,item->>'reference_hash',item->>'reference_text',expected,clock_timestamp());end if;
 end loop;
 return jsonb_build_object('schema','DAILY_AI_MARKET_PRICE_REFERENCES_STAGED_V1','plan_hash',p.id,'input_pool_hash',pool.input_pool_hash,'items',jsonb_array_length(b->'items'),'body_hash',p_body_hash);
end $$;
create function vnext_market.reference_projection(p_plan_hash text,p_security_id text,p_references_text text,p_references_hash text,p_packet_text text,p_packet_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare refs jsonb;expected jsonb;packet jsonb;full_short jsonb;bars jsonb;all_bars jsonb;bar jsonb;capture_ids jsonb;latest_bar jsonb;observed_low numeric;observed_high numeric;
begin
 if p_references_text is null or octet_length(p_references_text) not between 2 and 16000 or p_references_hash is distinct from vnext_market.digest(p_references_text)
  or not exists(select from vnext_market.price_input_pools where plan_id=p_plan_hash) then raise exception 'MARKET_REFERENCE_PROJECTION_HASH';end if;
 refs:=p_references_text::jsonb;
 select jsonb_build_object('SHORT',(select summary from vnext_market.price_references where plan_id=p_plan_hash and security_id=p_security_id and horizon='SHORT'),
  'MEDIUM',(select summary from vnext_market.price_references where plan_id=p_plan_hash and security_id=p_security_id and horizon='MEDIUM'),
  'LONG',(select summary from vnext_market.price_references where plan_id=p_plan_hash and security_id=p_security_id and horizon='LONG')) into expected;
 if refs is distinct from expected then raise exception 'MARKET_REFERENCE_PROJECTION_BINDING';end if;
 if refs->'SHORT' is distinct from 'null'::jsonb then
  if p_packet_text is null or p_packet_hash is distinct from vnext_market.digest(p_packet_text) then raise exception 'MARKET_REFERENCE_SHORT_PACKET_HASH';end if;
  packet:=p_packet_text::jsonb;
  select vnext_market.price_expand(pr.reference_text::jsonb-'input_encoding'-'encoded_hash',ip.body->'inputs') into strict full_short
   from vnext_market.price_references pr join vnext_market.price_input_pools ip on ip.plan_id=pr.plan_id
   where pr.plan_id=p_plan_hash and pr.security_id=p_security_id and pr.horizon='SHORT';
  if full_short->>'input_packet_hash' is distinct from p_packet_hash then raise exception 'MARKET_REFERENCE_SHORT_PACKET_BINDING';end if;
  select coalesce(jsonb_agg(b order by b->>'date'),'[]') into all_bars from
   (select (e->>'content')::jsonb b from jsonb_array_elements(packet->'evidence')e)t
   where b->>'schema'='TAIWAN_MARKET_HISTORY_OBSERVATION_V1' and b->>'family'='PRICE' and b->>'date'<=full_short->>'through';
  select coalesce(jsonb_agg(b order by b->>'date'),'[]') into bars from
   (select b from jsonb_array_elements(all_bars)b order by b->>'date' desc limit 20)t;
  if jsonb_array_length(bars)<>20 or (select count(distinct b->>'date') from jsonb_array_elements(bars)b)<>20 then raise exception 'MARKET_REFERENCE_SHORT_BARS';end if;
  for bar in select * from jsonb_array_elements(bars) loop
   if bar->>'symbol' is distinct from split_part(p_security_id,':',2) or bar->>'market' is distinct from split_part(p_security_id,':',1)
    or bar->>'price_basis' is distinct from 'RAW_UNADJUSTED' or bar->>'currency' is distinct from 'TWD'
    or bar->'all_trades_session_complete' is distinct from 'true'::jsonb or bar->>'session_scope' is distinct from 'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES'
    or coalesce(bar->>'date','')!~'^\d{4}-\d{2}-\d{2}$' or ((bar->>'date')||'T13:30:00+08:00')::timestamptz>(packet->>'cutoff')::timestamptz
    or exists(select from unnest(array['open','high','low','close','volume','amount'])k where jsonb_typeof(bar->k) is distinct from 'number' or (bar->>k)::numeric<=0)
    or (bar->>'low')::numeric>least((bar->>'open')::numeric,(bar->>'close')::numeric)
    or (bar->>'high')::numeric<greatest((bar->>'open')::numeric,(bar->>'close')::numeric) then raise exception 'MARKET_REFERENCE_SHORT_BAR_VALUES';end if;
  end loop;
  select min((b->>'low')::numeric),max((b->>'high')::numeric) into observed_low,observed_high from jsonb_array_elements(bars)b;
  latest_bar:=bars->19;
  select coalesce(jsonb_agg(to_jsonb(id) order by id),'[]') into capture_ids from
   (select distinct b->'source_capture'->>'capture_id' id from jsonb_array_elements(all_bars)b)t;
  if capture_ids is distinct from (select jsonb_agg(x order by x#>>'{}') from jsonb_array_elements(full_short->'source_capture_ids')x)
   then raise exception 'MARKET_REFERENCE_SHORT_SOURCE_IDS';end if;
  if latest_bar->>'date' is distinct from full_short->>'through' or latest_bar->>'date' is distinct from refs->'SHORT'->>'quote_date'
   or observed_low is distinct from (refs->'SHORT'->>'lower')::numeric or observed_high is distinct from (refs->'SHORT'->>'upper')::numeric
   or (latest_bar->>'close')::numeric is distinct from (refs->'SHORT'->>'current_price')::numeric then raise exception 'MARKET_REFERENCE_SHORT_VALUES';end if;
 end if;return refs;
end $$;

create function public.stage_daily_ai_market_shard_with_references_v2(p_plan_hash text,p_shard_id text,p_lease_id uuid,p_result_text text,p_result_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p vnext_market.work_plans;s vnext_market.shards;prior vnext_market.shard_results;r jsonb;item jsonb;packet jsonb;a jsonb;h jsonb;card jsonb;refs jsonb;
 c vnext_market.companies;items_seen text[]:='{}';at_time timestamptz:=clock_timestamp();
begin
 if p_plan_hash is null or p_shard_id is null or p_lease_id is null or p_result_text is null
  or octet_length(p_result_text) not between 2 and 16000000 or p_result_hash is null
  or p_result_hash is distinct from vnext_market.digest(p_result_text) then raise exception 'MARKET_SHARD_RESULT_SCOPE';end if;
 select * into strict p from vnext_market.work_plans where id=p_plan_hash;
 select * into strict s from vnext_market.shards where id=p_shard_id and plan_id=p.id for update;
 select * into prior from vnext_market.shard_results where shard_id=s.id;
 if found then
  if prior.result_hash is distinct from p_result_hash or prior.result_text is distinct from p_result_text or prior.lease_id is distinct from p_lease_id
   then raise exception 'MARKET_SHARD_REPLAY_CONFLICT';end if;
  return jsonb_build_object('schema','DAILY_AI_MARKET_SHARD_STAGED_V2','plan_hash',p.id,'shard_id',s.id,'result_hash',prior.result_hash,
   'cards',cardinality(s.security_ids)*3,'replayed',true,'member_published',false,'review_required',true);
 end if;
 if s.state<>'LEASED' or s.lease_id is distinct from p_lease_id or s.lease_until<=at_time then raise exception 'MARKET_SHARD_LEASE';end if;
 r:=p_result_text::jsonb;
 if not coalesce(vnext_market.exact(r,array['schema','plan_hash','shard_id','items','member_published','methodology_approved']),false)
  or r->>'schema' is distinct from 'DAILY_AI_MARKET_SHARD_RESULT_WITH_REFERENCES_V2' or r->>'plan_hash' is distinct from p.id or r->>'shard_id' is distinct from s.id
  or r->'member_published' is distinct from 'false'::jsonb or r->'methodology_approved' is distinct from 'false'::jsonb
  or jsonb_typeof(r->'items') is distinct from 'array' or jsonb_array_length(r->'items') is distinct from cardinality(s.security_ids)
  then raise exception 'MARKET_SHARD_RESULT_CONTRACT';end if;
 for item in select * from jsonb_array_elements(r->'items') loop
  if not coalesce(vnext_market.exact(item,array['security_id','packet_text','packet_hash','analysis_text','analysis_hash','references_text','references_hash']),false)
   or not(item->>'security_id'=any(s.security_ids)) or item->>'security_id'=any(items_seen)
   or item->>'packet_hash' is distinct from vnext_market.digest(item->>'packet_text')
   or item->>'analysis_hash' is distinct from vnext_market.digest(item->>'analysis_text')
   or octet_length(item->>'packet_text') not between 2 and 1500000
   or octet_length(item->>'analysis_text') not between 2 and 200000 then raise exception 'MARKET_STOCK_RESULT_SCOPE';end if;
  items_seen:=array_append(items_seen,item->>'security_id');packet:=(item->>'packet_text')::jsonb;a:=(item->>'analysis_text')::jsonb;
  perform vnext_market.validate_packet(packet,item->>'security_id',p.id);
  refs:=vnext_market.reference_projection(p.id,item->>'security_id',item->>'references_text',item->>'references_hash',item->>'packet_text',item->>'packet_hash');
  select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=item->>'security_id';
  if a->>'schema' is distinct from 'DAILY_AI_STOCK_ANALYSIS_V2' or a->>'symbol' is distinct from c.symbol
   or a->>'input_hash' is distinct from item->>'packet_hash' or (a->>'cutoff')::timestamptz is distinct from p.cutoff
   or a->>'analysis_origin' is distinct from 'DETERMINISTIC_SCREENING' or a->>'method_version' is distinct from 'TAIWAN_MARKET_RESEARCH_V1'
   or a->'model_generated' is distinct from 'false'::jsonb or a->'member_published' is distinct from 'false'::jsonb
   or a->'sources' is distinct from (select jsonb_agg(e-'content' order by ord) from jsonb_array_elements(packet->'evidence') with ordinality t(e,ord))
   or jsonb_typeof(a->'horizons') is distinct from 'array' or jsonb_array_length(a->'horizons')<>3
   or (select count(distinct x->>'horizon') from jsonb_array_elements(a->'horizons')x where x->>'horizon' in('SHORT','MEDIUM','LONG'))<>3
   then raise exception 'MARKET_ANALYSIS_PROVENANCE';end if;
  insert into vnext_market.stock_results values(p.id,s.id,c.security_id,item->>'packet_text',item->>'packet_hash',item->>'analysis_text',item->>'analysis_hash');
  for h in select * from jsonb_array_elements(a->'horizons') loop
   card:=vnext_market.card_projection(packet,h,c.market)||jsonb_build_object('research_reference',refs->(h->>'horizon'));
   insert into vnext_market.cards(plan_id,security_id,horizon,market,symbol,company,status,status_rank,market_rank,card,price_date,financial_available_at,news_available_at)
    values(p.id,c.security_id,h->>'horizon',c.market,c.symbol,packet->>'company',h->>'status',
     array_position(array['WATCH','WAIT','AVOID','INSUFFICIENT'],h->>'status')-1,array_position(array['TWSE','TPEX','EMERGING'],c.market)-1,card,
     (packet->>'data_through')::date,
     (select max((e->>'available_at')::timestamptz) from jsonb_array_elements(packet->'evidence')e where e->>'kind'='FINANCIAL'),
     (select max((e->>'available_at')::timestamptz) from jsonb_array_elements(packet->'evidence')e where e->>'kind'='NEWS'));
  end loop;
 end loop;
 insert into vnext_market.shard_results(shard_id,plan_id,lease_id,result_hash,result_text) values(s.id,p.id,p_lease_id,p_result_hash,p_result_text);
 update vnext_market.shards set state='COMPLETE',result_hash=p_result_hash where id=s.id;
 return jsonb_build_object('schema','DAILY_AI_MARKET_SHARD_STAGED_V2','plan_hash',p.id,'shard_id',s.id,'result_hash',p_result_hash,
  'cards',cardinality(s.security_ids)*3,'replayed',false,'member_published',false,'review_required',true);
end $$;


-- The original reader still performs every Auth, entitlement, latest-review,
-- revocation, licensing, expiry, query and cursor check. Free projections clear
-- the new optional reference alongside the existing paid fields.
alter function public.get_daily_ai_member_market_page_v2(jsonb) set schema vnext_market;
alter function vnext_market.get_daily_ai_member_market_page_v2(jsonb) rename to member_page_before_references_v2;
revoke all on function vnext_market.member_page_before_references_v2(jsonb) from public,anon,authenticated,service_role;
create function public.get_daily_ai_member_market_page_v2(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 r:=vnext_market.member_page_before_references_v2(p_request);
 if r->>'tier'='free' and r->>'mode'='FULL' then
  r:=jsonb_set(r,'{cards}',(select coalesce(jsonb_agg(c||jsonb_build_object('research_reference',null) order by ord),'[]')
   from jsonb_array_elements(r->'cards') with ordinality t(c,ord)));
 end if;return r;
end $$;
create function public.get_daily_ai_owner_market_references_v2(p_plan_hash text,p_security_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb;begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not coalesce(public.is_research_owner_v1(),false)
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 select jsonb_build_object('plan_hash',p_plan_hash,'security_id',p_security_id,'input_pool_hash',p.input_pool_hash,
  'references',coalesce(jsonb_agg(jsonb_build_object('horizon',pr.horizon,'summary',pr.summary,
   'reference',vnext_market.price_expand(pr.reference_text::jsonb-'input_encoding'-'encoded_hash',p.body->'inputs')) order by pr.horizon) filter(where pr.reference_hash is not null),'[]')) into answer
  from vnext_market.price_input_pools p left join vnext_market.price_references pr on pr.plan_id=p.plan_id and pr.security_id=p_security_id
  where p.plan_id=p_plan_hash group by p.input_pool_hash;
 return answer;
end $$;
do $$declare name text;begin
 foreach name in array array['price_input_pools','price_references'] loop
  execute format('alter table vnext_market.%I enable row level security',name);
  execute format('alter table vnext_market.%I force row level security',name);
  execute format('revoke all on vnext_market.%I from public,anon,authenticated,service_role',name);
  execute format('create trigger immutable before update or delete on vnext_market.%I for each row execute function vnext_market.immutable()',name);
 end loop;
end $$;
revoke all on function vnext_market.price_capture_bindings(jsonb,integer),vnext_market.price_expand(jsonb,jsonb,integer),
 vnext_market.price_validate_reference_sources(jsonb,jsonb,text,integer),
 vnext_market.reference_projection(text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_price_inputs_v2(text,text,text),public.stage_daily_ai_market_price_references_v2(text,text,text),
 public.stage_daily_ai_market_shard_with_references_v2(text,text,uuid,text,text),public.get_daily_ai_member_market_page_v2(jsonb),
 public.get_daily_ai_owner_market_references_v2(text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_price_inputs_v2(text,text,text),public.stage_daily_ai_market_price_references_v2(text,text,text),
 public.stage_daily_ai_market_shard_with_references_v2(text,text,uuid,text,text) to service_role;
grant execute on function public.get_daily_ai_member_market_page_v2(jsonb),public.get_daily_ai_owner_market_references_v2(text,text) to authenticated;
commit;
