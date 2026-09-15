import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import {
  authorizeInternalRequest,
  constantTimeEqual,
  internalCredentialsFromEnv,
  INTERNAL_AUTH_ERROR_CODES,
} from '../_shared/internal-function-auth.mjs';
import {
  FUGLE_TAIEX_CONTRACT,
  resolveFugleTaiexProvider,
} from '../_shared/fugle-taiex-provider.mjs';
import {
  REQUIRED_PROVIDER_COUNT,
  REQUIRED_PROVIDER_SLOTS,
  describeProductionResponseShape,
  sanitizeProductionMarketPayload,
  stableJson,
  validateRequiredProviderRegistry,
} from '../_shared/provider-reliability-contract.mjs';

const VERSION = 'MARKET_READINESS_PREFLIGHT_V1';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization, x-cron-secret, x-daily-delivery-token, x-internal-auth-version',
  'Content-Type': 'application/json',
};
const PROVIDER_TIMEOUT_MS = 5_000;

type JsonRecord = Record<string, unknown>;
type CheckStatus = 'PASS' | 'FAIL';
type ReadinessStatus = 'READY' | 'DEGRADED' | 'BLOCKED';

interface ProviderCheck {
  key: string;
  provider: string;
  source_symbol: string;
  endpoint: string;
  status: CheckStatus;
  failure_code: string | null;
  http_status: number | null;
  response_hash: string | null;
  shape: JsonRecord | null;
  sample?: JsonRecord | null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function normalized(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function taipeiDateFromTimestamp(value: unknown): string {
  let timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  while (timestamp > 100_000_000_000_000) timestamp /= 1000;
  if (timestamp < 100_000_000_000) timestamp *= 1000;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function positive(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function taipeiClock(now = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function authorized(req: Request, supabase: ReturnType<typeof createClient<any>>): Promise<boolean> {
  const auth = await authorizeInternalRequest(req.headers, internalCredentialsFromEnv());
  if (auth.ok) return true;
  const token = req.headers.get('x-daily-delivery-token') || '';
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase
    .from('runtime_job_tokens')
    .select('token_hash,is_active')
    .eq('name', 'morning_alpha_daily_delivery')
    .maybeSingle();
  return !error && data?.is_active === true && typeof data.token_hash === 'string' &&
    await constantTimeEqual(tokenHash, data.token_hash);
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<{ status: number | null; payload: unknown; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) return { status: response.status, payload: null, error: `HTTP_${response.status}` };
    return { status: response.status, payload: await response.json(), error: null };
  } catch (error) {
    return {
      status: null,
      payload: null,
      error: error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function failureCode(result: { status: number | null; error: string | null }, invalidContract = false): string {
  if (result.status === 404) return 'RESOURCE_NOT_FOUND';
  if ([401, 403].includes(Number(result.status))) return 'AUTHENTICATION_FAILED';
  if (result.status === 402) return 'BLOCKED_BY_SUBSCRIPTION';
  if (result.status === 429) return 'RATE_LIMITED';
  if (Number(result.status) >= 500) return 'PROVIDER_UNAVAILABLE';
  if (result.error === 'TIMEOUT') return 'TIMEOUT';
  if (invalidContract) return 'PROVIDER_RESPONSE_CONTRACT_INVALID';
  return String(result.error || 'PROVIDER_REQUEST_REJECTED');
}

async function checkedResult(
  slot: typeof REQUIRED_PROVIDER_SLOTS[number],
  endpoint: string,
  result: { status: number | null; payload: unknown; error: string | null },
  contractValid: boolean,
  captureSample: boolean,
): Promise<ProviderCheck> {
  const sanitized = result.payload ? asRecord(sanitizeProductionMarketPayload(result.payload)) : null;
  const ok = result.status === 200 && contractValid;
  return {
    key: slot.key,
    provider: slot.provider,
    source_symbol: slot.sourceSymbol,
    endpoint,
    status: ok ? 'PASS' : 'FAIL',
    failure_code: ok ? null : failureCode(result, result.status === 200 && !contractValid),
    http_status: result.status,
    response_hash: sanitized ? await sha256Hex(stableJson(sanitized)) : null,
    shape: sanitized ? asRecord(describeProductionResponseShape(sanitized)) : null,
    ...(captureSample ? { sample: sanitized } : {}),
  };
}

async function checkFinnhub(
  slot: typeof REQUIRED_PROVIDER_SLOTS[number],
  apiKey: string,
  captureSample: boolean,
): Promise<ProviderCheck> {
  if (!apiKey) {
    return checkedResult(slot, 'quote', { status: null, payload: null, error: 'CONFIGURATION_MISSING' }, false, captureSample);
  }
  const result = await fetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(slot.sourceSymbol)}&token=${encodeURIComponent(apiKey)}`,
    { Accept: 'application/json' },
  );
  const payload = asRecord(result.payload);
  const valid = positive(payload.c) && positive(payload.pc) && positive(payload.t);
  return checkedResult(slot, 'quote', result, valid, captureSample);
}

function fugleHeaders(apiKey: string): Record<string, string> {
  return { Accept: 'application/json', 'X-API-KEY': apiKey };
}

function fugleUrl(path: string): string {
  return `https://api.fugle.tw/marketdata/v1.0/${path}`;
}

async function checkTaiex(
  apiKey: string,
  tradingDate: string,
  captureSample: boolean,
  phase: 'premarket' | 'intraday' = 'premarket',
): Promise<ProviderCheck> {
  const slot = REQUIRED_PROVIDER_SLOTS.find(item => item.key === 'TAIEX')!;
  if (!apiKey) {
    return checkedResult(slot, FUGLE_TAIEX_CONTRACT.tickerEndpoint, { status: null, payload: null, error: 'CONFIGURATION_MISSING' }, false, captureSample);
  }
  let last = { status: null as number | null, payload: null as unknown, error: null as string | null };
  const result = await resolveFugleTaiexProvider(async ({ endpoint }: { endpoint: string }) => {
    last = await fetchJson(fugleUrl(endpoint), fugleHeaders(apiKey));
    return last;
  }, { tradingDate, phase });
  if (result.ok) {
    return checkedResult(slot, String(result.endpoint), last, true, captureSample);
  }
  const checked = await checkedResult(slot, String(result.endpoint || slot.endpoint), last, false, captureSample);
  return { ...checked, failure_code: String(result.failureCode || checked.failure_code) };
}

async function checkFugleQuote(
  key: '2330' | 'TXF',
  apiKey: string,
  tradingDate: string,
  captureSample: boolean,
): Promise<ProviderCheck> {
  const slot = REQUIRED_PROVIDER_SLOTS.find(item => item.key === key)!;
  const endpoint = key === 'TXF'
    ? `${slot.endpoint}?session=afterhours`
    : slot.endpoint;
  if (!apiKey) {
    return checkedResult(slot, endpoint, { status: null, payload: null, error: 'CONFIGURATION_MISSING' }, false, captureSample);
  }
  const result = await fetchJson(fugleUrl(endpoint), fugleHeaders(apiKey));
  const payload = asRecord(result.payload);
  const symbol = normalized(payload.symbol);
  const identityValid = key === '2330' ? symbol === '2330' : /^TXF[A-Z0-9!]+$/.test(symbol);
  const sourceTimestamp = payload.lastUpdated || payload.closeTime || asRecord(payload.lastTrade).time || asRecord(payload.total).time;
  const dateValid = key === 'TXF'
    ? taipeiDateFromTimestamp(sourceTimestamp) === tradingDate
    : String(payload.date || '') === tradingDate;
  const priceValid = [payload.previousClose, payload.referencePrice, payload.closePrice, payload.price]
    .some(positive);
  return checkedResult(slot, endpoint, result, identityValid && dateValid && priceValid, captureSample);
}

function readiness(checks: ProviderCheck[]): ReadinessStatus {
  const failures = checks.filter(check => check.status === 'FAIL');
  if (failures.length === 0) return 'READY';
  const blocking = new Set([
    'CONFIGURATION_MISSING', 'AUTHENTICATION_FAILED', 'BLOCKED_BY_SUBSCRIPTION',
    'PROVIDER_SYMBOL_INVALID', 'RESOURCE_NOT_FOUND', 'PROVIDER_RESPONSE_CONTRACT_INVALID',
  ]);
  return failures.some(check => blocking.has(String(check.failure_code))) ? 'BLOCKED' : 'DEGRADED';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const started = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ success: false, error_code: 'CONFIGURATION_MISSING', version: VERSION }), { status: 500, headers: CORS_HEADERS });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  if (!await authorized(req, supabase)) {
    return new Response(JSON.stringify({ success: false, error_code: INTERNAL_AUTH_ERROR_CODES.INVALID, version: VERSION }), { status: 401, headers: CORS_HEADERS });
  }

  let body: JsonRecord = {};
  try { body = asRecord(await req.json()); } catch { body = {}; }
  const mode = body.mode === 'diagnostic' ? 'diagnostic' : 'scheduled';
  const captureSample = mode === 'diagnostic' && body.capture_fixture_shapes === true;
  const clock = taipeiClock();
  const requestedDate = String(body.service_date || '');
  const tradingDate = mode === 'diagnostic' && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : clock.date;
  const marketStatus = resolveMarketStatus(tradingDate);
  if (!marketStatus.is_trading_day) {
    return new Response(JSON.stringify({
      success: true, skipped: true, readiness_status: 'READY', reason: 'NON_TRADING_DAY',
      service_date: tradingDate, version: VERSION, business_writes: [],
    }), { status: 200, headers: CORS_HEADERS });
  }
  if (mode === 'scheduled' && (clock.minutes < 405 || clock.minutes > 419)) {
    return new Response(JSON.stringify({
      success: false, readiness_status: 'BLOCKED', error_code: 'OUTSIDE_0650_PREFLIGHT_WINDOW',
      service_date: tradingDate, version: VERSION, business_writes: [],
    }), { status: 409, headers: CORS_HEADERS });
  }

  const registry = validateRequiredProviderRegistry();
  if (!registry.valid) {
    return new Response(JSON.stringify({
      success: false, readiness_status: 'BLOCKED', error_code: registry.failure_code,
      service_date: tradingDate, version: VERSION, business_writes: [],
    }), { status: 500, headers: CORS_HEADERS });
  }

  const finnhubKey = Deno.env.get('FINNHUB_API_KEY') || '';
  const fugleKey = Deno.env.get('FUGLE_API_KEY') || '';
  const taiexPhase = mode === 'diagnostic' && body.taiex_phase === 'intraday' ? 'intraday' : 'premarket';
  const checks = await Promise.all([
    ...REQUIRED_PROVIDER_SLOTS.filter(slot => slot.provider === 'finnhub')
      .map(slot => checkFinnhub(slot, finnhubKey, captureSample)),
    checkTaiex(fugleKey, tradingDate, captureSample, taiexPhase),
    checkFugleQuote('2330', fugleKey, tradingDate, captureSample),
    checkFugleQuote('TXF', fugleKey, tradingDate, captureSample),
  ]);
  const readinessStatus = readiness(checks);
  const succeeded = checks.filter(check => check.status === 'PASS').length;
  const correlationId = crypto.randomUUID();
  const payload = {
    success: readinessStatus === 'READY',
    version: VERSION,
    service_date: tradingDate,
    readiness_status: readinessStatus,
    provider_contract_version: 'MORNING_ALPHA_REQUIRED_PROVIDERS_V1',
    requested_count: REQUIRED_PROVIDER_COUNT,
    succeeded_count: succeeded,
    failed_count: REQUIRED_PROVIDER_COUNT - succeeded,
    checks,
    credentials: {
      finnhub: finnhubKey ? 'CONFIGURED' : 'MISSING',
      fugle: fugleKey ? 'CONFIGURED' : 'MISSING',
    },
    next_action: '07:00_REFETCH_FROM_PROVIDERS',
    forbidden_fallback: 'NO_PREVIOUS_DAY_DATA',
    business_writes: [],
    correlation_id: correlationId,
    latency_ms: Date.now() - started,
  };

  if (mode === 'scheduled') {
    const healthStatus = readinessStatus === 'READY' ? 'healthy' : readinessStatus === 'DEGRADED' ? 'degraded' : 'down';
    const { error } = await supabase.from('data_provider_health').upsert({
      provider: 'market_readiness_preflight',
      service_date: tradingDate,
      phase: 'premarket',
      checkpoint: 'readiness_0650',
      status: healthStatus,
      success_rate: (succeeded / REQUIRED_PROVIDER_COUNT) * 100,
      requested_count: REQUIRED_PROVIDER_COUNT,
      succeeded_count: succeeded,
      failed_count: REQUIRED_PROVIDER_COUNT - succeeded,
      latency_ms: Date.now() - started,
      timed_out: checks.some(check => check.failure_code === 'TIMEOUT'),
      last_error_code: checks.find(check => check.status === 'FAIL')?.failure_code || null,
      correlation_id: correlationId,
      details: {
        version: VERSION,
        readiness_status: readinessStatus,
        checks: checks.map(({ sample: _sample, ...check }) => check),
        next_action: '07:00_REFETCH_FROM_PROVIDERS',
        business_writes: [],
      },
      checked_at: new Date().toISOString(),
    }, { onConflict: 'provider,service_date,phase,checkpoint' });
    if (error) {
      return new Response(JSON.stringify({
        ...payload, success: false, readiness_status: 'BLOCKED', error_code: 'PREFLIGHT_HEALTH_WRITE_FAILED',
      }), { status: 500, headers: CORS_HEADERS });
    }
  }

  return new Response(JSON.stringify(payload), { status: 200, headers: CORS_HEADERS });
});
