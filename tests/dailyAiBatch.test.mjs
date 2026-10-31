import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseDailyBatch} from '../research/daily-ai-batch.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
const packets=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試',cutoff:'2026-10-30T12:00:00Z',evidence:[{id:'E',symbol:String(1000+i),kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試資料'}]}));
const result=async p=>({schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:p.symbol,cutoff:p.cutoff,input_hash:await snapshotHash(p),member_published:false,horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon}))});
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
