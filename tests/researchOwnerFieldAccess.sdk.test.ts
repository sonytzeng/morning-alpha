// Actual fixed SDK 2.115.0 and actual Reader with SYNTHETIC in-memory HTTP.
// Run cached-only with network/env/filesystem permissions denied; not Production E2E.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { canReadResearchOwnerFields } from '../supabase/functions/_shared/research-owner-field-access.ts';

const URL_BASE = 'https://synthetic-reader.invalid';
const ANON = 'synthetic-anon-not-a-credential';
const SERVICE = 'synthetic-service-not-a-credential';
const TOKEN = 'synthetic-request-jwt-not-a-credential';
const UID = '00000000-0000-4000-8000-000000000001';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
type Trace = { path: string; method: string; key: string | null; authorization: string | null; body: string | null };
const input = () => ({ request: new Request(URL_BASE, { headers: { Authorization: 'Bearer ' + TOKEN } }),
  tier: 'admin', userId: UID, supabaseUrl: URL_BASE, anonKey: ANON, createClient });

async function transport<T>(options: { owner?: unknown; authId?: string; authDelay?: number; rpcDelay?: number; fail?: boolean | 'rpc' }, run: (trace: Trace[]) => Promise<T>): Promise<T> {
  const nativeFetch = globalThis.fetch, trace: Trace[] = [], logs: unknown[][] = [];
  const nativeError = console.error, nativeWarn = console.warn;
  console.error = (...args: unknown[]) => { logs.push(args); };
  console.warn = (...args: unknown[]) => { logs.push(args); };
  globalThis.fetch = async (value, init) => {
    const request = new Request(value, init), url = new URL(request.url);
    assert(url.origin === URL_BASE, 'unexpected destination');
    const key = request.headers.get('apikey');
    assert(key === ANON || key === SERVICE, 'unexpected synthetic key');
    assert(request.headers.get('authorization') === 'Bearer ' + TOKEN || key === SERVICE, 'request JWT changed');
    trace.push({ path: url.pathname, method: request.method, key,
      authorization: request.headers.get('authorization'), body: request.method === 'POST' ? await request.text() : null });
    if (options.fail === true || (options.fail === 'rpc' && url.pathname.endsWith('/is_research_owner_v1'))) throw new Error('SYNTHETIC_TRANSPORT_FAILURE_NOT_FOR_LOGGING');
    if (url.pathname === '/auth/v1/user') {
      if (key === ANON && options.authDelay) await new Promise(resolve => setTimeout(resolve, options.authDelay));
      return Response.json({ id: key === ANON ? options.authId ?? UID : UID, aud: 'authenticated',
        app_metadata: {}, user_metadata: { owner: true }, created_at: '2026-01-01T00:00:00Z' });
    }
    if (url.pathname === '/rest/v1/rpc/is_research_owner_v1') {
      assert(key === ANON, 'Owner RPC used privileged credential');
      assert(request.method === 'POST', 'predicate must use POST');
      if (options.rpcDelay) await new Promise(resolve => setTimeout(resolve, options.rpcDelay));
      return Response.json(Object.hasOwn(options, 'owner') ? options.owner : true);
    }
    if (url.pathname === '/rest/v1/rpc/ensure_member_entitlement_v1') {
      assert(key === SERVICE, 'legacy entitlement flow changed');
      return Response.json({ state: 'paid_active', tier: 'member', owner: true, access_ends_at: '2099-01-01T00:00:00Z' });
    }
    assert(request.method === 'GET', 'unexpected write');
    if (url.pathname === '/rest/v1/profiles') return Response.json([{ role: 'admin', subscription_status: 'active' }]);
    if (url.pathname === '/rest/v1/reports') return Response.json([{ id: 'synthetic-report', report_date: '2026-10-16',
      ai_strategy_json: { generated_at: '2026-10-16T00:00:00Z', legacy_diagnostic: { keep: true },
        recommendation_stock_evidence: { captures: [], legacy_receipt: 'keep', foundation_candidate: { private_marker: 'SDK_SYNTHETIC_RECEIPT' } } } }]);
    const tables = ['opening_market_radar', 'sector_rotation_scores', 'market_data_snapshots', 'trading_day_state',
      'close_market_reviews', 'learning_runs', 'learning_metric_corrections', 'market_quotes', 'news_events',
      'institutional_flows', 'earnings_events', 'sector_stock_map', 'catalyst_tw_mappings', 'research_catalysts', 'model_evaluations'];
    assert(tables.some(table => url.pathname === '/rest/v1/' + table), 'unapproved synthetic table ' + url.pathname);
    return Response.json([]);
  };
  try { const result = await run(trace); assert(logs.length === 0, 'SDK must not log raw transport errors'); return result; }
  finally { globalThis.fetch = nativeFetch; console.error = nativeError; console.warn = nativeWarn; }
}

