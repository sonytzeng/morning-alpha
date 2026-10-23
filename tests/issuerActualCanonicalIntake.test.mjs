// Synthetic intake/refusal tests, NOT source review or Production admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareIssuerActualCanonicalIntake as prepare} from '../research/issuer-actual-canonical-intake.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {syntheticIssuerPdfActual} from './fixtures/issuerPdfActual.mjs';
import {evaluatePublicV1} from '../scripts/official-actuals/evaluate-public-v1.mjs';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const identity={report_date:'2026-10-20',today_date:'2026-10-20',generated_at:'2026-10-20T00:10:00Z',
 data_as_of:'2026-10-20T00:10:00Z',revision_id:'synthetic-pdf-canonical-intake',is_trading_day:true};
const data=()=>({...emptyEvidenceData(),universe:[{symbol:'2330',is_active:true}]});
const packet=async p=>({parsed:p,parsed_sha256:await snapshotHash(p)});
test('native PDF pair is prepared for a distinct reviewed SQL dialect, never manufactured XBRL or approval',async()=>{
 const d=data(),out=await prepare(d,identity,[await packet(syntheticIssuerPdfActual())]);
 assert.equal(d.earnings.length,0);assert.equal(out.prepared.length,1);
 const p=out.prepared[0];assert.equal(p.source.source_format,'ISSUER_PDF_DIRECT_QUARTER_V1');
 assert.equal(p.source.source_version_ref,null);assert.equal(p.source.version_status,'UNKNOWN');
 assert.equal(p.source.first_seen_at,'2026-10-19T01:00:00.000001Z');
 assert.equal(p.source.available_at,'2026-10-19T01:00:00.000006Z');
 for(const key of ['revenue_namespace','revenue_concept','eps_namespace','eps_concept'])assert.equal(p.actual[key],null);
 assert.equal(p.actual.revenue_actual,'123456789');assert.equal(p.actual.eps_actual,'1.25');
 assert.equal(p.actual.pdf_measurement.revenue.value_decimal,p.actual.revenue_actual);
 assert.equal(p.actual.pdf_measurement.eps.page,6);assert.equal(p.actual.eps_basis,'BASIC');
 for(const key of ['announced_at','announcement_precision','announcement_source_ref','announcement_document_sha256','announcement_version_ref'])assert.equal(p.review_requirements[key],null);
 assert.equal(p.review_requirements.quality_status,'PENDING');assert.equal(p.review_requirements.internal_rights_status,'PENDING');
 assert.equal(out.source_admission,false);assert.equal(out.quality_approval,false);assert.equal(out.member_publication,false);
 assert.equal(out.canonical_writes,0);assert.equal(out.forward_sample,0);assert.equal(out.outcome_sample,0);
 assert.doesNotMatch(JSON.stringify(out),/PRIVATE_SYNTHETIC_PATH|authority_id|source_revision_id|status":"APPROVED/);
});
test('existing held earnings are not overwritten or reused as source authority; exact preparation is deterministic',async()=>{
 const d=data(),p=await packet(syntheticIssuerPdfActual()),a=await prepare(d,identity,[p]);
 d.earnings=[{symbol:'2330',fiscal_period:'2026-Q2',eps_actual:999,source_admitted:true}];
 assert.deepEqual(await prepare(d,identity,[p]),a);assert.equal(d.earnings[0].eps_actual,999);
});
test('the 8,000,000-byte SQL source bound is distinct from the private 8 MiB parser bound',async()=>{
 for(const [bytes,expected] of [[8000000,1],[8000001,0],[8388608,0]]){
  const p=syntheticIssuerPdfActual();p.source_bytes=bytes;
  const out=await prepare(data(),identity,[await packet(p)]);assert.equal(out.prepared.length,expected);
  assert.equal(out.gaps.length,expected?0:1);
  if(!expected)assert.equal(out.gaps[0].reason,'CANONICAL_SOURCE_BYTES_UNSUPPORTED');
 }
});
test('shared original validator rejects tampering/YTD/units/future time and keeps incomplete native pairs held',async()=>{
 const p=await packet(syntheticIssuerPdfActual());p.parsed.rows[0].value_decimal='999';
 await assert.rejects(prepare(data(),identity,[p]),/PARSER_DIGEST/);
 for(const change of [p=>p.rows[0].period_basis='YTD',p=>p.rows[1].unit='USD/ADR',
  p=>p.announced_at=p.first_seen_at,p=>p.conservative_available_at='2026-10-20T00:10:00.000001Z']){
  const q=syntheticIssuerPdfActual();change(q);await assert.rejects(prepare(data(),identity,[await packet(q)]));
 }
 const q=syntheticIssuerPdfActual();q.rows=q.rows.slice(1);
 const held=await prepare(data(),identity,[await packet(q)]);assert.equal(held.prepared.length,0);
 assert.equal(held.gaps[0].reason,'NATIVE_ACTUAL_PAIR_INCOMPLETE');
});
test('existing public evidence CLI wires intake into PRIVATE facts only, with original 72-stock evaluator still blocked',async()=>{
 const universe=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,sector:'SYNTHETIC_SECTOR',is_active:true,
  created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'}));
 const bundle={schema:'EVENT_ALIGNMENT_REFRESH_BUNDLE_V1',input:{receipts:[],overlay_receipts:[],
  observation:{source:'public.sector_stock_map',observed_at:'2026-10-20T00:00:00Z',rows:universe},
  retained_issuer_actuals:[await packet(syntheticIssuerPdfActual())]},new_receipts:[]};
 const out=await evaluatePublicV1(bundle,{now:()=>identity.generated_at,fetcher:async()=>Response.json([])});
 assert.equal(out.canonical_actual_intake_rows,1);assert.equal(out.after.universe,72);
 assert.equal(out.after.evaluated,0);assert.equal(out.production_operations,0);
 assert.equal(out.captured_official_facts.canonical_actual_intake.prepared[0].review_requirements.quality_status,'PENDING');
 assert.equal(out.captured_official_facts.canonical_actual_intake.source_admission,false);
 const {captured_official_facts,...summary}=out;
 assert.doesNotMatch(JSON.stringify(summary),/value_decimal|pdf_measurement|revenue_actual|eps_actual/);
 assert.equal(captured_official_facts.canonical_actual_intake.canonical_writes,0);
});
