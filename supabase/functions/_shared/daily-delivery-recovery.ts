import { RUNTIME_QUALITY_POLICY } from './production-architecture-core.mjs';
import { PREMARKET_REPORT_DEADLINE_MINUTES } from './premarket-provider-readiness.mjs';

/** Business outcome is distinct from legacy outbox/provider receipt enums. */
export function resolveReportDeliveryStatus(input: {
  is_trading_day: boolean; system_failure: boolean; report_eligible: boolean;
  delivered: boolean; no_recommendation: boolean; suppressed: boolean;
}): 'DELIVERED' | 'DELIVERED_NO_RECOMMENDATION' | 'SKIPPED_NON_TRADING_DAY' | 'BLOCKED_QUALITY' | 'FAILED_SYSTEM' | 'SUPPRESSED' | 'WAITING' {
  if (!input.is_trading_day) return 'SKIPPED_NON_TRADING_DAY';
  if (input.system_failure) return 'FAILED_SYSTEM';
  if (!input.report_eligible) return 'BLOCKED_QUALITY';
  if (input.suppressed) return 'SUPPRESSED';
  if (!input.delivered) return 'WAITING';
  return input.no_recommendation ? 'DELIVERED_NO_RECOMMENDATION' : 'DELIVERED';
}

export type DailyDeliveryAction =
  | 'refresh_news'
  | 'refresh_market'
  | 'refresh_sector_rotation'
  | 'regenerate_report'
  | 'deliver_premium'
  | 'deliver_incident';

export type DailyDeliveryPhase = 'refresh' | 'generate' | 'repair' | 'deliver' | 'watchdog';

export interface DailyDeliveryRecoveryInput {
  has_report: boolean;
  premium_eligible: boolean;
  report_eligible?: boolean;
  reason_codes: string[];
  attempt: number;
  content_repair_attempts?: number;
  taipei_minutes: number;
  delivery_deadline_minutes?: number;
}

export interface DailyDeliveryRecoveryPlan {
  status: 'ready' | 'repairing' | 'incident' | 'blocked_quality';
  phase: DailyDeliveryPhase;
  actions: DailyDeliveryAction[];
  reason_codes: string[];
  attempt: number;
  deadline_reached: boolean;
  retry_after_seconds: number | null;
}

export interface DailyDeliveryCompletionInput {
  phase: DailyDeliveryPhase;
  action_failure_count: number;
  premium_eligible: boolean;
  report_eligible?: boolean;
  delivered: boolean;
}

export interface ClaimedPipelineSlotResolution {
  success: boolean;
  status: 'RUNNING' | 'SKIPPED' | 'DEGRADED' | 'FAILED';
  claimed_status: string;
}

export interface ClaimedPipelineRetryInput {
  status: string | null | undefined;
  attempt: number | null | undefined;
  next_retry_at: string | null | undefined;
  now?: string;
  max_attempts?: number;
}

export interface ClaimedPipelineRetryResolution {
  retry: boolean;
  next_attempt: number;
  reason: 'RETRY_DUE' | 'STATUS_NOT_RETRYABLE' | 'RETRY_NOT_SCHEDULED' | 'RETRY_NOT_DUE' | 'RETRY_BUDGET_EXHAUSTED';
}

/** A committed 14:30 market batch does not imply that closing verification finished. */
export function shouldSkipRuntimeCheckpoint(
  checkpoint: string,
  checkpointStatus: unknown,
  readFailed = false,
): boolean {
  if (readFailed || !checkpointStatus || typeof checkpointStatus !== 'object' || Array.isArray(checkpointStatus)) return false;
  const statuses = checkpointStatus as Record<string, unknown>;
  const succeeded = (value: unknown): boolean =>
    !!value && typeof value === 'object' && !Array.isArray(value)
    && String((value as Record<string, unknown>).status || '').toUpperCase() === 'SUCCEEDED';
  return succeeded(statuses[checkpoint]) && (checkpoint !== '1430' || succeeded(statuses.closing_verification));
}

const NEWS_REASONS = new Set([
  'news_traceability_incomplete',
  'verified_catalyst_evidence_missing',
  'fresh_catalyst_evidence_missing',
  'market_news',
  'market_news:no_verified_relevant_items',
]);

const MARKET_REASONS = new Set([
  'blank_market_change_detected',
  'verified_catalyst_evidence_missing',
  'fresh_catalyst_evidence_missing',
  'source_data_incomplete',
  'market_data',
  'market_data_dates',
]);

const CONTENT_REASONS = new Set([
  'content_score_below_90',
  'recommendation_reasoning_incomplete',
  'member_research_structure_incomplete',
  'content_publish_gate_missing',
  'content_publish_gate_not_ready',
  'content_publish_gate_blocked',
  'generic_content_detected',
  'decision_mode_incomplete',
  'evidence_quality_contract_missing',
  'member_research_value_sentence_low_quality',
  'decision_snapshot_not_publishable',
]);
const CONTENT_REPAIR_MAX_ATTEMPTS = 3;
const SECTOR_ROTATION_REASON = /^sector_rotation_scores:\d{4}-\d{2}-\d{2}$/i;
const EVIDENCE_DEPENDENCY_ACTIONS = [
  'refresh_news',
  'refresh_market',
  'refresh_sector_rotation',
  'regenerate_report',
] as const;

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function includesReason(reasonCodes: string[], expected: Set<string>, prefix = ''): boolean {
  return reasonCodes.some((reason) => expected.has(reason) || (prefix && reason.startsWith(prefix)));
}

