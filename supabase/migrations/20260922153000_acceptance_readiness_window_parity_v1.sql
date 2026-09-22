-- Future natural trading days only. Align Acceptance with the existing 08:45
-- provider-readiness deadline while preserving the original 07:30 delivery SLA.
-- This migration changes one function definition and performs no business-row DML.
do $migration$
declare
  v_routine constant regprocedure := 'public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure;
  v_baseline constant text := '6b24694c90fff258727147df13ae2638';
  v_original text := pg_get_functiondef(v_routine);
  v_old_delivery_guard constant text := $old$
    if v_line_time is null or v_line_time >= (p_business_date::text||'T08:00:00+08:00')::timestamptz
      or (v_line_time at time zone 'Asia/Taipei')::date<>p_business_date then v_auto_block:=array_append(v_auto_block,'REPORT_DELIVERY_NOT_ON_TIME'); end if;$old$;
  v_new_delivery_guard constant text := $new$
    if v_line_time is not null and v_line_time >= (p_business_date::text||'T08:45:00+08:00')::timestamptz
      then v_block:=array_append(v_block,'READINESS_WINDOW_DEADLINE_EXCEEDED'); end if;
    if v_line_time is null or v_line_time > (p_business_date::text||'T07:30:00+08:00')::timestamptz
      or (v_line_time at time zone 'Asia/Taipei')::date<>p_business_date then v_auto_block:=array_append(v_auto_block,'REPORT_DELIVERY_NOT_ON_TIME'); end if;$new$;
  v_old_snapshot_guard constant text := $old$          and captured_at < (p_business_date::text||'T08:00:00+08:00')::timestamptz$old$;
  v_new_snapshot_guard constant text := $new$          and captured_at < (p_business_date::text||'T08:45:00+08:00')::timestamptz$new$;
  v_old_automation_guard constant text := $old$        and h.completed_at < (p_business_date::text||'T08:00:00+08:00')::timestamptz)$old$;
  v_new_automation_guard constant text := $new$        and h.completed_at < (p_business_date::text||'T08:45:00+08:00')::timestamptz)$new$;
  v_old_timing_evidence constant text := $old$    'normal_report_line_count',v_line_count,'normal_report_last_sent_at',v_line_time,
    'failed_dispatches',v_failed,'open_dead_letters',v_dead,'automatic_blocking_checks',v_auto_block,$old$;
  v_new_timing_evidence constant text := $new$    'normal_report_line_count',v_line_count,'normal_report_last_sent_at',v_line_time,
    'readiness_deadline_at',(p_business_date::text||'T08:45:00+08:00')::timestamptz,
    'delivery_sla_deadline_at',(p_business_date::text||'T07:30:00+08:00')::timestamptz,
    'lifecycle_status',v_verdict,
    'readiness_status',case when v_line_time is not null
      and v_line_time < (p_business_date::text||'T08:45:00+08:00')::timestamptz then 'PASS' else 'FAIL' end,
    'delivery_sla_status',case when v_line_time is null then 'FAIL'
      when v_line_time <= (p_business_date::text||'T07:30:00+08:00')::timestamptz then 'PASS' else 'MISS' end,
    'recovered_within_readiness_window',v_line_time is not null
      and v_line_time > (p_business_date::text||'T07:30:00+08:00')::timestamptz
      and v_line_time < (p_business_date::text||'T08:45:00+08:00')::timestamptz,
    'failed_dispatches',v_failed,'open_dead_letters',v_dead,'automatic_blocking_checks',v_auto_block,$new$;
  v_candidate text;
  v_reverted text;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_volatility "char";
  v_settings text[];
  v_arguments text;
  v_result text;
begin
  select proowner,proacl,prosecdef,provolatile,proconfig,
    pg_get_function_arguments(oid),pg_get_function_result(oid)
  into v_owner,v_acl,v_security_definer,v_volatility,v_settings,v_arguments,v_result
  from pg_proc where oid=v_routine;

  v_reverted := replace(replace(replace(replace(v_original,
    v_new_timing_evidence,v_old_timing_evidence),
    v_new_automation_guard,v_old_automation_guard),
    v_new_snapshot_guard,v_old_snapshot_guard),
    v_new_delivery_guard,v_old_delivery_guard);
  if md5(v_reverted)=v_baseline and v_original<>v_reverted then return; end if;
  if md5(v_original)<>v_baseline then
    raise exception 'ACCEPTANCE_READINESS_WINDOW_BASELINE_MISMATCH';
  end if;
  if length(v_original)-length(replace(v_original,v_old_delivery_guard,''))<>length(v_old_delivery_guard)
    or length(v_original)-length(replace(v_original,v_old_snapshot_guard,''))<>length(v_old_snapshot_guard)
    or length(v_original)-length(replace(v_original,v_old_automation_guard,''))<>length(v_old_automation_guard)
    or length(v_original)-length(replace(v_original,v_old_timing_evidence,''))<>length(v_old_timing_evidence) then
    raise exception 'ACCEPTANCE_READINESS_WINDOW_ANCHOR_MISMATCH';
  end if;

  v_candidate := replace(replace(replace(replace(v_original,
    v_old_delivery_guard,v_new_delivery_guard),
    v_old_snapshot_guard,v_new_snapshot_guard),
    v_old_automation_guard,v_new_automation_guard),
    v_old_timing_evidence,v_new_timing_evidence);
  execute v_candidate;
  if pg_get_functiondef(v_routine)<>v_candidate then
    raise exception 'ACCEPTANCE_READINESS_WINDOW_CANDIDATE_MISMATCH';
  end if;
  if not exists(select 1 from pg_proc where oid=v_routine
    and proowner=v_owner and proacl is not distinct from v_acl
    and prosecdef=v_security_definer and provolatile=v_volatility
    and proconfig is not distinct from v_settings
    and pg_get_function_arguments(oid)=v_arguments
    and pg_get_function_result(oid)=v_result) then
    raise exception 'ACCEPTANCE_READINESS_WINDOW_AUTHORITY_DRIFT';
  end if;
end;
$migration$;
