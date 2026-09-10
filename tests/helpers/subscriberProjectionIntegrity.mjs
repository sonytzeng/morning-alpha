import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Fixed independently reviewed successors, never an open-ended newest-hash exemption.
// First approval/artifact anchors remain permanently unchanged.
const OLD_REGISTRY = '343495f199d47aa1263d3014e433d028641fd1c85e2dfb786e8fcdd3095450d2';
const ARTIFACT = '4dbb461f7350ee3f6c8b8923174e9b4ff97d54e3220b99f9dfa7b06cdc0ea63d';
const PATCH = '7f8abe21abf2004fe26861306b200ab9f9b4b8070f1c457f9a31ea409e665c50';
const BASE = '1bb06a047f38600be27f6e89a38b81baa5578706';
const ID = 'SUBSCRIBER_PROJECTION_BASELINE_APPEND_20260909';
const EVIDENCE = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';
const PATHS = ['src/services/resolveActiveReport.ts', 'supabase/functions/get-report-payload/index.ts'];
const HISTORY = PATHS[1] + ':buildHistorySummary';
const SECOND_PREVIOUS = 'ae28fdc443a5e1363e5d0ac222578a9687e8585153de79f26c2dbc55bc027bdb';
const SECOND_ID = 'SUBSCRIBER_CHECKPOINT_BASELINE_APPEND_20260909';
const SECOND_SECTION = '38b047ec1839597bb5e11396e831bb4f6c241c34e6823ecfe6c917f6b80983e9';
const SECOND_PATCH = '031c7413437fd26fe80dcd10bab38203d2d8ddf24398b0ede0dcd3a118a5c00f';
const SECOND_RELATED = [
  'src/hooks/useAccountDashboard.ts', 'src/lib/subscriberReportContract.ts',
  'src/pages/account/components/TodayInfoCards.tsx', 'src/pages/war-room/WarRoom.tsx',
  'tests/accountSubscriberProjection.test.mjs', 'tests/browser/subscriberProjection.e2e.mjs',
  'tests/publicRelease.test.mjs', 'tests/runtimeDecisionTimeline.test.ts',
  'tests/runtimeReportState.test.mjs', 'tests/subscriberProjectionRoutes.test.mjs',
  'tests/subscriberReportProjection.test.mjs',
];
const SECOND_PROTECTED = ['src/lib/runtimeDecisionTimeline.ts'];
const SECOND_BASE = new Map([
  ['src/components/v11/V11ObservationSection.tsx', 'ba757723c33517ba7bb4647a86055f9d0f62e12fbfa6543701a71bfb4462d084'],
  ['src/lib/canonicalNarrative.ts', '754213394595ddb981c390a5c53b2118fe46a21d8eabb2d37bf210484e0cdd9e'],
  ['tests/stateConsistency.test.mjs', '2bb3f2457d6b2ab86880ad93be7bf28fe3f387cc73e38f1885bd4fdb025b3a65'],
]);
const root = new URL('../../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');

