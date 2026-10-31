import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectDailyAiGlobalMarket,dailyAiExpectedTaiwanNight,dailyAiTaiwanNightReportUrl,DAILY_AI_GLOBAL_MARKET_URLS} from '../research/daily-ai-global-market.ts';
const clock=()=> '2026-10-31T03:50:00Z',signal=()=>new AbortController().signal;
const sha=s=>createHash('sha256').update(s).digest('hex');
const bar=d=>Date.parse(d+'T09:30:00-04:00')/1000;
function us(symbol){return {chart:{error:null,result:[{meta:{symbol:'^'+symbol,instrumentType:'INDEX',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d',regularMarketTime:Date.parse('2026-10-30T16:15:00-04:00')/1000,chartPreviousClose:99999},timestamp:[bar('2026-10-29'),bar('2026-10-30')],indicators:{quote:[{close:[100,97]}]}}]}};}
const night=(date='20261102')=>[{Date:date,Contract:'TX','ContractMonth(Week)':'202611',Last:'44433',Change:'-867','%':'-1.91%',TradingSession:'盤後'}];
const options=(fetcher,extra={})=>({fetcher,clock,signal:signal(),businessDate:'2026-10-31',...extra});
const fixtureFetcher=(change=()=>{})=>async(url,init)=>{
 assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert(!new Headers(init.headers).has('Authorization'));
 const instrument=Object.keys(DAILY_AI_GLOBAL_MARKET_URLS).find(k=>DAILY_AI_GLOBAL_MARKET_URLS[k]===url);assert(instrument,'fixed URL only');
 const body=instrument==='TX'?night():us(instrument);change(body,instrument);return Response.json(body);
};
test('four fixed public sources produce three native US indices and correctly attributed Friday night',async()=>{
 const r=await collectDailyAiGlobalMarket(options(fixtureFetcher()));assert.equal(r.market.length,4);assert.deepEqual(r.additionalGaps,[]);assert.equal(r.receipts.length,4);
 for(const e of r.market){assert.equal(e.symbol,null);assert.equal(e.kind,'MARKET');assert.equal(e.published_at,null);assert.equal(e.time_basis,'OBSERVED_AFTER_RECEIPT');
  assert.equal(e.available_at,clock());assert.equal(e.first_seen_at,clock());assert.equal(e.as_of,clock());assert.equal(e.evidence_hash,sha(e.content));
  const v=JSON.parse(e.content);assert.equal(v.schema,'DAILY_AI_GLOBAL_MARKET_FACT_V1');assert.equal(v.timestamp_basis,'RECEIPT_ONLY_PUBLICATION_UNKNOWN');assert.equal(v.source_response_sha256,r.receipts.find(x=>x.source===e.source).hash);assert(v.source_response_bytes>0);}
 const usFact=JSON.parse(r.market[0].content);assert.equal(usFact.close,97);assert.equal(usFact.prior_close,100);assert.equal(usFact.change_percent,-3);assert.equal(usFact.comparison_basis,'PREVIOUS_COMPLETED_US_CASH_SESSION_CLOSE');assert.equal(usFact.session_date,'2026-10-30');assert.equal(usFact.unit,'INDEX_POINTS');
 const tx=JSON.parse(r.market[3].content);assert.equal(tx.native_contract,'TX202611');assert.equal(tx.session_date,'2026-10-30');assert.equal(tx.session_ended_on,'2026-10-31');assert.equal(tx.trading_date,'2026-11-02');assert.equal(tx.research_business_date,'2026-10-31');assert.equal(tx.change_reference_value,45300);assert.equal(tx.comparison_basis,'TAIFEX_REPORTED_OPENING_REFERENCE');
});
test('old official API attribution is not relabelled as the latest physical night',async()=>{
 const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((body,k)=>{if(k==='TX')body[0].Date='20261030';})));
 assert.equal(r.market.length,3);assert(r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));const receipt=r.receipts.find(x=>x.instrument==='TX');assert.equal(receipt.state,'UNAVAILABLE');assert(receipt.hash);assert(receipt.received_at);
});
test('index proxy, wrong currency, stale session and future provider timestamps fail without contaminating other sources',async()=>{
 for(const change of [v=>v.meta.symbol='QQQ',v=>v.meta.currency='TWD',v=>v.timestamp=[bar('2026-10-28'),bar('2026-10-29')],v=>v.meta.regularMarketTime=Date.parse('2026-11-02T00:00:00Z')/1000]){
  const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((body,k)=>{if(k==='SOX')change(body.chart.result[0]);})));
  assert.equal(r.market.length,3);assert(r.additionalGaps.includes('US_CLOSE_SOX_UNAVAILABLE'));assert(!r.additionalGaps.includes('US_COMPLETED_CASH_SESSION_PARTIAL'));
 }
});
test('in-progress US daily bar is ignored until the verified cash session has completed',async()=>{
 const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((body,k)=>{if(k!=='TX'){const p=body.chart.result[0];p.meta.regularMarketTime=Date.parse('2026-11-02T15:59:00Z')/1000;p.timestamp.push(Date.parse('2026-11-02T14:30:00Z')/1000);p.indicators.quote[0].close.push(33333);}}),{clock:()=> '2026-11-02T16:00:00Z',businessDate:'2026-11-03'}));
 assert.equal(r.market.length,4);for(const e of r.market.filter(e=>JSON.parse(e.content).market==='US')){assert.equal(JSON.parse(e.content).close,97);assert.equal(JSON.parse(e.content).session_date,'2026-10-30');}
});
test('night identity excludes day session, spreads, duplicates, impossible months and inconsistent change basis',async()=>{
 for(const change of [b=>b[0].TradingSession='一般',b=>b[0]['ContractMonth(Week)']='202611/202612',b=>b.push({...b[0]}),b=>b[0]['ContractMonth(Week)']='202613',b=>b[0]['%']='10%']){
  const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((b,k)=>{if(k==='TX')change(b);})));
  assert(!r.market.some(e=>JSON.parse(e.content).market==='TW'));assert(r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
 }
});
test('all unavailable endpoints produce explicit per-index and night gaps with no invented observations',async()=>{
 const r=await collectDailyAiGlobalMarket(options(async()=>new Response('not authorized',{status:403})));
 assert.deepEqual(r.market,[]);assert.equal(r.receipts.filter(x=>x.state==='UNAVAILABLE').length,5);
 assert.deepEqual(r.additionalGaps,['US_CLOSE_IXIC_UNAVAILABLE','US_CLOSE_SOX_UNAVAILABLE','US_CLOSE_GSPC_UNAVAILABLE','US_COMPLETED_CASH_SESSION_PARTIAL','TAIWAN_NIGHT_SESSION_UNVERIFIED']);
 assert(!JSON.stringify(r).includes('not authorized'));
});
test('body size, actual clock regression and cancelled input are bounded before model use',async()=>{
 const large=await collectDailyAiGlobalMarket(options(async()=>new Response('x'.repeat(2000001))));assert.equal(large.market.length,0);
 const aborted=new AbortController();aborted.abort();let calls=0;await assert.rejects(()=>collectDailyAiGlobalMarket(options(async()=>{calls++;return Response.json({});},{signal:aborted.signal})),/AI_GLOBAL_MARKET_ABORTED/);assert.equal(calls,0);
 let ticks=0;await assert.rejects(()=>collectDailyAiGlobalMarket(options(fixtureFetcher(),{clock:()=>ticks++?'2026-10-31T01:00:00Z':clock()})),/AI_GLOBAL_MARKET_CLOCK/);
});
test('four calls use concurrency two and never depend on member count or paid-provider credentials',async()=>{
 let active=0,peak=0,calls=0;
 const r=await collectDailyAiGlobalMarket(options(async(u,i)=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));const result=await fixtureFetcher()(u,i);active--;return result;}));
 assert.equal(calls,4);assert.equal(peak,2);assert.equal(r.market.length,4);
});
test('Taiwan night attribution is calendar based and cannot include a currently open night',()=>{
 assert.equal(dailyAiExpectedTaiwanNight('2026-10-31T03:50:00Z').trading_date,'2026-11-02');
 const beforeEnd=dailyAiExpectedTaiwanNight('2026-10-30T20:59:59Z');assert.equal(beforeEnd.session_date,'2026-10-29');assert.equal(beforeEnd.trading_date,'2026-10-30');
 const afterEnd=dailyAiExpectedTaiwanNight('2026-10-30T21:00:00Z');assert.equal(afterEnd.session_date,'2026-10-30');assert.equal(afterEnd.trading_date,'2026-11-02');
 assert.equal(dailyAiExpectedTaiwanNight('2030-10-31T03:50:00Z'),null);
});
const htmlNight=()=>`<!-- ---------dataStart--------- --><p>日期：2026/11/02</p><div>臺股期貨 (TX) 行情表</div>2026/10/30&nbsp;&nbsp;15:00~次日05:00 盤後交易時段行情表<br>
<table><thead><tr>${['契約','到期<br>月份<br>(週別)','開盤價','最高價','最低價','最後<br>成交價','漲跌價','漲跌%','*成交量','結算價','*未沖銷契約量','最後<br>最佳買價','最後<br>最佳賣價','歷史最高價','歷史最低價'].map(h=>'<th>'+h+'</th>').join('')}</tr></thead>
<tbody><tr>${['TX','202611','45395','45420','44052','44433','<span>▼-867</span>','<span>▼-1.91%</span>','44305','-','-','44432','44448','50440','44052'].map(c=>'<td>'+c+'</td>').join('')}</tr></tbody></table>`;
test('one official HTML fallback verifies printed dates and exact table columns after stale API',async()=>{
 let calls=0;const expectedUrl=dailyAiTaiwanNightReportUrl('2026-11-02');
 const r=await collectDailyAiGlobalMarket(options(async(u,i)=>{calls++;if(u===expectedUrl)return new Response(htmlNight());return fixtureFetcher((body,k)=>{if(k==='TX')body[0].Date='20261030';})(u,i);}));
 assert.equal(calls,5);assert.equal(r.market.length,4);assert.equal(r.receipts.length,5);assert(!r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
 const e=r.market[3],f=JSON.parse(e.content);assert.equal(e.source,expectedUrl);assert.equal(f.close,44433);assert.equal(f.trading_date,'2026-11-02');assert.equal(f.session_date,'2026-10-30');assert.equal(e.evidence_hash,sha(e.content));
});
test('form echo, wrong physical window, changed table schema and impossible price never pass HTML fallback',async()=>{
 for(const change of [s=>s.replace('日期：2026/11/02','<input value="2026/11/02">'),s=>s.replace('2026/10/30&nbsp;','2026/10/29&nbsp;'),
  s=>s.replace('15:00~次日05:00','08:45~13:45'),s=>s.replace('<th>最高價</th>','<th>未知欄位</th>'),s=>s.replace('<td>44433</td>','<td>999999</td>')]){
  const r=await collectDailyAiGlobalMarket(options(async(u,i)=>u===dailyAiTaiwanNightReportUrl('2026-11-02')?new Response(change(htmlNight())):
   fixtureFetcher((body,k)=>{if(k==='TX')body[0].Date='20261030';})(u,i)));
  assert.equal(r.market.length,3);assert(r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
 }
});
test('derived numeric overflow becomes an unavailable source instead of a frozen invalid market packet',async()=>{
 const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((b,k)=>{if(k==='IXIC')b.chart.result[0].indicators.quote[0].close=[1e-308,1e308];if(k==='TX')b[0].Last='9'.repeat(400);})));
 assert(r.additionalGaps.includes('US_CLOSE_IXIC_UNAVAILABLE'));assert(r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
 assert(r.market.every(e=>{const c=JSON.parse(e.content);return Number.isFinite(c.close)&&Number.isFinite(c.change_percent)&&Number.isFinite(c.change_points);}));
});
test('primary retained HTML report can be checked without a production fetch or publication',async()=>{
 if(!process.env.MA_TAIFEX_NIGHT_HTML)return;
 const {readFileSync}=await import('node:fs'),html=readFileSync(process.env.MA_TAIFEX_NIGHT_HTML,'utf8');
 const r=await collectDailyAiGlobalMarket(options(async(u,i)=>u===dailyAiTaiwanNightReportUrl('2026-11-02')?new Response(html):
  fixtureFetcher((body,k)=>{if(k==='TX')body[0].Date='20261030';})(u,i)));
 assert.equal(r.market.length,4);const f=JSON.parse(r.market[3].content);assert.equal(f.close,44433);assert.equal(f.change_points,-867);assert.equal(f.change_percent,-1.91);
 assert.equal(f.source_response_sha256,sha(html));
});
test('unresponsive public fetches expire within three bounded waves including the single night fallback',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 try{
  const pending=collectDailyAiGlobalMarket(options(async()=>{calls++;return new Promise(()=>{});}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
  t.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);
  t.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,5);
  t.mock.timers.tick(12000);const result=await pending;assert.equal(result.market.length,0);assert.equal(result.receipts.length,5);
  assert(result.receipts.every(r=>r.error==='AI_GLOBAL_MARKET_TIMEOUT'));
 }finally{t.mock.timers.reset();}
});
