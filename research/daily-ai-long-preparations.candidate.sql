-- Local, unapplied addition for first-pass LONG review material. It does not
-- create a price plan, change an INSUFFICIENT card, issue a review verdict or
-- publish anything. Apply after daily-ai-price-workflow.candidate.sql.
begin;
do $guard$
begin
 if to_regclass('vnext_private.ai_price_calculation_inputs_v1') is null
  or to_regprocedure('vnext_private.ai_edition_integrity_v1(text)') is null
  or to_regprocedure('vnext_private.ai_batch_commitment_v1(text)') is null
  or to_regprocedure('vnext_private.immutable_record()') is null
  then raise exception 'LONG_PREPARATION_PREREQUISITES';end if;
 if to_regclass('vnext_private.ai_long_preparations_v1') is not null
  or to_regprocedure('public.stage_daily_ai_long_preparations_batch_v1(text,jsonb)') is not null
  or to_regprocedure('public.get_daily_ai_owner_long_preparation_v1(text,text)') is not null
  or to_regprocedure('vnext_private.long_preparation_source_hash_v1(jsonb)') is not null
  then raise exception 'LONG_PREPARATION_ALREADY_EXISTS';end if;
end $guard$;

create table vnext_private.ai_long_preparations_v1(
 edition_id text not null references vnext_private.ai_research_editions(id),
 batch_id text not null,input_hash text not null,symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 calculation_hash text not null check(calculation_hash ~ '^[a-f0-9]{64}$'),
 calculation_text text not null check(octet_length(calculation_text) between 2 and 200000),calculation jsonb not null,
 preparation_hash text not null check(preparation_hash ~ '^[a-f0-9]{64}$'),
 preparation_text text not null check(octet_length(preparation_text) between 2 and 200000),preparation jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(edition_id,input_hash),
 foreign key(batch_id,input_hash) references vnext_private.ai_price_calculation_inputs_v1(batch_id,input_hash),
 check(calculation=calculation_text::jsonb and preparation=preparation_text::jsonb),
 check(encode(sha256(convert_to(calculation_text,'UTF8')),'hex')=calculation_hash),
 check(encode(sha256(convert_to(preparation_text,'UTF8')),'hex')=preparation_hash)
);
alter table vnext_private.ai_long_preparations_v1 enable row level security;
alter table vnext_private.ai_long_preparations_v1 force row level security;
revoke all on vnext_private.ai_long_preparations_v1 from public,anon,authenticated,service_role;
create trigger immutable before update or delete on vnext_private.ai_long_preparations_v1
 for each row execute function vnext_private.immutable_record();

-- AnalysisEvidence is a flat object containing strings or null. Sorting its
-- ASCII field names and encoding those scalar JSON values reproduces the JS
-- canonical evidence hash without converting any financial JSON number.
-- Nested content remains the exact original string, not a parsed/reformatted
-- financial object. Unsupported source shapes fail closed.
create function vnext_private.long_preparation_source_hash_v1(p_source jsonb) returns text
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_source)='object' and not exists(
  select from jsonb_each(p_source) x where jsonb_typeof(x.value) not in('string','null'))
 then encode(sha256(convert_to('{'||(select string_agg(to_jsonb(x.key)::text||':'||x.value::text,',' order by x.key collate "C")
  from jsonb_each(p_source)x)||'}','UTF8')),'hex') else null end;
$$;
revoke all on function vnext_private.long_preparation_source_hash_v1(jsonb) from public,anon,authenticated,service_role;

