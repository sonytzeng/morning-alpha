-- Private calculation inputs and durable review packets for the existing price
-- sidecar. This is an unapplied deployment candidate. It creates no input,
-- price, source grant, review decision, Owner approval, schedule or publication.
begin;
do $guard$
begin
 if to_regprocedure('public.stage_daily_ai_price_plan_v1(text,text)') is null
  or to_regprocedure('vnext_private.ai_edition_integrity_v1(text)') is null
  or to_regprocedure('vnext_private.ai_batch_commitment_v1(text)') is null
  or to_regprocedure('vnext_private.immutable_record()') is null
  then raise exception 'PRICE_WORKFLOW_PREREQUISITES';end if;
 if to_regclass('vnext_private.ai_price_calculation_inputs_v1') is not null
  or to_regclass('vnext_private.ai_price_calculation_audits_v1') is not null
  or to_regclass('vnext_private.ai_price_profiles_v1') is not null
  or to_regclass('vnext_private.ai_price_work_results_v1') is not null
  or to_regprocedure('public.get_daily_ai_price_work_v1(text)') is not null
  or to_regprocedure('public.stage_daily_ai_price_calculation_input_v1(text,text,text)') is not null
  or to_regprocedure('public.stage_daily_ai_price_inputs_batch_v1(text,jsonb)') is not null
  or to_regprocedure('public.stage_daily_ai_price_profile_v1(text,text)') is not null
  or to_regprocedure('public.stage_daily_ai_price_work_batch_v1(text,jsonb)') is not null
  or to_regprocedure('public.get_daily_ai_owner_price_calculation_v1(text,text)') is not null
  or to_regprocedure('public.finish_daily_ai_price_work_v1(text,text,text,text)') is not null
  then raise exception 'PRICE_WORKFLOW_ALREADY_EXISTS';end if;
end $guard$;

create table vnext_private.ai_price_calculation_inputs_v1(
 registration_id bigint generated always as identity unique,
 batch_id text not null references vnext_runtime.ai_stock_batches(id),
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 horizon text not null check(horizon in('SHORT','MEDIUM','LONG')),
 input_text text not null check(octet_length(input_text) between 2 and 1500000),
 input jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 primary key(batch_id,input_hash),
 check(input=input_text::jsonb),
 check(encode(sha256(convert_to(input_text,'UTF8')),'hex')=input_hash)
);
create index ai_price_calculation_latest_v1 on vnext_private.ai_price_calculation_inputs_v1(batch_id,symbol,horizon,registration_id desc);

-- A profile is an explicit, expiring instruction to reuse its fixed research
-- assumptions. Registration neither approves the method nor changes a source
-- grant. The daily binder must still match every pinned source before writing
-- an input against the new batch's exact evidence.
create table vnext_private.ai_price_profiles_v1(
 registration_id bigint generated always as identity unique,
 profile_hash text primary key check(profile_hash ~ '^[a-f0-9]{64}$'),
 symbol text not null check(symbol ~ '^[0-9]{4,6}$'),
 horizon text not null check(horizon in('SHORT','MEDIUM','LONG')),
 profile_text text not null check(octet_length(profile_text) between 2 and 1500000),
 profile jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 check(profile=profile_text::jsonb),
 check(encode(sha256(convert_to(profile_text,'UTF8')),'hex')=profile_hash)
);
create index ai_price_profile_latest_v1 on vnext_private.ai_price_profiles_v1(symbol,horizon,registration_id desc);

create table vnext_private.ai_price_calculation_audits_v1(
 plan_hash text primary key references vnext_private.ai_price_plans_v1(plan_hash),
 edition_id text not null references vnext_private.ai_research_editions(id),
 batch_id text not null,input_hash text not null,
 calculation_hash text not null check(calculation_hash ~ '^[a-f0-9]{64}$'),
 calculation_text text not null check(octet_length(calculation_text) between 2 and 200000),
 calculation jsonb not null,
 method_note_hash text not null check(method_note_hash ~ '^[a-f0-9]{64}$'),
 method_note_text text not null check(octet_length(method_note_text) between 2 and 32000),
 method_note jsonb not null,
 review_request_hash text not null check(review_request_hash ~ '^[a-f0-9]{64}$'),
 review_request_text text not null check(octet_length(review_request_text) between 2 and 16000),
 review_request jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 foreign key(batch_id,input_hash) references vnext_private.ai_price_calculation_inputs_v1(batch_id,input_hash),
 check(calculation=calculation_text::jsonb and method_note=method_note_text::jsonb and review_request=review_request_text::jsonb),
 check(encode(sha256(convert_to(calculation_text,'UTF8')),'hex')=calculation_hash),
 check(encode(sha256(convert_to(method_note_text,'UTF8')),'hex')=method_note_hash),
 check(encode(sha256(convert_to(review_request_text,'UTF8')),'hex')=review_request_hash)
);
create index ai_price_calculation_audit_edition_v1 on vnext_private.ai_price_calculation_audits_v1(edition_id,plan_hash);

-- A completed private work pass may still require inputs, method changes and
-- every existing review. This receipt only prevents the same immutable work
-- from being dispatched repeatedly after it has reached a known outcome.
create table vnext_private.ai_price_work_results_v1(
 edition_id text not null references vnext_private.ai_research_editions(id),
 work_key text not null check(work_key ~ '^[a-f0-9]{64}$'),
 result_hash text not null check(result_hash ~ '^[a-f0-9]{64}$'),
 result_text text not null check(octet_length(result_text) between 2 and 1000000),
 result jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 primary key(edition_id,work_key),
 check(result=result_text::jsonb),
 check(encode(sha256(convert_to(result_text,'UTF8')),'hex')=result_hash)
);
do $permissions$
declare n text;
begin
 foreach n in array array['ai_price_calculation_inputs_v1','ai_price_calculation_audits_v1','ai_price_profiles_v1','ai_price_work_results_v1'] loop
  execute format('alter table vnext_private.%I enable row level security',n);
  execute format('alter table vnext_private.%I force row level security',n);
  execute format('revoke all on vnext_private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger immutable before update or delete on vnext_private.%I for each row execute function vnext_private.immutable_record()',n);
 end loop;
end $permissions$;
revoke all on sequence vnext_private.ai_price_calculation_inputs_v1_registration_id_seq from public,anon,authenticated,service_role;
revoke all on sequence vnext_private.ai_price_profiles_v1_registration_id_seq from public,anon,authenticated,service_role;

