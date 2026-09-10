// Offline fixture loader only. Captured downstream values are observations,
// never instructions to seed a successful database or a provider response.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export function loadConsolidationFixtures() {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.schema_version, 'CONSOLIDATION_REPLAY_MANIFEST_V1');
  assert.equal(manifest.production_operations_authorized, false);
  assert.equal(manifest.automatic_stability_claim, false);
  assert.equal(manifest.full_chain_executed, false, 'Fixture availability is not an executed full-chain result');
  const fixtures = new Map();
  for (const entry of manifest.fixtures) {
    assert.match(entry.path, /^(captures|scenarios)\/[a-z0-9-]+\.json$/);
    assert.equal(fixtures.has(entry.fixture_id), false, 'Duplicate fixture identity');
    const bytes = readFileSync(new URL(entry.path, root));
    assert.equal(digest(bytes), entry.sha256, 'Fixture differs from reviewed manifest: ' + entry.path);
    const value = JSON.parse(bytes);
    assert.equal(value.fixture_id, entry.fixture_id);
    assert.equal(value.provenance.kind, entry.kind);
    assert.ok(['SANITIZED_CAPTURE_REPLAY', 'SYNTHETIC_FAILURE_SHAPE'].includes(entry.kind));
    if (entry.kind === 'SANITIZED_CAPTURE_REPLAY') {
      assert.equal(value.provenance.full_producer_replay_available, false);
      assert.equal(value.observed.automatic_stable_day, false);
      for (const source of value.provenance.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
    }
    fixtures.set(entry.fixture_id, freeze(value));
  }
  return { manifest: freeze(manifest), fixtures };
}

export function loadConsolidationProviderInput(fixtureId) {
  const { manifest } = loadConsolidationFixtures();
  const entries = manifest.provider_inputs.filter(entry => entry.fixture_id === fixtureId);
  assert.equal(entries.length, 1, 'Exactly one pinned provider input is required');
  const entry = entries[0];
  assert.match(entry.path, /^providers\/[a-z0-9-]+\.json$/);
  assert.equal(entry.kind, 'SYNTHETIC_FAILURE_SHAPE');
  const bytes = readFileSync(new URL(entry.path, root));
  assert.equal(digest(bytes), entry.sha256, 'Provider-shaped input changed without its manifest');
  const value = JSON.parse(bytes);
  assert.equal(value.fixture_id, entry.fixture_id);
  assert.equal(value.provenance.kind, entry.kind);
  assert.equal(value.provenance.historical_capture, false);
  return freeze(value);
}
