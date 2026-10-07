import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {acquireV2FugleShares,selectV2InstitutionalSources,startV2SourceAcquisition,V2_FUGLE_SHARES_URL,V2_SOURCE_URLS} from '../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
import {evaluateV2Shadow} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {recommendationJsonStream} from '../supabase/functions/_shared/recommendation-stream.ts';
import {sharedV2Acquisition} from '../supabase/functions/_shared/recommendation-v2-acquisition-cache.ts';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';

const at='2026-10-06T23:30:00.000Z',session='2026-10-06',key='SYNTHETIC_KEY_NEVER_REAL';
const payload=(symbol='2330')=>({symbol,type:'EQUITY',exchange:'TWSE',market:'TSE',data:[{
 date:session,foreign:{buy:10,sell:20,net:-10},trust:{buy:30,sell:10,net:20},dealer:{buy:5,sell:5,net:0},total:10,
}]});
function harness(fetcher,symbols=['2330'],start=at){
 let clock=Date.parse(start);const starts=[],waits=[];
 return {starts,waits,options:{symbols,apiKey:key,signal:new AbortController().signal,now:()=>new Date(clock).toISOString(),
  sleep:async(ms,signal)=>{signal.throwIfAborted();waits.push(ms);clock+=ms;},
  fetcher:async(url,init)=>{starts.push(clock);return fetcher(url,init,starts.length);}}};
}

test('official Fugle endpoint uses Edge header only, exact completed session and real per-institution SHARES',async()=>{
 const h=harness(async(url,init)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.fugle.tw');assert.equal(u.pathname,'/marketdata/v1.0/stock/ownership/institutional-trades/2330');
  assert.deepEqual(Object.fromEntries(u.searchParams),{from:session,to:session,sort:'asc'});
  assert.deepEqual(init.headers,{'X-API-KEY':key});assert.equal(init.redirect,'error');assert(init.signal instanceof AbortSignal);
  return Response.json({...payload(),untrusted_contact:key});
 });
 const [c]=await acquireV2FugleShares(h.options);
 assert.equal(c.status,'PASS');assert.equal(c.provenance,'FUGLE_INSTITUTIONAL_SHARES');assert.equal(c.attempts,1);
 assert.deepEqual(c.rows[0],{symbol:'2330',session,source:V2_FUGLE_SHARES_URL+'2330',available_at:at,unit:'SHARES',
  foreign:{buy:10,sell:20,net:-10},trust:{buy:30,sell:10,net:20},dealer:{buy:5,sell:5,net:0}});
 assert(!JSON.stringify(c).includes(key));assert(!JSON.stringify(c).includes('TWD'));
});

test('empty, amount/TWD, wrong symbol/session, malformed JSON and accounting faults stay honestly missing',async()=>{
 const wrongNet=payload();wrongNet.data[0].foreign.net=99;
 const wrongTotal=payload();wrongTotal.data[0].total=99;
 const old=payload();old.data[0].date='2026-10-05';
 const future=payload();future.data[0].date='2026-10-07';
 const duplicate=payload();duplicate.data.push(duplicate.data[0]);
 const amount=payload();amount.data[0].trust={buyAmount:30,sellAmount:10,netAmount:20};
 const fractional=payload();fractional.data[0].trust={buy:30.5,sell:10.5,net:20};
 for(const [body,status] of [[{symbol:'2330',data:[]},'NO_DATA'],[{...payload(),unit:'TWD'},'FUGLE_SHARES_CONTRACT_INVALID'],
  [payload('2317'),'FUGLE_SHARES_CONTRACT_INVALID'],...[wrongNet,wrongTotal,old,future,duplicate,amount,fractional].map(p=>[p,'FUGLE_SHARES_CONTRACT_INVALID'])]){
  const [c]=await acquireV2FugleShares(harness(async()=>Response.json(body)).options);
  assert.equal(c.status,status);assert.deepEqual(c.rows,[]);assert.equal(c.attempts,1);
 }
 const [bad]=await acquireV2FugleShares(harness(async()=>new Response('{bad '+key)).options);
 assert.equal(bad.status,'PROVIDER_JSON_INVALID');assert(!JSON.stringify(bad).includes(key));
 // Even a valid completed "today" is not the requested previous session.
 const [mismatch]=await acquireV2FugleShares(harness(async()=>Response.json(future),['2330'],'2026-10-07T08:00:00Z').options);
 assert.equal(mismatch.status,'FUGLE_SHARES_SESSION_MISMATCH');
});

