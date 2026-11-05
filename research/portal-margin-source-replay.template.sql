-- PRIVATE CANDIDATE. Exact selected observed portal ratios, not direct issuer percents.
-- Requires the full original26 quarantine and exact23 incoming native margins.
-- A first refresh's old native margins may be an exact subset of these23;
-- an existing portal replay requires the complete23 on both sides.
-- SOURCE-only: no original registry/COMPLETE/model/member/reader changes.
-- All270 original observations remain in the private source ledger. Only the
-- sealed, unique-quarter consolidated selection enters these SOURCE inputs.
-- Existing native quarters take priority; original per-kind4 quotas are unchanged.
-- The unchanged projection is checked, not patched: truncation MUST fail closed.
begin;
do $guard$
begin
 if to_regclass('vnext_private.verified_portal_margin_facts_v1') is not null
  or to_regprocedure('public.load_daily_stock_ai_portal_margin_replay_v1(text,timestamptz)') is not null
  or to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_portal_margin_v1(jsonb,jsonb,jsonb,timestamptz,date)') is not null
  then raise exception 'PORTAL_MARGIN_REPLAY_ALREADY_PRESENT';end if;
 if encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)')),'UTF8')),'hex')
   is distinct from '__SOURCE_RPC_BASELINE_SHA256__'
  or to_regprocedure('vnext_runtime.validate_daily_ai_financial_refresh_issuer16_v1(jsonb,jsonb,jsonb,timestamptz,date)') is null
  or to_regprocedure('vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(jsonb)') is null
  then raise exception 'PORTAL_MARGIN_REPLAY_BASELINE_DRIFT';end if;
end $guard$;

create table vnext_private.verified_portal_margin_facts_v1(
 source_seal_sha256 text primary key check(source_seal_sha256='__SOURCE_SEAL__'),
 facts_sha256 text not null check(facts_sha256='__FACTS_HASH__'),
 registry_cutoff timestamptz not null check(registry_cutoff='__REGISTRY_CUTOFF__'::timestamptz),
 facts_text text not null check(encode(sha256(convert_to(facts_text,'UTF8')),'hex')=facts_sha256
  and jsonb_typeof(facts_text::jsonb)='array' and jsonb_array_length(facts_text::jsonb)=__FACT_COUNT__),
 required_native_margins_sha256 text not null check(required_native_margins_sha256='__REQUIRED_NATIVE_MARGINS_SHA256__'),
 required_native_margins_text text not null check(
  encode(sha256(convert_to(required_native_margins_text,'UTF8')),'hex')=required_native_margins_sha256
  and jsonb_typeof(required_native_margins_text::jsonb)='array'
  and jsonb_array_length(required_native_margins_text::jsonb)=23),
 ingestion_verified boolean not null default true check(ingestion_verified),
 source_admitted boolean not null default false check(not source_admitted),
 member_publication_approved boolean not null default false check(not member_publication_approved)
);
alter table vnext_private.verified_portal_margin_facts_v1 enable row level security;
alter table vnext_private.verified_portal_margin_facts_v1 force row level security;
revoke all on vnext_private.verified_portal_margin_facts_v1 from public,anon,authenticated,service_role;
create function vnext_private.seal_verified_portal_margin_facts_v1() returns trigger
language plpgsql set search_path='' as $fn$
begin raise exception 'PORTAL_MARGIN_REGISTRY_IMMUTABLE';end $fn$;
revoke all on function vnext_private.seal_verified_portal_margin_facts_v1() from public,anon,authenticated,service_role;
create trigger seal_verified_portal_margin_facts_v1 before update or delete or truncate
 on vnext_private.verified_portal_margin_facts_v1 for each statement
 execute function vnext_private.seal_verified_portal_margin_facts_v1();
insert into vnext_private.verified_portal_margin_facts_v1(
 source_seal_sha256,facts_sha256,registry_cutoff,facts_text,
 required_native_margins_sha256,required_native_margins_text)
 values('__SOURCE_SEAL__','__FACTS_HASH__','__REGISTRY_CUTOFF__',$portal_margin_facts$__FACTS_TEXT__$portal_margin_facts$,
 '__REQUIRED_NATIVE_MARGINS_SHA256__',$portal_margin_native$__REQUIRED_NATIVE_MARGINS_TEXT__$portal_margin_native$);

