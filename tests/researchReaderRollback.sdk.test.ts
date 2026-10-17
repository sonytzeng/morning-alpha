// SAFE ROLLBACK acceptance, derived from researchOwnerFieldAccess.sdk.test.ts.
// Actual Reader + fixed SDK 2.115.0; SYNTHETIC HTTP-memory fixtures only.
// No Production Auth/RLS/E2E claim. Run cached-only with all runtime permissions denied.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';

type Row = Record<string, unknown>;
type Role = { name: string; expected: string; profileRole: string; state: string; entitlementTier: string; owner: boolean; anonymous?: boolean };
type Trace = { path: string; method: string; key: string | null; authorization: string | null; body: string | null };
const URL_BASE = 'https://synthetic-reader.invalid';
const ANON = 'synthetic-anon-not-a-credential';
const SERVICE = 'synthetic-service-not-a-credential';
const TOKEN = 'synthetic-request-jwt-not-a-credential';
const UID = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-10-17T02:00:00Z';
const MARKER = 'SYNTHETIC_PRIVATE_FOUNDATION_RECEIPT';
const roles: Role[] = [
  { name: 'Owner admin', expected: 'admin', profileRole: 'admin', state: 'owner', entitlementTier: 'admin', owner: true },
  { name: 'nonOwner admin', expected: 'admin', profileRole: 'admin', state: 'paid_active', entitlementTier: 'member', owner: false },
  { name: 'free', expected: 'free', profileRole: 'user', state: 'free', entitlementTier: 'free', owner: false },
  { name: 'premium', expected: 'member', profileRole: 'user', state: 'paid_active', entitlementTier: 'member', owner: false },
  { name: 'VIP', expected: 'vip', profileRole: 'user', state: 'paid_active', entitlementTier: 'vip', owner: false },
  { name: 'anonymous', expected: 'free', profileRole: 'user', state: 'free', entitlementTier: 'free', owner: false, anonymous: true },
];
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
function object(value: unknown): Row { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Row; }
function freeze(value: unknown) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
}
function sourceReport(date: string, stringAi: boolean, receipt: boolean): Row {
  const ai = { generated_at: date + 'T00:00:00Z', legacy_diagnostic: { keep: 'existing diagnostic' },
    recommendation_stock_evidence: { contract: 'RECOMMENDATION_STOCK_EVIDENCE_V1', captures: [],
      legacy_receipt: { keep: 7 }, ...(receipt ? { foundation_candidate: { private_marker: MARKER } } : {}) } };
  const row = { id: 'synthetic-rollback-report', report_date: date, report_mode: 'normal_overnight',
    summary: 'existing summary', today_quote: 'existing quote', market_bias: '觀察中', confidence_score: 0,
    unrelated_diagnostic: { keep: true }, ai_strategy_json: stringAi ? JSON.stringify(ai) : ai };
  freeze(row); return row;
}

let reader: ((request: Request) => Promise<Response>) | undefined;
const nativeServe = Deno.serve;
try {
  assert(typeof createClient === 'function', 'fixed SDK unavailable');
  Deno.serve = ((handler: typeof reader) => { reader = handler; return {}; }) as typeof Deno.serve;
  await import('../supabase/functions/get-report-payload/index.ts');
} finally { Deno.serve = nativeServe; }

