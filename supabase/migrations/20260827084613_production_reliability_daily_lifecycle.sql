-- Morning Alpha production reliability: authoritative lifecycle, HTTP receipts,
-- retry evidence, and append-only replay artifacts. This migration contains no
-- credentials and is backward compatible with the existing v1 wrappers.

create table if not exists public.runtime_http_dispatches (
  id uuid primary key default gen_random_uuid(),
  trading_date date not null,
  job_name text not null,
  checkpoint text not null,
  endpoint text not null,
  request_id bigint,
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text not null unique,
  dispatch_status text not null default 'SCHEDULED'
    check (dispatch_status in ('SCHEDULED','DISPATCHED','ACKNOWLEDGED','SUCCEEDED','FAILED','TIMED_OUT','DEAD_LETTERED','SKIPPED')),
  http_status integer,
  response_success boolean,
  response_error_code text,
  response_body jsonb,
  request_body jsonb not null default '{}'::jsonb,
  is_backup boolean not null default false,
  started_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  max_retries integer not null default 3 check (max_retries between 0 and 8),
  next_retry_at timestamptz,
  deadline_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists runtime_http_dispatches_reconcile_idx
  on public.runtime_http_dispatches (dispatch_status, created_at)
  where dispatch_status in ('DISPATCHED','ACKNOWLEDGED');
create index if not exists runtime_http_dispatches_retry_idx
  on public.runtime_http_dispatches (dispatch_status, next_retry_at)
  where dispatch_status in ('FAILED','TIMED_OUT');

create table if not exists public.runtime_http_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.runtime_http_dispatches(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  request_id bigint,
  http_status integer,
  response_error_code text,
  response_body jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (dispatch_id, attempt)
);

create table if not exists public.runtime_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  trading_date date not null,
  state text not null,
  state_rank smallint not null,
  checkpoint text not null,
  status text not null check (status in ('SCHEDULED','RUNNING','SUCCEEDED','DEGRADED','FAILED','SKIPPED')),
  correlation_id uuid,
  http_dispatch_id uuid references public.runtime_http_dispatches(id) on delete set null,
  input_fingerprint text,
  output_fingerprint text,
  provider_status jsonb not null default '{}'::jsonb,
  reason_codes text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trading_date, checkpoint, correlation_id, status)
);
create index if not exists runtime_lifecycle_events_date_rank_idx
  on public.runtime_lifecycle_events (trading_date desc, state_rank, created_at);

create table if not exists public.runtime_replay_artifacts (
  id uuid primary key default gen_random_uuid(),
  replay_run_id uuid not null,
  trading_date date not null,
  scenario text not null,
  result text not null check (result in ('PASS','FAIL','BLOCKED')),
  production_writes integer not null default 0 check (production_writes = 0),
  notifications_sent integer not null default 0 check (notifications_sent = 0),
  artifact jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (replay_run_id, trading_date, scenario)
);

alter table public.learning_runs
  add column if not exists outcomes_created integer not null default 0 check (outcomes_created >= 0),
  add column if not exists outcomes_unchanged integer not null default 0 check (outcomes_unchanged >= 0),
  add column if not exists reviews_updated integer not null default 0 check (reviews_updated >= 0),
  add column if not exists reviews_unchanged integer not null default 0 check (reviews_unchanged >= 0),
  add column if not exists cases_unchanged integer not null default 0 check (cases_unchanged >= 0),
  add column if not exists skipped_count integer not null default 0 check (skipped_count >= 0),
  add column if not exists failed_count integer not null default 0 check (failed_count >= 0);

-- Expand the authoritative lifecycle rank contract without changing any state label.
alter table public.trading_day_state drop constraint if exists trading_day_state_state_rank_check;
alter table public.trading_day_state add constraint trading_day_state_state_rank_check
  check (state_rank between 0 and 150);

create unique index if not exists editorial_reviews_snapshot_gate_uidx
  on public.editorial_reviews (decision_snapshot_id)
  where decision_snapshot_id is not null;

alter table public.line_delivery_outbox drop constraint if exists line_delivery_outbox_push_type_check;
alter table public.line_delivery_outbox add constraint line_delivery_outbox_push_type_check
  check (push_type in ('daily_report','data_incident','market_closed_typhoon'));

alter table public.line_delivery_outbox drop constraint if exists line_delivery_outbox_status_check;
alter table public.line_delivery_outbox add constraint line_delivery_outbox_status_check
  check (status in ('PENDING','PROCESSING','SENT','FAILED','DEAD_LETTERED'));

