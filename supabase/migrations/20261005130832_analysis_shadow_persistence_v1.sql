-- Research-only candidate. No dispatch, business backfill, Auth/RLS policy or Cron change.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
 if (select md5(prosrc) from pg_proc where oid='public.store_research_analysis_v1(jsonb,jsonb,text,numeric)'::regprocedure)
   is distinct from '12320280c91fb29905c4d1a7bbd39c06' then raise exception 'SHADOW_PERSISTENCE_PREDECESSOR_MISMATCH'; end if;
end $guard$;
-- Mode and cutoff are part of authority; replay must never occupy a Forward slot.
do $keys$
declare k name;
begin
 select conname into strict k from pg_constraint where conrelid='public.research_daily_analysis'::regclass
   and contype='u' and pg_get_constraintdef(oid)='UNIQUE (business_date, methodology_id, methodology_version)';
 execute format('alter table public.research_daily_analysis drop constraint %I',k);
 select conname into strict k from pg_constraint where conrelid='public.research_analysis_graphs'::regclass
   and contype='u' and pg_get_constraintdef(oid)='UNIQUE (decision_snapshot_id, methodology_id, methodology_version, observation_kind)';
 execute format('alter table public.research_analysis_graphs drop constraint %I',k);
end $keys$;
alter table public.research_daily_analysis add constraint research_analysis_authority_unique
 unique(business_date,analysis_cutoff_at,methodology_id,methodology_version,observation_kind);
alter table public.research_analysis_graphs add constraint research_graph_authority_unique
 unique(decision_snapshot_id,methodology_id,methodology_version,observation_kind,evidence_as_of);
-- Separate read projections retain original rows, hashes, timestamps and RLS.
create view public.research_historical_replay_v1 with (security_invoker=true) as
 select id,business_date,analysis_cutoff_at,methodology_id,methodology_version,
 'HISTORICAL_REPLAY'::text as analysis_mode,true as not_forward,true as not_production_decision,
 created_at as replay_created_at,prediction_hash,analysis
 from public.research_daily_analysis where observation_kind='HISTORICAL_REPLAY';
create view public.research_forward_shadow_v1 with (security_invoker=true) as
 select id,business_date,analysis_cutoff_at,methodology_id,methodology_version,
 'FORWARD_SHADOW'::text as analysis_mode,created_at as locked_at,prediction_hash,analysis
 from public.research_daily_analysis where observation_kind='FORWARD';
