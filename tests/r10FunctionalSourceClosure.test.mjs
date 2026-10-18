import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyMemberContinuity,memberContinuityHistoricalReader} from './helpers/memberContinuityAdmission.mjs';
// Old evidence keeps its exact two admitted member-source preimages. The new
// live tree and two replacements are verified before this narrow view exists.
verifyMemberContinuity();
const historicalMemberRead=memberContinuityHistoricalReader();
const file='docs/operations/evidence/r10-functional-source-closure-20261017.json';
const bytes=readFileSync(file),p=JSON.parse(bytes);
const hash=b=>createHash('sha256').update(b).digest('hex');

test('R10 source closure preserves R9 and immutable V1, never grants Production authority',()=>{
 assert.equal(p.parent_head,'882d6799e4646c7917621843a65b960f7a7666ed');
 assert.equal(p.base,'754850ba1c66329d12eac8e98ab799e0a0c9123e');
 assert.equal(hash(readFileSync(p.prior_r9.path)),p.prior_r9.sha256);
 assert.deepEqual(readFileSync(p.prior_r9.path),execFileSync('git',['show',p.parent_head+':'+p.prior_r9.path]));
 for(const s of p.sources)assert.equal(hash(historicalMemberRead(s.path)),s.sha256,s.path);
 assert.equal(p.price.formal_v1_evaluator_unchanged,hash(readFileSync('supabase/functions/_shared/decision-v1-evidence.ts')));
 assert.equal(p.production_authorized,false);assert.equal(p.production.explicit_mutation_actions,0);
});
test('real price coverage keeps 72x20, independent old and overlay results, full same-cutoff peers and original cutoff refusal',()=>{
 const r=p.price;
 assert.equal(r.original.denominator,1440);assert.equal(r.before.denominator,1440);assert.equal(r.after.denominator,1440);
 assert.equal(r.original.stock_ohlcv_and_taiex,1296);assert.equal(r.before.stock_ohlcv_and_taiex,1302);
 assert.equal(r.after.stock_ohlcv_and_taiex,1440);assert.equal(r.filled_stock_days,138);
 assert.equal(r.requests,60);assert.equal(r.new_receipts,60);assert.equal(r.receipt_files_hash_checked,60);
 assert.equal(r.halted,null);assert.equal(r.response_bytes,3892850);assert(r.elapsed_ms<=150000);
 assert.equal(r.cutoff,'2026-10-17T08:55:36.500Z');assert.equal(r.expected_sessions.length,20);
 assert.deepEqual(r.expected_sessions.slice(-2),['2026-10-15','2026-10-16']);
 assert.equal(r.taiex_sessions,20);assert.equal(r.canonical_symbols,72);assert.equal(r.canonical_min_peers,2);
 assert.equal(r.full_peer_windows,72);assert.deepEqual(r.remaining_stock_dates,[]);
 assert.equal(r.new_at_saved_1016_cutoff_quotes,0);assert.equal(r.old_cutoff_rejected,true);
 assert.equal(r.existing_db_inventory.complete_symbols,72);assert.equal(r.existing_db_inventory.date_20261016_symbols,0);
 assert.equal(r.existing_db_inventory.db_rows_recast_as_source_receipts,false);
 assert.equal(r.assessment_session,'NOT_A_TRADING_SESSION');assert.equal(r.forward_sample,0);assert.equal(r.outcome_sample,0);
 assert.equal(r.reviewed_causal_events,0);assert.equal(r.formal_source_admission,false);assert.equal(r.raw_values_in_repository,false);
});
test('issuer actual, guidance and causal draft limits do not become completed V1 or publication',()=>{
 const a=p.issuer_actuals;
 assert.deepEqual(a.observed_quarters,['2025-Q4','2026-Q1','2026-Q2','2026-Q3']);
 assert.equal(a.standalone_releases_directly_observed,4);assert.equal(a.common_share_basis_direct,2);
 assert.equal(a.common_share_basis_indexed_only,2);assert.equal(a.original_publication_instant,null);
 assert.equal(a.original_version,null);assert.equal(a.revenue_precision_twd,10000000);
 assert.equal(a.consensus_before_announcement,0);assert.equal(a.guidance_direction,null);assert.equal(a.formal_complete_v1_symbols,0);
 assert.equal(p.event.reviewable_drafts,1);assert.equal(p.event.reviewed_causal_events,0);
 assert.equal(p.event.approved_causal_reviews_passed_to_existing_adapter,0);assert.equal(p.event.canonical_rows_created,0);
 assert.equal(p.event.member_publication,false);
});
test('A immutable payload, B24 exact operations and policy separation remain fail-closed',()=>{
 const old=JSON.parse(readFileSync(p.prior_r9.path));
 assert.equal(p.release.A.source_head,'5f33777836778e3600e4e377fcb3cf4de690fe80');
 assert.equal(p.release.A.local_match,22);assert.equal(p.release.A.remote_cache_source_match,63);
 assert.deepEqual(p.release.B.operations,old.release.B.operations);assert.equal(p.release.B.operations.length,24);
 for(const o of p.release.B.operations)assert.equal(hash(historicalMemberRead(o.path)),o.target_sha256,o.path);
 assert.deepEqual(p.release.B.sql,old.release.B.sql);
 for(const s of p.release.B.sql)assert.equal(hash(readFileSync(s.path)),s.sha256);
 assert.equal(p.release.B.verify_jwt,false);assert.equal(p.release.B.policy_activation,false);
 assert.equal(p.release.C.activation,false);assert.equal(p.release.C.installed,false);
 assert.deepEqual(p.release.C.legal_formal_sessions_observed,{owner:1,free:0,premium:0,legacy:0});
 assert.equal(p.release.D.direct_v55_rollback_after_private_capture,false);assert.equal(p.release.E.historical_research_publication,0);
});
test('capability proof is product-specific, cost/entitlement unknown and no purchase or raw data claims',()=>{
 const c=JSON.parse(readFileSync(p.capability.path));assert.equal(hash(readFileSync(p.capability.path)),p.capability.sha256);
 assert.equal(c.authority.source_admission_changed,false);assert.equal(c.authority.purchase_recommended_or_authorized,false);
 assert.equal(c.institutional_actual_twd.excluded_candidate.classification,'DERIVED_PRICE_TIMES_QUANTITY_NOT_ACTUAL_TWD');
 assert.equal(p.capability.cost,'UNKNOWN');assert.equal(p.capability.current_account_entitlement,'UNKNOWN');
 assert.equal(p.capability.new_authenticated_provider_calls,0);
 assert.doesNotMatch(bytes.toString(),/\/Users\/|\/private\/tmp\/|Bearer\s+[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{15,}\.|postgres(?:ql)?:\/\/|@gmail\.com|BEGIN.*PRIVATE KEY/i);
 assert.equal(p.production.payment,'DISABLED');assert.equal(p.production.commercial_stability,'0/5');
 assert.equal(p.production.formal_v1.evaluated,0);assert.equal(p.production.formal_v1.blocked,72);
 assert.equal(p.production.natural_runs,0);assert.equal(p.production.predictions,0);assert.equal(p.production.outcomes,0);
});
