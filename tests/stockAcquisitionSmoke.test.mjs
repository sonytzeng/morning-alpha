// Explicitly synthetic transport tests. Never claims Production acquisition.
import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireStockEvidence,stockAcquisitionCoverage,RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
const universe=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,is_active:true}));
const date='2026-10-07',start='2026-10-06T23:00:00.000Z';
function payload(symbol='2330'){
 let d=previousMarketTradingDate('TW',date);const data=[];
 for(let i=0;i<20;i++){data.push({date:d,open:100,high:103,low:99,close:102,volume:1000000,turnover:102000000,change:1});d=previousMarketTradingDate('TW',d);}
 return {symbol,timeframe:'D',data};
}
function setup(fetcher,extra={}){
 let clock=Date.parse(start);const sleeps=[];
 return {options:{businessDate:date,universe,apiKey:'SYNTHETIC_NOT_A_SECRET',scope:'SMOKE_2330',now:()=>new Date(clock).toISOString(),signal:AbortSignal.timeout(10000),sleep:async ms=>{sleeps.push(ms);clock+=ms;},fetcher,...extra},sleeps};
}
test('2330 smoke does not contact the other71 or manufacture a full-universe proof',async()=>{
 const urls=[];const {options}=setup(async url=>{urls.push(String(url));return Response.json(payload());});
 const captures=await acquireStockEvidence(options),coverage=stockAcquisitionCoverage(captures,['2330']);
 assert.equal(urls.length,1);assert.ok(urls.every(u=>new URL(u).pathname.endsWith('/2330')));
 assert.deepEqual([coverage.requested,coverage.success,coverage.ohlc_20d,coverage.volume_20d,coverage.amount_20d],[1,1,1,1,1]);
 assert.equal(captures[0].http_status,200);assert.equal(captures[0].attempts,1);
 for(const row of captures[0].rows){
  assert.equal(row.available_at,start);assert.equal(row.observed_at,start);assert.equal(row.source_timestamp,row.captured_at);
  assert.equal(row.business_date,row.trading_date);assert.equal(row.source,'fugle');assert.equal(row.session,'REGULAR_COMPLETED');
 }
});
for(const [http,stage,reason] of [[401,'AUTH','PROVIDER_AUTH_INVALID'],[403,'ENTITLEMENT','ENTITLEMENT_NON_RETRYABLE'],[404,'PROVIDER_HTTP','PROVIDER_SYMBOL_OR_ENDPOINT_NOT_FOUND'],[400,'PROVIDER_HTTP','PROVIDER_REQUEST_INVALID']])test(`${http} is exact, nonretryable and sanitized`,async()=>{
 let calls=0;const {options}=setup(async()=>{calls++;return new Response('SECRET_PROVIDER_ERROR',{status:http});});
 const captures=await acquireStockEvidence(options);assert.equal(calls,1);assert.equal(captures[0].failure_stage,stage);assert.equal(captures[0].status,reason);
 assert.doesNotMatch(JSON.stringify(captures),/SECRET_PROVIDER_ERROR|SYNTHETIC_NOT_A_SECRET/);
});
test('429 respects Retry-After, retries once then succeeds, no unbounded loop',async()=>{
 let calls=0;const {options,sleeps}=setup(async()=>++calls===1?new Response(null,{status:429,headers:{'Retry-After':'2'}}):Response.json(payload()));
 const captures=await acquireStockEvidence(options);assert.equal(calls,2);assert.deepEqual(sleeps,[2000]);assert.equal(captures[0].status,'PASS');
});
test('500 and transport timeout have at most3 attempts and can recover',async()=>{
 for(const kind of ['500','timeout']){
  let calls=0;const {options}=setup(async()=>{calls++;if(calls===1){if(kind==='timeout')throw new DOMException('SECRET_URL','TimeoutError');return new Response(null,{status:500});}return Response.json(payload());});
  assert.equal((await acquireStockEvidence(options))[0].status,'PASS');assert.equal(calls,2);
 }
 let calls=0;const {options}=setup(async()=>{calls++;return new Response(null,{status:500});});
 const c=(await acquireStockEvidence(options))[0];assert.equal(calls,3);assert.equal(c.status,'PROVIDER_HTTP_500');
});
test('JSON parser, missing amount and missing sessions remain distinct; missing is not zero',async()=>{
 const missingAmount=payload();delete missingAmount.data[0].turnover;
 const missingDay=payload();missingDay.data.pop();
 for(const [body,status] of [['{','PROVIDER_JSON_INVALID'],[JSON.stringify(missingAmount),'STOCK_OHLCV_AMOUNT_INVALID'],[JSON.stringify(missingDay),'STOCK_COMPLETED_SESSIONS_INCOMPLETE']]){
  const {options}=setup(async()=>new Response(body));const captures=await acquireStockEvidence(options);
  assert.equal(captures[0].status,status);assert.equal(captures[0].attempts,1);assert.equal(captures[0].rows.length,0);
  assert.equal(stockAcquisitionCoverage(captures,['2330']).amount_20d,0);
 }
});
test('expired request never starts network calls and unknown scope cannot expand the universe',async()=>{
 let calls=0;const controller=new AbortController();controller.abort();
 const {options}=setup(async()=>{calls++;return Response.json(payload());},{signal:controller.signal});
 assert.equal((await acquireStockEvidence(options))[0].status,'ACQUISITION_DEADLINE');assert.equal(calls,0);
 await assert.rejects(acquireStockEvidence({...options,scope:'ARBITRARY_SYMBOLS'}),/ACQUISITION_SCOPE_INVALID/);
});
test('72 stock run stays bounded and aggregates actual successes rather than requested count',async()=>{
 let active=0,max=0,calls=0;const {options}=setup(async url=>{
  active++;max=Math.max(max,active);calls++;await new Promise(r=>setTimeout(r,1));active--;
  const symbol=new URL(url).pathname.split('/').at(-1);
  return symbol==='2330'?Response.json(payload(symbol)):new Response(null,{status:403});
 },{scope:'UNIVERSE_72'});
 const captures=await acquireStockEvidence(options),coverage=stockAcquisitionCoverage(captures,RECOMMENDATION_UNIVERSE);
 assert.equal(calls,72);assert.ok(max<=6);assert.equal(coverage.success,1);assert.equal(coverage.failed,71);assert.equal(coverage.ohlc_20d,1);
});
test('daily success cannot pretend current intraday quote is available',async()=>{
 const {options}=setup(async()=>Response.json(payload()));const daily=(await acquireStockEvidence(options))[0];
 const coverage=stockAcquisitionCoverage([daily,{symbol:'2330',endpoint:'intraday/quote',status:'PROVIDER_TIMEOUT',rows:[],received_at:start,payload_hash:null}],['2330']);
 assert.equal(coverage.latest_price,0);assert.equal(coverage.partial,1);assert.equal(coverage.ohlc_20d,1);
});
