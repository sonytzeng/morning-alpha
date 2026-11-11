-- Whole V2 feature stop. Execute extension rollbacks first, this file last.
-- This is not a data restore: every private table, raw receipt, review,
-- publication and immutable hash is retained with its existing RLS.
-- Existing V1 member/read/review APIs, cron and credentials are untouched.
begin;
do $$declare item record;begin
 if to_regclass('vnext_market.editions')is null then raise exception 'MARKET_V2_ROLLBACK_PREREQUISITES';end if;
 for item in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and p.proname=any(array[
   'stage_daily_ai_market_capture_v2','stage_daily_ai_market_encoded_capture_v2','stage_daily_ai_market_public_capture_v2',
   'stage_daily_ai_market_revenue_capture_v2','stage_daily_ai_market_work_plan_v2','claim_daily_ai_market_shard_v2',
   'stage_daily_ai_market_shard_v2','stage_daily_ai_market_shard_with_references_v2','finish_daily_ai_market_edition_v2',
   'stage_daily_ai_market_review_v2','stage_daily_ai_market_price_inputs_v2','stage_daily_ai_market_price_input_chunk_v2',
   'finalize_daily_ai_market_price_inputs_v2','stage_daily_ai_market_price_references_v2',
   'submit_daily_ai_owner_market_review_v2','review_daily_ai_market_edition_v2','get_daily_ai_owner_market_page_v2',
   'get_daily_ai_owner_market_input_v2','get_daily_ai_owner_market_references_v2','get_daily_ai_owner_market_search_v2',
   'stage_daily_ai_market_worker_seed_v2','stage_daily_ai_market_worker_seed_chunk_v2','finalize_daily_ai_market_worker_seed_v2',
   'get_daily_ai_market_worker_seed_manifest_v2','get_daily_ai_market_worker_seed_chunk_v2',
   'get_daily_ai_market_worker_checkpoint_v2','begin_daily_ai_market_worker_checkpoint_v2','seal_daily_ai_market_worker_checkpoint_v2'])loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',item.signature);
 end loop;
end $$;
-- Explicit disabled response lets the new /stocks adapter clear V2 caches and
-- fall back to its separately gated V1 reader. Do not return 42501 here: that
-- would incorrectly describe a feature rollback as a member access failure.
create or replace function public.get_daily_ai_member_market_page_v2(p_request jsonb)returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid()is null or coalesce(academy_private.access_v11(),'denied')not in('free','premium','owner')
  then raise exception 'MEMBER_REQUIRED'using errcode='42501';end if;
 raise exception 'AI_MARKET_PAGE_V2_DISABLED';
end $$;
revoke all on function public.get_daily_ai_member_market_page_v2(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_member_market_page_v2(jsonb)to authenticated;
commit;
