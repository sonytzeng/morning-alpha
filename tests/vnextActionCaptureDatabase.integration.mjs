/** Exact saved production SOURCE_SAVE against isolated local PGlite only. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fetchSource} from '../src/features/vnext/dailyAdapter.ts';
import {validateActionResponseCapture} from '../src/features/vnext/dailyActionCapture.ts';
import {canonical} from '../research/entry-opportunity.ts';

assert(process.env.MA_PGLITE_MODULE?.startsWith('/'),'LOCAL_PGLITE_REQUIRED');
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),q=async(s,p=[])=>(await db.query(s,p)).rows;
const run='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222';
const phases=[];
const op=async(operation,data)=>{
 await db.exec('set role service_role');
 try{return (await q('select public.vnext_daily_runtime_v1($1,$2,1,$3,$4) r',[run,lease,operation,data]))[0].r;}
 finally{await db.exec('reset role');}
};
try{
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;');
 const foundation=read('supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql');
 await db.exec(foundation.slice(0,foundation.indexOf('-- Admission reads'))+'\ncommit;');
 await db.exec(read('tests/fixtures/action-source-runtime.saved.sql'));
 await db.exec('revoke all on function public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb) from public,anon,authenticated,service_role;grant execute on function public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb) to service_role;');
 const definition=(await q("select md5(pg_get_functiondef('public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb)'::regprocedure)) h"))[0].h;
 assert.equal(definition,'781d27ab8c7e9fead92634c0c5be227b');
 await q("insert into vnext_runtime.runs(id,business_date,upstream_batch,upstream_phase,actionable_at,created_at,lease,lease_until,fence) values($1,'2026-10-12',$1,'PREMARKET',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 minute',$2,clock_timestamp()+interval '1 hour',1)",[run,lease]);
 const at=new Date().toISOString();
 const task={key:'a'.repeat(64),kind:'ACTION',url:'https://www.twse.com.tw/rwd/zh/exRight/TWT49U?startDate=20250901&endDate=20261109&response=json',
  format:'json',scope:'SYNTHETIC_ACTION_SQL',symbols:['2330'],from:'2025-09-01',through:'2026-11-09',action_index:0,max_age_days:1};
 const raw={stat:'OK',fields:['資料日期','股票代號','股票名稱','除權息前收盤價','除權息參考價','每股現金股利'],
  data:[['115年09月16日','2330','合成控制','100','93','6.000035']],opaque_provider_field:{preserved:true}};
 const text='\n'+JSON.stringify(raw,null,2)+'\n';
 const current=await fetchSource(task,async()=>new Response(text),()=>at,new AbortController().signal);
 const legacy=structuredClone(current);delete legacy.raw_response;legacy.task.key='b'.repeat(64);legacy.task.scope='SYNTHETIC_LEGACY_SQL';
 const expected=[];
 for(const receipt of [legacy,current]){
  assert.equal((await op('SOURCE_BEGIN',receipt.task)).status,'FETCH');
  const encoded=canonical(receipt),id=createHash('sha256').update(encoded).digest('hex');
  const saved=await op('SOURCE_SAVE',{text:encoded});assert.equal(saved.status,'STORED');assert.equal(saved.source_revision,id);
  const cached=await op('SOURCE_BEGIN',receipt.task);assert.equal(cached.status,'CACHE');assert.deepEqual(cached.receipt,receipt);
  const stored=(await q('select payload_text,receipt from vnext_runtime.source_revisions where id=$1',[id]))[0];
  assert.equal(stored.payload_text,encoded);assert.deepEqual(stored.receipt,receipt);expected.push(receipt);
 }
 const rows=await op('SOURCES',{});assert.equal(rows.length,2);
 assert.equal(Object.hasOwn(rows.find(r=>r.task.key===legacy.task.key),'raw_response'),false);
 const retained=rows.find(r=>r.task.key===current.task.key);
 assert.equal(retained.raw_response.text,text);assert.equal(await validateActionResponseCapture(retained.raw_response,retained.raw_hash),'RETAINED_TEXT_VALID');
 assert.equal(retained.payload.complete,false);assert.equal(retained.payload.rows[0].adjustment_applied,false);
 assert.equal(retained.payload.rows[0].cash_per_share,6.000035);
 phases.push({name:'exact_production_rpc_legacy_and_new_capture',status:'PASS',definition_md5:definition,rows:2,complete_false:true});

 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(()=>q('select receipt from vnext_runtime.source_revisions'),/permission denied/);
   await assert.rejects(()=>q('select public.vnext_daily_runtime_v1($1,$2,1,$3,$4)',[run,lease,'SOURCES',{}]),/permission denied/);
  }finally{await db.exec('reset role');}
 }
 await assert.rejects(()=>q('update vnext_runtime.source_revisions set receipt=$1',[{}]),/VNEXT_RUNTIME_IMMUTABLE/);
 await assert.rejects(()=>q('delete from vnext_runtime.source_revisions'),/VNEXT_RUNTIME_IMMUTABLE/);
 assert.equal((await q('select count(*)::int n from vnext_runtime.predictions'))[0].n,0);
 assert.equal((await q('select count(*)::int n from vnext_runtime.publication_status'))[0].n,0);
 phases.push({name:'private_append_only_no_review_or_publication',status:'PASS',user_read_and_rpc_denied:true});

 const huge=structuredClone(current);huge.task.key='c'.repeat(64);huge.raw_response.text='x'.repeat(12_000_000);
 assert.equal((await op('SOURCE_BEGIN',huge.task)).status,'FETCH');
 await assert.rejects(()=>op('SOURCE_SAVE',{text:canonical(huge)}),/SOURCE_TIME_INVALID/);
 assert.equal((await q('select count(*)::int n from vnext_runtime.source_revisions'))[0].n,2);
 assert.equal((await q('select source_id from vnext_runtime.run_sources where run_id=$1 and task_key=$2',[run,huge.task.key]))[0].source_id,null);
 phases.push({name:'unchanged_database_receipt_cap_rejects_atomically',status:'PASS',source_saved:false});
 const report={schema:'VNEXT_ACTION_CAPTURE_DATABASE_CHECK_V1',scope:'LOCAL_PGLITE_SYNTHETIC_EXACT_SAVED_SQL',status:'PASS',phases,production_writes:0};
 if(process.env.MA_ACTION_CAPTURE_DB_RECEIPT)writeFileSync(process.env.MA_ACTION_CAPTURE_DB_RECEIPT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{await db.close();}