alter table public.runtime_http_dispatches enable row level security;
alter table public.runtime_http_dispatches force row level security;
alter table public.runtime_http_dispatch_attempts enable row level security;
alter table public.runtime_http_dispatch_attempts force row level security;
alter table public.runtime_lifecycle_events enable row level security;
alter table public.runtime_lifecycle_events force row level security;
alter table public.runtime_replay_artifacts enable row level security;
alter table public.runtime_replay_artifacts force row level security;
revoke all on public.runtime_http_dispatches, public.runtime_http_dispatch_attempts,
  public.runtime_lifecycle_events, public.runtime_replay_artifacts from public, anon, authenticated;
grant all on public.runtime_http_dispatches, public.runtime_http_dispatch_attempts,
  public.runtime_lifecycle_events, public.runtime_replay_artifacts to service_role;

create or replace function public.advance_trading_day_state_v1(
  p_trading_date date,
  p_state text,
  p_checkpoint text,
  p_status text default 'SUCCEEDED',
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.trading_day_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state_rank smallint;
  v_status_rank smallint;
  v_existing_status_rank smallint;
  v_existing_rank smallint;
  v_existing_state text;
  v_effective_rank smallint;
  v_effective_state text;
  v_result public.trading_day_state;
begin
  if p_trading_date is null then raise exception 'trading_date_required'; end if;
  if coalesce(trim(p_checkpoint),'') = '' then raise exception 'checkpoint_required'; end if;
  v_state_rank := case p_state
    when 'SCHEDULED' then 0 when 'PREMARKET_CAPTURED' then 10
    when 'REPORT_GENERATED' then 20 when 'EDITORIAL_APPROVED' then 30
    when 'PREMARKET_DELIVERED' then 40 when 'MARKET_OPEN_CAPTURED' then 50
    when 'CHECKPOINT_0930_CAPTURED' then 60 when 'CHECKPOINT_1030_CAPTURED' then 70
    when 'CHECKPOINT_1300_CAPTURED' then 80 when 'CLOSE_1410_CAPTURED' then 90
    when 'CLOSE_1430_CAPTURED' then 100 when 'CLOSING_VERIFIED' then 110
    when 'FEEDBACK_COMPLETED' then 120 when 'LEARNING_COMPLETED' then 130
    when 'HEALTH_AUDITED' then 140 when 'DAY_COMPLETED' then 150
    when 'MANUAL_CAPTURED' then 0 else null end;
  if v_state_rank is null then raise exception 'invalid_trading_day_state:%', p_state; end if;
  v_status_rank := case upper(coalesce(p_status,''))
    when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2
    when 'DEGRADED' then 2 when 'SKIPPED' then 2 when 'SUCCEEDED' then 3 else null end;
  if v_status_rank is null then raise exception 'invalid_checkpoint_status:%', p_status; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trading_date::text || ':' || p_checkpoint,0));
  select t.state_rank, t.current_state, case upper(coalesce(t.checkpoint_status -> p_checkpoint ->> 'status',''))
    when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2
    when 'DEGRADED' then 2 when 'SKIPPED' then 2 when 'SUCCEEDED' then 3 else -1 end
    into v_existing_rank, v_existing_state, v_existing_status_rank
  from public.trading_day_state t where t.trading_date=p_trading_date for update;

  if v_existing_rank is not null and v_state_rank < v_existing_rank then
    insert into public.runtime_lifecycle_events(trading_date,state,state_rank,checkpoint,status,correlation_id,
      http_dispatch_id,input_fingerprint,output_fingerprint,provider_status,reason_codes,metadata,completed_at)
    values(p_trading_date,p_state,v_state_rank,p_checkpoint,'SKIPPED',p_correlation_id,
      nullif(p_metadata->>'http_dispatch_id','')::uuid,p_metadata->>'input_fingerprint',p_metadata->>'output_fingerprint',
      coalesce(p_metadata->'provider_status','{}'::jsonb),array['STATE_RANK_REGRESSION_BLOCKED'],p_metadata,now())
    on conflict do nothing;
    select * into v_result from public.trading_day_state where trading_date=p_trading_date;
    return v_result;
  end if;

  if upper(p_status)='SUCCEEDED' and v_state_rank>coalesce(v_existing_rank,0)+10 then
    raise exception 'lifecycle_predecessor_not_satisfied: current=%, requested=%',coalesce(v_existing_rank,0),v_state_rank;
  end if;
  v_effective_rank:=case when upper(p_status)='SUCCEEDED' then greatest(coalesce(v_existing_rank,0),v_state_rank) else coalesce(v_existing_rank,0) end;
  v_effective_state:=case when upper(p_status)='SUCCEEDED' then p_state else coalesce(v_existing_state,'SCHEDULED') end;

  insert into public.trading_day_state as t(trading_date,current_state,state_rank,checkpoint_status,last_correlation_id,last_metadata,completed_at)
  values(p_trading_date,v_effective_state,v_effective_rank,jsonb_build_object(p_checkpoint,jsonb_build_object(
    'status',upper(p_status),'state',p_state,'updated_at',now(),'correlation_id',p_correlation_id,'metadata',coalesce(p_metadata,'{}'::jsonb))),
    p_correlation_id,coalesce(p_metadata,'{}'::jsonb),case when v_effective_rank>=150 then now() end)
  on conflict(trading_date) do update set
    current_state=case when excluded.state_rank>t.state_rank then excluded.current_state else t.current_state end,
    state_rank=greatest(t.state_rank,excluded.state_rank),
    checkpoint_status=case when v_status_rank>coalesce(v_existing_status_rank,-1) then t.checkpoint_status||excluded.checkpoint_status else t.checkpoint_status end,
    last_correlation_id=case when excluded.state_rank>t.state_rank or (excluded.state_rank=t.state_rank and v_status_rank>coalesce(v_existing_status_rank,-1)) then coalesce(excluded.last_correlation_id,t.last_correlation_id) else t.last_correlation_id end,
    last_metadata=case when excluded.state_rank>t.state_rank or (excluded.state_rank=t.state_rank and v_status_rank>coalesce(v_existing_status_rank,-1)) then excluded.last_metadata else t.last_metadata end,
    completed_at=case when greatest(t.state_rank,excluded.state_rank)>=150 then coalesce(t.completed_at,now()) else t.completed_at end,
    updated_at=case when excluded.state_rank>t.state_rank or (excluded.state_rank=t.state_rank and v_status_rank>coalesce(v_existing_status_rank,-1)) then now() else t.updated_at end
  returning * into v_result;

  insert into public.runtime_lifecycle_events(trading_date,state,state_rank,checkpoint,status,correlation_id,
    http_dispatch_id,input_fingerprint,output_fingerprint,provider_status,reason_codes,metadata,completed_at)
  values(p_trading_date,p_state,v_state_rank,p_checkpoint,upper(p_status),p_correlation_id,
    nullif(p_metadata->>'http_dispatch_id','')::uuid,p_metadata->>'input_fingerprint',p_metadata->>'output_fingerprint',
    coalesce(p_metadata->'provider_status','{}'::jsonb),coalesce(array(select jsonb_array_elements_text(coalesce(p_metadata->'reason_codes','[]'::jsonb))),'{}'::text[]),p_metadata,
    case when upper(p_status) in ('SUCCEEDED','DEGRADED','FAILED','SKIPPED') then now() end)
  on conflict do nothing;
  return v_result;
