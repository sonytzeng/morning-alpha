// SYNTHETIC format controls only. These invented amounts are not issuer facts,
// source admission, production approval or Forward samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {evaluateResearch,traceIssues,publicationEligibility} from '../src/features/vnext/researchFunnel.ts';
import {stockDossier} from '../src/features/vnext/stockResearch.ts';
import {retainedQuarterFinancialFacts as normalizeFacts,withRetainedQuarterFinancials as mergeFacts,retainedQuarterFinancialDossier,RETAINED_QUARTER_SOURCE_IDENTITIES} from '../research/retained-quarter-financials.ts';
const pack={schema:'RETAINED_2330_DIRECT_QUARTER_FINANCIAL_FAMILIES_V1',symbol:'2330',created_at:'2026-10-19T09:08:23.667Z',
 supported_as_of_dates:{from:'2026-10-19',through:'2026-12-31'},source_review_sha256:'a'.repeat(64),source_quality_review_sha256:'b'.repeat(64),
 source_admitted:false,member_publication_approved:false,methodology_promoted:false,forward_sample:0,outcome_sample:0,
 missing_documented_reviews:['DEMAND','MOAT','SUPPLY_CHAIN','VALUATION'],counterevidence:[{difference_percentage_points:-1.3},{fact:'SYNTHETIC non-operating earnings control'}],
 rows:['2025-Q4','2026-Q1','2026-Q2','2026-Q3'].map((period,i)=>{const q=Number(period.at(-1)),y=Number(period.slice(0,4));return {symbol:'2330',period,
 period_start:new Date(Date.UTC(y,(q-1)*3,1)).toISOString().slice(0,10),period_end:new Date(Date.UTC(y,q*3,0)).toISOString().slice(0,10),basis:'DIRECT_STANDALONE_QUARTER',consolidation:'CONSOLIDATED',
 eps:{reported_decimal:['1.10','2.20','3.30','4.40'][i],unit:'TWD_PER_COMMON_SHARE',basis:'DILUTED',page:1,locator:'SYNTHETIC current quarter'},
 margin:{reported_decimal:['41.1','42.2','43.3','42.0'][i],unit:'PERCENT',basis:'DIRECTLY_REPORTED_GROSS_MARGIN',page:1,locator:'SYNTHETIC current quarter',gross_profit_twd_billion:'1.00',revenue_twd_billion:'2.00',ratio_recomputed:false},
 capex:{reported_signed_decimal_twd_billion:['-1.00','-2.00','-3.00','-4.00'][i],reported_unit:'TWD_BILLION',cashflow_sign:'OUTFLOW_IN_PARENTHESES',measurement:'CONSOLIDATED_QUARTERLY_CAPITAL_EXPENDITURES',positive_value_semantics:'EXPENDITURE_MAGNITUDE_NOT_CASH_INFLOW',page:5,locator:'SYNTHETIC excludes annual and USD columns'},
 source:{url:RETAINED_QUARTER_SOURCE_IDENTITIES[i].url,sha256:RETAINED_QUARTER_SOURCE_IDENTITIES[i].sha256,bytes:RETAINED_QUARTER_SOURCE_IDENTITIES[i].bytes,received_at:'2026-10-18T05:00:00Z',first_seen_at:'2026-10-18T05:00:00Z',date_label:'2026-10-15',published_at:null,original_version:null,revision_chain:null}};})};
const RETAINED_QUARTER_FINANCIAL_HASH=await snapshotHash(pack);
const seal={schema:'RETAINED_QUARTER_FINANCIAL_SOURCE_SEAL_V1',source_pack_sha256:RETAINED_QUARTER_FINANCIAL_HASH};
const retainedQuarterFinancialFacts=(cutoff,candidate=pack)=>normalizeFacts(cutoff,candidate,seal);
const withRetainedQuarterFinancials=(input,candidate=pack)=>mergeFacts(input,candidate,seal);

