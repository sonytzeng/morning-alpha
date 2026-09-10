// These are fixture/scope contracts, not database, provider or full-chain E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConsolidationFixtures } from './index.mjs';
import { CONSOLIDATION_SERVICES, validateConsolidationConfiguration, validateConsolidationFacts } from '../../helpers/consolidationLocalScope.mjs';

const { manifest, fixtures } = loadConsolidationFixtures();
test('three captured failures and one explicitly synthetic counterfactual remain separate', () => {
  assert.equal(manifest.fixtures.length, 4);
  assert.equal(manifest.fixtures.filter(f => f.kind === 'SANITIZED_CAPTURE_REPLAY').length, 3);
  assert.equal(fixtures.get('market-only-counterfactual').provenance.kind, 'SYNTHETIC_FAILURE_SHAPE');
  for (const value of fixtures.values()) assert.ok(Object.isFrozen(value));
});
test('9/7 has actual missing immutable evidence, never repaired historical completion', () => {
  const value = fixtures.get('2026-09-07-fetch-persistence');
  assert.deepEqual(value.observed.immutable_checkpoint_rows, []);
  assert.equal(value.observed.acceptance_verdict, 'FAIL');
  for (const checkpoint of ['0900', '0930', '1030', '1300', '1410', '1430']) {
    for (const symbol of ['TAIEX', '2330', 'TXF']) assert.ok(value.observed.blocking_checks.includes(`CHECKPOINT_${checkpoint}_${symbol}_EVIDENCE_MISSING`));
  }
});
test('9/8 preserves the canonical failure and conflicting public aliases', () => {
  const value = fixtures.get('2026-09-08-quality-projection');
  assert.equal(value.observed.research_quality.evidence_coverage, 79);
  assert.equal(value.observed.research_quality.unsupported_claims.length, 4);
  assert.equal(value.observed.canonical.status, 'PARTIAL');
  assert.equal(value.observed.legacy_aliases.confidence_score, 100);
  assert.equal(value.observed.legacy_aliases.closing_status, 'completed');
  assert.equal(value.market_date.today_date, null, 'Do not fabricate a capture-time today date');
});
test('9/9 captures 76 percent/five unsupported stocks without changing future NOT_DUE to failure or success', () => {
  const value = fixtures.get('2026-09-09-premarket-quality');
  assert.equal(value.observed.research_quality.evidence_coverage, 76);
  assert.equal(value.observed.research_quality.unsupported_claims.length, 5);
  assert.deepEqual(value.observed.research_quality.unsupported_claims.map(c => c.symbol), ['3034', '3529', '5274', '3131', '4763']);
  assert.equal(value.observed.premarket_business_gate, 'FAIL');
  assert.equal(value.observed.full_day_acceptance, 'NOT_DUE');
  assert.equal(value.observed.acceptance_record_id, null);
  assert.equal(value.observed.health_dispatch_http, 200);
  assert.equal(value.observed.health_status, 'failed');
  assert.equal(value.observed.normal_report_line_receipts, 0);
  assert.equal(value.observed.incident_line_receipts, 3);
  assert.equal(value.observed.required_core_lineage.length, 6);
  for (const row of value.observed.required_core_lineage) {
    assert.equal(String(row.snapshot_version), row.canonical_immutable_version);
    assert.equal(String(row.snapshot_version), row.compatibility_immutable_version);
    assert.equal(row.canonical_values_match, true);
    assert.ok(Date.parse(row.source_timestamp) <= Date.parse(row.captured_at));
  }
});

const scope = 'ma-consolidation-v1-20260909120000';
const env = { MA_CONSOLIDATION_REPLAY: 'LOCAL_ONLY', MA_LOCAL_SCOPE: scope };
const config = { scope, dockerContext: 'colima-ma-core-20260907', network: scope + '-isolated', evidenceDirectory: `/private/tmp/${scope}-evidence`,
  origins: { api: 'http://127.0.0.1:54471', mail: 'http://127.0.0.1:54474', frontend: 'http://127.0.0.1:4323' } };
const facts = { dockerEndpoint: 'unix:///Users/sonytzeng/.colima/ma-core-20260907/docker.sock', internal: true, databaseScope: scope, containerNetworks: Object.fromEntries(CONSOLIDATION_SERVICES.map(name => [name, [config.network]])) };
test('scope accepts only explicitly authorized new isolated loopback configuration', () => {
  const checked = validateConsolidationConfiguration(config, env);
  assert.equal(validateConsolidationFacts(checked, facts).isolation_verified, true);
});
test('scope rejects missing authority, old stacks, remote endpoints and unsafe result paths before Docker', () => {
  for (const bad of [{}, { ...env, MA_LOCAL_SCOPE: 'other' }]) assert.throws(() => validateConsolidationConfiguration(config, bad));
  for (const patch of [{ scope: 'ma-core-final-20260907' }, { network: 'shared-network' }, { dockerContext: 'production' }, { evidenceDirectory: '/private/tmp/../var/overwrite' }]) {
    assert.throws(() => validateConsolidationConfiguration({ ...config, ...patch }, env));
  }
  for (const api of ['https://example.com', 'http://localhost:54471', 'http://127.0.0.1:54471/functions/v1/test', 'http://user:password@127.0.0.1:54471', 'http://127.0.0.1:54471/?secret=x']) {
    assert.throws(() => validateConsolidationConfiguration({ ...config, origins: { ...config.origins, api } }, env));
  }
});
test('actual isolation facts reject public networks, wrong DB identity and dual-attached containers', () => {
  for (const patch of [{ dockerEndpoint: 'tcp://example.invalid:2376' }, { internal: false }, { databaseScope: 'other' }, { containerNetworks: {} }, { containerNetworks: { ...facts.containerNetworks, db: [config.network, 'bridge'] } }]) {
    assert.throws(() => validateConsolidationFacts(config, { ...facts, ...patch }));
  }
});