end;
$$;
revoke all on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb) to service_role;

-- Deterministically translate legacy rank numbers to the expanded contract. The
-- lifecycle label and historical checkpoint evidence remain unchanged.
update public.trading_day_state
set state_rank = case current_state
  when 'SCHEDULED' then 0 when 'PREMARKET_CAPTURED' then 10
  when 'REPORT_GENERATED' then 20 when 'EDITORIAL_APPROVED' then 30
  when 'PREMARKET_DELIVERED' then 40 when 'MARKET_OPEN_CAPTURED' then 50
  when 'CHECKPOINT_0930_CAPTURED' then 60 when 'CHECKPOINT_1030_CAPTURED' then 70
  when 'CHECKPOINT_1300_CAPTURED' then 80 when 'CLOSE_1410_CAPTURED' then 90
  when 'CLOSE_1430_CAPTURED' then 100 when 'CLOSING_VERIFIED' then 110
  when 'FEEDBACK_COMPLETED' then 120 when 'LEARNING_COMPLETED' then 130
  when 'HEALTH_AUDITED' then 140 when 'DAY_COMPLETED' then 150
  when 'MANUAL_CAPTURED' then 0 else state_rank end
where state_rank is distinct from case current_state
  when 'SCHEDULED' then 0 when 'PREMARKET_CAPTURED' then 10
  when 'REPORT_GENERATED' then 20 when 'EDITORIAL_APPROVED' then 30
  when 'PREMARKET_DELIVERED' then 40 when 'MARKET_OPEN_CAPTURED' then 50
  when 'CHECKPOINT_0930_CAPTURED' then 60 when 'CHECKPOINT_1030_CAPTURED' then 70
  when 'CHECKPOINT_1300_CAPTURED' then 80 when 'CLOSE_1410_CAPTURED' then 90
  when 'CLOSE_1430_CAPTURED' then 100 when 'CLOSING_VERIFIED' then 110
  when 'FEEDBACK_COMPLETED' then 120 when 'LEARNING_COMPLETED' then 130
  when 'HEALTH_AUDITED' then 140 when 'DAY_COMPLETED' then 150
  when 'MANUAL_CAPTURED' then 0 else state_rank end;

