// Opt-in persistent negative control. This file does not bootstrap a stack or
// seed business rows. Its only fault is the provider fixture's absent NVDA quote.
// A successful test means real publication/Acceptance FAILURE was verified;
// it never means a complete 13-handler chain or a historical day passed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { WARMUP_INPUT_TABLES } from '../helpers/coreConsolidationContinuation.mjs';
import { localFetchCorrelationHeaders } from '../helpers/coreConsolidationFreshManualContinuation.mjs';
import { resolveConsolidationVendorResponse } from '../helpers/coreConsolidationVendorShapes.mjs';
import { validateReplayConfiguration, checkPinnedReplayInputs, readNewLocalCredentials,
  guardedLocalFetch, createGuestReadback, createReplayClock, assertClockAgreement,
  createReplayJournal, sha256, object, canonicalNumeric, REPLAY_FUNCTIONS, RETAINED_TABLES,
} from '../helpers/coreConsolidationMissingQuoteRuntime.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const success = result => {
  assert.equal(result.http, 200, 'Prerequisite handler must really succeed');
  assert.equal(result.body.success, true, 'A failed prerequisite is not the expected missing-quote result');
};
const sorted = values => [...values].sort();
const oneRow = values => { assert.equal(values.length, 1, 'Expected exactly one persisted row'); return values[0]; };

// Reconstruct only the recorded provider request, including the actual futures
// session. Never infer it from the phase or silently map an unknown provider.
export function reconstructCheckpointProviderRequest(source) {
  const raw = object(source.raw), sourceRaw = object(raw.source_raw);
  assert.equal(raw.contract, 'FETCH_CHECKPOINT_EVIDENCE_V1');
  const symbol = raw.source_symbol;
  assert.ok(typeof symbol === 'string' && symbol.length > 0 && symbol.trim() === symbol);
  assert.ok(['finnhub', 'fugle', 'fugle_futopt'].includes(source.source), 'Unknown provider in the bounded quote replay');
  assert.equal(sourceRaw.provider, source.source, 'Immutable provider provenance must agree');
  let url;
  if (source.source === 'finnhub') {
    assert.equal(sourceRaw.finnhub_symbol, symbol); assert.equal(sourceRaw.session, undefined);
    url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol);
  } else {
    assert.equal(sourceRaw.source_symbol, symbol);
    const futures = source.source === 'fugle_futopt';
    url = 'https://api.fugle.tw/marketdata/v1.0/' + (futures ? 'futopt' : 'stock') + '/intraday/quote/' + encodeURIComponent(symbol);
    if (futures) {
      assert.equal(sourceRaw.product, 'TXF');
      assert.ok(['regular', 'afterhours'].includes(sourceRaw.session), 'Exact immutable futures session is required');
      if (sourceRaw.session === 'afterhours') url += '?session=afterhours';
    } else assert.equal(sourceRaw.session, undefined);
  }
  return { url: new URL(url).href, method: 'GET', body: null };
}

