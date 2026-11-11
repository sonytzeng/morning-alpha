-- LOCAL CANDIDATE. Equivalent reference processing only: extract immutable
-- pool maps once per request; recurse only through JSON containers.
-- Scalar depth 40/41, identity inheritance, partial binding, node hashes,
-- source counts, original-data/method validators and all grants remain.
-- Install after the exact BVPS extension. No data or batch contract changes.
begin;
do $guard$begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.price_expand(jsonb,jsonb,integer)')) is distinct from '14cba48a127da9b3bb500f691132c5df'
  then raise exception 'MARKET_REFERENCE_PERFORMANCE_BASELINE';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.price_validate_reference_sources(jsonb,jsonb,text,integer)')) is distinct from 'f4f701242475042224408f8bdf3b8f1a'
  then raise exception 'MARKET_REFERENCE_PERFORMANCE_BASELINE';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_references_v2(text,text,text)')) is distinct from '71fe131c114760f4373f0b7cc5881d40'
  then raise exception 'MARKET_REFERENCE_PERFORMANCE_BASELINE';end if;
end $guard$;
create or replace function vnext_market.price_expand(value jsonb,pool jsonb,depth integer default 0) returns jsonb
language plpgsql immutable set search_path='' as $$
declare answer jsonb;ref text;begin
 if depth>40 then raise exception 'MARKET_REFERENCE_DEPTH';end if;
 if jsonb_typeof(value)='object' and value?'$price_input_ref' then
  ref:=value->>'$price_input_ref';
  if not coalesce(vnext_market.exact(value,array['$price_input_ref']),false) or ref!~'^[a-f0-9]{64}$'
   or pool->ref is null or vnext_market.hash(pool->ref) is distinct from ref then raise exception 'MARKET_REFERENCE_POOL_BINDING';end if;
  return vnext_market.price_expand(pool->ref,pool,depth+1);
 elsif jsonb_typeof(value)='object' then
  if depth=40 and value<>'{}'::jsonb then raise exception 'MARKET_REFERENCE_DEPTH';end if;
  select coalesce(jsonb_object_agg(k,case when jsonb_typeof(v) in('object','array') then vnext_market.price_expand(v,pool,depth+1) else v end),'{}')
   into answer from jsonb_each(value)t(k,v);return answer;
 elsif jsonb_typeof(value)='array' then
  if depth=40 and value<>'[]'::jsonb then raise exception 'MARKET_REFERENCE_DEPTH';end if;
  select coalesce(jsonb_agg(case when jsonb_typeof(v) in('object','array') then vnext_market.price_expand(v,pool,depth+1) else v end order by ord),'[]')
   into answer from jsonb_array_elements(value) with ordinality t(v,ord);return answer;
 end if;return value;
end $$;

create or replace function vnext_market.price_validate_reference_sources(value jsonb,bindings jsonb,security_id text,depth integer default 0) returns integer
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
  if depth=40 and value<>'{}'::jsonb then raise exception 'MARKET_REFERENCE_DEPTH';end if;
  for child in select v from jsonb_each(value)t(k,v) where jsonb_typeof(v) in('object','array') loop
   n:=n+vnext_market.price_validate_reference_sources(child,bindings,bound_security,depth+1);end loop;
 elsif jsonb_typeof(value)='array' then
  if depth=40 and value<>'[]'::jsonb then raise exception 'MARKET_REFERENCE_DEPTH';end if;
  for child in select v from jsonb_array_elements(value)t(v) where jsonb_typeof(v) in('object','array') loop
   n:=n+vnext_market.price_validate_reference_sources(child,bindings,bound_security,depth+1);end loop;
 end if;
 if n>60000 then raise exception 'MARKET_REFERENCE_INPUT_COUNT';end if;return n;
