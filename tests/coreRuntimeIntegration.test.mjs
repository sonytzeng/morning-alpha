// Loopback HTTP contract test. Identity provider / DB responses are explicit
// isolated fixtures, NOT proof of a real GoTrue login or Production Owner E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolatedEdge, isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { currentResearchDateError, companyEvidenceSupported } from '../supabase/functions/_shared/research-pipeline-contract.ts';
import { candidateEvidenceRelevance } from '../supabase/functions/generate-daily-report-v7/candidate-evidence.ts';
import { hasFailedEvidenceDependency, resolveClaimedPipelineSlot, resolveClaimedPipelineRetry, resolveDailyDeliveryCompletion } from '../supabase/functions/_shared/daily-delivery-recovery.ts';
import { RUNTIME_QUALITY_POLICY } from '../supabase/functions/_shared/production-architecture-core.mjs';
import { dedupePresentedOpportunities } from '../src/lib/decisionPresentation.ts';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));
const read = relative => readFileSync(path(relative), 'utf8');

test('recovered canonical member recommendation survives the actual Opportunities page mapper', () => {
  const source = read('../src/pages/opportunities/page.tsx');
  const map = isolatedFunction(source, 'mapV10OpportunityStocks', {
    asRecordArray: value => Array.isArray(value) ? value : [],
    compactText: value => String(value ?? '').trim(),
    numberOrNull: value => value == null ? null : Number(value),
    stringArray: value => Array.isArray(value) ? value : [],
  });
  const rows = map([{ symbol: '2330', name: '台積電', event_source: '公開公司來源',
    transmission_path: '先進封裝需求傳導至製程供應鏈。', taiwan_supply_chain_relation: '台積電為供應鏈驗證點。',
    confirmation_condition: '09:30 相對大盤轉強且權值同步。', invalidation_condition: '相對大盤轉弱取消觀察。' }]);
  const [stock] = dedupePresentedOpportunities(rows);
  assert.match(stock.oneLineReason, /先進封裝需求/);
  assert.equal(stock.confirmation, '09:30 相對大盤轉強且權值同步。');
  assert.equal(stock.invalidation, '相對大盤轉弱取消觀察。');
  assert.equal(dedupePresentedOpportunities(map([{ symbol: '2330', name: '台積電' }]))[0].confirmation, undefined);
});
const generator = read('../supabase/functions/generate-daily-report-v7/index.ts');
const orchestrator = read('../supabase/functions/daily-delivery-orchestrator/index.ts');

test('atomic reader requires same report/decision/member revision; legacy rows remain compatible', () => {
  const aligned = isolatedFunction(read('../supabase/functions/get-report-payload/index.ts'), 'isPublishedReadAligned', {
    asObject: value => value || {}, toStringValue: value => typeof value === 'string' ? value : '',
  });
  const report = { id: 'r1', report_date: '2026-09-07', ai_strategy_json: { revision_id: 'd1', canonical_member_revision_id: 'm1' } };
  const context = { decisionSnapshot: { id: 'd1', report_id: 'r1', report_date: report.report_date },
    memberContentRevision: { id: 'm2', decision_snapshot_id: 'd1', report_id: 'r1', report_date: report.report_date } };
  assert.equal(aligned(report, context), true);
  assert.equal(aligned({ ...report, ai_strategy_json: {} }, {}), true);
  assert.equal(aligned(report, { ...context, decisionSnapshot: { ...context.decisionSnapshot, id: 'd2' } }), false);
  assert.equal(aligned(report, { ...context, memberContentRevision: { ...context.memberContentRevision, decision_snapshot_id: 'd2' } }), false);
  assert.equal(aligned(report, { ...context, memberContentRevision: { ...context.memberContentRevision, report_date: '2026-09-04' } }), false);
  assert.equal(aligned(report, { ...context, memberContentRevision: null }), false);
  assert.equal(aligned({ ...report, ai_strategy_json: { canonical_member_revision_id: 'm1' } }, context), false);
});

