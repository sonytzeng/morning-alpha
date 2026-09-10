// Exact, read-only adoption of this new local run's already committed prefix.
// Never promotes the retained 503 FAIL or permits a different scope/source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, validateReplayConfiguration, checkPinnedReplayInputs } from './coreConsolidationPublicExportRuntime.mjs';
import { stableInputBytes } from './coreConsolidationContinuation.mjs';

export const PUBLIC_EXPORT_CONTINUATION_SCOPE = 'ma-consolidation-v1-20260909183000';
const root = '/private/tmp/' + PUBLIC_EXPORT_CONTINUATION_SCOPE;
export const PUBLIC_EXPORT_CONTINUATION_TABLES = Object.freeze([
  'market_data', 'market_checkpoint_snapshots', 'market_quotes', 'market_data_snapshots', 'data_provider_health',
  'trading_day_state', 'reports', 'decision_snapshots', 'line_delivery_outbox', 'line_subscribers', 'learning_runs',
  'learning_predictions', 'prediction_outcomes', 'news_events', 'market_news', 'sector_rotation_scores',
  'pipeline_runs', 'member_content_revisions', 'production_acceptance_results', 'runtime_http_dispatches',
  'runtime_dead_letters', 'ma_ops_runs', 'research_sessions', 'runtime_quality_policies', 'content_os_sync_incidents',
  'editorial_reviews', 'semantic_coherence_reviews',
]);
const expectedCounts = [11, 22, 22, 22, 2, 2, 1, 1, 0, 0, 0, 0, 0, 12, 12, 3, 2, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1];
export const PUBLIC_EXPORT_PREFIX = Object.freeze({
  report_id: '9db468b4-4400-4752-a588-f1d5ab785187',
  snapshot_id: 'fec4aed8-a421-4cbb-9d34-b5b7a5bf9221',
  member_id: '7309cf47-84e1-4f8a-834d-56d07b9ed3af',
  publication_run_id: '4181aca5-2c3a-42a5-827f-b91f8682a9ec',
  prior_run_id: 'd68dfa68-701a-4bdd-92ab-8f01a48460c0',
});
const read = (path, expected) => {
  const bytes = readFileSync(path); assert.equal(sha256(bytes), expected, 'Exact continuation artifact drift: ' + path); return bytes;
};
export function loadPublicExportContinuation(manifest, repo) {
  assert.equal(manifest.schema_version, 'CORE_PUBLIC_EXPORT_POST_PUBLICATION_CONTINUATION_V1');
  assert.equal(manifest.scope, PUBLIC_EXPORT_CONTINUATION_SCOPE);
  assert.equal(manifest.evidence_directory, root + '-evidence-continuation-001');
  assert.equal(manifest.original_failure_rewritten, false); assert.equal(manifest.producer_requests_resent, false);
  assert.equal(manifest.production_operations, false); assert.equal(manifest.local_dependency_transform_only, true);
  const originalBytes = read(root + '/replay-config.json', '533ed7ce2af34aa955136d371bc4ec49b1b390c5076440230dedf026f750b8c0');
  const original = JSON.parse(originalBytes);
  const active = JSON.parse(read(root + '/replay-config-export-esm.json', 'af814d9e25790e0da8abf6008fdf51d219d9e3cf0c271b8e7ac5793cdd3566db'));
  const result = JSON.parse(read(root + '-evidence/result.json', '80b61c535cb1a293c810c386b75af60c71faecebee2a2794fadb0aedb554635a'));
  const baseline = JSON.parse(read(root + '/post-publication-failure-readback.json', 'bf0dc4a13973abcb207c205bf52e6fdfb761b8261283e62af854808cae7c193b'));
  const transformPath = root + '/bundle-successor-001/transform.json';
  const transform = JSON.parse(read(transformPath, '97283ef125f73d7ab1cb4778e4b9049bfd1739048848a0985cfa2f6855b8d024'));
  const executed = JSON.parse(read(root + '/executed-source-manifest.json', '2c833f47795bac0eb8b777fb7fcd8d08a5caab1759ceaa53428141a7e29cb389'));
  assert.equal(executed.source_files.length, 65); assert.equal(original.source_files.length, 54);
  for (const row of executed.source_files) {
    assert.ok(!row.path.includes('..') && !row.path.includes(' 2.') && !row.path.startsWith('/'));
    read(resolve(repo, row.path), row.sha256);
  }
  read(root + '/executed-source-preimages.tar', '94e39c4ae77a68499e1b4e240a82796094d8fd6c8a9de6a8f6d120a622de383d');
  assert.equal(transform.from, 'npm:@supabase/supabase-js@2.57.4');
  assert.equal(transform.to, 'https://esm.sh/@supabase/supabase-js@2.57.4?target=es2022');
  for (const key of ['product_source_modified', 'sdk_version_changed', 'runtime_external_egress', 'production_runtime_parity_claim']) assert.equal(transform[key], false);
  read(root + '/bundle-successor-001/original-index.js', 'e9fb2e9705bda7321759716a65813b0c59e766b21d8e79dc9f3bbe04d3465a32');
  read(root + '/bundle-successor-001/index.js', '20c4a8dcad1cec6193c2cc95ef212566e876cd66069d9ebd4203dc8dbbec0f0e');
  const expected = structuredClone(original), changed = expected.functions.find(row => row.slug === 'content-os-morning-alpha-source');
  changed.bundle_file = root + '/bundle-successor-001/index.js'; changed.bundle_sha256 = '20c4a8dcad1cec6193c2cc95ef212566e876cd66069d9ebd4203dc8dbbec0f0e';
  expected.bootstrap_receipts.push({ scope: manifest.scope, path: transformPath, sha256: '97283ef125f73d7ab1cb4778e4b9049bfd1739048848a0985cfa2f6855b8d024' });
  assert.deepEqual(active, expected, 'Only the exact same-version export bundle transform may differ');
  read(resolve(repo, 'tests/integration/coreConsolidationPublicExportFullChain.e2e.mjs'), '87c0c82eee2b723f6f3273659c8de5900d88ffc5816227dc28a66d6364455012');
  read(resolve(repo, 'tests/helpers/coreConsolidationPublicExportRuntime.mjs'), '8a2d454333fe346d75665a6ad1a1aa73940d93cd02e3ba37f3fd45b76bce6007');
  validateReplayConfiguration(active); checkPinnedReplayInputs(active, repo);
  return { manifest, config: active, priorResult: result, baseline };
}

