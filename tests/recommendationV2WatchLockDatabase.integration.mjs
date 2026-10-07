import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {evaluateV2Shadow,v2Canonical,v2Hash} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {evaluateV2Outcome} from '../supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_v2_watch_test\d+$/);
const container=process.env.MA_TEST_DOCKER_CONTAINER;
assert.equal(container,'ma-recommendation-owner-ci');
assert.equal(execFileSync('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',container],{encoding:'utf8'}).trim(),'none');
const args=name=>['exec','-i',container,'psql','-X','-q','-U','postgres','-d',name,'-At','-v','ON_ERROR_STOP=1'];
const exec=(name,input)=>execFileSync('docker',args(name),{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000}).trim();
const sql=s=>exec(db,s),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",j=x=>lit(JSON.stringify(x))+'::jsonb';
assert.equal(exec('postgres',`select count(*) from pg_database where datname='${db}'`),'0');exec('postgres',`create database ${db}`);
// Existing isolated cluster roles only; never create/change roles during this test.
assert.equal(exec('postgres',"select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')"),'3');
sql(read('tests/fixtures/research-foundation-dependencies.sql'));
sql(read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql'));
sql(read('supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql').split('create or replace function public.latest_completed_us_session_v1')[0]+'commit;');
sql('create schema extensions; create extension pgcrypto with schema extensions; create table sector_stock_map(symbol text primary key,is_active boolean not null);');
sql('insert into sector_stock_map values '+RECOMMENDATION_UNIVERSE.map(s=>`('${s}',true)`).join(','));
const baseline=()=>sql("select md5(string_agg(pg_get_functiondef(oid),'' order by proname)) from pg_proc where proname in ('uid','is_research_owner_v1','market_calendar_session_v1')");
const before=baseline(),migration=read('supabase/migrations/20261007092045_recommendation_v2_owner_shadow.sql');sql(migration);assert.equal(baseline(),before);assert.throws(()=>sql(migration),/already exists/);
const accessSnapshot=()=>sql(`select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_array(relname,relowner,relacl,relrowsecurity,relforcerowsecurity) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 'roles',(select jsonb_agg(to_jsonb(r) order by rolname) from pg_roles r),
 'functions',(select jsonb_agg(jsonb_build_array(proname,proowner,proacl,prosecdef,proconfig) order by proname) from pg_proc where proname like '%recommendation_shadow_v2%'),
 'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid in ('recommendation_shadow_v2_runs'::regclass,'recommendation_shadow_v2_predictions'::regclass,'recommendation_shadow_v2_outcomes'::regclass))
)`);
const accessBefore=accessSnapshot(),watchMigration=read('supabase/migrations/20261007113746_recommendation_v2_watch_prospective_lock.sql');
sql(watchMigration);sql(watchMigration);
assert.equal(accessSnapshot(),accessBefore);assert.equal(baseline(),before);
assert.equal(sql('select count(*) from recommendation_shadow_v2_predictions'),'0');
// Use the isolated server clock, not Mac's clock: the existing Docker VM is
// intentionally time-shifted. The product's five-minute lock is not relaxed.
const now=new Date(sql("select clock_timestamp()-interval '1 second'")).toISOString(),today=new Date(Date.parse(now)+8*3600000).toISOString().slice(0,10);
// Source fixture is explicitly synthetic. No network, Production credentials,
// accounts, trades or performance records are used by this isolation program.
const input=v2Fixture(now);
input.identity.generated_at=now;input.identity.data_as_of=now;input.v1.generated_at=now;
input.captures.forEach(c=>{c.received_at=now;c.rows.forEach(r=>r.ingested_at=now);});
input.sources.forEach(c=>{c.received_at=now;c.rows.forEach(r=>r.available_at=now);});
const local=new Date(Date.parse(now)+8*3600000).toISOString();
if(local.slice(11,16)>='09:00')input.data.quotes.push({id:'SYNTHETIC_CURRENT_TAIEX',symbol:'TAIEX',trading_date:today,phase:local.slice(11,16)>='13:30'?'close':'intraday',provider:'fugle',value:20000,change_percent:0,captured_at:local.slice(11,16)>='13:30'?today+'T13:30:00+08:00':now,ingested_at:now});
// Four genuine engine cohorts, not promoted WATCH placeholders.
input.sources[0].rows=input.sources[0].rows.filter(r=>RECOMMENDATION_UNIVERSE.indexOf(r.symbol)>=18);
input.sources[1].rows.forEach(r=>{if(RECOMMENDATION_UNIVERSE.indexOf(r.symbol)>=36)r.revenue_yoy=-.1;});
input.captures=input.captures.filter(c=>RECOMMENDATION_UNIVERSE.indexOf(c.symbol)<54);
const result=await evaluateV2Shadow(input);assert.deepEqual(result.counts,{WATCH:18,READY:18,NONE:18,BLOCKED:18});
const store=(i=input,r=result)=>`select store_recommendation_shadow_v2(${lit(v2Canonical(i))},${j(r)})`;
const first=JSON.parse(sql('set role service_role;'+store()));assert.equal(first.status,'STORED');
assert.equal(JSON.parse(sql('set role service_role;'+store())).status,'ALREADY_STORED');
assert.equal(sql('select count(*) from recommendation_shadow_v2_runs'),'1');assert.equal(sql('select count(*) from recommendation_shadow_v2_predictions'),'36');
const lockedBefore=sql("select jsonb_agg(to_jsonb(p) order by symbol) from recommendation_shadow_v2_predictions p");
assert.equal(sql("select count(*) from recommendation_shadow_v2_predictions where status='WATCH'"),'18');
assert.equal(sql("select count(*) from recommendation_shadow_v2_predictions where status='READY'"),'18');
const denied=(q,re=/permission denied|RESEARCH_OWNER_REQUIRED/)=>assert.throws(()=>sql(q),re);
denied('set role service_role;'+store(input,{...result,input_sha256:'0'.repeat(64)}),/IDENTITY/);
denied('set role service_role;'+store(input,{...result,counts:{READY:0}}),/IDEMPOTENCY/);
for(const field of ['cutoff','business_date','source_revision']){const r={...result,[field]:null};denied('set role service_role;'+store(input,r),/IDENTITY/);}
const old=structuredClone(input);old.identity.generated_at='2026-10-01T00:00:00Z';old.identity.revision_id='OLD';
denied('set role service_role;'+store(old,result),/IDENTITY/);
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003';
sql(`insert into profiles values('${owner}','admin'),('${member}','member'),('${paid}','paid');insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${owner}',true,'SYNTHETIC_ONLY');`);
const asUser=(uid,q)=>`begin;set local role authenticated;set local request.jwt.claim.sub='${uid}';${q};rollback;`;
for(const table of ['recommendation_shadow_v2_runs','recommendation_shadow_v2_predictions','recommendation_shadow_v2_outcomes']){
 denied('set role anon;select * from '+table);
 for(const uid of [member,paid])assert.equal(sql(asUser(uid,`select count(*) from ${table}`)),'0');
 denied(asUser(owner,`delete from ${table}`));denied(`delete from ${table}`,/IMMUTABLE|foreign key/);
}
denied('truncate recommendation_shadow_v2_runs,recommendation_shadow_v2_predictions,recommendation_shadow_v2_outcomes',/IMMUTABLE/);
for(const uid of [member,paid])denied(asUser(uid,'select get_owner_recommendation_shadow_v2()'));
assert.equal(sql(asUser(owner,"select get_owner_recommendation_shadow_v2()->>'forward_sample'")),'1');
denied('set role authenticated;select get_owner_recommendation_shadow_v2()');
denied(asUser(paid,"set local request.jwt.claims='{\"user_metadata\":{\"role\":\"admin\"}}';select get_owner_recommendation_shadow_v2()"));
for(const role of ['anon','authenticated'])denied(`set role ${role};`+store());
const retry=structuredClone(input);retry.identity.revision_id='SYNTHETIC_CONCURRENT';retry.v1.revision_id=retry.identity.revision_id;
const retryResult=await evaluateV2Shadow(retry),command='set role service_role;'+store(retry,retryResult);
const invoke=()=>new Promise((resolve,reject)=>{const p=execFile('docker',args(db),{encoding:'utf8'},(e,out)=>e?reject(e):resolve(out));p.stdin.end(command);});
const concurrent=await Promise.all([invoke(),invoke()]);assert(concurrent.some(r=>r.includes('ALREADY_STORED')));
assert.equal(sql('select count(*) from recommendation_shadow_v2_predictions'),'36');
assert.equal(sql('select count(*) from recommendation_shadow_v2_runs'),'2');

assert.equal(sql("select jsonb_agg(to_jsonb(p) order by symbol) from recommendation_shadow_v2_predictions p"),lockedBefore);
async function capsule(name,mutate=()=>{}){
 const i=structuredClone(input),r=structuredClone(result);
 i.identity.revision_id=name;r.source_revision=name;
 mutate(i,r);r.input_sha256=await v2Hash(i);return [i,r];
}
for(const [name,mutate,re] of [
 ['STALE',(i,r)=>{i.identity.generated_at=i.v1.generated_at=r.cutoff=new Date(Date.parse(now)-360000).toISOString();},/NOT_FORWARD/],
 ['FUTURE',(i,r)=>{i.identity.generated_at=i.v1.generated_at=r.cutoff=new Date(Date.parse(now)+360000).toISOString();},/NOT_FORWARD/],
 ['OLD_DATE',(i,r)=>{i.identity.report_date=i.v1.report_date=r.business_date='2026-08-01';},/NOT_FORWARD/],
 ['SAME_DAY_ENTRY',(i,r)=>{r.candidates[0].entry.not_before=today;},/ENTRY_INVALID/],
 ['SKIPPED_SESSION',(i,r)=>{r.candidates[0].entry.not_before='2999-01-01';},/ENTRY_INVALID/],
 ['MISSING_ENTRY',(i,r)=>{r.candidates[0].entry=null;},/ENTRY_INVALID/],
 ['BAD_TRIGGER',(i,r)=>{r.candidates[0].entry.trigger_price=0;},/ENTRY_INVALID/],
 ['BAD_STOP',(i,r)=>{r.candidates[0].entry.invalidation_price=r.candidates[0].entry.trigger_price;},/ENTRY_INVALID/],
 ['BAD_CONDITION',(i,r)=>{r.candidates[0].entry.condition='BUY_NOW';},/ENTRY_INVALID/],
 ['BAD_STATUS',(i,r)=>{r.candidates[0].status='PROMOTED';},/STATUS_INVALID/],
 ['BAD_UNIVERSE',(i,r)=>{r.candidates[1].symbol=r.candidates[0].symbol;},/UNIVERSE_INVALID/],
 ['PROMOTION',(i,r)=>{r.promotion_allowed=true;},/IDENTITY_INVALID/],
]){
 const [i,r]=await capsule(name,mutate);denied('set role service_role;'+store(i,r),re);
 assert.equal(sql('select count(*) from recommendation_shadow_v2_runs'),'2');
 assert.equal(sql("select jsonb_agg(to_jsonb(p) order by symbol) from recommendation_shadow_v2_predictions p"),lockedBefore);
}
// A later revision can evaluate differently but cannot rewrite either status.
const [laterI,laterR]=await capsule('LATER_STATUS',(_i,r)=>r.candidates.forEach(c=>{
 if(c.status==='WATCH')c.status='READY';else if(c.status==='READY')c.status='WATCH';
}));
assert.equal(JSON.parse(sql('set role service_role;'+store(laterI,laterR))).status,'STORED');
assert.equal(sql("select jsonb_agg(to_jsonb(p) order by symbol) from recommendation_shadow_v2_predictions p"),lockedBefore);
const pending=JSON.parse(sql('set role service_role;select pending_recommendation_shadow_v2()'));
assert.equal(pending.filter(p=>p.status==='WATCH').length,18);assert.equal(pending.filter(p=>p.status==='READY').length,18);
sql(watchMigration);assert.equal(sql("select jsonb_agg(to_jsonb(p) order by symbol) from recommendation_shadow_v2_predictions p"),lockedBefore);

// Root-only synthetic historical fixtures in this fresh network-isolated DB,
// never retrospective RPC locks and never Production data.
for(const [n,status] of ['READY','WATCH'].entries()){
 const capture=input.captures[n],symbol=capture.symbol;
 const bars=capture.rows.map(r=>({date:r.trading_date,open:r.raw_payload.open,high:r.raw_payload.high,low:r.raw_payload.low,close:r.raw_payload.close,volume:r.raw_payload.volume_shares,amount:r.raw_payload.amount_twd,source_ref:r.id,available_at:r.ingested_at}));
 const oldDate=previousMarketTradingDate('TW',bars[0].date),oldTime=oldDate+'T08:00:00+08:00';
 const runId='90000000-0000-4000-8000-00000000000'+(n+1),predictionId='90000000-0000-4000-8000-00000000001'+n;
 const prediction={id:predictionId,symbol,methodology_version:result.methodology_version,observation_kind:'FORWARD',locked_at:oldTime,cutoff:oldTime,input_sha256:'c'.repeat(64),status,entry:{not_before:bars[0].date,trigger_price:100,invalidation_price:95}};
 sql(`insert into recommendation_shadow_v2_runs(id,business_date,source_revision,methodology_version,cutoff,locked_at,input_sha256,evidence,result) values('${runId}','${oldDate}','ISOLATED_HISTORICAL_${status}','${result.methodology_version}','${oldTime}','${oldTime}',repeat('c',64),'{}','{}');
 insert into recommendation_shadow_v2_predictions(id,run_id,business_date,symbol,methodology_version,locked_at,cutoff,input_sha256,status,entry) values('${predictionId}','${runId}','${oldDate}','${symbol}','${result.methodology_version}','${oldTime}','${oldTime}',repeat('c',64),'${status}',${j(prediction.entry)});`);
 for(const horizon of [1,3,5,10,20]){
  const observedAt=new Date(sql('select clock_timestamp()')).toISOString(),outcome=evaluateV2Outcome(prediction,bars,horizon,observedAt);
  assert.equal(outcome.state,'OBSERVED');assert.equal(outcome.prediction_status,status);
  const proof={source_revision:input.identity.revision_id,prediction,bars,horizon,observed_at:observedAt};
  const put=(o=outcome,p=proof)=>`select store_recommendation_shadow_v2_outcome(${j(o)},${lit(v2Canonical(p))})`;
  const legacy={...outcome};delete legacy.prediction_status;
  if(status==='READY')assert.equal(sql('set role service_role;'+put(legacy)),'STORED');
  else denied('set role service_role;'+put(legacy),/OUTCOME_STATUS/);
  assert.equal(sql('set role service_role;'+put()),status==='READY'?'ALREADY_STORED':'STORED');
  assert.equal(sql('set role service_role;'+put()),'ALREADY_STORED');
  denied('set role service_role;'+put({...outcome,prediction_status:status==='WATCH'?'READY':'WATCH'}),/OUTCOME_STATUS/);
  denied('set role service_role;'+put(outcome,{...proof,prediction:{...prediction,status:'NONE'}}),/LINEAGE/);
  denied('set role service_role;'+put({...outcome,return:.99}),/CALCULATION/);
  denied('set role service_role;'+put({...outcome,reason:'TAMPERED'}),/CONFLICT/);
  const tamper=structuredClone(proof);tamper.bars[0].close=999;denied('set role service_role;'+put(outcome,tamper),/BAR_INVALID/);
  denied('set role service_role;'+put(outcome,{...proof,observed_at:'2999-01-01T00:00:00Z'}),/LINEAGE/);
  assert.equal(sql(`select result ? 'prediction_status' from recommendation_shadow_v2_outcomes where prediction_id='${predictionId}' and horizon=${horizon}`),status==='READY'?'f':'t');
 }
}
assert.equal(sql('select count(*) from recommendation_shadow_v2_outcomes'),'10');
const ownerRead=JSON.parse(sql(asUser(owner,'select get_owner_recommendation_shadow_v2()')));
assert.equal(ownerRead.outcomes.filter(o=>o.prediction_status==='WATCH').length,5);
assert.equal(ownerRead.outcomes.filter(o=>o.prediction_status==='READY').length,5);
assert.equal(ownerRead.forward_dates_by_status.WATCH.length,2);
assert.equal(ownerRead.forward_dates_by_status.READY.length,2);
assert.equal(ownerRead.promotion_allowed,false);
for(const table of ['recommendation_shadow_v2_runs','recommendation_shadow_v2_predictions','recommendation_shadow_v2_outcomes']){
 denied('update '+table+' set '+(table.endsWith('_runs')?'shadow_only=true':table.endsWith('_predictions')?"status='READY'":'horizon=1'),/IMMUTABLE/);
 denied('delete from '+table,/IMMUTABLE/);denied('truncate '+table+' cascade',/IMMUTABLE/);
 for(const uid of [member,paid])assert.equal(sql(asUser(uid,`select count(*) from ${table}`)),'0');
 denied('set role anon;select * from '+table);
}
assert.equal(accessSnapshot(),accessBefore);assert.equal(baseline(),before);
assert.equal(sql('select count(*) from decision_snapshots'),'0');
console.log(JSON.stringify({fresh_db:db,network:'none',watch_locks:18,ready_locks:18,none_blocked_locks:0,access_unchanged:true,immutable:true,idempotent:true,concurrent_lock:true,no_status_promotion:true,time_hash_entry_guards:true,watch_ready_horizons:'10/10',legacy_read_enrichment:true,production_used:false}));
