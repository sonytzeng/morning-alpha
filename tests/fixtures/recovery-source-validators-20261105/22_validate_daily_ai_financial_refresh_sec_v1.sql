CREATE OR REPLACE FUNCTION vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(p_base_inputs jsonb, p_inputs jsonb, p_refresh jsonb, p_cutoff timestamp with time zone, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare registry vnext_private.verified_retained_sec_facts_v1;registered jsonb;base_sec jsonb;incoming_sec jsonb;projected_sec jsonb;
 stripped_base jsonb;stripped_inputs jsonb;old_proof jsonb;expected_replay jsonb;proof_present boolean;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'SEC_REPLAY_INPUT_SCOPE';end if;
 proof_present:=coalesce(p_refresh?'sec_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]'::jsonb) into base_sec
  from jsonb_array_elements(p_base_inputs)i cross join lateral jsonb_array_elements(i->'facts')f
  where vnext_runtime.is_retained_sec_quarter_identity_v1(f);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]'::jsonb) into incoming_sec
  from jsonb_array_elements(p_inputs)i cross join lateral jsonb_array_elements(i->'facts')f
  where vnext_runtime.is_retained_sec_quarter_identity_v1(f);
 -- Preserve the exact old behavior during the staged rollout when neither side
 -- carries SEC facts and the adapter has not supplied its optional proof.
 if not proof_present and base_sec='[]'::jsonb and incoming_sec='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_v5(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);
 end if;
 select * into strict registry from vnext_private.verified_retained_sec_facts_v1
  where source_seal_sha256='a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb';
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(registry.facts_text::jsonb)f;
 if exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i cross join lateral jsonb_array_elements(i->'facts')f
   where vnext_runtime.is_retained_sec_quarter_identity_v1(f) and i->>'symbol' is distinct from '2330')
  or (base_sec<>'[]'::jsonb and base_sec is distinct from registered)
  or incoming_sec is distinct from registered
  or p_cutoff is null or not isfinite(p_cutoff)
  or exists(select from jsonb_array_elements(registered)f where (f->>'available_at')::timestamptz>p_cutoff)
  then raise exception 'SEC_REPLAY_FACTS_NOT_EXACT';end if;
 expected_replay:=jsonb_build_object('schema','DAILY_AI_SEC_RETAINED_REPLAY_V1',
  'source_seal_sha256',registry.source_seal_sha256,'facts_sha256',registry.facts_sha256,
  'fact_ids',(select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f),
  'replay_basis',registry.replay_basis,'source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if proof_present then
  if p_refresh->'sec_replay' is distinct from expected_replay then raise exception 'SEC_REPLAY_PROOF_NOT_EXACT';end if;
 elsif base_sec='[]'::jsonb then
  -- First addition must have explicit replay proof. A prior exact full set may
  -- survive an adapter read failure, without turning old receipts into new ones.
  raise exception 'SEC_REPLAY_PROOF_REQUIRED';
 end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb)
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not vnext_runtime.is_retained_sec_quarter_identity_v1(f.value))) order by i.ordinality)
  into stripped_base from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb)
  from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not vnext_runtime.is_retained_sec_quarter_identity_v1(f.value))) order by i.ordinality)
  into stripped_inputs from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 old_proof:=vnext_runtime.validate_daily_ai_financial_refresh_v5(stripped_base,stripped_inputs,
  case when p_refresh is null then null else p_refresh-'sec_replay' end,p_cutoff,p_business_date);
 -- SOURCE applies this same pinned projection after validation. Refuse an
 -- otherwise valid intake if competing facts would silently displace any of
 -- the twelve retained SEC facts from the four-per-kind quarterly budget.
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]'::jsonb) into projected_sec
  from jsonb_array_elements(vnext_runtime.project_daily_stock_ai_inputs_v1(p_inputs))i
  cross join lateral jsonb_array_elements(i->'facts')f
  where vnext_runtime.is_retained_sec_quarter_identity_v1(f);
 if projected_sec is distinct from registered then raise exception 'SEC_REPLAY_PROJECTION_TRUNCATED';end if;
 return old_proof||jsonb_build_object('sec_replay',expected_replay);
end $function$