// Pure assertion surface for preparation tests. All arguments below are actual
// handler responses/readbacks in the executable lane; nothing is synthesized.
export function assertMissingRequiredQuoteReadback(input) {
  const { date, phase, checkpoint, correlation, result, immutable, raw, canonical,
    compatibility, lifecycle, health, receipts, fixture, scope } = input;
  assert.equal(result.http, 200);
  assert.equal(result.body.success, false);
  assert.equal(result.body.operation_succeeded, false);
  assert.equal(result.body.trading_date, date); assert.equal(result.body.phase, phase);
  assert.equal(result.body.checkpoint, checkpoint); assert.equal(result.body.correlation_id, correlation);
  assert.deepEqual(result.body.failed, ['NVDA']);
  assert.deepEqual(sorted(result.body.required_core_symbols), ['NVDA', 'SPX', 'TSM']);
  for (const key of ['core_batch_complete', 'required_core_complete', 'immutable_evidence_complete', 'checkpoint_complete']) {
    assert.equal(result.body[key], false, 'Missing NVDA must remain incomplete: ' + key);
  }
  for (const key of ['canonical_complete', 'snapshot_complete']) assert.equal(result.body[key], true);
  for (const key of ['db_write_errors', 'canonical_write_errors', 'snapshot_errors', 'provider_health_write_errors']) {
    assert.deepEqual(result.body[key], [], 'Infrastructure/write failure is not this negative control: ' + key);
  }
  assert.equal(result.body.timed_out, false); assert.equal(result.body.trading_day_state_error, null);
  assert.equal(result.body.trading_day_state_status, 'DEGRADED');
  const entry = object(object(lifecycle.checkpoint_status)[checkpoint]);
  assert.equal(lifecycle.trading_date, date); assert.equal(entry.status, 'DEGRADED');
  assert.equal(entry.correlation_id, correlation); assert.equal(object(entry.metadata).core_batch_complete, false);
  assert.deepEqual(object(entry.metadata).failed_symbols, ['NVDA']);
  assert.notEqual(lifecycle.current_state, 'DAY_COMPLETED');
  assert.equal(health.service_date, date); assert.equal(health.phase, phase); assert.equal(health.checkpoint, checkpoint);
  assert.equal(health.correlation_id, correlation); assert.equal(health.failed_count, 1);
  assert.equal(object(health.details).core_batch_complete, false);
  const expectedSymbols = sorted(result.body.symbols.filter(symbol => symbol !== 'NVDA'));
  assert.ok(expectedSymbols.includes('TAIEX') && expectedSymbols.includes('2330') && expectedSymbols.includes('TXF'));
  assert.deepEqual(sorted(result.body.inserted.map(row => row.symbol)), expectedSymbols);
  assert.deepEqual(sorted(immutable.map(row => row.symbol)), expectedSymbols);
  assert.deepEqual(sorted(canonical.map(row => row.symbol)), expectedSymbols);
  assert.deepEqual(sorted(compatibility.map(row => row.symbol)), expectedSymbols);
  for (const values of [immutable, raw, canonical, compatibility]) assert.ok(values.every(row => row.symbol !== 'NVDA'));
  const immutableCheckpoint = checkpoint === 'manual' ? 'RECOVERY' : 'PREMARKET';
  for (const source of immutable) {
    assert.equal(source.trading_date, date); assert.equal(source.market_session, checkpoint === 'manual' ? 'recovery' : phase);
    assert.equal(source.checkpoint, immutableCheckpoint); assert.equal(source.correlation_id, correlation);
    assert.equal(object(source.raw).contract, 'FETCH_CHECKPOINT_EVIDENCE_V1');
    assert.ok(source.snapshot_version > 0 && source.value > 0 && Number.isFinite(source.change_percent));
    assert.ok(Number.isFinite(Date.parse(source.source_timestamp)));
    assert.ok(Date.parse(source.source_timestamp) <= Date.parse(source.captured_at) + 60_000);
    assert.ok(Date.parse(source.source_timestamp) <= Date.parse(source.created_at));
    const rawRow = oneRow(raw.filter(row => row.symbol === source.symbol));
    assert.equal(rawRow.value, source.value); assert.equal(rawRow.change_percent, source.change_percent);
    assert.equal(Date.parse(rawRow.captured_at), Date.parse(source.source_timestamp));
    const quote = oneRow(canonical.filter(row => row.symbol === source.symbol));
    const alias = oneRow(compatibility.filter(row => row.symbol === source.symbol));
    for (const row of [quote, alias]) {
      const provenance = object(row.raw_payload ?? row.raw);
      assert.equal(row.trading_date, date); assert.equal(row.phase, phase);
      assert.equal(provenance.correlation_id, correlation); assert.equal(provenance.immutable_checkpoint, immutableCheckpoint);
      assert.equal(provenance.immutable_snapshot_version, source.snapshot_version);
      assert.equal(provenance.checkpoint, checkpoint); assert.equal(provenance.provider, source.source);
      assert.equal(row.value, row === quote ? canonicalNumeric(source.value, 8) : source.value);
      assert.equal(row.change_percent, row === quote ? canonicalNumeric(source.change_percent, 6) : source.change_percent);
      assert.equal(Date.parse(row.captured_at), Date.parse(source.source_timestamp));
    }
    assert.equal(quote.correlation_id, correlation); assert.equal(quote.provider, source.source); assert.equal(alias.source, source.source);
    const request = reconstructCheckpointProviderRequest(source);
    const receipt = oneRow(receipts.filter(row => row.request_sha256 === sha256(JSON.stringify(request))));
    const expected = resolveConsolidationVendorResponse(request, fixture, receipt.observed_at);
    assert.equal(receipt.scope, scope); assert.equal(receipt.status, 200); assert.equal(expected.status, 200);
    assert.equal(receipt.response_sha256, sha256(JSON.stringify(expected.body)));
    assert.equal(receipt.phase, expected.phase); assert.equal(receipt.provider, expected.provider);
  }
  const missingRequest = { url: 'https://finnhub.io/api/v1/quote?symbol=NVDA', method: 'GET', body: null };
  const absent = oneRow(receipts.filter(row => row.request_sha256 === sha256(JSON.stringify(missingRequest))));
  const expected = resolveConsolidationVendorResponse(missingRequest, fixture, absent.observed_at);
  assert.equal(expected.status, 404); assert.equal(absent.status, 404); assert.equal(absent.provider, 'finnhub');
  assert.equal(absent.scope, scope); assert.equal(absent.response_sha256, sha256(JSON.stringify(expected.body)));
  assert.equal(absent.phase, expected.phase);
  for (const receipt of receipts) {
    assert.equal(receipt.source_kind, 'SYNTHETIC_PROVIDER_CONTROL'); assert.equal(receipt.historical_capture, false);
    assert.ok(!['openai', 'line'].includes(receipt.provider), 'No unrelated provider operation may hide in Fetch');
  }
  return { date, phase, checkpoint, correlation_id: correlation, missing_required_symbol: 'NVDA',
    checkpoint_status: entry.status, persisted_symbols: expectedSymbols,
    immutable_sha256: sha256(JSON.stringify(immutable)), provider_receipts_sha256: sha256(JSON.stringify(receipts)) };
}

