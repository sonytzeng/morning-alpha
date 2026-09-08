// Opt-in, actual isolated Supabase + real subscriber routes. No mocked Auth,
// intercepted payload, Production endpoint, provider request, or notification.
// Existing synthetic report/decision fixture values are restored byte-for-byte.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateMarketReportGate } from '../../supabase/functions/_shared/market-report-gate.ts';

const scope = 'ma-core-final-20260907';
assert.equal(process.env.MA_LOCAL_SCOPE, scope, 'Explicit isolated scope required');
assert.equal(process.env.MA_SUBSCRIBER_STATE_FIXTURES, 'YES', 'Explicit reversible local fixture authorization required');
const repo = resolve(new URL('../..', import.meta.url).pathname);
const output = process.env.MA_E2E_OUTPUT;
assert.ok(output?.startsWith('/private/tmp/'), 'Private temporary evidence directory required');
assert.equal(existsSync(output), false, 'Never overwrite previous acceptance evidence');
const origin = 'http://127.0.0.1:4313', api = 'http://127.0.0.1:54371', mail = 'http://127.0.0.1:54374';
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
assert.equal(date, '2026-09-08', 'This explicitly dated synthetic fixture must not masquerade as a new trading day');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = process.env.MA_E2E_SOURCE_MANIFEST;
assert.ok(manifestPath?.startsWith('/private/tmp/'), 'Final source fingerprint required');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.ok(Array.isArray(manifest.files) && manifest.files.length > 20);
const sourceCheck = () => { for (const file of manifest.files) assert.equal(digest(readFileSync(resolve(repo, file.path))), file.sha256, `Source drift: ${file.path}`); };
sourceCheck();
const integrity = execFileSync(process.execPath, ['--test', 'tests/coreProductionPreservation.test.mjs', 'tests/productContract.test.mjs'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
assert.match(integrity, /# fail 0/, 'Original integrity tests must pass before local Auth');

const docker = (...args) => execFileSync('docker', ['--context', 'colima-ma-core-20260907', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const networkName = 'ma-core-final-isolated-20260907';
assert.equal(docker('network', 'inspect', '--format', '{{.Internal}}', networkName), 'true');
for (const service of ['db', 'kong', 'auth', 'edge_runtime', 'inbucket']) {
  assert.deepEqual(Object.keys(JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Networks}}', `supabase_${service}_${scope}`))), [networkName]);
}
const rawSql = statement => execFileSync('docker', ['--context', 'colima-ma-core-20260907', 'exec', '-i', `supabase_db_${scope}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const read = query => rawSql(`begin read only;\n${query}\nrollback;`);
assert.equal(read('select scope from ma_isolated_guard.identity;'), scope);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const write = query => rawSql(`begin; do $$ begin if (select scope from ma_isolated_guard.identity) is distinct from '${scope}' then raise exception 'LOCAL_SCOPE_MISMATCH'; end if; end $$;\n${query}\ncommit;`);
const report = JSON.parse(read(`select to_jsonb(r) from public.reports r where report_date=${quote(date)};`));
const decision = JSON.parse(read(`select to_jsonb(d) from public.decision_snapshots d where id=${quote(report.ai_strategy_json.revision_id)};`));
assert.equal(decision.report_id, report.id); assert.equal(decision.report_date, date); assert.equal(decision.status, 'READY');
assert.equal(read(`select count(*) from public.close_market_reviews where report_date=${quote(date)};`), '0', 'Do not overwrite an existing close review');
assert.equal(read(`select count(*) from public.decision_snapshots where report_date=${quote(date)} and session_type='CLOSING' and is_current;`), '0', 'Do not hide an existing closing snapshot');
assert.equal(read("select count(*) from pg_trigger where not tgisinternal and tgrelid='public.reports'::regclass;"), '0', 'Report restoration requires unchanged no-trigger contract');
const columns = table => JSON.parse(read(`select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name=${quote(table)} and is_generated='NEVER';`));
const reportColumns = columns('reports'), decisionColumns = columns('decision_snapshots');
const replace = (table, row, fields) => {
  assert.ok(['reports', 'decision_snapshots'].includes(table));
  const names = fields.filter(k => k !== 'id').map(k => `"${k}"`);
  return `update public.${table} set (${names.join(',')})=(select ${names.join(',')} from jsonb_populate_record(null::public.${table},${json(row)})) where id=${quote(row.id)} and report_date=${quote(date)};`;
};
const fingerprint = () => read(`select jsonb_build_object(
  'reports',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb)::text) from public.reports r),
  'decisions',(select md5(coalesce(jsonb_agg(to_jsonb(d) order by id),'[]'::jsonb)::text) from public.decision_snapshots d),
  'members',(select md5(coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb)::text) from public.member_content_revisions m),
  'line',(select md5(coalesce(jsonb_agg(to_jsonb(l) order by id),'[]'::jsonb)::text) from public.line_delivery_outbox l),
  'checkpoints',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by trading_date),'[]'::jsonb)::text) from public.trading_day_state t),
  'raw',(select md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb)::text) from public.market_data_snapshots s),
  'users',(select count(*) from auth.users),
  'access',(select md5(jsonb_agg(to_jsonb(c)-'updated_at' order by config_key)::text) from public.membership_access_config c));`);
const originalSignup = read("select signup_mode from public.membership_access_config where config_key='primary';");
assert.ok(['closed', 'beta_full', 'trialing'].includes(originalSignup));
const signup = mode => { assert.ok(['closed', 'beta_full', 'trialing'].includes(mode)); write(`update public.membership_access_config set signup_mode=${quote(mode)} where config_key='primary';`); };
const before = fingerprint();
const resetFixture = () => write(replace('reports', report, reportColumns) + '\n' + replace('decision_snapshots', decision, decisionColumns));

const scenarios = [
  { name: 'READY_PUBLISHED', publication: 'PUBLISHED', analysis: 'READY', closing: 'NOT_DUE', recommendation: 'QUALIFIED', confidence: 90 },
  { name: 'PARTIAL_UNPUBLISHED', publication: 'UNPUBLISHED', analysis: 'PARTIAL', closing: 'INSUFFICIENT_EVIDENCE', recommendation: 'BLOCKED', confidence: null },
  { name: 'MARKET_READY_RECOMMENDATION_BLOCKED', publication: 'PUBLISHED', analysis: 'READY', closing: 'NOT_DUE', recommendation: 'BLOCKED', confidence: 90 },
  { name: 'CLOSING_NOT_DUE', publication: 'PUBLISHED', analysis: 'READY', closing: 'NOT_DUE', recommendation: 'QUALIFIED', confidence: 90 },
  { name: 'CLOSING_COMPLETE', publication: 'PUBLISHED', analysis: 'READY', closing: 'COMPLETE', recommendation: 'QUALIFIED', confidence: 90 },
  { name: 'INSUFFICIENT_EVIDENCE', publication: 'UNPUBLISHED', analysis: 'INSUFFICIENT_EVIDENCE', closing: 'NOT_DUE', recommendation: 'BLOCKED', confidence: null },
  { name: 'READY_MISSING_CONFIDENCE', publication: 'PUBLISHED', analysis: 'READY', closing: 'NOT_DUE', recommendation: 'QUALIFIED', confidence: null },
];
function fixture(scenario) {
  const r = structuredClone(report), d = structuredClone(decision), ai = r.ai_strategy_json;
  const completeClose = { status: 'completed', data_status: 'complete', report_date: date,
    opening_decision_snapshot_id: d.id, verified_at: `${date}T14:30:00+08:00`, prediction_result: 'hit', hit_or_miss: 'hit',
    actual_taiex_change: 0.5, actual_2330_close: { change_percent: 0.4 }, actual_txf_close: { change_percent: 0.3 },
    missing_data: [], source: 'LOCAL_SYNTHETIC_SUBSCRIBER_STATE_FIXTURE' };
  ai.closing_verification_v2 = scenario.name === 'CLOSING_COMPLETE' || scenario.name === 'PARTIAL_UNPUBLISHED'
    ? completeClose : { status: 'NOT_DUE', report_date: date, source: 'LOCAL_SYNTHETIC_SUBSCRIBER_STATE_FIXTURE' };
  // A legacy completed alias must not override an explicit current NOT_DUE.
  ai.closing_verification = completeClose;
  if (['PARTIAL_UNPUBLISHED', 'CLOSING_NOT_DUE'].includes(scenario.name)) {
    ai.intraday_sync_status = { ...ai.intraday_sync_status, report_date: date,
      lifecycle_complete: true, windows: Object.fromEntries(['0900', '0930', '1030', '1300', '1410', '1430'].map(checkpoint => [checkpoint, {
        status: 'completed', completed_at: `${date}T${checkpoint.slice(0, 2)}:${checkpoint.slice(2)}:00+08:00`,
        real_checkpoint_observation: true, evidence: { source: 'LOCAL_SYNTHETIC_STATE_CONFLICT', core_batch_complete: true },
      }])) };
  }
  d.confidence_score = 90;
  if (scenario.name === 'READY_MISSING_CONFIDENCE') {
    d.confidence_score = null; ai.confidence_score = 100; ai.quality_score = 100;
    r.confidence_score = 100;
  }
  if (scenario.publication === 'UNPUBLISHED') {
    // Deliberately poison legacy aliases: they must not promote private QA to a
    // published judgment, invalidation, completed closing, or perfect confidence.
    delete ai.revision_id; delete ai.canonical_member_revision_id;
    ai.confidence_score = 100; ai.quality_score = 100; ai.content_score = 100;
    ai.report_status = scenario.analysis === 'PARTIAL' ? 'PARTIAL' : 'INSUFFICIENT_DATA';
    ai.content_publish_gate = { overall_status: 'blocked' };
    ai.publish_ready = false; ai.canonical_action = 'STOP';
    ai.content_evidence_quality.verified_market_count = 0;
    d.status = scenario.analysis === 'PARTIAL' ? 'PARTIAL' : 'INSUFFICIENT_DATA';
    d.confidence_score = null; d.action = 'STOP';
    if (scenario.analysis === 'INSUFFICIENT_EVIDENCE') d.content_score = 0;
  }
  if (scenario.name === 'MARKET_READY_RECOMMENDATION_BLOCKED') {
    for (const key of ['today_beneficiary_stocks', 'today_beneficiary_stocks_v10', 'beneficiary_stocks', 'core_beneficiary_stocks']) ai[key] = [];
    ai.research_master_v2.sections.representative_stocks = [];
    ai.decision_mode = 'market_only'; ai.canonical_action = 'WAIT'; ai.report_status = 'READY'; ai.recommendation_status = 'BLOCKED';
    const gate = evaluateMarketReportGate(ai, date);
    assert.equal(gate.eligible, true, `Market fixture fails actual quality gate: ${gate.reason_codes.join(',')}`);
    assert.equal(gate.recommendation_status, 'BLOCKED');
    ai.market_report_gate = gate; ai.recommendation_gate = gate.recommendation_gate;
    d.generated_text.market_report_gate = gate; d.generated_text.recommendations = [];
    d.generated_text.stock_opportunities = []; d.generated_text.opportunity_score = null;
    d.decision_mode = 'market_only'; d.action = 'WAIT'; d.content_score = gate.content_score;
  }
  write(replace('reports', r, reportColumns) + '\n' + replace('decision_snapshots', d, decisionColumns));
  const actual = JSON.parse(read(`select jsonb_build_object('status',status,'confidence',confidence_score,'mode',decision_mode) from public.decision_snapshots where id=${quote(d.id)};`));
  assert.equal(actual.status, d.status, 'Real decision trigger changed fixture status');
  assert.equal(actual.confidence, d.confidence_score);
}

mkdirSync(output, { recursive: true });
writeFileSync(output + '/local-fixture-backup.json', JSON.stringify({ scope, report, decision }, null, 2), { flag: 'wx', mode: 0o600 });
const safeUrl = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[INVALID_URL]'; } };
const safeError = value => String(value).replace(/(?:https?|wss?):\S+/g, safeUrl).replace(/eyJ[\w.-]+/g, '[REDACTED]').replace(/\b[^\s@]+@[^\s@]+\b/g, '[LOCAL_IDENTITY]');
const evidence = { scope, source_manifest_sha256: digest(readFileSync(manifestPath)), integrity_sha256: digest(integrity), baseline: [], matrix: [], payloads: [], history: [], network: [], websockets: [], console: [], failures: [], blocked_external: [], fixture_restored: false, production_requests: 0 };
const { chromium } = await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.MA_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const widths = [375, 390, 430, 768, 1440];
const incomplete = '今日分析尚未完成／證據不足';
const recommendationNotice = '推薦評估證據不足，今日暫不發布正式個股推薦';
let currentScenario = null;

function checkPayload(body, role) {
  if (!body.payload) return;
  const p = body.payload, state = p.subscriber_state;
  assert.equal(state.schema_version, 'ma-subscriber-state-v1');
  for (const field of ['report_date', 'revision_id', 'generated_at']) { assert.equal(state[field], p[field], field); assert.equal(state[field], body[field], field); }
  assert.equal(body.report_date, date, 'Current unfinished report must not become stale previous day');
  assert.equal(body.revision_id, decision.id);
  assert.equal(p.confidence_score, state.confidence.value);
  if (p.ai_strategy_json) {
    assert.deepEqual(p.ai_strategy_json.subscriber_state, state, 'Admin nested AI cannot carry a mixed state schema/revision');
    assert.equal(p.ai_strategy_json.confidence_score, state.confidence.value);
  }
  if (currentScenario) {
    for (const field of ['publication', 'analysis', 'closing', 'recommendation']) assert.equal(state[field], currentScenario[field], currentScenario.name + ':' + field);
    assert.equal(state.confidence.value, currentScenario.confidence);
    assert.equal(state.confidence.status, currentScenario.confidence === null ? 'UNAVAILABLE' : 'AVAILABLE');
    if (state.closing !== 'COMPLETE') {
      assert.equal(['completed', 'complete', 'ready', 'success', 'succeeded'].includes(String(p.intraday_sync_status?.windows?.['1430']?.status || '').toLowerCase()), false,
        'Backward-compatible 14:30 alias must not claim a completed closing result');
    }
    if (state.publication === 'UNPUBLISHED') {
      assert.equal(p.canonical_decision.status, currentScenario.analysis);
      assert.equal(p.canonical_decision.action, 'WAIT');
      assert.equal(p.canonical_decision.confidence_score, null);
      assert.equal(p.closing_verification, null);
      assert.equal(p.decision_engine_v1.model_confidence, null);
      assert.equal(p.decision_engine_v1.direction_probability, null);
      assert.equal(p.decision_engine_v1.entry_environment_score, null);
      assert.equal(p.today_quote, incomplete); assert.equal(p.content_publish_gate.overall_status, 'blocked');
    }
    if (state.recommendation === 'BLOCKED') {
      assert.equal(p.beneficiary_count, 0); assert.equal(p.one_teaser_stock, null);
      assert.equal((p.today_beneficiary_stocks || []).length, 0);
      assert.equal((p.canonical_decision?.recommendations || []).length, 0);
      assert.equal((p.decision_engine_v1?.stock_opportunities || []).length, 0);
      assert.equal(p.recommendation_message, recommendationNotice);
    }
  } else {
    assert.equal(state.publication, 'PUBLISHED'); assert.equal(state.analysis, 'READY');
    assert.equal(state.recommendation, 'QUALIFIED');
    const symbols = (p.today_beneficiary_stocks || []).map(s => s.symbol || s.stock_code);
    if (!body.authenticated || role === 'free') assert.deepEqual(symbols, []);
    else assert.deepEqual(symbols, ['2330']);
  }
  evidence.payloads.push({ scenario: currentScenario?.name || 'BASELINE', role, tier: body.tier, authenticated: body.authenticated, report_date: body.report_date, revision_id: body.revision_id, subscriber_state: state, stock_count: (p.today_beneficiary_stocks || []).length });
}

try {
  signup('closed');
  for (const [role, profileRole, entitlementState] of [['free', 'free', 'free'], ['member', 'free', 'paid_active'], ['admin', 'admin', 'owner']]) {
    const email = `core-${role}-market-split-20260908-v1@local.test`;
    assert.equal(read(`select p.role||':'||coalesce(e.state,'free') from public.profiles p left join public.member_entitlements e on e.user_id=p.id where p.email=${quote(email)};`), profileRole + ':' + entitlementState);
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.routeWebSocket('**/*', ws => { const u = new URL(ws.url()); if (u.protocol === 'ws:' && ['127.0.0.1:4313', '127.0.0.1:54371'].includes(u.host)) return ws.connectToServer(); evidence.blocked_external.push(safeUrl(u.href)); ws.close({ code: 1008 }); });
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if ([origin, api, mail].includes(u.origin)) return route.continue();
      if (route.request().method() === 'GET' && u.protocol === 'https:' && ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'storage.readdy-site.link'].includes(u.hostname)) return route.continue();
      evidence.blocked_external.push(safeUrl(u.href)); return route.abort('blockedbyclient');
    });
    const page = await context.newPage(), pending = new Set(), payloadErrors = [];
    page.setDefaultTimeout(25000);
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) evidence.console.push({ role, scenario: currentScenario?.name, type: m.type(), text: safeError(m.text()) }); });
    page.on('pageerror', e => evidence.console.push({ role, type: 'pageerror', text: safeError(e.message) }));
    page.on('requestfailed', r => evidence.failures.push({ role, path: safeUrl(r.url()), error: safeError(r.failure()?.errorText) }));
    page.on('websocket', socket => {
      const row = { role, path: safeUrl(socket.url()), errors: [], reply_status: [] }; evidence.websockets.push(row);
      socket.on('socketerror', error => row.errors.push(safeError(error)));
      socket.on('framereceived', frame => {
        try {
          const value = JSON.parse(String(frame.payload));
          if (Array.isArray(value) && value[3] === 'phx_reply') row.reply_status.push(value[4]?.status);
          else if (value.event === 'phx_reply') row.reply_status.push(value.payload?.status);
        } catch { /* Protocol text is not evidence and is never retained. */ }
      });
    });
    page.on('response', r => {
      evidence.network.push({ role, path: safeUrl(r.url()), status: r.status(), method: r.request().method() });
      if (safeUrl(r.url()) !== api + '/functions/v1/get-report-payload' || r.status() !== 200) return;
      const task = r.json().then(d => checkPayload(d, role)).catch(e => payloadErrors.push(safeError(e.message)));
      pending.add(task); task.finally(() => pending.delete(task));
    });
    const settled = async () => { while (pending.size) await Promise.all([...pending]); assert.deepEqual(payloadErrors, []); };
    await page.goto(origin + '/login?next=%2Freport%2Ftoday');
    await page.waitForLoadState('networkidle'); await settled();
    const oldIds = new Set((await (await fetch(mail + '/api/v1/messages')).json()).messages?.map(m => m.ID));
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await page.getByRole('button', { name: '寄送登入連結', exact: true }).click();
    await page.getByRole('heading', { name: '登入信已寄出', exact: true }).waitFor();
    let message;
    for (let attempt = 0; attempt < 10; attempt++) {
      const inbox = await (await fetch(mail + '/api/v1/messages')).json();
      message = inbox.messages?.find(m => !oldIds.has(m.ID) && m.To?.some(t => t.Address === email));
      if (message) break; await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(message, 'Exactly one local email requested; do not resend');
    const emailBody = await (await fetch(mail + '/api/v1/message/' + message.ID)).json();
    const link = emailBody.HTML?.match(/href="([^"]+)"/i)?.[1]?.replaceAll('&amp;', '&');
    const verify = new URL(link); assert.equal(verify.origin, api); assert.equal(verify.pathname, '/auth/v1/verify');
    assert.equal(verify.searchParams.get('redirect_to'), origin + '/auth/callback?next=%2Freport%2Ftoday');
    await page.waitForLoadState('networkidle'); await settled();
    await page.goto(link); await page.waitForURL(origin + '/report/today'); await page.waitForLoadState('networkidle'); await settled();
    const getAccess = () => page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.ts'); const { fetchMemberAccess } = await import('/src/services/membershipService.ts'); const access = await fetchMemberAccess('status'); const profile = await supabase.from('profiles').select('role').single(); return { role: profile.data?.role, state: access.membership.state, authenticated: access.success, code_removed: !location.search.includes('code=') }; });
    assert.deepEqual(await getAccess(), { role: profileRole, state: entitlementState, authenticated: true, code_removed: true });
    await page.reload(); await page.waitForLoadState('networkidle'); await settled();
    assert.deepEqual(await getAccess(), { role: profileRole, state: entitlementState, authenticated: true, code_removed: true });
    if (role === 'free') {
      const override = await page.evaluate(async () => {
        localStorage.setItem('tier', 'admin'); localStorage.setItem('role', 'admin');
        const { supabase } = await import('/src/lib/supabase.ts');
        const response = await supabase.functions.invoke('get-report-payload', { body: { tier: 'vip' } });
        const user = await supabase.auth.getUser();
        return { tier: response.data?.tier, authenticated: response.data?.authenticated,
          metadata_role: user.data.user?.user_metadata?.role, metadata_tier: user.data.user?.user_metadata?.tier };
      });
      assert.deepEqual(override, { tier: 'free', authenticated: true, metadata_role: 'admin', metadata_tier: 'vip' });
      await settled();
    }
    const networkStart = evidence.network.length, consoleStart = evidence.console.length;
    const privateRead = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.ts');
      const profiles = await supabase.from('profiles').select('id');
      const entitlements = await supabase.from('member_entitlements').select('user_id');
      return { own_profiles: profiles.data?.length, private_entitlements_denied: !!entitlements.error };
    });
    assert.deepEqual(privateRead, { own_profiles: 1, private_entitlements_denied: true });
    await page.waitForTimeout(150);
    for (const row of evidence.network.slice(networkStart)) if (row.path === api + '/rest/v1/member_entitlements' && row.status === 403) row.expected = 'INTENTIONAL_PRIVATE_TABLE_RLS_REJECTION';
    for (const row of evidence.console.slice(consoleStart)) if (row.text === 'Failed to load resource: the server responded with a status of 403 (Forbidden)') row.expected = 'INTENTIONAL_PRIVATE_TABLE_RLS_REJECTION';

    async function visit(path, bucket) {
      const n = evidence.network.length, p = evidence.payloads.length;
      const response = await page.goto(origin + path); await page.waitForLoadState('networkidle'); await settled();
      assert.equal(response.status(), 200); assert.equal(await page.locator('main').count(), 1);
      const text = await page.locator('main').innerText(); assert.ok(text.length > 40);
      assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|Cannot read properties/);
      if (path !== '/performance') assert.ok(evidence.payloads.length > p, path + ' must consume real local payload');
      const requests = evidence.network.slice(n).filter(row => row.path.startsWith(api));
      assert.equal(requests.filter(row => row.status >= 400).length, 0);
      const counts = {}; for (const row of requests) counts[row.path] = (counts[row.path] || 0) + 1;
      assert.ok(Object.values(counts).every(value => value <= 6), path + ' request storm');
      if (currentScenario) {
        if (currentScenario.confidence === null && /100\s*\/\s*100/.test(text)) {
          const matches = await page.locator('main').evaluate(root => [...root.querySelectorAll('*')].filter(el =>
            el.checkVisibility() && /100\s*\/\s*100/.test(el.innerText || '')
            && ![...el.children].some(child => child.checkVisibility() && /100\s*\/\s*100/.test(child.innerText || '')),
          ).slice(0, 10).map(el => ({ tag: el.tagName, className: String(el.className), text: el.innerText.slice(0, 240) })));
          evidence.rendered_confidence_failure = { scenario: currentScenario.name, path,
            matches: matches.map(row => ({ ...row, text: safeError(row.text) })) };
          await page.screenshot({ path: `${output}/failure-missing-confidence.png`, fullPage: true });
        }
        if (currentScenario.confidence === null) assert.doesNotMatch(text, /100\s*\/\s*100/, path + ' missing confidence must not fall back to a quality score');
        if (currentScenario.publication === 'UNPUBLISHED') {
          assert.ok(text.includes(incomplete), path + ' missing explicit unfinished analysis');
          assert.doesNotMatch(text, /(?:今日|原定).*條件(?:已)?失效|收盤驗證已完成|(?:^|\n)收盤完成(?:\n|$)|100\s*\/\s*100/);
        }
        if (currentScenario.closing !== 'COMPLETE') assert.doesNotMatch(text, /今日收盤驗證已完成|收盤驗證已完成/);
        if (path === '/verification' && currentScenario.closing === 'COMPLETE') {
          assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), '完整成立');
          assert.ok(text.includes('已取得可核對的收盤方向與完整資料'));
        }
        if (path === '/war-room' && currentScenario.closing !== 'COMPLETE') {
          const finalNode = await page.locator('.ma-war-room-v3-feed li').evaluateAll(rows => rows.filter(row => row.querySelector('time')?.textContent === '14:30').map(row => ({ className: row.className, text: row.textContent })));
          assert.equal(finalNode.length, 1, 'Final War Room checkpoint must exist');
          assert.ok(finalNode.every(row => !row.className.includes('is-completed')), 'Captured checkpoint is not closing verification completion');
        }
        if (currentScenario.name === 'MARKET_READY_RECOMMENDATION_BLOCKED' && ['/', '/report/today'].includes(path)) assert.ok(text.includes(recommendationNotice), path + ' missing blocked recommendation explanation');
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        const layout = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), body_overflow: Math.max(0, document.body.scrollWidth - innerWidth), clipped_ctas: [...document.querySelectorAll('main a,main button')].filter(el => { if (!el.checkVisibility() || el.closest('[aria-hidden="true"],[inert]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -.5 || r.right > innerWidth + .5); }).length }));
        assert.deepEqual(layout, { overflow: 0, body_overflow: 0, clipped_ctas: 0 }, `${path}:${width}`);
        bucket.push({ role, scenario: currentScenario?.name || 'BASELINE', path, width, http: 200, ...layout });
        if (role === 'admin' && path === '/report/today') await page.screenshot({ path: `${output}/${currentScenario?.name || 'BASELINE'}-${width}.png`, fullPage: true });
      }
    }
    for (const path of ['/', '/report/today', '/opportunities', '/war-room', '/member-note', '/verification', '/performance']) await visit(path, evidence.baseline);
    if (role === 'admin') {
      for (const scenario of scenarios) {
        await settled(); currentScenario = scenario; fixture(scenario);
        for (const path of ['/', '/report/today', '/war-room', '/verification']) await visit(path, evidence.matrix);
        const history = await page.evaluate(async () => {
          const { callGetReportHistory } = await import('/src/services/entitlementService.ts');
          const response = await callGetReportHistory(3);
          return response.reports;
        });
        const currentHistory = history.find(row => row.report_date === date);
        assert.ok(currentHistory, 'History must not replace an unfinished current report with the previous day');
        assert.equal(currentHistory.subscriber_state.schema_version, 'ma-subscriber-state-v1');
        assert.equal(currentHistory.subscriber_state.publication, scenario.publication);
        assert.equal(currentHistory.confidence_score, scenario.confidence);
        if (scenario.publication === 'UNPUBLISHED') {
          assert.equal(currentHistory.today_quote, incomplete);
          assert.equal(currentHistory.summary, incomplete);
          assert.equal(currentHistory.market_bias, '分析尚未完成');
        } else assert.equal(currentHistory.revision_id, decision.id);
        evidence.history.push({ scenario: scenario.name, report_date: currentHistory.report_date,
          revision_id: currentHistory.revision_id, confidence: currentHistory.confidence_score,
          publication: currentHistory.subscriber_state.publication });
        await settled(); resetFixture(); currentScenario = null;
      }
    }
    await context.close();
  }
  assert.equal(evidence.baseline.length, 105); assert.equal(evidence.matrix.length, scenarios.length * 4 * widths.length);
  assert.deepEqual(evidence.console.filter(row => !row.expected), []); assert.deepEqual(evidence.failures, []); assert.deepEqual(evidence.blocked_external, []);
  assert.equal(evidence.network.filter(row => row.status >= 400 && !row.expected).length, 0);
  for (const socket of evidence.websockets) {
    assert.deepEqual(socket.errors, []); assert.ok(socket.reply_status.every(status => status === 'ok'));
  }
  sourceCheck();
} catch (error) {
  evidence.error = safeError(error.message); process.exitCode = 1;
} finally {
  try { resetFixture(); signup(originalSignup); assert.equal(fingerprint(), before); evidence.fixture_restored = true; }
  catch (error) { evidence.restore_error = safeError(error.message); process.exitCode = 1; }
  await browser.close();
  evidence.status = process.exitCode ? 'FAIL' : 'PASS';
  writeFileSync(output + '/subscriber-state-results.json', JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: evidence.status, baseline_checks: evidence.baseline.length, matrix_checks: evidence.matrix.length, fixture_restored: evidence.fixture_restored, error: evidence.error, restore_error: evidence.restore_error }));
}
