import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireForwardOutcomeBars,persistForwardOutcomes} from '../supabase/functions/_shared/recommendation-v2-forward-outcomes.ts';
import {nextV2Session,V2_METHODOLOGY} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {summarizeV2Outcomes} from '../src/features/research/recommendation-shadow-v2-summary.ts';
const p={id:'SYNTHETIC_ONLY',symbol:'2330',methodology_version:V2_METHODOLOGY,observation_kind:'FORWARD',locked_at:'2026-09-07T01:00:00Z',cutoff:'2026-09-07T00:59:00Z',input_sha256:'a'.repeat(64),status:'WATCH',entry:{not_before:'2026-09-08',trigger_price:100,invalidation_price:95}};
const observed='2026-10-07T06:30:00Z';
function capture(){let date='2026-09-08';return {symbol:'2330',endpoint:'historical/candles',status:'PASS',received_at:observed,rows:Array.from({length:20},()=>{const d=date;date=nextV2Session(d);return {id:'SYNTHETIC:'+d,trading_date:d,ingested_at:observed,raw_payload:{open:100,high:104,low:99,close:102,volume_shares:1000,amount_twd:100000}};})};}
test('bounded autonomous outcomes preserve WATCH, all five horizons and explicit Close alias',async()=>{
 const saved=[],before=structuredClone(p),r=await persistForwardOutcomes({predictions:[p],captures:[capture()],sourceRevision:'SYNTHETIC_SOURCE',now:()=>observed,store:async(result,e)=>{saved.push(result);assert.equal(JSON.parse(e).prediction.id,p.id);return {error:null};}});
 assert.equal(r.status,'COMPLETE');assert.equal(r.observed,5);assert.deepEqual(p,before);
 assert.deepEqual(saved.map(x=>x.horizon),[1,3,5,10,20]);assert.deepEqual(saved[0].observation_labels,['CLOSE','1D']);
 assert(saved.every(x=>x.prediction_status==='WATCH'&&x.invalidation_hit===false&&x.target_hit===null));
 const duplicate=await persistForwardOutcomes({predictions:[{...p,completed_horizons:[1,3,5,10,20]}],captures:[capture()],sourceRevision:'SYNTHETIC_SOURCE',now:()=>observed,store:async()=>{throw Error('DUPLICATE');}});assert.equal(duplicate.observed,0);
});
test('no entry, stop, missing evidence and future horizon fail safely without fabricated return',async()=>{
 const run=async(c,at=observed)=>{const saved=[];const result=await persistForwardOutcomes({predictions:[p],captures:c,sourceRevision:'SYNTHETIC_SOURCE',now:()=>at,store:async r=>{saved.push(r);return {error:null};}});return {result,saved};};
 const stop=capture();stop.rows[0].raw_payload.low=94;assert((await run([stop])).saved.every(r=>r.invalidation_hit===true));
 const none=capture();none.rows[0].raw_payload.high=100;none.rows[0].raw_payload.close=100;assert((await run([none])).saved.every(r=>r.state==='NOT_ENTERED'&&r.return===null&&r.invalidation_hit===null));
 assert.equal((await run([])).result.status,'SOURCE_OR_STORE_UNAVAILABLE');assert.equal((await run([capture()],'2026-09-08T00:00:00Z')).saved.length,0);
});
test('outcome acquisition uses completed session, fixed universe and bounded HTTP retry',async()=>{
 let time=Date.parse('2026-10-07T02:00:00Z');const urls=[];let calls=0;
 const r=await acquireForwardOutcomeBars({symbols:['2330'],businessDate:'2026-10-07',apiKey:'SYNTHETIC_ONLY',now:()=>new Date(time).toISOString(),sleep:async ms=>{time+=ms;},signal:new AbortController().signal,fetcher:async url=>{urls.push(new URL(url));calls++;return new Response('{}',{status:503});}});
 assert.equal(calls,2);assert.equal(urls[0].searchParams.get('to'),'2026-10-06');assert.equal(r[0].status,'OUTCOME_PROVIDER_HTTP_503');
 await assert.rejects(acquireForwardOutcomeBars({symbols:['INVALID'],businessDate:'2026-10-07',apiKey:'SYNTHETIC_ONLY',now:()=>new Date(time).toISOString(),signal:new AbortController().signal,fetcher:()=>{throw Error('NOT_ALLOWED');}}),/UNIVERSE/);
});
test('review needs complete real lock inventory and every horizon; sample count alone is not evidence',()=>{
 const dates=Array.from({length:20},(_,i)=>'SYNTHETIC_'+i),audit={prediction_ids:['p'],complete_inventory:true,no_lookahead:true,no_methodology_drift:true,no_contamination:true};
 const rows=[1,3,5,10,20].map(h=>({prediction_id:'p',prediction_status:'READY',horizon:h,state:'OBSERVED',methodology_version:V2_METHODOLOGY,return:.01,mfe:.02,mae:-.01,exit_at:'2026-10-07'}));
 assert.equal(summarizeV2Outcomes(rows,dates,{READY:dates},audit).promotion_review_eligible,true);
 for(const key of ['complete_inventory','no_lookahead','no_methodology_drift','no_contamination'])assert.equal(summarizeV2Outcomes(rows,dates,{READY:dates},{...audit,[key]:false}).promotion_review_eligible,false);
 assert.equal(summarizeV2Outcomes(rows.slice(1),dates,{READY:dates},audit).promotion_review_eligible,false);
 assert.equal(summarizeV2Outcomes(rows,dates).promotion_review_eligible,false);assert.equal(summarizeV2Outcomes(rows,dates,undefined,audit).promotion_allowed,false);
});
