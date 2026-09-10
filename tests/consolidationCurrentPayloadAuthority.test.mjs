// Actual Edge handler + installed Supabase SDK + shared production validators.
// All DB/Auth HTTP responses are synthetic loopback fixtures: no GoTrue/RLS,
// SQL persistence, providers, Production, or producer E2E claim is made here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolatedEdge, isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch, assembleResearchMasterV2, admitResearchRecommendations, validateResearchMasterV2 } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportContract.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fixtureDeps = { isolatedFunction, read, assert, structuredClone, assembleCanonicalMarketResearch,
  buildCanonicalMarketState, canonicalMarketSourceRefs, evaluateMarketReportGate };
export function currentPayloadFixture() {
  const f = isolatedFunction(read('tests/consolidationPerformanceHistory.test.mjs'), 'fixture', fixtureDeps)();
  f.now = `${f.report.report_date}T15:00:00+08:00`;
  f.report.confidence_score = 100;
  f.report.ai_strategy_json.closing_verification_v2 = {
    ...structuredClone(f.closingSnapshot.generated_text.closing_verification_v2),
    missing_data: [], actual_taiex_change: 99,
  };
  return f;
}

export function qualifyCurrentFixture(f) {
  const input = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture')();
  const ai = f.report.ai_strategy_json;
  const premium = isolatedFunction(read('tests/premiumContentGate.test.mjs'), 'validAi')();
  const sentence = ai.today_quote;
  const news = input.evidenceIndex.find(row => row.evidence_id === 'NEWS001');
  Object.assign(news, { title: '2330 台積電營收更新', summary: '台積電 2330 營收更新，半導體主線需再由市場同步確認。', source: 'Company IR' });
  input.candidateUniverse.candidates[0].related_evidence = [{ evidence_id: 'NEWS001' }, { evidence_id: 'SEC001' }];
  input.legacy = { ...input.legacy, ...premium, today_quote: sentence, today_core_thesis: sentence,
    v8_daily_sentence: { sentence }, free_summary: { one_sentence: sentence },
    member_research_note_v2: { ...input.legacy.member_research_note_v2, ...premium.member_research_note_v2, today_core_thesis: sentence },
    today_beneficiary_stocks_v10: premium.today_beneficiary_stocks_v10.map(row => ({ ...row,
      trigger_event: news.title, entry_condition: '09:30 台積電與台股量價同步後再確認，不在事件前先追價。',
      reason: 'SOX 與台積電營收更新支持半導體主線，再由台灣先進製程及封裝量價反應驗證。',
      data_basis: 'NEWS001; https://investor.tsmc.com/; market_data:SOX' })) };
  const admitted = admitResearchRecommendations(input);
  assert.equal(admitted.accepted.length, 1, JSON.stringify(admitted));
  input.legacy.today_beneficiary_stocks_v10 = admitted.accepted;
  const stockDocument = assembleResearchMasterV2(input);
  stockDocument.quality = validateResearchMasterV2(stockDocument, input).quality;
  Object.assign(ai, input.legacy, { canonical_market_state: f.snapshot.generated_text.canonical_market_state,
    research_master_v2: f.snapshot.generated_text.canonical_market_state.document,
    stock_research: { document: stockDocument }, v10_analysis_debug: { evidence_index: input.evidenceIndex } });
  f.snapshot.decision_mode = 'recommendations'; f.snapshot.action = 'SELECTIVE';
  f.snapshot.generated_text.recommendations = admitted.accepted;
  f.member.member_content = { ...input.legacy.member_research_note_v2,
    representative_stocks: admitted.accepted, beneficiary_candidates: admitted.accepted,
    canonical_contract: { ...f.member.canonical_contract, decision_mode: 'recommendations', primary_symbols: ['2330'] } };
  assert.equal(evaluatePremiumContentGate(ai, 0).eligible, true, JSON.stringify(evaluatePremiumContentGate(ai, 0)));
  assert.equal(evaluateMarketReportGate(ai, f.report.report_date).recommendation_gate.eligible, true,
    JSON.stringify(evaluateMarketReportGate(ai, f.report.report_date).recommendation_gate));
  return f;
}

