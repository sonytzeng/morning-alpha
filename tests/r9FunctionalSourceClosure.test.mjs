// The immutable B24 assertions use only the exact pre-copy Owner view after
// full current successor admission; all other source reads stay current.
import {ownerStatusCopyHistoricalFsRead as readFileSync} from './helpers/ownerStatusCopyAdmission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyMemberContinuity,memberContinuityHistoricalReader} from './helpers/memberContinuityAdmission.mjs';
import {verifyHistoricalFrontendTypeClosureForOwnerCopy as verifyFrontendTypeClosure,frontendTypeClosureHistoricalReader} from './helpers/frontendTypeClosureAdmission.mjs';
import {verifyIntegrationCandidate,integrationHistoricalRead} from './helpers/integrationAdmission.mjs';
verifyFrontendTypeClosure();
// Old evidence keeps its exact two admitted member-source preimages. The new
// live tree and two replacements are verified before this narrow view exists.
verifyMemberContinuity();
const historicalFrontendRead=frontendTypeClosureHistoricalReader();
const historicalMemberRead=memberContinuityHistoricalReader(historicalFrontendRead);
const path='docs/operations/evidence/r9-functional-source-closure-20261017.json';
const bytes=readFileSync(path),p=JSON.parse(bytes),old=JSON.parse(readFileSync(p.r8_package.path));
const hash=b=>createHash('sha256').update(b).digest('hex');
const gitBlob=(revision,path)=>execFileSync('git',['--no-replace-objects','show',revision+':'+path],{maxBuffer:2000000});
// R9's immutable evaluator is tested only after full current-tree admission;
// this historical view never updates its original Caller or evidence receipt.
const historicalV1Read=name=>{
 if(name!=='supabase/functions/_shared/decision-v1-evidence.ts')return historicalFrontendRead(name);
 verifyIntegrationCandidate();return integrationHistoricalRead('core',name,readFileSync(name));
};

