import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PUBLIC_EXPORT_ARTIFACT_PATH,
  readPremarketAtomicReadinessIntegrity,
  resolveAtomicRowContractIntegrity,
} from './helpers/premarketAtomicReadinessIntegrity.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const registry = JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
const artifact = read(PUBLIC_EXPORT_ARTIFACT_PATH);
const inventoryPath = 'docs/operations/evidence/premarket-atomic-core-inventory-20260917.json';
const migrationPath = 'supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql';
const verify = source => resolveAtomicRowContractIntegrity(registry, artifact, source);
const changedInventory = mutate => {
  const inventory = JSON.parse(read(inventoryPath));
  mutate(inventory);
  return path => path === inventoryPath ? Buffer.from(JSON.stringify(inventory)) : read(path);
};

test('reviewed 109-to-110 transition preserves every predecessor path and hash and admits only the named SQL', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  assert.deepEqual(result.atomicCoreInventory, {
    predecessor_count: 109,
    candidate_count: 110,
    reviewed_addition: migrationPath,
  });
  assert.equal(result.reviewedBaselinePredecessor.reviewedBaselineTransition.transition_id,
    'MORNING_ALPHA_PREMARKET_READINESS_20260917');
  const atomicCandidate = result.reportPublicationCandidateIntegrity.reviewedBaselinePredecessor;
  assert.equal(atomicCandidate.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.reviewedBaselinePredecessor.newCandidatePaths.includes(path)).join(','), migrationPath);
});

test('report publication and freshness successor pins only reviewed Handler, shared validation and direct regressions', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.reportPublicationCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_REPORT_PUBLICATION_CONTRACT_20260917');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_PREMARKET_ATOMIC_READINESS_20260917');
  assert.deepEqual(successor.files.map(row => row.path).sort(), [
    'supabase/functions/_shared/market-runtime-stability.mjs',
    'supabase/functions/_shared/production-architecture-core.mjs',
    'supabase/functions/generate-daily-report-v7/index.ts',
    'tests/consolidationGeneratorEditorial.test.mjs',
    'tests/fixtures/consolidation-v1/provider-chain.test.mjs',
    'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
    'tests/marketRuntimeStability.test.mjs',
    'tests/precheckProductionParity.test.mjs',
    'tests/premarketAtomicInventory.test.mjs',
    'tests/productionReliability.test.mjs',
  ]);
  assert.throws(() => verify(path => path === 'supabase/functions/generate-daily-report-v7/index.ts'
    ? Buffer.concat([read(path), Buffer.from('\n// unreviewed drift\n')]) : read(path)), /unreviewed candidate drift/);
  assert.throws(() => verify(path => path === 'supabase/functions/_shared/market-runtime-stability.mjs'
    ? Buffer.concat([read(path), Buffer.from('\n// unreviewed freshness drift\n')]) : read(path)), /unreviewed candidate drift/);
});

test('cross-day Research successor pins only reviewed report evidence, provenance and direct regressions', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.crossDayCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_CROSS_DAY_SECTOR_RECOVERY_20260918');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_REPORT_PUBLICATION_CONTRACT_20260917');
  assert.deepEqual(successor.files.map(row => row.path).sort(), [
    '.github/workflows/validate-release.yml',
    'supabase/functions/_shared/canonical-market-state.ts',
    'supabase/functions/generate-daily-report-v7/index.ts',
    'supabase/functions/generate-daily-report-v7/market-data-evidence.ts',
    'tests/crossDaySectorReconstruction.test.ts',
    'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
    'tests/marketPublicationDelivery.test.mjs',
    'tests/premarketAtomicInventory.test.mjs',
  ]);
  assert.deepEqual(result.crossDayCandidateIntegrity.newCandidatePaths.filter(path => path.startsWith('supabase/')
    && !result.reportPublicationCandidateIntegrity.newCandidatePaths.includes(path)), []);
  for (const path of [
    'supabase/functions/generate-daily-report-v7/index.ts',
    'supabase/functions/generate-daily-report-v7/market-data-evidence.ts',
    'tests/crossDaySectorReconstruction.test.ts',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed drift\n')]) : read(name)), /unreviewed candidate drift/);
  }
});

