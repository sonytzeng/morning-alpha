begin;

create table if not exists public.member_content_revisions (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  report_id uuid not null references public.reports(id) on delete restrict,
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete restrict,
  decision_snapshot_version integer not null check (decision_snapshot_version > 0),
  revision integer not null check (revision > 0),
  idempotency_key text not null unique,
  status text not null check (status in ('PASSED','BLOCKED','DEGRADED')),
  canonical_contract jsonb not null,
  member_content jsonb not null,
  data_quality_status text not null,
  content_score numeric(5,2) not null check (content_score between 0 and 100),
  evidence_coverage numeric(5,2) not null check (evidence_coverage between 0 and 100),
  source_revision text not null,
  generated_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (report_date, revision)
);

create table if not exists public.semantic_coherence_reviews (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  decision_snapshot_id uuid not null references public.decision_snapshots(id) on delete restrict,
  member_content_revision_id uuid not null references public.member_content_revisions(id) on delete restrict,
  gate_version text not null,
  status text not null check (status in ('PASSED','BLOCKED','DEGRADED')),
  reason_codes text[] not null default '{}'::text[],
  conflicting_fields text[] not null default '{}'::text[],
  canonical_snapshot_id uuid not null,
  canonical_snapshot_version integer not null check (canonical_snapshot_version > 0),
  checked_at timestamptz not null,
  idempotency_key text not null unique,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (member_content_revision_id, gate_version)
);

create table if not exists public.content_os_sync_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_key text not null unique,
  business_date date not null,
  snapshot_id uuid references public.decision_snapshots(id) on delete restrict,
  snapshot_version integer,
  destination text not null default 'morning_alpha_content_os',
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  reason_codes text[] not null default '{}'::text[],
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_http_status integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learning_metric_corrections (
  id uuid primary key default gen_random_uuid(),
  learning_run_id uuid not null references public.learning_runs(id) on delete restrict,
  business_date date not null,
  idempotency_key text not null unique,
  engine_version text not null,
  original_metrics jsonb not null,
  corrected_metrics jsonb not null,
  authoritative_counts jsonb not null,
  reason_code text not null,
  actor text not null,
  request_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.production_acceptance_results (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  evaluator_version text not null,
  idempotency_key text not null unique,
  verdict text not null check (verdict in ('PASS','FAIL','NOT_DUE')),
  blocking_checks text[] not null default '{}'::text[],
  evidence jsonb not null,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_date, evaluator_version)
);

create index if not exists member_content_revisions_lookup_idx
  on public.member_content_revisions (report_date, revision desc);
create index if not exists semantic_coherence_reviews_lookup_idx
  on public.semantic_coherence_reviews (report_date, checked_at desc);
create index if not exists content_os_sync_incidents_open_idx
  on public.content_os_sync_incidents (business_date, status, last_seen_at desc);
create index if not exists production_acceptance_results_lookup_idx
  on public.production_acceptance_results (business_date desc, evaluated_at desc);

alter table public.member_content_revisions enable row level security;
alter table public.member_content_revisions force row level security;
alter table public.semantic_coherence_reviews enable row level security;
alter table public.semantic_coherence_reviews force row level security;
alter table public.content_os_sync_incidents enable row level security;
alter table public.content_os_sync_incidents force row level security;
alter table public.learning_metric_corrections enable row level security;
alter table public.learning_metric_corrections force row level security;
alter table public.production_acceptance_results enable row level security;
alter table public.production_acceptance_results force row level security;

revoke all on public.member_content_revisions, public.semantic_coherence_reviews,
  public.content_os_sync_incidents, public.learning_metric_corrections,
  public.production_acceptance_results from public, anon, authenticated;
grant all on public.member_content_revisions, public.semantic_coherence_reviews,
  public.content_os_sync_incidents, public.learning_metric_corrections,
  public.production_acceptance_results to service_role;

create or replace view public.current_member_content_revisions_v1
with (security_invoker = true) as
select distinct on (r.report_date)
  r.*,
  s.status as semantic_status,
  s.reason_codes as semantic_reason_codes,
  s.conflicting_fields as semantic_conflicting_fields,
  s.gate_version as semantic_gate_version,
  s.checked_at as semantic_checked_at
