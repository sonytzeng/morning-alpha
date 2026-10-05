-- Phase 2 candidate ONLY. Research sidecar; never called by the business pipeline.
-- Does not rewrite Phase 1, enroll owners, change public RLS, or schedule work.
begin;
create table research_private.analysis_activation (
  singleton boolean primary key default true check(singleton),
  enabled_at timestamptz not null default clock_timestamp()
);
alter table research_private.analysis_activation enable row level security;
alter table research_private.analysis_activation force row level security;
revoke all on research_private.analysis_activation from public,anon,authenticated,service_role;
insert into research_private.analysis_activation default values;

insert into public.research_methodology_versions(methodology_id,version,description)
values('ANALYSIS_INTELLIGENCE_V1',1,'Deterministic experimental signed-return/confirmation analysis. IEF is inverse yield pressure; reference prices are not returns. No promotion, AI, calibration or production strategy effect.');

-- Register every calculated feature as an immutable Phase 1 registry entry.
insert into public.research_feature_versions(feature_key,version,provider_key,source_reference,business_meaning,
  normalization,freshness_contract,session_contract,signal_role,confidence_impact,missing_behavior)
select f.provider_key||':'||d.kind||':v1',1,f.provider_key,f.source_reference,f.business_meaning||' / '||d.kind,
  d.normalization,f.freshness_contract,f.session_contract,f.signal_role,f.confidence_impact,f.missing_behavior
from public.research_feature_versions f cross join (values
  ('session_confirmation','Boolean 1: inherited committed formal session contract; not directional confirmation.'),
  ('return','Observed percentage points; reference-only prices are null, never 0-filled.'),
  ('risk_impulse','clip(return percentage points × instrument risk sign / 2, -1, 1); experimental, uncalibrated.')
) d(kind,normalization) where f.version=1 and f.feature_key=f.provider_key;

-- Analysis is a locked research artifact, NOT a second CLE prediction/outcome engine.
create table public.research_daily_analysis (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  methodology_id text not null default 'ANALYSIS_INTELLIGENCE_V1' check(methodology_id='ANALYSIS_INTELLIGENCE_V1'),
  methodology_version integer not null default 1 check(methodology_version=1),
  observation_kind text not null check(observation_kind in ('HISTORICAL_REPLAY','FORWARD')),
  analysis_cutoff_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  graph_id uuid references public.research_analysis_graphs(id),
  existing_prediction_id uuid references public.learning_predictions(id),
  input_snapshot jsonb not null check(jsonb_typeof(input_snapshot)='object'),
  previous_input_snapshot jsonb,
  analysis jsonb not null check(jsonb_typeof(analysis)='object'),
  prediction_hash text not null check(prediction_hash ~ '^[0-9a-f]{64}$'),
  compute_ms numeric not null check(compute_ms>=0 and compute_ms<60000),
  ai_call_count integer not null default 0 check(ai_call_count=0),
  token_usage integer not null default 0 check(token_usage=0),
  production_eligible boolean not null default false check(not production_eligible),
  unique(business_date,methodology_id,methodology_version),
  foreign key(methodology_id,methodology_version) references public.research_methodology_versions,
  check(analysis_cutoff_at<=created_at),
  check(pg_column_size(input_snapshot)+pg_column_size(analysis)<524288)
);
create index research_daily_prediction_idx on public.research_daily_analysis(existing_prediction_id);
create index research_daily_graph_idx on public.research_daily_analysis(graph_id);
alter table public.research_daily_analysis enable row level security;
alter table public.research_daily_analysis force row level security;
revoke all on public.research_daily_analysis from public,anon,authenticated,service_role;
grant select on public.research_daily_analysis to authenticated,service_role;
create policy research_owner_read on public.research_daily_analysis for select to authenticated
using((select public.is_research_owner_v1()));
create trigger research_immutable before update or delete on public.research_daily_analysis
for each row execute function research_private.reject_mutation();
create trigger research_no_truncate before truncate on public.research_daily_analysis
for each statement execute function research_private.reject_mutation();

