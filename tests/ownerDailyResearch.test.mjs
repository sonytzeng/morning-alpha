// Synthetic display/transport controls only. No market, user or execution proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HORIZONS,snapshotHash} from '../src/features/vnext/contracts.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {ENTRY_VERSION,ENTRY_PREMARKET_VERSION,evaluatePremarketEntry} from '../research/entry-opportunity.ts';
import {entryFixture,setup} from './helpers/entryFixtures.mjs';
import * as daily from '../src/features/vnext/ownerDailyResearch.ts';
import {dailyAiGapLabel} from '../src/features/vnext/dailyAiCopy.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

const today='2026-11-02',at='2026-11-02T00:00:00.000Z',now=Date.parse(at)+60000;
const response=(state='NOT_OBSERVED',predictions=[])=>({business_date:today,state,reason:null,source_count:7,predictions,
 member_published:0,analysis_value:'INSUFFICIENT_SAMPLE',performance_sample:0});
let fixturePromise;
async function fixture(){
 fixturePromise??=(async()=>{
  const through=previousMarketTradingDate('TW',today),dates=[through];while(dates.length<20)dates.unshift(previousMarketTradingDate('TW',dates[0]));
  const rows=[];
  for(let n=0;n<72;n++){
   const symbol=String(9000+n),trace=id=>({id,source:'https://example.test/owner-display-control',evidence_hash:'a'.repeat(64),
    published_at:null,first_seen_at:at,available_at:at,as_of:through+'T13:30:00+08:00'});
   const input={symbol,company:'合成顯示控制'+n,cutoff:at,through,next_session:today,expected_sessions:dates,
    bars:dates.map((date,i)=>({...trace(symbol+'-'+date),date,as_of:date+'T13:30:00+08:00',open:100,close:i===19?104:100,
     low:99,high:105,volume:10000,amount:i===19?2000000:1000000,session_scope:'SYNTHETIC'})),facts:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}};
   const evidenceHash=await snapshotHash(input);
   for(const horizon of Object.keys(HORIZONS)){
    const research=evaluateResearch(input,horizon),body={id:'f'.repeat(64)+':'+symbol+':'+horizon,business_date:today,
     mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',symbol,company:input.company,horizon,
     strategy_version:research.version,entry_version:ENTRY_VERSION,generated_at:at,locked_at:at,evidence_cutoff:at,evidence_hash:evidenceHash,
     actionable_at:today+'T01:00:00.000Z',target_sessions:HORIZONS[horizon].outcomes,research,entry:[],
     entry_gap:'MATCHING_ENTRY_SOURCE_UNAVAILABLE',confirmation:research.confirmation,invalidation:research.invalidation,next_review_at:research.next_review_at};
    rows.push({...body,lock_hash:await snapshotHash(body)});
   }
  }
  return response('COMPLETE',rows);
 })();
 return structuredClone(await fixturePromise);
}
async function reseal(lock){const {lock_hash,...body}=lock;void lock_hash;lock.lock_hash=await snapshotHash(body);}

