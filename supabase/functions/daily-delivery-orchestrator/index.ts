import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { evaluatePremiumContentGate } from '../_shared/premium-content-gate.ts';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import {
  buildDailyDeliveryRecoveryPlan,
  hasFailedEvidenceDependency,
  resolveDailyDeliveryPhase,
  type DailyDeliveryAction,
  type DailyDeliveryPhase,
} from '../_shared/daily-delivery-recovery.ts';

const VERSION = 'DAILY_DELIVERY_V1.3_CONTINUOUS_LEARNING_BACKUP';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-cron-secret, x-daily-delivery-token',
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
): Promise<boolean> {
  const presentedCronSecret = req.headers.get('x-cron-secret') || '';
  if (cronSecret && presentedCronSecret === cronSecret) return true;

  const token = req.headers.get('x-daily-delivery-token') || '';
  if (!token) return false;
  const { data, error } = await supabase
    .from('runtime_job_tokens')
    .select('token_hash,is_active')
    .eq('name', 'morning_alpha_daily_delivery')
    .maybeSingle();
  if (error || !data?.is_active || typeof data.token_hash !== 'string') return false;
  return await sha256Hex(token) === data.token_hash;
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
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
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
      && ['ready', 'degraded'].includes(String(payload.data_status || ''))
      && String(payload.radar_status || '').length > 0;
  }
  if (slug === 'close-market-review') {
    return payload.success === true && (
      ['written_and_synced', 'skipped_idempotent'].includes(String(payload.action || ''))
      || payload.pending === true
      || payload.skipped === true
    );
  }
  if (slug === 'closing-verification-engine') {
    return payload.success === true && [
      'completed',
      'direction_completed_data_degraded',
    ].includes(String(payload.closing_verification_status || ''));
  }
  return result.ok;
}

