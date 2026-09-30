// Twelfth admission is test-only. It authenticates the bounded Content OS
// read-contract successor, reconstructs the exact Eleventh bytes, and then
// executes every earlier immutable verifier. It grants no Production authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const CONTENT_OS_READ_CONTRACT_ARTIFACT_PATH =
  'docs/operations/evidence/content-os-read-contract-v1-20261001.json';
const REGISTRY = 'docs/operations/core-stability-incident-amendment-20260908.json';
const SECTION = 'content_os_read_contract_v1_registration';
const PREVIOUS_REGISTRY = '0cf9db8e012607f1b057d8ed974c21354c304b342d5b3a5674b78eb927e11ad2';
const FINAL_SEAL = Object.freeze({
  artifact: '84f9802355c293d7b6161bf0c3052c7956553e40c4a401ab9b4f51a098004f8e',
  section: '7ed53d34f23c744a20e093dde94a90ed73b668193f70c32748b692dd92832f1e',
  paths: [
    'supabase/functions/content-os-morning-alpha-source/index.ts',
    'tests/consolidationContentOsPublication.test.mjs',
    'tests/consolidationAcceptanceDefaultIntegrity.test.mjs',
    'tests/helpers/consolidationPublicExportIntegrity.mjs',
  ],
});

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');
const exactSet = (actual, expected, label) => {
  assert.equal(new Set(actual).size, actual.length, label + ' duplicates');
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
};

function verifyExactSourceDiff(row, before, after, diff) {
  assert.equal(before.toString().endsWith('\n'), row.original_ends_with_newline);
  assert.equal(after.toString().endsWith('\n'), row.candidate_ends_with_newline);
  const lines = diff.split('\n');
  assert.equal(lines.shift(), '--- a/' + row.path);
  assert.equal(lines.shift(), '+++ b/' + row.path);
  const previous = before.length ? before.toString().replace(/\n$/, '').split('\n') : [];
  const result = [];
  let cursor = 0;
  let index = 0;
  let count = 0;
  while (index < lines.length) {
    if (lines[index] === '' && index === lines.length - 1) break;
    const hunk = lines[index++].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    assert.ok(hunk, 'exact bounded unified source diff');
    count++;
    const oldCount = Number(hunk[2] ?? 1);
    const newCount = Number(hunk[4] ?? 1);
    const oldStart = Number(hunk[1]) - (oldCount ? 1 : 0);
    const newStart = Number(hunk[3]) - (newCount ? 1 : 0);
    assert.ok(oldStart >= cursor && oldStart <= previous.length);
    result.push(...previous.slice(cursor, oldStart));
    assert.equal(result.length, newStart, 'new hunk offset');
    const oldLines = [];
    const newLines = [];
    while (index < lines.length && !lines[index].startsWith('@@ ')) {
      const line = lines[index++];
      if (line === '' && index === lines.length) break;
      if (line === '\\ No newline at end of file') continue;
      assert.ok([' ', '+', '-'].includes(line[0]), 'supported unified diff line');
      if (line[0] !== '+') oldLines.push(line.slice(1));
      if (line[0] !== '-') newLines.push(line.slice(1));
    }
    assert.equal(oldLines.length, oldCount);
    assert.equal(newLines.length, newCount);
    assert.deepEqual(previous.slice(oldStart, oldStart + oldCount), oldLines);
    result.push(...newLines);
    cursor = oldStart + oldCount;
  }
  assert.ok(count > 0, 'nonempty reviewed source diff');
  result.push(...previous.slice(cursor));
  assert.deepEqual(
    Buffer.from(result.join('\n') + (row.candidate_ends_with_newline ? '\n' : '')),
    after,
    'reviewed diff must reproduce the complete live candidate',
  );
}

