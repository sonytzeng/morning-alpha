/** Disposable PostgreSQL (PGlite) schema/transaction controls only.
 * No Production connection, market prices, publication approval or samples.
 * Set MA_PGLITE_MODULE to an installed @electric-sql/pglite module if needed. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
const moduleName=process.env.MA_PGLITE_MODULE??'@electric-sql/pglite';
const {PGlite}=await import(moduleName.startsWith('/')?pathToFileURL(moduleName).href:moduleName);
const db=new PGlite();const checks=[];
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261103003744_vnext_premarket_entry_v11.sql');
const query=async sql=>(await db.query(sql)).rows;
const rejected=async(sql,pattern)=>{await assert.rejects(()=>db.exec(sql),pattern);await db.exec('rollback;');};
try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select false$$;
 create function public.market_calendar_session_v1(text,date) returns boolean language sql stable as $$select extract(isodow from $2)<6$$;
 create function public.authoritative_market_calendar_v1() returns jsonb language sql stable as $$select '{"TW":{"from":"2026-01-01","through":"2027-12-31"}}'::jsonb$$;
 create table public.market_checkpoint_batches(batch_id uuid,business_date date,checkpoint text,status text,expected_provider_count integer,committed_provider_count integer,committed_at timestamptz);
 create table public.recommendation_shadow_v2_runs(business_date date,source_batch_id uuid,cutoff timestamptz,evidence jsonb,input_sha256 text);
 create table public.decision_snapshots(id uuid,report_date date,session_type text,status text,created_at timestamptz,generated_text jsonb,market_regime text);`);
 await db.exec(read('supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql'));
 const compact=read('supabase/migrations/20261029055349_vnext_compact_checkpoint_state.sql');
 await db.exec(compact.slice(compact.indexOf('CREATE OR REPLACE FUNCTION'),compact.indexOf('end$function$;')+'end$function$;'.length));
 const fingerprint=async()=>(await query("select encode(sha256(convert_to(rtrim(pg_get_functiondef(oid),E'\\n'),'UTF8')),'hex') as hash,proacl::text as acl,prosecdef,proconfig from pg_proc where oid='public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb)'::regprocedure"))[0];
 const before=await fingerprint();assert.equal(before.hash,'9600c4606c026bef9cab27d7dbdba5320c1fc0d01bd0c9c7774a86b0cceb289f');
 await db.exec(migration);const after=await fingerprint();assert.notEqual(after.hash,before.hash);
 assert.deepEqual({...after,hash:before.hash},before);checks.push('Exact canonical deployed baseline and full candidate SQL applied; ACL/definer/search_path preserved');
 await rejected(migration,/ENTRY_V11_RUNTIME_BASELINE_DRIFT/);checks.push('Reapplication / unexpected baseline refused transactionally');
 assert.equal((await query("select count(*)::integer as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vnext_runtime' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity"))[0].count,8);
 await rejected("begin;set local role anon;select public.vnext_daily_runtime_v1(gen_random_uuid(),gen_random_uuid(),1,'ENTRY_SOURCE','{}');",/permission denied/);
 await rejected("begin;set local role authenticated;select public.vnext_daily_runtime_v1(gen_random_uuid(),gen_random_uuid(),1,'ENTRY_SOURCE','{}');",/permission denied/);
 checks.push('Eight private tables retain forced RLS; anon/authenticated cannot execute worker RPC');
 // Controlled clock injection occurs only in this disposable in-memory database,
 // after executing and checking the exact candidate DDL and privileges.
 await db.exec("create function public.entry_v11_test_now() returns timestamptz language sql volatile as $$select '2026-11-03T08:15:00+08:00'::timestamptz$$;");
 const def=(await query("select pg_get_functiondef('public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb)'::regprocedure) as def"))[0].def;
 await db.exec(def.replaceAll('clock_timestamp()','public.entry_v11_test_now()'));
 const run='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222';
 const rows=[];
 for(let n=0;n<72;n++)for(const horizon of ['SHORT','MEDIUM','LONG']){
  const symbol=String(9000+n),body={id:'a'.repeat(64)+':'+symbol+':'+horizon,business_date:'2026-11-03',symbol,company:'SYNTHETIC',horizon,
   mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',strategy_version:'VNEXT_OBSERVATION_HYPOTHESIS_2.0.0',entry_version:'ENTRY_OPPORTUNITY_1.1.0',
   generated_at:'2026-11-03T08:00:00+08:00',locked_at:'2026-11-03T08:00:00+08:00',evidence_cutoff:'2026-11-03T07:50:00+08:00',
   actionable_at:'2026-11-03T09:00:00+08:00',target_sessions:{SHORT:[1,5,10],MEDIUM:[20,40,60],LONG:[120,180,250]}[horizon],
   evidence_hash:'b'.repeat(64),research:{symbol,horizon},entry:['OVERSOLD_REVERSAL','PULLBACK_ENTRY','BREAKOUT_CONTINUATION']
    .map(strategy=>({symbol,strategy,strategy_version:strategy+'_1.1.0',status:'INSUFFICIENT_EVIDENCE',plan:null})),entry_gap:null};
  rows.push({...body,lock_hash:await snapshotHash(body)});
 }
 await db.query(`insert into vnext_runtime.runs(id,business_date,upstream_batch,upstream_phase,created_at,actionable_at,state,lease,lease_until,fence,source_revision)
 values($1,'2026-11-03',gen_random_uuid(),'PREMARKET','2026-11-03T07:00:00+08:00','2026-11-03T09:00:00+08:00','RUNNING',$2,'2026-11-03T09:00:00+08:00',1,$3)`,[run,lease,'c'.repeat(64)]);
 const rpc=async(op,data)=>(await db.query("select public.vnext_daily_runtime_v1($1,$2,1,$3,$4::jsonb) as result",[run,lease,op,JSON.stringify(data)])).rows[0].result;
 const capability=await rpc('ENTRY_SOURCE',{cutoff:'2026-11-03T08:00:00+08:00'});
 assert.deepEqual(capability.entry_versions,['ENTRY_OPPORTUNITY_1.0.0','ENTRY_OPPORTUNITY_1.1.0']);checks.push('Existing fenced source read exposes explicit 1.0/1.1 capability');
 const prepare=async batch=>db.query('update vnext_runtime.runs set checkpoint=$1::jsonb where id=$2',[JSON.stringify({acquired:{entry_version:'ENTRY_OPPORTUNITY_1.1.0',evidence_cutoff:'2026-11-03T07:50:00+08:00'},locks:batch}),run]);
 const envelope=batch=>batch.map(body=>{const {lock_hash,...payload}=body;return {body,canonical:canonical(payload),hash:lock_hash};});
 const negative=async(mutate,pattern)=>{
  const batch=structuredClone(rows);mutate(batch);for(const row of batch){const {lock_hash,...payload}=row;void lock_hash;row.lock_hash=await snapshotHash(payload);}
  await prepare(batch);await assert.rejects(()=>rpc('PREDICTIONS',envelope(batch)),pattern);
  assert.equal((await query('select count(*)::integer as n from vnext_runtime.predictions'))[0].n,0);
 };
 await negative(batch=>batch[0].entry[0].plan={not_before:'2026-11-04',expires_on:'2026-11-04'},/PREDICTION_PREMARKET_ENTRY_SCOPE/);
 await negative(batch=>batch[0].entry.pop(),/PREDICTION_PREMARKET_ENTRY_SCOPE/);
 await negative(batch=>batch[0].entry[1].strategy=batch[0].entry[0].strategy,/PREDICTION_PREMARKET_ENTRY_SCOPE/);
 await negative(batch=>batch[0].entry[0].symbol='9999',/PREDICTION_PREMARKET_ENTRY_SCOPE/);
 await prepare(rows);await db.query("update vnext_runtime.runs set checkpoint=checkpoint #- '{acquired,entry_version}' where id=$1",[run]);
 await assert.rejects(()=>rpc('PREDICTIONS',envelope(rows)),/PREDICTION_PREMARKET_ENTRY_SCOPE/);
 checks.push('Wrong-session plan, missing/duplicate strategies, wrong stock, and unpinned version all reject without inserting predictions');
 await prepare(rows);assert.equal((await rpc('PREDICTIONS',envelope(rows))).status,'LOCKED');
 assert.equal((await query('select count(*)::integer as n from vnext_runtime.predictions'))[0].n,216);
 assert.equal((await rpc('PREDICTIONS',envelope(rows))).status,'LOCKED');
 assert.equal((await query('select count(*)::integer as n from vnext_runtime.predictions'))[0].n,216);
 assert.equal((await query('select count(*)::integer as n from vnext_runtime.publication_status where approved or licensing<>\'PENDING\''))[0].n,0);
 checks.push('Exactly 216 1.1 locks persist once; exact retries remain idempotent; publication approvals remain zero');
 // A legacy acquisition already waiting at deployment must remain admissible.
 await db.exec("create or replace function public.entry_v11_test_now() returns timestamptz language sql volatile as $$select '2026-11-04T08:15:00+08:00'::timestamptz$$;");
 const legacyRun='33333333-3333-4333-8333-333333333333',legacy=structuredClone(rows);
 for(const row of legacy){row.id='d'.repeat(64)+':'+row.symbol+':'+row.horizon;row.business_date='2026-11-04';row.entry_version='ENTRY_OPPORTUNITY_1.0.0';
  for(const key of ['generated_at','locked_at','evidence_cutoff','actionable_at'])row[key]=new Date(Date.parse(row[key])+86400000).toISOString();
  row.entry.forEach(entry=>entry.strategy_version=entry.strategy+'_1.0.0');
  const {lock_hash,...payload}=row;void lock_hash;row.lock_hash=await snapshotHash(payload);}
 await db.query(`insert into vnext_runtime.runs(id,business_date,upstream_batch,upstream_phase,created_at,actionable_at,state,lease,lease_until,fence,source_revision,checkpoint)
 values($1,'2026-11-04',gen_random_uuid(),'PREMARKET','2026-11-04T07:00:00+08:00','2026-11-04T09:00:00+08:00','RUNNING',$2,'2026-11-04T09:00:00+08:00',1,$3,$4::jsonb)`,
 [legacyRun,lease,'e'.repeat(64),JSON.stringify({acquired:{evidence_cutoff:legacy[0].evidence_cutoff},locks:legacy})]);
 const legacySaved=(await db.query("select public.vnext_daily_runtime_v1($1,$2,1,'PREDICTIONS',$3::jsonb) as result",[legacyRun,lease,JSON.stringify(envelope(legacy))])).rows[0].result;
 assert.equal(legacySaved.status,'LOCKED');
 assert.equal((await db.query('select count(*)::integer as n from vnext_runtime.predictions where run_id=$1',[legacyRun])).rows[0].n,216);
 checks.push('An already-pinned legacy 1.0 acquisition still saves its original 216 locks after the additive upgrade');
 console.log(JSON.stringify({state:'PASS',engine:'PGlite PostgreSQL',checks,production_changes:0},null,2));
}finally{await db.close();}
