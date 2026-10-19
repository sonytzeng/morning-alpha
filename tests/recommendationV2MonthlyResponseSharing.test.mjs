// Isolated synthetic transport/official protocol only: zero external requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createMonthlyResponseSharing} from '../supabase/functions/_shared/recommendation-monthly-response-sharing.ts';
import {acquireOfficialActuals,OFFICIAL_ACTUAL_SOURCES} from '../supabase/functions/_shared/recommendation-official-actuals.ts';
import {acquireV2PublicSources,V2_SOURCE_URLS} from '../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
const at='2026-10-19T06:30:00.000Z',symbols=['2330','6488'];
const urls=[V2_SOURCE_URLS.twseGrowth,V2_SOURCE_URLS.tpexGrowth];
const row=symbol=>({'公司代號':symbol,'公司名稱':'合成資料','出表日期':'1151019','資料年月':'11509',
 '營業收入-當月營收':'1100','營業收入-去年當月營收':'1000','營業收入-上月營收':'1000',
 '營業收入-去年同月增減(%)':'10','營業收入-上月比較增減(%)':'10','Email':'SYNTHETIC_PRIVATE_FIELD'});
const body=url=>JSON.stringify([row(url===urls[0]?'2330':'6488')]);
function chunksResponse(bytes,splits=[17,19]){
 const chunks=[];let start=0;for(const end of [...splits,bytes.length]){if(end>start&&end<=bytes.length){chunks.push(bytes.slice(start,end));start=end;}}
 let index=0;return new Response(new ReadableStream({pull(c){if(index<chunks.length)c.enqueue(chunks[index++]);else c.close();}}),{headers:{'Content-Type':'application/json; charset=utf-8'}});
}
async function views(fetcher){
 return Promise.all([
  acquireOfficialActuals({symbols,fetcher,signal:AbortSignal.timeout(5000),now:()=>at}),
  acquireV2PublicSources({symbols,fetcher,signal:AbortSignal.timeout(5000),now:()=>at}),
 ]);
}
const monthly=xs=>xs.filter(x=>x.kind==='monthly_revenue'||x.kind==='growth');

