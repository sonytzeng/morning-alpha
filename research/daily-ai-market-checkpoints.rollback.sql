-- Disable checkpoint transport; retain issued keys, pending outcomes and all
-- immutable archive bindings so rollback cannot silently reuse an old seed.
begin;
revoke all on function public.get_daily_ai_market_worker_checkpoint_v2(),public.begin_daily_ai_market_worker_checkpoint_v2(text,text),
 public.seal_daily_ai_market_worker_checkpoint_v2(text,text,text)from public,anon,authenticated,service_role;
revoke all on function vnext_market.worker_checkpoint_record(text)from public,anon,authenticated,service_role;
revoke all on table vnext_market.worker_checkpoints,vnext_market.worker_checkpoint_archives,vnext_market.worker_checkpoint_stream
 from public,anon,authenticated,service_role;
commit;
