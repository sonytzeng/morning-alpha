// All market/financial values below are synthetic mathematical counterexamples.
import test from 'node:test';
import assert from 'node:assert/strict';
import {marketSnapshotHash as hash} from '../research/taiwan-market-universe.mjs';
import {createTaiwanReportedBvpsContext,calculateTaiwanReportedBvpsPeerReference as calculate,
 TAIWAN_REPORTED_BVPS_POLICY,MOPS_REPORTED_BVPS_UNIT_PROOF} from '../research/taiwan-market-bvps.mjs';
import {compactTaiwanPriceReference,expandTaiwanPriceReference} from '../research/taiwan-market-price-reference.mjs';
import {taiwanMarketBvpsFixture as fixture,buildBvpsActions,bvpsExRow,bvpsFinancialRecord,resealBvpsRecord,refreshBvpsQuality} from './helpers/taiwanMarketBvpsFixture.mjs';

const latest=(f,sid=f.security_id)=>f.financial_rows.find(r=>r.security_id===sid&&r.period==='2026Q2'&&r.family==='BALANCE');
const calc=f=>calculate({security_id:f.security_id,horizon:f.horizon,context:createTaiwanReportedBvpsContext(f)});
const structuredClone=globalThis.structuredClone;

test('reported BVPS10 times five OTHER peer PB [1,2,3,4,5] yields exact [20,30,40], excluding issuer PB100',()=>{
 const f=fixture(),r=calc(f);assert.equal(r.state,'CALCULATED_RESEARCH_ONLY');assert.equal(r.peer_count,5);
 assert.equal(r.reported_bvps,10);assert.equal(r.reported_bvps_raw,'10.00');assert.equal(r.derived_pb,100);
 assert.deepEqual(r.multiple_scenarios,[2,3,4]);assert.deepEqual(r.price_scenarios,[20,30,40]);
 assert(r.peers.every(p=>p.security_id!==f.security_id));assert.equal(r.method,'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB');
 assert.equal(r.issuer_balance_record.field_units['每股參考淨值'],'PER_SHARE_UNIT_NOT_EXPLICIT');
 assert.equal(r.unit_proof.raw_value_multiplier,1);assert.equal(r.unit_proof.per_share_unit,'TWD_PER_SHARE');
 assert.equal(r.unit_proof.shares_or_par_value_inferred,false);assert.equal(r.policy_hash,hash(TAIWAN_REPORTED_BVPS_POLICY));
 assert.equal(r.unit_proof_hash,hash(MOPS_REPORTED_BVPS_UNIT_PROOF));
 for(const key of ['methodology_approved','production_eligible','buy_ready','member_published','forecast','performance_available'])assert.equal(r[key],false);
 assert.equal(r.review,null);assert.equal(r.source_use_review,null);assert.equal(Object.hasOwn(r,'official_pb'),false);assert.equal(Object.hasOwn(r,'entry_range'),false);
});

test('R7 interpolation remains exact, order-independent, and unrounded to order ticks',()=>{
 const f=fixture([1,2,4,8,16,32]);const r=calc(f);assert.deepEqual(r.multiple_scenarios,[2.5,6,14]);assert.deepEqual(r.price_scenarios,[25,60,140]);
 const reversed={...f,securities:[...f.securities].reverse(),financial_rows:[...f.financial_rows].reverse()};
 assert.equal(calc(reversed).reference_hash,r.reference_hash);assert.match(r.arithmetic.rounding,/NONE_RESEARCH/);
});

test('minimum count is five other peers; no price with only four',()=>{
 const r=calc(fixture([1,2,3,4]));assert.equal(r.state,'UNAVAILABLE');assert.equal(r.peer_count,4);
 assert.equal(r.reason,'AT_LEAST_FIVE_OTHER_COMPARABLE_BVPS_PEERS_REQUIRED');assert.equal(Object.hasOwn(r,'price_scenarios'),false);
});

test('same industry, explicit balance period, current quote date and ordinary-equity cohort',()=>{
 const f=fixture([1,2,3,4,5,6,7,8,9]);
 f.securities[6].company.industry_code='25';
 f.financial_rows=f.financial_rows.filter(r=>!(r.security_id==='TPEX:1007'&&r.period==='2026Q2'));
 f.financial_rows.push(bvpsFinancialRecord('1007','2026Q3','BALANCE',{'每股參考淨值':'10.00'}));
 f.securities[8].observations[0].date='2026-11-10';f.securities[9].company.instrument_kind='TDR';
 const r=calc(f);assert.equal(r.peer_count,5);assert.deepEqual(r.price_scenarios,[20,30,40]);
 const notTpex=fixture();notTpex.security_id='TWSE:1000';const s=notTpex.securities[0];s.security_id=notTpex.security_id;s.company.market='TWSE';s.company.security_id=s.security_id;
 assert(calc(notTpex).reasons.includes('TPEX_ONLY_METHOD'));
});

