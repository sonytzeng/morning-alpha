-- Durable Morning Alpha 07:30 delivery guarantee.
-- Premium content is fail-closed at 90 points; transient delivery failures are
-- persisted in an outbox and retried by a five-minute Supabase Cron watchdog.

create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.runtime_job_tokens (
  name text primary key,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.runtime_job_tokens enable row level security;
revoke all on table public.runtime_job_tokens from public, anon, authenticated;
grant all on table public.runtime_job_tokens to service_role;

do $$
declare
  v_token text;
begin
  select decrypted_secret
    into v_token
  from vault.decrypted_secrets
  where name = 'morning_alpha_daily_delivery_token'
  order by created_at desc
  limit 1;

  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(
      v_token,
      'morning_alpha_daily_delivery_token',
      'Internal token used only by pg_cron to invoke daily-delivery-orchestrator'
    );
  end if;

  insert into public.runtime_job_tokens (name, token_hash, is_active, updated_at)
  values (
    'morning_alpha_daily_delivery',
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    true,
    now()
  )
  on conflict (name) do update
    set token_hash = excluded.token_hash,
        is_active = true,
        updated_at = now();
end;
$$;

alter table public.pipeline_runs
  add column if not exists decision_snapshot_id uuid
    references public.decision_snapshots(id) on delete set null,
  add column if not exists deadline_at timestamptz,
  add column if not exists delivery_status text
    check (delivery_status is null or delivery_status in ('NOT_DUE', 'PENDING', 'SENT', 'INCIDENT_SENT', 'FAILED')),
  add column if not exists recovery_plan jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists pipeline_runs_snapshot_idx
  on public.pipeline_runs (decision_snapshot_id);

create table if not exists public.line_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  decision_snapshot_id uuid references public.decision_snapshots(id) on delete set null,
  line_subscriber_id uuid not null references public.line_subscribers(id) on delete cascade,
  line_user_id text not null,
  push_type text not null check (push_type in ('daily_report', 'data_incident')),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  next_retry_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, push_type, line_subscriber_id)
);

create index if not exists line_delivery_outbox_snapshot_idx
  on public.line_delivery_outbox (decision_snapshot_id);
create index if not exists line_delivery_outbox_subscriber_idx
  on public.line_delivery_outbox (line_subscriber_id);
create index if not exists line_delivery_outbox_ready_idx
  on public.line_delivery_outbox (report_date, push_type, next_retry_at, created_at)
  where status in ('PENDING', 'PROCESSING');

alter table public.line_delivery_outbox enable row level security;
revoke all on table public.line_delivery_outbox from public, anon, authenticated;
grant all on table public.line_delivery_outbox to service_role;

create or replace function public.claim_line_delivery_outbox_v1(
  p_report_date date,
  p_decision_snapshot_id uuid,
  p_push_type text,
  p_limit integer default 1000,
  p_lease_seconds integer default 180
)
returns setof public.line_delivery_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_report_date is null then
    raise exception 'report_date is required';
  end if;
  if p_push_type not in ('daily_report', 'data_incident') then
    raise exception 'invalid push_type: %', p_push_type;
  end if;

  return query
  with candidates as (
    select outbox.id
    from public.line_delivery_outbox as outbox
    where outbox.report_date = p_report_date
      and outbox.decision_snapshot_id is not distinct from p_decision_snapshot_id
      and outbox.push_type = p_push_type
      and outbox.attempt_count < outbox.max_attempts
      and (
        (outbox.status = 'PENDING' and outbox.next_retry_at <= clock_timestamp())
        or (outbox.status = 'PROCESSING' and outbox.lease_expires_at <= clock_timestamp())
      )
      and exists (
        select 1
        from public.line_subscribers as subscriber
        where subscriber.id = outbox.line_subscriber_id
          and subscriber.is_active = true
      )
    order by outbox.created_at, outbox.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1000), 1000))
  )
  update public.line_delivery_outbox as outbox
    set status = 'PROCESSING',
        attempt_count = outbox.attempt_count + 1,
        lease_expires_at = clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 600))),
        updated_at = clock_timestamp()
  from candidates
  where outbox.id = candidates.id
  returning outbox.*;
end;
$$;

