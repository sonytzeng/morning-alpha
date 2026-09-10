// Original supplemental matrix: 650 planned cells, independently evidenced by lane:
// Anonymous 260 (375/390/430/1440), Member/Admin 260 and Free 130 (375/430).
// MA_SUBSCRIBER_MATRIX_PROFILE=full adds EMPTY_CANONICAL and runs all four
// widths for all roles: 14 states x 5 routes x 4 roles x 4 widths = 1120 cells.
// MA_SUBSCRIBER_HISTORY_MATRIX=YES adds 192 history cells (6 x2 routes x4 roles x4 widths).
// Reuses the existing isolated stack; no SQL definitions, signup-mode, role,
// ACL/RLS or config writes. Optional explicit local expired fixture is recorded.
// Opt-in subscriber *presentation* E2E. Local GoTrue/PKCE, server profile,
// entitlement and RLS are real. Only the local report-reader response is replayed
// with declared synthetic states, after its real server tier has been verified.
// This is NOT provider, generation/publication, or Production acceptance proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import ts from 'typescript';
import { subscriberProjectionFixture, subscriberFixtureEnvelope, PROJECTION_SCENARIOS, RECOMMENDATION_BLOCKED } from '../fixtures/subscriber-projection-v1.mjs';
import { getSubscriberReportProjection } from '../../src/lib/subscriberReportProjection.ts';
import { buildBrowserHistoryReplays, HISTORY_BROWSER_SCENARIOS } from '../helpers/consolidationHistoryBrowserReplay.mjs';