async function runReader(role: Role, options: { history?: boolean; historicalDetail?: boolean; stringAi?: boolean; receipt?: boolean } = {}) {
  const date = options.historicalDetail ? '2026-09-11' : '2026-10-16';
  const report = sourceReport(date, options.stringAi ?? false, options.receipt !== false);
  const before = JSON.stringify(report), decoded: Row[] = [], trace: Trace[] = [], envReads: string[] = [], logs: unknown[][] = [];
  const nativeFetch = globalThis.fetch, nativeGet = Deno.env.get, nativeParse = JSON.parse, NativeDate = Date;
  const nativeError = console.error, nativeWarn = console.warn;
  class FixedDate extends NativeDate {
    constructor(value?: string | number | Date) { super(value === undefined ? NOW : value instanceof NativeDate ? value.getTime() : value); }
    static override now() { return NativeDate.parse(NOW); }
  }
  globalThis.Date = FixedDate as DateConstructor;
  console.error = (...args: unknown[]) => { logs.push(args); };
  console.warn = (...args: unknown[]) => { logs.push(args); };
  // Freeze the real SDK's decoded Report, not only the HTTP fixture. This proves
  // the actual Reader can project a copy without deleting from its input row.
  JSON.parse = (text, reviver) => {
    const parsed = nativeParse(text, reviver);
    if (Array.isArray(parsed) && parsed.length === 1 && parsed[0]?.id === report.id) {
      freeze(parsed); decoded.push(parsed[0]);
    }
    return parsed;
  };
  Deno.env.get = (name: string) => {
    envReads.push(name);
    return ({ SUPABASE_URL: URL_BASE, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE } as Record<string, string>)[name];
  };
  globalThis.fetch = async (value, init) => {
    const request = new Request(value, init), url = new URL(request.url), key = request.headers.get('apikey');
    assert(url.origin === URL_BASE, 'unexpected destination');
    assert(key === SERVICE || key === ANON, 'unexpected synthetic key');
    trace.push({ path: url.pathname, method: request.method, key, authorization: request.headers.get('authorization'),
      body: request.method === 'POST' ? await request.text() : null });
    if (url.pathname === '/auth/v1/user') {
      assert(!role.anonymous, 'anonymous request unexpectedly authenticated');
      assert(request.headers.get('authorization') === 'Bearer ' + TOKEN, 'request JWT changed');
      return Response.json({ id: UID, aud: 'authenticated', app_metadata: {}, user_metadata: { owner: role.owner }, created_at: '2026-01-01T00:00:00Z' });
    }
    // Unexpected Owner calls are recorded rather than hidden by a failed stub:
    // every acceptance case independently requires zero such calls afterward.
    if (url.pathname === '/rest/v1/rpc/is_research_owner_v1') return Response.json(role.owner);
    if (url.pathname === '/rest/v1/rpc/ensure_member_entitlement_v1') {
      assert(key === SERVICE && request.method === 'POST', 'legacy entitlement flow changed');
      return Response.json({ state: role.state, tier: role.entitlementTier, source: 'synthetic-existing-entitlement', access_ends_at: '2099-01-01T00:00:00Z' });
    }
    assert(request.method === 'GET', 'unexpected business write');
    if (url.pathname === '/rest/v1/profiles') return Response.json([{ role: role.profileRole, subscription_status: 'inactive' }]);
    if (url.pathname === '/rest/v1/reports') return Response.json([report]);
    const tables = ['opening_market_radar', 'sector_rotation_scores', 'market_data_snapshots', 'trading_day_state',
      'close_market_reviews', 'learning_runs', 'learning_metric_corrections', 'market_quotes', 'news_events',
      'institutional_flows', 'earnings_events', 'sector_stock_map', 'catalyst_tw_mappings', 'research_catalysts', 'model_evaluations'];
    assert(tables.some(table => url.pathname === '/rest/v1/' + table), 'unexpected synthetic table ' + url.pathname);
    return Response.json([]);
  };
  try {
    assert(reader, 'actual Reader entrypoint not captured');
    const response = await reader(new Request(URL_BASE + '/functions/v1/get-report-payload?tier=admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(role.anonymous ? {} : { Authorization: 'Bearer ' + TOKEN }) },
      body: JSON.stringify(options.history ? { history_limit: 1, tier: 'admin', owner: true } : { report_date: date, tier: 'admin', owner: true }),
    }));
    assert(response.status === 200, 'Reader contract status changed');
    const body = object(await response.json());
    assert(body.tier === role.expected && body.authenticated === !role.anonymous, 'existing tier contract changed');
    assert(JSON.stringify(report) === before, 'HTTP fixture mutated');
    assert(decoded.length > 0, 'test must observe the actual SDK-decoded Report');
    assert(decoded.every(row => Object.isFrozen(row) && JSON.stringify(row) === before), 'actual Reader input mutated');
    assert(!JSON.stringify(body).includes(MARKER) && !JSON.stringify(body).includes('"foundation_candidate"'), 'private receipt leaked');
    assert(!JSON.stringify(body).includes('owner_market_foundation_candidate'), 'withdrawn Owner study emitted');
    assert(!trace.some(call => call.path.endsWith('/is_research_owner_v1')), 'Owner predicate RPC started');
    assert(!trace.some(call => call.key === ANON), 'rollback started an Owner Auth client');
    assert(!envReads.includes('SUPABASE_ANON_KEY'), 'rollback read new Owner Auth configuration');
    assert(trace.filter(call => call.path === '/auth/v1/user').length === (role.anonymous ? 0 : 1), 'existing Auth flow changed');
    assert(logs.length === 0, 'unexpected raw diagnostic log');
    return { body, report, date, trace };
  } finally {
    globalThis.fetch = nativeFetch; Deno.env.get = nativeGet; JSON.parse = nativeParse; globalThis.Date = NativeDate;
    console.error = nativeError; console.warn = nativeWarn;
  }
}

