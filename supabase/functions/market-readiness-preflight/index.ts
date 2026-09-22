import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import { PREMARKET_REPORT_DEADLINE_MINUTES } from '../_shared/premarket-provider-readiness.mjs';
import {
  authorizeInternalRequest,
  constantTimeEqual,
  internalCredentialsFromEnv,
  INTERNAL_AUTH_ERROR_CODES,
} from '../_shared/internal-function-auth.mjs';
import {
  FUGLE_2330_CONTRACT,
  FUGLE_TAIEX_CONTRACT,
  resolveFugle2330Provider,
  resolveFugleTaiexProvider,
} from '../_shared/fugle-taiex-provider.mjs';
import {
  REQUIRED_PROVIDER_COUNT,
  describeProductionResponseShape,
  sanitizeProductionMarketPayload,
  stableJson,
  validateRequiredProviderRegistry,
} from '../_shared/provider-reliability-contract.mjs';
import {
  REQUIRED_PROVIDER_CONFIG,
  classifyRequiredProviderFailure,
  fetchRequiredFugleResponse,
  fetchRequiredFinnhubResponse,
  normalizeRequiredFinnhubQuote,
  normalizeRequiredTaiwanCoreQuote,
  resolveRequiredTxfQuote,
  validateRequiredProviderEvidence,
} from '../_shared/required-provider-validation.mjs';

const VERSION = 'MARKET_READINESS_PREFLIGHT_V4_TW_PHASE_CONTRACT';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, authorization, x-cron-secret, x-daily-delivery-token, x-internal-auth-version',
  'Content-Type': 'application/json',
};

type JsonRecord = Record<string, unknown>;
type CheckStatus = 'PASS' | 'FAIL' | 'EXPECTED' | 'WAITING';
type ReadinessStatus = 'READY' | 'DEGRADED' | 'BLOCKED' | 'MARKET_PHASE_EXPECTED' | 'WAITING_FOR_MARKET_DATA';

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
  observations?: JsonRecord[];
  rejected_field?: string | null;
  discovery_status?: string | null;
}

interface FugleCoreResolution {
  ok: boolean;
  endpoint?: unknown;
  status?: unknown;
  payload?: unknown;
  error?: unknown;
  failureCode?: unknown;
  rejectedField?: unknown;
  discoveryStatus?: unknown;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
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

async function checkedResult(
  slot: typeof REQUIRED_PROVIDER_CONFIG[number],
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
    failure_code: ok ? null : classifyRequiredProviderFailure(result, result.status === 200 ? 'ATOMIC_PROVIDER_RESULT_MISSING' : null),
    http_status: result.status,
    response_hash: sanitized ? await sha256Hex(stableJson(sanitized)) : null,
    shape: sanitized ? asRecord(describeProductionResponseShape(sanitized)) : null,
    ...(captureSample ? { sample: sanitized } : {}),
  };
}

async function providerObservation(
  endpoint: string,
  result: { status: number | null; payload: unknown; error: string | null },
  captureSample: boolean,
): Promise<JsonRecord> {
  const sanitized = result.payload ? asRecord(sanitizeProductionMarketPayload(result.payload)) : null;
  return {
    endpoint,
    http_status: result.status,
    error: result.error,
    response_hash: sanitized ? await sha256Hex(stableJson(sanitized)) : null,
    shape: sanitized ? asRecord(describeProductionResponseShape(sanitized)) : null,
    ...(captureSample ? { sample: sanitized } : {}),
  };
}

async function checkFinnhub(
  slot: typeof REQUIRED_PROVIDER_CONFIG[number],
  apiKey: string,
  captureSample: boolean,
  evidenceInput: JsonRecord,
  phaseExpected: boolean,
): Promise<ProviderCheck> {
  if (!apiKey) {
    return checkedResult(slot, 'quote', { status: null, payload: null, error: 'CONFIGURATION_MISSING' }, false, captureSample);
  }
  const result = await fetchRequiredFinnhubResponse(slot.sourceSymbol, apiKey);
  const quote = result.status === 200 ? normalizeRequiredFinnhubQuote(result.payload, slot.sourceSymbol) : null;
  const evidence = validateRequiredProviderEvidence(slot, quote, evidenceInput);
  const checked = await checkedResult(slot, slot.endpoint, result, evidence.valid, captureSample);
  return withEvidenceStatus(checked, result, evidence, phaseExpected);
}

