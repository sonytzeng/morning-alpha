// Loopback HTTP contract test. Identity provider / DB responses are explicit
// isolated fixtures, NOT proof of a real GoTrue login or Production Owner E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { isolatedEdge, isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { currentResearchDateError, companyEvidenceSupported } from '../supabase/functions/_shared/research-pipeline-contract.ts';
import { candidateEvidenceRelevance } from '../supabase/functions/generate-daily-report-v7/candidate-evidence.ts';
import { hasFailedEvidenceDependency, resolveClaimedPipelineSlot, resolveClaimedPipelineRetry, resolveDailyDeliveryCompletion } from '../supabase/functions/_shared/daily-delivery-recovery.ts';
import { RUNTIME_QUALITY_POLICY } from '../supabase/functions/_shared/production-architecture-core.mjs';
import { getSubscriberOpportunityList } from '../src/lib/subscriberOpportunities.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { assembleCanonicalMarketResearch, assembleResearchMasterV2, admitResearchRecommendations, validateResearchMasterV2 } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));
const read = relative => readFileSync(path(relative), 'utf8');
const { Request } = globalThis;

test('recovered canonical member recommendation survives the actual Opportunities page mapper', () => {
  const ai = subscriberProjectionFixture('READY');
  ai.canonical_decision.recommendations = [{ symbol: '2330', name: '台積電', event_source: '公開公司來源',
    transmission_path: '先進封裝需求傳導至製程供應鏈。', taiwan_supply_chain_relation: '台積電為供應鏈驗證點。',
    confirmation_condition: '09:30 相對大盤轉強且權值同步。', invalidation_condition: '相對大盤轉弱取消觀察。' }];
  const [stock] = getSubscriberOpportunityList(ai);
  assert.match(stock.oneLineReason, /先進封裝需求/);
  assert.equal(stock.confirmation, '09:30 相對大盤轉強且權值同步。');
  assert.equal(stock.invalidation, '相對大盤轉弱取消觀察。');
  ai.canonical_decision.recommendations = [{ symbol: '2330', name: '台積電' }];
  assert.equal(getSubscriberOpportunityList(ai)[0].confirmation, undefined);
  ai.premium_content_status = 'blocked';
  assert.deepEqual(getSubscriberOpportunityList(ai), [], 'the formatter cannot bypass the independent paid evidence gate');
});
const generator = read('../supabase/functions/generate-daily-report-v7/index.ts');
const orchestrator = read('../supabase/functions/daily-delivery-orchestrator/index.ts');

test('server payload rejects future snapshot cutoffs and impossible future checkpoint completion',()=>{
  const source=read('../supabase/functions/get-report-payload/index.ts');
  const deps={asObject:value=>value&&typeof value==='object'?value:{},toStringValue:value=>typeof value==='string'?value:''};
  const observable=isolatedFunction(source,'observableTradingDayState',deps);
  const now=Date.parse('2026-09-08T02:00:00Z');
  const original={trading_date:'2026-09-08',checkpoint_status:{
    '0900':{status:'SUCCEEDED',updated_at:'2026-09-08T01:00:10Z',metadata:{core_batch_complete:true}},
    '1300':{status:'SUCCEEDED',updated_at:'2026-09-08T05:00:10Z',metadata:{core_batch_complete:true}},
  }};
  const result=observable(original,now);
  assert.equal(result.checkpoint_status['0900'].status,'SUCCEEDED');
  assert.equal(result.checkpoint_status['1300'].status,'INSUFFICIENT_DATA');
  assert.equal(result.checkpoint_status['1300'].metadata.core_batch_complete,false);
  assert.equal(original.checkpoint_status['1300'].status,'SUCCEEDED','Do not mutate stored evidence');
  deps.toIsoTimestamp=isolatedFunction(source,'toIsoTimestamp',deps);
  const cutoff=isolatedFunction(source,'getDataAsOf',deps);
  assert.equal(cutoff({data_as_of:'2026-09-01T00:00:00Z'},{marketDataSnapshots:[{captured_at:'2099-09-01T00:00:00Z'}]}),'2026-09-01T00:00:00.000Z');
  assert.match(source,/\.lte\("captured_at", new Date\(\)\.toISOString\(\)\)/);
});