test('one same-bundle anonymous GET feeds both unchanged contracts with original bytes/hash/time',async()=>{
 const calls=[];const shared=createMonthlyResponseSharing({signal:AbortSignal.timeout(5000),fetcher:async(url,init)=>{
  calls.push(url);assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);
  if(!urls.includes(url))return new Response(null,{status:403});
  assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');
  const bytes=new TextEncoder().encode(body(url)),split=bytes.findIndex(b=>b>=0xe0)+1;
  return chunksResponse(bytes,[split,split+1]);
 }});
 try{
  const [actual,growth]=await views(shared.fetcher);
  assert.equal(calls.length,8);for(const url of urls)assert.equal(calls.filter(x=>x===url).length,1);
  assert(monthly(actual).every(x=>x.status==='PASS'));assert(monthly(growth).every(x=>x.status==='PASS'));
  for(const capture of monthly(actual)){
   assert.equal(capture.source_response_sha256,createHash('sha256').update(body(capture.source)).digest('hex'));
   assert.equal(capture.response_bytes,new TextEncoder().encode(body(capture.source)).length);
   assert.equal(capture.rows[0].available_at,at);assert.equal(capture.rows[0].period,'2026-09');
  }
  for(const capture of monthly(growth)){assert(Math.abs(capture.rows[0].revenue_yoy-.1)<1e-12);assert(Math.abs(capture.rows[0].revenue_mom-.1)<1e-12);assert.equal(capture.rows[0].available_at,at);}
  assert.doesNotMatch(JSON.stringify([...actual,...growth]),/SYNTHETIC_PRIVATE_FIELD/);
  const producer=readFileSync(new URL('../supabase/functions/recommendation-stock-evidence-v1/index.ts',import.meta.url),'utf8');
  assert.match(producer,/const acquireBundle=async\(\)=>\{[\s\S]*?const monthly=createMonthlyResponseSharing/);
  assert.match(producer,/startV2SourceAcquisition\([\s\S]*?fetcher:monthly.fetcher/);
  assert.match(producer,/acquireOfficialActuals\(\{[^\n]*fetcher:monthly.fetcher/);
  assert.match(producer,/await shadowWork\?\.complete;\}\)\.finally\(\(\)=>\{monthly.dispose\(\);\}\)/);
 }finally{shared.dispose();}
});

test('bad JSON or contract-specific refusal stays isolated, fails closed, and never causes a second GET',async()=>{
 for(const mode of ['json','ratio','stream']){
  const calls=[];const shared=createMonthlyResponseSharing({signal:AbortSignal.timeout(5000),fetcher:async url=>{
   calls.push(url);if(!urls.includes(url))return new Response(null,{status:403});
   if(url===urls[0])return mode==='stream'?new Response(new ReadableStream({pull(c){c.error(Error('SYNTHETIC_BODY_FAILURE'));}})):
    new Response(mode==='ratio'?JSON.stringify([{...row('2330'),'營業收入-上月比較增減(%)':'99'}]):'{');
   return new Response(body(url));
  }});
  try{
   const [actual,growth]=await views(shared.fetcher),a=monthly(actual),g=monthly(growth);
   assert.equal(a.find(x=>x.source===urls[0]).status,mode==='ratio'?'PASS':mode==='stream'?'OFFICIAL_TRANSPORT_FAILURE':'OFFICIAL_JSON_INVALID');
   assert.equal(g.find(x=>x.source===urls[0]).status,mode==='ratio'?'V2_GROWTH_RATIO_MISMATCH':'SOURCE_UNAVAILABLE');
   assert.equal(a.find(x=>x.source===urls[0]).http_status,200);assert.equal(g.find(x=>x.source===urls[0]).http,200);
   assert.equal(a.find(x=>x.source===urls[1]).status,'PASS');assert.equal(g.find(x=>x.source===urls[1]).status,'PASS');
   for(const url of urls)assert.equal(calls.filter(x=>x===url).length,1);
  }finally{shared.dispose();}
 }
});

test('a consumer abort cannot cancel its peer; expired/failed/disposed work never re-fetches',async()=>{
 let complete,calls=0,upstreamSignal;const shared=createMonthlyResponseSharing({signal:AbortSignal.timeout(5000),fetcher:async(_url,init)=>{
  calls++;upstreamSignal=init.signal;return new Promise(resolve=>{complete=resolve;});
 }});
 const first=new AbortController(),second=new AbortController();
 const a=shared.fetcher(urls[0],{redirect:'error',signal:first.signal}),b=shared.fetcher(urls[0],{redirect:'error',signal:second.signal});
 first.abort();await assert.rejects(a);assert.equal(upstreamSignal.aborted,false);
 complete(new Response(body(urls[0])));assert.equal(await(await b).text(),body(urls[0]));
 const expired=new AbortController();expired.abort();await assert.rejects(shared.fetcher(urls[0],{redirect:'error',signal:expired.signal}));
 assert.equal(calls,1);shared.dispose();await assert.rejects(shared.fetcher(urls[0],{redirect:'error'}));assert.equal(calls,1);
 let failures=0;const failed=createMonthlyResponseSharing({signal:AbortSignal.timeout(5000),fetcher:async()=>{failures++;throw Error('SYNTHETIC_FAILURE');}});
 try{for(let i=0;i<2;i++)await assert.rejects(failed.fetcher(urls[0],{redirect:'error'}));assert.equal(failures,1);}finally{failed.dispose();}
 const counts=new Map();const delayed=createMonthlyResponseSharing({signal:AbortSignal.timeout(10000),fetcher:async url=>{
  if(!urls.includes(url))return new Response(null,{status:403});counts.set(url,(counts.get(url)||0)+1);
  if(url!==urls[0])return new Response(body(url));
  return new Response(new ReadableStream({start(c){setTimeout(()=>{c.enqueue(new TextEncoder().encode(body(url)));c.close();},4500);}}));
 }});
 try{
  const [actual,growth]=await Promise.all([
   acquireOfficialActuals({symbols,fetcher:delayed.fetcher,signal:AbortSignal.timeout(10000),now:()=>at}),
   acquireV2PublicSources({symbols,fetcher:delayed.fetcher,signal:AbortSignal.timeout(10000),now:()=>at}),
  ]);
  const a=monthly(actual).find(x=>x.source===urls[0]),g=monthly(growth).find(x=>x.source===urls[0]);
  assert.equal(a.status,'OFFICIAL_DEADLINE');assert.equal(a.http_status,200);
  assert.equal(g.status,'PASS');assert.equal(g.http,200);assert.deepEqual([...counts.values()],[1,1]);
 }finally{delayed.dispose();}
});

test('original byte/read limits and noncooperative body cancellation remain bounded',async()=>{
 for(const [bytes,expected] of [[3_000_001,'NO_DATA'],[8_000_001,'V2_RESPONSE_LIMIT']]){
  const shared=createMonthlyResponseSharing({signal:AbortSignal.timeout(5000),fetcher:async url=>new Response(url===urls[0]?' '.repeat(bytes)+'[]':'[]')});
  try{
   const [actual,growth]=await views(shared.fetcher);
   assert.equal(monthly(actual).find(x=>x.source===urls[0]).status,'OFFICIAL_RESPONSE_LIMIT');
   assert.equal(monthly(growth).find(x=>x.source===urls[0]).status,expected);
  }finally{shared.dispose();}
 }
 let cancelled=0;const abort=new AbortController();
 const shared=createMonthlyResponseSharing({signal:abort.signal,fetcher:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}}))});
 const response=await shared.fetcher(urls[0],{redirect:'error'});assert.equal(response.status,200);
 const pending=response.text();abort.abort();await assert.rejects(pending);shared.dispose();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);
 let reads=0;const chunks=createMonthlyResponseSharing({signal:AbortSignal.timeout(5000),fetcher:async url=>{
  if(url!==urls[0])return new Response('[]');
  return new Response(new ReadableStream({pull(c){reads++;if(reads===1)c.enqueue(new TextEncoder().encode(body(url)));else if(reads<=4100)c.enqueue(new Uint8Array([32]));else c.close();}}));
 }});
 try{
  const [actual,growth]=await views(chunks.fetcher);
  assert.equal(monthly(actual).find(x=>x.source===urls[0]).status,'OFFICIAL_RESPONSE_LIMIT');
  assert.equal(monthly(growth).find(x=>x.source===urls[0]).status,'PASS');assert.equal(reads,4101);
 }finally{chunks.dispose();}
});

