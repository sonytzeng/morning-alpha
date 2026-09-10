import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import { resolveConsolidationSqlHistoryIntegrity } from './consolidationSqlHistoryIntegrity.mjs';
import { resolveConsolidationRequiredMarketIntegrity } from './consolidationRequiredMarketIntegrity.mjs';
import { resolveConsolidationFixtureRepresentation } from './consolidationFixtureRepresentation.mjs';
import { resolveConsolidationAcceptanceDefaultIntegrity } from './consolidationAcceptanceDefaultIntegrity.mjs';

// Eighth source admission is additive. The immutable Seventh guard executes on
// exact reconstructed predecessor bytes, followed by checks of every live byte
// and protected declaration in the narrowly reviewed successor. It grants no
// Production, account, external delivery, or natural-stability authority.
export const PUBLIC_EXPORT_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-public-export-20260909.json';
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const PREVIOUS_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-sql-history-20260909.json';
const PREVIOUS_GUARD_PATH = 'tests/helpers/consolidationSqlHistoryIntegrity.mjs';
const MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';
const PREVIOUS_REGISTRY = '9ce4346495b9287e31a73c286abc45a5a7dac45db67ece8899988aafd7996d9a';
const PREVIOUS_ARTIFACT = 'c14666fd23bd334da8a97e4c8f00ef686fe176d2733c9a1d80c76f39d0dcf2a5';
const PREVIOUS_GUARD = '85e6bce987095d13e86d2d6f003996a3654abdde4b9cd54729375ceac249d832';
const MANIFEST = 'bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c';
const SECTION_KEY = 'core_public_export_projection_registration';
const APPROVAL_ID = 'CORE_PUBLIC_EXPORT_PROJECTION_APPEND_20260909';
const BASE = '6469630795fb1215595306c026437d850b668801';
const FIRST_ADMITTED_EXISTING_SOURCE = {
  path: 'supabase/functions/content-os-morning-alpha-source/index.ts',
  original_hash: 'c4a2f7aa37c0e1ddb7437da340b43084f3e0be88040353988a0dce6dfcd0a105',
};
// Set only after the complete bounded diff and tests have been reviewed. An
// absent independent seal is an explicit failure, never a newest-hash fallback.
const FINAL_SEAL = Object.freeze({
  "artifact": "f0f4a1a7d5b72d45841f1910ef5ccd8c3b390c4488f78b82ccf3e687ee17b2f1",
  "section": "bf4d0eabaffe4406b1c98ac3d9af6abacf8bf453a369748b36b2cebd0886ef4d",
  "paths": [
    ".github/workflows/validate-release.yml",
    "docs/operations/core-consolidation-public-export-local-v1.md",
    "supabase/functions/_shared/canonical-market-state.ts",
    "supabase/functions/_shared/market-publication-contract.ts",
    "supabase/functions/content-os-morning-alpha-source/index.ts",
    "supabase/functions/generate-daily-report-v7/research-master-v2.ts",
    "tests/consolidationCanonicalNewsFacts.test.mjs",
    "tests/consolidationContentOsCapturedReplay.test.mjs",
    "tests/consolidationContentOsPublication.test.mjs",
    "tests/consolidationDeliveryIntegrity.test.mjs",
    "tests/consolidationIntegrity.test.mjs",
    "tests/consolidationPublicationReadAdapter.test.ts",
    "tests/consolidationSourceProvenance.test.mjs",
    "tests/consolidationSqlHistoryIntegrity.test.mjs",
    "tests/consolidationTestWiringIntegrity.test.mjs",
    "tests/coreProductionPreservation.test.mjs",
    "tests/fixtures/consolidation-v1/content-os/persisted-market-only-20260921.json",
    "tests/fixtures/consolidation-v1/content-os/replay-evidence-index.json",
    "tests/helpers/coreContentOsCapturedReplay.mjs",
    "tests/integration/coreConsolidationContentOsAddon.integration.mjs",
    "tests/productContract.test.mjs",
    "tests/productionReliability.test.mjs",
    "tests/publicRelease.test.mjs",
    "tests/subscriberProjectionIntegrity.test.mjs"
  ],
  "declarations": [],
  "test_successors": [
    "tests/publicRelease.test.mjs:paid report fails closed when evidence does not meet the member threshold",
    "tests/publicRelease.test.mjs:report, site payload, and LINE converge on the same immutable decision snapshot",
    "tests/productionReliability.test.mjs:Content OS public reason reuses canonical supply-chain evidence when no display reason exists",
    "tests/productionReliability.test.mjs:delivery, payload, and Content OS all require the same semantic member revision"
  ],
  "preserved_test_bodies": [
    {
      "path": "tests/coreProductionPreservation.test.mjs",
      "marker": "test('trusted deployed generator/orchestrator",
      "sha256": "720575afcd4a4f329be5ea9e09387fab9b877f2579facad8c3867f23defb7722"
    },
    {
      "path": "tests/productContract.test.mjs",
      "marker": "test('Core freeze",
      "sha256": "65bce943b50c380b546d99afb628edb0693b704fd9a2b50235018e35defb7ca7"
    },
    {
      "path": "tests/subscriberProjectionIntegrity.test.mjs",
      "marker": "const registry = consolidation.predecessorRegistry;",
      "sha256": "8f84073b18ae8bcd7acc11291bf7d3a9e8222816e8c8894efa89d64a23447a79"
    },
    {
      "path": "tests/consolidationIntegrity.test.mjs",
      "marker": "const registry = fifth.fourthRegistry;",
      "sha256": "5ca47b8fcdbbe5ccd01c9ef7a5bf78f400d8de9ccd5ec9d3290e4fc9a466ed7f"
    },
    {
      "path": "tests/consolidationDeliveryIntegrity.test.mjs",
      "marker": "// Independent pins captured after source review.",
      "sha256": "03d963f17e62b249ec4286c880187fdba6a143b6a4d1b024f55db669c73d6fe3"
    },
    {
      "path": "tests/consolidationTestWiringIntegrity.test.mjs",
      "marker": "// Independent review pins.",
      "sha256": "28403897286a12d715baffbbc32b297b66b589279b3f48038f9522723b3e4c1d"
    },
    {
      "path": "tests/consolidationSqlHistoryIntegrity.test.mjs",
      "marker": "const hash = bytes =>",
      "sha256": "a94fa24cd8d35a6f2b195a0ffb01f8ef2ba9af5ab6e2bffc808a64c0495ef751"
    }
  ]
});
const root = new URL('../../', import.meta.url);
const defaultRead = path => readFileSync(new URL(path, root));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');
function exactSet(actual, expected, message) {
  assert.ok(Array.isArray(actual) && Array.isArray(expected), message);
  assert.equal(new Set(actual).size, actual.length, message + ' duplicates');
  assert.deepEqual([...actual].sort(), [...expected].sort(), message);
}
function declarations(path, bytes) {
  const parsed = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const result = new Map();
  for (const node of parsed.statements) {
    const name = node.name?.getText(parsed)
      || node.declarationList?.declarations.map(item => item.name.getText(parsed)).join(',');
    if (!name) continue;
    assert.equal(result.has(name), false, 'duplicate protected declaration');
    result.set(name, node.getText(parsed));
  }
  return result;
}
function cases(path, bytes) {
  const parsed = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const found = parsed.statements.filter(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === 'test');
  const result = new Map();
  for (const node of found) {
    const name = node.expression.arguments[0]?.text;
    assert.equal(typeof name, 'string', 'only explicit named reviewed test cases');
    assert.ok(!result.has(name), 'duplicate test case: ' + name);
    result.set(name, node.getText(parsed));
  }
  return result;
}

