import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDailyStockAiSource} from '../supabase/functions/daily-stock-analysis-v1/source.ts';
import {collectDailyStockAiNews} from '../supabase/functions/_shared/daily-stock-ai-news.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {collectDailyAiGlobalMarket} from '../research/daily-ai-global-market.ts';
import {refreshDailyAiFinancials} from '../research/daily-ai-financial-refresh.ts';

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
test('SOURCE runs prices/financials/news/market in parallel once, freezes final receipt and persists per-stock gaps before dispatch',async()=>{
 const h=harness(),r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);
 assert.deepEqual(r,{state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:h.batchId,analysis_dispatched:true});
 assert.deepEqual(h.calls.slice(1,5).sort(),['PRICE','FINANCE','NEWS','MARKET'].sort());
 assert.deepEqual(h.calls.filter(c=>!['PRICE','FINANCE','NEWS','MARKET','load_daily_stock_ai_batch_v1'].includes(c)),['CLAIM','import_daily_stock_ai_official_news_v1','SOURCE','store_daily_stock_ai_batch_v1','COMPLETE','dispatch_daily_stock_ai_batch_v1']);
 const cached=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(cached.analysis_dispatched,true);assert.equal(h.refreshes,1);assert.equal(h.financialRefreshes,1);assert.equal(h.newsCalls,1);assert.equal(h.marketCalls,1);
});
test('news refresh failure remains an explicit gap while frozen currently available observations continue',async()=>{
 const h=harness();h.ports.collectNews=async()=>{h.calls.push('NEWS');throw Error('private provider URL');};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{if(args.p_op==='SOURCE')assert(args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));return rpc(name,args,signal);};
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(r.analysis_dispatched,true);
});
test('official-news import failure remains explicit and never substitutes unverified collector output for frozen evidence',async()=>{
 const h=harness();h.failure='import_daily_stock_ai_official_news_v1';
 h.ports.collectNews=async()=>{h.calls.push('NEWS');return {complete:true,additionalGaps:['OFFICIAL_NEWS_FIXED_FEEDS_NOT_ALL_COMPANY_OR_MARKET_NEWS'],
  proof:{schema:'DAILY_AI_OFFICIAL_NEWS_PROOF_V1',responses:[],additions:[]},news:[{content:'unverified collector output'}]};};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert(args.p_gaps.includes('NEWS_OFFICIAL_CAPTURE_IMPORT_UNAVAILABLE'));assert(args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));
   assert(!Object.hasOwn(args,'p_news'),'only the verified registry can supply frozen news');
  }
  if(name==='store_daily_stock_ai_batch_v1')assert(!args.p_text.includes('unverified collector output'));
  return rpc(name,args,signal);
 };
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');
 assert(h.calls.indexOf('import_daily_stock_ai_official_news_v1')<h.calls.indexOf('SOURCE'));
});
test('invalid official-news port metadata is rejected and abort during import prevents SOURCE',async()=>{
 for(const value of [{complete:true,additionalGaps:['private provider prose'],proof:null},
  {complete:true,additionalGaps:[],proof:{schema:'OTHER'}}]){
  const h=harness();h.ports.collectNews=async()=>{h.calls.push('NEWS');return value;};
  await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/AI_INTAKE_NEWS_PORT_INVALID/);assert(!h.calls.includes('SOURCE'));
 }
 const h=harness(),controller=new AbortController(),rpc=h.ports.rpc;
 h.ports.rpc=async(name,args,signal)=>{
  if(name==='import_daily_stock_ai_official_news_v1'){controller.abort();throw Error('private import error');}
  return rpc(name,args,signal);
 };
 await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,controller.signal),/AI_INTAKE_ABORTED/);
 assert(!h.calls.includes('SOURCE'));assert(!h.calls.includes('store_daily_stock_ai_batch_v1'));
});
test('facts-only financial merge keeps newly refreshed price bars and exact official financial receipt traces',async()=>{
 const h=harness(),stock=h.state.inputs[0];
 const retainedRevenue={id:'retained-revenue',kind:'REVENUE',period:'2026-09',basis:'MONTHLY',values:{yoy_percent:10},
  source:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-09-30T15:59:59Z',evidence_hash:'e'.repeat(64)};
 stock.facts.push(retainedRevenue,{...retainedRevenue,id:'restricted-eps',kind:'EPS',period:'2026-Q2',basis:'SINGLE_QUARTER',source:'https://investor.tsmc.com/financial-report',values:{eps:8}});
 const originalRefresh=h.ports.refresh;let expectedBar,financialResult;
 h.ports.refresh=async input=>{
  const result=await originalRefresh(input);expectedBar={...result.inputs[0].bars[0],id:'fresh-public-price',high:14,close:13,amount:13000,
   first_seen_at:'2026-10-31T03:00:00Z',available_at:'2026-10-31T03:00:00Z',evidence_hash:'b'.repeat(64)};
  result.inputs[0].bars=[expectedBar];return result;
 };
 h.ports.refreshFinancials=async input=>{
  h.calls.push('FINANCE');financialResult=await refreshDailyAiFinancials({...input,fetcher:async url=>{
   const value=String(url),row={'公司代號':'1000','年度':'115','季別':'2','出表日期':'1151031'};
   if(value.endsWith('/t187ap14_L'))return Response.json([{...row,'基本每股盈餘(元)':'49.33'}]);
   if(value.endsWith('/t187ap06_L_ci'))return Response.json([{...row,'營業收入':'100','營業毛利（毛損）淨額':'40','營業利益（損失）':'30','本期淨利（淨損）':'20'}]);
   assert(['https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O','https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d'].includes(value));return Response.json([]);
  }});
  // The independent finance projection still owns the old price snapshot.
  // Its bars must never replace the price port's more recent observation.
  financialResult.inputs[0].bars[0]={...financialResult.inputs[0].bars[0],close:999,high:999};return financialResult;
 };
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert.deepEqual(args.p_inputs[0].bars,[expectedBar]);assert.deepEqual(args.p_inputs[0].facts.find(f=>f.id==='retained-revenue'),retainedRevenue);
   assert(!JSON.stringify(args.p_inputs[0].facts).includes('tsmc.com'));assert.deepEqual(args.p_financial_refresh,financialResult.proof);
   assert.equal(args.p_financial_refresh.additions.length,2);assert.equal(args.p_financial_refresh.removals.length,1);
   const eps=args.p_inputs[0].facts.find(f=>f.kind==='EPS_AS_REPORTED');assert.equal(eps.values.value,49.33);assert.equal(eps.basis,'AS_REPORTED');
   assert.equal(eps.available_at,'2026-10-31T03:00:01Z');assert.equal(eps.published_at,null);
  }
  if(name==='store_daily_stock_ai_batch_v1'){
   const p=JSON.parse(JSON.parse(args.p_text).packet_texts['1000']),price=p.evidence.find(e=>e.kind==='PRICE');assert.equal(JSON.parse(price.content).close,13);
   assert.equal(price.evidence_hash,'b'.repeat(64));assert.equal(price.available_at,'2026-10-31T03:00:00Z');
   const eps=p.evidence.find(e=>e.kind==='FINANCIAL'&&JSON.parse(e.content).kind==='EPS_AS_REPORTED');
   assert.equal(eps.available_at,'2026-10-31T03:00:01Z');assert.equal(JSON.parse(eps.content).basis,'AS_REPORTED');assert.equal(JSON.parse(eps.content).values.value,49.33);
   assert.equal(eps.evidence_hash,financialResult.inputs[0].facts.find(f=>f.kind==='EPS_AS_REPORTED').evidence_hash);
  }
  return rpc(name,args,signal);
 };
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(r.analysis_dispatched,true);
});
test('financial acquisition exceptions remove restricted facts before SOURCE instead of recycling them',async()=>{
 const h=harness();h.state.inputs[0].facts=[{id:'restricted-eps',kind:'EPS',period:'2026-Q2',basis:'SINGLE_QUARTER',values:{eps:8},
  source:'https://www.mediatek.com/financial-report',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-06-30T15:59:59Z',evidence_hash:'e'.repeat(64)}];
 h.ports.refreshFinancials=async()=>{h.calls.push('FINANCE');throw Error('private financial source response');};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert.deepEqual(args.p_inputs[0].facts,[]);assert(args.p_gaps.includes('FINANCIAL_REFRESH_UNAVAILABLE'));
   assert(args.p_symbol_gaps['1000'].includes('RESTRICTED_COMPANY_WEBSITE_FACTS_REMOVED_NOT_RELABELLED_OR_RELICENSED'));
   assert.equal(args.p_financial_refresh.removals.length,1);assert.deepEqual(args.p_financial_refresh.additions,[]);
  }
  if(name==='store_daily_stock_ai_batch_v1')assert(!args.p_text.includes('mediatek.com'));
  return rpc(name,args,signal);
 };
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');
});
test('only an official TPEX EPS proof may replace a missing company display name while preserving price observations',async()=>{
 const h=harness();h.state.inputs[0].company='1000';h.state.companies[0].company='1000';
 let proof;
 h.ports.refreshFinancials=async input=>{h.calls.push('FINANCE');const result=await refreshDailyAiFinancials({...input,fetcher:async url=>{
  if(String(url)==='https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O')return Response.json([{SecuritiesCompanyCode:'1000',CompanyName:'官方核實公司',Year:'115','季別':'2',Date:'1151031','基本每股盈餘':'1.63'}]);
  return Response.json([]);
 }});proof=result.proof;return result;};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert.equal(args.p_inputs[0].company,'官方核實公司');assert.equal(args.p_inputs[1].company,'測試公司1');
   assert.deepEqual(args.p_inputs[0].bars,h.state.inputs[0].bars);assert.deepEqual(args.p_financial_refresh.company_names,proof.company_names);
   assert.equal(proof.company_names.length,1);assert.equal(proof.company_names[0].previous_company,'1000');
  }
  if(name==='store_daily_stock_ai_batch_v1')assert.equal(JSON.parse(JSON.parse(args.p_text).packet_texts['1000']).company,'官方核實公司');
  return rpc(name,args,signal);
 };
 assert.equal((await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal)).state,'SOURCE_PREPARED');
});
test('unproven name changes, known-name rewrites, cross-company rows and nonofficial naming sources remain rejected',async()=>{
 for(const change of [
  (result)=>{result.inputs[0].company='未經核實名稱';},
  (result,base)=>{result.inputs[0].company='改寫既有名稱';result.proof.company_names=[{symbol:'1000',previous_company:base[0].company,company:'改寫既有名稱',source:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O',row_text:'{}'}];},
  (result,base)=>{base[0].company='1000';result.inputs[0].company='甲公司';result.proof.company_names=[{symbol:'1000',previous_company:'1000',company:'甲公司',source:'https://example.invalid',row_text:'{}'}];},
  (result,base)=>{base[0].company='1000';result.inputs[0].company='甲公司';result.proof.company_names=[{symbol:'1000',previous_company:'1000',company:'甲公司',source:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O',row_text:'{"CompanyName":"甲公司","SecuritiesCompanyCode":"1001"}'}];},
 ]){
  const h=harness();h.ports.refreshFinancials=async input=>{h.calls.push('FINANCE');const result=await refreshDailyAiFinancials({...input,fetcher:async()=>Response.json([])});change(result,input.inputs);return result;};
  await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/AI_INTAKE_FINANCIAL_COMPANIES/);
  assert(!h.calls.includes('SOURCE'));assert(!h.calls.includes('store_daily_stock_ai_batch_v1'));
 }
});
test('market acquisition failure preserves separate US/night gaps without claiming the news collector failed',async()=>{
 const h=harness();h.ports.collectMarket=async()=>{h.calls.push('MARKET');throw Error('private market provider body');};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert.deepEqual(args.p_market,[]);for(const gap of unavailableMarketGaps)assert(args.p_gaps.includes(gap));
   assert(!args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));
  }
  if(name==='store_daily_stock_ai_batch_v1'){
   const p=JSON.parse(JSON.parse(args.p_text).packet_texts['1000']);assert(!p.evidence.some(e=>e.kind==='MARKET'));
   for(const gap of unavailableMarketGaps)assert(p.data_gaps.includes(gap));
  }
  return rpc(name,args,signal);
 };
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(r.analysis_dispatched,true);
});
test('Treasury observations reach SOURCE unchanged with explicit missing equity and night coverage; Yahoo is never requested',async()=>{
 let yahooCalls=0,nightFallbackCalls=0;
 const received='2026-10-31T03:00:00Z',market=await collectDailyAiGlobalMarket({businessDate:'2026-10-31',clock:()=>received,signal:new AbortController().signal,
  fetcher:async url=>{
   const value=String(url),parsed=new URL(value);
   if(parsed.hostname.endsWith('yahoo.com')){yahooCalls++;return new Response('disallowed source',{status:503});}
   if(value==='https://openapi.taifex.com.tw/v1/DailyMarketReportFut')return new Response('private night API outage',{status:503});
   if(value===nightReportUrl){nightFallbackCalls++;return new Response('private official night report outage',{status:503});}
   assert.equal(value,treasuryUrl);return new Response(treasuryXml,{headers:{'Content-Type':'application/xml'}});
  }});
 assert.equal(yahooCalls,0);assert.equal(nightFallbackCalls,1);assert.equal(market.market.length,1);
 assert.deepEqual(new Set(market.additionalGaps),new Set([equityGap,'TAIWAN_NIGHT_SESSION_UNVERIFIED']));
 const curve=JSON.parse(market.market[0].content);assert.equal(curve.kind,'US_TREASURY_PAR_YIELD_CURVE');assert.equal(curve.unit,'PERCENT');
 assert.deepEqual([curve.yield_2y,curve.yield_10y,curve.yield_30y],[4.56,4.94,5.31]);assert.deepEqual([curve.change_2y_bp,curve.change_10y_bp,curve.change_30y_bp],[-5,-4,-1]);
 const h=harness();h.ports.collectMarket=async()=>{h.calls.push('MARKET');return market;};
 const rpc=h.ports.rpc;h.ports.rpc=async(name,args,signal)=>{
  if(args.p_op==='SOURCE'){
   assert.deepEqual(args.p_market,market.market);assert(args.p_gaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));assert(args.p_gaps.includes(equityGap));assert(!args.p_gaps.includes('MARKET_REFRESH_UNAVAILABLE'));
  }
  if(name==='store_daily_stock_ai_batch_v1'){
   const body=JSON.parse(args.p_text),byId=(a,b)=>a.id.localeCompare(b.id);
   for(const text of Object.values(body.packet_texts)){
    const p=JSON.parse(text);assert.deepEqual(p.evidence.filter(e=>e.kind==='MARKET').sort(byId),market.market.slice().sort(byId));
    assert(p.data_gaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));assert(p.data_gaps.includes(equityGap));assert(!p.data_gaps.includes('MARKET_CONTEXT_NOT_CAPTURED'));
    assert(!p.data_gaps.includes('MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'));
   }
  }
  return rpc(name,args,signal);
 };
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(r.analysis_dispatched,true);
});
test('a retained Yahoo market snapshot is rejected before any batch is stored',async()=>{
 const content='{}',evidence_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content))),v=>v.toString(16).padStart(2,'0')).join('');
 const legacy={id:'global:IXIC:2026-10-30',symbol:null,kind:'MARKET',source:'https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1mo',
  published_at:null,available_at:'2026-10-31T03:00:00Z',first_seen_at:'2026-10-31T03:00:00Z',as_of:'2026-10-31T03:00:00Z',time_basis:'OBSERVED_AFTER_RECEIPT',content,evidence_hash};
 const h=harness();h.ports.collectMarket=async()=>{h.calls.push('MARKET');return {market:[legacy],additionalGaps:[equityGap],receipts:[]};};
 await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/AI_INTAKE_MARKET_SOURCE/);
 assert(!h.calls.includes('store_daily_stock_ai_batch_v1'));assert(!h.calls.includes('COMPLETE'));assert(!h.calls.includes('dispatch_daily_stock_ai_batch_v1'));
});
test('excessive market evidence or unnormalized gaps cannot reach SOURCE or a model',async()=>{
 for(const value of [{market:Array.from({length:5},()=>({})),additionalGaps:[],receipts:[]},
  {market:[],additionalGaps:['private provider prose'],receipts:[]}]){
  const h=harness();h.ports.collectMarket=async()=>{h.calls.push('MARKET');return value;};
  await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/AI_INTAKE_MARKET_PORT_INVALID/);
  assert(!h.calls.includes('SOURCE'));assert(!h.calls.includes('store_daily_stock_ai_batch_v1'));assert(!h.calls.includes('FAIL'));
 }
});
test('unknown SOURCE/COMPLETE commits never FAIL and SOURCED retry skips all four acquisitions',async()=>{
 const h=harness();h.failure='COMPLETE';await assert.rejects(()=>prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),/private server body/);
 assert.equal(h.state.state,'SOURCED');assert(!h.calls.includes('FAIL'));h.failure=null;
 const r=await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal);assert.equal(r.state,'SOURCE_PREPARED');assert.equal(h.refreshes,1);assert.equal(h.financialRefreshes,1);assert.equal(h.newsCalls,1);assert.equal(h.marketCalls,1);
 const u=harness();u.failure='SOURCE';await assert.rejects(()=>prepareDailyStockAiSource(intakeId,u.ports,new AbortController().signal));assert(!u.calls.includes('FAIL'));assert(!u.calls.includes('store_daily_stock_ai_batch_v1'));
});
test('claim statuses and dispatch failures never invent preparation or publication',async()=>{
 for(const state of ['BUSY','EXHAUSTED','EXPIRED','SOURCE_UNAVAILABLE']){
  const h=harness();h.state={state,intake_id:intakeId,member_published:false};assert.deepEqual(await prepareDailyStockAiSource(intakeId,h.ports,new AbortController().signal),{state,intake_id:intakeId});assert.equal(h.refreshes,0);assert.equal(h.financialRefreshes,0);assert.equal(h.newsCalls,0);assert.equal(h.marketCalls,0);
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