create or replace function public.dispatch_morning_alpha_runtime_v1(
  p_trading_date date,
  p_job_name text,
  p_checkpoint text,
  p_body jsonb,
  p_is_backup boolean default false,
  p_deadline_at timestamptz default null
)
returns public.runtime_http_dispatches
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_token text; v_dispatch public.runtime_http_dispatches; v_request_id bigint;
  v_idempotency text; v_corr uuid := gen_random_uuid(); v_completed boolean := false;
begin
  if p_trading_date is null then raise exception 'trading_date_required'; end if;
  if p_job_name not in ('daily_delivery','runtime_checkpoint','continuous_learning','report_health','closing_health') then raise exception 'unsupported_job:%',p_job_name; end if;
  v_idempotency := p_trading_date::text||':'||p_job_name||':'||p_checkpoint;
  perform pg_advisory_xact_lock(hashtextextended(v_idempotency,0));
  select * into v_dispatch from public.runtime_http_dispatches where idempotency_key=v_idempotency for update;
  if v_dispatch.id is not null and v_dispatch.dispatch_status in ('SUCCEEDED','SKIPPED') then return v_dispatch; end if;
  if v_dispatch.id is not null and v_dispatch.dispatch_status in ('DISPATCHED','ACKNOWLEDGED') and v_dispatch.lease_expires_at>now() then return v_dispatch; end if;
  if p_is_backup then
    select upper(coalesce(t.checkpoint_status->p_checkpoint->>'status',''))='SUCCEEDED' into v_completed
    from public.trading_day_state t where t.trading_date=p_trading_date;
    if coalesce(v_completed,false) then
      insert into public.runtime_http_dispatches(trading_date,job_name,checkpoint,endpoint,correlation_id,idempotency_key,dispatch_status,completed_at)
      values(p_trading_date,p_job_name,p_checkpoint,'daily-delivery-orchestrator',v_corr,v_idempotency,'SKIPPED',now())
      on conflict(idempotency_key) do update set dispatch_status='SKIPPED',completed_at=coalesce(runtime_http_dispatches.completed_at,now()),updated_at=now()
      returning * into v_dispatch;
      return v_dispatch;
    end if;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
  if v_token is null then raise exception 'morning_alpha_daily_delivery_token_missing'; end if;
  insert into public.runtime_http_dispatches(trading_date,job_name,checkpoint,endpoint,correlation_id,idempotency_key,
    dispatch_status,retry_count,next_retry_at,deadline_at,lease_expires_at,request_body,is_backup)
  values(p_trading_date,p_job_name,p_checkpoint,'daily-delivery-orchestrator',v_corr,v_idempotency,'SCHEDULED',0,null,p_deadline_at,now()+interval '11 minutes',coalesce(p_body,'{}'::jsonb),p_is_backup)
  on conflict(idempotency_key) do update set correlation_id=gen_random_uuid(),dispatch_status='SCHEDULED',retry_count=runtime_http_dispatches.retry_count+1,next_retry_at=null,lease_expires_at=now()+interval '11 minutes',request_body=coalesce(p_body,'{}'::jsonb),is_backup=p_is_backup,http_status=null,response_success=null,response_error_code=null,response_body=null,completed_at=null,updated_at=now()
  returning * into v_dispatch;
  select net.http_post(
    url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-delivery-orchestrator',
    headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',v_token),
    body:=coalesce(p_body,'{}'::jsonb)||jsonb_build_object('dispatch_id',v_dispatch.id,'correlation_id',v_dispatch.correlation_id,'source',case when p_is_backup then 'supabase_cron_watchdog' else 'supabase_cron_primary' end),
    timeout_milliseconds:=600000) into v_request_id;
  update public.runtime_http_dispatches set request_id=v_request_id,dispatch_status='DISPATCHED',started_at=now(),updated_at=now() where id=v_dispatch.id returning * into v_dispatch;
  insert into public.runtime_http_dispatch_attempts(dispatch_id,attempt,request_id) values(v_dispatch.id,v_dispatch.retry_count+1,v_request_id) on conflict do nothing;
  perform public.advance_trading_day_state_v1(p_trading_date,'SCHEDULED',p_checkpoint,'SCHEDULED',v_dispatch.correlation_id,jsonb_build_object('http_dispatch_id',v_dispatch.id));
  return v_dispatch;
