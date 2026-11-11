-- Stop private company discovery; preserve all market data and review records.
begin;
revoke all on function public.get_daily_ai_owner_market_search_v2(text,text,integer)from public,anon,authenticated,service_role;
commit;
