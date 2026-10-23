// Synthetic canonical projection controls, not real financial results or source
// admission. The Fresh PostgreSQL companion verifies the actual JSONB column.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DATA_QUERIES,loadDecisionEvidence} from '../supabase/functions/_shared/decision-v1-data.ts';
import {buildEvidenceDecision,projectEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {IDENTITY,evidenceRows} from './fixtures/decision-evidence-rows.mjs';

async function load(source) {
  const requested=[];
  const data=await loadDecisionEvidence(async request=>{
    requested.push(request);
    const key=Object.keys(DATA_QUERIES).find(k=>DATA_QUERIES[k].table===request.table);
    assert(key);
    // Simulate SELECT projection, not an adapter that returns every fixture
    // property regardless of the real query and masks a missing column.
    const columns=request.columns.split(',');
    return {data:source[key].map(row=>Object.fromEntries(columns.filter(k=>Object.hasOwn(row,k)).map(k=>[k,structuredClone(row[k])]))),error:null};
  },IDENTITY);
  return {data,requested};
}

function withMeasurement(source=evidenceRows()) {
  for(const row of source.earnings){
    const [,year,quarter]=row.fiscal_period.match(/^(\d{4})-Q([1-4])$/);
    const start=new Date(Date.UTC(Number(year),(Number(quarter)-1)*3,1));
    const end=new Date(Date.UTC(Number(year),Number(quarter)*3,0));
    row.raw_payload={measurement:{symbol:row.symbol,fiscal_year:Number(year),fiscal_quarter:Number(quarter),
      period_start:start.toISOString().slice(0,10),period_end:end.toISOString().slice(0,10),
      period_basis:'DIRECT_STANDALONE_QUARTER',accounting_basis:'IFRS_AS_REPORTED',
      consolidation:'CONSOLIDATED',currency:'TWD',revenue_unit:'TWD',revenue_scale:1,
      share_class:'COMMON_SHARE',eps_basis:'BASIC',eps_unit:'TWD_PER_COMMON_SHARE',
      profile:'NONFINANCIAL_IFRS',revenue_definition:'IFRS_REVENUE',
      revenue_actual:row.revenue_actual,eps_actual:row.eps_actual}};
  }
  return source;
}
const selected=result=>result.phase_evaluation.candidates.find(c=>c.symbol==='2330');

test('four comparable explicitly reported quarters preserve the legacy numerical decision',async()=>{
  const baseline=buildEvidenceDecision((await load(evidenceRows())).data,IDENTITY);
  const result=buildEvidenceDecision((await load(withMeasurement())).data,IDENTITY);
  assert.deepEqual(result.phase_evaluation,baseline.phase_evaluation);
  assert.deepEqual(result.stock_opportunities,baseline.stock_opportunities);
});

for(const [label,patch,reason] of [
  ['YTD is not a standalone quarter',{period_basis:'YTD'},'FUNDAMENTAL_PERIOD_BASIS_UNPROVEN'],
  ['a Q2 period cannot start in January',{period_start:'2026-01-01'},'FUNDAMENTAL_PERIOD_IDENTITY_MISMATCH'],
  ['an invalid month is not a real quarter end',{period_end:'2026-13-30'},'FUNDAMENTAL_PERIOD_IDENTITY_MISMATCH'],
  ['metadata fiscal quarter must match the row',{fiscal_quarter:1},'FUNDAMENTAL_PERIOD_IDENTITY_MISMATCH'],
  ['metadata company must match the row',{symbol:'2317'},'FUNDAMENTAL_PERIOD_IDENTITY_MISMATCH'],
  ['BASIC and DILUTED cannot be spliced',{eps_basis:'DILUTED'},'FUNDAMENTAL_MEASUREMENT_BASIS_CONFLICT'],
  ['consolidated and individual accounts cannot be spliced',{consolidation:'INDIVIDUAL'},'FUNDAMENTAL_MEASUREMENT_BASIS_CONFLICT'],
  ['an unknown EPS basis is not BASIC',{eps_basis:'UNKNOWN'},'FUNDAMENTAL_MEASUREMENT_BASIS_UNPROVEN'],
  ['USD is not a normalized TWD actual',{currency:'USD'},'FUNDAMENTAL_MEASUREMENT_BASIS_UNPROVEN'],
  ['thousands are not normalized TWD',{revenue_scale:1000},'FUNDAMENTAL_MEASUREMENT_BASIS_UNPROVEN'],
  ['financial net revenue requires a separate method review',{profile:'FINANCIAL_TIFRS_FH',revenue_definition:'FINANCIAL_NET_REVENUE'},'FUNDAMENTAL_PROFILE_METHOD_REVIEW_REQUIRED'],
  ['canonical and measurement values must agree',{eps_actual:0},'FUNDAMENTAL_MEASUREMENT_VALUE_MISMATCH'],
])test(label,async()=>{
  const source=withMeasurement(),row=source.earnings.find(r=>r.symbol==='2330'&&r.fiscal_period==='2026-Q2');
  Object.assign(row.raw_payload.measurement,patch);
  const before=structuredClone(source),{data}=await load(source),result=buildEvidenceDecision(data,IDENTITY);
  assert.equal(result.phase_evaluation.evaluated_count,2);
  assert.equal(result.phase_evaluation.blocked_count,1);
  assert.equal(selected(result).status,'BLOCKED');
  assert(selected(result).reasons.includes(reason));
  assert.equal(result.stock_opportunities.some(r=>r.symbol==='2330'),false);
  assert.deepEqual(source,before);
});

test('fully comparable DILUTED quarters are not rejected just for being diluted',async()=>{
  const source=withMeasurement();
  source.earnings.forEach(row=>{row.raw_payload.measurement.eps_basis='DILUTED';});
  const result=buildEvidenceDecision((await load(source)).data,IDENTITY);
  assert.equal(result.phase_evaluation.evaluated_count,3);
});

for(const [announced,accepted]of [['2026-06-30T15:59:59.999Z',false],['2026-06-30T16:00:00Z',true]])
test('explicit quarter announcement uses the Taipei quarter-end boundary: '+announced,async()=>{
  const source=withMeasurement(),row=source.earnings.find(r=>r.symbol==='2330'&&r.fiscal_period==='2026-Q2');
  row.announced_at=announced;row.created_at=announced;
  const result=buildEvidenceDecision((await load(source)).data,IDENTITY);
  assert.equal(result.phase_evaluation.evaluated_count,accepted?3:2);
  assert.equal(selected(result).reasons.includes('FUNDAMENTAL_ANNOUNCEMENT_BEFORE_PERIOD_END'),!accepted);
});

test('canonical financial metadata survives the exact loader SELECT without being synthesized',async()=>{
  const source=evidenceRows();
  source.earnings[0].raw_payload={contract:'SYNTHETIC_SOURCE_IDENTITY',measurement:{period_basis:'YTD',eps_basis:'DILUTED'},source_version_ref:'SYNTHETIC_ONLY'};
  source.earnings[1].raw_payload=null;
  const before=structuredClone(source),result=await load(source);
  assert(result.requested.find(q=>q.table==='earnings_events').columns.split(',').includes('raw_payload'));
  assert.deepEqual(result.data.earnings[0].raw_payload,source.earnings[0].raw_payload);
  assert.equal(result.data.earnings[1].raw_payload,null);
  assert.equal(Object.hasOwn(result.data.earnings[2],'raw_payload'),false,'missing metadata must remain missing');
  assert.deepEqual(source,before);
});

test('an Actual-only canonical record stays incomplete; reading metadata cannot manufacture expectations',async()=>{
  const source=evidenceRows();
  const row=source.earnings.find(r=>r.symbol==='2330'&&r.fiscal_period==='2026-Q2');
  Object.assign(row,{revenue_consensus:null,eps_consensus:null,guidance_direction:null,
    raw_payload:{contract:'V1_ACTUAL_CANONICAL_CANDIDATE_V1',actual_only:true,v1_ready:false,member_publication_approved:false}});
  const {data}=await load(source),result=buildEvidenceDecision(data,IDENTITY);
  assert.equal(result.phase_evaluation.evaluated_count,2);
  assert.equal(result.phase_evaluation.blocked_count,1);
  assert(result.phase_evaluation.candidates.find(c=>c.symbol==='2330').reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING'));
  for(const field of ['revenue_consensus','eps_consensus','guidance_direction'])assert.equal(data.earnings.find(r=>r.id===row.id)[field],null);
  assert.equal(result.stock_opportunities.some(r=>r.symbol==='2330'),false);
});

test('internal canonical payload does not become public/member evidence fields',async()=>{
  const source=evidenceRows();
  source.earnings.forEach(row=>{row.raw_payload={review_document_ref:'SYNTHETIC_INTERNAL_METADATA_NOT_PUBLIC',measurement:{period_basis:'DIRECT_STANDALONE_QUARTER'}};});
  const {data}=await load(source),decision=buildEvidenceDecision(data,IDENTITY);
  assert.equal(decision.phase_evaluation.evaluated_count,3,'legacy complete projection still evaluates');
  for(const companyContentAllowed of [false,true]){
    const projection=projectEvidenceDecision(decision,{companyContentAllowed,canonicalAction:'ACT',publishedSymbols:['2330','2317','2382']});
    assert.doesNotMatch(JSON.stringify(projection),/SYNTHETIC_INTERNAL_METADATA_NOT_PUBLIC|raw_payload|review_document_ref/);
  }
});