test('real-mode locked display contract retains 72 independent judgments per horizon, date and source cutoff',async()=>{
 const data=await daily.parseOwnerDailyResearch(await fixture(),today,now);
 assert.equal(data.rows.length,216);assert.equal(data.through,'2026-10-30');assert.equal(data.evidence_cutoff,at);
 assert.deepEqual(daily.ownerDailyCounts(data,'SHORT'),{saved:72,evaluated:72,qualified:72,rejected:0,insufficient:0});
 assert.deepEqual(daily.ownerDailyCounts(data,'LONG'),{saved:72,evaluated:0,qualified:0,rejected:0,insufficient:72});
 assert.equal(data.member_published,0);assert(!Object.hasOwn(data,'buy_ready'));
});
test('missing natural run and incomplete acquisition stay distinct from zero candidates',async()=>{
 for(const state of daily.OWNER_DAILY_STATES){
  const data=await daily.parseOwnerDailyResearch(response(state),today,now);
  assert.equal(data.state,state);assert.equal(data.rows.length,0);assert.equal(data.through,null);
  assert.equal(daily.ownerDailyCounts(data,'SHORT').evaluated,0);
 }
});
test('normal continuation reasons describe progress without implying a broken process',()=>{
 assert.equal(daily.ownerDailyReason('ACQUIRED_SNAPSHOT_CONTINUATION'),'來源快照已保存，正在接續評估。');
 assert.equal(daily.ownerDailyReason('EVALUATION_CONTINUATION'),'正在接續整理與評估。');
 assert.equal(daily.ownerDailyReason('OUTCOME_SOURCE_CONTINUATION'),'已保存今日評估，正在取得先前研究追蹤資料。');
 assert.equal(daily.ownerDailyReason('SOURCE_RETRY_PENDING'),'來源暫時未回應，依既有排程重試。');
 assert.equal(daily.ownerDailyReason('OTHER_CONTINUATION'),'本次流程仍在處理或等待下一步，尚未確認完成。');
});
test('wrong Taipei date, member promotion, malformed source progress and partial universes fail closed',async()=>{
 for(const mutate of [p=>p.business_date='2026-10-30',p=>p.member_published=1,p=>p.source_count=-1,p=>p.state='READY',p=>p.predictions.pop()]){
  const p=await fixture();mutate(p);await assert.rejects(()=>daily.parseOwnerDailyResearch(p,today,now),/OWNER_DAILY_SCOPE/);
 }
 await assert.rejects(async()=>daily.parseOwnerDailyResearch(await fixture(),today,Date.parse('2026-11-02T16:00:00Z')),/OWNER_DAILY_SCOPE/);
});
test('tampered, future, historical and synthetic locks never render as today natural evaluations',async()=>{
 for(const mutate of [l=>l.research.reason='tampered',l=>l.mode='HISTORICAL_REPLAY',l=>l.provenance='SYNTHETIC_CONTROL',l=>l.locked_at='2026-11-02T00:02:00.000Z']){
  const p=await fixture();mutate(p.predictions[0]);await assert.rejects(()=>daily.parseOwnerDailyResearch(p,today,now),/OWNER_DAILY_LOCK/);
 }
 const p=await fixture();p.predictions[0].research.used[0].source='javascript:alert(1)';await reseal(p.predictions[0]);
 await assert.rejects(()=>daily.parseOwnerDailyResearch(p,today,now),/OWNER_DAILY_LOCK/);
});
test('duplicate horizons and separately rehashed mixed batch, cutoff or stock evidence are rejected',async()=>{
 const duplicate=await fixture();duplicate.predictions[1]=structuredClone(duplicate.predictions[0]);
 await assert.rejects(()=>daily.parseOwnerDailyResearch(duplicate,today,now),/OWNER_DAILY_UNIVERSE/);
 for(const mutate of [l=>l.id='e'.repeat(64)+':'+l.symbol+':'+l.horizon,l=>l.evidence_hash='b'.repeat(64),
  l=>l.entry.push({strategy:'SYNTHETIC_OTHER_ENTRY'}),l=>l.entry_gap='SYNTHETIC_DIFFERENT_ENTRY_GAP',
  l=>{l.evidence_cutoff='2026-11-01T23:59:59.000Z';l.research.cutoff=l.evidence_cutoff;}]){
  const p=await fixture();mutate(p.predictions[1]);await reseal(p.predictions[1]);
  await assert.rejects(()=>daily.parseOwnerDailyResearch(p,today,now),/OWNER_DAILY_MIXED_BATCH/);
 }
});
test('parser owns every response preimage before its first digest await',async()=>{
 const p=await fixture(),read=daily.parseOwnerDailyResearch(p,today,now);p.predictions.at(-1).research.reason='late mutation';
 const parsed=await read;assert.notEqual(parsed.rows.at(-1).research.reason,'late mutation');
});

