import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDailyStockAiSource} from '../supabase/functions/daily-stock-analysis-v1/source.ts';
import {collectDailyStockAiNews} from '../supabase/functions/_shared/daily-stock-ai-news.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {collectDailyAiGlobalMarket} from '../research/daily-ai-global-market.ts';

const intakeId='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222';
const cutoff='2026-10-31T03:00:00.123456Z',now='2026-10-31T03:00:01Z',old='2026-10-30T12:00:00Z';
const baseGaps=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','FINANCIAL_DATA_RETAINED_NOT_REFRESHED','INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY'];
const newsGaps=['NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS','NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE','NEWS_NONE_AVAILABLE_WITHIN_48H'];
function fixture(){
 const inputs=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司'+i,cutoff:old,through:'2026-10-30',next_session:'2026-11-02',v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},expected_sessions:['2026-10-30'],facts:[],
  bars:[{id:'bar',source:'https://www.twse.com.tw/',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-10-30T05:30:00Z',evidence_hash:'a'.repeat(64),date:'2026-10-30',open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TEST'}]}));
 return {schema:'DAILY_AI_INTAKE_SOURCE_V1',state:'ACQUIRED',intake_id:intakeId,lease,business_date:'2026-10-31',requested_at:'2026-10-31T02:00:00Z',projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1',
  inputs,companies:inputs.map(i=>({symbol:i.symbol,company:i.company,exchange:'TWSE'})),source_kind:'VNEXT_ACQUIRED',source_id:'33333333-3333-4333-8333-333333333333',source_revision:'c'.repeat(64),source_cutoff:old,source_business_date:'2026-10-30',source_issues:[],intake_gaps:baseGaps.slice(),news:[],market:[],member_published:false};
}
function harness(){
 let state=fixture(),batchId=null,failure=null;const calls=[];let refreshes=0,newsCalls=0,marketCalls=0;
 const ports={clock:()=>now,fetcher:async()=>assert.fail('no model fetch'),
  refresh:async()=>{refreshes++;calls.push('PRICE');await Promise.resolve();assert(calls.includes('NEWS')&&calls.includes('MARKET'));return {inputs:structuredClone(state.inputs),cutoff:'2026-10-31T03:00:00Z',through:'2026-10-30',additionalGaps:['TEST_REFRESH_GAP'],gapsBySymbol:Object.fromEntries(state.inputs.map((i,n)=>[i.symbol,n===0?['PRICE_SESSION_OBSERVATION_UNAVAILABLE']:[]])),receipts:[]};},
  collectNews:async()=>{newsCalls++;calls.push('NEWS');return {complete:true};},
  collectMarket:async()=>{marketCalls++;calls.push('MARKET');return {market:[],additionalGaps:['US_MARKET_CONTEXT_UNAVAILABLE','TAIWAN_NIGHT_SESSION_UNVERIFIED'],receipts:[]};},
  rpc:async(name,args)=>{
   const op=name==='daily_stock_ai_intake_v1'?args.p_op:name;calls.push(op);
   if(failure===op)throw Error('private server body');
   if(op==='CLAIM')return structuredClone(state);
   if(op==='SOURCE'){
    assert.equal(args.p_lease,lease);assert(calls.includes('PRICE')&&calls.includes('NEWS')&&calls.includes('MARKET'));
    assert(Array.isArray(args.p_market));
    const snapshotGaps=newsGaps.filter(g=>g!=='MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'||args.p_market.length===0);
    state={...state,state:'SOURCED',cutoff,snapshot_hash:'d'.repeat(64),inputs:args.p_inputs.map(i=>({...i,cutoff})),intake_gaps:[...new Set([...baseGaps,...snapshotGaps,...args.p_gaps])],gaps_by_symbol:args.p_symbol_gaps,market:args.p_market};return structuredClone(state);
   }
   if(op==='store_daily_stock_ai_batch_v1'){
    const b=JSON.parse(args.p_text);assert.equal(args.p_hash,await snapshotHash(b));batchId=args.p_hash;
    assert.equal(b.source_intake.intake_id,intakeId);assert.equal(b.source_intake.source_cutoff,old);assert.equal(b.source_intake.snapshot_hash,'d'.repeat(64));
    assert.equal(JSON.parse(b.packet_texts['1000']).cutoff,cutoff);assert(JSON.parse(b.packet_texts['1000']).data_gaps.includes('PRICE_SESSION_OBSERVATION_UNAVAILABLE'));
    assert(!JSON.parse(b.packet_texts['1001']).data_gaps.includes('PRICE_SESSION_OBSERVATION_UNAVAILABLE'));
    return {state:'STORED',batch_id:batchId,packets:72,member_published:false};
   }
   if(op==='COMPLETE'){assert.equal(args.p_batch_id,batchId);state={state:'CACHED',intake_id:intakeId,batch_id:batchId,member_published:false};return {...state,state:'COMPLETE'};}
   if(op==='dispatch_daily_stock_ai_batch_v1'){assert.equal(args.p_batch_id,batchId);return {state:'DISPATCHED',batch_id:batchId,member_published:false};}
   if(op==='FAIL')return {state:'FAILED'};
   assert.fail('unexpected RPC '+op);
  }};
 return {ports,calls,get state(){return state;},set state(v){state=v;},set failure(v){failure=v;},get refreshes(){return refreshes;},get newsCalls(){return newsCalls;},get marketCalls(){return marketCalls;},get batchId(){return batchId;}};
}
test('SOURCE runs prices/news/market in parallel once, freezes final receipt and persists per-stock gaps before dispatch',async()=>{
 const h=harness(),r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);
 assert.deepEqual(r,{state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:h.batchId,analysis_dispatched:true});
 assert.deepEqual(h.calls,['CLAIM','PRICE','NEWS','MARKET','SOURCE','store_daily_stock_ai_batch_v1','COMPLETE','dispatch_daily_stock_ai_batch_v1']);
 const cached=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(cached.analysis_dispatched,true);assert.equal(h.refreshes,1);assert.equal(h.newsCalls,1);assert.equal(h.marketCalls,1);
});
test('news refresh failure remains an explicit gap while frozen currently available observations continue',async()=>{
 const h=harness();h.ports.collectNews=async()=>{h.calls.push('NEWS');throw Error('private provider URL');};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{if(args.p_op==='SOURCE')assert(args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));return rpc(name,args,signal);};
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(r.analysis_dispatched,true);
});
test('market acquisition failure preserves separate US/night gaps without claiming the news collector failed',async()=>{
 const h=harness();h.ports.collectMarket=async()=>{h.calls.push('MARKET');throw Error('private market provider body');};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert.deepEqual(args.p_market,[]);for(const gap of ['MARKET_REFRESH_UNAVAILABLE','US_MARKET_CONTEXT_UNAVAILABLE','TAIWAN_NIGHT_SESSION_UNVERIFIED'])assert(args.p_gaps.includes(gap));
   assert(!args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));
  }
  if(name==='store_daily_stock_ai_batch_v1'){
   const p=JSON.parse(JSON.parse(args.p_text).packet_texts['1000']);assert(!p.evidence.some(e=>e.kind==='MARKET'));
   for(const gap of ['MARKET_REFRESH_UNAVAILABLE','US_MARKET_CONTEXT_UNAVAILABLE','TAIWAN_NIGHT_SESSION_UNVERIFIED'])assert(p.data_gaps.includes(gap));
  }
  return rpc(name,args,signal);
 };
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(r.analysis_dispatched,true);
});
test('available completed US closes reach SOURCE and every seed packet unchanged while night failure remains explicit',async()=>{
 const received='2026-10-31T03:00:00Z',market=await collectDailyAiGlobalMarket({businessDate:'2026-10-31',clock:()=>received,signal:new AbortController().signal,
  fetcher:async url=>{
   const parsed=new URL(String(url));
   if(parsed.hostname==='openapi.taifex.com.tw')return new Response('private night API outage',{status:503});
   const symbol=decodeURIComponent(parsed.pathname.split('/').at(-1));assert(['^IXIC','^SOX','^GSPC'].includes(symbol));
   return Response.json({chart:{error:null,result:[{meta:{symbol,instrumentType:'INDEX',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d',regularMarketTime:1793394959},
    timestamp:[1793280600,1793367000],indicators:{quote:[{close:[100,101]}]}}]}});
  }});
 assert.equal(market.market.length,3);assert.deepEqual(market.additionalGaps,['TAIWAN_NIGHT_SESSION_UNVERIFIED']);
 const h=harness();h.ports.collectMarket=async()=>{h.calls.push('MARKET');return market;};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert.deepEqual(args.p_market,market.market);assert(args.p_gaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));assert(!args.p_gaps.includes('MARKET_REFRESH_UNAVAILABLE'));
  }
  if(name==='store_daily_stock_ai_batch_v1'){
   const body=JSON.parse(args.p_text),byId=(a,b)=>a.id.localeCompare(b.id);
   for(const text of Object.values(body.packet_texts)){
    const p=JSON.parse(text);assert.deepEqual(p.evidence.filter(e=>e.kind==='MARKET').sort(byId),market.market.slice().sort(byId));
    assert(p.data_gaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));assert(!p.data_gaps.includes('MARKET_CONTEXT_NOT_CAPTURED'));
    assert(!p.data_gaps.includes('MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'));
   }
  }
  return rpc(name,args,signal);
 };
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(r.analysis_dispatched,true);
});
test('excessive market evidence or unnormalized gaps cannot reach SOURCE or a model',async()=>{
 for(const value of [{market:Array.from({length:5},()=>({})),additionalGaps:[],receipts:[]},
  {market:[],additionalGaps:['private provider prose'],receipts:[]}]){
  const h=harness();h.ports.collectMarket=async()=>{h.calls.push('MARKET');return value;};
  await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/AI_INTAKE_MARKET_PORT_INVALID/);
  assert(!h.calls.includes('SOURCE'));assert(!h.calls.includes('store_daily_stock_ai_batch_v1'));assert(!h.calls.includes('FAIL'));
 }
});
test('unknown SOURCE/COMPLETE commits never FAIL and SOURCED retry skips all three acquisitions',async()=>{
 const h=harness();h.failure='COMPLETE';await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/private server body/);
 assert.equal(h.state.state,'SOURCED');assert(!h.calls.includes('FAIL'));h.failure=null;
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(h.refreshes,1);assert.equal(h.newsCalls,1);assert.equal(h.marketCalls,1);
 const u=harness();u.failure='SOURCE';await assert.rejects(()=>prepareDailyStockAiSource(intakeId,u.ports,new AbortController().signal));assert(!u.calls.includes('FAIL'));assert(!u.calls.includes('store_daily_stock_ai_batch_v1'));
});
test('claim statuses and dispatch failures never invent preparation or publication',async()=>{
 for(const state of ['BUSY','EXHAUSTED','EXPIRED','SOURCE_UNAVAILABLE']){
  const h=harness();h.state={state,intake_id:intakeId,member_published:false};assert.deepEqual(await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),{state,intake_id:intakeId});assert.equal(h.refreshes,0);assert.equal(h.newsCalls,0);assert.equal(h.marketCalls,0);
 }
 const h=harness();h.failure='dispatch_daily_stock_ai_batch_v1';const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.analysis_dispatched,false);assert.equal(r.batch_id,h.batchId);
});
test('malformed claims stop acquisition and worker abort prevents later SOURCE/store/dispatch',async()=>{
 for(const change of [s=>s.inputs.pop(),s=>s.inputs[0].cutoff=cutoff,s=>s.companies[0].company='mismatch',s=>s.source_revision='bad',s=>s.source_issues=[{kind:'SOURCE',key:'abc',reason:'private prose'}]]){
  const h=harness();change(h.state);await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/AI_INTAKE_/);assert.equal(h.refreshes,0);
 }
 const h=harness(),controller=new AbortController();h.ports.refresh=async()=>{controller.abort();throw Error('interrupted');};
 await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,controller.signal));assert(!h.calls.includes('SOURCE'));assert(!h.calls.includes('FAIL'));
});
test('news collection port uses only the fixed server collector and bounds body/errors/time',async()=>{
 const secret='test-only-internal-secret-0123456789',signal=new AbortController().signal;
 const config={baseUrl:'https://database.example.invalid',internalSecret:secret,signal,fetcher:async(url,init)=>{
  assert.equal(String(url),'https://database.example.invalid/functions/v1/fetch-global-market-news');assert.equal(init.method,'POST');assert.equal(init.body,'{}');assert.equal(init.headers['x-cron-secret'],secret);
  return Response.json({success:true,canonical_complete:true,logs:['private ignored']});
 }};
 assert.deepEqual(await collectDailyStockAiNews(config),{complete:true});
 for(const fetcher of [async()=>Response.json({success:true,canonical_complete:false}),async()=>Response.json({logs:['private']})])assert.deepEqual(await collectDailyStockAiNews({...config,fetcher}),{complete:false});
 for(const fetcher of [async()=>new Response('private error',{status:503}),async()=>new Response('x'.repeat(200001)),async()=>new Response('{bad JSON')])await assert.rejects(()=>collectDailyStockAiNews({...config,fetcher}),/^Error: AI_INTAKE_NEWS_UNAVAILABLE$/);
 let requestSignal;await assert.rejects(()=>collectDailyStockAiNews({...config,fetcher:async(url,init)=>{requestSignal=init.signal;return new Promise(()=>{});}},5),/AI_INTAKE_NEWS_UNAVAILABLE/);assert.equal(requestSignal.aborted,true);
 const controller=new AbortController();await assert.rejects(()=>collectDailyStockAiNews({...config,signal:controller.signal,fetcher:async()=>{controller.abort();return new Promise(()=>{});}}),/AI_INTAKE_NEWS_UNAVAILABLE/);
});
