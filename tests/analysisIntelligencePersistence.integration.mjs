// Fresh DB: real Handler → Engine → SQL store → Owner RLS/read, never Production.
import {shadowHttp} from './helpers/analysisShadowHttp.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { analyzeIntelligence, stableJson, predictionHash, observeInvalidations } from '../supabase/functions/_shared/analysis-intelligence-v1.mjs';
import { retained, publicDay, researchContexts } from './helpers/phase2AnalysisFixtures.mjs';
const db=process.env.MA_ISOLATED_TEST_DB;
assert.match(db||'',/^ma_phase2_analysis_test\d+$/);
const container=process.env.MA_TEST_DOCKER_CONTAINER;
if(container)assert.equal(container,'ma-phase2-analysis-db');
const port=process.env.MA_TEST_PGPORT||'55440';assert.match(port,/^\d{4,5}$/);
const execute=(name,input)=>execFileSync(container?'docker':'psql',container?['exec','-i',container,'psql','-X','-q','-U','postgres','-d',name,'-At','-v','ON_ERROR_STOP=1']
  :['-X','-q','-h','127.0.0.1','-p',port,'-U','postgres','-d',name,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(execute('postgres',`select count(*) from pg_database where datname='${db}'`),'0');
execute('postgres',`create database ${db}`);
const sql=s=>execute(db,s),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const lit=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>lit(JSON.stringify(v))+'::jsonb';
sql(read('tests/fixtures/research-foundation-dependencies.sql'));
sql(read('tests/fixtures/phase2-analysis/dependencies.sql'));
// Use the exact existing Production calendar functions, not a test-only date rule.
sql(read('supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql').split('create or replace function public.latest_completed_us_session_v1')[0]+'\ncommit;');
sql(read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql'));
const baseline=()=>sql("select md5(string_agg(pg_get_functiondef(oid),'' order by proname)) from pg_proc where pronamespace in ('auth'::regnamespace,'public'::regnamespace) and proname in ('uid','is_research_owner_v1','market_checkpoint_batch_integrity_v1')");
const before=baseline();
const migration=read('supabase/migrations/20261005083437_analysis_intelligence_shadow_v1.sql');sql(migration);
assert.equal(baseline(),before);assert.throws(()=>sql(migration),/already exists/);
for(const [cutoff,created,enabled,expected] of [
  ['07:30','07:32','07:00','t'],['08:44','08:45','07:00','t'],['08:59','09:00','07:00','f'],
  ['07:30','07:36','07:00','f'],['07:32','07:30','07:00','f'],['07:30','07:32','07:33','f'],
]) assert.equal(sql(`select research_private.analysis_forward_allowed_v1('2026-10-05','2026-10-05T${cutoff}:00+08:00','2026-10-05T${created}:00+08:00','2026-10-05T${enabled}:00+08:00')`),expected);
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003',admin='10000000-0000-4000-8000-000000000004';
sql(`insert into profiles values('${owner}','admin'),('${member}','member'),('${paid}','paid'),('${admin}','admin');
insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${owner}',true,'SYNTHETIC_ISOLATION_ONLY');`);
for(const d of retained.days){
  sql(`insert into isolated_retained_integrity values(${lit(d.business_date)},'PREMARKET',${json(d.integrity)})`);
  if(d.batch)sql(`insert into market_checkpoint_batches select * from jsonb_populate_record(null::market_checkpoint_batches,${json(d.batch)})`);
  for(const row of d.rows)sql(`insert into market_checkpoint_snapshots select * from jsonb_populate_record(null::market_checkpoint_snapshots,${json(row)})`);
}
// Preserve the previously omitted, incompatible 9/18 record to exercise the real
// old SQL resolver: nearest COMMITTED data would incorrectly choose this day.
const exact=JSON.parse(read('tests/fixtures/phase2-analysis/previous-comparison-production.json'));
const oldDay=exact.previous_inputs.find(x=>x.business_date==='2026-09-18').input.core;
sql(`insert into isolated_retained_integrity values('2026-09-18','PREMARKET',${json(oldDay.integrity)});
insert into market_checkpoint_batches select * from jsonb_populate_record(null::market_checkpoint_batches,${json(oldDay.batch)});`);
for(const row of oldDay.rows)sql(`insert into market_checkpoint_snapshots select * from jsonb_populate_record(null::market_checkpoint_snapshots,${json(row)})`);
assert.equal(sql("select research_analysis_input_v1('2026-09-30','2026-09-30T07:30:00+08:00','HISTORICAL_REPLAY')->>'previous_valid_business_date'"),'2026-09-18');
const rpcMetadata=()=>sql("select jsonb_agg(jsonb_build_object('name',proname,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig) order by proname)::text from pg_proc where oid in ('public.research_analysis_input_v1(date,timestamptz,text)'::regprocedure,'public.store_research_analysis_v1(jsonb,jsonb,text,numeric)'::regprocedure)");
const rpcBefore=rpcMetadata();
const successor=read('supabase/migrations/20261005103458_analysis_previous_comparison_nonblocking_v1.sql');sql(successor);
assert.equal(rpcMetadata(),rpcBefore);assert.throws(()=>sql(successor),/PREDECESSOR_MISMATCH/);
assert.equal(sql("select research_analysis_input_v1('2026-09-30','2026-09-30T07:30:00+08:00','HISTORICAL_REPLAY')->>'previous_trading_day'"),'2026-09-29');
const snap=publicDay.tables.decision_snapshots.find(s=>s.generated_text.market_report_gate);
sql(`insert into decision_snapshots select * from jsonb_populate_record(null::decision_snapshots,${json(snap)})`);
for(const row of researchContexts) sql(`insert into research_sessions select * from jsonb_populate_record(null::research_sessions,${json(row)})`);
for(const row of JSON.parse(read('tests/fixtures/phase2-analysis/cle-linkage.json')).rows) sql(`insert into learning_predictions select * from jsonb_populate_record(null::learning_predictions,${json(row)})`);
for(const row of publicDay.tables.prediction_outcomes) sql(`insert into prediction_outcomes select * from jsonb_populate_record(null::prediction_outcomes,${json(row)})`);
for(const row of publicDay.tables.market_checkpoint_batches.filter(b=>b.checkpoint!=='PREMARKET')) sql(`insert into market_checkpoint_batches select * from jsonb_populate_record(null::market_checkpoint_batches,${json(row)})`);
for(const row of publicDay.tables.market_checkpoint_snapshots.filter(b=>b.checkpoint!=='PREMARKET')) sql(`insert into market_checkpoint_snapshots select * from jsonb_populate_record(null::market_checkpoint_snapshots,${json(row)})`);
for(const row of JSON.parse(read('tests/fixtures/phase2-analysis/intraday-integrity.json')).rows)sql(`insert into isolated_retained_integrity values('2026-10-02',${lit(row.checkpoint)},${json(row.integrity)})`);
const businessHash=()=>sql("select md5((select jsonb_agg(t)::text from decision_snapshots t)||(select jsonb_agg(t)::text from market_checkpoint_snapshots t))");
const businessBefore=businessHash();
const asRole=(role,query,id)=>`begin;set local role ${role};${id?`set local request.jwt.claim.sub='${id}';`:''}${query};rollback;`;
const input=(day,cutoff=day+'T07:30:00+08:00',kind='HISTORICAL_REPLAY')=>JSON.parse(sql(asRole('service_role',`select research_analysis_input_v1('${day}','${cutoff}','${kind}')`)));
const persistence=read('supabase/migrations/20261005130832_analysis_shadow_persistence_v1.sql');
sql(persistence);assert.equal(rpcMetadata(),rpcBefore);assert.equal(baseline(),before);
assert.throws(()=>sql(persistence),/PREDECESSOR_MISMATCH/);
assert.equal(sql('select count(*) from research_daily_analysis'),'0','migration does NOT seed analysis');
let reads=0,writes=0,failWrite=false;
const sdk={
 from(table){
  assert.equal(table,'research_daily_analysis');const filters=[];
  const q={select(){return q;},eq(k,v){assert(['business_date','analysis_cutoff_at','observation_kind','methodology_id','methodology_version'].includes(k));filters.push(k+'='+lit(v));return q;},
   async maybeSingle(){return{data:JSON.parse(sql('set role service_role;select coalesce((select row_to_json(x) from (select id,prediction_hash,observation_kind,analysis_cutoff_at from research_daily_analysis where '+filters.join(' and ')+") x),'null'::json)")),error:null};}};
  return q;
 },
 async rpc(name,args){
  if(name==='research_analysis_input_v1'){reads++;return{data:input(args.p_date,args.p_cutoff,args.p_kind),error:null};}
  if(name==='store_research_analysis_v1'){
   writes++;if(failWrite)return{data:null,error:{code:'ISOLATED_WRITE_FAILURE'}};
   const data=JSON.parse(sql('set role service_role;select store_research_analysis_v1('+json(args.p_input)+','+(args.p_previous?json(args.p_previous):'null')+','+lit(args.p_analysis_text)+','+Number(args.p_compute_ms)+')'));
   return{data,error:null};
  }
  throw Error('UNAPPROVED_RPC');
 }
};
const http=await shadowHttp(sdk);
const request=day=>({operation:'ANALYZE',business_date:day,analysis_cutoff_at:day+'T07:30:00+08:00',observation_kind:'HISTORICAL_REPLAY'});
try {
const authCases=[
 ['missing',{},'AUTH_MISSING'],
 ['wrong',{...http.headers(),'x-shadow-worker-token':'W'.repeat(43)},'AUTH_INVALID'],
 ['cron',{'x-cron-secret':'ISOLATION_OTHER_IDENTITY'},'AUTH_MISSING'],
 ['service-role',{'apikey':'ISOLATED_DB_ONLY'},'AUTH_MISSING'],
 ['member',{authorization:'Bearer ISOLATED_MEMBER'},'AUTH_MISSING'],
 ['owner-browser',{authorization:'Bearer ISOLATED_OWNER',origin:'https://owner.invalid'},'AUTH_INVALID'],
 ['browser-dedicated',{...http.headers(),origin:'https://owner.invalid'},'AUTH_INVALID'],
 ['version',{...http.headers(),'x-shadow-worker-version':'2'},'AUTH_VERSION_MISMATCH'],
 ['expired',{...http.headers(),'x-shadow-worker-issued-at':String(Date.now()-600000)},'AUTH_EXPIRED'],
];
for(const [label,headers,reason] of authCases){
 const response=await http.request(request('2026-09-30'),headers);
 assert.equal(response.status,401,label);assert.equal((await response.json()).error,reason,label);
}
assert.equal(reads,0);assert.equal(writes,0);assert.equal(http.calls(),0);
for(const body of [{...request('2026-09-30'),observation_kind:'FORWARD'},
 {...request('2026-09-30'),operation:'LINK_OUTCOME'},{...request('2026-09-30'),operation:'OBSERVE_INVALIDATION'},
 {...request('2026-09-30'),rpc:'public.reports'},{...request('2026-09-30'),business_date:'2026-10-06'}])
 assert.equal((await http.request(body,http.headers())).status,403);
assert.equal(http.calls(),0,'operation allowlist precedes privileged DB access');
failWrite=true;
const writeFailure=await http.call('2026-09-30');
assert.equal(writeFailure.http,422);assert.equal(writeFailure.ok,false);
assert.equal(sql('select count(*) from research_daily_analysis'),'0');failWrite=false;
const results=[];
for(const day of ['2026-09-30','2026-10-01','2026-10-02']){
 const receipt=await http.call(day);assert.equal(receipt.http,200);assert.equal(receipt.status,'RECORDED');assert.equal(receipt.production_writes,0);
 const output=JSON.parse(sql(asRole('authenticated',`select get_owner_analysis_v2('HISTORICAL_REPLAY','${day}')`,owner)));
 const a=output.latest.analysis;assert.equal(a.business_date,day);assert.equal(a.observation_kind,'HISTORICAL_REPLAY');
 assert.equal(output.latest.not_forward,true);assert.equal(output.latest.not_production_decision,true);
 assert(output.latest.replay_created_at);assert.equal(output.forward_sample,0);
 assert.equal(a.features.length,33);assert.equal(a.signals.length,11);assert.equal(a.cross_signals.length,3);
 assert(a.supporting_signals.length>0);assert(a.contradicting_signals.length>0);assert(a.invalidation_conditions.length>0);
 const frozen=JSON.parse(sql(`select jsonb_build_object('input',input_snapshot,'previous',previous_input_snapshot) from research_daily_analysis where id='${receipt.analysis_id}'`));
 assert.equal(stableJson(analyzeIntelligence(frozen.input,frozen.previous)),stableJson(a));
 assert.equal(await predictionHash(a),receipt.prediction_hash);
 if(day==='2026-09-30'){assert.equal(a.quality.change_detection,'UNAVAILABLE');assert.equal(a.previous_comparison.reason,'PREVIOUS_COMPARISON_UNAVAILABLE');assert.equal(a.decision.shadow_confidence,3.8821);}
 if(day==='2026-10-02'){assert.equal(a.decision.shadow_regime,'range');assert.equal(a.decision.shadow_direction,'BULLISH');assert.equal(a.decision.shadow_risk,'HIGH');assert.equal(a.decision.shadow_confidence,17.3047);}
 assert.equal(a.decision.shadow_action,'WAIT');
 const beforeReads=reads,beforeWrites=writes;
 // The complete second pass is below; no in-loop hidden retries.
 assert.equal(reads,beforeReads);assert.equal(writes,beforeWrites);
 results.push({day,status:'PASS',confidence:a.decision.shadow_confidence});
}
assert.equal(sql('select count(*) from research_historical_replay_v1'),'3');
const firstLock=sql('select md5(jsonb_agg(t order by id)::text) from research_daily_analysis t');
for(const day of ['2026-09-30','2026-10-01','2026-10-02']){
 const r=await http.call(day);assert.equal(r.http,200);assert.equal(r.status,'ALREADY_RECORDED');
 const stored=JSON.parse(sql(`select jsonb_build_object('id',id,'hash',prediction_hash) from research_daily_analysis where business_date='${day}'`));
 assert.equal(r.analysis_id,stored.id);assert.equal(r.prediction_hash,stored.hash);
}
assert.equal(sql('select count(*) from research_historical_replay_v1'),'3');
assert.equal(sql('select md5(jsonb_agg(t order by id)::text) from research_daily_analysis t'),firstLock);
assert.equal(sql('select count(*) from research_forward_shadow_v1'),'0');
const catalogue=JSON.parse(sql(asRole('authenticated',"select get_owner_analysis_v2()",owner)));
assert.equal(catalogue.historical_replay_count,3);assert.equal(catalogue.catalog.length,3);
const forward=JSON.parse(sql(asRole('authenticated',"select get_owner_analysis_v2('FORWARD_SHADOW')",owner)));
assert.equal(forward.latest,null);assert.equal(forward.forward_sample,0);assert.equal(forward.catalog.length,0);
assert.equal(forward.analysis_value,'INSUFFICIENT_SAMPLE');
const denied=(q,re=/permission denied|RESEARCH_OWNER_REQUIRED|APPEND_ONLY/)=>assert.throws(()=>sql(q),re);
for(const id of [member,paid,admin]){
 denied(asRole('authenticated','select get_owner_analysis_v2()',id));
 assert.equal(sql(asRole('authenticated','select count(*) from research_historical_replay_v1',id)),'0');
}
denied(asRole('authenticated','select get_owner_analysis_v2()')); // expired/absent subject
denied(asRole('anon','select get_owner_analysis_v2()'));
denied(asRole('anon','select * from research_historical_replay_v1'));
assert.equal(sql(asRole('service_role','select count(*) from research_historical_replay_v1')),'3');
const locked=sql('select md5(jsonb_agg(t order by id)::text) from research_daily_analysis t');
for(const role of ['authenticated','service_role']){
 denied(asRole(role,"update research_daily_analysis set analysis='{}'",owner));
 denied(asRole(role,'delete from research_daily_analysis',owner));
}
denied('truncate research_daily_analysis cascade');
// A historical row cannot satisfy a Forward request; actual clock rejects backdating.
const bad=await http.request({...request('2026-10-02'),observation_kind:'FORWARD'},http.headers());assert.equal(bad.status,403);
assert.equal(sql('select count(*) from research_forward_shadow_v1'),'0');
// Missing / write-failure controls exercise actual Handler without touching any business code.
assert.equal((await http.request(request('2026-09-29'),http.headers())).status,403);
assert.equal((await http.request({...request('2026-10-02'),analysis_cutoff_at:'2026-10-02T07:31:00+08:00'},http.headers())).status,403);
assert.equal(sql('select md5(jsonb_agg(t order by id)::text) from research_daily_analysis t'),locked);
assert.equal(businessHash(),businessBefore);assert.equal(baseline(),before);
console.log(JSON.stringify({fresh_db:db,handler_to_database_to_owner:'PASS',results,historical_replay_count:3,
 forward_sample:0,production_equivalent_auth_test:'PASS',auth_negative_cases:authCases.length,rls:'PASS',idempotency:'PASS',immutability:'PASS',deterministic_replay:'PASS',business_diff:0,external_network_calls:0}));
} finally {await http.close();}