test('missing key and invalid scope never acquire; first 401/403 circuit-breaks the remaining 71 symbols',async()=>{
 const h=harness(async()=>{throw Error('must not call');},RECOMMENDATION_UNIVERSE);
 const missing=await acquireV2FugleShares({...h.options,apiKey:''});
 assert.equal(h.starts.length,0);assert.equal(missing.length,72);assert(missing.every(c=>c.status==='EXISTING_FUGLE_CREDENTIAL_UNAVAILABLE'&&c.attempts===0));
 for(const symbols of [['../../leak'],['2330','2330'],Array(73).fill('2330')])await assert.rejects(acquireV2FugleShares({...h.options,symbols}),/SCOPE/);
 for(const status of [401,403]){
  const h=harness(async()=>new Response(key,{status}),RECOMMENDATION_UNIVERSE),rows=await acquireV2FugleShares(h.options);
  assert.equal(h.starts.length,1);assert.equal(rows.length,72);
  assert.equal(rows[0].symbol,'2330');assert.equal(rows[0].status,status===401?'PROVIDER_AUTH_INVALID':'ENTITLEMENT_NON_RETRYABLE');
  assert(rows.every(c=>c.rows.length===0));assert.equal(rows[0].attempts,1);
  assert(rows.slice(1).every(c=>c.attempts===0&&c.http===null&&c.status===(status===401?'AUTH_NOT_ATTEMPTED':'ENTITLEMENT_NOT_ATTEMPTED')));assert(!JSON.stringify(rows).includes(key));
 }
});

test('single worker plus 8-second pacing bounds combined V1+Shadow starts below 60/min and classifies budget exhaustion',async()=>{
 let inFlight=0,max=0;
 const h=harness(async(url)=>{inFlight++;max=Math.max(max,inFlight);await Promise.resolve();inFlight--;return Response.json(payload(new URL(url).pathname.split('/').at(-1)));},RECOMMENDATION_UNIVERSE);
 const rows=await acquireV2FugleShares(h.options);
 assert.equal(max,1);assert.equal(h.starts.length,12);assert(h.waits.every(w=>w>=8000));
 assert.equal(rows[0].symbol,'2330');assert.equal(rows.filter(c=>c.status==='PASS').length,12);assert.equal(rows.filter(c=>c.status==='BUDGET_NOT_ATTEMPTED'&&c.attempts===0).length,60);
 // Existing V1 starts at 1200ms; Shadow never changes its permits.
 const base=Date.parse(at),v1=Array.from({length:75},(_,i)=>base+i*1200),combined=[...v1,...h.starts].sort((a,b)=>a-b);
 for(const end of combined)assert(combined.filter(t=>t>end-60000&&t<=end).length<=58);
});

