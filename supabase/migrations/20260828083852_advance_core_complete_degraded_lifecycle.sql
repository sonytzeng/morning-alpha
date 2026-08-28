-- A checkpoint may complete its Core/Public obligation while Premium evidence
-- remains degraded. Preserve the DEGRADED label, but allow the lifecycle to
-- advance only when explicit Core completion metadata is present.

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
  v_advances boolean:=false;
  v_core_market_open_jump boolean:=false;
begin
  if p_trading_date is null then raise exception 'trading_date_required'; end if;
  if coalesce(trim(p_checkpoint),'')='' then raise exception 'checkpoint_required'; end if;
  v_state_rank:=case p_state
    when 'SCHEDULED' then 0 when 'PREMARKET_CAPTURED' then 10
    when 'REPORT_GENERATED' then 20 when 'EDITORIAL_APPROVED' then 30
    when 'PREMARKET_DELIVERED' then 40 when 'MARKET_OPEN_CAPTURED' then 50
    when 'CHECKPOINT_0930_CAPTURED' then 60 when 'CHECKPOINT_1030_CAPTURED' then 70
    when 'CHECKPOINT_1300_CAPTURED' then 80 when 'CLOSE_1410_CAPTURED' then 90
    when 'CLOSE_1430_CAPTURED' then 100 when 'CLOSING_VERIFIED' then 110
    when 'FEEDBACK_COMPLETED' then 120 when 'LEARNING_COMPLETED' then 130
    when 'HEALTH_AUDITED' then 140 when 'DAY_COMPLETED' then 150
    when 'MANUAL_CAPTURED' then 0 else null end;
  if v_state_rank is null then raise exception 'invalid_trading_day_state:%',p_state; end if;
  v_status_rank:=case upper(coalesce(p_status,''))
    when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2
    when 'DEGRADED' then 2 when 'SKIPPED' then 2 when 'SUCCEEDED' then 3 else null end;
  if v_status_rank is null then raise exception 'invalid_checkpoint_status:%',p_status; end if;

  v_advances:=upper(p_status)='SUCCEEDED' or (
    upper(p_status)='DEGRADED' and (
      (
        coalesce((p_metadata->>'required_core_complete')::boolean,false)
        and coalesce((p_metadata->>'canonical_complete')::boolean,false)
        and coalesce((p_metadata->>'core_batch_complete')::boolean,false)
      )
      or (
        p_state='CLOSING_VERIFIED'
        and p_metadata->>'closing_verification_status'='direction_completed_data_degraded'
        and coalesce(p_metadata->>'closing_decision_snapshot_id','')<>''
        and coalesce(p_metadata->>'report_id','')<>''
      )
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trading_date::text||':'||p_checkpoint,0));
  select t.state_rank,t.current_state,case upper(coalesce(t.checkpoint_status->p_checkpoint->>'status',''))
    when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2
    when 'DEGRADED' then 2 when 'SKIPPED' then 2 when 'SUCCEEDED' then 3 else -1 end
  into v_existing_rank,v_existing_state,v_existing_status_rank
  from public.trading_day_state t where t.trading_date=p_trading_date for update;

  if v_existing_rank is not null and v_state_rank<v_existing_rank then
    insert into public.runtime_lifecycle_events(trading_date,state,state_rank,checkpoint,status,correlation_id,
      http_dispatch_id,input_fingerprint,output_fingerprint,provider_status,reason_codes,metadata,completed_at)
    values(p_trading_date,p_state,v_state_rank,p_checkpoint,'SKIPPED',p_correlation_id,
      nullif(p_metadata->>'http_dispatch_id','')::uuid,p_metadata->>'input_fingerprint',p_metadata->>'output_fingerprint',
      coalesce(p_metadata->'provider_status','{}'::jsonb),array['STATE_RANK_REGRESSION_BLOCKED'],p_metadata,now())
    on conflict do nothing;
    select * into v_result from public.trading_day_state where trading_date=p_trading_date;
    return v_result;
  end if;

  v_core_market_open_jump:=p_state='MARKET_OPEN_CAPTURED' and v_advances
    and coalesce((p_metadata->>'required_core_complete')::boolean,false)
    and coalesce((p_metadata->>'canonical_complete')::boolean,false);
  if v_advances and v_state_rank>coalesce(v_existing_rank,0)+10 and not v_core_market_open_jump then
    raise exception 'lifecycle_predecessor_not_satisfied: current=%, requested=%',coalesce(v_existing_rank,0),v_state_rank;
  end if;
  v_effective_rank:=case when v_advances then greatest(coalesce(v_existing_rank,0),v_state_rank) else coalesce(v_existing_rank,0) end;
  v_effective_state:=case when v_advances then p_state else coalesce(v_existing_state,'SCHEDULED') end;

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
