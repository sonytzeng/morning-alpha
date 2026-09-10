import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { CONSOLIDATION_ARTIFACT_PATH, resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';
import { readConsolidationPublicExportIntegrity as readConsolidationDeliveryIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';
import { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';

// Tamper simulations are in memory only. Never rewrite registered source,
// historical evidence, Auth, secrets, SQL, or the previous guard to test a failure.
const fifth = readConsolidationDeliveryIntegrity(JSON.parse(readFileSync('docs/operations/core-stability-incident-amendment-20260908.json')));
const registry = fifth.fourthRegistry;
const artifact = readFileSync(CONSOLIDATION_ARTIFACT_PATH);
const firstArtifact = readFileSync('docs/operations/evidence/subscriber-projection-candidate-20260909.json');
const manifest = JSON.parse(readFileSync('docs/operations/core-stability-source-manifest-20260907.json'));
const readSource = fifth.fourthReadSource;
const readConsolidationIntegrity = value => resolveConsolidationIntegrity(value, artifact, readSource, firstArtifact);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fourth = value => value.core_pipeline_consolidation_registration;
const verify = (value = registry, bytes = artifact, source = readSource, first = firstArtifact) =>
  resolveConsolidationIntegrity(value, bytes, source, first);
const declarationText = (path, name) => {
  const file = ts.createSourceFile(path, readSource(path).toString(), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(node => node.name?.getText(file) === name
    || node.declarationList?.declarations.map(item => item.name.getText(file)).join(',') === name);
  assert.ok(declaration, `test prerequisite: declaration exists: ${path}:${name}`);
  return declaration.getText(file);
};
const sourceMutation = (path, mutate = bytes => Buffer.concat([bytes, Buffer.from('\n// unreviewed in-memory change\n')])) => {
  const bytes = readSource(path), changed = Buffer.from(mutate(bytes));
  assert.notEqual(hash(changed), hash(bytes), 'test must actually change source bytes');
  return requested => requested === path ? changed : readSource(requested);
};
const negative = (name, mutate, expected) => test(name, () => {
  // An unrelated stale baseline is not evidence that this mutation is guarded.
  assert.doesNotThrow(() => verify(), 'clean complete fourth baseline must pass first');
  const input = { registry: structuredClone(registry), artifactBytes: Buffer.from(artifact), readSource, firstArtifactBytes: firstArtifact };
  mutate(input);
  assert.throws(() => verify(input.registry, input.artifactBytes, input.readSource, input.firstArtifactBytes), expected);
});

test('fourth exact candidate reconstructs the predecessor and executes the unchanged three-layer verifier', () => {
  const result = verify();
  const { core_pipeline_consolidation_registration: section, ...predecessor } = registry;
  assert.deepEqual(result.predecessorRegistry, predecessor);
  assert.equal(hash(artifact), 'e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315');
  assert.equal(hash(jsonBytes(section)), '01804c4ed0b2f55071bac23bd575a26964c683714fea2262aa4eeeccb0bdafab');
  assert.equal(hash(JSON.parse(artifact).source_diff.patch_lines.join('\n')), '36abc6f3e6a33a1dd142ae68319e33c852098a34939836dc8aa1668123d8bd7d');
  assert.equal(hash(jsonBytes(predecessor)), '7597edbd731636882e442faecd3bc4f8dd6f0701e07dd1ed7ddfe32e43b7505b');
  assert.equal(hash(readSource('tests/helpers/subscriberProjectionIntegrity.mjs')), '2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0');
  assert.doesNotThrow(() => resolveSubscriberProjectionIntegrity(result.predecessorRegistry, firstArtifact, result.predecessorReadSource));
  assert.equal(section.files.length, 23); assert.equal(section.related_candidates.length, 15);
  assert.equal(section.new_candidates.length, 26); assert.equal(section.declarations.length, 4);
  assert.equal(new Set([...section.files, ...section.related_candidates, ...section.new_candidates].map(row => row.path)).size, 64);
  for (const row of [...section.files, ...section.related_candidates]) {
    assert.equal(hash(result.predecessorReadSource(row.path)), row.original_hash, row.path);
    assert.equal(hash(readSource(row.path)), row.candidate_hash, row.path);
  }
  assert.deepEqual([...result.newCandidatePaths].sort(), section.new_candidates.map(row => row.path).sort());
  for (const path of result.newCandidatePaths) {
    assert.doesNotMatch(path, /^supabase\/migrations\/|^docs\/| 2\./);
    assert.throws(() => result.predecessorReadSource(path), /new candidate did not exist in predecessor/);
  }
  assert.equal(readConsolidationIntegrity(registry).fileHash(registry.files[0]), result.fileHash(registry.files[0]));
});

test('checkpointResultOk has only its exact fourth override despite no original incident amendment', () => {
  const result = verify(), path = 'supabase/functions/daily-delivery-orchestrator/index.ts';
  const record = manifest.protected_declarations.find(row => row.path === path && row.name === 'checkpointResultOk');
  assert.ok(record);
  assert.equal(registry.modified_declarations.some(row => row.path === path && row.name === record.name), false);
  assert.equal(record.production_sha256, 'd5aa72c5d0a6785b1bce8886e3bfff495b576099d8fe258e2fe5b244977d1465');
  assert.equal(result.declarationHash(record), '9dd6e260883fcc8b9b72136dfa89db9c4670a4dd6ac7b3b28626cc7535464bcc');
  assert.equal(hash(declarationText(path, record.name)), result.declarationHash(record));
  const auth = manifest.protected_declarations.find(row => row.path === path && row.name === 'authorizeRequest');
  assert.ok(auth);
  assert.equal(result.declarationHash(auth), auth.production_sha256, 'same-file approval is not an Auth declaration waiver');
  assert.equal(hash(declarationText(path, auth.name)), auth.production_sha256);
});

negative('fourth registration cannot be omitted', input => { delete input.registry.core_pipeline_consolidation_registration; }, /explicit fourth consolidation registration is required/);
negative('original Production file hashes stay immutable', input => { input.registry.files[0].baseline_sha256 = '0'.repeat(64); }, /complete third registry and original Production pins remain unchanged/);
negative('original Production declaration hashes stay immutable', input => { input.registry.modified_declarations[0].production_sha256 = '0'.repeat(64); }, /complete third registry and original Production pins remain unchanged/);
negative('historical approval provenance stays immutable', input => { input.registry.integrity_approval_history[0].approval_source = 'unreviewed history'; }, /complete third registry and original Production pins remain unchanged/);
negative('fourth exact predecessor cannot become latest HEAD', input => { fourth(input.registry).candidate_base_git_sha = '0'.repeat(40); }, /fourth exact HEAD base/);
negative('fourth approval identity is fixed', input => { fourth(input.registry).approval_id = 'UNREVIEWED'; }, /fourth exact approval identity/);

for (const group of ['files', 'related_candidates', 'new_candidates']) {
  negative(`fourth ${group} rejects unknown paths`, input => {
    fourth(input.registry)[group].push({ ...fourth(input.registry)[group][0], path: 'src/unreviewed-candidate.ts' });
  }, new RegExp('fourth exact allowlist: ' + group));
  negative(`fourth ${group} rejects duplicate paths`, input => {
    fourth(input.registry)[group].push(structuredClone(fourth(input.registry)[group][0]));
  }, new RegExp('fourth exact allowlist: ' + group));
}
for (const path of ['supabase/migrations/unreviewed.sql', 'tests/publicRelease.test 2.mjs', 'docs/research/unreviewed.md', '../outside.ts']) {
  negative(`fourth cannot admit excluded scope: ${path}`, input => {
    fourth(input.registry).new_candidates[0].path = path;
  }, /fourth exact allowlist: new_candidates/);
}
negative('fourth rejects an unknown Auth declaration override', input => {
  fourth(input.registry).declarations.push({ ...fourth(input.registry).declarations[0],
    path: 'supabase/functions/daily-delivery-orchestrator/index.ts', name: 'authorizeRequest' });
}, /fourth exact declaration allowlist/);
negative('fourth rejects duplicate declaration overrides', input => {
  fourth(input.registry).declarations.push(structuredClone(fourth(input.registry).declarations[0]));
}, /fourth exact declaration allowlist/);
negative('fourth declaration original Production hash cannot be rewritten', input => {
  fourth(input.registry).declarations[0].production_hash = '0'.repeat(64);
}, /fourth fixed declaration production_hash/);

for (const field of ['production_operations_authorized', 'sql_authoring_authorized', 'sql_execution_authorized', 'merge_authorized', 'automatic_stability_day']) {
  negative(`fourth cannot grant ${field}`, input => { fourth(input.registry)[field] = true; }, new RegExp('fourth forbidden authority: ' + field));
}
negative('fourth cannot replace fresh validation', input => { fourth(input.registry).fresh_validation_required = false; }, /fourth cannot waive fresh validation/);
negative('fourth metadata cannot self-authorize a new review', input => { fourth(input.registry).files[0].reason += ' Unreviewed extension.'; }, /fourth independently fixed complete section/);
negative('fourth artifact bytes are independently fixed', input => { input.artifactBytes = Buffer.concat([input.artifactBytes, Buffer.from('\n')]); }, /fourth independently fixed artifact bytes/);
negative('source, patch and mutable registry hashes cannot jointly self-authorize', input => {
  const value = JSON.parse(input.artifactBytes), section = fourth(input.registry), path = section.files[0].path;
  input.readSource = sourceMutation(path);
  const digest = hash(input.readSource(path));
  section.files[0].candidate_hash = digest; value.files[0].candidate_hash = digest;
  value.source_diff.patch_lines.push('+ unreviewed in-memory change');
  value.source_diff.sha256 = hash(value.source_diff.patch_lines.join('\n'));
  input.artifactBytes = jsonBytes(value);
  section.source_diff_reference.sha256 = hash(input.artifactBytes);
  section.source_diff_reference.patch_sha256 = value.source_diff.sha256;
}, /fourth fixed artifact reference/);

for (const path of ['src/lib/subscriberReportContract.ts', 'supabase/functions/closing-verification-engine/index.ts',
  'supabase/functions/_shared/closing-learning-contract.ts', 'tests/subscriberFrozenOpening.test.mjs']) {
  negative(`registered source cannot drift: ${path}`, input => { input.readSource = sourceMutation(path); },
    new RegExp('fourth current source drift: ' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
negative('missing new runtime source is a failure, not a legacy skip', input => {
  const path = 'supabase/functions/_shared/market-publication-contract.ts';
  input.readSource = requested => {
    if (requested === path) throw new Error('SYNTHETIC_MISSING_NEW_SOURCE:' + path);
    return readSource(requested);
  };
}, /SYNTHETIC_MISSING_NEW_SOURCE:supabase\/functions\/_shared\/market-publication-contract.ts/);

for (const [path, name] of [
  ['supabase/functions/daily-delivery-orchestrator/index.ts', 'checkpointResultOk'],
  ['supabase/functions/daily-delivery-orchestrator/index.ts', 'authorizeRequest'],
  ['supabase/functions/generate-daily-report-v7/index.ts', 'OPENAI_EVIDENCE_GUARDRAILS'],
]) negative(`no file-level bypass for protected declaration mutation: ${name}`, input => {
  const text = declarationText(path, name);
  input.readSource = sourceMutation(path, bytes => Buffer.from(bytes.toString().replace(text, text.replace(name, name + '_UNREVIEWED'))));
}, new RegExp('fourth current source drift: ' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

negative('original verifier implementation bytes remain pinned', input => {
  input.readSource = sourceMutation('tests/helpers/subscriberProjectionIntegrity.mjs');
}, /original three-layer guard bytes must remain unchanged/);
negative('original Production source manifest remains pinned', input => {
  input.readSource = sourceMutation('docs/operations/core-stability-source-manifest-20260907.json');
}, /original Production source manifest remains unchanged/);
negative('original first artifact is still validated by the unchanged predecessor verifier', input => {
  input.firstArtifactBytes = Buffer.concat([firstArtifact, Buffer.from('\n')]);
}, /reviewed artifact cannot self-authorize new content/);
