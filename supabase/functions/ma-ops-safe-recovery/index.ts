import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { buildRetryDecision, RUNTIME_QUALITY_POLICY } from '../_shared/production-architecture-core.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-cron-secret, x-correlation-id',
};

const ACTIONS = {
  retry_daily_delivery: { target: 'daily-delivery-orchestrator', defaultBody: { mode: 'watchdog' } },
  retry_market_data: { target: 'fetch-market-data-v10', defaultBody: { phase: 'manual_backfill', force_run: true } },
  regenerate_report: { target: 'generate-daily-report-v7', defaultBody: { quality_retry: true } },
  retry_closing_verification: { target: 'closing-verification-engine', defaultBody: {} },
  retry_continuous_learning: { target: 'continuous-learning-engine', defaultBody: {} },
} as const;

type ActionName = keyof typeof ACTIONS;
type JsonRecord = Record<string, unknown>;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function isAction(value: unknown): value is ActionName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, value);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const expectedSecret = Deno.env.get('CRON_SECRET') || '';
  if (!expectedSecret) return jsonResponse({ success: false, error: 'CRON_SECRET_NOT_CONFIGURED' }, 500);
  if ((req.headers.get('x-cron-secret') || '') !== expectedSecret) {
    return jsonResponse({ success: false, error: 'UNAUTHORIZED' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, error: 'SUPABASE_CREDENTIALS_MISSING' }, 500);

  const body = asRecord(await req.json().catch(() => ({})));
  if (!isAction(body.action)) {
    return jsonResponse({ success: false, error: 'ACTION_NOT_ALLOWLISTED', allowed_actions: Object.keys(ACTIONS) }, 400);
  }

  const action = body.action;
  const config = ACTIONS[action];
  const dryRun = body.dry_run !== false;
  const approved = body.approved === true;
  const attempt = Math.max(1, Math.trunc(Number(body.attempt) || 1));
  const retryDecision = buildRetryDecision({
    attempt,
    max_attempts: RUNTIME_QUALITY_POLICY.max_recovery_attempts,
    retryable: true,
  });
  const requestedCorrelation = req.headers.get('x-correlation-id') || String(body.correlation_id || '');
  const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCorrelation)
    ? requestedCorrelation
    : crypto.randomUUID();
  const requestPayload = { ...config.defaultBody, ...asRecord(body.payload), recovery_attempt: attempt };
  const idempotencyKey = String(body.idempotency_key || `${action}:${correlationId}:${attempt}`);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: existingAudit, error: existingAuditError } = await supabase
    .from('ma_ops_recovery_actions')
    .select('id,status,after_json')
    .eq('environment', 'production')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existingAuditError) return jsonResponse({ success: false, error: 'RECOVERY_AUDIT_READ_FAILED', details: existingAuditError.message, correlation_id: correlationId }, 500);
  if (existingAudit?.status === 'succeeded') {
    return jsonResponse({ success: true, executed: false, idempotent_replay: true, action, target: config.target, audit_id: existingAudit.id, correlation_id: correlationId, result: existingAudit.after_json });
  }
  if (existingAudit?.status === 'running') {
    return jsonResponse({ success: false, executed: false, error: 'RECOVERY_ALREADY_RUNNING', audit_id: existingAudit.id, correlation_id: correlationId }, 409);
  }

  const auditPayload = {
    environment: 'production',
    action_type: action,
    target: config.target,
    idempotency_key: idempotencyKey,
    approval_required: true,
    approval_status: approved ? 'approved' : 'pending',
    approved_at: approved ? new Date().toISOString() : null,
    status: dryRun || !approved ? 'pending' : 'running',
    before_json: {
      dry_run: dryRun,
      correlation_id: correlationId,
      attempt,
      retry_decision: retryDecision,
      request_payload: requestPayload,
    },
  };
  const { data: auditRow, error: auditError } = await supabase
    .from('ma_ops_recovery_actions')
    .upsert(auditPayload, { onConflict: 'environment,idempotency_key' })
    .select('id,status')
    .single();
  if (auditError) return jsonResponse({ success: false, error: 'RECOVERY_AUDIT_WRITE_FAILED', details: auditError.message, correlation_id: correlationId }, 500);

  if (dryRun || !approved) {
    return jsonResponse({
      success: true,
      executed: false,
      dry_run: dryRun,
      approved,
      action,
      target: config.target,
      audit_id: auditRow.id,
      correlation_id: correlationId,
      retry_decision: retryDecision,
    });
  }

  if (retryDecision.dead_letter) {
    await supabase.rpc('enqueue_runtime_dead_letter_v1', {
      p_component: 'ma-ops-safe-recovery',
      p_operation: action,
      p_idempotency_key: idempotencyKey,
      p_correlation_id: correlationId,
      p_attempt: attempt,
      p_max_attempts: RUNTIME_QUALITY_POLICY.max_recovery_attempts,
      p_error_code: 'RECOVERY_ATTEMPT_BUDGET_EXHAUSTED',
      p_error_message: 'Allowlisted recovery was not invoked because the retry budget was exhausted.',
      p_request_payload: requestPayload,
      p_context: { target: config.target },
    });
    await supabase.from('ma_ops_recovery_actions').update({ status: 'failed', error_message: 'RECOVERY_ATTEMPT_BUDGET_EXHAUSTED' }).eq('id', auditRow.id);
    return jsonResponse({ success: false, executed: false, error: 'RECOVERY_ATTEMPT_BUDGET_EXHAUSTED', correlation_id: correlationId }, 409);
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${config.target}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': expectedSecret,
        'x-correlation-id': correlationId,
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json().catch(() => ({}));
    const succeeded = response.ok && asRecord(result).success !== false;
    await supabase.from('ma_ops_recovery_actions').update({
      status: succeeded ? 'succeeded' : 'failed',
      after_json: { http_status: response.status, response: result, correlation_id: correlationId },
      error_message: succeeded ? null : String(asRecord(result).error || `HTTP_${response.status}`),
    }).eq('id', auditRow.id);
    return jsonResponse({ success: succeeded, executed: true, action, target: config.target, audit_id: auditRow.id, correlation_id: correlationId, result }, succeeded ? 200 : 502);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('ma_ops_recovery_actions').update({ status: 'failed', error_message: message }).eq('id', auditRow.id);
    if (attempt >= RUNTIME_QUALITY_POLICY.max_recovery_attempts) {
      await supabase.rpc('enqueue_runtime_dead_letter_v1', {
        p_component: 'ma-ops-safe-recovery',
        p_operation: action,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
        p_attempt: attempt,
        p_max_attempts: RUNTIME_QUALITY_POLICY.max_recovery_attempts,
        p_error_code: 'RECOVERY_EXECUTION_FAILED',
        p_error_message: message,
        p_request_payload: requestPayload,
        p_context: { target: config.target },
      });
    }
    return jsonResponse({ success: false, executed: true, error: 'RECOVERY_EXECUTION_FAILED', details: message, correlation_id: correlationId }, 502);
  }
});