end;
$$;
revoke all on function public.dispatch_morning_alpha_runtime_v1(date,text,text,jsonb,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.dispatch_morning_alpha_runtime_v1(date,text,text,jsonb,boolean,timestamptz) to service_role;

create or replace function public.reconcile_runtime_http_dispatches_v1(p_limit integer default 100)
returns table(dispatch_id uuid,dispatch_status text,http_status integer,error_code text)
language plpgsql security definer set search_path=public,net as $$
declare v_row record; v_retry public.runtime_http_dispatches; v_response record; v_payload jsonb; v_success boolean; v_status text; v_error text; v_state_rank smallint;
begin
  for v_retry in
    select * from public.runtime_http_dispatches
    where dispatch_status in ('FAILED','TIMED_OUT') and next_retry_at<=now()
    order by next_retry_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),500))
  loop
    if v_retry.retry_count>=v_retry.max_retries or (v_retry.deadline_at is not null and v_retry.deadline_at<now()) then
      update public.runtime_http_dispatches set dispatch_status='DEAD_LETTERED',completed_at=now(),updated_at=now() where id=v_retry.id;
      insert into public.runtime_dead_letters(component,operation,idempotency_key,correlation_id,attempt,max_attempts,error_code,error_message,context)
      values('runtime_http_dispatch',v_retry.job_name,v_retry.idempotency_key,v_retry.correlation_id,v_retry.retry_count+1,v_retry.max_retries+1,coalesce(v_retry.response_error_code,'HTTP_RETRY_EXHAUSTED'),'HTTP retry exhausted or deadline elapsed.',jsonb_build_object('dispatch_id',v_retry.id,'http_status',v_retry.http_status)) on conflict do nothing;
    else
      perform public.dispatch_morning_alpha_runtime_v1(v_retry.trading_date,v_retry.job_name,v_retry.checkpoint,v_retry.request_body,true,v_retry.deadline_at);
    end if;
  end loop;

  for v_row in select * from public.runtime_http_dispatches where dispatch_status in ('DISPATCHED','ACKNOWLEDGED') order by created_at for update skip locked limit greatest(1,least(coalesce(p_limit,100),500)) loop
    select status_code,content,timed_out,error_msg into v_response from net._http_response where id=v_row.request_id;
    if not found then
      if v_row.lease_expires_at<=now() then update public.runtime_http_dispatches set dispatch_status='TIMED_OUT',response_error_code='HTTP_RECEIPT_TIMEOUT',next_retry_at=now()+interval '1 minute',updated_at=now() where id=v_row.id;
      else update public.runtime_http_dispatches set dispatch_status='ACKNOWLEDGED',acknowledged_at=coalesce(acknowledged_at,now()),updated_at=now() where id=v_row.id; end if;
      continue;
    end if;
    begin v_payload:=coalesce(v_response.content,'{}')::jsonb; exception when others then v_payload:=jsonb_build_object('raw_response',left(coalesce(v_response.content,''),2000)); end;
    v_success:=v_response.status_code between 200 and 299 and lower(coalesce(v_payload->>'success',v_payload->>'ok','false')) in ('true','1');
    v_status:=case when v_success then 'SUCCEEDED' when coalesce(v_response.timed_out,false) then 'TIMED_OUT' else 'FAILED' end;
    v_error:=coalesce(v_payload->>'error_code',v_payload->>'error',v_response.error_msg,case when v_success then null else 'HTTP_BUSINESS_FAILURE' end);
    update public.runtime_http_dispatches set dispatch_status=v_status,http_status=v_response.status_code,response_success=v_success,response_error_code=v_error,response_body=v_payload,acknowledged_at=coalesce(acknowledged_at,now()),completed_at=now(),
      next_retry_at=case when not v_success and (coalesce(v_response.timed_out,false) or v_response.status_code in (409,429,500,502,503,504)) and retry_count<max_retries then now()+make_interval(secs=>least(900,30*power(2,retry_count)::integer)) end,updated_at=now() where id=v_row.id;
    update public.runtime_http_dispatch_attempts set http_status=v_response.status_code,response_error_code=v_error,response_body=v_payload,completed_at=now() where dispatch_id=v_row.id and request_id=v_row.request_id;
    if v_success and v_row.job_name='closing_health' then
      select t.state_rank into v_state_rank from public.trading_day_state t where t.trading_date=v_row.trading_date;
      if coalesce(v_state_rank,0)>=130 then
        perform public.advance_trading_day_state_v1(v_row.trading_date,'HEALTH_AUDITED','closing_health','SUCCEEDED',v_row.correlation_id,
          jsonb_build_object('http_dispatch_id',v_row.id,'http_status',v_response.status_code));
        perform public.advance_trading_day_state_v1(v_row.trading_date,'DAY_COMPLETED','day_completed','SUCCEEDED',v_row.correlation_id,
          jsonb_build_object('http_dispatch_id',v_row.id,'http_status',v_response.status_code));
      end if;
    end if;
    if not v_success and (v_response.status_code in (401,403) or (v_response.status_code between 400 and 499 and v_response.status_code not in (409,429)) or v_row.retry_count>=v_row.max_retries) then
      update public.runtime_http_dispatches set dispatch_status='DEAD_LETTERED',completed_at=now(),updated_at=now() where id=v_row.id;
      insert into public.runtime_dead_letters(component,operation,idempotency_key,correlation_id,attempt,max_attempts,error_code,error_message,context)
      values('runtime_http_dispatch',v_row.job_name,v_row.idempotency_key,v_row.correlation_id,v_row.retry_count+1,v_row.max_retries+1,coalesce(v_error,'HTTP_BUSINESS_FAILURE'),'Final HTTP receipt failed.',jsonb_build_object('dispatch_id',v_row.id,'http_status',v_response.status_code)) on conflict do nothing;
      v_status:='DEAD_LETTERED';
    end if;
    dispatch_id:=v_row.id; dispatch_status:=v_status; http_status:=v_response.status_code; error_code:=v_error; return next;
  end loop;
