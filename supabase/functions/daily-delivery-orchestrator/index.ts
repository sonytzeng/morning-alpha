import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluatePremiumContentGate } from '../_shared/premium-content-gate.ts';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import { authorizeInternalRequest, buildInternalFunctionHeaders, constantTimeEqual, internalCredentialsFromEnv, INTERNAL_AUTH_ERROR_CODES } from '../_shared/internal-function-auth.mjs';
import {
  buildDailyDeliveryRecoveryPlan,
  hasFailedEvidenceDependency,
  resolveClaimedPipelineSlot,
  resolveDailyDeliveryCompletion,
  resolveDailyDeliveryPhase,
  type DailyDeliveryAction,
  type DailyDeliveryPhase,
} from '../_shared/daily-delivery-recovery.ts';

const VERSION = 'DAILY_DELIVERY_V1.6_SECTOR_ROTATION_RECOVERY';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-cron-secret, x-daily-delivery-token, x-correlation-id',
  'Content-Type': 'application/json',
};

type JsonRecord = Record<string, unknown>;
type SupabaseClient = ReturnType<typeof createClient<any>>;

interface DeliveryState {
  report: JsonRecord | null;
  snapshot: JsonRecord | null;
  premium_eligible: boolean;
  reason_codes: string[];
}

interface FunctionResult {
  ok: boolean;
  status: number;
  payload: JsonRecord;
  attempts?: number;
}

