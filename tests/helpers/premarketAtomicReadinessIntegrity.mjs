import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_EXPORT_ARTIFACT_PATH,
  resolveConsolidationPublicExportIntegrity,
} from './consolidationPublicExportIntegrity.mjs';
import { readReviewedGitPredecessor, resolveReviewedBaselineTransition } from './reviewedBaselineTransition.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const predecessorCommit = 'c77798272c34a7be42de376a19ad2d7dc90877a7';
const namedMigration = 'supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql';
const namedMigrationHash = '32e3828364e6e69d83b675c8f3ab6a1f0b580d7e9cbcdee987620fe5d0c708ad';
const scopes = ['supabase', '.github/workflows', 'src/lib/decisionEvidence.ts',
  'src/lib/runtimeDecisionTimeline.ts', 'src/services/resolveActiveReport.ts'];
const approvedHistoricalExceptions = new Set([
  'supabase/functions/get-report-payload/index.ts',
  'supabase/functions/_shared/decision-v1-data.ts',
  'supabase/functions/_shared/decision-v1-evidence.ts',
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n');

export function verifyPremarketAtomicCoreInventory(registry, integrity, readSource = read) {
  const inventory = JSON.parse(readSource('docs/operations/evidence/premarket-atomic-core-inventory-20260917.json'));
  assert.equal(inventory.schema_version, 'PREMARKET_ATOMIC_CORE_INVENTORY_V1');
  assert.equal(inventory.predecessor_commit, predecessorCommit);
  assert.equal(inventory.predecessor_count, 109);
  assert.equal(inventory.candidate_count, 110);
  assert.deepEqual(inventory.reviewed_addition, { path: namedMigration, sha256: namedMigrationHash });
  assert.equal(inventory.predecessor.length, 109);
  const rows = inventory.predecessor;
  const paths = rows.map(row => row.path);
  assert.equal(new Set(paths).size, 109);
  assert.deepEqual(paths, [...paths].sort());
  const historicalAdditions = new Set(registry.files.filter(row => row.baseline_sha256 === null).map(row => row.path));
  const include = path => !approvedHistoricalExceptions.has(path) && !historicalAdditions.has(path)
    && (!integrity.newCandidatePaths.includes(path) || path === namedMigration);
  const predecessorPaths = git(['ls-tree', '-r', '--name-only', predecessorCommit, '--', ...scopes]).filter(include);
  assert.deepEqual(paths, predecessorPaths, 'the exact sealed 109-file predecessor set must survive');
  const candidatePaths = git(['ls-files', ...scopes]).filter(include);
  assert.deepEqual(candidatePaths, [...paths, namedMigration].sort(),
    'the sole added Core file must be the named premarket Atomic migration');
  for (const row of rows) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(execFileSync('git', ['show', `${predecessorCommit}:${row.path}`], { cwd: root })),
      row.sha256, `predecessor hash drift: ${row.path}`);
    assert.equal(sha256(readSource(row.path)), row.sha256, `candidate hash drift: ${row.path}`);
  }
  assert.equal(sha256(readSource(namedMigration)), namedMigrationHash);
  return { predecessor_count: 109, candidate_count: 110, reviewed_addition: namedMigration };
}

function resolvePremarketAtomicReadinessBaseline(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/premarket-atomic-readiness-baseline-transition-20260917.json'));
  const integrity = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_PREMARKET_READINESS_20260917',
    verifyPredecessor: predecessorRead => resolveConsolidationPublicExportIntegrity(registry, artifactBytes, predecessorRead),
  });
  return { ...integrity, atomicCoreInventory: verifyPremarketAtomicCoreInventory(registry, integrity, readSource) };
}

function resolveReportPublicationCandidateIntegrity(registry, artifactBytes, readSource) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/report-publication-contract-baseline-transition-20260917.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_PREMARKET_ATOMIC_READINESS_20260917',
    verifyPredecessor: predecessorRead => resolvePremarketAtomicReadinessBaseline(registry, artifactBytes, predecessorRead),
  });
  // Preserve the historical public result shape for every predecessor test;
  // the new candidate is an additional, exact-hash successor, not a rewrite.
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    reportPublicationCandidateIntegrity: candidate,
  };
}

export function resolvePremarketAtomicReadinessIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/cross-day-sector-recovery-baseline-transition-20260918.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_REPORT_PUBLICATION_CONTRACT_20260917',
    verifyPredecessor: predecessorRead => resolveReportPublicationCandidateIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    crossDayCandidateIntegrity: candidate,
  };
}

export const readPremarketAtomicReadinessIntegrity = registry =>
  resolvePremarketAtomicReadinessIntegrity(registry, read(PUBLIC_EXPORT_ARTIFACT_PATH));

export const readConsolidationPublicExportIntegrity = readPremarketAtomicReadinessIntegrity;
export { PUBLIC_EXPORT_ARTIFACT_PATH };