async function runPayload(f, { identity = null, failTable = null } = {}) {
  const trace = []; let callbackError = null;
  const tables = { reports: [f.report], decision_snapshots: [...f.evidence.snapshots.values()],
    member_content_revisions: [...f.evidence.members.values()], pipeline_runs: f.evidence.runs,
    opening_market_radar: [], sector_rotation_scores: [], market_data_snapshots: [], trading_day_state: [],
    close_market_reviews: [], learning_runs: [], learning_metric_corrections: [],
    market_quotes: [], news_events: [], institutional_flows: [], earnings_events: [], sector_stock_map: [],
    catalyst_tw_mappings: [], research_catalysts: [], model_evaluations: [] };
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1');
      const url = new URL(request.url, 'http://127.0.0.1'), table = url.pathname.split('/').at(-1);
      trace.push({ table, method: request.method, query: Object.fromEntries(url.searchParams) });
      let data;
      if (url.pathname === '/auth/v1/user') {
        assert.equal(identity, 'member'); data = { id: 'synthetic-member-user', aud: 'authenticated' };
      } else if (table === 'profiles') data = [{ role: 'user', subscription_status: 'inactive' }];
      else if (table === 'ensure_member_entitlement_v1') {
        assert.equal(request.method, 'POST');
        data = { state: 'paid_active', tier: 'member', access_ends_at: '2099-01-01T00:00:00Z' };
      } else {
        assert.equal(request.method, 'GET', 'Business evidence is read-only');
        assert.ok(Object.hasOwn(tables, table), `Unexpected query ${table}`);
        data = tables[table];
        // Apply exact identity filters used by the real SDK. Never return a
        // fixture row solely because its date or table happens to match.
        data = data.filter(row => [...url.searchParams].every(([key, raw]) => {
          if (!raw.startsWith('eq.') && !raw.startsWith('in.')) return true;
          const value = key.split(/->>?/).reduce((object, part) => object?.[part], row);
          return raw.startsWith('eq.') ? String(value) === raw.slice(3)
            : raw.slice(4, -1).split(',').map(value => value.replace(/^"|"$/g, '')).includes(String(value));
        }));
      }
      response.writeHead(table === failTable ? 500 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(table === failTable ? { message: 'Synthetic reader failure', code: 'XX000' } : data));
    } catch (error) { callbackError = error; response.writeHead(500); response.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const { handler, diagnostics } = isolatedEdge(fileURLToPath(new URL('../supabase/functions/get-report-payload/index.ts', import.meta.url)), {
    SUPABASE_URL: endpoint, SUPABASE_SERVICE_ROLE_KEY: 'LOCAL_SYNTHETIC_READER_NOT_A_SECRET',
  }, { Date: class extends Date { constructor(value = f.now) { super(value); } static now() { return Date.parse(f.now); } } });
  const before = JSON.stringify(f);
  try {
    const response = await handler(new Request(endpoint + '/functions/v1/get-report-payload', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(identity ? { authorization: 'Bearer synthetic-local-member' } : {}) },
      body: JSON.stringify({ report_date: f.report.report_date, tier: 'admin' }),
    }));
    const body = await response.json();
    if (callbackError) throw callbackError;
    assert.equal(JSON.stringify(f), before, 'Actual reader never mutates stored fixture evidence');
    const projection = body.payload ? getSubscriberReportProjection(body) : null;
    return { status: response.status, body, projection, trace, diagnostics };
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test('actual current handler retains verified publication, frozen summary, exact close and genuine zero', async () => {
  const f = currentPayloadFixture(), result = await runPayload(f);
  assert.equal(result.status, 200); assert.equal(result.body.tier, 'free');
  assert.equal(result.projection.analysisAvailable, true); assert.equal(result.projection.closing.complete, true);
  assert.equal(result.projection.confidence.value, 64); assert.equal(result.projection.closing.result.actual_taiex_change, 0);
  assert.equal(result.projection.identity.reportDate, f.report.report_date);
  assert.equal(result.projection.identity.revisionId, f.snapshot.id);
  assert.equal(result.body.payload.daily_sentence, f.snapshot.generated_text.canonical_market_state.document.sections.executive_summary.text);
  assert.equal(result.body.payload.today_beneficiary_stocks, undefined);
  assert.equal(result.trace.filter(row => row.table === 'decision_snapshots').length, 1);
  assert.ok(result.trace.find(row => row.table === 'decision_snapshots').query.id.startsWith('in.'));
  assert.ok(result.trace.find(row => row.table === 'pipeline_runs').query['provider_status->result->>decision_snapshot_id'].startsWith('in.'));
  assert.equal(result.trace.some(row => row.query.is_current || row.query.session_type), false);
  assert.deepEqual(result.diagnostics, []);
});

