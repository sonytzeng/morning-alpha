import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolveConsolidationDeliveryIntegrity } from './consolidationDeliveryIntegrity.mjs';

// Sixth is test-only compatibility plumbing. Runtime, source policies, old
// artifacts/guards and original test assertion bodies are not mutable here.
const FIXED = {
  "approval_id": "CORE_DELIVERY_TEST_WIRING_APPEND_20260909",
  "base": "6469630795fb1215595306c026437d850b668801",
  "artifact_path": "docs/operations/evidence/core-consolidation-test-wiring-20260909.json",
  "artifact": "69cf698d21fb306a002025d1edd04e4b1a825baf905698724e40f0cae8d52d96",
  "section": "b33572e43b278ac2c05292841a065575069229eed896bec9cc8d0ac35d40d207",
  "patch": "0356eeeeb8ba7914f66eb9bae18080d9ac43ce4ac6cdb87e6b7cd4dd6194f6a8",
  "previous_registry": "e5f0c29c7b371a0d9ec36bf63f9bb4f2b384218a277dc239cd4ba50b1362ff5d",
  "previous_registry_json": "8df45d8b4d7f367f015313282a5c6272003ca5eeee0b8fcde8309283356585ee",
  "fifth_artifact": "861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056",
  "anchors": [
    {
      "path": "tests/helpers/consolidationDeliveryIntegrity.mjs",
      "sha256": "3770a8e3305933f5f42add561ac5b8cbd98273c036c15a49c6c44338c0a2e23c"
    },
    {
      "path": "docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json",
      "sha256": "861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056"
    },
    {
      "path": "tests/helpers/consolidationIntegrity.mjs",
      "sha256": "0994de2d3326de77b1f9c3aa2bdae601758c3dc30fbcbef9197a69b6a7bdbe1a"
    },
    {
      "path": "docs/operations/evidence/core-consolidation-candidate-20260909.json",
      "sha256": "e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315"
    },
    {
      "path": "tests/helpers/subscriberProjectionIntegrity.mjs",
      "sha256": "2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0"
    },
    {
      "path": "docs/operations/core-stability-source-manifest-20260907.json",
      "sha256": "bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c"
    }
  ],
  "paths": [
    "tests/productionLivePipeline.test.mjs",
    "tests/productionReliability.test.mjs",
    "tests/publicRelease.test.mjs",
    "tests/coreProductionPreservation.test.mjs",
    "tests/productContract.test.mjs",
    "tests/subscriberProjectionIntegrity.test.mjs",
    "tests/consolidationIntegrity.test.mjs",
    "tests/consolidationDeliveryIntegrity.test.mjs"
  ],
  "assertion_bodies": [
    {
      "path": "tests/subscriberProjectionIntegrity.test.mjs",
      "sha256": "a0e57cb4abcbacf66cf71b3785d426a6ea51f541e69b98021f814b8e9fcca2d2"
    },
    {
      "path": "tests/consolidationIntegrity.test.mjs",
      "sha256": "a336572755e95da10e00add17ac4d62c0588cb9e615fc56f32c44813fb8f3f9a"
    },
    {
      "path": "tests/consolidationDeliveryIntegrity.test.mjs",
      "sha256": "7ae34c94c8069a49ac5f335dfb65aac772794f8581cfe0bf9a12a8338e797f4b"
    }
  ],
  "compatibility_paths": [
    "tests/productionLivePipeline.test.mjs",
    "tests/productionReliability.test.mjs",
    "tests/publicRelease.test.mjs"
  ],
  "test_cases": [
    {
      "path": "tests/productionLivePipeline.test.mjs",
      "name": "daily sentence rejects stale report dates and delivery fails closed",
      "original_assertions": 4,
      "candidate_assertions": 8
    },
    {
      "path": "tests/productionReliability.test.mjs",
      "name": "delivery, payload, and Content OS all require the same semantic member revision",
      "original_assertions": 15,
      "candidate_assertions": 20
    },
    {
      "path": "tests/publicRelease.test.mjs",
      "name": "LINE delivery is fail-closed and persists per-subscriber retries",
      "original_assertions": 17,
      "candidate_assertions": 21
    },
    {
      "path": "tests/publicRelease.test.mjs",
      "name": "runtime deployment and missing checkpoint schedules are reproducible",
      "original_assertions": 54,
      "candidate_assertions": 61
    },
    {
      "path": "tests/publicRelease.test.mjs",
      "name": "LINE retains verified Production v59 Flex layout and refuses evidence-blocked stock delivery",
      "original_assertions": 11,
      "candidate_assertions": 17
    },
    {
      "path": "tests/publicRelease.test.mjs",
      "name": "report, site payload, and LINE converge on the same immutable decision snapshot",
      "original_assertions": 18,
      "candidate_assertions": 21
    },
    {
      "path": "tests/publicRelease.test.mjs",
      "name": "LINE daily push is paginated, multicast, retry-safe, and subscriber-idempotent",
      "original_assertions": 12,
      "candidate_assertions": 14
    }
  ]
};
export const CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH = FIXED.artifact_path;
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const FIFTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json';
const root = new URL('../../', import.meta.url);
const defaultRead = path => readFileSync(new URL(path, root));
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');

