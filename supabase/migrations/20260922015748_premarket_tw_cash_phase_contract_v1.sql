-- Candidate only. This aligns TAIEX/2330 Atomic admission with the shared
-- PREMARKET/INTRADAY/CLOSE session contract. It changes no data, tables, ACL,
-- owner, security, cardinality, idempotency, TXF rules, deadline or Cron.
do $migration$
declare
  v_routine constant regprocedure := 'public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;
  v_baseline constant text := '8f45427f702fd8dc17fa0089089f08e8';
  v_original text := pg_get_functiondef(v_routine);
  v_old_declaration constant text := $old_decl$  v_distinct_count integer;
  v_txf_expected_session_date date;
  v_inserted integer;$old_decl$;
  v_new_declaration constant text := $new_decl$  v_distinct_count integer;
  v_txf_expected_session_date date;
  v_tw_cash_expected_session_date date;
  v_inserted integer;$new_decl$;
  v_old_calendar constant text := $old_calendar$

  if p_checkpoint = 'PREMARKET' then
    v_txf_expected_session_date := p_business_date - 1;
    while extract(isodow from v_txf_expected_session_date) in (6, 7)
      or v_txf_expected_session_date = any(array[
        date '2026-01-01', date '2026-02-16', date '2026-02-17', date '2026-02-18',
        date '2026-02-19', date '2026-02-20', date '2026-02-27', date '2026-04-03',
        date '2026-04-06', date '2026-06-19', date '2026-07-10', date '2026-09-25',
        date '2026-10-09'
      ])
    loop
      v_txf_expected_session_date := v_txf_expected_session_date - 1;
    end loop;
  end if;$old_calendar$;
  v_new_calendar constant text := $new_calendar$

  if p_checkpoint = 'PREMARKET' then
    v_txf_expected_session_date := p_business_date - 1;
    while extract(isodow from v_txf_expected_session_date) in (6, 7)
      or v_txf_expected_session_date = any(array[
        date '2026-01-01', date '2026-02-16', date '2026-02-17', date '2026-02-18',
        date '2026-02-19', date '2026-02-20', date '2026-02-27', date '2026-04-03',
        date '2026-04-06', date '2026-06-19', date '2026-07-10', date '2026-09-25',
        date '2026-10-09'
      ])
    loop
      v_txf_expected_session_date := v_txf_expected_session_date - 1;
    end loop;
  end if;
  v_tw_cash_expected_session_date := case
    when p_market_session = 'premarket' then v_txf_expected_session_date
    else p_business_date
  end;$new_calendar$;
  v_old_guard constant text := $old_guard$or (row_value->'raw'->>'market' = 'TW' and (
        (row_value->>'provider_key' <> 'TXF'
          and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date)
        or (row_value->>'provider_key' = 'TXF' and p_checkpoint <> 'PREMARKET'
          and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date)
        or (row_value->>'provider_key' = 'TXF' and p_checkpoint = 'PREMARKET' and (
          v_txf_expected_session_date is null
          or row_value->'raw'->>'txf_session_contract' is distinct from 'TXF_PREMARKET_SESSION_V1'
          or row_value->'raw'->>'txf_expected_previous_trading_date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->>'txf_provider_session_date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->'source_raw'->>'date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->>'txf_session_type' is distinct from row_value->'raw'->'source_raw'->>'session'
          or coalesce(row_value->'raw'->'source_raw'->>'session', '') not in ('afterhours', 'regular')
          or not case row_value->'raw'->'source_raw'->>'session'
            when 'afterhours' then
              (((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date
                and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time >= time '15:00')
              or (((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date + 1
                and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time <= time '05:00')
            when 'regular' then
              ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date
              and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time between time '08:45' and time '13:45'
            else false
          end
        ))
      ))$old_guard$;
  v_new_guard constant text := $new_guard$or (row_value->'raw'->>'market' = 'TW' and (
        (row_value->>'provider_key' in ('TAIEX', '2330') and (
          v_tw_cash_expected_session_date is null
          or (p_market_session = 'premarket' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_PREMARKET_LATEST_COMPLETED_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'premarket'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from v_tw_cash_expected_session_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from v_tw_cash_expected_session_date::text
            or coalesce(row_value->'raw'->'source_raw'->>'response_date', row_value->'raw'->'source_raw'->>'date') is distinct from v_tw_cash_expected_session_date::text
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> v_tw_cash_expected_session_date
          ))
          or (p_market_session = 'intraday' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_INTRADAY_CURRENT_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'intraday'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from p_business_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from p_business_date::text
            or coalesce(row_value->'raw'->'source_raw'->>'response_date', row_value->'raw'->'source_raw'->>'date') is distinct from p_business_date::text
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '09:00'
          ))
          or (p_market_session = 'close' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_CLOSE_CURRENT_COMPLETED_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'close'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from p_business_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from p_business_date::text
            or coalesce(row_value->'raw'->'source_raw'->>'response_date', row_value->'raw'->'source_raw'->>'date') is distinct from p_business_date::text
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '13:25'
          ))
          or (p_market_session not in ('premarket', 'intraday', 'close')
            and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date)
        ))
        or (row_value->>'provider_key' = 'TXF' and p_checkpoint <> 'PREMARKET'
          and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date)
        or (row_value->>'provider_key' = 'TXF' and p_checkpoint = 'PREMARKET' and (
          v_txf_expected_session_date is null
          or row_value->'raw'->>'txf_session_contract' is distinct from 'TXF_PREMARKET_SESSION_V1'
          or row_value->'raw'->>'txf_expected_previous_trading_date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->>'txf_provider_session_date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->'source_raw'->>'date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->>'txf_session_type' is distinct from row_value->'raw'->'source_raw'->>'session'
          or coalesce(row_value->'raw'->'source_raw'->>'session', '') not in ('afterhours', 'regular')
          or not case row_value->'raw'->'source_raw'->>'session'
            when 'afterhours' then
              (((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date
                and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time >= time '15:00')
              or (((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date + 1
                and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time <= time '05:00')
            when 'regular' then
              ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date
              and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time between time '08:45' and time '13:45'
            else false
          end
        ))
      ))$new_guard$;
  v_candidate text;
  v_reverted text;
begin
  v_reverted := replace(replace(replace(v_original,
    v_new_guard, v_old_guard),
    v_new_calendar, v_old_calendar),
    v_new_declaration, v_old_declaration);
  if md5(v_reverted) = v_baseline and v_original <> v_reverted then
    return;
  end if;
  if md5(v_original) <> v_baseline then
    raise exception 'PREMARKET_TW_CASH_PHASE_BASELINE_MISMATCH';
  end if;
  if length(v_original) - length(replace(v_original, v_old_declaration, '')) <> length(v_old_declaration)
    or length(v_original) - length(replace(v_original, v_old_calendar, '')) <> length(v_old_calendar)
    or length(v_original) - length(replace(v_original, v_old_guard, '')) <> length(v_old_guard) then
    raise exception 'PREMARKET_TW_CASH_PHASE_ANCHOR_MISMATCH';
  end if;

  v_candidate := replace(replace(replace(v_original,
    v_old_declaration, v_new_declaration),
    v_old_calendar, v_new_calendar),
    v_old_guard, v_new_guard);
  execute v_candidate;
  if pg_get_functiondef(v_routine) <> v_candidate then
    raise exception 'PREMARKET_TW_CASH_PHASE_CANDIDATE_MISMATCH';
  end if;
end;
$migration$;