test('latest reported statement must be positive, finite, within180days and unambiguously per share',()=>{
 for(const value of ['0','-1','--','NaN']){const f=fixture();latest(f).fields['每股參考淨值']=value;resealBvpsRecord(latest(f));assert(calc(f).reasons.includes('POSITIVE_REPORTED_BVPS_REQUIRED'));}
 const old=fixture();old.financial_rows=old.financial_rows.filter(r=>!(r.security_id===old.security_id&&r.period==='2026Q2'));
 old.financial_rows.push(bvpsFinancialRecord('1000','2026Q1','BALANCE',{'每股參考淨值':'10'}));
 assert(calc(old).reasons.includes('BALANCE_PERIOD_WITHIN_180_DAYS_REQUIRED'));
 const units=fixture();latest(units).field_units['每股參考淨值']='TWD_THOUSANDS';resealBvpsRecord(latest(units));
 assert(calc(units).reasons.includes('REPORTED_BVPS_UNIT_MAPPING_REQUIRED'));
 const missing=fixture();delete latest(missing).fields['每股參考淨值'];resealBvpsRecord(latest(missing));
 assert(calc(missing).reasons.includes('EXPLICIT_UNAMBIGUOUS_REPORTED_BVPS_FIELD_REQUIRED'));
});

test('cash dividend is retained as an event without deducting it from reported book value',()=>{
 const f=fixture();f.corporate_actions=buildBvpsActions(f,{rows:{tpex_ex_right:[bvpsExRow()]}});
 const r=calc(f);assert.deepEqual(r.price_scenarios,[20,30,40]);assert.equal(r.reported_bvps,10);
 assert.equal(r.issuer_action_proof.cash_dividend_events.length,1);assert.equal(r.issuer_action_proof.share_change_events.length,0);
 const e=r.issuer_action_proof.cash_dividend_events[0];assert.match(e.source_capture.source_row_hash,/^[a-f0-9]{64}$/);
 assert(r.limitations.some(t=>t.includes('not current book value')));
 const full=r.issuer_action_proof.coverage_evidence[0];assert.equal(typeof full.content,'string');assert.equal(Object.keys(full).length,11);
 assert.equal(full.id,'market-'+full.evidence_hash.slice(0,40));assert.equal(JSON.parse(full.content).coverage_hash,r.issuer_action_proof.coverage_hashes[0]);
});

test('unadjusted stock dividend and rights after balance end exclude issuer or peer; pre-end action is already in reported basis',()=>{
 for(const change of [{stock:'50',cash:'0'},{rights:'20',cash:'0'}]){
  const f=fixture();f.corporate_actions=buildBvpsActions(f,{rows:{tpex_ex_right:[bvpsExRow(change)]}});
  assert(calc(f).reasons.includes('UNADJUSTED_SHARE_CHANGE_AFTER_BALANCE_END'));
  f.corporate_actions=buildBvpsActions(f,{rows:{tpex_ex_right:[bvpsExRow({...change,symbol:'1005'})]}});
  assert.equal(calc(f).peer_count,4);
 }
 const f=fixture();f.corporate_actions=buildBvpsActions(f,{from:'2026-06-01',rows:{tpex_ex_right:[bvpsExRow({date:'115/06/30',cash:'0',stock:'50'})]}});
 assert.equal(calc(f).state,'CALCULATED_RESEARCH_ONLY');
});

test('missing CA table, insufficient range and caller-invented complete flags cannot create reference prices',()=>{
 for(const actionOptions of [{omit:['tpex_par_value_change']},{from:'2026-07-01'},{through:'2026-11-10'}]){
  const f=fixture();f.corporate_actions=buildBvpsActions(f,actionOptions);
  assert(calc(f).reasons.includes('COMPLETE_ACTION_COVERAGE_FROM_BALANCE_END_REQUIRED'));
 }
 const forged=fixture();forged.corporate_actions=structuredClone(forged.corporate_actions);
 assert.throws(()=>calc(forged),/VERIFIED_COVERAGE_REQUIRED/);
});

test('capital reduction and par-value change are blocked using the original classified action details',()=>{
 const html=pairs=>'<table>'+pairs.map(([label,value])=>'<tr><th>'+label+'</th><td>'+value+'</td></tr>').join('')+'</table>';
 const capital=['1150821','1000','Synthetic','100','90','99','81','90','90','現金減資',html([
  ['股票代號/股票名稱:','1000&nbsp/&nbspSynthetic'],['停止買賣日期:','115/08/11'],['恢復買賣日期:','115/08/21'],
  ['每壹仟股換發新股票:','700.00000000&nbsp股'],['每股退還股款:','3.00000000&nbsp元/股'],
  ['現金增資總股數:','NA'],['現金增資認購價:','NA'],['現金增資配股率:','NA']])];
 const split=['1150901','1000','Synthetic','100','50','55','45','50',html([
  ['證券代號/證券名稱:','1000&nbsp/&nbspSynthetic'],['停止買賣日期:','115/08/20'],['恢復買賣日期:','115/09/01'],
  ['變更股票面額換股率:','2.00000000'],['變更前股票面額:','5.00000000'],['變更後股票面額:','2.50000000']])];
 for(const rows of [{tpex_capital_reduction:[capital]},{tpex_par_value_change:[split]}]){
  const f=fixture();f.corporate_actions=buildBvpsActions(f,{rows});assert(calc(f).reasons.includes('UNADJUSTED_SHARE_CHANGE_AFTER_BALANCE_END'));
 }
});