let displayNow=Date.now();
class ViewDate extends Date{static now(){return displayNow;}}
const componentFile='src/pages/vnext/OwnerDailyResearch.tsx',exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+componentFile,import.meta.url),'utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,{
 exports,React,Intl,Date:ViewDate,URL,require:name=>{
  if(name==='react')return React;
  if(name==='@/features/vnext/contracts')return {HORIZONS};
  if(name==='@/features/vnext/ownerDailyResearch')return daily;
  if(name==='@/features/vnext/dailyAiCopy')return {dailyAiGapLabel};
  if(name.endsWith('.css'))return {};
  throw Error('UNEXPECTED_OWNER_DAILY_IMPORT:'+name);
 },
},{filename:componentFile});
const render=data=>renderToStaticMarkup(React.createElement(exports.default,{data,unavailable:false,requestDate:today,horizon:'LONG',onHorizonChange:()=>{},onRefresh:()=>{}}));
test('actual Owner UI distinguishes incomplete natural runs, 216 saved evaluations and missing long evidence',async()=>{
 const pending=render(await daily.parseOwnerDailyResearch(response(),today,now));
 assert.match(pending,/尚未取得今日執行紀錄/);assert.match(pending,/0／216/);assert(!pending.includes('今天沒有股票'));
 const complete=render(await daily.parseOwnerDailyResearch(await fixture(),today,now));
 assert.match(complete,/216／216/);assert.match(complete,/已保存 72 檔 × 三期間紀錄/);assert.match(complete,/2026-10-30/);
 assert.match(complete,/已保存 72 檔／有效評估 0 檔/);assert(!complete.includes('已完成 72 檔'));
 assert.match(complete,/資料不足 72 檔/);assert.match(complete,/尚未發布給會員/);assert(!complete.includes('已確認買點'));
});

