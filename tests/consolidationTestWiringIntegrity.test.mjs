import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH,
  resolveConsolidationTestWiringIntegrity,
} from './helpers/consolidationTestWiringIntegrity.mjs';
import { resolveConsolidationDeliveryIntegrity } from './helpers/consolidationDeliveryIntegrity.mjs';
import { resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';
import { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';
import { readConsolidationPublicExportIntegrity as readConsolidationSqlHistoryIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';

// Independent review pins. Every negative first executes the complete clean
// predecessor chain. All tampering is in memory: no runtime, SQL or baseline writes.
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const GUARD_PATH = 'tests/helpers/consolidationTestWiringIntegrity.mjs';
const FIFTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json';
const FOURTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';
const FIRST_ARTIFACT_PATH = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';
const MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';
const PUBLICATION_PATH = 'supabase/functions/_shared/market-publication-contract.ts';
const ORCHESTRATOR_PATH = 'supabase/functions/daily-delivery-orchestrator/index.ts';
const seventh = readConsolidationSqlHistoryIntegrity(
  JSON.parse(readFileSync(new URL('../' + REGISTRY_PATH, import.meta.url))),
);
const readSource = seventh.sixthReadSource;
const rawRegistry = readSource(REGISTRY_PATH);
const registry = JSON.parse(rawRegistry);
const artifact = readSource(CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH);
const fifthArtifact = readSource(FIFTH_ARTIFACT_PATH);
const manifest = JSON.parse(readSource(MANIFEST_PATH));
const readConsolidationTestWiringIntegrity = value =>
  resolveConsolidationTestWiringIntegrity(value, artifact, readSource, fifthArtifact);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sixth = value => value.core_delivery_test_wiring_registration;
const verify = (value = registry, bytes = artifact, source = readSource, prior = fifthArtifact) =>
  resolveConsolidationTestWiringIntegrity(value, bytes, source, prior);
const guardHash = 'f4d367c84bb6ad4267d4f07a41341c9421d6c36eec2c659cbc4f82825e049630';
const artifactHash = '69cf698d21fb306a002025d1edd04e4b1a825baf905698724e40f0cae8d52d96';
const sectionHash = 'b33572e43b278ac2c05292841a065575069229eed896bec9cc8d0ac35d40d207';
const patchHash = '0356eeeeb8ba7914f66eb9bae18080d9ac43ce4ac6cdb87e6b7cd4dd6194f6a8';
const exactPaths = [
  'tests/productionLivePipeline.test.mjs', 'tests/productionReliability.test.mjs', 'tests/publicRelease.test.mjs',
  'tests/coreProductionPreservation.test.mjs', 'tests/productContract.test.mjs',
  'tests/subscriberProjectionIntegrity.test.mjs', 'tests/consolidationIntegrity.test.mjs',
  'tests/consolidationDeliveryIntegrity.test.mjs',
];
const previousAnchors = {
  'tests/helpers/consolidationDeliveryIntegrity.mjs': '3770a8e3305933f5f42add561ac5b8cbd98273c036c15a49c6c44338c0a2e23c',
  [FIFTH_ARTIFACT_PATH]: '861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056',
  'tests/helpers/consolidationIntegrity.mjs': '0994de2d3326de77b1f9c3aa2bdae601758c3dc30fbcbef9197a69b6a7bdbe1a',
  [FOURTH_ARTIFACT_PATH]: 'e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315',
  'tests/helpers/subscriberProjectionIntegrity.mjs': '2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0',
  [MANIFEST_PATH]: 'bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c',
};
const assertionBodyPins = {
  'tests/subscriberProjectionIntegrity.test.mjs': 'a0e57cb4abcbacf66cf71b3785d426a6ea51f541e69b98021f814b8e9fcca2d2',
  'tests/consolidationIntegrity.test.mjs': 'a336572755e95da10e00add17ac4d62c0588cb9e615fc56f32c44813fb8f3f9a',
  'tests/consolidationDeliveryIntegrity.test.mjs': '7ae34c94c8069a49ac5f335dfb65aac772794f8581cfe0bf9a12a8338e797f4b',
};
const reviewedCases = [
  [exactPaths[0], 'daily sentence rejects stale report dates and delivery fails closed', 4, 8, 'e338c901133000d22ce1fa0e39ac942f0468a2ae27bd2a5a467770f8aa1c7fc5'],
  [exactPaths[1], 'delivery, payload, and Content OS all require the same semantic member revision', 15, 20, '8e9fe3e38b79081a8ffa05a9a41123ac365aa13f1192f3ff66e3c8a4f8e7209c'],
  [exactPaths[2], 'LINE delivery is fail-closed and persists per-subscriber retries', 17, 21, '66473b71e8c38a5a25ffc014a88235a65d68af8f51ac606b4e349657a18a10ba'],
  [exactPaths[2], 'runtime deployment and missing checkpoint schedules are reproducible', 54, 61, 'd70ff3456e06c1df9b2c07e759cab61521caab9ecdc8146b1c88fcb1d3245a87'],
  [exactPaths[2], 'LINE retains verified Production v59 Flex layout and refuses evidence-blocked stock delivery', 11, 17, '7a070ca27bf24a64c51bc3f23982b3c0e0553254a44ce136f6694cbf9178e965'],
  [exactPaths[2], 'report, site payload, and LINE converge on the same immutable decision snapshot', 18, 21, '37dd45515b77b358edd52f2b6df84c3a049326cacbdba00cdcf73cf49e20eff5'],
  [exactPaths[2], 'LINE daily push is paginated, multicast, retry-safe, and subscriber-idempotent', 12, 14, '10a90f833a01efdab92f9a1a34962acc7a6e70b084fe3ae979cf2e6f60367d2c'],
];
const bodies = bytes => {
  const file = ts.createSourceFile('test.mjs', bytes.toString(), ts.ScriptTarget.Latest, true);
  return new Map(file.statements.flatMap(node => {
    const call = node.expression;
    return call && ts.isCallExpression(call) && call.expression.getText(file) === 'test'
      ? [[call.arguments[0].text, node.getText(file)]] : [];
  }));
};
const replaceExact = (bytes, before, after) => {
  assert.ok(bytes.toString().includes(before), 'mutation prerequisite: ' + before);
  return bytes.toString().replace(before, after);
};
const sourceMutation = (path, mutate = bytes => bytes.toString() + '\n// unreviewed in-memory mutation\n') => {
  const before = readSource(path), after = Buffer.from(mutate(before));
  assert.notEqual(hash(after), hash(before), 'mutation must change real source bytes');
  return requested => requested === path ? after : readSource(requested);
};
const negative = (name, mutate, expected) => test(name, () => {
  assert.doesNotThrow(() => verify(), 'clean complete sixth baseline must pass before each negative');
  const input = { registry: structuredClone(registry), artifactBytes: Buffer.from(artifact), readSource,
    fifthArtifactBytes: Buffer.from(fifthArtifact) };
  mutate(input);
  assert.throws(() => verify(input.registry, input.artifactBytes, input.readSource, input.fifthArtifactBytes), expected);
});

test('sixth independent pins authorize exactly eight test deltas and no runtime declarations', () => {
  const result = verify(), section = sixth(registry), parsed = JSON.parse(artifact);
  assert.equal(hash(readSource(GUARD_PATH)), guardHash);
  assert.equal(hash(artifact), artifactHash);
  assert.equal(hash(jsonBytes(section)), sectionHash);
  assert.equal(hash(parsed.source_diff.patch_lines.join('\n')), patchHash);
  assert.equal(hash(rawRegistry), '8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737');
  assert.deepEqual(section.files.map(row => row.path).sort(), [...exactPaths].sort());
  assert.equal(section.files.length, 8);
  assert.deepEqual(section.declarations, []);
  assert.deepEqual(section.new_candidates, []);
  assert.equal(section.test_only_authorized, true);
  for (const field of ['production_operations_authorized', 'runtime_source_changes_authorized', 'sql_authoring_authorized',
    'sql_execution_authorized', 'merge_authorized', 'automatic_stability_day']) assert.equal(section[field], false);
  assert.equal(section.fresh_validation_required, true);
  for (const row of section.files) {
    assert.equal(hash(readSource(row.path)), row.candidate_hash);
    assert.equal(hash(result.fifthReadSource(row.path)), row.original_hash, 'exact Fifth preimage: ' + row.path);
  }
  assert.equal(result.newCandidatePaths.length, 30);
  assert.equal(new Set(result.newCandidatePaths).size, 30);
  assert.equal(readConsolidationTestWiringIntegrity(registry).fileHash(registry.files[0]), result.fileHash(registry.files[0]));
});

test('sixth reconstructs exact raw Fifth bytes and runs all unchanged predecessor verifiers', () => {
  const result = verify();
  for (const [path, digest] of Object.entries(previousAnchors)) assert.equal(hash(readSource(path)), digest, path);
  assert.equal(hash(result.fifthReadSource(REGISTRY_PATH)), 'e5f0c29c7b371a0d9ec36bf63f9bb4f2b384218a277dc239cd4ba50b1362ff5d');
  assert.equal(hash(jsonBytes(result.fifthRegistry)), '8df45d8b4d7f367f015313282a5c6272003ca5eeee0b8fcde8309283356585ee');
  assert.deepEqual(JSON.parse(result.fifthReadSource(REGISTRY_PATH)), result.fifthRegistry);
  assert.doesNotThrow(() => resolveConsolidationDeliveryIntegrity(result.fifthRegistry, fifthArtifact, result.fifthReadSource));
  assert.doesNotThrow(() => resolveConsolidationIntegrity(result.fourthRegistry, readSource(FOURTH_ARTIFACT_PATH), result.fourthReadSource));
  assert.doesNotThrow(() => resolveSubscriberProjectionIntegrity(result.predecessorRegistry, readSource(FIRST_ARTIFACT_PATH), result.predecessorReadSource));
});

test('sixth preserves all original 70, 41 and 66 assertion bodies and whole prior test preimages', () => {
  const result = verify();
  for (const [path, digest] of Object.entries(assertionBodyPins)) {
    for (const bytes of [readSource(path), result.fifthReadSource(path)]) {
      const source = bytes.toString(), start = source.indexOf('const hash =');
      assert.ok(start > 0, 'only predecessor/header wiring precedes the fixed assertion body');
      assert.equal(hash(source.slice(start)), digest, path);
    }
  }
  assert.equal(hash(result.fifthReadSource('tests/consolidationDeliveryIntegrity.test.mjs')),
    'a150cc75f4e4581823299106f2b07164c493cbd415b84bf2189d585fed1a69fd');
  assert.equal(hash(result.fourthReadSource('tests/consolidationIntegrity.test.mjs')),
    '968e50b57da286924b4658d85b26802cc27b7fa59ca9e43d2fa1c2225708e13b');
  for (const path of exactPaths.slice(3)) {
    assert.deepEqual([...bodies(readSource(path))], [...bodies(result.fifthReadSource(path))],
      'every original test body is preserved in the five header-only files: ' + path);
  }
});

test('exactly seven independently reviewed cases grow from 131 to 162 assertions while 81 bodies remain identical', () => {
  const result = verify();
  let changed = 0, unchanged = 0, originalAssertions = 0, candidateAssertions = 0;
  for (const path of exactPaths.slice(0, 3)) {
    const before = bodies(result.fifthReadSource(path)), after = bodies(readSource(path));
    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [name, oldBody] of before) {
      const row = reviewedCases.find(item => item[0] === path && item[1] === name), current = after.get(name);
      if (!row) { assert.equal(current, oldBody, 'unreviewed case is byte-identical: ' + name); unchanged++; continue; }
      assert.notEqual(current, oldBody);
      assert.equal(hash(current), row[4], 'independent exact reviewed case bytes: ' + name);
      const oldCount = (oldBody.match(/assert\./g) || []).length, newCount = (current.match(/assert\./g) || []).length;
      assert.equal(oldCount, row[2]); assert.equal(newCount, row[3]); assert.ok(newCount >= oldCount);
      originalAssertions += oldCount; candidateAssertions += newCount; changed++;
    }
  }
  assert.equal(changed, 7); assert.equal(unchanged, 81);
  assert.equal(originalAssertions, 131); assert.equal(candidateAssertions, 162);
});

test('sixth changes no runtime file or declaration authority inherited from Fifth', () => {
  const result = verify();
  const fifth = resolveConsolidationDeliveryIntegrity(result.fifthRegistry, fifthArtifact, result.fifthReadSource);
  for (const row of registry.files) if (!exactPaths.includes(row.path)) assert.equal(result.fileHash(row), fifth.fileHash(row), row.path);
  assert.deepEqual(result.newCandidatePaths, fifth.newCandidatePaths);
  for (const row of manifest.protected_declarations) assert.equal(result.declarationHash(row), fifth.declarationHash(row), row.path + ':' + row.name);
  for (const row of JSON.parse(fifthArtifact).files.filter(row => !row.path.startsWith('tests/'))) {
    assert.equal(hash(readSource(row.path)), row.candidate_hash, 'runtime remains exactly Fifth: ' + row.path);
    assert.deepEqual(readSource(row.path), result.fifthReadSource(row.path));
  }
});

negative('sixth cannot be omitted', input => { delete input.registry.core_delivery_test_wiring_registration; }, /explicit sixth test-wiring registration is required/);
negative('sixth cannot change original Production file hashes', input => { input.registry.files[0].baseline_sha256 = '0'.repeat(64); }, /complete fifth object and original Production pins remain unchanged/);
negative('sixth cannot change original Production declaration hashes', input => { input.registry.modified_declarations[0].production_sha256 = '0'.repeat(64); }, /complete fifth object and original Production pins remain unchanged/);
negative('sixth cannot rewrite approval history', input => { input.registry.integrity_approval_history[0].approval_source = 'UNREVIEWED'; }, /complete fifth object and original Production pins remain unchanged/);
for (const key of ['core_market_delivery_projection_registration', 'core_pipeline_consolidation_registration', 'subscriber_public_release_assertion_registration']) {
  negative('sixth cannot rewrite previous registration: ' + key, input => { input.registry[key].approval_id = 'UNREVIEWED'; }, /complete fifth object and original Production pins remain unchanged/);
}
negative('sixth cannot change exact approval identity', input => { sixth(input.registry).approval_id = 'UNREVIEWED'; }, /sixth exact approval identity/);
negative('sixth cannot replace the raw Fifth predecessor pin', input => { sixth(input.registry).previous_complete_registry_sha256 = '0'.repeat(64); }, /sixth immutable fifth raw registry anchor/);
negative('sixth cannot change predecessor identity', input => { sixth(input.registry).previous_registration_id = 'UNREVIEWED'; }, /sixth exact predecessor identity/);
negative('sixth cannot move to newest Git HEAD', input => { sixth(input.registry).candidate_base_git_sha = '0'.repeat(40); }, /sixth exact Git base/);
negative('sixth must stay explicitly test-only', input => { sixth(input.registry).test_only_authorized = false; }, /sixth is only reviewed test compatibility/);
for (const field of ['production_operations_authorized', 'runtime_source_changes_authorized', 'sql_authoring_authorized', 'sql_execution_authorized', 'merge_authorized', 'automatic_stability_day']) {
  negative('sixth cannot authorize ' + field, input => { sixth(input.registry)[field] = true; }, new RegExp('sixth forbidden authority: ' + field));
}
negative('sixth cannot waive fresh validation', input => { sixth(input.registry).fresh_validation_required = false; }, /sixth cannot waive fresh validation/);
negative('sixth cannot duplicate an approved test path', input => { sixth(input.registry).files.push(structuredClone(sixth(input.registry).files[0])); }, /sixth exact eight test paths/);
negative('sixth cannot omit an approved test path', input => { sixth(input.registry).files.pop(); }, /sixth exact eight test paths/);
for (const path of ['tests/unreviewed.test.mjs', PUBLICATION_PATH, 'supabase/migrations/unreviewed.sql',
  'supabase/functions/.env', 'tests/publicRelease.test 2.mjs', 'docs/research/unreviewed.md', '../outside.test.mjs']) {
  negative('sixth cannot admit excluded scope: ' + path, input => { sixth(input.registry).files[0].path = path; }, /sixth exact eight test paths/);
}
negative('sixth cannot add any Auth declaration override', input => { sixth(input.registry).declarations.push({ path: ORCHESTRATOR_PATH, name: 'authorizeRequest' }); }, /sixth cannot override protected declarations/);
negative('sixth cannot add a runtime candidate', input => { sixth(input.registry).new_candidates.push({ path: PUBLICATION_PATH }); }, /sixth cannot admit new runtime candidates/);
for (const field of ['candidate_hash', 'original_hash', 'production_hash']) {
  negative('sixth test ' + field + ' cannot self-authorize', input => { sixth(input.registry).files[0][field] = '0'.repeat(64); }, /sixth independently fixed complete section/);
}
negative('sixth cannot change its artifact reference', input => { sixth(input.registry).source_diff_reference.path = 'docs/operations/evidence/unreviewed.json'; }, /sixth fixed artifact reference/);
negative('sixth artifact bytes cannot self-authorize', input => { input.artifactBytes = Buffer.concat([artifact, Buffer.from('\n')]); }, /sixth independently fixed artifact bytes/);
negative('sixth test source, reverse patch and current hash cannot jointly grant an assertion waiver', input => {
  const value = JSON.parse(artifact), section = sixth(input.registry), path = exactPaths[0];
  input.readSource = sourceMutation(path);
  const digest = hash(input.readSource(path));
  section.files.find(row => row.path === path).candidate_hash = digest;
  value.files.find(row => row.path === path).candidate_hash = digest;
  value.source_diff.patch_lines.push('+// unreviewed in-memory mutation');
  value.source_diff.sha256 = hash(value.source_diff.patch_lines.join('\n'));
  input.artifactBytes = jsonBytes(value);
  section.source_diff_reference.sha256 = hash(input.artifactBytes);
  section.source_diff_reference.patch_sha256 = value.source_diff.sha256;
}, /sixth fixed artifact reference/);
negative('sixth bad CORE source cannot gain authority through artifact and newest hashes', input => {
  const value = JSON.parse(artifact), section = sixth(input.registry);
  input.readSource = sourceMutation(PUBLICATION_PATH, bytes => replaceExact(bytes, "receipt.semantic_status === 'PASSED'", 'true'));
  const row = { ...section.files[0], path: PUBLICATION_PATH, candidate_hash: hash(input.readSource(PUBLICATION_PATH)) };
  section.files.push(row); value.files.push(row);
  value.source_diff.patch_lines.push('diff --git a/' + PUBLICATION_PATH + ' b/' + PUBLICATION_PATH);
  value.source_diff.sha256 = hash(value.source_diff.patch_lines.join('\n'));
  input.artifactBytes = jsonBytes(value); section.source_diff_reference.sha256 = hash(input.artifactBytes);
}, /sixth exact eight test paths/);

for (const path of exactPaths) negative('sixth rejects current test drift: ' + path, input => { input.readSource = sourceMutation(path); }, /sixth current test source drift:/);
for (const [path, name] of reviewedCases) {
  negative('sixth rejects weakening an approved case after review: ' + name, input => {
    const original = bodies(readSource(path)).get(name);
    assert.ok(original.includes('assert.'));
    input.readSource = sourceMutation(path, bytes => replaceExact(bytes, original, original.replace('assert.', 'UNREVIEWED_ASSERT.')));
  }, /sixth current test source drift:/);
}
negative('sixth rejects changing an old case outside the seven approved cases', input => {
  const path = exactPaths[0], [name, original] = [...bodies(readSource(path))].find(([name]) => !reviewedCases.some(row => row[0] === path && row[1] === name));
  assert.ok(name && original.includes('assert.'));
  input.readSource = sourceMutation(path, bytes => replaceExact(bytes, original, original.replace('assert.', 'UNREVIEWED_ASSERT.')));
}, /sixth current test source drift:/);
for (const path of Object.keys(assertionBodyPins)) {
  negative('sixth rejects rewriting the old assertion/helper body: ' + path, input => {
    input.readSource = sourceMutation(path, bytes => replaceExact(bytes, 'const hash =', 'const UNREVIEWED_hash ='));
  }, /sixth current test source drift:/);
}
for (const [name, before, after] of [
  ['durable run status', "run.status === 'SUCCEEDED'", 'true'],
  ['semantic receipt', "receipt.semantic_status === 'PASSED'", 'true'],
  ['receipt report identity', 'receipt.report_id === report.id', 'true'],
  ['receipt member identity', 'receipt.member_content_revision_id === member?.id', 'true'],
  ['receipt revision', 'receipt.decision_snapshot_id === revision', 'true'],
  ['receipt ordering', 'generatedTime <= completedAt', 'true'],
  ['editorial threshold', 'snapshot.content_score < 90', 'snapshot.content_score < 0'],
  ['evidence completeness', 'snapshot.coverage_score === 100', 'true'],
  ['frozen source ledger', 'JSON.stringify(tupleKeys(snapshot.source_refs)) === JSON.stringify(tupleKeys(expectedSources))', 'true'],
  ['committed mode suppression', "snapshot?.decision_mode !== 'recommendations'", 'false'],
  ['same-symbol suppression', '!committedSymbolsAdmitted', 'false'],
  ['raw stock fallback', 'recommendations: committedRecommendations', 'recommendations: ai.today_beneficiary_stocks_v10'],
]) negative('sixth cannot authorize runtime weakening: ' + name, input => {
  input.readSource = sourceMutation(PUBLICATION_PATH, bytes => replaceExact(bytes, before, after));
}, /fifth current source drift: supabase\/functions\/_shared\/market-publication-contract.ts/);
for (const path of ['src/lib/subscriberReportContract.ts', 'supabase/functions/line-daily-push/index.ts', ORCHESTRATOR_PATH,
  'supabase/functions/ma-ops-health-check/index.ts', 'tests/consolidationPublicationConsumers.test.mjs']) {
  negative('sixth leaves Fifth source hashes enforced: ' + path, input => { input.readSource = sourceMutation(path); }, /fifth current source drift:/);
}
negative('sixth cannot change Auth code inside an otherwise approved runtime file', input => {
  input.readSource = sourceMutation(ORCHESTRATOR_PATH, bytes => replaceExact(bytes, 'authorizeRequest', 'authorizeRequest_UNREVIEWED'));
}, /fifth current source drift:/);
negative('sixth cannot change original Evidence policy in a Fourth source', input => {
  input.readSource = sourceMutation('supabase/functions/generate-daily-report-v7/index.ts', bytes => replaceExact(bytes, 'OPENAI_EVIDENCE_GUARDRAILS', 'OPENAI_EVIDENCE_GUARDRAILS_UNREVIEWED'));
}, /fourth current source drift:/);
negative('sixth cannot skip a missing Fifth sample test', input => {
  input.readSource = path => { if (path === 'tests/consolidationLineProjection.test.mjs') throw new Error('SYNTHETIC_MISSING_FIFTH_SOURCE'); return readSource(path); };
}, /SYNTHETIC_MISSING_FIFTH_SOURCE/);
for (const path of Object.keys(previousAnchors)) {
  negative('sixth cannot rewrite immutable predecessor bytes: ' + path, input => { input.readSource = sourceMutation(path); }, /sixth immutable previous guard\/artifact:/);
}
negative('sixth fifth-artifact argument must match the exact old bytes', input => { input.fifthArtifactBytes = Buffer.concat([fifthArtifact, Buffer.from('\n')]); }, /sixth immutable fifth artifact bytes/);
negative('sixth still invokes the original first artifact verifier', input => { input.readSource = sourceMutation(FIRST_ARTIFACT_PATH); }, /reviewed artifact cannot self-authorize new content/);
negative('sixth parsed-equal raw Fifth whitespace cannot silently change', input => {
  input.readSource = sourceMutation(REGISTRY_PATH, bytes => replaceExact(bytes, '\n  "baseline_commit"', '\n   "baseline_commit"'));
}, /sixth exact raw fifth registry preimage/);
negative('sixth raw registry cannot acquire unregistered trailing bytes', input => { input.readSource = sourceMutation(REGISTRY_PATH, bytes => bytes.toString() + '\n'); }, /sixth exact append-only registry bytes/);
test('independent sixth guard pin rejects disabling source and artifact checks', () => {
  assert.doesNotThrow(() => verify());
  const bytes = readSource(GUARD_PATH);
  assert.equal(hash(bytes), guardHash);
  for (const before of [
    "assert.equal(hash(artifactBytes), FIXED.artifact, 'sixth independently fixed artifact bytes');",
    "assert.equal(hash(source(row.path)), row.candidate_hash, 'sixth current test source drift: ' + row.path);",
  ]) assert.throws(() => assert.equal(hash(replaceExact(bytes, before, '// unreviewed assertion waiver')), guardHash));
});
