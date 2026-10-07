// Local-only schema/SQL parity. No Production URL, token, network or backfill.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const db=process.env.MA_ISOLATED_TEST_DB,container=process.env.MA_TEST_DOCKER_CONTAINER;
assert.equal(process.env.MA_RECOMMENDATION_SCOPE,'recommendation-phase-20261007');
assert.match(db||'',/^ma_six_bug_test5\d\d$/);if(container)assert.equal(container,'ma-six-bug-shadow-db');
const sql=input=>execFileSync(container?'docker':'psql',container?['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1']:
 ['-X','-q','-h','127.0.0.1','-p',process.env.MA_TEST_PGPORT||'55439','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:8e6,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
if(!process.argv.includes('--prepared'))execFileSync(process.execPath,['tests/operationalMarketDatabase.integration.mjs'],{cwd:root,env:{...process.env,MA_OPERATIONAL_SCOPE:'operational-market-20261001'},stdio:['pipe','pipe','pipe']});
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
assert.equal(sql('select count(*) from reports'),'0');
sql(read('supabase/migrations/20261002130000_public_market_projection_v1.sql'));
const catalog=()=>sql("select jsonb_agg(jsonb_build_array(oid::regprocedure::text,proowner,proacl,prosecdef,proconfig,pg_get_function_arguments(oid)) order by oid) from pg_proc where pronamespace='public'::regnamespace");
const protectedCode=()=>sql("select jsonb_agg(jsonb_build_array(oid::regprocedure::text,md5(pg_get_functiondef(oid))) order by oid) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in ('validate_core_market_publication_v1','capture_morning_alpha_acceptance_v1','project_critical_sql_input_v1')");
const before={catalog:catalog(),code:protectedCode(),policies:sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'")};
const migration=read('supabase/migrations/20261006235430_recommendation_phase_contract_v1.sql');
sql(migration);assert.equal(catalog(),before.catalog);assert.equal(protectedCode(),before.code);
assert.equal(sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'"),before.policies);
assert.equal(sql('select count(*) from reports'),'0');assert.equal(sql('select count(*) from market_checkpoint_snapshots'),'0');
assert.throws(()=>sql(migration),/PREDECESSOR_MISMATCH/);

// Retained 10/2 market proof plus explicitly synthetic stock phase controls.
// No historical report is produced or rewritten. The validator is called pure.
const tables=JSON.parse(read('tests/fixtures/public-projection/sql-readset-20261002.json')).tables;
let seed='begin;set constraints all deferred;';
for(const table of ['runtime_quality_policies','market_checkpoint_batches','market_checkpoint_snapshots','market_data_snapshots']){
 const records=tables[table];
 for(const record of records){const columns=Object.keys(record);assert(columns.every(k=>/^[a-z0-9_]+$/.test(k)));
  seed+=`insert into ${table}(${columns.join(',')}) overriding system value select ${columns.join(',')} from jsonb_populate_record(null::${table},${j(record)});`;}
}
sql(seed+'commit;');
const decision=structuredClone(tables.decision_snapshots.find(r=>r.session_type==='PREMARKET'));
const ai=structuredClone(tables.reports[0].ai_strategy_json);
const invoke=(a=ai,d=decision)=>JSON.parse(sql(`select validate_core_market_publication_v1('2026-10-02',${j(a)},${j(d)},null,null,null)`));
assert.equal(invoke().eligible,true,'retained market publication must stay valid');
const phase={evaluation_phase:'PREMARKET',status:'PREMARKET_WATCH',universe_count:72,evaluated_count:72,watch_count:72,ready_count:0,none_count:0,blocked_count:0,not_yet_observable_count:72,reason_distribution:{ENTRY_PENDING_MARKET_OPEN:72},candidates:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,status:'WATCH',reasons:['ENTRY_PENDING_MARKET_OPEN'],post_event_price:'NOT_YET_OBSERVABLE',post_event_volume:'NOT_YET_OBSERVABLE',evidence_ids:['synthetic-sql-control']}))};
ai.decision_v1={schema_version:'decision-evidence-v1',report_date:'2026-10-02',today_date:'2026-10-02',revision_id:'SYNTHETIC_SQL_VALIDATION_ONLY',generated_at:decision.generated_text.canonical_market_state.generated_at,evidence_quality:'complete',data_freshness:'valid_at_assessment',phase_evaluation:phase,evidence:[{id:'synthetic-sql-control'}],screening:{status:'COMPLETE',universe_count:72,evaluated_count:72,rejected:[]}};
const gate=structuredClone(ai.market_report_gate);gate.recommendation_status='PREMARKET_WATCH';
gate.recommendation_gate={...gate.recommendation_gate,status:'PREMARKET_WATCH',eligible:false,universe_evaluation_complete:true,screening:ai.decision_v1.screening,phase_evaluation:{...phase,candidates:[]}};
ai.market_report_gate=gate;ai.recommendation_status='PREMARKET_WATCH';decision.generated_text.market_report_gate=gate;
assert.equal(invoke().eligible,true,JSON.stringify(invoke()));
const projected=JSON.parse(sql(`select project_critical_sql_input_v1(${j({p_ai:ai,p_decision:decision})})`));
assert.deepEqual(projected.p_ai.decision_v1.phase_evaluation,phase,'complete phase proof survives critical projection');
assert.equal(invoke(projected.p_ai,projected.p_decision).eligible,true,'Recorder replay and direct SQL must agree');
const large={schema_version:'decision-evidence-v1',evidence:Array.from({length:2116},(_,i)=>({id:`synthetic-${i}`,observed_at:'2026-10-02T01:59:00Z'}))};
assert.deepEqual(JSON.parse(sql(`select project_critical_sql_input_v1(${j(large)})`)),large,'72-stock intraday proof does not hit generic 1000-item bound');
assert.throws(()=>sql(`select project_critical_sql_input_v1(${j({schema_version:'other',evidence:large.evidence})})`),/CRITICAL_SQL_PROJECTION_BOUND/);
assert.throws(()=>sql(`select project_critical_sql_input_v1(${j({...large,evidence:Array(4097).fill({id:'synthetic'})})})`),/RECOMMENDATION_PROOF_EVIDENCE_BOUND/);
for(const change of [a=>{delete a.decision_v1;},a=>{a.decision_v1.phase_evaluation.candidates.pop();},a=>{a.decision_v1.phase_evaluation.ready_count=1;},a=>{a.decision_v1.phase_evaluation.candidates[0].post_event_price='MISSING';},a=>{a.decision_v1.generated_at='2026-10-02T01:00:00Z';}]){
 const bad=structuredClone(ai);change(bad);assert.equal(invoke(bad).eligible,false);
}
assert.equal(sql('select count(*) from reports'),'0','no business publication in this candidate test');
console.log(JSON.stringify({fresh_db:db,migration:'PASS',original_market_contract:'PASS',premarket_watch_sql:'PASS',negative_controls:5,auth_rls_catalog_unchanged:true,atomic_retry_unchanged:true,production_writes:0}));
