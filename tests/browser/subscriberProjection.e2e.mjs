// Opt-in subscriber *presentation* E2E. Local GoTrue/PKCE, server profile,
// entitlement and RLS are real. Only the local report-reader response is replayed
// with declared synthetic states, after its real server tier has been verified.
// This is NOT provider, generation/publication, or Production acceptance proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { subscriberProjectionFixture, subscriberFixtureEnvelope, PROJECTION_SCENARIOS, RECOMMENDATION_BLOCKED } from '../fixtures/subscriber-projection-v1.mjs';
import { getSubscriberReportProjection } from '../../src/lib/subscriberReportProjection.ts';

const scope = 'ma-core-final-20260907';
const { fetch } = globalThis;
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.equal(process.env.MA_SUBSCRIBER_PROJECTION_MATRIX, 'YES', 'Explicit local report-response fixture permission required');
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
for (const service of ['db', 'kong', 'auth', 'edge_runtime', 'inbucket']) {
  assert.deepEqual(Object.keys(JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', `supabase_${service}_${scope}`))), [network]);
}
const sql = statement => execFileSync('docker', ['--context', 'colima-ma-core-20260907', 'exec', '-i', `supabase_db_${scope}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const read = query => sql(`begin read only;\n${query}\nrollback;`);
assert.equal(read('select scope from ma_isolated_guard.identity;'), scope);
const originalSignup = read("select signup_mode from public.membership_access_config where config_key='primary';");
assert.ok(['closed', 'beta_full', 'trialing'].includes(originalSignup));
const signup = mode => {
  assert.ok(['closed', 'beta_full', 'trialing'].includes(mode));
  sql(`begin; do $$ begin if (select scope from ma_isolated_guard.identity) is distinct from '${scope}' then raise exception 'LOCAL_SCOPE_MISMATCH'; end if; end $$;
    update public.membership_access_config set signup_mode='${mode}' where config_key='primary'; commit;`);
};
const fingerprint = () => read(`select jsonb_build_object(
  'reports',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb)::text) from public.reports r),
  'decisions',(select md5(coalesce(jsonb_agg(to_jsonb(d) order by id),'[]'::jsonb)::text) from public.decision_snapshots d),
  'members',(select md5(coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb)::text) from public.member_content_revisions m),
  'line',(select md5(coalesce(jsonb_agg(to_jsonb(l) order by id),'[]'::jsonb)::text) from public.line_delivery_outbox l),
  'users',(select count(*) from auth.users),
  'access',(select md5(jsonb_agg(to_jsonb(c)-'updated_at' order by config_key)::text) from public.membership_access_config c));`);
const before = fingerprint();
const digest = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = [...new Set([
  ...execFileSync('git', ['ls-files', '-z', '--', 'src', 'shared'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean),
  'src/lib/subscriberReportProjection.ts', 'tests/fixtures/subscriber-projection-v1.mjs',
  'tests/fixtures/subscriber-projection-legacy-payload44.json', 'tests/browser/subscriberProjection.e2e.mjs',
])];
const sourceHashes = Object.fromEntries(sourcePaths.filter(path => existsSync(resolve(repo, path))).map(path => [path, digest(readFileSync(resolve(repo, path)))]));
const sourceCheck = () => { for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(digest(readFileSync(resolve(repo, path))), hash, `Source changed during E2E: ${path}`); };
const legacy = JSON.parse(readFileSync(new URL('../fixtures/subscriber-projection-legacy-payload44.json', import.meta.url), 'utf8'));
const CHECKPOINT_SCENARIOS = ['STALE_ONLY_RECEIPTS', 'MIXED_OLD_0930_VALID_1030'];
const MATRIX_SCENARIOS = [...PROJECTION_SCENARIOS, ...CHECKPOINT_SCENARIOS];
const UNVERIFIED_COMPLETION_PROSE = '舊修訂09:30已完成，盤中判斷已確認';
const scenarioPayload = name => {
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
mkdirSync(output, { recursive: true });
const safeUrl = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[INVALID_URL]'; } };
const safeError = value => String(value).replace(/(?:https?|wss?):\S+/g, safeUrl).replace(/eyJ[\w.-]+/g, '[REDACTED]').replace(/\b[^\s@]+@[^\s@]+\b/g, '[LOCAL_IDENTITY]');
const evidence = { scope, business_date: today, baseline_fixture_date: fixtureSourceDate,
  method: 'REAL_LOCAL_AUTH_RLS_WITH_SYNTHETIC_LOCAL_REPORT_RESPONSE', full_stack_publication_claim: false,
  captured_legacy_payload_version: 44, captured_legacy_source_sha256: legacy.provenance.source_sha256,
  source_hashes: sourceHashes, auth: [], matrix: [], checkpoint_details: [], voice_gate: [], network: [], console: [], failed: [], blocked_external: [],
  static_test_doubles: [], projection_payload_count: 0, business_unchanged: false, production_requests: 0 };
const { chromium } = await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.MA_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let currentScenario = null;
try {
  signup('closed');
  for (const [role, profileRole, entitlementState] of [['free', 'free', 'free'], ['member', 'free', 'paid_active'], ['admin', 'admin', 'owner']]) {
    const email = `core-${role}-market-split-20260908-v1@local.test`;
    assert.equal(read(`select p.role||':'||coalesce(e.state,'free') from public.profiles p left join public.member_entitlements e on e.user_id=p.id where p.email='${email}';`), profileRole + ':' + entitlementState);
    const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
    let serverIdentity = null;
    await context.routeWebSocket('**/*', socket => {
      const u = new URL(socket.url());
      if (u.protocol === 'ws:' && ['127.0.0.1:4313', '127.0.0.1:54371'].includes(u.host)) return socket.connectToServer();
      evidence.blocked_external.push(safeUrl(u.href)); socket.close({ code: 1008 });
    });
    await context.route('**/*', async route => {
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
      if (currentScenario && u.origin === api && u.pathname === '/functions/v1/get-report-payload') {
        assert.ok(serverIdentity?.authenticated); assert.equal(serverIdentity.tier, role);
        const payload = scenarioPayload(currentScenario);
        const replacement = subscriberFixtureEnvelope(payload, serverIdentity);
        const requestBody = request.postDataJSON();
        if (requestBody?.history_limit !== undefined) {
          replacement.payload = null; replacement.report_date = null;
          replacement.reports = [{ ...payload, summary: payload.daily_sentence, today_quote: payload.daily_sentence }];
        }
        evidence.projection_payload_count++;
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(replacement) });
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    page.on('console', m => { if (['warning', 'error'].includes(m.type())) evidence.console.push({ role, state: currentScenario, type: m.type(), text: safeError(m.text()) }); });
    page.on('pageerror', e => evidence.console.push({ role, state: currentScenario, type: 'pageerror', text: safeError(e.message) }));
    page.on('requestfailed', r => evidence.failed.push({ role, path: safeUrl(r.url()), error: safeError(r.failure()?.errorText) }));
    page.on('response', r => evidence.network.push({ role, state: currentScenario, path: safeUrl(r.url()), status: r.status(), method: r.request().method() }));
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
    const readAccess = () => page.evaluate(async baselineDate => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const { fetchMemberAccess } = await import('/src/services/membershipService.ts');
      const access = await fetchMemberAccess('status'); const profile = await supabase.from('profiles').select('role').single();
      const response = await supabase.functions.invoke('get-report-payload', { body: { report_date: baselineDate } });
      return { access: { role: profile.data?.role, state: access.membership.state, authenticated: access.success,
        code_removed: !globalThis.location.search.includes('code=') }, response: response.data, error: !!response.error };
    }, fixtureSourceDate);
    let actual = await readAccess();
    assert.deepEqual(actual.access, { role: profileRole, state: entitlementState, authenticated: true, code_removed: true });
    assert.equal(actual.error, false); assert.equal(actual.response.tier, role); assert.equal(actual.response.authenticated, true);
    serverIdentity = { tier: actual.response.tier, authenticated: actual.response.authenticated, membership: actual.response.membership,
      today_date: today, locked_sections: actual.response.locked_sections, source: actual.response.source };
    await page.reload(); await page.waitForLoadState('networkidle'); actual = await readAccess();
    assert.deepEqual(actual.access, { role: profileRole, state: entitlementState, authenticated: true, code_removed: true });
    assert.equal(actual.response.tier, role);
    const n = evidence.network.length, c = evidence.console.length;
    const rls = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const profiles = await supabase.from('profiles').select('id');
      const privateRows = await supabase.from('member_entitlements').select('user_id');
      return { ownProfiles: profiles.data?.length, privateDenied: Boolean(privateRows.error) };
    });
    assert.deepEqual(rls, { ownProfiles: 1, privateDenied: true }); await page.waitForTimeout(100);
    for (const row of evidence.network.slice(n)) if (row.path === api + '/rest/v1/member_entitlements' && row.status === 403) row.expected = 'EXPLICIT_RLS_DENIAL';
    for (const row of evidence.console.slice(c)) if (row.text === 'Failed to load resource: the server responded with a status of 403 (Forbidden)') row.expected = 'EXPLICIT_RLS_DENIAL';
    evidence.auth.push({ role, ...actual.access, server_tier: actual.response.tier, reload: 'PASS', rls });

    for (const scenario of MATRIX_SCENARIOS) {
      currentScenario = scenario;
      const fixture = scenarioPayload(scenario);
      for (const path of ['/', '/report/today', `/reports/${fixture.report_date}`, '/verification', '/war-room']) {
        for (const [device, width, height] of [['mobile', 390, 844], ['desktop', 1440, 1000]]) {
          await page.setViewportSize({ width, height });
          const firstNetwork = evidence.network.length, payloadBefore = evidence.projection_payload_count;
          const response = await page.goto(origin + path); await page.waitForLoadState('networkidle');
          assert.equal(response.status(), 200); assert.equal(await page.locator('main').count(), 1);
          assert.ok(evidence.projection_payload_count > payloadBefore, `${path} must consume the scoped local fixture`);
          const expected = getSubscriberReportProjection(subscriberFixtureEnvelope(fixture, serverIdentity), { todayDate: today, historical: path.startsWith('/reports/') });
          const markers = await page.locator('main').evaluate(el => ({ state: el.dataset.subscriberState,
            report_date: el.dataset.reportDate, revision_id: el.dataset.revisionId }));
          evidence.last_attempt = { role, scenario, path, device, width, markers,
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
            projected_state: markers.state,
            status: 'PASS', http: 200, ...layout });
          if (role === 'admin' && path === '/report/today') await page.screenshot({ path: `${output}/${scenario}-${device}.png`, fullPage: true });
        }
      }
      process.stdout.write(JSON.stringify({ stage: 'STATE_COMPLETE', role, scenario, completed: evidence.matrix.length }) + '\n');
    }
    currentScenario = null;
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
    await context.close();
  }
  assert.equal(evidence.matrix.length, MATRIX_SCENARIOS.length * 5 * 2 * 3);
  assert.equal(evidence.checkpoint_details.length, (MATRIX_SCENARIOS.length - 5) * 2 * 2 * 3,
    'Every available non-stale state must include expanded War Room and Verification details for all roles/devices');
  assert.equal(evidence.voice_gate.length, 2);
  assert.deepEqual(evidence.console.filter(row => !row.expected), []); assert.deepEqual(evidence.failed, []);
  assert.deepEqual(evidence.blocked_external, []); assert.equal(evidence.network.filter(row => row.status >= 400 && !row.expected).length, 0);
  sourceCheck();
} catch (error) { evidence.error = safeError(error.message); process.exitCode = 1; }
finally {
  try { signup(originalSignup); assert.equal(fingerprint(), before); evidence.business_unchanged = true; }
  catch (error) { evidence.restore_error = safeError(error.message); process.exitCode = 1; }
  await browser.close(); evidence.status = process.exitCode ? 'FAIL' : 'PASS';
  writeFileSync(output + '/subscriber-projection-results.json', JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: evidence.status, date: today, auth_roles: evidence.auth.length, matrix: evidence.matrix.length,
    business_unchanged: evidence.business_unchanged, error: evidence.error, restore_error: evidence.restore_error }) + '\n');
}