// A receipt-assertion failure after one completed Fetch is not permission to
// resend it. The explicit continuation revalidates that exact retained request
// against the live DB and receiver before executing any subsequent handler.
export function validateMissingQuoteWarmupFailure(prior, config) {
  assert.equal(prior.schema_version, 'CORE_CONSOLIDATION_MISSING_QUOTE_RESULT_V1');
  assert.equal(prior.scope, config.scope); assert.equal(prior.status, 'FAIL');
  assert.equal(prior.test_success, false); assert.equal(prior.actual_acceptance_verdict, null);
  assert.equal(prior.full_persisted_chain_executed, false); assert.equal(prior.production_requests, 0);
  assert.equal(prior.historical_success_claim, false); assert.equal(prior.automatic_stable_day, false);
  assert.deepEqual(prior.records.map(row => row.stage), ['fresh-business-scope-readback', 'real-runtime-clock',
    'handler:fetch-market-data-v10', 'handler:fetch-market-data-v10', 'FIRST_FAILURE']);
  const [fresh, witness, requested, received, failure] = prior.records;
  assert.equal(fresh.all_required_tables_empty, true); assert.equal(fresh.direct_business_seed_writes, 0);
  assert.equal(fresh.new_synthetic_users, 0); assert.equal(witness.auth_user_count, 0);
  assert.equal(witness.boot_id, config.clock.configuration.bootId);
  assert.equal(requested.request_attempted, true); assert.equal(requested.response_received, false);
  const correlation = requested.request_body.correlation_id;
  assert.match(correlation, /^[a-f0-9-]{36}$/);
  assert.deepEqual(requested.request_body, { source: 'LOCAL_CONSOLIDATION_SYNTHETIC',
    phase: 'manual_backfill', checkpoint: 'manual', correlation_id: correlation });
  assert.equal(requested.request_sha256, sha256(JSON.stringify(requested.request_body)));
  assert.equal(received.http, 200); assert.match(received.response_sha256, /^[a-f0-9]{64}$/);
  assert.equal(received.response_body.trading_date, config.warmup_date);
  assert.equal(received.response_body.correlation_id, correlation);
  assert.equal(received.response_body.success, false); assert.equal(received.response_body.operation_succeeded, false);
  assert.deepEqual(received.response_body.failed, ['NVDA']);
  assert.equal(failure.expected_failure_verified, false); assert.equal(failure.full_chain_pass, false);
  assert.equal(failure.error, 'Expected exactly one persisted row\n\n0 !== 1\n');
  return { correlation, result: { http: received.http, body: received.response_body,
    response_sha256: received.response_sha256 }, prior_run_id: prior.run_id };
}

