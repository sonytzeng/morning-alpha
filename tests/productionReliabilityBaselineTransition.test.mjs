import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_EXPORT_ARTIFACT_PATH,
  resolveConsolidationPublicExportIntegrity,
} from './helpers/consolidationPublicExportIntegrity.mjs';

const MANIFEST = 'docs/operations/evidence/production-reliability-baseline-transition-20260915.json';
const PARITY_MANIFEST = 'docs/operations/evidence/production-parity-baseline-transition-20260916.json';
const PRECHECK_MANIFEST = 'docs/operations/evidence/precheck-production-parity-baseline-transition-20260916.json';
const READINESS_MANIFEST = 'docs/operations/evidence/premarket-readiness-baseline-transition-20260917.json';
const REGISTRY = 'docs/operations/core-stability-incident-amendment-20260908.json';
const ENTRY = 'tests/helpers/consolidationPublicExportIntegrity.mjs';
const PIPELINE_TEST = 'tests/productionLivePipeline.test.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const registry = JSON.parse(read(REGISTRY));
const artifact = read(PUBLIC_EXPORT_ARTIFACT_PATH);
const manifest = JSON.parse(read(MANIFEST));
const verify = (source = read) => resolveConsolidationPublicExportIntegrity(registry, artifact, source);

test('reviewed parity baseline preserves the reliability transition and reconstructs all predecessors', () => {
  assert.equal(hash(read(MANIFEST)), '9d84af2ee3a805132d1769147ca5256d9439d1ad2f744b9faa8573d81ddc5309');
  const result = verify();
  assert.equal(result.reviewedBaselineTransition.transition_id, 'MORNING_ALPHA_PREMARKET_READINESS_20260917');
  assert.equal(result.reviewedBaselineTransition.predecessor_integrity_id, 'MORNING_ALPHA_PRECHECK_PRODUCTION_PARITY_20260916');
  assert.equal(result.reviewedBaselinePredecessor.reviewedBaselineTransition.transition_id,
    'MORNING_ALPHA_PRECHECK_PRODUCTION_PARITY_20260916');
  assert.equal(result.reviewedBaselinePredecessor.reviewedBaselinePredecessor.reviewedBaselineTransition.transition_id,
    'MORNING_ALPHA_PRODUCTION_PARITY_20260916');
  assert.equal(result.reviewedBaselinePredecessor.reviewedBaselinePredecessor.reviewedBaselinePredecessor.reviewedBaselineTransition.transition_id,
    'MORNING_ALPHA_PRODUCTION_RELIABILITY_20260915');
  assert.equal(hash(result.reviewedBaselinePredecessor.reviewedBaselinePredecessor.reviewedBaselinePredecessor.reviewedBaselinePredecessorReadSource(ENTRY)),
    'd4cda72931e160b6e07457f83f916c5390e0123bf497e81d33de8c37b42994bc');
  assert.equal(hash(result.reviewedBaselinePredecessor.reviewedBaselinePredecessor.reviewedBaselinePredecessor.reviewedBaselinePredecessorReadSource(PIPELINE_TEST)),
    '9021c72366b2b5a31ec9f9b53fb12ed52dd0047c8f543028cbbd87de629ea0e8');
  assert.equal(result.reviewedBaselineTransition.natural_day_pass_claimed, false);
});

test('candidate drift, predecessor drift, and authority escalation remain fail closed', () => {
  assert.throws(() => verify(path => path === PIPELINE_TEST
    ? Buffer.concat([read(path), Buffer.from('\nUNREVIEWED\n')]) : read(path)), /unreviewed candidate drift/);
  for (const mutate of [
    value => { value.files[0].predecessor_sha256 = '0'.repeat(64); },
    value => { value.files[0].candidate_sha256 = '0'.repeat(64); },
    value => { value.baseline_excluded_reviewed_paths[0].candidate_sha256 = '0'.repeat(64); },
    value => { value.baseline_restored_reviewed_paths[0].baseline_sha256 = '0'.repeat(64); },
    value => { value.auth_change = true; },
    value => { value.natural_day_pass_claimed = true; },
  ]) {
    const changed = structuredClone(manifest);
    mutate(changed);
    assert.throws(() => verify(path => path === MANIFEST ? json(changed) : read(path)));
  }
  const parity = JSON.parse(read(PARITY_MANIFEST));
  parity.auth_change = true;
  assert.throws(() => verify(path => path === PARITY_MANIFEST ? json(parity) : read(path)));
  const precheck = JSON.parse(read(PRECHECK_MANIFEST));
  precheck.auth_change = true;
  assert.throws(() => verify(path => path === PRECHECK_MANIFEST ? json(precheck) : read(path)));
  const readiness = JSON.parse(read(READINESS_MANIFEST));
  readiness.auth_change = true;
  assert.throws(() => verify(path => path === READINESS_MANIFEST ? json(readiness) : read(path)));
});
