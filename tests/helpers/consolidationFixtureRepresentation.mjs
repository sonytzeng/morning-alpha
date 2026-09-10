// Exact four-file serialization admission only. No runtime or release authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';

export const FIXTURE_REPRESENTATION_ARTIFACT_PATH = 'docs/operations/evidence/core-fixture-representation-20260910.json';
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const NINTH_ARTIFACT_PATH = 'docs/operations/evidence/core-required-market-input-20260910.json';
const NINTH_GUARD_PATH = 'tests/helpers/consolidationRequiredMarketIntegrity.mjs';
const PUBLIC_ENTRY_PATH = 'tests/helpers/consolidationPublicExportIntegrity.mjs';
const EIGHTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-public-export-20260909.json';
const SECTION_KEY = 'core_fixture_representation_registration';
const PREVIOUS_REGISTRY = '48668fbb895cb926fbec2c696358161bb701b1534805a078caa268998086087c';
const NINTH_ARTIFACT = '59425c6ad3d7a5e1e7ba4d37a3fcd7580f1b7b12f256a8aa22c42d25ed8eb25b';
const NINTH_GUARD = '8ce476ae47872563b01a77830c26336400effebac08c4fd365760b499f454b0c';
const EIGHTH_ARTIFACT = 'f0f4a1a7d5b72d45841f1910ef5ccd8c3b390c4488f78b82ccf3e687ee17b2f1';
const FINAL_SEAL = Object.freeze({
  "artifact": "6595d0e89d2ef0843420fce4e810cb76bd9ac0a78e6a42b9092062a0c956dae1",
  "section": "894602e0d956be03acaffde559fccc9b41d54bcdeb8087d795d81745b1d9bbd5",
  "paths": [
    "tests/consolidationRequiredMarketIntegrity.test.mjs",
    "tests/coreConsolidationFactualExportPreparation.test.mjs",
    "tests/coreConsolidationReplayPreparation.test.mjs",
    "tests/fixtures/consolidation-v1/local-runs/full-chain-market-only-20260921.json",
    "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260923.json",
    "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260925.json",
    "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260930.json",
    "tests/helpers/consolidationPublicExportIntegrity.mjs",
    "tests/helpers/coreConsolidationFactualExportRuntime.mjs",
    "tests/helpers/coreConsolidationMissingQuoteRuntime.mjs"
  ],
  "preserved_test_bodies": [
    {
      "path": "tests/consolidationRequiredMarketIntegrity.test.mjs",
      "marker": "// Independent exact pins for the reviewed Ninth proposal.",
      "sha256": "dc40a77f30c1375281f13449f15d8d53a8edd0ccb38490dfa425604dfbf7d999"
    },
    {
      "path": "tests/coreConsolidationReplayPreparation.test.mjs",
      "marker": "const fixture =",
      "sha256": "43d71d48e17c5e39f3c39f018240cd8e5abcd5cb6031db9e66797c3f78e8a5f3"
    },
    {
      "path": "tests/coreConsolidationFactualExportPreparation.test.mjs",
      "marker": "const read =",
      "sha256": "60769be15406d5aa07eb9823ef5027e7c836f2c5b80ccc4abc1a69da8bd292c5"
    }
  ],
  "eighth_verifier": "a41c7fc33df538798ddc5b21b2cc2b9d59794329249a64d5b52a96053cdb612d"
});

