import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDailyAiGlobalMarket} from '../research/daily-ai-global-market.ts';
import {parseDailyAiMarketEvidence} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';

const observed='2026-10-31T03:00:00.123456Z',signal=new AbortController().signal;
const sha=async content=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content))),b=>b.toString(16).padStart(2,'0')).join('');
const row=(date,rates)=>'<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">'+date+'T00:00:00</d:NEW_DATE>'+['BC_2YEAR','BC_10YEAR','BC_30YEAR'].map((k,i)=>'<d:'+k+' m:type="Edm.Double">'+rates[i]+'</d:'+k+'>').join('')+'</m:properties></content></entry>';
const xml=onlyCurrent=>'<feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"><title>DailyTreasuryYieldCurveRateData</title>'+(onlyCurrent?'':row('2026-10-29',[4.61,4.98,5.32]))+row('2026-10-30',[4.56,4.94,5.31])+'</feed>';
async function facts(onlyCurrent=false){
 return (await collectDailyAiGlobalMarket({businessDate:'2026-10-31',clock:()=>observed,signal,fetcher:async url=>{
  const source=String(url);assert(!source.includes('yahoo.com'),'commercially restricted sources must never be requested');
  if(source.includes('taifex'))return Response.json([{Date:'20261102',Contract:'TX','ContractMonth(Week)':'202611',Last:'20000',Change:'100','%':'0.50%',TradingSession:'盤後'}]);
  assert.equal(source,'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=202610');
  return new Response(xml(onlyCurrent),{headers:{'Content-Type':'application/xml'}});
 }})).market;
}
test('Treasury yield percent and physical night facts retain exact receipts without an equity-close claim',async()=>{
 const market=await facts();assert.equal(market.length,2);assert.deepEqual(await parseDailyAiMarketEvidence(market,observed,signal),market);
 const rates=JSON.parse(market[0].content);assert.equal(rates.kind,'US_TREASURY_PAR_YIELD_CURVE');assert.equal(rates.unit,'PERCENT');
 assert.deepEqual([rates.yield_2y,rates.yield_10y,rates.yield_30y],[4.56,4.94,5.31]);assert.deepEqual([rates.change_2y_bp,rates.change_10y_bp,rates.change_30y_bp],[-5,-4,-1]);
 const night=JSON.parse(market[1].content);assert.equal(night.session_date,'2026-10-30');assert.equal(night.session_ended_on,'2026-10-31');assert.equal(night.trading_date,'2026-11-02');
 for(const e of market){assert.equal(e.published_at,null);assert.equal(e.available_at,observed);assert.equal(e.evidence_hash,await sha(e.content));}
});
test('legacy Yahoo snapshots and market metadata repurposing cannot be admitted',async()=>{
 const original=(await facts())[0];
 for(const change of [e=>e.symbol='2330',e=>e.kind='NEWS',e=>e.source='https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1mo',
  e=>e.source='https://www.taifex.org.tw/regular',e=>e.available_at='2026-10-31T03:00:00.123457Z',e=>e.first_seen_at='2026-10-31T03:00:00.123455Z',
  e=>e.published_at=observed,e=>e.time_basis='PUBLISHED',e=>e.evidence_hash='0'.repeat(64)]){
  const e=structuredClone(original);change(e);await assert.rejects(()=>parseDailyAiMarketEvidence([e],observed,signal),/AI_INTAKE_MARKET_/);
 }
 await assert.rejects(()=>parseDailyAiMarketEvidence(Array(3).fill(original),observed,signal),/AI_INTAKE_MARKET_LIMIT/);
 await assert.rejects(()=>parseDailyAiMarketEvidence([original,original],observed,signal),/AI_INTAKE_MARKET_INVALID/);
});
test('rehashed Treasury content must retain actual dates, rate units and basis-point arithmetic',async()=>{
 const original=(await facts())[0];
 for(const change of [c=>c.market='TW',c=>c.session='REGULAR',c=>c.kind='US_CASH_INDEX',c=>c.native_symbol='^IXIC',c=>c.currency='TWD',c=>c.unit='INDEX_POINTS',
  c=>c.calendar_version='NYSE_STOCK_SESSIONS',c=>c.research_business_date='2026-10-30',c=>c.observation_age_calendar_days=1,c=>c.session_date='2026-10-01',
  c=>c.observation_date_coordinate='2026-10-30T16:00:00',c=>c.yield_2y=456,c=>c.change_2y_bp=-.05,c=>c.prior_yield_10y=null,c=>c.prior_session_date=null,
  c=>c.comparison_basis='STOCK_CLOSE_PERCENT_CHANGE',c=>c.source_row_date_basis='PUBLICATION_TIME',c=>c.source_response_bytes=2000001,c=>c.close=5000,c=>c.raw_payload='private provider body']){
  const e=structuredClone(original),c=JSON.parse(e.content);change(c);e.content=JSON.stringify(c);e.evidence_hash=await sha(e.content);
  await assert.rejects(()=>parseDailyAiMarketEvidence([e],observed,signal),/AI_INTAKE_MARKET_/);
 }
});
test('one Treasury row preserves missing prior values and prior-month feed is valid at a Taipei month boundary',async()=>{
 const one=(await facts(true))[0],single=JSON.parse(one.content);assert.equal(single.prior_session_date,null);
 for(const key of ['prior_yield_2y','prior_yield_10y','prior_yield_30y','change_2y_bp','change_10y_bp','change_30y_bp'])assert.equal(single[key],null);
 assert.deepEqual(await parseDailyAiMarketEvidence([one],observed,signal),[one]);
 const e=(await facts())[0],c=JSON.parse(e.content),receipt='2026-11-01T01:00:00Z';
 c.research_business_date='2026-11-01';c.received_at=receipt;c.observation_age_calendar_days=1;
 Object.assign(e,{available_at:receipt,first_seen_at:receipt,as_of:receipt,content:JSON.stringify(c)});e.evidence_hash=await sha(e.content);
 assert.deepEqual(await parseDailyAiMarketEvidence([e],receipt,signal),[e]);
 e.source=e.source.replace('202610','202611');await assert.rejects(()=>parseDailyAiMarketEvidence([e],receipt,signal),/AI_INTAKE_MARKET_SOURCE/);
});
test('regular or stale TAIFEX observations cannot be relabeled as the completed night',async()=>{
 const original=(await facts()).find(e=>JSON.parse(e.content).market==='TW');
 for(const change of [c=>c.session='REGULAR',c=>c.session_date='2026-10-29',c=>c.trading_date='2026-10-30',
  c=>c.scheduled_session_end='2026-11-01T05:00:00+08:00',c=>c.contract_month='202510',c=>c.native_contract='MTX202611',
  c=>c.change_reference_value=1,c=>c.change_percent=5,c=>c.trading_date_basis='SESSION_CALENDAR_DATE']){
  const e=structuredClone(original),c=JSON.parse(e.content);change(c);e.content=JSON.stringify(c);e.evidence_hash=await sha(e.content);
  await assert.rejects(()=>parseDailyAiMarketEvidence([e],observed,signal),/AI_INTAKE_MARKET_/);
 }
});
test('official night HTML fallback accepts only its exact verified session query',async()=>{
 const original=(await facts()).find(e=>JSON.parse(e.content).market==='TW'),content=JSON.parse(original.content);
 const html='<table>test-only official night fixture</table>';
 content.source_response_sha256=await sha(html);content.source_response_bytes=new TextEncoder().encode(html).byteLength;
 original.content=JSON.stringify(content);original.evidence_hash=await sha(original.content);
 original.source='https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&queryDate=2026%2F11%2F02&commodity_id=TX';
 assert.deepEqual(await parseDailyAiMarketEvidence([original],observed,signal),[original]);
 for(const source of [original.source.replace('marketCode=1','marketCode=0'),original.source+'&latest=true',original.source.replace('commodity_id=TX','commodity_id=MTX'),
  original.source.replace('2026%2F11%2F02','2026%2F10%2F30'),original.source.replace('www.taifex.com.tw','www.taifex.org.tw')]){
  await assert.rejects(()=>parseDailyAiMarketEvidence([{...original,source}],observed,signal),/AI_INTAKE_MARKET_SOURCE/);
 }
});
