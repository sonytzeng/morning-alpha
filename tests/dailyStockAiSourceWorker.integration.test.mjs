import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {twseDailyUrl} from '../research/entry-official-history.ts';

test('real intake route refreshes prices/financials/news/markets in parallel, freezes truthful gaps, and resumes without reacquiring',async()=>{
 const NativeDate=globalThis.Date,oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;
 const now='2026-10-31T03:00:01Z',cutoff='2026-10-31T03:00:01.000000Z',old='2026-10-29T12:00:00Z';
 const intakeId='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222',sourceId='33333333-3333-4333-8333-333333333333';
 const internal='test-only-source-worker-secret-0123456789',providerKey='test-only-provider-key';
 const treasuryUrl='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=202610';
 const nightReportUrl='https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&queryDate=2026%2F11%2F02&commodity_id=TX';
 const equityGap='US_EQUITY_CLOSE_NOT_COLLECTED_US_NEWS_CONTEXT_ONLY';
 const financialUrls=new Set(['https://openapi.twse.com.tw/v1/opendata/t187ap14_L','https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O']);
 const restrictedDomains=['tsmc.com','mediatek.com','honhai.com'];
 const treasuryXml=`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"><title type="text">DailyTreasuryYieldCurveRateData</title>${[
  ['2026-10-29','4.61','4.98','5.32'],['2026-10-30','4.56','4.94','5.31'],
 ].map(([date,two,ten,thirty])=>`<entry><content type="application/xml"><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">${two}</d:BC_2YEAR><d:BC_10YEAR m:type="Edm.Double">${ten}</d:BC_10YEAR><d:BC_30YEAR m:type="Edm.Double">${thirty}</d:BC_30YEAR></m:properties></content></entry>`).join('')}</feed>`;
 const baseGaps=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','FINANCIAL_DATA_RETAINED_NOT_REFRESHED',
  'INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY'];
 const newsGaps=['NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS',
  'NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE','NEWS_NONE_AVAILABLE_WITHIN_48H'];
 const inputs=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司'+i,cutoff:old,through:'2026-10-29',next_session:'2026-10-30',
  v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},expected_sessions:['2026-10-29'],facts:[],bars:[{
   id:'retained-bar-'+i,source:'https://www.twse.com.tw/',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-10-29T09:00:00Z',
   evidence_hash:'a'.repeat(64),date:'2026-10-29',open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TWSE_OFFICIAL_DAY_INCLUDING_BLOCK',
  }]}));
 for(let i=0;i<3;i++)inputs[i].facts.push({id:'restricted-issuer-'+i,kind:'EPS',period:'2026-Q2',basis:'SINGLE_QUARTER',values:{eps:8},
  source:'https://investor.'+restrictedDomains[i]+'/financial-report',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-06-30T15:59:59Z',evidence_hash:'e'.repeat(64)});
 const retainedOfficialFact={id:'retained-official-revenue',kind:'REVENUE',period:'2026-09',basis:'MONTHLY',values:{yoy_percent:10},
  source:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-09-30T15:59:59Z',evidence_hash:'f'.repeat(64)};
 inputs[3].facts.push(retainedOfficialFact);
 const acquired={schema:'DAILY_AI_INTAKE_SOURCE_V1',state:'ACQUIRED',intake_id:intakeId,lease,business_date:'2026-10-31',requested_at:'2026-10-31T02:00:00Z',
  projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1',inputs,companies:inputs.map(i=>({symbol:i.symbol,company:i.company,exchange:'TWSE'})),
  source_kind:'VNEXT_ACQUIRED',source_id:sourceId,source_revision:'c'.repeat(64),source_cutoff:old,source_business_date:'2026-10-29',source_issues:[],
  intake_gaps:baseGaps,news:[],market:[],member_published:false};
 let current=structuredClone(acquired),snapshot,batchId,batch,worker,newsCalls=0,priceCalls=0,financialCalls=0,marketCalls=0,nightFallbackCalls=0,yahooCalls=0,restrictedCalls=0,modelCalls=0,dispatches=0,sourceCalls=0,storeCalls=0,claimFailure=false;
 let releaseSources;const sourcesMaySettle=new Promise(resolve=>{releaseSources=resolve;});
 const sourceGateTimeout=setTimeout(()=>releaseSources(),3000);
 const releaseWhenParallel=()=>{if(newsCalls&&marketCalls&&financialCalls)releaseSources();};
 const calls=[],publicUrls=new Set(),marketUrls=new Set(),requestedFinancialUrls=new Set();
 try{
  globalThis.Date=class extends NativeDate{
   constructor(...args){super(...(args.length?args:[now]));}
   static now(){return NativeDate.parse(now);}
  };
  globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-service-role',CRON_SECRET:internal,OPENAI_API_KEY:providerKey})[name]},
   serve:handler=>{worker=handler;}};
  globalThis.fetch=async(url,init)=>{
   const value=String(url),parsed=new URL(value),name=parsed.pathname.split('/').at(-1);
   if(parsed.hostname==='api.openai.com'){modelCalls++;assert.fail('source preparation must never invoke a model');}
   if(parsed.hostname.endsWith('yahoo.com')){yahooCalls++;return new Response('disallowed market source',{status:503});}
   if(restrictedDomains.some(domain=>parsed.hostname===domain||parsed.hostname.endsWith('.'+domain))){restrictedCalls++;return new Response('disallowed issuer source',{status:503});}
   if(financialUrls.has(value)){
    financialCalls++;requestedFinancialUrls.add(value);calls.push('FINANCIAL_BEGIN');assert.equal(init.method,'GET');assert(init.signal instanceof AbortSignal);
    if(financialCalls===1)assert(!calls.includes('PRICE_END'),'financial refresh must overlap the price port');releaseWhenParallel();
    await sourcesMaySettle;calls.push('FINANCIAL_END');return new Response('private official financial endpoint outage',{status:503});
   }
   if(parsed.hostname==='www.twse.com.tw'){
    priceCalls++;publicUrls.add(value);calls.push('PRICE_BEGIN');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert(init.signal instanceof AbortSignal);
    const digits=parsed.searchParams.get('date');assert.match(digits,/^\d{8}$/);
    assert.equal(value,twseDailyUrl(digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6)));
    await sourcesMaySettle;calls.push('PRICE_END');return new Response('private exchange outage details',{status:503});
   }
   if(parsed.hostname==='home.treasury.gov'||parsed.hostname==='openapi.taifex.com.tw'||parsed.hostname==='www.taifex.com.tw'){
    marketCalls++;marketUrls.add(value);calls.push('MARKET_BEGIN');assert(calls.includes('PRICE_BEGIN'));
    if(marketCalls===1)assert(!calls.includes('PRICE_END'),'global markets must start before prices finish');assert(init.signal instanceof AbortSignal);releaseWhenParallel();
    await sourcesMaySettle;calls.push('MARKET_END');
    assert.equal(init.method,'GET');
    if(parsed.hostname==='home.treasury.gov'){
     assert.equal(value,treasuryUrl);return new Response(treasuryXml,{headers:{'Content-Type':'application/xml'}});
    }
    if(parsed.hostname==='www.taifex.com.tw'){
     nightFallbackCalls++;assert.equal(value,nightReportUrl);return new Response('private official night report outage',{status:503});
    }
    assert.equal(value,'https://openapi.taifex.com.tw/v1/DailyMarketReportFut');
    return Response.json([{Date:'20261030',Contract:'TX','ContractMonth(Week)':'202611',Last:'45926',Change:'-643','%':'-1.38%',TradingSession:'盤後'}]);
   }
   assert.equal(parsed.hostname,'database.example.invalid');
   if(name==='fetch-global-market-news'){
    newsCalls++;calls.push('NEWS_BEGIN');assert(calls.includes('PRICE_BEGIN'),'news collection must overlap price acquisition');
    assert(!calls.includes('PRICE_END'),'the source ports must start in parallel');
    assert.equal(init.method,'POST');assert.equal(init.body,'{}');assert.equal(init.headers['x-cron-secret'],internal);assert(init.signal instanceof AbortSignal);
    releaseWhenParallel();await sourcesMaySettle;calls.push('NEWS_END');return new Response('private collector provider body',{status:503});
   }
   assert(init.signal instanceof AbortSignal,'RPC requests keep their bounded cancellation');
   const args=JSON.parse(init.body),op=name==='daily_stock_ai_intake_v1'?args.p_op:name;calls.push(op);
   if(op==='CLAIM'){
    assert.equal(args.p_intake_id,intakeId);
    if(claimFailure)return Response.json({message:'private database body '+internal},{status:503});
    return Response.json(current);
   }
   if(op==='SOURCE'){
    sourceCalls++;assert.equal(args.p_intake_id,intakeId);assert.equal(args.p_lease,lease);
    assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(financialCalls,3);assert.equal(marketCalls,3);assert.equal(nightFallbackCalls,1);assert.equal(yahooCalls,0);assert.equal(restrictedCalls,0);
    assert.equal(calls.filter(x=>x==='PRICE_END').length,4);assert.equal(calls.filter(x=>x==='FINANCIAL_END').length,3);assert.equal(calls.filter(x=>x==='MARKET_END').length,3);assert(calls.includes('NEWS_END'));
    assert.equal(args.p_inputs.length,72);assert.equal(new Set(args.p_inputs.map(i=>i.symbol)).size,72);
    for(const stock of args.p_inputs){
     assert.equal(stock.through,'2026-10-30');assert.equal(stock.expected_sessions.length,20);assert.equal(stock.expected_sessions.at(-1),'2026-10-30');
     assert.equal(stock.cutoff,'2026-10-31T03:00:01.000Z');assert.equal(stock.bars.length,1);assert.equal(stock.bars[0].date,'2026-10-29');
     assert.equal(stock.bars[0].available_at,old);assert.equal(stock.bars[0].published_at,null);
     assert(args.p_symbol_gaps[stock.symbol].includes('PRICE_PUBLIC_SOURCE_REFRESH_UNAVAILABLE'));
     assert(args.p_symbol_gaps[stock.symbol].includes('PRICE_20_SESSION_COVERAGE_MISSING'));
     if(stock.symbol==='1003')assert.deepEqual(stock.facts,[retainedOfficialFact]);else assert.deepEqual(stock.facts,[]);
    }
    const financialProof=args.p_financial_refresh;assert.equal(financialProof.schema,'DAILY_AI_FINANCIAL_REFRESH_V1');
    assert.deepEqual(Object.keys(financialProof).sort(),['schema','observed_at','responses','additions','removals'].sort());
    assert.equal(financialProof.observed_at,'2026-10-31T03:00:01.000Z');assert.equal(financialProof.responses.length,3);assert.equal(financialProof.additions.length,0);assert.equal(financialProof.removals.length,3);
    assert(args.p_gaps.includes('FINANCIAL_DATA_RETAINED_NOT_REFRESHED'));assert(args.p_gaps.includes('INSTITUTIONAL_DATA_RETAINED_NOT_REFRESHED'));
    assert(args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));assert(args.p_gaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));assert(args.p_gaps.includes(equityGap));
    assert(!args.p_gaps.includes('US_TREASURY_YIELD_CURVE_UNAVAILABLE'));assert.equal(args.p_market.length,1);
    for(const e of args.p_market){
     assert.equal(e.kind,'MARKET');assert.equal(e.symbol,null);assert.equal(e.source,treasuryUrl);
     const c=JSON.parse(e.content);assert.equal(c.kind,'US_TREASURY_PAR_YIELD_CURVE');assert.equal(c.unit,'PERCENT');assert.equal(c.session_date,'2026-10-30');
     assert.deepEqual([c.yield_2y,c.yield_10y,c.yield_30y],[4.56,4.94,5.31]);assert.deepEqual([c.change_2y_bp,c.change_10y_bp,c.change_30y_bp],[-5,-4,-1]);
    }
    current={...current,state:'SOURCED',cutoff,snapshot_hash:'d'.repeat(64),inputs:args.p_inputs.map(i=>({...i,cutoff})),
     intake_gaps:[...new Set([...baseGaps,...newsGaps.filter(g=>g!=='MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'),...args.p_gaps])],gaps_by_symbol:args.p_symbol_gaps,market:args.p_market,financial_refresh:financialProof};
    snapshot=structuredClone(current);return Response.json(current);
   }
   if(op==='store_daily_stock_ai_batch_v1'){
    storeCalls++;const body=JSON.parse(args.p_text);assert.equal(args.p_hash,await snapshotHash(body));batchId=args.p_hash;
    assert.equal(body.through,'2026-10-30');assert.equal(body.cutoff,cutoff);assert.equal(Object.keys(body.packet_texts).length,72);
    assert.equal(body.source_intake.intake_id,intakeId);assert.equal(body.source_intake.source_kind,'VNEXT_ACQUIRED');assert.equal(body.source_intake.source_id,sourceId);
    assert.equal(body.source_intake.source_cutoff,old);assert.equal(body.source_intake.source_business_date,'2026-10-29');assert.equal(body.source_intake.snapshot_hash,'d'.repeat(64));
    for(const [symbol,text] of Object.entries(body.packet_texts)){
     const packet=JSON.parse(text);assert.equal(body.packet_hashes[symbol],await snapshotHash(packet));assert.equal(packet.cutoff,cutoff);assert.equal(packet.data_through,'2026-10-30');
     for(const gap of ['PRICE_PUBLIC_SOURCE_REFRESH_UNAVAILABLE','PRICE_20_SESSION_COVERAGE_MISSING','NEWS_REFRESH_UNAVAILABLE','TAIWAN_NIGHT_SESSION_UNVERIFIED',equityGap,...newsGaps.filter(g=>g!=='MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE')])assert(packet.data_gaps.includes(gap),gap);
     assert.equal(packet.evidence.length,symbol==='1003'?3:2);assert.equal(packet.evidence[0].available_at,old);assert.equal(JSON.parse(packet.evidence[0].content).date,'2026-10-29');
     if(symbol==='1003'){const financial=packet.evidence.find(e=>e.kind==='FINANCIAL');assert.equal(financial.source,retainedOfficialFact.source);assert.equal(financial.available_at,old);assert.equal(JSON.parse(financial.content).basis,'MONTHLY');}
     for(const domain of restrictedDomains)assert(!text.includes(domain));
     const byId=(a,b)=>a.id.localeCompare(b.id);
     assert.deepEqual(packet.evidence.filter(e=>e.kind==='MARKET').sort(byId),current.market.slice().sort(byId));
    }
    batch={id:batchId,cutoff,packets:Object.values(body.packet_texts).map(text=>JSON.parse(text))};
    return Response.json({state:'STORED',batch_id:batchId,packets:72,member_published:false});
   }
   if(op==='load_daily_stock_ai_batch_v1'){assert.equal(args.p_batch_id,batchId);assert(batch);return Response.json(batch);}
   if(op==='COMPLETE'){
    assert.equal(args.p_intake_id,intakeId);assert.equal(args.p_lease,lease);assert.equal(args.p_batch_id,batchId);
    current={state:'CACHED',intake_id:intakeId,batch_id:batchId,member_published:false};return Response.json({...current,state:'COMPLETE'});
   }
   if(op==='dispatch_daily_stock_ai_batch_v1'){
    dispatches++;assert.equal(args.p_batch_id,batchId);return Response.json({state:'DISPATCHED',batch_id:batchId,member_published:false});
   }
   assert.fail('unexpected database, publication or model operation: '+op);
  };
  await import('../supabase/functions/daily-stock-analysis-v1/index.ts');assert.equal(typeof worker,'function');
  const invoke=()=>worker(new Request('https://worker.example.invalid',{method:'POST',headers:{'x-vnext-internal':internal},body:JSON.stringify({intake_id:intakeId})}));
  let response=await invoke(),body=await response.json();
  assert.equal(response.status,202);assert.deepEqual(body,{state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:batchId,analysis_dispatched:true,model_calls:0,member_published:false});
  assert.equal(modelCalls,0);assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(financialCalls,3);assert.equal(marketCalls,3);assert.equal(nightFallbackCalls,1);assert.equal(yahooCalls,0);assert.equal(restrictedCalls,0);
  assert.equal(publicUrls.size,4);assert.equal(requestedFinancialUrls.size,3);assert.equal(marketUrls.size,3);assert.equal(dispatches,1);assert.equal(sourceCalls,1);assert.equal(storeCalls,1);
  assert(calls.indexOf('SOURCE')>calls.lastIndexOf('PRICE_END'));assert(calls.indexOf('COMPLETE')>calls.indexOf('store_daily_stock_ai_batch_v1'));
  assert.equal(calls.at(-1),'dispatch_daily_stock_ai_batch_v1');assert(!JSON.stringify(body).includes('private'));assert(!JSON.stringify(body).includes(internal));assert(!JSON.stringify(body).includes(providerKey));
  const originalBatch=batchId;calls.length=0;current=structuredClone(snapshot);
  response=await invoke();body=await response.json();assert.equal(response.status,202);assert.equal(body.batch_id,originalBatch);assert.equal(body.analysis_dispatched,true);
  assert.deepEqual(calls.filter(op=>op!=='load_daily_stock_ai_batch_v1'),['CLAIM','store_daily_stock_ai_batch_v1','COMPLETE','dispatch_daily_stock_ai_batch_v1']);assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(financialCalls,3);assert.equal(marketCalls,3);assert.equal(nightFallbackCalls,1);assert.equal(yahooCalls,0);assert.equal(restrictedCalls,0);assert.equal(sourceCalls,1);assert.equal(dispatches,2);
  calls.length=0;response=await invoke();body=await response.json();assert.equal(response.status,202);assert.equal(body.batch_id,originalBatch);
  assert.deepEqual(calls.filter(op=>op!=='load_daily_stock_ai_batch_v1'),['CLAIM','dispatch_daily_stock_ai_batch_v1']);assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(financialCalls,3);assert.equal(marketCalls,3);assert.equal(nightFallbackCalls,1);assert.equal(yahooCalls,0);assert.equal(restrictedCalls,0);assert.equal(sourceCalls,1);assert.equal(storeCalls,2);assert.equal(dispatches,3);assert.equal(modelCalls,0);
  calls.length=0;claimFailure=true;response=await invoke();body=await response.json();assert.equal(response.status,409);assert.equal(body.error,'STOCK_SOURCE_REJECTED');
  assert.equal(body.model_calls,0);assert.equal(body.member_published,false);assert.deepEqual(calls,['CLAIM']);assert(!JSON.stringify(body).includes('private'));assert(!JSON.stringify(body).includes(internal));
 }finally{clearTimeout(sourceGateTimeout);releaseSources();globalThis.Date=NativeDate;globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
