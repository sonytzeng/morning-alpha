// Preparation/unit tests only. These do not start a stack or establish full E2E PASS.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync as readActualFileSync } from 'node:fs';
import { readExactFixturePreimage } from './helpers/consolidationFixtureRepresentation.mjs';
import { createHash } from 'node:crypto';
import { REPLAY_FUNCTIONS, validateReplayConfiguration, replaySqlFunctionNames, guardedLocalFetch,
  assertClockAgreement, assertCheckpointLineage } from './helpers/coreConsolidationReplayRuntime.mjs';
import { resolveConsolidationVendorResponse as vendor } from './helpers/coreConsolidationVendorShapes.mjs';

// Preserve the exact historical fixture assertion, after validating its one-LF representation.
const representedFixturePath = 'tests/fixtures/consolidation-v1/local-runs/full-chain-market-only-20260921.json';
const representedFixtureUrl = new URL('../' + representedFixturePath, import.meta.url).href;
const readFileSync = (target, options) => {
  if (target instanceof URL && target.href === representedFixtureUrl) {
    const bytes = readExactFixturePreimage(representedFixturePath, readActualFileSync(target));
    return options === 'utf8' ? bytes.toString('utf8') : bytes;
  }
  return readActualFileSync(target, options);
};

const fixture = JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260915.json', import.meta.url)));
const scope = 'ma-consolidation-v1-20260909133500';
const digest = 'a'.repeat(64), boot = '2879f43f-0819-4a08-88dc-195166474350';
const clone = value => structuredClone(value);
const environment = { MA_CONSOLIDATION_REPLAY: 'LOCAL_ONLY', MA_LOCAL_SCOPE: scope };
function config() {
  return {
    schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V1', scope, report_date: '2026-09-15', warmup_date: '2026-09-14',
    scenario_kind: 'SYNTHETIC_MARKET_READY_STOCK_BLOCKED_CONTROL', historical_success_claim: false,
    production_operations_authorized: false, evidence_directory: '/private/tmp/' + scope + '-evidence',
    credentials_file: '/private/tmp/' + scope + '/local-credentials.json', network: scope + '-isolated',
    api_origin: 'http://127.0.0.1:55461', clock: { kind: 'DEDICATED_SHARED_GUEST', configuration: {
      root: '/private/tmp/ma-clock-20260909-020052', limaHome: '/private/tmp/ma-clock-20260909-020052/lima',
      instance: 'clock', configPath: '/private/tmp/ma-clock-20260909-020052/clock.yaml', configSha256: digest, bootId: boot,
    } }, docker: { kind: 'IN_SAME_GUEST', guest_boot_id: boot },
    containers: Object.fromEntries(['auth', 'db', 'edge', 'gateway', 'rest'].map(name => [name, { name: scope + '-' + name, image_id: 'sha256:' + digest }])),
    additional_containers: [{ name: 'local_core_boundary_' + scope, image_id: 'sha256:' + digest }], boundary: { slug: 'local-core-consolidation-boundary', fixture_sha256: digest,
      source_sha256: digest, bundle_sha256: digest, egress_default_deny: true,
      deployed_file: '/private/tmp/' + scope + '/supabase/functions/local-core-consolidation-boundary/index.js',
      source_files: ['coreConsolidationBoundaryPrelude.mjs', 'coreConsolidationBoundaryServer.mjs', 'coreConsolidationVendorShapes.mjs', 'coreConsolidationBoundaryProxy.mjs']
        .map(file => ({ path: 'tests/helpers/' + file, sha256: digest })),
      receiver: { name: 'local_core_boundary_' + scope, image_id: 'sha256:' + digest, deployed_file: '/srv/boundary/index.ts', bundle_sha256: digest } },
    functions: REPLAY_FUNCTIONS.map(slug => ({ slug, entrypoint: 'supabase/functions/' + slug + '/index.ts',
      source_sha256: digest, bundle_sha256: digest, deployed_file: '/private/tmp/' + scope + '/supabase/functions/' + slug + '/index.js',
      vendor_boundary_only: true, business_clock_override: false })),
    source_files: [...REPLAY_FUNCTIONS.map(slug => ({ path: 'supabase/functions/' + slug + '/index.ts', sha256: digest })),
      { path: 'src/lib/subscriberReportContract.ts', sha256: digest }],
    sql_candidate: { path: 'supabase/migrations/20260909015650_core_market_publication_contract.sql', sha256: digest },
    sql_functions: ['enforce_decision_snapshot_premium_90_gate_v1', 'publish_research_bundle_v1', 'publish_member_content_revision_v1',
      'publish_decision_snapshot_v3', 'capture_morning_alpha_acceptance_v1', 'validate_core_market_publication_v1']
      .map(name => ({ name, definition_md5: 'a'.repeat(32) })),
    bootstrap_receipts: [{ scope, path: '/private/tmp/' + scope + '/bootstrap.json', sha256: digest }],
  };
}
test('configuration validation does not pretend to execute an environment', () => {
  assert.equal(validateReplayConfiguration(config(), environment).scope, scope);
  assert.equal(fixture.provenance.historical_capture, false);
  assert.equal(fixture.provenance.historical_success_claim, false);
});
function terminalConfig() {
  const value = JSON.parse(JSON.stringify(config()).replaceAll(scope, 'ma-consolidation-v1-20260909170000').replaceAll('55461', '55481'));
  value.schema_version = 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V2';
  value.report_date = '2026-09-21'; value.warmup_date = '2026-09-18';
  value.sql_functions.push({ name: 'reconcile_runtime_terminal_failures_v1', definition_md5: 'b'.repeat(32) });
  return value;
}
test('terminal successor requires exact third scope, V2 schema and all seven named SQL definitions', () => {
  const value = terminalConfig();
  assert.equal(validateReplayConfiguration(value, { ...environment, MA_LOCAL_SCOPE: value.scope }), value);
  assert.equal(replaySqlFunctionNames(value).length, 7);
  assert.equal(replaySqlFunctionNames(config()).length, 6, 'Original six-function lane stays unchanged');
});
for (const [name, mutate] of [
  ['missing terminal definition', value => value.sql_functions.pop()],
  ['duplicate terminal definition', value => value.sql_functions[0] = value.sql_functions.at(-1)],
  ['unreviewed seventh definition', value => value.sql_functions.at(-1).name = 'unreviewed_terminal'],
  ['wrong terminal fingerprint', value => value.sql_functions.at(-1).definition_md5 = 'not-a-digest'],
  ['legacy schema downgrade', value => value.schema_version = 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V1'],
  ['arbitrary new scope', value => value.scope = 'ma-consolidation-v1-20260909999999'],
  ['other local scope API', value => value.api_origin = 'http://127.0.0.1:55471'],
  ['old scope reused for new SQL', value => value.scope = scope],
]) test('terminal successor rejects ' + name, () => {
  const value = terminalConfig(); mutate(value);
  assert.throws(() => validateReplayConfiguration(value, { ...environment, MA_LOCAL_SCOPE: value.scope }));
});
test('legacy six-function config cannot silently adopt the terminal successor', () => {
  const value = config(); value.sql_functions.push({ name: 'reconcile_runtime_terminal_failures_v1', definition_md5: 'b'.repeat(32) });
  assert.throws(() => validateReplayConfiguration(value, environment));
});
test('Monday provider input uses Friday cash and night-session sources, with distinct warmup news URLs', () => {
  const value = JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260921.json', import.meta.url)));
  const previous = JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260917.json', import.meta.url)));
  assert.equal(value.report_date, '2026-09-21'); assert.equal(value.warmup_date, '2026-09-18');
  assert.equal(value.phases[0].source_times.US, '2026-09-17T20:00:00.000Z');
  assert.equal(value.phases[1].source_times.US, '2026-09-18T20:00:00.000Z');
  assert.equal(value.phases[1].source_times.TW, '2026-09-18T05:30:00.000Z');
  assert.equal(value.phases[1].source_times.TXF, '2026-09-18T21:00:00.000Z');
  assert.deepEqual(value.openai_completion, previous.openai_completion);
  assert.deepEqual(value.quotes['TXF1!'], previous.quotes['TXF1!']);
  assert.equal(value.futures[0].symbol, 'TXF202610'); assert.equal(value.futures[0].deliveryDate, '2026-10-21');
  const request = { url: 'https://finnhub.io/api/v1/news?category=general' };
  const warmup = vendor(request, value, '2026-09-18T14:30:00+08:00');
  const main = vendor(request, value, '2026-09-21T07:00:00+08:00');
  assert.equal(warmup.body.length, 6); assert.equal(main.body.length, 6);
  assert.ok(warmup.body.every(row => !main.body.some(other => other.url === row.url)));
  assert.ok(warmup.body.every(row => row.datetime === Date.parse('2026-09-18T14:00:00+08:00') / 1000));
  assert.ok(main.body.every(row => row.datetime === Date.parse('2026-09-21T06:30:00+08:00') / 1000));
  for (const row of [...warmup.body, ...main.body]) {
    assert.equal(row.source, 'Synthetic market provider'); assert.equal(new URL(row.url).hostname, 'fixture.example.invalid');
    assert.equal(row.final_score, undefined); assert.equal(row.is_selected, undefined);
  }
});
test('later synthetic scenario preserves its original input hash and uses a real prior cash-session weekday', () => {
  const next = JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260916.json', import.meta.url)));
  const originalBytes = readFileSync(new URL('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260915.json', import.meta.url));
  assert.equal(next.provenance.synthetic_template.sha256, createHash('sha256').update(originalBytes).digest('hex'));
  assert.equal(next.provenance.historical_capture, false); assert.equal(next.report_date, '2026-09-16');
  assert.equal(next.warmup_date, '2026-09-15'); assert.equal(next.phases[0].source_times.US, '2026-09-14T20:00:00Z');
  assert.equal(next.phases[1].source_times.US, '2026-09-15T20:00:00Z');
  for (const phase of next.phases) assert.ok(Object.values(phase.source_times).every(at => Date.parse(at) <= Date.parse(phase.starts_at)));
  assert.deepEqual(next.quotes, fixture.quotes); assert.deepEqual(next.openai_completion, fixture.openai_completion);
});
for (const [name, mutate] of [
  ['remote origin', c => { c.api_origin = 'https://production.example.invalid'; }],
  ['localhost ambiguity', c => { c.api_origin = 'http://localhost:55461'; }],
  ['old scope', c => { c.scope = 'ma-core-final-20260907'; }],
  ['foreign guest', c => { c.docker.guest_boot_id = '00000000-0000-0000-0000-000000000000'; }],
  ['date override', c => { c.functions[0].business_clock_override = true; }],
  ['missing handler', c => { c.functions.pop(); }],
  ['unknown dependency', c => { c.source_files[0].path = '../secrets'; }],
  ['duplicate dependency', c => { c.source_files[1].path = c.source_files[0].path; }],
  ['unknown SQL function', c => { c.sql_functions[0].name = 'unreviewed_function'; }],
  ['historical success claim', c => { c.historical_success_claim = true; }],
  ['provider egress', c => { c.boundary.egress_default_deny = false; }],
  ['duplicate network registration', c => { c.additional_containers.push(c.containers.db); }],
  ['missing previous failed result', c => { c.attempt = 2; c.evidence_directory += '-attempt-002'; }],
  ['unknown receiver', c => { c.boundary.receiver.name = 'unrelated'; }],
]) test('configuration rejects ' + name, () => { const value = config(); mutate(value); assert.throws(() => validateReplayConfiguration(value, environment)); });
test('opt in is mandatory, even for a syntactically valid config', () => assert.throws(() => validateReplayConfiguration(config(), {})));
test('local client refuses vendor and redirect egress before network execution', async () => {
  const calls = [], transport = guardedLocalFetch('http://127.0.0.1:55461', async (url, init) => {
    calls.push({ url, init }); return new Response('{}');
  });
  await assert.rejects(transport('https://api.openai.com/v1/chat/completions'));
  await assert.rejects(transport('http://127.0.0.1:55462/rest/v1/reports'));
  assert.equal(calls.length, 0);
  await transport('http://127.0.0.1:55461/rest/v1/reports', { redirect: 'follow' });
  assert.equal(calls[0].init.redirect, 'error');
});
const now = '2026-09-15T07:00:01+08:00';
test('Finnhub news uses real array envelope, not quote shape', () => {
  const response = vendor({ url: 'https://finnhub.io/api/v1/news?category=general' }, fixture, now);
  assert.ok(Array.isArray(response.body)); assert.ok(response.body.length >= 1);
  for (const row of response.body) { assert.ok(row.id); assert.ok(row.datetime < Date.parse(now) / 1000); assert.ok(row.url.length >= 10); assert.ok(row.headline.length >= 10); }
  assert.equal(response.body.c, undefined);
});
test('GNews and NewsAPI retain their distinct articles envelope', () => {
  for (const url of ['https://gnews.io/api/v4/search', 'https://newsapi.org/v2/everything']) {
    const response = vendor({ url }, fixture, now);
    assert.ok(response.body.articles.every(row => row.source.name && row.publishedAt && row.title && row.url));
  }
});
test('premarket Taiwan close is not relabeled as today and US timestamp is real input time', () => {
  const tw = vendor({ url: 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/IX0001' }, fixture, now);
  assert.equal(tw.body.lastUpdated, '2026-09-14T13:30:00+08:00');
  const us = vendor({ url: 'https://finnhub.io/api/v1/quote?symbol=SPY' }, fixture, now);
  assert.equal(us.body.t, Date.parse('2026-09-14T20:00:00Z') / 1000);
  assert.equal(us.body.dp, 1);
});
test('raw OpenAI object does not supply accepted business state or recommendations', () => {
  const response = vendor({ url: 'https://api.openai.com/v1/chat/completions', method: 'POST', body: { messages: [{ role: 'user', content: 'report request' }] } }, fixture, now);
  const content = JSON.parse(response.body.choices[0].message.content);
  assert.deepEqual(content.today_beneficiary_stocks, []); assert.deepEqual(content.beneficiary_stocks, []);
  for (const name of ['canonical_market_state', 'market_publication_contract', 'decision_snapshot_id', 'content_evidence_quality', 'research_master_v2', 'quality_status', 'status']) assert.equal(content[name], undefined);
  assert.equal(response.historical_capture, false);
});
test('unknown endpoint, debug completion, future source and missing phase fail closed', () => {
  assert.throws(() => vendor({ url: 'https://api.openai.com/v1/responses' }, fixture, now));
  assert.throws(() => vendor({ url: 'https://api.openai.com/v1/chat/completions', method: 'POST', body: { messages: [{ content: 'candidate_evaluations' }] } }, fixture, now));
  assert.throws(() => vendor({ url: 'https://finnhub.io/api/v1/quote?symbol=SPY' }, fixture, '2026-09-09T07:00:00+08:00'));
  const changed = clone(fixture); changed.phases[1].source_times.US = '2026-09-16T20:00:00Z';
  assert.throws(() => vendor({ url: 'https://finnhub.io/api/v1/quote?symbol=SPY' }, changed, now));
});
test('provider counterfactual can withhold TXF and percent without producing a downstream success state', () => {
  const changed = clone(fixture); changed.phases[1].missing_txf = true; changed.phases[1].missing_change = true;
  assert.equal(vendor({ url: 'https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/TXF1!' }, changed, now).status, 404);
  const quote = vendor({ url: 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330' }, changed, now);
  assert.equal(quote.body.changePercent, null); assert.equal(quote.body.change, null);
  assert.equal(quote.body.status, undefined);
});
test('LINE local receiver requires valid message shape; it does not mark database outbox SENT', () => {
  assert.throws(() => vendor({ url: 'https://api.line.me/v2/bot/message/push', method: 'POST', body: { to: 'external-recipient', messages: [] } }, fixture, now));
  const response = vendor({ url: 'https://api.line.me/v2/bot/message/push', method: 'POST', body: { to: 'U' + '0'.repeat(32), messages: [{ type: 'text', text: 'Local test' }] } }, fixture, now);
  assert.deepEqual(response.body, {}); assert.equal(response.operation, 'local-receiver');
});
function witness() {
  return { scope, guest: { boot_id: boot }, postgres: { scope, observed_at: '2026-09-15T00:00:00.000Z' },
    edge: { scope, boot_id: boot, clock_override: false, business_edge_clock_observed: true,
      observed_at: '2026-09-15T00:00:01.000Z', receiver_observed_at: '2026-09-15T00:00:01.000Z' },
    auth: { issued_at: Date.parse('2026-09-15T00:00:02Z') / 1000, user_id: 'actual-user', verified_user_id: 'actual-user' },
    started: '2026-09-15T00:00:00.000Z', ended: '2026-09-15T00:00:03.000Z' };
}
test('clock comparison rejects JS-only clock and unverified Auth identity', () => {
  assert.doesNotThrow(() => assertClockAgreement(witness()));
  const stale = witness(); stale.postgres.observed_at = '2026-09-09T00:00:00Z'; assert.throws(() => assertClockAgreement(stale));
  const override = witness(); override.edge.clock_override = true; assert.throws(() => assertClockAgreement(override));
  const wrongUser = witness(); wrongUser.auth.verified_user_id = 'other-user'; assert.throws(() => assertClockAgreement(wrongUser));
});
function lineage() {
  const rows = ['TAIEX', '2330', 'TXF'].map((symbol, index) => ({ id: index + 1, symbol, checkpoint: '0900', correlation_id: 'actual-correlation',
    trading_date: '2026-09-15', value: 100, change_percent: 1, snapshot_version: index + 1, source: 'fugle',
    source_timestamp: '2026-09-15T09:00:00+08:00', raw: { contract: 'FETCH_CHECKPOINT_EVIDENCE_V1' } }));
  return { date: '2026-09-15', checkpoint: '0900', rows, raw: rows.map(row => ({ ...row, captured_at: row.source_timestamp })), canonical: rows.map(row => ({ ...row, captured_at: row.source_timestamp,
    provider: row.source, phase: 'intraday', raw_payload: { immutable_snapshot_version: row.snapshot_version, correlation_id: row.correlation_id,
      provider: row.source, checkpoint: '0900', immutable_checkpoint: '0900' } })), compatibility: rows.map(row => ({ ...row, captured_at: row.source_timestamp,
      phase: 'intraday', raw: { immutable_snapshot_version: row.snapshot_version, correlation_id: row.correlation_id,
        provider: row.source, checkpoint: '0900', immutable_checkpoint: '0900' } })), lifecycle: { checkpoint_status: {
        '0900': { status: 'SUCCEEDED', correlation_id: 'actual-correlation', metadata: { core_batch_complete: true } },
      } } };
}
test('checkpoint verifier needs immutable, canonical and compatibility rows under the actual correlation', () => {
  assert.equal(assertCheckpointLineage(lineage()).correlation_id, 'actual-correlation');
  for (const mutate of [
    value => { value.rows.pop(); }, value => { value.raw.pop(); }, value => { value.raw[0].change_percent += 1; },
    value => { value.canonical[0].raw_payload.immutable_snapshot_version = 999; },
    value => { value.compatibility[0].change_percent = 5; }, value => { value.rows.push(value.rows[0]); },
    value => { value.lifecycle.checkpoint_status['0900'].correlation_id = 'different-correlation'; },
    value => { value.rows[0].change_percent = null; },
    value => { value.canonical[0].raw_payload.correlation_id = 'wrong'; },
    value => { value.compatibility[0].raw.correlation_id = 'wrong'; },
    value => { value.canonical[0].provider = 'wrong'; }, value => { value.compatibility[0].source = 'wrong'; },
    value => { value.compatibility[0].raw.immutable_checkpoint = '1430'; },
    value => { value.canonical[0].trading_date = '2026-09-14'; },
    value => { value.compatibility[0].phase = 'close'; },
  ]) { const value = lineage(); mutate(value); assert.throws(() => assertCheckpointLineage(value)); }
});
test('test bundle boundaries contain no Date override, SQL execution or database-success seed', () => {
  for (const path of ['coreConsolidationBoundaryPrelude.mjs', 'coreConsolidationBoundaryServer.mjs', 'coreConsolidationVendorShapes.mjs', 'coreConsolidationBoundaryProxy.mjs']) {
    const source = readFileSync(new URL('./helpers/' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /globalThis\.Date\s*=|Date\.now\s*=|\.rpc\(|\.from\(|\bINSERT\s+INTO\b/i);
  }
});
test('sanitized completed local evidence preserves manual-only limits and the earlier terminal FAIL', () => {
  const bytes = readFileSync(new URL('./fixtures/consolidation-v1/local-runs/full-chain-market-only-20260921.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '903dc460b4764a61d61b5b14734a3a587a9e7094091f58f6241de305361c1a08');
  const evidence = JSON.parse(bytes);
  assert.equal(evidence.provenance.output_evidence_only, true);
  assert.equal(evidence.provenance.not_a_business_seed, true);
  assert.equal(evidence.observed.acceptance.verdict, 'PASS');
  assert.equal(evidence.observed.acceptance.automatic_stable_day, false);
  assert.equal(evidence.observed.acceptance.manual_intervention, true);
  assert.equal(evidence.observed.acceptance.frontend_status, 'EXTERNAL_SMOKE_REQUIRED');
  assert.deepEqual(evidence.observed.acceptance.automatic_blocking_checks,
    ['MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER', 'AUTOMATION_PROVENANCE_UNVERIFIED']);
  assert.equal(evidence.observed.publication.recommendation_available, false);
  assert.equal(evidence.scope_limits.production_requests, 0);
  assert.equal(evidence.scope_limits.historical_success_claim, false);
  assert.equal(evidence.scope_limits.historical_120_day_learning, 'NOT_DEMONSTRATED');
  assert.deepEqual(evidence.observed.learning.outcomes.filter(row => row.status === 'pending').map(row => row.horizon), ['1D', '3D', '5D']);
  assert.equal(evidence.evidence.old_failure_preservation.previous_result.status, 'FAIL');
  assert.equal(evidence.evidence.old_failure_preservation.previous_result.sha256,
    '15ecbabac65df46280bd342c5191a636708b06f96ffe6ead75ccdab19c8ae7ca');
  assert.equal(evidence.evidence.old_failure_preservation.all_22_previous_tables_unchanged, true);
  const failed = JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/local-failures/terminal-market-only-20260917.json', import.meta.url)));
  assert.equal(failed.observed.full_chain_result, 'FAIL');
});