export function isContentOnlyDeliveryFailure(reasonCodes: string[]): boolean {
  const reasons = unique((reasonCodes || []).filter(Boolean));
  return reasons.length > 0
    && reasons.every((reason) => CONTENT_REASONS.has(reason));
}

export function hasFailedEvidenceDependency(actionResults: Record<string, unknown>): boolean {
  return EVIDENCE_DEPENDENCY_ACTIONS.some((action) => {
    if (!Object.prototype.hasOwnProperty.call(actionResults, action)) return false;
    const result = actionResults[action];
    return !result || typeof result !== 'object' || Array.isArray(result) ||
      (result as Record<string, unknown>).ok !== true;
  });
}

export function resolveDailyDeliveryPhase(taipeiMinutes: number): DailyDeliveryPhase {
  if (taipeiMinutes < 7 * 60 + 5) return 'refresh';
  if (taipeiMinutes < 7 * 60 + 10) return 'generate';
  if (taipeiMinutes < 7 * 60 + 20) return 'repair';
  if (taipeiMinutes < 7 * 60 + 30) return 'deliver';
  return 'watchdog';
}

export function resolveDailyDeliveryCompletion(
  input: DailyDeliveryCompletionInput,
): boolean {
  if (input.action_failure_count > 0) return false;
  if (input.phase === 'refresh') return true;
  if (input.phase === 'generate' || input.phase === 'repair') {
    return input.report_eligible ?? input.premium_eligible;
  }
  return (input.report_eligible ?? input.premium_eligible) && input.delivered;
}

export function resolveClaimedPipelineSlot(
  existingStatus: string | null | undefined,
): ClaimedPipelineSlotResolution {
  const claimedStatus = String(existingStatus || 'UNKNOWN').toUpperCase();
  if (claimedStatus === 'RUNNING') {
    return { success: false, status: 'RUNNING', claimed_status: claimedStatus };
  }
  if (['SUCCEEDED', 'SKIPPED'].includes(claimedStatus)) {
    return {
      success: true,
      status: 'SKIPPED',
      claimed_status: claimedStatus,
    };
  }
  return {
    success: false,
    status: claimedStatus === 'FAILED' ? 'FAILED' : 'DEGRADED',
    claimed_status: claimedStatus,
  };
}

export function resolveClaimedPipelineRetry(
  input: ClaimedPipelineRetryInput,
): ClaimedPipelineRetryResolution {
  const status = String(input.status || 'UNKNOWN').toUpperCase();
  const attempt = Math.max(1, Math.trunc(Number(input.attempt) || 1));
  const maxAttempts = Math.max(1, Math.trunc(Number(input.max_attempts) || RUNTIME_QUALITY_POLICY.max_recovery_attempts));
  const nextAttempt = attempt + 1;

  if (!['DEGRADED', 'FAILED'].includes(status)) {
    return { retry: false, next_attempt: nextAttempt, reason: 'STATUS_NOT_RETRYABLE' };
  }
  if (attempt >= maxAttempts) {
    return { retry: false, next_attempt: nextAttempt, reason: 'RETRY_BUDGET_EXHAUSTED' };
  }

  const retryAtMs = Date.parse(String(input.next_retry_at || ''));
  if (!Number.isFinite(retryAtMs)) {
    return { retry: false, next_attempt: nextAttempt, reason: 'RETRY_NOT_SCHEDULED' };
  }
  const nowMs = Date.parse(String(input.now || new Date().toISOString()));
  if (!Number.isFinite(nowMs) || retryAtMs > nowMs) {
    return { retry: false, next_attempt: nextAttempt, reason: 'RETRY_NOT_DUE' };
  }
  return { retry: true, next_attempt: nextAttempt, reason: 'RETRY_DUE' };
}

