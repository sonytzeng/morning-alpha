begin;

-- A replay run stores one result per prediction. Multiple predictions can
-- legitimately share a report date and decision snapshot, so the older
-- snapshot-level uniqueness rule rejected valid, idempotent replay output.
alter table public.historical_replay_results
  drop constraint if exists historical_replay_results_replay_run_id_report_date_decisio_key;

-- A failed HTTP attempt is not an unresolved production failure after every
-- authoritative business outcome has independently succeeded. Reconcile only
-- at the completed-day boundary, retain the original receipt, and append an
-- explicit lifecycle audit event. No report, decision, delivery, or learning
-- business row is rewritten by this function.
create or replace function public.reconcile_runtime_terminal_failures_v1(
  p_business_date date,
  p_correlation_id uuid
)
returns integer
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
$$;

revoke all on function public.reconcile_runtime_terminal_failures_v1(date, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_runtime_terminal_failures_v1(date, uuid)
  to service_role;

commit;
