import test from 'node:test';
import assert from 'node:assert/strict';
import {stageCompletedStockAiBatch} from '../supabase/functions/daily-stock-analysis-v1/checkpoint.ts';
import {parseStockAiProgress,stockAiModelRevision} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

const batch={id:'a'.repeat(64),cutoff:'2026-10-30T12:00:00Z',packets:Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試',cutoff:'2026-10-30T12:00:00Z',evidence:[]}))};
const summary=()=>({status:'ANALYSIS_COMPLETE',batch_id:batch.id,cutoff:batch.cutoff,counts:{CACHED:71,COMPLETE:1,BUSY:0,FAILED:0,DEFERRED:0},requires_next_checkpoint:false,member_published:false});
test('progress cache is bound to exact batch, model revision and at most 72 hashed job IDs',()=>{
 const revision=stockAiModelRevision('test-model'),value={schema:'DAILY_AI_PROGRESS_V1',batch_id:batch.id,model_revision:revision,completed:{['b'.repeat(64)]:{result:'validated later'}}};
 assert.deepEqual(parseStockAiProgress(value,batch.id,revision),value.completed);
 for(const change of [v=>v.schema='wrong',v=>v.batch_id='c'.repeat(64),v=>v.model_revision='wrong',v=>v.completed=[],v=>v.completed={raw_key:{}},
  v=>v.completed=Object.fromEntries(Array.from({length:73},(_,i)=>[i.toString(16).padStart(64,'0'),{}]))]){
  const v=structuredClone(value);change(v);assert.throws(()=>parseStockAiProgress(v,batch.id,revision),/AI_BATCH_PROGRESS_INVALID/);
 }
});
test('complete checkpoint stages exact job keys with deterministic expiry and never publishes',async()=>{
 const revision=stockAiModelRevision('test-model');let captured;
 const r=await stageCompletedStockAiBatch(summary(),batch,revision,async(name,args)=>{
  captured={name,args};return {status:'STAGED_REVIEW_REQUIRED',edition_id:'b'.repeat(64),member_published:false,rights_ready:true};
 });
 assert.equal(captured.name,'stage_daily_ai_research_edition_v1');assert.equal(captured.args.p_batch_id,batch.id);assert.equal(captured.args.p_expires_at,'2026-11-02T12:00:00.000Z');
 assert.equal(captured.args.p_job_keys.length,72);assert.equal(new Set(captured.args.p_job_keys).size,72);
 assert.equal(captured.args.p_job_keys[0],await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:await snapshotHash(batch.packets[0]),model_revision:revision}));
 assert.deepEqual(r,{edition_id:'b'.repeat(64),edition_status:'STAGED_REVIEW_REQUIRED',requires_stage_checkpoint:false,member_published:false});
});
test('pending, mismatched or incomplete summaries never stage; database failure stays a recoverable checkpoint',async()=>{
 for(const change of [s=>s.status='ANALYSIS_PENDING',s=>s.batch_id='c'.repeat(64),s=>s.requires_next_checkpoint=true,s=>s.counts.CACHED=70,s=>s.counts.FAILED=1]){
  const s=summary();change(s);const r=await stageCompletedStockAiBatch(s,batch,'test',async()=>assert.fail('must not stage incomplete analysis'));
  assert.equal(r.requires_stage_checkpoint,true);assert.equal(r.member_published,false);
 }
 for(const reply of [async()=>{throw Error('private error');},async()=>({status:'STAGED_REVIEW_REQUIRED',edition_id:'b'.repeat(64),member_published:true}),async()=>({status:'PUBLISHED'})]){
  const r=await stageCompletedStockAiBatch(summary(),batch,'test',reply);assert.equal(r.edition_status,'STAGING_PENDING');assert.equal(r.edition_id,null);assert.equal(r.member_published,false);
 }
});
