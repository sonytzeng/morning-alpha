import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deriveDailyAiFinancialActuals,buildDailyAiActualPriceInput,parseRetainedSecPriceSupplement} from '../research/daily-ai-financial-inputs.ts';
import {calculateDailyAiPricePlan,isSupportedPriceMethod,PRICE_CALCULATION_METHODS,LONG_EPS_DIVIDEND_METHOD} from '../research/daily-ai-price-calculation.ts';
import {bindDailyAiPriceProfile} from '../research/daily-ai-price-profile.ts';
import {buildDailyAiPackets} from '../research/daily-ai-packets.ts';
import {parseSecQuarterFinancials} from '../research/sec-quarter-financials.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

const periods=['2025-Q4','2026-Q1','2026-Q2','2026-Q3'],epsValues=[19.50,22.08,27.25,29.43];
const asOf='2026-11-10T00:00:00Z',expiry='2026-11-10T05:30:00Z';
const evidence=(id,kind,body)=>({id,symbol:'2330',kind,source:'https://www.sec.gov/synthetic-fixture',published_at:'2026-11-07T10:00:00Z',
 available_at:'2026-11-07T10:00:00Z',time_basis:'PUBLISHED',content:JSON.stringify(body)});
function packet(){
 const price=evidence('price','PRICE',{date:'2026-11-09',close:105,currency:'TWD'});price.published_at=price.available_at='2026-11-09T09:05:00Z';
 return {symbol:'2330',company:'合成數學案例',cutoff:'2026-11-09T22:00:00Z',data_through:'2026-11-09',evidence:[price,
  ...periods.map((period,i)=>evidence('eps-'+i,'FINANCIAL',{kind:'EPS',period,basis:'SINGLE_QUARTER',values:{value:epsValues[i],reported_decimal:epsValues[i].toFixed(2),unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED',consolidation:'CONSOLIDATED'}})),
  ...periods.map((period,i)=>evidence('cash-'+i,'FINANCIAL',{kind:'CAPEX',period,basis:'SINGLE_QUARTER',values:{value:1000000000+i*100000000,
   unit:'TWD',operating_cashflow_twd:2000000000+i*100000000,free_cashflow_twd:1000000000,measurement_basis:'DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES',amount_resolution_twd:10000000}})),
 ]};
}
function policy(){return {schema:'DAILY_AI_ACTUAL_PRICE_POLICY_V1',version:'SYNTHETIC_ARITHMETIC_POLICY_V1',symbol:'2330',horizon:'MEDIUM',formed_at:'2026-11-09T23:00:00Z',
 description:'Synthetic PE and discount inputs test arithmetic only; no recommendation or approved multiple is claimed.',evidence_ids:['eps-0','eps-1','eps-2','eps-3'],
 earnings_period:{start:'2025-10-01',end:'2026-09-30'},pe_scenarios:[{name:'conservative',pe:10},{name:'base',pe:12},{name:'upside',pe:14}],
 entry_scenarios:['conservative','base'],margin_of_safety:.2,invalidation:'原財務觀察有新版或方法假設改變時重新審查。'};}
function longPolicy(){const {pe_scenarios,...common}=policy();void pe_scenarios;
 return {...common,horizon:'LONG',method_id:LONG_EPS_DIVIDEND_METHOD,version:'SYNTHETIC_DIVIDEND_TERMINAL_PE_POLICY_V1',
  scenarios:['conservative','base','upside'].map((name,i)=>({name,eps_growth_rates:[0,0],payout_ratios:[.5,.5],required_return:.1,terminal_pe:10+2*i}))};}
function tenEpsPacket(){const p=packet();for(let i=0;i<4;i++)editSource(p,'eps-'+i,c=>{c.values.value=2.5;c.values.reported_decimal='2.50';});return p;}
const build=(p=packet(),settings=policy())=>buildDailyAiActualPriceInput({packet:p,as_of:asOf,expires_at:expiry,policy:settings});
function editSource(p,id,edit){const e=p.evidence.find(e=>e.id===id),c=JSON.parse(e.content);edit(c);e.content=JSON.stringify(c);}

test('reported quarter EPS uses exact decimals and remains distinct from reported annual EPS or FCFE',async()=>{
 const p=packet(),before=structuredClone(p),actual=await deriveDailyAiFinancialActuals({packet:p});
 assert.equal(actual.reported_four_quarter_diluted_eps_sum.value,98.26);
 assert.equal(actual.reported_four_quarter_diluted_eps_sum.reported_sum_decimal,'98.26');
 assert.deepEqual(actual.reported_four_quarter_diluted_eps_sum.period,{start:'2025-10-01',end:'2026-09-30'});
 assert.equal(actual.reported_four_quarter_diluted_eps_sum.issuer_reported_ttm,false);
 assert.equal(actual.reported_four_quarter_diluted_eps_sum.weighted_denominator_recomputed,false);
 assert.equal(actual.cashflow_actuals.issuer_free_cashflow_twd,4000000000);assert.equal(actual.common_share_fcfe,null);
 assert(actual.missing.LONG.some(m=>m.code==='ACTUAL_FCFE_PARENT_COMMON_CASH_ATTRIBUTION_REQUIRED'));
 assert(actual.missing.LONG.some(m=>m.code==='ACTUAL_FCFE_COMPLETE_NET_BORROWING_REQUIRED'));
 assert.equal(actual.packet_hash,await snapshotHash(p));const {actuals_hash,...body}=actual;assert.equal(actuals_hash,await snapshotHash(body));
 assert.deepEqual(p,before);assert(Object.isFrozen(actual));
});

test('the builder preserves the original packet and takes every multiple and discount from the explicit policy',async()=>{
 const p=packet(),result=await build(p);assert.equal(result.status,'INPUT_READY_REVIEW_REQUIRED');
 const input=result.calculation_input;assert.deepEqual(input.evidence,p.evidence);assert.equal(input.evidence.length,p.evidence.length);
 assert.equal(input.parameters.earnings_basis,'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM');
 assert(input.parameters.scenarios.every(s=>s.eps===98.26));
 assert(input.assumption_basis.description.includes(result.packet_hash));assert(input.assumption_basis.description.includes(result.policy_hash));
 const calculated=await calculateDailyAiPricePlan(input,Date.parse(asOf));assert.deepEqual(calculated.entry_range,[786.08,943.29]);
 assert.equal(calculated.trace.reported_eps_sum.reported_sum_decimal,'98.26');
 assert.equal(calculated.trace.period_field_semantics,'HISTORICAL_EARNINGS_PERIOD_NOT_FORECAST');
 assert.equal(calculated.forecast,false);assert.equal(calculated.review,null);assert.equal(result.methodology_approved,false);
 assert.equal(result.member_published,false);assert.equal(calculated.trace.scenarios[0].classification,'REPORTED_QUARTER_EPS_SUM_WITH_EXPLICIT_PE_ASSUMPTION');
});

test('incomplete, basic, cumulative, ADR, inconsistent or ambiguous quarters cannot turn into diluted actual EPS',async()=>{
 for(const edit of [
  p=>{p.evidence=p.evidence.filter(e=>e.id!=='eps-0');},
  p=>editSource(p,'eps-1',c=>{c.values.measurement_basis='BASIC';}),
  p=>editSource(p,'eps-1',c=>{c.basis='CUMULATIVE';}),
  p=>editSource(p,'eps-1',c=>{c.values.unit='USD_PER_ADR';}),
  p=>editSource(p,'eps-1',c=>{c.values.reported_decimal='999.00';}),
  p=>editSource(p,'eps-0',c=>{c.period='2025-Q3';}),
  p=>editSource(p,'eps-3',c=>{c.period='2026-Q4';}),
  p=>{p.evidence.push({...p.evidence.find(e=>e.id==='eps-3'),id:'ambiguous-quarter'});},
 ]){const p=packet();edit(p);const derived=await deriveDailyAiFinancialActuals({packet:p});assert.equal(derived.reported_four_quarter_diluted_eps_sum,null);assert(derived.missing.MEDIUM.length);}
 const usd=packet();editSource(usd,'cash-0',c=>{c.values.unit='USD_MILLION';});
 const cash=await deriveDailyAiFinancialActuals({packet:usd});assert.equal(cash.cashflow_actuals,null);assert.equal(cash.common_share_fcfe,null);
});

test('actual data alone does not supply a PE, policy time, future earnings or approval',async()=>{
 const noPolicy=await build(packet(),null);assert.equal(noPolicy.status,'MISSING_INPUT');assert.equal(noPolicy.calculation_input,null);
 assert.equal(noPolicy.actuals.reported_four_quarter_diluted_eps_sum.value,98.26);assert(noPolicy.missing.some(m=>m.code==='ACTUAL_PRICE_POLICY_REQUIRED'));
 for(const edit of [p=>{p.approved=true;},p=>{p.formed_at='2026-11-10T00:00:00.000001Z';},p=>{p.evidence_ids=['not-in-packet'];},
  p=>{p.pe_scenarios[0].pe=0;},p=>{p.margin_of_safety=1;},p=>{p.entry_scenarios=['upside','conservative'];}]){
  const settings=policy();edit(settings);await assert.rejects(()=>build(packet(),settings),/ACTUAL_FINANCIAL_INPUT_INVALID/);
 }
 const otherWindow=policy();otherWindow.earnings_period.end='2026-06-30';assert.equal((await build(packet(),otherWindow)).missing[0].code,'ACTUAL_POLICY_EARNINGS_PERIOD_MISMATCH');
 const late=packet();late.evidence[1].available_at='2026-11-09T22:00:00.000001Z';await assert.rejects(()=>build(late),/ACTUAL_FINANCIAL_INPUT_INVALID/);
});

test('calculator independently derives the historical sum and rejects relabelled assumptions or incomplete references',async()=>{
 const original=(await build()).calculation_input;
 for(const edit of [x=>{x.parameters.scenarios[0].eps=99;},x=>{x.parameters.dilution_basis.evidence_ids=['eps-0'];},
  x=>{x.parameters.forecast_period={start:'2025-07-01',end:'2026-06-30'};},
  x=>{const e=x.evidence.find(e=>e.id==='eps-1'),c=JSON.parse(e.content);c.values.measurement_basis='BASIC';e.content=JSON.stringify(c);},
 ]){const input=structuredClone(original);edit(input);await assert.rejects(()=>calculateDailyAiPricePlan(input,Date.parse(asOf)),/PRICE_CALCULATION_/);}
});

test('a historical EPS profile reprices after the earnings period without rolling quarters, while financial revisions stop reuse',async()=>{
 const initial=await build(),template=initial.calculation_input;
 const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:'2330',horizon:'MEDIUM',
  method_id:template.method_id,created_at:'2026-11-10T00:00:01Z',valid_until:'2026-11-20T05:30:00Z',revision_note:'Synthetic fixed historical-period policy.',template_input:template};
 const next=packet();next.cutoff='2026-11-10T22:00:00Z';next.data_through='2026-11-10';
 const price=next.evidence[0];price.id='next-price';price.published_at=price.available_at='2026-11-10T09:05:00Z';price.content=JSON.stringify({date:next.data_through,close:108,currency:'TWD'});
 const edition={id:'a'.repeat(64),evidence_cutoff:next.cutoff,prepared_at:'2026-11-11T00:00:00Z',expires_at:'2026-11-11T05:30:00Z',data_through:next.data_through};
 const input={profile,packet:next,edition,now:Date.parse('2026-11-11T00:01:00Z')};
 const bound=await bindDailyAiPriceProfile(input);assert.equal(bound.status,'BOUND_REVIEW_REQUIRED');assert.deepEqual(bound.calculation_input.parameters,template.parameters);
 assert.deepEqual((await calculateDailyAiPricePlan(bound.calculation_input,input.now)).entry_range,[786.08,943.29]);
 editSource(next,'eps-3',c=>{c.values.value=30;c.values.reported_decimal='30.00';});
 const changed=await bindDailyAiPriceProfile(input);assert.equal(changed.status,'METHOD_UPDATE_REQUIRED');assert.equal(changed.calculation_input,null);
});

test('long dividend and terminal-PE golden discounts each dividend and the terminal value at the correct year',async()=>{
 const result=await build(tenEpsPacket(),longPolicy());assert.equal(result.status,'INPUT_READY_REVIEW_REQUIRED');
 const input=result.calculation_input;assert.equal(input.method_id,LONG_EPS_DIVIDEND_METHOD);assert.equal(input.horizon,'LONG');
 assert.equal(PRICE_CALCULATION_METHODS.LONG,'LONG_FCFE_DISCOUNT_SCENARIOS_V1');assert(isSupportedPriceMethod('LONG',LONG_EPS_DIVIDEND_METHOD));
 assert(!isSupportedPriceMethod('MEDIUM',LONG_EPS_DIVIDEND_METHOD));assert(!isSupportedPriceMethod('LONG','2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1'));
 const computed=await calculateDailyAiPricePlan(input,Date.parse(asOf)),s=computed.trace.scenarios[0],expected=5/1.1+105/1.1**2;
 assert(Math.abs(s.value-expected)<1e-10);assert(Math.abs(s.dividend_present_value-(5/1.1+5/1.1**2))<1e-10);
 assert.equal(s.terminal.value,100);assert.equal(s.terminal.year,2);assert(Math.abs(s.terminal.present_value-100/1.1**2)<1e-10);
 assert.deepEqual(s.years.map(y=>y.eps),[10,10]);assert.deepEqual(s.years.map(y=>y.dividend),[5,5]);
 assert(Math.abs(s.terminal_fraction-(100/1.1**2)/expected)<1e-10);assert.deepEqual(computed.entry_range,[73.05,86.28]);
 assert.equal(computed.trace.reported_eps_sum.value,10);assert(!Object.hasOwn(computed.trace,'cashflow_basis'));
 assert.equal(computed.trace.timing,'END_OF_YEAR_DIVIDENDS_AND_EX_DIVIDEND_TERMINAL_PRICE');
 assert.equal(computed.trace.observation_horizon_scope,'REASSESSMENT_WINDOW_NOT_MODEL_VALUE_REALIZATION_DEADLINE');
 assert(computed.method_note.derivation.includes('dividend is counted once'));assert(computed.method_note.limitations.some(x=>x.includes('3 to 18 months')));
 assert.equal(s.classification,'EXPLICIT_FUTURE_EPS_DIVIDEND_AND_TERMINAL_PE_ASSUMPTIONS_NOT_ISSUER_FORECAST');
 assert(computed.method_note.limitations.some(x=>x.includes('distinct from FCFE')));assert.equal(computed.review,null);
 assert.equal(computed.buy_ready,false);assert.equal(computed.performance_available,false);assert.equal(result.actuals.common_share_fcfe,null);
 assert(result.actuals.missing.LONG.some(x=>x.code==='ACTUAL_FCFE_PARENT_COMMON_CASH_ATTRIBUTION_REQUIRED'));
});

test('long growth compounds from the historical starting EPS and zero payout keeps all value in the explicit terminal assumption',async()=>{
 const settings=longPolicy();settings.scenarios.forEach(s=>{s.eps_growth_rates=[.1,-.2];s.payout_ratios=[.5,.25];});
 const input=(await build(tenEpsPacket(),settings)).calculation_input,calculated=await calculateDailyAiPricePlan(input,Date.parse(asOf));
 const first=calculated.trace.scenarios[0];assert.deepEqual(first.years.map(y=>y.eps),[11,8.8]);assert.deepEqual(first.years.map(y=>y.dividend),[5.5,2.2]);
 assert(Math.abs(first.value-(5.5/1.1+(2.2+88)/1.1**2))<1e-10);
 const zero=longPolicy();zero.scenarios.forEach(s=>{s.payout_ratios=[0,0];});
 const zeroInput=(await build(tenEpsPacket(),zero)).calculation_input,zeroResult=await calculateDailyAiPricePlan(zeroInput,Date.parse(asOf));
 for(const s of zeroResult.trace.scenarios){assert.equal(s.dividend_present_value,0);assert.equal(s.terminal_fraction,1);assert.equal(s.value,s.terminal.present_value);}
});

test('long assumptions require finite explicit vectors, supported domains and one shared horizon without optimistic reordering',async()=>{
 const valid=(await build(tenEpsPacket(),longPolicy())).calculation_input;
 for(const edit of [
  p=>{p.scenarios[0].eps_growth_rates=[];},p=>{p.scenarios[0].eps_growth_rates=Array(11).fill(0);p.scenarios[0].payout_ratios=Array(11).fill(.5);},
  p=>{p.scenarios[0].payout_ratios=[.5];},p=>{p.scenarios[0].eps_growth_rates=[0];p.scenarios[0].payout_ratios=[.5];},
  p=>{p.scenarios[0].eps_growth_rates[0]=-1;},p=>{p.scenarios[0].eps_growth_rates[0]=Infinity;},
  p=>{p.scenarios[0].payout_ratios[0]=1.01;},p=>{p.scenarios[0].payout_ratios[0]=-.01;},
  p=>{p.scenarios[0].required_return=0;},p=>{p.scenarios[0].terminal_pe=0;},p=>{p.scenarios[0].terminal_pe=100;},
  p=>{p.scenarios[0].base_reported_eps=999;},p=>{p.earnings_basis='FCFE';},p=>{p.dilution_basis.evidence_ids=['eps-0'];},
 ]){const input=structuredClone(valid);edit(input.parameters);await assert.rejects(()=>calculateDailyAiPricePlan(input,Date.parse(asOf)),/PRICE_CALCULATION_/);}
 const incompatible=longPolicy();incompatible.scenarios[0].terminal_pe=100;
 const held=await build(tenEpsPacket(),incompatible);assert.equal(held.status,'MISSING_INPUT');assert.equal(held.calculation_input,null);
 assert(held.missing.some(m=>m.field==='parameters.scenarios'));
});

test('a long dividend policy retains its original growth, payout, return, terminal multiple and earnings window when the quote changes',async()=>{
 const initial=await build(tenEpsPacket(),longPolicy()),template=initial.calculation_input;
 const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:'2330',horizon:'LONG',method_id:template.method_id,
  created_at:'2026-11-10T00:00:01Z',valid_until:'2026-11-20T05:30:00Z',revision_note:'Synthetic long dividend policy, no stock qualification.',template_input:template};
 const current=tenEpsPacket();current.cutoff='2026-11-10T22:00:00Z';current.data_through='2026-11-10';
 const price=current.evidence[0];price.id='new-long-price';price.published_at=price.available_at='2026-11-10T09:05:00Z';price.content=JSON.stringify({date:current.data_through,close:108,currency:'TWD'});
 const edition={id:'c'.repeat(64),evidence_cutoff:current.cutoff,prepared_at:'2026-11-11T00:00:00Z',expires_at:'2026-11-11T05:30:00Z',data_through:current.data_through};
 const result=await bindDailyAiPriceProfile({profile,packet:current,edition,now:Date.parse('2026-11-11T00:01:00Z')});
 assert.equal(result.status,'BOUND_REVIEW_REQUIRED');assert.deepEqual(result.calculation_input.parameters,template.parameters);
 const next=await calculateDailyAiPricePlan(result.calculation_input,Date.parse('2026-11-11T00:01:00Z'));assert.deepEqual(next.entry_range,[73.05,86.28]);assert.equal(next.trace.quote,108);
 editSource(current,'eps-3',c=>{c.values.value=3;c.values.reported_decimal='3.00';});
 assert.equal((await bindDailyAiPriceProfile({profile,packet:current,edition,now:Date.parse('2026-11-11T00:01:00Z')})).status,'METHOD_UPDATE_REQUIRED');
});

test('matching retained SEC bytes reproduce actual 2330 EPS and provide new supplement observations only for future intake',async t=>{
 const root=process.env.MA_FINANCIAL_RETAINED_ROOT;
 if(!root){t.skip('Set MA_FINANCIAL_RETAINED_ROOT to the already retained local source workspace.');return;}
 const directory=join(root,'long-evidence-20261108'),documents=JSON.parse(await readFile(join(directory,'documents.json'),'utf8'));
 const saved=JSON.parse(await readFile(join(directory,'fresh-review-result.json'),'utf8'));
 const sourceCutoff=saved.input.cutoff,derivedAt=new Date().toISOString(),parsed=[],supplements=[];
 for(const period of periods){
  const load=async kind=>{const meta=documents.find(d=>d.period===period&&d.kind===kind),bytes=await readFile(join(directory,meta.file));
   assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.sha256);assert.equal(bytes.length,meta.bytes);
   return {period,kind,url:meta.url,bytes:meta.bytes,sha256:meta.sha256,received_at:meta.received_at,body:bytes.toString('utf8')};};
  const release=await load('release'),presentation=await load('presentation');
  parsed.push(...await parseSecQuarterFinancials(release,presentation,sourceCutoff));
  supplements.push(await parseRetainedSecPriceSupplement({release,presentation,cutoff:sourceCutoff,derived_at:derivedAt}));
 }
 assert.deepEqual(parsed,saved.financials,'The current local raw files must match their own retained receipt version, not older registry bytes.');
 const all=JSON.parse(await readFile(join(root,'evidence/production-price-inputs.json'),'utf8')).inputs;
 const inputs=all.map(input=>input.symbol==='2330'?saved.input:{...input,cutoff:sourceCutoff});
 const current=buildDailyAiPackets({inputs,cutoff:sourceCutoff,news:[],market:[]}).packets.find(p=>p.symbol==='2330');
 const actuals=await deriveDailyAiFinancialActuals({packet:current});
 assert.equal(actuals.reported_four_quarter_diluted_eps_sum.value,98.26);
 assert.equal(actuals.cashflow_actuals.operating_cashflow_twd,3127610000000);
 assert.equal(actuals.cashflow_actuals.capital_expenditures_twd,1646880000000);
 assert.equal(actuals.cashflow_actuals.issuer_free_cashflow_twd,1480730000000);assert.equal(actuals.common_share_fcfe,null);
 assert.deepEqual(supplements.map(s=>s.facts[0].values.value),[25931000000,25931000000,25932000000,25932000000]);
 assert.deepEqual(supplements.map(s=>s.facts[1].values.value),[21750000000,12400000000,-31660000000,-850000000]);
 for(const supplement of supplements){assert.equal(supplement.admission_status,'PENDING_SOURCE_INTAKE');assert.equal(supplement.source_admitted,false);
  assert(supplement.facts.every(f=>f.available_at===derivedAt&&!current.evidence.some(e=>e.id===f.id)));}
 const output={schema:'DAILY_AI_RETAINED_FINANCIAL_INPUT_REPLAY_V1',test_scope:'HISTORICAL_OFFLINE_REPLAY_NOT_CURRENT_PRICE_OR_REVIEW',
  actuals,supplements,source_files_checked:8,new_data_acquired:false,production_written:false};
 if(process.env.MA_FINANCIAL_INPUTS_RECEIPT)await writeFile(process.env.MA_FINANCIAL_INPUTS_RECEIPT,JSON.stringify(output,null,2)+'\n');
});
