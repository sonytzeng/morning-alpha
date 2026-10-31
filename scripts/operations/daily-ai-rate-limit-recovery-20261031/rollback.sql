-- Empty-only rollback. Audit or provider work makes DROP permanently forbidden.
-- With records, separately revoke public recovery EXECUTE while preserving history.
begin;
do $guard$
declare item record;oid_value oid;
begin
 if pg_catalog.to_regclass('vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1') is null then raise exception 'AI_RATE_LIMIT_RECOVERY_ROLLBACK_MISSING';end if;
 if exists(select from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1)
  or exists(select from vnext_runtime.ai_stock_jobs where model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1')
  then raise exception 'AI_RATE_LIMIT_RECOVERY_ROLLBACK_HAS_RECORDS';end if;
 for item in select * from (values
  ('public.daily_stock_ai_rate_limit_recovery_job_v1(text, text, text, text, text, text, jsonb, jsonb, uuid, text)','fcec571f097c18bb102b766dd2a84800874d8e07965d8a23e369b4add7048fb2','{postgres=X/postgres,service_role=X/postgres}','v','true'),
  ('public.dispatch_daily_stock_ai_rate_limit_recovery_v1(text, text, text)','32ca0f32baccaccbc70d988b35e2ebe00243e7a953a5ff11b883dfc0f397571d','{postgres=X/postgres,service_role=X/postgres}','v','true'),
  ('public.load_daily_stock_ai_rate_limit_recovery_progress_v1(text)','8c31eb5e297108a7bef1d71c5fd3022563201768098517bd19809800832d1c0a','{postgres=X/postgres,service_role=X/postgres}','s','true'),
  ('public.load_daily_stock_ai_rate_limit_recovery_v1(text, text, text)','b2c30483420d9c420cc4ab831df4c049c57d447ebe1089a2c907edf5ec28e0ad','{postgres=X/postgres,service_role=X/postgres}','s','true'),
  ('vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(text, text)','43ebb34cf9afacf435b452e22a71cb823f8bd8125548d720eb38da335256ae4b','{postgres=X/postgres}','s','true'),
  ('vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1()','2cd3a0e54a061311c0ff5d3eeab2f2db576e0ecddd6e2578f9b891afe9bfa8d8','{postgres=X/postgres}','v','false')
 ) pins(signature,definition_hash,acl,volatility,definer_flag) loop
  oid_value:=pg_catalog.to_regprocedure(item.signature);
  if oid_value is null then raise exception 'AI_RATE_LIMIT_RECOVERY_ROLLBACK_FUNCTION_MISSING';end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(oid_value),'UTF8')),'hex')<>item.definition_hash then raise exception 'AI_RATE_LIMIT_RECOVERY_ROLLBACK_DEFINITION_DRIFT';end if;
  if not exists(select from pg_catalog.pg_proc p where p.oid=oid_value and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
   and p.proacl::text=item.acl and p.provolatile::text=item.volatility and p.prosecdef::text=item.definer_flag
   and p.proconfig=array['search_path=""']::text[] and p.prokind='f' and not p.proisstrict and not p.proleakproof and p.proparallel='u'
   and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')) then raise exception 'AI_RATE_LIMIT_RECOVERY_ROLLBACK_PRIVILEGE_DRIFT';end if;
 end loop;
end $guard$;
drop function public.daily_stock_ai_rate_limit_recovery_job_v1(text,text,text,text,text,text,jsonb,jsonb,uuid,text);
drop function public.load_daily_stock_ai_rate_limit_recovery_progress_v1(text);
drop function public.load_daily_stock_ai_rate_limit_recovery_v1(text,text,text);
drop function public.dispatch_daily_stock_ai_rate_limit_recovery_v1(text,text,text);
drop function vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(text,text);
drop table vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1;
drop function vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1();
commit;