revoke all on function public.claim_line_delivery_outbox_v1(date, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_line_delivery_outbox_v1(date, uuid, text, integer, integer)
  to service_role;

create or replace function public.mark_line_delivery_outbox_v1(
  p_ids uuid[],
  p_status text,
  p_error text default null,
  p_retry_delay_seconds integer default 60
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;
  if p_status not in ('SENT', 'RETRY', 'FAILED') then
    raise exception 'invalid delivery completion status: %', p_status;
  end if;

  update public.line_delivery_outbox as outbox
    set status = case
          when p_status = 'SENT' then 'SENT'
          when p_status = 'FAILED' or outbox.attempt_count >= outbox.max_attempts then 'FAILED'
          else 'PENDING'
        end,
        next_retry_at = case
          when p_status = 'RETRY' and outbox.attempt_count < outbox.max_attempts
            then clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_retry_delay_seconds, 60), 3600)))
          else outbox.next_retry_at
        end,
        lease_expires_at = null,
        last_error = case when p_status = 'SENT' then null else left(coalesce(p_error, 'LINE_DELIVERY_FAILED'), 500) end,
        sent_at = case when p_status = 'SENT' then clock_timestamp() else outbox.sent_at end,
        updated_at = clock_timestamp()
  where outbox.id = any(p_ids)
    and outbox.status = 'PROCESSING';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_line_delivery_outbox_v1(uuid[], text, text, integer)
  from public, anon, authenticated;
grant execute on function public.mark_line_delivery_outbox_v1(uuid[], text, text, integer)
  to service_role;

-- The database is the final guardrail: a PREMARKET snapshot below 90 can never
-- be READY, and an editorial review below 90 can never be APPROVED.
create or replace function public.enforce_decision_snapshot_premium_90_gate_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_type = 'PREMARKET'
    and (
      new.content_score is null
      or new.content_score < 90
      or coalesce(new.decision_mode, 'blocked') not in ('recommendations', 'no_trade')
    )
  then
    new.status := case when coalesce(new.content_score, 0) >= 70 then 'PARTIAL' else 'INSUFFICIENT_DATA' end;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_decision_snapshot_premium_90_gate_v1() from public, anon, authenticated;

create or replace function public.enforce_editorial_review_premium_90_gate_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_status = 'APPROVED'
    and (new.content_score is null or new.content_score < 90)
  then
    new.review_status := case when new.content_score >= 70 then 'DEGRADED' else 'REJECTED' end;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_editorial_review_premium_90_gate_v1() from public, anon, authenticated;

drop trigger if exists decision_snapshots_premium_90_gate on public.decision_snapshots;
create trigger decision_snapshots_premium_90_gate
  before insert or update of status, content_score, decision_mode
  on public.decision_snapshots
  for each row execute function public.enforce_decision_snapshot_premium_90_gate_v1();

drop trigger if exists editorial_reviews_premium_90_gate on public.editorial_reviews;
create trigger editorial_reviews_premium_90_gate
  before insert or update of review_status, content_score
  on public.editorial_reviews
  for each row execute function public.enforce_editorial_review_premium_90_gate_v1();

-- Re-evaluate any rows created before this migration so the invariant is true
-- immediately, not only for future writes.
update public.decision_snapshots
  set status = status
where session_type = 'PREMARKET'
  and is_current = true;

update public.editorial_reviews
  set review_status = review_status
where review_status = 'APPROVED';

create or replace function public.invoke_daily_delivery_tick_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_token
  from vault.decrypted_secrets
  where name = 'morning_alpha_daily_delivery_token'
  order by created_at desc
  limit 1;

  if v_token is null then
    raise exception 'morning_alpha_daily_delivery_token is missing';
  end if;

  select net.http_post(
    url := 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-delivery-orchestrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-daily-delivery-token', v_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_daily_delivery_tick_v1() from public, anon, authenticated;
grant execute on function public.invoke_daily_delivery_tick_v1() to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname = 'morning-alpha-daily-delivery-primary'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'morning-alpha-daily-delivery-primary',
    '0-40/5 23 * * 0-4',
    'select public.invoke_daily_delivery_tick_v1();'
  );
end;
$$;

comment on table public.line_delivery_outbox is
  'Durable, per-subscriber LINE delivery state for retry-safe premium and incident messages.';
comment on function public.invoke_daily_delivery_tick_v1() is
  'Invokes the self-healing 07:00-07:40 Asia/Taipei daily delivery state machine.';