Deno.test('SYNTHETIC fixed SDK: same JWT Auth then literal Owner predicate, anon transport only', async () => {
  await transport({}, async trace => {
    assert(await canReadResearchOwnerFields(input()));
    assert(trace.length === 2); assert(trace[0].path === '/auth/v1/user');
    assert(trace[1].path === '/rest/v1/rpc/is_research_owner_v1');
    assert(trace.every(call => call.key === ANON && call.authorization === 'Bearer ' + TOKEN));
    assert(trace[1].body === '{}');
  });
});

Deno.test('SYNTHETIC fixed SDK: identity mismatch cannot start predicate RPC', async () => {
  await transport({ authId: '00000000-0000-4000-8000-000000000002' }, async trace => {
    assert(!await canReadResearchOwnerFields(input())); assert(trace.length === 1);
  });
});

Deno.test('SYNTHETIC fixed SDK: nonboolean predicate responses fail closed', async () => {
  for (const owner of ['true', { owner: true }, [true], 1, false, null]) await transport({ owner }, async trace => {
    assert(!await canReadResearchOwnerFields(input())); assert(trace.length === 2);
  });
});

Deno.test('SYNTHETIC fixed SDK: transport error is denied without retry', async () => {
  for (const fail of [true, 'rpc'] as const) await transport({ fail }, async trace => {
    assert(!await canReadResearchOwnerFields(input())); assert(trace.length === (fail === true ? 1 : 2));
  });
});

Deno.test('SYNTHETIC fixed SDK: late Auth cannot start RPC after the total deadline', async () => {
  await transport({ authDelay: 2100 }, async trace => {
    const started = performance.now(); assert(!await canReadResearchOwnerFields(input()));
    assert(performance.now() - started < 2600);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert(trace.length === 1);
  });
});

Deno.test('SYNTHETIC fixed SDK: Auth and predicate share one 2s budget', async () => {
  await transport({ authDelay: 1200, rpcDelay: 1000 }, async trace => {
    const started = performance.now(); assert(!await canReadResearchOwnerFields(input()));
    assert(performance.now() - started < 2600);
    await new Promise(resolve => setTimeout(resolve, 300)); assert(trace.length === 2);
  });
});

let reader: ((request: Request) => Promise<Response>) | undefined;
const nativeServe = Deno.serve;
try {
  Deno.serve = ((handler: typeof reader) => { reader = handler; return {}; }) as typeof Deno.serve;
  await import('../supabase/functions/get-report-payload/index.ts');
} finally { Deno.serve = nativeServe; }

async function readActual(history = false): Promise<Record<string, unknown>> {
  const nativeGet = Deno.env.get;
  try {
    Deno.env.get = (name: string) => ({ SUPABASE_URL: URL_BASE, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE })[name as 'SUPABASE_URL'];
    assert(reader, 'actual Reader entrypoint was not captured');
    const response = await reader(new Request(URL_BASE + '/functions/v1/get-report-payload', {
      method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(history ? { history_limit: 1 } : { report_date: '2026-10-16', tier: 'admin', owner: true }),
    }));
    assert(response.status === 200); return await response.json();
  } finally { Deno.env.get = nativeGet; }
}

Deno.test('SYNTHETIC actual Reader + fixed SDK: nonOwner admin raw copy strips only new receipt; Owner retains it', async () => {
  let denied: Record<string, unknown>;
  await transport({ owner: false }, async trace => {
    denied = await readActual(); const payload = denied.payload as Record<string, unknown>;
    assert(payload.owner_market_foundation_candidate === undefined);
    assert(!JSON.stringify(denied).includes('SDK_SYNTHETIC_RECEIPT'));
    const raw = payload.admin_source_report as { ai_strategy_json: { legacy_diagnostic: { keep: boolean }; recommendation_stock_evidence: { legacy_receipt: string } } };
    assert(raw.ai_strategy_json.legacy_diagnostic.keep); assert(raw.ai_strategy_json.recommendation_stock_evidence.legacy_receipt === 'keep');
    assert(trace.filter(call => call.path.endsWith('/is_research_owner_v1')).length === 1);
  });
  await transport({}, async () => {
    const allowed = await readActual(), payload = allowed.payload as Record<string, unknown>;
    assert(payload.owner_market_foundation_candidate); assert(JSON.stringify(allowed).includes('SDK_SYNTHETIC_RECEIPT'));
    assert(JSON.stringify(payload.decision_engine_v1) === JSON.stringify((denied.payload as Record<string, unknown>).decision_engine_v1));
  });
});

Deno.test('SYNTHETIC actual Reader + fixed SDK: history always omits receipt and skips Owner checks', async () => {
  await transport({}, async trace => {
    const body = await readActual(true); assert(Array.isArray(body.reports) && body.reports.length === 1);
    assert(!JSON.stringify(body).includes('foundation_candidate'));
    assert(!trace.some(call => call.key === ANON));
  });
});
