// Read-only assertions over actual captured output. This is not a provider fixture
// or a new E2E execution and never changes any historical or persistent row.
import assert from 'node:assert/strict';
import { companyEvidenceSupported } from '../../supabase/functions/_shared/research-pipeline-contract.ts';

export const HISTORICAL_COMPANY_SYMBOLS = Object.freeze(['3034', '3529', '5274', '3131', '4763']);
export function assertHistoricalIsolationProof(view) {
  assert.equal(view.kind, 'DERIVED_ACTUAL_LOCAL_OUTPUT_NOT_PROVIDER_INPUT');
  assert.equal(view.scope, 'ma-consolidation-v1-20260909200000');
  assert.equal(view.report_date, '2026-09-30');
  assert.equal(view.source_readback.sha256, '35d2cc283ced1d28e733fa6feb069a5647aa26b5c2a8b26184edf416c9076d76');
  assert.equal(view.source_result.sha256, 'fa0fcc81bf14a4a83b3acc38b29e2e6895eb329e4096ef5d560c277bb82a5838');
  assert.equal(view.source_result.status, 'PASS'); assert.equal(view.source_result.records, 102);
  assert.equal(view.source_result.run_id, '26a2fe1c-4f55-46a3-bd30-4c742106e339');
  assert.equal(view.universe_count, 75);
  assert.deepEqual(view.company_candidates.map(row => row.symbol).sort(), [...HISTORICAL_COMPANY_SYMBOLS].sort());
  for (const row of view.company_candidates) {
    assert.equal(row.eligibility, false); assert.equal(row.excluded_reason, 'No Company-Specific Source Evidence');
    assert.equal(row.related_evidence.length, 4, 'Rejected candidates retain their actual macro source lineage');
    for (const ref of row.related_evidence) {
      const source = view.referenced_evidence_index.find(item => item.evidence_id === ref.evidence_id);
      assert.ok(source, 'Every source ID must resolve to the captured actual evidence index');
      assert.equal(ref.purpose, 'approved_supply_chain_bridge');
      assert.equal(companyEvidenceSupported(row, source), false, 'Sector/other-company source cannot establish company support');
    }
  }
  assert.equal(view.phase1.candidate_count, 0); assert.deepEqual(view.phase1.recommendations, []);
  assert.equal(view.admission.source_coverage, 100); assert.deepEqual(view.admission.source_unsupported_claims, []);
  assert.deepEqual(view.admission.rejected_recommendations, [], 'Earlier universe exclusion is not a fabricated later admission rejection');
  assert.equal(view.market.cms_status, 'READY'); assert.equal(view.market.coverage, 100);
  assert.equal(view.market.content_score, 97); assert.equal(view.market.decision_mode, 'market_only');
  assert.equal(view.market.recommendation_available, false);
  assert.deepEqual(view.market.public_recommendations, []); assert.deepEqual(view.market.canonical_stocks, []);
  assert.deepEqual(view.checkpoint_records.map(row => row.checkpoint), ['PREMARKET', '0900', '0930', '1030', '1300', '1410', '1430']);
  for (const row of view.checkpoint_records) {
    assert.equal(row.scope, view.scope); assert.equal(row.producer_readback_verified, true); assert.equal(row.direct_seed_writes, 0);
    assert.ok(row.verified_symbols.length >= 6); assert.ok(row.correlation_id);
    for (const key of ['immutable_sha256', 'raw_sha256', 'canonical_sha256', 'compatibility_sha256']) assert.match(row[key], /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(view.public_export_records.map(row => row.stage), ['actual-public-export-publication', 'actual-public-export-closing']);
  for (const row of view.public_export_records) {
    assert.equal(row.revision_id, view.revision_id); assert.equal(row.reference_count, 3);
    assert.equal(row.source_references_from_actual_frozen_generator, true); assert.equal(row.external_content_os_delivery, false);
  }
  const closing = view.downstream_records.find(row => row.stage === 'durable-closing');
  assert.equal(closing.status, 'COMPLETE'); assert.equal(closing.opening_publication_revision_id, view.revision_id);
  const learning = view.downstream_records.find(row => row.stage === 'durable-learning');
  assert.equal(learning.contract.status, 'COMPLETE'); assert.equal(learning.contract.opening_publication_revision_id, view.revision_id);
  assert.equal(learning.contract.stock_prediction_count, 0); assert.equal(learning.raw_whole_set_retry_verified, true);
  const terminal = view.downstream_records.find(row => row.stage === 'actual-manual-terminal-handler');
  assert.equal(terminal.natural_scheduler_executed, false); assert.equal(terminal.automatic_stable_day, false);
  assert.equal(view.line_outbox.length, 1); assert.equal(view.line_outbox[0].status, 'SENT');
  assert.equal(view.line_outbox[0].report_date, view.report_date);
  assert.equal(view.acceptance.id, 'f7579ffe-7786-4d63-adcf-2d859524466b'); assert.equal(view.acceptance.verdict, 'PASS');
  assert.equal(view.acceptance.automatic_stable_day, false); assert.equal(view.acceptance.manual_intervention, true);
  assert.equal(view.acceptance.content_handoff_evidence_scope, 'PROJECTION_CONTRACT_ONLY_NOT_DOWNSTREAM_DELIVERY');
  assert.equal(view.historical_dates_replayed, false); assert.equal(view.exact_historical_coverage76_regenerated, false);
  assert.equal(view.production_requests, 0);
  return { actual_counterfactual_chain: true, original_five_symbols_excluded_at_universe: true,
    private_research_failed: false, exact_historical_replay: false, automatic_stable_day: false };
}
