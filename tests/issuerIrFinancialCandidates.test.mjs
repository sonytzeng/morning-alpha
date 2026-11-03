import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {traceIssues,evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {buildDailyAiPackets} from '../research/daily-ai-packets.ts';
import {normalizeIssuerIrFinancialCandidates,issuerIrPpeObservationCandidate,withIssuerIrFinancialCandidatesForReview} from '../research/issuer-ir-financial-candidates.ts';

// Synthetic bytes/claims verify normalization and boundaries, not issuer facts.
const at='2026-11-01T09:42:49.965517Z',first='2026-11-01T09:42:43.985837Z',cutoff='2026-11-01T10:00:00Z';
const rawDocument=()=>{
 const body=new TextEncoder().encode('%PDF-1.7\nSynthetic test data, not a real financial document.');
 return {symbol:'9999',url:'https://ir.example.test/reports/quarter.pdf',body,bytes:body.length,
  sha256:createHash('sha256').update(body).digest('hex'),first_seen_at:first,available_at:at,published_at:null};
};
const claim=(kind='EPS')=>{
 const doc=rawDocument();return {symbol:doc.symbol,kind,period:'2026-Q2',basis:'SINGLE_QUARTER',
  source:doc.url,source_sha256:doc.sha256,first_seen_at:first,available_at:at,source_published_at:null,
  values:kind==='EPS'?{basic_eps_twd_per_share:2.01,diluted_eps_twd_per_share:1.95,measurement_basis:'DIRECTLY_REPORTED_THREE_MONTH_PERIOD'}:
   {gross_margin_percent:30,revenue_thousand_twd:1000,gross_profit_thousand_twd:300,
    measurement_basis:'DERIVED_RATIO_OF_SAME_DIRECT_THREE_MONTH_REPORTED_AMOUNTS',formula:'gross_profit / operating_revenue * 100',not_source_rounded_percent:true},
  locator:{pdf_page:7,table:'Synthetic quarterly income',rows:[kind],column:'Current three months'},
  source_admitted:false,member_publication_approved:false};
};
const request=(candidates=[claim()],extra={})=>({symbol:'9999',allowedOrigins:['https://ir.example.test'],cutoff,
 documents:[rawDocument()],candidates,...extra});
const ppe=(period='2026-H1',basis='SIX_MONTH_CUMULATIVE')=>({...claim(),kind:'PPE_ACQUISITION_AND_CASH_PAID',period,basis,
 values:{ppe_acquisitions_thousand_twd:100,cash_paid_for_ppe_thousand_twd:80,measurement_basis:'DIRECTLY_REPORTED_PPE_ACQUISITION_AND_PAYABLE_RECONCILIATION',
  not_total_capital_expenditure:true,intangibles_excluded:true,no_quarter_differencing_performed:true}});

test('explicit basic/diluted selection stays distinct and hash-bound; all results remain private candidates',async()=>{
 const req=request([claim(),claim('MARGIN')]),before=structuredClone(req);
 const basic=await normalizeIssuerIrFinancialCandidates({...req,epsBasis:'BASIC'});
 const diluted=await normalizeIssuerIrFinancialCandidates({...req,epsBasis:'DILUTED'});
 assert.deepEqual(req,before);
 assert.equal(basic.facts[0].values.value,2.01);assert.equal(diluted.facts[0].values.value,1.95);
 assert.equal(basic.facts[0].values.measurement_basis,'BASIC');assert.equal(diluted.facts[0].values.measurement_basis,'DILUTED');
 assert.notEqual(basic.facts[0].id,diluted.facts[0].id);assert.notEqual(basic.facts[0].evidence_hash,diluted.facts[0].evidence_hash);
 assert.equal(diluted.facts[0].values.basic_eps_twd_per_share,2.01);
 assert.equal(diluted.facts[0].as_of,'2026-06-30T23:59:59+08:00');assert.equal(diluted.facts[0].source_locator.page,7);
 for(const f of diluted.facts){
  const {id,evidence_hash,...body}=f;assert.equal(evidence_hash,await snapshotHash(body));assert.equal(f.first_seen_at,first);
  assert.equal(f.available_at,at);assert.equal(f.published_at,null);assert.equal(f.source_admitted,false);
  assert.equal(f.member_publication_approved,false);assert.equal(f.candidate_only,true);assert.deepEqual(traceIssues(f,cutoff),[]);
 }
 assert.equal(diluted.production_writes,0);assert.equal(diluted.model_calls,0);assert.equal(diluted.facts[1].values.value,30);
});

test('unselected or unverified dilution basis never satisfies the existing EPS four-quarter gate',async()=>{
 const reported={...claim(),values:{value:3.5,unit:'TWD_PER_COMMON_SHARE',measurement_basis:'REPORTED_EPS_ATTRIBUTABLE_TO_PARENT_DILUTION_BASIS_NOT_ASSERTED'}};
 for(const epsBasis of [undefined,'BASIC','DILUTED']){
  const r=await normalizeIssuerIrFinancialCandidates(request([reported],{epsBasis}));
  assert.equal(r.facts[0].kind,'EPS_REPORTED_UNSPECIFIED');assert.equal(r.facts[0].values.value,3.5);
  assert(r.gaps.includes('EPS_DILUTION_BASIS_NOT_ESTABLISHED'));assert.deepEqual(r.coverage.EPS,[]);
  const evaluation=evaluateResearch({symbol:'9999',company:'Synthetic',cutoff,through:'2026-10-30',next_session:'2026-11-02',
   facts:r.facts,bars:[],expected_sessions:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}},'LONG');
  assert(evaluation.reasons.includes('MISSING_EPS_4'));assert.equal(evaluation.state,'INSUFFICIENT');
 }
 const preserve=await normalizeIssuerIrFinancialCandidates(request());
 assert.equal(preserve.facts[0].kind,'EPS_REPORTED_UNSPECIFIED');
 assert.equal(preserve.facts[0].values.basic_eps_twd_per_share,2.01);assert.equal(preserve.facts[0].values.diluted_eps_twd_per_share,1.95);
});

