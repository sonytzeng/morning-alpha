CREATE OR REPLACE FUNCTION vnext_runtime.validate_daily_ai_financial_refresh_issuer_ir_v1(p_base_inputs jsonb, p_inputs jsonb, p_refresh jsonb, p_cutoff timestamp with time zone, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r vnext_private.verified_issuer_ir_facts_v1;registered jsonb;old_facts jsonb;new_facts jsonb;
 old_stripped jsonb;new_stripped jsonb;expected jsonb;prior jsonb;projected jsonb;provided boolean;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'ISSUER_IR_INPUT_SCOPE';end if;
 provided:=coalesce(p_refresh?'issuer_ir_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into old_facts
  from jsonb_array_elements(p_base_inputs)i,lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_issuer_ir_direct_fact_v1(f);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into new_facts
  from jsonb_array_elements(p_inputs)i,lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_issuer_ir_direct_fact_v1(f);
 if not provided and old_facts='[]'::jsonb and new_facts='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);end if;
 select * into strict r from vnext_private.verified_issuer_ir_facts_v1 where source_seal_sha256='f4ea34657aa08d4e9db61bb45851510fe1aaa97193ca592a8c983be3ff4c4b32';
 select jsonb_agg(f order by (f->>'id') collate "C") into registered from jsonb_array_elements(r.facts_text::jsonb)f;
 if p_cutoff is null or not isfinite(p_cutoff)
  or old_facts<>'[]'::jsonb and old_facts is distinct from registered or new_facts is distinct from registered
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
   where vnext_runtime.is_issuer_ir_direct_fact_v1(f) and (i->>'symbol' is distinct from f->>'symbol' or i->>'symbol' not in('2454','2379')))
  or exists(select from jsonb_array_elements(registered)f where (f->>'available_at')::timestamptz>p_cutoff
   or (f->>'first_seen_at')::timestamptz>p_cutoff or (f->>'as_of')::timestamptz>p_cutoff)
  then raise exception 'ISSUER_IR_FACT_DRIFT';end if;
 expected:=jsonb_build_object('schema','DAILY_AI_ISSUER_IR_REPLAY_V1','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'fact_ids',(select jsonb_agg(f->>'id' order by (f->>'id') collate "C") from jsonb_array_elements(registered)f),
  'source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if provided and p_refresh->'issuer_ir_replay' is distinct from expected
  or not provided and old_facts='[]'::jsonb then raise exception 'ISSUER_IR_PROOF_REQUIRED_OR_DRIFT';end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not vnext_runtime.is_issuer_ir_direct_fact_v1(f.value))) order by i.ordinality)
 into old_stripped from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not vnext_runtime.is_issuer_ir_direct_fact_v1(f.value))) order by i.ordinality)
 into new_stripped from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 prior:=vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2(old_stripped,new_stripped,
  case when p_refresh is null then null else p_refresh-'issuer_ir_replay' end,p_cutoff,p_business_date);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into projected
  from jsonb_array_elements(vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs))i,
  lateral jsonb_array_elements(i->'facts')f where vnext_runtime.is_issuer_ir_direct_fact_v1(f);
 if projected is distinct from registered then raise exception 'ISSUER_IR_PROJECTION_TRUNCATED';end if;
 return prior||jsonb_build_object('issuer_ir_replay',expected);
end $function$
