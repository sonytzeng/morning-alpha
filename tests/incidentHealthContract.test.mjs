import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';

const source=readFileSync(new URL('../supabase/functions/ma-ops-health-check/index.ts',import.meta.url),'utf8');
const makeCheck=isolatedFunction(source,'makeCheck');
const handlers=isolatedFunction(source,'handlers',{withTimeout:p=>p,makeCheck,Date});
const database=(daily,incident,failed=0)=>({from(table){
  assert.equal(table,'line_delivery_outbox');
  const filters={};
  const query={select(){return query;},eq(k,v){filters[k]=v;return query;},then(resolve){
    const count=filters.status==='FAILED'?failed:filters.status!=='SENT'?0:filters.push_type==='daily_report'?daily:filters.push_type==='data_incident'?incident:daily+incident;
    return Promise.resolve({count,error:null}).then(resolve);
  }};return query;
}});
test('health never labels an incident-only receipt as successful daily-report delivery',async()=>{
  const result=await handlers['line-push-delivery']({supabase:database(0,3),targetDate:'2026-09-08'});
  assert.equal(result.status,'failed');assert.equal(result.error_code,'NORMAL_REPORT_NOT_DELIVERED');
  assert.equal(result.actual_state.sent_incident_count,3);assert.equal(result.actual_state.sent_premium_count,0);
});
test('actual normal receipt passes; pending or exhausted delivery remains non-PASS',async()=>{
  assert.equal((await handlers['line-push-delivery']({supabase:database(3,0),targetDate:'2026-09-08'})).status,'passed');
  assert.equal((await handlers['line-push-delivery']({supabase:database(0,0),targetDate:'2026-09-08'})).status,'warning');
  assert.equal((await handlers['line-push-delivery']({supabase:database(3,0,1),targetDate:'2026-09-08'})).status,'failed');
});
test('market health is gated by canonical market evidence, not paid-note depth',()=>{
  assert.match(source,/isTradingDay && !reportGate\.eligible \? "market_report_gate"/);
  assert.doesNotMatch(source,/isTradingDay && !premiumGate\.eligible/);
  assert.match(source,/premium_gate_independent: true/);
  assert.match(source,/premium_reason_codes: premiumGate.reason_codes/);
});
test('daily trace cannot hide a live checkpoint failure while acceptance is not yet available',async()=>{
  const attach=isolatedFunction(source,'attachDailyHealthTrace',{withTimeout:p=>p,asArray:v=>Array.isArray(v)?v:[],asObject:v=>v&&typeof v==='object'?v:{}});
  const db={from(table){const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},then(resolve){return Promise.resolve({data:table==='pipeline_runs'?[{status:'FAILED',attempt:2,started_at:'2026-09-08T01:00:00Z'}]:null,error:null}).then(resolve);}};return query;}};
  const result=await attach(db,{target_date:'2026-09-08'},{checks:[{check_name:'opening-radar-exists',status:'failed',error_code:'RADAR_MISSING'}]});
  assert.equal(result.daily_health.stages.Checkpoint,'FAIL');
  assert.equal(result.daily_health.first_failure_stage,'Checkpoint');
  assert.equal(result.daily_health.error_code,'RADAR_MISSING');
  assert.equal(result.daily_health.retry_count,1);
  assert.equal(result.daily_health.stages.Acceptance,'WAITING');
});