test('full-day counterfactual successor preserves cross-day lineage and rejects unknown candidate drift', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.fullDayCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_FULL_DAY_COUNTERFACTUAL_20260918');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_CROSS_DAY_SECTOR_RECOVERY_20260918');
  assert.deepEqual(successor.files.map(row => row.path).sort(), [
    'supabase/functions/_shared/daily-delivery-recovery.ts',
    'supabase/functions/_shared/market-runtime-stability.mjs',
    'supabase/functions/daily-delivery-orchestrator/index.ts',
    'supabase/functions/fetch-market-data-v10/index.ts',
    'tests/dailyDeliveryRecovery.test.mjs',
    'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
    'tests/marketRuntimeStability.test.mjs',
    'tests/premarketAtomicInventory.test.mjs',
  ]);
  assert.deepEqual(result.txfSessionParityCandidateIntegrity.reviewedBaselinePredecessor.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.crossDayCandidateIntegrity.newCandidatePaths.includes(path)), []);
  for (const path of [
    'supabase/functions/_shared/market-runtime-stability.mjs',
    'supabase/functions/daily-delivery-orchestrator/index.ts',
    'supabase/functions/fetch-market-data-v10/index.ts',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed full-day drift\n')]) : read(name)),
    /unreviewed candidate drift/);
  }
});

test('9/21 TXF parity successor pins the sole named migration and exact shared contract surface', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.txfSessionParityCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_TXF_SESSION_DATE_PARITY_20260921');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_FULL_DAY_COUNTERFACTUAL_20260918');
  assert.deepEqual(successor.files.filter(row => row.operation === 'ADD').map(row => row.path).sort(), [
    'docs/operations/evidence/9_21_production_vs_certified_parity_report.md',
    'supabase/functions/_shared/txf-session-contract.mjs',
    'supabase/migrations/20260921120000_premarket_txf_session_date_parity_v1.sql',
    'tests/fixtures/production-parity-v3/txf-weekend-20260921.json',
    'tests/txfSessionDatabase.integration.mjs',
    'tests/txfSessionParity.test.mjs',
  ]);
  assert.deepEqual(result.txfSessionParityCandidateIntegrity.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.fullDayCandidateIntegrity.newCandidatePaths.includes(path)), [
    'supabase/migrations/20260921120000_premarket_txf_session_date_parity_v1.sql',
  ]);
  for (const path of [
    'supabase/functions/_shared/txf-session-contract.mjs',
    'supabase/functions/_shared/fetch-checkpoint-evidence.mjs',
    'supabase/functions/fetch-market-data-v10/index.ts',
    'supabase/functions/market-readiness-preflight/index.ts',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed TXF drift\n')]) : read(name)),
    /unreviewed candidate drift/);
  }
});

test('9/22 Taiwan cash phase successor pins one additive migration and the exact phase-aware runtime surface', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.taiwanCashPhaseCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_PREMARKET_TW_CASH_PHASE_20260922');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_TXF_SESSION_DATE_PARITY_20260921');
  assert.deepEqual(successor.files.filter(row => row.operation === 'ADD').map(row => row.path).sort(), [
    'supabase/functions/_shared/taiwan-cash-session-contract.mjs',
    'supabase/migrations/20260922015748_premarket_tw_cash_phase_contract_v1.sql',
    'tests/fixtures/premarket-phase-v1/production-contract-20260922.json',
    'tests/fixtures/premarket-phase-v1/taiwan-session-20260916.json',
    'tests/taiwanCashPhaseContract.test.mjs',
    'tests/taiwanCashPhaseDatabase.integration.mjs',
  ]);
  assert.deepEqual(result.taiwanCashPhaseCandidateIntegrity.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.txfSessionParityCandidateIntegrity.newCandidatePaths.includes(path)), [
    'supabase/migrations/20260922015748_premarket_tw_cash_phase_contract_v1.sql',
  ]);
  for (const path of [
    'supabase/functions/_shared/taiwan-cash-session-contract.mjs',
    'supabase/functions/_shared/fetch-checkpoint-evidence.mjs',
    'supabase/functions/_shared/fugle-taiex-provider.mjs',
    'supabase/functions/fetch-market-data-v10/index.ts',
    'supabase/functions/market-readiness-preflight/index.ts',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed Taiwan cash phase drift\n')]) : read(name)),
    /unreviewed candidate drift/);
  }
});

