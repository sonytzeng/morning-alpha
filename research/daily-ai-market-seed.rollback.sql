-- Disable seed transport; retain immutable manifest/chunks/completions and RLS.
begin;
revoke all on function public.stage_daily_ai_market_worker_seed_v2(text,text),public.stage_daily_ai_market_worker_seed_chunk_v2(text,integer,text,text),
 public.finalize_daily_ai_market_worker_seed_v2(text,text),public.get_daily_ai_market_worker_seed_manifest_v2(text),public.get_daily_ai_market_worker_seed_chunk_v2(text,integer)
 from public,anon,authenticated,service_role;
commit;
