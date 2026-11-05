-- OFFLINE CANDIDATE: unexecuted; do not apply without independent review.
-- The live immutable input retains its own observed time; no registry replay.
begin;
do $baseline$ declare p pg_catalog.pg_proc; begin
 select * into strict p from pg_catalog.pg_proc where oid='vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)'::regprocedure;
 if encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') is distinct from 'c6aa315d3d957dfea4126af5b126255ce1b9a9eb3826f475e4f7c3e084808d59'
 or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef
 or p.proconfig is distinct from array['search_path=""']::text[]
 or p.proacl::text is distinct from '{postgres=X/postgres}' then
  raise exception 'INSTITUTIONAL_VALIDATOR_BASELINE_DRIFT';end if;
end $baseline$;
create or replace function vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(
 p_base_inputs jsonb,p_inputs jsonb,p_refresh jsonb,p_cutoff timestamptz,p_business_date date)
returns jsonb language plpgsql stable set search_path='' as $fn$
declare r vnext_private.verified_institutional_facts_20261029_30_v1;registered jsonb;registered_ids jsonb;
 old_facts jsonb;new_facts jsonb;old_stripped jsonb;new_stripped jsonb;expected jsonb;prior jsonb;projected jsonb;provided boolean;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or (select count(distinct i->>'symbol') from jsonb_array_elements(p_base_inputs)i)<>72
  or (select count(distinct i->>'symbol') from jsonb_array_elements(p_inputs)i)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'INSTITUTIONAL_INPUT_SCOPE';end if;
 select * into strict r from vnext_private.verified_institutional_facts_20261029_30_v1
  where source_seal_sha256='322a73e452f1f5c25561925d87cb37500f1f6bacb832d84cfd1f8a822e8ef3c8';
 select jsonb_agg(f order by (f->>'id') collate "C"),jsonb_agg(f->>'id' order by (f->>'id') collate "C")
  into registered,registered_ids from jsonb_array_elements(r.facts_text::jsonb)f;
 provided:=coalesce(p_refresh?'institutional_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into old_facts
  from jsonb_array_elements(p_base_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into new_facts
  from jsonb_array_elements(p_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 -- Candidate only: distinct observation of identical official rows. Do not
 -- replace a receipt, promote a source, or manufacture replay proof. The
 -- ordinary lower validator still checks the entire unchanged base projection.
 if not provided and old_facts <> '[]'::jsonb and old_facts is distinct from registered then
  if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff<r.registry_cutoff
   or r.ingestion_verified is distinct from true or r.source_admitted is distinct from false
   or r.member_publication_approved is distinct from false
   or encode(sha256(convert_to(r.facts_text,'UTF8')),'hex') is distinct from r.facts_sha256
   or exists(select from jsonb_array_elements(registered)f where f->>'kind' is distinct from 'INSTITUTIONAL'
    or f->>'basis' is distinct from 'SHARES' or f->>'unit' is distinct from 'SHARES'
    or f->'not_currency' is distinct from 'true'::jsonb or f->'source_admitted' is distinct from 'false'::jsonb
    or f->'member_publication_approved' is distinct from 'false'::jsonb
    or f->>'period' not in('2026-10-29','2026-10-30')
    or (f->>'available_at')::timestamptz>p_cutoff or (f->>'first_seen_at')::timestamptz>p_cutoff
    or (f->>'as_of')::timestamptz>p_cutoff)
   or old_facts is distinct from new_facts
   or jsonb_array_length(old_facts)<>jsonb_array_length(registered)
   or (select count(distinct f->>'id') from jsonb_array_elements(old_facts)f)<>jsonb_array_length(registered)
   or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
     where registered_ids ? (f->>'id') and i->>'symbol' is distinct from f->>'symbol')
   or exists(select from jsonb_array_elements(old_facts)o
      left join lateral (select f from jsonb_array_elements(registered)f where f->>'id'=o->>'id')r0 on true
      where r0.f is null
       or o ?| array['unit','not_currency','source_admitted','member_publication_approved','source_received_at','source_sha256','source_bytes','source_locator']
       or (o - array['first_seen_at','available_at','source_received_at','source_sha256','source_bytes','source_locator','unit','not_currency','source_admitted','member_publication_approved'])
          is distinct from
          (r0.f - array['first_seen_at','available_at','source_received_at','source_sha256','source_bytes','source_locator','unit','not_currency','source_admitted','member_publication_approved'])
       or (o->>'as_of')::timestamptz>(o->>'first_seen_at')::timestamptz
       or (o->>'first_seen_at')::timestamptz>(o->>'available_at')::timestamptz
       or (o->>'available_at')::timestamptz>p_cutoff
       or o->>'first_seen_at' is null or o->>'available_at' is null or o->>'as_of' is null)
    then raise exception 'INSTITUTIONAL_EXISTING_CAPTURE_DRIFT';end if;
  select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into projected
   from jsonb_array_elements(vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs))i,
   lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
  if projected is distinct from old_facts then raise exception 'INSTITUTIONAL_PROJECTION_TRUNCATED';end if;
  return vnext_runtime.validate_daily_ai_financial_refresh_umc_ir_v1(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);
 end if;
 if not provided and old_facts='[]'::jsonb and new_facts='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_umc_ir_v1(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);end if;
 if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff<r.registry_cutoff
  or r.ingestion_verified is distinct from true or r.source_admitted is distinct from false
  or r.member_publication_approved is distinct from false
  or encode(sha256(convert_to(r.facts_text,'UTF8')),'hex') is distinct from r.facts_sha256
  or old_facts<>'[]'::jsonb and old_facts is distinct from registered or new_facts is distinct from registered
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
   where registered_ids ? (f->>'id') and i->>'symbol' is distinct from f->>'symbol')
  or exists(select from jsonb_array_elements(registered)f where f->>'kind' is distinct from 'INSTITUTIONAL'
   or f->>'basis' is distinct from 'SHARES' or f->>'unit' is distinct from 'SHARES'
   or f->'not_currency' is distinct from 'true'::jsonb or f->'source_admitted' is distinct from 'false'::jsonb
   or f->'member_publication_approved' is distinct from 'false'::jsonb
   or f->>'period' not in('2026-10-29','2026-10-30')
   or (f->>'available_at')::timestamptz>p_cutoff or (f->>'first_seen_at')::timestamptz>p_cutoff
   or (f->>'as_of')::timestamptz>p_cutoff)
  then raise exception 'INSTITUTIONAL_FACT_DRIFT';end if;
 expected:=jsonb_build_object('schema','DAILY_AI_OFFICIAL_INSTITUTIONAL_REPLAY_V1','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'fact_ids',registered_ids,
  'source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if provided and p_refresh->'institutional_replay' is distinct from expected
  or not provided and old_facts='[]'::jsonb then raise exception 'INSTITUTIONAL_PROOF_REQUIRED_OR_DRIFT';end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not(registered_ids ? (f.value->>'id')))) order by i.ordinality)
 into old_stripped from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not(registered_ids ? (f.value->>'id')))) order by i.ordinality)
 into new_stripped from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 prior:=vnext_runtime.validate_daily_ai_financial_refresh_umc_ir_v1(old_stripped,new_stripped,
  case when p_refresh is null then null else p_refresh-'institutional_replay' end,p_cutoff,p_business_date);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into projected
  from jsonb_array_elements(vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs))i,
  lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 if projected is distinct from registered then raise exception 'INSTITUTIONAL_PROJECTION_TRUNCATED';end if;
 return prior||jsonb_build_object('institutional_replay',expected);
end $fn$;
do $verify$ declare p pg_catalog.pg_proc; begin
 select * into strict p from pg_catalog.pg_proc where oid='vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)'::regprocedure;
 if encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') is distinct from 'f5d0235827dda68d85fafe050e8b462b4be2bc94d5b3938b5789d3e94c5e180b'
 or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' or p.prosecdef
 or p.proconfig is distinct from array['search_path=""']::text[]
 or p.proacl::text is distinct from '{postgres=X/postgres}' then raise exception 'INSTITUTIONAL_VALIDATOR_CANDIDATE_DRIFT';end if;
end $verify$;
commit;