revoke all on public.research_historical_replay_v1,public.research_forward_shadow_v1 from public,anon,authenticated,service_role;
grant select on public.research_historical_replay_v1,public.research_forward_shadow_v1 to authenticated,service_role;
create or replace function public.store_research_analysis_v1(p_input jsonb,p_previous jsonb,p_analysis_text text,p_compute_ms numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_date date:=(p_input#>>'{core,business_date}')::date; v_cutoff timestamptz:=(p_input->>'analysis_cutoff_at')::timestamptz;
  v_kind text:=p_input->>'observation_kind'; v_live jsonb; v_previous jsonb; a jsonb:=p_analysis_text::jsonb;
  v_graph uuid; v_result public.research_daily_analysis; v_hash text; v_created timestamptz:=clock_timestamp();
begin
  v_live:=public.research_analysis_input_v1(v_date,v_cutoff,v_kind);
  if v_live is distinct from p_input then raise exception 'RESEARCH_SOURCE_READSET_MISMATCH'; end if;
  if p_previous is not null then
    if v_live->>'previous_trading_day' is null then raise exception 'RESEARCH_UNEXPECTED_PREVIOUS_INPUT'; end if;
    v_previous:=public.research_analysis_input_v1((v_live->>'previous_trading_day')::date,
      (((v_live->>'previous_trading_day')::date+time '08:44:59') at time zone 'Asia/Taipei'),'HISTORICAL_REPLAY');
    if v_previous is distinct from p_previous then raise exception 'RESEARCH_PREVIOUS_READSET_MISMATCH'; end if;
  end if;
  if a#>>'{previous_comparison,contract}' is distinct from 'PREVIOUS_VALID_COMPARISON_V1'
    or a#>>'{previous_comparison,previous_trading_day}' is distinct from v_live->>'previous_trading_day' then
    raise exception 'RESEARCH_COMPARISON_CONTRACT_INVALID';
  end if;
  if a#>>'{previous_comparison,status}' = 'AVAILABLE' then
    if p_previous is null
      or a#>>'{previous_comparison,previous_comparable_evidence_day}' is distinct from v_live->>'previous_trading_day'
      or a#>>'{quality,change_detection}' is distinct from 'AVAILABLE'
      then raise exception 'RESEARCH_COMPARISON_AVAILABLE_INVALID'; end if;
  elsif a#>>'{previous_comparison,status}' = 'UNAVAILABLE' then
    if a#>>'{previous_comparison,reason}' is distinct from 'PREVIOUS_COMPARISON_UNAVAILABLE'
      or a#>>'{previous_comparison,previous_comparable_evidence_day}' is not null
      or a->'what_changed' is distinct from '[]'::jsonb
      or a#>>'{quality,change_detection}' is distinct from 'UNAVAILABLE'
      or not coalesce(a#>'{quality,missing_components}' ? 'PREVIOUS_DAY_COMPARISON',false)
      or (a#>>'{quality,evidence_coverage}')::numeric is distinct from 91.6667
      or (a#>>'{decision,confidence_components,previous_comparison_penalty}')::numeric is distinct from 5
      then raise exception 'RESEARCH_COMPARISON_UNAVAILABLE_INVALID'; end if;
  else raise exception 'RESEARCH_COMPARISON_STATUS_INVALID'; end if;
  if v_live#>>'{core,integrity,status}' is distinct from 'PASS'
    or (v_live#>>'{core,batch,committed_at}')::timestamptz>v_cutoff
    or exists(select 1 from jsonb_array_elements(v_live#>'{core,rows}') e
      where (e->>'created_at')::timestamptz>v_cutoff or (e->>'captured_at')::timestamptz>v_cutoff)
    then raise exception 'RESEARCH_TRUSTED_ASOF_CORE_REQUIRED'; end if;
  if a->>'schema_version' is distinct from 'ANALYSIS_INTELLIGENCE_V1' or a->>'mode' is distinct from 'SHADOW_ONLY'
    or a->'production_eligible' is distinct from 'false'::jsonb or (a->>'business_date')::date is distinct from v_date
    or (a->>'analysis_cutoff_at')::timestamptz is distinct from v_cutoff
    or a->>'observation_kind' is distinct from v_kind or a->>'methodology_version' is distinct from '1'
    or jsonb_array_length(a->'signals') is distinct from 11 or jsonb_array_length(a->'features') is distinct from 33
    then raise exception 'RESEARCH_OUTPUT_CONTRACT_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(a->'features') f where not exists(
      select 1 from jsonb_array_elements(v_live#>'{core,rows}') e
      where e->>'id'=f->>'source_evidence_id' and e->>'provider_key'=f->>'registry_key'
        and (f->>'observed_at')::timestamptz=(e->>'created_at')::timestamptz)) then
    raise exception 'RESEARCH_FEATURE_LINEAGE_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(a->'features') f where not exists(
    select 1 from public.research_feature_versions v where v.feature_key=f->>'feature_id'
      and v.version=(f->>'feature_version')::integer and v.normalization=f->>'normalization')) then
    raise exception 'RESEARCH_FEATURE_VERSION_DRIFT'; end if;
  if v_kind='FORWARD' and exists(select 1 from public.prediction_outcomes where target_date=v_date and evaluated_at<=v_created) then
    raise exception 'RESEARCH_FORWARD_OUTCOME_ALREADY_KNOWN'; end if;
  if v_kind='FORWARD' and not research_private.analysis_forward_allowed_v1(v_date,v_cutoff,v_created,
    (select enabled_at from research_private.analysis_activation)) then
    raise exception 'RESEARCH_FORWARD_CANNOT_BE_BACKDATED'; end if;
  v_hash:=encode(sha256(convert_to(p_analysis_text,'UTF8')),'hex');
  -- A concurrent duplicate returns the same canonical artifact; conflicting reruns cannot overwrite it.
  perform pg_advisory_xact_lock(hashtextextended('research-analysis:'||v_date::text,0));
  select * into v_result from public.research_daily_analysis where business_date=v_date and methodology_id='ANALYSIS_INTELLIGENCE_V1'
    and methodology_version=1 and observation_kind=v_kind and analysis_cutoff_at=v_cutoff;
  if found then
    if v_result.prediction_hash<>v_hash then raise exception 'RESEARCH_CANONICAL_ALREADY_LOCKED'; end if;
    return jsonb_build_object('status','ALREADY_RECORDED','id',v_result.id,'prediction_hash',v_result.prediction_hash);
  end if;
  if p_input->'production'<>'null'::jsonb and p_input#>>'{enhancements,report_level}' in ('FULL','DEGRADED') then
    insert into public.research_analysis_graphs(business_date,decision_snapshot_id,decision_revision,decision_fingerprint,
      source_methodology_version,methodology_id,methodology_version,report_level,evidence_as_of,observation_kind,what_changed,invalidation_conditions)
    values(v_date,(p_input#>>'{production,id}')::uuid,(p_input#>>'{production,revision}')::integer,p_input#>>'{production,fingerprint}',
      p_input#>>'{production,source_methodology_version}','ANALYSIS_INTELLIGENCE_V1',1,p_input#>>'{enhancements,report_level}',
      v_cutoff,v_kind,a->'what_changed',a->'invalidation_conditions') returning id into v_graph;
  end if;
  insert into public.research_daily_analysis(business_date,observation_kind,analysis_cutoff_at,created_at,graph_id,
    existing_prediction_id,input_snapshot,previous_input_snapshot,analysis,prediction_hash,compute_ms)
  values(v_date,v_kind,v_cutoff,v_created,v_graph,(p_input->>'existing_prediction_id')::uuid,p_input,p_previous,a,v_hash,p_compute_ms)
  returning * into v_result;
  return jsonb_build_object('status','RECORDED','id',v_result.id,'prediction_hash',v_result.prediction_hash);
end $$;

-- Bounded Owner-only catalogue + one selected immutable artifact, not an unbounded data dump.
-- Existing v1 remains unchanged for backward compatibility; no new Owner truth.
create function public.get_owner_analysis_v2(p_mode text default 'HISTORICAL_REPLAY',p_date date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_kind text; a public.research_daily_analysis;
begin
 if not public.is_research_owner_v1() then raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501'; end if;
 if p_mode not in ('HISTORICAL_REPLAY','FORWARD_SHADOW') or p_mode is null then raise exception 'RESEARCH_MODE_INVALID'; end if;
 v_kind:=case when p_mode='FORWARD_SHADOW' then 'FORWARD' else 'HISTORICAL_REPLAY' end;
 select * into a from public.research_daily_analysis where observation_kind=v_kind and (p_date is null or business_date=p_date)
 order by business_date desc,analysis_cutoff_at desc,id limit 1;
 return jsonb_build_object('schema_version','OWNER_ANALYSIS_V1','mode','SHADOW_ONLY','production_eligible',false,
 'selected_mode',p_mode,'forward_sample',(select count(distinct business_date) from public.research_daily_analysis where observation_kind='FORWARD'),
 'historical_replay_count',(select count(*) from public.research_daily_analysis where observation_kind='HISTORICAL_REPLAY'),
 'analysis_value','INSUFFICIENT_SAMPLE',
 'catalog',(select coalesce(jsonb_agg(to_jsonb(c) order by c.business_date desc),'[]'::jsonb) from
   (select distinct business_date from public.research_daily_analysis where observation_kind=v_kind order by business_date desc limit 90) c),
 'latest',case when a.id is null then null else jsonb_build_object('id',a.id,'analysis',a.analysis,'created_at',a.created_at,
   'compute_ms',a.compute_ms,'prediction_hash',a.prediction_hash,'analysis_mode',p_mode,
   'replay_created_at',case when v_kind='HISTORICAL_REPLAY' then a.created_at end,
   'not_forward',v_kind='HISTORICAL_REPLAY','not_production_decision',true) end,
 'invalidations',(select result from public.research_invalidation_observations where analysis_id=a.id order by observed_at desc limit 1));
end $$;
revoke all on function public.get_owner_analysis_v2(text,date) from public,anon,authenticated,service_role;
grant execute on function public.get_owner_analysis_v2(text,date) to authenticated;
commit;
