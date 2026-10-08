// Fresh isolation, actual existing Owner gate, explicit synthetic source rows.
// Does not authenticate Sony or read/write any Production database.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {entryFixture,setup} from './helpers/entryFixtures.mjs';
import {evaluateEntry,canonical} from '../research/entry-opportunity.ts';
const container=process.env.MA_TEST_DOCKER_CONTAINER,db=process.env.MA_ISOLATED_TEST_DB;
assert.match(container||'',/^ma-entry-ci-\d+$/);assert.match(db||'',/^ma_entry_test\d+$/);
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:8*1024*1024}).trim();
const inspect=JSON.parse(docker(['inspect',container]))[0];assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(Object.keys(inspect.HostConfig.PortBindings||{}).length,0);
const exec=(name,input)=>docker(['exec','-i',container,'psql','-X','-q','-U','postgres','-d',name,'-At','-v','ON_ERROR_STOP=1'],input),sql=s=>exec(db,s);
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),lit=s=>"'"+String(s).replaceAll("'","''")+"'",j=v=>lit(JSON.stringify(v))+'::jsonb';
assert.equal(exec('postgres',`select count(*) from pg_database where datname=${lit(db)}`),'0');exec('postgres',`create database ${db}`);
sql(read('tests/fixtures/research-foundation-dependencies.sql'));
sql(read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql'));
sql(read('supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql').split('create or replace function public.latest_completed_us_session_v1')[0]+'commit;');
sql('create schema extensions;create extension pgcrypto with schema extensions;create table public.recommendation_shadow_v2_runs(id uuid primary key,source_revision text,input_sha256 text,cutoff timestamptz,business_date date,evidence jsonb);');
const unchanged=()=>sql("select md5(string_agg(pg_get_functiondef(oid),'' order by oid)) from pg_proc where proname in ('is_research_owner_v1','market_calendar_session_v1','uid')");
const before=unchanged(),migration=read('supabase/migrations/20261008081315_entry_opportunity_owner_shadow_v1.sql');sql(migration);assert.equal(unchanged(),before);assert.throws(()=>sql(migration),/already exists/);
const input=setup(await entryFixture(),'reversal');
// Fictional identity in network-none DB, never a real retained capture.
input.provenance='REAL_RETAINED';const result=await evaluateEntry(input),source='30000000-0000-4000-8000-000000000001';
sql(`insert into recommendation_shadow_v2_runs values('${source}',${lit(input.source_revision)},${lit(input.source_evidence_hash)},${lit(input.evaluation_time)},${lit(input.business_date)},'{}')`);
const put=(i=input,r=result)=>`select store_entry_opportunity_v1('${source}',${lit(canonical(i))},${j(r)})`;
assert.equal(JSON.parse(sql('set role service_role;'+put())).status,'STORED');assert.equal(JSON.parse(sql('set role service_role;'+put())).status,'ALREADY_STORED');
assert.equal(sql('select count(*) from entry_opportunity_runs'),'1');assert.equal(sql('select count(*) from entry_opportunity_predictions'),'3');
assert.equal(sql("select count(*) from pg_proc where proname='store_entry_outcome_v1'"),'0','no unverified outcome write path');
assert.equal(sql("select has_table_privilege('service_role','entry_opportunity_outcomes','INSERT')"),'f');
assert.throws(()=>sql('set role service_role;'+put(input,{...result,evidence_hash:'f'.repeat(64)})),/LINEAGE/);
assert.throws(()=>sql('set role service_role;'+put(input,{...result,counts:{}})),/IDEMPOTENCY/);
const oldForward={...input,mode:'FORWARD'},oldResult=await evaluateEntry(oldForward);assert.throws(()=>sql('set role service_role;'+put(oldForward,oldResult)),/FORWARD_NOT_CURRENT/);
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003';
sql(`insert into profiles values('${owner}','admin'),('${member}','member'),('${paid}','paid');insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${owner}',true,'SYNTHETIC_LOCAL_ONLY');`);
const asUser=(uid,q)=>`begin;set local role authenticated;set local request.jwt.claim.sub='${uid}';${q};rollback;`;
for(const role of ['anon','authenticated'])assert.throws(()=>sql('set role '+role+';'+put()),/permission denied/);
for(const table of ['entry_opportunity_runs','entry_opportunity_predictions','entry_opportunity_outcomes']){
 assert.throws(()=>sql('set role anon;select * from '+table),/permission denied/);
 for(const uid of [member,paid])assert.equal(sql(asUser(uid,'select count(*) from '+table)),'0');
 assert.throws(()=>sql('delete from '+table),/IMMUTABLE/);assert.throws(()=>sql('truncate '+table+' cascade'),/IMMUTABLE/);
}
for(const uid of [member,paid,''])assert.throws(()=>sql(asUser(uid,'select get_owner_entry_opportunity_v1()')),/RESEARCH_OWNER_REQUIRED/);
assert.equal(JSON.parse(sql(asUser(owner,'select get_owner_entry_opportunity_v1()'))).forward_sample,0);
assert.throws(()=>sql(asUser(owner,"set local request.jwt.claim.sub='';select get_owner_entry_opportunity_v1()")),/RESEARCH_OWNER_REQUIRED/);
assert.equal(unchanged(),before);assert.equal(sql('select count(*) from decision_snapshots'),'0');
console.log(JSON.stringify({fresh_db:db,migration:'PASS',owner:'ALLOW',anonymous:'DENY',member:'DENY',paid:'DENY',logout:'DENY',immutable:'PASS',idempotency:'PASS',forward_backdating:'DENY',production_used:false,core_data_diff:0}));
