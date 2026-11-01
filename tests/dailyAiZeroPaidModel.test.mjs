import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {refreshDailyAiFinancials} from '../research/daily-ai-financial-refresh.ts';
import {analyseStockWithProvider} from '../supabase/functions/_shared/daily-stock-ai.ts';
import {prepareDailyStockAiSource} from '../supabase/functions/daily-stock-analysis-v1/source.ts';
import {stockAiPaidModelRequestGuard,STOCK_AI_PAID_CALLS_ENABLED} from '../supabase/functions/_shared/daily-stock-ai-cost-policy.ts';

const intakeId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const batchId='b'.repeat(64);
const internalSecret='local-test-only-internal-secret-0000';

test('zero paid model policy keeps sources usable and blocks every paid route',async t=>{
 assert.equal(STOCK_AI_PAID_CALLS_ENABLED,false);
 await t.test('provider is blocked before credentials, packet validation or fetch',async()=>{
  let touched=0;
  await assert.rejects(analyseStockWithProvider(null,{
   get apiKey(){touched++;throw Error('credential accessed');},
   get model(){touched++;throw Error('model accessed');},
   fetcher:async()=>{touched++;throw Error('provider called');},
  }),{message:'STOCK_AI_PAID_MODEL_DISABLED'});
  assert.equal(touched,0);
 });
 await t.test('cached source preparation preserves data without analysis dispatch',async()=>{
  const calls=[];
  const result=await prepareDailyStockAiSource(intakeId,{
   rpc:async(name,args)=>{calls.push([name,args.p_op]);assert.equal(name,'daily_stock_ai_intake_v1');assert.equal(args.p_op,'CLAIM');
    return {state:'CACHED',intake_id:intakeId,batch_id:batchId,member_published:false};},
   fetcher:async()=>{throw Error('external fetch forbidden');},clock:()=>{throw Error('cached source must not acquire');},
  },new AbortController().signal);
  assert.deepEqual(result,{state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:batchId,analysis_dispatched:false});
  assert.deepEqual(calls,[['daily_stock_ai_intake_v1','CLAIM']]);
 });
 await t.test('only the existing exact source selector passes request policy',async()=>{
  assert.equal(stockAiPaidModelRequestGuard({intake_id:intakeId}),null);
  for(const value of [{intake_id:intakeId,repair_symbol:'2330'},{intake_id:intakeId,recovery_symbol:'2330'},
   {intake_id:intakeId,allow_paid:true},{intake_id:'invalid'},null,[],{batch_id:batchId},{cutoff:'2026-11-01T00:00:00Z'}]){
   const response=stockAiPaidModelRequestGuard(value);assert.equal(response.status,409);
   const body=await response.json();assert.equal(body.model_calls,0);assert.equal(body.automatic_continuation,false);
  }
 });
 let endpoint;
 const envReads=[];let dbCalls=0,providerCalls=0;
 const previousDeno=globalThis.Deno,previousFetch=globalThis.fetch;
 globalThis.Deno={env:{get:name=>{envReads.push(name);
  if(name==='OPENAI_API_KEY')throw Error('paid API credential must remain unread');
  return ({SUPABASE_URL:'https://local-cost-guard.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-test-only-not-a-real-key',CRON_SECRET:internalSecret})[name];
 }},serve:handler=>{endpoint=handler;}};
 globalThis.fetch=async(input,options)=>{
  const target=String(input instanceof Request?input.url:input);
  if(target.includes('api.openai.com')){providerCalls++;throw Error('paid provider fetch forbidden');}
  dbCalls++;
  assert.equal(new URL(target).pathname,'/rest/v1/rpc/daily_stock_ai_intake_v1');
  const args=JSON.parse(options.body);assert.equal(args.p_op,'CLAIM');
  return Response.json({state:'CACHED',intake_id:intakeId,batch_id:batchId,member_published:false});
 };
 try{
  await import('../supabase/functions/daily-stock-analysis-v1/index.ts');
  assert.equal(typeof endpoint,'function');
  const request=(body,headers={'x-vnext-internal':internalSecret})=>new Request('https://local-cost-guard.invalid/functions/v1/daily-stock-analysis-v1',
   {method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
  const selectors=[{batch_id:batchId},{cutoff:'2026-11-01T00:00:00Z'},
   {batch_id:batchId,repair_symbol:'2330',review_document_hash:'c'.repeat(64)},
   {batch_id:batchId,recovery_symbol:'2330',review_document_hash:'c'.repeat(64)},
   {intake_id:intakeId,repair_symbol:'2330'},{intake_id:intakeId,recovery_symbol:'2330'}];
  for(const selector of selectors)await t.test(`live entrypoint blocks ${Object.keys(selector).join('+')} before DB or credentials`,async()=>{
   const before=dbCalls,response=await endpoint(request(selector));assert.equal(response.status,409);
   assert.deepEqual(await response.json(),{state:'PAUSED',error:'STOCK_AI_PAID_MODEL_DISABLED',model_calls:0,
    automatic_continuation:false,requires_next_checkpoint:false,member_published:false});
   assert.equal(dbCalls,before);assert.equal(providerCalls,0);assert.equal(envReads.includes('OPENAI_API_KEY'),false);
  });
  await t.test('authorization and bounded-input failures remain enforced',async()=>{
   assert.equal((await endpoint(request({batch_id:batchId},{}))).status,401);
   assert.equal((await endpoint(request({batch_id:batchId},{'x-vnext-internal':internalSecret,origin:'https://untrusted.invalid'}))).status,403);
   assert.equal((await endpoint(request('{broken'))).status,422);
   assert.equal((await endpoint(request('x'.repeat(513)))).status,413);
   assert.equal(providerCalls,0);
  });
  await t.test('live source-only cached request remains available without dispatch',async()=>{
   const before=dbCalls,response=await endpoint(request({intake_id:intakeId}));assert.equal(response.status,202);
   const body=await response.json();assert.equal(body.state,'SOURCE_PREPARED');assert.equal(body.analysis_dispatched,false);
   assert.equal(body.model_calls,0);assert.equal(body.member_published,false);assert.equal(dbCalls,before+1);
   assert.equal(providerCalls,0);assert.equal(envReads.includes('OPENAI_API_KEY'),false);
  });
 }finally{globalThis.Deno=previousDeno;globalThis.fetch=previousFetch;}
});

// Reuses the existing source-worker fixture to verify the full free retention path.
{
const intakeId='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222';
const cutoff='2026-10-31T03:00:01.000000Z',now='2026-10-31T03:00:01Z',old='2026-10-30T12:00:00Z';
const baseGaps=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','FINANCIAL_DATA_RETAINED_NOT_REFRESHED','INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY'];
const newsGaps=['NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS','NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE','NEWS_NONE_AVAILABLE_WITHIN_48H'];
const treasuryUrl='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=202610';
const nightReportUrl='https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&queryDate=2026%2F11%2F02&commodity_id=TX';
const equityGap='US_EQUITY_CLOSE_NOT_COLLECTED_US_NEWS_CONTEXT_ONLY';
const unavailableMarketGaps=['MARKET_REFRESH_UNAVAILABLE','US_TREASURY_YIELD_CURVE_UNAVAILABLE',equityGap,'TAIWAN_NIGHT_SESSION_UNVERIFIED'];
const treasuryXml=`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"><title type="text">DailyTreasuryYieldCurveRateData</title>${[
 ['2026-10-29','4.61','4.98','5.32'],['2026-10-30','4.56','4.94','5.31'],
].map(([date,two,ten,thirty])=>`<entry><content type="application/xml"><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">${two}</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">${ten}</d:BC_10YEAR><d:BC_30YEAR m:type="Edm.Double">${thirty}</d:BC_30YEAR></m:properties></content></entry>`).join('')}</feed>`;
function fixture(){
 const inputs=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司'+i,cutoff:old,through:'2026-10-30',next_session:'2026-11-02',v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},expected_sessions:['2026-10-30'],facts:[],
  bars:[{id:'bar',source:'https://www.twse.com.tw/',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-10-30T05:30:00Z',evidence_hash:'a'.repeat(64),date:'2026-10-30',open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TEST'}]}));
 return {schema:'DAILY_AI_INTAKE_SOURCE_V1',state:'ACQUIRED',intake_id:intakeId,lease,business_date:'2026-10-31',requested_at:'2026-10-31T02:00:00Z',projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1',
  inputs,companies:inputs.map(i=>({symbol:i.symbol,company:i.company,exchange:'TWSE'})),source_kind:'VNEXT_ACQUIRED',source_id:'33333333-3333-4333-8333-333333333333',source_revision:'c'.repeat(64),source_cutoff:old,source_business_date:'2026-10-30',source_issues:[],intake_gaps:baseGaps.slice(),news:[],market:[],member_published:false};
}
function harness(){
 let state=fixture(),batchId=null,batch=null,failure=null,financialProof=null;const calls=[];let refreshes=0,financialRefreshes=0,newsCalls=0,marketCalls=0;
 const ports={clock:()=>now,fetcher:async()=>assert.fail('no model fetch'),
  refresh:async()=>{refreshes++;calls.push('PRICE');await Promise.resolve();assert(calls.includes('FINANCE')&&calls.includes('NEWS')&&calls.includes('MARKET'));return {inputs:structuredClone(state.inputs),cutoff:'2026-10-31T03:00:00Z',through:'2026-10-30',additionalGaps:['TEST_REFRESH_GAP'],gapsBySymbol:Object.fromEntries(state.inputs.map((i,n)=>[i.symbol,n===0?['PRICE_SESSION_OBSERVATION_UNAVAILABLE']:[]])),receipts:[]};},
  refreshFinancials:async input=>{financialRefreshes++;calls.push('FINANCE');const result=await refreshDailyAiFinancials({...input,fetcher:async()=>new Response('private official endpoint outage',{status:503})});financialProof=result.proof;return result;},
  collectNews:async input=>{newsCalls++;calls.push('NEWS');assert.equal(input.businessDate,'2026-10-31');assert.equal(input.inputs.length,72);assert(input.signal instanceof AbortSignal);return {complete:true,additionalGaps:[],proof:{schema:'DAILY_AI_OFFICIAL_NEWS_PROOF_V1',responses:[],additions:[]}};},
  collectMarket:async()=>{marketCalls++;calls.push('MARKET');return {market:[],additionalGaps:unavailableMarketGaps.slice(),receipts:[]};},
  rpc:async(name,args)=>{
   const op=name==='daily_stock_ai_intake_v1'?args.p_op:name;calls.push(op);
   if(failure===op)throw Error('private server body');
   if(op==='CLAIM')return structuredClone(state);
   if(op==='import_daily_stock_ai_official_news_v1'){assert.equal(args.p_proof.schema,'DAILY_AI_OFFICIAL_NEWS_PROOF_V1');return {state:'STORED',capture_id:'e'.repeat(64),records:0,member_published:false};}
   if(op==='SOURCE'){
    assert.equal(args.p_lease,lease);assert(calls.includes('PRICE')&&calls.includes('FINANCE')&&calls.includes('NEWS')&&calls.includes('MARKET'));
    assert(Array.isArray(args.p_market));
    assert.equal(args.p_financial_refresh.schema,'DAILY_AI_FINANCIAL_REFRESH_V1');if(financialProof)assert.deepEqual(args.p_financial_refresh,financialProof);
    const snapshotGaps=newsGaps.filter(g=>g!=='MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'||args.p_market.length===0);
    state={...state,state:'SOURCED',cutoff,snapshot_hash:'d'.repeat(64),inputs:args.p_inputs.map(i=>({...i,cutoff})),intake_gaps:[...new Set([...baseGaps,...snapshotGaps,...args.p_gaps])],gaps_by_symbol:args.p_symbol_gaps,market:args.p_market,financial_refresh:args.p_financial_refresh};return structuredClone(state);
   }
   if(op==='store_daily_stock_ai_batch_v1'){
    const b=JSON.parse(args.p_text);assert.equal(args.p_hash,await snapshotHash(b));batchId=args.p_hash;
    assert.equal(b.source_intake.intake_id,intakeId);assert.equal(b.source_intake.source_cutoff,old);assert.equal(b.source_intake.snapshot_hash,'d'.repeat(64));
    assert.equal(JSON.parse(b.packet_texts['1000']).cutoff,cutoff);assert(JSON.parse(b.packet_texts['1000']).data_gaps.includes('PRICE_SESSION_OBSERVATION_UNAVAILABLE'));
    assert(!JSON.parse(b.packet_texts['1001']).data_gaps.includes('PRICE_SESSION_OBSERVATION_UNAVAILABLE'));
    batch={id:batchId,cutoff,packets:Object.values(b.packet_texts).map(text=>JSON.parse(text))};
    return {state:'STORED',batch_id:batchId,packets:72,member_published:false};
   }
   if(op==='load_daily_stock_ai_batch_v1'){assert.equal(args.p_batch_id,batchId);assert(batch);return structuredClone(batch);}
   if(op==='COMPLETE'){assert.equal(args.p_batch_id,batchId);state={state:'CACHED',intake_id:intakeId,batch_id:batchId,member_published:false};return {...state,state:'COMPLETE'};}
   if(op==='dispatch_daily_stock_ai_batch_v1'){assert.equal(args.p_batch_id,batchId);return {state:'DISPATCHED',batch_id:batchId,member_published:false};}
   if(op==='FAIL')return {state:'FAILED'};
   assert.fail('unexpected RPC '+op);
  }};
 return {ports,calls,get state(){return state;},set state(v){state=v;},set failure(v){failure=v;},get refreshes(){return refreshes;},get financialRefreshes(){return financialRefreshes;},get newsCalls(){return newsCalls;},get marketCalls(){return marketCalls;},get batchId(){return batchId;}};
}
test('fresh SOURCE retains official observation batch and completes intake without paid dispatch',async()=>{
 const h=harness(),r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);
 assert.deepEqual(r,{state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:h.batchId,analysis_dispatched:false});
 assert.deepEqual(h.calls.filter(c=>!['PRICE','FINANCE','NEWS','MARKET'].includes(c)),['CLAIM','import_daily_stock_ai_official_news_v1','SOURCE','store_daily_stock_ai_batch_v1','COMPLETE']);
 assert.equal(h.refreshes,1);assert.equal(h.financialRefreshes,1);assert.equal(h.newsCalls,1);assert.equal(h.marketCalls,1);
 assert.equal(h.state.state,'CACHED');
 const again=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);
 assert.equal(again.analysis_dispatched,false);assert.equal(again.batch_id,h.batchId);
 assert.equal(h.refreshes,1);assert(!h.calls.includes('dispatch_daily_stock_ai_batch_v1'));
});
}