export function validateMissingQuoteWarmupContinuationDescriptor(value, config) {
  assert.equal(config.scope, 'ma-consolidation-v1-20260909210000', 'A fresh successor must never adopt the failed prior publication or warmup');
  const hasReadonlyFailure = 'prior_readonly_failure_file' in value || 'prior_readonly_failure_sha256' in value;
  assert.deepEqual(Object.keys(value).sort(), (hasReadonlyFailure
    ? ['prior_result_file', 'prior_result_sha256', 'prior_readonly_failure_file', 'prior_readonly_failure_sha256']
    : ['prior_result_file', 'prior_result_sha256']).sort());
  assert.equal(value.prior_result_file, '/private/tmp/' + config.scope + '-evidence/result.json');
  assert.equal(value.prior_result_sha256, 'e26b7724872a37430c7d71d27f1770d1654edb797232f03260161b491851a61c');
  if (hasReadonlyFailure) {
    assert.equal(value.prior_readonly_failure_file, '/private/tmp/' + config.scope + '-evidence-warmup-continuation-001/result.json');
    assert.equal(value.prior_readonly_failure_sha256, '59ee9100b7b6fd4a7b059f4d56a61deb3157f75491b8df7dc8617178b96c9323');
  }
  return hasReadonlyFailure ? '-warmup-continuation-002' : '-warmup-continuation-001';
}

export function validateMissingQuoteReadonlyClockFailure(prior, config, retainedWarmup) {
  assert.equal(prior.schema_version, 'CORE_CONSOLIDATION_MISSING_QUOTE_RESULT_V1');
  assert.equal(prior.scope, config.scope); assert.equal(prior.status, 'FAIL');
  assert.equal(prior.test_success, false); assert.equal(prior.actual_acceptance_verdict, null);
  assert.equal(prior.full_persisted_chain_executed, false); assert.equal(prior.production_requests, 0);
  assert.equal(prior.historical_success_claim, false); assert.equal(prior.automatic_stable_day, false);
  assert.equal(prior.handler_count, 0); assert.deepEqual(prior.executed_handlers, []);
  const stages = ['persisted-missing-required-quote', 'FIRST_FAILURE'];
  assert.deepEqual(prior.executed_stages, stages); assert.deepEqual(prior.records.map(row => row.stage), stages);
  const [proof, failure] = prior.records;
  assert.equal(proof.date, config.warmup_date); assert.equal(proof.phase, 'manual_backfill'); assert.equal(proof.checkpoint, 'manual');
  assert.equal(proof.correlation_id, retainedWarmup.correlation); assert.equal(proof.missing_required_symbol, 'NVDA');
  assert.equal(proof.checkpoint_status, 'DEGRADED'); assert.equal(proof.direct_business_seed_writes, 0);
  assert.deepEqual(proof.result, retainedWarmup.result.body);
  assert.equal(proof.immutable.length, 10); assert.equal(proof.immutable_sha256, sha256(JSON.stringify(proof.immutable)));
  assert.deepEqual(proof.persisted_symbols, sorted(proof.immutable.map(row => row.symbol)));
  for (const key of ['provider_receipts_sha256', 'canonical_sha256', 'compatibility_sha256']) assert.match(proof[key], /^[a-f0-9]{64}$/);
  assert.equal(failure.error, 'Never rewind an active replay VM');
  assert.equal(failure.expected_failure_verified, false); assert.equal(failure.full_chain_pass, false);
  assert.equal(failure.ambiguous_write_not_retried, true);
  return prior.run_id;
}

// An observation is never a request to set the clock. The controller retains
// its independent no-rewind check for genuinely future scheduled targets.
export function prepareMissingQuoteClockTarget(clock, at, observeOnly = false) {
  assert.equal(typeof observeOnly, 'boolean');
  const target = new Date(at).toISOString(), observed = clock.observe();
  const delta = Date.parse(target) - Date.parse(observed.observed_at);
  if (observeOnly) assert.ok(delta <= 0, 'Observe-only cannot request a future clock target');
  if (!observeOnly && delta > 0) clock.advance(target);
  else assert.ok(delta >= -10 * 60_000, 'Phase expired; never rewind a runtime');
  return target;
}

