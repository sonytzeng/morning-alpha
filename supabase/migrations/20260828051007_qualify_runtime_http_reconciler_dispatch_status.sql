-- Qualify every runtime dispatch column referenced from the reconciler. The
-- RETURNS TABLE contract exposes an output variable named dispatch_status;
-- leaving the table column unqualified makes PL/pgSQL reject the query as
-- ambiguous before any receipt can be reconciled.

create or replace function public.reconcile_runtime_http_dispatches_v1(
  p_limit integer default 100
)
returns table (
  dispatch_id uuid,
  dispatch_status text,
  http_status integer,
  error_code text
)
language plpgsql
security definer
set search_path = public, net
as $$
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
$$;

revoke all on function public.reconcile_runtime_http_dispatches_v1(integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_runtime_http_dispatches_v1(integer)
  to service_role;
