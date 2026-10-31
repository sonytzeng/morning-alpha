import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {twseDailyUrl} from '../research/entry-official-history.ts';

test('real intake route refreshes prices/news/global markets in parallel, freezes truthful gaps, and resumes without reacquiring',async()=>{
 const NativeDate=globalThis.Date,oldFetch=globalThis.fetch,oldDeno=globalThis.Deno;
 const now='2026-10-31T03:00:01Z',cutoff='2026-10-31T03:00:01.000000Z',old='2026-10-29T12:00:00Z';
 const intakeId='11111111-1111-4111-8111-111111111111',lease='22222222-2222-4222-8222-222222222222',sourceId='33333333-3333-4333-8333-333333333333';
 const internal='test-only-source-worker-secret-0123456789',providerKey='test-only-provider-key';
 const baseGaps=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','FINANCIAL_DATA_RETAINED_NOT_REFRESHED',
  'INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY'];
 const newsGaps=['NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS',
  'NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE','NEWS_NONE_AVAILABLE_WITHIN_48H'];
 const inputs=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司'+i,cutoff:old,through:'2026-10-29',next_session:'2026-10-30',
  v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},expected_sessions:['2026-10-29'],facts:[],bars:[{
   id:'retained-bar-'+i,source:'https://www.twse.com.tw/',published_at:null,first_seen_at:old,available_at:old,as_of:'2026-10-29T09:00:00Z',
   evidence_hash:'a'.repeat(64),date:'2026-10-29',open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TWSE_OFFICIAL_DAY_INCLUDING_BLOCK',
  }]}));
 const acquired={schema:'DAILY_AI_INTAKE_SOURCE_V1',state:'ACQUIRED',intake_id:intakeId,lease,business_date:'2026-10-31',requested_at:'2026-10-31T02:00:00Z',
  projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1',inputs,companies:inputs.map(i=>({symbol:i.symbol,company:i.company,exchange:'TWSE'})),
  source_kind:'VNEXT_ACQUIRED',source_id:sourceId,source_revision:'c'.repeat(64),source_cutoff:old,source_business_date:'2026-10-29',source_issues:[],
  intake_gaps:baseGaps,news:[],market:[],member_published:false};
 let current=structuredClone(acquired),snapshot,batchId,worker,newsCalls=0,priceCalls=0,marketCalls=0,modelCalls=0,dispatches=0,sourceCalls=0,storeCalls=0,claimFailure=false;
 let releaseSources;const sourcesMaySettle=new Promise(resolve=>{releaseSources=resolve;});
 const sourceGateTimeout=setTimeout(()=>releaseSources(),3000);
 const releaseWhenParallel=()=>{if(newsCalls&&marketCalls)releaseSources();};
 const calls=[],publicUrls=new Set(),marketUrls=new Set();
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
   if(parsed.hostname==='www.twse.com.tw'){
    priceCalls++;publicUrls.add(value);calls.push('PRICE_BEGIN');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert(init.signal instanceof AbortSignal);
    const digits=parsed.searchParams.get('date');assert.match(digits,/^\d{8}$/);
    assert.equal(value,twseDailyUrl(digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6)));
    await sourcesMaySettle;calls.push('PRICE_END');return new Response('private exchange outage details',{status:503});
   }
   if(parsed.hostname==='query1.finance.yahoo.com'||parsed.hostname==='openapi.taifex.com.tw'){
    marketCalls++;marketUrls.add(value);calls.push('MARKET_BEGIN');assert(calls.includes('PRICE_BEGIN'));
    if(marketCalls===1)assert(!calls.includes('PRICE_END'),'global markets must start before prices finish');assert(init.signal instanceof AbortSignal);releaseWhenParallel();
    await sourcesMaySettle;calls.push('MARKET_END');
    if(parsed.hostname==='query1.finance.yahoo.com'){
     assert.equal(init.method,'GET');assert.equal(parsed.search,'?interval=1d&range=1mo');
     const symbol=decodeURIComponent(parsed.pathname.split('/').at(-1));assert(['^IXIC','^SOX','^GSPC'].includes(symbol));
     return Response.json({chart:{error:null,result:[{meta:{symbol,instrumentType:'INDEX',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d',regularMarketTime:1793394959},
      timestamp:[1793280600,1793367000],indicators:{quote:[{close:symbol==='^IXIC'?[26184.720703125,25436.998046875]:symbol==='^SOX'?[6000,5900]:[7000,6900]}]}}]}});
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
    assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(marketCalls,4);assert.equal(calls.filter(x=>x==='PRICE_END').length,4);assert.equal(calls.filter(x=>x==='MARKET_END').length,4);assert(calls.includes('NEWS_END'));
    assert.equal(args.p_inputs.length,72);assert.equal(new Set(args.p_inputs.map(i=>i.symbol)).size,72);
    for(const stock of args.p_inputs){
     assert.equal(stock.through,'2026-10-30');assert.equal(stock.expected_sessions.length,20);assert.equal(stock.expected_sessions.at(-1),'2026-10-30');
     assert.equal(stock.cutoff,'2026-10-31T03:00:01.000Z');assert.equal(stock.bars.length,1);assert.equal(stock.bars[0].date,'2026-10-29');
     assert.equal(stock.bars[0].available_at,old);assert.equal(stock.bars[0].published_at,null);
     assert(args.p_symbol_gaps[stock.symbol].includes('PRICE_PUBLIC_SOURCE_REFRESH_UNAVAILABLE'));
     assert(args.p_symbol_gaps[stock.symbol].includes('PRICE_20_SESSION_COVERAGE_MISSING'));
    }
    assert(args.p_gaps.includes('FINANCIAL_DATA_RETAINED_NOT_REFRESHED'));assert(args.p_gaps.includes('INSTITUTIONAL_DATA_RETAINED_NOT_REFRESHED'));
    assert(args.p_gaps.includes('NEWS_REFRESH_UNAVAILABLE'));assert(args.p_gaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
    assert(!args.p_gaps.includes('US_MARKET_CONTEXT_UNAVAILABLE'));assert.equal(args.p_market.length,3);
    for(const e of args.p_market){assert.equal(e.kind,'MARKET');assert.equal(e.symbol,null);assert.equal(new URL(e.source).hostname,'query1.finance.yahoo.com');}
    current={...current,state:'SOURCED',cutoff,snapshot_hash:'d'.repeat(64),inputs:args.p_inputs.map(i=>({...i,cutoff})),
     intake_gaps:[...new Set([...baseGaps,...newsGaps.filter(g=>g!=='MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'),...args.p_gaps])],gaps_by_symbol:args.p_symbol_gaps,market:args.p_market};
    snapshot=structuredClone(current);return Response.json(current);
   }
   if(op==='store_daily_stock_ai_batch_v1'){
    storeCalls++;const body=JSON.parse(args.p_text);assert.equal(args.p_hash,await snapshotHash(body));batchId=args.p_hash;
    assert.equal(body.through,'2026-10-30');assert.equal(body.cutoff,cutoff);assert.equal(Object.keys(body.packet_texts).length,72);
    assert.equal(body.source_intake.intake_id,intakeId);assert.equal(body.source_intake.source_kind,'VNEXT_ACQUIRED');assert.equal(body.source_intake.source_id,sourceId);
    assert.equal(body.source_intake.source_cutoff,old);assert.equal(body.source_intake.source_business_date,'2026-10-29');assert.equal(body.source_intake.snapshot_hash,'d'.repeat(64));
    for(const [symbol,text] of Object.entries(body.packet_texts)){
     const packet=JSON.parse(text);assert.equal(body.packet_hashes[symbol],await snapshotHash(packet));assert.equal(packet.cutoff,cutoff);assert.equal(packet.data_through,'2026-10-30');
     for(const gap of ['PRICE_PUBLIC_SOURCE_REFRESH_UNAVAILABLE','PRICE_20_SESSION_COVERAGE_MISSING','NEWS_REFRESH_UNAVAILABLE','TAIWAN_NIGHT_SESSION_UNVERIFIED',...newsGaps.filter(g=>g!=='MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE')])assert(packet.data_gaps.includes(gap),gap);
     assert.equal(packet.evidence.length,4);assert.equal(packet.evidence[0].available_at,old);assert.equal(JSON.parse(packet.evidence[0].content).date,'2026-10-29');
     const byId=(a,b)=>a.id.localeCompare(b.id);
     assert.deepEqual(packet.evidence.filter(e=>e.kind==='MARKET').sort(byId),current.market.slice().sort(byId));
    }
    return Response.json({state:'STORED',batch_id:batchId,packets:72,member_published:false});
   }
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
  assert.equal(modelCalls,0);assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(marketCalls,4);assert.equal(publicUrls.size,4);assert.equal(marketUrls.size,4);assert.equal(dispatches,1);assert.equal(sourceCalls,1);assert.equal(storeCalls,1);
  assert(calls.indexOf('SOURCE')>calls.lastIndexOf('PRICE_END'));assert(calls.indexOf('COMPLETE')>calls.indexOf('store_daily_stock_ai_batch_v1'));
  assert.equal(calls.at(-1),'dispatch_daily_stock_ai_batch_v1');assert(!JSON.stringify(body).includes('private'));assert(!JSON.stringify(body).includes(internal));assert(!JSON.stringify(body).includes(providerKey));
  const originalBatch=batchId;calls.length=0;current=structuredClone(snapshot);
  response=await invoke();body=await response.json();assert.equal(response.status,202);assert.equal(body.batch_id,originalBatch);assert.equal(body.analysis_dispatched,true);
  assert.deepEqual(calls,['CLAIM','store_daily_stock_ai_batch_v1','COMPLETE','dispatch_daily_stock_ai_batch_v1']);assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(marketCalls,4);assert.equal(sourceCalls,1);assert.equal(dispatches,2);
  calls.length=0;response=await invoke();body=await response.json();assert.equal(response.status,202);assert.equal(body.batch_id,originalBatch);
  assert.deepEqual(calls,['CLAIM','dispatch_daily_stock_ai_batch_v1']);assert.equal(newsCalls,1);assert.equal(priceCalls,4);assert.equal(marketCalls,4);assert.equal(sourceCalls,1);assert.equal(storeCalls,2);assert.equal(dispatches,3);assert.equal(modelCalls,0);
  calls.length=0;claimFailure=true;response=await invoke();body=await response.json();assert.equal(response.status,409);assert.equal(body.error,'STOCK_SOURCE_REJECTED');
  assert.equal(body.model_calls,0);assert.equal(body.member_published,false);assert.deepEqual(calls,['CLAIM']);assert(!JSON.stringify(body).includes('private'));assert(!JSON.stringify(body).includes(internal));
 }finally{clearTimeout(sourceGateTimeout);releaseSources();globalThis.Date=NativeDate;globalThis.fetch=oldFetch;if(oldDeno===undefined)delete globalThis.Deno;else globalThis.Deno=oldDeno;}
});
