import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolveConsolidationIntegrity } from './consolidationIntegrity.mjs';

// Fifth, independently fixed successor. Never changes the original four guards,
// accepts "latest" hashes, or turns this metadata into publication authority.
const FIXED = {
  "approval_id": "CORE_MARKET_DELIVERY_PROJECTION_APPEND_20260909",
  "base": "6469630795fb1215595306c026437d850b668801",
  "artifact_path": "docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json",
  "artifact": "861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056",
  "section": "36f073ab70754343b39b0c02edfe00e777c116d147708f7a87725a7af9eb0475",
  "patch": "12298ea146d188910154593866b80422520efd3df3482c372d00274250831eda",
  "previous_registry": "0c3e060ed49f6812db13839409fb48b0642deb11df2f391ff58d48f7ca5a4ae0",
  "fourth_artifact": "e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315",
  "anchors": [
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
  "paths": {
    "files": [
      "src/lib/subscriberReportContract.ts",
      "supabase/functions/_shared/market-publication-contract.ts",
      "supabase/functions/line-daily-push/index.ts",
      "supabase/functions/daily-delivery-orchestrator/index.ts",
      "supabase/functions/ma-ops-health-check/index.ts",
      "tests/incidentHealthContract.test.mjs",
      "tests/marketPublicationDelivery.test.mjs",
      "tests/coreProductionPreservation.test.mjs",
      "tests/productContract.test.mjs",
      "tests/subscriberProjectionIntegrity.test.mjs",
      "tests/consolidationIntegrity.test.mjs"
    ],
    "new_candidates": [
      "tests/consolidationLineProjection.test.mjs",
      "tests/consolidationPublicationConsumers.test.mjs",
      "tests/consolidationRecommendationProjection.test.mjs",
      "tests/browser/consolidationSubscriberMatrix.e2e.mjs"
    ]
  },
  "declarations": [
    {
      "path": "supabase/functions/daily-delivery-orchestrator/index.ts",
      "name": "DeliveryState",
      "production_hash": "88beae04190ec5051b6d372da20a36256601af01382e7732e6163a334af580ce",
      "original_hash": "6b2bd31eb391acce768c171ed47cac8f7fed122c4ea631593d8efaad589bd04a",
      "candidate_hash": "0756ce17b86605f0d2ab419e81bd8525d9c1cf437a134d93400fdbd948fd11fc"
    },
    {
      "path": "supabase/functions/daily-delivery-orchestrator/index.ts",
      "name": "loadDeliveryState",
      "production_hash": "9271dcebe511028f6a66ba0b43447e938f8fcbccc4de9f3d2b7fb111b67c9e97",
      "original_hash": "b845c65d103382fe82571b1be9107aa53832abd69d9bc5d87bcff98ca8df4d7e",
      "candidate_hash": "435a3c8c7335820330e076fa5345da48f44344083b39bd35288bd8c3d390cd63"
    }
  ]
};
export const CONSOLIDATION_DELIVERY_ARTIFACT_PATH = FIXED.artifact_path;
const FOURTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';
const FOURTH_GUARD_PATH = 'tests/helpers/consolidationIntegrity.mjs';
const MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';
const root = new URL('../../', import.meta.url);
const defaultRead = path => readFileSync(new URL(path, root));
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');
const declarationKey = row => row.path + ':' + row.name;

function reconstructPreimages(artifact, rows, source) {
  const patches = new Map();
  let active;
  for (const line of artifact.source_diff.patch_lines) {
    const header = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
    if (header) {
      assert.equal(header[1], header[2], 'fifth patch cannot rename files');
      assert.equal(patches.has(header[1]), false, 'fifth patch cannot duplicate files');
      active = []; patches.set(header[1], active);
    } else if (active) active.push(line);
    else assert.equal(line, '', 'fifth patch cannot contain unscoped bytes');
  }
  assert.deepEqual([...patches.keys()].sort(), rows.map(row => row.path).sort(), 'fifth patch exact file set');
  const restoredSources = new Map();
  for (const row of rows) {
    const patch = patches.get(row.path), isNew = row.original_hash === null;
    assert.equal(patch[0], isNew ? '--- /dev/null' : '--- a/' + row.path, 'fifth exact old patch path');
    assert.equal(patch[1], '+++ b/' + row.path, 'fifth exact new patch path');
    const bytes = source(row.path).toString('utf8');
    assert.equal(bytes.endsWith('\n'), row.candidate_ends_with_newline, 'fifth exact current newline');
    const current = bytes.endsWith('\n') ? bytes.slice(0, -1).split('\n') : bytes.split('\n');
    const restored = []; let cursor = 0, index = 2, hunkCount = 0;
    while (index < patch.length) {
      const line = patch[index++];
      if (line === '') continue;
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      assert.ok(match, 'fifth patch requires strict unified hunk: ' + row.path);
      hunkCount++;
      const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
      const oldStart = Number(match[1]) - (oldCount ? 1 : 0), newStart = Number(match[3]) - (newCount ? 1 : 0);
      const oldLines = [], newLines = [];
      while (index < patch.length && !patch[index].startsWith('@@ ') && patch[index] !== '') {
        const part = patch[index++];
        if (part === '\\ No newline at end of file') {
          assert.ok(oldLines.length || newLines.length, 'fifth newline control must follow content');
          continue;
        }
        assert.ok([' ', '+', '-'].includes(part[0]), 'fifth patch unsupported control line');
        if (part[0] !== '+') oldLines.push(part.slice(1));
        if (part[0] !== '-') newLines.push(part.slice(1));
      }
      assert.equal(oldLines.length, oldCount, 'fifth old hunk length');
      assert.equal(newLines.length, newCount, 'fifth new hunk length');
      assert.ok(newStart >= cursor && newStart <= current.length, 'fifth nonoverlapping bounded hunks');
      restored.push(...current.slice(cursor, newStart));
      assert.equal(restored.length, oldStart, 'fifth exact old hunk position');
      assert.deepEqual(current.slice(newStart, newStart + newCount), newLines, 'fifth exact new patch bytes: ' + row.path);
      restored.push(...oldLines); cursor = newStart + newCount;
    }
    assert.ok(hunkCount > 0, 'fifth reviewed patch cannot be empty');
    restored.push(...current.slice(cursor));
    const restoredBytes = Buffer.from(restored.join('\n') + (row.original_ends_with_newline ? '\n' : ''));
    if (isNew) assert.equal(restoredBytes.length, 0, 'fifth new file must reconstruct absence');
    else assert.equal(hash(restoredBytes), row.original_hash, 'fifth exact HEAD preimage: ' + row.path);
    restoredSources.set(row.path, isNew ? null : restoredBytes);
  }
  return restoredSources;
}


const declarationsIn = (path, bytes) => {
  const file = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  return new Map(file.statements.flatMap(node => {
    const name = node.name?.getText(file) || node.declarationList?.declarations.map(item => item.name.getText(file)).join(',');
    return name ? [[name, node.getText(file)]] : [];
  }));
};

export function resolveConsolidationDeliveryIntegrity(
  registry, artifactBytes, readSource = defaultRead,
  fourthArtifactBytes = readSource(FOURTH_ARTIFACT_PATH),
) {
  const { core_market_delivery_projection_registration: section, ...fourthRegistry } = registry;
  assert.ok(section, 'explicit fifth delivery projection registration is required');
  assert.equal(section.approval_id, FIXED.approval_id, 'fifth exact approval identity');
  assert.equal(section.previous_complete_registry_sha256, FIXED.previous_registry, 'fifth immutable fourth registry anchor');
  // Fourth append deliberately preserved predecessor whitespace. Pin the
  // parsed object independently and reconstruct its exact raw bytes below.
  assert.equal(jsonHash(fourthRegistry), '11a4149d0d24b80f9a9fe31364b369c90b09df72feeb971792cbfbd27476610a', 'complete fourth registry and original Production pins remain unchanged');
  assert.equal(section.previous_registration_id, 'CORE_PIPELINE_CONSOLIDATION_APPEND_20260909', 'fifth exact predecessor identity');
  assert.equal(section.candidate_base_git_sha, FIXED.base, 'fifth exact Git base');
  for (const name of ['production_operations_authorized', 'sql_authoring_authorized', 'sql_execution_authorized', 'merge_authorized', 'automatic_stability_day']) {
    assert.equal(section[name], false, 'fifth forbidden authority: ' + name);
  }
  assert.equal(section.fresh_validation_required, true, 'fifth cannot waive fresh validation');
  for (const group of ['files', 'new_candidates']) {
    assert.deepEqual(section[group].map(row => row.path).sort(), [...FIXED.paths[group]].sort(), 'fifth exact allowlist: ' + group);
  }
  assert.deepEqual(section.declarations.map(declarationKey).sort(), FIXED.declarations.map(declarationKey).sort(), 'fifth exact declaration allowlist');
  for (const row of section.declarations) {
    const fixed = FIXED.declarations.find(item => declarationKey(item) === declarationKey(row));
    for (const name of ['production_hash', 'original_hash', 'candidate_hash']) assert.equal(row[name], fixed[name], 'fifth fixed declaration ' + name);
  }
  assert.deepEqual(section.source_diff_reference, { path: FIXED.artifact_path, sha256: FIXED.artifact, patch_sha256: FIXED.patch }, 'fifth fixed artifact reference');
  assert.equal(jsonHash(section), FIXED.section, 'fifth independently fixed complete section');
  assert.equal(hash(artifactBytes), FIXED.artifact, 'fifth independently fixed artifact bytes');
  assert.equal(hash(fourthArtifactBytes), FIXED.fourth_artifact, 'fourth artifact bytes remain unchanged');
  const artifact = JSON.parse(artifactBytes);
  assert.equal(artifact.approval_id, FIXED.approval_id);
  assert.equal(artifact.candidate_base_git_sha, FIXED.base);
  assert.equal(artifact.previous_complete_registry_sha256, FIXED.previous_registry);
  assert.equal(artifact.approval_provenance, section.approval_provenance);
  for (const group of ['files', 'new_candidates', 'declarations']) assert.deepEqual(artifact[group], section[group], 'fifth artifact/section exact rows: ' + group);
  assert.equal(hash(artifact.source_diff.patch_lines.join('\n')), FIXED.patch, 'fifth independently fixed source patch');
  assert.equal(artifact.source_diff.sha256, FIXED.patch);
  const rows = [...artifact.files, ...artifact.new_candidates];
  assert.equal(new Set(rows.map(row => row.path)).size, rows.length, 'fifth unique exact candidates');
  assert.deepEqual([...artifact.source_diff.paths].sort(), rows.map(row => row.path).sort(), 'fifth exact source patch paths');
  const cache = new Map();
  const source = path => {
    if (!cache.has(path)) cache.set(path, Buffer.from(readSource(path)));
    return cache.get(path);
  };
  const rawRegistry = source('docs/operations/core-stability-incident-amendment-20260908.json').toString('utf8');
  const appendedSuffix = ',\n  "core_market_delivery_projection_registration": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(rawRegistry.endsWith(appendedSuffix), 'fifth exact append-only registry bytes');
  const rawFourth = rawRegistry.slice(0, -appendedSuffix.length) + '}\n';
  assert.equal(hash(rawFourth), FIXED.previous_registry, 'fifth exact raw fourth registry preimage');
  assert.deepEqual(JSON.parse(rawFourth), fourthRegistry, 'fifth raw and parsed fourth predecessor agree');
  for (const row of FIXED.anchors) assert.equal(hash(source(row.path)), row.sha256, 'fifth immutable previous guard/artifact: ' + row.path);
  for (const row of rows) {
    assert.doesNotMatch(row.path, /(^|\/)(\.env|secrets?|credentials?)(\.|\/|$)|^supabase\/migrations\/| 2\.|^docs\/research\/|(^|\/)\.\.(\/|$)/i, 'fifth forbidden candidate scope');
    assert.ok(row.reason?.length > 15 && row.rollback_target?.length > 15, 'fifth reason and rollback required');
    assert.equal(row.approval_provenance, section.approval_provenance, 'fifth row provenance');
    const original = fourthRegistry.files.find(item => item.path === row.path);
    if (original) assert.equal(row.production_hash, original.baseline_sha256, 'fifth immutable original Production hash');
    else assert.equal(row.production_hash, undefined, 'fifth cannot invent Production hashes');
    assert.equal(hash(source(row.path)), row.candidate_hash, 'fifth current source drift: ' + row.path);
  }
  const preimages = reconstructPreimages(artifact, rows, source);
  const fourthReadSource = path => {
    if (!preimages.has(path)) return source(path);
    assert.notEqual(preimages.get(path), null, 'new fifth candidate did not exist in fourth predecessor: ' + path);
    return preimages.get(path);
  };
  // Every Fourth/Third/Second/First assertion executes its original implementation.
  const fourth = resolveConsolidationIntegrity(fourthRegistry, fourthArtifactBytes, fourthReadSource);
  const manifest = JSON.parse(source(MANIFEST_PATH)), currentParsed = new Map(), oldParsed = new Map();
  const declarationHash = (path, name, old = false) => {
    const parsed = old ? oldParsed : currentParsed;
    if (!parsed.has(path)) parsed.set(path, declarationsIn(path, old ? fourthReadSource(path) : source(path)));
    const value = parsed.get(path).get(name);
    assert.equal(typeof value, 'string', 'fifth protected declaration missing: ' + path + ':' + name);
    return hash(value);
  };
  for (const record of manifest.protected_declarations) {
    const amendment = fourthRegistry.modified_declarations.find(row => declarationKey(row) === declarationKey(record));
    if (amendment) assert.equal(amendment.production_sha256, record.production_sha256, 'fifth retains original Production declaration pin');
    const original = fourth.declarationHash(amendment || record);
    assert.equal(declarationHash(record.path, record.name, true), original, 'fifth exact fourth declaration preimage: ' + declarationKey(record));
    const changed = artifact.declarations.find(row => declarationKey(row) === declarationKey(record));
    if (changed) {
      assert.equal(changed.production_hash, record.production_sha256, 'fifth original Production declaration hash');
      assert.equal(changed.original_hash, original, 'fifth exact predecessor declaration hash');
    }
    assert.equal(declarationHash(record.path, record.name), changed?.candidate_hash ?? original, 'fifth unapproved protected declaration drift: ' + declarationKey(record));
  }
  const fourthArtifact = JSON.parse(fourthArtifactBytes);
  assert.deepEqual(artifact.unchanged_ai_policy_pins, fourthArtifact.unchanged_ai_policy_pins, 'fifth AI/evidence/strategy pins cannot change');
  for (const row of artifact.unchanged_ai_policy_pins) {
    assert.equal(declarationHash(row.path, row.name), row.production_hash, 'fifth forbidden AI/evidence/strategy policy mutation: ' + row.name);
    assert.equal(artifact.declarations.some(changed => declarationKey(changed) === declarationKey(row)), false, 'fifth policy cannot acquire override');
  }
  const fileOverrides = new Map(artifact.files.map(row => [row.path, row.candidate_hash]));
  const declarationOverrides = new Map(artifact.declarations.map(row => [declarationKey(row), row.candidate_hash]));
  return {
    fileHash: row => fileOverrides.get(row.path) ?? fourth.fileHash(row),
    declarationHash: row => declarationOverrides.get(declarationKey(row)) ?? fourth.declarationHash(row),
    predecessorRegistry: fourth.predecessorRegistry,
    predecessorReadSource: fourth.predecessorReadSource,
    newCandidatePaths: Object.freeze([...fourth.newCandidatePaths, ...FIXED.paths.new_candidates]),
    fourthRegistry, fourthReadSource,
  };
}

export const readConsolidationDeliveryIntegrity = registry => resolveConsolidationDeliveryIntegrity(
  registry, defaultRead(CONSOLIDATION_DELIVERY_ARTIFACT_PATH),
);
