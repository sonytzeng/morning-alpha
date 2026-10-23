// Synthetic transport/control tests. They do not establish real recommendation efficacy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePublicV1,runCli,PUBLIC_V1_LIMITS} from '../scripts/official-actuals/evaluate-public-v1.mjs';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
const AT='2026-10-20T00:54:00.000Z';
function fixture(){return {schema:'EVENT_ALIGNMENT_REFRESH_BUNDLE_V1',input:{receipts:[],overlay_receipts:[],
 observation:{source:'public.sector_stock_map',observed_at:'2026-10-20T00:00:00.000Z',rows:RECOMMENDATION_UNIVERSE.map(symbol=>({
 symbol,sector:'SYNTHETIC_INDUSTRY',is_active:true,created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'}))}},new_receipts:[]};}
function market(){return {stat:'OK',date:'20261019',hints:'單位：元',fields:['單位名稱','買進金額','賣出金額','買賣差額'],data:[
 ['自營商(自行買賣)','20','10','10'],['自營商(避險)','30','20','10'],['投信','50','20','30'],
 ['外資及陸資(不含外資自營商)','100','50','50'],['外資自營商','8','3','5'],['合計','200','100','100']]};}
test('fixed2 approved open-data requests enter original72-stock evaluator without an unlicensed website fetch',async()=>{
 const calls=[],before=fixture();
 const result=await evaluatePublicV1(before,{now:()=>AT,fetcher:async(url,init)=>{
  calls.push({url,init});return Response.json(url.includes('BFI82U')?market():url.includes('t187ap04_L')?
   [{'公司代號':'2330','發言日期':'1151020','發言時間':'080000','主旨 ':'合成測試公告','說明':'SYNTHETIC_PRIVATE_BODY'}]:[]);
 }});
 assert.equal(calls.length,2);assert.equal(new Set(calls.map(c=>c.url)).size,2);assert(calls.every(c=>!c.url.includes('BFI82U')));
 for(const {url,init} of calls){assert(url.startsWith('https://'));assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');
  assert.equal(init.redirect,'error');assert.deepEqual(Object.keys(init.headers),['Accept']);assert(init.signal instanceof AbortSignal);}
 assert.equal(result.market_normalization,'NOT_ACQUIRED_AUTOMATION_RIGHTS_PENDING');assert.equal(result.official_event_facts,1);
 assert.equal(result.actual_rows,4);assert.equal(result.after.universe,72);assert.equal(result.after.evaluated,0);assert.equal(result.after.blocked,72);
 assert.equal(result.http_success,2);assert.equal(result.requests,2);assert.equal(result.production_operations,0);
 assert.equal(result.member_publication_approved,false);assert.equal(result.forward_sample,0);
 assert.match(await snapshotHash(result),/^[a-f0-9]{64}$/); // Regression: undefined raw-body key used to prevent immutable save.
 assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_BODY|response_body|Bearer|Authorization/);
 assert.equal(result.captured_official_facts.market_flow,null);
 assert.deepEqual(before,fixture());
});
test('HTTP failures and provider exceptions are fixed diagnostics, not success, retries or secret reflections',async()=>{
 let count=0;const result=await evaluatePublicV1(fixture(),{now:()=>AT,fetcher:async()=>{
  if(++count===1)throw Error('SYNTHETIC_TOKEN_ERROR_DO_NOT_EXPORT');return new Response('SYNTHETIC_PRIVATE_RESPONSE',{status:403});
 }});
 assert.equal(count,2);assert.equal(result.http_success,0);assert.equal(result.market_normalization,'NOT_ACQUIRED_AUTOMATION_RIGHTS_PENDING');
 assert.equal(result.official_event_facts,0);assert.equal(result.after.evaluated,0);
 assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_TOKEN_ERROR|SYNTHETIC_PRIVATE_RESPONSE/);
 assert.match(await snapshotHash(result),/^[a-f0-9]{64}$/);
});
test('HTTP200 malformed content is acquisition success but normalization failure, with one receipt per request',async()=>{
 const r=await evaluatePublicV1(fixture(),{now:()=>AT,fetcher:async()=>new Response('{PRIVATE_BODY')});
 assert.equal(r.requests,2);assert.equal(r.source_receipts.length,2);assert.equal(r.http_success,2);
 assert.equal(r.normalized_sources,0);assert.equal(r.official_event_facts,0);
 assert(r.source_receipts.every(s=>s.status==='SOURCE_SCHEMA_INVALID'));assert.doesNotMatch(JSON.stringify(r),/PRIVATE_BODY/);
});
test('closed date, forged taxonomy, future source and unexpected CLI arguments fail before network',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('NO_NETWORK_EXPECTED');};
 await assert.rejects(evaluatePublicV1(fixture(),{fetcher,now:()=> '2026-10-18T00:00:00.000Z'}),/NOT_TRADING/);
 const b=fixture();b.input.observation.rows.pop();await assert.rejects(evaluatePublicV1(b,{fetcher,now:()=>AT}),/SECTOR_SCOPE/);
 const future=fixture();future.input.observation.observed_at='2026-10-20T00:54:00.000001Z';
 await assert.rejects(evaluatePublicV1(future,{fetcher,now:()=>AT}),/SECTOR_SCOPE/);
 await assert.rejects(runCli(['--url','https://example.test']),/CLI/);assert.equal(calls,0);
 assert.equal(PUBLIC_V1_LIMITS.requests,2);assert.equal(PUBLIC_V1_LIMITS.total_ms,20000);
});
test('the total deadline covers retained validation and the final join, not only HTTP waits',async()=>{
 let ticks=0,calls=0;
 await assert.rejects(evaluatePublicV1(fixture(),{now:()=>AT,monotonic:()=>ticks++===0?0:20001,
  fetcher:async()=>{calls++;return Response.json([]);}}),/DEADLINE/);assert.equal(calls,0);
 let ms=0;calls=0;let reads=0;
 await assert.rejects(evaluatePublicV1(fixture(),{monotonic:()=>ms,now:()=>{
  // Initial, source1, source2, market first/received and completed cutoff reads.
  if(++reads>=6)ms=20001;return AT;
 },fetcher:async url=>{calls++;return Response.json(url.includes('BFI82U')?market():[]);}}),/DEADLINE/);
 assert(calls<=2);
});
