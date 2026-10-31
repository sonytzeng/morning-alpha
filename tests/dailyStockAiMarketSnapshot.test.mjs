import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDailyAiGlobalMarket} from '../research/daily-ai-global-market.ts';
import {parseDailyAiMarketEvidence} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';

const observed='2026-10-31T03:00:00.123456Z',signal=new AbortController().signal;
const sha=async content=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content))),b=>b.toString(16).padStart(2,'0')).join('');
async function facts(){
 return (await collectDailyAiGlobalMarket({businessDate:'2026-10-31',clock:()=>observed,signal,fetcher:async url=>{
  const source=String(url);
  if(source.includes('taifex'))return Response.json([{Date:'20261102',Contract:'TX','ContractMonth(Week)':'202611',Last:'20000',Change:'100','%':'0.50%',TradingSession:'盤後'}]);
  const symbol=decodeURIComponent(new URL(source).pathname.split('/').at(-1));
  return Response.json({chart:{error:null,result:[{meta:{symbol,instrumentType:'INDEX',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d',regularMarketTime:Date.parse('2026-10-30T20:00:00Z')/1000},
   timestamp:['2026-10-29T13:30:00Z','2026-10-30T13:30:00Z'].map(t=>Date.parse(t)/1000),indicators:{quote:[{close:[100,102]}]}}]}});
 }})).market;
}
test('market snapshot retains exact known US closes and physical night with distinct future volume date',async()=>{
 const market=await facts();assert.equal(market.length,4);
 assert.deepEqual(await parseDailyAiMarketEvidence(market,observed,signal),market);
 const night=JSON.parse(market.find(e=>JSON.parse(e.content).market==='TW').content);
 assert.equal(night.session_date,'2026-10-30');assert.equal(night.session_ended_on,'2026-10-31');assert.equal(night.trading_date,'2026-11-02');
 for(const e of market){assert.equal(e.published_at,null);assert.equal(e.available_at,observed);assert.equal(e.evidence_hash,await sha(e.content));}
});
test('global market metadata cannot be repurposed as stock evidence, publication or arbitrary sources',async()=>{
 const original=(await facts())[0];
 for(const change of [e=>e.symbol='2330',e=>e.kind='NEWS',e=>e.source=e.source.replace('%5EIXIC','QQQ'),e=>e.source='https://www.taifex.org.tw/regular',
  e=>e.available_at='2026-10-31T03:00:00.123457Z',e=>e.first_seen_at='2026-10-31T03:00:00.123455Z',
  e=>e.published_at=observed,e=>e.time_basis='PUBLISHED',e=>e.evidence_hash='0'.repeat(64)]){
  const e=structuredClone(original);change(e);await assert.rejects(()=>parseDailyAiMarketEvidence([e],observed,signal),/AI_INTAKE_MARKET_/);
 }
 await assert.rejects(()=>parseDailyAiMarketEvidence(Array(5).fill(original),observed,signal),/AI_INTAKE_MARKET_LIMIT/);
 await assert.rejects(()=>parseDailyAiMarketEvidence([original,original],observed,signal),/AI_INTAKE_MARKET_INVALID/);
});
test('even rehashed cash-index content must prove exact completed sessions, native units and coherent values',async()=>{
 const original=(await facts())[0];
 for(const change of [c=>c.market='TW',c=>c.session='PRE',c=>c.native_symbol='QQQ',c=>c.currency='TWD',c=>c.unit='ETF_PRICE',c=>c.calendar_version='unverified',
  c=>c.research_business_date='2026-10-30',c=>c.session_date='2026-10-29',c=>c.prior_session_date='2026-10-28',c=>c.prior_bar_at='2026-10-29T01:00:00Z',
  c=>c.source_bar_at='2026-10-31T03:00:00.123457Z',c=>c.change_points=5,c=>c.change_percent=100,c=>c.prior_close=0,c=>c.close=-1,
  c=>c.comparison_basis='LIVE_INTRADAY',c=>c.bar_timestamp_basis='PUBLICATION_TIME',c=>c.source_response_bytes=2000001,c=>c.raw_payload='private provider body']){
  const e=structuredClone(original),c=JSON.parse(e.content);change(c);e.content=JSON.stringify(c);e.evidence_hash=await sha(e.content);
  await assert.rejects(()=>parseDailyAiMarketEvidence([e],observed,signal),/AI_INTAKE_MARKET_/);
 }
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