export const EXACT_FIXTURE_REPRESENTATIONS = Object.freeze([
  Object.freeze({ path: 'tests/fixtures/consolidation-v1/local-runs/full-chain-market-only-20260921.json',
    original_bytes: 9754, original_sha256: '903dc460b4764a61d61b5b14734a3a587a9e7094091f58f6241de305361c1a08',
    candidate_bytes: 9753, candidate_sha256: '9ac767daa8e6275af75c85044bfbfc8a789c18fab75888b74cabeebce3c97743' }),
  Object.freeze({ path: 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260923.json',
    original_bytes: 19858, original_sha256: 'f1eda85b78645eb0c7264890cc73334e4624d5d4c0535300546f1316ad49a81a',
    candidate_bytes: 19857, candidate_sha256: 'c50aeb7628de6303959c9528db007401dbc59093ad9072af453dd1cf200e96d0' }),
  Object.freeze({ path: 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260925.json',
    original_bytes: 19655, original_sha256: '6506498e79aed90d9a18d7f5df01dcf46a205f8d7fbc3f3df4d57727e32c197a',
    candidate_bytes: 19654, candidate_sha256: 'd8fb004fb02f46c945df00c2452cd29ed179e40e1d9449ab35bccfc9c84d24cb' }),
  Object.freeze({ path: 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260930.json',
    original_bytes: 19662, original_sha256: '8b22d81d9e74ac7cdaf1d7224c4076b72c1354bcb26407881150bd064c2e7c48',
    candidate_bytes: 19661, candidate_sha256: 'd278c10454ac48830afcf3be043f8febb6e1f18ccf53d3f7b2cec96e1a29ddf0' }),
]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');
const exactSet = (actual, expected, label) => {
  assert.ok(Array.isArray(actual) && Array.isArray(expected), label);
  assert.equal(new Set(actual).size, actual.length, label + ' duplicate');
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
};
const defaultArtifact = () => readFileSync(new URL('../../' + FIXTURE_REPRESENTATION_ARTIFACT_PATH, import.meta.url));

function readSealedArtifact(bytes) {
  assert.ok(FINAL_SEAL && Object.isFrozen(FINAL_SEAL), 'TENTH_REVIEWED_SOURCE_FREEZE_REQUIRED');
  assert.equal(hash(bytes), FINAL_SEAL.artifact, 'Tenth independently pinned artifact');
  const artifact = JSON.parse(bytes);
  assert.equal(artifact.schema_version, 'CORE_FIXTURE_REPRESENTATION_V1');
  assert.deepEqual(artifact.representations, EXACT_FIXTURE_REPRESENTATIONS, 'exact four fixture representations');
  return artifact;
}

// This operation deliberately has no arbitrary-path fallback. Callers must
// select the exact historical fixture explicitly; ordinary raw reads stay raw.
export function readExactFixturePreimage(path, candidateBytes, artifactBytes = defaultArtifact()) {
  const row = EXACT_FIXTURE_REPRESENTATIONS.find(item => item.path === path);
  assert.ok(row, 'unapproved fixture representation path');
  const artifact = readSealedArtifact(artifactBytes);
  const candidate = Buffer.from(candidateBytes);
  assert.equal(candidate.length, row.candidate_bytes, 'exact candidate fixture length');
  assert.equal(hash(candidate), row.candidate_sha256, 'exact candidate fixture hash');
  const encoded = artifact.preimages[path];
  assert.equal(typeof encoded, 'string', 'complete original fixture preimage');
  const original = gunzipSync(Buffer.from(encoded, 'base64'));
  assert.equal(original.length, row.original_bytes, 'exact original fixture length');
  assert.equal(hash(original), row.original_sha256, 'exact original fixture hash');
  assert.equal(original.at(-1), 10); assert.equal(original.at(-2), 10); assert.notEqual(original.at(-3), 10);
  assert.equal(candidate.at(-1), 10); assert.notEqual(candidate.at(-2), 10);
  assert.deepEqual(original, Buffer.concat([candidate, Buffer.from([10])]), 'append exactly one LF restores original');
  assert.deepEqual(JSON.parse(original), JSON.parse(candidate), 'unchanged complete fixture JSON');
  return original;
}

function declaration(path, bytes, name) {
  const parsed = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const matches = parsed.statements.filter(node => node.name?.getText(parsed) === name);
  assert.equal(matches.length, 1, 'one exact protected declaration');
  return matches[0].getText(parsed);
}

function verifyExactSourceDiff(row, before, after, diff) {
  assert.equal(before.toString().endsWith('\n'), row.original_ends_with_newline);
  assert.equal(after.toString().endsWith('\n'), row.candidate_ends_with_newline);
  const lines = diff.split('\n');
  assert.equal(lines.shift(), '--- a/' + row.path); assert.equal(lines.shift(), '+++ b/' + row.path);
  const previous = before.toString().replace(/\n$/, '').split('\n');
  const result = []; let cursor = 0, index = 0, count = 0;
  while (index < lines.length) {
    if (lines[index] === '' && index === lines.length - 1) break;
    const hunk = lines[index++].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    assert.ok(hunk, 'exact bounded unified source diff'); count++;
    const oldCount = Number(hunk[2] ?? 1), newCount = Number(hunk[4] ?? 1);
    const oldStart = Number(hunk[1]) - (oldCount ? 1 : 0), newStart = Number(hunk[3]) - (newCount ? 1 : 0);
    assert.ok(oldStart >= cursor && oldStart <= previous.length);
    result.push(...previous.slice(cursor, oldStart)); assert.equal(result.length, newStart);
    const oldLines = [], newLines = [];
    while (index < lines.length && !lines[index].startsWith('@@ ')) {
      const line = lines[index++]; if (line === '' && index === lines.length) break;
      assert.ok([' ', '+', '-'].includes(line[0]), 'supported unified diff line');
      if (line[0] !== '+') oldLines.push(line.slice(1));
      if (line[0] !== '-') newLines.push(line.slice(1));
    }
    assert.equal(oldLines.length, oldCount); assert.equal(newLines.length, newCount);
    assert.deepEqual(previous.slice(oldStart, oldStart + oldCount), oldLines, 'exact original diff context');
    result.push(...newLines); cursor = oldStart + oldCount;
  }
  assert.ok(count > 0); result.push(...previous.slice(cursor));
  assert.deepEqual(Buffer.from(result.join('\n') + (row.candidate_ends_with_newline ? '\n' : '')), after,
    'reviewed diff reproduces the complete live successor');
}

export function resolveConsolidationFixtureRepresentation(registry, eighthArtifactBytes, readSource, verifyNinth) {
  assert.ok(registry && Object.hasOwn(registry, SECTION_KEY), 'complete Tenth registration required');
  const section = registry[SECTION_KEY];
  assert.ok(section && typeof section === 'object' && !Array.isArray(section), 'complete Tenth registration required');
  const cached = new Map();
  const source = path => { if (!cached.has(path)) cached.set(path, Buffer.from(readSource(path))); return cached.get(path); };
  const artifactBytes = source(FIXTURE_REPRESENTATION_ARTIFACT_PATH), artifact = readSealedArtifact(artifactBytes);
  assert.equal(jsonHash(section), FINAL_SEAL.section, 'Tenth independently fixed registration');
  assert.deepEqual(section, artifact.registration, 'Tenth artifact/registry equality');
  assert.equal(section.approval_id, 'CORE_FOUR_FIXTURE_SINGLE_LF_REPRESENTATION_20260910');
  assert.equal(section.candidate_base_git_sha, '6469630795fb1215595306c026437d850b668801');
  assert.equal(section.previous_complete_registry_sha256, PREVIOUS_REGISTRY);
  assert.ok(section.approval_provenance.length > 100);
  for (const flag of ['production_operations', 'production_sql_execution', 'external_delivery_verified',
    'natural_stability_claim', 'auth_change', 'acl_change', 'readdy_host_verified', 'release_ready', 'runtime_raw_hash_waiver']) {
    assert.equal(section[flag], false, 'Tenth grants no ' + flag);
  }
  const raw = source(REGISTRY_PATH).toString();
  assert.deepEqual(JSON.parse(raw), registry, 'supplied and physical registry differ');
  const suffix = ',\n  "' + SECTION_KEY + '": ' + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(raw.endsWith(suffix), 'exact append-only Tenth suffix');
  const previousBytes = Buffer.from(raw.slice(0, -suffix.length) + '}\n');
  assert.equal(hash(previousBytes), PREVIOUS_REGISTRY, 'all nine registry layers unchanged');
  const previousRegistry = JSON.parse(previousBytes);
  assert.equal(hash(source(NINTH_ARTIFACT_PATH)), NINTH_ARTIFACT, 'original Ninth artifact unchanged');
  assert.equal(hash(source(NINTH_GUARD_PATH)), NINTH_GUARD, 'original Ninth verifier unchanged');
  assert.equal(hash(source(EIGHTH_ARTIFACT_PATH)), EIGHTH_ARTIFACT, 'original Eighth artifact unchanged');
  assert.deepEqual(Buffer.from(eighthArtifactBytes), source(EIGHTH_ARTIFACT_PATH));
  exactSet(section.files.map(row => row.path), FINAL_SEAL.paths, 'exact ten source successors');
  exactSet(Object.keys(artifact.preimages), FINAL_SEAL.paths, 'complete original source preimages');
  exactSet(Object.keys(artifact.source_diffs), FINAL_SEAL.paths, 'complete source diffs');
  const restored = new Map();
  for (const row of section.files) {
    assert.match(row.path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);
    assert.ok(!row.path.split('/').includes('..') && !row.path.includes(' 2.'));
    assert.ok(row.reason.length > 20 && row.rollback_target.length > 15);
    assert.equal(row.approval_provenance, section.approval_provenance);
    assert.equal(hash(source(row.path)), row.candidate_hash, 'unreviewed Tenth source drift: ' + row.path);
    const before = gunzipSync(Buffer.from(artifact.preimages[row.path], 'base64'));
    assert.equal(hash(before), row.original_hash, 'exact predecessor source: ' + row.path);
    assert.equal(before.length, row.original_bytes); assert.equal(source(row.path).length, row.candidate_bytes);
    assert.notEqual(row.original_hash, row.candidate_hash, 'no unchanged-source waiver');
    assert.equal(hash(artifact.source_diffs[row.path]), row.diff_hash);
    verifyExactSourceDiff(row, before, source(row.path), artifact.source_diffs[row.path]);
    const fixture = EXACT_FIXTURE_REPRESENTATIONS.find(item => item.path === row.path);
    if (fixture) {
      assert.equal(row.original_hash, fixture.original_sha256); assert.equal(row.candidate_hash, fixture.candidate_sha256);
      assert.deepEqual(before, readExactFixturePreimage(row.path, source(row.path), artifactBytes));
    }
    restored.set(row.path, before);
  }
  const ninthReadSource = path => path === REGISTRY_PATH ? previousBytes : restored.get(path) ?? source(path);
  assert.deepEqual(section.preserved_test_bodies, FINAL_SEAL.preserved_test_bodies);
  for (const row of section.preserved_test_bodies) for (const bytes of [source(row.path), ninthReadSource(row.path)]) {
    const text = bytes.toString(), offset = text.indexOf(row.marker);
    assert.ok(offset >= 0 && text.indexOf(row.marker, offset + 1) < 0, 'unique preserved test-tail marker');
    assert.equal(hash(text.slice(offset)), row.sha256, 'all original historical assertions unchanged');
  }
  const oldVerifier = declaration(PUBLIC_ENTRY_PATH, ninthReadSource(PUBLIC_ENTRY_PATH), 'verifyPublicExport');
  assert.equal(declaration(PUBLIC_ENTRY_PATH, source(PUBLIC_ENTRY_PATH), 'verifyPublicExport'), oldVerifier);
  assert.equal(hash(oldVerifier), FINAL_SEAL.eighth_verifier);
  assert.equal(typeof verifyNinth, 'function');
  const ninth = verifyNinth(previousRegistry, source(EIGHTH_ARTIFACT_PATH), ninthReadSource);
  const overrides = new Map(section.files.map(row => [row.path, row.candidate_hash]));
  return { ...ninth, ninthRegistry: previousRegistry, ninthReadSource,
    verifyNinth: (r, a, read = ninthReadSource) => verifyNinth(r, a, read),
    fileHash: row => overrides.get(row.path) ?? ninth.fileHash(row),
  };
}
