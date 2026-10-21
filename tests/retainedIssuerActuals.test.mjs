// Synthetic data-contract controls, never real issuer outcomes or publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {withRetainedIssuerActualInputs as join} from '../research/issuer-actual-v1-input.ts';
import {evaluatePublicV1} from '../scripts/official-actuals/evaluate-public-v1.mjs';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const identity={report_date:'2026-10-21',today_date:'2026-10-21',revision_id:'synthetic-held-actual-input',
  generated_at:'2026-10-21T01:00:00.000Z',data_as_of:'2026-10-21T01:00:00.000Z',is_trading_day:true};
const flags={source_admission:false,quality_admission:false,member_publication:false,
  symbol_to_issuer_mapping_reviewed:false,accounting_classification_reviewed:false};
function parsed(symbol='2454',quarter=2) {
  const year=2026,start=new Date(Date.UTC(year,(quarter-1)*3,1)).toISOString().slice(0,10),end=new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10);
  const common={entity:symbol,source_sha256:'a'.repeat(64),fiscal_period:`${year}Q${quarter}`,period_start:start,period_end:end,
    scope:'CONSOLIDATED',currency:'TWD',period_basis:'DIRECT_THREE_MONTHS',...flags,cell:{page:6,bbox:[100,200,130,210]}};
  return {contract:'issuer-pdf-descriptor-candidate-v1',descriptor_is_approval:false,private_operator_only:true,untrusted_service_sandbox:false,
    ...flags,entity:symbol,source_url:'https://example.test/issuer-quarter.pdf',source_sha256:'a'.repeat(64),source_bytes:1000,
    descriptor_sha256:'b'.repeat(64),receipt_sha256:'c'.repeat(64),source_path:'PRIVATE_PATH_NOT_OUTPUT',receipt_path:'PRIVATE_RECEIPT_PATH_NOT_OUTPUT',
    first_seen_at:'2026-10-20T01:00:00.000Z',source_received_at:'2026-10-20T01:00:01.000Z',source_available_at:'2026-10-20T01:00:02.000Z',
    first_verified_at:'2026-10-20T02:00:00.000Z',normalization_available_at:'2026-10-20T02:00:01.000Z',conservative_available_at:'2026-10-20T02:00:01.000Z',
    capture_kind:'HTTP_RESPONSE_RECEIPT',http_status:200,http_status_observed:true,announced_at:null,source_version:null,revision_chain:null,
    legal_reuse_approval:null,ytd_or_annual_subtraction_used:false,canonical_writer_invoked:false,
    accounting:{classification:'FSC_ENDORSED_IAS34_INTERIM'},period_evidence:{year,quarter,period_start:start,period_end:end},
    rows:[{...common,metric:'revenue',value_decimal:'1234567000',unit:'TWD',multiplier:'1000',display_resolution_decimal:'1000',share_proof:null},
      {...common,metric:'basic_eps',value_decimal:'1.23',unit:'TWD/ordinary_share',multiplier:'1',display_resolution_decimal:'0.01',
        share_proof:{share_class:'ORDINARY',eps_basis:'BASIC'}}]};
}
function data(symbols=['2454']) {const d=emptyEvidenceData();d.universe=symbols.map(symbol=>({symbol,is_active:true,
  stock_name:'Synthetic control',sector:'synthetic-control',created_at:'2026-09-01T00:00:00.000Z',updated_at:'2026-09-01T00:00:00.000Z'}));return d;}