function withEvidenceStatus(check: ProviderCheck, response: JsonRecord, evidence: JsonRecord, phaseExpected: boolean): ProviderCheck {
  if (check.status === 'PASS') return check;
  const error = String(evidence.error || 'ATOMIC_PROVIDER_RESULT_MISSING');
  const expected = phaseExpected && Number(response.status) === 200 &&
    ['INVALID_EVIDENCE_IDENTITY', 'OUTSIDE_REAL_CHECKPOINT_WINDOW', 'INVALID_CHECKPOINT_SOURCE_TIME', 'STALE_PROVIDER_DATA'].includes(error);
  return {
    ...check,
    status: expected ? 'EXPECTED' : 'FAIL',
    failure_code: expected ? 'MARKET_PHASE_EXPECTED' : classifyRequiredProviderFailure(response, error),
  };
}

async function checkTaiwanCore(
  key: 'TAIEX' | '2330',
  apiKey: string,
  tradingDate: string,
  captureSample: boolean,
  evidenceInput: JsonRecord,
  phaseExpected: boolean,
  phase: 'premarket' | 'intraday' = 'premarket',
): Promise<ProviderCheck> {
  const slot = REQUIRED_PROVIDER_CONFIG.find(item => item.key === key)!;
  const contract = key === 'TAIEX' ? FUGLE_TAIEX_CONTRACT : FUGLE_2330_CONTRACT;
  if (!apiKey) {
    return checkedResult(slot, contract.tickerEndpoint, { status: null, payload: null, error: 'CONFIGURATION_MISSING' }, false, captureSample);
  }
  const responses = new Map<string, { status: number | null; payload: unknown; error: string | null }>();
  const resolver = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
  const result = await resolver(async ({ endpoint }: { endpoint: string }) => {
    const response = await fetchRequiredFugleResponse(endpoint, apiKey);
    responses.set(endpoint, response);
    return response;
  }, { tradingDate, phase, observedAt: String(evidenceInput.observedAt || '') }) as FugleCoreResolution;

  const endpoint = String(result.endpoint || (phase === 'premarket' ? contract.tickerEndpoint : contract.quoteEndpoint));
  const primary = responses.get(endpoint) || {
    status: Number.isFinite(Number(result.status)) ? Number(result.status) : null,
    payload: result.payload || null,
    error: result.error ? String(result.error) : null,
  };
  const normalizedQuote = result.ok ? normalizeRequiredTaiwanCoreQuote(result, key) : null;
  const evidence = validateRequiredProviderEvidence(slot, normalizedQuote, evidenceInput);
  const checked = withEvidenceStatus(
    await checkedResult(slot, endpoint, primary, evidence.valid, captureSample), primary, evidence, phaseExpected,
  );
  const observations = await Promise.all([...responses.entries()]
    .filter(([observedEndpoint]) => observedEndpoint !== endpoint)
    .map(([observedEndpoint, response]) => providerObservation(observedEndpoint, response, captureSample)));
  if (result.ok && evidence.valid) {
    return {
      ...checked,
      ...(observations.length ? { observations } : {}),
      discovery_status: key === 'TAIEX' ? String(result.discoveryStatus || '') : null,
    };
  }
  const futureDate = tradingDate > taipeiClock().date;
  return {
    ...checked,
    failure_code: phaseExpected && futureDate && result.failureCode === 'STALE_PROVIDER_DATA'
      ? 'MARKET_PHASE_EXPECTED' : String(result.failureCode || checked.failure_code),
    status: phaseExpected && futureDate && result.failureCode === 'STALE_PROVIDER_DATA' ? 'EXPECTED' : checked.status,
    rejected_field: result.rejectedField ? String(result.rejectedField) : null,
    ...(observations.length ? { observations } : {}),
  };
}