// Reconstruct every predecessor from the exact reviewed new bytes + reverse patch.
// Hash pins alone must not claim an old source that was never actually preserved.
function verifyPreimages(section, rows, readSource) {
  const restoredSources = new Map();
  const patches = new Map(); let active;
  for (const line of section.source_diff.patch_lines) {
    const header = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
    if (header) {
      assert.equal(header[1], header[2], 'second patch cannot rename files');
      assert.equal(patches.has(header[1]), false, 'second patch cannot duplicate files');
      active = []; patches.set(header[1], active);
    } else if (active) active.push(line);
    else assert.equal(line, '', 'second patch cannot contain unscoped bytes');
  }
  assert.deepEqual([...patches.keys()].sort(), rows.map(row => row.path).sort(), 'second patch exact file set');
  for (const row of rows) {
    const patch = patches.get(row.path);
    assert.equal(patch[0], '--- a/' + row.path, 'second patch old path');
    assert.equal(patch[1], '+++ b/' + row.path, 'second patch new path');
    const current = readSource(row.path).toString().split('\n');
    const restored = []; let cursor = 0, index = 2, hunkCount = 0;
    while (index < patch.length) {
      const line = patch[index++];
      if (line === '') continue;
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      assert.ok(match, 'second patch requires valid unified hunk: ' + row.path);
      hunkCount++;
      const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
      const oldStart = Number(match[1]) - (oldCount ? 1 : 0);
      const newStart = Number(match[3]) - (newCount ? 1 : 0);
      const oldLines = [], newLines = [];
      while (index < patch.length && !patch[index].startsWith('@@ ') && patch[index] !== '') {
        const part = patch[index++];
        assert.ok([' ', '+', '-'].includes(part[0]), 'second patch contains unsupported control line');
        if (part[0] !== '+') oldLines.push(part.slice(1));
        if (part[0] !== '-') newLines.push(part.slice(1));
      }
      assert.equal(oldLines.length, oldCount, 'second patch old hunk length');
      assert.equal(newLines.length, newCount, 'second patch new hunk length');
      assert.ok(newStart >= cursor, 'second patch hunks must not overlap');
      restored.push(...current.slice(cursor, newStart));
      assert.equal(restored.length, oldStart, 'second patch old hunk position');
      assert.deepEqual(current.slice(newStart, newStart + newCount), newLines, 'second patch new bytes: ' + row.path);
      restored.push(...oldLines); cursor = newStart + newCount;
    }
    assert.ok(hunkCount > 0, 'second patch must contain reviewed source differences');
    restored.push(...current.slice(cursor));
    assert.equal(hash(restored.join('\n')), row.original_hash, 'second patch must reconstruct exact predecessor: ' + row.path);
    restoredSources.set(row.path, Buffer.from(restored.join('\n')));
  }
  return restoredSources;
}