test('a directly labelled basic EPS value is usable only under the matching explicit series basis',async()=>{
 const c={...claim(),values:{value:2.4,reported_decimal:'2.40',unit:'TWD_PER_COMMON_SHARE',measurement_basis:'BASIC'}};
 const basic=await normalizeIssuerIrFinancialCandidates(request([c],{epsBasis:'BASIC'}));
 assert.equal(basic.facts[0].kind,'EPS');assert.equal(basic.facts[0].values.value,2.4);assert.equal(basic.facts[0].values.reported_decimal,'2.40');
 const diluted=await normalizeIssuerIrFinancialCandidates(request([c],{epsBasis:'DILUTED'}));
 assert.equal(diluted.facts[0].kind,'EPS_REPORTED_UNSPECIFIED');assert.deepEqual(diluted.coverage.EPS,[]);
 await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([{...c,values:{...c.values,reported_decimal:'2.41'}}],{epsBasis:'BASIC'})),/ISSUER_IR_EPS_REPORTED_DECIMAL/);
});

test('EPS duplicated values cannot conflict and a BASIC decimal is never attached to a selected DILUTED value',async()=>{
 const c={...claim(),values:{value:2.01,reported_decimal:'2.01',unit:'TWD_PER_COMMON_SHARE',measurement_basis:'BASIC',basic_eps_twd_per_share:2.01,diluted_eps_twd_per_share:1.95}};
 const diluted=await normalizeIssuerIrFinancialCandidates(request([c],{epsBasis:'DILUTED'}));
 assert.equal(diluted.facts[0].values.value,1.95);assert.equal(diluted.facts[0].values.reported_decimal,undefined);
 assert.equal(diluted.facts[0].values.source_reported_decimal,'2.01');assert.equal(diluted.facts[0].values.source_reported_decimal_basis,'BASIC');
 const bad=structuredClone(c);bad.values.basic_eps_twd_per_share=99;
 for(const epsBasis of ['BASIC','DILUTED'])await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([bad],{epsBasis})),/ISSUER_IR_EPS_CONFLICTING_VALUES/);
});

