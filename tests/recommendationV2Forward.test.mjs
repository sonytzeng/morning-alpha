import test from 'node:test';
import assert from 'node:assert/strict';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {evaluateV2Shadow,V2_METHODOLOGY} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {v2DailySnapshot,v2WatchTransitions,v2DailyHealth,v2SampleStatus} from '../src/features/research/recommendation-v2-forward.ts';
import {forwardTriggerBody,scheduleV2ForwardTrigger} from '../supabase/functions/_shared/recommendation-v2-forward-trigger.ts';
import {sharedV2Acquisition} from '../supabase/functions/_shared/recommendation-v2-acquisition-cache.ts';

test('NONE saves all 72, exact reasons, independent and cumulative gates, at most five non-recommendations',async()=>{
 const input=v2Fixture();input.sources.find(c=>c.kind==='growth').rows.forEach(r=>r.revenue_yoy=-.1);
 const result=await evaluateV2Shadow(input),before=structuredClone(result);
 const snapshot=v2DailySnapshot(result,{'2330':'SYNTHETIC_NAME'});
 assert.equal(snapshot.counts.NONE,72);assert.equal(snapshot.reason_distribution.ACTUAL_REVENUE_DETERIORATION,72);
 assert.equal(snapshot.funnel.find(g=>g.gate==='fundamental').independent_pass,0);
 assert.equal(snapshot.funnel.at(-1).cumulative_pass,0);
 assert.equal(snapshot.near_miss.length,5);assert(snapshot.near_miss.every(c=>c.is_recommendation===false&&c.status==='NONE'));
 assert.equal(snapshot.production_eligible,false);assert.deepEqual(result,before);
 assert.throws(()=>v2DailySnapshot({...result,candidates:result.candidates.slice(1)}),/INCOMPLETE/);
 assert.throws(()=>v2DailySnapshot({...result,candidates:Array(72).fill(result.candidates[0])}),/INCOMPLETE/);
});
test('partial-support fundamental data may PASS the frozen gate; missing critical evidence never becomes near-miss',async()=>{
 const input=v2Fixture(),result=await evaluateV2Shadow(input),snapshot=v2DailySnapshot(result);
 assert.equal(snapshot.funnel.find(g=>g.gate==='fundamental').independent_pass,72);
 assert.equal(snapshot.near_miss.length,0);
 input.data.quotes=[];const lost=v2DailySnapshot(await evaluateV2Shadow(input));
 assert.equal(lost.counts.BLOCKED,72);assert.equal(lost.near_miss.length,0);
});
test('intraday append projection preserves original WATCH and next-session entry; future/reversed lineage fails',async()=>{
 const input=v2Fixture();input.sources=input.sources.filter(c=>c.kind!=='shares');
 const pre=await evaluateV2Shadow(input),next=structuredClone(pre);next.cutoff=new Date(Date.parse(pre.cutoff)+1000).toISOString();next.source_revision='SYNTHETIC_INTRADAY';
 next.candidates[0].status='READY';next.candidates[1].status='NONE';next.candidates[2].status='BLOCKED';
 const before=structuredClone(pre),transitions=v2WatchTransitions(pre,next);
 assert.equal(transitions.length,72);assert.deepEqual(transitions.slice(0,3).map(t=>t.to),['READY','NONE','DROP']);
 assert.deepEqual(pre,before);assert(transitions.every(t=>t.original_prediction_unchanged));
 assert.throws(()=>v2WatchTransitions(next,pre),/LINEAGE/);
 assert.throws(()=>v2WatchTransitions(pre,{...next,business_date:'2026-10-08'}),/LINEAGE/);
 assert.throws(()=>v2WatchTransitions(pre,{...next,candidates:[]}),/SYMBOL/);
});
const dates=['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07'];
const day=(business_date,counts)=>({business_date,methodology_version:V2_METHODOLOGY,cutoff:business_date+'T06:30:00Z',counts,reason_distribution:{RISK:72}});
test('five true trading-day NONEs trigger research review, never degraded or automatic strategy change',()=>{
 const history=dates.map(d=>day(d,{NONE:72,WATCH:0,READY:0,BLOCKED:0}));
 const h=v2DailyHealth(history,dates,V2_METHODOLOGY);
 assert.equal(h.zero_candidate_review,'ZERO_CANDIDATE_REVIEW');assert.equal(h.service_status,'NORMAL');assert.equal(h.automatic_rule_change,false);
 assert.equal(v2DailyHealth(history.slice(1),dates,V2_METHODOLOGY).zero_candidate_review,'NOT_DUE');
 assert.equal(v2DailyHealth(history,dates,'V2.1').zero_candidate_days,0);
 assert.equal(v2DailyHealth([...history,...history],dates,V2_METHODOLOGY).zero_candidate_days,5);
});
test('BLOCKED 3 warns and 5 degrades; missing days neither fabricated nor skipped',()=>{
 const history=dates.map(d=>day(d,{NONE:0,WATCH:0,READY:0,BLOCKED:72}));
 assert.equal(v2DailyHealth(history.slice(-3),dates,V2_METHODOLOGY).service_status,'WARNING');
 assert.equal(v2DailyHealth(history,dates,V2_METHODOLOGY).service_status,'SERVICE_DEGRADED');
 const missing=v2DailyHealth(history.slice(0,-1),dates,V2_METHODOLOGY);
 assert.equal(missing.blocked_trading_days,0);assert.deepEqual(missing.missing_execution_dates,['2026-10-07']);
});
test('sample gate is honest, no amount of samples automatically proves efficacy',()=>{
 for(const [n,s] of [[0,'INSUFFICIENT_SAMPLE'],[4,'INSUFFICIENT_SAMPLE'],[5,'EARLY'],[19,'EARLY'],[20,'PRELIMINARY'],[59,'PRELIMINARY'],[60,'LARGER_SAMPLE_NOT_PROOF']])assert.equal(v2SampleStatus(n),s);
 assert.throws(()=>v2SampleStatus(-1));assert.throws(()=>v2SampleStatus(1.5));
});
test('only complete natural seven checkpoints notify; replay, force and incomplete batches do not',async()=>{
 const input={business_date:'2026-10-07',checkpoint:'PREMARKET',batch_id:'10000000-0000-4000-8000-000000000001',core_complete:true};
 for(const checkpoint of ['PREMARKET','0900','0930','1030','1300','1410','1430'])assert(forwardTriggerBody({...input,checkpoint}));
 for(const patch of [{checkpoint:'RECOVERY'},{checkpoint:'UNKNOWN'},{core_complete:false},{force_run:true},{beneficiary_close_only:true},{batch_id:'bad'}])assert.equal(forwardTriggerBody({...input,...patch}),null);
 let work,calls=0;
 const options={url:'https://synthetic.invalid',cronSecret:'SYNTHETIC',serviceRoleKey:'SYNTHETIC',gatewayAnonJwt:'synthetic.only.test',fetcher:async(url,init)=>{calls++;assert(url.endsWith('/recommendation-v2-forward-worker-v1'));assert.equal(JSON.parse(init.body).source_batch_id,input.batch_id);throw Error('network down');},waitUntil:p=>work=p};
 scheduleV2ForwardTrigger(input,options);assert.equal(await work,'SHADOW_UNAVAILABLE');assert.equal(calls,1);
 assert.doesNotThrow(()=>scheduleV2ForwardTrigger(input,{...options,waitUntil:()=>{throw Error('runtime');}}));
 scheduleV2ForwardTrigger(input,{...options,waitUntil:undefined});assert.equal(calls,2);
});
test('shared source acquisition waits for an existing reservation, never caches or substitutes a decision',async()=>{
 let claimed=0,acquired=0;const payload={business_date:'2026-10-07',captures:[],acquisition_cutoff:'2026-10-07T01:00:00Z'};
 const data=await sharedV2Acquisition({claim:async()=>({error:null,data:++claimed===1?{status:'IN_PROGRESS'}:{status:'CACHED',payload}}),finish:async()=>({error:null}),acquire:async()=>{acquired++;return payload;},signal:AbortSignal.timeout(1000),shadowOnly:true,sleep:async()=>{}});
 assert.deepEqual(data,payload);assert.equal(acquired,0);assert.equal(claimed,2);assert.equal(data.decision,undefined);
});
test('research coordinator failure leaves the existing formal source path intact but no competing Shadow fallback',async()=>{
 let acquired=0;const options={claim:async()=>({data:null,error:true}),finish:async()=>({error:null}),acquire:async()=>{acquired++;return {source:'SYNTHETIC'};},signal:AbortSignal.timeout(1000),shadowOnly:true};
 await assert.rejects(sharedV2Acquisition(options),/COORDINATOR_UNAVAILABLE/);assert.equal(acquired,0);
 assert.deepEqual(await sharedV2Acquisition({...options,shadowOnly:false}),{source:'SYNTHETIC'});assert.equal(acquired,1);
});
test('source reservation is released on failure, bounded on wait, and cache failure cannot invent evidence',async()=>{
 const finished=[];const options={claim:async()=>({data:{status:'ACQUIRED',lease_id:'SYNTHETIC'},error:null}),finish:async(id,payload)=>{finished.push([id,payload]);return {error:true};},acquire:async()=>{throw Error('source unavailable');},signal:AbortSignal.timeout(1000),shadowOnly:true};
 await assert.rejects(sharedV2Acquisition(options),/source unavailable/);assert.deepEqual(finished,[['SYNTHETIC',null]]);
 let n=0;await assert.rejects(sharedV2Acquisition({...options,claim:async()=>{n++;return {data:{status:'IN_PROGRESS'},error:null};},sleep:async()=>{}}),/DEADLINE/);assert.equal(n,120);
 const stopped=new AbortController();stopped.abort();await assert.rejects(sharedV2Acquisition({...options,signal:stopped.signal}));
});