end;
$$;
revoke all on function public.reconcile_runtime_http_dispatches_v1(integer) from public,anon,authenticated;
grant execute on function public.reconcile_runtime_http_dispatches_v1(integer) to service_role;

create or replace view public.morning_alpha_reliability_status_v1
with (security_invoker=true) as
select
  t.trading_date,
  t.current_state,
  t.state_rank,
  t.checkpoint_status,
  t.updated_at,
  case when exists(select 1 from public.reports r where r.report_date=t.trading_date) then 'GENERATED' else 'MISSING' end as report_status,
  coalesce((select ds.status from public.decision_snapshots ds where ds.report_date=t.trading_date and ds.session_type='PREMARKET' and ds.is_current=true limit 1),'MISSING') as decision_snapshot_status,
  coalesce((select er.review_status from public.editorial_reviews er join public.decision_snapshots ds on ds.id=er.decision_snapshot_id where ds.report_date=t.trading_date and ds.session_type='PREMARKET' and ds.is_current=true limit 1),'MISSING') as editorial_status,
  case when exists(
    select 1 from public.decision_snapshots ds
    join public.editorial_reviews er on er.decision_snapshot_id=ds.id
    where ds.report_date=t.trading_date and ds.session_type='PREMARKET' and ds.is_current=true
      and ds.status='READY' and ds.content_score>=90 and ds.decision_mode in ('recommendations','no_trade')
      and er.review_status='APPROVED' and er.content_score>=90
  ) then 'ELIGIBLE' else 'BLOCKED' end as premium_status,
  case
    when exists(select 1 from public.line_delivery_outbox o where o.report_date=t.trading_date and o.status in ('FAILED','DEAD_LETTERED')) then 'FAILED'
    when exists(select 1 from public.line_delivery_outbox o where o.report_date=t.trading_date and o.status in ('PENDING','PROCESSING')) then 'PENDING'
    when exists(select 1 from public.line_delivery_outbox o where o.report_date=t.trading_date and o.status='SENT') then 'SENT'
    else 'NOT_DUE'
  end as line_status,
  case when exists(
    select 1 from public.decision_snapshots ds
    join public.editorial_reviews er on er.decision_snapshot_id=ds.id
    where ds.report_date=t.trading_date and ds.session_type='PREMARKET' and ds.is_current=true
      and ds.status='READY' and ds.content_score>=90 and ds.decision_mode in ('recommendations','no_trade')
      and er.review_status='APPROVED' and er.content_score>=90
  ) then 'PROJECTION_ELIGIBLE' else 'BLOCKED' end as content_os_status,
  coalesce(t.checkpoint_status->'1430'->>'status','NOT_DUE') as closing_status,
  coalesce((select cmr.verification_result from public.close_market_reviews cmr where cmr.report_date=t.trading_date order by cmr.updated_at desc limit 1),'MISSING') as closing_review_status,
  coalesce((select lr.status from public.learning_runs lr where lr.run_date=t.trading_date order by lr.created_at desc limit 1),'NOT_DUE') as learning_status,
  coalesce((select count(*) from public.runtime_http_dispatches d where d.trading_date=t.trading_date and d.dispatch_status='DEAD_LETTERED'),0)
    + coalesce((select count(*) from public.runtime_dead_letters dl where dl.status='open' and dl.context->>'trading_date'=t.trading_date::text),0) as dead_letters,
  coalesce((select count(*) from public.runtime_http_dispatches d where d.trading_date=t.trading_date and d.dispatch_status='FAILED'),0) as failed_dispatches,
  (select max(d.completed_at) from public.runtime_http_dispatches d where d.trading_date=t.trading_date and d.dispatch_status='SUCCEEDED') as last_successful_dispatch,
  (select min(coalesce(d.next_retry_at,d.deadline_at,d.lease_expires_at)) from public.runtime_http_dispatches d where d.trading_date=t.trading_date and d.dispatch_status in ('SCHEDULED','DISPATCHED','ACKNOWLEDGED','FAILED','TIMED_OUT')) as next_scheduled_at,
  exists(select 1 from public.ma_ops_recovery_actions a where a.status='succeeded' and (a.created_at at time zone 'Asia/Taipei')::date=t.trading_date) as recovery_executed
