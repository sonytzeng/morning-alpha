// Source scheduling controls only. No Provider, Production write or strategy proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionPlan,sessionsBefore} from '../src/features/vnext/dailyAdapter.ts';
import {RESEARCH_RULES} from '../src/features/vnext/researchFunnel.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const companies=RECOMMENDATION_UNIVERSE.map((symbol,i)=>({symbol,company:'SYNTHETIC scheduling control',exchange:i<3?'TPEX':'TWSE',industry:'24'}));
// Captured from the unchanged fda6d637 acquisitionPlan before this repair.
const baselines={
 '2026-10-12':[1532,'66553c9efb44d72b19ab2b9710b4694eed4184b3751bdb604d43abff8e49a36b','c0868b654e78a12f76a10519d0c47497beaf94a1c738c73d95cbe002976d91fd'],
 '2026-10-19':[1462,'6a9f84c73f93ae3cec8cdfb01324acf708c1a5a583ab9e03c263aee950fcacde','4e58b5bfc0eb1633697045f24375af6cf298bdf219b1c85dc6a9d0dfb6c74656'],
 '2026-11-02':[1462,'f2a9d728babdd7780cf45cf5c7d9c32eec0511840ab27a3dc6ec6a018dfd7b7c','750774357b2afd407910e9cd88e0fec285dd74106b4d6b467f2890a8f38c50df'],
};
// Explicit new-calendar expectation; the original pre-exception baselines stay above.
const correctedCalendarBaselines={'2026-11-02':[1462,'db043b47a45ded528494c6ed22a3ea357b237b3069dc0dcccb924bd645ee12fe','609098f8d533df60e252650fad565dd347ac3e848f74f139dba6b8c7250d93be']};
test('cold ordering preserves original tasks with 40 financial contracts and one explicitly versioned current index source',async()=>{
 for(const [date,[count,keys,tasks]] of Object.entries(baselines)){
  const plan=await acquisitionPlan(date,companies);
  assert.equal(plan.length,count);assert.equal(new Set(plan.map(t=>t.key)).size,count);
  const legacy=await Promise.all(plan.map(async t=>{
   if(t.benchmark_response_contract){
    assert.equal(t.kind,'BENCHMARK');assert.equal(t.benchmark_response_contract,'TWSE_OPENAPI_INDEX_V1');
    assert.equal(t.url,'https://openapi.twse.com.tw/v1/indicesReport/MI_5MINS_HIST');
    const {key,benchmark_response_contract,...before}=t;void benchmark_response_contract;
    before.url=`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date=${t.month.replace('-','')}01&response=json`;
    const oldKey=await snapshotHash(before);assert.notEqual(key,oldKey);return {...before,key:oldKey};
   }
   if(!['FINANCIAL_YTD','CASHFLOW_YTD'].includes(t.kind)){assert(!Object.hasOwn(t,'financial_response_contract'));return t;}
   assert.equal(t.financial_response_contract,'MOPS_RESPONSE_PERIOD_V1');
   const {key,financial_response_contract,...before}=t;void financial_response_contract;
   const oldKey=await snapshotHash(before);assert.notEqual(key,oldKey);
   return {...before,key:oldKey};
  }));
  assert.equal(plan.filter(t=>t.financial_response_contract).length,40);
  assert.equal(plan.filter(t=>t.benchmark_response_contract).length,1);
  const corrected=correctedCalendarBaselines[date];
  if(corrected){assert.equal(count,corrected[0]);assert(!plan.some(t=>t.date==='2026-10-23'));assert(sessionsBefore(date).includes('2026-10-22'));}
  assert.equal(await snapshotHash(legacy.map(t=>t.key).sort()),corrected?.[1]??keys);
  assert.equal(await snapshotHash([...legacy].sort((a,b)=>a.key.localeCompare(b.key))),corrected?.[2]??tasks);
 }
});
test('all 72 latest20 windows and TAIEX precede MEDIUM, which precedes deep price bootstrap',async()=>{
 for(const date of Object.keys(baselines)){
  const plan=await acquisitionPlan(date,companies),dates=sessionsBefore(date).slice(-20),months=new Set(dates.map(d=>d.slice(0,7)));
  const warm=plan.filter(t=>t.kind==='OTC_PRICE'?dates.includes(t.date):['PRICE','BENCHMARK'].includes(t.kind)&&months.has(t.month));
  const lastWarm=Math.max(...warm.map(t=>plan.indexOf(t)));
  assert.equal(lastWarm+1,warm.length,'no unrelated task interrupts the complete 72-stock window');
  for(const c of companies.filter(c=>c.exchange==='TWSE'))for(const month of months)assert(warm.some(t=>t.kind==='PRICE'&&t.month===month&&t.symbols.includes(c.symbol)));
  for(const d of dates)assert(warm.some(t=>t.kind==='OTC_PRICE'&&t.date===d));
  for(const month of months)assert(warm.some(t=>t.kind==='BENCHMARK'&&t.month===month));
  const periods=[...new Set(plan.filter(t=>t.kind==='REVENUE').map(t=>t.period))].sort().slice(-RESEARCH_RULES.medium_months);
  const instDates=dates.slice(-RESEARCH_RULES.medium_institutional_sessions);
  const medium=plan.filter(t=>t.kind==='REVENUE'&&periods.includes(t.period)||t.kind==='INSTITUTIONAL'&&instDates.includes(t.date));
  assert.equal(medium.length,2*(RESEARCH_RULES.medium_months+RESEARCH_RULES.medium_institutional_sessions));
  const lastMedium=Math.max(...medium.map(t=>plan.indexOf(t)));
  assert(medium.every(t=>plan.indexOf(t)>lastWarm));assert.equal(lastMedium+1,warm.length+medium.length);
  const deep=plan.filter(t=>t.kind==='OTC_PRICE'?!dates.includes(t.date):['PRICE','BENCHMARK'].includes(t.kind)&&!months.has(t.month));
  assert(deep.length>0&&deep.every(t=>plan.indexOf(t)>lastMedium));
  assert(plan.filter(t=>['EVENT','FINANCIAL_YTD','CASHFLOW_YTD','ACTION'].includes(t.kind)).every(t=>plan.indexOf(t)>lastMedium&&plan.indexOf(t)<plan.indexOf(deep[0])));
 }
});
test('warm-cache planning and calendar refusal stay deterministic, never create substitute facts',async()=>{
 const first=await acquisitionPlan('2026-10-19',companies),again=await acquisitionPlan('2026-10-19',companies);
 assert.deepEqual(first,again);assert(first.every(t=>!Object.hasOwn(t,'payload')&&!Object.hasOwn(t,'published_at')));
 assert.equal(first.filter(t=>t.kind==='EVENT').length,144);
 assert.equal(first.filter(t=>t.kind==='FINANCIAL_YTD').length,20);
 assert.equal(first.filter(t=>t.kind==='CASHFLOW_YTD').length,20);
 await assert.rejects(()=>acquisitionPlan('2026-10-09',companies),/CALENDAR_SCOPE/);
});
