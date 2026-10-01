import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateOperationalCore, evaluateOperationalMarket, evaluateOperationalAvailability,
  operationalRecommendationStatus } from '../supabase/functions/_shared/operational-market-contract.mjs';
import {buildCriticalContractCapsule,replayCriticalContract} from '../supabase/functions/_shared/critical-contract-recorder.ts';
import {getSubscriberReportProjection} from '../src/lib/subscriberReportProjection.ts';
import {subscriberProjectionFixture} from './fixtures/subscriber-projection-v1.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/operational-market-core-20261001.json', import.meta.url)));
const core = () => structuredClone(fixture.core);
const evaluate = enhancements => evaluateOperationalMarket({core:core(),enhancements});

test('10/1 retained Atomic evidence is core READY; both actual unqualified-news attempts are DEGRADED, not fabricated FULL', () => {
  for (const attempt of fixture.research_attempts) {
    const result = evaluate(attempt);
    assert.equal(result.core_market.status,'READY');
    assert.equal(result.report_level,'DEGRADED');
    assert.equal(result.recommendation_status,'BLOCKED');
    assert.deepEqual(result.missing_evidence,['NEWS_CONTEXT']);
  }
  assert.equal(fixture.historical_result,'FAIL_UNCHANGED');
});
test('qualified news and sector are FULL; absent sector is explicitly DEGRADED', () => {
  assert.equal(evaluate({news_count:1,sector_count:4,missing_sources:[]}).report_level,'FULL');
  const missing = evaluate({news_count:1,sector_count:0,missing_sources:['sector_rotation_scores:2026-09-30']});
  assert.equal(missing.report_level,'DEGRADED');
  assert.deepEqual(missing.unavailable_sections,['SECTOR_ROTATION']);
});
const corruptions = {
  '10/11': x => x.rows.pop(),
  'Atomic failure': x => x.integrity.status='FAIL',
  'duplicate batch': x => x.integrity.committed_batch_count=2,
  'mixed batch': x => x.rows[0].batch_id='10000000-0000-4000-8000-000000000001',
  'mixed correlation': x => x.rows[0].correlation_id='10000000-0000-4000-8000-000000000001',
  'wrong business date': x => x.rows[0].trading_date='2026-09-30',
  'wrong checkpoint': x => x.rows[0].checkpoint='0930',
  'stale core': x => x.rows[0].source_timestamp='2026-09-28T05:30:00Z',
  'future core': x => x.rows[0].source_timestamp='2026-10-01T05:30:00Z',
  'wrong session': x => x.rows[0].raw.tw_cash_provider_session_date='2026-09-29',
  'integrity mismatch': x => x.integrity.compatibility_mismatch_count=1,
  'missing proof': x => x.integrity={},
  'forged payload hash': x => x.batch.payload_hash='00000000000000000000000000000000',
};
for(const [name,mutate] of Object.entries(corruptions)) test(name+' cannot degrade-publish',()=>{
  const input=core(); mutate(input);
  const result=evaluateOperationalMarket({core:input,enhancements:{news_count:1,sector_count:4,missing_sources:[]}});
  assert.equal(result.core_market.status,'BLOCKED');
  assert.equal(result.report_level,'CORE_FATAL');
  assert.equal(result.publication_status,'BLOCKED');
});
test('NONE is an evaluated universe, never a missing recommendation list',()=>{
  assert.equal(operationalRecommendationStatus({status:'NO_QUALIFIED_OPPORTUNITY'}),'BLOCKED');
  assert.equal(operationalRecommendationStatus({status:'NO_QUALIFIED_OPPORTUNITY',eligible:false,
    universe_evaluation_complete:true,screening:{status:'COMPLETE',universe_count:12,evaluated_count:12,rejected:[]}}),'NONE');
  assert.equal(operationalRecommendationStatus({status:'QUALIFIED',eligible:true,reason_codes:[]}),'READY');
});
test('availability never confuses recommendation/learning or 07:30 SLA with core service',()=>{
  const operational=evaluate(fixture.research_attempts[0]);
  for(const recommendation_status of ['READY','NONE','BLOCKED']){
    const state=evaluateOperationalAvailability({operational:{...operational,recommendation_status},publication_verified:true,
      normal_line_count:1,line_receipt_verified:true,closing_status:'PASS',learning_status:'FAIL',delivery_sla:'MISS'});
    assert.equal(state.service_available,true);
    assert.equal(state.dimensions.LEARNING,'LEARNING_DEGRADED');
    assert.equal(state.dimensions.DATA_SLA,'MISS');
    assert.equal(state.dimensions.RECOMMENDATION,recommendation_status);
  }
  assert.equal(evaluateOperationalAvailability({operational,publication_verified:true,normal_line_count:0}).service_available,false);
});
test('previous-day FULL/DEGRADED/CORE_FATAL outcome cannot poison current core',()=>{
  for(const previous_day_outcome of ['FULL','DEGRADED','CORE_FATAL']){
    assert.equal(evaluateOperationalCore({...core(),previous_day_outcome}).status,'READY');
  }
});
test('unknown optional research gap remains disclosed, not a second hidden core gate',()=>{
 const result=evaluate({news_count:1,sector_count:4,missing_sources:['optional_research:unavailable']});
 assert.equal(result.core_market.status,'READY');assert.equal(result.report_level,'DEGRADED');
 assert.deepEqual(result.missing_evidence,['RESEARCH_ENHANCEMENT']);
});
test('retained historical Atomic state is not rewritten or fabricated into a modern successful day',()=>{
 const history=JSON.parse(readFileSync(new URL('./fixtures/operational-market-historical-20261001.json',import.meta.url)));
 assert.equal(history.history_rewritten,false);assert.equal(history.raw_http_response_retained,false);
 for(const entry of history.cases){
  const input=structuredClone(entry);
  input.core.observed_at=input.core.batch?.committed_at
   ? new Date(Date.parse(input.core.batch.committed_at)+60000).toISOString():input.core.observed_at;
  const result=evaluateOperationalMarket(input);
  assert.equal(result.report_level,input.core.business_date==='2026-09-30'?'DEGRADED':'CORE_FATAL',input.core.business_date);
  if(input.core.business_date==='2026-09-18')assert(result.reason_codes.includes('TW_CASH_FUTURE_SESSION'),
   'Legacy date-only envelope is not proof of latest-completed session; no guessed repair');
 }
});
test('FULL/DEGRADED/CORE_FATAL Recorder uses the actual validator and deterministic projections',()=>{
 for(const level of ['FULL','DEGRADED','CORE_FATAL']){
  const input={core:core(),enhancements:{news_count:level==='FULL'?1:0,sector_count:4,missing_sources:level==='FULL'?[]:['market_news']}};
  // SQL inspection transports timestamps as PG text; production PostgREST
  // gives the same instants as ISO strings. Preserve the retained file itself.
  input.core.batch.committed_at=new Date(input.core.batch.committed_at).toISOString();
  for(const row of input.core.rows)for(const key of ['source_timestamp','captured_at'])row[key]=new Date(row[key]).toISOString();
  if(level==='CORE_FATAL')input.core.integrity.status='FAIL';
  const capsule=buildCriticalContractCapsule('RESEARCH',{schema_version:'OPERATIONAL_MARKET_REPLAY_V1',input});
  assert.equal(capsule.expected.report_level,level);
  assert.deepEqual(replayCriticalContract('RESEARCH',capsule.input),capsule.expected);
 }
});
test('subscriber full/degraded notices preserve published identity and never display engineering codes',()=>{
 for(const report_level of ['FULL','DEGRADED']){
  const row=subscriberProjectionFixture('MARKET_READY_RECOMMENDATION_BLOCKED');
  row.operational_market={contract_version:'OPERATIONAL_MARKET_V1',business_date:row.report_date,
   market_decision:'READY',report_level,missing_evidence:report_level==='FULL'?[]:['NEWS_CONTEXT','SECTOR_ROTATION']};
  const result=getSubscriberReportProjection(row,{todayDate:row.report_date});
  assert.equal(result.analysisAvailable,true);assert.equal(result.reportLevel,report_level);
  assert.equal(result.recommendation.available,false);
  assert.doesNotMatch(result.statusLabel+(result.researchNotice||''),/CORE_|RESEARCH_|PUBLICATION_|ATOMIC_/);
  if(report_level==='DEGRADED')assert.match(result.researchNotice,/合格市場新聞.*類股輪動資料/);
  row.operational_market.business_date='1900-01-01';
  assert.equal(getSubscriberReportProjection(row,{todayDate:row.report_date}).reportLevel,undefined);
 }
});