async function executeRuntimeCheckpoint(
  baseUrl: string,
  cronSecret: string,
  checkpoint: string,
): Promise<{ success: boolean; results: JsonRecord; failures: string[] }> {
  const results: JsonRecord = {};
  const failures: string[] = [];
  const phase = ['1410', '1430'].includes(checkpoint) ? 'close' : 'intraday';
  const market = await invokeFunctionWithRetry(baseUrl, 'fetch-market-data-v10', cronSecret, {
    phase,
    checkpoint,
    source: 'supabase_cron_backup',
  }, 180_000, 3);
  results.market = market;
  if (!checkpointResultOk('fetch-market-data-v10', checkpoint, market)) {
    failures.push('market_checkpoint_incomplete');
    return { success: false, results, failures };
  }

  if (phase === 'intraday') {
    if (checkpoint !== '0900') {
      const radar = await invokeFunctionWithRetry(baseUrl, 'opening-market-radar', cronSecret, {
        checkpoint,
        source: 'supabase_cron_backup',
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
    source: 'supabase_cron_backup',
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

  const review = await invokeFunctionWithRetry(baseUrl, 'close-market-review', cronSecret, {
    source: 'supabase_cron_backup',
  }, 180_000, 3);
  results.review = review;
  if (!checkpointResultOk('close-market-review', checkpoint, review)) {
    failures.push('closing_review_incomplete');
    return { success: false, results, failures };
  }

  const verification = await invokeFunctionWithRetry(baseUrl, 'closing-verification-engine', cronSecret, {
    source: 'supabase_cron_backup',
  }, 180_000, 3);
  results.verification = verification;
  if (!checkpointResultOk('closing-verification-engine', checkpoint, verification)) failures.push('closing_verification_incomplete');
  return { success: failures.length === 0, results, failures };
}

async function loadDeliveryState(
  supabase: SupabaseClient,
  reportDate: string,
): Promise<DeliveryState> {
  const [{ data: report, error: reportError }, { data: snapshot, error: snapshotError }] = await Promise.all([
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
  ]);

  if (reportError) throw new Error(`REPORT_STATE_QUERY_FAILED:${reportError.message}`);
  if (snapshotError) throw new Error(`SNAPSHOT_STATE_QUERY_FAILED:${snapshotError.message}`);
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
  const reasonCodes = Array.from(new Set([
    ...premiumGate.reason_codes,
    ...asStringArray(snapshotRecord?.reason_codes),
    ...(snapshotRecord ? [] : ['decision_snapshot_missing']),
    ...(snapshotReady ? [] : ['decision_snapshot_not_publishable']),
  ]));

  return {
    report: reportRecord,
    snapshot: snapshotRecord,
    premium_eligible: premiumGate.eligible && snapshotReady,
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
  if (!(await authorizeRequest(req, supabase, cronSecret))) {
    return jsonResponse({ success: false, error: 'Unauthorized', version: VERSION }, 401);
  }

  let body: JsonRecord = {};
  try {
    body = asRecord(await req.json());
  } catch {
    body = {};
  }

  const clock = taipeiClock();
  const marketStatus = resolveMarketStatus(clock.date);
  if (!marketStatus.is_trading_day) {
    return jsonResponse({
      success: true,
      status: 'SKIPPED',
      reason: 'MARKET_STATUS_NOT_OPEN',
      report_date: clock.date,
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
    const execution = await executeRuntimeCheckpoint(`${supabaseUrl}/functions/v1`, cronSecret, checkpoint);
    return jsonResponse({
      success: execution.success,
      status: execution.success ? 'SUCCEEDED' : 'DEGRADED',
      report_date: clock.date,
      checkpoint,
      failures: execution.failures,
      results: execution.results,
      version: VERSION,
    }, execution.success ? 200 : 409);
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
      && (result.payload.run_id != null || result.payload.skipped === true || result.payload.reused === true);
    return jsonResponse({
      success: accepted,
      status: accepted ? 'SUCCEEDED' : 'DEGRADED',
      report_date: clock.date,
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
    const claim = await claimPipelineSlot(supabase, clock.date, phase, clock.slot, attempt);
    if (!claim.acquired) {
      const existingSucceeded = claim.existingStatus === 'SUCCEEDED' || claim.existingStatus === 'SKIPPED';
      return jsonResponse({
        success: existingSucceeded,
        status: claim.existingStatus || 'RUNNING',
        reason: 'PIPELINE_SLOT_ALREADY_CLAIMED',
        report_date: clock.date,
        phase,
        reason_codes: claim.existingReasonCodes,
        error_code: claim.existingErrorCode,
        version: VERSION,
      });
    }
    const activeRunId = String(claim.id);
    runId = activeRunId;

    let state = await loadDeliveryState(supabase, clock.date);
    let plan = buildDailyDeliveryRecoveryPlan({
      has_report: Boolean(state.report),
      premium_eligible: state.premium_eligible,
      reason_codes: state.reason_codes,
      attempt,
      taipei_minutes: clock.minutes,
    });

    let actions = plan.actions;
    if (forceRegenerate) actions = ['regenerate_report'];
    else if (phase === 'refresh') actions = actions.filter((action) => action === 'refresh_news' || action === 'refresh_market');
    else if (phase === 'generate') actions = state.premium_eligible ? [] : ['regenerate_report'];
    else if (phase === 'deliver' && state.premium_eligible) actions = ['deliver_premium'];

    const actionResults = await executeRecoveryActions({
      actions,
      baseUrl: `${supabaseUrl}/functions/v1`,
      cronSecret,
      attempt,
      reasonCodes: state.reason_codes,
      allowIncident: clock.minutes >= 7 * 60 + 30,
    });

    if (actions.some((action) => action === 'refresh_news' || action === 'refresh_market' || action === 'regenerate_report')) {
      state = await loadDeliveryState(supabase, clock.date);
      plan = buildDailyDeliveryRecoveryPlan({
        has_report: Boolean(state.report),
        premium_eligible: state.premium_eligible,
        reason_codes: state.reason_codes,
        attempt,
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
    const completed = actionFailures.length === 0 && state.premium_eligible &&
      (clock.minutes < 7 * 60 + 20 || delivered || Object.keys(premiumDelivery).length === 0);
    const status = completed ? 'SUCCEEDED' : 'DEGRADED';
    const finalReasonCodes = Array.from(new Set([...state.reason_codes, ...actionFailureCodes]));
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
      report_date: clock.date,
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
