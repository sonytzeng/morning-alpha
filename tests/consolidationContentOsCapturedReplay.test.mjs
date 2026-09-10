// Actual 9/21 persisted-output replay. HTTP transport/Auth infrastructure is
// explicitly doubled; this does not extend the original 96-record DB PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { capturedOutput, runCapturedContentOs, selectCapturedRows,
  FIXTURE_INTERNAL_TOKEN, FIXTURE_SOURCE_TOKEN } from './helpers/coreContentOsCapturedReplay.mjs';

const original = capturedOutput();
const snapshot = tables => tables.decision_snapshots.find(row => row.session_type === 'PREMARKET');
const withoutIncidents = tables => Object.fromEntries(Object.entries(tables).filter(([table]) => table !== 'content_os_sync_incidents'));
const noResolve = result => assert.equal(result.trace.some(row => row.path.endsWith('/resolve_content_os_incident_v1')), false);

/** This is deliberately NOT the actual captured output. It tests only the
 * newly supported wire using explicit synthetic citation metadata. It changes
 * no score, gate, publication identity, lifecycle or original capture byte. */
export function counterfactualContentOsTables() {
  const tables = structuredClone(original.tables);
  const publicNews = row => /^NEWS00[123]$/.test(row.evidence_id) ? ({ ...row,
    title: 'Synthetic counterfactual citation ' + row.evidence_id,
    url: 'https://synthetic-consolidation.invalid/counterfactual/' + encodeURIComponent(row.evidence_id),
    published_at: row.source_date.length === 10 ? row.source_date + 'T00:00:00+08:00' : row.source_date,
  }) : row;
  // Only NEWS001–003 were news URL-bearing provider inputs. MD rows remain
  // non-public ledger tuples; never manufacture a market-data citation.
  snapshot(tables).source_refs = snapshot(tables).source_refs.map(publicNews);
  for (const claim of snapshot(tables).generated_text.canonical_market_state.document.quality.coverage_audit.claims) {
    claim.sources = claim.sources.map(publicNews);
  }
  return tables;
}

test('capture is preserved actual synthetic-provider output, not a handcrafted publication success', () => {
  assert.equal(original.provenance.original_run_id, 'dbc23233-8aba-4c82-aa2a-d77c1828752f');
  assert.equal(original.provenance.original_fullchain_result, 'd0e53dc47ff0e28b86c6cd419d0798da2855e51d19c21115b669ba3363cc8d50');
  assert.equal(original.preservation.public_table_count, 81);
  assert.equal(original.preservation.business_writes, 0);
  assert.equal(original.tables.content_os_sync_incidents.length, 0);
  assert.equal(snapshot(original.tables).decision_mode, 'market_only');
  assert.equal(snapshot(original.tables).source_refs.some(row => row.url), false);
  assert.equal(Object.hasOwn(original.tables, 'auth.users'), false);
});

test('actual 9/21 capture stays a real export negative: missing frozen HTTPS metadata cannot be invented', async () => {
  const tables = structuredClone(original.tables), before = structuredClone(withoutIncidents(tables));
  const result = await runCapturedContentOs(tables);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
  assert.deepEqual(result.body.reason_codes, ['PUBLIC_MARKET_EVIDENCE_INCOMPLETE']);
  assert.equal(tables.content_os_sync_incidents.length, 1);
  assert.equal(tables.content_os_sync_incidents[0].status, 'OPEN');
  assert.equal(tables.content_os_sync_incidents[0].snapshot_id, snapshot(tables).id);
  assert.deepEqual(withoutIncidents(tables), before); noResolve(result);
  assert.equal(result.full_supabase_claim, false);
  assert.equal(result.real_auth_gateway_executed, false);
  assert.equal(result.method, 'ACTUAL_HANDLER_SDK_WITH_EXPLICIT_DB_TRANSPORT_DOUBLE');
  assert.equal(result.trace.some(row => ['is_current', 'revision'].some(key => Object.hasOwn(row.query, key))), false);
});

test('explicit counterfactual metadata produces the existing non-stock wire without changing market or Premium gates', async () => {
  const tables = counterfactualContentOsTables(), before = structuredClone(withoutIncidents(tables));
  const result = await runCapturedContentOs(tables);
  assert.equal(result.status, 200); assert.equal(result.body.contract_version, 'morning_alpha_public_contract_v1');
  assert.equal(result.body.public_topic.kind, 'market_brief');
  assert.equal(result.body.public_topic.symbol, undefined); assert.deepEqual(result.body.opportunities, []);
  assert.equal(result.body.premium_locked, true); assert.equal(result.body.premium.status, 'BLOCKED');
  assert.equal(result.body.premium.locked, true); assert.equal(result.body.report_date, '2026-09-21');
  assert.equal(result.body.verification.decision_snapshot_id, snapshot(tables).id);
  assert.equal(result.body.daily_sentence, snapshot(tables).generated_text.canonical_market_state.document.sections.executive_summary.text);
  assert.ok(result.body.source_references.every(row => new URL(row.url).hostname === 'synthetic-consolidation.invalid'));
  assert.equal(result.body.source_references.length, 3);
  assert.equal(snapshot(tables).source_refs.filter(row => row.evidence_id.startsWith('MD')).some(row => row.url), false);
  assert.deepEqual(withoutIncidents(tables), before);
  assert.equal(result.incidentTrace.filter(row => row.name === 'resolve_content_os_incident_v1').length, 1);
  assert.equal(result.incidentTrace[0].body.p_incident_key, 'content-os:2026-09-21:' + snapshot(tables).id);
  assert.deepEqual(capturedOutput(), original, 'Counterfactual never modifies the captured evidence fixture');
});

