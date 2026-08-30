import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { readBoundedJsonResponse, readBoundedText } from '../_shared/bounded-json.ts';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import { verifyReportFreshness } from '../_shared/report-freshness.ts';

type JsonRecord = Record<string, unknown>;
type Operation = 'get_today_health' | 'get_market_intelligence' | 'get_thesis' | 'get_closing_verification';

const BRIDGE_VERSION = '1.6.0';
const MAX_BODY_BYTES = 32_768;
const MAX_INTROSPECTION_RESPONSE_BYTES = 4_096;
const MAX_PUBLIC_REPORT_RESPONSE_BYTES = 524_288;
const EMMA_PROJECT_HOST = 'qjgrthjpffhtxvbkfyat.supabase.co';
const DEFAULT_EMMA_INTROSPECTION_URL = `https://${EMMA_PROJECT_HOST}/functions/v1/emma-consume-delegation`;
const MORNING_ALPHA_PROJECT_URL = 'https://cttfzgvhiewfckydcrci.supabase.co';
const EMMA_ALLOWED_OWNER_ID = 'f770feea-9a77-48d3-a444-757d5895f38f';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const delegationPattern = /^[A-Za-z0-9_-]{43}$/;

const operations = new Set([
  'get_today_health',
  'get_market_intelligence',
  'get_thesis',
  'get_closing_verification',
]);