test('cumulative PPE and quarterly cash paid remain their reported scopes, never CAPEX or quarter differences',async()=>{
 const r=await normalizeIssuerIrFinancialCandidates(request([ppe(),ppe('2026-Q1','SINGLE_QUARTER'),ppe('2025-FY','FULL_YEAR')]));
 assert.deepEqual(r.coverage.CAPEX,[]);assert(r.gaps.includes('CAPEX_NOT_ESTABLISHED_BY_PPE_DISCLOSURES'));
 assert.deepEqual(r.facts.map(f=>f.basis),['SIX_MONTH_CUMULATIVE','SINGLE_QUARTER','FULL_YEAR']);
 assert(r.facts.every(f=>f.kind==='PPE_ACQUISITION_AND_CASH_PAID'&&f.values.value===undefined));
 assert.equal(r.facts[0].values.ppe_acquisitions_thousand_twd,100);assert.equal(r.facts[0].values.cash_paid_for_ppe_thousand_twd,80);
 for(const mutate of [r=>{r.kind='CAPEX';},r=>{r.basis='SINGLE_QUARTER';},r=>{r.values.not_total_capital_expenditure=false;},r=>{r.values.no_quarter_differencing_performed=false;}]){
  const c=ppe();mutate(c);await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([c])),/ISSUER_IR_/);
 }
 for(const bad of ['wrong','80',NaN,-1]){
  const c=ppe();c.values.cash_paid_for_ppe_thousand_twd=bad;
  await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([c])),/ISSUER_IR_PPE_VALUE/);
 }
});

test('annual report labelled Q4 is normalized to full-year PPE, with original document label preserved',async()=>{
 const d=rawDocument(),observation={symbol:'9999',period_label:'2025-Q4',reporting_scope:'FULL_YEAR',reported_row:'Acquisition of property, plant and equipment',
  reported_thousand_twd:100,outflow_positive_magnitude_twd:100000,source:d.url,source_sha256:d.sha256,source_pdf:'annual.pdf',page:12,published_at:null,
  first_seen_at:first,available_at:at,excludes_intangible_acquisition:true,not_total_investing_cashflow:true,
  eligible_as_direct_single_quarter_ppe_only:false,promoted_as_capex_fact:false,derived_by_differencing:false};
 const c=issuerIrPpeObservationCandidate(observation),r=await normalizeIssuerIrFinancialCandidates(request([c]));
 assert.equal(r.facts[0].period,'2025-FY');assert.equal(r.facts[0].basis,'FULL_YEAR');assert.equal(r.facts[0].values.original_period_label,'2025-Q4');
 assert.equal(r.facts[0].source_locator.document,'annual.pdf');assert.equal(r.facts[0].kind,'PPE_ACQUISITION');
 assert.throws(()=>issuerIrPpeObservationCandidate({...observation,reporting_scope:'THREE_MONTHS_SINGLE_QUARTER',derived_by_differencing:true}),/ISSUER_IR_/);
 assert.throws(()=>issuerIrPpeObservationCandidate({...observation,outflow_positive_magnitude_twd:101000}),/ISSUER_IR_/);
});

test('raw bytes, issuer host, receipt times and locators must bind exactly; old-cutoff intake fails before normalization',async()=>{
 for(const mutate of [
  r=>{r.documents[0].body[8]^=1;},r=>{r.documents[0].url='https://another.example.test/reports/quarter.pdf';},
  r=>{r.documents[0].symbol='8888';},r=>{r.cutoff='2026-10-31T10:32:18.395Z';},
  r=>{r.candidates[0].first_seen_at='2026-10-31T10:00:00Z';},r=>{r.candidates[0].available_at='2026-11-01T09:42:49.965518Z';},
  r=>{delete r.candidates[0].locator.pdf_page;},r=>{r.candidates[0].source_admitted=true;},
  r=>{r.candidates[0].source_sha256='a'.repeat(64);},r=>{r.documents.push(structuredClone(r.documents[0]));},
  r=>{r.candidates[0].values.unit='USD_PER_ADR';},r=>{r.candidates[0].values.basic_eps_twd_per_share='2.01';},
  r=>{r.candidates[0].published_at=first;r.candidates[0].source_published_at=null;},r=>{r.documents[0]=null;},
 ]){const r=request();mutate(r);await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(r),/ISSUER_IR_/);}
});

