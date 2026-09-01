import { RUNTIME_QUALITY_POLICY } from './production-architecture-core.mjs';

export type DailyDeliveryAction =
  | 'refresh_news'
  | 'refresh_market'
  | 'regenerate_report'
  | 'deliver_premium'
  | 'deliver_incident';

export type DailyDeliveryPhase = 'refresh' | 'generate' | 'repair' | 'deliver' | 'watchdog';

export interface DailyDeliveryRecoveryInput {
  has_report: boolean;
  premium_eligible: boolean;
  reason_codes: string[];
  attempt: number;
  content_repair_attempts?: number;
  taipei_minutes: number;
  delivery_deadline_minutes?: number;
}

export interface DailyDeliveryRecoveryPlan {
  status: 'ready' | 'repairing' | 'incident';
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
  delivered: boolean;
}

export interface ClaimedPipelineSlotResolution {
  success: boolean;
  status: 'SKIPPED' | 'DEGRADED' | 'FAILED';
  claimed_status: string;
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
const EVIDENCE_DEPENDENCY_ACTIONS = ['refresh_news', 'refresh_market', 'regenerate_report'] as const;

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
    return input.premium_eligible;
  }
  return input.premium_eligible && input.delivered;
}

export function resolveClaimedPipelineSlot(
  existingStatus: string | null | undefined,
): ClaimedPipelineSlotResolution {
  const claimedStatus = String(existingStatus || 'UNKNOWN').toUpperCase();
  if (['RUNNING', 'SUCCEEDED', 'SKIPPED'].includes(claimedStatus)) {
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

  if (input.premium_eligible) {
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

  const actions: DailyDeliveryAction[] = [];
  if (!input.has_report) {
    actions.push('refresh_news', 'refresh_market', 'regenerate_report');
  } else {
    if (includesReason(reasonCodes, NEWS_REASONS)) actions.push('refresh_news');
    if (includesReason(reasonCodes, MARKET_REASONS, 'stale_market_data:')
      || includesReason(reasonCodes, MARKET_REASONS, 'unavailable_market_data:')) {
      actions.push('refresh_market');
    }
    if (!contentRepairBudgetExhausted && (includesReason(reasonCodes, CONTENT_REASONS)
      || actions.includes('refresh_news')
      || actions.includes('refresh_market'))) {
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