test('sharing is fixed-URL, anonymous default GET, local to one bundle; redirect/content-type policy unchanged',async()=>{
 const calls=[];const fetcher=async(url,init)=>{calls.push({url,method:init?.method,redirect:init?.redirect});return new Response(body(url),{headers:{'Content-Type':'text/plain'}});};
 for(let batch=0;batch<2;batch++){
  const shared=createMonthlyResponseSharing({fetcher,signal:AbortSignal.timeout(5000)});
  try{
   for(let i=0;i<2;i++)assert.equal(await(await shared.fetcher(urls[0],{redirect:'error'})).text(),body(urls[0]));
   for(const url of [urls[0]+'?different=1','https://synthetic.invalid/not-a-monthly-feed'])await shared.fetcher(url,{redirect:'error'});
   // Financial profile has explicit Accept and retains its independent stricter transport.
   await shared.fetcher(urls[0],{redirect:'error',headers:{Accept:'application/json'}});
   await shared.fetcher(urls[0],{redirect:'error',cache:'no-store'});
   await shared.fetcher(urls[0],{redirect:'error',body:'SYNTHETIC_TEST_ONLY'});
  }finally{shared.dispose();}
 }
 assert.equal(calls.filter(x=>x.url===urls[0]).length,8);assert(calls.every(x=>x.redirect==='error'));
 let smokeCalls=0;const smoke=createMonthlyResponseSharing({fetcher:async()=>{smokeCalls++;throw Error('UNEXPECTED');},signal:AbortSignal.timeout(5000)});smoke.dispose();assert.equal(smokeCalls,0);
 const producer=readFileSync(new URL('../supabase/functions/recommendation-stock-evidence-v1/index.ts',import.meta.url),'utf8');
 assert.match(producer,/scope==='SMOKE_2330'\?null:startV2SourceAcquisition/);
 assert.match(producer,/scope==='SMOKE_2330'\?Promise.resolve\(\[\]\):acquireOfficialActuals/);
 assert.equal(OFFICIAL_ACTUAL_SOURCES.filter(x=>x.kind==='monthly_revenue').map(x=>x.url).sort().join(),[...urls].sort().join());
});