function verifyExactSourceDiff(row, before, after, diff) {
  assert.equal(before.toString().endsWith('\n'), row.original_ends_with_newline);
  assert.equal(after.toString().endsWith('\n'), row.candidate_ends_with_newline);
  const lines = diff.split('\n');
  assert.equal(lines.shift(), '--- a/' + row.path);
  assert.equal(lines.shift(), '+++ b/' + row.path);
  const previous = before.length ? before.toString().replace(/\n$/, '').split('\n') : [];
  const result = []; let cursor = 0, index = 0, count = 0;
  while (index < lines.length) {
    if (lines[index] === '' && index === lines.length - 1) break;
    const hunk = lines[index++].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    assert.ok(hunk, 'exact bounded unified source diff'); count++;
    const oldCount = Number(hunk[2] ?? 1), newCount = Number(hunk[4] ?? 1);
    const oldStart = Number(hunk[1]) - (oldCount ? 1 : 0);
    const newStart = Number(hunk[3]) - (newCount ? 1 : 0);
    assert.ok(oldStart >= cursor && oldStart <= previous.length);
    result.push(...previous.slice(cursor, oldStart));
    assert.equal(result.length, newStart, 'new hunk offset');
    const oldLines = [], newLines = [];
    while (index < lines.length && !lines[index].startsWith('@@ ')) {
      const line = lines[index++];
      if (line === '' && index === lines.length) break;
      if (line === '\\ No newline at end of file') continue;
      assert.ok([' ', '+', '-'].includes(line[0]), 'supported unified diff line');
      if (line[0] !== '+') oldLines.push(line.slice(1));
      if (line[0] !== '-') newLines.push(line.slice(1));
    }
    assert.equal(oldLines.length, oldCount); assert.equal(newLines.length, newCount);
    assert.deepEqual(previous.slice(oldStart, oldStart + oldCount), oldLines, 'exact predecessor diff context');
    result.push(...newLines); cursor = oldStart + oldCount;
  }
  assert.ok(count > 0, 'nonempty reviewed source diff');
  result.push(...previous.slice(cursor));
  assert.deepEqual(Buffer.from(result.join('\n') + (row.candidate_ends_with_newline ? '\n' : '')), after,
    'reviewed diff must reproduce the complete live candidate');
}