const scope = 'ma-core-final-20260907';
const { fetch } = globalThis;
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.equal(process.env.MA_SUBSCRIBER_CONSOLIDATION_MATRIX, 'YES', 'Explicit local report-response fixture permission required');
const output = process.env.MA_E2E_OUTPUT;
assert.ok(output?.startsWith('/private/tmp/')); assert.equal(existsSync(output), false, 'Prior evidence must remain immutable');
const repo = resolve(new URL('../..', import.meta.url).pathname);
const origin = 'http://127.0.0.1:4313', api = 'http://127.0.0.1:54371', mail = 'http://127.0.0.1:54374';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
assert.equal(process.env.MA_E2E_BUSINESS_DATE, today, 'Explicit current Taipei date is required; never silently reuse an old date');
const fixtureSourceDate = '2026-09-08'; // Existing synthetic DB baseline is read-only.
const docker = (...args) => execFileSync('docker', ['--context', 'colima-ma-core-20260907', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const network = 'ma-core-final-isolated-20260907';
assert.equal(docker('network', 'inspect', '--format', '{{.Internal}}', network), 'true');
for (const service of ['db', 'rest', 'kong', 'auth', 'edge_runtime', 'inbucket']) {
  assert.deepEqual(Object.keys(JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', `supabase_${service}_${scope}`))), [network]);
}
const digest = value => createHash('sha256').update(value).digest('hex');
// Hash the complete local import closure, not just the top-level validators.
// Explicit fixture declaration reads below are roots too: those are evaluated
// by the real history replay but are not JavaScript import statements.
function collectLocalSourceDependencies(roots) {
  const paths = new Set(), pending = [...roots];
  while (pending.length) {
    const path = pending.pop();
    if (paths.has(path)) continue;
    const absolute = resolve(repo, path);
    assert.ok(absolute.startsWith(repo + '/'), `Source dependency escaped repository: ${path}`);
    assert.ok(existsSync(absolute) && statSync(absolute).isFile(), `Source dependency missing: ${path}`);
    paths.add(path);
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    for (const imported of ts.preProcessFile(readFileSync(absolute, 'utf8'), true, true).importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      const base = resolve(dirname(absolute), imported.fileName);
      const target = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs'].map(ext => base + ext),
        ...['index.ts', 'index.tsx', 'index.js', 'index.mjs'].map(file => resolve(base, file))]
        .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      assert.ok(target, `Unresolved local source dependency: ${path} -> ${imported.fileName}`);
      pending.push(relative(repo, target));
    }
  }
  return [...paths].sort();
}
const sourcePaths = collectLocalSourceDependencies([...new Set([
  ...execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'shared'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean),
  'src/lib/subscriberReportProjection.ts', 'tests/fixtures/subscriber-projection-v1.mjs',
  'tests/fixtures/subscriber-projection-legacy-payload44.json', 'tests/browser/subscriberProjection.e2e.mjs',
  'tests/browser/consolidationSubscriberMatrix.e2e.mjs',
  'tests/helpers/consolidationHistoryBrowserReplay.mjs', 'tests/consolidationPerformanceHistory.test.mjs',
  'tests/consolidationPublicationConsumers.test.mjs', 'tests/helpers/isolatedEdgeLoader.mjs',
  'supabase/functions/get-report-payload/index.ts', 'supabase/functions/_shared/market-publication-contract.ts',
  'supabase/functions/_shared/closing-learning-contract.ts', 'supabase/functions/_shared/canonical-market-state.ts',
  'supabase/functions/_shared/content-intelligence.ts',
  'supabase/functions/generate-daily-report-v7/research-master-v2.ts',
  'supabase/functions/generate-daily-report-v7/research-master-v2.test.ts',
])]);
const sourceHashes = Object.fromEntries(sourcePaths.filter(path => existsSync(resolve(repo, path))).map(path => [path, digest(readFileSync(resolve(repo, path)))]));
const sourceCheck = () => { for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(digest(readFileSync(resolve(repo, path))), hash, `Source changed during E2E: ${path}`); };
const legacy = JSON.parse(readFileSync(new URL('../fixtures/subscriber-projection-legacy-payload44.json', import.meta.url), 'utf8'));
const CHECKPOINT_SCENARIOS = ['STALE_ONLY_RECEIPTS', 'MIXED_OLD_0930_VALID_1030'];
const matrixProfile = process.env.MA_SUBSCRIBER_MATRIX_PROFILE || 'supplemental';
const includeHistory = process.env.MA_SUBSCRIBER_HISTORY_MATRIX === 'YES';
assert.ok(['supplemental', 'full'].includes(matrixProfile));
const MATRIX_SCENARIOS = [...PROJECTION_SCENARIOS, ...CHECKPOINT_SCENARIOS, ...(matrixProfile === 'full' ? ['EMPTY_CANONICAL'] : [])];
const authenticatedWidths = matrixProfile === 'full' ? [375, 390, 430, 1440] : [375, 430];
const roleSet = process.env.MA_SUBSCRIBER_MATRIX_ROLES || 'all';
assert.ok(['all', 'authenticated', 'member-admin', 'free', 'anonymous'].includes(roleSet));
const createExpiredFixture = process.env.MA_LOCAL_SYNTHETIC_EXPIRED_FIXTURE === 'YES';
const freeState = process.env.MA_FREE_ENTITLEMENT_STATE || 'free';
assert.ok(['free', 'expired'].includes(freeState));
if (createExpiredFixture) { assert.equal(roleSet, 'free'); assert.equal(freeState, 'expired'); }
// Run the unaffected existing entitlements before the Free preflight. A Free
// enrollment that would grant Member access must stop, not be relabeled Free.
const roleDefinitions = [
  ['anonymous', null, null], ['member', 'free', 'paid_active'],
  ['admin', 'admin', 'owner'], ['free', 'free', freeState],
].filter(([role]) => roleSet === 'all' || (roleSet === 'authenticated' ? role !== 'anonymous'
  : ['free', 'anonymous'].includes(roleSet) ? role === roleSet : ['member', 'admin'].includes(role)));
const widthCount = roleDefinitions.reduce((total, [role]) => total + (role === 'anonymous' ? 4 : authenticatedWidths.length), 0);
const UNVERIFIED_COMPLETION_PROSE = '舊修訂09:30已完成，盤中判斷已確認';
const scenarioPayload = name => {
  if (name === 'EMPTY_CANONICAL') {
    const value = subscriberProjectionFixture('READY', { todayDate: today });
    const revision = 'synthetic-subscriber-empty-canonical';
    value.revision_id = revision; value.canonical_decision.id = revision;
    value.subscriber_state.revision_id = revision;
    value.canonical_decision.action = 'ACT';
    value.canonical_decision.recommendations = [];
    // Keep QUALIFIED and raw stock arrays deliberately contradictory. Explicit
    // canonical emptiness must win without blocking the READY market narrative.
    return value;
  }
  if (CHECKPOINT_SCENARIOS.includes(name)) {
    const value = subscriberProjectionFixture('READY', { todayDate: today });
    const previous = new Date(`${today}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
    const oldDate = previous.toISOString().slice(0, 10);
    const revision = `synthetic-subscriber-${name.toLowerCase()}`;
    value.revision_id = revision; value.canonical_decision.id = revision;
    value.subscriber_state.revision_id = revision; value.canonical_decision.action = 'ACT';
    value.intraday_sync_status.revision_id = revision;
    const stale = key => ({ status: 'completed', report_date: oldDate, revision_id: 'old-synthetic-revision',
      completed_at: `${oldDate}T${key.slice(0, 2)}:31:00+08:00`,
      evidence: { source: 'SYNTHETIC_LOCAL_OLD_CHECKPOINT', checkpoint: key } });
    value.intraday_sync_status.windows['0930'] = stale('0930');
    value.intraday_sync_status.windows['1030'] = name === 'MIXED_OLD_0930_VALID_1030'
      ? { status: 'completed', report_date: today, revision_id: revision, completed_at: `${today}T10:31:00+08:00`,
        evidence: { source: 'SYNTHETIC_LOCAL_CURRENT_CHECKPOINT', checkpoint: '1030' } }
      : stale('1030');
    // Contradictory raw prose must never become subscriber completion evidence.
    value.intraday_tracking = { status: UNVERIFIED_COMPLETION_PROSE };
    value.opening_radar = { report_date: oldDate, radar_status: UNVERIFIED_COMPLETION_PROSE,
      taiex_change: 1, txf_change: 1, tsmc_change: 1 };
    value.member_research_note_v2 = { intraday_time_windows: [
      { time: '09:30', title: '開盤條件確認', what_to_watch: '核對當日開盤資料與修訂。' },
      { time: '10:30', title: '主線條件確認', what_to_watch: '核對當日主線資料與修訂。' },
    ] };
    return value;
  }
  const generated = subscriberProjectionFixture(name, { todayDate: today });
  if (name !== 'PARTIAL') return generated;
  // Rebase the sanitized real legacy response into a declared synthetic day;
  // no Production record is changed and this is not today's market evidence.
  const delta = Date.parse(today) - Date.parse(legacy.response.report_date);
  const transform = value => {
    if (typeof value === 'string') return value.replaceAll(legacy.response.revision_id, generated.revision_id)
      .replace(/\d{4}-\d{2}-\d{2}/g, dateText => new Date(Date.parse(dateText) + delta).toISOString().slice(0, 10));
    if (Array.isArray(value)) return value.map(transform);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child)]));
    return value;
  };
  return transform(legacy.response.payload);
};
const matrixEnvelope = (payload, actualServerIdentity, scenario) => {
  const envelope = subscriberFixtureEnvelope(payload, actualServerIdentity);
  if (scenario === 'EMPTY_CANONICAL') {
    // An explicit empty list discloses no stock. Retain it for this countercase
    // so Free/Anonymous also test emptiness, not a redacted omission. All other
    // 13 scenarios keep the original helper's Free field-omission behavior.
    envelope.payload.canonical_decision.recommendations = [];
  }
  return envelope;
};
mkdirSync(output, { recursive: true });
const safeUrl = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[INVALID_URL]'; } };
const safeError = value => String(value).replace(/(?:https?|wss?):\S+/g, safeUrl).replace(/eyJ[\w.-]+/g, '[REDACTED]').replace(/\b[^\s@]+@[^\s@]+\b/g, '[LOCAL_IDENTITY]');
// The mounted member-access bundle calls ensure_member_entitlement_v1. The
// isolated stack's prepared 20260822183421 definition returns existing paid
// entitlements unchanged, creates beta/trial access when a Free user has no
// entitlement, and UPSERTs owner version/metadata on every Admin activation.
// Normal callback side effects for existing local users are permitted, but
// changing their effective privilege is not. These are server status objects,
// not invented session claims, inferred tiers or mocked membership responses.
function assertExistingActivation(status, role, expectedState) {
  assert.equal(status.success, true);
  assert.ok(['closed', 'beta_full', 'trialing'].includes(status.offer.signup_mode));
  assert.equal(status.membership.state, expectedState);
  assert.equal(status.membership.tier, role);
  if (role === 'free') {
    assert.equal(status.membership.active, false);
    if (expectedState === 'expired') {
      assert.ok(status.membership.accessStartsAt && Date.parse(status.membership.accessEndsAt) < Date.now());
      assert.equal(status.membership.trialStartsAt, null); assert.equal(status.membership.trialEndsAt, null);
      assert.equal(status.membership.source, 'manual');
    } else assert.equal(status.offer.signup_mode, 'closed',
      'LOCAL_FREE_IDENTITY_UNSUITABLE: existing beta_full enrollment policy grants Member access; use a genuine existing expired Free identity, not a forced tier');
  } else if (role === 'admin') {
    assert.equal(status.membership.active, true);
    assert.equal(status.membership.accessEndsAt, null);
  } else {
    assert.equal(status.membership.state, 'paid_active');
    assert.ok(status.membership.accessStartsAt && status.membership.source !== 'legacy_profile',
      'LOCAL_EXISTING_ENTITLEMENT_REQUIRED: profile-only paid access does not prove the read-only existing-row branch');
  }
}
function assertPreservedMembership(before, after, role) {
  assert.equal(after.tier, role, 'Normal local login cannot upgrade or downgrade effective access');
  if (role === 'admin') {
    assert.equal(after.state, 'owner'); assert.equal(after.active, true);
    assert.equal(after.accessEndsAt, null); assert.equal(after.source, 'owner');
    if (before.accessStartsAt) assert.equal(after.accessStartsAt, before.accessStartsAt);
    assert.equal(after.trialStartsAt, before.trialStartsAt);
    assert.equal(after.trialEndsAt, before.trialEndsAt);
  } else assert.deepEqual(after, before, 'Existing paid/Free access must remain unchanged');
}
const evidence = { scope, business_date: today, baseline_fixture_date: fixtureSourceDate,
  method: 'REAL_LOCAL_AUTH_RLS_WITH_SYNTHETIC_LOCAL_REPORT_RESPONSE', full_stack_publication_claim: false,
  captured_legacy_payload_version: 44, captured_legacy_source_sha256: legacy.provenance.source_sha256,
  source_hashes: sourceHashes, auth: [], matrix: [], checkpoint_details: [], voice_gate: [], network: [], console: [], failed: [], blocked_external: [],
  static_test_doubles: [], projection_payload_count: 0, source_unchanged: false, production_requests: 0,
  sql_executions: 0, auth_configuration_writes: 0, blocked_business_requests: [], route_errors: [],
  local_auth_membership_side_effects: [],
  history_matrix: [], history_handler_fixtures: null,
  local_synthetic_fixture: { requested: createExpiredFixture, writes: 0 },
  fixture_selection_note: 'Earlier failed artifacts remain immutable and are not relabeled PASS. Existing beta_full automatically enrolls an empty Free account as Member; this is existing policy, not a Consolidation defect. This run independently verifies its declared matrix on its frozen source, reusing the genuine expired Free fixture.',
  activation_contract: {
    member_access_bundle_sha256: digest(readFileSync('/private/tmp/ma-core-final-20260907/supabase/functions/member-access/index.js')),
    prepared_contract_sha256: digest(readFileSync('/private/tmp/ma-core-final-20260907/prepared/20260822183421_member_access_trial_state_machine.sql')),
    local_existing_user_callback_side_effects_permitted: true,
    effective_privilege_changes_permitted: false,
    owner_version_timestamp_updates: 'Normal ensure RPC updates are permitted; version/updated_at are not exposed by the public status contract and are not claimed unchanged.',
  },
  expected_matrix_cells: MATRIX_SCENARIOS.length * 5 * widthCount,
  expected_history_cells: includeHistory ? HISTORY_BROWSER_SCENARIOS.length * 2 * roleDefinitions.length * 4 : 0,
  coverage: { matrix_profile: matrixProfile, role_set: roleSet, roles: roleDefinitions.map(([role]) => role), authenticated_widths: authenticatedWidths,
    anonymous_widths: roleDefinitions.some(([role]) => role === 'anonymous') ? [375, 390, 430, 1440] : [], states: MATRIX_SCENARIOS, routes: 5 } };
const { chromium } = await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.MA_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, handleSIGINT: false, handleSIGTERM: false });
const stopRun = signal => {
  evidence.interrupted = signal; evidence.error = `RUN_INTERRUPTED_${signal}`; process.exitCode = 130;
  // Closing the browser rejects the current operation and reaches finally;
  // interruption must preserve evidence and must never count as PASS.
  void browser.close().catch(() => {});
};
process.once('SIGINT', () => stopRun('SIGINT'));
process.once('SIGTERM', () => stopRun('SIGTERM'));
let currentScenario = null;
let currentHistoryScenario = null, historyReplays = null;
let activePage = null;
try {
  if (includeHistory) {
    historyReplays = await buildBrowserHistoryReplays({ today, scope });
    evidence.history_handler_fixtures = historyReplays;
  }
  if (createExpiredFixture) {
    // This one INSERT is an explicitly authorized synthetic *data* fixture, not
    // the blocked Publication/Acceptance DDL. It cannot overwrite an entitlement
    // or grant access. Auth users, profiles, policies and config are unchanged.
    assert.equal(docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', 'colima-ma-core-20260907'),
      'unix:///Users/sonytzeng/.colima/ma-core-20260907/docker.sock');
    assert.deepEqual(JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', `supabase_db_${scope}`)), { '5432/tcp': null });
    const fixtureSql = String.raw`
begin;
set local lock_timeout = '3s';
set local statement_timeout = '10s';
do $local_fixture$
declare
  v_user uuid;
  v_profile jsonb;
  v_config jsonb;
begin
  if inet_client_addr() is distinct from '127.0.0.1'::inet then
    raise exception 'Only container loopback is permitted';
  end if;
  if (select count(*) from ma_isolated_guard.identity) <> 1
     or (select scope from ma_isolated_guard.identity) <> 'ma-core-final-20260907' then
    raise exception 'Wrong isolated database scope';
  end if;
  select u.id, to_jsonb(p) into strict v_user, v_profile
  from auth.users u join public.profiles p on p.id = u.id
  where u.email = 'core-free-market-split-20260908-v1@local.test'
    and p.email = u.email and p.role = 'free' and p.subscription_status = 'inactive'
    and p.membership_tier is null and p.paid_until is null;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if exists (select 1 from public.member_entitlements where user_id = v_user) then
    raise exception 'Never overwrite any existing entitlement';
  end if;
  select jsonb_agg(to_jsonb(c) order by config_key) into v_config from public.membership_access_config c;
  insert into public.member_entitlements (
    user_id, state, tier, source, access_started_at, access_ends_at, metadata
  ) values (
    v_user, 'expired', 'member', 'manual', now() - interval '2 days', now() - interval '1 day',
    jsonb_build_object('synthetic_fixture', 'CORE_CONSOLIDATION_EXPIRED_FREE_V1',
      'local_scope', 'ma-core-final-20260907', 'effective_access', 'free',
      'purpose', 'Real local PKCE/server-tier/RLS browser matrix; no paid, trial or owner access')
  );
  if (select to_jsonb(p) from public.profiles p where p.id = v_user) is distinct from v_profile
     or (select jsonb_agg(to_jsonb(c) order by config_key) from public.membership_access_config c) is distinct from v_config then
    raise exception 'Profile/config must remain unchanged';
  end if;
end
$local_fixture$;
select jsonb_build_object('schema_version', 'CORE_CONSOLIDATION_EXPIRED_FREE_V1',
  'scope', 'ma-core-final-20260907', 'writes', 1, 'state', e.state, 'stored_tier', e.tier,
  'source', e.source, 'access_ends_at', e.access_ends_at,
  'trial_started_at', e.trial_started_at, 'trial_ends_at', e.trial_ends_at,
  'billing_provider', e.billing_provider, 'profile_config_unchanged', true)
from public.member_entitlements e join auth.users u on u.id = e.user_id
where u.email = 'core-free-market-split-20260908-v1@local.test';
commit;`;
    evidence.sql_executions++;
    const fixtureResult = docker('exec', `supabase_db_${scope}`, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
      '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', fixtureSql);
    evidence.local_synthetic_fixture = { requested: true, ...JSON.parse(fixtureResult),
      sql_sha256: digest(fixtureSql), no_existing_entitlement_overwritten: true,
      sql_definition_changes: 0, profile_role_writes: 0, signup_config_writes: 0 };
    writeFileSync(`${output}/local-expired-fixture.json`, JSON.stringify(evidence.local_synthetic_fixture, null, 2), { flag: 'wx', mode: 0o600 });
  }
  for (const [role, profileRole, entitlementState] of roleDefinitions) {
    const email = `core-${role}-market-split-20260908-v1@local.test`;
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
    let serverIdentity = null, preActivationMembership = null;
    const localMembershipEvidence = role === 'anonymous' ? null : { role, before: null,
      activation_requests: 0, report_reader_ensure_requests: 0, status_checks: [],
      effective_privilege_preserved: false,
      owner_version_timestamp_effect: role === 'admin' ? 'Existing owner ensure UPSERT may increment version/update timestamps; raw values are not exposed by status.' : 'Existing valid entitlement path returns unchanged.',
    };
    if (localMembershipEvidence) evidence.local_auth_membership_side_effects.push(localMembershipEvidence);
    await context.routeWebSocket('**/*', socket => {
      const u = new URL(socket.url());
      if (u.protocol === 'ws:' && ['127.0.0.1:4313', '127.0.0.1:54371'].includes(u.host)) return socket.connectToServer();
      evidence.blocked_external.push(safeUrl(u.href)); socket.close({ code: 1008 });
    });
    await context.route('**/*', async route => {
      try {
      const request = route.request(), u = new URL(request.url());
      if (![origin, api, mail].includes(u.origin)) {
        // Offline presentational resources are explicit substitutes, not Market
        // or Auth responses. No request leaves the local test network.
        if (request.method() === 'GET' && ['fonts.googleapis.com', 'cdnjs.cloudflare.com'].includes(u.hostname)) {
          evidence.static_test_doubles.push(safeUrl(u.href)); return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        }
        if (request.method() === 'GET' && u.hostname === 'storage.readdy-site.link') {
          evidence.static_test_doubles.push(safeUrl(u.href)); return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
        }
        evidence.blocked_external.push(safeUrl(u.href)); return route.abort('blockedbyclient');
      }
      // Read application calls plus the normal existing-user PKCE callback.
      // Existing server ensure RPC side effects are recorded, never relabeled
      // read-only. Never issue direct DB/config/role writes or arbitrary calls.
      if (u.origin === api && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        const allowed = ['/auth/v1/otp', '/auth/v1/token', '/functions/v1/get-report-payload',
          '/functions/v1/member-access', '/rest/v1/rpc/get_public_performance_journal'].includes(u.pathname);
        const body = request.postDataJSON();
        const existingCallback = u.pathname === '/functions/v1/member-access' && body?.action === 'activate' && role !== 'anonymous';
        const statusOnly = u.pathname !== '/functions/v1/member-access' || body?.action === 'status' || existingCallback;
        if (!allowed || !statusOnly) {
          evidence.blocked_business_requests.push({ path: safeUrl(u.href), method: request.method() });
          return route.abort('blockedbyclient');
        }
        if (existingCallback) {
          // The existing UI invokes activate after real PKCE. Read the actual
          // server first; never change signup mode or substitute Auth responses.
          const response = await route.fetch({ postData: JSON.stringify({ action: 'status' }) });
          const status = await response.json();
          assert.equal(response.status(), 200);
          evidence.last_activation_check = { role, signup_mode: status.offer?.signup_mode,
            state: status.membership?.state, tier: status.membership?.tier, source: status.membership?.source,
            activation_sent: false };
          localMembershipEvidence.before ||= { membership: status.membership, offer: status.offer };
          assertExistingActivation(status, role, entitlementState);
          if (preActivationMembership) assertPreservedMembership(preActivationMembership, status.membership, role);
          preActivationMembership ||= status.membership;
          evidence.last_activation_check.activation_sent = true;
          localMembershipEvidence.activation_requests++;
        }
      }
      if (currentScenario && u.origin === api && u.pathname === '/functions/v1/get-report-payload') {
        assert.equal(serverIdentity?.authenticated, role !== 'anonymous');
        assert.equal(serverIdentity.tier, role === 'anonymous' ? 'free' : role);
        const payload = scenarioPayload(currentScenario);
        const replacement = matrixEnvelope(payload, serverIdentity, currentScenario);
        const requestBody = request.postDataJSON();
        if (requestBody?.history_limit !== undefined) {
          replacement.payload = null; replacement.report_date = null;
          replacement.reports = currentHistoryScenario ? historyReplays[currentHistoryScenario].reports
            : [{ ...payload, summary: payload.daily_sentence, today_quote: payload.daily_sentence }];
          if (currentHistoryScenario) replacement.today_date = historyReplays[currentHistoryScenario].today_date;
        }
        evidence.projection_payload_count++;
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(replacement) });
      }
      if (u.origin === api && u.pathname === '/functions/v1/get-report-payload' && role !== 'anonymous') {
        // The mounted reader itself invokes ensure_member_entitlement_v1.
        // Do not let an early authenticated reader bypass the callback guard.
        if (!preActivationMembership) {
          const response = await route.fetch({ url: api + '/functions/v1/member-access', postData: JSON.stringify({ action: 'status' }) });
          if (response.status() !== 401) {
            assert.equal(response.status(), 200);
            const status = await response.json();
            localMembershipEvidence.before ||= { membership: status.membership, offer: status.offer };
            assertExistingActivation(status, role, entitlementState);
            preActivationMembership = status.membership;
          }
        }
        if (preActivationMembership) localMembershipEvidence.report_reader_ensure_requests++;
      }
      return route.continue();
      } catch (error) {
        const failure = { role, state: currentScenario, path: safeUrl(route.request().url()), error: safeError(error.message) };
        evidence.route_errors.push(failure);
        // A route callback rejection must never become an unhandled Node crash
        // or discard already-passed cells. Each failure artifact is immutable.
        writeFileSync(`${output}/route-failure-${evidence.route_errors.length}.json`,
          JSON.stringify({ ...evidence, status: 'FAIL', error: failure.error }, null, 2), { flag: 'wx', mode: 0o600 });
        await route.abort('blockedbyclient').catch(() => {});
        await context.close(); // Stop this run; the outer finally flushes FAIL.
      }
    });
    const page = await context.newPage(); activePage = page; page.setDefaultTimeout(25000);
    page.on('console', m => { if (['warning', 'error'].includes(m.type())) evidence.console.push({ role, state: currentScenario, type: m.type(), text: safeError(m.text()) }); });
    page.on('pageerror', e => evidence.console.push({ role, state: currentScenario, type: 'pageerror', text: safeError(e.message) }));
    page.on('requestfailed', r => evidence.failed.push({ role, path: safeUrl(r.url()), error: safeError(r.failure()?.errorText) }));
    page.on('response', r => evidence.network.push({ role, state: currentScenario, path: safeUrl(r.url()), status: r.status(), method: r.request().method() }));
    if (role !== 'anonymous') {
      await page.goto(origin + '/login?next=%2Freport%2Ftoday'); await page.waitForLoadState('networkidle');
      const oldIds = new Set((await (await fetch(mail + '/api/v1/messages')).json()).messages?.map(m => m.ID));
      await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
      await page.getByRole('button', { name: '寄送登入連結', exact: true }).click();
      await page.getByRole('heading', { name: '登入信已寄出', exact: true }).waitFor();
      let message;
      for (let attempt = 0; attempt < 10; attempt++) {
        const inbox = await (await fetch(mail + '/api/v1/messages')).json();
        message = inbox.messages?.find(m => !oldIds.has(m.ID) && m.To?.some(t => t.Address === email));
        if (message) break; await new Promise(resolveWait => setTimeout(resolveWait, 200));
      }
      assert.ok(message, 'One local email requested; no automatic send retry');
      const mailBody = await (await fetch(mail + '/api/v1/message/' + message.ID)).json();
      const link = mailBody.HTML?.match(/href="([^"]+)"/i)?.[1]?.replaceAll('&amp;', '&');
      const verify = new URL(link); assert.equal(verify.origin, api); assert.equal(verify.pathname, '/auth/v1/verify');
      assert.equal(verify.searchParams.get('redirect_to'), origin + '/auth/callback?next=%2Freport%2Ftoday');
      await page.goto(link); await page.waitForURL(origin + '/report/today'); await page.waitForLoadState('networkidle');

    } else {
      await page.goto(origin + '/report/today'); await page.waitForLoadState('networkidle');
    }
    const readAccess = () => page.evaluate(async ({ baselineDate, anonymous }) => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      let access = null, membership = null, signupMode = null;
      if (!anonymous) {
        const { fetchMemberAccess } = await import('/src/services/membershipService.ts');
        const member = await fetchMemberAccess('status');
        const profile = await supabase.from('profiles').select('role').single();
        membership = member.membership; signupMode = member.offer.signup_mode;
        access = { role: profile.data?.role, state: member.membership.state, authenticated: member.success,
          code_removed: !globalThis.location.search.includes('code=') };
      }
      const response = await supabase.functions.invoke('get-report-payload', { body: { report_date: baselineDate } });
      return { access, membership, signupMode, sessionPresent: !!session, sessionError: !!sessionError, response: response.data, error: !!response.error };
    }, { baselineDate: fixtureSourceDate, anonymous: role === 'anonymous' });
    const verifyAccess = actual => {
      assert.equal(actual.sessionError, false); assert.equal(actual.sessionPresent, role !== 'anonymous');
      assert.equal(actual.error, false); assert.equal(actual.response.tier, role === 'anonymous' ? 'free' : role);
      assert.equal(actual.response.authenticated, role !== 'anonymous');
      assert.equal(actual.response.today_date, today, 'Current date must come from the actual local server');
      if (role !== 'anonymous') {
        assert.deepEqual(actual.access, { role: profileRole, state: entitlementState, authenticated: true, code_removed: true });
        assert.ok(['closed', 'beta_full', 'trialing'].includes(actual.signupMode));
        assert.ok(preActivationMembership, 'The existing callback must have real pre-activation status evidence');
        assertPreservedMembership(preActivationMembership, actual.membership, role);
        localMembershipEvidence.status_checks.push({ membership: actual.membership, signup_mode: actual.signupMode,
          report_reader_membership: actual.response.membership, server_tier: actual.response.tier });
        localMembershipEvidence.effective_privilege_preserved = true;
      }
      else assert.equal(actual.access, null, 'Anonymous is not an authenticated Free identity');
    };
    let actual = await readAccess(); verifyAccess(actual);
    // Preserve the actual server envelope identity/tier. No client tier inference.
    serverIdentity = { tier: actual.response.tier, authenticated: actual.response.authenticated,
      membership: actual.response.membership, today_date: actual.response.today_date,
      locked_sections: actual.response.locked_sections, source: actual.response.source };
    await page.reload(); await page.waitForLoadState('networkidle');
    actual = await readAccess(); verifyAccess(actual);
    const n = evidence.network.length, c = evidence.console.length;
    const rls = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const profiles = await supabase.from('profiles').select('id');
      const privateRows = await supabase.from('member_entitlements').select('user_id');
      return { ownProfiles: profiles.data?.length ?? 0, profilesDenied: Boolean(profiles.error),
        privateDenied: Boolean(privateRows.error), privateStatus: privateRows.status,
        privateErrorCode: privateRows.error?.code, privateDataNull: privateRows.data === null,
        privateErrorMessage: privateRows.error?.message };
    });
    assert.equal(rls.ownProfiles, role === 'anonymous' ? 0 : 1);
    assert.equal(rls.privateDenied, true);
    assert.equal(rls.privateStatus, role === 'anonymous' ? 401 : 403);
    assert.equal(rls.privateErrorCode, '42501'); assert.equal(rls.privateDataNull, true);
    if (role !== 'anonymous') assert.equal(rls.profilesDenied, false);
    await page.waitForTimeout(100);
    // PostgreSQL 42501 maps to HTTP 401 for an unauthenticated requester and
    // 403 for authenticated users. Exempt only this exact deliberate probe,
    // never other 401s, failed application requests or missing session data.
    const deniedRequests = evidence.network.slice(n).filter(row => row.path === api + '/rest/v1/member_entitlements'
      && row.method === 'GET' && row.status === rls.privateStatus);
    assert.equal(deniedRequests.length, 1); deniedRequests[0].expected = 'EXPLICIT_RLS_DENIAL';
    const deniedConsole = evidence.console.slice(c).filter(row => row.text ===
      `Failed to load resource: the server responded with a status of ${rls.privateStatus} (${role === 'anonymous' ? 'Unauthorized' : 'Forbidden'})`);
    assert.equal(deniedConsole.length, 1); deniedConsole[0].expected = 'EXPLICIT_RLS_DENIAL';
    assert.deepEqual(evidence.console.slice(c).filter(row => !row.expected), []);
    assert.deepEqual(evidence.network.slice(n).filter(row => row.status >= 400 && !row.expected), []);
    evidence.auth.push({ ...(actual.access || {}), role, profile_role: actual.access?.role ?? null, authenticated: actual.response.authenticated,
      session_present: actual.sessionPresent, server_tier: actual.response.tier, reload: 'PASS', rls });
    writeFileSync(`${output}/${role}-auth-rls.json`, JSON.stringify({ status: 'AUTH_RLS_PASS', auth: evidence.auth.at(-1),
      actual_private_response: { http: rls.privateStatus, code: rls.privateErrorCode, message: rls.privateErrorMessage, data: null },
      membership: actual.membership, scope, production_requests: 0 }, null, 2), { flag: 'wx', mode: 0o600 });


    for (const scenario of MATRIX_SCENARIOS) {
      currentScenario = scenario;
      const fixture = scenarioPayload(scenario);
      for (const path of ['/', '/report/today', `/reports/${fixture.report_date}`, '/verification', '/war-room']) {
        for (const width of role === 'anonymous' ? [375, 390, 430, 1440] : authenticatedWidths) {
          const device = `width-${width}`, height = width === 1440 ? 1000 : 844;
          await page.setViewportSize({ width, height });
          const firstNetwork = evidence.network.length, payloadBefore = evidence.projection_payload_count;
          evidence.last_attempt = { role, scenario, path, device, width, phase: 'navigation' };
          const response = await page.goto(origin + path); await page.waitForLoadState('networkidle');
          // Network quiet is not React lazy-route readiness: DeferredRoute's
          // legitimate Suspense fallback has no main. Wait for the actual
          // subscriber shell, then retain every exact identity/state check.
          evidence.last_attempt.phase = 'subscriber-shell-readiness';
          await page.locator('main[data-subscriber-state]').waitFor({ state: 'visible' });
          assert.equal(response.status(), 200); assert.equal(await page.locator('main').count(), 1);
          assert.ok(evidence.projection_payload_count > payloadBefore, `${path} must consume the scoped local fixture`);
          const expected = getSubscriberReportProjection(matrixEnvelope(fixture, serverIdentity, scenario), { todayDate: today, historical: path.startsWith('/reports/') });
          const markers = await page.locator('main').evaluate(el => ({ state: el.dataset.subscriberState,
            report_date: el.dataset.reportDate, revision_id: el.dataset.revisionId }));
          evidence.last_attempt = { role, scenario, path, device, width, phase: 'subscriber-assertions', markers,
            main_text: safeError((await page.locator('main').innerText()).slice(0, 2500)) };
          assert.deepEqual(markers, { state: expected.displayStatus, report_date: fixture.report_date, revision_id: fixture.revision_id },
            `${role}:${scenario}:${path} must render the shared projection identity/state`);
          if (['/war-room', '/verification'].includes(path) && expected.analysisAvailable && scenario !== 'STALE') {
            const details = page.locator('main details.ma-subscriber-timeline');
            assert.equal(await details.count(), 1, `${path} must expose one actual intraday detail disclosure`);
            await details.locator('summary').click();
            assert.equal(await details.getAttribute('open'), '', `${path} intraday details must actually be expanded`);
            const detailText = await details.innerText();
            assert.ok(detailText.length > 30); assert.doesNotMatch(detailText, /100\s*\/\s*100/);
            const checkpointRows = [];
            for (const [key, checkpoint] of Object.entries(expected.runtime.checkpoints)) {
              const time = `${key.slice(0, 2)}:${key.slice(2)}`;
              const item = details.locator('li').filter({ hasText: time });
              assert.equal(await item.count(), 1, `${path} must render checkpoint ${time} once`);
              const itemText = await item.innerText();
              if (checkpoint.status === 'completed') assert.match(itemText, /已完成/, `${scenario}:${path}:${time} keeps proven completion`);
              else assert.doesNotMatch(itemText, /已完成/, `${scenario}:${path}:${time} cannot claim unverified completion`);
              checkpointRows.push({ checkpoint: key, expected_status: checkpoint.status, completed_prose: /已完成/.test(itemText) });
            }
            if (CHECKPOINT_SCENARIOS.includes(scenario)) {
              assert.doesNotMatch(detailText, /舊修訂09:30已完成/,
                'Expanded narrative must not surface a raw or stale completion claim');
              assert.equal(expected.runtime.checkpoints['0930'].status, 'insufficient');
              assert.equal(expected.runtime.checkpoints['1030'].status, scenario === 'MIXED_OLD_0930_VALID_1030' ? 'completed' : 'insufficient');
            }
            evidence.checkpoint_details.push({ role, scenario, path, device, width, expanded: true,
              checkpoints: checkpointRows, raw_completion_prose_suppressed: !detailText.includes(UNVERIFIED_COMPLETION_PROSE), status: 'PASS' });
          }
          const text = await page.locator('main').innerText();
          assert.ok(text.length > 30); assert.doesNotMatch(text, /100\s*\/\s*100|\bundefined\b|\bNaN\b|Cannot read properties/);
          if (scenario === 'EMPTY_CANONICAL') {
            assert.equal(expected.analysisAvailable, true, 'Empty stock candidates cannot hide READY market analysis');
            assert.equal(expected.recommendation.available, false, 'QUALIFIED alone cannot establish stock availability');
            assert.deepEqual(expected.recommendation.items, []);
            assert.doesNotMatch(text, /合成測試公司/, 'Explicit empty canonical candidates must not fall back to raw stock arrays');
          }
          if (['PARTIAL', 'BLOCKED', 'FAILED', 'INVALIDATED'].includes(scenario)) {
            assert.doesNotMatch(text, /收盤驗證已完成|今日收盤驗證已完成/);
            if (scenario === 'PARTIAL') { assert.match(text, /尚未完成|證據不足/); assert.doesNotMatch(text, /條件(?:已)?失效|原劇本(?:已)?失效/); }
          }
          if (scenario === 'MARKET_READY_RECOMMENDATION_BLOCKED' && ['/', '/report/today'].includes(path)) assert.ok(text.includes(RECOMMENDATION_BLOCKED));
          if (scenario === 'STALE') assert.match(text, /歷史|先前|舊資料|非今日/);
          if (scenario === 'CLOSING_COMPLETE') {
            assert.equal(expected.closing.complete, true); assert.equal(expected.closing.outcome, 'hit');
            if (path === '/') assert.equal(await page.locator('#history-title').innerText(), '命中');
            if (path.startsWith('/reports/')) assert.match(text, /方向符合/);
            if (path === '/verification') {
              assert.match(text, /完整成立/); assert.match(text, /加權指數收盤上漲 1\.00%/);
            }
          }
          if (path === '/report/today' && expected.analysisAvailable && scenario !== 'STALE') {
            // The same 14:30 checkpoint may be the next-decision milestone;
            // select its immutable checkpoint identity, not a layout kicker.
            const lastCheckpoint = await page.locator('.ma-today-v4-progress article').filter({ hasText: '14:30｜收盤驗證' }).innerText();
            if (scenario === 'CLOSING_COMPLETE') assert.match(lastCheckpoint, /已完成/);
            else assert.doesNotMatch(lastCheckpoint, /已完成/, 'A captured close snapshot is not a completed verification');
          }
          if (scenario === 'RUNTIME_INVALIDATED') {
            assert.equal(expected.marketDecision.runtimeFailure, true); assert.equal(expected.marketDecision.action, 'STOP');
            if (path !== '/verification') assert.match(text, /條件已失效|判斷已失效|停止原定計畫/);
            assert.doesNotMatch(text, /完整成立|今日收盤驗證已完成/);
          }
          if (CHECKPOINT_SCENARIOS.includes(scenario)) {
            assert.doesNotMatch(text, /舊修訂09:30已完成/,
              'Subscriber body prose must not describe old or unverified intraday state as completed');
            assert.equal(expected.runtime.newIntradayEvidence, scenario === 'MIXED_OLD_0930_VALID_1030');
            if (path === '/war-room') {
              const completed = page.locator('.ma-war-room-v3-delta-grid .is-support');
              if (scenario === 'MIXED_OLD_0930_VALID_1030') {
                assert.equal(await completed.count(), 1);
                const prose = await completed.innerText();
                assert.match(prose, /10:?30/, 'A real current 10:30 receipt must remain in completed-step prose');
                assert.doesNotMatch(prose, /09:?30/, 'A stale 09:30 receipt must not piggyback on a valid 10:30 receipt');
              } else {
                assert.equal(await completed.count(), 0);
                assert.match(text, /還沒有新的盤中更新/);
                assert.doesNotMatch(text, /目前證據仍支持早上的判斷/);
              }
            }
          }
          const layout = await page.evaluate(() => {
            const { document, innerWidth } = globalThis;
            return { overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
              clipped: [...document.querySelectorAll('main a,main button')].filter(el => { if (!el.checkVisibility() || el.closest('[aria-hidden="true"],[inert]')) return false;
                const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -.5 || r.right > innerWidth + .5); }).length };
          });
          assert.deepEqual(layout, { overflow: 0, clipped: 0 }, `${scenario}:${path}:${width}`);
          const requests = evidence.network.slice(firstNetwork).filter(row => row.path.startsWith(api));
          assert.equal(requests.filter(row => row.status >= 400).length, 0);
          const counts = {}; for (const row of requests) counts[row.path] = (counts[row.path] || 0) + 1;
          assert.ok(Object.values(counts).every(count => count <= 6), 'Unexpected request storm');
          evidence.matrix.push({ role, scenario, path, device, width, report_date: fixture.report_date, revision_id: fixture.revision_id,
            projected_state: markers.state, recommendation_available: expected.recommendation.available,
            recommendation_count: expected.recommendation.items.length,
            status: 'PASS', http: 200, ...layout });
          if (['anonymous', 'admin'].includes(role) && path === '/report/today') await page.screenshot({ path: `${output}/${role}-${scenario}-${device}.png`, fullPage: true });
          if (role === 'anonymous') assert.equal(await page.evaluate(async () => {
            const { supabase } = await import('/src/lib/supabase.ts');
            return !!(await supabase.auth.getSession()).data.session;
          }), false, 'Anonymous cannot acquire a session during the presentation matrix');
        }
      }
      process.stdout.write(JSON.stringify({ stage: 'STATE_COMPLETE', role, scenario, completed: evidence.matrix.length }) + '\n');
    }
    if (includeHistory) {
      currentScenario = 'READY';
      for (const scenario of HISTORY_BROWSER_SCENARIOS) {
        currentHistoryScenario = scenario;
        const replay = historyReplays[scenario], expected = replay.expected;
        for (const path of ['/', '/performance']) for (const width of [375, 390, 430, 1440]) {
          const device = `width-${width}`;
          await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
          const payloadBefore = evidence.projection_payload_count, networkBefore = evidence.network.length;
          evidence.last_attempt = { role, scenario, path, device, width, phase: 'history-navigation' };
          const response = await page.goto(origin + path); await page.waitForLoadState('networkidle');
          evidence.last_attempt.phase = 'history-shell-readiness';
          if (path === '/') await page.locator('main[data-subscriber-state]').waitFor({ state: 'visible' });
          else {
            await page.locator('main').waitFor({ state: 'visible' });
            await page.getByText('正在核對可驗證的紀錄', { exact: true }).waitFor({ state: 'hidden' });
          }
          assert.equal(response.status(), 200); assert.equal(await page.locator('main').count(), 1);
          assert.ok(evidence.projection_payload_count > payloadBefore);
          const text = await page.locator('main').innerText();
          evidence.last_attempt = { role, scenario, path, device, width, phase: 'history-assertions', main_text: safeError(text.slice(0, 2500)) };
          assert.ok(text.length > 30); assert.doesNotMatch(text, /100\s*\/\s*100|SYNTHETIC_HISTORY_PRIVATE_STOCK|\bNaN\b|\bundefined\b/);
          if (path === '/performance') {
            assert.match(text, new RegExp(`已累積 ${expected.complete ? 1 : 0} 個有效交易日`));
            const entries = page.locator('.ma-performance-v3-ledger article');
            assert.equal(await entries.count(), expected.complete ? 1 : 0);
            if (expected.complete) {
              assert.match(await entries.innerText(), new RegExp(expected.report_date));
              await entries.locator('button').click();
              const detail = await entries.innerText(); assert.match(detail, /合成已驗證市場紀錄/);
              assert.match(detail, /等待新的市場證據/);
              assert.equal(await entries.getByRole('link', { name: '查看當日報告' }).getAttribute('href'), `/reports/${expected.report_date}`);
            } else assert.match(text, /資料不足|尚未/);
          } else {
            assert.equal(await page.locator('#history-title').count(), expected.complete ? 1 : 0);
            if (expected.complete) {
              const history = page.locator('section[aria-labelledby="history-title"]');
              assert.equal(await page.locator('#history-title').innerText(), '部分命中');
              assert.match(await history.innerText(), new RegExp(expected.report_date));
              // Home's compact card permits an omitted prose summary; the
              // Performance ledger above verifies the complete array content.
              assert.equal(await history.getByRole('link', { name: '查看完整歷史績效' }).getAttribute('href'), '/performance');
            }
          }
          const layout = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
            clipped: [...document.querySelectorAll('main a,main button')].filter(el => {
              if (!el.checkVisibility() || el.closest('[aria-hidden="true"],[inert]')) return false;
              const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -.5 || r.right > innerWidth + .5);
            }).length }));
          assert.deepEqual(layout, { overflow: 0, clipped: 0 });
          const requests = evidence.network.slice(networkBefore).filter(row => row.path.startsWith(api));
          assert.equal(requests.filter(row => row.status >= 400).length, 0);
          assert.equal(requests.filter(row => row.path.endsWith('/rpc/get_public_performance_journal')).length, 0);
          evidence.history_matrix.push({ role, scenario, path, device, width, ...expected, ...layout, status: 'PASS', http: 200,
            handler_database_queries: replay.evidence.queries.length, synthetic_persisted_rows: 0 });
          if (['anonymous', 'admin'].includes(role)) await page.screenshot({ path: `${output}/${role}-${scenario}-${path === '/' ? 'home' : 'performance'}-${device}.png`, fullPage: true });
        }
        process.stdout.write(JSON.stringify({ stage: 'HISTORY_STATE_COMPLETE', role, scenario, completed: evidence.history_matrix.length }) + '\n');
      }
    }
    currentHistoryScenario = null; currentScenario = null;
    if (role !== 'admin') {
      await page.evaluate(() => globalThis.localStorage.setItem('ma_tools', '1'));
      const start = evidence.network.length;
      const response = await page.goto(origin + '/voice'); await page.waitForLoadState('networkidle');
      assert.equal(response.status(), 200);
      assert.equal(await page.locator('main').getAttribute('data-internal-qa-authorized'), 'false');
      assert.match(await page.locator('main').innerText(), /僅供經伺服器確認的管理員/);
      const requests = evidence.network.slice(start);
      const rawRequests = requests.filter(row => /\/rest\/v1\/(?:voice_reports|market_data|market_news|reports)(?:$|\/)/.test(row.path));
      assert.deepEqual(rawRequests, [], 'A forged internal UI preference must not mount raw QA readers');
      assert.equal(requests.filter(row => row.status >= 400).length, 0);
      await page.evaluate(() => globalThis.localStorage.removeItem('ma_tools'));
      evidence.voice_gate.push({ role, server_tier: serverIdentity.tier, forged_preference: 'ma_tools=1', status: 'PASS', raw_requests: 0 });
    }
    actual = await readAccess(); verifyAccess(actual);
    sourceCheck();
    writeFileSync(`${output}/${role}-completed.json`, JSON.stringify({ ...evidence, status: 'ROLE_COMPLETE', completed_role: role }, null, 2), { flag: 'wx', mode: 0o600 });
    await context.close();
  }
  assert.equal(evidence.matrix.length, evidence.expected_matrix_cells);
  assert.equal(evidence.history_matrix.length, evidence.expected_history_cells);
  assert.equal(evidence.checkpoint_details.length, (MATRIX_SCENARIOS.length - 5) * 2 * widthCount,
    'Every available non-stale state must include expanded War Room and Verification details for all roles/devices');
  assert.equal(evidence.voice_gate.length, roleDefinitions.filter(([role]) => role !== 'admin').length);
  assert.deepEqual(evidence.console.filter(row => !row.expected), []); assert.deepEqual(evidence.failed, []);
  assert.deepEqual(evidence.blocked_external, []); assert.equal(evidence.network.filter(row => row.status >= 400 && !row.expected).length, 0);
  assert.deepEqual(evidence.blocked_business_requests, []);
  assert.deepEqual(evidence.route_errors, []);
  sourceCheck(); evidence.source_unchanged = true;
} catch (error) {
  evidence.error ||= evidence.route_errors[0]?.error || safeError(error.message); process.exitCode ||= 1;
  evidence.error_stack = safeError(error.stack || error.message);
  if (activePage && !activePage.isClosed()) {
    try {
      evidence.failure_page = { url: safeUrl(activePage.url()),
        body_text: safeError((await activePage.locator('body').innerText({ timeout: 2000 })).slice(0, 5000)) };
      await activePage.screenshot({ path: `${output}/matrix-failure.png`, fullPage: true, timeout: 5000 });
      evidence.failure_page.screenshot = 'matrix-failure.png';
    } catch (diagnosticError) { evidence.failure_diagnostic_error = safeError(diagnosticError.message); }
  }
}
finally {
  try { sourceCheck(); evidence.source_unchanged = true; }
  catch (error) { evidence.source_check_error = safeError(error.message); evidence.error ||= evidence.source_check_error; process.exitCode ||= 1; }
  await browser.close(); evidence.status = process.exitCode ? 'FAIL' : 'PASS';
  writeFileSync(output + '/consolidation-subscriber-matrix-results.json', JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: evidence.status, date: today, auth_roles: evidence.auth.length, matrix: evidence.matrix.length,
    history_matrix: evidence.history_matrix.length,
    source_unchanged: evidence.source_unchanged, sql_executions: evidence.sql_executions, error: evidence.error }) + '\n');
}
