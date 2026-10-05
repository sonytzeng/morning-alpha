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
const x=input('2026-10-02'),p=input('2026-10-01','2026-10-01T08:44:59+08:00');
const analysis=analyzeIntelligence(x,p),txt=stableJson(analysis);
const store=(i=x,prev=p,text=txt)=>`select store_research_analysis_v1(${json(i)},${prev?json(prev):'null'},${lit(text)},10)`;
const receipt=JSON.parse(sql('set role service_role;'+store()));assert.equal(receipt.status,'RECORDED');
assert.equal(receipt.prediction_hash,await predictionHash(analysis));
assert.equal(JSON.parse(sql('set role service_role;'+store())).status,'ALREADY_RECORDED');
assert.equal(sql('select count(*) from research_daily_analysis'),'1');
assert.equal(sql('select count(*) from research_analysis_graphs'),'1');
assert.equal(x.existing_prediction_id,null,'CLE materialized after cutoff is NOT a morning input');
for(const cp of ['0900','0930','1030','1300','1410','1430']) {
  const when=`2026-10-02T${cp.slice(0,2)}:${cp.slice(2)}:59+08:00`;
  const followup=JSON.parse(sql(asRole('service_role',`select research_invalidation_input_v1('${receipt.id}','${cp}','${when}')`)));
  const result=observeInvalidations(followup.analysis,followup.observation);
  assert(result.every(r=>['TRIGGERED','NOT_TRIGGERED','UNAVAILABLE'].includes(r.status)));
  const q=`select store_research_invalidation_v1(${json(followup)},${json(result)})`;
  assert.equal(sql('set role service_role;'+q),'RECORDED');assert.equal(sql('set role service_role;'+q),'ALREADY_RECORDED');
  assert.equal(stableJson(observeInvalidations(followup.analysis,followup.observation)),stableJson(result));
}
const closingOutcome=publicDay.tables.prediction_outcomes.find(o=>o.horizon==='close');
const link=`select link_research_outcome_v1('${receipt.id}','${closingOutcome.id}')`;
assert.equal(sql('set role service_role;'+link),'LINKED');assert.equal(sql('set role service_role;'+link),'ALREADY_LINKED');
assert.equal(sql("select eligible from research_quality_observations where measurement_version='SHADOW_DIRECTION_V1'"),'f');
const denied=(q,re=/permission denied|RESEARCH_OWNER_REQUIRED/)=>assert.throws(()=>sql(q),re);
for(const role of ['anon','authenticated'])denied(asRole(role,store(),owner));
denied(asRole('anon','select * from research_daily_analysis'));
for(const id of [member,paid,admin]){
  assert.equal(sql(asRole('authenticated','select count(*) from research_daily_analysis',id)),'0');
  assert.equal(sql(asRole('authenticated','select count(*) from research_invalidation_observations',id)),'0');
  denied(asRole('authenticated','select get_owner_analysis_v1()',id));
}
assert.equal(sql(asRole('authenticated','select count(*) from research_daily_analysis',owner)),'1');
assert.equal(sql(asRole('authenticated',"select get_owner_analysis_v1()->>'forward_sample'",owner)),'0');
assert.equal(sql(asRole('service_role','select count(*) from research_daily_analysis')),'1');
denied(asRole('authenticated',"set local request.jwt.claims='{\"user_metadata\":{\"role\":\"admin\"}}';select get_owner_analysis_v1()",paid));
denied(asRole('authenticated','select research_analysis_input_v1(\'2026-10-02\',\'2026-10-02T07:30:00+08:00\',\'HISTORICAL_REPLAY\')',owner));
denied(asRole('authenticated',link,owner));
denied(asRole('anon','select * from research_invalidation_observations'));
for(const role of ['authenticated','service_role']){
  denied(asRole(role,"update research_daily_analysis set prediction_hash=repeat('0',64)",owner));
  denied(asRole(role,'delete from research_daily_analysis',owner));
}
denied('delete from research_daily_analysis',/APPEND_ONLY/);
denied('truncate research_daily_analysis,research_invalidation_observations',/APPEND_ONLY/);
denied('delete from research_invalidation_observations',/APPEND_ONLY/);
const tampered=structuredClone(x);tampered.core.rows[0].value=1;
denied('set role service_role;'+store(tampered),/READSET_MISMATCH/);
const badOutput=structuredClone(analysis);badOutput.features[0].source_evidence_id='invented';
denied('set role service_role;'+store(x,p,stableJson(badOutput)),/FEATURE_LINEAGE_INVALID/);
const changed=structuredClone(analysis);changed.decision.shadow_action='AVOID';
denied('set role service_role;'+store(x,p,stableJson(changed)),/CANONICAL_ALREADY_LOCKED/);
const historicalForward=input('2026-10-02',undefined,'FORWARD');
denied('set role service_role;'+store(historicalForward,p,stableJson(analyzeIntelligence(historicalForward,p))),/FORWARD_CANNOT_BE_BACKDATED/);
// A late cutoff cannot smuggle future core rows into the valid-morning projection.
denied("select research_analysis_input_v1('2026-10-02','2026-10-02T13:00:00+08:00','HISTORICAL_REPLAY')",/CUTOFF_INVALID/);
const frozen=JSON.parse(sql('select jsonb_build_object(\'input\',input_snapshot,\'previous\',previous_input_snapshot,\'analysis\',analysis) from research_daily_analysis'));
assert.equal(stableJson(analyzeIntelligence(frozen.input,frozen.previous)),stableJson(frozen.analysis));
assert.equal(businessHash(),businessBefore);assert.equal(baseline(),before);
sql('update research_private.owner_access set enabled=false');
assert.equal(sql(asRole('authenticated','select count(*) from research_daily_analysis',owner)),'0');
assert.equal(sql("select count(*) from pg_publication_tables where tablename='research_daily_analysis'"),'0');
console.log(JSON.stringify({fresh_db:db,owner_rls:'PASS',immutability:'PASS',source_lineage:'PASS',duplicate:'PASS',forward_backdate:'REJECTED',deterministic_replay:'PASS',business_diff:0,existing_auth_diff:0,forward_sample:0}));
