-- Production schema only; isolated PostgreSQL tests, no production records.
-- Minimal pg_net receipt fixture: no HTTP extension or outbound networking.
create schema net;
create table net._http_response(id bigint primary key,status_code integer,content text,timed_out boolean,error_msg text);
create table public.content_os_sync_incidents (id uuid not null default gen_random_uuid(), incident_key text not null, business_date date not null, snapshot_id uuid, snapshot_version integer, destination text not null default 'morning_alpha_content_os'::text, status text not null default 'OPEN'::text, reason_codes text[] not null default '{}'::text[], first_seen_at timestamp with time zone not null default now(), last_seen_at timestamp with time zone not null default now(), resolved_at timestamp with time zone, attempt_count integer not null default 1, last_http_status integer, metadata jsonb not null default '{}'::jsonb, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
create table public.learning_predictions (id uuid not null default gen_random_uuid(), decision_snapshot_id uuid, report_id uuid, root_prediction_id uuid, supersedes_prediction_id uuid, revision integer not null default 1, idempotency_key text not null, report_date date not null, prediction_at timestamp with time zone not null, analysis_window text not null, prediction_scope text not null, symbol text not null, asset_name text, market text not null default 'TW'::text, sector text, event_id text, thesis text not null, direction text not null, model_confidence numeric(5,2), calibrated_confidence numeric(5,2), calibration_adjustment numeric(5,2) not null default 0, evidence_score numeric(5,2), catalyst_score numeric(5,2), surprise_score numeric(5,2), taiwan_mapping_score numeric(5,2), price_in_score numeric(5,2), risk_score numeric(5,2), expected_horizon text not null, source_refs jsonb not null default '[]'::jsonb, price_at_prediction numeric, benchmark_symbol text not null default 'TAIEX'::text, benchmark_price_at_prediction numeric, sector_benchmark_symbol text, sector_benchmark_price_at_prediction numeric, model_version text, prompt_version text, rule_version text, scoring_version text, data_version text, data_snapshot jsonb not null default '{}'::jsonb, data_quality_status text not null, record_status text not null default 'valid'::text, created_at timestamp with time zone not null default now());
create table public.learning_runs (id uuid not null default gen_random_uuid(), run_date date not null, run_type text not null, idempotency_key text not null, engine_version text not null, started_at timestamp with time zone not null default now(), completed_at timestamp with time zone, status text not null, predictions_processed integer not null default 0, outcomes_updated integer not null default 0, reviews_created integer not null default 0, cases_created integer not null default 0, patterns_updated integer not null default 0, rules_evaluated integer not null default 0, retry_count integer not null default 0, errors jsonb not null default '[]'::jsonb, metadata jsonb not null default '{}'::jsonb, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now(), outcomes_created integer not null default 0, outcomes_unchanged integer not null default 0, reviews_updated integer not null default 0, reviews_unchanged integer not null default 0, cases_unchanged integer not null default 0, skipped_count integer not null default 0, failed_count integer not null default 0);
create table public.line_delivery_outbox (id uuid not null default gen_random_uuid(), report_date date not null, decision_snapshot_id uuid, line_subscriber_id uuid not null, line_user_id text not null, push_type text not null, idempotency_key text not null, payload jsonb not null default '{}'::jsonb, status text not null default 'PENDING'::text, attempt_count integer not null default 0, max_attempts integer not null default 8, next_retry_at timestamp with time zone not null default now(), lease_expires_at timestamp with time zone, last_error text, sent_at timestamp with time zone, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
create table public.ma_ops_recovery_actions (id uuid not null default gen_random_uuid(), run_id uuid, check_id uuid, environment text not null default 'production'::text, action_type text not null, target text not null, idempotency_key text not null, approval_required boolean not null default true, approval_status text not null default 'pending'::text, approved_by uuid, approved_at timestamp with time zone, status text not null default 'pending'::text, before_json jsonb not null default '{}'::jsonb, after_json jsonb not null default '{}'::jsonb, error_message text, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
create table public.ma_ops_runs (id uuid not null default gen_random_uuid(), environment text not null default 'production'::text, check_type text not null, scheduled_for timestamp with time zone, started_at timestamp with time zone not null default now(), completed_at timestamp with time zone, status text not null, severity text not null, summary text, details_json jsonb not null default '{}'::jsonb, recovery_attempted boolean not null default false, recovery_result text, idempotency_key text, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
create table public.market_checkpoint_snapshots (id uuid not null default gen_random_uuid(), checkpoint text not null, trading_date date not null, captured_at timestamp with time zone not null, market_session text not null, symbol text not null, value numeric not null, change_percent numeric, source text not null, source_timestamp timestamp with time zone not null, correlation_id uuid not null, snapshot_version bigint not null, raw jsonb not null default '{}'::jsonb, created_at timestamp with time zone not null default now());
create table public.prediction_outcomes (id uuid not null default gen_random_uuid(), prediction_id uuid not null, horizon text not null, target_session integer not null, target_date date, evaluated_at timestamp with time zone, price_at_prediction numeric, outcome_price numeric, close_price numeric, max_favorable_excursion numeric, max_adverse_excursion numeric, return_percent numeric, benchmark_return_percent numeric, sector_return_percent numeric, abnormal_return_percent numeric, volume_change_percent numeric, thesis_confirmed boolean, direction_correct boolean, timing_correct boolean, outcome_direction text, status text not null default 'pending'::text, data_quality_status text not null default 'insufficient_data'::text, source_refs jsonb not null default '[]'::jsonb, failure_reason text, outcome_version text not null default 'CLE_OUTCOME_V1'::text, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
create table public.production_acceptance_results (id uuid not null default gen_random_uuid(), business_date date not null, evaluator_version text not null, idempotency_key text not null, verdict text not null, blocking_checks text[] not null default '{}'::text[], evidence jsonb not null, evaluated_at timestamp with time zone not null default now(), created_at timestamp with time zone not null default now());
create table public.runtime_dead_letters (id uuid not null default gen_random_uuid(), component text not null, operation text not null, idempotency_key text not null, correlation_id uuid not null, attempt integer not null, max_attempts integer not null, error_code text not null, error_message text, request_payload jsonb not null default '{}'::jsonb, context jsonb not null default '{}'::jsonb, status text not null default 'open'::text, resolved_at timestamp with time zone, created_at timestamp with time zone not null default now());
create table public.runtime_http_dispatch_attempts (id uuid not null default gen_random_uuid(), dispatch_id uuid not null, attempt integer not null, request_id bigint, http_status integer, response_error_code text, response_body jsonb, started_at timestamp with time zone not null default now(), completed_at timestamp with time zone);
create table public.runtime_http_dispatches (id uuid not null default gen_random_uuid(), trading_date date not null, job_name text not null, checkpoint text not null, endpoint text not null, request_id bigint, correlation_id uuid not null default gen_random_uuid(), idempotency_key text not null, dispatch_status text not null default 'SCHEDULED'::text, http_status integer, response_success boolean, response_error_code text, response_body jsonb, request_body jsonb not null default '{}'::jsonb, is_backup boolean not null default false, started_at timestamp with time zone not null default now(), acknowledged_at timestamp with time zone, completed_at timestamp with time zone, retry_count integer not null default 0, max_retries integer not null default 3, next_retry_at timestamp with time zone, deadline_at timestamp with time zone, lease_expires_at timestamp with time zone, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
create table public.trading_day_state (trading_date date not null, current_state text not null, state_rank smallint not null, checkpoint_status jsonb not null default '{}'::jsonb, last_correlation_id uuid, last_metadata jsonb not null default '{}'::jsonb, completed_at timestamp with time zone, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
alter table public.content_os_sync_incidents add constraint content_os_sync_incidents_attempt_count_check CHECK ((attempt_count > 0));
alter table public.content_os_sync_incidents add constraint content_os_sync_incidents_incident_key_key UNIQUE (incident_key);
alter table public.content_os_sync_incidents add constraint content_os_sync_incidents_pkey PRIMARY KEY (id);
alter table public.content_os_sync_incidents add constraint content_os_sync_incidents_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text])));
alter table public.learning_predictions add constraint learning_predictions_analysis_window_check CHECK ((analysis_window = ANY (ARRAY['PREMARKET'::text, 'OPEN'::text, 'MID_MORNING'::text, 'INTRADAY'::text, 'CLOSE'::text])));
alter table public.learning_predictions add constraint learning_predictions_calibrated_confidence_check CHECK (((calibrated_confidence >= (0)::numeric) AND (calibrated_confidence <= (100)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_calibration_adjustment_check CHECK (((calibration_adjustment >= ('-25'::integer)::numeric) AND (calibration_adjustment <= (25)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_catalyst_score_check CHECK (((catalyst_score >= (0)::numeric) AND (catalyst_score <= (100)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_check CHECK ((((revision = 1) AND (root_prediction_id IS NULL) AND (supersedes_prediction_id IS NULL)) OR ((revision > 1) AND (root_prediction_id IS NOT NULL) AND (supersedes_prediction_id IS NOT NULL))));
alter table public.learning_predictions add constraint learning_predictions_data_quality_status_check CHECK ((data_quality_status = ANY (ARRAY['complete'::text, 'degraded'::text, 'insufficient_data'::text, 'provider_failure'::text, 'stale_data'::text, 'incomplete_market_session'::text, 'invalid_prediction'::text])));
alter table public.learning_predictions add constraint learning_predictions_data_snapshot_check CHECK ((jsonb_typeof(data_snapshot) = 'object'::text));
alter table public.learning_predictions add constraint learning_predictions_direction_check CHECK ((direction = ANY (ARRAY['bullish'::text, 'bearish'::text, 'neutral'::text])));
alter table public.learning_predictions add constraint learning_predictions_evidence_score_check CHECK (((evidence_score >= (0)::numeric) AND (evidence_score <= (100)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_idempotency_key_key UNIQUE (idempotency_key);
alter table public.learning_predictions add constraint learning_predictions_model_confidence_check CHECK (((model_confidence >= (0)::numeric) AND (model_confidence <= (100)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_pkey PRIMARY KEY (id);
alter table public.learning_predictions add constraint learning_predictions_prediction_scope_check CHECK ((prediction_scope = ANY (ARRAY['market'::text, 'sector'::text, 'symbol'::text])));
alter table public.learning_predictions add constraint learning_predictions_price_in_score_check CHECK (((price_in_score >= (0)::numeric) AND (price_in_score <= (100)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_record_status_check CHECK ((record_status = ANY (ARRAY['valid'::text, 'invalid'::text])));
alter table public.learning_predictions add constraint learning_predictions_revision_check CHECK ((revision > 0));
alter table public.learning_predictions add constraint learning_predictions_risk_score_check CHECK (((risk_score >= (0)::numeric) AND (risk_score <= (100)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_source_refs_check CHECK ((jsonb_typeof(source_refs) = 'array'::text));
alter table public.learning_predictions add constraint learning_predictions_surprise_score_check CHECK (((surprise_score >= (0)::numeric) AND (surprise_score <= (100)::numeric)));
alter table public.learning_predictions add constraint learning_predictions_taiwan_mapping_score_check CHECK (((taiwan_mapping_score >= (0)::numeric) AND (taiwan_mapping_score <= (100)::numeric)));
alter table public.learning_runs add constraint learning_runs_cases_created_check CHECK ((cases_created >= 0));
alter table public.learning_runs add constraint learning_runs_cases_unchanged_check CHECK ((cases_unchanged >= 0));
alter table public.learning_runs add constraint learning_runs_errors_check CHECK ((jsonb_typeof(errors) = 'array'::text));
alter table public.learning_runs add constraint learning_runs_failed_count_check CHECK ((failed_count >= 0));
alter table public.learning_runs add constraint learning_runs_idempotency_key_key UNIQUE (idempotency_key);
alter table public.learning_runs add constraint learning_runs_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text));
alter table public.learning_runs add constraint learning_runs_outcomes_created_check CHECK ((outcomes_created >= 0));
alter table public.learning_runs add constraint learning_runs_outcomes_unchanged_check CHECK ((outcomes_unchanged >= 0));
alter table public.learning_runs add constraint learning_runs_outcomes_updated_check CHECK ((outcomes_updated >= 0));
alter table public.learning_runs add constraint learning_runs_patterns_updated_check CHECK ((patterns_updated >= 0));
alter table public.learning_runs add constraint learning_runs_pkey PRIMARY KEY (id);
alter table public.learning_runs add constraint learning_runs_predictions_processed_check CHECK ((predictions_processed >= 0));
alter table public.learning_runs add constraint learning_runs_retry_count_check CHECK ((retry_count >= 0));
alter table public.learning_runs add constraint learning_runs_reviews_created_check CHECK ((reviews_created >= 0));
alter table public.learning_runs add constraint learning_runs_reviews_unchanged_check CHECK ((reviews_unchanged >= 0));
alter table public.learning_runs add constraint learning_runs_reviews_updated_check CHECK ((reviews_updated >= 0));
alter table public.learning_runs add constraint learning_runs_rules_evaluated_check CHECK ((rules_evaluated >= 0));
alter table public.learning_runs add constraint learning_runs_run_type_check CHECK ((run_type = ANY (ARRAY['daily'::text, 'backfill'::text, 'recompute'::text, 'shadow'::text])));
alter table public.learning_runs add constraint learning_runs_skipped_count_check CHECK ((skipped_count >= 0));
alter table public.learning_runs add constraint learning_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'degraded'::text, 'failed'::text, 'skipped'::text])));
alter table public.line_delivery_outbox add constraint line_delivery_outbox_attempt_count_check CHECK ((attempt_count >= 0));
alter table public.line_delivery_outbox add constraint line_delivery_outbox_idempotency_key_key UNIQUE (idempotency_key);
alter table public.line_delivery_outbox add constraint line_delivery_outbox_max_attempts_check CHECK ((max_attempts > 0));
alter table public.line_delivery_outbox add constraint line_delivery_outbox_pkey PRIMARY KEY (id);
alter table public.line_delivery_outbox add constraint line_delivery_outbox_push_type_check CHECK ((push_type = ANY (ARRAY['daily_report'::text, 'data_incident'::text, 'market_closed_typhoon'::text])));
alter table public.line_delivery_outbox add constraint line_delivery_outbox_report_date_push_type_line_subscriber__key UNIQUE (report_date, push_type, line_subscriber_id);
alter table public.line_delivery_outbox add constraint line_delivery_outbox_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'SENT'::text, 'FAILED'::text, 'DEAD_LETTERED'::text])));
alter table public.ma_ops_recovery_actions add constraint ma_ops_recovery_actions_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'not_required'::text])));
alter table public.ma_ops_recovery_actions add constraint ma_ops_recovery_actions_environment_check CHECK ((environment = ANY (ARRAY['production'::text, 'staging'::text, 'development'::text])));
alter table public.ma_ops_recovery_actions add constraint ma_ops_recovery_actions_environment_idempotency_key_key UNIQUE (environment, idempotency_key);
alter table public.ma_ops_recovery_actions add constraint ma_ops_recovery_actions_pkey PRIMARY KEY (id);
alter table public.ma_ops_recovery_actions add constraint ma_ops_recovery_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])));
alter table public.ma_ops_runs add constraint ma_ops_runs_environment_check CHECK ((environment = ANY (ARRAY['production'::text, 'staging'::text, 'development'::text])));
alter table public.ma_ops_runs add constraint ma_ops_runs_idempotency_key_key UNIQUE (idempotency_key);
alter table public.ma_ops_runs add constraint ma_ops_runs_pkey PRIMARY KEY (id);
alter table public.ma_ops_runs add constraint ma_ops_runs_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])));
alter table public.ma_ops_runs add constraint ma_ops_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'passed'::text, 'warning'::text, 'failed'::text, 'skipped'::text])));
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_checkpoint_check CHECK ((checkpoint ~ '^[A-Z0-9_]{2,40}$'::text));
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_correlation_id_checkpoint_symbo_key UNIQUE (correlation_id, checkpoint, symbol);
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_market_session_check CHECK ((market_session = ANY (ARRAY['premarket'::text, 'intraday'::text, 'close'::text, 'recovery'::text])));
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_pkey PRIMARY KEY (id);
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_raw_check CHECK ((jsonb_typeof(raw) = 'object'::text));
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_snapshot_version_key UNIQUE (snapshot_version);
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_source_check CHECK (((length(TRIM(BOTH FROM source)) >= 1) AND (length(TRIM(BOTH FROM source)) <= 120)));
alter table public.market_checkpoint_snapshots add constraint market_checkpoint_snapshots_symbol_check CHECK (((length(TRIM(BOTH FROM symbol)) >= 1) AND (length(TRIM(BOTH FROM symbol)) <= 40)));
alter table public.prediction_outcomes add constraint prediction_outcomes_data_quality_status_check CHECK ((data_quality_status = ANY (ARRAY['complete'::text, 'degraded'::text, 'insufficient_data'::text, 'provider_failure'::text, 'stale_data'::text, 'incomplete_market_session'::text, 'invalid_prediction'::text])));
alter table public.prediction_outcomes add constraint prediction_outcomes_horizon_check CHECK ((horizon = ANY (ARRAY['intraday'::text, 'close'::text, '1D'::text, '3D'::text, '5D'::text, '10D'::text, '20D'::text])));
alter table public.prediction_outcomes add constraint prediction_outcomes_outcome_direction_check CHECK (((outcome_direction IS NULL) OR (outcome_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text]))));
alter table public.prediction_outcomes add constraint prediction_outcomes_pkey PRIMARY KEY (id);
alter table public.prediction_outcomes add constraint prediction_outcomes_prediction_id_horizon_key UNIQUE (prediction_id, horizon);
alter table public.prediction_outcomes add constraint prediction_outcomes_source_refs_check CHECK ((jsonb_typeof(source_refs) = 'array'::text));
alter table public.prediction_outcomes add constraint prediction_outcomes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'inconclusive'::text, 'insufficient_data'::text, 'provider_failure'::text, 'stale_data'::text])));
alter table public.prediction_outcomes add constraint prediction_outcomes_target_session_check CHECK ((target_session >= 0));
alter table public.production_acceptance_results add constraint production_acceptance_results_business_date_evaluator_versi_key UNIQUE (business_date, evaluator_version);
alter table public.production_acceptance_results add constraint production_acceptance_results_idempotency_key_key UNIQUE (idempotency_key);
alter table public.production_acceptance_results add constraint production_acceptance_results_pkey PRIMARY KEY (id);
alter table public.production_acceptance_results add constraint production_acceptance_results_verdict_check CHECK ((verdict = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'NOT_DUE'::text])));
alter table public.runtime_dead_letters add constraint runtime_dead_letters_attempt_check CHECK ((attempt > 0));
alter table public.runtime_dead_letters add constraint runtime_dead_letters_component_idempotency_key_attempt_key UNIQUE (component, idempotency_key, attempt);
alter table public.runtime_dead_letters add constraint runtime_dead_letters_context_check CHECK ((jsonb_typeof(context) = 'object'::text));
alter table public.runtime_dead_letters add constraint runtime_dead_letters_max_attempts_check CHECK ((max_attempts > 0));
alter table public.runtime_dead_letters add constraint runtime_dead_letters_pkey PRIMARY KEY (id);
alter table public.runtime_dead_letters add constraint runtime_dead_letters_request_payload_check CHECK ((jsonb_typeof(request_payload) = 'object'::text));
alter table public.runtime_dead_letters add constraint runtime_dead_letters_status_check CHECK ((status = ANY (ARRAY['open'::text, 'replayed'::text, 'resolved'::text, 'ignored'::text])));
alter table public.runtime_http_dispatch_attempts add constraint runtime_http_dispatch_attempts_attempt_check CHECK ((attempt > 0));
alter table public.runtime_http_dispatch_attempts add constraint runtime_http_dispatch_attempts_dispatch_id_attempt_key UNIQUE (dispatch_id, attempt);
alter table public.runtime_http_dispatch_attempts add constraint runtime_http_dispatch_attempts_pkey PRIMARY KEY (id);
alter table public.runtime_http_dispatches add constraint runtime_http_dispatches_dispatch_status_check CHECK ((dispatch_status = ANY (ARRAY['SCHEDULED'::text, 'DISPATCHED'::text, 'ACKNOWLEDGED'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'TIMED_OUT'::text, 'DEAD_LETTERED'::text, 'SKIPPED'::text])));
alter table public.runtime_http_dispatches add constraint runtime_http_dispatches_idempotency_key_key UNIQUE (idempotency_key);
alter table public.runtime_http_dispatches add constraint runtime_http_dispatches_max_retries_check CHECK (((max_retries >= 0) AND (max_retries <= 8)));
alter table public.runtime_http_dispatches add constraint runtime_http_dispatches_pkey PRIMARY KEY (id);
alter table public.runtime_http_dispatches add constraint runtime_http_dispatches_retry_count_check CHECK ((retry_count >= 0));
alter table public.trading_day_state add constraint trading_day_state_checkpoint_status_check CHECK ((jsonb_typeof(checkpoint_status) = 'object'::text));
alter table public.trading_day_state add constraint trading_day_state_last_metadata_check CHECK ((jsonb_typeof(last_metadata) = 'object'::text));
alter table public.trading_day_state add constraint trading_day_state_pkey PRIMARY KEY (trading_date);
alter table public.trading_day_state add constraint trading_day_state_state_rank_check CHECK (((state_rank >= 0) AND (state_rank <= 150)));

