import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireForwardOutcomeBars,persistForwardOutcomes} from '../supabase/functions/_shared/recommendation-v2-forward-outcomes.ts';
import {nextV2Session,V2_METHODOLOGY} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {summarizeV2Outcomes} from '../src/features/research/recommendation-shadow-v2-summary.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
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
function syntheticCandles(last='2026-10-19'){
 let date=last;return {symbol:'2330',timeframe:'D',data:Array.from({length:20},()=>{
  const current=date;date=previousMarketTradingDate('TW',date);
  return {date:current,open:100,high:104,low:99,close:102,volume:1000,turnover:100000,change:2};
 }).reverse()};
}
async function acquireFixture(fetcher,{at='2026-10-19T06:30:00Z',signal=new AbortController().signal}={}){
 let time=Date.parse(at),calls=0;const urls=[];
 const captures=await acquireForwardOutcomeBars({symbols:['2330'],businessDate:'2026-10-19',apiKey:'SYNTHETIC_ONLY',now:()=>new Date(time).toISOString(),sleep:async ms=>{time+=ms;},signal,
  fetcher:async(...args)=>{calls++;urls.push(new URL(args[0]));return fetcher(...args);}});
 return {capture:captures[0],calls,urls};
}
test('post-close requires today completed candle; missing today remains a fixed non-retryable session failure',async()=>{
 const missing=await acquireFixture(async()=>Response.json(syntheticCandles('2026-10-16')));
 assert.equal(missing.urls[0].searchParams.get('to'),'2026-10-19');assert.equal(missing.calls,1);
 assert.equal(missing.capture.status,'STOCK_COMPLETED_SESSIONS_INCOMPLETE');assert.equal(missing.capture.failure_stage,'SESSION');
 assert.equal(missing.capture.http_status,200);assert.equal(missing.capture.attempts,1);assert.deepEqual(missing.capture.rows,[]);
 const current=await acquireFixture(async()=>Response.json(syntheticCandles()));
 assert.equal(current.capture.status,'PASS');assert.equal(current.capture.failure_stage,null);assert.equal(current.calls,1);
 assert.equal(current.capture.rows.at(-1).trading_date,'2026-10-19');assert.equal(current.capture.rows.length,20);
 const beforeClose=await acquireFixture(async()=>Response.json(syntheticCandles('2026-10-16')),{at:'2026-10-19T02:00:00Z'});
 assert.equal(beforeClose.urls[0].searchParams.get('to'),'2026-10-16');assert.equal(beforeClose.capture.status,'PASS');
});
test('HTTP200 parser and fixed candle-contract failures are retained without copying bodies or retrying',async()=>{
 const invalidJson=await acquireFixture(async()=>new Response('SYNTHETIC_PRIVATE_BODY',{status:200}));
 assert.equal(invalidJson.capture.status,'OUTCOME_PROVIDER_JSON_INVALID');assert.equal(invalidJson.capture.failure_stage,'PARSER');assert.equal(invalidJson.calls,1);
 for(const [change,expected] of [
  [p=>{p.symbol='OTHER';},'STOCK_CANDLE_CONTRACT_INVALID'],
  [p=>{p.data.push(p.data[0]);},'STOCK_CANDLE_SESSION_INVALID'],
  [p=>{p.data[0].turnover=null;},'STOCK_OHLCV_AMOUNT_INVALID'],
 ]){
  const payload=syntheticCandles();change(payload);const result=await acquireFixture(async()=>Response.json(payload));
  assert.equal(result.capture.status,expected);assert.equal(result.calls,1);assert.equal(result.capture.http_status,200);assert.deepEqual(result.capture.rows,[]);
 }
 assert(!JSON.stringify(invalidJson.capture).includes('SYNTHETIC_PRIVATE_BODY'));
 const tooLarge=await acquireFixture(async()=>new Response('x'.repeat(250001),{status:200}));
 assert.equal(tooLarge.capture.status,'OUTCOME_RESPONSE_LIMIT');assert.equal(tooLarge.capture.failure_stage,'RESPONSE_CONTRACT');assert.equal(tooLarge.calls,1);
});
test('transient body, timeout and transport failures remain bounded at two requests and reveal no exception payload',async()=>{
 const marker='SYNTHETIC_PRIVATE_URL_OR_CREDENTIAL';
 const cases=[
  [async()=>({ok:true,status:200,text:async()=>{throw Error(marker);}}),'OUTCOME_RESPONSE_BODY_UNAVAILABLE','RESPONSE_BODY',200],
  [async()=>{throw Object.assign(Error(marker),{name:'TimeoutError'});},'OUTCOME_PROVIDER_TIMEOUT','TRANSPORT',null],
  [async()=>{throw Error(marker);},'OUTCOME_PROVIDER_TRANSPORT_FAILURE','TRANSPORT',null],
 ];
 for(const [fetcher,status,stage,http] of cases){
  const r=await acquireFixture(fetcher);assert.equal(r.calls,2);assert.equal(r.capture.attempts,2);
  assert.equal(r.capture.status,status);assert.equal(r.capture.failure_stage,stage);assert.equal(r.capture.http_status,http);
  assert(!JSON.stringify(r.capture).includes(marker));assert.deepEqual(r.capture.rows,[]);
 }
});
test('request timeout signal classifies native-like AbortError during fetch or body without reading its reason',async t=>{
 let deadline;
 t.mock.method(AbortSignal,'timeout',ms=>{assert.equal(ms,4000);deadline=new AbortController();return deadline.signal;});
 const fail=()=>{deadline.abort('SYNTHETIC_PRIVATE_TIMEOUT_REASON');throw Object.assign(Error('SYNTHETIC_PRIVATE_ABORT_ERROR'),{name:'AbortError'});};
 for(const stage of ['FETCH','BODY']){
  const r=await acquireFixture(async(_url,init)=>{
   assert.equal(init.signal.aborted,false);
   if(stage==='FETCH')return fail();
   return {ok:true,status:200,text:async()=>fail()};
  });
  assert.equal(r.capture.status,'OUTCOME_PROVIDER_TIMEOUT');assert.equal(r.capture.failure_stage,stage==='BODY'?'RESPONSE_BODY':'TRANSPORT');
  assert.equal(r.calls,2);assert.equal(r.capture.attempts,2);assert(!JSON.stringify(r.capture).includes('SYNTHETIC_PRIVATE'));
 }
});
test('transient failure followed by valid response clears failure metadata and retains only final HTTP status',async()=>{
 let n=0;const r=await acquireFixture(async()=>{if(++n===1)throw Error('SYNTHETIC_PRIVATE_TRANSPORT');return Response.json(syntheticCandles());});
 assert.equal(r.calls,2);assert.equal(r.capture.status,'PASS');assert.equal(r.capture.http_status,200);assert.equal(r.capture.attempts,2);
 assert.equal(r.capture.failure_stage,null);assert.equal(r.capture.rows.length,20);assert(!JSON.stringify(r.capture).includes('SYNTHETIC_PRIVATE'));
});
test('external deadline stops the current capture and non-retryable HTTP stays one request',async()=>{
 const controller=new AbortController();
 const aborted=await acquireFixture(async()=>{controller.abort();throw Error('SYNTHETIC_PRIVATE_ABORT');},{signal:controller.signal});
 assert.equal(aborted.capture.status,'OUTCOME_SOURCE_DEADLINE');assert.equal(aborted.capture.failure_stage,'DEADLINE');assert.equal(aborted.calls,1);
 for(const status of [400,401,403,404]){
  const r=await acquireFixture(async()=>new Response('SYNTHETIC_PRIVATE_HTTP_BODY',{status}));
  assert.equal(r.calls,1);assert.equal(r.capture.status,'OUTCOME_PROVIDER_HTTP_'+status);assert.equal(r.capture.failure_stage,'PROVIDER_HTTP');
  assert(!JSON.stringify(r.capture).includes('SYNTHETIC_PRIVATE_HTTP_BODY'));
 }
 for(const status of [429,503]){
  const r=await acquireFixture(async()=>new Response('SYNTHETIC_PRIVATE_HTTP_BODY',{status,headers:status===429?{'retry-after':'1'}:{}}));
  assert.equal(r.calls,2);assert.equal(r.capture.status,'OUTCOME_PROVIDER_HTTP_'+status);
  assert.equal(r.capture.failure_stage,status===429?'RATE_LIMIT':'PROVIDER_HTTP');
 }
});
test('review needs complete real lock inventory and every horizon; sample count alone is not evidence',()=>{
 const dates=Array.from({length:20},(_,i)=>'SYNTHETIC_'+i),audit={prediction_ids:['p'],complete_inventory:true,no_lookahead:true,no_methodology_drift:true,no_contamination:true};
 const rows=[1,3,5,10,20].map(h=>({prediction_id:'p',prediction_status:'READY',horizon:h,state:'OBSERVED',methodology_version:V2_METHODOLOGY,return:.01,mfe:.02,mae:-.01,exit_at:'2026-10-07'}));
 assert.equal(summarizeV2Outcomes(rows,dates,{READY:dates},audit).promotion_review_eligible,true);
 for(const key of ['complete_inventory','no_lookahead','no_methodology_drift','no_contamination'])assert.equal(summarizeV2Outcomes(rows,dates,{READY:dates},{...audit,[key]:false}).promotion_review_eligible,false);
 assert.equal(summarizeV2Outcomes(rows.slice(1),dates,{READY:dates},audit).promotion_review_eligible,false);
 assert.equal(summarizeV2Outcomes(rows,dates).promotion_review_eligible,false);assert.equal(summarizeV2Outcomes(rows,dates,undefined,audit).promotion_allowed,false);
});