from public.member_content_revisions r
join public.semantic_coherence_reviews s on s.member_content_revision_id = r.id
where r.status = 'PASSED' and s.status = 'PASSED'
order by r.report_date, r.revision desc, s.checked_at desc;
revoke all on public.current_member_content_revisions_v1 from public, anon, authenticated;
grant select on public.current_member_content_revisions_v1 to service_role;

create or replace function public.publish_member_content_revision_v1(
  p_report_date date,
  p_report_id uuid,
  p_decision_snapshot_id uuid,
  p_idempotency_key text,
  p_source_revision text,
  p_canonical_contract jsonb,
  p_member_content jsonb,
  p_semantic_result jsonb,
  p_content_score numeric,
  p_evidence_coverage numeric,
  p_generated_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_snapshot public.decision_snapshots;
  v_revision integer;
  v_revision_id uuid;
  v_status text := upper(coalesce(p_semantic_result->>'status','BLOCKED'));
  v_gate_version text := coalesce(p_semantic_result->>'gate_version','SEMANTIC_COHERENCE_V2');
begin
  if p_report_date is null or p_report_id is null or p_decision_snapshot_id is null then
    raise exception 'member revision identity is required';
  end if;
  if coalesce(trim(p_idempotency_key),'') = '' or coalesce(trim(p_source_revision),'') = '' then
    raise exception 'member revision idempotency and source revision are required';
  end if;
  if v_status not in ('PASSED','BLOCKED','DEGRADED') then
    raise exception 'invalid semantic status: %', v_status;
  end if;
  select id into v_existing from public.member_content_revisions where idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select * into v_snapshot from public.decision_snapshots where id = p_decision_snapshot_id for share;
  if not found or v_snapshot.report_date <> p_report_date or v_snapshot.report_id <> p_report_id then
    raise exception 'snapshot/report/date contract mismatch';
  end if;
  if p_canonical_contract->>'snapshot_id' <> p_decision_snapshot_id::text
    or nullif(p_canonical_contract->>'snapshot_version','')::integer <> v_snapshot.version then
    raise exception 'canonical snapshot identity mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member_content:' || p_report_date::text, 0));
  select coalesce(max(revision),0)+1 into v_revision
  from public.member_content_revisions where report_date = p_report_date;
  insert into public.member_content_revisions(
    report_date,report_id,decision_snapshot_id,decision_snapshot_version,revision,
    idempotency_key,status,canonical_contract,member_content,data_quality_status,
    content_score,evidence_coverage,source_revision,generated_at,metadata
  ) values (
    p_report_date,p_report_id,p_decision_snapshot_id,v_snapshot.version,v_revision,
    p_idempotency_key,v_status,p_canonical_contract,p_member_content,
    coalesce(p_canonical_contract->>'data_quality_status','insufficient'),
    p_content_score,p_evidence_coverage,p_source_revision,p_generated_at,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_revision_id;
  insert into public.semantic_coherence_reviews(
    report_date,decision_snapshot_id,member_content_revision_id,gate_version,status,
    reason_codes,conflicting_fields,canonical_snapshot_id,canonical_snapshot_version,
    checked_at,idempotency_key,result
  ) values (
    p_report_date,p_decision_snapshot_id,v_revision_id,v_gate_version,v_status,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'reason_codes','[]'::jsonb))),'{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'conflicting_fields','[]'::jsonb))),'{}'::text[]),
    p_decision_snapshot_id,v_snapshot.version,
    coalesce(nullif(p_semantic_result->>'checked_at','')::timestamptz,now()),
    p_idempotency_key || ':semantic:' || v_gate_version,p_semantic_result
  );
  return v_revision_id;
end;
$$;

