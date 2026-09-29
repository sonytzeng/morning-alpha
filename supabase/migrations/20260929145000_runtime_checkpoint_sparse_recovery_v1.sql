-- Sony-approved RUNTIME_CHECKPOINT_SPARSE_RECOVERY, 2026-09-29.
-- Only the lifecycle predecessor guard changes. No historical data, Atomic
-- contract, ACL, owner, RLS, function deployment, scheduler or secret changes.
-- Recovery is backed by the existing immutable Atomic ledger, not caller flags.
do $migration$
declare
  v_routine constant regprocedure := 'public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb)'::regprocedure;
  v_predecessor constant text := 'b8499733b0eb7ac12565594aecce9928';
  v_original text := pg_get_functiondef(v_routine);
  v_old_declarations constant text := '  v_core_market_open_jump boolean:=false;';
  v_new_declarations constant text := $new$  v_core_market_open_jump boolean:=false;
  v_sparse_recovery boolean:=false;
  v_sparse_batch public.market_checkpoint_batches;
  v_sparse_integrity jsonb;
  v_sparse_rows jsonb;
  v_sparse_validation jsonb;$new$;
  v_old_guard constant text := $old$  if v_advances and v_state_rank>coalesce(v_existing_rank,0)+10 and not v_core_market_open_jump then
    raise exception 'lifecycle_predecessor_not_satisfied: current=%, requested=%',coalesce(v_existing_rank,0),v_state_rank;
  end if;$old$;
  v_new_guard constant text := $new$  if v_advances and v_state_rank>coalesce(v_existing_rank,0)+10 and not v_core_market_open_jump then
    -- RUNTIME_CHECKPOINT_SPARSE_RECOVERY_V1: terminal earlier failures are
    -- retained verbatim. Never manufacture PREMARKET, Report, LINE or SLA PASS.
    if p_trading_date = (clock_timestamp() at time zone 'Asia/Taipei')::date
      and p_correlation_id is not null
      and p_state = (case p_checkpoint
        when '0930' then 'CHECKPOINT_0930_CAPTURED'
        when '1030' then 'CHECKPOINT_1030_CAPTURED'
        when '1300' then 'CHECKPOINT_1300_CAPTURED'
        when '1410' then 'CLOSE_1410_CAPTURED'
        when '1430' then 'CLOSE_1430_CAPTURED'
      end)
      and exists (
        select 1 from public.trading_day_state t,
          lateral jsonb_each(t.checkpoint_status) prior
        where t.trading_date = p_trading_date
          and upper(prior.value->>'status') in ('FAILED','DEGRADED')
          and case lower(prior.key)
            when 'premarket' then 10 when '0900' then 50 when '0930' then 60
            when '1030' then 70 when '1300' then 80 when '1410' then 90
            when '1430' then 100
          end < v_state_rank
      ) then
      -- Share the Atomic writer lock. The ledger must already exist; the
      -- idempotent validator below cannot enter its INSERT branch.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'market-checkpoint-atomic:'||p_trading_date::text||':'||p_checkpoint,0));
      select * into v_sparse_batch from public.market_checkpoint_batches b
        where b.business_date=p_trading_date and b.checkpoint=p_checkpoint
          and b.status='COMMITTED' for share;
      if found and v_sparse_batch.correlation_id=p_correlation_id
        and p_metadata->'atomic_checkpoint_complete'='true'::jsonb
        and v_sparse_batch.batch_id::text=p_metadata->>'atomic_batch_id'
        and v_sparse_batch.idempotency_key=p_metadata->>'atomic_idempotency_key'
        and v_sparse_batch.expected_provider_count=11
        and v_sparse_batch.committed_provider_count=11
        and (v_sparse_batch.committed_at at time zone 'Asia/Taipei')::date=p_trading_date
        and v_sparse_batch.committed_at<=clock_timestamp() then
        v_sparse_integrity:=public.market_checkpoint_batch_integrity_v1(p_trading_date,p_checkpoint);
        if v_sparse_integrity->>'status'='PASS'
          and v_sparse_integrity->>'mixed_batch_revision_count'='0'
          and not exists (
            select 1 from public.market_checkpoint_snapshots s
            where s.batch_id=v_sparse_batch.batch_id and (
              s.correlation_id is distinct from p_correlation_id
              or s.trading_date is distinct from p_trading_date
              or s.checkpoint is distinct from p_checkpoint
              or s.market_session is distinct from v_sparse_batch.market_session
              or s.idempotency_key is distinct from v_sparse_batch.idempotency_key
              or s.captured_at>clock_timestamp()
              or s.source_timestamp>clock_timestamp()+interval '60 seconds'
            )
          ) then
          select jsonb_agg(jsonb_build_object(
            'provider_key',s.provider_key,'symbol',s.symbol,'value',s.value,
            'change_percent',s.change_percent,'source',s.source,
            'source_timestamp',s.source_timestamp,'captured_at',s.captured_at,'raw',s.raw
          ) order by s.provider_key) into v_sparse_rows
          from public.market_checkpoint_snapshots s where s.batch_id=v_sparse_batch.batch_id;
          -- Reuse the unchanged current DB row/session/freshness contract.
          -- This is strictly an existing-batch replay under the same lock,
          -- not a new commit or a second independently maintained validator.
          v_sparse_validation:=public.commit_market_checkpoint_batch_v1(
            p_trading_date,p_checkpoint,v_sparse_batch.market_session,
            p_correlation_id,v_sparse_batch.idempotency_key,v_sparse_rows);
          v_sparse_recovery:=v_sparse_validation->>'status'='COMMITTED'
            and v_sparse_validation->>'reused'='true'
            and v_sparse_validation->>'row_count'='11'
            and v_sparse_validation->>'batch_id'=v_sparse_batch.batch_id::text
            and v_sparse_validation->>'correlation_id'=p_correlation_id::text;
        end if;
      end if;
    end if;
    if not coalesce(v_sparse_recovery,false) then
      raise exception 'lifecycle_predecessor_not_satisfied: current=%, requested=%',coalesce(v_existing_rank,0),v_state_rank;
    end if;
    p_metadata:=coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'sparse_recovery_contract','RUNTIME_CHECKPOINT_SPARSE_RECOVERY_V1',
      'recovered_from_state_rank',v_existing_rank,
      'sparse_recovery_batch_id',v_sparse_batch.batch_id,
      'reason_codes',coalesce(p_metadata->'reason_codes','[]'::jsonb)
        ||jsonb_build_array('ACCEPTED_BY_SPARSE_RECOVERY'));
  end if;$new$;
  v_reverted text;
  v_candidate text;
  v_catalog_before jsonb;
