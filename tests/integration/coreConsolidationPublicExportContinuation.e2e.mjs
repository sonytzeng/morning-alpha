// Independent 13-handler successor. Exact sealed predecessor: tests/integration/coreConsolidationFullChain.e2e.mjs
// SHA256 b100f04377ab1d3da8f430dde3deb5ca0063ba07ea94fc09ea7722e9f135fa7c; old file is never edited or executed against a reused scope.
// Opt-in real persistent replay. Run with Node 22 --experimental-strip-types.
// Requires a separately bootstrapped fresh local stack; this file authors no SQL,
// never seeds a report/checkpoint/READY state, and never calls a real provider.
import { loadPublicExportContinuation, assertPublicExportPrefixAdoption, PUBLIC_EXPORT_CONTINUATION_TABLES } from '../helpers/coreConsolidationPublicExportContinuation.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadConsolidationFixtures } from '../fixtures/consolidation-v1/index.mjs';
import { loadWarmupContinuation, assertWarmupInputAdoption, assertManualInputContinuation, WARMUP_INPUT_TABLES } from '../helpers/coreConsolidationContinuation.mjs';
import { loadPremarketContinuation, assertPremarketInputAdoption } from '../helpers/coreConsolidationPremarketContinuation.mjs';
import { loadFreshManualContinuation, assertFreshManualInputAdoption, localFetchCorrelationHeaders } from '../helpers/coreConsolidationFreshManualContinuation.mjs';
import { canonicalMarketSourceRefs } from '../../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../../supabase/functions/_shared/market-report-gate.ts';
import { fetchPublishedDeliveryEvidence, evaluatePublishedMarketDelivery } from '../../supabase/functions/_shared/market-publication-contract.ts';
import { validateOpeningPublication, evaluateClosingContract, evaluateLearningContract,
  selectLearningPredictionSamples, resolveClosingReceiptPointer } from '../../supabase/functions/_shared/closing-learning-contract.ts';
import { validateReplayConfiguration, checkPinnedReplayInputs, readNewLocalCredentials, guardedLocalFetch,
  createGuestReadback, createReplayClock, assertClockAgreement, assertCheckpointLineage,
  createReplayJournal, sha256, object, canonicalNumeric, REPLAY_FUNCTIONS } from '../helpers/coreConsolidationPublicExportRuntime.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const success = result => {
  assert.equal(result.http, 200, JSON.stringify({ http: result.http, error_code: result.body.error_code, reason: result.body.reason }));
  assert.equal(result.body.success, true, JSON.stringify({ error_code: result.body.error_code, reason_codes: result.body.reason_codes,
    trading_day_state_error: result.body.trading_day_state_error, reason: result.body.reason, error: result.body.error }));
};
const healthy = result => {
  assert.equal(result.http, 200); assert.equal(result.body.ok, true);
  assert.equal(result.body.status, 'passed', JSON.stringify(result.body.checks));
};

function recheckContinuationInputs(continuation, repo) {
  return loadPublicExportContinuation(continuation.manifest, repo);
}

