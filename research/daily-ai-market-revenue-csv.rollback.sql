-- LOCAL ROLLBACK CANDIDATE. Close monthly revenue admission; retain all
-- immutable original bytes and the expanded encoding constraints they require.
begin;
do $$begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_revenue_capture_v2(text,text,text)'))
  is distinct from 'ea17dd48be4ad48307b475c0f00b88a4' then raise exception 'MARKET_REVENUE_ROLLBACK_BASELINE_MISMATCH';end if;
end $$;
drop function public.stage_daily_ai_market_revenue_capture_v2(text,text,text);
commit;
