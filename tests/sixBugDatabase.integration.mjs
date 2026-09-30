// Fresh isolation only. No URL, Production credential, network dispatch, Cron
// or business backfill. The exact schema-only predecessor is hash-pinned.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import calendar from '../supabase/functions/_shared/market-calendar-data.json' with {type:'json'};
import {previousMarketTradingDate,validateGlobal8Session} from '../supabase/functions/_shared/market-session-contract.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const db=process.env.MA_ISOLATED_TEST_DB,container=process.env.MA_TEST_DOCKER_CONTAINER;
assert.equal(process.env.MA_LOCAL_SCOPE,'ma-six-bug-preventive-20260930');
assert.match(db||'',/^ma_six_bug_test\d+$/);
if(container)assert.match(container,/^ma-six-bug-(?:candidate|lifecycle|shadow)-db$/);
const port=process.env.MA_TEST_PGPORT||'55439';assert.match(port,/^\d{4,5}$/);
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const sql=(input,database=db)=>execFileSync(container?'docker':'psql',container?
 ['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1']:
 ['-X','-q','-h','127.0.0.1','-p',port,'-d',database,'-At','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:4e6,stdio:['pipe','pipe','pipe']}).trim();
const schema=read('tests/fixtures/six-bug-schema-only-20260930.sql');
const manifest=JSON.parse(read('tests/fixtures/six-bug-schema-only-20260930.json'));
assert.equal(createHash('sha256').update(schema).digest('hex'),manifest.sha256);
assert.equal(manifest.business_rows,0);
assert.equal(sql(`select count(*) from pg_database where datname=${q(db)}`,'postgres'),'0','NEW_DATABASE_REQUIRED');
sql(`create database ${db}`,'postgres');
sql(`do $$begin
 if not exists(select 1 from pg_roles where rolname='anon')then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated nologin;end if;
 if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role nologin bypassrls;end if;
end$$;`);
assert.equal(sql("select rolbypassrls from pg_roles where rolname='service_role'"),'t');
sql('drop schema public;'+schema); // Empty new DB only, never the source DB.
sql(read('supabase/migrations/20260923124500_production_evidence_recorder_v1.sql'));
for(const [signature,hash]of Object.entries(manifest.function_predecessor_hashes))
 assert.equal(sql(`select md5(pg_get_functiondef(${q('public.'+signature)}::regprocedure))`),hash);
const catalogs=()=>sql(`select jsonb_agg(jsonb_build_object('name',proname,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'defaults',proargdefaults::text) order by proname)
 from pg_proc where oid in (${Object.keys(manifest.function_predecessor_hashes).map(s=>q('public.'+s)+'::regprocedure').join(',')})`);
const beforeCatalog=catalogs();
const migration=read('supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql');
sql(migration);
assert.equal(catalogs(),beforeCatalog,'Original owner, ACL, defaults, security and search_path must not change');
assert.equal(sql('select count(*) from public.market_checkpoint_snapshots'),'0');
assert.equal(sql('select count(*) from public.reports'),'0');
if(process.argv.includes('--bootstrap-only')){
 sql("create schema ma_isolated_guard;create table ma_isolated_guard.identity(scope text primary key);insert into ma_isolated_guard.identity values('ma-six-bug-preventive-20260930');");
 // The schema-only artifact deliberately has no copied grants. This private
 // loopback test API uses a local service-role, never a production credential.
 sql('grant usage on schema public to service_role;grant all on all tables in schema public to service_role;grant all on all sequences in schema public to service_role;grant execute on all functions in schema public to service_role;');
 console.log(JSON.stringify({fresh_database:db,bootstrap:'PASS',business_rows:0,production_writes:0}));
 process.exit(0);
}
assert.deepEqual(JSON.parse(sql('select public.authoritative_market_calendar_v1()')),calendar);
let checks=1;
for(const day of ['2026-09-30','2026-09-21','2026-09-29','2026-10-27','2026-05-04','2026-02-23','2026-01-02']){
 assert.equal(sql(`select public.previous_market_session_v1('TW',${q(day)})`),previousMarketTradingDate('TW',day));checks++;
}
for(const [key,symbol]of Object.entries(calendar.global8_source_symbols))for(const [source,observed]of [
 ['2026-09-29T20:00:00Z','2026-09-29T23:00:00Z'],['2026-09-28T20:00:00Z','2026-09-29T23:00:00Z'],
 ['2026-09-25T20:00:00Z','2026-09-27T23:00:00Z'],['2026-09-04T20:00:00Z','2026-09-07T23:00:00Z'],
 ['2026-09-29T23:00:00.001Z','2026-09-29T23:00:00Z'],['2026-11-27T18:00:00Z','2026-11-27T23:00:00Z'],
 ['2025-12-31T21:00:00Z','2026-01-01T23:00:00Z']]){
 assert.equal(sql(`select public.global8_session_valid_v1(${[key,symbol,source,observed].map(q).join(',')})`)==='t',validateGlobal8Session(key,symbol,source,observed).valid);checks++;
}
assert.equal(sql("select has_table_privilege('anon','production_critical_contract_evidence','SELECT') or has_table_privilege('authenticated','production_critical_contract_evidence','INSERT')"),'f');
assert.equal(sql("select has_function_privilege('anon','record_critical_contract_evidence_v1(date,text,jsonb)','EXECUTE')"),'f');
const benign={contract_version:'CRITICAL_CONTRACT_REPLAY_V1',input:{status:'BLOCKED'},expected:{status:'BLOCKED'}};
const record=c=>`select public.record_critical_contract_evidence_v1('2026-09-30','RESEARCH',${q(JSON.stringify(c))}::jsonb)`;
assert.match(sql(record(benign)),/^[0-9a-f-]{36}$/);
assert.equal(sql(record({...benign,input:{Authorization:'Bearer never-store'}})),'');
assert.equal(sql(record({...benign,input:{email:'person@example.com'}})),'');
assert.equal(sql(record({input:{status:'PASS'}})),'');
assert.equal(sql('select bool_and(retention_until=recorded_at+interval \'90 days\') from production_critical_contract_evidence'),'t');
assert.throws(()=>sql("update production_critical_contract_evidence set stage='LEARNING'"),/APPEND_ONLY/);
assert.throws(()=>sql('delete from production_critical_contract_evidence'),/APPEND_ONLY/);
assert.equal(sql('select public.cleanup_expired_critical_contract_evidence_v1(1000)'),'0');
// The legacy 18:00 helper's precision difference cannot pass the actual Atomic
// close collection window. Mutations are explicitly synthetic; retained input
// source timestamps and quotes are never rewritten in the corpus.
const closeFixture=JSON.parse(read('tests/fixtures/production-parity-v4/runtime-sparse-recovery-20260929.json')).captures.find(c=>c.checkpoint==='1430');
for(const time of ['17:59:59.999','18:00:00.000','18:00:00.001']){
 const rows=closeFixture.rows.map(r=>({...r,captured_at:`2026-09-29T${time}+08:00`}));
 try{sql(`select public.commit_market_checkpoint_batch_v1('2026-09-29','1430','close','10000000-0000-4000-8000-000000000001','market-checkpoint:2026-09-29:1430:MARKET_CHECKPOINT_PROVIDER_V1',${q(JSON.stringify(rows))}::jsonb)`);assert.fail('Late boundary accepted');}
 catch(error){assert.match(String(error.stderr||error),/ATOMIC_CHECKPOINT_COLLECTION_TIME_INVALID/);}
}
// Successful and rejected Lifecycle calls execute the unchanged predicates.
const today=sql("select (clock_timestamp() at time zone 'Asia/Taipei')::date");
sql(`select public.advance_trading_day_state_v1(${q(today)},'PREMARKET_CAPTURED','premarket','FAILED',null,'{}');`);
assert.equal(sql("select count(*) from production_critical_contract_evidence where stage='LIFECYCLE'"),'1');
try{sql(`select public.advance_trading_day_state_v1(${q(today)},'CLOSE_1410_CAPTURED','1410','SUCCEEDED',null,'{}');`);assert.fail('Must reject an unproven jump');}
catch(error){assert.match(String(error.stderr||error),/lifecycle_predecessor_not_satisfied/);assert.match(String(error.stderr||error),/critical_contract_capsule/);}
sql(`select public.capture_morning_alpha_acceptance_v1(${q(today)});`);
assert.equal(sql("select count(*) from production_critical_contract_evidence where stage='ACCEPTANCE'"),'1');
// Recorder table failure must not become a lifecycle failure.
sql(`begin;alter table production_critical_contract_evidence add constraint injected_recorder_failure check(false) not valid;
 select public.advance_trading_day_state_v1(${q(today)},'PREMARKET_CAPTURED','premarket','SUCCEEDED',null,'{}');rollback;`);
assert.throws(()=>sql(migration),/PREDECESSOR_MISMATCH/,'An accidental second application is explicitly rejected, not silently re-patched');
console.log(JSON.stringify({fresh_database:db,calendar_and_global8_parity:checks,recorder_security:'PASS',retention_days:90,
 lifecycle_observation:'PASS',acceptance_observation:'PASS',recorder_fail_open:'PASS',catalog_unchanged:true,
 duplicate_migration:'REJECTED_BY_PREDECESSOR_GUARD',production_writes:0}));
