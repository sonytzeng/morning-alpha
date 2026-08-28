-- Keep transport failure, Core evidence, Public delivery, and Premium quality
-- as separate contracts. HTTP 409 is a terminal quality block unless a later
-- input revision is explicitly dispatched; it is not an infrastructure dead
-- letter and must not be retried blindly.

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
  v_core_market_open_jump boolean := false;
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

  -- Market evidence is independent of whether an optional notification was
  -- delivered. Permit only the MARKET_OPEN jump, and only with complete Core
  -- evidence; every later checkpoint remains sequential.
  v_core_market_open_jump := p_state='MARKET_OPEN_CAPTURED'
    and upper(p_status)='SUCCEEDED'
    and coalesce((p_metadata->>'required_core_complete')::boolean,false)
    and coalesce((p_metadata->>'canonical_complete')::boolean,false);
  if upper(p_status)='SUCCEEDED'
    and v_state_rank>coalesce(v_existing_rank,0)+10
    and not v_core_market_open_jump
  then
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

revoke all on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb)
  to service_role;

create or replace function public.classify_runtime_quality_block_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.http_status=409 and coalesce(new.response_success,false)=false then
    new.dispatch_status:='FAILED';
    new.response_error_code:='QUALITY_BLOCK';
    new.next_retry_at:=null;
    new.completed_at:=coalesce(new.completed_at,now());
  end if;
  return new;
end;
$$;

drop trigger if exists classify_runtime_quality_block_before_update
  on public.runtime_http_dispatches;
create trigger classify_runtime_quality_block_before_update
before update on public.runtime_http_dispatches
for each row execute function public.classify_runtime_quality_block_v1();

revoke all on function public.classify_runtime_quality_block_v1()
  from public,anon,authenticated;

