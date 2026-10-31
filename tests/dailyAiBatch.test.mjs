import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseDailyBatch} from '../research/daily-ai-batch.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
const packets=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試',cutoff:'2026-10-30T12:00:00Z',evidence:[{id:'E',symbol:String(1000+i),kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試資料'}]}));
const result=async p=>({schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:p.symbol,cutoff:p.cutoff,input_hash:await snapshotHash(p),member_published:false,model_generated:true,
 sources:p.evidence.map(({content,...source})=>source),horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'測試判斷',evidence_ids:['E']},counter_evidence:[],confirmation:'等待新資料',invalidation:'新證據否定判斷',gaps:[]}))});
test('72-stock batch resumes bounded work and reuses completed content without member-dependent model calls',async()=>{
 const saved=new Map();let calls=0;
 const jobs={claim:async k=>saved.has(k)?{state:'CACHED',result:saved.get(k)}:{state:'ACQUIRED',lease:'test'},complete:async(k,lease,r)=>saved.set(k,r),fail:async()=>assert.fail('unexpected failure')};
 const run=async p=>{calls++;return result(p);};
 let r;for(let i=0;i<9;i++)r=await analyseDailyBatch({packets:packets(),modelRevision:'test-v1',maxStocks:8},jobs,run);
 assert.equal(calls,72);assert.equal(r.complete,true);
 r=await analyseDailyBatch({packets:packets(),modelRevision:'test-v1',maxStocks:8},jobs,run);assert.equal(r.model_calls,0);assert.equal(calls,72);
});
test('failure is recorded without provider error prose or a false complete result',async()=>{
 const codes=[];const jobs={claim:async()=>({state:'ACQUIRED',lease:'test'}),complete:async()=>assert.fail(),fail:async(k,l,c)=>codes.push(c)};
 const r=await analyseDailyBatch({packets:packets(),modelRevision:'test-v1',maxStocks:1},jobs,async()=>{throw Error('sensitive provider response');});
 assert.equal(r.complete,false);assert.deepEqual(codes,['AI_BATCH_FAILED']);assert.equal(r.rows[0].state,'FAILED');
});
test('future evidence and duplicate symbols stop before claims',async()=>{
 const p=packets();p[71].evidence[0].available_at='2026-10-31T12:00:00Z';
 await assert.rejects(()=>analyseDailyBatch({packets:p,modelRevision:'test-v1',maxStocks:8},{claim:async()=>assert.fail()},result),/AI_ANALYSIS_EVIDENCE/);
 p[71]=p[0];await assert.rejects(()=>analyseDailyBatch({packets:p,modelRevision:'test-v1',maxStocks:8},{},result),/AI_BATCH_SCOPE/);
});
test('unknown result commits never produce a competing FAIL write or a second model call',async()=>{
 let calls=0;const jobs={claim:async()=>({state:'ACQUIRED',lease:'test'}),complete:async()=>{throw Error('AI_BATCH_SAVE_UNCONFIRMED');},fail:async()=>assert.fail('complete may already have committed')};
 await assert.rejects(()=>analyseDailyBatch({packets:packets(),modelRevision:'test-v1',maxStocks:1},jobs,async p=>{calls++;return result(p);}),/AI_BATCH_SAVE_UNCONFIRMED/);
 assert.equal(calls,1);
});
test('external interruption retains the lease and does not authorize immediate paid retries',async()=>{
 const controller=new AbortController();let calls=0;
 const jobs={claim:async()=>({state:'ACQUIRED',lease:'test'}),complete:async()=>assert.fail(),fail:async()=>assert.fail('an interrupted result is unknown')};
 await assert.rejects(()=>analyseDailyBatch({packets:packets(),modelRevision:'test-v1',maxStocks:1,signal:controller.signal},jobs,async()=>{calls++;controller.abort();throw Error('provider request interrupted');}),/AI_ANALYSIS_ABORTED/);
 assert.equal(calls,1);
 await assert.rejects(()=>analyseDailyBatch({packets:packets(),modelRevision:'test-v1',maxStocks:1,signal:controller.signal},{claim:async()=>assert.fail('already aborted')},result),/AI_ANALYSIS_ABORTED/);
});
test('valid paid output is saved when the deadline elapses just before storage',async()=>{
 const controller=new AbortController();let saved=0;
 const jobs={claim:async()=>({state:'ACQUIRED',lease:'test'}),complete:async()=>{saved++;},fail:async()=>assert.fail()};
 await assert.rejects(()=>analyseDailyBatch({packets:packets(),modelRevision:'test-v1',maxStocks:1,signal:controller.signal},jobs,async p=>{const output=await result(p);controller.abort();return output;}),/AI_ANALYSIS_ABORTED/);
 assert.equal(saved,1);
});