begin
  v_reverted:=replace(replace(v_original,v_new_declarations,v_old_declarations),v_new_guard,v_old_guard);
  if md5(v_reverted)=v_predecessor and v_original<>v_reverted then return; end if;
  if md5(v_original)<>v_predecessor then
    raise exception 'RUNTIME_SPARSE_RECOVERY_PREDECESSOR_MISMATCH';
  end if;
  if length(v_original)-length(replace(v_original,v_old_declarations,''))<>length(v_old_declarations)
    or length(v_original)-length(replace(v_original,v_old_guard,''))<>length(v_old_guard) then
    raise exception 'RUNTIME_SPARSE_RECOVERY_ANCHOR_MISMATCH';
  end if;
  select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,
    'config',proconfig,'defaults',proargdefaults::text,'result',prorettype)
    into v_catalog_before from pg_proc where oid=v_routine;
  v_candidate:=replace(replace(v_original,v_old_declarations,v_new_declarations),v_old_guard,v_new_guard);
  execute v_candidate;
  if pg_get_functiondef(v_routine)<>v_candidate or v_catalog_before is distinct from (
    select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,
      'config',proconfig,'defaults',proargdefaults::text,'result',prorettype)
    from pg_proc where oid=v_routine
  ) then raise exception 'RUNTIME_SPARSE_RECOVERY_CANDIDATE_MISMATCH'; end if;
end;
$migration$;
