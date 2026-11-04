CREATE OR REPLACE FUNCTION vnext_runtime.validate_daily_ai_financial_refresh_issuer16_v1(p_base_inputs jsonb, p_inputs jsonb, p_refresh jsonb, p_cutoff timestamp with time zone, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r vnext_private.verified_issuer16_facts_v1;registered jsonb;registered_ids jsonb;old_facts jsonb;new_facts jsonb;
 old_stripped jsonb;new_stripped jsonb;expected jsonb;prior jsonb;projected jsonb;provided boolean;
 required26 jsonb;scope jsonb;actual26 jsonb;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or (select count(distinct i->>'symbol') from jsonb_array_elements(p_base_inputs)i)<>72
  or (select count(distinct i->>'symbol') from jsonb_array_elements(p_inputs)i)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'ISSUER16_INPUT_SCOPE';end if;
 select * into strict r from vnext_private.verified_issuer16_facts_v1 where source_seal_sha256='968c404b486b359339ae55710d089970c9da78c163d4af856a8dae269705e0c1';
 select jsonb_agg(f order by (f->>'id') collate "C"),jsonb_agg(f->>'id' order by (f->>'id') collate "C")
  into registered,registered_ids from jsonb_array_elements(r.facts_text::jsonb)f;
 provided:=coalesce(p_refresh?'issuer16_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into old_facts
  from jsonb_array_elements(p_base_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into new_facts
  from jsonb_array_elements(p_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 if not provided and old_facts='[]'::jsonb and new_facts='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);end if;
 -- Native16 never creates a zero-issuer or standalone model-readable SOURCE route.
 if not exists(select from vnext_private.verified_issuer_ir_facts_v1 x where
   x.source_seal_sha256='f4ea34657aa08d4e9db61bb45851510fe1aaa97193ca592a8c983be3ff4c4b32'
   and x.facts_sha256='feda7f3fd3dc513e30c62c6e398cd4d915178a11a3a52cf3c71f7cbfc435c36e'
   and encode(sha256(convert_to(x.facts_text,'UTF8')),'hex')=x.facts_sha256
   and jsonb_array_length(x.facts_text::jsonb)=14 and x.ingestion_verified and not x.source_admitted and not x.member_publication_approved)
  or not exists(select from vnext_private.verified_umc_ir_facts_v1 x where
   x.source_seal_sha256='fd579e5d06f89ff3e3d84aba9cf532e7839e79b1984841906387cc9b04ac5ccc'
   and x.facts_sha256='294e037c75a35ae1ab272540685bede596c92c2f7677007c10c3d0bca0ed346b'
   and encode(sha256(convert_to(x.facts_text,'UTF8')),'hex')=x.facts_sha256
   and jsonb_array_length(x.facts_text::jsonb)=12 and x.ingestion_verified and not x.source_admitted and not x.member_publication_approved)
  then raise exception 'ISSUER16_REQUIRED_26_REGISTRY';end if;
 select jsonb_agg(f order by (f->>'id') collate "C") into required26 from(
  select f from vnext_private.verified_issuer_ir_facts_v1 x,lateral jsonb_array_elements(x.facts_text::jsonb)f
   where x.source_seal_sha256='f4ea34657aa08d4e9db61bb45851510fe1aaa97193ca592a8c983be3ff4c4b32'
  union all select f from vnext_private.verified_umc_ir_facts_v1 x,lateral jsonb_array_elements(x.facts_text::jsonb)f
   where x.source_seal_sha256='fd579e5d06f89ff3e3d84aba9cf532e7839e79b1984841906387cc9b04ac5ccc')all_required;
 for scope in select p_base_inputs union all select p_inputs loop
  select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into actual26
   from jsonb_array_elements(scope)i,lateral jsonb_array_elements(i->'facts')f
   where starts_with(f->>'id','issuer-ir-direct:') or starts_with(f->>'id','umc-ir-direct:');
  if jsonb_array_length(required26) is distinct from 26 or actual26 is distinct from required26
   or exists(select from jsonb_array_elements(scope)i,lateral jsonb_array_elements(i->'facts')f
    where (starts_with(f->>'id','issuer-ir-direct:') or starts_with(f->>'id','umc-ir-direct:')) and i->>'symbol' is distinct from f->>'symbol')
   then raise exception 'ISSUER16_REQUIRED_COMPLETE_26';end if;
 end loop;
 if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff<r.registry_cutoff
  or old_facts<>'[]'::jsonb and old_facts is distinct from registered or new_facts is distinct from registered
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
   where registered_ids ? (f->>'id') and i->>'symbol' is distinct from f->>'symbol')
  or exists(select from jsonb_array_elements(registered)f where f->>'symbol' not in('3006','3711')
   or f->>'kind' not in('EPS','MARGIN') or f->>'basis' is distinct from 'SINGLE_QUARTER'
   or f->>'as_of_basis' is distinct from 'FINANCIAL_PERIOD_END_NOT_PUBLICATION'
   or f->>'normalizer_version' is distinct from 'ISSUER16_NATIVE_FINANCIALS_V1'
   or f->'source_admitted' is distinct from 'false'::jsonb or f->'member_publication_approved' is distinct from 'false'::jsonb
   or f->>'period' not in('2025-Q4','2026-Q1','2026-Q2','2026-Q3')
   or (f->>'available_at')::timestamptz>p_cutoff or (f->>'first_seen_at')::timestamptz>p_cutoff or (f->>'as_of')::timestamptz>p_cutoff
   or f->>'kind'='EPS' and (f->'values'->>'measurement_basis' is distinct from 'BASIC' or f->'values'->>'unit' is distinct from 'TWD_PER_COMMON_SHARE')
   or f->>'kind'='MARGIN' and (f->'values'->>'unit' is distinct from 'PERCENT'
    or f->'values'->>'measurement_basis' not in('DIRECTLY_REPORTED_GROSS_MARGIN','CALCULATED_GROSS_MARGIN_FROM_SAME_QUARTER_REPORTED_AMOUNTS')))
  then raise exception 'ISSUER16_FACT_DRIFT';end if;
 expected:=jsonb_build_object('schema','DAILY_AI_ISSUER16_IR_REPLAY_V1','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'fact_ids',registered_ids,'source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if provided and p_refresh->'issuer16_replay' is distinct from expected or not provided and old_facts='[]'::jsonb
  then raise exception 'ISSUER16_PROOF_REQUIRED_OR_DRIFT';end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not(registered_ids ? (f.value->>'id')))) order by i.ordinality)
 into old_stripped from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not(registered_ids ? (f.value->>'id')))) order by i.ordinality)
 into new_stripped from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 prior:=vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(old_stripped,new_stripped,
  case when p_refresh is null then null else p_refresh-'issuer16_replay' end,p_cutoff,p_business_date);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into projected
  from jsonb_array_elements(vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs))i,
  lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 if projected is distinct from registered then raise exception 'ISSUER16_PROJECTION_TRUNCATED';end if;
 return prior||jsonb_build_object('issuer16_replay',expected);
end $function$
