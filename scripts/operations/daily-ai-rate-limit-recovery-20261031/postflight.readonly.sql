-- READ ONLY. Run after recovery migration and BEFORE the separate V2 stage patch.
-- Expected: all9 function matches; original18 COMPLETE+54 FAILED429attempt3;
-- new recovery jobs/receipts/edition all0; RLS+force true; all raw privileges false.
-- No dispatch function is executed. The progress reader cannot call a provider.
with expected(signature,definition_sha256,acl) as(values
  ('public.daily_stock_ai_rate_limit_recovery_job_v1(text, text, text, text, text, text, jsonb, jsonb, uuid, text)','fcec571f097c18bb102b766dd2a84800874d8e07965d8a23e369b4add7048fb2','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.dispatch_daily_stock_ai_rate_limit_recovery_v1(text, text, text)','32ca0f32baccaccbc70d988b35e2ebe00243e7a953a5ff11b883dfc0f397571d','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.load_daily_stock_ai_rate_limit_recovery_progress_v1(text)','8c31eb5e297108a7bef1d71c5fd3022563201768098517bd19809800832d1c0a','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.load_daily_stock_ai_rate_limit_recovery_v1(text, text, text)','b2c30483420d9c420cc4ab831df4c049c57d447ebe1089a2c907edf5ec28e0ad','{postgres=X/postgres,service_role=X/postgres}'),
  ('vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1(text, text)','43ebb34cf9afacf435b452e22a71cb823f8bd8125548d720eb38da335256ae4b','{postgres=X/postgres}'),
  ('vnext_runtime.seal_daily_stock_ai_rate_limit_recovery_receipt_v1()','2cd3a0e54a061311c0ff5d3eeab2f2db576e0ecddd6e2578f9b891afe9bfa8d8','{postgres=X/postgres}'),
  ('public.daily_stock_ai_job_v1(text,text,text,jsonb,jsonb,uuid,text)','2a055e4746a570d3a4ab3c9324b5f7272d4798ca80164249252a53ce71662e98','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)','651467f9f66872cd17d1eaa9855e789f35a0b88ad8836bd0a04acff8a9f35efb','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.dispatch_daily_stock_ai_batch_v1(text)','d0c3395e030c92b8cd55cedb53882fbb86cc07b37ac57c0d4b007db623467878','{postgres=X/postgres,service_role=X/postgres}')
), functions as(
 select e.signature,e.definition_sha256 expected_sha256,e.acl expected_acl,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') actual_sha256,
  p.proacl::text actual_acl,pg_catalog.pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')=e.definition_sha256 definition_matches,
  p.proacl::text=e.acl acl_matches
 from expected e left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
), originals as(
 select j.* from vnext_runtime.ai_stock_batches b
 cross join lateral pg_catalog.jsonb_each_text(b.payload->'packet_hashes') packet
 join vnext_runtime.ai_stock_jobs j on j.symbol=packet.key and j.input_hash=packet.value and j.cutoff=b.cutoff
 where b.id='0524783a79af043a70be593d2e019c435bc067f168a5b2567a831e32d78b4ddc' and j.model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'
), isolated_table as(
 select c.relrowsecurity,c.relforcerowsecurity,c.relacl::text acl,
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',role_name,'has_any_raw_privilege',
   pg_catalog.has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) order by role_name)
   from unnest(array['anon','authenticated','service_role'])role_name) raw_roles,
  (select pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) triggers
 from pg_catalog.pg_class c where c.oid='vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1'::regclass
)
select pg_catalog.jsonb_build_object(
 'phase','AFTER_RECOVERY_BEFORE_V2_STAGE',
 'functions',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) order by signature) from functions f),
 'receipt_table',(select pg_catalog.to_jsonb(t) from isolated_table t),
 'original_jobs',(select pg_catalog.jsonb_build_object('total',count(*),'complete',count(*)filter(where state='COMPLETE'),
  'failed_429_attempt3',count(*)filter(where state='FAILED' and code='STOCK_AI_PROVIDER_HTTP_429' and attempts=3),
  'running',count(*)filter(where state='RUNNING'),
  'rowset_sha256',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) order by o.id)::text,'UTF8')),'hex')) from originals o),
 'recovery_receipts',(select count(*) from vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1),
 'recovery_jobs',(select count(*) from vnext_runtime.ai_stock_jobs where model_revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1'),
 'current_batch_editions',(select count(*) from vnext_private.ai_research_editions where batch_id='0524783a79af043a70be593d2e019c435bc067f168a5b2567a831e32d78b4ddc'),
 'progress',public.load_daily_stock_ai_rate_limit_recovery_progress_v1('0524783a79af043a70be593d2e019c435bc067f168a5b2567a831e32d78b4ddc')
) postflight;