function verifyPublicExport(seal, registry, artifactBytes, readSource) {
  assert.ok(seal && Object.isFrozen(seal), 'independent reviewed Eighth seal required');
  assert.equal(hash(artifactBytes), seal.artifact, 'Eighth immutable artifact');
  const artifact = JSON.parse(artifactBytes);
  const { [SECTION_KEY]: section, ...previousRegistry } = registry;
  assert.ok(section, 'Eighth registration missing');
  assert.equal(jsonHash(section), seal.section, 'Eighth independently fixed registration');
  assert.deepEqual(section, artifact.registration, 'Eighth artifact/registration equality');
  assert.equal(section.approval_id, APPROVAL_ID);
  assert.equal(section.candidate_base_git_sha, BASE);
  assert.equal(section.previous_complete_registry_sha256, PREVIOUS_REGISTRY);
  assert.ok(section.approval_provenance?.length > 100);
  for (const key of ['production_operations', 'production_sql_execution', 'external_delivery_verified',
    'natural_stability_claim', 'auth_change', 'acl_change', 'readdy_host_verified', 'release_ready']) {
    assert.equal(section[key], false, 'Eighth does not grant ' + key);
  }
  const rows = section.files;
  assert.equal(rows.find(row => row.path === FIRST_ADMITTED_EXISTING_SOURCE.path)?.original_hash,
    FIRST_ADMITTED_EXISTING_SOURCE.original_hash, 'previously unregistered existing export is never a new/unknown file');
  exactSet(rows.map(row => row.path), seal.paths, 'Eighth complete exact reviewed scope');
  exactSet(Object.keys(artifact.preimages), rows.filter(row => row.original_hash !== null).map(row => row.path),
    'Eighth exact predecessor source set');
  exactSet(Object.keys(artifact.source_diffs), seal.paths, 'Eighth complete source diff set');
  exactSet(section.test_case_successors.map(row => row.path + ':' + row.name), seal.test_successors,
    'Eighth exact reviewed test case successors');
  assert.deepEqual(section.preserved_test_bodies, seal.preserved_test_bodies,
    'Eighth complete independently reviewed historical assertion bodies');
  const cached = new Map();
  const source = path => {
    if (!cached.has(path)) cached.set(path, Buffer.from(readSource(path)));
    return cached.get(path);
  };
  const raw = source(REGISTRY_PATH).toString();
  assert.deepEqual(JSON.parse(raw), registry, 'supplied and actual registry differ');
  const suffix = ',\n  "' + SECTION_KEY + '": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(raw.endsWith(suffix), 'Eighth append-only registry suffix');
  const originalRegistry = Buffer.from(raw.slice(0, -suffix.length) + '}\n');
  assert.equal(hash(originalRegistry), PREVIOUS_REGISTRY, 'all earlier registry bytes unchanged');
  assert.deepEqual(JSON.parse(originalRegistry), previousRegistry);
  assert.equal(hash(source(PREVIOUS_GUARD_PATH)), PREVIOUS_GUARD, 'Seventh guard unchanged');
  assert.equal(hash(source(PREVIOUS_ARTIFACT_PATH)), PREVIOUS_ARTIFACT, 'Seventh artifact unchanged');
  assert.equal(hash(source(MANIFEST_PATH)), MANIFEST, 'Production declaration inventory unchanged');
  const restored = new Map();
  for (const row of rows) {
    assert.match(row.path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);
    assert.ok(!row.path.split('/').includes('..') && !row.path.includes(' 2.'));
    assert.ok(row.reason?.length > 20 && row.rollback_target?.length > 15);
    assert.equal(row.approval_provenance, section.approval_provenance);
    assert.equal(hash(source(row.path)), row.candidate_hash, 'unreviewed live source drift: ' + row.path);
    assert.equal(hash(artifact.source_diffs[row.path]), row.diff_hash, 'reviewed source diff drift: ' + row.path);
    if (row.original_hash === null) {
      verifyExactSourceDiff(row, Buffer.alloc(0), source(row.path), artifact.source_diffs[row.path]);
      restored.set(row.path, null);
    }
    else {
      const bytes = gunzipSync(Buffer.from(artifact.preimages[row.path], 'base64'));
      assert.equal(hash(bytes), row.original_hash, 'exact source predecessor: ' + row.path);
      assert.notEqual(row.original_hash, row.candidate_hash, 'no unnecessary source waiver');
      verifyExactSourceDiff(row, bytes, source(row.path), artifact.source_diffs[row.path]);
      restored.set(row.path, bytes);
    }
  }
  const seventhReadSource = path => {
    if (path === REGISTRY_PATH) return originalRegistry;
    if (!restored.has(path)) return source(path);
    const bytes = restored.get(path);
    if (bytes !== null) return bytes;
    throw Object.assign(new Error('Eighth-new file absent from Seventh: ' + path), { code: 'ENOENT' });
  };
  const seventh = resolveConsolidationSqlHistoryIntegrity(previousRegistry,
    source(PREVIOUS_ARTIFACT_PATH), seventhReadSource);
  for (const row of rows) {
    const original = previousRegistry.files.find(item => item.path === row.path);
    assert.equal(row.production_hash, original?.baseline_sha256 ?? null, 'original Production hash preserved');
  }
  const manifest = JSON.parse(source(MANIFEST_PATH));
  assert.equal(manifest.protected_declarations.length, 698);
  const changed = [], overrides = new Map();
  const oldDeclarations = new Map(), liveDeclarations = new Map();
  for (const item of manifest.protected_declarations) {
    if (!oldDeclarations.has(item.path)) oldDeclarations.set(item.path, declarations(item.path, seventhReadSource(item.path)));
    if (!liveDeclarations.has(item.path)) liveDeclarations.set(item.path, declarations(item.path, source(item.path)));
    const before = oldDeclarations.get(item.path).get(item.name), after = liveDeclarations.get(item.path).get(item.name);
    assert.equal(typeof before, 'string'); assert.equal(typeof after, 'string');
    const approved = section.declarations.find(row => row.path === item.path && row.name === item.name);
    if (before === after) { assert.equal(approved, undefined, 'unnecessary protected-declaration waiver'); continue; }
    assert.ok(approved, 'unreviewed protected declaration: ' + item.path + ':' + item.name);
    assert.equal(approved.production_hash, item.production_sha256);
    assert.equal(approved.original_hash, hash(before)); assert.equal(approved.candidate_hash, hash(after));
    assert.ok(approved.reason?.length > 20 && approved.rollback_target?.length > 15);
    changed.push(item.path + ':' + item.name); overrides.set(item.path + ':' + item.name, approved.candidate_hash);
  }
  exactSet(changed, seal.declarations, 'exact changed protected declaration set');
  exactSet(section.declarations.map(row => row.path + ':' + row.name), seal.declarations, 'declared protected set');
  for (const row of section.preserved_test_bodies) {
    for (const bytes of [source(row.path), seventhReadSource(row.path)]) {
      const text = bytes.toString(), offset = text.indexOf(row.marker);
      assert.ok(offset >= 0); assert.equal(hash(text.slice(offset)), row.sha256, 'all historical assertions preserved: ' + row.path);
    }
  }
  for (const path of new Set(section.test_case_successors.map(row => row.path))) {
    const before = cases(path, seventhReadSource(path)), after = cases(path, source(path));
    exactSet([...after.keys()], [...before.keys()], 'no removed or duplicate legacy tests');
    for (const [name, old] of before) {
      const approved = section.test_case_successors.find(row => row.path === path && row.name === name);
      if (!approved) assert.equal(after.get(name), old, 'unreviewed adjacent test: ' + name);
      else {
        assert.equal(hash(old), approved.original_hash); assert.equal(hash(after.get(name)), approved.candidate_hash);
        assert.notEqual(after.get(name), old, 'no phantom unchanged test successor');
        assert.ok((after.get(name).match(/assert\./g) || []).length >= (old.match(/assert\./g) || []).length,
          'reviewed contract successor does not reduce assertions');
      }
    }
  }
  const fileOverrides = new Map(rows.map(row => [row.path, row.candidate_hash]));
  return { ...seventh, seventhRegistry: previousRegistry, seventhReadSource,
    fileHash: row => fileOverrides.get(row.path) ?? seventh.fileHash(row),
    declarationHash: row => overrides.get(row.path + ':' + row.name) ?? seventh.declarationHash(row),
    newCandidatePaths: [...new Set([...seventh.newCandidatePaths, ...rows.filter(row => row.original_hash === null).map(row => row.path)])],
  };
}

export function resolveConsolidationPublicExportIntegrity(registry, artifactBytes, readSource = defaultRead) {
  if (FINAL_SEAL === null) throw Object.assign(new Error('EIGHTH_REVIEWED_SOURCE_FREEZE_REQUIRED'),
    { code: 'EIGHTH_REVIEWED_SOURCE_FREEZE_REQUIRED' });
  // Verify the exact V1 default admission before all unchanged historical layers.
  return resolveConsolidationAcceptanceDefaultIntegrity(registry, artifactBytes, readSource,
    (tenthRegistry, tenthArtifact, tenthRead) =>
      resolveConsolidationFixtureRepresentation(tenthRegistry, tenthArtifact, tenthRead,
        (ninthRegistry, ninthArtifact, ninthRead) =>
          resolveConsolidationRequiredMarketIntegrity(ninthRegistry, ninthArtifact, ninthRead,
            (previousRegistry, previousArtifact, previousRead) =>
              verifyPublicExport(FINAL_SEAL, previousRegistry, previousArtifact, previousRead))));
}
export const readConsolidationPublicExportIntegrity = registry =>
  resolveConsolidationPublicExportIntegrity(registry, defaultRead(PUBLIC_EXPORT_ARTIFACT_PATH));
