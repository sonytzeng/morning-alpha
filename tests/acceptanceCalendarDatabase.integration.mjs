// Actual PostgreSQL evaluator, fresh schema-only predecessor, network-none local DB.
// Isolated controls are never reported as Production natural execution.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
assert.equal(process.env.MA_ACCEPTANCE_CALENDAR_SCOPE,'issue-238-calendar');
assert.equal(process.env.MA_TEST_DOCKER_CONTAINER,'ma-acceptance-calendar-238');
assert.match(process.env.MA_ISOLATED_TEST_DB||'',/^ma_six_bug_test5\d\d$/);
const container=process.env.MA_TEST_DOCKER_CONTAINER,db=process.env.MA_ISOLATED_TEST_DB;
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none','TEST_DATABASE_MUST_HAVE_NO_NETWORK');
const sql=(input,database=db)=>execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:6e6,stdio:['pipe','pipe','pipe']}).trim();
// Exact existing schema-only artifact; no Production rows or credentials.
const read=path=>readFileSync(root+path,'utf8');
const schema=read('tests/fixtures/six-bug-schema-only-20260930.sql');
const schemaManifest=JSON.parse(read('tests/fixtures/six-bug-schema-only-20260930.json'));
assert.equal(createHash('sha256').update(schema).digest('hex'),schemaManifest.sha256);
assert.equal(schemaManifest.business_rows,0);
assert.equal(sql(`select count(*) from pg_database where datname='${db}'`,'postgres'),'0','FRESH_DATABASE_REQUIRED');
sql(`create database ${db}`,'postgres');
sql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;');
sql('drop schema public;'+schema); // Only the freshly created, network-isolated DB.
for(const path of [
 '20260923124500_production_evidence_recorder_v1.sql',
 '20260930043122_six_bug_preventive_closure_v1.sql',
 '20260930080719_recorder_retry_projection_parity_v1.sql',
 '20261001065146_operational_market_architecture_v1.sql',
 '20261002130000_public_market_projection_v1.sql',
 '20261006235430_recommendation_phase_contract_v1.sql',
])sql(read('supabase/migrations/'+path));
assert.equal(sql('select count(*) from reports'),'0');
const signature="'public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure";
const triggerSignature="'public.enforce_atomic_checkpoint_acceptance_v1()'::regprocedure";
// Schema-only dump intentionally omits ACLs. Reproduce the two Production ACLs
// read on 2026-10-13: postgres/service_role EXECUTE only, never member access.
sql('grant usage on schema public to anon,authenticated,service_role;'+
 'revoke all on function public.capture_morning_alpha_acceptance_v1(date,text),public.enforce_atomic_checkpoint_acceptance_v1() from public,anon,authenticated;'+
 'grant execute on function public.capture_morning_alpha_acceptance_v1(date,text),public.enforce_atomic_checkpoint_acceptance_v1() to service_role;');
const source=()=>sql(`select prosrc from pg_proc where oid=${signature}`);
const metadata=()=>sql(`select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,
 'settings',proconfig,'volatility',provolatile,'args',pg_get_function_arguments(oid),'result',pg_get_function_result(oid)) from pg_proc where oid in (${signature},${triggerSignature}) order by oid`);
const untouched=()=>sql(`select jsonb_agg(jsonb_build_array(oid::regprocedure::text,md5(pg_get_functiondef(oid))) order by oid)
 from pg_proc where pronamespace='public'::regnamespace and prokind='f' and oid not in (${signature},${triggerSignature})`);
const policies=()=>sql('select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p');
const history=()=>sql("select md5(coalesce(string_agg(row_to_json(a)::text,E'\n' order by id),'')) from production_acceptance_results a");
const capture=(date,label)=>JSON.parse(sql(`select capture_morning_alpha_acceptance_v1('${date}','ISOLATED_${label}');
 select jsonb_build_object('verdict',verdict,'blocking',blocking_checks,'phase',evidence->>'phase',
 'market_data_pass',evidence->'market_data_pass','automatic_stable_day',evidence->'automatic_stable_day',
 'dimensions',evidence->'acceptance_dimensions') from production_acceptance_results
 where business_date='${date}' and evaluator_version like 'ISOLATED_${label}:%' order by evaluated_at desc limit 1;`).split('\n').at(-1));