const at=pack.created_at;
const input=()=>({symbol:'2330',company:'台積電',cutoff:at,through:'2026-10-16',next_session:'2026-10-19',
 expected_sessions:[],bars:[],facts:[],v1_missing:{SHORT:['INDEPENDENT_V1_NOT_EVALUATED'],MEDIUM:['INDEPENDENT_V1_NOT_EVALUATED'],LONG:['INDEPENDENT_V1_NOT_EVALUATED']}});

test('SYNTHETIC four-quarter EPS, reported margin and TWD CapEx reach the existing fact model',async()=>{
 assert.equal(await snapshotHash(pack),RETAINED_QUARTER_FINANCIAL_HASH);
 const facts=await retainedQuarterFinancialFacts(at);assert.equal(facts.length,12);
 assert.equal(new Set(facts.map(f=>f.id)).size,12);
 for(const [kind,values] of [['EPS',[1.1,2.2,3.3,4.4]],['MARGIN',[41.1,42.2,43.3,42]],['CAPEX',[1000000000,2000000000,3000000000,4000000000]]]){
  const rows=facts.filter(f=>f.kind===kind);assert.deepEqual(rows.map(f=>f.period),['2025-Q4','2026-Q1','2026-Q2','2026-Q3']);assert.deepEqual(rows.map(f=>f.values.value),values);
  assert(rows.every(f=>f.basis==='SINGLE_QUARTER'&&f.source_pack_sha256===RETAINED_QUARTER_FINANCIAL_HASH));
 }
 assert(facts.filter(f=>f.kind==='EPS').every(f=>f.values.unit==='TWD_PER_COMMON_SHARE'&&f.values.measurement_basis==='DILUTED'));
 assert(facts.every(f=>traceIssues(f,at).length===0));
});

test('positive CapEx is the exact reviewed expenditure magnitude, retaining its negative original cash-flow sign',async()=>{
 const facts=(await retainedQuarterFinancialFacts(at)).filter(f=>f.kind==='CAPEX');
 assert.deepEqual(facts.map(f=>f.values.reported_decimal),['-1.00','-2.00','-3.00','-4.00']);
 assert(facts.every(f=>Number.isSafeInteger(f.values.value)&&f.values.signed_cashflow_twd===-f.values.value&&f.values.reported_unit==='TWD_BILLION'));
 assert(facts.every(f=>f.values.measurement_basis==='EXPENDITURE_MAGNITUDE_NOT_CASH_INFLOW'&&f.source_locator.page===5));
 assert(pack.rows.every(r=>r.capex.locator.includes('excludes annual and USD')));
});

test('exact source receipt time remains separate from pack availability and unknown first publication',async()=>{
 for(const f of await retainedQuarterFinancialFacts(at)){
  assert.equal(f.published_at,null);assert(f.first_seen_at.startsWith('2026-10-18'));assert.equal(f.available_at,pack.created_at);
  assert.equal(f.first_seen_at,f.source_received_at);assert(f.source_sha256.match(/^[a-f0-9]{64}$/));
  assert(traceIssues(f,at,true).includes('PUBLICATION_TIME_UNVERIFIED'));
  assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);
 }
});

test('SYNTHETIC LONG evaluator consumes 12 format-control facts while the three documented-review gaps remain',async()=>{
 const i=(await withRetainedQuarterFinancials(input())).input,r=evaluateResearch(i,'LONG');
 assert.equal(r.used.length,12);assert.equal(r.state,'INSUFFICIENT');assert.equal(r.evaluated,false);
 assert.deepEqual(r.reasons,['MISSING_DEMAND_1','MISSING_MOAT_1','MISSING_VALUATION_1']);
 assert(r.warnings.includes('EXACT_PUBLICATION_TIME_UNKNOWN_OBSERVED_AFTER_RECEIPT_ONLY'));
 assert.equal(r.v1.state,'INSUFFICIENT');assert(pack.missing_documented_reviews.includes('SUPPLY_CHAIN'));
});

