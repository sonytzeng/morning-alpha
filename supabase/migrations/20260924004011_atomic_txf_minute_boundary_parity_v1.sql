-- Candidate only. Align the Atomic database TXF time-window predicate with
-- the existing minute-precision Edge contract. This changes no provider
-- mapping, session date, freshness, cardinality, deadline, data, ACL, owner,
-- security, Cron, Auth or RLS.
do $migration$
declare
  v_routine constant regprocedure := 'public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;
  v_baseline constant text := 'e6f6e3804fcfd41b811ea01a575f03e2';
  v_original text := pg_get_functiondef(v_routine);
  v_old_afterhours constant text := $old$and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time <= time '05:00')$old$;
  v_new_afterhours constant text := $new$and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '05:01')$new$;
  v_old_regular constant text := $old$and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time between time '08:45' and time '13:45'$old$;
  v_new_regular constant text := $new$and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time >= time '08:45'
              and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '13:46'$new$;
  v_candidate text;
  v_reverted text;
begin
  v_reverted := replace(replace(v_original,
    v_new_afterhours, v_old_afterhours),
    v_new_regular, v_old_regular);
  if md5(v_reverted) = v_baseline and v_original <> v_reverted then
    return;
  end if;
  if md5(v_original) <> v_baseline then
    raise exception 'ATOMIC_TXF_MINUTE_BOUNDARY_BASELINE_MISMATCH';
  end if;
  if length(v_original) - length(replace(v_original, v_old_afterhours, '')) <> length(v_old_afterhours)
    or length(v_original) - length(replace(v_original, v_old_regular, '')) <> length(v_old_regular) then
    raise exception 'ATOMIC_TXF_MINUTE_BOUNDARY_ANCHOR_MISMATCH';
  end if;

  v_candidate := replace(replace(v_original,
    v_old_afterhours, v_new_afterhours),
    v_old_regular, v_new_regular);
  execute v_candidate;
  if pg_get_functiondef(v_routine) <> v_candidate then
    raise exception 'ATOMIC_TXF_MINUTE_BOUNDARY_CANDIDATE_MISMATCH';
  end if;
end;
$migration$;