function resolveCheckpointProjectionIntegrity(registry, artifactBytes, readSource) {
  const { subscriber_checkpoint_projection_registration: successor, ...firstRegistry } = registry;
  assert.ok(successor, 'explicit second checkpoint registration is required');
  assert.equal(jsonHash(firstRegistry), SECOND_PREVIOUS, 'complete first registry/approval must remain unchanged');
  const { subscriber_projection_candidate_registration: approval, ...oldRegistry } = firstRegistry;
  assert.ok(approval, 'explicit Subscriber Projection registration is required');
  assert.equal(jsonHash(oldRegistry), OLD_REGISTRY, 'all prior registry fields/pins/history must remain unchanged');
  assert.equal(approval.previous_registry_sha256, OLD_REGISTRY);
  assert.equal(approval.approval_id, ID);
  assert.equal(approval.candidate_base_git_sha, BASE);
  assert.equal(approval.production_operations_authorized, false);
  assert.equal(approval.merge_authorized, false);
  assert.equal(approval.live_production_rollback_reference.execution_authorized, false);
  assert.equal(approval.automatic_stability_day, false);
  assert.ok(Number.isFinite(Date.parse(approval.approval_recorded_at)));
  assert.ok(approval.approval_provenance.length > 100);
  assert.equal(approval.source_diff_reference.path, EVIDENCE);
  assert.equal(approval.source_diff_reference.sha256, ARTIFACT);
  assert.equal(approval.source_diff_reference.protected_patch_sha256, PATCH);
  assert.equal(hash(artifactBytes), ARTIFACT, 'reviewed artifact cannot self-authorize new content');
  const evidence = JSON.parse(artifactBytes);
  assert.equal(evidence.approval_id, ID);
  assert.equal(evidence.candidate_base_git_sha, BASE);
  assert.equal(evidence.production_change_authorized, false);
  assert.equal(hash(evidence.source_diff.patch_lines.join('\n')), PATCH);
  assert.equal(evidence.source_diff.sha256, PATCH);
  assert.deepEqual([...evidence.source_diff.paths].sort(), PATHS);
  assert.deepEqual(approval.files.map(row => row.path).sort(), PATHS, 'only the two reviewed protected files');
  assert.equal(approval.declarations.length, 1);
  assert.equal(approval.declarations[0].path + ':' + approval.declarations[0].name, HISTORY);
  assert.equal(approval.declarations[0].candidate_hash, 'd403ea7baa3574ed6c9493296eb55df02eff1d0b957502ced7e12d5fd49d5f70');
  assert.equal(evidence.related_candidates.length, 45);
  assert.equal(new Set(evidence.related_candidates.map(row => row.path)).size, 45);
  for (const row of [...approval.files, ...approval.declarations]) {
    const old = row.name ? oldRegistry.modified_declarations.find(item => item.path === row.path && item.name === row.name)
      : oldRegistry.files.find(item => item.path === row.path);
    assert.ok(old, 'no unknown protected entry');
    assert.equal(row.original_hash, old.incident_sha256, 'successor must bind original approved hash');
    assert.equal(row.production_hash, row.name ? old.production_sha256 : old.baseline_sha256);
    assert.deepEqual(row.source_diff_reference, approval.source_diff_reference);
    assert.ok(row.reason.length > 15 && row.approval_provenance === approval.approval_provenance);
    assert.ok(row.rollback_target.startsWith(BASE + ':' + row.path));
    if (!row.name) assert.equal(row.candidate_hash, evidence.related_candidates.find(item => item.path === row.path).candidate_hash);
  }
  assert.equal(successor.approval_id, SECOND_ID, 'second approval exact identity');
  assert.equal(successor.previous_complete_registry_sha256, SECOND_PREVIOUS, 'second predecessor registry anchor');
  assert.equal(successor.previous_registration_id, ID, 'second predecessor approval identity');
  assert.equal(successor.candidate_base_git_sha, BASE, 'second immutable Git base');
  assert.deepEqual(successor.first_artifact_reference, { path: EVIDENCE, sha256: ARTIFACT }, 'second immutable first artifact reference');
  for (const key of ['production_operations_authorized', 'merge_authorized', 'automatic_stability_day']) {
    assert.equal(successor[key], false, 'second approval cannot enable authority: ' + key);
  }
  assert.equal(successor.fresh_validation_required, true, 'second registration does not replace fresh validation');
  assert.deepEqual(successor.related_candidates.map(row => row.path).sort(), SECOND_RELATED, 'second exact related path set');
  assert.deepEqual(successor.protected_files.map(row => row.path).sort(), SECOND_PROTECTED, 'second exact protected path set');
  assert.deepEqual(successor.base_candidates.map(row => row.path).sort(), [...SECOND_BASE.keys()], 'second exact Git-base path set');
  assert.equal(successor.declarations, undefined, 'second approval cannot alter declarations');
  const secondRows = [...successor.related_candidates, ...successor.protected_files, ...successor.base_candidates];
  assert.equal(new Set(secondRows.map(row => row.path)).size, 15, 'second exact unique successor count');
  for (const row of secondRows) {
    const first = evidence.related_candidates.find(item => item.path === row.path);
    const protectedOld = oldRegistry.files.find(item => item.path === row.path);
    assert.equal(row.original_hash, first?.candidate_hash ?? protectedOld?.incident_sha256 ?? SECOND_BASE.get(row.path), 'second exact predecessor hash: ' + row.path);
    if (protectedOld) assert.equal(row.production_hash, protectedOld.baseline_sha256, 'second original Production hash');
    else assert.equal(row.production_hash, undefined, 'no invented Production hash for unprotected source');
    assert.ok(row.reason?.length > 15 && row.rollback_target?.length > 15, 'second source needs reason and rollback: ' + row.path);
    assert.equal(row.approval_provenance, successor.approval_provenance, 'second source approval provenance: ' + row.path);
  }
  assert.ok(Number.isFinite(Date.parse(successor.approval_recorded_at)), 'second actual approval recording time');
  assert.ok(successor.approval_provenance?.length > 100, 'second explicit owner approval provenance');
  assert.deepEqual([...successor.source_diff.paths].sort(), secondRows.map(row => row.path).sort(), 'second exact inline patch paths');
  assert.equal(hash(successor.source_diff.patch_lines.join('\n')), SECOND_PATCH, 'second independently anchored inline patch');
  assert.equal(successor.source_diff.sha256, SECOND_PATCH, 'second inline patch declared hash');
  assert.equal(jsonHash(successor), SECOND_SECTION, 'second independently anchored complete registration');
  for (const row of secondRows) assert.equal(hash(readSource(row.path)), row.candidate_hash, 'reviewed second source drift: ' + row.path);
  for (const row of evidence.related_candidates) {
    const successorRow = successor.related_candidates.find(item => item.path === row.path);
    assert.equal(hash(readSource(row.path)), successorRow?.candidate_hash ?? row.candidate_hash, 'reviewed candidate drift: ' + row.path);
    assert.ok(row.reason.length > 15 && row.rollback_target.length > 15 && row.approval_provenance.length > 100);
  }
  verifyPreimages(successor, secondRows, readSource);
  return {
    fileHash: row => successor.protected_files.find(item => item.path === row.path)?.candidate_hash
      ?? approval.files.find(item => item.path === row.path)?.candidate_hash ?? row.incident_sha256,
    declarationHash: row => approval.declarations.find(item => item.path === row.path && item.name === row.name)?.candidate_hash ?? row.incident_sha256,
  };
}