test('transient retry is bounded/paced; 429 cooldown crosses symbols and excessive Retry-After never gets shortened',async()=>{
 for(const status of [500,502,503,504]){
  const h=harness(async(_u,_i,n)=>n===1?new Response(key,{status}):Response.json(payload()));
  const [c]=await acquireV2FugleShares(h.options);assert.equal(c.status,'PASS');assert.equal(c.attempts,2);assert.equal(h.starts[1]-h.starts[0],8000);
 }
 for(const retry of ['20',new Date(Date.parse(at)+20000).toUTCString()]){
  const h=harness(async(_u,_i,n)=>n===1?new Response('',{status:429,headers:{'Retry-After':retry}}):Response.json(payload()));
  assert.equal((await acquireV2FugleShares(h.options))[0].status,'PASS');assert.equal(h.starts[1]-h.starts[0],20000);
 }
 const h=harness(async()=>new Response('',{status:429,headers:{'Retry-After':'20'}}),['2330','2317']);
 const rows=await acquireV2FugleShares(h.options);assert.equal(h.starts.length,4);assert(rows.every(c=>c.status==='HTTP_429'&&c.attempts===2));
 assert(h.starts.slice(1).every((t,i)=>t-h.starts[i]>=20000));
 const long=harness(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}),RECOMMENDATION_UNIVERSE);
 const exhausted=await acquireV2FugleShares(long.options);assert.equal(long.starts.length,1);assert.equal(exhausted[0].status,'RETRY_BUDGET_EXHAUSTED');
 assert.equal(exhausted[0].http,429);assert(exhausted.slice(1).every(c=>c.status==='BUDGET_NOT_ATTEMPTED'&&c.attempts===0));
 const unsafe=harness(async()=>{throw Error('V2_'+key);});
 const [failed]=await acquireV2FugleShares(unsafe.options);assert.equal(failed.status,'PROVIDER_TRANSPORT_OR_TIMEOUT');assert.equal(failed.attempts,2);assert(!JSON.stringify(failed).includes(key));
});

test('pre-abort and abort during pacing settle all captures; late fetch/body completion cannot write after cutoff',async()=>{
 const pre=new AbortController();pre.abort();
 const never=harness(async()=>{throw Error('no request');},['2330','2317']);
 assert((await acquireV2FugleShares({...never.options,signal:pre.signal})).every(c=>c.status==='BUDGET_NOT_ATTEMPTED'));assert.equal(never.starts.length,0);
 const controller=new AbortController(),paced=harness(async()=>Response.json(payload()),['2330','2317']);
 const stopped=await acquireV2FugleShares({...paced.options,signal:controller.signal,sleep:async()=>controller.abort()});
 assert.deepEqual(stopped.map(c=>c.status),['PASS','BUDGET_NOT_ATTEMPTED']);assert.equal(paced.starts.length,1);
 let late;const lateController=new AbortController(),lateHarness=harness(()=>new Promise(resolve=>{late=resolve;}),['2330','2317']);
 const pending=acquireV2FugleShares({...lateHarness.options,signal:lateController.signal});lateController.abort();
 const result=await pending,before=JSON.stringify(result);assert.deepEqual(result.map(c=>c.status),['ACQUISITION_DEADLINE','BUDGET_NOT_ATTEMPTED']);
 late(Response.json(payload()));await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.stringify(result),before);
 let reading,cancelled=false;
 const entered=new Promise(resolve=>{reading=resolve;}),bodyController=new AbortController();
 const bodyHarness=harness(async()=>new Response(new ReadableStream({pull(){reading();return new Promise(()=>{});},cancel(){cancelled=true;}})));
 const bodyWork=acquireV2FugleShares({...bodyHarness.options,signal:bodyController.signal});await entered;bodyController.abort();
 assert.equal((await bodyWork)[0].status,'ACQUISITION_DEADLINE');assert(cancelled);
});

test('bounded response rejects oversized payload without outputting its body',async()=>{
 const h=harness(async()=>new Response(' '.repeat(250001)+key));
 const [c]=await acquireV2FugleShares(h.options);assert.equal(c.status,'V2_RESPONSE_LIMIT');assert.equal(c.attempts,1);assert(!JSON.stringify(c).includes(key));
});

test('per-request timeout covers fetch AND streaming body, retries twice at most',async(t)=>{
 const timeout=AbortSignal.timeout.bind(AbortSignal);
 t.mock.method(AbortSignal,'timeout',ms=>{
  if(ms!==4000)return timeout(ms);
  const controller=new AbortController();setTimeout(()=>controller.abort(),10);return controller.signal;
 });
 for(const fetcher of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{})}))]){
  const h=harness(fetcher),[c]=await acquireV2FugleShares(h.options);
  assert.equal(c.status,'PROVIDER_TRANSPORT_OR_TIMEOUT');assert.equal(c.attempts,2);assert.equal(h.starts[1]-h.starts[0],8000);
 }
});

