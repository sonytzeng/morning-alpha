import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PUBLIC_EXPORT_ARTIFACT_PATH,
  readPremarketAtomicReadinessIntegrity,
  resolvePremarketAtomicReadinessIntegrity,
} from './helpers/premarketAtomicReadinessIntegrity.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const registry = JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
const artifact = read(PUBLIC_EXPORT_ARTIFACT_PATH);
const inventoryPath = 'docs/operations/evidence/premarket-atomic-core-inventory-20260917.json';
const migrationPath = 'supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql';
const verify = source => resolvePremarketAtomicReadinessIntegrity(registry, artifact, source);
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
  assert.equal(result.newCandidatePaths.filter(path => path.startsWith('supabase/migrations/')
    && !result.reviewedBaselinePredecessor.newCandidatePaths.includes(path)).join(','), migrationPath);
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
