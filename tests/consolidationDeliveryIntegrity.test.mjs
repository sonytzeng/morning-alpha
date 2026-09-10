import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  CONSOLIDATION_DELIVERY_ARTIFACT_PATH, resolveConsolidationDeliveryIntegrity,
} from './helpers/consolidationDeliveryIntegrity.mjs';
import { readConsolidationPublicExportIntegrity as readConsolidationTestWiringIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';
import { resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';
import { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';

// Independent pins captured after source review. Mutations below are in memory;
// no registered source, original assertion, SQL, secrets or Production I/O changes.
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const FOURTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';
const FIRST_ARTIFACT_PATH = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';
const GUARD_PATH = 'tests/helpers/consolidationDeliveryIntegrity.mjs';
const PUBLICATION_PATH = 'supabase/functions/_shared/market-publication-contract.ts';
const ORCHESTRATOR_PATH = 'supabase/functions/daily-delivery-orchestrator/index.ts';
const sixth = readConsolidationTestWiringIntegrity(JSON.parse(readFileSync(REGISTRY_PATH)));
const readSource = sixth.fifthReadSource;
const rawRegistry = readSource(REGISTRY_PATH);
const registry = JSON.parse(rawRegistry);
const artifact = readSource(CONSOLIDATION_DELIVERY_ARTIFACT_PATH);
const fourthArtifact = readSource(FOURTH_ARTIFACT_PATH);
const manifest = JSON.parse(readSource('docs/operations/core-stability-source-manifest-20260907.json'));
const readConsolidationDeliveryIntegrity = value => resolveConsolidationDeliveryIntegrity(value, artifact, readSource, fourthArtifact);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fifth = value => value.core_market_delivery_projection_registration;
const verify = (value = registry, bytes = artifact, source = readSource, prior = fourthArtifact) =>
  resolveConsolidationDeliveryIntegrity(value, bytes, source, prior);
const fixedGuardHash = '3770a8e3305933f5f42add561ac5b8cbd98273c036c15a49c6c44338c0a2e23c';
const fixedArtifactHash = '861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056';
const sectionHash = '36f073ab70754343b39b0c02edfe00e777c116d147708f7a87725a7af9eb0475';
const patchHash = '12298ea146d188910154593866b80422520efd3df3482c372d00274250831eda';
const exactPaths = {
  files: ['src/lib/subscriberReportContract.ts', PUBLICATION_PATH, 'supabase/functions/line-daily-push/index.ts',
    ORCHESTRATOR_PATH, 'supabase/functions/ma-ops-health-check/index.ts', 'tests/incidentHealthContract.test.mjs',
    'tests/marketPublicationDelivery.test.mjs', 'tests/coreProductionPreservation.test.mjs', 'tests/productContract.test.mjs',
    'tests/subscriberProjectionIntegrity.test.mjs', 'tests/consolidationIntegrity.test.mjs'],
  new_candidates: ['tests/consolidationLineProjection.test.mjs', 'tests/consolidationPublicationConsumers.test.mjs',
    'tests/consolidationRecommendationProjection.test.mjs', 'tests/browser/consolidationSubscriberMatrix.e2e.mjs'],
};
const textOfDeclaration = (path, name, source = readSource) => {
  const file = ts.createSourceFile(path, source(path).toString(), ts.ScriptTarget.Latest, true);
  const node = file.statements.find(item => item.name?.getText(file) === name
    || item.declarationList?.declarations.map(value => value.name.getText(file)).join(',') === name);
  assert.ok(node, `test prerequisite: declaration exists: ${path}:${name}`);
  return node.getText(file);
};
const sourceMutation = (path, mutate = bytes => bytes.toString() + '\n// unreviewed in-memory mutation\n') => {
  const before = readSource(path), after = Buffer.from(mutate(before));
  assert.notEqual(hash(after), hash(before), 'test must change actual bytes');
  return requested => requested === path ? after : readSource(requested);
};
const replaceExact = (bytes, before, after) => {
  assert.ok(bytes.toString().includes(before), `mutation prerequisite: ${before}`);
  return bytes.toString().replace(before, after);
};
const negative = (name, mutate, expected) => test(name, () => {
  assert.doesNotThrow(() => verify(), 'clean complete fifth baseline must pass before each negative');
  const input = { registry: structuredClone(registry), artifactBytes: Buffer.from(artifact), readSource,
    fourthArtifactBytes: Buffer.from(fourthArtifact) };
  mutate(input);
  assert.throws(() => verify(input.registry, input.artifactBytes, input.readSource, input.fourthArtifactBytes), expected);
});

test('fifth pins only the reviewed 11 deltas, four new sources and two declaration overrides', () => {
  const result = verify(), section = fifth(registry), parsed = JSON.parse(artifact);
  assert.equal(hash(readSource(GUARD_PATH)), fixedGuardHash);
  assert.equal(hash(artifact), fixedArtifactHash);
  assert.equal(hash(jsonBytes(section)), sectionHash);
  assert.equal(hash(parsed.source_diff.patch_lines.join('\n')), patchHash);
  assert.equal(hash(rawRegistry), 'e5f0c29c7b371a0d9ec36bf63f9bb4f2b384218a277dc239cd4ba50b1362ff5d');
  for (const group of Object.keys(exactPaths)) assert.deepEqual(section[group].map(row => row.path).sort(), [...exactPaths[group]].sort());
  assert.equal(section.files.length, 11); assert.equal(section.new_candidates.length, 4);
  assert.deepEqual(section.declarations.map(row => row.name).sort(), ['DeliveryState', 'loadDeliveryState']);
  assert.ok(section.declarations.every(row => row.path === ORCHESTRATOR_PATH));
  assert.equal(result.newCandidatePaths.length, 30);
  assert.equal(new Set(result.newCandidatePaths).size, 30);
  for (const row of section.files) {
    assert.equal(hash(readSource(row.path)), row.candidate_hash);
    assert.equal(hash(result.fourthReadSource(row.path)), row.original_hash, 'exact fourth preimage: ' + row.path);
  }
  for (const row of section.new_candidates) {
    assert.equal(row.original_hash, null);
    assert.equal(hash(readSource(row.path)), row.candidate_hash);
    assert.throws(() => result.fourthReadSource(row.path), /new fifth candidate did not exist in fourth predecessor/);
  }
  assert.equal(readConsolidationDeliveryIntegrity(registry).fileHash(registry.files[0]), result.fileHash(registry.files[0]));
});

test('raw predecessor and parsed predecessor stay independently fixed and execute original four guards', () => {
  const result = verify(), section = fifth(registry);
  const suffix = ',\n  "core_market_delivery_projection_registration": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(rawRegistry.toString().endsWith(suffix));
  const previousRaw = rawRegistry.toString().slice(0, -suffix.length) + '}\n';
  assert.equal(hash(previousRaw), '0c3e060ed49f6812db13839409fb48b0642deb11df2f391ff58d48f7ca5a4ae0');
  assert.equal(hash(jsonBytes(result.fourthRegistry)), '11a4149d0d24b80f9a9fe31364b369c90b09df72feeb971792cbfbd27476610a');
  assert.deepEqual(JSON.parse(previousRaw), result.fourthRegistry);
  assert.equal(hash(jsonBytes(result.predecessorRegistry)), '7597edbd731636882e442faecd3bc4f8dd6f0701e07dd1ed7ddfe32e43b7505b');
  assert.equal(hash(fourthArtifact), 'e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315');
  assert.equal(hash(readSource('tests/helpers/consolidationIntegrity.mjs')), '0994de2d3326de77b1f9c3aa2bdae601758c3dc30fbcbef9197a69b6a7bdbe1a');
  assert.equal(hash(readSource('tests/helpers/subscriberProjectionIntegrity.mjs')), '2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0');
  assert.doesNotThrow(() => resolveConsolidationIntegrity(result.fourthRegistry, fourthArtifact, result.fourthReadSource));
  assert.doesNotThrow(() => resolveSubscriberProjectionIntegrity(result.predecessorRegistry, readSource(FIRST_ARTIFACT_PATH), result.predecessorReadSource));
});

test('all original 70 and 41 assertion/helper bodies remain byte-identical after header wiring', () => {
  const result = verify();
  const expected = {
    'tests/subscriberProjectionIntegrity.test.mjs': 'a0e57cb4abcbacf66cf71b3785d426a6ea51f541e69b98021f814b8e9fcca2d2',
    'tests/consolidationIntegrity.test.mjs': 'a336572755e95da10e00add17ac4d62c0588cb9e615fc56f32c44813fb8f3f9a',
  };
  for (const [path, digest] of Object.entries(expected)) {
    for (const bytes of [readSource(path), result.fourthReadSource(path)]) {
      const source = bytes.toString(), start = source.indexOf('const hash =');
      assert.ok(start > 0, 'only import/predecessor wiring precedes the immutable body');
      assert.equal(hash(source.slice(start)), digest, path);
    }
  }
  assert.equal(hash(result.fourthReadSource('tests/consolidationIntegrity.test.mjs')),
    '968e50b57da286924b4658d85b26802cc27b7fa59ca9e43d2fa1c2225708e13b');
});

test('two exact fifth overrides preserve Production hashes and the fourth closing receipt override', () => {
  const result = verify(), section = fifth(registry);
  const expected = { DeliveryState: '0756ce17b86605f0d2ab419e81bd8525d9c1cf437a134d93400fdbd948fd11fc',
    loadDeliveryState: '435a3c8c7335820330e076fa5345da48f44344083b39bd35288bd8c3d390cd63' };
  for (const [name, digest] of Object.entries(expected)) {
    const row = manifest.protected_declarations.find(value => value.path === ORCHESTRATOR_PATH && value.name === name);
    assert.ok(row);
    assert.equal(result.declarationHash(row), digest);
    assert.equal(hash(textOfDeclaration(row.path, name)), digest);
    assert.equal(section.declarations.find(value => value.name === name).production_hash, row.production_sha256);
  }
  const checkpoint = manifest.protected_declarations.find(row => row.path === ORCHESTRATOR_PATH && row.name === 'checkpointResultOk');
  assert.equal(result.declarationHash(checkpoint), '9dd6e260883fcc8b9b72136dfa89db9c4670a4dd6ac7b3b28626cc7535464bcc');
  assert.equal(section.declarations.some(row => row.name === 'checkpointResultOk'), false);
  const auth = manifest.protected_declarations.find(row => row.path === ORCHESTRATOR_PATH && row.name === 'authorizeRequest');
  assert.equal(result.declarationHash(auth), auth.production_sha256);
  assert.equal(hash(textOfDeclaration(auth.path, auth.name)), auth.production_sha256);
});

negative('fifth cannot be omitted', input => { delete input.registry.core_market_delivery_projection_registration; }, /explicit fifth delivery projection registration is required/);
negative('fifth cannot change original Production file hashes', input => { input.registry.files[0].baseline_sha256 = '0'.repeat(64); }, /complete fourth registry and original Production pins remain unchanged/);
negative('fifth cannot change original Production declaration hashes', input => { input.registry.modified_declarations[0].production_sha256 = '0'.repeat(64); }, /complete fourth registry and original Production pins remain unchanged/);
negative('fifth cannot rewrite earlier approval provenance', input => { input.registry.integrity_approval_history[0].approval_source = 'unreviewed'; }, /complete fourth registry and original Production pins remain unchanged/);
negative('fifth cannot rewrite fourth section hashes', input => { input.registry.core_pipeline_consolidation_registration.files[0].candidate_hash = '0'.repeat(64); }, /complete fourth registry and original Production pins remain unchanged/);
negative('fifth cannot rewrite third registration', input => { input.registry.subscriber_public_release_assertion_registration.approval_id = 'UNREVIEWED'; }, /complete fourth registry and original Production pins remain unchanged/);
negative('fifth exact approval identity cannot change', input => { fifth(input.registry).approval_id = 'UNREVIEWED'; }, /fifth exact approval identity/);
negative('fifth raw fourth predecessor anchor cannot change', input => { fifth(input.registry).previous_complete_registry_sha256 = '0'.repeat(64); }, /fifth immutable fourth registry anchor/);
negative('fifth predecessor identity cannot change', input => { fifth(input.registry).previous_registration_id = 'UNREVIEWED'; }, /fifth exact predecessor identity/);
negative('fifth Git base cannot become latest HEAD', input => { fifth(input.registry).candidate_base_git_sha = '0'.repeat(40); }, /fifth exact Git base/);
for (const field of ['production_operations_authorized', 'sql_authoring_authorized', 'sql_execution_authorized', 'merge_authorized', 'automatic_stability_day']) {
  negative(`fifth cannot authorize ${field}`, input => { fifth(input.registry)[field] = true; }, new RegExp('fifth forbidden authority: ' + field));
}
negative('fifth cannot waive fresh validation', input => { fifth(input.registry).fresh_validation_required = false; }, /fifth cannot waive fresh validation/);
for (const group of ['files', 'new_candidates']) {
  negative(`fifth ${group} rejects unknown paths`, input => { fifth(input.registry)[group].push({ ...fifth(input.registry)[group][0], path: 'src/unreviewed.ts' }); }, new RegExp('fifth exact allowlist: ' + group));
  negative(`fifth ${group} rejects duplicate paths`, input => { fifth(input.registry)[group].push(structuredClone(fifth(input.registry)[group][0])); }, new RegExp('fifth exact allowlist: ' + group));
}
for (const path of ['supabase/migrations/unreviewed.sql', 'supabase/functions/.env', 'tests/publicRelease.test 2.mjs', 'docs/research/unreviewed.md', '../outside.ts']) {
  negative(`fifth cannot admit excluded scope: ${path}`, input => { fifth(input.registry).new_candidates[0].path = path; }, /fifth exact allowlist: new_candidates/);
}
negative('fifth cannot add an Auth declaration override', input => { fifth(input.registry).declarations.push({ ...fifth(input.registry).declarations[0], name: 'authorizeRequest' }); }, /fifth exact declaration allowlist/);
negative('fifth cannot duplicate a declaration override', input => { fifth(input.registry).declarations.push(structuredClone(fifth(input.registry).declarations[0])); }, /fifth exact declaration allowlist/);
for (const field of ['production_hash', 'original_hash', 'candidate_hash']) {
  negative(`fifth declaration ${field} cannot self-authorize`, input => { fifth(input.registry).declarations[0][field] = '0'.repeat(64); }, new RegExp('fifth fixed declaration ' + field));
}
negative('fifth cannot use a newest-source hash waiver', input => { fifth(input.registry).files[0].candidate_hash = hash('newest unreviewed bytes'); }, /fifth independently fixed complete section/);
negative('fifth artifact bytes cannot self-authorize', input => { input.artifactBytes = Buffer.concat([artifact, Buffer.from('\n')]); }, /fifth independently fixed artifact bytes/);
negative('fifth bad CORE source, artifact patch and mutable hashes cannot jointly self-authorize', input => {
  const value = JSON.parse(artifact), section = fifth(input.registry);
  input.readSource = sourceMutation(PUBLICATION_PATH, bytes => replaceExact(bytes, "receipt.semantic_status === 'PASSED'", 'true'));
  const digest = hash(input.readSource(PUBLICATION_PATH));
  section.files.find(row => row.path === PUBLICATION_PATH).candidate_hash = digest;
  value.files.find(row => row.path === PUBLICATION_PATH).candidate_hash = digest;
  value.source_diff.patch_lines = value.source_diff.patch_lines.map(line => line.replace("receipt.semantic_status === 'PASSED'", 'true'));
  value.source_diff.sha256 = hash(value.source_diff.patch_lines.join('\n'));
  input.artifactBytes = jsonBytes(value);
  section.source_diff_reference.sha256 = hash(input.artifactBytes);
  section.source_diff_reference.patch_sha256 = value.source_diff.sha256;
}, /fifth fixed artifact reference/);

for (const [name, before, after] of [
  ['durable receipt', "run.status === 'SUCCEEDED'", 'true'],
  ['committed semantic', "receipt.semantic_status === 'PASSED'", 'true'],
  ['receipt report identity', 'receipt.report_id === report.id', 'true'],
  ['receipt member identity', 'receipt.member_content_revision_id === member?.id', 'true'],
  ['receipt revision', 'receipt.decision_snapshot_id === revision', 'true'],
  ['receipt time ordering', 'generatedTime <= completedAt', 'true'],
  ['editorial threshold', 'snapshot.content_score < 90', 'snapshot.content_score < 0'],
  ['evidence completeness', 'snapshot.coverage_score === 100', 'true'],
  ['frozen ledger source proof', 'JSON.stringify(tupleKeys(snapshot.source_refs)) === JSON.stringify(tupleKeys(expectedSources))', 'true'],
  ['committed mode suppression', "snapshot?.decision_mode !== 'recommendations'", 'false'],
  ['same-symbol suppression', '!committedSymbolsAdmitted', 'false'],
  ['raw stock fallback', 'recommendations: committedRecommendations', 'recommendations: ai.today_beneficiary_stocks_v10'],
]) negative(`fifth rejects source weakening: ${name}`, input => {
  input.readSource = sourceMutation(PUBLICATION_PATH, bytes => replaceExact(bytes, before, after));
}, /fifth current source drift: supabase\/functions\/_shared\/market-publication-contract.ts/);

for (const path of ['src/lib/subscriberReportContract.ts', 'supabase/functions/line-daily-push/index.ts', ORCHESTRATOR_PATH,
  'supabase/functions/ma-ops-health-check/index.ts', 'tests/consolidationPublicationConsumers.test.mjs']) {
  negative(`fifth current registered source cannot drift: ${path}`, input => { input.readSource = sourceMutation(path); }, /fifth current source drift:/);
}
negative('fifth missing new source cannot be skipped as legacy', input => {
  input.readSource = path => { if (path === 'tests/consolidationLineProjection.test.mjs') throw new Error('SYNTHETIC_MISSING_FIFTH_SOURCE'); return readSource(path); };
}, /SYNTHETIC_MISSING_FIFTH_SOURCE/);
negative('fifth cannot rewrite unchanged Auth inside an approved consumer file', input => {
  const declaration = textOfDeclaration(ORCHESTRATOR_PATH, 'authorizeRequest');
  input.readSource = sourceMutation(ORCHESTRATOR_PATH, bytes => replaceExact(bytes, declaration, declaration.replace('authorizeRequest', 'authorizeRequest_UNREVIEWED')));
}, /fifth current source drift:/);
negative('fifth cannot modify Evidence policy in an untouched fourth source', input => {
  const path = 'supabase/functions/generate-daily-report-v7/index.ts', declaration = textOfDeclaration(path, 'OPENAI_EVIDENCE_GUARDRAILS');
  input.readSource = sourceMutation(path, bytes => replaceExact(bytes, declaration, declaration.replace('OPENAI_EVIDENCE_GUARDRAILS', 'OPENAI_EVIDENCE_GUARDRAILS_UNREVIEWED')));
}, /fourth current source drift:/);
for (const path of ['tests/helpers/consolidationIntegrity.mjs', FOURTH_ARTIFACT_PATH,
  'tests/helpers/subscriberProjectionIntegrity.mjs', 'docs/operations/core-stability-source-manifest-20260907.json']) {
  negative(`fifth preserves immutable predecessor bytes: ${path}`, input => { input.readSource = sourceMutation(path); }, /fifth immutable previous guard\/artifact:/);
}
negative('fourth artifact argument cannot differ from its original immutable bytes', input => { input.fourthArtifactBytes = Buffer.concat([fourthArtifact, Buffer.from('\n')]); }, /fourth artifact bytes remain unchanged/);
negative('first artifact still executes its original predecessor verifier', input => { input.readSource = sourceMutation(FIRST_ARTIFACT_PATH); }, /reviewed artifact cannot self-authorize new content/);
negative('parsed-equal raw predecessor whitespace cannot silently change', input => {
  input.readSource = sourceMutation(REGISTRY_PATH, bytes => replaceExact(bytes, '\n  "baseline_commit"', '\n   "baseline_commit"'));
}, /fifth exact raw fourth registry preimage/);
negative('fifth raw append cannot acquire unregistered trailing bytes', input => { input.readSource = sourceMutation(REGISTRY_PATH, bytes => bytes.toString() + '\n'); }, /fifth exact append-only registry bytes/);

test('independent fifth helper pin rejects changing the verifier to accept newest hashes', () => {
  assert.doesNotThrow(() => verify());
  const bytes = readSource(GUARD_PATH);
  assert.equal(hash(bytes), fixedGuardHash);
  const changed = replaceExact(bytes, "assert.equal(hash(artifactBytes), FIXED.artifact, 'fifth independently fixed artifact bytes');", '// unreviewed artifact waiver');
  assert.throws(() => assert.equal(hash(changed), fixedGuardHash));
});