test('canonical Fugle suppresses duplicate public evidence, missing Fugle uses explicit public fallback',async()=>{
 const fugle=await acquireV2FugleShares(harness(async()=>Response.json(payload())).options);
 const input=v2Fixture(),before=structuredClone(input.v1),publicShares={...input.sources[0],source:V2_SOURCE_URLS.twseShares,
  rows:input.sources[0].rows.map(r=>({...r,source:V2_SOURCE_URLS.twseShares}))};
 const sources=selectV2InstitutionalSources(fugle,[publicShares,input.sources[1]],at);
 const publicCapture=sources.find(c=>c.source===V2_SOURCE_URLS.twseShares);
 assert.equal(publicCapture.provenance,'OFFICIAL_PUBLIC_FALLBACK');assert.equal(publicCapture.superseded_by_fugle,1);
 assert(!publicCapture.rows.some(r=>r.symbol==='2330'));assert.equal(publicCapture.rows.length,71);
 input.sources=sources;const result=await evaluateV2Shadow(input),candidate=result.candidates.find(c=>c.symbol==='2330');
 assert.equal(candidate.evidence.institutional.value.net_shares,10);assert.equal(candidate.evidence.institutional.status,'AVAILABLE');
 assert.deepEqual(candidate.evidence.institutional.source_refs,[V2_FUGLE_SHARES_URL+'2330']);assert.deepEqual(input.v1,before);
 assert(!candidate.blockers.includes('INSTITUTIONAL_SOURCE_CONFLICT'));
 for(const status of ['NO_DATA','ENTITLEMENT_NON_RETRYABLE','ACQUISITION_DEADLINE']){
  const fallback=selectV2InstitutionalSources([{...fugle[0],status,rows:[]}],[publicShares],at);
  assert(fallback[1].rows.some(r=>r.symbol==='2330'));assert.equal(fallback[1].provenance,'OFFICIAL_PUBLIC_FALLBACK');
 }
 const late=selectV2InstitutionalSources([{...fugle[0],received_at:'2026-10-07T00:00:00Z'}],[publicShares],at);
 assert.equal(late[0].status,'NOT_AVAILABLE_AT_CUTOFF');assert.equal(late[1].rows.length,72);
 // Selection never bypasses a conflict within the canonical provider.
 input.sources=selectV2InstitutionalSources([fugle[0],fugle[0]],[publicShares],at);
 assert((await evaluateV2Shadow(input)).candidates.find(c=>c.symbol==='2330').blockers.includes('INSTITUTIONAL_SOURCE_CONFLICT'));
});

test('Shadow coordinator joins hung public/index/Fugle jobs and preserves classifications instead of disappearing promises',async()=>{
 const calls=[],work=startV2SourceAcquisition({businessDate:'2026-10-07',symbols:['2330','2317'],apiKey:key,now:()=>at,signal:new AbortController().signal,
  fetcher:async(url,init)=>{calls.push({url,headers:init.headers});return new Promise(()=>{});}});
 work.stop();const result=await work.complete;
 assert.equal(result.fugle.length,2);assert.deepEqual(result.fugle.map(c=>c.status),['ACQUISITION_DEADLINE','BUDGET_NOT_ATTEMPTED']);
 assert.equal(result.publicSources.length,5);assert(result.publicSources.every(c=>c.status==='ACQUISITION_DEADLINE'));assert.deepEqual(result.benchmark_history,[]);
 for(const c of calls)if(!c.url.startsWith(V2_FUGLE_SHARES_URL))assert.equal(c.headers,undefined);
 assert(!JSON.stringify(result).includes(key));
});