assert.equal(sql(`select md5(prosrc) from pg_proc where oid=${signature}`),'9d0c66a17d93fa3d6319fa309ae4ca7b');
assert.equal(sql(`select md5(prosrc) from pg_proc where oid=${triggerSignature}`),'aaca0aeed381e54a1333bc2385cbf04e');
assert.equal(sql("select public.market_calendar_session_v1('TW','2026-10-09')"),'f');
const originalHoliday=capture('2026-10-09','BEFORE_HOLIDAY');
assert.equal(originalHoliday.verdict,'FAIL'); // Actual reported defect: no holiday Report.
const originalTrading=capture('2026-10-08','BEFORE_TRADING');
assert.equal(originalTrading.verdict,'FAIL'); // Missing business data must remain failure.
const before={source:source(),metadata:metadata(),untouched:untouched(),policies:policies(),history:history(),
 definitions:sql(`select pg_get_functiondef(oid)||';' from pg_proc where oid in (${signature},${triggerSignature}) order by oid`)};
const migration=readFileSync(root+'supabase/migrations/20261013073004_operational_acceptance_calendar_guard_v1.sql','utf8');
sql(migration);
assert.equal(metadata(),before.metadata);
assert.equal(untouched(),before.untouched);
assert.equal(policies(),before.policies);
assert.equal(history(),before.history,'MIGRATION_MUST_NOT_REWRITE_OBSERVATIONS');
assert.throws(()=>sql(migration),/ACCEPTANCE_CALENDAR_PREDECESSOR_MISMATCH/);
const once=source();
for(const date of ['2026-10-09','2026-10-10','2026-10-11']){
 const result=capture(date,'AFTER_'+date.replaceAll('-',''));
 assert.equal(result.verdict,'NOT_DUE');assert.equal(result.phase,'NON_TRADING');
 assert.deepEqual(result.blocking,[]);assert.equal(result.market_data_pass,null);
 assert.equal(result.automatic_stable_day,false);
}
assert.deepEqual(capture('2026-10-08','AFTER_TRADING'),originalTrading);
// A report claiming a real trading day is closed must not suppress genuine failures.
sql("insert into reports(report_date,ai_strategy_json) values('2026-10-08','{\"is_trading_day\":false}')");
assert.equal(capture('2026-10-08','FALSE_REPORT_FLAG').verdict,'FAIL');
sql("insert into production_acceptance_results(business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence) values('2026-10-08','ISOLATED_FORGED_NOT_DUE','isolated-forged-not-due','NOT_DUE','{}','{\"phase\":\"NON_TRADING\"}')");
assert.equal(sql("select verdict from production_acceptance_results where idempotency_key='isolated-forged-not-due'"),'FAIL');
for(const day of ['2024-12-31','2027-01-01'])
 assert.throws(()=>capture(day,'OUTSIDE'),/ACCEPTANCE_CALENDAR_COVERAGE_UNAVAILABLE/);
assert.throws(()=>sql("select capture_morning_alpha_acceptance_v1(null,'ISOLATED_NULL')"),/BUSINESS_DATE_REQUIRED/);
for(const role of ['anon','authenticated'])
 assert.throws(()=>sql(`set role ${role};select public.capture_morning_alpha_acceptance_v1('2026-10-09'::date,'ISOLATED_DENIED'::text)`),/permission denied/);
const count=sql('select count(*) from production_acceptance_results');
capture('2026-10-09','AFTER_20261009');
assert.equal(sql('select count(*) from production_acceptance_results'),count,'DUPLICATE_OBSERVATION');
assert.equal(source(),once);assert.equal(untouched(),before.untouched);
// The exact two-definition rollback is proven locally, never run in Production.
const rollbackHistory=history();
sql('begin;'+before.definitions+'commit;');
assert.equal(source(),before.source);
assert.equal(sql(`select md5(prosrc) from pg_proc where oid=${triggerSignature}`),'aaca0aeed381e54a1333bc2385cbf04e');
assert.equal(metadata(),before.metadata);assert.equal(policies(),before.policies);
assert.equal(untouched(),before.untouched);assert.equal(history(),rollbackHistory);
console.log(JSON.stringify({fresh_db:'PASS',historical_defect_reproduced:true,holiday:'NOT_DUE',weekend:'NOT_DUE',
 trading_day_regression:'PASS',calendar_unknown:'DENY',false_report_flag:'DENY',metadata_unchanged:true,
 existing_policies_unchanged:true,all_other_functions_unchanged:true,migration_history_diff:0,idempotency:'PASS',
 exact_rollback:'PASS',production_execution:false}));