export async function runCoreConsolidationMissingQuote(configPath, warmupContinuation = null) {
  const supplied = JSON.parse(readFileSync(configPath, 'utf8'));
  const config = validateReplayConfiguration(supplied);
  if (config.scope === 'ma-consolidation-v1-20260910220000') assert.equal(warmupContinuation, null, 'Fresh successor cannot adopt any prior input');
  checkPinnedReplayInputs(config, repo);
  let retainedWarmup = null;
  let retainedReadonlyFailure = null, continuationSuffix = null;
  const checkPrior = () => {
    if (!warmupContinuation) return;
    continuationSuffix = validateMissingQuoteWarmupContinuationDescriptor(warmupContinuation, config);
    const bytes = readFileSync(warmupContinuation.prior_result_file);
    assert.equal(sha256(bytes), warmupContinuation.prior_result_sha256, 'Original FAIL must remain unchanged');
    retainedWarmup = validateMissingQuoteWarmupFailure(JSON.parse(bytes), config);
    if (warmupContinuation.prior_readonly_failure_file) {
      const readonlyBytes = readFileSync(warmupContinuation.prior_readonly_failure_file);
      assert.equal(sha256(readonlyBytes), warmupContinuation.prior_readonly_failure_sha256, 'Prior readonly clock FAIL must remain unchanged');
      retainedReadonlyFailure = validateMissingQuoteReadonlyClockFailure(JSON.parse(readonlyBytes), config, retainedWarmup);
    }
  };
  checkPrior();
  const fixture = JSON.parse(readFileSync(config.boundary.fixture_file, 'utf8'));
  const credentials = readNewLocalCredentials(config), transport = guardedLocalFetch(config.api_origin);
  const guest = createGuestReadback(config); guest.inspect();
  const clock = createReplayClock(config), journal = createReplayJournal(warmupContinuation
    ? { ...config, evidence_directory: config.evidence_directory + continuationSuffix } : config);
  const service = createClient(config.api_origin, credentials.service_role_key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport },
  });
  const rows = async query => {
    const result = await query; assert.equal(result.error, null, 'Actual local readback failed');
    assert.ok(Array.isArray(result.data)); return result.data;
  };
  const request = async (path, body) => {
    const response = await transport(config.api_origin + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: credentials.service_role_key,
        Authorization: 'Bearer ' + credentials.service_role_key, 'x-cron-secret': credentials.cron_secret,
        ...localFetchCorrelationHeaders(path, body) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(360000) });
    const text = await response.text();
    let result; try { result = JSON.parse(text); } catch { throw new Error('Non-JSON local response: ' + response.status); }
    return { http: response.status, body: result, response_sha256: sha256(text) };
  };
  const call = async (slug, body = {}) => {
    assert.ok(REPLAY_FUNCTIONS.includes(slug));
    const requestBody = { source: 'LOCAL_CONSOLIDATION_SYNTHETIC', ...body };
    journal.append('handler:' + slug, { request_attempted: true, request_body: requestBody,
      request_sha256: sha256(JSON.stringify(requestBody)), response_received: false });
    // One attempt only: timeout/ambiguous transport is a retained FAIL, never a retry.
    const result = await request('/functions/v1/' + slug, requestBody);
    journal.append('handler:' + slug, { http: result.http, response_sha256: result.response_sha256, response_body: result.body });
    return result;
  };
  const boundary = operation => request('/functions/v1/' + config.boundary.slug, { operation, scope: config.scope });
  const audit = async () => { const value = await boundary('audit'); success(value); return value.body.receipts; };
  async function clockAt(at, { observeOnly = false } = {}) {
    const target = prepareMissingQuoteClockTarget(clock, at, observeOnly);
    const before = clock.observe(), postgres = guest.clockWitness();
    const edge = await boundary('clock'); success(edge);
    assert.equal(edge.body.fixture_sha256, config.boundary.fixture_sha256);
    assert.equal(edge.body.boundary_source_sha256, config.boundary.source_sha256);
    const after = clock.observe();
    assertClockAgreement({ scope: config.scope, guest: before, postgres, edge: edge.body,
      started: before.observed_at, ended: after.observed_at });
    journal.append('real-runtime-clock', { target, boot_id: before.boot_id, postgres, edge: edge.body,
      user_authentication_executed: false, auth_user_count: postgres.auth_user_count,
      host_clock_unchanged: true, business_clock_override: false, observe_only: observeOnly });
  }
  async function readCheckpoint(date, phase, checkpoint, correlation, result, receipts) {
    const [immutable, raw, canonical, compatibility, lifecycle, health] = await Promise.all([
      rows(service.from('market_checkpoint_snapshots').select('*').eq('trading_date', date).eq('correlation_id', correlation)),
      rows(service.from('market_data').select('*')),
      rows(service.from('market_quotes').select('*').eq('trading_date', date).eq('phase', phase)),
      rows(service.from('market_data_snapshots').select('*').eq('trading_date', date).eq('phase', phase).eq('checkpoint', checkpoint)),
      rows(service.from('trading_day_state').select('*').eq('trading_date', date)),
      rows(service.from('data_provider_health').select('*').eq('provider', 'market_fetch_v10').eq('service_date', date).eq('phase', phase).eq('checkpoint', checkpoint)),
    ]);
    const proof = assertMissingRequiredQuoteReadback({ date, phase, checkpoint, correlation, result, immutable, raw, canonical,
      compatibility, lifecycle: oneRow(lifecycle), health: oneRow(health), receipts, fixture, scope: config.scope });
    journal.append('persisted-missing-required-quote', { ...proof, result: result.body, immutable,
      canonical_sha256: sha256(JSON.stringify(canonical)), compatibility_sha256: sha256(JSON.stringify(compatibility)),
      lifecycle: oneRow(lifecycle), provider_health: oneRow(health), direct_business_seed_writes: 0 });
    return { immutable, checkpoint: object(oneRow(lifecycle).checkpoint_status)[checkpoint] };
  }
  async function partialCheckpoint(date, phase, checkpoint) {
    const correlation = randomUUID(), before = await audit();
    const result = await call('fetch-market-data-v10', { phase, checkpoint, correlation_id: correlation });
    const allReceipts = await audit();
    assert.deepEqual(allReceipts.slice(0, before.length), before, 'Earlier provider receipts must remain immutable');
    return readCheckpoint(date, phase, checkpoint, correlation, result, allReceipts.slice(before.length));
  }
  async function noPublication(stage) {
    const tables = {};
    for (const [table, dateField] of [['reports', 'report_date'], ['decision_snapshots', 'report_date'],
      ['member_content_revisions', 'report_date'], ['line_delivery_outbox', 'report_date'],
      ['learning_runs', 'run_date'], ['learning_predictions', 'report_date']]) {
      tables[table] = await rows(service.from(table).select('*').eq(dateField, config.report_date));
      assert.deepEqual(tables[table], [], 'Unpublished missing-quote day must not acquire ' + table);
    }
    assert.deepEqual(await rows(service.from('prediction_outcomes').select('*')), []);
    assert.deepEqual(await rows(service.from('pipeline_runs').select('*').eq('trading_date', config.report_date)
      .like('idempotency_key', 'research-input:%').eq('status', 'SUCCEEDED')), []);
    journal.append('no-publication-' + stage, { tables, true_durable_publication_absent: true, direct_business_seed_writes: 0 });
  }
  try {
    let warmup;
    if (retainedWarmup) {
      const inputCounts = { market_data: 10, market_checkpoint_snapshots: 10, market_quotes: 10,
        market_data_snapshots: 10, data_provider_health: 1, trading_day_state: 1, runtime_quality_policies: 1 };
      for (const table of RETAINED_TABLES) {
        const actual = await rows(service.from(table).select('*'));
        assert.equal(actual.length, inputCounts[table] ?? 0, 'Only the exact retained warmup may exist: ' + table);
      }
      const priorReceipts = await audit(); assert.equal(priorReceipts.length, 11);
      warmup = await readCheckpoint(config.warmup_date, 'manual_backfill', 'manual',
        retainedWarmup.correlation, retainedWarmup.result, priorReceipts);
      const observed = clock.observe().observed_at;
      assert.ok(observed >= config.warmup_date + 'T06:30:00.000Z'
        && observed < config.warmup_date + 'T16:00:00.000Z', 'Retained warmup input phase expired; never rewind');
      await clockAt(observed, { observeOnly: true });
      journal.append('retained-warmup-reverified-not-reexecuted', { ...warmupContinuation,
        prior_run_id: retainedWarmup.prior_run_id, prior_failure_retained: true, prior_result_promoted: false,
        prior_readonly_failure_run_id: retainedReadonlyFailure,
        business_handler_retried: false, direct_business_seed_writes: 0, auth_users: 0,
        provider_receipts_sha256: sha256(JSON.stringify(priorReceipts)) });
    } else {
      for (const table of WARMUP_INPUT_TABLES) {
        assert.deepEqual(await rows(service.from(table).select('*').limit(1)), [], 'Fresh unseeded scope required: ' + table);
      }
      journal.append('fresh-business-scope-readback', { tables: WARMUP_INPUT_TABLES, all_required_tables_empty: true,
        direct_business_seed_writes: 0, new_synthetic_users: 0, copied_user_sessions: false });
      const observed = clock.observe().observed_at;
      assert.ok(Date.parse(observed) <= Date.parse(config.warmup_date + 'T15:20:00+08:00'), 'Manual input window expired');
      await clockAt(new Date(Math.max(Date.parse(observed), Date.parse(config.warmup_date + 'T14:30:00+08:00'))).toISOString());
      warmup = await partialCheckpoint(config.warmup_date, 'manual_backfill', 'manual');
    }
    // Genuine Taiwan rows support the existing sector cold-start. The partial
    // manual capture is INPUT ONLY, never a successful natural checkpoint.
    success(await call('fetch-global-market-news'));
    success(await call('generate-sector-rotation'));
    await clockAt(config.report_date + 'T07:00:00+08:00');
    const main = await partialCheckpoint(config.report_date, 'premarket', 'premarket');
    success(await call('fetch-global-market-news'));
    assert.ok((await rows(service.from('news_events').select('id,published_at,source_url'))).length > 0);
    const generated = await call('generate-daily-report-v7', { suppress_notifications: true, skip_openai: false });
    assert.equal(generated.http, 409); assert.equal(generated.body.success, false);
    assert.equal(generated.body.error_code, 'RESEARCH_QUALITY_REJECTED');
    assert.ok(generated.body.reason_codes.includes('CANONICAL_DECISION_BLOCKED'));
    const rejected = oneRow(await rows(service.from('pipeline_runs').select('*').eq('trading_date', config.report_date)
      .like('idempotency_key', 'research-input:%')));
    assert.equal(rejected.status, 'DEGRADED');
    assert.equal(object(object(rejected.provider_status).result).error_code, 'RESEARCH_QUALITY_REJECTED');
    assert.ok(object(object(rejected.provider_status).manifest).missing_sources.includes('required_us_market_evidence'));
    journal.append('actual-research-quality-rejection', { run: rejected, derived_scores_not_seeded: true });
    await noPublication('generation');
    const payload = await call('get-report-payload', { report_date: config.report_date });
    assert.equal(payload.http, 404); assert.equal(payload.body.error, 'REPORT_NOT_FOUND'); assert.equal(payload.body.payload, null);
    const delivery = await call('line-daily-push');
    assert.equal(delivery.http, 200); assert.equal(delivery.body.sent, false); assert.equal(delivery.body.reason, 'NO_REPORT_FOR_TODAY');
    await noPublication('payload-line');
    await clockAt(config.report_date + 'T14:40:00+08:00');
    const closing = await call('closing-verification-engine');
    assert.equal(closing.http, 404); assert.equal(closing.body.success, false); assert.equal(closing.body.error, 'MISSING_REPORT');
    const learning = await call('continuous-learning-engine');
    assert.equal(learning.http, 409); assert.equal(learning.body.success, false); assert.equal(learning.body.error, 'CANONICAL_REPORT_MISSING');
    await clockAt(config.report_date + 'T15:15:00+08:00');
    const health = await call('ma-ops-health-check', { environment: 'development', check_type: 'closing', target_date: config.report_date });
    assert.equal(health.http, 200); assert.equal(health.body.status, 'failed');
    assert.ok(health.body.checks.some(row => row.check_name === 'closing-verification-status' && row.status === 'failed' && row.error_code === 'REPORT_MISSING'));
    const terminal = await call('daily-delivery-orchestrator', { mode: 'health_check', check_type: 'closing',
      source: 'ma-ops-safe-recovery', target_date: config.report_date });
    assert.equal(terminal.http, 409); assert.equal(terminal.body.success, false);
    assert.equal(terminal.body.error, 'RECOVERY_LIFECYCLE_PREDECESSOR_NOT_SATISFIED');
    const day = oneRow(await rows(service.from('trading_day_state').select('*').eq('trading_date', config.report_date)));
    assert.notEqual(day.current_state, 'DAY_COMPLETED'); assert.ok(day.state_rank < 130);
    assert.deepEqual(object(day.checkpoint_status).premarket, main.checkpoint, 'Failed source checkpoint must not be upgraded');
    assert.notEqual(object(object(day.checkpoint_status).day_completed).status, 'SUCCEEDED');
    await noPublication('terminal');
    await clockAt(config.report_date + 'T15:35:00+08:00');
    guest.inspect();
    const acceptance = await service.rpc('capture_morning_alpha_acceptance_v1', {
      p_business_date: config.report_date, p_evaluator_version: 'LOCAL_CONSOLIDATION_SYNTHETIC_MISSING_REQUIRED_NVDA',
    });
    assert.equal(acceptance.error, null, 'Actual Acceptance RPC must execute, not fail with an infrastructure error');
    const verdict = oneRow(await rows(service.from('production_acceptance_results').select('*').eq('id', acceptance.data)));
    journal.append('actual-acceptance', verdict);
    assert.equal(verdict.verdict, 'FAIL'); assert.equal(object(verdict.evidence).phase, 'FULL_DAY');
    for (const code of ['PREMARKET_NVDA_PRODUCER_EVIDENCE_MISSING', 'REPORT_REVISION_MISMATCH',
      'CURRENT_PUBLICATION_RECEIPT_UNVERIFIED', 'CANONICAL_NOT_READY', 'NORMAL_REPORT_LINE_NOT_COMPLETE']) {
      assert.ok(verdict.blocking_checks.includes(code), 'Expected durable failure evidence missing: ' + code);
    }
    assert.equal(object(verdict.evidence).automatic_stable_day, false);
    const after = await audit(); assert.equal(after.filter(row => row.provider === 'line').length, 0);
    assert.ok(after.some(row => row.provider === 'openai' && row.operation === 'chat-completions'), 'Actual generator must consume the unchanged raw model fixture');
    const currentImmutable = await rows(service.from('market_checkpoint_snapshots').select('*'));
    assert.equal(currentImmutable.length, warmup.immutable.length + main.immutable.length);
    for (const original of [...warmup.immutable, ...main.immutable]) {
      assert.deepEqual(currentImmutable.find(row => row.id === original.id), original, 'Partial immutable source row changed');
    }
    assert.deepEqual(oneRow(await rows(service.from('pipeline_runs').select('*').eq('id', rejected.id))), rejected);
    await noPublication('acceptance');
    checkPinnedReplayInputs(config, repo);
    checkPrior();
    journal.append('negative-control-verified', { acceptance_verdict: verdict.verdict, publication_blocked: true,
      line_delivery_blocked: true, terminal_complete: false, missing_required_symbol: 'NVDA',
      acceptance_id: verdict.id, provider_receipts_sha256: sha256(JSON.stringify(after)),
      immutable_rows_sha256: sha256(JSON.stringify(currentImmutable)), new_synthetic_users: 0,
      full_persisted_chain_executed: false, downstream_success_stages_not_executed: ['six-intraday-checkpoints', 'content-os-public-export'] });
    return journal.finish('EXPECTED_FAILURE_VERIFIED');
  } catch (error) {
    journal.append('FIRST_FAILURE', { error: String(error.message), expected_failure_verified: false,
      ambiguous_write_not_retried: true, full_chain_pass: false });
    journal.finish('FAIL'); throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], '--config', 'Usage: node --experimental-strip-types tests/integration/coreConsolidationMissingQuote.e2e.mjs --config /private/tmp/<fresh-scope>/replay-config.json');
  assert.ok(process.argv[3], 'Exact fresh-scope config path required');
  await runCoreConsolidationMissingQuote(resolve(process.argv[3]));
}
