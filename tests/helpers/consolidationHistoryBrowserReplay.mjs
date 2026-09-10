// Actual get-report-payload handler + installed SDK, synthetic loopback DB HTTP
// responses. No DB persistence, Auth fixtures, providers or Production requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolatedEdge, isolatedFunction } from './isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../../supabase/functions/_shared/market-report-gate.ts';
import { getSubscriberReportProjection } from '../../src/lib/subscriberReportProjection.ts';

export const HISTORY_BROWSER_SCENARIOS = ['HISTORY_READY_VERIFIED', 'HISTORY_PARTIAL_RAW100',
  'HISTORY_WRONG_REVISION', 'HISTORY_MISSING_DURABLE_RECEIPT', 'HISTORY_LATE_OPENING', 'HISTORY_STOCK_BLOCKED'];
export async function buildBrowserHistoryReplays({ today, scope }) {
  assert.equal(scope, 'ma-core-final-20260907');
  const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
  const makeFixture = isolatedFunction(read('tests/consolidationPerformanceHistory.test.mjs'), 'fixture', {
    isolatedFunction, read, assert, structuredClone, assembleCanonicalMarketResearch, buildCanonicalMarketState,
    canonicalMarketSourceRefs, evaluateMarketReportGate,
  });
  let fixture, trace, callbackError;
  const server = createServer((request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1'); assert.equal(request.method, 'GET');
      const url = new URL(request.url, 'http://127.0.0.1'), table = url.pathname.split('/').at(-1);
      assert.ok(['reports', 'decision_snapshots', 'member_content_revisions', 'pipeline_runs'].includes(table),
        `Unexpected history request: ${table}`);
      trace.push({ table, method: request.method, query: Object.fromEntries(url.searchParams) });
      const tables = { reports: [fixture.report], decision_snapshots: [...fixture.evidence.snapshots.values()],
        member_content_revisions: [...fixture.evidence.members.values()], pipeline_runs: fixture.evidence.runs };
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(tables[table]));
    } catch (error) { callbackError = error; response.writeHead(500); response.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const { handler } = isolatedEdge(fileURLToPath(new URL('../../supabase/functions/get-report-payload/index.ts', import.meta.url)), {
    SUPABASE_URL: endpoint, SUPABASE_SERVICE_ROLE_KEY: 'LOCAL_SYNTHETIC_HTTP_READER_NOT_A_SECRET',
  }, { fetch: async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, endpoint, 'Reader fixture cannot contact another origin');
    return fetch(input, init);
  } });
  const replays = {};
  try {
    for (const name of HISTORY_BROWSER_SCENARIOS) {
      fixture = makeFixture(); trace = []; callbackError = null;
      const ai = fixture.report.ai_strategy_json;
      ai.confidence_score = 100; fixture.report.confidence_score = 100;
      ai.stock_research = { document: { private: 'SYNTHETIC_HISTORY_PRIVATE_STOCK' } };
      ai.today_beneficiary_stocks_v10 = [{ symbol: 'SYNTHETIC_HISTORY_PRIVATE_STOCK' }];
      ai.closing_verification_v2 = { ...fixture.closingSnapshot.generated_text.closing_verification_v2,
        status: 'completed', data_status: 'complete', missing_data: [], actual_taiex_change: 99 };
      if (name === 'HISTORY_PARTIAL_RAW100') { fixture.snapshot.status = 'PARTIAL'; fixture.snapshot.confidence_score = 100; }
      if (name === 'HISTORY_WRONG_REVISION') ai.revision_id = 'synthetic-wrong-current-revision';
      if (name === 'HISTORY_MISSING_DURABLE_RECEIPT') fixture.evidence.snapshots.delete(fixture.closingSnapshot.id);
      if (name === 'HISTORY_LATE_OPENING') fixture.snapshot.valid_from = `${fixture.report.report_date}T09:01:00+08:00`;
      if (name === 'HISTORY_STOCK_BLOCKED') { fixture.member.status = 'BLOCKED'; ai.member_value_score = 0; }
      const result = await handler(new Request(endpoint + '/functions/v1/get-report-payload', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ history_limit: 30 }),
      }));
      if (callbackError) throw callbackError;
      assert.equal(result.status, 200); const body = await result.json();
      assert.equal(body.today_date, today); assert.equal(body.reports.length, 1);
      assert.equal(trace.length, 4); assert.deepEqual(trace.map(row => row.table).sort(),
        ['decision_snapshots', 'member_content_revisions', 'pipeline_runs', 'reports']);
      assert.equal(trace.find(row => row.table === 'reports').query.limit, '30');
      assert.equal(trace.find(row => row.table === 'decision_snapshots').query.limit, '90');
      assert.ok(trace.find(row => row.table === 'pipeline_runs').query['provider_status->result->>decision_snapshot_id'].startsWith('in.'));
      const projected = getSubscriberReportProjection(body.reports[0], { historical: true });
      assert.equal(projected.closing.complete, ['HISTORY_READY_VERIFIED', 'HISTORY_STOCK_BLOCKED'].includes(name));
      assert.equal(projected.identity.reportDate, fixture.report.report_date);
      assert.equal(projected.recommendation.available, false);
      assert.doesNotMatch(JSON.stringify(body.reports), /SYNTHETIC_HISTORY_PRIVATE_STOCK/);
      replays[name] = { reports: body.reports, today_date: body.today_date,
        expected: { complete: projected.closing.complete, report_date: projected.identity.reportDate,
          revision_id: projected.identity.revisionId, outcome: projected.closing.outcome, analysis_available: projected.analysisAvailable },
        evidence: { method: 'ACTUAL_HISTORY_HANDLER_SDK_WITH_SYNTHETIC_LOOPBACK_DB_RESPONSES',
          queries: trace, persisted_database_rows: 0, auth_simulated: false, production_requests: 0 } };
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  return replays;
}