test('atomic market reader requires same published report/decision; paid member quality is independent', () => {
  const aligned = isolatedFunction(read('../supabase/functions/get-report-payload/index.ts'), 'isPublishedReadAligned', {
    getAi: report => report.ai_strategy_json || {}, toStringValue: value => typeof value === 'string' ? value : '',
  });
  const report = { id: 'r1', report_date: '2026-09-07', ai_strategy_json: { revision_id: 'd1', canonical_member_revision_id: 'm1' } };
  const context = { decisionSnapshot: { id: 'd1', report_id: 'r1', report_date: report.report_date },
    memberContentRevision: { id: 'm2', decision_snapshot_id: 'd1', report_id: 'r1', report_date: report.report_date } };
  assert.equal(aligned(report, context), true);
  assert.equal(aligned({ ...report, ai_strategy_json: {} }, {}), true);
  assert.equal(aligned({ ...report, ai_strategy_json: {} }, { decisionSnapshot: null }), true);
  assert.equal(aligned({ ...report, ai_strategy_json: {} }, context), false,
    'a detached QA snapshot must not supply a missing committed publication pointer');
  assert.equal(aligned(report, { ...context, decisionSnapshot: { ...context.decisionSnapshot, id: 'd2' } }), false);
  // Internal/member QA cannot take the market report off-line. The member
  // reader has its own strict identity+semantic checks, exercised separately.
  assert.equal(aligned(report, { ...context, memberContentRevision: { ...context.memberContentRevision, decision_snapshot_id: 'd2' } }), true);
  assert.equal(aligned(report, { ...context, memberContentRevision: { ...context.memberContentRevision, report_date: '2026-09-04' } }), true);
  assert.equal(aligned(report, { ...context, memberContentRevision: null }), true);
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
  assert.match(orchestrator, /if \(!suppressNotifications && state.report_eligible/);
  assert.match(orchestrator, /!actionResults.deliver_premium/,'one delivery attempt per orchestrator invocation');
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
  // Reuse the actual assembler/admission fixture, not a Premium-only master
  // stub. Shift its synthetic date tuple together; no evidence counter is edited.
  const fixtureRead = file => read('../' + file);
  const fixtureDeps = { exports: {}, isolatedFunction, read: fixtureRead, assert, structuredClone, assembleCanonicalMarketResearch,
    assembleResearchMasterV2, admitResearchRecommendations, validateResearchMasterV2,
    buildCanonicalMarketState, canonicalMarketSourceRefs, evaluateMarketReportGate, evaluatePremiumContentGate };
  const currentSource = read('./consolidationCurrentPayloadAuthority.test.mjs');
  const f = isolatedFunction(currentSource, 'currentPayloadFixture', { ...fixtureDeps, fixtureDeps })();
  isolatedFunction(currentSource, 'qualifyCurrentFixture', fixtureDeps)(f);
  const shift = value => JSON.parse(JSON.stringify(value).replaceAll('2026-07-14', '2026-09-07').replaceAll('2026-07-13', '2026-09-06'));
  const report = shift(f.report), snapshot = shift(f.snapshot), member = shift(f.member), publicationRun = shift(f.publicationRun);
  report.summary = 'OLD_RAW_THESIS'; snapshot.market_regime = 'range';
  const ai = report.ai_strategy_json, day = report.report_date, revision = snapshot.id;
  const sentence = snapshot.generated_text.canonical_market_state.document.sections.executive_summary.text;
  assert.equal(evaluateMarketReportGate(ai, day).eligible, true);
  assert.equal(evaluateMarketReportGate(ai, day).recommendation_gate.eligible, true);
  const quotes = ['TAIEX', '2330', 'TXF'].map(symbol => ({ symbol, value: 100, change_percent: 1, source: 'isolated fixture', trading_date: day, phase: 'premarket', captured_at: report.created_at }));
  const trace = [];
  let blocked = false;
  let misaligned = false;
  let semanticMisaligned = false;
  let history = false;
  const historyFixture = isolatedFunction(read('./consolidationPerformanceHistory.test.mjs'), 'fixture', {
    isolatedFunction, read: file => read('../' + file), assert, structuredClone, assembleCanonicalMarketResearch,
    buildCanonicalMarketState, canonicalMarketSourceRefs, evaluateMarketReportGate,
  })();
  historyFixture.snapshot.confidence_score = 67;
  const historyPartial = { ...report, id: '00000000-0000-4000-8000-000000000004', report_date: '2026-09-06', confidence_score: 100,
    summary: 'QA 原劇本失效，不得作為公開歷史摘要', ai_strategy_json: { ...report.ai_strategy_json,
      confidence_score: 100, revision_id: '00000000-0000-4000-8000-000000000003' } };
  const historyDecisions = [historyFixture.snapshot, historyFixture.closingSnapshot,
    { ...snapshot, id: historyPartial.ai_strategy_json.revision_id, report_id: historyPartial.id, report_date: historyPartial.report_date,
      status: 'PARTIAL', action: 'STOP', confidence_score: 100, generated_text: { daily_sentence: historyPartial.summary } }];
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
    else if (resource === 'reports') payload = history ? [{ ...historyFixture.report, confidence_score: 100 }, historyPartial] : [{ ...report, ai_strategy_json: misaligned ? { ...report.ai_strategy_json, revision_id: 'older-decision', canonical_member_revision_id: 'older-member' }
      : blocked ? { ...report.ai_strategy_json, missing_sources: ['sector_rotation_scores'], data_quality: 'degraded' } : report.ai_strategy_json }];
    else if (resource === 'decision_snapshots') payload = history ? historyDecisions : url.searchParams.get('session_type') === 'eq.CLOSING' ? [] : [{ ...snapshot,
      ...(blocked ? { action: 'STOP', decision_mode: 'blocked', status: 'PARTIAL', generated_text: { daily_sentence: '資料不足，研究未發布。', recommendations: [] } } : {}) }];
    else if (resource === 'pipeline_runs') payload = history ? [historyFixture.publicationRun] : [publicationRun];
    else if (resource === 'member_content_revisions' || resource === 'current_member_content_revisions_v1') payload = history ? [historyFixture.member] : blocked ? [] : [{ ...member,
      semantic_coherence_reviews: [{ status: 'PASSED', reason_codes: [], checked_at: report.created_at,
        canonical_snapshot_id: semanticMisaligned ? 'wrong-semantic-revision' : revision,
        canonical_snapshot_version: snapshot.version }] }];
    else if (resource === 'market_data_snapshots') payload = quotes;
    trace.push({ method: req.method, path: url.pathname, status, limit: url.searchParams.get('limit'),
      batchedRevisionRead: resource === 'decision_snapshots' && (url.searchParams.get('id') || '').startsWith('in.') }); // No headers/credentials/PII.
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
      assert.ok(requests.length-evidenceReads.length<=14, `original Core request budget unchanged: ${JSON.stringify(requests.filter(r => !evidenceTables.has(r.path.split('/').pop())))}`);
      assert.equal(result.payload.decision_engine_v1.schema_version,'decision-evidence-v1');
      assert.equal(result.payload.decision_engine_v1.revision_id,revision);
      assert.equal(result.payload.decision_engine_v1.direction_probability,null);
      const repeated = await (await handler(request(identity))).json();
      assert.equal(repeated.revision_id, revision); assert.equal(repeated.tier, result.tier);
    }
    history = true;
    const historyStart = trace.length;
    const historyResponse = await handler(new Request(`${endpoint}/functions/v1/get-report-payload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history_limit: 3 }),
    }));
    assert.equal(historyResponse.status, 200);
    const historical = await historyResponse.json();
    assert.equal(historical.reports.length, 2);
    const [publishedHistory, partialHistory] = historical.reports;
    assert.equal(publishedHistory.report_date, historyFixture.report.report_date);
    assert.equal(publishedHistory.revision_id, historyFixture.snapshot.id);
    assert.equal(publishedHistory.subscriber_state.publication, 'PUBLISHED'); assert.equal(publishedHistory.subscriber_state.analysis, 'READY');
    assert.equal(publishedHistory.confidence_score, 67);
    assert.equal(publishedHistory.summary, historyFixture.snapshot.generated_text.canonical_market_state.document.sections.executive_summary.text);
    assert.equal(publishedHistory.subscriber_projection.closing.complete, true);
    assert.equal(publishedHistory.subscriber_projection.closing.result.actual_taiex_change, 0);
    assert.equal(partialHistory.report_date, historyPartial.report_date);
    assert.equal(partialHistory.revision_id, historyPartial.ai_strategy_json.revision_id);
    assert.equal(partialHistory.subscriber_state.publication, 'UNPUBLISHED'); assert.equal(partialHistory.subscriber_state.analysis, 'PARTIAL');
    assert.equal(partialHistory.confidence_score, null); assert.equal(partialHistory.summary, '今日分析尚未完成／證據不足');
    assert.equal(partialHistory.market_bias, '分析尚未完成');
    const historyRequests = trace.slice(historyStart);
    assert.equal(historyRequests.length, 4, 'History uses reports plus three bounded evidence batches, no per-row contexts');
    assert.equal(historyRequests[0].limit, '3');
    const snapshotRead = historyRequests.find(row => row.path.endsWith('/decision_snapshots'));
    assert.equal(snapshotRead.limit, '90'); assert.equal(snapshotRead.batchedRevisionRead, true);
    assert.equal(historyRequests.find(row => row.path.endsWith('/member_content_revisions')).limit, '30');
    assert.ok(Number(historyRequests.find(row => row.path.endsWith('/pipeline_runs')).limit) <= 121);
    history = false;
    semanticMisaligned = true;
    const wrongSemantic = await (await handler(request('member'))).json();
    assert.equal(wrongSemantic.payload.premium_content_status, 'blocked', 'PASSED review for another revision is not Premium evidence');
    assert.ok(wrongSemantic.payload.premium_content_reason_codes.includes('SEMANTIC_MEMBER_REVISION_NOT_ELIGIBLE'));
    assert.equal(wrongSemantic.payload.today_beneficiary_stocks?.length || 0, 0);
    semanticMisaligned = false;
    blocked = true;
    for (const identity of ['member', 'admin']) {
      const result = await (await handler(request(identity))).json();
      assert.equal(result.payload.premium_content_status, 'blocked');
      assert.equal(result.payload.canonical_decision.action, 'WAIT', 'Unpublished PARTIAL is not a failed market thesis');
      assert.equal(result.payload.canonical_decision.status, 'PARTIAL');
      assert.equal(result.payload.daily_sentence, '今日分析尚未完成／證據不足');
      assert.equal(result.payload.subscriber_state.publication, 'UNPUBLISHED');
      assert.equal(result.payload.subscriber_state.analysis, 'PARTIAL');
      assert.equal(result.payload.confidence_score, null);
      assert.equal(result.payload.decision_engine_v1.model_confidence, null);
      assert.equal(result.payload.closing_verification, null);
      assert.equal(result.report_date, day); assert.equal(result.revision_id, revision);
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