-- The original canonical input is immutable. Storage validates scope and
-- provenance, not forecast merit. The calculator must still validate all
-- numeric method rules and recompute its own canonical input hash.
create function public.stage_daily_ai_price_calculation_input_v1(p_batch_id text,p_input_text text,p_input_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b vnext_runtime.ai_stock_batches;v jsonb;packet jsonb;parameters jsonb;refs jsonb;scenario jsonb;
 existing vnext_private.ai_price_calculation_inputs_v1;at_time timestamptz:=clock_timestamp();
 asof_time timestamptz;expiry timestamptz;assumption_at timestamptz;expected_method text;parameter_keys text[];scenario_keys text[];
 input_keys text[]:=array['schema','symbol','horizon','cutoff','data_through','as_of','expires_at','currency','method_id','quote_evidence_id','evidence','assumption_basis','invalidation','parameters'];
begin
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$' or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
  or p_input_text is null or octet_length(p_input_text) not between 2 and 1500000
  or encode(sha256(convert_to(p_input_text,'UTF8')),'hex') is distinct from p_input_hash
  then raise exception 'PRICE_INPUT_HASH';end if;
 v:=p_input_text::jsonb;
 if jsonb_typeof(v) is distinct from 'object' then raise exception 'PRICE_INPUT_FIELDS';end if;
 if (select count(*) from jsonb_object_keys(v))<>cardinality(input_keys) or not v ?& input_keys
  or v->>'schema' is distinct from 'DAILY_AI_PRICE_CALCULATION_INPUT_V1'
  or jsonb_typeof(v->'symbol') is distinct from 'string' or coalesce(v->>'symbol','') !~ '^[0-9]{4,6}$'
  or coalesce(v->>'horizon','') not in('SHORT','MEDIUM','LONG') or v->>'currency' is distinct from 'TWD'
  or jsonb_typeof(v->'invalidation') is distinct from 'string' or length(btrim(v->>'invalidation')) not between 1 and 1500
  or jsonb_typeof(v->'parameters') is distinct from 'object' or jsonb_typeof(v->'assumption_basis') is distinct from 'object'
  or jsonb_typeof(v->'evidence') is distinct from 'array' then raise exception 'PRICE_INPUT_FIELDS';end if;
 expected_method:=case v->>'horizon' when 'SHORT' then 'SHORT_ATR_CONDITIONAL_V1'
  when 'MEDIUM' then 'MEDIUM_EPS_PE_SCENARIOS_V1' else 'LONG_FCFE_DISCOUNT_SCENARIOS_V1' end;
 if v->>'horizon'='LONG' and v->>'method_id'='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then
  expected_method:='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1';
 end if;
 if v->>'method_id' is distinct from expected_method then raise exception 'PRICE_INPUT_METHOD';end if;
 if jsonb_typeof(v->'cutoff') is distinct from 'string' or jsonb_typeof(v->'data_through') is distinct from 'string'
  or coalesce(v->>'data_through','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or jsonb_typeof(v->'as_of') is distinct from 'string' or jsonb_typeof(v->'expires_at') is distinct from 'string'
  then raise exception 'PRICE_INPUT_TIME';end if;
 select * into b from vnext_runtime.ai_stock_batches where id=p_batch_id;
 if not found or not vnext_private.ai_batch_commitment_v1(p_batch_id) or b.cutoff>at_time
  or v->>'cutoff' is distinct from b.payload->>'cutoff' or v->>'data_through' is distinct from b.payload->>'through'
  then raise exception 'PRICE_INPUT_BATCH_BINDING';end if;
 select p into packet from jsonb_array_elements(b.payload->'packets')p where p->>'symbol'=v->>'symbol';
 if packet is null or packet->>'cutoff' is distinct from v->>'cutoff' or packet->>'data_through' is distinct from v->>'data_through'
  then raise exception 'PRICE_INPUT_SYMBOL';end if;
 if v->'evidence' is distinct from packet->'evidence' then raise exception 'PRICE_INPUT_EVIDENCE_BINDING';end if;
 if (select count(*) from jsonb_object_keys(v->'assumption_basis'))<>3
  or not (v->'assumption_basis') ?& array['available_at','description','evidence_ids']
  or jsonb_typeof(v->'assumption_basis'->'description') is distinct from 'string'
  or length(btrim(v->'assumption_basis'->>'description')) not between 1 and 1500
  or jsonb_typeof(v->'assumption_basis'->'available_at') is distinct from 'string'
  or jsonb_typeof(v->'assumption_basis'->'evidence_ids') is distinct from 'array'
  then raise exception 'PRICE_INPUT_ASSUMPTION';end if;
 begin
  asof_time:=(v->>'as_of')::timestamptz;expiry:=(v->>'expires_at')::timestamptz;
  assumption_at:=(v->'assumption_basis'->>'available_at')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'PRICE_INPUT_TIME';end;
 if not isfinite(asof_time) or not isfinite(expiry) or not isfinite(assumption_at)
  or asof_time<b.cutoff or asof_time>at_time or expiry<=at_time or expiry<=asof_time
  or expiry>b.cutoff+interval '72 hours' or assumption_at>asof_time then raise exception 'PRICE_INPUT_TIME';end if;
 parameters:=v->'parameters';refs:=v->'assumption_basis'->'evidence_ids';
 if jsonb_array_length(refs) not between 1 and 100 then raise exception 'PRICE_INPUT_REFERENCE';end if;
 if v->>'horizon'='SHORT' then
  parameter_keys:=array['bar_evidence_ids','expected_sessions','atr_period','breakout_lookback','trigger_rule','entry_atr_width','stop_atr_multiple','tick_size','corporate_actions_evidence_id'];
  if jsonb_typeof(parameters->'bar_evidence_ids') is distinct from 'array'
   or jsonb_typeof(parameters->'corporate_actions_evidence_id') is distinct from 'string'
   then raise exception 'PRICE_INPUT_PARAMETERS';end if;
  refs:=refs||(parameters->'bar_evidence_ids')||jsonb_build_array(parameters->>'corporate_actions_evidence_id');
 else
  parameter_keys:=case when v->>'horizon'='MEDIUM' then array['earnings_basis','forecast_period','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids']
   when expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then array['earnings_basis','earnings_period','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids']
   else array['cashflow_basis','timing','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids'] end;
  if jsonb_typeof(parameters->'dilution_basis') is distinct from 'object' or jsonb_typeof(parameters->'scenarios') is distinct from 'array'
   or jsonb_typeof(parameters->'stop_evidence_ids') is distinct from 'array' then raise exception 'PRICE_INPUT_PARAMETERS';end if;
  if (select count(*) from jsonb_object_keys(parameters->'dilution_basis'))<>2
   or not (parameters->'dilution_basis') ?& array['description','evidence_ids']
   or jsonb_typeof(parameters->'dilution_basis'->'description') is distinct from 'string'
   or length(btrim(parameters->'dilution_basis'->>'description')) not between 1 and 1500
   or jsonb_typeof(parameters->'dilution_basis'->'evidence_ids') is distinct from 'array'
   or jsonb_array_length(parameters->'scenarios')<>3 then raise exception 'PRICE_INPUT_PARAMETERS';end if;
  if expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then
   if parameters->>'earnings_basis' is distinct from 'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM'
    or jsonb_typeof(parameters->'earnings_period') is distinct from 'object' then raise exception 'PRICE_INPUT_PARAMETERS';end if;
   if (select count(*) from jsonb_object_keys(parameters->'earnings_period'))<>2
    or not (parameters->'earnings_period') ?& array['start','end']
    or jsonb_typeof(parameters->'earnings_period'->'start') is distinct from 'string'
    or jsonb_typeof(parameters->'earnings_period'->'end') is distinct from 'string' then raise exception 'PRICE_INPUT_PARAMETERS';end if;
  end if;
  scenario_keys:=case when v->>'horizon'='MEDIUM' then array['name','eps','pe']
   when expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then array['name','eps_growth_rates','payout_ratios','required_return','terminal_pe']
   else array['name','cashflows','discount_rate','terminal'] end;
  for scenario in select * from jsonb_array_elements(parameters->'scenarios') loop
   if jsonb_typeof(scenario) is distinct from 'object' then raise exception 'PRICE_INPUT_PARAMETERS';end if;
   if (select count(*) from jsonb_object_keys(scenario))<>cardinality(scenario_keys) or not scenario ?& scenario_keys
    then raise exception 'PRICE_INPUT_PARAMETERS';end if;
   if expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then
    if jsonb_typeof(scenario->'eps_growth_rates') is distinct from 'array' or jsonb_typeof(scenario->'payout_ratios') is distinct from 'array'
     or jsonb_typeof(scenario->'required_return') is distinct from 'number' or jsonb_typeof(scenario->'terminal_pe') is distinct from 'number'
     then raise exception 'PRICE_INPUT_PARAMETERS';end if;
    if jsonb_array_length(scenario->'eps_growth_rates') not between 1 and 10
     or jsonb_array_length(scenario->'payout_ratios')<>jsonb_array_length(scenario->'eps_growth_rates')
     or exists(select from jsonb_array_elements((scenario->'eps_growth_rates')||(scenario->'payout_ratios'))n where jsonb_typeof(n)<>'number')
     then raise exception 'PRICE_INPUT_PARAMETERS';end if;
   end if;
  end loop;
  refs:=refs||(parameters->'stop_evidence_ids')||(parameters->'dilution_basis'->'evidence_ids');
 end if;
 if (select count(*) from jsonb_object_keys(parameters))<>cardinality(parameter_keys) or not parameters ?& parameter_keys
  then raise exception 'PRICE_INPUT_PARAMETERS';end if;
 refs:=refs||jsonb_build_array(v->>'quote_evidence_id');
 if jsonb_typeof(v->'quote_evidence_id') is distinct from 'string' or not exists(select from jsonb_array_elements(packet->'evidence')e
  where e->>'id'=v->>'quote_evidence_id' and e->>'symbol'=v->>'symbol' and e->>'kind'='PRICE')
  or exists(select from jsonb_array_elements(refs)r where jsonb_typeof(r)<>'string' or length(btrim(r#>>'{}')) not between 1 and 200
   or not exists(select from jsonb_array_elements(packet->'evidence')e where e->>'id'=r#>>'{}' and e->>'symbol'=v->>'symbol'))
  then raise exception 'PRICE_INPUT_REFERENCE';end if;
 -- This lock also serializes registration against staging an older method.
 perform pg_advisory_xact_lock(hashtextextended('ai-price-work:'||b.id,0));
 insert into vnext_private.ai_price_calculation_inputs_v1(batch_id,input_hash,symbol,horizon,input_text,input)
 values(b.id,p_input_hash,v->>'symbol',v->>'horizon',p_input_text,v) on conflict(batch_id,input_hash) do nothing;
 select * into strict existing from vnext_private.ai_price_calculation_inputs_v1 where batch_id=b.id and input_hash=p_input_hash;
 if existing.input_text is distinct from p_input_text or existing.input is distinct from v then raise exception 'PRICE_INPUT_REPLAY_CONFLICT';end if;
 return jsonb_build_object('schema','DAILY_AI_PRICE_CALCULATION_INPUT_STAGED_V1','batch_id',b.id,'input_hash',p_input_hash,
  'symbol',existing.symbol,'horizon',existing.horizon,'registration_id',existing.registration_id,'registered',true,'review_required',true,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_price_calculation_input_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_price_calculation_input_v1(text,text,text) to service_role;

create function public.stage_daily_ai_price_profile_v1(p_profile_text text,p_profile_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;t jsonb;parameters jsonb;scenario jsonb;refs jsonb;existing vnext_private.ai_price_profiles_v1;
 created_time timestamptz;until_time timestamptz;template_asof timestamptz;template_expiry timestamptz;template_cutoff timestamptz;assumption_at timestamptz;
 at_time timestamptz:=clock_timestamp();expected_method text;parameter_keys text[];scenario_keys text[];
 profile_keys text[]:=array['schema','policy','symbol','horizon','method_id','created_at','valid_until','revision_note','template_input'];
 input_keys text[]:=array['schema','symbol','horizon','cutoff','data_through','as_of','expires_at','currency','method_id','quote_evidence_id','evidence','assumption_basis','invalidation','parameters'];
 time_pattern text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
 if p_profile_hash is null or p_profile_hash !~ '^[a-f0-9]{64}$' or p_profile_text is null
  or octet_length(p_profile_text) not between 2 and 1500000
  or encode(sha256(convert_to(p_profile_text,'UTF8')),'hex') is distinct from p_profile_hash
  then raise exception 'PRICE_PROFILE_HASH';end if;
 p:=p_profile_text::jsonb;
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'PRICE_PROFILE_FIELDS';end if;
 if (select count(*) from jsonb_object_keys(p))<>cardinality(profile_keys) or not p ?& profile_keys
  or p->>'schema' is distinct from 'DAILY_AI_PRICE_PROFILE_V1'
  or p->>'policy' is distinct from 'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY'
  or jsonb_typeof(p->'symbol') is distinct from 'string' or coalesce(p->>'symbol','') !~ '^[0-9]{4,6}$'
  or coalesce(p->>'horizon','') not in('SHORT','MEDIUM','LONG')
  or jsonb_typeof(p->'revision_note') is distinct from 'string' or length(btrim(p->>'revision_note')) not between 1 and 1500
  or jsonb_typeof(p->'template_input') is distinct from 'object' then raise exception 'PRICE_PROFILE_FIELDS';end if;
 t:=p->'template_input';
 expected_method:=case p->>'horizon' when 'SHORT' then 'SHORT_ATR_CONDITIONAL_V1'
  when 'MEDIUM' then 'MEDIUM_EPS_PE_SCENARIOS_V1' else 'LONG_FCFE_DISCOUNT_SCENARIOS_V1' end;
 if p->>'horizon'='LONG' and p->>'method_id'='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then
  expected_method:='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1';
 end if;
 if p->>'method_id' is distinct from expected_method or t->>'method_id' is distinct from expected_method
  or t->>'symbol' is distinct from p->>'symbol' or t->>'horizon' is distinct from p->>'horizon'
  then raise exception 'PRICE_PROFILE_IDENTITY';end if;
 if (select count(*) from jsonb_object_keys(t))<>cardinality(input_keys) or not t ?& input_keys
  or t->>'schema' is distinct from 'DAILY_AI_PRICE_CALCULATION_INPUT_V1' or t->>'currency' is distinct from 'TWD'
  or jsonb_typeof(t->'invalidation') is distinct from 'string' or length(btrim(t->>'invalidation')) not between 1 and 1500
  or jsonb_typeof(t->'parameters') is distinct from 'object' or jsonb_typeof(t->'assumption_basis') is distinct from 'object'
  or jsonb_typeof(t->'evidence') is distinct from 'array' then raise exception 'PRICE_PROFILE_TEMPLATE';end if;
 if (select count(*) from jsonb_object_keys(t->'assumption_basis'))<>3
  or not (t->'assumption_basis') ?& array['available_at','description','evidence_ids']
  or jsonb_typeof(t->'assumption_basis'->'description') is distinct from 'string'
  or length(btrim(t->'assumption_basis'->>'description')) not between 1 and 1500
  or jsonb_typeof(t->'assumption_basis'->'evidence_ids') is distinct from 'array'
  then raise exception 'PRICE_PROFILE_TEMPLATE';end if;
 if exists(select from jsonb_array_elements(jsonb_build_array(p->'created_at',p->'valid_until',t->'cutoff',t->'as_of',t->'expires_at',t->'assumption_basis'->'available_at'))x
   where jsonb_typeof(x)<>'string' or (x#>>'{}') !~ time_pattern)
  or jsonb_typeof(t->'data_through') is distinct from 'string' or coalesce(t->>'data_through','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then raise exception 'PRICE_PROFILE_TIME';end if;
 begin
  created_time:=(p->>'created_at')::timestamptz;until_time:=(p->>'valid_until')::timestamptz;
  template_asof:=(t->>'as_of')::timestamptz;template_expiry:=(t->>'expires_at')::timestamptz;
  template_cutoff:=(t->>'cutoff')::timestamptz;assumption_at:=(t->'assumption_basis'->>'available_at')::timestamptz;
  perform (t->>'data_through')::date;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'PRICE_PROFILE_TIME';end;
 if not isfinite(created_time) or not isfinite(until_time) or not isfinite(template_asof) or not isfinite(template_expiry)
  or not isfinite(template_cutoff) or not isfinite(assumption_at) or created_time>at_time or until_time<=created_time
  or template_cutoff>template_asof or assumption_at>template_asof or template_asof>created_time or created_time>=template_expiry
  then raise exception 'PRICE_PROFILE_TIME';end if;
 -- Expired registrations remain visible so the binder can explicitly block
 -- them. A new version never acquires a later validity date by clock inference.
 if jsonb_array_length(t->'evidence') not between 1 and 100 or exists(select from jsonb_array_elements(t->'evidence')e
  where jsonb_typeof(e)<>'object' or jsonb_typeof(e->'id') is distinct from 'string' or length(btrim(e->>'id')) not between 1 and 200
   or e-array['id','symbol','kind','source','published_at','available_at','content','time_basis','first_seen_at','as_of','evidence_hash']<>'{}'::jsonb
   or coalesce(e->>'kind','') not in('NEWS','MARKET','FINANCIAL','PRICE')
   or e->'symbol' is distinct from 'null'::jsonb and e->>'symbol' is distinct from p->>'symbol'
   or jsonb_typeof(e->'source') is distinct from 'string' or jsonb_typeof(e->'content') is distinct from 'string'
   or length(btrim(e->>'content')) not between 1 and 12000)
  or (select count(distinct e->>'id') from jsonb_array_elements(t->'evidence')e)<>jsonb_array_length(t->'evidence')
  then raise exception 'PRICE_PROFILE_EVIDENCE';end if;
 parameters:=t->'parameters';refs:=t->'assumption_basis'->'evidence_ids';
 if jsonb_array_length(refs) not between 1 and 100 then raise exception 'PRICE_PROFILE_REFERENCE';end if;
 if p->>'horizon'='SHORT' then
  parameter_keys:=array['bar_evidence_ids','expected_sessions','atr_period','breakout_lookback','trigger_rule','entry_atr_width','stop_atr_multiple','tick_size','corporate_actions_evidence_id'];
  if jsonb_typeof(parameters->'bar_evidence_ids') is distinct from 'array'
   or jsonb_typeof(parameters->'expected_sessions') is distinct from 'array'
   or jsonb_typeof(parameters->'corporate_actions_evidence_id') is distinct from 'string'
   or parameters->>'trigger_rule' is distinct from 'PRIOR_WINDOW_HIGH_PLUS_TICK'
   or exists(select from unnest(array['atr_period','breakout_lookback','entry_atr_width','stop_atr_multiple','tick_size'])k
    where jsonb_typeof(parameters->k) is distinct from 'number')
   or exists(select from jsonb_array_elements(parameters->'expected_sessions')s where jsonb_typeof(s)<>'string')
   then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
  refs:=refs||(parameters->'bar_evidence_ids')||jsonb_build_array(parameters->>'corporate_actions_evidence_id');
 else
  parameter_keys:=case when p->>'horizon'='MEDIUM' then array['earnings_basis','forecast_period','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids']
   when expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then array['earnings_basis','earnings_period','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids']
   else array['cashflow_basis','timing','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids'] end;
  if jsonb_typeof(parameters->'dilution_basis') is distinct from 'object' or jsonb_typeof(parameters->'scenarios') is distinct from 'array'
   or jsonb_typeof(parameters->'entry_scenarios') is distinct from 'array' or jsonb_typeof(parameters->'stop_evidence_ids') is distinct from 'array'
   then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
  if (select count(*) from jsonb_object_keys(parameters->'dilution_basis'))<>2
   or not (parameters->'dilution_basis') ?& array['description','evidence_ids']
   or jsonb_typeof(parameters->'dilution_basis'->'description') is distinct from 'string'
   or length(btrim(parameters->'dilution_basis'->>'description')) not between 1 and 1500
   or jsonb_typeof(parameters->'dilution_basis'->'evidence_ids') is distinct from 'array'
   or jsonb_array_length(parameters->'scenarios')<>3 then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
  if jsonb_typeof(parameters->'margin_of_safety') is distinct from 'number'
   or jsonb_array_length(parameters->'entry_scenarios')<>2
   or exists(select from jsonb_array_elements(parameters->'entry_scenarios')n
    where jsonb_typeof(n)<>'string' or n#>>'{}' not in('conservative','base','upside'))
   then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
  if p->>'horizon'='MEDIUM' then
   if jsonb_typeof(parameters->'forecast_period') is distinct from 'object' then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   if (select count(*) from jsonb_object_keys(parameters->'forecast_period'))<>2
    or not (parameters->'forecast_period') ?& array['start','end']
    or coalesce(parameters->>'earnings_basis','') not in('FORWARD_12_MONTH_DILUTED_EPS','NORMALIZED_12_MONTH_DILUTED_EPS','FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION','REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM')
    or jsonb_typeof(parameters->'forecast_period'->'start') is distinct from 'string'
    or jsonb_typeof(parameters->'forecast_period'->'end') is distinct from 'string' then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
  elsif expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then
   if parameters->>'earnings_basis' is distinct from 'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM'
    or jsonb_typeof(parameters->'earnings_period') is distinct from 'object' then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   if (select count(*) from jsonb_object_keys(parameters->'earnings_period'))<>2
    or not (parameters->'earnings_period') ?& array['start','end']
    or jsonb_typeof(parameters->'earnings_period'->'start') is distinct from 'string'
    or jsonb_typeof(parameters->'earnings_period'->'end') is distinct from 'string' then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
  elsif parameters->>'cashflow_basis' is distinct from 'FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI'
   or parameters->>'timing' is distinct from 'END_OF_YEAR' then raise exception 'PRICE_PROFILE_PARAMETERS';
  end if;
  scenario_keys:=case when p->>'horizon'='MEDIUM' then array['name','eps','pe']
   when expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then array['name','eps_growth_rates','payout_ratios','required_return','terminal_pe']
   else array['name','cashflows','discount_rate','terminal'] end;
  for scenario in select * from jsonb_array_elements(parameters->'scenarios') loop
   if jsonb_typeof(scenario) is distinct from 'object' then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   if (select count(*) from jsonb_object_keys(scenario))<>cardinality(scenario_keys) or not scenario ?& scenario_keys
    then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   if coalesce(scenario->>'name','') not in('conservative','base','upside') then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   if p->>'horizon'='MEDIUM' then
    if jsonb_typeof(scenario->'eps') is distinct from 'number' or jsonb_typeof(scenario->'pe') is distinct from 'number'
     then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   elsif expected_method='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' then
    if jsonb_typeof(scenario->'eps_growth_rates') is distinct from 'array' or jsonb_typeof(scenario->'payout_ratios') is distinct from 'array'
     or jsonb_typeof(scenario->'required_return') is distinct from 'number' or jsonb_typeof(scenario->'terminal_pe') is distinct from 'number'
     then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
    if jsonb_array_length(scenario->'eps_growth_rates') not between 1 and 10
     or jsonb_array_length(scenario->'payout_ratios')<>jsonb_array_length(scenario->'eps_growth_rates')
     or exists(select from jsonb_array_elements((scenario->'eps_growth_rates')||(scenario->'payout_ratios'))n where jsonb_typeof(n)<>'number')
     then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   else
    if jsonb_typeof(scenario->'cashflows') is distinct from 'array' or jsonb_typeof(scenario->'discount_rate') is distinct from 'number'
     then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
    if jsonb_array_length(scenario->'cashflows') not between 1 and 100 or exists(select from jsonb_array_elements(scenario->'cashflows')f where jsonb_typeof(f)<>'number')
     then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   end if;
   if expected_method='LONG_FCFE_DISCOUNT_SCENARIOS_V1' and scenario->'terminal' is distinct from 'null'::jsonb then
    if jsonb_typeof(scenario->'terminal') is distinct from 'object' then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
    if (select count(*) from jsonb_object_keys(scenario->'terminal'))<>2 or not (scenario->'terminal') ?& array['next_fcfe','growth']
     or jsonb_typeof(scenario->'terminal'->'next_fcfe') is distinct from 'number' or jsonb_typeof(scenario->'terminal'->'growth') is distinct from 'number'
     then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
   end if;
  end loop;
  refs:=refs||(parameters->'stop_evidence_ids')||(parameters->'dilution_basis'->'evidence_ids');
 end if;
 if (select count(*) from jsonb_object_keys(parameters))<>cardinality(parameter_keys) or not parameters ?& parameter_keys
  then raise exception 'PRICE_PROFILE_PARAMETERS';end if;
 refs:=refs||jsonb_build_array(t->>'quote_evidence_id');
 if jsonb_typeof(t->'quote_evidence_id') is distinct from 'string' or not exists(select from jsonb_array_elements(t->'evidence')e
  where e->>'id'=t->>'quote_evidence_id' and e->>'symbol'=p->>'symbol' and e->>'kind'='PRICE')
  or exists(select from jsonb_array_elements(refs)r where jsonb_typeof(r)<>'string' or length(btrim(r#>>'{}')) not between 1 and 200
   or not exists(select from jsonb_array_elements(t->'evidence')e where e->>'id'=r#>>'{}' and e->>'symbol'=p->>'symbol'))
  then raise exception 'PRICE_PROFILE_REFERENCE';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-price-profile:'||(p->>'symbol')||':'||(p->>'horizon'),0));
 select * into existing from vnext_private.ai_price_profiles_v1 where profile_hash=p_profile_hash;
 if not found then
  -- A caller's backdated created_at is not proof of registration while the
  -- template was alive. Check the actual clock after acquiring the lock.
  -- An exact, already registered hash remains replayable after its template
  -- expires; this does not extend either the profile or a review's validity.
  if clock_timestamp()>=template_expiry then raise exception 'PRICE_PROFILE_TEMPLATE_EXPIRED_AT_REGISTRATION';end if;
  insert into vnext_private.ai_price_profiles_v1(profile_hash,symbol,horizon,profile_text,profile)
  values(p_profile_hash,p->>'symbol',p->>'horizon',p_profile_text,p) returning * into existing;
 end if;
 if existing.profile_text is distinct from p_profile_text or existing.profile is distinct from p then raise exception 'PRICE_PROFILE_REPLAY_CONFLICT';end if;
 return jsonb_build_object('schema','DAILY_AI_PRICE_PROFILE_STAGED_V1','profile_hash',p_profile_hash,'symbol',existing.symbol,
  'horizon',existing.horizon,'registration_id',existing.registration_id,'registered',true,'review_required',true,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_price_profile_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_price_profile_v1(text,text) to service_role;

-- One daily write, not 216 requests. The same batch lock also prevents a
-- loader/write race from overwriting an explicit input registered meanwhile.
-- Deliberate input revisions still use the original single-input RPC.
create function public.stage_daily_ai_price_inputs_batch_v1(p_batch_id text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;v jsonb;receipt jsonb;receipts jsonb:='[]'::jsonb;keys_seen text[]:=array[]::text[];key text;latest_hash text;
begin
 if p_batch_id is null or p_batch_id !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_items) is distinct from 'array'
  then raise exception 'PRICE_INPUT_BATCH_SCOPE';end if;
 if jsonb_array_length(p_items) not between 1 and 216 or octet_length(p_items::text)>64000000
  then raise exception 'PRICE_INPUT_BATCH_SCOPE';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-price-work:'||p_batch_id,0));
 for item in select * from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'PRICE_INPUT_BATCH_FIELDS';end if;
  if (select count(*) from jsonb_object_keys(item))<>2 or not item ?& array['input_text','input_hash']
   or jsonb_typeof(item->'input_text') is distinct from 'string' or jsonb_typeof(item->'input_hash') is distinct from 'string'
   then raise exception 'PRICE_INPUT_BATCH_FIELDS';end if;
  if octet_length(item->>'input_text') not between 2 and 1500000 then raise exception 'PRICE_INPUT_BATCH_FIELDS';end if;
  v:=(item->>'input_text')::jsonb;
  if jsonb_typeof(v) is distinct from 'object' then raise exception 'PRICE_INPUT_BATCH_FIELDS';end if;
  key:=(v->>'symbol')||':'||(v->>'horizon');
  if key is null or key=any(keys_seen) then raise exception 'PRICE_INPUT_BATCH_SCOPE';end if;
  keys_seen:=array_append(keys_seen,key);
  select input_hash into latest_hash from vnext_private.ai_price_calculation_inputs_v1
   where batch_id=p_batch_id and symbol=v->>'symbol' and horizon=v->>'horizon' order by registration_id desc limit 1;
  if found and latest_hash is distinct from item->>'input_hash' then raise exception 'PRICE_INPUT_BATCH_ALREADY_REGISTERED';end if;
  receipt:=public.stage_daily_ai_price_calculation_input_v1(p_batch_id,item->>'input_text',item->>'input_hash');
  if receipt->>'schema' is distinct from 'DAILY_AI_PRICE_CALCULATION_INPUT_STAGED_V1' or receipt->>'batch_id' is distinct from p_batch_id
   or receipt->>'input_hash' is distinct from item->>'input_hash' or receipt->'registered' is distinct from 'true'::jsonb
   or receipt->'review_required' is distinct from 'true'::jsonb or receipt->'member_published' is distinct from 'false'::jsonb
   then raise exception 'PRICE_INPUT_BATCH_RECEIPT';end if;
  receipts:=receipts||jsonb_build_array(receipt);
 end loop;
 return jsonb_build_object('schema','DAILY_AI_PRICE_INPUTS_BATCH_STAGED_V1','batch_id',p_batch_id,
  'items',receipts,'review_required',true,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_price_inputs_batch_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_price_inputs_batch_v1(text,jsonb) to service_role;

create function vnext_private.daily_ai_price_work_key_v1(p_edition_id text) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('schema','DAILY_AI_PRICE_WORK_KEY_V1','edition_id',e.id,
  'inputs',coalesce((select jsonb_agg(jsonb_build_object('symbol',i.symbol,'horizon',i.horizon,'input_hash',i.input_hash) order by i.symbol,i.horizon)
   from(select distinct on(symbol,horizon) symbol,horizon,input_hash from vnext_private.ai_price_calculation_inputs_v1
    where batch_id=e.batch_id order by symbol,horizon,registration_id desc)i),'[]'::jsonb),
  'profiles',coalesce((select jsonb_agg(jsonb_build_object('symbol',p.symbol,'horizon',p.horizon,'profile_hash',p.profile_hash) order by p.symbol,p.horizon)
   from(select distinct on(symbol,horizon) symbol,horizon,profile_hash from vnext_private.ai_price_profiles_v1 p
    where exists(select from jsonb_array_elements(e.payload->'cards')c where c->>'symbol'=p.symbol and c->>'horizon'=p.horizon)
     and not exists(select from vnext_private.ai_price_calculation_inputs_v1 i where i.batch_id=e.batch_id and i.symbol=p.symbol and i.horizon=p.horizon)
    order by symbol,horizon,registration_id desc)p),'[]'::jsonb))::text,'UTF8')),'hex')
 from vnext_private.ai_research_editions e where e.id=p_edition_id;
$$;
revoke all on function vnext_private.daily_ai_price_work_key_v1(text) from public,anon,authenticated,service_role;

create function public.get_daily_ai_price_work_v1(p_edition_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;b vnext_runtime.ai_stock_batches;inputs jsonb;profiles jsonb;at_time timestamptz:=clock_timestamp();
begin
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' then raise exception 'PRICE_WORK_EDITION';end if;
 select * into e from vnext_private.ai_research_editions where id=p_edition_id;
 if not found or e.created_at>at_time or e.expires_at<=at_time or not vnext_private.ai_edition_integrity_v1(e.id)
  then raise exception 'PRICE_WORK_EDITION';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=e.batch_id;
 if not vnext_private.ai_batch_commitment_v1(b.id) or jsonb_array_length(b.payload->'packets')<>72
  or jsonb_array_length(e.payload->'cards')<>216 then raise exception 'PRICE_WORK_BATCH';end if;
 select coalesce(jsonb_agg(jsonb_build_object('registration_id',i.registration_id,'input_text',i.input_text,'input_hash',i.input_hash,
  'symbol',i.symbol,'horizon',i.horizon) order by i.symbol,i.horizon),'[]'::jsonb) into inputs from (
  select distinct on(symbol,horizon) registration_id,input_text,input_hash,symbol,horizon
  from vnext_private.ai_price_calculation_inputs_v1 where batch_id=b.id order by symbol,horizon,registration_id desc)i;
 select coalesce(jsonb_agg(jsonb_build_object('registration_id',p.registration_id,'profile_text',p.profile_text,'profile_hash',p.profile_hash,
  'symbol',p.symbol,'horizon',p.horizon) order by p.symbol,p.horizon),'[]'::jsonb) into profiles from (
  select distinct on(symbol,horizon) registration_id,profile_text,profile_hash,symbol,horizon
  from vnext_private.ai_price_profiles_v1 p where exists(select from jsonb_array_elements(e.payload->'cards')c
   where c->>'symbol'=p.symbol and c->>'horizon'=p.horizon)
  -- Current-batch inputs already take precedence. Do not duplicate their
  -- potentially large template evidence in every reload or CACHED response.
  and not exists(select from vnext_private.ai_price_calculation_inputs_v1 i
   where i.batch_id=b.id and i.symbol=p.symbol and i.horizon=p.horizon)
  order by symbol,horizon,registration_id desc)p;
 if jsonb_array_length(inputs)>216 or jsonb_array_length(profiles)>216 then raise exception 'PRICE_WORK_COUNT';end if;
 return jsonb_build_object('schema','DAILY_AI_PRICE_WORK_V1','batch_id',b.id,'work_key',vnext_private.daily_ai_price_work_key_v1(e.id),
  'edition',jsonb_build_object('id',e.id,'evidence_cutoff',to_char(e.cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'prepared_at',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'expires_at',to_char(e.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'data_through',to_char(e.through,'YYYY-MM-DD')),
  'cards',e.payload->'cards','packets',b.payload->'packets','inputs',inputs,'profiles',profiles,'review_required',true,'member_published',false);
end $$;
revoke all on function public.get_daily_ai_price_work_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_price_work_v1(text) to service_role;

-- All items commit atomically. The exact existing stage function remains the
-- authority for price/card/source/expiry checks. These additional checks bind
-- the numerical plan to its immutable calculation, method and PENDING request.
-- They do not independently rerun financial arithmetic or grant review PASS.
create function public.stage_daily_ai_price_work_batch_v1(p_edition_id text,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;b vnext_runtime.ai_stock_batches;item jsonb;plan jsonb;calculation jsonb;note jsonb;request jsonb;
 registered vnext_private.ai_price_calculation_inputs_v1;prior vnext_private.ai_price_calculation_audits_v1;
 staged jsonb;receipts jsonb:='[]'::jsonb;request_hash text;replayed boolean;at_time timestamptz:=clock_timestamp();
 expected_keys text[]:=array['input_hash','body_text','plan_hash','calculation_text','calculation_hash','method_note_text','method_note_hash','review_request_text'];
 request_keys text[]:=array['schema','status','edition_id','symbol','horizon','plan_hash','calculation_hash','input_hash','assumption_hash','packet_hash','card_hash','method_document_hash','evidence_ids','prepared_at','expires_at','required_reviews','review','source_use_approved','methodology_approved'];
begin
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_items) is distinct from 'array'
  then raise exception 'PRICE_WORK_BATCH_SCOPE';end if;
 if jsonb_array_length(p_items) not between 1 and 216 or octet_length(p_items::text)>12000000
  or (select count(distinct x->>'plan_hash') from jsonb_array_elements(p_items)x)<>jsonb_array_length(p_items)
  then raise exception 'PRICE_WORK_BATCH_SCOPE';end if;
 select * into e from vnext_private.ai_research_editions where id=p_edition_id;
 if not found or e.created_at>at_time or e.expires_at<=at_time or not vnext_private.ai_edition_integrity_v1(e.id)
  then raise exception 'PRICE_WORK_EDITION';end if;
 select * into strict b from vnext_runtime.ai_stock_batches where id=e.batch_id;
 perform pg_advisory_xact_lock(hashtextextended('ai-price-work:'||b.id,0));
 for item in select * from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' then raise exception 'PRICE_WORK_ITEM_FIELDS';end if;
  if (select count(*) from jsonb_object_keys(item))<>cardinality(expected_keys) or not item ?& expected_keys
   or exists(select from jsonb_each(item)x where jsonb_typeof(x.value)<>'string')
   or coalesce(item->>'input_hash','') !~ '^[a-f0-9]{64}$' or coalesce(item->>'plan_hash','') !~ '^[a-f0-9]{64}$'
   or coalesce(item->>'calculation_hash','') !~ '^[a-f0-9]{64}$' or coalesce(item->>'method_note_hash','') !~ '^[a-f0-9]{64}$'
   then raise exception 'PRICE_WORK_ITEM_FIELDS';end if;
  if octet_length(item->>'body_text') not between 2 and 16000 or octet_length(item->>'calculation_text') not between 2 and 200000
   or octet_length(item->>'method_note_text') not between 2 and 32000 or octet_length(item->>'review_request_text') not between 2 and 16000
   or encode(sha256(convert_to(item->>'body_text','UTF8')),'hex') is distinct from item->>'plan_hash'
   or encode(sha256(convert_to(item->>'calculation_text','UTF8')),'hex') is distinct from item->>'calculation_hash'
   or encode(sha256(convert_to(item->>'method_note_text','UTF8')),'hex') is distinct from item->>'method_note_hash'
   then raise exception 'PRICE_WORK_ITEM_HASH';end if;
  plan:=(item->>'body_text')::jsonb;calculation:=(item->>'calculation_text')::jsonb;
  note:=(item->>'method_note_text')::jsonb;request:=(item->>'review_request_text')::jsonb;
  if jsonb_typeof(plan) is distinct from 'object' or jsonb_typeof(calculation) is distinct from 'object'
   or jsonb_typeof(note) is distinct from 'object' or jsonb_typeof(request) is distinct from 'object'
   then raise exception 'PRICE_WORK_ITEM_FIELDS';end if;
  select * into registered from vnext_private.ai_price_calculation_inputs_v1 where batch_id=b.id
   and symbol=plan->>'symbol' and horizon=plan->>'horizon' order by registration_id desc limit 1;
  if not found or registered.input_hash is distinct from item->>'input_hash' then raise exception 'PRICE_WORK_INPUT_SUPERSEDED';end if;
  if plan->>'edition_id' is distinct from e.id or calculation->>'schema' is distinct from 'DAILY_AI_PRICE_CALCULATION_V1'
   or calculation->>'status' is distinct from 'CALCULATED_REVIEW_REQUIRED'
   or calculation->>'input_hash' is distinct from registered.input_hash
   or calculation->>'symbol' is distinct from registered.symbol or calculation->>'horizon' is distinct from registered.horizon
   or calculation->>'method_id' is distinct from registered.input->>'method_id' or calculation->>'method' is distinct from calculation->>'method_id'
   or calculation->>'cutoff' is distinct from registered.input->>'cutoff' or calculation->>'data_through' is distinct from registered.input->>'data_through'
   or calculation->>'as_of' is distinct from registered.input->>'as_of' or calculation->>'expires_at' is distinct from registered.input->>'expires_at'
   or calculation->'review' is distinct from 'null'::jsonb or calculation->'research_only' is distinct from 'true'::jsonb
   or calculation->'production_eligible' is distinct from 'false'::jsonb or calculation->'buy_ready' is distinct from 'false'::jsonb
   or coalesce(calculation->>'assumption_hash','') !~ '^[a-f0-9]{64}$'
   or exists(select from unnest(array['symbol','horizon','currency','method','entry_range','wait_above','stop_kind','stop','stop_evidence_ids','invalidation','evidence_ids','as_of','expires_at'])k
    where plan->k is distinct from calculation->k)
   or plan->>'basis' is distinct from (calculation->>'basis')||E'\n計算紀錄 SHA-256：'||(item->>'calculation_hash')
   then raise exception 'PRICE_WORK_CALCULATION_BINDING';end if;
  if (select count(*) from jsonb_object_keys(note))<>5 or not note ?& array['name','derivation','assumptions','limitations','source_use_scope']
   or note->>'name' is distinct from calculation->>'method' or note->>'source_use_scope' is distinct from 'PRIVATE_RESEARCH_ONLY'
   or note->'assumptions' is distinct from calculation->'method_note'->'assumptions'
   or note->'limitations' is distinct from calculation->'method_note'->'limitations'
   or note->>'derivation' is distinct from (calculation->'method_note'->>'derivation')||E'\n計算紀錄 SHA-256：'||(item->>'calculation_hash')
     ||E'\n輸入 SHA-256：'||registered.input_hash||E'\n假設 SHA-256：'||(calculation->>'assumption_hash')
   then raise exception 'PRICE_WORK_METHOD_BINDING';end if;
  if (select count(*) from jsonb_object_keys(request))<>cardinality(request_keys) or not request ?& request_keys
   or request->>'schema' is distinct from 'DAILY_AI_PRICE_REVIEW_REQUEST_V1' or request->>'status' is distinct from 'PENDING'
   or request->>'edition_id' is distinct from e.id or request->>'symbol' is distinct from registered.symbol or request->>'horizon' is distinct from registered.horizon
   or request->>'plan_hash' is distinct from item->>'plan_hash' or request->>'calculation_hash' is distinct from item->>'calculation_hash'
   or request->>'input_hash' is distinct from registered.input_hash or request->>'method_document_hash' is distinct from item->>'method_note_hash'
   or request->>'assumption_hash' is distinct from calculation->>'assumption_hash'
   or request->>'packet_hash' is distinct from b.payload->'packet_hashes'->>registered.symbol or coalesce(request->>'card_hash','') !~ '^[a-f0-9]{64}$'
   or request->'evidence_ids' is distinct from plan->'evidence_ids' or request->'expires_at' is distinct from plan->'expires_at'
   or request->'required_reviews' is distinct from '["QUALITY","TIME","SOURCE_USE","METHODOLOGY"]'::jsonb
   or request->'review' is distinct from 'null'::jsonb or request->'source_use_approved' is distinct from 'false'::jsonb
   or request->'methodology_approved' is distinct from 'false'::jsonb
   then raise exception 'PRICE_WORK_REVIEW_REQUEST';end if;
  if jsonb_typeof(request->'prepared_at') is distinct from 'string' or not isfinite((request->>'prepared_at')::timestamptz)
   or (request->>'prepared_at')::timestamptz<e.created_at or (request->>'prepared_at')::timestamptz<(plan->>'as_of')::timestamptz
   or (request->>'prepared_at')::timestamptz>clock_timestamp() then raise exception 'PRICE_WORK_REVIEW_TIME';end if;
  staged:=public.stage_daily_ai_price_plan_v1(item->>'body_text',item->>'plan_hash');
  if staged->>'schema' is distinct from 'DAILY_AI_PRICE_PLAN_STAGED_V1' or staged->>'plan_hash' is distinct from item->>'plan_hash'
   or staged->'review_required' is distinct from 'true'::jsonb or staged->'member_published' is distinct from 'false'::jsonb
   then raise exception 'PRICE_WORK_STAGE_RECEIPT';end if;
  request_hash:=encode(sha256(convert_to(item->>'review_request_text','UTF8')),'hex');
  select * into prior from vnext_private.ai_price_calculation_audits_v1 where plan_hash=item->>'plan_hash';replayed:=found;
  if replayed then
   if prior.edition_id is distinct from e.id or prior.batch_id is distinct from b.id or prior.input_hash is distinct from registered.input_hash
    or prior.calculation_hash is distinct from item->>'calculation_hash' or prior.calculation_text is distinct from item->>'calculation_text'
    or prior.method_note_hash is distinct from item->>'method_note_hash' or prior.method_note_text is distinct from item->>'method_note_text'
    or (prior.review_request-'prepared_at') is distinct from (request-'prepared_at') then raise exception 'PRICE_WORK_AUDIT_REPLAY_CONFLICT';end if;
   request_hash:=prior.review_request_hash;
  else
   insert into vnext_private.ai_price_calculation_audits_v1(plan_hash,edition_id,batch_id,input_hash,calculation_hash,calculation_text,calculation,
    method_note_hash,method_note_text,method_note,review_request_hash,review_request_text,review_request)
   values(item->>'plan_hash',e.id,b.id,registered.input_hash,item->>'calculation_hash',item->>'calculation_text',calculation,
    item->>'method_note_hash',item->>'method_note_text',note,request_hash,item->>'review_request_text',request);
  end if;
  receipts:=receipts||jsonb_build_array(jsonb_build_object('plan_hash',item->>'plan_hash','input_hash',registered.input_hash,
   'calculation_hash',item->>'calculation_hash','method_note_hash',item->>'method_note_hash','review_request_hash',request_hash,
   'review_required',true,'member_published',false,'replayed',replayed));
 end loop;
 return jsonb_build_object('schema','DAILY_AI_PRICE_WORK_BATCH_STAGED_V1','edition_id',e.id,'items',receipts,'review_required',true,'member_published',false);
end $$;
revoke all on function public.stage_daily_ai_price_work_batch_v1(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stage_daily_ai_price_work_batch_v1(text,jsonb) to service_role;

create function public.finish_daily_ai_price_work_v1(p_edition_id text,p_work_key text,p_result_text text,p_result_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;r jsonb;row jsonb;card jsonb;latest_hash text;prior vnext_private.ai_price_work_results_v1;
 replayed boolean;at_time timestamptz:=clock_timestamp();staged integer:=0;missing integer:=0;ineligible integer:=0;invalid integer:=0;
begin
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' or p_work_key is null or p_work_key !~ '^[a-f0-9]{64}$'
  or p_result_hash is null or p_result_hash !~ '^[a-f0-9]{64}$' or p_result_text is null
  or octet_length(p_result_text) not between 2 and 1000000
  or encode(sha256(convert_to(p_result_text,'UTF8')),'hex') is distinct from p_result_hash
  then raise exception 'PRICE_WORK_FINISH_HASH';end if;
 select * into e from vnext_private.ai_research_editions where id=p_edition_id;
 if not found or e.created_at>at_time or e.expires_at<=at_time or not vnext_private.ai_edition_integrity_v1(e.id)
  then raise exception 'PRICE_WORK_FINISH_EDITION';end if;
 perform pg_advisory_xact_lock(hashtextextended('ai-price-work:'||e.batch_id,0));
 if p_work_key is distinct from vnext_private.daily_ai_price_work_key_v1(e.id) then raise exception 'PRICE_WORK_FINISH_KEY_CHANGED';end if;
 r:=p_result_text::jsonb;
 if jsonb_typeof(r) is distinct from 'object' then raise exception 'PRICE_WORK_FINISH_RESULT';end if;
 if r->>'schema' is distinct from 'DAILY_AI_PRICE_WORK_RESULT_V1' or r->>'edition_id' is distinct from e.id
  or r->>'batch_id' is distinct from e.batch_id or r->'review_required' is distinct from 'true'::jsonb
  or r->'member_published' is distinct from 'false'::jsonb or r->'model_calls' is distinct from '0'::jsonb
  or coalesce(r->>'state','') not in('METHOD_INPUTS_REQUIRED','NO_ELIGIBLE_PRICE_PLANS','PRICES_STAGED_REVIEW_REQUIRED','PARTIAL_PRICES_STAGED_REVIEW_REQUIRED')
  or jsonb_typeof(r->'rows') is distinct from 'array' or jsonb_typeof(r->'counts') is distinct from 'object'
  then raise exception 'PRICE_WORK_FINISH_RESULT';end if;
 if jsonb_array_length(r->'rows')<>216 or (select count(distinct (x->>'symbol')||':'||(x->>'horizon')) from jsonb_array_elements(r->'rows')x)<>216
  then raise exception 'PRICE_WORK_FINISH_ROWS';end if;
 for row in select * from jsonb_array_elements(r->'rows') loop
  if jsonb_typeof(row) is distinct from 'object' then raise exception 'PRICE_WORK_FINISH_ROWS';end if;
  select c into card from jsonb_array_elements(e.payload->'cards')c where c->>'symbol'=row->>'symbol' and c->>'horizon'=row->>'horizon';
  if not found then raise exception 'PRICE_WORK_FINISH_ROWS';end if;
  select input_hash into latest_hash from vnext_private.ai_price_calculation_inputs_v1
   where batch_id=e.batch_id and symbol=row->>'symbol' and horizon=row->>'horizon' order by registration_id desc limit 1;
  if row->>'input_hash' is distinct from latest_hash then raise exception 'PRICE_WORK_FINISH_INPUT';end if;
  if row->>'state'='STAGED_REVIEW_REQUIRED' then
   if latest_hash is null or not exists(select from vnext_private.ai_price_calculation_audits_v1 a
    join vnext_private.ai_price_plans_v1 p on p.plan_hash=a.plan_hash
    where a.edition_id=e.id and a.batch_id=e.batch_id and a.input_hash=latest_hash and a.plan_hash=row->>'plan_hash'
     and a.calculation_hash=row->>'calculation_hash' and p.edition_id=e.id and p.symbol=row->>'symbol' and p.horizon=row->>'horizon')
    then raise exception 'PRICE_WORK_FINISH_AUDIT';end if;
   staged:=staged+1;
  elsif row->>'state'='METHOD_INPUT_REQUIRED' then
   if latest_hash is not null or card->>'status' in('INSUFFICIENT','AVOID') then raise exception 'PRICE_WORK_FINISH_INPUT';end if;
   missing:=missing+1;
  elsif row->>'state'='INVALID_INPUT' then
   if latest_hash is null or card->>'status' in('INSUFFICIENT','AVOID') then raise exception 'PRICE_WORK_FINISH_INPUT';end if;
   invalid:=invalid+1;
  elsif row->>'state'='INELIGIBLE' then
   if latest_hash is null and card->>'status' not in('INSUFFICIENT','AVOID') then raise exception 'PRICE_WORK_FINISH_INPUT';end if;
   ineligible:=ineligible+1;
  else raise exception 'PRICE_WORK_FINISH_ROWS';end if;
 end loop;
 if r->'counts' is distinct from jsonb_build_object('cards',216,'calculated',staged,'staged',staged,'missing_inputs',missing,'ineligible',ineligible,'invalid',invalid)
  or (staged>0 and (r->'stage_attempted' is distinct from 'true'::jsonb or r->>'state' is distinct from
   case when missing>0 or invalid>0 then 'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED' else 'PRICES_STAGED_REVIEW_REQUIRED' end))
  or (staged=0 and (r->'stage_attempted' is distinct from 'false'::jsonb or r->>'state' not in('METHOD_INPUTS_REQUIRED','NO_ELIGIBLE_PRICE_PLANS')))
  then raise exception 'PRICE_WORK_FINISH_COUNTS';end if;
 select * into prior from vnext_private.ai_price_work_results_v1 where edition_id=e.id and work_key=p_work_key;replayed:=found;
 if not replayed then
  insert into vnext_private.ai_price_work_results_v1(edition_id,work_key,result_hash,result_text,result)
  values(e.id,p_work_key,p_result_hash,p_result_text,r) returning * into prior;
 end if;
 return jsonb_build_object('schema','DAILY_AI_PRICE_WORK_FINISHED_V1','edition_id',e.id,'work_key',p_work_key,
  'result_hash',prior.result_hash,'replayed',replayed,'member_published',false,'review_required',true);
end $$;
revoke all on function public.finish_daily_ai_price_work_v1(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_daily_ai_price_work_v1(text,text,text,text) to service_role;

-- Exact Owner-only calculation inspection. This exposes one registered
-- stock/horizon input and its immutable math, never all edition packets. A
-- pending audit is readable without copying or creating any review decision.
create function public.get_daily_ai_owner_price_calculation_v1(p_edition_id text,p_plan_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e vnext_private.ai_research_editions;p vnext_private.ai_price_plans_v1;
 a vnext_private.ai_price_calculation_audits_v1;i vnext_private.ai_price_calculation_inputs_v1;audit jsonb:=null;
begin
 if auth.uid() is null or academy_private.access_v11() is distinct from 'owner' or not public.is_research_owner_v1()
  then raise exception 'OWNER_REQUIRED' using errcode='42501';end if;
 if p_edition_id is null or p_edition_id !~ '^[a-f0-9]{64}$' or p_plan_hash is null or p_plan_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'AI_PRICE_CALCULATION_SCOPE';end if;
 select * into e from vnext_private.ai_research_editions where id=p_edition_id;
 if not found then raise exception 'AI_PRICE_CALCULATION_EDITION';end if;
 select * into p from vnext_private.ai_price_plans_v1 where plan_hash=p_plan_hash and edition_id=e.id;
 if not found then raise exception 'AI_PRICE_CALCULATION_PLAN';end if;
 select * into a from vnext_private.ai_price_calculation_audits_v1 where plan_hash=p.plan_hash;
 if found then
  select * into strict i from vnext_private.ai_price_calculation_inputs_v1 where batch_id=a.batch_id and input_hash=a.input_hash;
  if a.edition_id is distinct from e.id or a.batch_id is distinct from e.batch_id
   or i.symbol is distinct from p.symbol or i.horizon is distinct from p.horizon
   or a.calculation->>'input_hash' is distinct from i.input_hash or a.calculation->>'symbol' is distinct from p.symbol
   or a.calculation->>'horizon' is distinct from p.horizon or a.review_request->>'plan_hash' is distinct from p.plan_hash
   then raise exception 'AI_PRICE_CALCULATION_BINDING';end if;
  audit:=jsonb_build_object('batch_id',a.batch_id,'input_hash',i.input_hash,'input_text',i.input_text,
   'calculation_hash',a.calculation_hash,'calculation_text',a.calculation_text,
   'method_note_hash',a.method_note_hash,'method_note_text',a.method_note_text,
   'review_request_hash',a.review_request_hash,'review_request_text',a.review_request_text,
   'recorded_at',to_char(a.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end if;
 return jsonb_build_object('schema','DAILY_AI_OWNER_PRICE_CALCULATION_V1','edition_id',e.id,'plan_hash',p.plan_hash,
  'subject_user_id',auth.uid(),'research_only',true,'preview_only',true,'audit',audit);
end $$;
revoke all on function public.get_daily_ai_owner_price_calculation_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_owner_price_calculation_v1(text,text) to authenticated;
commit;