function reconstructPreimages(artifact, rows, source) {
  const patches = new Map();
  let active;
  for (const line of artifact.source_diff.patch_lines) {
    const header = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
    if (header) {
      assert.equal(header[1], header[2], 'sixth patch cannot rename files');
      assert.equal(patches.has(header[1]), false, 'sixth patch cannot duplicate files');
      active = []; patches.set(header[1], active);
    } else if (active) active.push(line);
    else assert.equal(line, '', 'sixth patch cannot contain unscoped bytes');
  }
  assert.deepEqual([...patches.keys()].sort(), rows.map(row => row.path).sort(), 'sixth patch exact file set');
  const restoredSources = new Map();
  for (const row of rows) {
    const patch = patches.get(row.path), isNew = row.original_hash === null;
    assert.equal(patch[0], isNew ? '--- /dev/null' : '--- a/' + row.path, 'sixth exact old patch path');
    assert.equal(patch[1], '+++ b/' + row.path, 'sixth exact new patch path');
    const bytes = source(row.path).toString('utf8');
    assert.equal(bytes.endsWith('\n'), row.candidate_ends_with_newline, 'sixth exact current newline');
    const current = bytes.endsWith('\n') ? bytes.slice(0, -1).split('\n') : bytes.split('\n');
    const restored = []; let cursor = 0, index = 2, hunkCount = 0;
    while (index < patch.length) {
      const line = patch[index++];
      if (line === '') continue;
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      assert.ok(match, 'sixth patch requires strict unified hunk: ' + row.path);
      hunkCount++;
      const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
      const oldStart = Number(match[1]) - (oldCount ? 1 : 0), newStart = Number(match[3]) - (newCount ? 1 : 0);
      const oldLines = [], newLines = [];
      while (index < patch.length && !patch[index].startsWith('@@ ') && patch[index] !== '') {
        const part = patch[index++];
        if (part === '\\ No newline at end of file') {
          assert.ok(oldLines.length || newLines.length, 'sixth newline control must follow content');
          continue;
        }
        assert.ok([' ', '+', '-'].includes(part[0]), 'sixth patch unsupported control line');
        if (part[0] !== '+') oldLines.push(part.slice(1));
        if (part[0] !== '-') newLines.push(part.slice(1));
      }
      assert.equal(oldLines.length, oldCount, 'sixth old hunk length');
      assert.equal(newLines.length, newCount, 'sixth new hunk length');
      assert.ok(newStart >= cursor && newStart <= current.length, 'sixth nonoverlapping bounded hunks');
      restored.push(...current.slice(cursor, newStart));
      assert.equal(restored.length, oldStart, 'sixth exact old hunk position');
      assert.deepEqual(current.slice(newStart, newStart + newCount), newLines, 'sixth exact new patch bytes: ' + row.path);
      restored.push(...oldLines); cursor = newStart + newCount;
    }
    assert.ok(hunkCount > 0, 'sixth reviewed patch cannot be empty');
    restored.push(...current.slice(cursor));
    const restoredBytes = Buffer.from(restored.join('\n') + (row.original_ends_with_newline ? '\n' : ''));
    if (isNew) assert.equal(restoredBytes.length, 0, 'sixth new file must reconstruct absence');
    else assert.equal(hash(restoredBytes), row.original_hash, 'sixth exact HEAD preimage: ' + row.path);
    restoredSources.set(row.path, isNew ? null : restoredBytes);
  }
  return restoredSources;
}


