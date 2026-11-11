-- LOCAL ROLLBACK CANDIDATE. Removes only added public source admission.
-- The retained original responses, row indexes and action proofs are preserved.
begin;
do $$begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.stage_daily_ai_market_public_capture_v2(text,text,text)'))
  is distinct from 'ad909b6263b4dba9c47229b2dfc7b60a' then raise exception 'MARKET_PUBLIC_SOURCE_ROLLBACK_BASELINE';end if;
end $$;
drop function public.stage_daily_ai_market_public_capture_v2(text,text,text);
commit;
