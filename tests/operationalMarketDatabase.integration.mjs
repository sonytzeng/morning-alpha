import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
assert.equal(process.env.MA_OPERATIONAL_SCOPE,'operational-market-20261001');
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_six_bug_test5\d\d$/);
const container=process.env.MA_TEST_DOCKER_CONTAINER;
if(container)assert.equal(container,'ma-six-bug-shadow-db');
const sql=input=>execFileSync(container?'docker':'psql',container?
 ['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1']:
 ['-X','-q','-h','127.0.0.1','-p',process.env.MA_TEST_PGPORT||'55449','-d',db,'-At','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:6e6,stdio:['pipe','pipe','pipe']}).trim();
execFileSync(process.execPath,['tests/recorderRetryProjectionDatabase.integration.mjs','--bootstrap-only'],{
 cwd:root,env:{...process.env,MA_RECORDER_LOCAL_SCOPE:'ma-recorder-retry-projection-20260930',MA_LOCAL_SCOPE:'ma-six-bug-preventive-20260930'},stdio:['pipe','pipe','pipe']});
const catalog=()=>sql("select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid)) order by oid) from pg_proc where pronamespace='public'::regnamespace");
const unchanged=()=>sql("select jsonb_agg(jsonb_build_array(oid::regprocedure::text,md5(pg_get_functiondef(oid))) order by oid) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in ('validate_core_market_publication_v1','publish_research_bundle_v1','capture_morning_alpha_acceptance_v1','project_critical_sql_input_v1','record_publication_contract_evidence_v1','critical_sql_replay_inputs_v1')");
const before={catalog:catalog(),unchanged:unchanged(),policies:sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'")};
const migration=readFileSync(root+'supabase/migrations/20261001065146_operational_market_architecture_v1.sql','utf8');
sql(migration);
assert.equal(catalog(),before.catalog);assert.equal(unchanged(),before.unchanged);
assert.equal(sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'"),before.policies);
assert.equal(sql('select count(*) from reports'),'0');assert.equal(sql('select count(*) from market_checkpoint_snapshots'),'0');
assert.throws(()=>sql(migration),/PREDECESSOR_MISMATCH/);
console.log(JSON.stringify({fresh_database:db,migration:'PASS',catalog_unchanged:true,atomic_provider_retry_unchanged:true,business_rows:0,production_writes:0}));
