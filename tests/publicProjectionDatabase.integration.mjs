// Exact schema-only predecessor + one candidate, in a new local DB. No remote URL.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {publicMarketInput,buildPublicMarketReadModel} from '../supabase/functions/_shared/public-market-projection.ts';
import {publicProjectionCapsule,publicHandoffCapsule} from '../supabase/functions/_shared/public-projection-recorder.ts';
import {measureHandoffReferences,replayHandoffReferences} from '../supabase/functions/_shared/public-handoff-evidence.ts';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
assert.equal(process.env.MA_PUBLIC_PROJECTION_SCOPE,'public-projection-20261002');
const db=process.env.MA_ISOLATED_TEST_DB,container=process.env.MA_TEST_DOCKER_CONTAINER;
assert.match(db||'',/^ma_six_bug_test5\d\d$/);if(container)assert.equal(container,'ma-six-bug-shadow-db');
const sql=input=>execFileSync(container?'docker':'psql',container?['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1']:
 ['-X','-q','-h','127.0.0.1','-p',process.env.MA_TEST_PGPORT||'55439','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:5e6,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
execFileSync(process.execPath,['tests/operationalMarketDatabase.integration.mjs'],{cwd:root,env:{...process.env,MA_OPERATIONAL_SCOPE:'operational-market-20261001'},stdio:['pipe','pipe','pipe']});
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
const catalog=()=>sql("select jsonb_agg(jsonb_build_array(oid::regprocedure::text,proowner,proacl,prosecdef,proconfig,pg_get_function_arguments(oid)) order by oid) from pg_proc where pronamespace='public'::regnamespace and proname<>'public_market_checkpoint_inputs_v1'");
const frozen=()=>sql("select jsonb_agg(jsonb_build_array(oid::regprocedure::text,md5(pg_get_functiondef(oid))) order by oid) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in ('record_content_os_incident_v1','capture_morning_alpha_acceptance_v1','public_market_checkpoint_inputs_v1')");
const policies=()=>sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'");
const before={catalog:catalog(),frozen:frozen(),policies:policies()};
// Explicit historical-preservation controls, not fabricated Production rows.
sql("insert into production_acceptance_results(business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence,evaluated_at) values('2026-10-02','ISOLATED_HISTORY_CONTROL_1525','history-1525','FAIL',array['CONTENT_HANDOFF_INCIDENT'],'{}','2026-10-02T15:25:00+08:00'),('2026-10-02','ISOLATED_HISTORY_CONTROL_1535','history-1535','FAIL',array['CONTENT_HANDOFF_INCIDENT'],'{}','2026-10-02T15:35:00+08:00')");
const historical=()=>sql("select jsonb_agg(to_jsonb(r) order by idempotency_key) from production_acceptance_results r where evaluator_version like 'ISOLATED_HISTORY_CONTROL_%'");
const historicalBefore=historical();
sql(read('supabase/migrations/20261002130000_public_market_projection_v1.sql'));
assert.equal(historical(),historicalBefore);
assert.equal(catalog(),before.catalog);assert.equal(frozen(),before.frozen);assert.equal(policies(),before.policies);
assert.equal(sql('select count(*) from reports'),'0');
assert.equal(sql("select has_function_privilege('anon','public_market_checkpoint_inputs_v1(date)','EXECUTE')"),'f');
const capture=JSON.parse(read('tests/fixtures/public-projection/production-20261002.json'));
// SQL equality validators use the Recorder's original consistently hashed
// prose across ALL relations. Never mix full public text with redacted aliases.
const tables=JSON.parse(read('tests/fixtures/public-projection/sql-readset-20261002.json')).tables;
tables.editorial_reviews=tables.editorial_reviews.map(row=>({...row,...capture.tables.editorial_reviews.find(x=>x.id===row.id)}));
const order=['runtime_quality_policies','research_sessions','market_checkpoint_batches','market_checkpoint_snapshots','market_data_snapshots','reports','decision_snapshots','pipeline_runs','member_content_revisions','semantic_coherence_reviews','editorial_reviews','ma_ops_runs','content_os_sync_incidents','learning_runs','learning_predictions','prediction_outcomes','runtime_http_dispatches','runtime_dead_letters','ma_ops_recovery_actions','trading_day_state','line_delivery_outbox'];
if(container)writeFileSync(new URL('node_modules/.ma-six-clock',root),'2026-10-02 07:35:30\n');
let seed="begin;set constraints all deferred;set local morning_alpha.recorder_execution_origin='REPLAY';";
for(const table of order){
 const records=tables[table]||[];if(!records.length)continue;
 if(table==='line_delivery_outbox')for(const [index,r]of records.entries()){
  const id='00000000-0000-4000-8000-'+String(r.group_index).padStart(12,'0');
  seed+=`insert into line_subscribers(id,line_user_id,is_active) values(${q(id)},${q('LOCAL_PUBLIC_REPLAY_'+index)},true);`;
  r.line_subscriber_id=id;r.line_user_id='LOCAL_PUBLIC_REPLAY_'+index;r.idempotency_key='local-public-replay:'+index;delete r.group_index;
 }
 for(const record of records){const columns=Object.keys(record);assert(columns.every(k=>/^[a-z0-9_]+$/.test(k)));
  seed+=`insert into ${table}(${columns.join(',')}) overriding system value select ${columns.join(',')} from jsonb_populate_record(null::${table},${j(record)});`;}
}
seed+='commit;';
try{sql(seed);}catch(e){console.error(String(e.stderr||e.message).split('\n').filter(x=>x.startsWith('ERROR:')).join('\n'));throw Error('RECORDED_INPUT_RESTORE_FAILED');}
const evidence=JSON.parse(sql("select public_market_checkpoint_inputs_v1('2026-10-02')"));
assert.equal(evidence.batches.length,7);for(const p of evidence.proofs)assert.equal(p.status,'PASS');
const snapshot=capture.tables.decision_snapshots.find(x=>x.session_type==='PREMARKET');
const input=publicMarketInput(capture.public_response.payload,snapshot,tables.member_content_revisions[0],tables.learning_runs[0],evidence,'2026-10-02T12:30:00Z');
const model=buildPublicMarketReadModel(input);assert(model);assert.equal(model.next_checkpoint,'DAY_COMPLETED');
const cap=publicProjectionCapsule(input),rpc=`select record_critical_contract_evidence_v1('2026-10-02','PUBLICATION',${j(cap)})`;
const id=sql(rpc);assert.match(id,/^[0-9a-f-]{36}$/);assert.equal(sql(rpc),id,'Duplicate observation must be idempotent');
const stored=JSON.parse(sql(`select capsule from production_critical_contract_evidence where id=${q(id)}`));
assert.deepEqual(buildPublicMarketReadModel(stored.input),stored.expected);
assert.equal(sql(`select retention_until=recorded_at+interval '90 days' from production_critical_contract_evidence where id=${q(id)}`),'t');
const handoff=publicHandoffCapsule({business_date:snapshot.report_date,canonical_revision:snapshot.id,decision_version:snapshot.version,
 member_revision:tables.member_content_revisions[0].id,source_revision:'candidate-v14',operational_ready:true,
 references:measureHandoffReferences(snapshot.source_refs,snapshot.source_refs)});
const hid=sql(`select record_critical_contract_evidence_v1('2026-10-02','PUBLICATION',${j(handoff)})`);
assert.match(hid,/^[0-9a-f-]{36}$/);
const hstored=JSON.parse(sql(`select capsule from production_critical_contract_evidence where id=${q(hid)}`));
assert.deepEqual(replayHandoffReferences(hstored.input),hstored.expected);assert.equal(hstored.expected.status,'PASS');
const incident=`select record_content_os_incident_v1('isolated-public-contract','2026-10-02',${q(snapshot.id)},1,array['SCHEMA_CONFLICT'],409,'{"retry_classification":"NON_RETRYABLE","source_revision":"candidate-v1"}')`;
const incidentId=sql(incident);for(let n=0;n<104;n++)assert.equal(sql(incident),incidentId);
assert.equal(sql(`select attempt_count from content_os_sync_incidents where id=${q(incidentId)}`),'1');
// Immutable real inputs only. No synthesized Acceptance success. Tests execute
// the actual evaluator; a fake clock changes the test environment, not SQL.
if(container || sql("select clock_timestamp()>='2026-10-02T15:35:00+08:00'::timestamptz")==='t'){
 const result=JSON.parse(sql("select capture_morning_alpha_acceptance_v1('2026-10-02','PUBLIC_PROJECTION_ISOLATED_REPLAY');select jsonb_build_object('verdict',verdict,'blocking',blocking_checks,'evidence',evidence) from production_acceptance_results order by evaluated_at desc limit 1").split('\n').at(-1));
 assert.equal(result.verdict,'DEGRADED',JSON.stringify({verdict:result.verdict,blocking:result.blocking}));
 assert.equal(result.evidence.service_available,true);for(const key of ['CORE_MARKET','REPORT','LINE','CLOSING','LEARNING'])assert.equal(result.evidence.acceptance_dimensions[key],'PASS');
 assert.equal(result.evidence.acceptance_dimensions.PUBLIC_PROJECTION,'FAIL');
}else throw Error('CLOCK_CONTROL_REQUIRED_FOR_REAL_ACCEPTANCE_REPLAY');
assert.equal(historical(),historicalBefore);
console.log(JSON.stringify({fresh_db:db,migration:'PASS',recorded_input_replay:'PASS',atomic_batches:7,providers_per_batch:11,
 recorder_replay:'PASS',same_contract_result:true,duplicate_incident_attempts:1,acceptance:'DEGRADED_CORE_PASS',business_logic_unchanged:true,
 catalog_unchanged:true,rls_unchanged:true,production_writes:0}));