test('Edge integration starts Shadow beside unchanged V1 and stops/joins on V1 failure; smoke does not start Shadow',async()=>{
 const source=readFileSync(new URL('../supabase/functions/recommendation-stock-evidence-v1/index.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const fixture=v2Fixture(),events=[];let handler,done,successful=false,authorized=true,capsuleInput;
 const modules={
  'https://esm.sh/@supabase/supabase-js@2.57.4':{createClient:()=>({rpc:async(name)=>{
   assert(['claim_recommendation_v2_acquisition','finish_recommendation_v2_acquisition'].includes(name));
   return {data:name==='claim_recommendation_v2_acquisition'?{status:'ACQUIRED',lease_id:'SYNTHETIC_LEASE'}:'STORED',error:null};
  }})},
  '../_shared/internal-function-auth.mjs':{authorizeInternalRequest:async()=>({ok:authorized,error_code:'DENIED'}),internalCredentialsFromEnv:()=>({})},
  '../_shared/decision-v1-data.ts':{loadDecisionEvidence:async()=>fixture.data},
  '../_shared/recommendation-stock-evidence.ts':{RECOMMENDATION_UNIVERSE,acquireStockEvidence:async()=>{events.push('V1');if(successful)return fixture.captures;throw Error('synthetic V1 failure');},
   stockAcquisitionCoverage:()=>({synthetic:true}),buildRecommendationProof:async(_data,_identity,captures)=>{assert.equal(captures,fixture.captures);return {decision:fixture.v1,business_writes:[]};}},
  '../_shared/market-session-contract.mjs':{isMarketTradingDate:()=>true},
  '../_shared/recommendation-official-actuals.ts':{acquireOfficialActuals:async()=>[]},
  '../_shared/recommendation-company-events.ts':{acquireCompanyEvents:async()=>[]},
  '../_shared/recommendation-stream.ts':{recommendationJsonStream},
  '../_shared/recommendation-v2-acquisition-cache.ts':{sharedV2Acquisition},
  '../_shared/recommendation-shadow-v2-runtime.ts':{buildV2Capsule:async input=>{capsuleInput=input;return {synthetic:true};}},
  '../_shared/recommendation-shadow-v2-sources.ts':{startV2SourceAcquisition:()=>{
   events.push('SHADOW_START');return {complete:new Promise(resolve=>{done=resolve;}),stop:()=>{events.push('STOP');done({fugle:[],publicSources:fixture.sources,benchmark_history:[]});}};},selectV2InstitutionalSources},
 };
 new Function('require','exports','Deno',code)(name=>{assert(name in modules);return modules[name];},{},{serve:fn=>{handler=fn;},env:{get:()=>key}});
 const business_date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 for(const scope of ['UNIVERSE_72','SMOKE_2330']){
  events.length=0;
  const response=await handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({business_date,correlation_id:'TEST',scope})}));
  assert.equal(response.status,scope==='SMOKE_2330'?422:200);
  const body=await response.json();assert.equal(body.error,scope==='SMOKE_2330'?'RECOMMENDATION_EVIDENCE_UNAVAILABLE':'RECOMMENDATION_TRANSPORT_FAILED');
  if(scope!=='SMOKE_2330')assert.equal(body.transport_result_status,502);
  assert.deepEqual(events,scope==='SMOKE_2330'?['V1']:['SHADOW_START','V1','STOP']);
 }
 successful=true;events.length=0;
 const request=()=>new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({business_date,correlation_id:'TEST',scope:'UNIVERSE_72'})});
 const completed=await(await handler(request())).json();
 assert.equal(completed.transport_result_status,200);assert.deepEqual(completed.decision,fixture.v1);assert.equal(capsuleInput.captures,fixture.captures);
 assert.equal(capsuleInput.sources[0].provenance,'OFFICIAL_PUBLIC_FALLBACK');assert.deepEqual(events,['SHADOW_START','V1','STOP']);
 authorized=false;events.length=0;
 assert.equal((await handler(request())).status,401);assert.deepEqual(events,[]);
 assert.equal((await handler(new Request('https://synthetic.invalid'))).status,405);assert.deepEqual(events,[]);
 assert.match(source,/timeout\(scope==='SMOKE_2330'\?22000:240000\)/);assert.match(source,/deadlineMs:260000/);
 assert.match(source,/finally\(async\(\)=>\{shadowWork\?\.stop\(\);cutoff=now\(\);await shadowWork\?\.complete;/);
 assert.match(source,/identity\.data_as_of=bundle\.acquisition_cutoff/);
 assert.doesNotMatch(source,/void acquireV2|console\./);
});
