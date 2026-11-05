import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectDailyAiGlobalMarket,dailyAiExpectedTaiwanNight,dailyAiTaiwanNightReportUrl,dailyAiTreasuryYieldUrl,DAILY_AI_GLOBAL_MARKET_URLS} from '../research/daily-ai-global-market.ts';
const clock=()=> '2026-10-31T06:00:00Z',signal=()=>new AbortController().signal;
const sha=s=>createHash('sha256').update(s).digest('hex');
const row=(date,rates)=>`<entry><content type="application/xml"><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>${['BC_2YEAR','BC_10YEAR','BC_30YEAR'].map((field,i)=>rates[i]===null?`<d:${field} m:type="Edm.Double" m:null="true" />`:`<d:${field} m:type="Edm.Double">${rates[i]}</d:${field}>`).join('')}</m:properties></content></entry>`;
const treasury=(rows=[['2026-10-29',[4.61,4.98,5.32]],['2026-10-30',[4.56,4.94,5.31]]])=>`<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"><title type="text">DailyTreasuryYieldCurveRateData</title><updated>2026-10-30T15:46:08Z</updated>${rows.map(([d,r])=>row(d,r)).join('')}</feed>`;
const night=(date='20261102')=>[{Date:date,Contract:'TX','ContractMonth(Week)':'202611',Last:'44433',Change:'-867','%':'-1.91%',TradingSession:'盤後'}];
const options=(fetcher,extra={})=>({fetcher,clock,signal:signal(),businessDate:'2026-10-31',...extra});
const fixtureFetcher=(change=()=>{})=>async(url,init)=>{
 assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert(!new Headers(init.headers).has('Authorization'));
 assert(!new URL(url).hostname.endsWith('yahoo.com'),'Yahoo must never be requested');
 if(url===dailyAiTreasuryYieldUrl('2026-10-31',clock())){const body={xml:treasury()};change(body,'TREASURY');return new Response(body.xml,{headers:{'Content-Type':'text/xml'}});}
 assert.equal(url,DAILY_AI_GLOBAL_MARKET_URLS.TX,'only fixed Treasury/official futures URL');const body=night();change(body,'TX');return Response.json(body);
};
test('two public sources retain CC0 Treasury rates and correctly attributed Friday night without any equity fetch',async()=>{
 const r=await collectDailyAiGlobalMarket(options(fixtureFetcher()));assert.equal(r.market.length,2);assert.deepEqual(r.additionalGaps,['US_EQUITY_CLOSE_NOT_COLLECTED_US_NEWS_CONTEXT_ONLY']);assert.equal(r.receipts.length,2);
 for(const e of r.market){assert.equal(e.symbol,null);assert.equal(e.kind,'MARKET');assert.equal(e.published_at,null);assert.equal(e.time_basis,'OBSERVED_AFTER_RECEIPT');
  assert.equal(e.available_at,clock());assert.equal(e.first_seen_at,clock());assert.equal(e.as_of,clock());assert.equal(e.evidence_hash,sha(e.content));
  const v=JSON.parse(e.content);assert.equal(v.schema,'DAILY_AI_GLOBAL_MARKET_FACT_V1');assert.equal(v.timestamp_basis,'RECEIPT_ONLY_PUBLICATION_UNKNOWN');assert.equal(v.source_response_sha256,r.receipts.find(x=>x.source===e.source).hash);assert(v.source_response_bytes>0);}
 const rate=JSON.parse(r.market[0].content);assert.equal(r.market[0].id,'global:TREASURY:2026-10-30');assert.equal(rate.kind,'US_TREASURY_PAR_YIELD_CURVE');assert.equal(rate.native_symbol,'UST_PAR_YIELD_CURVE');assert.equal(rate.unit,'PERCENT');assert.equal(rate.currency,'USD');
 assert.deepEqual([rate.yield_2y,rate.yield_10y,rate.yield_30y],[4.56,4.94,5.31]);assert.deepEqual([rate.prior_yield_2y,rate.prior_yield_10y,rate.prior_yield_30y],[4.61,4.98,5.32]);assert.deepEqual([rate.change_2y_bp,rate.change_10y_bp,rate.change_30y_bp],[-5,-4,-1]);
 assert.equal(rate.prior_session_date,'2026-10-29');assert.equal(rate.freshness,'LATEST_AVAILABLE_TREASURY_OBSERVATION');assert.equal(rate.calendar_version,'TREASURY_XML_ACTUAL_DATES_V1');assert(!('close' in rate));assert(!('change_percent' in rate));
 assert.equal(rate.observation_date_coordinate,'2026-10-30T00:00:00');assert.equal(rate.source_row_date_basis,'NEW_DATE_DATE_COORDINATE_NOT_PUBLICATION');
 const tx=JSON.parse(r.market[1].content);assert.equal(tx.native_contract,'TX202611');assert.equal(tx.session_date,'2026-10-30');assert.equal(tx.session_ended_on,'2026-10-31');assert.equal(tx.trading_date,'2026-11-02');assert.equal(tx.research_business_date,'2026-10-31');assert.equal(tx.change_reference_value,45300);
});
test('old official API attribution is not relabelled as the latest physical night',async()=>{
 const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((body,k)=>{if(k==='TX')body[0].Date='20261030';})));
 assert.equal(r.market.length,1);assert(r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));const receipt=r.receipts.find(x=>x.instrument==='TX');assert.equal(receipt.state,'UNAVAILABLE');assert(receipt.hash);assert(receipt.received_at);
});
test('Treasury XML namespace, duplicate dates/fields, missing latest tenor, future dates, stale rows and entity declarations fail closed',async()=>{
 for(const change of [s=>s.replace('http://www.w3.org/2005/Atom','https://example.test/not-atom'),s=>s.replace('</feed>',row('2026-10-30',[4,5,6])+'</feed>'),
  s=>s.replace('2026-10-30T00:00:00','2026-11-02T00:00:00'),s=>s.replace('<d:BC_30YEAR m:type="Edm.Double">5.31</d:BC_30YEAR>','<d:BC_30YEAR m:type="Edm.Double" m:null="true" />'),
  s=>'<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+s,s=>s.replace('<d:BC_2YEAR m:type="Edm.Double">4.56</d:BC_2YEAR>','<d:BC_2YEAR m:type="Edm.Double">4.56</d:BC_2YEAR><d:BC_2YEAR m:type="Edm.Double">4.57</d:BC_2YEAR>'),
  ()=>treasury([['2026-10-19',[4,5,6]],['2026-10-20',[4,5,6]]])]){
  const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((body,k)=>{if(k==='TREASURY')body.xml=change(body.xml);})));
  assert.equal(r.market.length,1);assert(r.additionalGaps.includes('US_TREASURY_YIELD_CURVE_UNAVAILABLE'));assert.equal(JSON.parse(r.market[0].content).market,'TW');
 }
});
test('single Treasury observation remains actual rates with all prior fields null and a comparison gap',async()=>{
 const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((b,k)=>{if(k==='TREASURY')b.xml=treasury([['2026-10-30',[4.56,4.94,5.31]]]);})));
 const c=JSON.parse(r.market[0].content);for(const field of ['prior_yield_2y','prior_yield_10y','prior_yield_30y','change_2y_bp','change_10y_bp','change_30y_bp','prior_session_date'])assert.equal(c[field],null);
 assert(r.additionalGaps.includes('US_TREASURY_PRIOR_OBSERVATION_UNAVAILABLE'));assert.equal(c.yield_10y,4.94);
});
test('Treasury actual row dates are independent of NYSE holiday/session expectations',async()=>{
 const r=await collectDailyAiGlobalMarket(options(async(u,i)=>u.startsWith('https://home.treasury.gov/')?new Response(treasury([['2026-10-08',[4.4,4.8,5.2]],['2026-10-09',[4.5,4.9,5.3]]])):new Response('unavailable',{status:503}),
  {businessDate:'2026-10-13',clock:()=> '2026-10-12T22:00:00Z'}));
 assert.equal(r.market.length,1);const c=JSON.parse(r.market[0].content);assert.equal(c.session_date,'2026-10-09');assert.equal(c.observation_age_calendar_days,3);assert.equal(c.prior_session_date,'2026-10-08');
 assert(dailyAiTreasuryYieldUrl('2026-11-01','2026-10-31T23:00:00Z').endsWith('202610'));
 assert(dailyAiTreasuryYieldUrl('2026-11-02','2026-11-01T23:30:00Z').endsWith('202610'));
});
test('night identity excludes day session, spreads, duplicates, impossible months and inconsistent change basis',async()=>{
 for(const change of [b=>b[0].TradingSession='一般',b=>b[0]['ContractMonth(Week)']='202611/202612',b=>b.push({...b[0]}),b=>b[0]['ContractMonth(Week)']='202613',b=>b[0]['%']='10%']){
  const r=await collectDailyAiGlobalMarket(options(fixtureFetcher((b,k)=>{if(k==='TX')change(b);})));
  assert(!r.market.some(e=>JSON.parse(e.content).market==='TW'));assert(r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
 }
});
test('unavailable sources record rates/equity/night gaps without invented observations or HTTP error text',async()=>{
 const r=await collectDailyAiGlobalMarket(options(async()=>new Response('not authorized',{status:403})));
 assert.deepEqual(r.market,[]);assert.equal(r.receipts.filter(x=>x.state==='UNAVAILABLE').length,3);
 assert.deepEqual(r.additionalGaps,['US_EQUITY_CLOSE_NOT_COLLECTED_US_NEWS_CONTEXT_ONLY','US_TREASURY_YIELD_CURVE_UNAVAILABLE','TAIWAN_NIGHT_SESSION_UNVERIFIED']);assert(!JSON.stringify(r).includes('not authorized'));
});
test('body size, clock regression, numerical overflow and cancelled input stay bounded before model use',async()=>{
 const large=await collectDailyAiGlobalMarket(options(async()=>new Response('x'.repeat(2000001))));assert.equal(large.market.length,0);
 const aborted=new AbortController();aborted.abort();let calls=0;await assert.rejects(()=>collectDailyAiGlobalMarket(options(async()=>{calls++;return Response.json({});},{signal:aborted.signal})),/AI_GLOBAL_MARKET_ABORTED/);assert.equal(calls,0);
 let ticks=0;await assert.rejects(()=>collectDailyAiGlobalMarket(options(fixtureFetcher(),{clock:()=>ticks++?'2026-10-31T01:00:00Z':clock()})),/AI_GLOBAL_MARKET_CLOCK/);
 const malformed=await collectDailyAiGlobalMarket(options(fixtureFetcher((b,k)=>{if(k==='TREASURY')b.xml=b.xml.replace('>4.56<','>'+('9'.repeat(400))+'<');else b[0].Last='9'.repeat(400);})));
 assert.equal(malformed.market.length,0);
});
test('two requests use concurrency two and never call a forbidden quote provider',async()=>{
 let active=0,peak=0,calls=0;const r=await collectDailyAiGlobalMarket(options(async(u,i)=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));const response=await fixtureFetcher()(u,i);active--;return response;}));
 assert.equal(calls,2);assert.equal(peak,2);assert.equal(r.market.length,2);
});
test('Taiwan night attribution cannot include a currently open night',()=>{
 assert.equal(dailyAiExpectedTaiwanNight('2026-10-31T06:00:00Z').trading_date,'2026-11-02');
 assert.equal(dailyAiExpectedTaiwanNight('2026-10-30T20:59:59Z').session_date,'2026-10-29');assert.equal(dailyAiExpectedTaiwanNight('2026-10-30T21:00:00Z').session_date,'2026-10-30');
 assert.equal(dailyAiExpectedTaiwanNight('2030-10-31T03:50:00Z'),null);
});
const htmlNight=()=>`<!-- ---------dataStart--------- --><p>日期：2026/11/02</p><div>臺股期貨 (TX) 行情表</div>2026/10/30&nbsp;&nbsp;15:00~次日05:00 盤後交易時段行情表<br>
<table><thead><tr>${['契約','到期<br>月份<br>(週別)','開盤價','最高價','最低價','最後<br>成交價','漲跌價','漲跌%','*成交量','結算價','*未沖銷契約量','最後<br>最佳買價','最後<br>最佳賣價','歷史最高價','歷史最低價'].map(h=>'<th>'+h+'</th>').join('')}</tr></thead>
<tbody><tr>${['TX','202611','45395','45420','44052','44433','<span>▼-867</span>','<span>▼-1.91%</span>','44305','-','-','44432','44448','50440','44052'].map(c=>'<td>'+c+'</td>').join('')}</tr></tbody></table>`;
test('one official HTML fallback verifies printed dates and exact columns after stale API',async()=>{
 let calls=0;const url=dailyAiTaiwanNightReportUrl('2026-11-02');
 const r=await collectDailyAiGlobalMarket(options(async(u,i)=>{calls++;return u===url?new Response(htmlNight()):fixtureFetcher((b,k)=>{if(k==='TX')b[0].Date='20261030';})(u,i);}));
 assert.equal(calls,3);assert.equal(r.market.length,2);assert.equal(r.receipts.length,3);assert(!r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
 const e=r.market[1],c=JSON.parse(e.content);assert.equal(e.source,url);assert.equal(c.close,44433);assert.equal(c.trading_date,'2026-11-02');assert.equal(c.session_date,'2026-10-30');
});
test('form echo, wrong physical window, changed schema and impossible price cannot pass HTML fallback',async()=>{
 for(const change of [s=>s.replace('日期：2026/11/02','<input value="2026/11/02">'),s=>s.replace('2026/10/30&nbsp;','2026/10/29&nbsp;'),s=>s.replace('15:00~次日05:00','08:45~13:45'),s=>s.replace('<th>最高價</th>','<th>未知欄位</th>'),s=>s.replace('<td>44433</td>','<td>999999</td>')]){
  const r=await collectDailyAiGlobalMarket(options(async(u,i)=>u===dailyAiTaiwanNightReportUrl('2026-11-02')?new Response(change(htmlNight())):fixtureFetcher((b,k)=>{if(k==='TX')b[0].Date='20261030';})(u,i)));
  assert.equal(r.market.length,1);assert(r.additionalGaps.includes('TAIWAN_NIGHT_SESSION_UNVERIFIED'));
 }
});
test('retained official Treasury XML and night HTML validate without production writes',async t=>{
 if(!process.env.MA_TREASURY_YIELD_XML||!process.env.MA_TAIFEX_NIGHT_HTML){t.skip('Primary retained source paths were not supplied');return;}
 const {readFileSync}=await import('node:fs'),xml=readFileSync(process.env.MA_TREASURY_YIELD_XML,'utf8'),html=readFileSync(process.env.MA_TAIFEX_NIGHT_HTML,'utf8');
 const r=await collectDailyAiGlobalMarket(options(async(u,i)=>u.startsWith('https://home.treasury.gov/')?new Response(xml):u===dailyAiTaiwanNightReportUrl('2026-11-02')?new Response(html):Response.json(night('20261030'))));
 assert.equal(r.market.length,2);const rate=JSON.parse(r.market[0].content),tx=JSON.parse(r.market[1].content);
 assert.deepEqual([rate.yield_2y,rate.yield_10y,rate.yield_30y],[4.56,4.94,5.31]);assert.equal(rate.source_response_sha256,sha(xml));assert.equal(tx.close,44433);assert.equal(tx.source_response_sha256,sha(html));
});
test('unresponsive sources expire in one initial six-second wave and one bounded night fallback',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 try{
  const pending=collectDailyAiGlobalMarket(options(async()=>{calls++;return new Promise(()=>{});}));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
  t.mock.timers.tick(6000);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);
  t.mock.timers.tick(12000);const result=await pending;assert.equal(result.market.length,0);assert.equal(result.receipts.length,3);assert(result.receipts.every(r=>r.error==='AI_GLOBAL_MARKET_TIMEOUT'));
 }finally{t.mock.timers.reset();}
});