for (const [name, headers, method, status, error] of [
  ['missing authorization', {}, 'GET', 401, 'SOURCE_AUTH_REQUIRED'],
  ['wrong internal token', { 'x-cron-secret': 'wrong' }, 'GET', 401, 'INTERNAL_AUTH_INVALID'],
  ['wrong source bearer', { authorization: 'Bearer wrong' }, 'GET', 401, 'SOURCE_AUTH_REQUIRED'],
  ['wrong internal key', { apikey: 'wrong' }, 'GET', 401, 'INTERNAL_AUTH_MISSING'],
  ['wrong internal version', { 'x-cron-secret': FIXTURE_INTERNAL_TOKEN, 'x-internal-auth-version': 'wrong' }, 'GET', 401, 'INTERNAL_AUTH_VERSION_MISMATCH'],
  ['POST remains unsupported', { 'x-cron-secret': FIXTURE_INTERNAL_TOKEN }, 'POST', 405, 'METHOD_NOT_ALLOWED'],
]) test('real handler auth/method guard: ' + name, async () => {
  const result = await runCapturedContentOs(structuredClone(original.tables), { headers, method });
  assert.equal(result.status, status); assert.equal(result.body.error, error);
  assert.equal(result.trace.length, 0); assert.equal(result.incidentTrace.length, 0);
});

test('existing dedicated source-token contract executes without introducing gateway or user fixtures', async () => {
  const result = await runCapturedContentOs(structuredClone(original.tables), { headers: { authorization: 'Bearer ' + FIXTURE_SOURCE_TOKEN } });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
  assert.ok(result.trace.every(row => row.path.startsWith('/rest/v1/'))); noResolve(result);
});

for (const [name, mutate] of [
  ['missing publication run', tables => { tables.pipeline_runs = []; }],
  ['wrong actual run snapshot id', tables => { tables.pipeline_runs.find(row => row.provider_status.result)?.provider_status.result &&
    (tables.pipeline_runs.find(row => row.provider_status.result).provider_status.result.decision_snapshot_id = 'foreign'); }],
  ['wrong semantic snapshot tuple', tables => { tables.semantic_coherence_reviews[0].canonical_snapshot_id = 'foreign'; }],
  ['missing current revision pointer', tables => { delete tables.reports[0].ai_strategy_json.revision_id; }],
  ['PARTIAL frozen snapshot', tables => { snapshot(tables).status = 'PARTIAL'; }],
  ['thin frozen market document', tables => { snapshot(tables).generated_text.canonical_market_state.document.sections.executive_summary.text = '觀察市場'; }],
  ['missing exact editorial receipt', tables => { tables.editorial_reviews = []; }],
  ['foreign editorial snapshot', tables => { tables.editorial_reviews[0].decision_snapshot_id = 'foreign'; }],
]) test('counterfactual public citations cannot override publication proof: ' + name, async () => {
  const tables = counterfactualContentOsTables(); mutate(tables);
  const result = await runCapturedContentOs(tables);
  assert.ok([404, 409].includes(result.status), JSON.stringify({ status: result.status, error: result.body.error }));
  assert.equal(result.body.public_topic, undefined); noResolve(result);
});

test('current private QA cannot turn the exact captured missing-citation failure into a market publication veto', async () => {
  const tables = structuredClone(original.tables);
  const ai = tables.reports[0].ai_strategy_json;
  ai.canonical_market_state = { status: 'INSUFFICIENT_EVIDENCE' }; ai.data_quality = 'incomplete'; ai.member_value_score = 0;
  const result = await runCapturedContentOs(tables);
  assert.equal(result.status, 409); assert.equal(result.body.error, 'PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
  noResolve(result);
});

test('mutable raw URL aliases cannot repair the missing frozen capture metadata', async () => {
  const tables = structuredClone(original.tables);
  tables.reports[0].ai_strategy_json.public_delivery_gate = { eligible: true, status: 'PASS' };
  tables.reports[0].ai_strategy_json.source_references = counterfactualContentOsTables().decision_snapshots.find(row => row.session_type === 'PREMARKET').source_refs;
  const result = await runCapturedContentOs(tables);
  assert.equal(result.status, 409); assert.equal(result.body.error, 'PUBLIC_MARKET_EVIDENCE_INCOMPLETE'); noResolve(result);
});

for (const [rpc, tables, expected] of [
  ['record_content_os_incident_v1', () => structuredClone(original.tables), 'CONTENT_OS_INCIDENT_WRITE_FAILED'],
  ['resolve_content_os_incident_v1', counterfactualContentOsTables, 'CONTENT_OS_INCIDENT_RESOLUTION_FAILED'],
]) test('incident persistence failure is not reported as export success: ' + rpc, async () => {
  const result = await runCapturedContentOs(tables(), { failRpc: rpc });
  assert.equal(result.status, 503); assert.equal(result.body.error, expected);
});

test('real SDK exact identity predicates are applied by the test transport, not table-name-only matching', () => {
  const tables = structuredClone(original.tables);
  for (const key of ['id', 'report_id', 'report_date']) {
    assert.deepEqual(selectCapturedRows(tables, 'decision_snapshots', new URLSearchParams({ [key]: 'eq.foreign' })), []);
  }
  assert.throws(() => selectCapturedRows(tables, 'reports', new URLSearchParams({ id: 'unsupported.value' })), /fail closed/);
  assert.throws(() => selectCapturedRows(tables, 'auth.users', new URLSearchParams()), /Unexpected fixture table/);
});