test('Acceptance readiness successor keeps 07:30 SLA separate from the sole 08:45 database migration', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.acceptanceReadinessCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_ACCEPTANCE_READINESS_WINDOW_PARITY_20260922');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_PREMARKET_TW_CASH_PHASE_20260922');
  assert.deepEqual(successor.files.filter(row => row.operation === 'ADD').map(row => row.path).sort(), [
    'supabase/migrations/20260922153000_acceptance_readiness_window_parity_v1.sql',
    'tests/acceptanceReadinessWindowDatabase.integration.mjs',
    'tests/acceptanceReadinessWindowParity.test.mjs',
  ]);
  assert.deepEqual(result.acceptanceReadinessCandidateIntegrity.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.taiwanCashPhaseCandidateIntegrity.newCandidatePaths.includes(path)), [
    'supabase/migrations/20260922153000_acceptance_readiness_window_parity_v1.sql',
  ]);
  for (const path of [
    'supabase/migrations/20260922153000_acceptance_readiness_window_parity_v1.sql',
    'tests/acceptanceReadinessWindowParity.test.mjs',
    'tests/acceptanceReadinessWindowDatabase.integration.mjs',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed Acceptance readiness drift\n')]) : read(name)),
    /unreviewed candidate drift/);
  }
});

test('9/23 Production parity successor pins the exact envelope/session fix and sole additive migration', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.premarketProductionParityCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_PREMARKET_PRODUCTION_PARITY_20260923');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_ACCEPTANCE_READINESS_WINDOW_PARITY_20260922');
  assert.deepEqual(successor.files.filter(row => row.operation === 'ADD').map(row => row.path).sort(), [
    'docs/operations/evidence/9_23_0650_vs_0700_production_diff.json',
    'supabase/migrations/20260923120000_premarket_ticker_envelope_session_parity_v1.sql',
    'tests/fixtures/premarket-phase-v1/production-parity-20260923.json',
    'tests/premarketProductionParity20260923.test.mjs',
    'tests/premarketProductionParityDatabase.integration.mjs',
  ]);
  assert.deepEqual(result.premarketProductionParityCandidateIntegrity.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.acceptanceReadinessCandidateIntegrity.newCandidatePaths.includes(path)), [
    'supabase/migrations/20260923120000_premarket_ticker_envelope_session_parity_v1.sql',
  ]);
  for (const path of [
    'supabase/functions/_shared/fugle-taiex-provider.mjs',
    'supabase/functions/_shared/fetch-checkpoint-evidence.mjs',
    'supabase/functions/daily-delivery-orchestrator/index.ts',
    'supabase/migrations/20260923120000_premarket_ticker_envelope_session_parity_v1.sql',
    'tests/premarketProductionParity20260923.test.mjs',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed 9/23 parity drift\n')]) : read(name)),
    /unreviewed candidate drift/);
  }
});