async function packet(p=parsed()) {return {parsed:p,parsed_sha256:await snapshotHash(p)};}
test('native quarter pair reaches original V1 earnings, never canonical approval, guessed announcement or expectations',async()=>{
  const d=data(),original=structuredClone(d),out=await join(d,identity,[await packet()]);
  assert.equal(out.appended_rows,1);const r=out.data.earnings[0];assert.equal(r.eps_actual,1.23);assert.equal(r.revenue_actual,1234567000);
  for(const k of ['announced_at','revenue_consensus','eps_consensus','guidance_direction'])assert.equal(r[k],null);
  assert.equal(r.created_at,identity.generated_at);assert.equal(r.actual_source.source_available_at,'2026-10-20T01:00:02.000Z');
  assert.equal(r.actual_source.first_seen_at,'2026-10-20T01:00:00.000Z');
  assert.equal(r.actual_source.measurements[0].display_resolution_decimal,'1000');
  assert.equal(r.source_admitted,false);assert.equal(out.source_admission,false);assert.equal(out.canonical_writes,0);
  assert.equal(r.legal_reuse_approval,null);assert.equal(r.actual_source.legal_reuse_approval,null);
  assert.equal(r.actual_source.revision_chain,null);assert.equal(out.source_receipts[0].legal_reuse_approval,null);
  assert.equal(out.source_receipts[0].revision_chain,null);
  assert.equal(out.member_publication,false);assert.equal(out.forward_sample,0);assert.equal(out.outcome_sample,0);
  assert.deepEqual(d,original);assert.doesNotMatch(JSON.stringify(out),/PRIVATE_PATH|PRIVATE_RECEIPT_PATH/);
  const decision=buildEvidenceDecision(out.data,identity);assert.equal(decision.phase_evaluation.evaluated_count,0);
  assert.equal(decision.phase_evaluation.blocked_count,1);assert(decision.phase_evaluation.candidates[0].reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING'));
});
test('idempotent same study does not duplicate rows; conflicting saved same ID fails closed',async()=>{
  const p=await packet(),a=await join(data(),identity,[p]),b=await join(a.data,identity,[p]);
  assert.equal(b.appended_rows,0);assert.deepEqual(a.data,b.data);
  a.data.earnings[0].eps_actual=999;await assert.rejects(join(a.data,identity,[p]),/EXISTING_ROW_CONFLICT/);
});
test('all 72 original symbols can use the same bridge without issuer-specific helpers or partial universe success claims',async()=>{
  const symbols=Array.from({length:72},(_,i)=>String(1500+i)),packets=await Promise.all(symbols.map(s=>packet(parsed(s))));
  const out=await join(data(symbols),identity,packets);assert.equal(out.appended_rows,72);assert.equal(out.source_receipts.length,72);
  assert.equal(out.data.earnings.length,72);assert(out.data.earnings.every(r=>r.announced_at===null&&r.source_admitted===false));
});
test('tampered parsed content cannot reuse its old digest',async()=>{
  const p=await packet();p.parsed.rows[0].value_decimal='999';await assert.rejects(join(data(),identity,[p]),/PARSER_DIGEST/);
});
test('fake publication, admission, legal approval, annual arithmetic or canonical flags are never silently dropped',async()=>{
  for(const change of [p=>p.announced_at=p.first_seen_at,p=>p.source_admission=true,p=>p.member_publication=true,
    p=>p.legal_reuse_approval=true,p=>p.ytd_or_annual_subtraction_used=true,p=>p.canonical_writer_invoked=true,
    p=>p.symbol_to_issuer_mapping_reviewed=true,p=>p.rows[0].quality_admission=true]){
    const p=parsed();change(p);await assert.rejects(join(data(),identity,[await packet(p)]));
  }
});
test('future, missing-zone, impossible or reordered source/normalization timestamps are refused',async()=>{
  for(const [k,v] of [['first_seen_at','2026-10-20T01:00:00'],['first_seen_at','2026-02-30T01:00:00Z'],
    ['first_seen_at','2026-10-21T02:00:00Z'],['source_available_at','2026-10-20T00:00:00Z'],
    ['normalization_available_at','2026-10-20T01:00:00Z'],['conservative_available_at','2026-10-21T02:00:00Z']]){
    const p=parsed();p[k]=v;await assert.rejects(join(data(),identity,[await packet(p)]),/TIME/);
  }
});
test('retained microseconds remain exact; a one-microsecond future or reversed instant is not rounded into cutoff',async()=>{
  const p=parsed();p.first_verified_at='2026-10-20T02:00:00.000001+00:00';
  p.normalization_available_at='2026-10-20T02:00:00.000002Z';p.conservative_available_at=p.normalization_available_at;
  const out=await join(data(),identity,[await packet(p)]);
  assert.equal(out.source_receipts[0].normalization_available_at,p.normalization_available_at);
  p.first_verified_at='2026-10-20T02:00:00.000003Z';await assert.rejects(join(data(),identity,[await packet(p)]),/TIME/);
  p.first_verified_at='2026-10-20T02:00:00.000001Z';p.conservative_available_at='2026-10-21T01:00:00.000001Z';
  await assert.rejects(join(data(),identity,[await packet(p)]),/TIME/);
});
test('wrong issuer/quarter/source/units/share basis/YTD cannot masquerade as direct Actual',async()=>{
  for(const change of [p=>p.entity='9999',p=>p.rows[0].entity='2330',p=>p.rows[0].source_sha256='d'.repeat(64),
    p=>p.period_evidence.period_start='2026-01-01',p=>p.rows[0].period_basis='YTD',p=>p.rows[1].unit='USD/ADR',
    p=>p.rows[1].share_proof.share_class='ADR',p=>p.rows[1].share_proof.eps_basis='DILUTED',p=>p.rows[0].unit='USD']){
    const p=parsed();change(p);await assert.rejects(join(data(),identity,[await packet(p)]));
  }
});
test('missing native revenue remains a precise gap, not zero or EPS-only four-quarter completion',async()=>{
  const p=parsed();p.rows=p.rows.filter(r=>r.metric==='basic_eps');const out=await join(data(),identity,[await packet(p)]);
  assert.equal(out.appended_rows,0);assert.equal(out.source_receipts.length,1);assert.equal(out.gaps[0].reason,'NATIVE_ACTUAL_PAIR_INCOMPLETE');
});
test('unreviewed financial metric profile remains held and cannot become generic revenue',async()=>{
  const p=parsed();p.accounting.classification='FINANCIAL_TIFRS_FH';const out=await join(data(),identity,[await packet(p)]);
  assert.equal(out.appended_rows,0);assert.equal(out.gaps[0].reason,'ACCOUNTING_CLASSIFICATION_REVIEW_REQUIRED');
});
test('duplicate metrics and same-quarter competing versions are not combined or cherry-picked',async()=>{
  const p=parsed();p.rows[1]=p.rows[0];await assert.rejects(join(data(),identity,[await packet(p)]),/DUPLICATE_METRIC/);
  const a=await packet(),q=parsed();q.source_sha256='d'.repeat(64);q.rows.forEach(r=>r.source_sha256=q.source_sha256);
  await assert.rejects(join(data(),identity,[a,await packet(q)]),/DUPLICATE_QUARTER/);
  const first=await join(data(),identity,[a]),unchanged=structuredClone(first.data);
  await assert.rejects(join(first.data,identity,[await packet(q)]),/EXISTING_QUARTER_CONFLICT/);
  assert.deepEqual(first.data,unchanged);
});
test('native small Decimal scientific notation preserves resolution without generic coercion or underflow',async()=>{
  const p=parsed();p.rows[1].display_resolution_decimal='1E-8';
  const out=await join(data(),identity,[await packet(p)]);
  assert.equal(out.data.earnings[0].actual_source.measurements[1].display_resolution_decimal,'1E-8');
  for(const value of ['NaN','Infinity','1E-99','1E99','1E309','0x10','1.123456789012E-12']){
    const bad=parsed();bad.rows[1].display_resolution_decimal=value;
    await assert.rejects(join(data(),identity,[await packet(bad)]),/DECIMAL/);
  }
});
test('locators reject reversed/negative geometry and project no private path or extra properties',async()=>{
  for(const bbox of [[130,210,100,200],[-1,200,130,210],[100,200,100,210],[100,200,130,200]]){
    const bad=parsed();bad.rows[0].cell.bbox=bbox;await assert.rejects(join(data(),identity,[await packet(bad)]),/LOCATOR/);
  }
  const p=parsed();p.rows[0].cell.private_path='MUST_NOT_ESCAPE_LOCATOR';
  const out=await join(data(),identity,[await packet(p)]);
  assert.deepEqual(Object.keys(out.data.earnings[0].actual_source.measurements[0].cell).sort(),['bbox','page']);
  assert.doesNotMatch(JSON.stringify(out),/MUST_NOT_ESCAPE_LOCATOR|private_path/);
});
test('unknown native HTTP remains unknown, not fabricated HTTP 200',async()=>{
  const p=parsed();p.capture_kind='BROWSER_NATIVE_PUBLIC_DOWNLOAD_RECEIPT_V1';p.http_status=null;p.http_status_observed=false;
  assert.equal((await join(data(),identity,[await packet(p)])).appended_rows,1);
  p.http_status=200;await assert.rejects(join(data(),identity,[await packet(p)]),/CAPTURE_KIND/);
});
test('cutoff/size bounds and await-time caller mutation cannot retarget immutable input',async()=>{
  const d=data(),p=await packet(),pending=join(d,identity,[p]);p.parsed.entity='9999';d.universe=[];
  assert.equal((await pending).data.earnings[0].symbol,'2454');
  await assert.rejects(join(data(),{...identity,today_date:'2026-10-20'},[]),/IDENTITY/);
  await assert.rejects(join(data(),identity,Array(289).fill(await packet())),/SCOPE/);
  const big=parsed();big.extra='x'.repeat(131072);await assert.rejects(join(data(),identity,[await packet(big)]),/PARSER_DIGEST/);
});
test('existing public evaluator consumes pinned held inputs without awaiting-time bundle retargeting',async()=>{
  const bundle={schema:'EVENT_ALIGNMENT_REFRESH_BUNDLE_V1',input:{receipts:[],overlay_receipts:[],
    observation:{source:'public.sector_stock_map',observed_at:'2026-10-21T00:00:00.000Z',rows:data(RECOMMENDATION_UNIVERSE).universe.map(({symbol,sector,is_active,created_at,updated_at})=>({symbol,sector,is_active,created_at,updated_at}))},
    retained_issuer_actuals:[await packet()]},new_receipts:[]};
  const originalHash=await snapshotHash(bundle);let requests=0;
  const out=await evaluatePublicV1(bundle,{now:()=>identity.generated_at,fetcher:async()=>{
    requests++;bundle.input.retained_issuer_actuals=[];return Response.json([]); // Synthetic transport only.
  }});
  assert.equal(requests,2);assert.equal(out.source_input_sha256,originalHash);
  assert.equal(out.held_issuer_actual_rows,1);assert.equal(out.held_issuer_actual_symbols,1);assert.equal(out.actual_rows,5);
  assert.equal(out.held_issuer_actual_receipts.length,1);assert.equal(out.held_issuer_actual_receipts[0].symbol,'2454');
  assert.equal(out.after.universe,72);assert.equal(out.after.evaluated,0);assert.equal(out.after.blocked,72);
  assert.equal(out.production_operations,0);assert.equal(out.member_publication_approved,false);assert.equal(out.forward_sample,0);
});
