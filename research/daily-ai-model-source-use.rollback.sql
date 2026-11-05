-- Fail closed while preserving every immutable review and all existing data.
begin;
revoke all on function public.load_daily_stock_ai_model_source_use_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.record_daily_stock_ai_model_source_use_v1(text,text) from public,anon,authenticated,service_role;
commit;
