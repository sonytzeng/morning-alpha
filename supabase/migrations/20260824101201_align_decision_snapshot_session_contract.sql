alter table public.research_sessions
  drop constraint if exists research_sessions_session_type_check;

alter table public.research_sessions
  add constraint research_sessions_session_type_check
  check (session_type in (
    'PREMARKET', 'OPEN', 'OPENING', 'MID_MORNING', 'INTRADAY',
    'CLOSE', 'PRE_CLOSE', 'CLOSING', 'POST_CLOSE'
  ));

create or replace function public.publish_decision_snapshot_v2(
  p_report_date date,
  p_session_type text,
  p_report_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_previous public.decision_snapshots%rowtype;
  v_snapshot_id uuid;
  v_fingerprint text;
  v_version integer;
  v_now timestamptz := clock_timestamp();
  v_content_score numeric(5, 2);
  v_content_grade text;
  v_status text;
  v_snapshot_session_type text;
begin
  if p_report_date is null then
    raise exception 'report_date is required';
  end if;
  v_snapshot_session_type := case
    when p_session_type = 'OPEN' then 'OPENING'
    when p_session_type = 'MID_MORNING' then 'INTRADAY'
    when p_session_type = 'CLOSE' then 'CLOSING'
    else p_session_type
  end;
  if v_snapshot_session_type not in ('PREMARKET', 'OPENING', 'INTRADAY', 'PRE_CLOSE', 'CLOSING', 'POST_CLOSE') then
    raise exception 'invalid session_type: %', p_session_type;
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  perform pg_advisory_xact_lock(hashtext(concat(p_report_date::text, ':', v_snapshot_session_type)));

  v_fingerprint := md5(p_payload::text);
  v_content_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_content_grade := coalesce(nullif(p_payload ->> 'content_grade', ''), 'reject');
  v_status := case
    when v_snapshot_session_type = 'CLOSING' then 'FINAL'
    when p_payload ->> 'decision_mode' = 'blocked' then 'INSUFFICIENT_DATA'
    when v_content_score >= 80 then 'READY'
    when v_content_score >= 70 then 'PARTIAL'
    else 'INSUFFICIENT_DATA'
  end;

  select *
    into v_previous
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = v_snapshot_session_type
    and is_current = true
  for update;

  if found and v_previous.snapshot_fingerprint = v_fingerprint then
    return v_previous.id;
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = v_snapshot_session_type;

  insert into public.research_sessions (
    trading_date,
    session_type,
    version,
    status,
    report_mode,
    market_status,
    is_trading_day,
    data_as_of,
    generated_at,
    engine_version,
    idempotency_key,
    input_coverage,
    missing_sources,
    reason_codes
  ) values (
    p_report_date,
    v_snapshot_session_type,
    v_version,
    case
      when v_snapshot_session_type = 'CLOSING' then 'VERIFIED'
      when p_payload ->> 'decision_mode' = 'blocked' then 'REJECTED'
      when v_content_score >= 80 then 'PUBLISHED'
      when v_content_score >= 70 then 'DEGRADED'
      else 'REJECTED'
    end,
    nullif(p_payload ->> 'report_mode', ''),
    nullif(p_payload ->> 'market_status', ''),
    case
      when p_payload ? 'is_trading_day' then (p_payload ->> 'is_trading_day')::boolean
      else null
    end,
    nullif(p_payload ->> 'data_as_of', '')::timestamptz,
    coalesce(nullif(p_payload ->> 'generated_at', '')::timestamptz, v_now),
    nullif(p_payload ->> 'engine_version', ''),
    concat(p_report_date::text, ':', v_snapshot_session_type, ':', v_fingerprint),
    coalesce(p_payload -> 'input_coverage', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'missing_sources', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[])
  )
  on conflict (idempotency_key) do update
    set status = excluded.status,
        data_as_of = excluded.data_as_of,
        reason_codes = excluded.reason_codes
  returning id into v_session_id;

  if v_previous.id is not null then
    update public.decision_snapshots
      set is_current = false,
          valid_until = v_now
    where id = v_previous.id;
  end if;

  insert into public.decision_snapshots (
    report_date,
    session_type,
    version,
    idempotency_key,
    status,
    market_score,
    confidence_score,
    coverage_score,
    action,
    market_regime,
    preferred_sectors,
    watch_sectors,
    blocked_sectors,
    reasons,
    risk_flags,
    invalidation_rules,
    factor_scores,
    source_freshness,
    source_refs,
    generated_text,
    valid_from,
    supersedes_id,
    is_current,
    research_session_id,
    report_id,
    snapshot_fingerprint,
    decision_mode,
    content_score,
    content_grade,
    content_score_breakdown,
    reason_codes,
    generic_content_flags
  ) values (
    p_report_date,
    v_snapshot_session_type,
    v_version,
    concat(p_report_date::text, ':', v_snapshot_session_type, ':', v_fingerprint),
    v_status,
    nullif(p_payload ->> 'market_score', '')::numeric,
    nullif(p_payload ->> 'confidence_score', '')::numeric,
    nullif(p_payload ->> 'coverage_score', '')::numeric,
    nullif(p_payload ->> 'action', ''),
    nullif(p_payload ->> 'market_regime', ''),
    coalesce(p_payload -> 'preferred_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'watch_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'blocked_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'reasons', '[]'::jsonb),
    coalesce(p_payload -> 'risk_flags', '[]'::jsonb),
    coalesce(p_payload -> 'invalidation_rules', '[]'::jsonb),
    coalesce(p_payload -> 'factor_scores', '{}'::jsonb),
    coalesce(p_payload -> 'source_freshness', '{}'::jsonb),
    coalesce(p_payload -> 'source_refs', '[]'::jsonb),
    coalesce(p_payload -> 'generated_text', '{}'::jsonb),
    v_now,
    v_previous.id,
    true,
    v_session_id,
    p_report_id,
    v_fingerprint,
    nullif(p_payload ->> 'decision_mode', ''),
    v_content_score,
    v_content_grade,
    coalesce(p_payload -> 'content_score_breakdown', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'generic_content_flags', '[]'::jsonb))), '{}'::text[])
  )
  returning id into v_snapshot_id;

  if v_snapshot_session_type = 'PREMARKET' then
    insert into public.editorial_reviews (
      research_session_id,
      decision_snapshot_id,
      review_status,
      content_score,
      content_score_breakdown,
      reason_codes,
      generic_content_flags
    ) values (
      v_session_id,
      v_snapshot_id,
      case
        when p_payload ->> 'decision_mode' = 'blocked' then 'REJECTED'
        when v_content_score >= 80 then 'APPROVED'
        when v_content_score >= 70 then 'DEGRADED'
        else 'REJECTED'
      end,
      coalesce(v_content_score, 0),
      coalesce(p_payload -> 'content_score_breakdown', '{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'generic_content_flags', '[]'::jsonb))), '{}'::text[])
    );
  end if;

  return v_snapshot_id;
end;
$$;

revoke all on function public.publish_decision_snapshot_v2(date, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_decision_snapshot_v2(date, text, uuid, jsonb)
  to service_role;

comment on function public.publish_decision_snapshot_v2(date, text, uuid, jsonb) is
  'Idempotently publishes one immutable canonical decision revision and normalizes legacy session names.';
;