test('LONG matches the existing annual-quality method for issuer AND peers, with no sector17 override',()=>{
 const f=fixture([1,2,3,4,5,999]);f.horizon='LONG';
 const bad=f.financial_rows.find(r=>r.security_id==='TPEX:1006'&&r.period==='2024Q4'&&r.family==='INCOME');
 bad.fields['本期淨利（淨損）']='-1';resealBvpsRecord(bad);refreshBvpsQuality(f);
 const r=calc(f);assert.equal(r.state,'CALCULATED_RESEARCH_ONLY');assert.equal(r.peer_count,5);assert.deepEqual(r.price_scenarios,[20,30,40]);
 assert.equal(r.method,'CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB');
 assert(r.peers.every(p=>p.annual_quality.eligible&&p.quality_result_hash===hash(p.annual_quality)));
 f.securities.forEach(s=>s.company.industry_code='17');assert(calc(f).reasons.includes('FINANCIAL_SECTOR_QUALITY_METHOD_REQUIRED'));
});

test('an eligible assertion with real source refs but altered earnings is rejected',()=>{
 const f=fixture();f.annual_quality.set(f.security_id,structuredClone(f.annual_quality.get(f.security_id)));f.annual_quality.get(f.security_id).annuals[0].net_profit=999;
 assert.throws(()=>calc(f),/ANNUAL_QUALITY_VALUES_BINDING/);
 const g=fixture();g.annual_quality.set(g.security_id,structuredClone(g.annual_quality.get(g.security_id)));g.annual_quality.get(g.security_id).annuals[0].source_captures.income=g.annual_quality.get('TPEX:1001').annuals[0].source_captures.income;
 assert.throws(()=>calc(g),/ANNUAL_QUALITY_SOURCE_BINDING/);
});

test('future, forged, duplicate and mismatched source identities are errors rather than missing-data fallbacks',()=>{
 const future=fixture();future.securities[0].observations[0].available_at='2026-11-12T00:00:00Z';assert.throws(()=>calc(future),/QUOTE_TIME/);
 const raw=fixture();latest(raw).fields['每股參考淨值']='11';assert.throws(()=>calc(raw),/RECORD_HASH/);
 const c=fixture();c.securities[0].observations[0].source_capture.capture_id='0'.repeat(64);assert.throws(()=>calc(c),/CAPTURE_ID/);
 const repeated=fixture();repeated.securities.push(repeated.securities[0]);assert.throws(()=>calc(repeated),/DUPLICATE_SECURITY/);
 assert.throws(()=>createTaiwanReportedBvpsContext({...fixture(),expected_quote_date:'2026-11-10'}),/EXPECTED_SESSION_MISMATCH/);
 const duplicateQuote=fixture();duplicateQuote.securities[0].observations.push(structuredClone(duplicateQuote.securities[0].observations[0]));
 assert(calc(duplicateQuote).reasons.includes('UNAMBIGUOUS_CURRENT_COMPLETED_SESSION_CLOSE_REQUIRED'));
});

test('one immutable branded context supports both horizons and survives caller mutation with full proofs and hashes',()=>{
 const f=fixture(),context=createTaiwanReportedBvpsContext(f),args={security_id:f.security_id,horizon:'MEDIUM',context},r=calculate(args);
 f.securities[0].observations[0].close=99999;latest(f).fields['每股參考淨值']='99999';f.annual_quality.clear();
 assert.equal(calculate(args).reference_hash,r.reference_hash);assert.equal(calculate({...args,horizon:'LONG'}).state,'CALCULATED_RESEARCH_ONLY');
 assert.throws(()=>calculate({...args,context:structuredClone(context)}),/BRANDED_CONTEXT_REQUIRED/);
 const {reference_hash,...body}=r;assert.equal(reference_hash,hash(body));assert.equal(Object.isFrozen(r.peers[0].balance_record.fields),true);
 assert.throws(()=>{r.issuer_balance_record.fields['每股參考淨值']='99';},TypeError);
 const pool={},bindings={},compressed=compactTaiwanPriceReference(r,pool,bindings);assert.deepEqual(expandTaiwanPriceReference(compressed,pool),r);
 assert(compressed.issuer_balance_record.$price_input_ref);assert(compressed.peers[0].balance_record.$price_input_ref);
 assert(compressed.issuer_action_proof.coverage_evidence.$price_input_ref);
});