test('previous cumulative EPS is returned as context, never joined or overwritten in the original input',async()=>{
 const i=input(),raw=(await retainedQuarterFinancialFacts(at))[0];
 i.facts=[{...raw,id:'original-cumulative',period:'2026-Q2',basis:'AS_REPORTED_CUMULATIVE_BASIS_NOT_INFERRED',values:{eps_as_reported:49.33}}];
 const before=structuredClone(i),r=await withRetainedQuarterFinancials(i);
 assert.deepEqual(i,before);assert.deepEqual(r.retained_context,before.facts);assert.equal(r.input.facts.length,12);
 assert(!r.input.facts.some(f=>f.id==='original-cumulative'));assert.equal(before.facts[0].values.eps_as_reported,49.33);
});

test('existing single-quarter series conflicts instead of being overwritten or silently combined',async()=>{
 const i=input();i.facts=[(await retainedQuarterFinancialFacts(at))[0]];
 await assert.rejects(()=>withRetainedQuarterFinancials(i),/EXISTING_SERIES_CONFLICT/);
});

test('old cutoffs, pack construction after cutoff, invalid clocks and unsupported later windows cannot use new facts',async()=>{
 for(const cutoff of ['2026-10-16T00:00:00Z','2026-10-18T23:59:59Z',new Date(Date.parse(at)-1).toISOString(),'2027-01-01T00:00:00Z','invalid'])await assert.rejects(()=>retainedQuarterFinancialFacts(cutoff));
});

test('changed source, shares, units, periods, amounts, receipt, publication or admission cannot be legitimized by a caller',async()=>{
 for(const change of [p=>p.rows[0].source.sha256='0'.repeat(64),p=>p.rows[0].source.url='https://example.test/other',p=>p.rows[0].source.received_at='2026-10-01T00:00:00Z',
  p=>p.rows[0].source.published_at=p.created_at,p=>p.rows[0].eps.basis='BASIC',p=>p.rows[0].eps.unit='USD_PER_ADR',p=>p.rows[0].eps.reported_decimal='99.00',
  p=>p.rows[0].margin.reported_decimal='99',p=>p.rows[0].capex.reported_signed_decimal_twd_billion='356.91',p=>p.rows[0].capex.reported_unit='USD_BILLION',
  p=>p.rows[0].period='2026-Q4',p=>p.rows[0].symbol='2454',p=>p.rows[0].basis='YTD',p=>p.source_admitted=true]){
  const bad=structuredClone(pack);change(bad);await assert.rejects(()=>retainedQuarterFinancialFacts(at,bad),/SOURCE_INVALID/);
 }
});

test('other equities and SHORT/MEDIUM results remain independent of the new financial series',async()=>{
 const other={...input(),symbol:'2454'},copy=structuredClone(other);assert.deepEqual((await withRetainedQuarterFinancials(other)).input,copy);
 const i=input(),withFacts=(await withRetainedQuarterFinancials(i)).input;
 for(const h of ['SHORT','MEDIUM'])assert.deepEqual(evaluateResearch(withFacts,h),evaluateResearch(i,h));
});

test('stock dossier displays the same 12-source financial facts and clears only the closed financial gap',async()=>{
 const i=(await withRetainedQuarterFinancials(input())).input,research=evaluateResearch(i,'LONG');
 const base=stockDossier({research,bars:[],facts:[],events:[],benchmark:[],expectedSessions:[],lastMonth:'2026-09'});
 const d=await retainedQuarterFinancialDossier(base,i,pack,seal);
 assert.equal(d.coverage.comparable_eps_quarters,4);assert.equal(d.coverage.capex_quarters,4);
 assert.equal(d.sources.length,12);assert(d.sources.every(s=>['EPS','MARGIN','CAPEX'].includes(s.kind)));
 assert(!d.data_gaps.includes('可比較單季EPS與資本支出不足'));
 assert(d.data_gaps.some(s=>s.includes('需求')&&s.includes('估值')));assert(d.opposing.some(s=>s.includes('非經常性')));
});

test('SYNTHETIC counterevidence retains weaker margin and non-operating earnings without inventing a new rule',()=>{
 assert.equal(pack.counterevidence[0].difference_percentage_points,-1.3);
 assert(pack.counterevidence[1].fact.includes('SYNTHETIC'));
 const code=readFileSync(new URL('../src/features/vnext/researchFunnel.ts',import.meta.url),'utf8');
 assert(code.includes("Number(margin.at(-1)!.values.value)<Number(margin[0].values.value)"));
});

