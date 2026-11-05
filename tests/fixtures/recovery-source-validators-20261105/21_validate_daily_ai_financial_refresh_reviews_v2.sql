CREATE OR REPLACE FUNCTION vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(p_base_inputs jsonb, p_inputs jsonb, p_refresh jsonb, p_cutoff timestamp with time zone, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r vnext_private.verified_documented_reviews_v2;registered jsonb;base_reviews jsonb;incoming_reviews jsonb;provided boolean;
 phase jsonb;state text;expected jsonb;base_stripped jsonb;input_stripped jsonb;prior_proof jsonb;projected jsonb;required_ids jsonb;selected_ids jsonb;price_count integer;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'DOCUMENTED_REVIEW_V2_INPUT_SCOPE';end if;
 provided:=coalesce(p_refresh?'documented_review_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into base_reviews from jsonb_array_elements(p_base_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into incoming_reviews from jsonb_array_elements(p_inputs)i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_documented_review_v2(f);
 if not provided and base_reviews='[]'::jsonb and incoming_reviews='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);end if;
 if p_cutoff is null or not isfinite(p_cutoff) then raise exception 'DOCUMENTED_REVIEW_V2_CLOCK';end if;
 select * into strict r from vnext_private.verified_documented_reviews_v2;
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
 if (base_reviews<>'[]'::jsonb and base_reviews is distinct from registered)
  or (incoming_reviews<>'[]'::jsonb and incoming_reviews is distinct from registered)
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
   where vnext_runtime.is_documented_review_v2(f) and i->>'symbol' is distinct from '2330')
  or exists(select from jsonb_array_elements(registered)f where (f->>'available_at')::timestamptz>p_cutoff)
  then raise exception 'DOCUMENTED_REVIEW_V2_FACT_DRIFT';end if;
 phase:=vnext_runtime.documented_review_phase_v2(p_inputs,p_cutoff,r.review_valid_until,r.review_price_basis_text::jsonb);state:=phase->>'state';
 if provided and p_refresh->'documented_review_replay'->>'state'='REGISTRY_UNAVAILABLE_NOT_APPLIED' then state:='REGISTRY_UNAVAILABLE_NOT_APPLIED';end if;
 if not provided and incoming_reviews='[]'::jsonb and state='ACTIVE' then state:='REGISTRY_UNAVAILABLE_NOT_APPLIED';end if;
 if not provided and base_reviews='[]'::jsonb and incoming_reviews<>'[]'::jsonb then raise exception 'DOCUMENTED_REVIEW_V2_PROOF_REQUIRED';end if;
 if state='ACTIVE' and incoming_reviews is distinct from registered
  or provided and state<>'ACTIVE' and incoming_reviews<>'[]'::jsonb then raise exception 'DOCUMENTED_REVIEW_V2_ACTIVATION';end if;
 expected:=jsonb_build_object('schema','DOCUMENTED_REVIEW_REPLAY_V2','source_seal_sha256',r.source_seal_sha256,'facts_sha256',r.facts_sha256,
  'review_valid_until',r.review_valid_until,'review_price_basis',r.review_price_basis_text::jsonb,
  'review_fact_ids',(select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f),
  'applied_fact_ids',case when state='ACTIVE' then (select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f)else '[]'::jsonb end,
  'state',state,'observed_price',phase->'observed_price','source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if provided and p_refresh->'documented_review_replay' is distinct from expected then raise exception 'DOCUMENTED_REVIEW_V2_PROOF_DRIFT';end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(select coalesce(jsonb_agg(f.value order by f.ordinality),'[]')
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality) where not vnext_runtime.is_documented_review_v2(f.value))) order by i.ordinality)
 into base_stripped from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(select coalesce(jsonb_agg(f.value order by f.ordinality),'[]')
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality) where not vnext_runtime.is_documented_review_v2(f.value))) order by i.ordinality)
 into input_stripped from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 prior_proof:=vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(base_stripped,input_stripped,
  case when p_refresh is null then null else p_refresh-'documented_review_replay' end,p_cutoff,p_business_date);
 if state='ACTIVE' then
  select vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb_agg(i||jsonb_build_object('cutoff',p_cutoff))) into projected from jsonb_array_elements(p_inputs)i;
  select coalesce(jsonb_agg(f->>'id' order by (f->>'id') collate "C"),'[]') into required_ids from jsonb_array_elements(p_inputs)i,
   lateral jsonb_array_elements(i->'facts')f where i->>'symbol'='2330' and (vnext_runtime.is_documented_review_v2(f) or f->>'id' like 'sec-quarter:2330:%');
  select count(*) into price_count from jsonb_array_elements(projected)i,
   lateral jsonb_array_elements_text(i->'expected_sessions') with ordinality s(day,n),lateral jsonb_array_elements(i->'bars')b
   where i->>'symbol'='2330' and s.n>greatest(jsonb_array_length(i->'expected_sessions')-20,0) and b->>'date'=s.day;
  select coalesce(jsonb_agg(f.value->>'id' order by (f.value->>'id') collate "C"),'[]') into selected_ids from jsonb_array_elements(projected)i,
   lateral jsonb_array_elements(i->'facts') with ordinality f(value,n)
   where i->>'symbol'='2330' and f.n<=84-price_count and (vnext_runtime.is_documented_review_v2(f.value) or f.value->>'id' like 'sec-quarter:2330:%');
  if jsonb_array_length(required_ids)<>15 or selected_ids is distinct from required_ids then raise exception 'DOCUMENTED_REVIEW_V2_15_EVIDENCE_BUDGET';end if;
 end if;
 return prior_proof||jsonb_build_object('documented_review_replay',expected);
end $function$