create function public.load_daily_stock_ai_portal_margin_replay_v1(p_source_seal text,p_cutoff timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare r vnext_private.verified_portal_margin_facts_v1;
begin
 if p_source_seal is distinct from '__SOURCE_SEAL__' or p_cutoff is null or not isfinite(p_cutoff)
  then raise exception 'PORTAL_MARGIN_REGISTRY_SCOPE';end if;
 select * into strict r from vnext_private.verified_portal_margin_facts_v1 where source_seal_sha256=p_source_seal;
 if p_cutoff<r.registry_cutoff or exists(select from jsonb_array_elements(r.facts_text::jsonb)f
  where f->>'available_at' is null or f->>'first_seen_at' is null or f->>'as_of' is null
   or f->>'source_received_at' is null
   or not isfinite((f->>'available_at')::timestamptz) or not isfinite((f->>'first_seen_at')::timestamptz)
   or not isfinite((f->>'as_of')::timestamptz) or not isfinite((f->>'source_received_at')::timestamptz)
   or (f->>'available_at')::timestamptz>p_cutoff or (f->>'first_seen_at')::timestamptz>p_cutoff
   or (f->>'as_of')::timestamptz>p_cutoff or (f->>'source_received_at')::timestamptz>p_cutoff)
  then raise exception 'PORTAL_MARGIN_FUTURE_RECEIPT';end if;
 return jsonb_build_object('schema','DAILY_AI_PORTAL_MARGIN_REGISTRY_V1','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'registry_cutoff',to_char(r.registry_cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'facts',r.facts_text::jsonb,'required_native_margins_sha256',r.required_native_margins_sha256,
  'required_native_margins',r.required_native_margins_text::jsonb,
  'source_admitted',false,'member_publication_approved',false);
end $fn$;
revoke all on function public.load_daily_stock_ai_portal_margin_replay_v1(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.load_daily_stock_ai_portal_margin_replay_v1(text,timestamptz) to service_role;

create function vnext_runtime.validate_daily_ai_financial_refresh_portal_margin_v1(
 p_base_inputs jsonb,p_inputs jsonb,p_refresh jsonb,p_cutoff timestamptz,p_business_date date)
returns jsonb language plpgsql stable set search_path='' as $fn$
declare r vnext_private.verified_portal_margin_facts_v1;registered jsonb;registered_ids jsonb;old_facts jsonb;new_facts jsonb;
 old_stripped jsonb;new_stripped jsonb;expected jsonb;prior jsonb;projected jsonb;provided boolean;
 required26 jsonb;required_native jsonb;scope jsonb;scope_index integer;actual26 jsonb;actual_native jsonb;
begin
 if jsonb_typeof(p_base_inputs) is distinct from 'array' or jsonb_array_length(p_base_inputs)<>72
  or jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs)<>72
  or (select count(distinct i->>'symbol') from jsonb_array_elements(p_base_inputs)i)<>72
  or (select count(distinct i->>'symbol') from jsonb_array_elements(p_inputs)i)<>72
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i where jsonb_typeof(i->'facts') is distinct from 'array')
  then raise exception 'PORTAL_MARGIN_INPUT_SCOPE';end if;
 select * into strict r from vnext_private.verified_portal_margin_facts_v1 where source_seal_sha256='__SOURCE_SEAL__';
 select jsonb_agg(f order by (f->>'id') collate "C"),jsonb_agg(f->>'id' order by (f->>'id') collate "C")
  into registered,registered_ids from jsonb_array_elements(r.facts_text::jsonb)f;
 provided:=coalesce(p_refresh?'portal_margin_replay',false);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into old_facts
  from jsonb_array_elements(p_base_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into new_facts
  from jsonb_array_elements(p_inputs)i,lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 -- Reserved portal types/basis never create an unregistered context route.
 -- Stripping later is by fixed IDs only; unrelated/unknown facts reach prior validation unchanged.
 if exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
  where (f->>'kind' in('PORTAL_MARGIN_COMPARISON','PORTAL_MARGIN_INDIVIDUAL')
   or f->'values'->>'measurement_basis'='OFFICIAL_PORTAL_CALCULATED_GROSS_MARGIN')
   and not coalesce(registered_ids ? (f->>'id'),false))
  then raise exception 'PORTAL_MARGIN_UNREGISTERED_FACT';end if;
 if not provided and old_facts='[]'::jsonb and new_facts='[]'::jsonb then
  return vnext_runtime.validate_daily_ai_financial_refresh_issuer16_v1(p_base_inputs,p_inputs,p_refresh,p_cutoff,p_business_date);end if;
 if p_refresh is not null and jsonb_typeof(p_refresh) is distinct from 'object'
  then raise exception 'PORTAL_MARGIN_PROOF_SCOPE';end if;

 -- Recheck the full26 independently: the new outer wrapper may not rely on
 -- a prior validator's legacy no-native branch to imply quarantine completeness.
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
  then raise exception 'PORTAL_MARGIN_REQUIRED_26_REGISTRY';end if;
 select jsonb_agg(f order by (f->>'id') collate "C") into required26 from(
  select f from vnext_private.verified_issuer_ir_facts_v1 x,lateral jsonb_array_elements(x.facts_text::jsonb)f
   where x.source_seal_sha256='f4ea34657aa08d4e9db61bb45851510fe1aaa97193ca592a8c983be3ff4c4b32'
  union all select f from vnext_private.verified_umc_ir_facts_v1 x,lateral jsonb_array_elements(x.facts_text::jsonb)f
   where x.source_seal_sha256='fd579e5d06f89ff3e3d84aba9cf532e7839e79b1984841906387cc9b04ac5ccc')all_required;
 select jsonb_agg(f order by (f->>'id') collate "C") into required_native from jsonb_array_elements(r.required_native_margins_text::jsonb)f;
 for scope_index in 1..2 loop
  scope:=case when scope_index=1 then p_base_inputs else p_inputs end;
  select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into actual26
   from jsonb_array_elements(scope)i,lateral jsonb_array_elements(i->'facts')f
   where starts_with(f->>'id','issuer-ir-direct:') or starts_with(f->>'id','umc-ir-direct:');
  if jsonb_array_length(required26) is distinct from 26 or actual26 is distinct from required26
   or exists(select from jsonb_array_elements(scope)i,lateral jsonb_array_elements(i->'facts')f
    where (starts_with(f->>'id','issuer-ir-direct:') or starts_with(f->>'id','umc-ir-direct:')) and i->>'symbol' is distinct from f->>'symbol')
   then raise exception 'PORTAL_MARGIN_REQUIRED_COMPLETE_26';end if;
  -- All nonregistered MARGIN facts are pinned, not just a known namespace.
  -- First refresh may add native16 through the existing prior wrapper, so old
  -- margins may be an exact subset. Incoming and replay margins require all23.
  -- Revisions, extra native rows, swaps and duplicate old rows fail closed.
  select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into actual_native
   from jsonb_array_elements(scope)i,lateral jsonb_array_elements(i->'facts')f
   where f->>'kind'='MARGIN' and not coalesce(registered_ids ? (f->>'id'),false);
  if jsonb_array_length(required_native) is distinct from 23
   or (scope_index=2 or old_facts<>'[]'::jsonb) and actual_native is distinct from required_native
   or scope_index=1 and old_facts='[]'::jsonb and (
    (select count(distinct f->>'id') from jsonb_array_elements(actual_native)f)<>jsonb_array_length(actual_native)
    or exists(select from jsonb_array_elements(actual_native)f
     where not exists(select from jsonb_array_elements(required_native)rf where rf=f)))
   or exists(select from jsonb_array_elements(scope)i,lateral jsonb_array_elements(i->'facts')f
    where f->>'kind'='MARGIN' and not coalesce(registered_ids ? (f->>'id'),false) and i->>'symbol' is distinct from f->>'symbol')
   then raise exception 'PORTAL_MARGIN_REQUIRED_NATIVE_CONTEXT';end if;
 end loop;

 if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff<r.registry_cutoff
  or r.ingestion_verified is distinct from true or r.source_admitted is distinct from false
  or r.member_publication_approved is distinct from false
  or encode(sha256(convert_to(r.facts_text,'UTF8')),'hex') is distinct from r.facts_sha256
  or encode(sha256(convert_to(r.required_native_margins_text,'UTF8')),'hex') is distinct from r.required_native_margins_sha256
  or (select count(distinct f->>'id') from jsonb_array_elements(registered)f)<>__FACT_COUNT__
  or (select count(distinct(f->>'symbol',f->>'period')) from jsonb_array_elements(registered)f)<>__FACT_COUNT__
  or (select count(*) from jsonb_array_elements(registered)f where f->>'kind'='MARGIN')<>__FACT_COUNT__
  or (select count(distinct f->>'id') from jsonb_array_elements(required_native)f)<>23
  or exists(select from jsonb_array_elements(required_native)f where f->>'kind' is distinct from 'MARGIN')
  or exists(select from jsonb_array_elements(registered)f,jsonb_array_elements(required_native)nf
   where f->>'symbol'=nf->>'symbol' and f->>'period'=nf->>'period')
  or old_facts<>'[]'::jsonb and old_facts is distinct from registered or new_facts is distinct from registered
  or exists(select from jsonb_array_elements(p_base_inputs||p_inputs)i,lateral jsonb_array_elements(i->'facts')f
   where registered_ids ? (f->>'id') and i->>'symbol' is distinct from f->>'symbol')
  or exists(select from jsonb_array_elements(registered)f where f->>'source' is distinct from 'https://mopsfin.twse.com.tw/compare/data'
   or f->>'kind' is distinct from 'MARGIN'
   or f->>'basis' is distinct from 'SINGLE_QUARTER' or f->'values'->>'unit' is distinct from 'PERCENT'
   or f->'values'->>'measurement_basis' is distinct from 'OFFICIAL_PORTAL_CALCULATED_GROSS_MARGIN'
   or f->'source_admitted' is distinct from 'false'::jsonb or f->'member_publication_approved' is distinct from 'false'::jsonb
   or f->'published_at' is distinct from 'null'::jsonb
   or f->>'period' not in('2025-Q3','2025-Q4','2026-Q1','2026-Q2','2026-Q3')
   or f->>'available_at' is null or f->>'first_seen_at' is null or f->>'as_of' is null or f->>'source_received_at' is null
   or not isfinite((f->>'available_at')::timestamptz) or not isfinite((f->>'first_seen_at')::timestamptz)
   or not isfinite((f->>'as_of')::timestamptz) or not isfinite((f->>'source_received_at')::timestamptz)
   or (f->>'available_at')::timestamptz>p_cutoff or (f->>'first_seen_at')::timestamptz>p_cutoff
   or (f->>'as_of')::timestamptz>p_cutoff or (f->>'source_received_at')::timestamptz>p_cutoff
   or (f->>'first_seen_at')::timestamptz>(f->>'available_at')::timestamptz
   or (f->>'source_received_at')::timestamptz>(f->>'available_at')::timestamptz
   or f->'values'->>'consolidation' is distinct from 'CONSOLIDATED')
  then raise exception 'PORTAL_MARGIN_FACT_DRIFT';end if;
 expected:=jsonb_build_object('schema','DAILY_AI_PORTAL_MARGIN_REPLAY_V1','source_seal_sha256',r.source_seal_sha256,
  'facts_sha256',r.facts_sha256,'fact_ids',registered_ids,'required_native_margins_sha256',r.required_native_margins_sha256,
  'source_refetched',false,'source_admitted',false,'member_publication_approved',false);
 if provided and p_refresh->'portal_margin_replay' is distinct from expected or not provided and old_facts='[]'::jsonb
  then raise exception 'PORTAL_MARGIN_PROOF_REQUIRED_OR_DRIFT';end if;
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not coalesce(registered_ids ? (f.value->>'id'),false))) order by i.ordinality)
 into old_stripped from jsonb_array_elements(p_base_inputs) with ordinality i(value,ordinality);
 select jsonb_agg(i.value||jsonb_build_object('facts',(
  select coalesce(jsonb_agg(f.value order by f.ordinality),'[]') from jsonb_array_elements(i.value->'facts') with ordinality f(value,ordinality)
  where not coalesce(registered_ids ? (f.value->>'id'),false))) order by i.ordinality)
 into new_stripped from jsonb_array_elements(p_inputs) with ordinality i(value,ordinality);
 prior:=vnext_runtime.validate_daily_ai_financial_refresh_issuer16_v1(old_stripped,new_stripped,
  case when p_refresh is null then null else p_refresh-'portal_margin_replay' end,p_cutoff,p_business_date);
 select coalesce(jsonb_agg(f order by (f->>'id') collate "C"),'[]') into projected
  from jsonb_array_elements(vnext_runtime.project_daily_stock_ai_inputs_reviews_v2(p_inputs))i,
  lateral jsonb_array_elements(i->'facts')f where registered_ids ? (f->>'id');
 if projected is distinct from registered then raise exception 'PORTAL_MARGIN_PROJECTION_TRUNCATED';end if;
 return prior||jsonb_build_object('portal_margin_replay',expected);
end $fn$;
revoke all on function vnext_runtime.validate_daily_ai_financial_refresh_portal_margin_v1(jsonb,jsonb,jsonb,timestamptz,date)
 from public,anon,authenticated,service_role;

do $patch$
declare d text;needle constant text:='vnext_runtime.validate_daily_ai_financial_refresh_issuer16_v1(';
begin
 d:=pg_get_functiondef(to_regprocedure('public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)'));
 if encode(sha256(convert_to(d,'UTF8')),'hex') is distinct from '__SOURCE_RPC_BASELINE_SHA256__'
  or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'PORTAL_MARGIN_SOURCE_CALLSITE_DRIFT';end if;
 execute replace(d,needle,'vnext_runtime.validate_daily_ai_financial_refresh_portal_margin_v1(');
end $patch$;
commit;
