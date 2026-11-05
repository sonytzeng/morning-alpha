import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema vnext_runtime;
 create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;`);
 await db.exec(readFileSync(new URL('../research/daily-ai-jobs.candidate.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../research/daily-ai-batches.candidate.sql',import.meta.url),'utf8'));
 const body={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff:'2026-10-31T01:00:00Z',through:'2026-10-30',packet_texts:{},packet_hashes:{},gaps:{}};
 for(let i=0;i<72;i++){
  const symbol=String(1000+i),packet={symbol,company:'測試',cutoff:body.cutoff,data_through:body.through,evidence:[{id:'E1',kind:'NEWS',symbol,source:'https://www.twse.com.tw/',content:'測試',published_at:null,time_basis:'OBSERVED_AFTER_RECEIPT',first_seen_at:'2026-10-30T10:00:00Z',as_of:'2026-10-30T10:00:00Z',available_at:'2026-10-30T10:00:00Z',evidence_hash:'a'.repeat(64)}]};
  body.packet_texts[symbol]=canonical(packet);body.packet_hashes[symbol]=await snapshotHash(packet);
 }
 const store=async b=>db.query('select public.store_daily_stock_ai_batch_v1($1,$2) r',[canonical(b),await snapshotHash(b)]);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>store(body),/permission denied/);await assert.rejects(()=>db.query('select public.load_daily_stock_ai_batch_v1($1,null)',['a'.repeat(64)]),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_batches'),/permission denied/);
 const saved=(await store(body)).rows[0].r;assert.equal(saved.packets,72);assert.equal((await store(body)).rows[0].r.batch_id,saved.batch_id);
 const loaded=(await db.query('select public.load_daily_stock_ai_batch_v1($1,null) r',[saved.batch_id])).rows[0].r;assert.equal(loaded.packets.length,72);assert.equal(loaded.packets[0].evidence[0].published_at,null);
 const changed=structuredClone(body);changed.packet_hashes['1000']='b'.repeat(64);await assert.rejects(()=>store(changed),/AI_INPUT_PACKET/);
 const future=structuredClone(body);const p=JSON.parse(future.packet_texts['1000']);p.evidence[0].available_at='2026-11-02T00:00:00Z';future.packet_texts['1000']=canonical(p);future.packet_hashes['1000']=await snapshotHash(p);await assert.rejects(()=>store(future),/AI_INPUT_EVIDENCE/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_batches')).rows[0].n,1);
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_batches set cutoff=now()'),/IMMUTABLE/);
 const progress=async(batch,revision)=>(await db.query('select public.load_daily_stock_ai_progress_v1($1,$2) r',[batch,revision])).rows[0].r;
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>progress(saved.batch_id,'test-v1'),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');
 for(const [id,revision] of [[null,'v1'],['bad','v1'],[saved.batch_id,null],[saved.batch_id,' '],[saved.batch_id,'x'.repeat(201)]])await assert.rejects(()=>progress(id,revision),/AI_PROGRESS_SCOPE/);
 await assert.rejects(()=>progress('f'.repeat(64),'test-v1'),/AI_PROGRESS_BATCH_MISSING/);
 assert.deepEqual((await progress(saved.batch_id,'test-v1')).completed,{});
 // These are isolated synthetic analyses completed through the real job RPC.
 // Progress must include only actual COMPLETE rows with all four exact scopes.
 const job=async(symbol,revision,patch={},finish=true)=>{
  const context={symbol,input_hash:body.packet_hashes[symbol],cutoff:body.cutoff,model_revision:revision,...patch};
  const identity=canonical({version:'DAILY_AI_BATCH_1',input_hash:context.input_hash,model_revision:revision}),key=await snapshotHash(JSON.parse(identity));
  const call=async(op,lease=null,result=null)=>(await db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4,$5,$6,null) r',[op,key,identity,context,result,lease])).rows[0].r;
  const claim=await call('CLAIM');assert.equal(claim.state,'ACQUIRED');
  const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:context.symbol,cutoff:context.cutoff,input_hash:context.input_hash,member_published:false,publication_ready:false,model_generated:true,
   receipt:{response_id:'isolated-'+key,model:'test',input_tokens:10,output_tokens:10},sources:[],
   horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'隔離測試',evidence_ids:['E1']},counter_evidence:[],confirmation:'新資料',invalidation:'反證',gaps:[]}))};
  if(finish)assert.equal((await call('COMPLETE',claim.lease,result)).state,'STORED');
  return {key,result,lease:claim.lease};
 };
 const exact=await job('1000','test-v1'),revision=await job('1000','test-v2');
 await job('1001','test-v1',{},false);
 await job('1002','test-v1',{symbol:'9999'});
 await job('1003','test-v1',{cutoff:'2026-10-30T00:00:00Z'});
 const failed=await job('1004','test-v1',{},false);
 await db.query('select public.daily_stock_ai_job_v1($1,$2,null,null,null,$3,$4)',['FAIL',failed.key,failed.lease,'AI_BATCH_TEST']);
 const response=await progress(saved.batch_id,'test-v1');
 assert.deepEqual(response,{schema:'DAILY_AI_PROGRESS_V1',batch_id:saved.batch_id,model_revision:'test-v1',completed:{[exact.key]:exact.result}});
 assert.deepEqual((await progress(saved.batch_id,'test-v2')).completed,{[revision.key]:revision.result});
 assert(!JSON.stringify(response).includes('lease'));assert(!JSON.stringify(response).includes('attempts'));
 const alternate=structuredClone(body),alternatePacket=JSON.parse(alternate.packet_texts['1000']);alternatePacket.company='另一批測試';alternate.packet_texts['1000']=canonical(alternatePacket);alternate.packet_hashes['1000']=await snapshotHash(alternatePacket);
 const alternateSaved=(await store(alternate)).rows[0].r;
 assert.deepEqual((await progress(alternateSaved.batch_id,'test-v1')).completed,{});
 const other=await job('1000','test-v1',{input_hash:alternate.packet_hashes['1000']});
 assert.deepEqual((await progress(alternateSaved.batch_id,'test-v1')).completed,{[other.key]:other.result});
 assert.deepEqual((await progress(saved.batch_id,'test-v1')).completed,{[exact.key]:exact.result});
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_jobs'),/permission denied/);
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_batches'),/permission denied/);
 console.log('PASS: private immutable 72-stock input batch; exact per-packet hashes; unknown publication preserved; RPC isolation; idempotent storage; mismatch/future evidence rejected atomically; progress returns only actual COMPLETE results for exact retained batch/cutoff/symbol/hash/model without leases.');
}finally{await db.close();}