create or replace function public.record_content_os_incident_v1(
  p_incident_key text,
  p_business_date date,
  p_snapshot_id uuid,
  p_snapshot_version integer,
  p_reason_codes text[],
  p_http_status integer,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if coalesce(trim(p_incident_key),'') = '' or p_business_date is null then
    raise exception 'content os incident identity is required';
  end if;
  insert into public.content_os_sync_incidents(
    incident_key,business_date,snapshot_id,snapshot_version,status,reason_codes,
    first_seen_at,last_seen_at,attempt_count,last_http_status,metadata
  ) values (
    p_incident_key,p_business_date,p_snapshot_id,p_snapshot_version,'OPEN',
    coalesce(p_reason_codes,'{}'::text[]),now(),now(),1,p_http_status,coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (incident_key) do update set
    status='OPEN', reason_codes=excluded.reason_codes, last_seen_at=now(),
    resolved_at=null, attempt_count=public.content_os_sync_incidents.attempt_count+1,
    last_http_status=excluded.last_http_status, metadata=excluded.metadata, updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resolve_content_os_incident_v1(
  p_incident_key text,
  p_snapshot_version integer,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  update public.content_os_sync_incidents
  set status='RESOLVED',resolved_at=coalesce(resolved_at,now()),last_seen_at=now(),
      snapshot_version=coalesce(p_snapshot_version,snapshot_version),last_http_status=200,
      metadata=metadata || coalesce(p_metadata,'{}'::jsonb),updated_at=now()
  where incident_key=p_incident_key and status='OPEN';
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.record_learning_metric_correction_v1(
  p_learning_run_id uuid,
  p_business_date date,
  p_idempotency_key text,
  p_engine_version text,
  p_original_metrics jsonb,
  p_corrected_metrics jsonb,
  p_authoritative_counts jsonb,
  p_reason_code text,
  p_actor text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.learning_metric_corrections(
    learning_run_id,business_date,idempotency_key,engine_version,original_metrics,
    corrected_metrics,authoritative_counts,reason_code,actor,request_id
  ) values (
    p_learning_run_id,p_business_date,p_idempotency_key,p_engine_version,p_original_metrics,
    p_corrected_metrics,p_authoritative_counts,p_reason_code,p_actor,p_request_id
  ) on conflict (idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.learning_metric_corrections where idempotency_key=p_idempotency_key; end if;
  return v_id;
end;
$$;

create or replace function public.capture_morning_alpha_acceptance_v1(
  p_business_date date,
  p_evaluator_version text default 'PRODUCTION_ACCEPTANCE_V1'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_core record;
  v_semantic text;
  v_report_health boolean;
  v_closing_health boolean;
  v_open_incidents bigint;
  v_blocking text[] := '{}'::text[];
  v_evidence jsonb;
  v_id uuid;
  v_key text := p_business_date::text || ':' || p_evaluator_version;
begin
  if p_business_date is null then raise exception 'business date is required'; end if;
  select * into v_core from public.morning_alpha_reliability_status_v1 where trading_date=p_business_date;
  select semantic_status into v_semantic from public.current_member_content_revisions_v1 where report_date=p_business_date;
  select exists(select 1 from public.ma_ops_runs where check_type='report' and status='passed' and details_json->>'target_date'=p_business_date::text) into v_report_health;
  select exists(select 1 from public.ma_ops_runs where check_type='closing' and status='passed' and details_json->>'target_date'=p_business_date::text) into v_closing_health;
  select count(*) into v_open_incidents from public.content_os_sync_incidents where business_date=p_business_date and status='OPEN';
  if v_core.trading_date is null then v_blocking:=array_append(v_blocking,'RELIABILITY_STATE_MISSING'); end if;
  if coalesce(v_core.current_state,'') <> 'DAY_COMPLETED' then v_blocking:=array_append(v_blocking,'DAY_NOT_COMPLETED'); end if;
  if coalesce(v_core.report_status,'') <> 'GENERATED' then v_blocking:=array_append(v_blocking,'REPORT_NOT_GENERATED'); end if;
  if coalesce(v_core.decision_snapshot_status,'') <> 'READY' then v_blocking:=array_append(v_blocking,'DECISION_NOT_READY'); end if;
  if coalesce(v_core.editorial_status,'') <> 'APPROVED' then v_blocking:=array_append(v_blocking,'EDITORIAL_NOT_APPROVED'); end if;
  if coalesce(v_core.premium_status,'') <> 'ELIGIBLE' then v_blocking:=array_append(v_blocking,'PREMIUM_NOT_ELIGIBLE'); end if;
  if coalesce(v_semantic,'') <> 'PASSED' then v_blocking:=array_append(v_blocking,'SEMANTIC_NOT_PASSED'); end if;
  if coalesce(v_core.content_os_status,'') <> 'PROJECTION_ELIGIBLE' or v_open_incidents > 0 then v_blocking:=array_append(v_blocking,'CONTENT_OS_NOT_HEALTHY'); end if;
  if coalesce(v_core.line_status,'') <> 'SENT' then v_blocking:=array_append(v_blocking,'LINE_NOT_SENT'); end if;
  if coalesce(v_core.closing_status,'') <> 'SUCCEEDED' then v_blocking:=array_append(v_blocking,'CLOSING_NOT_SUCCEEDED'); end if;
  if coalesce(v_core.learning_status,'') <> 'succeeded' then v_blocking:=array_append(v_blocking,'LEARNING_NOT_SUCCEEDED'); end if;
  if coalesce(v_core.dead_letters,0) <> 0 or coalesce(v_core.failed_dispatches,0) <> 0 then v_blocking:=array_append(v_blocking,'RUNTIME_FAILURE_PRESENT'); end if;
  if not v_report_health then v_blocking:=array_append(v_blocking,'PREMARKET_HEALTH_MISSING'); end if;
  if not v_closing_health then v_blocking:=array_append(v_blocking,'CLOSING_HEALTH_MISSING'); end if;
  v_evidence:=jsonb_build_object(
    'reliability_state',to_jsonb(v_core),'semantic_status',v_semantic,
    'report_health',v_report_health,'closing_health',v_closing_health,
    'open_content_os_incidents',v_open_incidents
  );
  insert into public.production_acceptance_results(
    business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence
  ) values (
    p_business_date,p_evaluator_version,v_key,
    case when coalesce(array_length(v_blocking,1),0)=0 then 'PASS' else 'FAIL' end,
    v_blocking,v_evidence
  ) on conflict (idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.production_acceptance_results where idempotency_key=v_key; end if;
  return v_id;
end;
$$;

revoke all on function public.publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb),
  public.record_content_os_incident_v1(text,date,uuid,integer,text[],integer,jsonb),
  public.resolve_content_os_incident_v1(text,integer,jsonb),
  public.record_learning_metric_correction_v1(uuid,date,text,text,jsonb,jsonb,jsonb,text,text,uuid),
  public.capture_morning_alpha_acceptance_v1(date,text)
  from public,anon,authenticated;
grant execute on function public.publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb),
  public.record_content_os_incident_v1(text,date,uuid,integer,text[],integer,jsonb),
  public.resolve_content_os_incident_v1(text,integer,jsonb),
  public.record_learning_metric_correction_v1(uuid,date,text,text,jsonb,jsonb,jsonb,text,text,uuid),
  public.capture_morning_alpha_acceptance_v1(date,text)
  to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='morning-alpha-acceptance-primary') then
    perform cron.unschedule((select jobid from cron.job where jobname='morning-alpha-acceptance-primary' limit 1));
  end if;
  if exists(select 1 from cron.job where jobname='morning-alpha-acceptance-watchdog') then
    perform cron.unschedule((select jobid from cron.job where jobname='morning-alpha-acceptance-watchdog' limit 1));
  end if;
  perform cron.schedule(
    'morning-alpha-acceptance-primary','25 7 * * 1-5',
    $cron$select public.capture_morning_alpha_acceptance_v1((now() at time zone 'Asia/Taipei')::date,'PRODUCTION_ACCEPTANCE_V1_PRIMARY');$cron$
  );
  perform cron.schedule(
    'morning-alpha-acceptance-watchdog','35 7 * * 1-5',
    $cron$select public.capture_morning_alpha_acceptance_v1((now() at time zone 'Asia/Taipei')::date,'PRODUCTION_ACCEPTANCE_V1_WATCHDOG');$cron$
  );
end;
$$;

comment on table public.member_content_revisions is 'Append-only canonical member content. Existing revision bodies are never updated.';
comment on table public.semantic_coherence_reviews is 'Immutable Semantic Coherence Gate evidence for a member content revision.';
comment on table public.content_os_sync_incidents is 'Aggregated Content OS blocking incident; repeated 409 responses increment attempts instead of creating alert storms.';
comment on table public.learning_metric_corrections is 'Append-only correction evidence; original learning run audit rows remain unchanged.';
comment on table public.production_acceptance_results is 'Immutable daily Production Reliability verdict. A later successful day never overwrites a prior failure.';

commit;