test('actual candidate universe retains Hon Hai source and scoring, rejects other-company spillover, and preserves evidence lineage after four industry rows', () => {
  const deps = { candidateEvidenceRelevance, companyEvidenceSupported };
  for (const name of ['v10Candidate', 'V10_CANDIDATE_METADATA', 'TW_STOCK_WHITELIST', 'addV10TagsFromText',
    'v10PrimaryEventTags', 'extractV10HistoricalSymbols', 'calculateRepeatPenalty',
    'validateV10Range', 'validateV10Text', 'validateV10EvidenceReferenceArray',
    'buildV10EvidenceRefsForTags', 'validateCandidateUniverse', 'buildCandidateUniverse']) {
    deps[name] = isolatedFunction(generator, name, deps);
  }
  const company = { evidence_id: 'NEWS_COMPANY', evidence_type: 'market_news', title: 'Hon Hai AI server sales rise', summary: 'Hon Hai reported new server revenue.', importance: 80 };
  const industry = Array.from({ length: 4 }, (_, i) => ({ evidence_id: `NEWS_CONTEXT_${i}`, evidence_type: 'market_news', title: 'AI server industry grows', summary: 'Industry context only.', importance: 70 }));
  const result = deps.buildCandidateUniverse({ normalizedEvidence: { market_context: { primary_event: { event_type: 'AI_SERVER' } } },
    evidenceIndex: [...industry, company], recentReports: [] });
  const honHai = result.candidates.find(row => row.symbol === '2317');
  assert.equal(honHai.eligibility, true);
  assert.equal(honHai.related_evidence[0].evidence_id, 'NEWS_COMPANY');
  // Production classifies English Hon Hai + AI_SERVER as approved_bridge for
  // this ELECTRONIC_BLUE_CHIP metadata: 80 * 0.85 = 68. Do not raise its score
  // merely because the new company-source gate now establishes eligibility.
  assert.equal(honHai.related_evidence[0].purpose, 'approved_supply_chain_bridge');
  assert.equal(honHai.related_evidence[0].weight, 68);
  assert.equal(honHai.repeat_penalty, 0);
  assert.equal(result.validation.is_valid, true);
  for (const symbol of ['2308', '2356', '2376', '3037']) {
    const stock = result.candidates.find(row => row.symbol === symbol);
    assert.ok(stock, `expected unchanged universe member ${symbol}`);
    assert.equal(stock.eligibility, false, symbol);
    assert.equal(stock.excluded_reason, 'No Company-Specific Source Evidence');
  }
});

test('normal research rejects historical, conflicting and malformed targets before input writes', () => {
  const today = '2026-09-07';
  for (const input of [{}, { report_date: today }, { target_date: today, report_date: today }]) assert.equal(currentResearchDateError(input, today), null);
  for (const input of [{ report_date: '2026-09-04' }, { target_date: today, report_date: '2026-09-04' }]) assert.equal(currentResearchDateError(input, today), 'HISTORICAL_RESEARCH_REGENERATION_UNSUPPORTED');
  for (const value of [null, '', '2026-02-30', 'yesterday']) assert.equal(currentResearchDateError({ report_date: value }, today), 'INVALID_RESEARCH_DATE');
  assert.ok(generator.indexOf('currentResearchDateError(body,todayDate)') < generator.indexOf("const policyResult=await supabase.rpc"));
  assert.ok(orchestrator.indexOf('currentResearchDateError(body, clock.date)') < orchestrator.indexOf('const claim = await claimPipelineSlot'));
});