for (const [name, mutate, analysis] of [
  ['missing actual publication receipt', f => { f.evidence.runs = []; }, false],
  ['malformed frozen CMS cannot borrow current healthy draft', f => { f.snapshot.generated_text.canonical_market_state = { status: 'INSUFFICIENT_EVIDENCE' }; }, false],
  ['current failed CMS cannot revoke a valid frozen publication', f => { f.report.ai_strategy_json.canonical_market_state = { status: 'INSUFFICIENT_EVIDENCE' }; }, true],
  ['raw completed close cannot replace missing durable snapshot', f => { f.evidence.snapshots.delete(f.closingSnapshot.id); }, true],
  ['wrong publication receipt date', f => { f.publicationRun.provider_status.result.report_date = '2026-07-13'; }, false],
  ['wrong publication receipt revision', f => { f.publicationRun.provider_status.result.decision_snapshot_id = 'foreign'; }, false],
  ['wrong frozen opening revision', f => { f.report.ai_strategy_json.market_publication_contract.opening_publication_revision_id = 'foreign'; }, true],
  ['wrong durable close opening revision', f => { f.closingSnapshot.generated_text.opening_decision_snapshot_id = 'foreign'; }, true],
  ['late opening never establishes a close evaluation', f => { f.snapshot.valid_from = `${f.report.report_date}T09:01:00+08:00`; }, false],
  ['PARTIAL raw100 never publishes', f => { f.snapshot.status = 'PARTIAL'; f.snapshot.confidence_score = 100; }, false],
]) test(`actual current handler authority: ${name}`, async () => {
  const f = currentPayloadFixture(); mutate(f); const result = await runPayload(f);
  assert.equal(result.status, 200); assert.equal(result.projection.analysisAvailable, analysis);
  assert.equal(result.projection.closing.complete, name === 'current failed CMS cannot revoke a valid frozen publication');
  assert.notEqual(result.projection.confidence.value, 100);
  assert.equal(result.projection.recommendation.available, false); assert.equal(result.body.payload.one_teaser_stock, null);
  assert.equal(result.body.payload.today_beneficiary_stocks, undefined);
  if (!analysis) { assert.equal(result.projection.confidence.value, null); assert.equal(result.body.payload.content_publish_gate.overall_status, 'blocked'); }
});

test('qualified company evidence + independent Premium preserves member stock positive control', async () => {
  const f = qualifyCurrentFixture(currentPayloadFixture()), result = await runPayload(f, { identity: 'member' });
  assert.equal(result.status, 200); assert.equal(result.body.tier, 'member');
  assert.equal(result.projection.analysisAvailable, true); assert.equal(result.projection.recommendation.available, true);
  assert.equal(result.body.payload.premium_content_status, 'eligible');
  assert.equal(result.body.payload.today_beneficiary_stocks[0].symbol, '2330');
});

for (const [name, mutate] of [
  ['Premium blocked', f => { f.report.ai_strategy_json.member_value_score = 0; }],
  ['explicit canonical recommendations empty', f => { f.snapshot.generated_text.recommendations = []; }],
  ['current company source stale', f => { f.report.ai_strategy_json.v10_analysis_debug.evidence_index.find(row => row.evidence_id === 'NEWS001').freshness = 'stale'; }],
]) test(`member stocks cannot revive through note aliases: ${name}`, async () => {
  const f = qualifyCurrentFixture(currentPayloadFixture()); mutate(f); const result = await runPayload(f, { identity: 'member' });
  assert.equal(result.status, 200); assert.equal(result.projection.analysisAvailable, true);
  assert.equal(result.projection.recommendation.available, false); assert.equal(result.body.payload.one_teaser_stock, null);
  assert.equal(result.body.payload.today_beneficiary_stocks, undefined);
  assert.equal(result.body.payload.canonical_decision.recommendations, undefined);
});

test('publication evidence query failure returns explicit unavailable response, not an unhandled or legacy fallback', async () => {
  const result = await runPayload(currentPayloadFixture(), { failTable: 'pipeline_runs' });
  assert.equal(result.status, 503); assert.equal(result.body.error, 'REPORT_EVIDENCE_QUERY_FAILED');
  assert.equal(result.body.payload, null); assert.equal(result.projection, null);
  assert.ok(result.diagnostics.some(row => row.includes('GET_REPORT_PAYLOAD_EVIDENCE_QUERY_FAILED')));
});