export function buildDailyDeliveryRecoveryPlan(
  input: DailyDeliveryRecoveryInput,
): DailyDeliveryRecoveryPlan {
  const attempt = Math.max(1, Math.trunc(input.attempt || 1));
  const deadlineMinutes = input.delivery_deadline_minutes ?? 7 * 60 + 30;
  const deadlineReached = input.taipei_minutes >= deadlineMinutes;
  const phase = resolveDailyDeliveryPhase(input.taipei_minutes);
  const reasonCodes = unique((input.reason_codes || []).filter(Boolean));
  const contentRepairAttempts = Math.max(0, Math.trunc(input.content_repair_attempts || 0));
  const contentRepairBudgetExhausted = isContentOnlyDeliveryFailure(reasonCodes)
    && contentRepairAttempts >= CONTENT_REPAIR_MAX_ATTEMPTS;

  if (input.report_eligible ?? input.premium_eligible) {
    return {
      status: 'ready',
      phase,
      actions: phase === 'refresh' || phase === 'generate' || phase === 'repair'
        ? []
        : ['deliver_premium'],
      reason_codes: reasonCodes,
      attempt,
      deadline_reached: deadlineReached,
      retry_after_seconds: null,
    };
  }

  // Retrying unchanged unsupported content cannot create evidence. A changed
  // input fingerprint may be evaluated by the normal generator on a later run;
  // this planner must never regenerate repeatedly until an LLM evades a gate.
  if (reasonCodes.some((reason) => /unsupported_claim|evidence_coverage|research_duplicate|research_contradiction|schema_mismatch|schema_corruption|company_.*evidence|quality_counter|no_recommendation_not_audited/.test(reason))) {
    return { status: 'blocked_quality', phase, actions: deadlineReached ? ['deliver_incident'] : [],
      reason_codes: reasonCodes, attempt, deadline_reached: deadlineReached, retry_after_seconds: null };
  }

  const actions: DailyDeliveryAction[] = [];
  if (!input.has_report) {
    actions.push('refresh_news', 'refresh_market', 'regenerate_report');
  } else {
    if (includesReason(reasonCodes, NEWS_REASONS)) actions.push('refresh_news');
    if (includesReason(reasonCodes, MARKET_REASONS, 'stale_market_data:')
      || includesReason(reasonCodes, MARKET_REASONS, 'unavailable_market_data:')) {
      actions.push('refresh_market');
    }
    if (reasonCodes.some((reason) => SECTOR_ROTATION_REASON.test(reason))) {
      actions.push('refresh_sector_rotation');
    }
    if (!contentRepairBudgetExhausted && (includesReason(reasonCodes, CONTENT_REASONS)
      || actions.includes('refresh_news')
      || actions.includes('refresh_market')
      || actions.includes('refresh_sector_rotation'))) {
      actions.push('regenerate_report');
    }
  }

  if (actions.length === 0 && !deadlineReached && !contentRepairBudgetExhausted) actions.push('regenerate_report');
  if (deadlineReached) actions.unshift('deliver_incident');

  return {
    status: deadlineReached ? 'incident' : 'repairing',
    phase,
    actions: unique(actions),
    reason_codes: reasonCodes.length > 0 ? reasonCodes : ['daily_report_not_publishable'],
    attempt,
    deadline_reached: deadlineReached,
    retry_after_seconds: contentRepairBudgetExhausted
      ? null
      : attempt >= RUNTIME_QUALITY_POLICY.max_recovery_attempts ? 300 : Math.min(180, 30 * attempt),
  };
}

// The protected legacy planner remains byte-for-byte unchanged. The only
// exception is a verified prior-session Taiwan provider delay, with its own
// bounded deadline and terminal incident-only action.
export function buildPremarketProviderReadinessPlan(
  input: DailyDeliveryRecoveryInput & { provider_not_ready?: boolean },
): DailyDeliveryRecoveryPlan {
  if (!input.provider_not_ready) return buildDailyDeliveryRecoveryPlan(input);
  const base = buildDailyDeliveryRecoveryPlan({
    ...input, delivery_deadline_minutes: PREMARKET_REPORT_DEADLINE_MINUTES,
  });
  if (!input.has_report && input.taipei_minutes >= PREMARKET_REPORT_DEADLINE_MINUTES) {
    return {
      status: 'incident', phase: base.phase, actions: ['deliver_incident'],
      reason_codes: ['PROVIDER_DATA_NOT_READY'], attempt: base.attempt,
      deadline_reached: true, retry_after_seconds: null,
    };
  }
  return { ...base, retry_after_seconds: base.deadline_reached ? base.retry_after_seconds : 300 };
}

// A late recovery must not move the original 07:30 delivery deadline.
export function resolvePremarketReadinessTiming(input: {
  report_date: string;
  completed_at: string;
  provider_delay_context: boolean;
  report_eligible: boolean;
  provider_not_ready: boolean;
  delivered: boolean;
}): {
  delivery_sla_status: 'MET' | 'MISS' | 'PENDING';
  readiness_recovery_status: 'RECOVERED_WITHIN_READINESS_WINDOW' | null;
  readiness_window_deadline_at: string | null;
} {
  const completedAtMs = Date.parse(input.completed_at);
  const deliverySlaMs = Date.parse(`${input.report_date}T07:30:00+08:00`);
  const readinessDeadlineMs = Date.parse(`${input.report_date}T08:45:00+08:00`);
  const deliverySlaStatus = input.delivered && completedAtMs <= deliverySlaMs ? 'MET'
    : completedAtMs > deliverySlaMs ? 'MISS' : 'PENDING';
  const recovered = input.provider_delay_context && input.report_eligible && !input.provider_not_ready
    && completedAtMs > deliverySlaMs && completedAtMs < readinessDeadlineMs;
  return {
    delivery_sla_status: deliverySlaStatus,
    readiness_recovery_status: recovered ? 'RECOVERED_WITHIN_READINESS_WINDOW' : null,
    readiness_window_deadline_at: input.provider_delay_context ? new Date(readinessDeadlineMs).toISOString() : null,
  };
}