-- Approved, auditable reconciliation. It never changes a business result to
-- success: exact-time Core evidence advances lifecycle state, 409 responses
-- remain FAILED, and a timed-out refresh is SKIPPED only when superseded by
-- durable premarket + report evidence.
create or replace function public.reconcile_runtime_incidents_v1(
  p_trading_date date,
  p_actor text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idempotency_key text;
  v_existing public.ma_ops_recovery_actions;
  v_before jsonb;
  v_after jsonb;
  v_checkpoint record;
  v_market jsonb;
  v_captured_at timestamptz;
  v_expected_at timestamptz;
  v_correlation_id uuid;
  v_core_reconciled integer:=0;
  v_quality_resolved integer:=0;
  v_refresh_resolved integer:=0;
  v_terminal_failed integer:=0;
  v_open integer:=0;
begin
  if p_trading_date is null then raise exception 'trading_date_required'; end if;
  if coalesce(trim(p_actor),'')='' then raise exception 'recovery_actor_required'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'recovery_reason_required'; end if;
  if p_request_id is null then raise exception 'recovery_request_id_required'; end if;

  v_idempotency_key:='runtime-incident-reconciliation:'||p_trading_date::text||':v1';
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idempotency_key,0));
  select * into v_existing from public.ma_ops_recovery_actions
  where environment='production' and idempotency_key=v_idempotency_key;
  if found and v_existing.status='succeeded' then return v_existing.after_json; end if;

  v_before:=jsonb_build_object(
    'open_dead_letters',(select count(*) from public.runtime_dead_letters where status='open'),
    'failed_dispatches',(select count(*) from public.runtime_http_dispatches where trading_date=p_trading_date and dispatch_status='FAILED'),
    'dead_lettered_dispatches',(select count(*) from public.runtime_http_dispatches where trading_date=p_trading_date and dispatch_status='DEAD_LETTERED')
  );
  insert into public.ma_ops_recovery_actions(environment,action_type,target,idempotency_key,
    approval_required,approval_status,approved_at,status,before_json)
  values('production','reconcile_runtime_incidents','runtime_http_dispatches',v_idempotency_key,
    true,'approved',now(),'running',v_before)
  on conflict(environment,idempotency_key) do update set
    approval_status='approved',approved_at=now(),status='running',before_json=excluded.before_json,
    after_json='{}'::jsonb,error_message=null,updated_at=now();

  for v_checkpoint in
    select * from (values
      ('0900','MARKET_OPEN_CAPTURED',time '09:00'),
      ('0930','CHECKPOINT_0930_CAPTURED',time '09:30'),
      ('1030','CHECKPOINT_1030_CAPTURED',time '10:30'),
      ('1300','CHECKPOINT_1300_CAPTURED',time '13:00'),
      ('1410','CLOSE_1410_CAPTURED',time '14:10'),
      ('1430','CLOSE_1430_CAPTURED',time '14:30')
    ) as checkpoints(checkpoint,state_name,expected_time)
  loop
    select attempts.response_body #> '{results,market,payload}', dispatches.correlation_id
      into v_market,v_correlation_id
    from public.runtime_http_dispatches dispatches
    join public.runtime_http_dispatch_attempts attempts on attempts.dispatch_id=dispatches.id
    where dispatches.trading_date=p_trading_date
      and dispatches.job_name='runtime_checkpoint'
      and dispatches.checkpoint=v_checkpoint.checkpoint
      and attempts.attempt=1
    order by attempts.started_at
    limit 1;

    if v_market is null
      or v_market->>'trading_day_state_status'<>'SUCCEEDED'
      or coalesce((v_market->>'required_core_complete')::boolean,false)=false
      or coalesce((v_market->>'canonical_complete')::boolean,false)=false
      or coalesce((v_market->>'core_batch_complete')::boolean,false)=false
    then
      raise exception 'core_checkpoint_evidence_incomplete:%',v_checkpoint.checkpoint;
    end if;
    v_captured_at:=nullif(v_market->>'started_at','')::timestamptz;
    v_expected_at:=(p_trading_date::timestamp+v_checkpoint.expected_time) at time zone 'Asia/Taipei';
    if v_captured_at<v_expected_at or v_captured_at>=v_expected_at+interval '10 minutes' then
      raise exception 'core_checkpoint_outside_window:%:%',v_checkpoint.checkpoint,v_captured_at;
    end if;

    perform public.advance_trading_day_state_v1(
      p_trading_date,v_checkpoint.state_name,v_checkpoint.checkpoint,'SUCCEEDED',v_correlation_id,
      v_market||jsonb_build_object(
        'reconciliation_source','runtime_http_dispatch_attempts:first_attempt',
        'recovery_request_id',p_request_id,
        'recovery_actor',p_actor,
        'recovery_reason',p_reason,
        'captured_at',v_captured_at
      )
    );
    v_core_reconciled:=v_core_reconciled+1;
  end loop;

  update public.runtime_http_dispatches
  set dispatch_status='FAILED',response_error_code='QUALITY_BLOCK',next_retry_at=null,
      completed_at=coalesce(completed_at,now()),updated_at=now()
  where trading_date=p_trading_date and http_status=409 and coalesce(response_success,false)=false;

  update public.runtime_dead_letters letters
  set status='resolved',resolved_at=now(),context=letters.context||jsonb_build_object(
    'resolution','QUALITY_BLOCK_TERMINAL','recovery_request_id',p_request_id,
    'recovery_actor',p_actor,'reconciled_at',now())
  from public.runtime_http_dispatches dispatches
  where letters.status='open'
    and letters.component='runtime_http_dispatch'
    and letters.context->>'dispatch_id'=dispatches.id::text
    and dispatches.trading_date=p_trading_date
    and dispatches.http_status=409;
  get diagnostics v_quality_resolved=row_count;

  if coalesce((select checkpoint_status->'premarket'->>'status'='SUCCEEDED'
    and checkpoint_status->'report_generation'->>'status'='SUCCEEDED'
    from public.trading_day_state where trading_date=p_trading_date),false)
  then
    update public.runtime_http_dispatches
    set dispatch_status='SKIPPED',response_error_code='SUPERSEDED_BY_DURABLE_STATE',
        next_retry_at=null,completed_at=coalesce(completed_at,now()),updated_at=now()
    where trading_date=p_trading_date and checkpoint='daily_refresh'
      and dispatch_status='DEAD_LETTERED' and response_error_code='HTTP_RECEIPT_TIMEOUT';
    get diagnostics v_refresh_resolved=row_count;

    update public.runtime_dead_letters letters
    set status='resolved',resolved_at=now(),context=letters.context||jsonb_build_object(
      'resolution','SUPERSEDED_BY_DURABLE_STATE','recovery_request_id',p_request_id,
      'recovery_actor',p_actor,'reconciled_at',now())
    from public.runtime_http_dispatches dispatches
    where letters.status='open'
      and letters.component='runtime_http_dispatch'
      and letters.context->>'dispatch_id'=dispatches.id::text
      and dispatches.trading_date=p_trading_date
      and dispatches.checkpoint='daily_refresh';
  end if;

  update public.runtime_http_dispatches
  set response_error_code='QUALITY_GATE_TERMINAL',next_retry_at=null,updated_at=now()
  where trading_date=p_trading_date and job_name='daily_delivery'
    and dispatch_status='FAILED' and http_status between 200 and 299
    and coalesce(response_success,false)=false
    and response_body->>'status'='DEGRADED';
  get diagnostics v_terminal_failed=row_count;

  select count(*) into v_open from public.runtime_dead_letters where status='open';
  if v_open<>0 then raise exception 'open_dead_letters_remain:%',v_open; end if;

  v_after:=jsonb_build_object(
    'trading_date',p_trading_date,'core_checkpoints_reconciled',v_core_reconciled,
    'quality_dead_letters_resolved',v_quality_resolved,
    'refresh_dead_letters_resolved',v_refresh_resolved,
    'failed_dispatches_terminalized',v_terminal_failed,
    'open_dead_letters',v_open,'duplicate_dispatches',(
      select count(*) from (
        select idempotency_key from public.runtime_http_dispatches
        group by idempotency_key having count(*)>1
      ) duplicates
    )
  );
  update public.ma_ops_recovery_actions
  set status='succeeded',after_json=v_after,updated_at=now()
  where environment='production' and idempotency_key=v_idempotency_key;
  return v_after;
end;
$$;

revoke all on function public.reconcile_runtime_incidents_v1(date,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.reconcile_runtime_incidents_v1(date,text,text,uuid)
  to service_role;
