import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = await readFile(new URL('../supabase/functions/emma-morning-alpha-bridge/index.ts', import.meta.url), 'utf8');
const publicPayloadSource = await readFile(new URL('../supabase/functions/get-report-payload/index.ts', import.meta.url), 'utf8');
const boundedSource = await readFile(new URL('../supabase/functions/_shared/bounded-json.ts', import.meta.url), 'utf8');
const freshnessSource = await readFile(new URL('../supabase/functions/_shared/report-freshness.ts', import.meta.url), 'utf8');

test('Emma bridge consumes one exact opaque delegation and rejects legacy credentials', () => {
  assert.match(source, /X-Emma-Delegation/);
  assert.match(source, /functions\/v1\/emma-consume-delegation/);
  assert.match(source, /EMMA_PROJECT_HOST = 'qjgrthjpffhtxvbkfyat\.supabase\.co'/);
  assert.match(source, /EMMA_ALLOWED_OWNER_ID = 'f770feea-9a77-48d3-a444-757d5895f38f'/);
  assert.match(source, /ownerId !== EMMA_ALLOWED_OWNER_ID/);
  assert.match(source, /consumeEmmaDelegation/);
  assert.match(source, /redirect: 'error'/);
  assert.match(source, /owner_id: input\.ownerId/);
  assert.match(source, /system_key: 'morning_alpha'/);
  assert.match(source, /action_request_id: input\.actionRequestId/);
  assert.match(source, /mission_id: input\.missionId/);
  assert.match(source, /payload_sha256: input\.payloadSha256/);
  assert.match(source, /delegation_consumed: true/);
  assert.match(source, /action_binding_verified: true/);
  assert.match(source, /payload_hash_verified: true/);
  assert.match(source, /request\.headers\.has\('Authorization'\)/);
  assert.match(source, /request\.headers\.has\('X-Emma-Bridge-Token'\)/);
  assert.match(source, /LEGACY_CREDENTIAL_FORBIDDEN/);
  assert.doesNotMatch(source, /createRemoteJWKSet|jwtVerify|EMMA_AUTH_|MORNING_ALPHA_EMMA_BRIDGE_TOKEN|constantTimeTokenMatch|user_metadata/);
  assert.doesNotMatch(source, /headers:\s*\{[^}]*Authorization:/s);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin/);
});

test('market intelligence crosses only the existing free public payload boundary', () => {
  assert.match(source, /functions\/v1\/get-report-payload/);
  assert.match(source, /body\.tier !== 'free'/);
  assert.match(source, /body\.authenticated === true/);
  assert.doesNotMatch(source, /member_research_note_v2/);
  assert.doesNotMatch(source, /today_beneficiary_stocks_v10/);
  assert.match(source, /MORNING_ALPHA_PROJECT_URL = 'https:\/\/cttfzgvhiewfckydcrci\.supabase\.co'/);
  assert.match(source, /supabaseUrl !== MORNING_ALPHA_PROJECT_URL/);
  assert.match(source, /PROJECT_CONFIGURATION_INVALID/);
});

test('bridge exposes only the four registered read operations', () => {
  for (const operation of ['get_today_health', 'get_market_intelligence', 'get_thesis', 'get_closing_verification']) {
    assert.match(source, new RegExp(`['"]${operation}['"]`));
  }
  assert.doesNotMatch(source, /record_|update_|delete_|publish_/);
});

test('structured logs contain trace fields without logging provider payload', () => {
  for (const field of ['trace_id', 'mission_id', 'execution_id', 'tool_call_id', 'duration_ms', 'result', 'error_type', 'verification_status']) {
    assert.match(source, new RegExp(field));
  }
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^\n]*(payload|serviceRoleKey|providedToken)/);
});

test('public bridge streams and cancels oversized request bodies', () => {
  assert.match(source, /MAX_BODY_BYTES = 32_768/);
  assert.match(source, /readBoundedText\(request\.body, MAX_BODY_BYTES\)/);
  assert.match(boundedSource, /reader\.cancel\('REQUEST_TOO_LARGE'\)/);
  assert.doesNotMatch(source, /await request\.text\(\)/);
});

test('every successful operation returns explicit fresh market date evidence', () => {
  for (const field of ['today_date', 'report_date', 'data_as_of', 'market_status', 'is_trading_day', 'report_mode', 'is_current_report', 'report_freshness_verified', 'expected_report_date']) {
    assert.match(source, new RegExp(field));
  }
  assert.match(publicPayloadSource, /report_mode:\s*getReportMode\(report, ai\)/);
  assert.match(publicPayloadSource, /toStringValue\(report\.report_mode\) \|\| toStringValue\(ai\.report_mode\)/);
  assert.doesNotMatch(publicPayloadSource, /isTradingDay === true\) return "normal_overnight"/);
  assert.doesNotMatch(publicPayloadSource, /isTradingDay === false\) return "non_trading_day"/);
  assert.match(source, /PUBLIC_PAYLOAD_REPORT_DATE_MISMATCH/);
  assert.match(source, /MARKET_CALENDAR_VERIFICATION_FAILED/);
  assert.match(source, /operation === 'get_today_health' \? todayDate : null/);
  assert.match(source, /reportDate \? \{ report_date: reportDate \} : \{\}/);
  assert.match(source, /reportDate !== null && providerReportDate !== reportDate/);
  assert.match(freshnessSource, /MAX_NON_TRADING_LOOKBACK_DAYS = 4/);
  assert.match(freshnessSource, /REPORT_DATE_STALE/);
  assert.match(freshnessSource, /DATA_AS_OF_IN_FUTURE/);
  assert.match(freshnessSource, /DATA_AS_OF_DATE_MISMATCH/);
});

