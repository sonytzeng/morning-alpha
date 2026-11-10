import test from 'node:test';
import assert from 'node:assert/strict';
import {bindDailyAiPriceProfile} from '../research/daily-ai-price-profile.ts';
import {calculateDailyAiPricePlan} from '../research/daily-ai-price-calculation.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

const now=Date.parse('2026-11-11T00:01:00Z');
const evidence=(id,kind,data,date='2026-11-09',symbol='2330')=>({id,kind,symbol,source:'https://www.twse.com.tw/',
 published_at:date+'T09:01:00Z',available_at:date+'T09:01:00Z',time_basis:'PUBLISHED',content:JSON.stringify(data)});
function fixture(){
 const financial=evidence('F1','FINANCIAL',{kind:'EPS',period:'2026-Q3',basis:'SYNTHETIC_TEST',value:10});
 const template={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol:'2330',horizon:'MEDIUM',method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',currency:'TWD',
  cutoff:'2026-11-09T22:00:00Z',data_through:'2026-11-09',as_of:'2026-11-10T00:00:00Z',expires_at:'2026-11-10T05:30:00Z',quote_evidence_id:'P-old',
  evidence:[evidence('P-old','PRICE',{date:'2026-11-09',close:105,currency:'TWD'}),financial,
   evidence('I-old','FINANCIAL',{kind:'INSTITUTIONAL',period:'2026-11-09',net_shares:100}),
   evidence('M-old','MARKET',{context:'Synthetic old market'},'2026-11-09',null)],
  assumption_basis:{available_at:'2026-11-09T23:00:00Z',description:'SYNTHETIC fixed assumptions only; actual forecasts and publication are not approved.',evidence_ids:['F1']},
  invalidation:'模型使用的EPS或稀釋依據更新後，需要重新審查。',
  parameters:{earnings_basis:'FORWARD_12_MONTH_DILUTED_EPS',forecast_period:{start:'2027-01-01',end:'2027-12-31'},
   dilution_basis:{description:'SYNTHETIC diluted common share assumptions',evidence_ids:['F1']},
   scenarios:[{name:'conservative',eps:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:12,pe:14}],
   entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F1']}};
 const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:'2330',horizon:'MEDIUM',
  method_id:template.method_id,created_at:'2026-11-10T00:00:01Z',valid_until:'2026-11-20T05:30:00Z',revision_note:'Synthetic fixed input profile for daily rebinding tests.',template_input:template};
 const edition={id:'a'.repeat(64),evidence_cutoff:'2026-11-10T22:00:00Z',prepared_at:'2026-11-11T00:00:00Z',expires_at:'2026-11-11T05:30:00Z',data_through:'2026-11-10'};
 const packet={symbol:'2330',company:'合成測試公司',cutoff:edition.evidence_cutoff,data_through:edition.data_through,evidence:[
  evidence('P-new','PRICE',{date:'2026-11-10',close:108,currency:'TWD'},'2026-11-10'),structuredClone(financial),
  evidence('I-new','FINANCIAL',{kind:'INSTITUTIONAL',period:'2026-11-10',net_shares:-200},'2026-11-10'),
  evidence('N-new','NEWS',{kind:'SYNTHETIC_NEWS',text:'An unreferenced daily event.'},'2026-11-10'),
  evidence('M-new','MARKET',{context:'Synthetic new market'},'2026-11-10',null)]};
 return {profile,packet,edition,now};
}
function shortFixture({citeCoverage=true}={}){
 const input=fixture(),p=input.profile,t=p.template_input;
 p.horizon='SHORT';p.method_id='SHORT_ATR_CONDITIONAL_V1';t.horizon='SHORT';t.method_id=p.method_id;
 const dates=['2026-11-05','2026-11-06','2026-11-09'];
 const bars=dates.map((date,i)=>evidence('B'+i,'PRICE',{date,open:100+i,high:104+i,low:98+i,close:103+i,
  session_scope:'SYNTHETIC_FULL_SESSION',currency:'TWD'},date));
 const oldCoverage=evidence('A1','NEWS',{kind:'CORPORATE_ACTION_COVERAGE',symbol:'2330',from:dates[0],
  through:'2026-11-09',status:'NO_ACTIONS',price_basis:'RAW_UNADJUSTED'});
 t.evidence=[...bars,t.evidence[1],oldCoverage];t.quote_evidence_id='B2';
 if(citeCoverage)t.assumption_basis.evidence_ids.push('A1');
 t.parameters={bar_evidence_ids:bars.map(b=>b.id),expected_sessions:dates,atr_period:2,breakout_lookback:2,
  trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK',entry_atr_width:.5,stop_atr_multiple:2,tick_size:.5,corporate_actions_evidence_id:'A1'};
 const newCoverage=evidence('A2','NEWS',{kind:'CORPORATE_ACTION_COVERAGE',symbol:'2330',from:'2026-11-06',
  through:'2026-11-10',status:'NO_ACTIONS',price_basis:'RAW_UNADJUSTED'},'2026-11-10');
 input.packet.evidence=[...structuredClone(bars.slice(1)),evidence('B3','PRICE',{date:'2026-11-10',open:104,high:108,low:102,close:107,
  session_scope:'SYNTHETIC_FULL_SESSION',currency:'TWD'},'2026-11-10'),structuredClone(t.evidence[3]),structuredClone(oldCoverage),newCoverage];
 return input;
}
const setCoverageBody=(input,id,changes)=>{
 const source=input.packet.evidence.find(row=>row.id===id);source.content=JSON.stringify({...JSON.parse(source.content),...changes});
};
const shortNumericPolicy=parameters=>Object.fromEntries(['atr_period','breakout_lookback','trigger_rule','entry_atr_width','stop_atr_multiple','tick_size']
 .map(key=>[key,parameters[key]]));
test('a next-day quote is rebound without changing explicit EPS, PE, forecast period or source receipt times',async()=>{
 const input=fixture(),before=structuredClone(input),result=await bindDailyAiPriceProfile(input);
 assert.equal(result.status,'BOUND_REVIEW_REQUIRED');assert.deepEqual(result.missing,[]);
 const bound=result.calculation_input,original=input.profile.template_input;
 assert.equal(bound.quote_evidence_id,'P-new');assert.equal(bound.data_through,'2026-11-10');assert.equal(bound.as_of,new Date(now).toISOString());
 assert.equal(bound.cutoff,input.packet.cutoff);assert.equal(bound.expires_at,input.edition.expires_at);
 assert.deepEqual(bound.parameters,original.parameters);assert.deepEqual(bound.evidence,input.packet.evidence);
 assert.equal(bound.assumption_basis.available_at,original.assumption_basis.available_at);
 assert(bound.assumption_basis.description.includes(original.cutoff));assert(bound.assumption_basis.description.includes(original.as_of));
 assert.equal(result.profile_hash,await snapshotHash(input.profile));assert.equal(result.binding.forecast_parameters_rolled,false);
 assert.equal(result.methodology_approved,false);assert.equal(result.member_published,false);assert.equal(result.review_required,true);
 assert.deepEqual(input,before);assert(Object.isFrozen(bound.parameters.scenarios));
 const calculated=await calculateDailyAiPricePlan(bound,now);assert.deepEqual(calculated.entry_range,[64,96]);assert.equal(calculated.trace.quote,108);
});
test('unreferenced daily institutional, market and news evidence may change without blocking a fixed earnings method',async()=>{
 const input=fixture();const result=await bindDailyAiPriceProfile(input);assert.equal(result.status,'BOUND_REVIEW_REQUIRED');
 assert.deepEqual(result.binding.non_price_dependency_ids,['F1']);assert.deepEqual(result.binding.financial_series,['EPS']);
 assert(result.calculation_input.evidence.some(e=>e.id==='I-new'));assert(!result.calculation_input.evidence.some(e=>e.id==='I-old'));
});
test('a cited EPS revision or new quarter requires a new method profile even when its old row still exists',async()=>{
 const changed=fixture();changed.packet.evidence.find(e=>e.id==='F1').content=JSON.stringify({kind:'EPS',period:'2026-Q3',value:11});
 const revised=await bindDailyAiPriceProfile(changed);assert.equal(revised.status,'METHOD_UPDATE_REQUIRED');assert.equal(revised.calculation_input,null);
 assert(revised.missing.some(x=>x.code==='PROFILE_DEPENDENCY_VERSION_CHANGED'));
 const appended=fixture();appended.packet.evidence.push(evidence('F-new-quarter','FINANCIAL',{kind:'EPS',period:'2026-Q4',value:12},'2026-11-10'));
 const newQuarter=await bindDailyAiPriceProfile(appended);assert.equal(newQuarter.status,'METHOD_UPDATE_REQUIRED');
 assert(newQuarter.missing.some(x=>x.code==='PROFILE_FINANCIAL_SERIES_CHANGED'&&x.field==='FINANCIAL.EPS'));
});
test('missing referenced financial data and changed receipt metadata cannot be silently reused',async()=>{
 const missing=fixture();missing.packet.evidence=missing.packet.evidence.filter(e=>e.id!=='F1');
 assert((await bindDailyAiPriceProfile(missing)).missing.some(x=>x.code==='PROFILE_DEPENDENCY_MISSING'));
 const receipt=fixture();receipt.packet.evidence.find(e=>e.id==='F1').available_at='2026-11-10T09:01:00Z';
 assert((await bindDailyAiPriceProfile(receipt)).missing.some(x=>x.code==='PROFILE_DEPENDENCY_VERSION_CHANGED'));
});
test('the explicit profile lifetime is never inferred or extended, and expired templates cannot create new profiles',async()=>{
 const early=fixture();early.profile.valid_until='2026-11-11T01:00:00Z';
 assert.equal((await bindDailyAiPriceProfile(early)).calculation_input.expires_at,early.profile.valid_until);
 const expired=fixture();expired.profile.valid_until='2026-11-11T00:01:00Z';
 assert.equal((await bindDailyAiPriceProfile(expired)).missing[0].code,'PROFILE_EXPIRED');
 const revived=fixture();revived.profile.created_at='2026-11-10T06:00:00Z';
 await assert.rejects(()=>bindDailyAiPriceProfile(revived),/TEMPLATE_IDENTITY_OR_EXPIRED_AT_CREATION/);
 const unsupported=fixture();unsupported.profile.method_id='2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1';
 await assert.rejects(()=>bindDailyAiPriceProfile(unsupported),/PRICE_PROFILE_SCHEMA/);
});
test('quote identity, uniqueness and source cutoff remain binding across daily reprice work',async()=>{
 const missing=fixture();missing.packet.evidence=missing.packet.evidence.filter(e=>e.id!=='P-new');
 assert.equal((await bindDailyAiPriceProfile(missing)).missing[0].code,'PROFILE_CURRENT_QUOTE_MISSING');
 const duplicated=fixture();duplicated.packet.evidence.push({...duplicated.packet.evidence[0],id:'P-second'});
 assert.equal((await bindDailyAiPriceProfile(duplicated)).missing[0].code,'PROFILE_CURRENT_QUOTE_AMBIGUOUS');
 const late=fixture();late.packet.evidence[0].available_at='2026-11-10T22:00:00.000001Z';
 await assert.rejects(()=>bindDailyAiPriceProfile(late),/PRICE_PROFILE_SOURCE_TIME/);
 const wrong=fixture();wrong.profile.symbol='2454';await assert.rejects(()=>bindDailyAiPriceProfile(wrong),/TEMPLATE_IDENTITY/);
});
test('fixed FCFE vectors, discount rates and terminal assumptions do not roll forward with the quote',async()=>{
 const input=fixture(),p=input.profile;p.horizon='LONG';p.method_id='LONG_FCFE_DISCOUNT_SCENARIOS_V1';p.template_input.horizon='LONG';p.template_input.method_id=p.method_id;
 p.template_input.parameters={cashflow_basis:'FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI',timing:'END_OF_YEAR',
  dilution_basis:{description:'Synthetic dilution',evidence_ids:['F1']},scenarios:['conservative','base','upside'].map((name,i)=>({name,cashflows:[8+2*i,8+2*i],discount_rate:.1,terminal:{next_fcfe:8+2*i,growth:0}})),
  entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F1']};
 const result=await bindDailyAiPriceProfile(input);assert.equal(result.status,'BOUND_REVIEW_REQUIRED');assert.deepEqual(result.calculation_input.parameters,p.template_input.parameters);
 const calculated=await calculateDailyAiPricePlan(result.calculation_input,now);assert.deepEqual(calculated.entry_range,[64,80]);assert.equal(calculated.trace.quote,108);
});
test('a forward forecast window is not silently rolled or relabelled when its start is passed',async()=>{
 const input=fixture();input.profile.template_input.parameters.forecast_period={start:'2026-11-10',end:'2027-11-09'};
 const result=await bindDailyAiPriceProfile(input);assert.equal(result.status,'METHOD_UPDATE_REQUIRED');assert.equal(result.missing[0].code,'PROFILE_FORECAST_WINDOW_NO_LONGER_FORWARD');
});
test('an explicitly fixed earnings period can reprice daily after its start while preserving every assumption',async()=>{
 const input=fixture();input.profile.template_input.parameters.earnings_basis='FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION';
 input.profile.template_input.parameters.forecast_period={start:'2026-01-01',end:'2026-12-31'};
 const result=await bindDailyAiPriceProfile(input);assert.equal(result.status,'BOUND_REVIEW_REQUIRED');
 assert.deepEqual(result.calculation_input.parameters,input.profile.template_input.parameters);
 const lastDay=fixture();lastDay.profile.template_input.parameters.earnings_basis='FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION';
 lastDay.profile.template_input.parameters.forecast_period={start:'2025-11-10',end:'2026-11-09'};
 const expired=await bindDailyAiPriceProfile(lastDay);assert.equal(expired.status,'METHOD_UPDATE_REQUIRED');assert.equal(expired.missing[0].code,'PROFILE_FIXED_EARNINGS_PERIOD_EXPIRED');
});
test('short profiles rebind actual new company-action coverage across days while keeping fixed numeric policy',async()=>{
 const input=shortFixture(),before=structuredClone(input),result=await bindDailyAiPriceProfile(input);
 assert.equal(result.status,'BOUND_REVIEW_REQUIRED');assert.deepEqual(result.missing,[]);
 const bound=result.calculation_input,original=input.profile.template_input,link=result.binding.corporate_action_source;
 assert.deepEqual(bound.parameters.bar_evidence_ids,['B1','B2','B3']);
 assert.deepEqual(bound.parameters.expected_sessions,['2026-11-06','2026-11-09','2026-11-10']);
 assert.equal(bound.parameters.corporate_actions_evidence_id,'A2');
 assert.deepEqual(shortNumericPolicy(bound.parameters),shortNumericPolicy(original.parameters));
 assert.deepEqual(bound.assumption_basis.evidence_ids,['F1','A2']);
 assert.equal(bound.assumption_basis.available_at,original.assumption_basis.available_at);
 assert.equal(link.original_evidence_id,'A1');assert.equal(link.current_evidence_id,'A2');
 assert.equal(link.original_evidence_hash,await snapshotHash(original.evidence.find(e=>e.id==='A1')));
 assert.equal(link.current_evidence_hash,await snapshotHash(input.packet.evidence.find(e=>e.id==='A2')));
 assert.equal(link.assumption_reference_rebound,true);
 assert(Date.parse(link.current_observation_at)>Date.parse(original.assumption_basis.available_at));
 assert(bound.assumption_basis.description.includes('公司行動覆蓋為本次資料檢核'));
 assert.deepEqual(result.binding.non_price_dependency_ids,['F1']);assert.deepEqual(result.binding.financial_series,['EPS']);
 assert.deepEqual(input,before);assert.equal(result.profile_hash,await snapshotHash(input.profile));
 const calculated=await calculateDailyAiPricePlan(bound,now);
 assert.deepEqual(calculated.entry_range,[106.5,109.5]);assert.equal(calculated.trace.corporate_actions_evidence_id,'A2');
 assert(calculated.evidence_ids.includes('A2'));assert(!calculated.evidence_ids.includes('A1'));
});
test('company-action data can update under the same source ID with both versions bound, and unused citations stay unchanged',async()=>{
 const input=shortFixture({citeCoverage:false}),updated={...input.packet.evidence.find(e=>e.id==='A2'),id:'A1'};
 input.packet.evidence=input.packet.evidence.filter(e=>!['A1','A2'].includes(e.id));input.packet.evidence.push(updated);
 const result=await bindDailyAiPriceProfile(input);assert.equal(result.status,'BOUND_REVIEW_REQUIRED');
 assert.equal(result.binding.corporate_action_source.original_evidence_id,'A1');
 assert.equal(result.binding.corporate_action_source.current_evidence_id,'A1');
 assert.notEqual(result.binding.corporate_action_source.original_evidence_hash,result.binding.corporate_action_source.current_evidence_hash);
 assert.equal(result.binding.corporate_action_source.assumption_reference_rebound,false);
 assert.deepEqual(result.calculation_input.assumption_basis.evidence_ids,['F1']);
 assert.deepEqual(shortNumericPolicy(result.calculation_input.parameters),shortNumericPolicy(input.profile.template_input.parameters));
});
test('missing, partial, conflicting, duplicate or adjusted corporate-action coverage stays explicitly blocked',async()=>{
 for(const [alter,code] of [
  [input=>{input.packet.evidence=input.packet.evidence.filter(e=>!['A1','A2'].includes(e.id));},'PROFILE_CORPORATE_ACTION_COVERAGE_MISSING'],
  [input=>{input.packet.evidence=input.packet.evidence.filter(e=>e.id!=='A2');},'PROFILE_CORPORATE_ACTION_COVERAGE_INCOMPLETE'],
  [input=>setCoverageBody(input,'A2',{from:'2026-11-09'}),'PROFILE_CORPORATE_ACTION_COVERAGE_INCOMPLETE'],
  [input=>setCoverageBody(input,'A2',{status:'HAS_ACTIONS'}),'PROFILE_CORPORATE_ACTIONS_PRESENT'],
  [input=>setCoverageBody(input,'A1',{status:'HAS_ACTIONS'}),'PROFILE_CORPORATE_ACTIONS_PRESENT'],
  [input=>{input.packet.evidence.push({...input.packet.evidence.find(e=>e.id==='A2'),id:'A3'});},'PROFILE_CORPORATE_ACTION_COVERAGE_AMBIGUOUS'],
  [input=>setCoverageBody(input,'A2',{price_basis:'ADJUSTED'}),'PROFILE_CORPORATE_ACTION_PRICE_BASIS_INVALID'],
  [input=>setCoverageBody(input,'A2',{symbol:'2454'}),'PROFILE_CORPORATE_ACTION_IDENTITY_INVALID'],
 ]){
  const input=shortFixture();alter(input);const result=await bindDailyAiPriceProfile(input);
  assert.equal(result.status,'METHOD_UPDATE_REQUIRED');assert.equal(result.calculation_input,null);assert.equal(result.missing[0].code,code);
 }
});
test('new receipts cannot turn an old observation or a future interval into completed no-action evidence',async()=>{
 for(const alter of [
  input=>{input.packet.evidence.find(e=>e.id==='A2').available_at='2026-11-10T05:00:00Z';input.packet.evidence.find(e=>e.id==='A2').published_at='2026-11-10T05:00:00Z';},
  input=>{input.packet.evidence.find(e=>e.id==='A2').published_at='2026-11-09T09:01:00Z';},
  input=>{input.packet.evidence.find(e=>e.id==='A2').as_of='2026-11-09T09:01:00Z';},
  input=>setCoverageBody(input,'A2',{through:'2026-11-12'}),
 ]){
  const input=shortFixture();alter(input);const result=await bindDailyAiPriceProfile(input);
  assert.equal(result.status,'METHOD_UPDATE_REQUIRED');assert.equal(result.missing[0].code,'PROFILE_CORPORATE_ACTION_COVERAGE_TIME_INVALID');
 }
 const late=shortFixture();late.packet.evidence.find(e=>e.id==='A2').available_at='2026-11-10T22:00:00.000001Z';
 await assert.rejects(()=>bindDailyAiPriceProfile(late),/PRICE_PROFILE_SOURCE_TIME/);
});
test('renewed corporate-action data does not relax other pinned method evidence',async()=>{
 const input=shortFixture();input.packet.evidence.find(e=>e.id==='F1').content=JSON.stringify({kind:'EPS',period:'2026-Q3',value:999});
 const result=await bindDailyAiPriceProfile(input);assert.equal(result.status,'METHOD_UPDATE_REQUIRED');
 assert(result.missing.some(problem=>problem.code==='PROFILE_DEPENDENCY_VERSION_CHANGED'&&problem.field==='F1'));
 assert.equal(result.calculation_input,null);
});
test('unsupported profile fields cannot smuggle an approval or mutate the original template',async()=>{
 const input=fixture();input.profile.approved=true;await assert.rejects(()=>bindDailyAiPriceProfile(input),/PRICE_PROFILE_SCHEMA/);
 const ordinary=fixture(),before=structuredClone(ordinary),promise=bindDailyAiPriceProfile(ordinary);ordinary.profile.template_input.parameters.scenarios[0].eps=999;
 const result=await promise;assert.equal(result.profile_hash,await snapshotHash(before.profile));assert.equal(result.calculation_input.parameters.scenarios[0].eps,8);
});