test('source-claimed gross margins must recompute from same-period amounts and keep calculated precision',async()=>{
 const c=claim('MARGIN');const r=await normalizeIssuerIrFinancialCandidates(request([c]));
 assert.equal(r.facts[0].values.precision,'CALCULATED_RATIO_NOT_SOURCE_ROUNDED_PERCENT');
 for(const mutate of [c=>{c.values.gross_margin_percent=31;},c=>{c.values.revenue_thousand_twd=0;},c=>{c.basis='YEAR_TO_DATE';},
  c=>{c.values.formula='YTD difference';},c=>{c.values.not_source_rounded_percent=false;}]){
  const c=claim('MARGIN');mutate(c);await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([c])),/ISSUER_IR_/);
 }
});

test('direct margin decimals and percentage components cannot contradict the retained numeric value',async()=>{
 const c={...claim('MARGIN'),values:{value:40,unit:'PERCENT',measurement_basis:'DIRECTLY_REPORTED_GROSS_MARGIN',reported_decimal:'40.0',operating_margin_percent:20,net_margin_percent:15}};
 const r=await normalizeIssuerIrFinancialCandidates(request([c]));assert.equal(r.facts[0].values.reported_decimal,'40.0');
 for(const mutate of [v=>{v.reported_decimal='99.9';},v=>{v.reported_decimal='unknown';},v=>{v.operating_margin_percent='wrong';},v=>{v.net_margin_percent=NaN;}]){
  const bad=structuredClone(c);mutate(bad.values);await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([bad])),/ISSUER_IR_MARGIN_/);
 }
});

test('both historical claim-hash conventions are verified; changed values cannot reuse an old retained hash',async()=>{
 const a=claim();a.id='synthetic-claim';a.evidence_hash=await snapshotHash(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='id')));
 const b=claim('MARGIN');b.id='synthetic-ratio';b.fact_hash=await snapshotHash(b);
 const r=await normalizeIssuerIrFinancialCandidates(request([a,b],{epsBasis:'DILUTED'}));assert.equal(r.facts.length,2);
 const bad=structuredClone(a);bad.values.diluted_eps_twd_per_share=999;
 await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([bad])),/ISSUER_IR_CLAIM_HASH/);
 const both={...a,fact_hash:'a'.repeat(64)};await assert.rejects(()=>normalizeIssuerIrFinancialCandidates(request([both])),/ISSUER_IR_CLAIM_HASH_AMBIGUOUS/);
});

test('offline-only merge preserves candidate flags and original inputs; stale, duplicate and altered facts cannot merge',async()=>{
 const r=await normalizeIssuerIrFinancialCandidates(request([claim(),claim('MARGIN')],{epsBasis:'DILUTED'}));
 const input={symbol:'9999',company:'Synthetic',cutoff,through:'2026-10-30',next_session:'2026-11-02',facts:[],bars:[],expected_sessions:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}};
 const before=JSON.stringify(input),next=await withIssuerIrFinancialCandidatesForReview(input,r.facts,'OFFLINE_PRIVATE_REVIEW_ONLY');
 assert.equal(JSON.stringify(input),before);assert.equal(next.facts.length,2);assert(next.facts.every(f=>f.source_admitted===false));
 await assert.rejects(()=>withIssuerIrFinancialCandidatesForReview(input,r.facts,'PRODUCTION'),/ISSUER_IR_REVIEW_SCOPE/);
 await assert.rejects(()=>withIssuerIrFinancialCandidatesForReview(next,r.facts,'OFFLINE_PRIVATE_REVIEW_ONLY'),/ISSUER_IR_REVIEW_MERGE/);
 await assert.rejects(()=>withIssuerIrFinancialCandidatesForReview({...input,cutoff:'2026-10-31T10:00:00Z'},r.facts,'OFFLINE_PRIVATE_REVIEW_ONLY'),/ISSUER_IR_REVIEW_MERGE/);
 const bad=structuredClone(r.facts);bad[0].values.value=999;
 await assert.rejects(()=>withIssuerIrFinancialCandidatesForReview(input,bad,'OFFLINE_PRIVATE_REVIEW_ONLY'),/ISSUER_IR_REVIEW_MERGE/);
});

