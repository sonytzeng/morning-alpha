-- Explicit feature rollback, not a data rollback. Preserve every raw capture,
-- pool, reference, packet, result hash, review and publication event for audit.
-- Original capture/work-plan/claim/legacy-shard/finish RPCs stay unchanged.
begin;
do $$begin
 if to_regprocedure('vnext_market.member_page_before_references_v2(jsonb)')is null then raise exception 'MARKET_REFERENCES_ROLLBACK_PREREQUISITES';end if;
end $$;
revoke all on function public.stage_daily_ai_market_price_inputs_v2(text,text,text),
 public.stage_daily_ai_market_price_references_v2(text,text,text),public.stage_daily_ai_market_shard_with_references_v2(text,text,uuid,text,text),
 public.get_daily_ai_owner_market_references_v2(text,text) from public,anon,authenticated,service_role;
-- Optional bounded-input extension may have been installed after references.
do $$declare item record;begin
 for item in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and p.proname=any(array['stage_daily_ai_market_price_input_chunk_v2','finalize_daily_ai_market_price_inputs_v2'])loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',item.signature);
 end loop;
end $$;

-- Keep the original independent Auth/review/license/expiry and cursor checks.
-- Stored cards are immutable, so remove the added field in the projection.
-- A client may still cache it: always return a bounded FULL page (at most 60)
-- after validating the original request, rather than acknowledging UNCHANGED.
create or replace function public.get_daily_ai_member_market_page_v2(p_request jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb;begin
 answer:=vnext_market.member_page_before_references_v2(p_request);
 if answer->>'mode'='UNCHANGED' then
  answer:=vnext_market.member_page_before_references_v2(jsonb_set(p_request,'{known}','null'::jsonb));
 end if;
 answer:=jsonb_set(answer,'{cards}',(select coalesce(jsonb_agg(card-'research_reference' order by ordinal),'[]')
  from jsonb_array_elements(answer->'cards')with ordinality t(card,ordinal)));
 return answer;
end $$;
revoke all on function public.get_daily_ai_member_market_page_v2(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_member_market_page_v2(jsonb)to authenticated;
commit;