export function assertPublicExportPrefixAdoption({ priorResult, baseline, actual }) {
  assert.equal(priorResult.scope, PUBLIC_EXPORT_CONTINUATION_SCOPE); assert.equal(priorResult.status, 'FAIL');
  assert.equal(priorResult.run_id, PUBLIC_EXPORT_PREFIX.prior_run_id);
  assert.equal(priorResult.full_persisted_chain_executed, false); assert.equal(priorResult.records.length, 24);
  assert.equal(priorResult.records.at(-1).stage, 'FIRST_FAILURE');
  const exportCalls = priorResult.records.filter(row => row.stage === 'handler:content-os-morning-alpha-source' && row.http);
  assert.equal(exportCalls.length, 1); assert.equal(exportCalls[0].http, 503); assert.equal(exportCalls[0].response_body.code, 'BOOT_ERROR');
  const publication = priorResult.records.find(row => row.stage === 'durable-publication');
  assert.equal(publication.report_id, PUBLIC_EXPORT_PREFIX.report_id); assert.equal(publication.revision_id, PUBLIC_EXPORT_PREFIX.snapshot_id);
  assert.equal(publication.member_revision_id, PUBLIC_EXPORT_PREFIX.member_id); assert.equal(publication.publication_run_id, PUBLIC_EXPORT_PREFIX.publication_run_id);
  for (const state of [baseline, actual]) {
    assert.equal(state.scope, PUBLIC_EXPORT_CONTINUATION_SCOPE); assert.equal(state.report_date, '2026-09-23'); assert.equal(state.warmup_date, '2026-09-22');
    assert.equal(state.prior_result_sha256, '80b61c535cb1a293c810c386b75af60c71faecebee2a2794fadb0aedb554635a');
    assert.equal(state.prior_run_id, PUBLIC_EXPORT_PREFIX.prior_run_id);
    assert.deepEqual(Object.keys(state.tables).sort(), [...PUBLIC_EXPORT_CONTINUATION_TABLES].sort());
    PUBLIC_EXPORT_CONTINUATION_TABLES.forEach((table, i) => assert.equal(state.tables[table].length, expectedCounts[i], 'Unexpected pre-continuation rows: ' + table));
    const report = state.tables.reports[0], snapshot = state.tables.decision_snapshots[0], member = state.tables.member_content_revisions[0];
    assert.equal(report.id, PUBLIC_EXPORT_PREFIX.report_id); assert.equal(report.report_date, '2026-09-23');
    assert.equal(report.ai_strategy_json.revision_id, PUBLIC_EXPORT_PREFIX.snapshot_id); assert.equal(report.ai_strategy_json.canonical_member_revision_id, PUBLIC_EXPORT_PREFIX.member_id);
    assert.equal(snapshot.id, PUBLIC_EXPORT_PREFIX.snapshot_id); assert.equal(snapshot.report_id, report.id); assert.equal(snapshot.version, 1);
    assert.equal(snapshot.decision_mode, 'market_only'); assert.equal(member.id, PUBLIC_EXPORT_PREFIX.member_id); assert.equal(member.decision_snapshot_id, snapshot.id);
    assert.equal(state.tables.pipeline_runs.filter(row => row.id === PUBLIC_EXPORT_PREFIX.publication_run_id && row.status === 'SUCCEEDED').length, 1);
    assert.deepEqual(Object.keys(state.boundary).sort(), ['receipts', 'scope', 'success']);
    assert.equal(state.boundary.success, true); assert.equal(state.boundary.scope, PUBLIC_EXPORT_CONTINUATION_SCOPE); assert.equal(state.boundary.receipts.length, 29);
    assert.equal(state.boundary.receipts.filter(row => row.provider === 'line').length, 0);
  }
  for (const table of PUBLIC_EXPORT_CONTINUATION_TABLES) assert.equal(stableInputBytes(actual.tables[table]), stableInputBytes(baseline.tables[table]), 'Actual persisted row drift: ' + table);
  assert.equal(stableInputBytes(actual.boundary.receipts), stableInputBytes(baseline.boundary.receipts), 'Prior provider receipt drift/new request');
  // Audit proves receipt bytes only. The unchanged clockAt boundary operation
  // separately proves fixture/source hashes against the pinned configuration.
  assert.equal(actual.guest.boot_id, 'd9f73673-b3e3-4daf-8080-13d8dde5b2c0');
  const now = Date.parse(actual.guest.observed_at);
  assert.ok(now >= Date.parse('2026-09-23T07:00:00+08:00') && now < Date.parse('2026-09-23T08:45:00+08:00'), 'Continuation must precede the real opening window; never rewind');
  return { status: 'EXACT_PERSISTED_PREFIX_VERIFIED', prior_run_id: PUBLIC_EXPORT_PREFIX.prior_run_id,
    prior_fail_preserved: true, original_export_http: 503, producer_requests_resent: false, all_27_tables_verified: true,
    no_downstream_success_adopted: true, publication_must_be_revalidated_by_actual_central_contract: true };
}