test('SYNTHETIC review control proves source facts cannot silently confer publication eligibility',async()=>{
 const i=(await withRetainedQuarterFinancials(input())).input;
 for(const kind of ['DEMAND','MOAT','VALUATION'])i.facts.push({...i.facts[0],id:'SYNTHETIC-'+kind,kind,basis:'DOCUMENTED_REVIEW',values:{verdict:'SUPPORTED'}});
 const r=evaluateResearch(i,'LONG');assert.equal(r.state,'QUALIFIED'); // Only the explicit synthetic review completes this control.
 const p=publicationEligibility(r,{now:at,audience:'owner',server_entitlement_verified:true,input_hash:'a'.repeat(64),approved_hash:null,approved_at:null,methodology_approved:false,quality_reviewed:false,use:'OWN_ANALYSIS',grants:[]});
 assert.equal(p.eligible,false);assert(p.reasons.includes('PUBLICATION_TIME_UNVERIFIED'));assert(p.reasons.includes('RESEARCH_METHOD_REVIEW_REQUIRED'));
 assert.equal(pack.member_publication_approved,false);assert.equal(pack.methodology_promoted,false);assert.equal(pack.forward_sample,0);
});


test('duplicate quarter counts cannot clear the original or the sealed-study dossier gap',async()=>{
 const i=input(),f=(await retainedQuarterFinancialFacts(at))[0];i.facts=Array.from({length:4},(_,n)=>({...f,id:'duplicate-'+n,period:'2026-Q2'}));
 const research=evaluateResearch(i,'LONG'),base=stockDossier({research,bars:[],facts:i.facts,events:[],benchmark:[],expectedSessions:[],lastMonth:'2026-09'});
 assert.equal(research.state,'INSUFFICIENT');assert(base.data_gaps.includes('可比較單季EPS與資本支出不足'));
 await assert.rejects(()=>retainedQuarterFinancialDossier(base,i,pack,seal),/DOSSIER_INPUT_MISMATCH/);
});

test('rehashing an invalid measurement or missing source review still cannot bypass structural refusal',async()=>{
 for(const change of [p=>p.rows[0].source.url='https://example.test/unknown',p=>p.rows[0].source.sha256='0'.repeat(64),p=>p.rows[0].eps.unit='USD_PER_ADR',p=>p.rows[0].period='2025-Q3',p=>p.rows[0].capex.reported_signed_decimal_twd_billion='1.00',p=>p.rows[0].source.published_at=p.created_at,p=>p.rows[0].source.first_seen_at='2026-10-20T00:00:00Z',p=>p.source_quality_review_sha256='missing']){
  const bad=structuredClone(pack);change(bad);const digest=await snapshotHash(bad);await assert.rejects(()=>normalizeFacts(at,bad,{...seal,source_pack_sha256:digest}),/SOURCE_INVALID/);
 }
});

test('overlong EPS that becomes Infinity is refused while a finite negative EPS remains an actual observation',async()=>{
 const bad=structuredClone(pack);bad.rows[0].eps.reported_decimal='9'.repeat(400)+'.00';
 const badHash=await snapshotHash(bad);await assert.rejects(()=>normalizeFacts(at,bad,{...seal,source_pack_sha256:badHash}),/SOURCE_INVALID/);
 const negative=structuredClone(pack);negative.rows[0].eps.reported_decimal='-1.10';
 const facts=await normalizeFacts(at,negative,{...seal,source_pack_sha256:await snapshotHash(negative)});
 assert.equal(facts.find(f=>f.kind==='EPS').values.value,-1.1);
});

test('a quarter cannot be available before its stated period has completed',async()=>{
 const bad=structuredClone(pack);bad.rows[3].source.received_at='2026-09-29T08:00:00Z';bad.rows[3].source.first_seen_at=bad.rows[3].source.received_at;
 const badHash=await snapshotHash(bad);await assert.rejects(()=>normalizeFacts(at,bad,{...seal,source_pack_sha256:badHash}),/SOURCE_INVALID/);
});