-- Existing Production RPC definitions captured read-only on 2026-09-07.
-- Isolated test baseline only: instantiate, then REPLACE via the candidate
-- migration twice. Never invoke these baseline routines against Production.
-- This catches return-type/security/ACL drift that an empty-schema test misses.
CREATE OR REPLACE FUNCTION public.capture_morning_alpha_acceptance_v1(p_business_date date, p_evaluator_version text DEFAULT 'PRODUCTION_ACCEPTANCE_V1'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_runtime_http_dispatches_v1(p_limit integer DEFAULT 100)
 RETURNS TABLE(dispatch_id uuid, dispatch_status text, http_status integer, error_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
declare
  v_row record;
  v_retry public.runtime_http_dispatches;
  v_response record;
  v_payload jsonb;
  v_success boolean;
  v_status text;
  v_error text;
  v_state_rank smallint;
begin
  for v_retry in
    select dispatches.*
    from public.runtime_http_dispatches as dispatches
    where dispatches.dispatch_status in ('FAILED', 'TIMED_OUT')
      and dispatches.next_retry_at <= now()
    order by dispatches.next_retry_at
    for update of dispatches skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    if v_retry.retry_count >= v_retry.max_retries
      or (v_retry.deadline_at is not null and v_retry.deadline_at < now())
    then
      update public.runtime_http_dispatches as dispatches
      set dispatch_status = 'DEAD_LETTERED',
          completed_at = now(),
          updated_at = now()
      where dispatches.id = v_retry.id;

      insert into public.runtime_dead_letters (
        component,
        operation,
        idempotency_key,
        correlation_id,
        attempt,
        max_attempts,
        error_code,
        error_message,
        context
      )
      values (
        'runtime_http_dispatch',
        v_retry.job_name,
        v_retry.idempotency_key,
        v_retry.correlation_id,
        v_retry.retry_count + 1,
        v_retry.max_retries + 1,
        coalesce(v_retry.response_error_code, 'HTTP_RETRY_EXHAUSTED'),
        'HTTP retry exhausted or deadline elapsed.',
        jsonb_build_object(
          'dispatch_id', v_retry.id,
          'http_status', v_retry.http_status
        )
      )
      on conflict do nothing;
    else
      perform public.dispatch_morning_alpha_runtime_v1(
        v_retry.trading_date,
        v_retry.job_name,
        v_retry.checkpoint,
        v_retry.request_body,
        true,
        v_retry.deadline_at
      );
    end if;
  end loop;

  for v_row in
    select dispatches.*
    from public.runtime_http_dispatches as dispatches
    where dispatches.dispatch_status in ('DISPATCHED', 'ACKNOWLEDGED')
    order by dispatches.created_at
    for update of dispatches skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    select responses.status_code,
           responses.content,
           responses.timed_out,
           responses.error_msg
    into v_response
    from net._http_response as responses
    where responses.id = v_row.request_id;

    if not found then
      if v_row.lease_expires_at <= now() then
        update public.runtime_http_dispatches as dispatches
        set dispatch_status = 'TIMED_OUT',
            response_error_code = 'HTTP_RECEIPT_TIMEOUT',
            next_retry_at = now() + interval '1 minute',
            updated_at = now()
        where dispatches.id = v_row.id;
      else
        update public.runtime_http_dispatches as dispatches
        set dispatch_status = 'ACKNOWLEDGED',
            acknowledged_at = coalesce(dispatches.acknowledged_at, now()),
            updated_at = now()
        where dispatches.id = v_row.id;
      end if;
      continue;
    end if;

    begin
      v_payload := coalesce(v_response.content, '{}')::jsonb;
    exception
      when others then
        v_payload := jsonb_build_object(
          'raw_response',
          left(coalesce(v_response.content, ''), 2000)
        );
    end;

    v_success := v_response.status_code between 200 and 299
      and lower(coalesce(v_payload ->> 'success', v_payload ->> 'ok', 'false')) in ('true', '1');
    v_status := case
      when v_success then 'SUCCEEDED'
      when coalesce(v_response.timed_out, false) then 'TIMED_OUT'
      else 'FAILED'
    end;
    v_error := coalesce(
      v_payload ->> 'error_code',
      v_payload ->> 'error',
      v_response.error_msg,
      case when v_success then null else 'HTTP_BUSINESS_FAILURE' end
    );

    update public.runtime_http_dispatches as dispatches
    set dispatch_status = v_status,
        http_status = v_response.status_code,
        response_success = v_success,
        response_error_code = v_error,
        response_body = v_payload,
        acknowledged_at = coalesce(dispatches.acknowledged_at, now()),
        completed_at = now(),
        next_retry_at = case
          when not v_success
            and (
              coalesce(v_response.timed_out, false)
              or v_response.status_code in (409, 429, 500, 502, 503, 504)
            )
            and dispatches.retry_count < dispatches.max_retries
          then now() + make_interval(
            secs => least(900, 30 * power(2, dispatches.retry_count)::integer)
          )
        end,
        updated_at = now()
    where dispatches.id = v_row.id;

    update public.runtime_http_dispatch_attempts as attempts
    set http_status = v_response.status_code,
        response_error_code = v_error,
        response_body = v_payload,
        completed_at = now()
    where attempts.dispatch_id = v_row.id
      and attempts.request_id = v_row.request_id;

    if v_success and v_row.job_name = 'closing_health' then
      select states.state_rank
      into v_state_rank
      from public.trading_day_state as states
      where states.trading_date = v_row.trading_date;

      if coalesce(v_state_rank, 0) >= 130 then
        perform public.advance_trading_day_state_v1(
          v_row.trading_date,
          'HEALTH_AUDITED',
          'closing_health',
          'SUCCEEDED',
          v_row.correlation_id,
          jsonb_build_object(
            'http_dispatch_id', v_row.id,
            'http_status', v_response.status_code
          )
        );
        perform public.advance_trading_day_state_v1(
          v_row.trading_date,
          'DAY_COMPLETED',
          'day_completed',
          'SUCCEEDED',
          v_row.correlation_id,
          jsonb_build_object(
            'http_dispatch_id', v_row.id,
            'http_status', v_response.status_code
          )
        );
      end if;
    end if;

    if not v_success
      and (
        v_response.status_code in (401, 403)
        or (
          v_response.status_code between 400 and 499
          and v_response.status_code not in (409, 429)
        )
        or v_row.retry_count >= v_row.max_retries
      )
    then
      update public.runtime_http_dispatches as dispatches
      set dispatch_status = 'DEAD_LETTERED',
          completed_at = now(),
          updated_at = now()
      where dispatches.id = v_row.id;

      insert into public.runtime_dead_letters (
        component,
        operation,
        idempotency_key,
        correlation_id,
        attempt,
        max_attempts,
        error_code,
        error_message,
        context
      )
      values (
        'runtime_http_dispatch',
        v_row.job_name,
        v_row.idempotency_key,
        v_row.correlation_id,
        v_row.retry_count + 1,
        v_row.max_retries + 1,
        coalesce(v_error, 'HTTP_BUSINESS_FAILURE'),
        'Final HTTP receipt failed.',
        jsonb_build_object(
          'dispatch_id', v_row.id,
          'http_status', v_response.status_code
        )
      )
      on conflict do nothing;
      v_status := 'DEAD_LETTERED';
    end if;

    dispatch_id := v_row.id;
    dispatch_status := v_status;
    http_status := v_response.status_code;
    error_code := v_error;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_runtime_terminal_failures_v1(p_business_date date, p_correlation_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_core record;
  v_semantic text;
  v_report_health boolean;
  v_closing_health boolean;
  v_open_incidents bigint;
  v_blocking text[] := '{}'::text[];
  v_reconciled integer := 0;
begin
  if p_business_date is null or p_correlation_id is null then
    raise exception 'business date and correlation id are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'morning-alpha-terminal-reconciliation:' || p_business_date::text,
    0
  ));

  select * into v_core
  from public.morning_alpha_reliability_status_v1
  where trading_date = p_business_date;
  select semantic_status into v_semantic
  from public.current_member_content_revisions_v1
  where report_date = p_business_date;
  select exists(
    select 1 from public.ma_ops_runs
    where check_type = 'report' and status = 'passed'
      and details_json->>'target_date' = p_business_date::text
  ) into v_report_health;
  select exists(
    select 1 from public.ma_ops_runs
    where check_type = 'closing' and status = 'passed'
      and details_json->>'target_date' = p_business_date::text
  ) into v_closing_health;
  select count(*) into v_open_incidents
  from public.content_os_sync_incidents
  where business_date = p_business_date and status = 'OPEN';

  if v_core.trading_date is null then v_blocking := array_append(v_blocking, 'RELIABILITY_STATE_MISSING'); end if;
  if coalesce(v_core.current_state, '') <> 'DAY_COMPLETED' then v_blocking := array_append(v_blocking, 'DAY_NOT_COMPLETED'); end if;
  if coalesce(v_core.report_status, '') <> 'GENERATED' then v_blocking := array_append(v_blocking, 'REPORT_NOT_GENERATED'); end if;
  if coalesce(v_core.decision_snapshot_status, '') <> 'READY' then v_blocking := array_append(v_blocking, 'DECISION_NOT_READY'); end if;
  if coalesce(v_core.editorial_status, '') <> 'APPROVED' then v_blocking := array_append(v_blocking, 'EDITORIAL_NOT_APPROVED'); end if;
  if coalesce(v_core.premium_status, '') <> 'ELIGIBLE' then v_blocking := array_append(v_blocking, 'PREMIUM_NOT_ELIGIBLE'); end if;
  if coalesce(v_semantic, '') <> 'PASSED' then v_blocking := array_append(v_blocking, 'SEMANTIC_NOT_PASSED'); end if;
  if coalesce(v_core.content_os_status, '') <> 'PROJECTION_ELIGIBLE' or v_open_incidents > 0 then v_blocking := array_append(v_blocking, 'CONTENT_OS_NOT_HEALTHY'); end if;
  if coalesce(v_core.line_status, '') <> 'SENT' then v_blocking := array_append(v_blocking, 'LINE_NOT_SENT'); end if;
  if coalesce(v_core.closing_status, '') <> 'SUCCEEDED' then v_blocking := array_append(v_blocking, 'CLOSING_NOT_SUCCEEDED'); end if;
  if coalesce(v_core.learning_status, '') <> 'succeeded' then v_blocking := array_append(v_blocking, 'LEARNING_NOT_SUCCEEDED'); end if;
  if coalesce(v_core.dead_letters, 0) <> 0 then v_blocking := array_append(v_blocking, 'DEAD_LETTER_PRESENT'); end if;
  if not v_report_health then v_blocking := array_append(v_blocking, 'PREMARKET_HEALTH_MISSING'); end if;
  if not v_closing_health then v_blocking := array_append(v_blocking, 'CLOSING_HEALTH_MISSING'); end if;

  if coalesce(array_length(v_blocking, 1), 0) > 0 then
    raise exception 'TERMINAL_RECONCILIATION_BLOCKED:%', array_to_string(v_blocking, ',');
  end if;

  update public.runtime_http_dispatches
  set dispatch_status = 'SKIPPED',
      response_error_code = 'SUPERSEDED_BY_DURABLE_STATE',
      response_body = coalesce(response_body, '{}'::jsonb) || jsonb_build_object(
        'terminal_reconciliation', jsonb_build_object(
          'reason_code', 'SUPERSEDED_BY_DURABLE_STATE',
          'correlation_id', p_correlation_id,
          'reconciled_at', now()
        )
      ),
      next_retry_at = null,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where trading_date = p_business_date
    and dispatch_status = 'FAILED';
  get diagnostics v_reconciled = row_count;

  insert into public.runtime_lifecycle_events(
    trading_date, state, state_rank, checkpoint, status, correlation_id,
    reason_codes, metadata, completed_at
  ) values (
    p_business_date, 'DAY_COMPLETED', 150, 'terminal_failure_reconciliation',
    'SUCCEEDED', p_correlation_id, array['SUPERSEDED_BY_DURABLE_STATE'],
    jsonb_build_object('reconciled_dispatches', v_reconciled), now()
  ) on conflict (trading_date, checkpoint, correlation_id, status) do nothing;

  return v_reconciled;
end;
$function$;
revoke all on function public.capture_morning_alpha_acceptance_v1(date,text) from public,anon,authenticated;
grant execute on function public.capture_morning_alpha_acceptance_v1(date,text) to service_role;
revoke all on function public.reconcile_runtime_terminal_failures_v1(date,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_runtime_terminal_failures_v1(date,uuid) to service_role;
revoke all on function public.reconcile_runtime_http_dispatches_v1(integer) from public,anon,authenticated;
grant execute on function public.reconcile_runtime_http_dispatches_v1(integer) to service_role;
