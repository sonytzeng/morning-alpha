-- Calendar guard only; preserves Cron, ACL, Owner review and all source data.
begin;
do $guard$ begin
 if (select md5(prosrc) from pg_proc where oid='public.tick_daily_stock_ai_intake_v1()'::regprocedure) not in ('97204881fcbbb39c69802d09ac27e77a','ec5526cd3dad8cf36651177ea27c2db2') then raise exception 'DAILY_AI_CALENDAR_BASELINE_DRIFT';end if;
end $guard$;
create or replace function public.tick_daily_stock_ai_intake_v1() returns jsonb
language plpgsql security definer set search_path='' as $function$
declare local_time timestamp:=clock_timestamp() at time zone 'Asia/Taipei';minute_of_day integer;
begin
 minute_of_day:=extract(hour from local_time)::integer*60+extract(minute from local_time)::integer;
 if minute_of_day<410 or minute_of_day>540 then return jsonb_build_object('state','OUTSIDE_WINDOW','member_published',false);end if;
 -- Keep the existing Taipei window and Cron; run only on a covered TW session.
 if not coalesce((local_time::date between
    (public.authoritative_market_calendar_v1()->'TW'->>'from')::date and
    (public.authoritative_market_calendar_v1()->'TW'->>'through')::date),false)
 then return jsonb_build_object('state','CALENDAR_UNCOVERED','member_published',false);end if;
 if not coalesce(public.market_calendar_session_v1('TW',local_time::date),false)
 then return jsonb_build_object('state','NON_TRADING_DAY','member_published',false);end if;
 begin perform vnext_private.resume_zero_paid_stock_draft_v1();exception when others then null;end;
 return public.enqueue_daily_stock_ai_intake_v1();
end $function$;
commit;