create function public.stage_daily_ai_long_preparations_batch_v1(p_edition_id text,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;b vnext_runtime.ai_stock_batches;
 registered vnext_private.ai_price_calculation_inputs_v1;prior vnext_private.ai_long_preparations_v1;
 item jsonb;c jsonb;p jsonb;packet jsonb;binding jsonb;source jsonb;review_item jsonb;quote jsonb;valuation jsonb;
 receipts jsonb:='[]';seen text[]:='{}';replayed boolean;expected_expiry timestamptz;at_time timestamptz:=clock_timestamp();
 item_keys text[]:=array['input_hash','calculation_text','calculation_hash','preparation_text','preparation_hash'];
 calc_keys text[]:=array['schema','status','symbol','horizon','cutoff','data_through','as_of','expires_at','method_id','method','currency','basis',
  'entry_range','wait_above','stop_kind','stop','stop_evidence_ids','invalidation','evidence_ids','method_note','input_hash','assumption_hash',
  'evidence_bindings','trace','analysis_mode','forecast','performance_available','research_only','production_eligible','buy_ready','review'];
 prep_keys text[]:=array['schema','symbol','horizon','status','as_of','expires_at','cutoff','data_through','packet_hash','actuals_hash',
  'price_observation','official_valuation_observations','financial_observations','review_items','valuation_calculation','missing',
  'pending_source_intake','source_supplement_hash','existing_review_context','limitations','review','selection_qualified',
  'methodology_approved','source_admitted','member_published','forecast','performance_available'];
 review_keys text[];
begin
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_items) is distinct from 'array'
  then raise exception 'LONG_PREPARATION_SCOPE';end if;
 if jsonb_array_length(p_items) not between 1 and 72 or octet_length(p_items::text)>12000000
  then raise exception 'LONG_PREPARATION_BOUNDS';end if;
 select * into e from vnext_private.ai_research_editions where id=p_edition_id;
 if not found or e.created_at>at_time or e.expires_at<=at_time or not vnext_private.ai_edition_integrity_v1(e.id)
  then raise exception 'LONG_PREPARATION_EDITION';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=e.batch_id;
 if not vnext_private.ai_batch_commitment_v1(b.id) then raise exception 'LONG_PREPARATION_BATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-price-work:'||b.id,0));
 for item in select * from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'LONG_PREPARATION_FIELDS';end if;
  if (select count(*) from jsonb_object_keys(item))<>cardinality(item_keys) or not item ?& item_keys
   or exists(select from unnest(item_keys)k where jsonb_typeof(item->k) is distinct from 'string')
   or exists(select from unnest(array['input_hash','calculation_hash','preparation_hash'])k where (item->>k) !~ '^[a-f0-9]{64}$')
   or octet_length(item->>'calculation_text') not between 2 and 200000
   or octet_length(item->>'preparation_text') not between 2 and 200000
   then raise exception 'LONG_PREPARATION_FIELDS';end if;
  if encode(sha256(convert_to(item->>'calculation_text','UTF8')),'hex') is distinct from item->>'calculation_hash'
   or encode(sha256(convert_to(item->>'preparation_text','UTF8')),'hex') is distinct from item->>'preparation_hash'
   then raise exception 'LONG_PREPARATION_HASH';end if;
  c:=(item->>'calculation_text')::jsonb;p:=(item->>'preparation_text')::jsonb;
  if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object' then raise exception 'LONG_PREPARATION_FIELDS';end if;
  if (select count(*) from jsonb_object_keys(c))<>cardinality(calc_keys) or not c ?& calc_keys
   or (select count(*) from jsonb_object_keys(p))<>cardinality(prep_keys) or not p ?& prep_keys
   then raise exception 'LONG_PREPARATION_FIELDS';end if;
  select * into registered from vnext_private.ai_price_calculation_inputs_v1
   where batch_id=b.id and symbol=c->>'symbol' and horizon='LONG' order by registration_id desc limit 1;
  if not found or registered.input_hash is distinct from item->>'input_hash' then raise exception 'LONG_PREPARATION_INPUT_SUPERSEDED';end if;
  if registered.symbol=any(seen) then raise exception 'LONG_PREPARATION_DUPLICATE';end if;seen:=array_append(seen,registered.symbol);
  if not exists(select from jsonb_array_elements(e.payload->'cards')card where card->>'symbol'=registered.symbol
   and card->>'horizon'='LONG' and card->>'status'='INSUFFICIENT') then raise exception 'LONG_PREPARATION_CARD';end if;
  select original into strict packet from jsonb_array_elements(b.payload->'packets')original where original->>'symbol'=registered.symbol;
  if registered.input->'evidence' is distinct from packet->'evidence' or registered.input->>'cutoff' is distinct from packet->>'cutoff'
   or registered.input->>'data_through' is distinct from packet->>'data_through' then raise exception 'LONG_PREPARATION_PACKET';end if;
  if c->>'schema' is distinct from 'DAILY_AI_PRICE_CALCULATION_V1' or c->>'status' is distinct from 'CALCULATED_REVIEW_REQUIRED'
   or c->>'input_hash' is distinct from registered.input_hash or c->>'symbol' is distinct from registered.symbol
   or c->>'horizon' is distinct from 'LONG' or c->>'method_id' is distinct from registered.input->>'method_id'
   or c->>'method' is distinct from c->>'method_id' or c->>'currency' is distinct from 'TWD'
   or exists(select from unnest(array['cutoff','data_through','as_of','expires_at','invalidation'])k where c->k is distinct from registered.input->k)
   or c->'stop_evidence_ids' is distinct from registered.input->'parameters'->'stop_evidence_ids'
   or c->>'stop_kind' is distinct from 'EVENT' or c->'stop' is distinct from 'null'::jsonb
   or c->'review' is distinct from 'null'::jsonb or c->'research_only' is distinct from 'true'::jsonb
   or c->'production_eligible' is distinct from 'false'::jsonb or c->'buy_ready' is distinct from 'false'::jsonb
   or c->>'analysis_mode' is distinct from 'AS_OF_RESEARCH' or c->'forecast' is distinct from 'false'::jsonb
   or c->'performance_available' is distinct from 'false'::jsonb or coalesce(c->>'assumption_hash','') !~ '^[a-f0-9]{64}$'
   then raise exception 'LONG_PREPARATION_CALCULATION';end if;
  if jsonb_typeof(c->'trace') is distinct from 'object' or jsonb_typeof(c->'method_note') is distinct from 'object'
   or jsonb_typeof(c->'evidence_ids') is distinct from 'array' or jsonb_typeof(c->'evidence_bindings') is distinct from 'array'
   or jsonb_typeof(c->'entry_range') is distinct from 'array' or jsonb_typeof(c->'wait_above') is distinct from 'number'
   then raise exception 'LONG_PREPARATION_CALCULATION';end if;
  if (select count(*) from jsonb_object_keys(c->'method_note'))<>5
   or not (c->'method_note') ?& array['name','derivation','assumptions','limitations','source_use_scope']
   or c->'method_note'->>'name' is distinct from c->>'method_id'
   or c->'method_note'->>'source_use_scope' is distinct from 'PRIVATE_RESEARCH_ONLY'
   or jsonb_array_length(c->'entry_range')<>2 or exists(select from jsonb_array_elements(c->'entry_range')x where jsonb_typeof(x)<>'number')
   then raise exception 'LONG_PREPARATION_CALCULATION';end if;
  if (c->'entry_range'->>0)::numeric<=0 or (c->'entry_range'->>1)::numeric<(c->'entry_range'->>0)::numeric
   or (c->>'wait_above')::numeric<(c->'entry_range'->>1)::numeric then raise exception 'LONG_PREPARATION_CALCULATION';end if;
  if jsonb_array_length(c->'evidence_ids') not between 1 and 100
   or (select count(distinct x#>>'{}') from jsonb_array_elements(c->'evidence_ids')x)<>jsonb_array_length(c->'evidence_ids')
   or c->'evidence_ids' is distinct from (select jsonb_agg(x.binding->'id' order by x.ordinality)
    from jsonb_array_elements(c->'evidence_bindings') with ordinality x(binding,ordinality))
   or not (c->'evidence_ids') ? (registered.input->>'quote_evidence_id')
   or exists(select from jsonb_array_elements((registered.input->'assumption_basis'->'evidence_ids')
    ||(registered.input->'parameters'->'dilution_basis'->'evidence_ids')||(registered.input->'parameters'->'stop_evidence_ids'))ref
    where not (c->'evidence_ids') ? (ref#>>'{}')) then raise exception 'LONG_PREPARATION_SOURCE';end if;
  for binding in select * from jsonb_array_elements(c->'evidence_bindings') loop
   if jsonb_typeof(binding) is distinct from 'object' then raise exception 'LONG_PREPARATION_SOURCE';end if;
   if (select count(*) from jsonb_object_keys(binding))<>2 or not binding ?& array['id','evidence_hash']
    or jsonb_typeof(binding->'id') is distinct from 'string' or coalesce(binding->>'evidence_hash','') !~ '^[a-f0-9]{64}$'
    then raise exception 'LONG_PREPARATION_SOURCE';end if;
   select original into source from jsonb_array_elements(packet->'evidence')original
    where original->>'id'=binding->>'id' and original->>'symbol'=registered.symbol;
   if not found or vnext_private.long_preparation_source_hash_v1(source) is distinct from binding->>'evidence_hash'
    then raise exception 'LONG_PREPARATION_SOURCE';end if;
  end loop;
  expected_expiry:=least((registered.input->>'expires_at')::timestamptz,e.expires_at);
  if p->>'schema' is distinct from 'DAILY_AI_LONG_REVIEW_PREPARATION_V1' or p->>'symbol' is distinct from registered.symbol
   or p->>'horizon' is distinct from 'LONG' or coalesce(p->>'status','') not in('DATA_REQUIRED_REVIEW_PREPARATION','READY_FOR_REVIEW')
   or exists(select from unnest(array['cutoff','data_through','as_of'])k where p->k is distinct from registered.input->k)
   or p->>'packet_hash' is distinct from b.payload->'packet_hashes'->>registered.symbol
   or coalesce(p->>'actuals_hash','') !~ '^[a-f0-9]{64}$'
   or p->'review' is distinct from 'null'::jsonb
   or exists(select from unnest(array['selection_qualified','methodology_approved','source_admitted','member_published','forecast','performance_available'])k
    where p->k is distinct from 'false'::jsonb) then raise exception 'LONG_PREPARATION_BINDING';end if;
  if jsonb_typeof(p->'expires_at') is distinct from 'string' or not isfinite((p->>'expires_at')::timestamptz)
   or (p->>'expires_at')::timestamptz is distinct from expected_expiry or expected_expiry<=clock_timestamp()
   or (registered.input->>'as_of')::timestamptz>clock_timestamp()
   then raise exception 'LONG_PREPARATION_TIME';end if;
  if jsonb_typeof(p->'valuation_calculation') is distinct from 'object' or jsonb_typeof(p->'review_items') is distinct from 'array'
   or jsonb_typeof(p->'missing') is distinct from 'array' or jsonb_typeof(p->'pending_source_intake') is distinct from 'array'
   or jsonb_typeof(p->'limitations') is distinct from 'array' or jsonb_typeof(p->'financial_observations') is distinct from 'object'
   or jsonb_typeof(p->'official_valuation_observations') is distinct from 'array' or jsonb_typeof(p->'existing_review_context') is distinct from 'object'
   then raise exception 'LONG_PREPARATION_FIELDS';end if;
  valuation:=p->'valuation_calculation';
  if valuation is distinct from jsonb_build_object('calculation_hash',item->>'calculation_hash','input_hash',registered.input_hash,
   'assumption_hash',c->>'assumption_hash','method_id',c->>'method_id','trace',c->'trace','method_note',c->'method_note')
   or (jsonb_array_length(p->'missing')=0) is distinct from (p->>'status'='READY_FOR_REVIEW')
   or jsonb_array_length(p->'review_items')<>3
   or (select array_agg(x.value->>'kind' order by x.ordinality) from jsonb_array_elements(p->'review_items') with ordinality x(value,ordinality))
    is distinct from array['DEMAND','MOAT','VALUATION'] then raise exception 'LONG_PREPARATION_REVIEW';end if;
  if (select count(*) from jsonb_object_keys(p->'financial_observations'))<>4
   or not (p->'financial_observations') ?& array['reported_eps','reported_cashflow','margins','common_share_fcfe']
   or p->'financial_observations'->'common_share_fcfe' is distinct from 'null'::jsonb
   or (select count(*) from jsonb_object_keys(p->'existing_review_context'))<>2
   or not (p->'existing_review_context') ?& array['evidence_ids','state']
   or p->'existing_review_context'->>'state' is distinct from 'NOT_REUSED_FOR_NEW_JUDGMENT'
   or jsonb_typeof(p->'existing_review_context'->'evidence_ids') is distinct from 'array'
   or p->'source_supplement_hash' is distinct from 'null'::jsonb and coalesce(p->>'source_supplement_hash','') !~ '^[a-f0-9]{64}$'
   then raise exception 'LONG_PREPARATION_REVIEW';end if;
  if c->>'method_id'='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1'
   and p->'financial_observations'->'reported_eps' is distinct from c->'trace'->'reported_eps_sum'
   then raise exception 'LONG_PREPARATION_SOURCE';end if;
  select original into strict source from jsonb_array_elements(packet->'evidence')original where original->>'id'=registered.input->>'quote_evidence_id';
  quote:=(source->>'content')::jsonb;
  if p->'price_observation' is distinct from jsonb_build_object('date',registered.input->>'data_through','close',quote->'close',
   'evidence_id',source->>'id','source',source->>'source','available_at',source->>'available_at','scope','RETAINED_PACKET_AS_OF_CUTOFF_NOT_REALTIME')
   or c->'trace'->'quote' is distinct from quote->'close' then raise exception 'LONG_PREPARATION_SOURCE';end if;
  for review_item in select * from jsonb_array_elements(p->'review_items') loop
   if jsonb_typeof(review_item) is distinct from 'object' then raise exception 'LONG_PREPARATION_REVIEW';end if;
   review_keys:=array['kind','review_status','verdict','observation_status','evidence_ids','observations','rationale_zh','judgment_required_zh'];
   if review_item->>'kind'='VALUATION' then review_keys:=review_keys||array['calculation_hash','method_id'];end if;
   if (select count(*) from jsonb_object_keys(review_item))<>cardinality(review_keys) or not review_item ?& review_keys
    or review_item->>'review_status' is distinct from 'REVIEW_REQUIRED' or review_item->'verdict' is distinct from 'null'::jsonb
    or jsonb_typeof(review_item->'evidence_ids') is distinct from 'array'
    or jsonb_typeof(review_item->'rationale_zh') is distinct from 'string' or jsonb_typeof(review_item->'judgment_required_zh') is distinct from 'string'
    then raise exception 'LONG_PREPARATION_REVIEW';end if;
   if exists(select from jsonb_array_elements(review_item->'evidence_ids')ref where jsonb_typeof(ref)<>'string'
    or not exists(select from jsonb_array_elements(packet->'evidence')original where original->>'id'=ref#>>'{}' and original->>'symbol'=registered.symbol))
    then raise exception 'LONG_PREPARATION_SOURCE';end if;
   if review_item->>'kind'='VALUATION' then
    if review_item->>'observation_status' is distinct from 'CALCULATED_FROM_CURRENT_PACKET'
     or review_item->>'calculation_hash' is distinct from item->>'calculation_hash' or review_item->>'method_id' is distinct from c->>'method_id'
     or review_item->'evidence_ids' is distinct from c->'evidence_ids'
     or review_item->'observations' is distinct from jsonb_build_object('quote',c->'trace'->'quote','entry_range',c->'entry_range',
      'wait_above',c->'wait_above','relation',case when (c->'trace'->>'quote')::numeric<(c->'entry_range'->>0)::numeric then 'BELOW_SELECTED_RANGE'
       when (c->'trace'->>'quote')::numeric>(c->'entry_range'->>1)::numeric then 'ABOVE_SELECTED_RANGE' else 'WITHIN_SELECTED_RANGE' end,
      'is_execution_instruction',false) then raise exception 'LONG_PREPARATION_REVIEW';end if;
   elsif coalesce(review_item->>'observation_status','') not in('AVAILABLE_IN_PACKET','SOURCE_REQUIRED') then raise exception 'LONG_PREPARATION_REVIEW';end if;
  end loop;
  select * into prior from vnext_private.ai_long_preparations_v1 where edition_id=e.id and input_hash=registered.input_hash;replayed:=found;
  if replayed then
   if prior.batch_id is distinct from b.id or prior.symbol is distinct from registered.symbol
    or prior.calculation_hash is distinct from item->>'calculation_hash' or prior.calculation_text is distinct from item->>'calculation_text'
    or prior.preparation_hash is distinct from item->>'preparation_hash' or prior.preparation_text is distinct from item->>'preparation_text'
    then raise exception 'LONG_PREPARATION_REPLAY_CONFLICT';end if;
  else
   insert into vnext_private.ai_long_preparations_v1(edition_id,batch_id,input_hash,symbol,calculation_hash,calculation_text,calculation,
    preparation_hash,preparation_text,preparation) values(e.id,b.id,registered.input_hash,registered.symbol,item->>'calculation_hash',
    item->>'calculation_text',c,item->>'preparation_hash',item->>'preparation_text',p);
  end if;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('input_hash',registered.input_hash,'calculation_hash',item->>'calculation_hash',
   'preparation_hash',item->>'preparation_hash','replayed',replayed));
 end loop;
 return jsonb_build_object('schema','DAILY_AI_LONG_PREPARATIONS_STAGED_V1','edition_id',e.id,'items',receipts,'review_required',true,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_long_preparations_batch_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_long_preparations_batch_v1(text,jsonb) to service_role;

create function public.get_daily_ai_owner_long_preparation_v1(p_edition_id text,p_symbol text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;i vnext_private.ai_price_calculation_inputs_v1;
 a vnext_private.ai_long_preparations_v1;prepared jsonb:=null;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1()
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' or p_symbol is null or p_symbol !~ '^[0-9]{4,6}$'
  then raise exception 'LONG_PREPARATION_SCOPE';end if;
 select * into e from vnext_private.ai_research_editions where id=p_edition_id;
 if not found then raise exception 'LONG_PREPARATION_EDITION';end if;
 if not exists(select from jsonb_array_elements(e.payload->'cards')card where card->>'symbol'=p_symbol and card->>'horizon'='LONG')
  then raise exception 'LONG_PREPARATION_SYMBOL';end if;
 select * into i from vnext_private.ai_price_calculation_inputs_v1 where batch_id=e.batch_id and symbol=p_symbol and horizon='LONG'
  order by registration_id desc limit 1;
 if found then
  select * into a from vnext_private.ai_long_preparations_v1 where edition_id=e.id and input_hash=i.input_hash;
  if found then
   if a.batch_id is distinct from e.batch_id or a.symbol is distinct from p_symbol or a.calculation->>'input_hash' is distinct from i.input_hash
    or a.calculation->>'symbol' is distinct from p_symbol or a.calculation->>'horizon' is distinct from 'LONG'
    then raise exception 'LONG_PREPARATION_BINDING';end if;
   prepared:=jsonb_build_object('input_hash',i.input_hash,'input_text',i.input_text,'calculation_hash',a.calculation_hash,
    'calculation_text',a.calculation_text,'preparation_hash',a.preparation_hash,'preparation_text',a.preparation_text,
    'recorded_at',to_char(a.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  end if;
 end if;
 return jsonb_build_object('schema','DAILY_AI_OWNER_LONG_PREPARATION_V1','edition_id',e.id,'symbol',p_symbol,'horizon','LONG',
  'subject_user_id',auth.uid(),'research_only',true,'preview_only',true,'preparation',prepared);
end $$;
revoke all on function public.get_daily_ai_owner_long_preparation_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_owner_long_preparation_v1(text,text) to authenticated;
commit;