function json(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validIsoDate(value: unknown): string | null {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date;
}

function validIsoTimestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function boolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function taipeiDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function taipeiDayUtcRange(date: string): { start: string; end: string } {
  const startDate = new Date(`${date}T00:00:00+08:00`);
  const endDate = new Date(startDate.getTime() + 86_400_000);
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

function hasRecords(value: unknown): boolean {
  return Array.isArray(value) && value.some(isRecord);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256Hex(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validatedEmmaIntrospectionUrl(): URL | null {
  const raw = Deno.env.get('EMMA_DELEGATION_INTROSPECTION_URL')?.trim() || DEFAULT_EMMA_INTROSPECTION_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:'
      || url.hostname !== EMMA_PROJECT_HOST
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname.replace(/\/$/, '') !== '/functions/v1/emma-consume-delegation') return null;
    return url;
  } catch {
    return null;
  }
}

async function consumeEmmaDelegation(input: {
  delegation: string;
  ownerId: string;
  actionRequestId: string;
  missionId: string | null;
  operation: string;
  payloadSha256: string;
  traceId: string;
}): Promise<{ authorized: boolean; error?: string }> {
  const url = validatedEmmaIntrospectionUrl();
  if (!url) return { authorized: false, error: 'EMMA_INTROSPECTION_CONFIGURATION_INVALID' };

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Emma-Delegation': input.delegation,
        'X-Trace-Id': input.traceId,
      },
      body: JSON.stringify({
        owner_id: input.ownerId,
        system_key: 'morning_alpha',
        operation: input.operation,
        action_request_id: input.actionRequestId,
        mission_id: input.missionId,
        payload_sha256: input.payloadSha256,
      }),
      signal: abort.signal,
    });
    let body: unknown;
    try {
      body = await readBoundedJsonResponse(response, MAX_INTROSPECTION_RESPONSE_BYTES);
    } catch (error) {
      return {
        authorized: false,
        error: error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
          ? 'EMMA_INTROSPECTION_RESPONSE_TOO_LARGE'
          : 'EMMA_INTROSPECTION_RESPONSE_INVALID',
      };
    }
    if (!response.ok || !isRecord(body) || body.authorized !== true) {
      return { authorized: false, error: 'DELEGATION_INVALID_OR_CONSUMED' };
    }
    return { authorized: true };
  } catch (error) {
    return {
      authorized: false,
      error: error instanceof DOMException && error.name === 'AbortError'
        ? 'EMMA_INTROSPECTION_TIMEOUT'
        : 'EMMA_INTROSPECTION_UNAVAILABLE',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function structuredLog(input: {
  traceId: string;
  toolCallId: string;
  executionId: string;
  missionId: string | null;
  operation: string;
  result: string;
  startedAt: number;
  errorType?: string;
}) {
  console.log(JSON.stringify({
    runtime: 'emma-morning-alpha-bridge',
    trace_id: input.traceId,
    mission_id: input.missionId,
    execution_id: input.executionId,
    tool_call_id: input.toolCallId,
    operation: input.operation,
    duration_ms: Date.now() - input.startedAt,
    result: input.result,
    error_type: input.errorType ?? null,
    verification_status: input.result === 'PASS' ? 'PASS' : 'NOT_EXECUTED',
  }));
}

function failure(input: {
  statusCode: number;
  status: 'DATA_NOT_AVAILABLE' | 'NOT_CONNECTED' | 'TOOL_DEGRADED' | 'VERIFICATION_REQUIRED';
  error: string;
  traceId: string;
  toolCallId: string;
  executionId: string;
  missionId: string | null;
  operation: string;
  startedAt: number;
}): Response {
  structuredLog({
    traceId: input.traceId,
    toolCallId: input.toolCallId,
    executionId: input.executionId,
    missionId: input.missionId,
    operation: input.operation,
    result: input.status === 'DATA_NOT_AVAILABLE' ? 'NO_DATA' : 'FAILED',
    startedAt: input.startedAt,
    errorType: input.error,
  });
  return json(input.statusCode, {
    execution_succeeded: false,
    status: input.status,
    error: input.error,
    bridge_version: BRIDGE_VERSION,
    trace_id: input.traceId,
    execution_id: input.executionId,
    tool_call_id: input.toolCallId,
  });
}

async function fetchPublicPayload(
  supabaseUrl: string,
  anonKey: string,
  reportDate: string | null,
): Promise<{ body?: JsonRecord; error?: string }> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8_000);
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/get-report-payload`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
      },
      body: JSON.stringify(reportDate ? { report_date: reportDate } : {}),
      signal: abort.signal,
    });
    let body: unknown;
    try {
      body = await readBoundedJsonResponse(response, MAX_PUBLIC_REPORT_RESPONSE_BYTES);
    } catch (error) {
      return {
        error: error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
          ? 'PUBLIC_REPORT_RESPONSE_TOO_LARGE'
          : 'PUBLIC_REPORT_RESPONSE_INVALID',
      };
    }
    if (!response.ok || !isRecord(body)) return { error: response.status === 404 ? 'REPORT_NOT_FOUND' : 'PUBLIC_REPORT_PROVIDER_FAILED' };
    if (body.tier !== 'free' || body.authenticated === true || !isRecord(body.payload)) return { error: 'PUBLIC_PAYLOAD_BOUNDARY_FAILED' };
    return { body };
  } catch (error) {
    return { error: error instanceof DOMException && error.name === 'AbortError' ? 'PUBLIC_REPORT_TIMEOUT' : 'PUBLIC_REPORT_NETWORK_ERROR' };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  const startedAt = Date.now();
  const traceId = request.headers.get('X-Trace-Id')?.trim() || crypto.randomUUID();
  const missionId = request.headers.get('X-Mission-Id')?.trim() || null;
  const executionId = request.headers.get('X-Execution-Id')?.trim() || crypto.randomUUID();
  const toolCallId = crypto.randomUUID();
  if (request.method !== 'POST') return failure({ statusCode: 405, status: 'TOOL_DEGRADED', error: 'METHOD_NOT_ALLOWED', traceId, toolCallId, executionId, missionId, operation: 'unknown', startedAt });
  if (request.headers.has('Authorization') || request.headers.has('X-Emma-Bridge-Token')) {
    return failure({ statusCode: 400, status: 'TOOL_DEGRADED', error: 'LEGACY_CREDENTIAL_FORBIDDEN', traceId, toolCallId, executionId, missionId, operation: 'unknown', startedAt });
  }
  const contentLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return failure({ statusCode: 413, status: 'VERIFICATION_REQUIRED', error: 'REQUEST_TOO_LARGE', traceId, toolCallId, executionId, missionId, operation: 'unknown', startedAt });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim() ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
  const delegation = request.headers.get('X-Emma-Delegation')?.trim() ?? '';

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (idempotencyKey.length < 16 || idempotencyKey.length > 160) {
    return failure({ statusCode: 400, status: 'VERIFICATION_REQUIRED', error: 'IDEMPOTENCY_KEY_REQUIRED', traceId, toolCallId, executionId, missionId, operation: 'unknown', startedAt });
  }

  let body: JsonRecord;
  try {
    const bodyText = await readBoundedText(request.body, MAX_BODY_BYTES);
    const parsed = JSON.parse(bodyText);
    if (!isRecord(parsed)) throw new Error('invalid body');
    body = parsed;
  } catch (error) {
    const requestTooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE';
    return failure({ statusCode: requestTooLarge ? 413 : 400, status: requestTooLarge ? 'VERIFICATION_REQUIRED' : 'TOOL_DEGRADED', error: requestTooLarge ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON', traceId, toolCallId, executionId, missionId, operation: 'unknown', startedAt });
  }

  const operation = text(body.operation) as Operation;
  if (!operations.has(operation)) {
    return failure({ statusCode: 400, status: 'NOT_CONNECTED', error: 'OPERATION_NOT_REGISTERED', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  const payload = isRecord(body.payload) ? body.payload : {};
  if (body.payload !== undefined && !isRecord(body.payload)) {
    return failure({ statusCode: 400, status: 'VERIFICATION_REQUIRED', error: 'PAYLOAD_SCHEMA_INVALID', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  if (Object.keys(payload).some((key) => key !== 'report_date')) {
    return failure({ statusCode: 400, status: 'VERIFICATION_REQUIRED', error: 'PAYLOAD_SCHEMA_INVALID', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  if (payload.report_date !== undefined && !validIsoDate(payload.report_date)) {
    return failure({ statusCode: 400, status: 'VERIFICATION_REQUIRED', error: 'PAYLOAD_SCHEMA_INVALID', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  const ownerId = text(body.actor_id);
  const actionRequestId = text(body.action_request_id);
  const requestActionId = request.headers.get('X-Action-Request-Id')?.trim() ?? '';
  const bodyMissionId = body.mission_id === null ? null : text(body.mission_id);
  if (!delegationPattern.test(delegation)
    || !uuidPattern.test(ownerId)
    || ownerId !== EMMA_ALLOWED_OWNER_ID
    || !uuidPattern.test(actionRequestId)
    || actionRequestId !== requestActionId
    || (bodyMissionId !== null && !uuidPattern.test(bodyMissionId))
    || bodyMissionId !== missionId) {
    return failure({ statusCode: 401, status: 'TOOL_DEGRADED', error: 'DELEGATION_BINDING_INVALID', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return failure({ statusCode: 503, status: 'NOT_CONNECTED', error: 'CONFIGURATION_MISSING', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  if (supabaseUrl !== MORNING_ALPHA_PROJECT_URL) {
    return failure({ statusCode: 503, status: 'NOT_CONNECTED', error: 'PROJECT_CONFIGURATION_INVALID', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }

  const payloadSha256 = await sha256Hex(payload);
  const delegationResult = await consumeEmmaDelegation({
    delegation,
    ownerId,
    actionRequestId,
    missionId,
    operation,
    payloadSha256,
    traceId,
  });
  if (!delegationResult.authorized) {
    const unavailable = delegationResult.error?.startsWith('EMMA_INTROSPECTION_') ?? false;
    return failure({
      statusCode: unavailable ? 503 : 401,
      status: 'TOOL_DEGRADED',
      error: delegationResult.error ?? 'DELEGATION_INVALID_OR_CONSUMED',
      traceId,
      toolCallId,
      executionId,
      missionId,
      operation,
      startedAt,
    });
  }

  const todayDate = taipeiDate();
  const requestedReportDate = validIsoDate(payload.report_date);
  // The latest endpoint may return a report only when the response passes the
  // bounded freshness proof below. Historical latest is never treated LIVE.
  const reportDate = requestedReportDate ?? null;
  const publicResult = await fetchPublicPayload(supabaseUrl, anonKey, reportDate);
  if (!publicResult.body) {
    const missing = publicResult.error === 'REPORT_NOT_FOUND';
    return failure({ statusCode: missing ? 404 : 502, status: missing ? 'DATA_NOT_AVAILABLE' : 'TOOL_DEGRADED', error: publicResult.error ?? 'PUBLIC_REPORT_PROVIDER_FAILED', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }

  const publicPayload = publicResult.body.payload as JsonRecord;
  const degradedMetadata = isRecord(publicPayload.degraded_metadata) ? publicPayload.degraded_metadata : null;
  if (!degradedMetadata
    || degradedMetadata.component_query_status !== 'complete'
    || degradedMetadata.bridge_verification_status !== 'VERIFIED') {
    return failure({ statusCode: 502, status: 'TOOL_DEGRADED', error: 'PUBLIC_COMPONENT_EVIDENCE_DEGRADED', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  const providerReportDate = validIsoDate(publicPayload.report_date);
  if (!providerReportDate || (reportDate !== null && providerReportDate !== reportDate)) {
    return failure({ statusCode: 502, status: 'TOOL_DEGRADED', error: 'PUBLIC_PAYLOAD_REPORT_DATE_MISMATCH', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  const dataAsOf = validIsoTimestamp(publicPayload.data_as_of);
  const reportMode = text(publicPayload.report_mode);
  if (!dataAsOf || !reportMode) {
    return failure({ statusCode: 404, status: 'DATA_NOT_AVAILABLE', error: !dataAsOf ? 'DATA_AS_OF_NOT_AVAILABLE' : 'REPORT_MODE_NOT_AVAILABLE', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  const freshness = verifyReportFreshness({
    todayDate,
    reportDate: providerReportDate,
    requestedReportDate,
    reportMode,
    dataAsOf,
  });
  if (!freshness.verified) {
    const unavailable = freshness.error === 'REPORT_DATE_STALE'
      || freshness.error === 'REPORT_MODE_NOT_AVAILABLE'
      || freshness.error === 'DATA_AS_OF_NOT_AVAILABLE';
    return failure({
      statusCode: unavailable ? 404 : 502,
      status: unavailable ? 'DATA_NOT_AVAILABLE' : 'TOOL_DEGRADED',
      error: freshness.error,
      traceId,
      toolCallId,
      executionId,
      missionId,
      operation,
      startedAt,
    });
  }
  const providerTradingDay = boolean(publicPayload.is_trading_day);
  const providerMarketStatus = text(publicPayload.market_status).toUpperCase();
  const canonicalMarket = resolveMarketStatus(providerReportDate);
  const todayMarket = resolveMarketStatus(todayDate);
  const canonicalMarketStatus = canonicalMarket.is_trading_day ? 'OPEN' : 'CLOSED';
  if (providerTradingDay === null || providerTradingDay !== canonicalMarket.is_trading_day || providerMarketStatus !== canonicalMarketStatus) {
    return failure({ statusCode: 502, status: 'TOOL_DEGRADED', error: 'MARKET_CALENDAR_VERIFICATION_FAILED', traceId, toolCallId, executionId, missionId, operation, startedAt });
  }
  const metadata = {
    today_date: todayDate,
    today_market_status: todayMarket.is_trading_day ? 'open' : 'closed',
    today_is_trading_day: todayMarket.is_trading_day,
    today_closed_reason: todayMarket.closed_reason,
    report_date: providerReportDate,
    latest_valid_trading_day: providerReportDate,
    data_as_of: freshness.dataAsOf,
    market_status: canonicalMarket.is_trading_day ? 'open' : 'closed',
    is_trading_day: canonicalMarket.is_trading_day,
    report_mode: reportMode,
    is_current_report: providerReportDate === todayDate,
    report_freshness_verified: true,
    expected_report_date: freshness.expectedReportDate,
  };
  let data: unknown;
  if (operation === 'get_thesis') {
    const decision = isRecord(publicPayload.canonical_decision) ? publicPayload.canonical_decision : null;
    if (!decision || Object.keys(decision).length === 0) return failure({ statusCode: 404, status: 'DATA_NOT_AVAILABLE', error: 'THESIS_NOT_AVAILABLE', traceId, toolCallId, executionId, missionId, operation, startedAt });
    data = {
      ...metadata,
      market_bias: publicPayload.market_bias,
      confidence_score: publicPayload.confidence_score,
      daily_sentence: publicPayload.daily_sentence,
      canonical_decision: decision,
      data_quality: publicPayload.data_quality,
    };
  } else if (operation === 'get_closing_verification') {
    const closing = isRecord(publicPayload.closing_verification) ? publicPayload.closing_verification : null;
    if (!closing || Object.keys(closing).length === 0) return failure({ statusCode: 404, status: 'DATA_NOT_AVAILABLE', error: 'CLOSING_VERIFICATION_NOT_AVAILABLE', traceId, toolCallId, executionId, missionId, operation, startedAt });
    const closingStatus = text(closing.status).toLowerCase();
    const closingDataStatus = text(closing.data_status).toLowerCase();
    data = {
      ...metadata,
      closing_verification: closing,
      closing_verification_complete: closingStatus === 'completed' && closingDataStatus === 'complete',
    };
  } else if (operation === 'get_today_health') {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const dayRange = taipeiDayUtcRange(providerReportDate);
    const [healthResult, opsResult] = await Promise.all([
      admin.from('system_health_logs')
        .select('check_date,report_exists,report_date_correct,has_market_bias,has_confidence,has_member_note_v2,has_opening_radar,has_sector_rotation,has_closing_verification,health_score,issues,created_at')
        .eq('check_date', providerReportDate).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('ma_ops_runs')
        .select('id,check_type,started_at,completed_at,status,severity,summary,recovery_attempted,recovery_result')
        .eq('environment', 'production').gte('created_at', dayRange.start).lt('created_at', dayRange.end)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (healthResult.error || opsResult.error) return failure({ statusCode: 502, status: 'TOOL_DEGRADED', error: 'HEALTH_QUERY_FAILED', traceId, toolCallId, executionId, missionId, operation, startedAt });
    if (!healthResult.data || !opsResult.data) return failure({ statusCode: 404, status: 'DATA_NOT_AVAILABLE', error: 'TODAY_HEALTH_INCOMPLETE', traceId, toolCallId, executionId, missionId, operation, startedAt });
    data = {
      ...metadata,
      data_quality: publicPayload.data_quality,
      opening_radar_status: publicPayload.opening_radar_status,
      closing_verification: publicPayload.closing_verification,
      system_health: healthResult.data,
      latest_ops_run: opsResult.data,
      health_data_status: 'complete',
    };
  } else {
    const hasMarketEvidence = hasRecords(publicPayload.market_data_snapshots)
      || hasRecords(publicPayload.important_news)
      || hasRecords(publicPayload.sector_rotation_scores)
      || isRecord(publicPayload.canonical_decision)
      || Object.keys(isRecord(publicPayload.opening_radar) ? publicPayload.opening_radar : {}).length > 0;
    if (!hasMarketEvidence) return failure({ statusCode: 404, status: 'DATA_NOT_AVAILABLE', error: 'MARKET_INTELLIGENCE_NOT_AVAILABLE', traceId, toolCallId, executionId, missionId, operation, startedAt });
    data = {
      ...metadata,
      market_bias: publicPayload.market_bias,
      confidence_score: publicPayload.confidence_score,
      daily_sentence: publicPayload.daily_sentence,
      public_summary: publicPayload.public_summary,
      important_news: publicPayload.important_news,
      sector_rotation_scores: publicPayload.sector_rotation_scores,
      market_data_snapshots: publicPayload.market_data_snapshots,
      canonical_decision: publicPayload.canonical_decision,
      opening_radar: publicPayload.opening_radar,
      opening_radar_status: publicPayload.opening_radar_status,
      premium_content_status: publicPayload.premium_content_status,
      premium_content_reason_codes: publicPayload.premium_content_reason_codes,
      content_publish_gate: publicPayload.content_publish_gate,
      one_teaser_stock: publicPayload.one_teaser_stock,
      closing_verification: publicPayload.closing_verification,
      continuous_learning: publicPayload.continuous_learning,
      runtime_lifecycle_complete: publicPayload.runtime_lifecycle_complete,
      data_quality: publicPayload.data_quality,
      degraded_metadata: publicPayload.degraded_metadata,
    };
  }

  structuredLog({ traceId, toolCallId, executionId, missionId, operation, result: 'PASS', startedAt });
  return json(200, {
    execution_succeeded: true,
    status: 'LIVE',
    provider_reference: `morning-alpha:public-read:${operation}:${traceId}`,
    bridge_version: BRIDGE_VERSION,
    verification: {
      public_payload_boundary: true,
      no_subscriber_data: true,
      provider_response: true,
      report_date_exact: true,
      data_as_of_present: true,
      report_freshness_verified: true,
      expected_report_date: freshness.expectedReportDate,
      market_calendar_consistent: true,
      delegation_consumed: true,
      action_binding_verified: true,
      payload_hash_verified: true,
    },
    data,
    trace_id: traceId,
    execution_id: executionId,
    tool_call_id: toolCallId,
    action_request_id: actionRequestId,
  });
});