function entryDisplayControl(lock){
 const entry={symbol:lock.symbol,strategy:'BREAKOUT_CONTINUATION',strategy_version:'BREAKOUT_CONTINUATION_1.1.0',status:'WAIT_CONFIRMATION',
  reasons:['合成顯示控制：仍等待事件確認。'],entry_trigger:'合成顯示控制：突破100且不超過101。',invalidation:'合成顯示控制：跌至98或超價取消。',
  evidence_refs:['https://www.twse.com.tw/exchangeReport/STOCK_DAY?stockNo=9000','javascript:alert(1)'],
  plan:{not_before:today,expires_on:today,reference_range:[100,101],trigger:100,stop:98,target:110,risk_distance:3.5,reward_space:7,
   reward_risk:2,max_risk:.08}};
 return {...lock,entry_version:'ENTRY_OPPORTUNITY_1.1.0',entry_gap:null,entry:[entry]};
}
test('saved entry diagnostics preserve rejected, missing and waiting reasons; only same-day unexpired validated plans expose prices',async()=>{
 const data=await daily.parseOwnerDailyResearch(await fixture(),today,now),lock=entryDisplayControl(data.rows[0]);
 const result=daily.ownerDailyEntryResults(lock,now),plan=result[2];
 assert.equal(result[0].status,'INSUFFICIENT_EVIDENCE');assert.equal(result[0].plan,null);
 assert.equal(plan.status,'WAIT_CONFIRMATION');assert.equal(plan.plan_state,'AVAILABLE');assert.deepEqual(plan.plan.range,[100,101]);
 assert.equal(plan.plan.wait_above,101);assert.equal(plan.plan.stop,98);assert.equal(plan.sources.length,1);
 assert.equal(plan.plan.valid_until,today+'T13:30:00+08:00');
 for(const mutate of [l=>l.entry[0].status='AVOID_ENTRY',l=>l.entry[0].status='INSUFFICIENT_EVIDENCE',
  l=>l.entry[0].plan.not_before='2026-11-03',l=>l.entry[0].plan.expires_on='2026-11-03',l=>l.entry[0].plan.stop=102,
  l=>l.entry[0].plan.reference_range[1]=NaN,l=>l.entry[0].plan.reward_risk=1.9,l=>l.entry[0].plan.risk_distance=20,
  l=>l.entry[0].strategy_version='BREAKOUT_CONTINUATION_1.0.0',l=>l.entry_version='ENTRY_OPPORTUNITY_1.0.0',
  l=>l.entry[0].symbol='2330',l=>l.entry.push(structuredClone(l.entry[0])),l=>l.entry_gap='MATCHING_ENTRY_SOURCE_UNAVAILABLE']){
  const changed=structuredClone(lock);mutate(changed);assert.equal(daily.ownerDailyEntryResults(changed,now)[2].plan,null);
 }
 assert.equal(daily.ownerDailyEntryResults(lock,Date.parse(today+'T13:30:00+08:00'))[2].plan_state,'EXPIRED');
 assert.equal(daily.ownerDailyEntryResults(lock,Date.parse(at)-1)[2].plan,null);
});
test('actual Owner cards expose the saved three-model reasons and explain mismatched plans without reviving prices',async()=>{
 const data=await daily.parseOwnerDailyResearch(await fixture(),today,now),lock=entryDisplayControl(data.rows.find(row=>row.horizon==='LONG'));
 lock.entry[0].plan.not_before='2026-11-03';data.rows[data.rows.findIndex(row=>row.id===lock.id)]=lock;
 const html=render(data);
 assert.match(html,/查看進場判斷、價格與等待原因/);assert.match(html,/超跌反轉：進場資料不足/);
 assert.match(html,/突破延續：等待條件確認/);assert.match(html,/合成顯示控制：仍等待事件確認/);
 assert.match(html,/保存的價格計畫交易日與本次評估不一致/);assert(!html.includes('合成顯示控制：突破100'));
 assert.match(html,/中、長期頁籤不把這些價位當成公司合理估值/);assert(!html.includes('javascript:'));
});
test('actual Owner price rendering binds same-day range, no-chase and stop to its expiry boundary',async()=>{
 const data=await daily.parseOwnerDailyResearch(await fixture(),today,now),index=data.rows.findIndex(row=>row.horizon==='LONG');
 data.rows[index]=entryDisplayControl(data.rows[index]);displayNow=now;
 try{
  const html=render(data);assert.match(html,/100.00～101.00 元/);assert.match(html,/超過先等/);assert.match(html,/失效參考/);
  assert.match(html,/98.00 元/);assert.match(html,/合成顯示控制：跌至98或超價取消/);assert.match(html,/2.00：1/);
  assert.match(html,/失效價不保證可成交停損/);
  displayNow=Date.parse(today+'T13:30:00+08:00');const expired=render(data);
  assert.match(expired,/當日價格計畫已到期/);assert(!expired.includes('100.00～101.00 元'));assert(!expired.includes('合成顯示控制：跌至98'));
 }finally{displayNow=Date.now();}
});
test('new premarket engine prices reach Owner normalization without moving the session or substituting a horizon valuation',async()=>{
 const input=setup(await entryFixture(),'breakout'),evaluation=await evaluatePremarketEntry(input),candidate=evaluation.candidates[2];
 const data=await daily.parseOwnerDailyResearch(await fixture(),today,now),lock={...data.rows[0],symbol:candidate.symbol,
  business_date:input.business_date,evidence_cutoff:input.evaluation_time,locked_at:input.evaluation_time,
  entry_version:ENTRY_PREMARKET_VERSION,entry_gap:null,entry:evaluation.candidates};
 const result=daily.ownerDailyEntryResults(lock,Date.parse(input.evaluation_time)+1000)[2];
 assert.equal(result.status,'ENTRY_READY');assert.equal(result.plan_state,'AVAILABLE');
 assert.deepEqual(result.plan.range,candidate.plan.reference_range);assert.equal(result.plan.wait_above,candidate.plan.reference_range[1]);
 assert.equal(result.plan.stop,candidate.plan.stop);assert.equal(result.plan.valid_from,input.business_date+'T09:00:00+08:00');
 assert.equal(result.plan.valid_until,input.business_date+'T13:30:00+08:00');
});