export function resolveContentOsReadContractIntegrity(registry, eighthArtifactBytes, readSource, verifyEleventh) {
  assert.ok(registry && Object.hasOwn(registry, SECTION), 'complete Twelfth registration required');
  const section = registry[SECTION];
  const cached = new Map();
  const source = path => {
    if (!cached.has(path)) cached.set(path, Buffer.from(readSource(path)));
    return cached.get(path);
  };
  const artifactBytes = source(CONTENT_OS_READ_CONTRACT_ARTIFACT_PATH);
  assert.equal(hash(artifactBytes), FINAL_SEAL.artifact, 'Twelfth independently pinned artifact');
  const artifact = JSON.parse(artifactBytes);
  assert.equal(artifact.schema_version, 'CONTENT_OS_READ_CONTRACT_V1_ADMISSION');
  assert.equal(jsonHash(section), FINAL_SEAL.section, 'Twelfth independently pinned registration');
  assert.deepEqual(section, artifact.registration, 'Twelfth artifact/registry equality');
  assert.equal(section.approval_id, 'CONTENT_OS_READ_CONTRACT_V1_APPEND_20261001');
  assert.equal(section.previous_complete_registry_sha256, PREVIOUS_REGISTRY);
  assert.ok(section.approval_provenance.length > 100);
  for (const key of [
    'production_operations', 'production_sql_execution', 'auth_change', 'acl_change',
    'runtime_raw_hash_waiver', 'external_delivery_verified', 'natural_stability_claim',
    'release_ready', 'content_generation', 'public_posting',
  ]) assert.equal(section[key], false, 'Twelfth grants no ' + key);

  const raw = source(REGISTRY).toString();
  assert.deepEqual(JSON.parse(raw), registry, 'supplied and physical registry equality');
  const suffix = ',\n  "' + SECTION + '": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(raw.endsWith(suffix), 'exact Twelfth append-only suffix');
  const previousBytes = Buffer.from(raw.slice(0, -suffix.length) + '}\n');
  assert.equal(hash(previousBytes), PREVIOUS_REGISTRY, 'all eleven registry layers unchanged');
  assert.deepEqual(gunzipSync(Buffer.from(artifact.previous_complete_registry_gzip_base64, 'base64')), previousBytes);

  exactSet(section.files.map(row => row.path), FINAL_SEAL.paths, 'exact Twelfth source rows');
  exactSet(Object.keys(artifact.source_diffs), FINAL_SEAL.paths, 'complete Twelfth diffs');
  exactSet(Object.keys(artifact.preimages), FINAL_SEAL.paths, 'complete Twelfth preimages');
  const restored = new Map();
  for (const row of section.files) {
    const candidate = source(row.path);
    const before = gunzipSync(Buffer.from(artifact.preimages[row.path], 'base64'));
    assert.equal(hash(candidate), row.candidate_hash, 'unreviewed Twelfth live source drift: ' + row.path);
    assert.equal(candidate.length, row.candidate_bytes);
    assert.equal(hash(before), row.original_hash, 'exact Twelfth source predecessor: ' + row.path);
    assert.equal(before.length, row.original_bytes);
    assert.notEqual(row.original_hash, row.candidate_hash, 'no unchanged-source waiver');
    assert.equal(hash(artifact.source_diffs[row.path]), row.diff_hash, 'exact Twelfth source diff: ' + row.path);
    assert.equal(row.approval_provenance, section.approval_provenance);
    assert.ok(row.reason.length > 20 && row.rollback_target.length > 15);
    verifyExactSourceDiff(row, before, candidate, artifact.source_diffs[row.path]);
    restored.set(row.path, before);
  }

  const eleventhReadSource = path => {
    if (path === REGISTRY) return previousBytes;
    return restored.get(path) ?? source(path);
  };
  assert.equal(typeof verifyEleventh, 'function', 'fixed Eleventh verifier callback');
  const previousRegistry = JSON.parse(previousBytes);
  const eleventh = verifyEleventh(previousRegistry, eighthArtifactBytes, eleventhReadSource);
  const overrides = new Map(section.files.map(row => [row.path, row.candidate_hash]));
  return {
    ...eleventh,
    eleventhRegistry: previousRegistry,
    eleventhReadSource,
    fileHash: row => overrides.get(row.path) ?? eleventh.fileHash(row),
  };
}