from public.trading_day_state t;
revoke all on public.morning_alpha_reliability_status_v1 from public,anon,authenticated;
grant select on public.morning_alpha_reliability_status_v1 to service_role;

comment on table public.runtime_http_dispatches is 'Durable request/response receipt; pg_net queueing alone is never business success.';
comment on table public.runtime_lifecycle_events is 'Append-only evidence for every Morning Alpha daily lifecycle transition.';
comment on table public.runtime_replay_artifacts is 'Isolated dry replay evidence; constraints prohibit production writes and notifications.';

create or replace function public.claim_line_delivery_outbox_v1(
  p_report_date date, p_decision_snapshot_id uuid, p_push_type text,
  p_limit integer default 1000, p_lease_seconds integer default 180
)
returns setof public.line_delivery_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if p_report_date is null then raise exception 'report_date is required'; end if;
  if p_push_type not in ('daily_report','data_incident','market_closed_typhoon') then raise exception 'invalid push_type: %',p_push_type; end if;
  return query
  with candidates as (
    select o.id from public.line_delivery_outbox o
    where o.report_date=p_report_date
      and o.decision_snapshot_id is not distinct from p_decision_snapshot_id
      and o.push_type=p_push_type and o.attempt_count<o.max_attempts
      and ((o.status='PENDING' and o.next_retry_at<=clock_timestamp())
        or (o.status='PROCESSING' and o.lease_expires_at<=clock_timestamp()))
      and exists(select 1 from public.line_subscribers s where s.id=o.line_subscriber_id and s.is_active=true)
    order by o.created_at,o.id for update skip locked
    limit greatest(1,least(coalesce(p_limit,1000),1000))
  )
  update public.line_delivery_outbox o set status='PROCESSING',attempt_count=o.attempt_count+1,
    lease_expires_at=clock_timestamp()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,180),600))),updated_at=clock_timestamp()
  from candidates where o.id=candidates.id returning o.*;
