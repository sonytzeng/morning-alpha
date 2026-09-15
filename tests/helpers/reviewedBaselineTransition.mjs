import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = value => /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(String(value || '')) &&
  !String(value).split('/').includes('..') && !String(value).includes(' 2.');

export function readReviewedGitPredecessor(row, repositoryRoot) {
  if (row.operation === 'ADD') return null;
  assert.match(String(row.predecessor_git_sha || ''), /^[a-f0-9]{40}$/);
  assert.ok(safePath(row.path));
  return execFileSync('git', ['show', `${row.predecessor_git_sha}:${row.path}`], {
    cwd: repositoryRoot,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function resolveReviewedBaselineTransition({
  manifest,
  readSource,
  readPredecessor,
  verifyPredecessor,
}) {
  assert.equal(manifest.schema_version, 'REVIEWED_BASELINE_TRANSITION_V1');
  assert.match(String(manifest.transition_id || ''), /^[A-Z0-9_]+$/);
  assert.match(String(manifest.candidate_base_git_sha || ''), /^[a-f0-9]{40}$/);
  assert.equal(manifest.predecessor_integrity_id, 'CORE_ACCEPTANCE_DEFAULT_V1_ADMISSION');
  assert.ok(String(manifest.approval_provenance || '').length > 100);
  assert.equal(manifest.affected_tests_status, 'PASS');
  assert.ok(Array.isArray(manifest.affected_tests) && manifest.affected_tests.length > 0);
  assert.ok(Array.isArray(manifest.baseline_excluded_reviewed_paths));
  assert.equal(new Set(manifest.baseline_excluded_reviewed_paths.map(row => row.path)).size,
    manifest.baseline_excluded_reviewed_paths.length, 'duplicate baseline-excluded path');
  for (const row of manifest.baseline_excluded_reviewed_paths) {
    assert.ok(safePath(row.path), `unsafe baseline-excluded path: ${row.path}`);
    assert.match(String(row.candidate_sha256 || ''), /^[a-f0-9]{64}$/);
    assert.ok(String(row.reason || '').length > 30);
    assert.equal(hash(Buffer.from(readSource(row.path))), row.candidate_sha256,
      `reviewed baseline-excluded path drift: ${row.path}`);
  }
  assert.ok(Array.isArray(manifest.baseline_restored_reviewed_paths));
  assert.equal(new Set(manifest.baseline_restored_reviewed_paths.map(row => row.path)).size,
    manifest.baseline_restored_reviewed_paths.length, 'duplicate baseline-restored path');
  const baselineRestored = new Map();
  for (const row of manifest.baseline_restored_reviewed_paths) {
    assert.ok(safePath(row.path), `unsafe baseline-restored path: ${row.path}`);
    assert.match(String(row.baseline_git_sha || ''), /^[a-f0-9]{40}$/);
    assert.match(String(row.baseline_sha256 || ''), /^[a-f0-9]{64}$/);
    assert.match(String(row.candidate_sha256 || ''), /^[a-f0-9]{64}$/);
    assert.ok(String(row.reason || '').length > 30);
    assert.equal(hash(Buffer.from(readSource(row.path))), row.candidate_sha256,
      `reviewed baseline-restored candidate drift: ${row.path}`);
    const baseline = Buffer.from(readPredecessor({
      operation: 'MODIFY', path: row.path, predecessor_git_sha: row.baseline_git_sha,
    }));
    assert.equal(hash(baseline), row.baseline_sha256,
      `reviewed baseline-restored predecessor drift: ${row.path}`);
    baselineRestored.set(row.path, baseline);
  }
  for (const claim of [
    'production_destructive_migration', 'auth_change', 'rls_relaxation', 'secret_change',
    'historical_data_change', 'member_change', 'natural_day_pass_claimed',
  ]) assert.equal(manifest[claim], false, `reviewed transition grants no ${claim}`);

  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  assert.equal(new Set(manifest.files.map(row => row.path)).size, manifest.files.length, 'duplicate transition path');
  const restored = new Map();
  const overrides = new Map();
  for (const row of manifest.files) {
    assert.ok(safePath(row.path), `unsafe transition path: ${row.path}`);
    assert.ok(['ADD', 'MODIFY'].includes(row.operation));
    assert.match(String(row.candidate_sha256 || ''), /^[a-f0-9]{64}$/);
    assert.ok(String(row.source_lineage || '').length > 30);
    assert.ok(String(row.reason || '').length > 20);
    assert.ok(String(row.rollback_target || '').length > 20);
    const candidate = Buffer.from(readSource(row.path));
    assert.equal(hash(candidate), row.candidate_sha256, `unreviewed candidate drift: ${row.path}`);
    const predecessor = readPredecessor(row);
    if (row.operation === 'ADD') {
      assert.equal(predecessor, null, `new file unexpectedly has predecessor: ${row.path}`);
      assert.equal(row.predecessor_sha256, null);
      restored.set(row.path, null);
    } else {
      const bytes = Buffer.from(predecessor);
      assert.match(String(row.predecessor_sha256 || ''), /^[a-f0-9]{64}$/);
      assert.equal(hash(bytes), row.predecessor_sha256, `predecessor drift: ${row.path}`);
      assert.notEqual(row.predecessor_sha256, row.candidate_sha256, `unchanged transition row: ${row.path}`);
      restored.set(row.path, bytes);
    }
    overrides.set(row.path, row.candidate_sha256);
  }

  const predecessorRead = path => {
    if (!restored.has(path)) return readSource(path);
    const bytes = restored.get(path);
    if (bytes !== null) return bytes;
    throw Object.assign(new Error(`reviewed successor absent from predecessor: ${path}`), { code: 'ENOENT' });
  };
  const predecessor = verifyPredecessor(predecessorRead);
  assert.ok(predecessor && typeof predecessor === 'object', 'predecessor Integrity result required');
  const productBaselineRead = path => baselineRestored.get(path) ?? predecessor.predecessorReadSource(path);
  return {
    ...predecessor,
    reviewedBaselineTransition: manifest,
    reviewedBaselinePredecessorReadSource: predecessorRead,
    predecessorReadSource: productBaselineRead,
    fileHash: row => overrides.get(row.path) ?? predecessor.fileHash(row),
    newCandidatePaths: [...new Set([
      ...predecessor.newCandidatePaths,
      ...manifest.files.filter(row => row.operation === 'ADD').map(row => row.path),
      ...manifest.baseline_excluded_reviewed_paths.map(row => row.path),
    ])],
  };
}
