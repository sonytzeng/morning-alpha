import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';
import { readConsolidationPublicExportIntegrity as readConsolidationIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';
// Run every original negative/assertion below against the verified exact predecessor.
const consolidation = readConsolidationIntegrity(JSON.parse(readFileSync('docs/operations/core-stability-incident-amendment-20260908.json')));
const registry = consolidation.predecessorRegistry;
const artifact = readFileSync('docs/operations/evidence/subscriber-projection-candidate-20260909.json');
const readSource = consolidation.predecessorReadSource;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const verify = (value = registry, bytes = artifact, source = readSource) => resolveSubscriberProjectionIntegrity(value, bytes, source);
const clone = () => structuredClone(registry);
const second = value => value.subscriber_checkpoint_projection_registration;
const first = value => value.subscriber_projection_candidate_registration;
const firstGuard = /complete first registry\/approval must remain unchanged/;
const negative = (name, change, expected, bytes = () => artifact, source = () => readSource) => test(name, () => {
  // Never count an unrelated pre-existing drift as this negative's protection.
  assert.doesNotThrow(() => verify(), 'the complete unmodified current baseline must pass first');
  const value = clone(); change(value);
  assert.throws(() => verify(value, bytes(), source()), expected);
});

test('append-only successors preserve the complete first registration and reconstruct every approved old preimage', () => {
  const result = verify();
  const { subscriber_public_release_assertion_registration: last, ...secondRegistry } = registry;
  assert.equal(hash(JSON.stringify(secondRegistry, null, 2) + '\n'), '2356082045202008439e56d85a81e197937ec565b08b1cbc1a22bbdd93293518');
  assert.equal(last.files[0].path, 'tests/publicRelease.test.mjs');
  const { subscriber_checkpoint_projection_registration: successor, ...prior } = secondRegistry;
  assert.equal(hash(JSON.stringify(prior, null, 2) + '\n'), 'ae28fdc443a5e1363e5d0ac222578a9687e8585153de79f26c2dbc55bc027bdb');
  assert.equal(hash(artifact), '4dbb461f7350ee3f6c8b8923174e9b4ff97d54e3220b99f9dfa7b06cdc0ea63d');
  assert.equal(successor.related_candidates.length, 11);
  assert.equal(successor.protected_files.length, 1);
  assert.equal(successor.base_candidates.length, 3);
  assert.equal(JSON.parse(artifact).related_candidates.length, 45);
  for (const row of registry.files) assert.equal(result.fileHash(row),
    successor.protected_files.find(item => item.path === row.path)?.candidate_hash
      ?? first(registry).files.find(item => item.path === row.path)?.candidate_hash ?? row.incident_sha256);
  for (const row of registry.modified_declarations) assert.equal(result.declarationHash(row),
    first(registry).declarations.find(item => item.path === row.path && item.name === row.name)?.candidate_hash ?? row.incident_sha256);
});

negative('missing first approval cannot remove immutable history', value => { delete value.subscriber_projection_candidate_registration; }, firstGuard);
negative('prior Production hashes cannot be changed', value => { value.files[0].baseline_sha256 = '0'.repeat(64); }, firstGuard);
negative('unknown protected file cannot be added to the first approval', value => { first(value).files.push({ path: 'supabase/functions/fetch-market-data-v10/index.ts' }); }, firstGuard);
negative('first original candidate hash cannot be rewritten', value => { first(value).files[0].original_hash = '0'.repeat(64); }, firstGuard);
negative('simultaneously altered first artifact and registry cannot self-authorize', value => { first(value).source_diff_reference.sha256 = '0'.repeat(64); }, firstGuard,
  () => Buffer.from(artifact.toString().replace('projected', 'mutated')));
negative('unknown first protected declaration cannot be added', value => { first(value).declarations.push({ path: 'supabase/functions/get-report-payload/index.ts', name: 'fetchPayloadContext' }); }, firstGuard);
negative('duplicate first protected path cannot be inserted', value => { first(value).files.push(first(value).files[0]); }, firstGuard);
negative('first original Production hash cannot be rewritten', value => { first(value).files[0].production_hash = '0'.repeat(64); }, firstGuard);
negative('historical approval provenance is immutable', value => { value.integrity_approval_history[0].approval_source = 'changed history'; }, firstGuard);
negative('modified first patch bytes fail the independent artifact anchor', () => {}, /reviewed artifact cannot self-authorize new content/,
  () => { const value = JSON.parse(artifact); value.source_diff.patch_lines.push('unreviewed patch'); return Buffer.from(JSON.stringify(value)); });
for (const field of ['approval_provenance', 'rollback_target']) negative(`first protected ${field} cannot be removed`, value => { first(value).files[0][field] = ''; }, firstGuard);
for (const field of ['production_operations_authorized', 'merge_authorized']) negative(`first registration cannot enable ${field}`, value => { first(value)[field] = true; }, firstGuard);
negative('first declaration successor is immutable', value => { first(value).declarations[0].candidate_hash = '0'.repeat(64); }, firstGuard);

negative('missing second registration fails its explicit approval boundary', value => { delete value.subscriber_checkpoint_projection_registration; }, /explicit second checkpoint registration is required/);
negative('second approval identity is exact', value => { second(value).approval_id = 'UNREVIEWED_APPROVAL'; }, /second approval exact identity/);
negative('second predecessor registry anchor is exact', value => { second(value).previous_complete_registry_sha256 = '0'.repeat(64); }, /second predecessor registry anchor/);
negative('second predecessor approval identity is exact', value => { second(value).previous_registration_id = 'UNREVIEWED_PREDECESSOR'; }, /second predecessor approval identity/);
negative('second Git base cannot be replaced with an unknown source', value => { second(value).candidate_base_git_sha = '0'.repeat(40); }, /second immutable Git base/);
negative('second first-artifact reference cannot be redirected', value => { second(value).first_artifact_reference.path = 'unreviewed.json'; }, /second immutable first artifact reference/);
negative('second missing related file cannot be silently skipped', value => { second(value).related_candidates.pop(); }, /second exact related path set/);
negative('second unknown related path is rejected', value => { second(value).related_candidates.push({ path: 'src/unreviewed.ts' }); }, /second exact related path set/);
negative('second duplicate related path is rejected', value => { second(value).related_candidates.push(second(value).related_candidates[0]); }, /second exact related path set/);
negative('second approval cannot add a new Payload override', value => { second(value).protected_files.push({ path: 'supabase/functions/get-report-payload/index.ts' }); }, /second exact protected path set/);
negative('second approval cannot add a new Resolver override', value => { second(value).protected_files.push({ path: 'src/services/resolveActiveReport.ts' }); }, /second exact protected path set/);
negative('second approval cannot add an unreviewed base file', value => { second(value).base_candidates.push({ path: 'src/unreviewed.ts' }); }, /second exact Git-base path set/);
negative('second approval cannot modify protected declarations', value => { second(value).declarations = []; }, /second approval cannot alter declarations/);
negative('first-candidate predecessor must match the immutable artifact hash', value => { second(value).related_candidates[0].original_hash = '0'.repeat(64); }, /second exact predecessor hash: src\/hooks\/useAccountDashboard.ts/);
negative('protected predecessor must match the immutable incident hash', value => { second(value).protected_files[0].original_hash = '0'.repeat(64); }, /second exact predecessor hash: src\/lib\/runtimeDecisionTimeline.ts/);
negative('new base predecessor must match its independently fixed Git hash', value => { second(value).base_candidates[0].original_hash = '0'.repeat(64); }, /second exact predecessor hash: src\/components\/v11\/V11ObservationSection.tsx/);
negative('original Production timeline hash remains immutable', value => { second(value).protected_files[0].production_hash = '0'.repeat(64); }, /second original Production hash/);
negative('new base source cannot invent a Production hash', value => { second(value).base_candidates[0].production_hash = '0'.repeat(64); }, /no invented Production hash for unprotected source/);
negative('second rollback reference is required', value => { second(value).related_candidates[0].rollback_target = ''; }, /second source needs reason and rollback: src\/hooks\/useAccountDashboard.ts/);
negative('second per-file provenance must match actual approval', value => { second(value).related_candidates[0].approval_provenance = ''; }, /second source approval provenance: src\/hooks\/useAccountDashboard.ts/);
for (const field of ['production_operations_authorized', 'merge_authorized', 'automatic_stability_day']) negative(`second registration cannot enable ${field}`, value => { second(value)[field] = true; }, new RegExp(`second approval cannot enable authority: ${field}`));
negative('second registration cannot substitute for fresh validation', value => { second(value).fresh_validation_required = false; }, /second registration does not replace fresh validation/);
negative('second inline patch cannot add files', value => { second(value).source_diff.paths.push('src/unreviewed.ts'); }, /second exact inline patch paths/);
negative('changed inline patch cannot self-authorize even if its declared digest is updated', value => {
  second(value).source_diff.patch_lines.push('+ unreviewed patch');
  second(value).source_diff.sha256 = hash(second(value).source_diff.patch_lines.join('\n'));
}, /second independently anchored inline patch/);
negative('second declared patch hash cannot differ from its fixed anchor', value => { second(value).source_diff.sha256 = '0'.repeat(64); }, /second inline patch declared hash/);
negative('changed approved reason cannot bypass the independent complete-section anchor', value => { second(value).related_candidates[0].reason += ' Unreviewed addition.'; }, /second independently anchored complete registration/);
negative('simultaneous current source and mutable registry hash cannot self-authorize', value => {
  second(value).related_candidates[0].candidate_hash = hash('unreviewed source');
}, /second independently anchored complete registration/, () => artifact,
  () => path => path === 'src/hooks/useAccountDashboard.ts' ? Buffer.from('unreviewed source') : readSource(path));
negative('registered source drift fails the exact target source boundary', () => {}, /reviewed second source drift: src\/hooks\/useAccountDashboard.ts/,
  () => artifact, () => path => path === 'src/hooks/useAccountDashboard.ts' ? Buffer.from('unreviewed source') : readSource(path));
negative('registered Browser drift cannot use old successful E2E evidence', () => {}, /reviewed second source drift: tests\/browser\/subscriberProjection.e2e.mjs/,
  () => artifact, () => path => path === 'tests/browser/subscriberProjection.e2e.mjs' ? Buffer.from('unreviewed Browser source') : readSource(path));
negative('untouched first artifact file remains strictly pinned', () => {}, /reviewed candidate drift: src\/services\/resolveActiveReport.ts/,
  () => artifact, () => path => path === 'src/services/resolveActiveReport.ts' ? Buffer.from('unreviewed original source') : readSource(path));

const third = value => value.subscriber_public_release_assertion_registration;
negative('missing third registration cannot bypass the exact test successor', value => { delete value.subscriber_public_release_assertion_registration; }, /explicit third test-conformance registration is required/);
negative('third approval identity is exact', value => { third(value).approval_id = 'UNKNOWN'; }, /third exact approval identity/);
negative('third prior registry anchor is exact', value => { third(value).previous_complete_registry_sha256 = '0'.repeat(64); }, /third predecessor registry anchor/);
negative('third predecessor approval identity is exact', value => { third(value).previous_registration_id = 'UNKNOWN'; }, /third predecessor approval identity/);
negative('third Git base remains fixed', value => { third(value).candidate_base_git_sha = '0'.repeat(40); }, /third immutable Git base/);
negative('third cannot add unknown or duplicate files', value => { third(value).files.push(third(value).files[0]); }, /third exact test-only path set/);
negative('third patch cannot name a production source', value => { third(value).source_diff.paths = ['supabase/functions/get-report-payload/index.ts']; }, /third exact patch path set/);
negative('third old source must be the exact immutable second candidate', value => { third(value).files[0].original_hash = '0'.repeat(64); }, /third exact second-candidate predecessor/);
negative('third new hash cannot be updated to arbitrary current bytes', value => { third(value).files[0].candidate_hash = '0'.repeat(64); }, /third independently fixed candidate hash/);
negative('third test source cannot claim a Production hash', value => { third(value).files[0].production_hash = '0'.repeat(64); }, /test-only successor cannot invent a Production hash/);
negative('third rollback is mandatory', value => { third(value).files[0].rollback_target = ''; }, /third source needs reviewed reason and rollback/);
negative('third per-file provenance is mandatory', value => { third(value).files[0].approval_provenance = ''; }, /third per-file approval provenance/);
for (const field of ['production_operations_authorized', 'merge_authorized', 'automatic_stability_day']) negative(
  'third cannot enable ' + field, value => { third(value)[field] = true; }, new RegExp('third approval cannot enable authority: ' + field));
negative('third cannot waive fresh regression', value => { third(value).fresh_validation_required = false; }, /third registration does not replace fresh regression/);
negative('third cannot add protected source overrides', value => { third(value).protected_files = []; }, /third registration cannot change protected sources/);
negative('third cannot add declaration overrides', value => { third(value).declarations = []; }, /third registration cannot change declarations/);
negative('third mutated patch cannot self-authorize', value => {
  third(value).source_diff.patch_lines.push('+ unreviewed');
  third(value).source_diff.sha256 = hash(third(value).source_diff.patch_lines.join('\n'));
}, /third independently anchored inline patch/);
negative('third declared patch hash is fixed', value => { third(value).source_diff.sha256 = '0'.repeat(64); }, /third declared patch hash/);
negative('third metadata cannot self-authorize a new review', value => { third(value).files[0].reason += ' Unreviewed.'; }, /third independently anchored complete registration/);
negative('third source mutation fails its own current-source boundary', () => {}, /reviewed third source drift: tests\/publicRelease.test.mjs/,
  () => artifact, () => path => path === 'tests/publicRelease.test.mjs' ? Buffer.from('unreviewed test rewrite') : readSource(path));