for (const role of roles) {
  Deno.test(`SYNTHETIC rollback actual SDK: ${role.name} detail always strips receipt; no Owner checks`, async () => {
    const { body, report, date } = await runReader(role), payload = object(body.payload);
    assert(body.report_date === date && payload.report_date === date, 'detail date changed');
    assert(object(payload.decision_engine_v1).schema_version === 'decision-evidence-v1', 'formal decision contract missing');
    assert(Array.isArray(body.locked_sections) && body.source === 'server_trimmed_payload');
    if (role.expected === 'admin') {
      const expected = sourceReport(date, false, false);
      assert(JSON.stringify(payload.admin_source_report) === JSON.stringify(expected), 'unrelated raw report fields changed');
      assert(JSON.stringify(report).includes(MARKER), 'input receipt must remain stored');
    } else assert(payload.admin_source_report === undefined, 'raw diagnostics crossed tier boundary');
  });
  Deno.test(`SYNTHETIC rollback actual SDK: ${role.name} historical detail is stripped`, async () => {
    const { body, date } = await runReader(role, { historicalDetail: true });
    assert(body.report_date === date && object(body.payload).report_date === date);
    assert(body.today_date === '2026-10-17' && body.today_date !== date, 'history date impersonates today');
  });
  Deno.test(`SYNTHETIC rollback actual SDK: ${role.name} history omits all raw receipts`, async () => {
    const { body, date } = await runReader(role, { history: true });
    assert(body.payload === null && body.report_date === null);
    assert(Array.isArray(body.reports) && body.reports.length === 1);
    assert(object(body.reports[0]).report_date === date);
    assert(!JSON.stringify(body).includes('legacy_diagnostic'), 'history began exposing raw diagnostics');
  });
  Deno.test(`SYNTHETIC rollback actual SDK: ${role.name} every other output equals no-new-receipt control`, async () => {
    const withReceipt = await runReader(role), legacy = await runReader(role, { receipt: false });
    assert(JSON.stringify(withReceipt.body) === JSON.stringify(legacy.body), 'new receipt changed another Reader contract');
  });
}

for (const role of roles.filter(role => role.expected === 'admin')) Deno.test(`SYNTHETIC rollback actual SDK: ${role.name} string-AI copy preserves every unrelated diagnostic`, async () => {
  const { body, date } = await runReader(role, { stringAi: true });
  const raw = object(object(body.payload).admin_source_report), expected = sourceReport(date, true, false);
  assert(typeof raw.ai_strategy_json === 'string', 'legacy AI representation changed');
  assert(JSON.stringify(raw) === JSON.stringify(expected), 'string-AI raw diagnostics changed');
});
