-- 10K Product Program / Phase 1. Additive research-only candidate.
-- No existing policy, function, strategy, business row, cron or publication changes.
-- No owner is enrolled here. Production enrolment needs a named release approval.
begin;

create schema research_private;
revoke all on schema research_private from public, anon, authenticated, service_role;

create table research_private.owner_access (
  singleton boolean primary key default true check (singleton),
  principal_id uuid not null unique references public.profiles(id) on delete restrict,
  enabled boolean not null default false,
  approved_at timestamptz not null default now(),
  approval_reference text not null check (length(approval_reference) >= 10)
);
alter table research_private.owner_access enable row level security;
alter table research_private.owner_access force row level security;
revoke all on research_private.owner_access from public, anon, authenticated, service_role;

-- Narrow definer: one boolean, bound to the verified request UID, never an ID argument.
create function public.is_research_owner_v1() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from research_private.owner_access a
    join public.profiles p on p.id = a.principal_id
    where a.principal_id = (select auth.uid()) and a.enabled and lower(p.role) = 'admin'
  )
$$;
revoke all on function public.is_research_owner_v1() from public, anon, authenticated, service_role;
grant execute on function public.is_research_owner_v1() to authenticated, service_role;

create table public.research_feature_versions (
  feature_key text not null,
  version integer not null check (version > 0),
  supersedes_version integer,
  provider_key text not null,
  source_reference text not null,
  business_meaning text not null,
  normalization text not null,
  freshness_contract text not null,
  session_contract text not null,
  signal_role text not null,
  confidence_impact text not null check (confidence_impact = 'SHADOW_ONLY_UNCALIBRATED'),
  missing_behavior text not null check (missing_behavior = 'UNAVAILABLE_NO_IMPUTATION'),
  created_at timestamptz not null default now(),
  primary key(feature_key, version),
  foreign key(feature_key, supersedes_version) references public.research_feature_versions(feature_key, version),
  check ((version = 1 and supersedes_version is null) or (version > 1 and supersedes_version = version - 1))
);

create table public.research_methodology_versions (
  methodology_id text not null,
  version integer not null check (version > 0),
  supersedes_version integer,
  description text not null,
  mode text not null default 'SHADOW' check (mode = 'SHADOW'),
  production_eligible boolean not null default false check (not production_eligible),
  created_at timestamptz not null default now(),
  primary key(methodology_id, version),
  foreign key(methodology_id, supersedes_version) references public.research_methodology_versions(methodology_id, version),
  check ((version = 1 and supersedes_version is null) or (version > 1 and supersedes_version = version - 1))
);

-- Teacher methods and testable candidates share version/provenance, not a new production rule engine.
create table public.research_method_versions (
  method_id uuid not null,
  version integer not null check (version > 0),
  supersedes_version integer,
  kind text not null check (kind in ('TEACHER_METHOD','RULE_CANDIDATE')),
  teacher_method_id uuid,
  teacher_method_version integer,
  method_name text not null,
  teacher_label text not null,
  description text not null,
  source_type text not null check (source_type in ('COURSE','VIDEO','ARTICLE','NOTE','INTERNAL_RESEARCH')),
  source_title text not null,
  source_date date not null,
  source_reference text not null,
  extracted_claim text not null,
  normalized_rule jsonb not null check (jsonb_typeof(normalized_rule) = 'object'),
  market_scope text not null,
  entry_conditions jsonb not null check (jsonb_typeof(entry_conditions) = 'array'),
  exit_conditions jsonb not null check (jsonb_typeof(exit_conditions) = 'array'),
  invalidation_conditions jsonb not null check (jsonb_typeof(invalidation_conditions) = 'array'),
  risk_conditions jsonb not null check (jsonb_typeof(risk_conditions) = 'array'),
  expected_horizon text not null check (expected_horizon in ('INTRADAY','1D','3D','5D','10D','20D')),
  status text not null check (status in ('RESEARCH','BACKTEST','SHADOW','FORWARD_VALIDATION','REJECTED','RETIRED')),
  existing_learning_rule_id uuid references public.learning_rules(id) on delete restrict,
  production_eligible boolean not null default false check (not production_eligible),
  created_at timestamptz not null default now(),
  primary key(method_id,version),
  foreign key(method_id,supersedes_version) references public.research_method_versions(method_id,version),
  foreign key(teacher_method_id,teacher_method_version) references public.research_method_versions(method_id,version) match full,
  check ((version = 1 and supersedes_version is null) or (version > 1 and supersedes_version = version - 1)),
  check (kind <> 'RULE_CANDIDATE' or
    (jsonb_array_length(entry_conditions)>0 and jsonb_array_length(exit_conditions)>0
     and jsonb_array_length(invalidation_conditions)>0 and jsonb_array_length(risk_conditions)>0))
);
create index research_method_existing_rule_idx on public.research_method_versions(existing_learning_rule_id);
create index research_method_teacher_idx on public.research_method_versions(teacher_method_id,teacher_method_version);