test('today health cannot reuse an ops run from another Taipei date', () => {
  assert.match(source, /taipeiDayUtcRange\(providerReportDate\)/);
  assert.match(source, /\.gte\('created_at', dayRange\.start\)\.lt\('created_at', dayRange\.end\)/);
  assert.match(source, /TODAY_HEALTH_INCOMPLETE/);
  assert.match(source, /if \(!healthResult\.data \|\| !opsResult\.data\)/);
  assert.doesNotMatch(source, /health_data_status:.*partial/);
});

test('market intelligence requires at least one public production evidence source', () => {
  assert.match(source, /degradedMetadata\.component_query_status !== 'complete'/);
  assert.match(source, /degradedMetadata\.bridge_verification_status !== 'VERIFIED'/);
  assert.match(source, /PUBLIC_COMPONENT_EVIDENCE_DEGRADED/);
  assert.match(source, /MARKET_INTELLIGENCE_NOT_AVAILABLE/);
  for (const evidence of ['market_data_snapshots', 'important_news', 'sector_rotation_scores', 'canonical_decision', 'opening_radar']) {
    assert.match(source, new RegExp(evidence));
  }
  assert.doesNotMatch(source, /mockMarketData|mockDailyReport|mockNews/);
});

test('closing verification exposes completeness without pretending pending data passed', () => {
  assert.match(publicPayloadSource, /data_status:\s*toStringValue\(closing\.data_status\)/);
  assert.match(source, /closing_verification_complete/);
  assert.match(source, /closingStatus === 'completed' && closingDataStatus === 'complete'/);
});

test('upstream delegation and public payload responses are bounded and safely parsed', async () => {
  assert.doesNotMatch(source, /response\.json\(\)/);
  assert.match(source, /readBoundedJsonResponse\(response, MAX_INTROSPECTION_RESPONSE_BYTES\)/);
  assert.match(source, /readBoundedJsonResponse\(response, MAX_PUBLIC_REPORT_RESPONSE_BYTES\)/);
  assert.match(source, /EMMA_INTROSPECTION_RESPONSE_TOO_LARGE/);
  assert.match(source, /PUBLIC_REPORT_RESPONSE_TOO_LARGE/);

  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'supabase/functions/_shared/bounded-json.ts')).href;
  const { readBoundedJsonResponse } = await import(moduleUrl);
  assert.deepEqual(
    await readBoundedJsonResponse(new Response('{"ok":true}'), 64),
    { ok: true },
  );
  await assert.rejects(readBoundedJsonResponse(new Response('123456'), 5), /REQUEST_TOO_LARGE/);
  await assert.rejects(readBoundedJsonResponse(new Response('{broken'), 64), /UPSTREAM_RESPONSE_INVALID_JSON/);
});

test('freshness verifier rejects historical, future and date-incompatible evidence', async () => {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'supabase/functions/_shared/report-freshness.ts')).href;
  const { verifyReportFreshness } = await import(moduleUrl);
  const now = new Date('2026-08-23T04:00:00.000Z');

  assert.deepEqual(verifyReportFreshness({
    todayDate: '2026-08-23',
    reportDate: '2026-08-21',
    requestedReportDate: null,
    reportMode: 'normal_overnight',
    dataAsOf: '2026-08-21T08:00:00.000Z',
    now,
  }), {
    verified: true,
    expectedReportDate: '2026-08-21',
    dataAsOf: '2026-08-21T08:00:00.000Z',
  });

  for (const [input, error] of [
    [{ reportDate: '2026-05-26', dataAsOf: '2026-05-26T08:00:00.000Z', reportMode: 'normal_overnight' }, 'REPORT_DATE_STALE'],
    [{ reportDate: '2026-08-21', dataAsOf: '2026-08-23T08:00:00.000Z', reportMode: 'normal_overnight' }, 'DATA_AS_OF_IN_FUTURE'],
    [{ reportDate: '2026-08-21', dataAsOf: '2026-08-20T08:00:00.000Z', reportMode: 'normal_overnight' }, 'DATA_AS_OF_DATE_MISMATCH'],
    [{ reportDate: '2026-08-21', dataAsOf: '2026-08-21T08:00:00.000Z', reportMode: '' }, 'REPORT_MODE_NOT_AVAILABLE'],
  ]) {
    assert.deepEqual(verifyReportFreshness({
      todayDate: '2026-08-23',
      requestedReportDate: null,
      now,
      ...input,
    }), { verified: false, error });
  }
});
