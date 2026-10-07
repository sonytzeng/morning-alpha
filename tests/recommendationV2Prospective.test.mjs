import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {evaluateV2Shadow,V2_METHODOLOGY,v2Hash,nextV2Session} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {normalizeActualGrowth,normalizeFugleShares,normalizeTwseShares,normalizeTpexShares,V2_SOURCE_URLS,acquireV2PublicSources} from '../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
import {evaluateV2Outcome,summarizeV2Outcomes} from '../supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts';
import {normalizeV2IndexHistory,acquireV2IndexHistory,V2_INDEX_URL} from '../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';

test('official index history covers a missing local close without backdating or changing V1',async()=>{
 const input=fixture(),before=structuredClone(input.v1),missing=input.data.quotes.shift();
 input.benchmark_history=[{date:missing.trading_date,close:missing.value,available_at:at,source:V2_INDEX_URL+'?date='+missing.trading_date.slice(0,7).replace('-','')+'01&response=json#'+missing.trading_date}];
 assert.equal((await evaluateV2Shadow(input)).counts.BLOCKED,0);assert.deepEqual(input.v1,before);
 for(const mutate of [x=>x.benchmark_history[0].available_at='2026-10-08T00:00:00Z',x=>x.benchmark_history.push(x.benchmark_history[0]),x=>x.benchmark_history[0].source='UNTRUSTED',x=>x.benchmark_history[0].date='2026-10-08']){
  const copy=structuredClone(input);mutate(copy);assert.equal((await evaluateV2Shadow(copy)).counts.BLOCKED,72);
 }
 input.data.quotes.unshift({...missing,value:1});assert.equal((await evaluateV2Shadow(input)).counts.BLOCKED,72);
});
test('official index adapter accepts only observed complete exchange sessions and bounded no-credential reads',async()=>{
 const p={stat:'OK',date:'20261001',fields:['日期','開盤指數','最高指數','最低指數','收盤指數'],data:[['115/10/06','20,000','20,010','19,999','20,000']]};
 assert.equal(normalizeV2IndexHistory(p,'2026-10',at)[0].close,20000);
 for(const q of [{...p,date:'20260901'},{...p,data:[...p.data,...p.data]},{...p,data:[['115/10/07','20,000','20,010','19,999','20,000']]},{...p,fields:['日期','wrong']}])assert.throws(()=>normalizeV2IndexHistory(q,'2026-10',at));
 let calls=0;const result=await acquireV2IndexHistory({businessDate:'2026-10-07',now:()=>at,signal:AbortSignal.timeout(5000),fetcher:async(url,init)=>{calls++;assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');const month=new URL(url).searchParams.get('date');return Response.json(month==='20261001'?p:{...p,date:month,data:[]});}});
 assert.equal(calls,2);assert.equal(result.length,1);
});

const at='2026-10-06T23:30:00.000Z';
function fixture(){
 const data=emptyEvidenceData(),identity={report_date:'2026-10-07',today_date:'2026-10-07',generated_at:at,data_as_of:at,revision_id:'SYNTHETIC_TEST_ONLY',is_trading_day:true};
 const days=[];let d='2026-10-06';for(let i=0;i<20;i++){days.unshift(d);d=previousMarketTradingDate('TW',d);}
 const captures=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,endpoint:'historical/candles',received_at:at,status:'PASS',payload_hash:'a'.repeat(64),rows:days.map((date,i)=>({id:`SYNTHETIC:${symbol}:${date}`,symbol,trading_date:date,captured_at:date+'T13:30:00+08:00',ingested_at:at,raw_payload:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',volume_unit:'SHARES',amount_unit:'TWD',open:100+i,high:101+i,low:99+i,close:100+i,volume_shares:1000000+i*1000,amount_twd:100000000}}))}));
 data.universe=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,is_active:true,sector:'SYNTHETIC_SECTOR'}));
 data.quotes=days.map(date=>({id:'SYNTHETIC:TAIEX:'+date,symbol:'TAIEX',trading_date:date,phase:'close',provider:'fugle',value:20000,change_percent:0,captured_at:date+'T13:30:00+08:00',ingested_at:date+'T13:31:00+08:00'}));
 const sources=[{kind:'shares',source:'SYNTHETIC',status:'PASS',received_at:at,http:200,rows:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,session:'2026-10-06',source:'SYNTHETIC',available_at:at,unit:'SHARES',foreign:{buy:20,sell:10,net:10},trust:{buy:20,sell:10,net:10},dealer:{buy:20,sell:10,net:10}}))},
 {kind:'growth',source:'SYNTHETIC',status:'PASS',received_at:at,http:200,rows:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,period:'2026-08',source:'SYNTHETIC',available_at:at,source_date:'2026-09-10',revenue_yoy:.1,revenue_mom:.1,actual_only:true,consensus:null}))}];
 return {data,identity,captures,sources,events:[],events_complete:true,v1:{report_date:identity.report_date,generated_at:at,phase_evaluation:{candidates:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,status:'BLOCKED',reasons:['CONSENSUS_UNAVAILABLE']}))}}};
}
const growth=()=>({'公司代號':'2330','出表日期':'1150910','資料年月':'11508','營業收入-當月營收':'110','營業收入-上月營收':'100','營業收入-去年當月營收':'100','營業收入-上月比較增減(%)':'10','營業收入-去年同月增減(%)':'10','Email':'NEVER_RETAIN','備註':'NEVER_RETAIN'});
test('actual monthly growth uses actual same-unit ratios, never consensus or raw contact fields',()=>{
 const r=normalizeActualGrowth([growth()],V2_SOURCE_URLS.twseGrowth,at,['2330']);assert.equal(r[0].revenue_yoy,.10000000000000009);assert.equal(r[0].consensus,null);assert.doesNotMatch(JSON.stringify(r),/NEVER_RETAIN/);
 for(const mutate of [r=>r['營業收入-上月比較增減(%)']='100',r=>r['資料年月']='11510',r=>r['出表日期']='1151032',r=>r['出表日期']='1151008']){const r=growth();mutate(r);assert.throws(()=>normalizeActualGrowth([r],V2_SOURCE_URLS.twseGrowth,at,['2330']));}
 const zero=growth();zero['營業收入-上月營收']='0';assert.equal(normalizeActualGrowth([zero],V2_SOURCE_URLS.twseGrowth,at,['2330'])[0].revenue_mom,null);
});
test('Fugle shares use documented trust field and do not infer zero from empty success',()=>{
 const p={symbol:'2330',data:[{date:'2026-10-06',foreign:{buy:10,sell:1,net:9},trust:{buy:3,sell:1,net:2},dealer:{buy:2,sell:1,net:1},total:12}]};
 const url='https://api.fugle.tw/marketdata/v1.0/stock/ownership/institutional-trades/2330';
 assert.equal(normalizeFugleShares(p,url,at,'2330')[0].unit,'SHARES');
 assert.deepEqual(normalizeFugleShares({...p,data:[]},url,at,'2330'),[]);
 p.data[0].total=13;assert.throws(()=>normalizeFugleShares(p,url,at,'2330'),/TOTAL/);
});
test('TWSE dealer sums proprietary + hedging; foreign dealers never counted twice',()=>{
 const fields=['證券代號','外陸資買進股數(不含外資自營商)','外陸資賣出股數(不含外資自營商)','外陸資買賣超股數(不含外資自營商)','投信買進股數','投信賣出股數','投信買賣超股數','自營商買進股數(自行買賣)','自營商買進股數(避險)','自營商賣出股數(自行買賣)','自營商賣出股數(避險)','自營商買賣超股數','三大法人買賣超股數','外資自營商買進股數'];
 const p={stat:'OK',date:'20261006',fields,data:[['2330','100','50','50','20','10','10','8','4','2','1','9','69','999']]};
 const r=normalizeTwseShares(p,at,['2330'])[0];assert.equal(r.dealer.net,9);assert.equal(r.foreign.net,50);
 assert.throws(()=>normalizeTwseShares({...p,date:'20261007'},at,['2330']),/SESSION/);
 assert.throws(()=>normalizeTwseShares({...p,data:[...p.data,...p.data]},at,['2330']),/DUPLICATE/);
});
test('TPEx trims documented leading field space, fails closed on reconciliation conflict',()=>{
 const p={Date:'1151006',SecuritiesCompanyCode:'3081','Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Buy':'10',' Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Sell':'2','Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference':'8','SecuritiesInvestmentTrustCompanies-TotalBuy':'3','SecuritiesInvestmentTrustCompanies-TotalSell':'1','SecuritiesInvestmentTrustCompanies-Difference':'2','Dealers-TotalBuy':'2','Dealers-TotalSell':'1','Dealers-Difference':'1',TotalDifference:'11'};
 assert.equal(normalizeTpexShares([p],at,['3081'])[0].trust.net,2);
 assert.throws(()=>normalizeTpexShares([{...p,TotalDifference:'0'}],at,['3081']),/TOTAL/);
});
test('public source acquisition never passes credentials, rejects redirects/errors without retaining body',async()=>{
 const calls=[];const r=await acquireV2PublicSources({symbols:['2330'],now:()=>at,signal:AbortSignal.timeout(5000),fetcher:async(url,init)=>{calls.push(url);assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');return new Response('SECRET_SHOULD_NOT_SURVIVE',{status:403});}});
 assert.equal(calls.length,4);assert(r.every(c=>c.status==='HTTP_403'));assert.doesNotMatch(JSON.stringify(r),/SECRET_SHOULD/);
});
test('same-input comparison is deterministic and V1 unchanged; complete synthetic evidence can READY only in Shadow',async()=>{
 const input=fixture(),before=structuredClone(input),r=await evaluateV2Shadow(input);
 assert.deepEqual(input,before);assert.equal(r.counts.READY,72);assert.equal(r.counts.BLOCKED,0);assert.equal(r.production_eligible,false);assert.equal(r.promotion_allowed,false);assert.equal(r.forward_sample,0);
 assert(r.candidates.every(c=>c.v1_status==='BLOCKED'&&c.confidence===null));assert.deepEqual(await evaluateV2Shadow(input),r);assert.equal(r.input_sha256,await v2Hash(input));
});
test('missing consensus does not block; missing supporting data WATCH, observed rejection NONE, critical loss BLOCKED',async()=>{
 const missing=fixture();missing.sources=[];assert.equal((await evaluateV2Shadow(missing)).counts.WATCH,72);
 const negative=fixture();negative.sources[1].rows.forEach(r=>r.revenue_yoy=-.1);assert.equal((await evaluateV2Shadow(negative)).counts.NONE,72);
 const lost=fixture();lost.data.quotes=[];assert.equal((await evaluateV2Shadow(lost)).counts.BLOCKED,72);
});
test('events never auto-bullish; unassessed material event prevents READY',async()=>{
 const input=fixture();input.events=[{symbol:'2330',source_ref:'SYNTHETIC',source_hash:'a'.repeat(64),available_at:at,published_at:at,event_fact:true,bullishness:null,impact_review:'REQUIRED'}];
 const r=await evaluateV2Shadow(input),c=r.candidates.find(c=>c.symbol==='2330');assert.equal(c.status,'WATCH');assert(c.pending.includes('MATERIAL_EVENT_IMPACT_UNASSESSED'));
});
test('future captures, holes, duplicates, wrong units and benchmark gaps cannot be full evidence',async()=>{
 for(const mutate of [x=>x.captures[0].received_at='2026-10-08T00:00:00Z',x=>x.captures[0].rows.pop(),x=>x.captures[0].rows.push(x.captures[0].rows[0]),x=>x.captures[0].rows[0].raw_payload.amount_unit='SHARES',x=>x.data.quotes.shift()]){
  const input=fixture();mutate(input);assert((await evaluateV2Shadow(input)).counts.BLOCKED>=1);
 }
 const input=fixture();input.v1.generated_at='2026-10-08T00:00:00Z';await assert.rejects(evaluateV2Shadow(input),/IDENTITY/);
});
const prediction=()=>({id:'SYNTHETIC_LOCK',symbol:'2330',methodology_version:V2_METHODOLOGY,observation_kind:'FORWARD',locked_at:'2026-10-07T01:00:00Z',cutoff:at,input_sha256:'a'.repeat(64),status:'READY',entry:{not_before:'2026-10-08',trigger_price:100,invalidation_price:95}});
function outcomeBars(){let date='2026-10-08';return Array.from({length:20},(_,i)=>{const r={date,open:100,high:104+i*.1,low:99,close:102,volume:1000,amount:100000,source_ref:'SYNTHETIC:'+date,available_at:date+'T14:00:00+08:00'};date=nextV2Session(date);return r;});}
test('all horizons count trading sessions, not calendar days; no outcome before maturity',()=>{
 const p=prediction(),bars=outcomeBars();for(const h of [1,3,5,10,20]){assert.equal(evaluateV2Outcome(p,bars,h,'2026-12-01T00:00:00Z').state,'OBSERVED');}
 assert.equal(evaluateV2Outcome(p,bars,20,'2026-10-08T01:00:00Z').state,'PENDING');
 assert.equal(evaluateV2Outcome({...p,observation_kind:'HISTORICAL_REPLAY'},bars,1,'2026-12-01T00:00:00Z').state,'UNAVAILABLE');
 assert.equal(evaluateV2Outcome({...p,locked_at:'2026-10-08T03:00:00Z'},bars,1,'2026-12-01T00:00:00Z').state,'UNAVAILABLE');
});
test('duplicate/missing bars reject; no entry is not a win; same-bar stop conservative',()=>{
 const p=prediction(),bars=outcomeBars(),now='2026-12-01T00:00:00Z';
 assert.equal(evaluateV2Outcome(p,bars.slice(1),1,now).state,'UNAVAILABLE');assert.equal(evaluateV2Outcome(p,[...bars,bars[0]],1,now).state,'UNAVAILABLE');
 const no=structuredClone(bars);no[0].high=100;no[0].close=100;assert.equal(evaluateV2Outcome(p,no,1,now).state,'NOT_ENTERED');
 const stop=structuredClone(bars);stop[0].low=94;const r=evaluateV2Outcome(p,stop,1,now);assert.equal(r.win_loss,'LOSS');assert(Math.abs(r.return+.05)<1e-10);
});
test('samples are distinct forward dates, no infinite profit factor, twenty dates never promotes',()=>{
 const r=evaluateV2Outcome(prediction(),outcomeBars(),1,'2026-12-01T00:00:00Z'),s=summarizeV2Outcomes([r],['2026-10-07','2026-10-07']);
 assert.equal(s.forward_sample,1);assert.equal(s.horizons[0].profit_factor,null);assert.equal(s.promotion_allowed,false);
 assert.throws(()=>summarizeV2Outcomes([r,r],[]),/DUPLICATE/);
 assert.equal(summarizeV2Outcomes([],Array.from({length:20},(_,i)=>'2026-10-'+String(i+1).padStart(2,'0'))).promotion_allowed,false);
});
