import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';

const source=readFileSync(new URL('../supabase/functions/ma-ops-health-check/index.ts',import.meta.url),'utf8');
const makeCheck=isolatedFunction(source,'makeCheck');
const summarizeProductionBusinessHealth=isolatedFunction(source,'summarizeProductionBusinessHealth');
const asObject=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const nonEmptyString=v=>typeof v==='string'&&v.trim().length>0;
const fetchPublishedHealthDecision=isolatedFunction(source,'fetchPublishedHealthDecision',{withTimeout:p=>p,asObject,nonEmptyString});
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
  const attach=isolatedFunction(source,'attachDailyHealthTrace',{withTimeout:p=>p,asArray:v=>Array.isArray(v)?v:[],asObject:v=>v&&typeof v==='object'?v:{},summarizeProductionBusinessHealth});
  const db={from(table){const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},then(resolve){return Promise.resolve({data:table==='pipeline_runs'?[{status:'FAILED',attempt:2,started_at:'2026-09-08T01:00:00Z'}]:null,error:null}).then(resolve);}};return query;}};
  const result=await attach(db,{target_date:'2026-09-08'},{checks:[{check_name:'opening-radar-exists',status:'failed',error_code:'RADAR_MISSING'}]});
  assert.equal(result.daily_health.stages.Checkpoint,'FAIL');
  assert.equal(result.daily_health.first_failure_stage,'Checkpoint');
  assert.equal(result.daily_health.error_code,'RADAR_MISSING');
  assert.equal(result.daily_health.retry_count,1);
  assert.equal(result.daily_health.stages.Acceptance,'WAITING');
  assert.equal(result.daily_health.production_business_health.status,'FAIL');
  assert.equal(result.daily_health.production_business_health.today_all_pass,'NO');
  assert.equal(result.daily_health.engineering_release.status,'NOT_EVALUATED');
});

const completeBusinessStages=()=>Object.fromEntries([
  'Market Data','Research','Editorial','Semantic','Decision','Publication','Delivery',
  'Checkpoint','Frontend','Closing','Learning','Acceptance',
].map(stage=>[stage,'PASS']));

test('Draft/Open PR or internal QA cannot turn actual Production business PASS into failure',()=>{
  const stages=completeBusinessStages();
  const expected=summarizeProductionBusinessHealth(stages);
  assert.equal(expected.status,'PASS');
  assert.equal(expected.today_all_pass,'YES');
  for(const release of ['DRAFT','OPEN','BLOCKED','FAIL']) {
    const actual=summarizeProductionBusinessHealth({...stages,'GitHub PR':release,'Engineering Release':release,'Internal QA':'FAIL','Recommendation':'BLOCKED'});
    assert.deepEqual(actual,expected);
  }
});

test('engineering success cannot hide real Publication/Delivery/Acceptance failures or unobserved stages',()=>{
  for(const stage of ['Publication','Delivery','Acceptance']) {
    const result=summarizeProductionBusinessHealth({...completeBusinessStages(),[stage]:'FAIL','Engineering Release':'PASS'});
    assert.equal(result.status,'FAIL');
    assert.equal(result.today_all_pass,'NO');
    assert.deepEqual(Array.from(result.failed_stages),[stage]);
  }
  const missing=summarizeProductionBusinessHealth({...completeBusinessStages(),Frontend:'WAITING','Engineering Release':'PASS'});
  assert.equal(missing.status,'WAITING');
  assert.equal(missing.today_all_pass,'PENDING');
  assert.equal(summarizeProductionBusinessHealth({}).status,'WAITING');
});

test('health keeps published market revision even when newer internal QA is current and blocked',async()=>{
  const rows=[
    {id:'published-9-8',report_id:'report-9-8',report_date:'2026-09-08',status:'READY',decision_mode:'no_trade',content_score:92,is_current:false,version:1},
    {id:'qa-9-8',report_id:'report-9-8',report_date:'2026-09-08',status:'PARTIAL',decision_mode:'blocked',content_score:79,is_current:true,version:2,session_type:'PREMARKET'},
  ];
  const db={from(table){assert.equal(table,'decision_snapshots');const filters={};const query={
    select(){return query;},eq(k,v){filters[k]=v;return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},
    then(resolve){return Promise.resolve({error:null,data:rows.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v)).sort((a,b)=>b.version-a.version)[0]||null}).then(resolve);},
  };return query;}};
  const report={id:'report-9-8',ai_strategy_json:{revision_id:'published-9-8'}};
  assert.equal((await fetchPublishedHealthDecision(db,report,'2026-09-08')).id,'published-9-8');
  assert.equal(await fetchPublishedHealthDecision(db,{...report,id:'another-report'},'2026-09-08'),null);
  assert.equal(await fetchPublishedHealthDecision(db,{...report,ai_strategy_json:{revision_id:'missing-published'}},'2026-09-08'),null);
  assert.equal(await fetchPublishedHealthDecision(db,report,'2026-09-06'),null);
});

test('actual report-health handler admits Market PASS + Recommendation BLOCKED but never Market FAIL',async()=>{
  // Isolated contract fixture: market/recommendation evaluators are independently
  // covered by their gate suites; this executes the real health handler routing.
  const report={id:'report-9-8',report_date:'2026-09-08',market_bias:'中性',confidence_score:60,
    report_mode:'normal_overnight',today_quote:'先看開盤後加權指數與台積電量能是否同步，09:30 確認前不追價。',
    ai_strategy_json:{revision_id:'published-9-8',is_trading_day:true,market_status:'OPEN',content_evidence_quality:{verified_news_count:0,verified_market_count:3}},
  };
  const snapshot={id:'published-9-8',status:'READY',decision_mode:'no_trade',content_score:92};
  let eligible=true;
  const reportHandlers=isolatedFunction(source,'handlers',{
    withTimeout:p=>p,makeCheck,Date,asObject,nonEmptyString,asArray:v=>Array.isArray(v)?v:[],
    fetchReport:async()=>report,fetchPublishedHealthDecision:async()=>snapshot,
    isActionableResearchSentence:isolatedFunction(source,'isActionableResearchSentence',{nonEmptyString}),
    evaluatePremiumContentGate:()=>({status:'BLOCKED',content_score:22,decision_mode:'blocked',reason_codes:['member_depth_insufficient']}),
    evaluateMarketReportGate:()=>({eligible,status:eligible?'READY':'BLOCKED',recommendation_status:'BLOCKED',reason_codes:eligible?[]:['market_evidence_incomplete']}),
  });
  const result=await reportHandlers['daily-report-contract']({supabase:{},targetDate:'2026-09-08'});
  assert.equal(result.status,'passed');
  assert.equal(result.actual_state.recommendation_status,'BLOCKED');
  assert.equal(result.actual_state.premium_content_status,'BLOCKED');
  assert.equal(result.actual_state.current_revision,'published-9-8');
  eligible=false;
  const blocked=await reportHandlers['daily-report-contract']({supabase:{},targetDate:'2026-09-08'});
  assert.equal(blocked.status,'failed');
  assert.ok(blocked.actual_state.missing_fields.includes('market_report_gate'));
});
