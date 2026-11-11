-- Disable new human-review/publication writes and private browsing without
-- deleting reviews, request receipts or source records. Keep authenticated,
-- Owner-gated readback so an outstanding request can still be reconciled.
begin;
do $$declare item record;begin
 for item in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and p.proname=any(array['submit_daily_ai_owner_market_review_v2','review_daily_ai_market_edition_v2',
   'get_daily_ai_owner_market_page_v2','get_daily_ai_owner_market_input_v2','get_daily_ai_owner_market_references_v2'])loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',item.signature);
 end loop;
end $$;
create or replace function public.get_daily_ai_owner_market_catalog_v2(p_before jsonb default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid()is null or academy_private.access_v11()is distinct from 'owner' or not coalesce(public.is_research_owner_v1(),false)
  then raise exception 'OWNER_REQUIRED'using errcode='42501';end if;
 raise exception 'AI_MARKET_OWNER_DISABLED';
end $$;
revoke all on function public.get_daily_ai_owner_market_catalog_v2(jsonb,integer)from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_owner_market_catalog_v2(jsonb,integer)to authenticated;
commit;