test('R9 binds actual changed runtime paths and preserves immutable R8 evidence without authorizing Production',()=>{
 assert.equal(p.parent_head,'d04de5da23fea367b7eab23d6c5cc42c3b25b3d5');
 assert.equal(p.base,'754850ba1c66329d12eac8e98ab799e0a0c9123e');
 assert.equal(hash(readFileSync(p.r8_package.path)),p.r8_package.sha256);
 assert.deepEqual(readFileSync(p.r8_package.path),gitBlob(p.parent_head,p.r8_package.path));
 assert.equal(p.production_authorized,false);assert.equal(p.payment,'DISABLED');
 assert.equal(p.sources.length,6);
 for(const row of p.sources)assert.equal(hash(historicalMemberRead(row.path)),row.sha256,row.path);
 assert.equal(p.production.blanket_business_diff_zero_claim,false);
});
test('Caller deploy closure stays immutable5f: new financial shared code is explicitly excluded, not mixed into A',()=>{
 const a=p.release.A,original=old.decisions[0];assert.equal(a.source_head,original.source_head);
 for(const row of original.local_sources)assert.equal(hash(gitBlob(a.source_head,row.path)),row.sha256,row.path);
 assert.equal(a.local_match,22);assert.equal(a.remote_cache_source_match,63);
 assert.equal(a.sdk,'2.57.4');assert.equal(a.verify_jwt,true);
 // This is R9's saved candidate collision set, before the separately sealed
 // frontend type-only import change; A still deploys its immutable5f source.
 const collisions=original.local_sources.filter(r=>hash(historicalV1Read(r.path))!==r.sha256).map(r=>r.path);
 assert.deepEqual(collisions,a.working_tree_collision);
 assert.deepEqual(collisions,['supabase/functions/_shared/recommendation-official-actuals.ts']);
 assert.match(a.payload_policy,/IMMUTABLE.*NOT_CURRENT/);
});
test('B is exactly24 explicit website operations, unchanged3SQL and fixed SDK, never all PR files or policy activation',()=>{
 const b=p.release.B;assert.equal(b.website_operation_count,24);assert.equal(b.operations.length,24);
 assert.equal(new Set(b.operations.map(r=>r.path)).size,24);
 assert.deepEqual(b.operations.map(r=>r.path).sort(),[...old.decisions[1].website.operations.map(r=>r.path),
  'src/pages/account/components/MorningHeroCard.tsx','src/hooks/useAccountDashboard.ts'].sort());
 for(const row of b.operations){assert.equal(hash(historicalMemberRead(row.path)),row.target_sha256,row.path);assert.equal(row.mode,'100644');}
 assert(!b.operations.some(r=>r.path.includes('ProviderCapabilityReview')||r.path.includes('financial-actuals')));
 assert.equal(b.baseline.version,674);assert.equal(b.baseline.archive_sha256,'71f36b8103622901c8bb03a97f6c2e485fb7a1d9768eb25cf81a0bd327af2d7f');
 assert.deepEqual(b.sql,old.decisions[1].sql.map(({path,sha256})=>({path,sha256})));
 for(const s of b.sql)assert.equal(hash(readFileSync(s.path)),s.sha256);
 assert.equal(b.sdk,'2.115.0');assert.equal(b.verify_jwt,false);assert.equal(b.remote_cache_source_match,54);
 assert.equal(b.policy_activation,false);assert.equal(b.research_publication,false);
 assert.match(p.release.C.status,/HOLD/);assert.match(p.release.D.status,/HOLD/);
 assert.equal(p.release.D.original_reader_v55_safe_after_private_capture,false);
});
test('fresh monthly72 coverage is new evidence, not old67 plus5 or a repaired historical cutoff',()=>{
 const f=p.financial;assert.equal(f.covered,72);assert.equal(f.universe,72);
 assert.deepEqual(f.missing,[]);assert.deepEqual(f.null_symbols,[]);assert.deepEqual(f.conflicts,[]);
 assert.deepEqual(f.captures.map(r=>r.total_source_rows),[1088,893]);
 assert.deepEqual(f.captures.map(r=>r.selected_rows),[61,11]);
 assert.equal(f.captures.length,2);assert.deepEqual(f.periods,['2026-09']);assert.equal(f.old_cutoff_eligible,0);
 for(const r of f.captures){assert.equal(r.http_status,200);assert(Date.parse(r.received_at)<=Date.parse(f.same_cutoff));assert(Date.parse(r.received_at)>Date.parse('2026-10-16T23:59:59Z'));}
 assert.equal(f.complete_four_quarter_v1,0);assert.equal(f.consensus,0);assert.equal(f.guidance,0);assert.equal(f.formal_admission,false);
 assert.match(f.historical_missing_reason,/UNKNOWN.*NOT_PROVEN_PROVIDER_EXCLUSION/);
});
test('real amount/share capabilities, issuer actuals and partial rights stay distinct',()=>{
 const i=p.institutional;assert.equal(i.market_bfi82u.normalized_rows,3);assert.equal(i.market_bfi82u.unit,'ACTUAL_TWD');
 assert.equal(i.market_bfi82u.stock_level,false);assert.equal(i.twse_t86.actual_twd_fields,0);assert.equal(i.tpex_ogl11856.actual_twd_fields,0);
 assert.match(i.tpex_ogl11856.exact_resource_license,/OGL_1_0/);assert.equal(i.purchase_necessary,'NOT_ESTABLISHED');
 const a=p.issuer_actual_capability;assert.equal(a.direct_quarter_actual_sources,4);assert.equal(a.first_seen,null);
 assert.equal(a.original_publish_exact_time,null);assert.equal(a.historical_revision,null);assert.equal(a.preannouncement_consensus,'UNPROVEN');
 assert.equal(a.guidance_direction,'UNCLASSIFIED_NOT_STABLE_DEFAULT');assert.equal(a.formal_admission,false);
});
test('real source join preserves denominators, canonical taxonomy, unchanged evaluator and no false natural results',()=>{
 const e=p.event;assert.equal(e.totals.symbols,3);assert.equal(e.totals.denominator,60);assert.equal(e.totals.stock_ohlcv_and_taiex,60);
 assert.deepEqual(e.canonical_peer_counts.map(r=>[r.symbol,r.peers]),[['2330',1],['2303',1],['2344',0]]);
 assert.equal(e.reviewed_causal_events,0);assert.equal(e.historical_cutoff_rejected,true);
 assert.equal(e.formal_v1_evaluator_sha256,hash(historicalV1Read('supabase/functions/_shared/decision-v1-evidence.ts')));
 assert.equal(e.formal_v1_evaluator_sha256,hash(gitBlob(p.parent_head,'supabase/functions/_shared/decision-v1-evidence.ts')));
 assert(e.retained_runs.every(r=>r.unchanged_v1_equivalent&&r.totals.denominator===1440&&r.totals.stock_ohlcv_and_taiex===0));
 assert.equal(e.forward_sample,0);assert.equal(e.outcome_sample,0);assert.equal(e.production_pass,false);
 assert.deepEqual(p.formal_v1,{universe:72,evaluated:0,blocked:72,ready:0,watch:0,none:0,reasons_overlap:true,source:'UNCHANGED_SAVED_20261016_NOT_NEW_FINANCIAL_SOURCE_RESULT'});
});
test('safe review package exports no credentials, local paths, raw captures, personal data or new permissions',()=>{
 const text=bytes.toString();assert.doesNotMatch(text,/\/Users\/|\/private\/tmp\/|Bearer\s+[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{15,}\.|postgres(?:ql)?:\/\/|[A-Z0-9._%+-]+@gmail\.com|BEGIN (?:RSA |EC )?PRIVATE KEY/i);
 assert.equal(p.financial.raw_rows_exported,false);
 assert.equal(p.institutional.raw_amounts_exported,false);
 assert.equal(p.event.raw_data_exported,false);
 assert.equal(p.provider_account_review.provider_authenticated_calls,0);assert.equal(p.provider_account_review.diagnostic_f_deployed,false);
 assert.equal(p.production.run_count,0);assert.equal(p.production.prediction_count,0);assert.equal(p.production.outcome_count,0);
 assert.equal(p.production.commercial_stability,'0/5');assert.equal(p.release.E.approved,0);
});
