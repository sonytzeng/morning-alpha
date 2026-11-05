import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleDaily,sessionsBefore} from '../src/features/vnext/dailyAdapter.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {evaluateEntry} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const date='2026-11-03',cutoff='2026-11-03T00:30:00.000Z';
const source='https://www.twse.com.tw/exchangeReport/STOCK_DAY';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成控制 '+symbol,exchange:'TWSE',industry:'24'}));
const dates=sessionsBefore(date);
const bar=(symbol,day,index)=>({symbol,date:day,open:100,high:104,low:98,close:103,volume:1000000,amount:103000000+index,
 id:`bar-${symbol}-${day}`,source,published_at:null,first_seen_at:cutoff,available_at:cutoff,as_of:day+'T13:30:00+08:00',
 evidence_hash:'a'.repeat(64),session_scope:'OFFICIAL_STOCK_DAY'});
const receipt=async(kind,rows)=>({task:{key:'a'.repeat(64),kind,url:source,format:'json',scope:date,symbols:[...RECOMMENDATION_UNIVERSE],max_age_days:1},
 first_seen_at:cutoff,available_at:cutoff,published_at:null,as_of:cutoff,version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:'b'.repeat(64),
 payload_hash:await snapshotHash({rows}),payload:{rows},status:'OK',reason:null});

test('SYNTHETIC: daily projection keeps every required research/Entry bar, full calendar and exact decisions while retaining source bytes',async()=>{
 const rows=companies.flatMap(c=>dates.map((d,i)=>bar(c.symbol,d,i))),r=await receipt('PRICE',rows),before=JSON.stringify(r);
 const revenue=companies.flatMap(c=>['2026-07','2026-08','2026-09'].map(period=>({symbol:c.symbol,kind:'REVENUE',period,basis:'MONTHLY',
  values:{yoy_percent:10,mom_percent:2},id:'revenue-'+c.symbol+'-'+period,source,published_at:null,first_seen_at:cutoff,available_at:cutoff,
  as_of:new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10)+'T13:30:00+08:00',evidence_hash:'c'.repeat(64)})));
 const market={value:{direction:'BULLISH',regime:'TREND',change_percent:1},source_ref:source,observed_at:cutoff,available_at:cutoff};
 const projected=await assembleDaily(date,companies,[r,await receipt('REVENUE',revenue)],cutoff,market);
 const originalInputs=projected.inputs.map(i=>({...i,bars:rows.filter(b=>b.symbol===i.symbol)}));
 assert(projected.inputs.every(i=>i.bars.length===20&&i.expected_sessions.length===250));
 assert.deepEqual(projected.inputs[0].bars.map(b=>b.date),dates.slice(-20));
 for(const [index,input] of projected.inputs.entries())for(const horizon of ['SHORT','MEDIUM','LONG']){
  assert.deepEqual(evaluateResearch(input,horizon),evaluateResearch(originalInputs[index],horizon),'verdict/reasons/metrics/used evidence remain identical');
 }
 const entry=structuredClone(projected.entry);
 for(const stock of entry.stocks){
  stock.relative_strength={value:2,source_ref:source,observed_at:cutoff,available_at:cutoff};
  stock.sector_return={value:1,source_ref:source,observed_at:cutoff,available_at:cutoff};
  stock.events_reviewed={value:true,source_ref:source,observed_at:cutoff,available_at:cutoff};
 }
 const originalEntry={...entry,source_evidence_hash:await snapshotHash(originalInputs)};
 const [actual,prior]=await Promise.all([evaluateEntry(entry),evaluateEntry(originalEntry)]);
 assert.deepEqual(actual.candidates,prior.candidates);assert.deepEqual(actual.counts,prior.counts);
 assert(actual.candidates.every(c=>Number.isFinite(c.metrics.atr)),'all ATR/price/relative/sector calculations actually ran');
 assert.notEqual(actual.evidence_hash,prior.evidence_hash,'input identity changes when unused historical payload is removed');
 assert.equal(JSON.stringify(r),before,'original full 250-session receipt stays immutable');
 assert(JSON.stringify(projected.inputs).length<JSON.stringify(originalInputs).length/3);
});

test('SYNTHETIC: projection never fills missing sessions or bypasses original receipt integrity',async()=>{
 const rows=dates.slice(0,-1).map((d,i)=>bar(companies[0].symbol,d,i));
 const r=await receipt('PRICE',rows),out=await assembleDaily(date,companies,[r],cutoff);
 assert(evaluateResearch(out.inputs[0],'SHORT').reasons.includes('SHORT_20_SESSION_COVERAGE'));
 r.payload.rows[0].close=999;
 await assert.rejects(()=>assembleDaily(date,companies,[r],cutoff),/SOURCE_REVISION_INVALID/);
 const future=await receipt('PRICE',[{...rows[0],first_seen_at:'2026-11-03T01:00:00.000Z'}]);
 await assert.rejects(()=>assembleDaily(date,companies,[future],cutoff),/POINT_IN_TIME_INVALID/,'unused historical prefix retains the existing future-time veto');
});

test('SYNTHETIC: omitted TWSE daily prefix retains future and invalid-lineage vetoes',async()=>{
 const prefix=bar(companies[0].symbol,dates[0],0);
 const valid=await assembleDaily(date,companies,[await receipt('TWSE_PRICE_DAY',[prefix])],cutoff);
 assert.equal(valid.inputs[0].bars.length,0,'a valid unused daily prefix is projected out');
 for(const change of [
  {first_seen_at:'2026-11-03T01:00:00.000Z'},
  {evidence_hash:'invalid-lineage-hash'},
 ]){
  const r=await receipt('TWSE_PRICE_DAY',[{...prefix,...change}]),before=JSON.stringify(r);
  await assert.rejects(()=>assembleDaily(date,companies,[r],cutoff),/POINT_IN_TIME_INVALID/);
  assert.equal(JSON.stringify(r),before,'refusal preserves the original retained receipt');
 }
});