test('caller mutation during hashing cannot move an already-captured merge cutoff or add existing evidence',async()=>{
 const r=await normalizeIssuerIrFinancialCandidates(request([claim()],{epsBasis:'BASIC'}));
 const input={symbol:'9999',cutoff,facts:[]},pending=withIssuerIrFinancialCandidatesForReview(input,r.facts,'OFFLINE_PRIVATE_REVIEW_ONLY');
 input.cutoff='2020-01-01T00:00:00Z';input.facts.push({kind:'EPS',period:'2026-Q1',values:{measurement_basis:'DILUTED'}});
 const next=await pending;assert.equal(next.cutoff,cutoff);assert.equal(next.facts.length,1);assert.equal(next.facts[0].values.measurement_basis,'BASIC');
 assert.notEqual(next.facts,input.facts);
});

test('separate valid batches cannot mix BASIC and DILUTED EPS into a falsely comparable quarterly series',async()=>{
 const basic=await normalizeIssuerIrFinancialCandidates(request([{...claim(),period:'2026-Q1'}],{epsBasis:'BASIC'}));
 const diluted=await normalizeIssuerIrFinancialCandidates(request([claim()],{epsBasis:'DILUTED'}));
 const input={symbol:'9999',cutoff,facts:[]};
 const next=await withIssuerIrFinancialCandidatesForReview(input,basic.facts,'OFFLINE_PRIVATE_REVIEW_ONLY');
 await assert.rejects(()=>withIssuerIrFinancialCandidatesForReview(next,diluted.facts,'OFFLINE_PRIVATE_REVIEW_ONLY'),/ISSUER_IR_EPS_SERIES_BASIS/);
 const unknown={...next,facts:next.facts.map(f=>({...f,values:{...f.values,measurement_basis:'UNSPECIFIED'}}))};
 await assert.rejects(()=>withIssuerIrFinancialCandidatesForReview(unknown,diluted.facts,'OFFLINE_PRIVATE_REVIEW_ONLY'),/ISSUER_IR_EPS_SERIES_BASIS/);
});

test('existing packet builder consumes normalized values without changing receipt metadata or candidate approval flags',async()=>{
 const r=await normalizeIssuerIrFinancialCandidates(request([claim(),claim('MARGIN')],{epsBasis:'DILUTED'}));
 const inputs=Array.from({length:72},(_,i)=>({symbol:i===0?'9999':String(1000+i),company:'Synthetic',cutoff,through:'2026-10-30',next_session:'2026-11-02',
  facts:[],bars:[],expected_sessions:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
 inputs[0]=await withIssuerIrFinancialCandidatesForReview(inputs[0],r.facts,'OFFLINE_PRIVATE_REVIEW_ONLY');
 const market={id:'synthetic-market',symbol:null,kind:'MARKET',source:'https://ir.example.test/market',published_at:null,
  first_seen_at:first,available_at:at,as_of:'2026-10-30T13:30:00+08:00',evidence_hash:'a'.repeat(64),time_basis:'OBSERVED_AFTER_RECEIPT',content:'Synthetic market only'};
 const result=buildDailyAiPackets({inputs,cutoff,news:[],market:[market]}),packet=result.packets.find(p=>p.symbol==='9999');
 assert.equal(packet.evidence.filter(e=>e.kind==='FINANCIAL').length,2);const eps=packet.evidence.find(e=>e.kind==='FINANCIAL'&&JSON.parse(e.content).kind==='EPS');
 assert.equal(JSON.parse(eps.content).basis,'SINGLE_QUARTER');assert.equal(JSON.parse(eps.content).values.value,1.95);
 assert.equal(JSON.parse(eps.content).values.measurement_basis,'DILUTED');assert.equal(eps.first_seen_at,first);assert.equal(eps.available_at,at);
 assert.equal(eps.evidence_hash,r.facts[0].evidence_hash);assert.equal(eps.published_at,null);assert.equal(eps.time_basis,'OBSERVED_AFTER_RECEIPT');
 assert(inputs[0].facts.every(f=>f.source_admitted===false&&f.member_publication_approved===false));
});