end $$;
do $stage$declare definition text;begin
 definition:=pg_get_functiondef('public.stage_daily_ai_market_price_references_v2(text,text,text)'::regprocedure);
 execute replace(definition,'
declare p vnext_market.work_plans;pool vnext_market.price_input_pools;b jsonb;item jsonb;encoded jsonb;full_ref jsonb;expected jsonb;
c vnext_market.companies;prior vnext_market.price_references;ref_horizon text;method text;version text;observed boolean;seen text[]:=''{}'';identity text;sealed boolean;source_count integer;
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 16000000 or p_body_hash is distinct from vnext_market.digest(p_body_text) then raise exception ''MARKET_REFERENCE_BATCH_HASH'';end if;
 select * into strict p from vnext_market.work_plans where id=p_plan_hash for update;
 select * into strict pool from vnext_market.price_input_pools where plan_id=p.id;
 sealed:=exists(select from vnext_market.editions where plan_id=p.id);
 b:=p_body_text::jsonb;
 if not coalesce(vnext_market.exact(b,array[''schema'',''plan_hash'',''input_pool_hash'',''items'']),false)
  or b->>''schema'' is distinct from ''TAIWAN_MARKET_PRICE_REFERENCE_BATCH_V1'' or b->>''plan_hash'' is distinct from p.id
  or b->>''input_pool_hash'' is distinct from pool.input_pool_hash or jsonb_typeof(b->''items'') is distinct from ''array''
  or jsonb_array_length(b->''items'') not between 1 and 192 then raise exception ''MARKET_REFERENCE_BATCH_CONTRACT'';end if;
 for item in select * from jsonb_array_elements(b->''items'') loop
  if not coalesce(vnext_market.exact(item,array[''security_id'',''horizon'',''reference_text'',''reference_hash'',''summary'']),false)
   or jsonb_typeof(item->''reference_text'') is distinct from ''string''
   or octet_length(item->>''reference_text'') not between 2 and 1500000 then raise exception ''MARKET_REFERENCE_ITEM'';end if;
  ref_horizon:=item->>''horizon'';identity:=item->>''security_id''||'':''||ref_horizon;
  if coalesce(ref_horizon,'''') not in(''SHORT'',''MEDIUM'',''LONG'') or identity=any(seen) then raise exception ''MARKET_REFERENCE_SCOPE'';end if;seen:=array_append(seen,identity);
  select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=item->>''security_id'';
  encoded:=(item->>''reference_text'')::jsonb;
  if encoded->>''input_encoding'' is distinct from ''SHARED_PRICE_INPUTS_V1''
   or encoded->>''encoded_hash'' is distinct from vnext_market.hash(encoded-''input_encoding''-''encoded_hash'') then raise exception ''MARKET_REFERENCE_ENCODED_HASH'';end if;
  full_ref:=vnext_market.price_expand(encoded-''input_encoding''-''encoded_hash'',pool.body->''inputs'');
  if item->>''reference_hash'' is distinct from full_ref->>''reference_hash'' or full_ref->>''reference_hash'' is distinct from vnext_market.hash(full_ref-''reference_hash'')
   or full_ref->>''security_id'' is distinct from c.security_id or full_ref->''buy_ready'' is distinct from ''false''::jsonb
   or full_ref->''forecast'' is distinct from ''false''::jsonb or full_ref->''production_eligible'' is distinct from ''false''::jsonb then raise exception ''MARKET_REFERENCE_FULL_HASH'';end if;
  observed:=ref_horizon=''SHORT'';
  source_count:=vnext_market.price_validate_reference_sources(full_ref,pool.body->''bindings'',c.security_id);
  if observed then
   if full_ref->>''schema'' is distinct from ''TAIWAN_OBSERVED_PRICE_RANGE_V1''
    or jsonb_typeof(full_ref->''range'') is distinct from ''array'' or jsonb_array_length(full_ref->''range'') is distinct from 2
    or coalesce(full_ref->>''input_packet_hash'','''')!~''^[a-f0-9]{64}$''
    or jsonb_typeof(full_ref->''source_capture_ids'') is distinct from ''array'' or jsonb_array_length(full_ref->''source_capture_ids'') not between 1 and 100
    or exists(select from jsonb_array_elements(full_ref->''source_capture_ids'')x where jsonb_typeof(x) is distinct from ''string'' or (x#>>''{}'')!~''^[a-f0-9]{64}$'')
    then raise exception ''MARKET_REFERENCE_SHORT_METHOD'';end if;
   method:=''OBSERVED_UNADJUSTED_20_SESSION_RANGE'';version:=''TAIWAN_OBSERVED_RANGE_V1'';
  else
   method:=full_ref->>''method'';version:=coalesce(full_ref->>''method_version'',''TAIWAN_PEER_RERATING_V1'');
   if source_count<1 then raise exception ''MARKET_REFERENCE_SOURCE_REQUIRED'';end if;
   if full_ref->>''state'' is distinct from ''CALCULATED_RESEARCH_ONLY''
    or jsonb_typeof(full_ref->''method'') is distinct from ''string''
    or (full_ref?''method_version'' and jsonb_typeof(full_ref->''method_version'') is distinct from ''string'')
    or jsonb_typeof(full_ref->''peer_count'') is distinct from ''number'' or coalesce(full_ref->>''peer_count'','''')!~''^[0-9]+$'' or (full_ref->>''peer_count'')::integer<5
    or jsonb_typeof(full_ref->''price_scenarios'') is distinct from ''array'' or jsonb_array_length(full_ref->''price_scenarios'') is distinct from 3
    or (ref_horizon=''MEDIUM'' and not coalesce((coalesce(method,'''') in(''CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'',''CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'') and version=''TAIWAN_PEER_RERATING_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false))
    or (ref_horizon=''LONG'' and not coalesce((method=''CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'' and version=''TAIWAN_LONG_QUALITY_PEER_PB_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false)) then raise exception ''MARKET_REFERENCE_METHOD'';end if;
  end if;
  if version=''TAIWAN_REPORTED_BVPS_PEER_V1'' then perform vnext_market.bvps_validate_reference(full_ref,ref_horizon,p.id);end if;
  expected:=jsonb_build_object(''schema'',''DAILY_AI_MARKET_RESEARCH_REFERENCE_V1'',''status'',''CALCULATED_RESEARCH_ONLY'',''symbol'',c.symbol,''horizon'',ref_horizon,
   ''method_id'',method,''method_version'',version,''quote_date'',case when observed then full_ref->>''through'' else full_ref->>''quote_date'' end,
   ''current_price'',full_ref->''current_price'',''lower'',case when observed then full_ref->''range''->0 else full_ref->''price_scenarios''->0 end,
   ''median'',case when observed then ''null''::jsonb else full_ref->''price_scenarios''->1 end,''upper'',case when observed then full_ref->''range''->1 else full_ref->''price_scenarios''->2 end,
   ''peer_count'',case when observed then ''null''::jsonb else full_ref->''peer_count'' end,''reference_hash'',item->>''reference_hash'',''input_pool_hash'',pool.input_pool_hash,
   ''forecast'',false,''buy_ready'',false,''methodology_approved'',false);
  if item->''summary'' is distinct from expected or coalesce(expected->>''quote_date'','''')!~''^\d{4}-\d{2}-\d{2}$'' or (expected->>''quote_date'')::date>p.business_date
   or ((expected->>''quote_date'')||''T13:30:00+08:00'')::timestamptz>p.cutoff
   or jsonb_typeof(expected->''current_price'') is distinct from ''number'' or jsonb_typeof(expected->''lower'') is distinct from ''number'' or jsonb_typeof(expected->''upper'') is distinct from ''number''
   or (not observed and (jsonb_typeof(expected->''median'') is distinct from ''number'' or jsonb_typeof(expected->''peer_count'') is distinct from ''number'' or (expected->>''peer_count'')::integer<5))
   or (expected->>''current_price'')::numeric<=0 or (expected->>''lower'')::numeric<=0 or (expected->>''upper'')::numeric<(expected->>''lower'')::numeric
   or (not observed and ((expected->>''median'')::numeric<(expected->>''lower'')::numeric or (expected->>''median'')::numeric>(expected->>''upper'')::numeric)) then raise exception ''MARKET_REFERENCE_SUMMARY'';end if;
  select * into prior from vnext_market.price_references where plan_id=p.id and security_id=c.security_id and price_references.horizon=ref_horizon;
  if found then
   if prior.reference_text is distinct from item->>''reference_text'' or prior.reference_hash is distinct from item->>''reference_hash'' or prior.summary is distinct from expected then raise exception ''MARKET_REFERENCE_REPLAY'';end if;
  else
   if sealed then raise exception ''MARKET_REFERENCE_EDITION_SEALED'';end if;
   if exists(select from vnext_market.stock_results where plan_id=p.id and security_id=c.security_id) then raise exception ''MARKET_REFERENCE_STOCK_SEALED'';end if;
   insert into vnext_market.price_references values(p.id,c.security_id,ref_horizon,item->>''reference_hash'',item->>''reference_text'',expected,clock_timestamp());end if;
 end loop;
 return jsonb_build_object(''schema'',''DAILY_AI_MARKET_PRICE_REFERENCES_STAGED_V1'',''plan_hash'',p.id,''input_pool_hash'',pool.input_pool_hash,''items'',jsonb_array_length(b->''items''),''body_hash'',p_body_hash);
end ','
declare p vnext_market.work_plans;pool vnext_market.price_input_pools;price_inputs jsonb;price_bindings jsonb;b jsonb;item jsonb;encoded jsonb;full_ref jsonb;expected jsonb;
c vnext_market.companies;prior vnext_market.price_references;ref_horizon text;method text;version text;observed boolean;seen text[]:=''{}'';identity text;sealed boolean;source_count integer;
begin
 if p_body_text is null or octet_length(p_body_text) not between 2 and 16000000 or p_body_hash is distinct from vnext_market.digest(p_body_text) then raise exception ''MARKET_REFERENCE_BATCH_HASH'';end if;
 select * into strict p from vnext_market.work_plans where id=p_plan_hash for update;
 select * into strict pool from vnext_market.price_input_pools where plan_id=p.id;
 price_inputs:=pool.body->''inputs'';price_bindings:=pool.body->''bindings'';
 sealed:=exists(select from vnext_market.editions where plan_id=p.id);
 b:=p_body_text::jsonb;
 if not coalesce(vnext_market.exact(b,array[''schema'',''plan_hash'',''input_pool_hash'',''items'']),false)
  or b->>''schema'' is distinct from ''TAIWAN_MARKET_PRICE_REFERENCE_BATCH_V1'' or b->>''plan_hash'' is distinct from p.id
  or b->>''input_pool_hash'' is distinct from pool.input_pool_hash or jsonb_typeof(b->''items'') is distinct from ''array''
  or jsonb_array_length(b->''items'') not between 1 and 192 then raise exception ''MARKET_REFERENCE_BATCH_CONTRACT'';end if;
 for item in select * from jsonb_array_elements(b->''items'') loop
  if not coalesce(vnext_market.exact(item,array[''security_id'',''horizon'',''reference_text'',''reference_hash'',''summary'']),false)
   or jsonb_typeof(item->''reference_text'') is distinct from ''string''
   or octet_length(item->>''reference_text'') not between 2 and 1500000 then raise exception ''MARKET_REFERENCE_ITEM'';end if;
  ref_horizon:=item->>''horizon'';identity:=item->>''security_id''||'':''||ref_horizon;
  if coalesce(ref_horizon,'''') not in(''SHORT'',''MEDIUM'',''LONG'') or identity=any(seen) then raise exception ''MARKET_REFERENCE_SCOPE'';end if;seen:=array_append(seen,identity);
  select * into strict c from vnext_market.companies where universe_id=p.universe_id and security_id=item->>''security_id'';
  encoded:=(item->>''reference_text'')::jsonb;
  if encoded->>''input_encoding'' is distinct from ''SHARED_PRICE_INPUTS_V1''
   or encoded->>''encoded_hash'' is distinct from vnext_market.hash(encoded-''input_encoding''-''encoded_hash'') then raise exception ''MARKET_REFERENCE_ENCODED_HASH'';end if;
  full_ref:=vnext_market.price_expand(encoded-''input_encoding''-''encoded_hash'',price_inputs);
  if item->>''reference_hash'' is distinct from full_ref->>''reference_hash'' or full_ref->>''reference_hash'' is distinct from vnext_market.hash(full_ref-''reference_hash'')
   or full_ref->>''security_id'' is distinct from c.security_id or full_ref->''buy_ready'' is distinct from ''false''::jsonb
   or full_ref->''forecast'' is distinct from ''false''::jsonb or full_ref->''production_eligible'' is distinct from ''false''::jsonb then raise exception ''MARKET_REFERENCE_FULL_HASH'';end if;
  observed:=ref_horizon=''SHORT'';
  source_count:=vnext_market.price_validate_reference_sources(full_ref,price_bindings,c.security_id);
  if observed then
   if full_ref->>''schema'' is distinct from ''TAIWAN_OBSERVED_PRICE_RANGE_V1''
    or jsonb_typeof(full_ref->''range'') is distinct from ''array'' or jsonb_array_length(full_ref->''range'') is distinct from 2
    or coalesce(full_ref->>''input_packet_hash'','''')!~''^[a-f0-9]{64}$''
    or jsonb_typeof(full_ref->''source_capture_ids'') is distinct from ''array'' or jsonb_array_length(full_ref->''source_capture_ids'') not between 1 and 100
    or exists(select from jsonb_array_elements(full_ref->''source_capture_ids'')x where jsonb_typeof(x) is distinct from ''string'' or (x#>>''{}'')!~''^[a-f0-9]{64}$'')
    then raise exception ''MARKET_REFERENCE_SHORT_METHOD'';end if;
   method:=''OBSERVED_UNADJUSTED_20_SESSION_RANGE'';version:=''TAIWAN_OBSERVED_RANGE_V1'';
  else
   method:=full_ref->>''method'';version:=coalesce(full_ref->>''method_version'',''TAIWAN_PEER_RERATING_V1'');
   if source_count<1 then raise exception ''MARKET_REFERENCE_SOURCE_REQUIRED'';end if;
   if full_ref->>''state'' is distinct from ''CALCULATED_RESEARCH_ONLY''
    or jsonb_typeof(full_ref->''method'') is distinct from ''string''
    or (full_ref?''method_version'' and jsonb_typeof(full_ref->''method_version'') is distinct from ''string'')
    or jsonb_typeof(full_ref->''peer_count'') is distinct from ''number'' or coalesce(full_ref->>''peer_count'','''')!~''^[0-9]+$'' or (full_ref->>''peer_count'')::integer<5
    or jsonb_typeof(full_ref->''price_scenarios'') is distinct from ''array'' or jsonb_array_length(full_ref->''price_scenarios'') is distinct from 3
    or (ref_horizon=''MEDIUM'' and not coalesce((coalesce(method,'''') in(''CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'',''CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'') and version=''TAIWAN_PEER_RERATING_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false))
    or (ref_horizon=''LONG'' and not coalesce((method=''CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'' and version=''TAIWAN_LONG_QUALITY_PEER_PB_V1'') or (method=''CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB'' and version=''TAIWAN_REPORTED_BVPS_PEER_V1''),false)) then raise exception ''MARKET_REFERENCE_METHOD'';end if;
  end if;
  if version=''TAIWAN_REPORTED_BVPS_PEER_V1'' then perform vnext_market.bvps_validate_reference(full_ref,ref_horizon,p.id);end if;
  expected:=jsonb_build_object(''schema'',''DAILY_AI_MARKET_RESEARCH_REFERENCE_V1'',''status'',''CALCULATED_RESEARCH_ONLY'',''symbol'',c.symbol,''horizon'',ref_horizon,
   ''method_id'',method,''method_version'',version,''quote_date'',case when observed then full_ref->>''through'' else full_ref->>''quote_date'' end,
   ''current_price'',full_ref->''current_price'',''lower'',case when observed then full_ref->''range''->0 else full_ref->''price_scenarios''->0 end,
   ''median'',case when observed then ''null''::jsonb else full_ref->''price_scenarios''->1 end,''upper'',case when observed then full_ref->''range''->1 else full_ref->''price_scenarios''->2 end,
   ''peer_count'',case when observed then ''null''::jsonb else full_ref->''peer_count'' end,''reference_hash'',item->>''reference_hash'',''input_pool_hash'',pool.input_pool_hash,
   ''forecast'',false,''buy_ready'',false,''methodology_approved'',false);
  if item->''summary'' is distinct from expected or coalesce(expected->>''quote_date'','''')!~''^\d{4}-\d{2}-\d{2}$'' or (expected->>''quote_date'')::date>p.business_date
   or ((expected->>''quote_date'')||''T13:30:00+08:00'')::timestamptz>p.cutoff
   or jsonb_typeof(expected->''current_price'') is distinct from ''number'' or jsonb_typeof(expected->''lower'') is distinct from ''number'' or jsonb_typeof(expected->''upper'') is distinct from ''number''
   or (not observed and (jsonb_typeof(expected->''median'') is distinct from ''number'' or jsonb_typeof(expected->''peer_count'') is distinct from ''number'' or (expected->>''peer_count'')::integer<5))
   or (expected->>''current_price'')::numeric<=0 or (expected->>''lower'')::numeric<=0 or (expected->>''upper'')::numeric<(expected->>''lower'')::numeric
   or (not observed and ((expected->>''median'')::numeric<(expected->>''lower'')::numeric or (expected->>''median'')::numeric>(expected->>''upper'')::numeric)) then raise exception ''MARKET_REFERENCE_SUMMARY'';end if;
  select * into prior from vnext_market.price_references where plan_id=p.id and security_id=c.security_id and price_references.horizon=ref_horizon;
  if found then
   if prior.reference_text is distinct from item->>''reference_text'' or prior.reference_hash is distinct from item->>''reference_hash'' or prior.summary is distinct from expected then raise exception ''MARKET_REFERENCE_REPLAY'';end if;
  else
   if sealed then raise exception ''MARKET_REFERENCE_EDITION_SEALED'';end if;
   if exists(select from vnext_market.stock_results where plan_id=p.id and security_id=c.security_id) then raise exception ''MARKET_REFERENCE_STOCK_SEALED'';end if;
   insert into vnext_market.price_references values(p.id,c.security_id,ref_horizon,item->>''reference_hash'',item->>''reference_text'',expected,clock_timestamp());end if;
 end loop;
 return jsonb_build_object(''schema'',''DAILY_AI_MARKET_PRICE_REFERENCES_STAGED_V1'',''plan_hash'',p.id,''input_pool_hash'',pool.input_pool_hash,''items'',jsonb_array_length(b->''items''),''body_hash'',p_body_hash);
end ');
end $stage$;
do $guard$begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.price_expand(jsonb,jsonb,integer)')) is distinct from '19cae08b9d07c70247c1db91daa6e7ee'
  then raise exception 'MARKET_REFERENCE_PERFORMANCE_BASELINE';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('vnext_market.price_validate_reference_sources(jsonb,jsonb,text,integer)')) is distinct from 'c32673666a53f6750ac474f1259931a3'
  then raise exception 'MARKET_REFERENCE_PERFORMANCE_BASELINE';end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_price_references_v2(text,text,text)')) is distinct from '296cdb91f6446b567275c8001fd25a42'
  then raise exception 'MARKET_REFERENCE_PERFORMANCE_BASELINE';end if;
end $guard$;
revoke all on function vnext_market.price_expand(jsonb,jsonb,integer),vnext_market.price_validate_reference_sources(jsonb,jsonb,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.stage_daily_ai_market_price_references_v2(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_market_price_references_v2(text,text,text) to service_role;
commit;