async function checkFugleQuote(
  key: 'TXF',
  apiKey: string,
  tradingDate: string,
  captureSample: boolean,
  evidenceInput: JsonRecord,
  phaseExpected: boolean,
): Promise<ProviderCheck> {
  const slot = REQUIRED_PROVIDER_CONFIG.find(item => item.key === key)!;
  const endpoint = `${slot.endpoint}?session=afterhours`;
  if (!apiKey) {
    return checkedResult(slot, endpoint, { status: null, payload: null, error: 'CONFIGURATION_MISSING' }, false, captureSample);
  }
  const resolved = await resolveRequiredTxfQuote(
    (path: string) => fetchRequiredFugleResponse(path, apiKey),
    { phase: 'premarket', tradingDate, observedAt: String(evidenceInput.observedAt || '') },
  );
  const last = resolved.observations.at(-1) || { status: null, payload: null, error: 'PROVIDER_REQUEST_REJECTED' };
  const response = resolved.response || last;
  const evidence = validateRequiredProviderEvidence(slot, resolved.quote, evidenceInput);
  const checked = withEvidenceStatus(
    await checkedResult(slot, resolved.endpoint || String(last.endpoint || endpoint), response, evidence.valid, captureSample),
    response, evidence, phaseExpected,
  );
  const observations = await Promise.all(resolved.observations
    .filter((item: JsonRecord) => item.endpoint !== checked.endpoint)
    .map((item: JsonRecord) => providerObservation(String(item.endpoint), item as { status: number | null; payload: unknown; error: string | null }, captureSample)));
  return { ...checked, source_symbol: String(resolved.quote?.sourceSymbol || slot.sourceSymbol),
    ...(observations.length ? { observations } : {}) };
}

function readiness(checks: ProviderCheck[]): ReadinessStatus {
  const failures = checks.filter(check => check.status === 'FAIL');
  const expected = checks.filter(check => check.status === 'EXPECTED');
  const waiting = checks.filter(check => check.status === 'WAITING');
  if (failures.length === 0) return waiting.length ? 'WAITING_FOR_MARKET_DATA' : expected.length ? 'MARKET_PHASE_EXPECTED' : 'READY';
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

  const registry = validateRequiredProviderRegistry(REQUIRED_PROVIDER_CONFIG);
  if (!registry.valid) {
    return new Response(JSON.stringify({
      success: false, readiness_status: 'BLOCKED', error_code: registry.failure_code,
      service_date: tradingDate, version: VERSION, business_writes: [],
    }), { status: 500, headers: CORS_HEADERS });
  }

  const finnhubKey = Deno.env.get('FINNHUB_API_KEY') || '';
  const fugleKey = Deno.env.get('FUGLE_API_KEY') || '';
  const taiexPhase = mode === 'diagnostic' && body.taiex_phase === 'intraday' ? 'intraday' : 'premarket';
  const evidenceInput = {
    phase: 'premarket', checkpoint: 'premarket', tradingDate,
    observedAt: new Date().toISOString(), correlationId: crypto.randomUUID(),
  };
  const phaseExpected = mode === 'diagnostic' && (tradingDate > clock.date || clock.minutes >= PREMARKET_REPORT_DEADLINE_MINUTES);
  const checks = await Promise.all([
    ...REQUIRED_PROVIDER_CONFIG.filter(slot => slot.provider === 'finnhub')
      .map(slot => checkFinnhub(slot, finnhubKey, captureSample, evidenceInput, phaseExpected)),
    checkTaiwanCore('TAIEX', fugleKey, tradingDate, captureSample, evidenceInput, phaseExpected, taiexPhase),
    checkTaiwanCore('2330', fugleKey, tradingDate, captureSample, evidenceInput, phaseExpected, taiexPhase),
    checkFugleQuote('TXF', fugleKey, tradingDate, captureSample, evidenceInput, phaseExpected),
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
    forbidden_fallback: 'NO_STALE_OR_ARBITRARY_SESSION_DATA',
    business_writes: [],
    correlation_id: correlationId,
    latency_ms: Date.now() - started,
  };

  if (mode === 'scheduled') {
    const healthStatus = readinessStatus === 'READY' ? 'healthy'
      : ['DEGRADED', 'WAITING_FOR_MARKET_DATA'].includes(readinessStatus) ? 'degraded' : 'down';
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
      last_error_code: checks.find(check => check.status !== 'PASS')?.failure_code || null,
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