create table public.research_method_features (
  method_id uuid not null,
  method_version integer not null,
  feature_key text not null,
  feature_version integer not null,
  primary key(method_id,method_version,feature_key),
  foreign key(method_id,method_version) references public.research_method_versions(method_id,version),
  foreign key(feature_key,feature_version) references public.research_feature_versions(feature_key,version)
);
create index research_method_feature_idx on public.research_method_features(feature_key,feature_version);

create table public.research_analysis_graphs (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete restrict,
  decision_revision integer not null,
  decision_fingerprint text not null,
  source_methodology_version text, -- NULL means legacy provenance unavailable; never invented.
  methodology_id text not null,
  methodology_version integer not null,
  report_level text not null check (report_level in ('FULL','DEGRADED')),
  mode text not null default 'SHADOW' check (mode = 'SHADOW'),
  evidence_as_of timestamptz not null,
  observation_kind text not null check (observation_kind in ('FORWARD','HISTORICAL_REPLAY')),
  what_changed jsonb not null default '[]'::jsonb check (jsonb_typeof(what_changed)='array'),
  invalidation_conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(invalidation_conditions)='array'),
  created_at timestamptz not null default now(),
  foreign key(methodology_id,methodology_version) references public.research_methodology_versions(methodology_id,version),
  unique(decision_snapshot_id,methodology_id,methodology_version,observation_kind),
  check(evidence_as_of <= created_at)
);
create index research_graph_date_idx on public.research_analysis_graphs(business_date desc);
create index research_graph_methodology_idx on public.research_analysis_graphs(methodology_id,methodology_version);

create table public.research_signal_observations (
  graph_id uuid not null references public.research_analysis_graphs(id) on delete restrict,
  signal_key text not null,
  feature_key text not null,
  feature_version integer not null,
  disposition text not null check (disposition in ('SUPPORTING','CONTRADICTING','NEUTRAL','MISSING')),
  evidence_ids text[] not null default '{}',
  evidence_available_at timestamptz,
  strength numeric check (strength between 0 and 100),
  confidence numeric check (confidence between 0 and 100),
  calibration_status text not null default 'EXPERIMENTAL' check (calibration_status='EXPERIMENTAL'),
  regime_dependency text[] not null default '{}',
  decision_contribution jsonb not null check (jsonb_typeof(decision_contribution)='object'),
  primary key(graph_id,signal_key),
  foreign key(feature_key,feature_version) references public.research_feature_versions(feature_key,version),
  check ((disposition='MISSING' and cardinality(evidence_ids)=0 and strength is null and confidence is null)
    or (disposition<>'MISSING' and cardinality(evidence_ids)>0 and evidence_available_at is not null))
);
create index research_signal_feature_idx on public.research_signal_observations(feature_key,feature_version);

-- No duplicate predictions/outcomes/backtests/cases. These references reuse CLE.
-- Snapshot mutable legacy outcomes at observation time without overwriting them.
create table public.research_quality_observations (
  id uuid primary key default gen_random_uuid(),
  graph_id uuid not null references public.research_analysis_graphs(id) on delete restrict,
  prediction_id uuid not null references public.learning_predictions(id) on delete restrict,
  outcome_id uuid references public.prediction_outcomes(id) on delete restrict,
  quality_dimension text not null check (quality_dimension in ('DATA','ANALYSIS','DECISION')),
  measurement_version text not null,
  report_level text not null check (report_level in ('FULL','DEGRADED')),
  eligible boolean not null,
  exclusion_reasons text[] not null default '{}',
  metrics jsonb not null check (jsonb_typeof(metrics)='object'),
  source_outcome jsonb,
  source_outcome_hash text,
  observed_at timestamptz not null default now(),
  check (eligible = (cardinality(exclusion_reasons)=0)),
  check (quality_dimension <> 'DECISION' or outcome_id is not null or not eligible),
  unique(graph_id,prediction_id,quality_dimension,measurement_version,source_outcome_hash)
);
create index research_quality_prediction_idx on public.research_quality_observations(prediction_id);
create index research_quality_outcome_idx on public.research_quality_observations(outcome_id);

