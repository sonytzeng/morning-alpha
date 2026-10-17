import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
import {getSubscriberReportProjection} from '../src/lib/subscriberReportProjection.ts';
import {resolveMarketStatus} from '../src/lib/market-status.ts';
import {subscriberProjectionFixture} from './fixtures/subscriber-projection-v1.mjs';

const source=readFileSync(new URL('../src/hooks/useAccountDashboard.ts',import.meta.url),'utf8');
const today='2026-10-17', previous='2026-10-16';
const helpers={getSubscriberReportProjection,resolveMarketStatus,isTaipeiToday:()=>today,exports:{}};
for(const name of ['asRecord','asRecords','firstText','latestTimestamp','getAccountIntradayView','computeStreakFromReports','accountFallbackDate'])
 helpers[name]=isolatedFunction(source,name,helpers);
const report=(date=previous,state='READY')=>{
 const body=subscriberProjectionFixture(state,{todayDate:date});
 return {...body,id:body.revision_id,created_at:body.generated_at,ai_strategy_json:body};
};
async function load({current=null,history=[{report_date:previous}],fallback=report()}={}){
 const calls=[];
 const fn=isolatedFunction(source,'loadAccountDashboard',{
  ...helpers,
  getTodayReport:async()=>{calls.push('today');return current;},
  getLatestReports:async n=>{calls.push(`history:${n}`);return history;},
  getReportByDate:async date=>{calls.push(`reader:${date}`);return fallback;},
  isDateTaipeiToday:value=>typeof value==='string'&&value.slice(0,10)===today,
 });
 return {data:await fn(),calls};
}

test('missing Saturday report reads one real indexed Friday through the existing Reader, not the summary',async()=>{
 const {data,calls}=await load();
 assert.deepEqual(calls,['today','history:30',`reader:${previous}`]);
 assert.equal(data.todayReport.report_date,previous);
 assert.equal(data.hasTodayReport,false);
 assert.equal(data.streak,0);
 assert.equal(data.hasIntradayData,false);
 assert.equal(data.isIntradayToday,false);
 assert.equal(data.error,null);
});
test('history rejects future, impossible, holiday and invalid dates without extra requests',async()=>{
 const {data,calls}=await load({history:[{report_date:'2026-10-19'},{report_date:today},{report_date:'2026-02-31'},{report_date:'2026-10-09'},{report_date:'bad'}]});
 assert.equal(data.todayReport,null);
 assert.deepEqual(calls,['today','history:30']);
});
test('fallback Reader denial, partial, wrong date and future payload cannot restore a history summary',async()=>{
 for(const fallback of [null,report(previous,'PARTIAL'),report('2026-10-15'),report('2026-10-19')]){
  const {data,calls}=await load({fallback});
  assert.equal(data.todayReport,null);
  assert.equal(data.hasTodayReport,false);
  assert.equal(calls.length,3);
 }
});
test('a current partial or ready report is never hidden by a successful historical fallback',async()=>{
 for(const state of ['PARTIAL','READY']){
  const current=report(today,state),{data,calls}=await load({current});
  assert.equal(data.todayReport,current);
  assert.deepEqual(calls,['today','history:30']);
 }
});
test('history order cannot select an older report and lookup remains bounded to one date',async()=>{
 const {data,calls}=await load({history:[{report_date:'2026-10-15'},{report_date:previous},{report_date:previous}]});
 assert.equal(data.todayReport.report_date,previous);
 assert.deepEqual(calls,['today','history:30',`reader:${previous}`]);
});
test('account non-trading labels use the existing official calendar including weekday holidays',()=>{
 const text=readFileSync(new URL('../src/pages/account/Account.tsx',import.meta.url),'utf8');
 const closed=isolatedFunction(text,'isTaipeiWeekend',{resolveMarketStatus,isTaipeiToday:()=> '2026-10-09',exports:{}});
 assert.equal(closed(),true);
 assert.equal(isolatedFunction(text,'isTaipeiWeekend',{resolveMarketStatus,isTaipeiToday:()=>previous,exports:{}})(),false);
 assert.equal(isolatedFunction(text,'isTaipeiWeekend',{resolveMarketStatus,isTaipeiToday:()=> '2027-01-04',exports:{}})(),false);
});