export async function runCoreConsolidationPublicExportContinuation(configPath) {
  const supplied = JSON.parse(readFileSync(configPath, 'utf8'));
  // Exact source-bound continuation of a retained local export BOOT_ERROR only.
  const continuation = loadPublicExportContinuation(supplied, repo);
  const config = continuation.config;
  checkPinnedReplayInputs(config, repo);
  const credentials = readNewLocalCredentials(config), transport = guardedLocalFetch(config.api_origin);
  const guest = createGuestReadback(config); guest.inspect();
  const clock = createReplayClock(config), journal = createReplayJournal(continuation
    ? { ...config, evidence_directory: continuation.manifest.evidence_directory } : config);
  const service = createClient(config.api_origin, credentials.service_role_key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport },
  });
  const request = async (path, body, auth = 'internal', method = 'POST') => {
    const headers = { 'Content-Type': 'application/json', apikey: credentials.anon_key };
    if (auth === 'internal') Object.assign(headers, { apikey: credentials.service_role_key,
      Authorization: 'Bearer ' + credentials.service_role_key, 'x-cron-secret': credentials.cron_secret });
    else if (auth !== 'anonymous') headers.Authorization = 'Bearer ' + auth;
    Object.assign(headers, localFetchCorrelationHeaders(path, body));
    const response = await transport(config.api_origin + path, { method, headers,
      body: method === 'GET' ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(360000) });
    const text = await response.text();
    let result; try { result = JSON.parse(text); } catch { throw new Error('Non-JSON local response: ' + response.status); }
    return { http: response.status, body: result, response_sha256: sha256(text) };
  };
  const call = async (slug, body = {}, auth = 'internal') => {
    assert.ok(REPLAY_FUNCTIONS.includes(slug));
    const requestBody = { source: 'LOCAL_CONSOLIDATION_SYNTHETIC', ...body };
    journal.append('handler:' + slug, { request_attempted: true, request_body: requestBody,
      request_sha256: sha256(JSON.stringify(requestBody)), response_received: false });
    const result = await request('/functions/v1/' + slug, requestBody, auth);
    journal.append('handler:' + slug, { http: result.http, response_sha256: result.response_sha256,
      response_body: result.body,
      business_success: result.body.success, error_code: result.body.error_code, reason_codes: result.body.reason_codes,
      report_id: result.body.report_id, decision_snapshot_id: result.body.decision_snapshot_id, run_id_returned: result.body.run_id });
    return result;
  };
  const rows = async query => { const result = await query; assert.equal(result.error, null, result.error?.message); return result.data || []; };
  const one = async query => { const data = await rows(query); assert.equal(data.length, 1, 'Expected one actual persisted row'); return data[0]; };
  const boundary = (operation, extra = {}) => request('/functions/v1/' + config.boundary.slug, { operation, scope: config.scope, ...extra });
  let authToken = '', runtimeNow = '';
  async function clockAt(at) {
    const target = new Date(at).toISOString(), observed = clock.observe();
    if (Date.parse(target) >= Date.parse(observed.observed_at)) clock.advance(target);
    else assert.ok(Date.parse(observed.observed_at) - Date.parse(target) <= 10 * 60_000,
      'Phase already expired; never rewind the VM or relabel an old provider batch');
    const before = clock.observe(), postgres = guest.clockWitness();
    const edge = await boundary('clock'); success(edge);
    assert.equal(edge.body.fixture_sha256, config.boundary.fixture_sha256);
    assert.equal(edge.body.boundary_source_sha256, config.boundary.source_sha256);
    const session = await request('/auth/v1/token?grant_type=password', {
      email: credentials.auth.email, password: credentials.auth.password,
    }, 'anonymous');
    assert.equal(session.http, 200); authToken = session.body.access_token;
    assert.ok(typeof authToken === 'string');
    const claims = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64url').toString());
    const verified = await transport(config.api_origin + '/auth/v1/user', {
      headers: { apikey: credentials.anon_key, Authorization: 'Bearer ' + authToken }, redirect: 'error',
    });
    assert.equal(verified.status, 200); const user = await verified.json(), after = clock.observe();
    assertClockAgreement({ scope: config.scope, guest: before, postgres, edge: edge.body,
      auth: { issued_at: claims.iat, user_id: claims.sub, verified_user_id: user.id },
      started: before.observed_at, ended: after.observed_at });
    runtimeNow = edge.body.observed_at;
    journal.append('real-runtime-clock', { target, boot_id: before.boot_id, postgres, edge: edge.body,
      authenticated_session_issued_at: new Date(claims.iat * 1000).toISOString(), real_auth_verified: true,
      host_clock_unchanged: true, business_clock_override: false });
  }
  const report = () => one(service.from('reports').select('*').eq('report_date', config.report_date));
  async function checkpoint(checkpointName, date = config.report_date) {
    const phase = checkpointName === 'PREMARKET' ? 'premarket' : ['1410', '1430'].includes(checkpointName) ? 'close' : 'intraday';
    const correlation = randomUUID();
    const result = await call('fetch-market-data-v10', { phase,
      checkpoint: checkpointName === 'PREMARKET' ? 'premarket' : checkpointName, correlation_id: correlation });
    success(result); assert.equal(result.body.immutable_evidence_complete, true);
    assert.equal(result.body.correlation_id, correlation, 'Real Fetch must preserve x-correlation-id through persistence');
    const [immutable, raw, canonical, compatibility, lifecycle] = await Promise.all([
      rows(service.from('market_checkpoint_snapshots').select('*').eq('trading_date', date).eq('checkpoint', checkpointName)),
      rows(service.from('market_data').select('*')),
      rows(service.from('market_quotes').select('*').eq('trading_date', date).eq('phase', phase)),
      rows(service.from('market_data_snapshots').select('*').eq('trading_date', date)
        .eq('checkpoint', checkpointName === 'PREMARKET' ? 'premarket' : checkpointName)),
      one(service.from('trading_day_state').select('*').eq('trading_date', date)),
    ]);
    const receipt = assertCheckpointLineage({ rows: immutable, raw, canonical, compatibility, lifecycle,
      date, checkpoint: checkpointName });
    journal.append('persisted-checkpoint', { ...receipt, immutable_sha256: sha256(JSON.stringify(immutable)),
      raw_sha256: sha256(JSON.stringify(raw)), canonical_sha256: sha256(JSON.stringify(canonical)), compatibility_sha256: sha256(JSON.stringify(compatibility)),
      producer_readback_verified: true, direct_seed_writes: 0 });
    return immutable;
  }
  async function published() {
    runtimeNow = guest.clockWitness().observed_at;
    const current = await report(), evidence = await fetchPublishedDeliveryEvidence(service, current);
    const gate = evaluateMarketReportGate(current.ai_strategy_json, config.report_date);
    const delivery = evaluatePublishedMarketDelivery(current, evidence.snapshot, evidence.member, gate,
      { publicationRun: evidence.publicationRun, now: runtimeNow, todayDate: config.report_date });
    assert.equal(delivery.eligible, true, JSON.stringify(delivery.reason_codes));
    assert.equal(delivery.projection.recommendation.available, false, 'Control must remain market-only with blocked stocks');
    assert.deepEqual(delivery.projection.recommendation.items, []);
    assert.equal(object(current.ai_strategy_json).market_publication_contract?.schema_version, 'CORE_MARKET_PUBLICATION_V1');
    const opening = validateOpeningPublication({ report: current, snapshot: evidence.snapshot,
      publicationRun: evidence.publicationRun, now: Date.parse(runtimeNow) });
    assert.equal(opening.status, 'PUBLISHED', JSON.stringify(opening.reason_codes));
    journal.append('durable-publication', { report_id: current.id, report_date: current.report_date,
      revision_id: evidence.snapshot.id, member_revision_id: evidence.member.id,
      publication_run_id: evidence.publicationRun.id, opening, recommendation_available: false,
      observed_market_gate: gate, actual_publication_validated: true, diagnostic_scores_not_fixture_seeded: true });
    return { current, evidence, opening, delivery };
  }
  async function closingReadback(opening) {
    runtimeNow = guest.clockWitness().observed_at;
    const current = await report(), id = resolveClosingReceiptPointer(current, opening);
    assert.ok(id, 'Handler did not persist a closing receipt pointer');
    const snapshot = await one(service.from('decision_snapshots').select('*').eq('id', id));
    const contract = evaluateClosingContract({ opening, closingSnapshot: snapshot, expectedSnapshotId: id,
      now: Date.parse(runtimeNow) });
    assert.equal(contract.status, 'COMPLETE', JSON.stringify(contract.reason_codes));
    return { contract, snapshot, sha256: sha256(JSON.stringify(snapshot)) };
  }
  try {
    const actual = { ...continuation.baseline, tables: {}, guest: clock.observe() };
    for (const table of PUBLIC_EXPORT_CONTINUATION_TABLES) actual.tables[table] = await rows(service.from(table).select('*'));
    const audit = await boundary('audit'); success(audit); actual.boundary = audit.body;
    const prefixProof = assertPublicExportPrefixAdoption({ ...continuation, actual });
    journal.append('exact-post-publication-continuation', { ...prefixProof,
      prior_failed_result_sha256: '80b61c535cb1a293c810c386b75af60c71faecebee2a2794fadb0aedb554635a',
      prior_actual_readback_sha256: 'bf0dc4a13973abcb207c205bf52e6fdfb761b8261283e62af854808cae7c193b',
      local_dependency_transform: 'npm:2.57.4 to same-version esm.sh2.57.4',
      production_runtime_packaging_parity_claim: false, original_fail_rewritten: false,
      no_fetch_or_generator_replay: true, source_inventory_sha256: sha256(JSON.stringify(config.source_files)) });
    await clockAt(actual.guest.observed_at);
    const publication = await published();
    async function verifyPublicExport(stage) {
      const slug = 'content-os-morning-alpha-source';
      assert.ok(REPLAY_FUNCTIONS.includes(slug));
      journal.append('handler:' + slug, { request_attempted: true, request_method: 'GET', response_received: false });
      const exported = await request('/functions/v1/' + slug, undefined, 'internal', 'GET');
      journal.append('handler:' + slug, { http: exported.http, response_sha256: exported.response_sha256, response_body: exported.body });
      assert.equal(exported.http, 200, JSON.stringify(exported.body));
      const body = exported.body, frozen = canonicalMarketSourceRefs(publication.evidence.snapshot.generated_text);
      assert.equal(body.contract_version, 'morning_alpha_public_contract_v1');
      assert.equal(body.report_date, config.report_date);
      assert.equal(body.public_topic?.kind, 'market_brief'); assert.equal(body.public_topic?.symbol, undefined);
      assert.deepEqual(body.opportunities, []); assert.equal(body.premium_locked, true);
      assert.equal(body.premium?.locked, true); assert.equal(body.premium?.status, 'BLOCKED');
      assert.equal(body.verification?.decision_snapshot_id, publication.evidence.snapshot.id);
      assert.equal(body.verification?.member_content_revision_id, publication.evidence.member.id);
      assert.equal(body.daily_sentence, publication.delivery.projection.marketDecision.summary);
      assert.ok(Array.isArray(body.source_references) && body.source_references.length > 0);
      for (const reference of body.source_references) {
        assert.equal(new URL(reference.url).protocol, 'https:');
        assert.equal(new URL(reference.url).hostname.endsWith('.invalid'), true, 'Synthetic provenance must remain visible');
        assert.ok(frozen.some(row => ['source', 'title', 'url', 'published_at'].every(key => row[key] === reference[key])),
          'The actual Generator must freeze the exact publicly emitted citation; never add it in this driver');
      }
      const incidents = await rows(service.from('content_os_sync_incidents').select('*').eq('business_date', config.report_date).eq('status', 'OPEN'));
      assert.deepEqual(incidents, [], 'Do not clear or bypass an incident outside the real export handler');
      journal.append('actual-public-export-' + stage, { response_sha256: exported.response_sha256,
        revision_id: publication.evidence.snapshot.id, reference_count: body.source_references.length,
        source_references_from_actual_frozen_generator: true, external_content_os_delivery: false });
    }
    await verifyPublicExport('publication');
    healthy(await call('ma-ops-health-check', { environment: 'development', check_type: 'report', target_date: config.report_date }));
    for (const role of ['anonymous', 'authenticated']) {
      const payload = await call('get-report-payload', { report_date: config.report_date }, role === 'anonymous' ? credentials.anon_key : authToken);
      assert.equal(payload.http, 200); assert.equal(payload.body.report_date, config.report_date);
      assert.equal(payload.body.payload.canonical_decision.id, publication.evidence.snapshot.id);
      assert.deepEqual(payload.body.payload.canonical_decision.recommendations || [], []);
      journal.append('actual-payload', { role, revision_id: payload.body.payload.canonical_decision.id,
        response_sha256: payload.response_sha256, report_responses_mocked: false });
    }
    // Synthetic recipient is an explicit local fixture, never a copied subscriber.
    const lineId = 'U' + journal.runId.replaceAll('-', '');
    const inserted = await service.from('line_subscribers').insert({ line_user_id: lineId,
      display_name: 'LOCAL SYNTHETIC CONSOLIDATION', source: 'local_test', is_active: true });
    assert.equal(inserted.error, null, inserted.error?.message);
    success(await call('line-daily-push'));
    const outboxBefore = await rows(service.from('line_delivery_outbox').select('*').eq('report_date', config.report_date).eq('push_type', 'daily_report'));
    assert.equal(outboxBefore.length, 1); assert.equal(outboxBefore[0].status, 'SENT');
    assert.equal(outboxBefore[0].decision_snapshot_id, publication.evidence.snapshot.id);
    success(await call('line-daily-push'));
    const outboxAfter = await rows(service.from('line_delivery_outbox').select('*').eq('report_date', config.report_date).eq('push_type', 'daily_report'));
    assert.deepEqual(outboxAfter, outboxBefore, 'Actual outbox receipt must remain idempotent');
    const receiver = await boundary('audit'); success(receiver);
    const sends = receiver.body.receipts.filter(r => r.provider === 'line');
    assert.equal(sends.length, 1, 'Only one actual local receiver delivery is allowed');
    assert.deepEqual(sends[0].body.messages, [object(outboxBefore[0].payload).message]);
    const retained = [];
    for (const [cp, time] of [['0900', '09:00'], ['0930', '09:30'], ['1030', '10:30'], ['1300', '13:00'], ['1410', '14:10'], ['1430', '14:30']]) {
      await clockAt(config.report_date + 'T' + time + ':00+08:00');
      const immutable = await checkpoint(cp); retained.push(...immutable);
      if (['0930', '1030', '1300'].includes(cp)) success(await call('opening-market-radar', { checkpoint: cp }));
    }
    success(await call('generate-sector-rotation')); success(await call('close-market-review'));
    success(await call('closing-verification-engine'));
    const closeBefore = await closingReadback(publication.opening);
    success(await call('closing-verification-engine'));
    const closeAfter = await closingReadback(publication.opening);
    assert.equal(closeAfter.sha256, closeBefore.sha256, 'Retry must reuse the durable close fingerprint and row');
    journal.append('durable-closing', closeAfter.contract);
    for (const role of ['anonymous', 'authenticated']) {
      const auth = role === 'anonymous' ? credentials.anon_key : authToken;
      const payload = await call('get-report-payload', { report_date: config.report_date }, auth);
      assert.equal(payload.http, 200); assert.equal(payload.body.subscriber_state.publication, 'PUBLISHED');
      assert.equal(payload.body.subscriber_state.closing, 'COMPLETE');
      assert.equal(payload.body.subscriber_projection.closing.complete, true);
      assert.equal(payload.body.subscriber_projection.closing.openingDecision.revisionId, publication.opening.opening_publication_revision_id);
      assert.deepEqual(payload.body.subscriber_projection.recommendation.items, []);
      const history = await call('get-report-payload', { history_limit: 1 }, auth);
      assert.equal(history.http, 200); assert.equal(history.body.reports.length, 1);
      const row = history.body.reports[0]; assert.equal(row.report_date, config.report_date);
      assert.equal(row.subscriber_state.closing, 'COMPLETE');
      assert.equal(row.closing_contract.closing_snapshot_id, closeAfter.snapshot.id);
      assert.equal(row.closing_contract.opening_publication_revision_id, publication.opening.opening_publication_revision_id);
      journal.append('actual-closing-payload-history', { role, opening_revision_id: publication.opening.opening_publication_revision_id,
        closing_snapshot_id: closeAfter.snapshot.id, payload_sha256: payload.response_sha256, history_sha256: history.response_sha256,
        actual_persistent_readers: true, report_responses_mocked: false });
    }
    await clockAt(config.report_date + 'T14:40:00+08:00');
    success(await call('continuous-learning-engine'));
    const runsBefore = await rows(service.from('learning_runs').select('*').eq('run_date', config.report_date));
    assert.equal(runsBefore.length, 1); assert.equal(runsBefore[0].status, 'succeeded');
    assert.equal(object(runsBefore[0].metadata).learning_contract?.status, 'COMPLETE');
    const rawPredictionsBefore = await rows(service.from('learning_predictions').select('*')
      .eq('report_date', config.report_date).order('id', { ascending: true }));
    const predictions = selectLearningPredictionSamples(rawPredictionsBefore
      .filter(row => row.decision_snapshot_id === publication.opening.opening_publication_revision_id));
    assert.ok(predictions.length > 0, 'Actual frozen-opening market prediction required');
    const allOutcomesBefore = await rows(service.from('prediction_outcomes').select('*')
      .in('prediction_id', rawPredictionsBefore.map(row => row.id)).order('id', { ascending: true }));
    const outcomes = allOutcomesBefore.filter(row => predictions.some(prediction => prediction.id === row.prediction_id));
    runtimeNow = guest.clockWitness().observed_at;
    const learning = evaluateLearningContract({ opening: publication.opening, closing: closeAfter.contract, predictions, outcomes, now: Date.parse(runtimeNow) });
    assert.equal(learning.status, 'COMPLETE', JSON.stringify(learning.reason_codes));
    success(await call('continuous-learning-engine'));
    const runsAfter = await rows(service.from('learning_runs').select('*').eq('run_date', config.report_date));
    assert.deepEqual(runsAfter, runsBefore, 'Learning retry must reuse real persisted results');
    const rawPredictionsAfter = await rows(service.from('learning_predictions').select('*')
      .eq('report_date', config.report_date).order('id', { ascending: true }));
    assert.deepEqual(rawPredictionsAfter, rawPredictionsBefore, 'Learning retry must not add/rewrite prediction rows, including deduplicated or invalid rows');
    const allOutcomesAfter = await rows(service.from('prediction_outcomes').select('*')
      .in('prediction_id', rawPredictionsAfter.map(row => row.id)).order('id', { ascending: true }));
    assert.deepEqual(allOutcomesAfter, allOutcomesBefore, 'Learning retry must not add/rewrite actual outcome rows');
    journal.append('durable-learning', { contract: learning, run_id: runsAfter[0].id,
      prediction_ids: predictions.map(row => row.id), outcome_ids: outcomes.map(row => row.id),
      all_prediction_rows_sha256: sha256(JSON.stringify(rawPredictionsAfter)), all_outcome_rows_sha256: sha256(JSON.stringify(allOutcomesAfter)),
      raw_whole_set_retry_verified: true,
      historical_120_day_lane: 'NOT_DEMONSTRATED_BY_SINGLE_DAY_REPLAY' });
    await clockAt(config.report_date + 'T15:15:00+08:00');
    healthy(await call('ma-ops-health-check', { environment: 'development', check_type: 'closing', target_date: config.report_date }));
    // The direct health handler does not write DAY_COMPLETED. Exercise the real,
    // explicitly manual recovery handler; never seed the terminal lifecycle row
    // or impersonate a natural scheduled dispatch in this synthetic control.
    const completion = await call('daily-delivery-orchestrator', { mode: 'health_check', check_type: 'closing',
      source: 'ma-ops-safe-recovery', target_date: config.report_date });
    success(completion); assert.equal(completion.body.health?.status, 'passed');
    const lifecycle = await one(service.from('trading_day_state').select('*').eq('trading_date', config.report_date));
    assert.equal(lifecycle.current_state, 'DAY_COMPLETED');
    assert.equal(object(object(lifecycle.checkpoint_status).day_completed).status, 'SUCCEEDED');
    journal.append('actual-manual-terminal-handler', { handler: 'daily-delivery-orchestrator', mode: 'health_check',
      source: 'ma-ops-safe-recovery', natural_scheduler_executed: false, automatic_stable_day: false,
      lifecycle_sha256: sha256(JSON.stringify(lifecycle)), recovery_lifecycle: completion.body.recovery_lifecycle });
    await clockAt(config.report_date + 'T15:35:00+08:00');
    await verifyPublicExport('closing');
    // This is the unmodified actual private RPC, only after fresh local isolation checks.
    guest.inspect();
    const acceptance = await service.rpc('capture_morning_alpha_acceptance_v1', {
      p_business_date: config.report_date, p_evaluator_version: 'LOCAL_CONSOLIDATION_SYNTHETIC_FULL_DAY',
    });
    assert.equal(acceptance.error, null, acceptance.error?.message);
    const result = await one(service.from('production_acceptance_results').select('*').eq('id', acceptance.data));
    journal.append('actual-acceptance', result);
    assert.equal(result.verdict, 'PASS'); assert.equal(object(result.evidence).automatic_stable_day, false);
    assert.equal(object(result.evidence).content_handoff_evidence_scope, 'PROJECTION_CONTRACT_ONLY_NOT_DOWNSTREAM_DELIVERY');
    const currentRows = await rows(service.from('market_checkpoint_snapshots').select('*').eq('trading_date', config.report_date));
    for (const original of retained) assert.deepEqual(currentRows.find(row => row.id === original.id), original, 'Immutable evidence changed after Closing/Learning');
    checkPinnedReplayInputs(config, repo);
    recheckContinuationInputs(continuation, repo);
    return journal.finish('PASS');
  } catch (error) {
    journal.append('FIRST_FAILURE', { error: String(error.message), full_chain_pass: false });
    journal.finish('FAIL'); throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], '--config', 'Usage: node --experimental-strip-types tests/integration/coreConsolidationPublicExportContinuation.e2e.mjs --config /private/tmp/<fresh-scope>/replay-config.json');
  await runCoreConsolidationPublicExportContinuation(resolve(process.argv[3]));
}
