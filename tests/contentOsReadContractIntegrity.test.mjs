import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  PUBLIC_EXPORT_ARTIFACT_PATH,
  readConsolidationPublicExportIntegrity,
  resolveConsolidationPublicExportIntegrity,
} from './helpers/consolidationPublicExportIntegrity.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const REGISTRY = 'docs/operations/core-stability-incident-amendment-20260908.json';
const SOURCE = 'supabase/functions/content-os-morning-alpha-source/index.ts';

const seals = Object.freeze({
  'tests/helpers/contentOsReadContractIntegrity.mjs': '387414d32813d0f870c88d588390a6d128423cd55ebebd4853a52987142a1a0b',
  'docs/operations/evidence/content-os-read-contract-v1-20261001.json': '84f9802355c293d7b6161bf0c3052c7956553e40c4a401ab9b4f51a098004f8e',
  'tests/helpers/consolidationPublicExportIntegrity.mjs': '6305d5f62957a5f6dbae64b945c5683f4db677416670a5b432e722a2f5c3e027',
  [REGISTRY]: '0d1daecb01c28b3673a67634f399fc4ea651ae1391ed2fa615fc8c1506c6a2d9',
});

test('Twelfth independent seals pin the helper, artifact, entry and append-only registry', () => {
  for (const [path, expected] of Object.entries(seals)) assert.equal(hash(read(path)), expected, path);
});

test('Twelfth admission authenticates the exact read-contract successor and every historical layer', () => {
  const registry = JSON.parse(read(REGISTRY));
  const result = readConsolidationPublicExportIntegrity(registry);
  assert.equal(result.fileHash({ path: SOURCE }), registry.content_os_read_contract_v1_registration.files[0].candidate_hash);
  assert.ok(result.eleventhRegistry.core_acceptance_default_v1_registration);
});

test('Twelfth admission rejects source drift before invoking historical verification', () => {
  const registry = JSON.parse(read(REGISTRY));
  const alteredRead = path => path === SOURCE ? Buffer.concat([read(path), Buffer.from('// drift\n')]) : read(path);
  assert.throws(
    () => resolveConsolidationPublicExportIntegrity(registry, read(PUBLIC_EXPORT_ARTIFACT_PATH), alteredRead),
    /unreviewed Twelfth live source drift/,
  );
});

test('Twelfth admission rejects a forged registration even when live sources are unchanged', () => {
  const registry = JSON.parse(read(REGISTRY));
  registry.content_os_read_contract_v1_registration.release_ready = true;
  assert.throws(
    () => resolveConsolidationPublicExportIntegrity(registry, read(PUBLIC_EXPORT_ARTIFACT_PATH), read),
    /pinned registration|physical registry equality/,
  );
});