end;
$$;
revoke all on function public.claim_line_delivery_outbox_v1(date,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_line_delivery_outbox_v1(date,uuid,text,integer,integer) to service_role;

create or replace function public.mark_line_delivery_outbox_v1(
  p_ids uuid[], p_status text, p_error text default null, p_retry_delay_seconds integer default 60
)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if coalesce(array_length(p_ids,1),0)=0 then return 0; end if;
  if p_status not in ('SENT','RETRY','FAILED') then raise exception 'invalid delivery completion status:%',p_status; end if;
  update public.line_delivery_outbox as o set
    status=case when p_status='SENT' then 'SENT' when p_status='FAILED' or o.attempt_count>=o.max_attempts then 'DEAD_LETTERED' else 'PENDING' end,
    next_retry_at=case when p_status='RETRY' and o.attempt_count<o.max_attempts then now()+make_interval(secs=>greatest(15,least(coalesce(p_retry_delay_seconds,60),3600))) else o.next_retry_at end,
    lease_expires_at=null,last_error=case when p_status='SENT' then null else left(coalesce(p_error,'LINE_DELIVERY_FAILED'),500) end,
    sent_at=case when p_status='SENT' then now() else o.sent_at end,updated_at=now()
  where o.id=any(p_ids) and o.status='PROCESSING';
  get diagnostics v_count=row_count; return v_count;
end;
$$;
revoke all on function public.mark_line_delivery_outbox_v1(uuid[],text,text,integer) from public,anon,authenticated;
grant execute on function public.mark_line_delivery_outbox_v1(uuid[],text,text,integer) to service_role;

create or replace function public.invoke_daily_delivery_tick_v2(p_phase text,p_is_backup boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  if p_phase not in ('refresh','generate','repair','deliver','watchdog') then raise exception 'unsupported_daily_phase:%',p_phase; end if;
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(
    v_date,'daily_delivery','daily_'||p_phase,jsonb_build_object('phase',p_phase),p_is_backup,
    (v_date + time '08:45') at time zone 'Asia/Taipei'
  );
  return v_row.id;
end;
$$;
create or replace function public.invoke_runtime_checkpoint_tick_v2(p_checkpoint text,p_is_backup boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  if p_checkpoint not in ('0900','0930','1030','1300','1410','1430') then raise exception 'unsupported_checkpoint:%',p_checkpoint; end if;
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(v_date,'runtime_checkpoint',p_checkpoint,jsonb_build_object('mode','runtime_checkpoint','checkpoint',p_checkpoint),p_is_backup,null);
  return v_row.id;
end;
$$;
create or replace function public.invoke_continuous_learning_tick_v2(p_is_backup boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(v_date,'continuous_learning','continuous_learning',jsonb_build_object('mode','continuous_learning'),p_is_backup,null); return v_row.id;
end;
$$;
create or replace function public.invoke_ma_ops_health_check_v2(p_check_type text,p_is_backup boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  if p_check_type not in ('report','closing') then raise exception 'unsupported_health_check:%',p_check_type; end if;
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(v_date,p_check_type||'_health',p_check_type||'_health',jsonb_build_object('mode','health_check','check_type',p_check_type),p_is_backup,null); return v_row.id;
end;
$$;

revoke all on function public.invoke_daily_delivery_tick_v2(text,boolean),public.invoke_runtime_checkpoint_tick_v2(text,boolean),
  public.invoke_continuous_learning_tick_v2(boolean),public.invoke_ma_ops_health_check_v2(text,boolean) from public,anon,authenticated;
grant execute on function public.invoke_daily_delivery_tick_v2(text,boolean),public.invoke_runtime_checkpoint_tick_v2(text,boolean),
  public.invoke_continuous_learning_tick_v2(boolean),public.invoke_ma_ops_health_check_v2(text,boolean) to service_role;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname like 'morning-alpha-%' loop perform cron.unschedule(j.jobid); end loop;
  perform cron.schedule('morning-alpha-daily-refresh-primary','0 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('refresh',false);$c$);
  perform cron.schedule('morning-alpha-daily-refresh-watchdog','3 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('refresh',true);$c$);
  perform cron.schedule('morning-alpha-daily-generate-primary','5 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('generate',false);$c$);
  perform cron.schedule('morning-alpha-daily-generate-watchdog','8 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('generate',true);$c$);
  perform cron.schedule('morning-alpha-daily-repair-primary','15 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('repair',false);$c$);
  perform cron.schedule('morning-alpha-daily-repair-watchdog','19 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('repair',true);$c$);
  perform cron.schedule('morning-alpha-daily-deliver-primary','23 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('deliver',false);$c$);
  perform cron.schedule('morning-alpha-daily-deliver-watchdog','27 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('deliver',true);$c$);
  perform cron.schedule('morning-alpha-daily-deadline-primary','30 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('watchdog',false);$c$);
  perform cron.schedule('morning-alpha-daily-deadline-watchdog','35 23 * * 0-4',$c$select public.invoke_daily_delivery_tick_v2('watchdog',true);$c$);
  perform cron.schedule('morning-alpha-runtime-0900-primary','0 1 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('0900',false);$c$);
  perform cron.schedule('morning-alpha-runtime-0900-watchdog','5 1 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('0900',true);$c$);
  perform cron.schedule('morning-alpha-runtime-0930-primary','30 1 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('0930',false);$c$);
  perform cron.schedule('morning-alpha-runtime-0930-watchdog','35 1 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('0930',true);$c$);
  perform cron.schedule('morning-alpha-runtime-1030-primary','30 2 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1030',false);$c$);
  perform cron.schedule('morning-alpha-runtime-1030-watchdog','35 2 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1030',true);$c$);
  perform cron.schedule('morning-alpha-runtime-1300-primary','0 5 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1300',false);$c$);
  perform cron.schedule('morning-alpha-runtime-1300-watchdog','5 5 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1300',true);$c$);
  perform cron.schedule('morning-alpha-runtime-1410-primary','10 6 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1410',false);$c$);
  perform cron.schedule('morning-alpha-runtime-1410-watchdog','15 6 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1410',true);$c$);
  perform cron.schedule('morning-alpha-runtime-1430-primary','30 6 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1430',false);$c$);
  perform cron.schedule('morning-alpha-runtime-1430-watchdog','35 6 * * 1-5',$c$select public.invoke_runtime_checkpoint_tick_v2('1430',true);$c$);
  perform cron.schedule('morning-alpha-cle-primary','40 6 * * 1-5','select public.invoke_continuous_learning_tick_v2(false);');
  perform cron.schedule('morning-alpha-cle-watchdog','50 6 * * 1-5','select public.invoke_continuous_learning_tick_v2(true);');
  perform cron.schedule('morning-alpha-report-health-primary','45 0 * * 1-5',$c$select public.invoke_ma_ops_health_check_v2('report',false);$c$);
  perform cron.schedule('morning-alpha-report-health-watchdog','50 0 * * 1-5',$c$select public.invoke_ma_ops_health_check_v2('report',true);$c$);
  perform cron.schedule('morning-alpha-closing-health-primary','10 7 * * 1-5',$c$select public.invoke_ma_ops_health_check_v2('closing',false);$c$);
  perform cron.schedule('morning-alpha-closing-health-watchdog','15 7 * * 1-5',$c$select public.invoke_ma_ops_health_check_v2('closing',true);$c$);
  perform cron.schedule('morning-alpha-http-reconciler','* * * * *','select * from public.reconcile_runtime_http_dispatches_v1(100);');
end;
$$;