test('actual recovery action dispatcher suppresses LINE, forwards exact date, preserves refresh dependencies', async () => {
  const calls = [];
  const invoke = async (_base, name, _credential, body) => {
    calls.push({ name, body });
    return { ok: true, status: 200, payload: { success: true } };
  };
  const execute = isolatedFunction(orchestrator, 'executeRecoveryActions', {
    invokeFunction: invoke, invokeFunctionWithRetry: invoke, hasFailedEvidenceDependency,
  });
  const args = { actions: ['refresh_sector_rotation', 'regenerate_report', 'deliver_incident'],
    baseUrl: 'http://127.0.0.1', cronSecret: 'isolated-placeholder', attempt: 1,
    reasonCodes: ['sector_rotation_scores:2026-09-04'], allowIncident: true,
    reportDate: '2026-09-07', suppressNotifications: true };
  await execute(args);
  assert.deepEqual(calls.map(c => c.name), ['generate-sector-rotation', 'generate-daily-report-v7']);
  assert.equal(calls[0].body.target_date, '2026-09-04');
  assert.equal(calls[1].body.report_date, '2026-09-07');
  assert.equal(calls[1].body.suppress_notifications, true);
  calls.length = 0;
  await execute({ ...args, actions: ['deliver_incident'], suppressNotifications: false });
  assert.equal(calls[0].name, 'line-daily-push'); // Normal scheduled behavior preserved.
  assert.match(orchestrator, /if \(!suppressNotifications && state.premium_eligible/);
  assert.match(orchestrator, /delivery_status: suppressNotifications \? 'SUPPRESSED'/);
});

test('Production due-slot retry retained; RUNNING is not success, phase-only generation is not delivery', () => {
  assert.equal(resolveClaimedPipelineSlot('RUNNING').success, false);
  assert.equal(resolveClaimedPipelineSlot('SUCCEEDED').success, true);
  const input = { status: 'FAILED', attempt: 1, next_retry_at: '2026-09-07T00:00:00Z', now_ms: Date.parse('2026-09-07T00:01:00Z') };
  assert.equal(resolveClaimedPipelineRetry(input).retry, true);
  assert.equal(resolveClaimedPipelineRetry({ ...input, attempt: RUNTIME_QUALITY_POLICY.max_recovery_attempts }).retry, false);
  assert.equal(resolveDailyDeliveryCompletion({ phase: 'generate', premium_eligible: true, delivered: false, action_failure_count: 0 }), true);
  assert.equal(resolveDailyDeliveryCompletion({ phase: 'deliver', premium_eligible: true, delivered: false, action_failure_count: 0 }), false);
  for (const phase of ['refresh', 'generate', 'repair', 'deliver', 'watchdog']) {
    assert.equal(resolveDailyDeliveryCompletion({ phase, premium_eligible: true, delivered: true, action_failure_count: 1 }), false);
  }
});

test('suppressed recovery preserves audit semantics within existing Production delivery CHECK', async () => {
  let written;
  const finish = isolatedFunction(orchestrator, 'finishPipelineRun', { asRecord: value => value || {} });
  const client = { from(name) { assert.equal(name, 'pipeline_runs'); return { update(row) { written = row; return { eq: async () => ({ error: null }) }; } }; } };
  await finish(client, 'isolated-run', 'SUCCEEDED', { delivery_status: 'SUPPRESSED', suppress_notifications: true }, [], null);
  assert.equal(written.delivery_status, 'NOT_DUE');
  assert.equal(written.provider_status.delivery_status, 'SUPPRESSED');
  assert.equal(written.provider_status.suppress_notifications, true);
  assert.equal(written.next_retry_at, null);
  for (const status of ['SENT', 'INCIDENT_SENT', 'PENDING', 'NOT_DUE', 'FAILED']) {
    await finish(client, 'isolated-run', 'SUCCEEDED', { delivery_status: status }, [], null);
    assert.equal(written.delivery_status, status);
  }
});

test('real payload handler and SDK over loopback: server roles, locked data, canonical revision, repeat reads, bounded network', async () => {
  const validAi = isolatedFunction(read('./premiumContentGate.test.mjs'), 'validAi');
  const ai = validAi();
  const sentence = ai.today_quote;
  const day = '2026-09-07', revision = '00000000-0000-4000-8000-000000000001';
  const report = { id: '00000000-0000-4000-8000-000000000002', report_date: day, report_mode: 'normal_overnight',
    summary: 'OLD_RAW_THESIS', ai_strategy_json: { ...ai, v8_daily_sentence: { sentence } },
    created_at: `${day}T07:20:00+08:00`, important_news_json: [{ title: '台積電先進封裝需求', source: 'isolated official fixture', url: 'https://example.invalid/fixture' }] };
  const snapshot = { id: revision, report_id: report.id, report_date: day, version: 1, session_type: 'PREMARKET', is_current: true,
    status: 'READY', action: 'SELECTIVE', decision_mode: 'recommendations', content_score: 100, market_regime: 'range',
    created_at: report.created_at, generated_text: { daily_sentence: sentence, recommendations: ai.today_beneficiary_stocks_v10 } };
  const member = { id: 'isolated-member', report_date: day, decision_snapshot_id: revision, decision_snapshot_version: 1,
    revision: 1, status: 'PASSED', semantic_status: 'PASSED', member_content: {
      ...ai.member_research_note_v2, today_core_thesis: sentence, representative_stocks: ai.today_beneficiary_stocks_v10,
      canonical_contract: { snapshot_id: revision, primary_thesis: sentence } } };
  const quotes = ['TAIEX', '2330', 'TXF'].map(symbol => ({ symbol, value: 100, change_percent: 1, source: 'isolated fixture', trading_date: day, phase: 'premarket', captured_at: report.created_at }));
  const trace = [];
  let blocked = false;
  let misaligned = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    let payload = [], status = 200;
    const resource = url.pathname.split('/').pop();
    if (url.pathname === '/auth/v1/user') {
      const identity = req.headers.authorization?.replace('Bearer fixture-', '');
      if (['free', 'member', 'vip', 'admin'].includes(identity)) payload = { id: identity, aud: 'authenticated', user_metadata: { role: 'admin', tier: 'admin' } };
      else { status = 401; payload = { message: 'Invalid isolated identity', code: 'bad_jwt' }; }
    } else if (resource === 'profiles') payload = [{ role: url.searchParams.get('id') === 'eq.admin' ? 'admin' : 'user', subscription_status: 'inactive' }];
    else if (resource === 'ensure_member_entitlement_v1') payload = { state: ['member', 'vip'].includes(body.p_user_id) ? 'paid_active' : 'free', tier: body.p_user_id, access_ends_at: '2099-01-01T00:00:00Z' };
    else if (resource === 'reports') payload = [{ ...report, ai_strategy_json: misaligned ? { ...report.ai_strategy_json, revision_id: 'older-decision', canonical_member_revision_id: 'older-member' }
      : blocked ? { ...report.ai_strategy_json, missing_sources: ['sector_rotation_scores'], data_quality: 'degraded' } : report.ai_strategy_json }];
    else if (resource === 'decision_snapshots') payload = url.searchParams.get('session_type') === 'eq.CLOSING' ? [] : [{ ...snapshot,
      ...(blocked ? { action: 'STOP', decision_mode: 'blocked', status: 'PARTIAL', generated_text: { daily_sentence: '資料不足，研究未發布。', recommendations: [] } } : {}) }];
    else if (resource === 'current_member_content_revisions_v1') payload = blocked ? [] : [member];
    else if (resource === 'market_data_snapshots') payload = quotes;
    trace.push({ method: req.method, path: url.pathname, status }); // No headers/credentials/PII.
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const { handler, diagnostics } = isolatedEdge(path('../supabase/functions/get-report-payload/index.ts'), {
      SUPABASE_URL: endpoint, SUPABASE_SERVICE_ROLE_KEY: 'isolated-non-production-key',
    }, { Date: class extends Date { constructor(value='2026-09-07T02:00:00Z'){ super(value); } } });
    const request = identity => new Request(`${endpoint}/functions/v1/get-report-payload?tier=admin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(identity ? { Authorization: `Bearer fixture-${identity}` } : {}) },
      body: JSON.stringify({ tier: 'vip', report_date: day }),
    });
    for (const identity of [null, 'invalid', 'free', 'member', 'vip', 'admin']) {
      const start = trace.length;
      const response = await handler(request(identity)); assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.tier, [null, 'invalid'].includes(identity) ? 'free' : identity);
      assert.equal(result.authenticated, identity !== null && identity !== 'invalid');
      assert.equal(result.revision_id, revision); assert.equal(result.report_date, day);
      assert.equal(result.payload.daily_sentence, sentence);
      assert.notEqual(result.payload.market_bias, 'range', 'Regime enum must not replace directional bias');
      assert.equal(result.payload.canonical_decision.market_regime, 'range');
      assert.equal(result.payload.v8_daily_sentence.sentence, sentence);
      assert.equal(result.payload.market_data_snapshots.length, 3);
      if (['member', 'vip', 'admin'].includes(identity)) {
        assert.equal(result.payload.premium_content_status, 'eligible', JSON.stringify(result.payload.premium_content_reason_codes));
        assert.equal(result.payload.today_beneficiary_stocks[0].symbol, '2330');
      } else {
        assert.equal(result.payload.today_beneficiary_stocks, undefined);
        assert.ok(result.locked_sections.includes('member_note_full'));
      }
      if (identity === 'admin') {
        assert.equal(result.payload.ai_strategy_json.v8_daily_sentence.sentence, sentence);
        assert.equal(result.payload.admin_source_report.summary, 'OLD_RAW_THESIS');
      } else assert.equal(result.payload.admin_source_report, undefined);
      const evidenceTables = new Set(['market_quotes','news_events','institutional_flows','earnings_events','sector_stock_map','catalyst_tw_mappings','research_catalysts','model_evaluations']);
      const requests = trace.slice(start);
      const evidenceReads = requests.filter(r=>evidenceTables.has(r.path.split('/').pop()));
      assert.equal(evidenceReads.length,8,'exactly one bounded read per evidence dataset');
      assert.equal(new Set(evidenceReads.map(r=>r.path)).size,8,'no evidence retries or duplicate scans');
      assert.ok(evidenceReads.every(r=>r.method==='GET'));
      assert.ok(requests.length-evidenceReads.length<=14,'original Core request budget unchanged');
      assert.equal(result.payload.decision_engine_v1.schema_version,'decision-evidence-v1');
      assert.equal(result.payload.decision_engine_v1.revision_id,revision);
      assert.equal(result.payload.decision_engine_v1.direction_probability,null);
      const repeated = await (await handler(request(identity))).json();
      assert.equal(repeated.revision_id, revision); assert.equal(repeated.tier, result.tier);
    }
    blocked = true;
    for (const identity of ['member', 'admin']) {
      const result = await (await handler(request(identity))).json();
      assert.equal(result.payload.premium_content_status, 'blocked');
      assert.equal(result.payload.canonical_decision.action, 'STOP');
      assert.equal(result.payload.daily_sentence, '資料不足，研究未發布。');
      assert.equal(result.payload.today_beneficiary_stocks?.length || 0, 0);
    }
    blocked = false;
    misaligned = true;
    const raceStart = trace.length;
    const raced = await handler(request(null));
    assert.equal(raced.status, 409);
    const refused = await raced.json();
    assert.equal(refused.error, 'REPORT_REVISION_CHANGED');
    assert.equal(refused.payload, null);
    assert.equal(trace.slice(raceStart).filter(row => row.path === '/rest/v1/reports').length, 2);
    assert.ok(trace.length - raceStart <= 22, 'revision mismatch retry exceeded its fixed budget');
    assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics));
    assert.ok(trace.every(row => row.method === 'GET' || row.path === '/rest/v1/rpc/ensure_member_entitlement_v1'));
    assert.ok(trace.every(row => row.status === 200 || row.path === '/auth/v1/user'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
