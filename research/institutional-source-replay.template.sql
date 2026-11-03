-- PRIVATE CANDIDATE. Exact144 institutional share observations; no commercial/model/member grant.
-- Does not modify old batches, 14/12 issuer registries/validators or quarantine COMPLETE predicate.
begin;
do $guard$
begin
 if to_regclass('vnext_private.verified_institutional_facts_20261029_30_v1') is not null
  or to_regprocedure('public.load_daily_stock_ai_institutional_replay_v1(text,timestamptz)') is not null
  then raise exception 'INSTITUTIONAL_REPLAY_ALREADY_PRESENT';end if;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)')),'UTF8')),'hex')
  is distinct from '__SOURCE_RPC_BASELINE_SHA256__'
  or encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb)')),'UTF8')),'hex')
  is distinct from '__PROJECTION_BASELINE_SHA256__'
  then raise exception 'INSTITUTIONAL_REPLAY_BASELINE_DRIFT';end if;
end $guard$;

create table vnext_private.verified_institutional_facts_20261029_30_v1(
 source_seal_sha256 text primary key check(source_seal_sha256='__SOURCE_SEAL__'),
 facts_sha256 text not null check(facts_sha256='__FACTS_HASH__'),
 registry_cutoff timestamptz not null check(registry_cutoff='__REGISTRY_CUTOFF__'::timestamptz),
 facts_text text not null check(encode(sha256(convert_to(facts_text,'UTF8')),'hex')=facts_sha256
  and jsonb_typeof(facts_text::jsonb)='array' and jsonb_array_length(facts_text::jsonb)=144),
 ingestion_verified boolean not null default true check(ingestion_verified),
 source_admitted boolean not null default false check(not source_admitted),
 member_publication_approved boolean not null default false check(not member_publication_approved)
);
alter table vnext_private.verified_institutional_facts_20261029_30_v1 enable row level security;
alter table vnext_private.verified_institutional_facts_20261029_30_v1 force row level security;
revoke all on vnext_private.verified_institutional_facts_20261029_30_v1 from public,anon,authenticated,service_role;
create function vnext_private.seal_verified_institutional_facts_v1() returns trigger
language plpgsql set search_path='' as $fn$
begin raise exception 'INSTITUTIONAL_REGISTRY_IMMUTABLE';end $fn$;
revoke all on function vnext_private.seal_verified_institutional_facts_v1() from public,anon,authenticated,service_role;
create trigger seal_verified_institutional_facts_v1 before update or delete or truncate
 on vnext_private.verified_institutional_facts_20261029_30_v1 for each statement
 execute function vnext_private.seal_verified_institutional_facts_v1();
insert into vnext_private.verified_institutional_facts_20261029_30_v1(source_seal_sha256,facts_sha256,registry_cutoff,facts_text)
 values('__SOURCE_SEAL__','__FACTS_HASH__','__REGISTRY_CUTOFF__',$institutional_facts$__FACTS_TEXT__$institutional_facts$);

-- IDs are the original audited INSTITUTIONAL-<hash>, not a new relabelled namespace.
-- The table's fixed canonical facts hash is checked again before exposing it to SOURCE.
create function public.load_daily_stock_ai_institutional_replay_v1(p_source_seal text,p_cutoff timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare r vnext_private.verified_institutional_facts_20261029_30_v1;
begin
 if p_source_seal is distinct from '__SOURCE_SEAL__' or p_cutoff is null or not isfinite(p_cutoff)
  then raise exception 'INSTITUTIONAL_REGISTRY_SCOPE';end if;
 select * into strict r from vnext_private.verified_institutional_facts_20261029_30_v1 where source_seal_sha256=p_source_seal;
 if p_cutoff<r.registry_cutoff or exists(select from jsonb_array_elements(r.facts_text::jsonb)f
  where (f->>'available_at')::timestamptz>p_cutoff or (f->>'first_seen_at')::timestamptz>p_cutoff
   or (f->>'as_of')::timestamptz>p_cutoff) then raise exception 'INSTITUTIONAL_FUTURE_RECEIPT';end if;
 return jsonb_build_object('schema','DAILY_AI_OFFICIAL_INSTITUTIONAL_REGISTRY_V1','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'registry_cutoff',to_char(r.registry_cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'facts',r.facts_text::jsonb,'source_admitted',false,'member_publication_approved',false);
end $fn$;
revoke all on function public.load_daily_stock_ai_institutional_replay_v1(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_institutional_replay_v1(text,timestamptz) to service_role;

create function vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(
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
  where source_seal_sha256='__SOURCE_SEAL__';
 select jsonb_agg(f order by (f->>'id') collate "C"),jsonb_agg(f->>'id' order by (f->>'id') collate "C")
  into registered,registered_ids from jsonb_array_elements(r.facts_text::jsonb)f;
 provided:=coalesce(p_refresh?'institutional_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into old_facts
  from jsonb_array_elements(p_base_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into new_facts
  from jsonb_array_elements(p_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
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
revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(jsonb,jsonb,jsonb,timestamptz,date)
 from public,anon,authenticated,service_role;

do $patch$
declare d text;needle constant text:='vnext_runtime.validate_daily_ai_financial_refresh_umc_ir_v1(';
begin
 d:=pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'));
 if encode(sha256(convert_to(d,'UTF8')),'hex') is distinct from '__SOURCE_RPC_BASELINE_SHA256__'
  or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'INSTITUTIONAL_SOURCE_CALLSITE_DRIFT';end if;
 execute replace(d,needle,'vnext_runtime.validate_daily_ai_financial_refresh_institutional_v1(');
end $patch$;
commit;