function testBodies(bytes) {
  const file = ts.createSourceFile('test.mjs', bytes.toString(), ts.ScriptTarget.Latest, true);
  return new Map(file.statements.flatMap(node => {
    const call = node.expression;
    return call && ts.isCallExpression(call) && call.expression.getText(file) === 'test'
      ? [[call.arguments[0].text, node.getText(file)]] : [];
  }));
}

export function resolveConsolidationTestWiringIntegrity(
  registry, artifactBytes, readSource = defaultRead,
  fifthArtifactBytes = readSource(FIFTH_ARTIFACT_PATH),
) {
  const { core_delivery_test_wiring_registration: section, ...fifthRegistry } = registry;
  assert.ok(section, 'explicit sixth test-wiring registration is required');
  assert.equal(section.approval_id, FIXED.approval_id, 'sixth exact approval identity');
  assert.equal(section.previous_complete_registry_sha256, FIXED.previous_registry, 'sixth immutable fifth raw registry anchor');
  assert.equal(jsonHash(fifthRegistry), FIXED.previous_registry_json, 'complete fifth object and original Production pins remain unchanged');
  assert.equal(section.previous_registration_id, 'CORE_MARKET_DELIVERY_PROJECTION_APPEND_20260909', 'sixth exact predecessor identity');
  assert.equal(section.candidate_base_git_sha, FIXED.base, 'sixth exact Git base');
  assert.equal(section.test_only_authorized, true, 'sixth is only reviewed test compatibility');
  for (const field of ['production_operations_authorized', 'runtime_source_changes_authorized', 'sql_authoring_authorized', 'sql_execution_authorized', 'merge_authorized', 'automatic_stability_day']) {
    assert.equal(section[field], false, 'sixth forbidden authority: ' + field);
  }
  assert.equal(section.fresh_validation_required, true, 'sixth cannot waive fresh validation');
  assert.deepEqual(section.files.map(row => row.path).sort(), [...FIXED.paths].sort(), 'sixth exact eight test paths');
  assert.deepEqual(section.declarations, [], 'sixth cannot override protected declarations');
  assert.deepEqual(section.new_candidates, [], 'sixth cannot admit new runtime candidates');
  assert.deepEqual(section.source_diff_reference, { path: FIXED.artifact_path, sha256: FIXED.artifact, patch_sha256: FIXED.patch }, 'sixth fixed artifact reference');
  assert.equal(jsonHash(section), FIXED.section, 'sixth independently fixed complete section');
  assert.equal(hash(artifactBytes), FIXED.artifact, 'sixth independently fixed artifact bytes');
  assert.equal(hash(fifthArtifactBytes), FIXED.fifth_artifact, 'sixth immutable fifth artifact bytes');
  const artifact = JSON.parse(artifactBytes);
  assert.equal(artifact.approval_id, FIXED.approval_id);
  assert.equal(artifact.candidate_base_git_sha, FIXED.base);
  assert.equal(artifact.previous_complete_registry_sha256, FIXED.previous_registry);
  assert.equal(artifact.approval_provenance, section.approval_provenance);
  for (const field of ['files', 'new_candidates', 'declarations']) assert.deepEqual(artifact[field], section[field], 'sixth artifact/section exact ' + field);
  assert.equal(hash(artifact.source_diff.patch_lines.join('\n')), FIXED.patch, 'sixth independently fixed source patch');
  assert.equal(artifact.source_diff.sha256, FIXED.patch);
  const rows = artifact.files;
  assert.equal(new Set(rows.map(row => row.path)).size, 8, 'sixth exactly eight unique test paths');
  assert.deepEqual([...artifact.source_diff.paths].sort(), [...FIXED.paths].sort(), 'sixth exact patch paths');
  const cache = new Map();
  const source = path => {
    if (!cache.has(path)) cache.set(path, Buffer.from(readSource(path)));
    return cache.get(path);
  };
  const rawRegistry = source(REGISTRY_PATH).toString('utf8');
  const suffix = ',\n  "core_delivery_test_wiring_registration": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(rawRegistry.endsWith(suffix), 'sixth exact append-only registry bytes');
  const rawFifth = Buffer.from(rawRegistry.slice(0, -suffix.length) + '}\n');
  assert.equal(hash(rawFifth), FIXED.previous_registry, 'sixth exact raw fifth registry preimage');
  assert.deepEqual(JSON.parse(rawFifth), fifthRegistry, 'sixth raw and parsed fifth registry agree');
  for (const row of FIXED.anchors) assert.equal(hash(source(row.path)), row.sha256, 'sixth immutable previous guard/artifact: ' + row.path);
  for (const row of rows) {
    assert.match(row.path, /^tests\/[A-Za-z]+\.test\.mjs$/, 'sixth only explicit top-level test files');
    assert.ok(row.reason?.length > 15 && row.rollback_target?.length > 15, 'sixth reason and rollback required');
    assert.equal(row.approval_provenance, section.approval_provenance, 'sixth row provenance');
    const original = fifthRegistry.files.find(item => item.path === row.path);
    if (original) assert.equal(row.production_hash, original.baseline_sha256, 'sixth original Production hash remains unchanged');
    else assert.equal(row.production_hash, undefined, 'sixth cannot invent Production hashes');
    assert.equal(hash(source(row.path)), row.candidate_hash, 'sixth current test source drift: ' + row.path);
  }
  const preimages = reconstructPreimages(artifact, rows, source);
  const fifthReadSource = path => path === REGISTRY_PATH ? rawFifth : preimages.get(path) || source(path);
  // No implementation/assertion of any prior guard is edited or skipped.
  const fifth = resolveConsolidationDeliveryIntegrity(fifthRegistry, fifthArtifactBytes, fifthReadSource);
  for (const row of FIXED.assertion_bodies) {
    const current = source(row.path).toString(), old = fifthReadSource(row.path).toString();
    assert.ok(current.includes('const hash =') && old.includes('const hash ='), 'sixth old assertion marker required');
    for (const text of [current, old]) assert.equal(hash(text.slice(text.indexOf('const hash ='))), row.sha256, 'sixth immutable original assertion body: ' + row.path);
  }
  let changed = 0, unchanged = 0;
  for (const path of FIXED.compatibility_paths) {
    const before = testBodies(fifthReadSource(path)), after = testBodies(source(path));
    assert.deepEqual([...after.keys()], [...before.keys()], 'sixth original test names/count remain unchanged: ' + path);
    for (const [name, original] of before) {
      const current = after.get(name), approved = FIXED.test_cases.find(row => row.path === path && row.name === name);
      if (!approved) { assert.equal(current, original, 'sixth unrelated test body unchanged: ' + name); unchanged++; continue; }
      assert.notEqual(current, original, 'sixth reviewed test correction must be present');
      assert.equal((original.match(/assert\./g) || []).length, approved.original_assertions, 'sixth exact original assertion count');
      assert.equal((current.match(/assert\./g) || []).length, approved.candidate_assertions, 'sixth exact replacement assertion count');
      assert.ok(approved.candidate_assertions >= approved.original_assertions, 'sixth cannot reduce test assertions');
      changed++;
    }
  }
  assert.equal(changed, 7, 'sixth exactly seven reviewed case bodies');
  assert.equal(unchanged, 81, 'sixth retains all other 81 case bodies');
  const overrides = new Map(rows.map(row => [row.path, row.candidate_hash]));
  return { ...fifth, fileHash: row => overrides.get(row.path) ?? fifth.fileHash(row), fifthRegistry, fifthReadSource };
}

export const readConsolidationTestWiringIntegrity = registry => resolveConsolidationTestWiringIntegrity(
  registry, defaultRead(CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH),
);