create function research_private.reject_mutation() returns trigger
language plpgsql set search_path='' as $$ begin
  raise exception 'RESEARCH_APPEND_ONLY_NEW_VERSION_REQUIRED' using errcode='55000';
end $$;

create function research_private.validate_lineage() returns trigger
language plpgsql set search_path='' as $$
declare s public.decision_snapshots; g public.research_analysis_graphs;
  p public.learning_predictions; o public.prediction_outcomes;
begin
  if tg_table_name='research_analysis_graphs' then
    select * into strict s from public.decision_snapshots where id=new.decision_snapshot_id;
    if s.report_date<>new.business_date or s.version<>new.decision_revision
       or s.snapshot_fingerprint is distinct from new.decision_fingerprint then
      raise exception 'RESEARCH_CANONICAL_LINEAGE_MISMATCH';
    end if;
    if (s.generated_text#>>'{market_report_gate,operational_market,report_level}') is distinct from new.report_level
       or (s.generated_text->>'methodology_version') is distinct from new.source_methodology_version then
      raise exception 'RESEARCH_CANONICAL_PROVENANCE_UNAVAILABLE_OR_MISMATCH';
    end if;
    new.created_at:=clock_timestamp();
    if new.evidence_as_of>new.created_at then raise exception 'RESEARCH_FUTURE_EVIDENCE'; end if;
    if new.observation_kind='FORWARD' and (s.created_at>new.evidence_as_of or
       new.created_at >= (new.business_date::timestamp + interval '9 hours') at time zone 'Asia/Taipei') then
      raise exception 'RESEARCH_FORWARD_CANNOT_BE_BACKDATED';
    end if;
  elsif tg_table_name='research_signal_observations' then
    select * into strict g from public.research_analysis_graphs where id=new.graph_id;
    if new.evidence_available_at>g.evidence_as_of then raise exception 'RESEARCH_SIGNAL_LOOKAHEAD'; end if;
  elsif tg_table_name='research_quality_observations' then
    select * into strict g from public.research_analysis_graphs where id=new.graph_id;
    select * into strict p from public.learning_predictions where id=new.prediction_id;
    if p.decision_snapshot_id is distinct from g.decision_snapshot_id or p.report_date<>g.business_date
       or new.report_level<>g.report_level then raise exception 'RESEARCH_PREDICTION_LINEAGE_MISMATCH'; end if;
    new.observed_at:=clock_timestamp();
    if p.prediction_at>new.observed_at then raise exception 'RESEARCH_FUTURE_PREDICTION'; end if;
    if new.eligible and (p.record_status<>'valid' or p.prediction_at >=
      (p.report_date::timestamp + interval '9 hours') at time zone 'Asia/Taipei') then
      raise exception 'RESEARCH_NOT_AN_ELIGIBLE_MORNING_PREDICTION';
    end if;
    if new.outcome_id is not null then
      select * into strict o from public.prediction_outcomes where id=new.outcome_id;
      if o.prediction_id<>new.prediction_id then raise exception 'RESEARCH_OUTCOME_LINEAGE_MISMATCH'; end if;
      if o.evaluated_at>new.observed_at or o.target_date>(new.observed_at at time zone 'Asia/Taipei')::date then
        raise exception 'RESEARCH_FUTURE_OUTCOME';
      end if;
      new.source_outcome:=jsonb_build_object('id',o.id,'prediction_id',o.prediction_id,'horizon',o.horizon,
        'target_date',o.target_date,'evaluated_at',o.evaluated_at,'status',o.status,
        'data_quality_status',o.data_quality_status,'direction_correct',o.direction_correct,
        'return_percent',o.return_percent,'max_favorable_excursion',o.max_favorable_excursion,
        'max_adverse_excursion',o.max_adverse_excursion,'source_refs',o.source_refs);
      new.source_outcome_hash:=md5(new.source_outcome::text);
      if new.eligible and (o.status<>'completed' or o.data_quality_status<>'complete'
          or o.evaluated_at is null or o.target_date is null) then raise exception 'RESEARCH_OUTCOME_NOT_ELIGIBLE'; end if;
    else
      new.source_outcome:=null; new.source_outcome_hash:='NO_OUTCOME';
    end if;
  end if;
  return new;
end $$;
revoke all on all functions in schema research_private from public,anon,authenticated,service_role;

do $$ declare t text; begin
  foreach t in array array['research_feature_versions','research_methodology_versions','research_method_versions',
    'research_method_features','research_analysis_graphs','research_signal_observations','research_quality_observations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert on public.%I to service_role',t);
    execute format('create policy research_owner_read on public.%I for select to authenticated using ((select public.is_research_owner_v1()))',t);
    execute format('create trigger research_immutable before update or delete on public.%I for each row execute function research_private.reject_mutation()',t);
    execute format('create trigger research_no_truncate before truncate on public.%I for each statement execute function research_private.reject_mutation()',t);
  end loop;
  foreach t in array array['research_analysis_graphs','research_signal_observations','research_quality_observations'] loop
    execute format('create trigger research_lineage before insert on public.%I for each row execute function research_private.validate_lineage()',t);
  end loop;
end $$;

-- Registry of analytical roles. No weights, investment thresholds or new provider adapters.
insert into public.research_feature_versions(feature_key,version,provider_key,source_reference,business_meaning,
  normalization,freshness_contract,session_contract,signal_role,confidence_impact,missing_behavior)
select key,1,key,'market_checkpoint_snapshots / '||key,meaning,
  'Use committed value and change_percent without imputation; percent remains percentage points.',
  'fetch-checkpoint-evidence.mjs::validateAtomicCheckpointEvidenceRows',session,signal,
  'SHADOW_ONLY_UNCALIBRATED','UNAVAILABLE_NO_IMPUTATION'
from (values
 ('TAIEX','台股大盤結構','TW_CASH_PHASE_CONTRACT','MARKET_STRUCTURE'),
 ('2330','台股權值／半導體核心','TW_CASH_PHASE_CONTRACT','LOCAL_CONFIRMATION'),
 ('TXF','期貨風險偏好／領先確認','TXF_SESSION_CONTRACT','FUTURES_CONFIRMATION'),
 ('SPX','美國廣泛風險環境','GLOBAL8_COMPLETED_SESSION','GLOBAL_RISK'),
 ('IXIC','科技成長風格','GLOBAL8_COMPLETED_SESSION','GROWTH_STYLE'),
 ('SOX','半導體週期','GLOBAL8_COMPLETED_SESSION','SEMICONDUCTOR_CYCLE'),
 ('NVDA','AI／半導體風險偏好','GLOBAL8_COMPLETED_SESSION','AI_RISK'),
 ('TSM','台積電 ADR／台股映射','GLOBAL8_COMPLETED_SESSION','ADR_MAPPING'),
 ('VIX','恐慌／風險價格','GLOBAL8_COMPLETED_SESSION','VOLATILITY_RISK'),
 ('DXY','美元壓力','GLOBAL8_COMPLETED_SESSION','DOLLAR_PRESSURE'),
 ('US10Y','利率／估值壓力','GLOBAL8_COMPLETED_SESSION','YIELD_PRESSURE')
) as definitions(key,meaning,session,signal);

insert into public.research_methodology_versions(methodology_id,version,description)
values ('RESEARCH_FOUNDATION_V1',1,'Schema-only research foundation; not a production methodology or validated investment model.');

create function public.get_research_foundation_v1() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.is_research_owner_v1() then raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('schema_version','RESEARCH_FOUNDATION_V1','mode','SHADOW','production_eligible',false,
    'features',(select coalesce(jsonb_agg(to_jsonb(f) order by feature_key,version),'[]'::jsonb) from public.research_feature_versions f),
    'methodologies',(select coalesce(jsonb_agg(to_jsonb(m) order by methodology_id,version),'[]'::jsonb) from public.research_methodology_versions m),
    'method_versions',(select count(*) from public.research_method_versions),
    'graphs',(select count(*) from public.research_analysis_graphs),
    'observations',(select count(*) from public.research_quality_observations));
end $$;
revoke all on function public.get_research_foundation_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_research_foundation_v1() to authenticated;
comment on function public.get_research_foundation_v1() is 'Owner-only research metadata. No data capture, metrics write, strategy change or production promotion.';
commit;
