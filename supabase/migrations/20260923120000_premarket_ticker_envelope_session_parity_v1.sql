-- Candidate only. Separate the Fugle ticker envelope date from the completed
-- Taiwan cash evidence session used by PREMARKET Atomic admission. This
-- changes no data, tables, ACL, owner, security, cardinality, idempotency,
-- TXF/INTRADAY/CLOSE rules, readiness deadline, SLA, Cron, Auth or RLS.
do $migration$
declare
  v_routine constant regprocedure := 'public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;
  v_baseline constant text := '00fcf28b4af0331b30dd2cea068dc3dc';
  v_original text := pg_get_functiondef(v_routine);
  v_old_guard constant text := $old_guard$or (p_market_session = 'premarket' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_PREMARKET_LATEST_COMPLETED_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'premarket'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from v_tw_cash_expected_session_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from v_tw_cash_expected_session_date::text
            or coalesce(row_value->'raw'->'source_raw'->>'response_date', row_value->'raw'->'source_raw'->>'date') is distinct from v_tw_cash_expected_session_date::text
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> v_tw_cash_expected_session_date
          ))$old_guard$;
  v_new_guard constant text := $new_guard$or (p_market_session = 'premarket' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_PREMARKET_LATEST_COMPLETED_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'premarket'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from v_tw_cash_expected_session_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from v_tw_cash_expected_session_date::text
            or row_value->'raw'->'source_raw'->>'evidence_session_date' is distinct from v_tw_cash_expected_session_date::text
            or coalesce(
              row_value->'raw'->'source_raw'->>'provider_envelope_date',
              row_value->'raw'->'source_raw'->>'response_date',
              row_value->'raw'->'source_raw'->>'date'
            ) not in (v_tw_cash_expected_session_date::text, p_business_date::text)
            or row_value->'raw'->'source_raw'->>'response_date' is distinct from coalesce(
              row_value->'raw'->'source_raw'->>'provider_envelope_date',
              row_value->'raw'->'source_raw'->>'response_date',
              row_value->'raw'->'source_raw'->>'date'
            )
            or row_value->'raw'->'source_raw'->>'date' is distinct from coalesce(
              row_value->'raw'->'source_raw'->>'provider_envelope_date',
              row_value->'raw'->'source_raw'->>'response_date',
              row_value->'raw'->'source_raw'->>'date'
            )
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> v_tw_cash_expected_session_date
          ))$new_guard$;
  v_candidate text;
  v_reverted text;
begin
  v_reverted := replace(v_original, v_new_guard, v_old_guard);
  if md5(v_reverted) = v_baseline and v_original <> v_reverted then
    return;
  end if;
  if md5(v_original) <> v_baseline then
    raise exception 'PREMARKET_TICKER_ENVELOPE_SESSION_BASELINE_MISMATCH';
  end if;
  if length(v_original) - length(replace(v_original, v_old_guard, '')) <> length(v_old_guard) then
    raise exception 'PREMARKET_TICKER_ENVELOPE_SESSION_ANCHOR_MISMATCH';
  end if;

  v_candidate := replace(v_original, v_old_guard, v_new_guard);
  execute v_candidate;
  if pg_get_functiondef(v_routine) <> v_candidate then
    raise exception 'PREMARKET_TICKER_ENVELOPE_SESSION_CANDIDATE_MISMATCH';
  end if;
end;
$migration$;
