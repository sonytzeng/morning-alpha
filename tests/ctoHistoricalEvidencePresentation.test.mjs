import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {historicalReportEvidencePresentation} from '../src/lib/historicalReportEvidencePresentation.ts';
import {getSubscriberReportProjection} from '../src/lib/subscriberReportContract.ts';
import {subscriberProjectionFixture} from './fixtures/subscriber-projection-v1.mjs';

// Isolated wire controls, not a Production report, identity or market result.
const saved=()=>{
 const row=subscriberProjectionFixture('MARKET_READY_RECOMMENDATION_BLOCKED');
 row.canonical_decision.version=1;
 row.member_research_note_v2={canonical_contract:{snapshot_id:row.revision_id,report_date:row.report_date,snapshot_version:1,validation_checkpoint:'09:30'},
  intraday_validation:['核對來源所列的價格與成交量條件'],
  invalidation_conditions:[{condition:'來源條件失效：反向變動超過 1.25%',action_note:'取消原本的觀察計畫'}]};
 return row;
};
test('historical detail retains explicit canonical time and thresholds, never derives rules from bias',()=>{
 const row=saved(),result=historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true}));
 assert.deepEqual(result.steps.map(x=>x.time),['09:30']);
 assert.deepEqual(result.confirmations,['核對來源所列的價格與成交量條件']);
 assert.deepEqual(result.invalidations,['來源條件失效：反向變動超過 1.25%；取消原本的觀察計畫']);
 row.market_bias='偏空';row.canonical_decision.market_bias='偏空';
 assert.deepEqual(historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true})).confirmations,result.confirmations);
 assert.doesNotMatch(JSON.stringify(result),/09:15|0\.5%|開盤 15 分鐘/);
});
test('missing saved conditions and missing explicit time are not filled with generic market instructions',()=>{
 const row=saved();delete row.member_research_note_v2;
 assert.deepEqual(historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true})),{confirmations:[],invalidations:[],steps:[]});
 row.member_research_note_v2=saved().member_research_note_v2;
 delete row.member_research_note_v2.canonical_contract.validation_checkpoint;
 row.member_research_note_v2.intraday_validation=['來源未提供時間的條件'];
 assert.equal(historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true})).steps[0].time,'');
});
test('unpublished analysis or a different source revision cannot supply a historical condition',()=>{
 const row=saved(),projection=getSubscriberReportProjection(row,{historical:true});
 const other=structuredClone(projection);other.identity.revisionId='different-source';
 assert.deepEqual(historicalReportEvidencePresentation(row,other),{confirmations:[],invalidations:[],steps:[]});
 const blocked=subscriberProjectionFixture('BLOCKED');blocked.member_research_note_v2=row.member_research_note_v2;
 assert.deepEqual(historicalReportEvidencePresentation(blocked,getSubscriberReportProjection(blocked,{historical:true})),{confirmations:[],invalidations:[],steps:[]});
});
test('actual detail page uses saved conditions and separates unavailable stocks from market report publication',()=>{
 const page=readFileSync(new URL('../src/pages/reports/ReportDetail.tsx',import.meta.url),'utf8');
 assert.match(page,/historicalReportEvidencePresentation\(report, projection\)/);
 assert.doesNotMatch(page,/deriveCheckpoints|開盤 15 分鐘|反向波動超過 1%|09:15 開盤確認/);
 assert.match(page,/沒有推薦不代表市場報告未完成/);
 assert.match(page,/!premiumAvailability\.eligible/);
 assert.match(page,/<details><summary[^>]*>查看個股研究資料限制/);
 assert.match(page,/memberResearchDegraded = !projection\.recommendation\.available/);
 assert.match(page,/未提供逐項缺失原因，不自行推定/);
});
test('an inner canonical contract cannot reuse the outer report authority for another snapshot, date or version',()=>{
 for(const patch of [{snapshot_id:'another-snapshot'},{report_date:'2026-09-08'},{snapshot_version:2},{snapshot_version:0},{snapshot_version:'1'}]){
  const row=saved();row.canonical_decision.version=1;
  Object.assign(row.member_research_note_v2.canonical_contract,{snapshot_id:row.revision_id,report_date:row.report_date,snapshot_version:1},patch);
  assert.deepEqual(historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true})),{confirmations:[],invalidations:[],steps:[]});
 }
 const row=saved();row.canonical_decision.version=1;
 Object.assign(row.member_research_note_v2.canonical_contract,{snapshot_id:row.revision_id,report_date:row.report_date,snapshot_version:1});
 assert.equal(historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true})).steps[0].time,'09:30');
 delete row.canonical_decision.version;
 assert.deepEqual(historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true})),{confirmations:[],invalidations:[],steps:[]});
});
test('the real reader public skeleton is not presented as a saved historical observation',()=>{
 const row=saved();row.member_research_note_v2={intraday_validation:[{time_window:'09:30',what_to_watch:'開盤驗證'},{time_window:'10:30',what_to_watch:'主線確認'},{time_window:'13:00',what_to_watch:'盤中追蹤'}]};
 assert.deepEqual(historicalReportEvidencePresentation(row,getSubscriberReportProjection(row,{historical:true})),{confirmations:[],invalidations:[],steps:[]});
 const reader=readFileSync(new URL('../supabase/functions/get-report-payload/index.ts',import.meta.url),'utf8');
 assert.match(reader,/member_research_note_v2: marketPublished \? buildPublicValidationSkeleton\(\)/);
});