// One further reviewed test-only successor; the complete second registration stays immutable.
// Reconstruct its predecessor, then run every original first/second check unchanged.
const THIRD_PREVIOUS = '2356082045202008439e56d85a81e197937ec565b08b1cbc1a22bbdd93293518';
const THIRD_SECTION = '38f7a84399d22ded1de328d866edab5185a1bf03230e4774a6afd38166427a6f';
const THIRD_PATCH = 'd0de7cf5f22146e4258965e049839a1f7e00ac5cbbad2a3ee2b9b2376ca32d1e';
const THIRD_PATH = 'tests/publicRelease.test.mjs';
const THIRD_OLD = '4dc1b386585b231562dca70430c2b25dc04145ddde4f41438ef86f3503245326';
const THIRD_NEW = '968b476409a2990d9d5f37e62456b264a7e32c41bb90ca83777c30cbbbc8d8b1';

export function resolveSubscriberProjectionIntegrity(registry, artifactBytes, readSource = path => readFileSync(new URL(path, root))) {
  const { subscriber_public_release_assertion_registration: successor, ...previousRegistry } = registry;
  assert.ok(successor, 'explicit third test-conformance registration is required');
  assert.equal(successor.approval_id, 'SUBSCRIBER_PUBLIC_RELEASE_ASSERTION_APPEND_20260909', 'third exact approval identity');
  assert.equal(successor.previous_complete_registry_sha256, THIRD_PREVIOUS, 'third predecessor registry anchor');
  assert.equal(successor.previous_registration_id, SECOND_ID, 'third predecessor approval identity');
  assert.equal(successor.candidate_base_git_sha, BASE, 'third immutable Git base');
  assert.deepEqual(successor.files.map(row => row.path), [THIRD_PATH], 'third exact test-only path set');
  assert.deepEqual(successor.source_diff.paths, [THIRD_PATH], 'third exact patch path set');
  const row = successor.files[0];
  assert.equal(row.original_hash, THIRD_OLD, 'third exact second-candidate predecessor');
  assert.equal(row.candidate_hash, THIRD_NEW, 'third independently fixed candidate hash');
  assert.equal(row.production_hash, undefined, 'test-only successor cannot invent a Production hash');
  assert.ok(row.reason?.length > 15 && row.rollback_target?.length > 15, 'third source needs reviewed reason and rollback');
  assert.equal(row.approval_provenance, successor.approval_provenance, 'third per-file approval provenance');
  for (const key of ['production_operations_authorized', 'merge_authorized', 'automatic_stability_day']) {
    assert.equal(successor[key], false, 'third approval cannot enable authority: ' + key);
  }
  assert.equal(successor.fresh_validation_required, true, 'third registration does not replace fresh regression');
  assert.equal(successor.protected_files, undefined, 'third registration cannot change protected sources');
  assert.equal(successor.declarations, undefined, 'third registration cannot change declarations');
  assert.equal(hash(successor.source_diff.patch_lines.join('\n')), THIRD_PATCH, 'third independently anchored inline patch');
  assert.equal(successor.source_diff.sha256, THIRD_PATCH, 'third declared patch hash');
  assert.equal(jsonHash(successor), THIRD_SECTION, 'third independently anchored complete registration');
  assert.equal(hash(readSource(THIRD_PATH)), THIRD_NEW, 'reviewed third source drift: ' + THIRD_PATH);
  const predecessors = verifyPreimages(successor, successor.files, readSource);
  const verified = resolveCheckpointProjectionIntegrity(previousRegistry, artifactBytes,
    path => path === THIRD_PATH ? predecessors.get(THIRD_PATH) : readSource(path));
  assert.equal(jsonHash(previousRegistry), THIRD_PREVIOUS, 'complete second registry/approval must remain unchanged');
  return verified;
}

export const readSubscriberProjectionIntegrity = registry => resolveSubscriberProjectionIntegrity(registry, readFileSync(new URL(EVIDENCE, root)));
