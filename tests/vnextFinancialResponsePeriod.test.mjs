// SYNTHETIC refusal controls, not official filing coverage or financial results.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFinancial,financialResponsePeriod} from '../src/features/vnext/dailyParsers.mjs';
import {parseFinancial as archiveParse} from '../scripts/vnext/stock-evidence.mjs';
import {normalizeSource,assembleDaily,acquisitionPlan} from '../src/features/vnext/dailyAdapter.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const at='2026-10-20T01:00:00.000Z';
const spec={kind:'FINANCIAL_YTD',year:2026,quarter:2,symbols:['2330'],exchange:'TWSE',
 url:'https://mopsov.twse.com.tw/mops/web/ajax_t163sb04'};
const body='<table><tr><th>公司代號</th><th>營業收入</th><th>基本每股盈餘（元）</th></tr><tr><td>2330</td><td>123</td><td>2.5</td></tr></table>';
const page=heading=>'公開資訊觀測站 上市公司'+heading+body;
for(const [name,parse] of [['runtime',parseFinancial],['archive',archiveParse]]){
 test(name+': response period is proved independently of request; YTD stays YTD',()=>{
  const r=parse(page('<h2>民國115年第2季</h2>'),spec,at).rows[0];
  assert.deepEqual(r.source_period,{year:2026,quarter:2});assert.equal(r.period,'2026-Q2');
  assert.equal(r.period_verification,'RESPONSE_REPORT_HEADING_MATCHED_REQUEST');
  assert.equal(r.standalone_quarter_actual,false);assert.equal(r.basis,'AS_REPORTED_YTD');
  assert.equal(r.values.eps,2.5);assert.equal(r.published_at,null);
  assert.equal(r.quarter_eps_derivation,'NOT_SUBTRACTED_WEIGHTED_SHARES_UNKNOWN');
 });
 test(name+': missing, mismatched and contradictory source periods refuse',()=>{
  const unproven=parse(page(''),spec,at);assert.equal(unproven.rows.length,0);
  assert.equal(unproven.unverified_rows.length,1);assert.equal(unproven.unverified_rows[0].period,null);
  assert.equal(unproven.unverified_rows[0].requested_period,'2026-Q2');
  assert.equal(unproven.unverified_rows[0].as_of,null);assert.equal(unproven.unverified_rows[0].values.eps,2.5);
  assert.equal(unproven.rejected[0].reason,'FINANCIAL_RESPONSE_PERIOD_UNPROVEN');
  assert.throws(()=>parse(page('<h2>114年第2季</h2>'),spec,at),/PERIOD_MISMATCH/);
  assert.throws(()=>parse(page('<h2>115年第1季</h2><h3>115年第2季</h3>'),spec,at),/PERIOD_CONFLICT/);
  assert.equal(parse(page('<input name="year" value="115"><input name="season" value="02">'),spec,at).rows.length,0);
  assert.throws(()=>parse('公開資訊觀測站 上市公司<h2>115年第2季</h2>',spec,at),/SOURCE_ROWS_EMPTY/);
 });
}
test('ROC/Gregorian and Chinese quarter labels match, malformed/oversized headings refuse',()=>{
 for(const label of ['民國 115 年第 二 季','2026 年第 2 季度'])assert.deepEqual(financialResponsePeriod('<h2>'+label+'</h2>'),{year:2026,quarter:2});
 assert.equal(financialResponsePeriod('<p>民國115年第2季</p>'),null);
 for(const tag of ['script','style','textarea','template'])assert.equal(financialResponsePeriod('<'+tag+'><h2>民國115年第2季</h2></'+tag+'>'),null);
 assert.equal(financialResponsePeriod('<!-- <h2>民國115年第2季</h2> -->'),null);
 assert.equal(financialResponsePeriod('<script>const a="<h2>115年第2季</h2>";</script>'),null);
 assert.throws(()=>financialResponsePeriod('<h2>115年第2季</h3>'),/HEADING_STRUCTURE/);
 assert.throws(()=>financialResponsePeriod('<h2>'+('x'.repeat(4097))+'</h2>'),/HEADING_LIMIT/);
 assert.throws(()=>financialResponsePeriod('<h2>x</h2>'.repeat(101)),/HEADING_LIMIT/);
});
test('actual runtime normalization and 72-stock assembly keep matching YTD distinct from Actual',async()=>{
 const task={...spec,key:'synthetic-source-task',format:'text',scope:'SYNTHETIC',max_age_days:1,financial_response_contract:'MOPS_RESPONSE_PERIOD_V1'};
 await assert.rejects(normalizeSource(task,page('<h2>115年第1季</h2>'),at),/PERIOD_MISMATCH/);
 const payload=await normalizeSource(task,page('<h2>115年第2季</h2>'),at);
 const receipt={task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:'SYNTHETIC',
  raw_hash:'a'.repeat(64),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};
 const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成控制',exchange:'TWSE',industry:'24'}));
 const out=await assembleDaily('2026-10-20',companies,[receipt],at);
 assert.equal(out.inputs.length,72);const facts=out.inputs.find(r=>r.symbol==='2330').facts;
 assert.equal(facts.length,1);assert.equal(facts[0].basis,'AS_REPORTED_YTD');
 assert(!facts.some(f=>f.kind==='EPS'||f.basis==='SINGLE_QUARTER'));
 assert.equal(out.entry.stocks.find(r=>r.symbol==='2330').fundamental,null);
 const legacy=structuredClone(receipt);delete legacy.task.financial_response_contract;
 const unproven=await assembleDaily('2026-10-20',companies,[legacy],at);
 assert.equal(unproven.inputs.find(r=>r.symbol==='2330').facts.length,0);
 assert.deepEqual(unproven.source_issues,[{kind:'FINANCIAL_YTD',key:task.key,reason:'FINANCIAL_RESPONSE_PERIOD_UNPROVEN'}]);
 assert.equal(receipt.payload.rows.length,1); // Never overwrite or erase old receipts.
 const plan=await acquisitionPlan('2026-10-20',companies);
 const task2=plan.find(t=>t.kind==='FINANCIAL_YTD'&&t.year===2026&&t.quarter===2);
 assert.equal(task2.financial_response_contract,'MOPS_RESPONSE_PERIOD_V1');
 const {key,financial_response_contract,...oldTask}=task2;void financial_response_contract;
 assert.notEqual(key,await snapshotHash(oldTask)); // New cache identity, not a rewritten old key.
 assert.equal(plan.filter(t=>t.financial_response_contract).length,40);
});
