-- Candidate for Issue #238. NOT approved for Production execution.
-- Changes observation scheduling only; no Report/Decision/LINE/business writes.
-- Exact predecessor guard prevents applying this to an unreviewed evaluator.
begin;
do $patch$
declare
 target regprocedure := 'public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure;
 body text;
 definition text;
 old_guard text := $old$if extract(isodow from p_business_date) in (6,7) or v_r.ai_strategy_json->'is_trading_day'='false'::jsonb then$old$;
 new_guard text := $new$if not public.market_calendar_session_v1('TW',p_business_date) then$new$;
 old_start text := $old$if p_business_date is null then raise exception 'BUSINESS_DATE_REQUIRED'; end if;$old$;
 new_start text := $new$if p_business_date is null then raise exception 'BUSINESS_DATE_REQUIRED'; end if;
  -- The calendar helper returns false outside coverage too. Unknown is not a holiday.
  if not coalesce(p_business_date between
    (public.authoritative_market_calendar_v1()#>>'{TW,from}')::date and
    (public.authoritative_market_calendar_v1()#>>'{TW,through}')::date,false) then
    raise exception 'ACCEPTANCE_CALENDAR_COVERAGE_UNAVAILABLE';
  end if;$new$;
begin
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid=target;
 if md5(body)<>'9d0c66a17d93fa3d6319fa309ae4ca7b' then
  raise exception 'ACCEPTANCE_CALENDAR_PREDECESSOR_MISMATCH';
 end if;
 if (length(body)-length(replace(body,old_guard,'')))/length(old_guard)<>1
   or (length(body)-length(replace(body,old_start,'')))/length(old_start)<>1 then
  raise exception 'ACCEPTANCE_CALENDAR_PATCH_CARDINALITY';
 end if;
 -- CREATE OR REPLACE from pg_get_functiondef retains the exact signature and settings;
 -- it also retains existing ownership and EXECUTE grants. No new public entrypoint.
 execute replace(replace(definition,old_start,new_start),old_guard,new_guard);

 -- The acceptance INSERT trigger independently schedules checkpoint checks.
 -- Do not change Atomic collection/commit/validator functions or any real-session check.
 target:='public.enforce_atomic_checkpoint_acceptance_v1()'::regprocedure;
 select prosrc,pg_get_functiondef(oid) into body,definition from pg_proc where oid=target;
 if md5(body)<>'aaca0aeed381e54a1333bc2385cbf04e' then
  raise exception 'ACCEPTANCE_TRIGGER_PREDECESSOR_MISMATCH';
 end if;
 old_guard:=$old$  foreach v_checkpoint in array array['0900','0930','1030','1300','1410','1430'] loop$old$;
 new_guard:=$new$  -- Only the authoritative calendar can exempt a closed session.
  -- An arbitrary NOT_DUE flag on a real trading day cannot bypass checks.
  if not coalesce(new.business_date between
    (public.authoritative_market_calendar_v1()#>>'{TW,from}')::date and
    (public.authoritative_market_calendar_v1()#>>'{TW,through}')::date,false) then
    raise exception 'ACCEPTANCE_CALENDAR_COVERAGE_UNAVAILABLE';
  end if;
  if not public.market_calendar_session_v1('TW',new.business_date) then
    return new;
  end if;

  foreach v_checkpoint in array array['0900','0930','1030','1300','1410','1430'] loop$new$;
 if (length(body)-length(replace(body,old_guard,'')))/length(old_guard)<>1 then
  raise exception 'ACCEPTANCE_TRIGGER_PATCH_CARDINALITY';
 end if;
 execute replace(definition,old_guard,new_guard);
end $patch$;
commit;
