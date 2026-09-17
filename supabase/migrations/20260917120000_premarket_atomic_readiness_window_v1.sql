-- CANDIDATE ONLY. Do not apply to Production without Sony's named approval.
-- Align the immutable 11-row PREMARKET commit with the already deployed 08:45
-- readiness window. Historical dates through 2026-09-17 retain the 07:35 gate.
-- No table, row, grant, provider cardinality, Cron, or other checkpoint changes.
do $migration$
declare
  v_routine constant regprocedure := 'public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;
  v_baseline constant text := '0fc2b7fb85932a72e2f64cf792665a37';
  v_original text := pg_get_functiondef(v_routine);
  v_old_bound constant text := '''T07:35:00+08:00''';
  v_new_bound constant text := 'case when p_business_date <= date ''2026-09-17'' then ''T07:35:00+08:00'' else ''T08:44:59.999999+08:00'' end';
  v_old_before_insert constant text := E'\n  v_batch_id := gen_random_uuid();';
  v_old_before_return constant text := E'\n  return jsonb_build_object(\n    ''contract'', ''MARKET_CHECKPOINT_ATOMIC_COMMIT_V1'',\n    ''status'', ''COMMITTED'',\n    ''reused'', false,';
  v_deadline_guard constant text := E'\n  if p_checkpoint = ''PREMARKET'' and p_business_date > date ''2026-09-17''\n    and clock_timestamp() >= (p_business_date + time ''08:45'') at time zone ''Asia/Taipei'' then\n    raise exception ''PREMARKET_READINESS_DEADLINE_EXCEEDED'';\n  end if;';
  v_new_before_insert text := v_deadline_guard || v_old_before_insert;
  v_new_before_return text := v_deadline_guard || v_old_before_return;
  v_candidate text;
  v_reverted text;
begin
  -- Idempotency is accepted only for the exact transformation of the pinned
  -- Production function. Unknown revisions fail closed instead of being patched.
  v_reverted := replace(replace(replace(v_original,
    v_new_before_return, v_old_before_return),
    v_new_before_insert, v_old_before_insert),
    v_new_bound, v_old_bound);
  if md5(v_reverted) = v_baseline and v_original <> v_reverted then
    return;
  end if;
  if md5(v_original) <> v_baseline then
    raise exception 'PREMARKET_ATOMIC_BASELINE_MISMATCH';
  end if;
  if length(v_original) - length(replace(v_original, v_old_bound, '')) <> length(v_old_bound)
    or length(v_original) - length(replace(v_original, v_old_before_insert, '')) <> length(v_old_before_insert)
    or length(v_original) - length(replace(v_original, v_old_before_return, '')) <> length(v_old_before_return) then
    raise exception 'PREMARKET_ATOMIC_ANCHOR_MISMATCH';
  end if;

  v_candidate := replace(replace(replace(v_original,
    v_old_bound, v_new_bound),
    v_old_before_insert, v_new_before_insert),
    v_old_before_return, v_new_before_return);
  execute v_candidate;
  if pg_get_functiondef(v_routine) <> v_candidate then
    raise exception 'PREMARKET_ATOMIC_CANDIDATE_MISMATCH';
  end if;
end;
$migration$;