function jsonResponse(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: CORS_HEADERS });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function taipeiClock(now = new Date()): { date: string; minutes: number; slot: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number(get('hour')) || 0;
  const minute = Number(get('minute')) || 0;
  const minutes = hour * 60 + minute;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes,
    slot: Math.floor(minutes / 5),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function authorizeRequest(
  req: Request,
  supabase: SupabaseClient,
  cronSecret: string,
): Promise<{ ok: boolean; error_code: string | null }> {
  const auth = await authorizeInternalRequest(req.headers, { ...internalCredentialsFromEnv(), currentToken: cronSecret, serviceRoleKey: '' });
  if (auth.ok) return { ok: true, error_code: null };

  const token = req.headers.get('x-daily-delivery-token') || '';
  if (!token) return { ok: false, error_code: auth.error_code };
  const { data, error } = await supabase
    .from('runtime_job_tokens')
    .select('token_hash,is_active')
    .eq('name', 'morning_alpha_daily_delivery')
    .maybeSingle();
  if (error || !data?.is_active || typeof data.token_hash !== 'string') {
    return { ok: false, error_code: INTERNAL_AUTH_ERROR_CODES.INVALID };
  }
  const accepted = await constantTimeEqual(await sha256Hex(token), data.token_hash);
  return { ok: accepted, error_code: accepted ? null : INTERNAL_AUTH_ERROR_CODES.INVALID };
}

async function invokeFunction(
  baseUrl: string,
  slug: string,
  cronSecret: string,
  body: JsonRecord,
  timeoutMs: number,
): Promise<FunctionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/${slug}`, {
      method: 'POST',
      headers: buildInternalFunctionHeaders({
        cronSecret,
        serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
        source: 'daily-delivery-orchestrator',
      }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let payload: JsonRecord = {};
    try {
      payload = asRecord(await response.json());
    } catch {
      payload = { error: `Non-JSON response from ${slug}` };
    }
    return { ok: response.ok && payload.success !== false, status: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      status: 599,
      payload: { error: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeFunctionWithRetry(
  baseUrl: string,
  slug: string,
  cronSecret: string,
  body: JsonRecord,
  timeoutMs: number,
  maxAttempts = 3,
): Promise<FunctionResult> {
  let lastResult: FunctionResult = { ok: false, status: 599, payload: { error: 'FUNCTION_NOT_ATTEMPTED' }, attempts: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await invokeFunction(baseUrl, slug, cronSecret, { ...body, provider_retry_attempt: attempt }, timeoutMs);
    if (lastResult.ok) return { ...lastResult, attempts: attempt };
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
  return { ...lastResult, attempts: maxAttempts };
}

const RUNTIME_CHECKPOINTS = new Set(['0900', '0930', '1030', '1300', '1410', '1430']);

function checkpointResultOk(slug: string, checkpoint: string, result: FunctionResult): boolean {
  if (!result.ok) return false;
  const payload = result.payload;
  if (slug === 'fetch-market-data-v10') {
    return payload.success === true
      && String(payload.checkpoint || '') === checkpoint
      && payload.canonical_complete === true
      && payload.required_core_complete === true
      && Array.isArray(payload.provider_health_write_errors)
      && payload.provider_health_write_errors.length === 0
      && payload.trading_day_state_error == null;
  }
  if (slug === 'opening-market-radar') {
    return payload.success === true
      && String(payload.checkpoint || '') === checkpoint
      && String(payload.data_status || '') === 'ready'
      && String(payload.radar_status || '').length > 0;
  }
  if (slug === 'close-market-review') {
    return payload.success === true && (
      ['written_and_synced', 'skipped_idempotent'].includes(String(payload.action || ''))
    );
  }
  if (slug === 'closing-verification-engine') {
    return payload.success === true && [
      'completed',
      'direction_completed_data_degraded',
    ].includes(String(payload.closing_verification_status || ''));
  }
  if (slug === 'generate-sector-rotation') {
    return payload.success === true
      && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.score_date || ''))
      && Number(payload.inserted_count || payload.inserted || 0) > 0;
  }
  return result.ok;
}

async function executeRuntimeCheckpoint(
  baseUrl: string,
  cronSecret: string,
  checkpoint: string,
  source: 'supabase_cron_primary' | 'supabase_cron_watchdog',
  businessDate: string,
): Promise<{ success: boolean; results: JsonRecord; failures: string[] }> {
  const results: JsonRecord = {};
  const failures: string[] = [];
  const phase = ['1410', '1430'].includes(checkpoint) ? 'close' : 'intraday';
  const market = await invokeFunctionWithRetry(baseUrl, 'fetch-market-data-v10', cronSecret, {
    phase,
    checkpoint,
    source,
  }, 180_000, 3);
  results.market = market;
  if (!checkpointResultOk('fetch-market-data-v10', checkpoint, market)) {
    failures.push('market_checkpoint_incomplete');
    return { success: false, results, failures };
  }

  if (checkpoint === '1410') {
    return { success: true, results, failures };
  }

  if (phase === 'intraday') {
    if (checkpoint !== '0900') {
      const radar = await invokeFunctionWithRetry(baseUrl, 'opening-market-radar', cronSecret, {
        checkpoint,
        source,
      }, 180_000, 3);
      results.radar = radar;
      if (!checkpointResultOk('opening-market-radar', checkpoint, radar)) failures.push('radar_checkpoint_incomplete');
    }
    return { success: failures.length === 0, results, failures };
  }

  const beneficiaryClose = await invokeFunctionWithRetry(baseUrl, 'fetch-market-data-v10', cronSecret, {
    phase: 'close',
    checkpoint,
    beneficiary_close_only: true,
    source,
  }, 180_000, 3);
  results.beneficiary_close = beneficiaryClose;
  const beneficiaryPayload = beneficiaryClose.payload;
  if (!beneficiaryClose.ok
    || beneficiaryPayload.beneficiary_close_only !== true
    || beneficiaryPayload.beneficiary_close_deferred === true
    || asRecord(beneficiaryPayload.beneficiary_close_status).complete !== true
    || beneficiaryPayload.canonical_complete !== true
    || beneficiaryPayload.checkpoint_complete !== true) {
    failures.push('beneficiary_close_incomplete');
    return { success: false, results, failures };
  }

  const currentTaipeiDate = taipeiClock().date;
  const sectorRotation = await invokeFunctionWithRetry(
    baseUrl,
    'generate-sector-rotation',
    cronSecret,
    businessDate === currentTaipeiDate
      ? { source }
      : { source, backfill: true, target_date: businessDate },
    300_000,
    3,
  );
  results.sector_rotation = sectorRotation;
  if (!checkpointResultOk('generate-sector-rotation', checkpoint, sectorRotation)
    || String(sectorRotation.payload.score_date || '') !== businessDate) {
    failures.push('sector_rotation_incomplete');
    return { success: false, results, failures };
  }

  const review = await invokeFunctionWithRetry(baseUrl, 'close-market-review', cronSecret, {
    source,
  }, 180_000, 3);
  results.review = review;
  if (!checkpointResultOk('close-market-review', checkpoint, review)) {
    failures.push('closing_review_incomplete');
    return { success: false, results, failures };
  }

  const verification = await invokeFunctionWithRetry(baseUrl, 'closing-verification-engine', cronSecret, {
    source,
  }, 180_000, 3);
  results.verification = verification;
  if (!checkpointResultOk('closing-verification-engine', checkpoint, verification)) failures.push('closing_verification_incomplete');
  return { success: failures.length === 0, results, failures };
}

async function loadDeliveryState(
  supabase: SupabaseClient,
  reportDate: string,
): Promise<DeliveryState> {
  const [
    { data: report, error: reportError },
    { data: snapshot, error: snapshotError },
    { data: memberRevision, error: memberRevisionError },
  ] = await Promise.all([
    supabase
      .from('reports')
      .select('id,report_date,ai_strategy_json,important_news_json,created_at,updated_at')
      .eq('report_date', reportDate)
      .maybeSingle(),
    supabase
      .from('decision_snapshots')
      .select('id,status,decision_mode,content_score,reason_codes,is_current,version')
      .eq('report_date', reportDate)
      .eq('session_type', 'PREMARKET')
      .eq('is_current', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('current_member_content_revisions_v1')
      .select('id,status,semantic_status,decision_snapshot_id,decision_snapshot_version,revision,data_quality_status')
      .eq('report_date', reportDate)
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (reportError) throw new Error(`REPORT_STATE_QUERY_FAILED:${reportError.message}`);
  if (snapshotError) throw new Error(`SNAPSHOT_STATE_QUERY_FAILED:${snapshotError.message}`);
  if (memberRevisionError) throw new Error(`MEMBER_REVISION_STATE_QUERY_FAILED:${memberRevisionError.message}`);
  if (!report) {
    return {
      report: null,
      snapshot: snapshot ? asRecord(snapshot) : null,
      premium_eligible: false,
      reason_codes: ['report_missing'],
    };
  }

  const reportRecord = asRecord(report);
  const ai = asRecord(reportRecord.ai_strategy_json);
  const importantNewsCount = Array.isArray(reportRecord.important_news_json)
    ? reportRecord.important_news_json.length
    : Array.isArray(ai.important_news)
      ? ai.important_news.length
      : 0;
  const premiumGate = evaluatePremiumContentGate(ai, importantNewsCount);
  const snapshotRecord = snapshot ? asRecord(snapshot) : null;
  const snapshotReady = Boolean(snapshotRecord)
    && snapshotRecord?.status === 'READY'
    && Number(snapshotRecord?.content_score) >= 90
    && ['recommendations', 'no_trade'].includes(String(snapshotRecord?.decision_mode || ''));
  const memberRevisionRecord = memberRevision ? asRecord(memberRevision) : null;
  const memberRevisionReady = Boolean(memberRevisionRecord)
    && memberRevisionRecord?.status === 'PASSED'
    && memberRevisionRecord?.semantic_status === 'PASSED'
    && String(memberRevisionRecord?.decision_snapshot_id || '') === String(snapshotRecord?.id || '')
    && Number(memberRevisionRecord?.decision_snapshot_version) === Number(snapshotRecord?.version);
  const reasonCodes = Array.from(new Set([
    ...premiumGate.reason_codes,
    ...asStringArray(ai.missing_sources),
    ...asStringArray(snapshotRecord?.reason_codes),
    ...(snapshotRecord ? [] : ['decision_snapshot_missing']),
    ...(snapshotReady ? [] : ['decision_snapshot_not_publishable']),
    ...(memberRevisionRecord ? [] : ['semantic_member_revision_missing']),
    ...(memberRevisionReady ? [] : ['semantic_member_revision_not_publishable']),
  ]));

  return {
    report: reportRecord,
    snapshot: snapshotRecord,
    premium_eligible: premiumGate.eligible && snapshotReady && memberRevisionReady,
    reason_codes: reasonCodes,
  };
}

async function claimPipelineSlot(
  supabase: SupabaseClient,
  reportDate: string,
  phase: DailyDeliveryPhase,
  slot: number,
  attempt: number,
): Promise<{
  acquired: boolean;
  id: string | null;
  existingStatus: string | null;
  existingReasonCodes: string[];
  existingErrorCode: string | null;
}> {
  const idempotencyKey = `${reportDate}:PREMARKET:${phase}:${slot}`;
  const { data, error } = await supabase
    .from('pipeline_runs')
    .insert({
      trading_date: reportDate,
      checkpoint: 'PREMARKET',
      idempotency_key: idempotencyKey,
      status: 'RUNNING',
      attempt,
      started_at: new Date().toISOString(),
      deadline_at: new Date(`${reportDate}T07:30:00+08:00`).toISOString(),
      delivery_status: phase === 'refresh' || phase === 'generate' || phase === 'repair' ? 'NOT_DUE' : 'PENDING',
      provider_status: { orchestrator_version: VERSION, phase },
    })
    .select('id')
    .maybeSingle();
  if (error?.code === '23505') {
    const { data: existing, error: existingError } = await supabase
      .from('pipeline_runs')
      .select('id,status,reason_codes,error_code')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existingError || !existing) {
      throw new Error(`PIPELINE_SLOT_STATUS_FAILED:${existingError?.message || 'existing run missing'}`);
    }
    return {
      acquired: false,
      id: typeof existing.id === 'string' ? existing.id : null,
      existingStatus: String(existing.status || 'RUNNING'),
      existingReasonCodes: asStringArray(existing.reason_codes),
      existingErrorCode: typeof existing.error_code === 'string' ? existing.error_code : null,
    };
  }
  if (error || !data?.id) throw new Error(`PIPELINE_SLOT_CLAIM_FAILED:${error?.message || 'no id'}`);
  return {
    acquired: true,
    id: String(data.id),
    existingStatus: null,
    existingReasonCodes: [],
    existingErrorCode: null,
  };
}

async function finishPipelineRun(
  supabase: SupabaseClient,
  runId: string,
  status: 'SUCCEEDED' | 'DEGRADED' | 'FAILED',
  details: JsonRecord,
  reasonCodes: string[],
  retryAfterSeconds: number | null,
): Promise<void> {
  const nextRetryAt = retryAfterSeconds === null
    ? null
    : new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
  const { error } = await supabase
    .from('pipeline_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      next_retry_at: nextRetryAt,
      updated_at: new Date().toISOString(),
      decision_snapshot_id: typeof details.decision_snapshot_id === 'string' ? details.decision_snapshot_id : null,
      delivery_status: String(details.delivery_status || (status === 'FAILED' ? 'FAILED' : 'PENDING')),
      recovery_plan: asRecord(details.recovery_plan),
      provider_status: details,
      reason_codes: reasonCodes,
      error_code: status === 'FAILED' ? String(details.error_code || 'DAILY_DELIVERY_FAILED') : null,
      error_message: status === 'FAILED' ? String(details.error_message || '').slice(0, 500) : null,
    })
    .eq('id', runId);
  if (error) throw new Error(`PIPELINE_RUN_UPDATE_FAILED:${error.message}`);
}

async function executeRecoveryActions(args: {
  actions: DailyDeliveryAction[];
  baseUrl: string;
  cronSecret: string;
  attempt: number;
  reasonCodes: string[];
  allowIncident: boolean;
}): Promise<JsonRecord> {
  const results: JsonRecord = {};
  const refreshes: Promise<void>[] = [];

  // Deadline communication is never allowed to wait behind a slow provider retry.
  if (args.allowIncident && args.actions.includes('deliver_incident')) {
    results.deliver_incident = await invokeFunction(
      args.baseUrl,
      'line-daily-push',
      args.cronSecret,
      { delivery_mode: 'incident', incident_reason_codes: args.reasonCodes },
      120_000,
    );
  }

  if (args.actions.includes('refresh_news')) {
    refreshes.push(invokeFunctionWithRetry(args.baseUrl, 'fetch-global-market-news', args.cronSecret, {
      recovery_attempt: args.attempt,
    }, 180_000).then((result) => { results.refresh_news = result; }));
  }
  if (args.actions.includes('refresh_market')) {
    refreshes.push(invokeFunctionWithRetry(args.baseUrl, 'fetch-market-data-v10', args.cronSecret, {
      phase: 'premarket',
      recovery_attempt: args.attempt,
    }, 180_000).then((result) => { results.refresh_market = result; }));
  }
  if (args.actions.includes('refresh_sector_rotation')) {
    const targetDate = args.reasonCodes
      .map((reason) => reason.match(/^sector_rotation_scores:(\d{4}-\d{2}-\d{2})$/i)?.[1] || '')
      .find(Boolean);
    refreshes.push(targetDate
      ? invokeFunctionWithRetry(args.baseUrl, 'generate-sector-rotation', args.cronSecret, {
        backfill: true,
        target_date: targetDate,
        recovery_attempt: args.attempt,
        source: 'daily-delivery-orchestrator',
      }, 300_000).then((result) => { results.refresh_sector_rotation = result; })
      : Promise.resolve().then(() => {
        results.refresh_sector_rotation = {
          ok: false,
          status: 400,
          payload: { success: false, error: 'SECTOR_ROTATION_TARGET_DATE_MISSING' },
        };
      }));
  }
  await Promise.all(refreshes);

  if (args.actions.includes('regenerate_report')) {
    const evidenceRefreshFailed = hasFailedEvidenceDependency(results);
    results.regenerate_report = evidenceRefreshFailed
      ? {
        ok: false,
        status: 424,
        payload: { success: false, error: 'EVIDENCE_REFRESH_DEPENDENCY_FAILED' },
      }
      : await invokeFunction(
        args.baseUrl,
        'generate-daily-report-v7',
        args.cronSecret,
        {
          quality_retry: true,
          recovery_attempt: args.attempt,
          recovery_reason_codes: args.reasonCodes,
        },
        540_000,
      );
  }

  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed', version: VERSION }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const cronSecret = Deno.env.get('CRON_SECRET') || '';
  if (!supabaseUrl || !serviceRoleKey || !cronSecret) {
    return jsonResponse({ success: false, error: 'Runtime credentials missing', version: VERSION }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authorization = await authorizeRequest(req, supabase, cronSecret);
  if (!authorization.ok) {
    return jsonResponse({ success: false, error: authorization.error_code, error_code: authorization.error_code, version: VERSION }, 401);
  }

  let body: JsonRecord = {};
  try {
    body = asRecord(await req.json());
  } catch {
    body = {};
  }

  const clock = taipeiClock();
  const requestedRecoveryDate = body.source === 'ma-ops-safe-recovery'
    ? String(body.target_date || body.report_date || '').trim()
    : '';
  if (requestedRecoveryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(requestedRecoveryDate) || requestedRecoveryDate > clock.date)) {
    return jsonResponse({ success: false, error: 'INVALID_RECOVERY_BUSINESS_DATE', version: VERSION }, 400);
  }
  const businessDate = requestedRecoveryDate || clock.date;
  const marketStatus = resolveMarketStatus(businessDate);
  if (!marketStatus.is_trading_day) {
    return jsonResponse({
      success: true,
      status: 'SKIPPED',
      reason: 'MARKET_STATUS_NOT_OPEN',
      report_date: businessDate,
      market_status: marketStatus.market_status,
      next_trading_day: marketStatus.next_trading_day,
      version: VERSION,
    });
  }
  if (body.mode === 'runtime_checkpoint') {
    const checkpoint = String(body.checkpoint || '');
    if (!RUNTIME_CHECKPOINTS.has(checkpoint)) {
      return jsonResponse({ success: false, error: 'UNSUPPORTED_RUNTIME_CHECKPOINT', checkpoint, version: VERSION }, 400);
    }
    const existingState = await supabase.from('trading_day_state').select('checkpoint_status')
      .eq('trading_date', businessDate).maybeSingle();
    if (!existingState.error && String(asRecord(asRecord(existingState.data?.checkpoint_status)[checkpoint]).status || '').toUpperCase() === 'SUCCEEDED') {
      return jsonResponse({ success: true, status: 'SKIPPED_ALREADY_SUCCEEDED', report_date: businessDate, checkpoint, version: VERSION });
    }
    const runtimeSource = body.source === 'supabase_cron_watchdog' ? 'supabase_cron_watchdog' : 'supabase_cron_primary';
    const execution = await executeRuntimeCheckpoint(
      `${supabaseUrl}/functions/v1`,
      cronSecret,
      checkpoint,
      runtimeSource,
      businessDate,
    );
    return jsonResponse({
      success: execution.success,
      status: execution.success ? 'SUCCEEDED' : 'DEGRADED',
      report_date: businessDate,
      checkpoint,
      failures: execution.failures,
      results: execution.results,
      version: VERSION,
    }, execution.success ? 200 : 409);
  }
  if (body.mode === 'health_check') {
    const checkType = String(body.check_type || 'full');
    if (!['report', 'closing', 'full'].includes(checkType)) return jsonResponse({ success: false, error: 'UNSUPPORTED_HEALTH_CHECK', version: VERSION }, 400);
    const result = await invokeFunction(`${supabaseUrl}/functions/v1`, 'ma-ops-health-check', cronSecret, {
      environment: 'production', check_type: checkType, target_date: businessDate, request_id: body.correlation_id || crypto.randomUUID(), dry_run: false,
    }, 180_000);
    const healthSucceeded = result.ok && result.payload.ok === true;
    let recoveryLifecycle: JsonRecord | null = null;
    if (healthSucceeded && body.source === 'ma-ops-safe-recovery') {
      const stateResult = await supabase.from('trading_day_state').select('state_rank').eq('trading_date', businessDate).maybeSingle();
      if (stateResult.error) {
        return jsonResponse({ success: false, error: 'RECOVERY_LIFECYCLE_STATE_READ_FAILED', details: stateResult.error.message, report_date: businessDate, version: VERSION }, 500);
      }
      if (Number(stateResult.data?.state_rank || 0) < 130) {
        return jsonResponse({ success: false, error: 'RECOVERY_LIFECYCLE_PREDECESSOR_NOT_SATISFIED', report_date: businessDate, state_rank: Number(stateResult.data?.state_rank || 0), version: VERSION }, 409);
      }
      const requestedCorrelation = req.headers.get('x-correlation-id') || String(body.correlation_id || '');
      const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCorrelation)
        ? requestedCorrelation
        : crypto.randomUUID();
      const healthAdvance = await supabase.rpc('advance_trading_day_state_v1', {
        p_trading_date: businessDate,
        p_state: 'HEALTH_AUDITED',
        p_checkpoint: 'closing_health',
        p_status: 'SUCCEEDED',
        p_correlation_id: correlationId,
        p_metadata: { source: 'ma-ops-safe-recovery', health_http_status: result.status },
      });
      if (healthAdvance.error) {
        return jsonResponse({ success: false, error: 'RECOVERY_HEALTH_LIFECYCLE_ADVANCE_FAILED', details: healthAdvance.error.message, report_date: businessDate, version: VERSION }, 500);
      }
      const completionAdvance = await supabase.rpc('advance_trading_day_state_v1', {
        p_trading_date: businessDate,
        p_state: 'DAY_COMPLETED',
        p_checkpoint: 'day_completed',
        p_status: 'SUCCEEDED',
        p_correlation_id: correlationId,
        p_metadata: { source: 'ma-ops-safe-recovery', health_http_status: result.status },
      });
      if (completionAdvance.error) {
        return jsonResponse({ success: false, error: 'RECOVERY_COMPLETION_LIFECYCLE_ADVANCE_FAILED', details: completionAdvance.error.message, report_date: businessDate, version: VERSION }, 500);
      }
      const terminalReconciliation = await supabase.rpc('reconcile_runtime_terminal_failures_v1', {
        p_business_date: businessDate,
        p_correlation_id: correlationId,
      });
      if (terminalReconciliation.error) {
        return jsonResponse({
          success: false,
          error: 'RECOVERY_TERMINAL_RECONCILIATION_FAILED',
          details: terminalReconciliation.error.message,
          report_date: businessDate,
          version: VERSION,
        }, 409);
      }
      const evaluatorVersion = `PRODUCTION_ACCEPTANCE_V2_RECOVERY:${correlationId}`;
      const acceptanceCapture = await supabase.rpc('capture_morning_alpha_acceptance_v1', {
        p_business_date: businessDate,
        p_evaluator_version: evaluatorVersion,
      });
      if (acceptanceCapture.error || !acceptanceCapture.data) {
        return jsonResponse({
          success: false,
          error: 'RECOVERY_ACCEPTANCE_CAPTURE_FAILED',
          details: acceptanceCapture.error?.message || 'Acceptance result id was not returned.',
          report_date: businessDate,
          version: VERSION,
        }, 500);
      }
      const acceptanceResult = await supabase
        .from('production_acceptance_results')
        .select('id,verdict,blocking_checks,evaluated_at')
        .eq('id', String(acceptanceCapture.data))
        .maybeSingle();
      if (acceptanceResult.error || acceptanceResult.data?.verdict !== 'PASS') {
        return jsonResponse({
          success: false,
          error: 'RECOVERY_ACCEPTANCE_FAILED',
          details: acceptanceResult.error?.message || null,
          acceptance: acceptanceResult.data || null,
          report_date: businessDate,
          version: VERSION,
        }, 409);
      }
      recoveryLifecycle = {
        health_audited: true,
        day_completed: true,
        terminal_dispatches_reconciled: Number(terminalReconciliation.data || 0),
        acceptance: acceptanceResult.data,
        correlation_id: correlationId,
      };
    }
    return jsonResponse({ success: healthSucceeded, status: result.status, health: result.payload, recovery_lifecycle: recoveryLifecycle, report_date: businessDate, version: VERSION }, healthSucceeded ? 200 : result.status);
  }
  if (body.mode === 'continuous_learning') {
    const result = await invokeFunction(
      `${supabaseUrl}/functions/v1`,
      'continuous-learning-engine',
      cronSecret,
      {},
      300_000,
    );
    const accepted = result.ok
      && result.payload.success === true
      && (
        result.payload.reused === true
        || (result.payload.run_id != null && result.payload.skipped !== true && result.payload.degraded !== true)
      );
    return jsonResponse({
      success: accepted,
      status: accepted ? 'SUCCEEDED' : 'DEGRADED',
      report_date: businessDate,
      continuous_learning: result.payload,
      version: VERSION,
    }, accepted ? 200 : 409);
  }
  const requestedPhase = String(body.phase || '');
  const phase = ['refresh', 'generate', 'repair', 'deliver', 'watchdog'].includes(requestedPhase)
    ? requestedPhase as DailyDeliveryPhase
    : resolveDailyDeliveryPhase(clock.minutes);
  const forceRegenerate = body.force_regenerate === true;
  const attempt = Math.max(1, Math.trunc(Number(body.attempt) || Math.max(1, clock.slot - Math.floor((7 * 60) / 5) + 1)));
  let runId: string | null = null;

  try {
    const claim = await claimPipelineSlot(supabase, businessDate, phase, clock.slot, attempt);
    if (!claim.acquired) {
      const resolution = resolveClaimedPipelineSlot(claim.existingStatus);
      return jsonResponse({
        success: resolution.success,
        status: resolution.status,
        claimed_status: resolution.claimed_status,
        reason: 'PIPELINE_SLOT_ALREADY_CLAIMED',
        report_date: businessDate,
        phase,
        reason_codes: claim.existingReasonCodes,
        error_code: claim.existingErrorCode,
        version: VERSION,
      }, resolution.success ? 200 : 409);
    }
    const activeRunId = String(claim.id);
    runId = activeRunId;

    let state = await loadDeliveryState(supabase, businessDate);
    let plan = buildDailyDeliveryRecoveryPlan({
      has_report: Boolean(state.report),
      premium_eligible: state.premium_eligible,
      reason_codes: state.reason_codes,
      attempt,
      content_repair_attempts: Number(state.snapshot?.version || 0),
      taipei_minutes: clock.minutes,
    });

    let actions = plan.actions;
    if (forceRegenerate) actions = ['regenerate_report'];
    else if (phase === 'refresh') actions = actions.filter((action) =>
      action === 'refresh_news' || action === 'refresh_market' || action === 'refresh_sector_rotation'
    );
    else if (phase === 'generate') actions = state.premium_eligible
      ? []
      : actions.filter((action) => action === 'refresh_sector_rotation' || action === 'regenerate_report');
    else if (phase === 'deliver' && state.premium_eligible) actions = ['deliver_premium'];

    const actionResults = await executeRecoveryActions({
      actions,
      baseUrl: `${supabaseUrl}/functions/v1`,
      cronSecret,
      attempt,
      reasonCodes: state.reason_codes,
      allowIncident: clock.minutes >= 7 * 60 + 30,
    });

    if (actions.some((action) =>
      action === 'refresh_news'
      || action === 'refresh_market'
      || action === 'refresh_sector_rotation'
      || action === 'regenerate_report'
    )) {
      state = await loadDeliveryState(supabase, businessDate);
      plan = buildDailyDeliveryRecoveryPlan({
        has_report: Boolean(state.report),
        premium_eligible: state.premium_eligible,
        reason_codes: state.reason_codes,
        attempt,
        content_repair_attempts: Number(state.snapshot?.version || 0),
        taipei_minutes: clock.minutes,
      });
    }

    const deliveryBlockedByEvidenceFailure = hasFailedEvidenceDependency(actionResults);
    if (state.premium_eligible && clock.minutes >= 7 * 60 + 20 && !deliveryBlockedByEvidenceFailure) {
      actionResults.deliver_premium = await invokeFunction(
        `${supabaseUrl}/functions/v1`,
        'line-daily-push',
        cronSecret,
        { delivery_mode: 'premium' },
        120_000,
      );
    }

    const premiumDelivery = asRecord(actionResults.deliver_premium);
    const premiumDeliveryPayload = asRecord(premiumDelivery.payload);
    const incidentDelivery = asRecord(actionResults.deliver_incident);
    const incidentPayload = asRecord(incidentDelivery.payload);
    const delivered = premiumDelivery.ok === true
      && Number(premiumDeliveryPayload.failed_count || 0) === 0
      && Number(premiumDeliveryPayload.pending_count || 0) === 0
      && (
        premiumDeliveryPayload.sent === true
        || ['ALREADY_SENT', 'NO_ACTIVE_SUBSCRIBERS'].includes(String(premiumDeliveryPayload.reason || ''))
      );
    const actionFailures = Object.entries(actionResults)
      .filter(([, result]) => asRecord(result).ok !== true)
      .map(([action, result]) => ({
        action,
        status: Number(asRecord(result).status || 0),
        error: String(asRecord(asRecord(result).payload).error || 'ACTION_RETURNED_UNSUCCESSFUL').slice(0, 300),
      }));
    const actionFailureCodes = actionFailures.map((failure) => `action_failed:${failure.action}`);
    const completed = resolveDailyDeliveryCompletion({
      phase,
      action_failure_count: actionFailures.length,
      premium_eligible: state.premium_eligible,
      delivered,
    });
    const status = completed ? 'SUCCEEDED' : 'DEGRADED';
    const finalReasonCodes = phase === 'refresh'
      ? actionFailureCodes
      : Array.from(new Set([...state.reason_codes, ...actionFailureCodes]));
    await finishPipelineRun(
      supabase,
      activeRunId,
      status,
      {
        orchestrator_version: VERSION,
        phase,
        actions,
        action_results: actionResults,
        action_failures: actionFailures,
        delivery_blocked_by_evidence_failure: deliveryBlockedByEvidenceFailure,
        premium_eligible: state.premium_eligible,
        delivered,
        decision_snapshot_id: typeof state.snapshot?.id === 'string' ? state.snapshot.id : null,
        delivery_status: delivered
          ? 'SENT'
          : incidentDelivery.ok === true && (incidentPayload.sent === true || incidentPayload.reason === 'ALREADY_SENT')
            ? 'INCIDENT_SENT'
            : clock.minutes < 7 * 60 + 20
              ? 'NOT_DUE'
              : 'PENDING',
        recovery_plan: plan,
      },
      finalReasonCodes,
      completed ? null : plan.retry_after_seconds,
    );

    return jsonResponse({
      success: completed,
      status,
      report_date: businessDate,
      phase,
      actions,
      premium_eligible: state.premium_eligible,
      delivered,
      action_failures: actionFailures,
      delivery_blocked_by_evidence_failure: deliveryBlockedByEvidenceFailure,
      reason_codes: finalReasonCodes,
      retry_after_seconds: completed ? null : plan.retry_after_seconds,
      version: VERSION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      try {
        await finishPipelineRun(
          supabase,
          runId,
          'FAILED',
          { error_code: 'DAILY_DELIVERY_EXCEPTION', error_message: message, phase },
          ['daily_delivery_exception'],
          60,
        );
      } catch (updateError) {
        console.error('[DAILY-DELIVERY] Failed to persist error state', updateError);
      }
    }
    return jsonResponse({ success: false, error: message, phase, version: VERSION }, 500);
  }
});