-- Service-only bounded source reader. No writes; never exposes market/raw tables to a member.
create function public.research_analysis_input_v1(p_date date,p_cutoff timestamptz,p_kind text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b public.market_checkpoint_batches; s public.decision_snapshots; r public.research_sessions;
  v_rows jsonb; v_production jsonb; v_context jsonb; v_previous date; v_prediction uuid;
begin
  if p_kind not in ('FORWARD','HISTORICAL_REPLAY') or p_cutoff>now()
    or (p_cutoff at time zone 'Asia/Taipei')::date<>p_date
    or (p_cutoff at time zone 'Asia/Taipei')::time>=time '09:00' then
    raise exception 'RESEARCH_INPUT_CUTOFF_INVALID';
  end if;
  select * into b from public.market_checkpoint_batches where business_date=p_date and checkpoint='PREMARKET';
  select jsonb_agg(to_jsonb(t) order by t.provider_key) into v_rows from (
    select x.id,x.provider_key,x.symbol,x.value,x.change_percent,x.source,x.source_timestamp,x.captured_at,x.created_at,
      x.snapshot_version,x.trading_date,x.checkpoint,x.market_session,x.batch_id,x.correlation_id,x.idempotency_key,
      jsonb_build_object('change',x.raw->'change','market',x.raw->'market','contract',x.raw->'contract',
        'source_symbol',x.raw->'source_symbol','freshness_status',x.raw->'freshness_status',
        'freshness_age_minutes',x.raw->'freshness_age_minutes','captured_session_date',x.raw->'captured_session_date',
        'tw_cash_phase',x.raw->'tw_cash_phase','tw_cash_session_contract',x.raw->'tw_cash_session_contract',
        'tw_cash_expected_session_date',x.raw->'tw_cash_expected_session_date','tw_cash_provider_session_date',x.raw->'tw_cash_provider_session_date',
        'txf_session_type',x.raw->'txf_session_type','txf_session_contract',x.raw->'txf_session_contract',
        'txf_expected_previous_trading_date',x.raw->'txf_expected_previous_trading_date','txf_provider_session_date',x.raw->'txf_provider_session_date',
        'source_raw',jsonb_build_object('date',x.raw#>'{source_raw,date}','session',x.raw#>'{source_raw,session}',
          'response_date',x.raw#>'{source_raw,response_date}','evidence_session_date',x.raw#>'{source_raw,evidence_session_date}',
          'price_basis',x.raw#>'{source_raw,price_basis}')) raw
    from public.market_checkpoint_snapshots x where x.trading_date=p_date and x.checkpoint='PREMARKET'
  ) t;
  select * into s from public.decision_snapshots where report_date=p_date and created_at<=p_cutoff
    and generated_text ? 'market_report_gate' order by created_at desc,id limit 1;
  if s.id is not null then
    v_production:=jsonb_build_object('id',s.id,'business_date',p_date,'created_at',s.created_at,
      'revision',s.version,'fingerprint',s.snapshot_fingerprint,'market_regime',s.market_regime,
      'direction',s.generated_text->>'market_bias','action',s.action,'confidence',s.confidence_score,
      'source_methodology_version',s.generated_text->>'methodology_version');
    select id into v_prediction from public.learning_predictions where decision_snapshot_id=s.id
      and prediction_at<=p_cutoff and created_at<=p_cutoff order by prediction_at,id limit 1;
  end if;
  select * into r from public.research_sessions where trading_date=p_date and created_at<=p_cutoff and generated_at<=p_cutoff
    order by created_at desc,id limit 1;
  v_context:=case when r.id is not null then jsonb_build_object('observed_at',r.created_at,'evidence_ids',jsonb_build_array(r.id),
    'missing_evidence',case when cardinality(r.missing_sources)>0 then to_jsonb(r.missing_sources) else '[]'::jsonb end,
    'report_level',coalesce(s.generated_text#>>'{market_report_gate,operational_market,report_level}',case when cardinality(r.missing_sources)>0 then 'DEGRADED' else 'UNAVAILABLE' end))
    else jsonb_build_object('observed_at',null,'evidence_ids','[]'::jsonb,'missing_evidence','["RESEARCH_CONTEXT"]'::jsonb,'report_level','UNAVAILABLE') end;
  select business_date into v_previous from public.market_checkpoint_batches
    where business_date<p_date and business_date>=p_date-45 and checkpoint='PREMARKET' and status='COMMITTED'
      and public.market_checkpoint_batch_integrity_v1(business_date,'PREMARKET')->>'status'='PASS'
    order by business_date desc limit 1;
  return jsonb_build_object('schema_version','ANALYSIS_INPUT_V1','observation_kind',p_kind,'analysis_cutoff_at',p_cutoff,
    'core',jsonb_build_object('business_date',p_date,'observed_at',p_cutoff,'batch',to_jsonb(b),
      'integrity',public.market_checkpoint_batch_integrity_v1(p_date,'PREMARKET'),'rows',coalesce(v_rows,'[]'::jsonb)),
    'registry',(select jsonb_agg(jsonb_build_object('feature_key',feature_key,'version',version,'normalization',normalization) order by feature_key)
      from public.research_feature_versions where version=1),
    'enhancements',v_context,'production',v_production,'existing_prediction_id',v_prediction,
    'previous_valid_business_date',v_previous);
end $$;
revoke all on function public.research_analysis_input_v1(date,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.research_analysis_input_v1(date,timestamptz,text) to service_role;

create function research_private.analysis_forward_allowed_v1(p_date date,p_cutoff timestamptz,p_created timestamptz,p_enabled timestamptz)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_created>=p_enabled and p_cutoff<=p_created and p_created-p_cutoff<=interval '5 minutes'
    and (p_created at time zone 'Asia/Taipei')::date=p_date
    and (p_cutoff at time zone 'Asia/Taipei')::date=p_date
    and (p_created at time zone 'Asia/Taipei')::time<time '09:00',false)
$$;
revoke all on function research_private.analysis_forward_allowed_v1(date,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- Narrow service-only writer. The source readset is rebuilt, not trusted from caller JSON.
-- Definer is needed only to insert locked research rows; no business writes exist here.
create function public.store_research_analysis_v1(p_input jsonb,p_previous jsonb,p_analysis_text text,p_compute_ms numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_date date:=(p_input#>>'{core,business_date}')::date; v_cutoff timestamptz:=(p_input->>'analysis_cutoff_at')::timestamptz;
  v_kind text:=p_input->>'observation_kind'; v_live jsonb; v_previous jsonb; a jsonb:=p_analysis_text::jsonb;
  v_graph uuid; v_result public.research_daily_analysis; v_hash text; v_created timestamptz:=clock_timestamp();
begin
  v_live:=public.research_analysis_input_v1(v_date,v_cutoff,v_kind);
  if v_live is distinct from p_input then raise exception 'RESEARCH_SOURCE_READSET_MISMATCH'; end if;
  if v_live->>'previous_valid_business_date' is not null then
    v_previous:=public.research_analysis_input_v1((v_live->>'previous_valid_business_date')::date,
      (((v_live->>'previous_valid_business_date')::date+time '08:44:59') at time zone 'Asia/Taipei'),'HISTORICAL_REPLAY');
    if v_previous is distinct from p_previous then raise exception 'RESEARCH_PREVIOUS_READSET_MISMATCH'; end if;
  elsif p_previous is not null then raise exception 'RESEARCH_UNEXPECTED_PREVIOUS_INPUT'; end if;
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
  if v_kind='FORWARD' and not research_private.analysis_forward_allowed_v1(v_date,v_cutoff,v_created,
    (select enabled_at from research_private.analysis_activation)) then
    raise exception 'RESEARCH_FORWARD_CANNOT_BE_BACKDATED'; end if;
  v_hash:=encode(sha256(convert_to(p_analysis_text,'UTF8')),'hex');
  -- A concurrent duplicate returns the same canonical artifact; conflicting reruns cannot overwrite it.
  perform pg_advisory_xact_lock(hashtextextended('research-analysis:'||v_date::text,0));
  select * into v_result from public.research_daily_analysis where business_date=v_date and methodology_id='ANALYSIS_INTELLIGENCE_V1';
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
revoke all on function public.store_research_analysis_v1(jsonb,jsonb,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.store_research_analysis_v1(jsonb,jsonb,text,numeric) to service_role;

create table public.research_invalidation_observations (
  analysis_id uuid not null references public.research_daily_analysis(id),
  batch_id uuid not null references public.market_checkpoint_batches(batch_id),
  observed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  input_snapshot jsonb not null,
  result jsonb not null check(jsonb_typeof(result)='array'),
  primary key(analysis_id,batch_id),
  check(observed_at<=created_at)
);
create index research_invalidation_batch_idx on public.research_invalidation_observations(batch_id);
alter table public.research_invalidation_observations enable row level security;
alter table public.research_invalidation_observations force row level security;
revoke all on public.research_invalidation_observations from public,anon,authenticated,service_role;
grant select on public.research_invalidation_observations to authenticated,service_role;
create policy research_owner_read on public.research_invalidation_observations for select to authenticated
using((select public.is_research_owner_v1()));
create trigger research_immutable before update or delete on public.research_invalidation_observations
for each row execute function research_private.reject_mutation();
create trigger research_no_truncate before truncate on public.research_invalidation_observations
for each statement execute function research_private.reject_mutation();

create function public.research_invalidation_input_v1(p_analysis_id uuid,p_checkpoint text,p_cutoff timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.research_daily_analysis; b public.market_checkpoint_batches; v_rows jsonb;
begin
  select * into strict a from public.research_daily_analysis where id=p_analysis_id;
  if p_checkpoint not in ('0900','0930','1030','1300','1410','1430') or p_cutoff>now()
    or p_cutoff<=a.analysis_cutoff_at or (p_cutoff at time zone 'Asia/Taipei')::date<>a.business_date then
    raise exception 'RESEARCH_INVALIDATION_CUTOFF'; end if;
  select * into strict b from public.market_checkpoint_batches where business_date=a.business_date and checkpoint=p_checkpoint;
  select jsonb_agg(to_jsonb(t) order by provider_key) into v_rows from (
    select x.id,x.provider_key,x.symbol,x.value,x.change_percent,x.source,x.source_timestamp,x.captured_at,x.created_at,
      x.snapshot_version,x.trading_date,x.checkpoint,x.market_session,x.batch_id,x.correlation_id,x.idempotency_key,
      jsonb_build_object('change',x.raw->'change','market',x.raw->'market','contract',x.raw->'contract',
        'source_symbol',x.raw->'source_symbol','freshness_status',x.raw->'freshness_status',
        'freshness_age_minutes',x.raw->'freshness_age_minutes','captured_session_date',x.raw->'captured_session_date',
        'tw_cash_phase',x.raw->'tw_cash_phase','tw_cash_session_contract',x.raw->'tw_cash_session_contract',
        'tw_cash_expected_session_date',x.raw->'tw_cash_expected_session_date','tw_cash_provider_session_date',x.raw->'tw_cash_provider_session_date',
        'source_raw',jsonb_build_object('date',x.raw#>'{source_raw,date}','session',x.raw#>'{source_raw,session}',
          'response_date',x.raw#>'{source_raw,response_date}','evidence_session_date',x.raw#>'{source_raw,evidence_session_date}',
          'price_basis',x.raw#>'{source_raw,price_basis}')) raw
    from public.market_checkpoint_snapshots x where x.batch_id=b.batch_id
  ) t;
  return jsonb_build_object('analysis_id',a.id,'analysis',a.analysis,'observation',jsonb_build_object('observed_at',p_cutoff,
    'core',jsonb_build_object('business_date',a.business_date,'batch',to_jsonb(b),'rows',v_rows,
      'integrity',public.market_checkpoint_batch_integrity_v1(a.business_date,p_checkpoint))));
end $$;
revoke all on function public.research_invalidation_input_v1(uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.research_invalidation_input_v1(uuid,text,timestamptz) to service_role;

create function public.store_research_invalidation_v1(p_input jsonb,p_result jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare v_live jsonb; v_id uuid:=(p_input->>'analysis_id')::uuid;
  v_batch uuid:=(p_input#>>'{observation,core,batch,batch_id}')::uuid; prior jsonb;
begin
  v_live:=public.research_invalidation_input_v1(v_id,p_input#>>'{observation,core,batch,checkpoint}',
    (p_input#>>'{observation,observed_at}')::timestamptz);
  if v_live is distinct from p_input or v_live#>>'{observation,core,integrity,status}' is distinct from 'PASS'
    or (v_live#>>'{observation,core,batch,committed_at}')::timestamptz>(v_live#>>'{observation,observed_at}')::timestamptz
    or jsonb_array_length(p_result) is distinct from 5 then raise exception 'RESEARCH_INVALIDATION_CONTRACT'; end if;
  if exists(select 1 from jsonb_array_elements(p_result) r where r->>'status' not in ('TRIGGERED','NOT_TRIGGERED','UNAVAILABLE')
    or not exists(select 1 from jsonb_array_elements(v_live#>'{analysis,invalidation_conditions}') c
      where c->>'invalidation_id'=r->>'invalidation_id')) then raise exception 'RESEARCH_INVALIDATION_RESULT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-invalidation:'||v_id::text||v_batch::text,0));
  select result into prior from public.research_invalidation_observations where analysis_id=v_id and batch_id=v_batch;
  if found then
    if prior is distinct from p_result then raise exception 'RESEARCH_INVALIDATION_IMMUTABLE'; end if;
    return 'ALREADY_RECORDED'; end if;
  insert into public.research_invalidation_observations(analysis_id,batch_id,observed_at,input_snapshot,result)
    values(v_id,v_batch,(p_input#>>'{observation,observed_at}')::timestamptz,p_input,p_result);
  return 'RECORDED';
end $$;
revoke all on function public.store_research_invalidation_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.store_research_invalidation_v1(jsonb,jsonb) to service_role;

-- Reuse CLE facts; never create a second Closing result or copy production direction_correct.
create function public.link_research_outcome_v1(p_analysis_id uuid,p_outcome_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare a public.research_daily_analysis; p public.learning_predictions; o public.prediction_outcomes;
  v_eligible boolean; v_direction text; v_correct boolean; v_reasons text[];
begin
  select * into strict a from public.research_daily_analysis where id=p_analysis_id;
  select * into strict o from public.prediction_outcomes where id=p_outcome_id;
  select * into strict p from public.learning_predictions where id=o.prediction_id;
  if a.graph_id is null or p.decision_snapshot_id is distinct from (a.input_snapshot#>>'{production,id}')::uuid
    or p.report_date<>a.business_date or o.target_date<>a.business_date or o.horizon<>'close'
    or o.evaluated_at is null or o.evaluated_at>now() or o.status<>'completed' or o.data_quality_status<>'complete'
    or o.return_percent is null then raise exception 'RESEARCH_OUTCOME_UNAVAILABLE'; end if;
  v_direction:=a.analysis#>>'{decision,shadow_direction}';
  v_correct:=case when v_direction='BULLISH' then o.return_percent>0 when v_direction='BEARISH' then o.return_percent<0 else null end;
  v_reasons:=array_remove(array[case when a.observation_kind<>'FORWARD' then 'HISTORICAL_REPLAY_NOT_FORWARD' end,
    case when v_correct is null then 'NEUTRAL_NOT_DIRECTION_SCORABLE' end],null);
  v_eligible:=cardinality(v_reasons)=0;
  perform pg_advisory_xact_lock(hashtextextended('research-outcome:'||a.id::text||o.id::text,0));
  if exists(select 1 from public.research_quality_observations where graph_id=a.graph_id and outcome_id=o.id
    and measurement_version='SHADOW_DIRECTION_V1') then return 'ALREADY_LINKED'; end if;
  insert into public.research_quality_observations(graph_id,prediction_id,outcome_id,quality_dimension,measurement_version,
    report_level,eligible,exclusion_reasons,metrics)
  values(a.graph_id,p.id,o.id,'DECISION','SHADOW_DIRECTION_V1',a.input_snapshot#>>'{enhancements,report_level}',v_eligible,v_reasons,
    jsonb_build_object('shadow_direction',v_direction,'shadow_direction_correct',v_correct,
      'realized_return_percent',o.return_percent,'observation_kind',a.observation_kind,'prediction_hash',a.prediction_hash));
  return 'LINKED';
end $$;
revoke all on function public.link_research_outcome_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.link_research_outcome_v1(uuid,uuid) to service_role;

create function public.get_owner_analysis_v1() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.is_research_owner_v1() then raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('schema_version','OWNER_ANALYSIS_V1','mode','SHADOW_ONLY','production_eligible',false,
    'forward_sample',(select count(distinct business_date) from public.research_daily_analysis where observation_kind='FORWARD'),
    'analysis_value','INSUFFICIENT_SAMPLE',
    'latest',(select jsonb_build_object('id',id,'analysis',analysis,'created_at',created_at,'compute_ms',compute_ms)
      from public.research_daily_analysis order by business_date desc limit 1),
    'invalidations',(select result from public.research_invalidation_observations where analysis_id=
      (select id from public.research_daily_analysis order by business_date desc limit 1) order by observed_at desc limit 1),
    'outcomes',(select coalesce(jsonb_agg(jsonb_build_object('analysis_id',d.id,'prediction_id',q.prediction_id,
      'outcome_id',q.outcome_id,'source_outcome',q.source_outcome,'observed_at',q.observed_at)),'[]'::jsonb)
      from public.research_daily_analysis d join public.research_quality_observations q on q.graph_id=d.graph_id
      where d.business_date=(select max(business_date) from public.research_daily_analysis)));
end $$;
revoke all on function public.get_owner_analysis_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_owner_analysis_v1() to authenticated;
commit;