test('Production Evidence Recorder successor pins the append-only sidecar, replay path, and sole additive migration', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.productionEvidenceRecorderCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_PRODUCTION_EVIDENCE_RECORDER_20260923');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_PREMARKET_PRODUCTION_PARITY_20260923');
  assert.deepEqual(successor.files.filter(row => row.operation === 'ADD').map(row => row.path).sort(), [
    'docs/operations/evidence/production-evidence-gap-20260923.json',
    'docs/operations/evidence/production-evidence-recorder-latency-20260923.json',
    'docs/operations/production-incident-replay-runbook.md',
    'scripts/replay-recorded-provider-evidence.mjs',
    'supabase/functions/_shared/production-evidence-recorder.mjs',
    'supabase/migrations/20260923124500_production_evidence_recorder_v1.sql',
    'tests/productionEvidenceRecorder.test.mjs',
    'tests/productionEvidenceRecorderDatabase.integration.mjs',
  ]);
  assert.deepEqual(result.productionEvidenceRecorderCandidateIntegrity.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.premarketProductionParityCandidateIntegrity.newCandidatePaths.includes(path)), [
    'supabase/migrations/20260923124500_production_evidence_recorder_v1.sql',
  ]);
  for (const path of [
    'supabase/functions/_shared/production-evidence-recorder.mjs',
    'supabase/functions/fetch-market-data-v10/index.ts',
    'supabase/functions/market-readiness-preflight/index.ts',
    'supabase/migrations/20260923124500_production_evidence_recorder_v1.sql',
    'tests/productionEvidenceRecorder.test.mjs',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed recorder drift\n')]) : read(name)),
    /unreviewed candidate drift/);
  }
});

test('9/24 Atomic row-contract successor pins exact Production evidence and the sole minute-boundary migration', () => {
  const result = readPremarketAtomicReadinessIntegrity(registry);
  const successor = result.atomicRowContractCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(successor.transition_id, 'MORNING_ALPHA_ATOMIC_ROW_CONTRACT_20260924');
  assert.equal(successor.predecessor_integrity_id, 'MORNING_ALPHA_PRODUCTION_EVIDENCE_RECORDER_20260923');
  assert.deepEqual(successor.files.filter(row => row.operation === 'ADD').map(row => row.path).sort(), [
    'docs/operations/evidence/atomic-row-contract-rejection-20260924.json',
    'supabase/migrations/20260924004011_atomic_txf_minute_boundary_parity_v1.sql',
    'tests/atomicRowContract20260924.test.mjs',
    'tests/atomicRowContract20260924Database.integration.mjs',
    'tests/fixtures/production-parity-v4/atomic-row-20260924.json',
  ]);
  assert.deepEqual(result.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.productionEvidenceRecorderCandidateIntegrity.newCandidatePaths.includes(path)), [
    'supabase/migrations/20260924004011_atomic_txf_minute_boundary_parity_v1.sql',
  ]);
  for (const path of [
    'supabase/migrations/20260924004011_atomic_txf_minute_boundary_parity_v1.sql',
    'tests/fixtures/production-parity-v4/atomic-row-20260924.json',
    'tests/atomicRowContract20260924.test.mjs',
    'tests/atomicRowContract20260924Database.integration.mjs',
    'tests/premarketProductionParityDatabase.integration.mjs',
  ]) {
    assert.throws(() => verify(name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n// unreviewed 9/24 Atomic row drift\n')]) : read(name)),
    /unreviewed candidate drift/);
  }
});

test('unknown file, missing predecessor, changed hash and renamed migration all fail closed', () => {
  const mutations = [
    inventory => { inventory.predecessor.push({ path: 'supabase/migrations/unreviewed.sql', sha256: '0'.repeat(64) }); },
    inventory => { inventory.predecessor.pop(); },
    inventory => { inventory.predecessor[0].sha256 = '0'.repeat(64); },
    inventory => { inventory.reviewed_addition.path = 'supabase/migrations/unreviewed.sql'; },
    inventory => { inventory.reviewed_addition.sha256 = '0'.repeat(64); },
    inventory => { inventory.candidate_count = 111; },
  ];
  for (const mutate of mutations) {
    assert.throws(() => verify(changedInventory(mutate)),
      /unreviewed candidate drift|candidate_count|predecessor_count|reviewed_addition|predecessor hash drift|the exact sealed 109-file predecessor set/);
  }
  assert.throws(() => verify(path => path === migrationPath
    ? Buffer.concat([read(path), Buffer.from('\n-- unreviewed drift\n')]) : read(path)),
  /unreviewed candidate drift|candidate hash drift/);
});
