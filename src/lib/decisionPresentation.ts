import type { CanonicalMorningNarrative } from './canonicalNarrative.ts';
import type { MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { canPresentConfirmedDecision, canPresentRejectedDecision } from './decisionEvidence.ts';

export type PresentationDecisionState = 'WAIT' | 'ACT' | 'STOP' | 'CLOSED' | 'INSUFFICIENT_DATA';

export type PresentedOpportunity = {
  symbol: string;
  name: string;
  roleLabel?: string;
  oneLineReason?: string;
  confirmation?: string;
  invalidation?: string;
  priority?: string | number;
};

export type DecisionPresentation = {
  dateLabel: string;
  marketStateLabel: string;
  marketBiasLabel?: string;
  primaryDecision: {
    state: PresentationDecisionState;
    headline: string;
    instruction: string;
    reason?: string;
  };
  mission: {
    title: string;
    explanation?: string;
  };
  nextCheckpoint: {
    label: string;
    time?: string;
  };
  actionItems: string[];
  confirmationItems: string[];
  invalidationItems: string[];
  confidence?: {
    label: string;
    score?: number;
    explanation?: string;
  };
  opportunities: PresentedOpportunity[];
};

type UnknownRecord = Record<string, unknown>;

export type DecisionPresentationInput = {
  displayState: MorningAlphaDisplayState | null;
  narrative: CanonicalMorningNarrative;
  opportunitySource?: UnknownRecord[];
  nextCheckpointFallback?: string;
};

const TERM_MAP: Array<[RegExp, string]> = [
  [/SEMICONDUCTOR/gi, '半導體'],
  [/PETROCHEMICAL/gi, '塑化'],
  [/AIRLINE[ _-]?TOURISM/gi, '航空觀光'],
  [/SHIPPING/gi, '航運'],
  [/AI[ _-]?SERVER/gi, 'AI 伺服器'],
  [/CRUDE[ _-]?OIL/gi, '油價題材'],
];

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const output = text(value);
    if (output) return output;
  }
  return '';
}

function compact(value: unknown, limit = 88): string {
  let output = text(value).replace(/\s+/g, ' ');
  for (const [pattern, replacement] of TERM_MAP) output = output.replace(pattern, replacement);
  output = output
    .replace(/(?:事件|觸發標籤|產業)\s*[：:]/g, '')
    .replace(/\s*→\s*/g, '、')
    .replace(/、{2,}/g, '、')
    .trim();
  if (output.length <= limit) return output;
  return `${output.slice(0, limit - 1).trim()}…`;
}

function unique(values: unknown[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const item = compact(value, 78);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

function splitCheckpoint(value: string): { label: string; time?: string } {
  const normalized = compact(value, 64);
  const match = normalized.match(/(?:^|\s)(\d{1,2}:\d{2})(?:\s|｜|$)/);
  if (!match) return { label: normalized || '等待下一個確認節點' };
  return {
    time: match[1],
    label: normalized.replace(match[1], '').replace(/^[\s｜|：:]+|[\s｜|：:]+$/g, '') || '回來確認市場訊號',
  };
}

function roleLabel(row: UnknownRecord): string {
  const raw = firstText(row.role_label, row.role, row.tier, row.category, row.netEvidenceDirection, row.net_evidence_direction).toLowerCase();
  if (raw === 'positive') return '主線候選';
  if (raw === 'neutral') return '先觀察';
  if (/strong|core|beneficiar|主線|強受惠/.test(raw)) return '主線候選';
  if (/representative|代表/.test(raw)) return '代表股';
  if (/risk|exclude|排除/.test(raw)) return '風險觀察';
  return raw ? compact(raw, 18) : '觀察股';
}

function opportunityCompleteness(item: PresentedOpportunity): number {
  return [item.symbol, item.name, item.oneLineReason, item.confirmation, item.invalidation, item.roleLabel]
    .filter(Boolean).length;
}

function opportunityRank(item: PresentedOpportunity): number {
  if (typeof item.priority === 'number' && Number.isFinite(item.priority)) return item.priority;
  const numeric = Number(item.priority);
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
}

function mapOpportunity(value: unknown): PresentedOpportunity | null {
  const row = record(value);
  const symbol = firstText(row.symbol, row.stock_code, row.stock_id, row.ticker, row.code);
  const name = firstText(row.stock_name, row.name, row.company_name);
  if (!symbol && !name) return null;
  const benefitChain = Array.isArray(row.benefitChain) ? row.benefitChain : Array.isArray(row.benefit_chain) ? row.benefit_chain : [];
  const scoringReasons = Array.isArray(row.scoringReasons) ? row.scoringReasons : Array.isArray(row.scoring_reasons) ? row.scoring_reasons : [];
  const rawReason = firstText(row.reason, row.rationale, row.investment_reason, row.benefit_source, row.relationship_to_thesis, row.observationReason, row.observation_reason, scoringReasons[0], benefitChain[0]);
  const translatedReason = compact(rawReason, 72);
  return {
    symbol,
    name,
    roleLabel: roleLabel(row),
    oneLineReason: translatedReason || undefined,
    confirmation: compact(firstText(row.confirmation, row.confirmation_needed, row.validation_signal, row.watch_point, row.what_to_watch, row.confirmationPendingReason, row.confirmation_pending_reason), 68) || undefined,
    invalidation: compact(firstText(row.invalidation, row.invalidation_condition, row.stop_condition, row.risk_note, row.risk, row.stopObservingCondition, row.stop_observing_condition), 68) || undefined,
    priority: typeof row.priority === 'string' || typeof row.priority === 'number'
      ? row.priority
      : typeof row.rank === 'string' || typeof row.rank === 'number' ? row.rank : undefined,
  };
}

export function dedupePresentedOpportunities(source: UnknownRecord[], limit = 8): PresentedOpportunity[] {
  const byKey = new Map<string, PresentedOpportunity>();
  for (const value of source) {
    const candidate = mapOpportunity(value);
    if (!candidate) continue;
    const key = candidate.symbol || candidate.name;
    const existing = byKey.get(key);
    const candidateRank = opportunityRank(candidate);
    const existingRank = existing ? opportunityRank(existing) : Number.POSITIVE_INFINITY;
    const shouldReplace = !existing
      || candidateRank < existingRank
      || (candidateRank === existingRank && opportunityCompleteness(candidate) > opportunityCompleteness(existing));
    if (shouldReplace) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values()).slice(0, limit);
}

function decisionState(input: DecisionPresentationInput): PresentationDecisionState {
  const { displayState, narrative } = input;
  if (displayState && (!displayState.is_trading_day || displayState.market_status !== 'OPEN')) return 'CLOSED';
  const status = narrative.decision_lifecycle.decision_status.status;
  if (status === 'Rejected' && canPresentRejectedDecision(narrative.decision_evidence)) return 'STOP';
  if (status === 'Confirmed' && canPresentConfirmedDecision(narrative.decision_evidence)) return 'ACT';
  if (!narrative.decision_evidence.marketSnapshotAvailable || !narrative.decision_evidence.checklistAvailable) {
    return 'INSUFFICIENT_DATA';
  }
  const hasMission = Boolean(narrative.decision_lifecycle.question.question || narrative.today_focus.summary);
  if (!displayState || !hasMission || displayState.dataStatus === 'insufficient') return 'INSUFFICIENT_DATA';
  return 'WAIT';
}

function decisionCopy(state: PresentationDecisionState): Pick<DecisionPresentation['primaryDecision'], 'headline' | 'instruction'> {
  if (state === 'ACT') return { headline: '劇本成立', instruction: '依原定計畫執行' };
  if (state === 'STOP') return { headline: '停止原定計畫', instruction: '今天不再延伸原本劇本' };
  if (state === 'CLOSED') return { headline: '今日休市', instruction: '今天不執行盤中流程' };
  if (state === 'INSUFFICIENT_DATA') return { headline: '資料尚未完整', instruction: '暫不建立交易判斷' };
  return { headline: '等待確認', instruction: '現在不要追價' };
}

export function buildDecisionPresentation(input: DecisionPresentationInput): DecisionPresentation {
  const { displayState, narrative } = input;
  const lifecycle = narrative.decision_lifecycle;
  const state = decisionState(input);
  const copy = decisionCopy(state);
  const nextRaw = firstText(
    /\d{1,2}:\d{2}/.test(lifecycle.validation_plan.next_step) ? lifecycle.validation_plan.next_step : '',
    input.nextCheckpointFallback,
    lifecycle.validation_plan.next_step,
    lifecycle.decision_status.next_step,
    narrative.intraday_progress.next_step,
    narrative.today_script.current_step,
    displayState?.nextUpdateTime,
  );
  const score = displayState?.confidenceScore;
  const opportunities = dedupePresentedOpportunities(input.opportunitySource || []);
  return {
    dateLabel: displayState?.reportDate || displayState?.currentDate || '',
    marketStateLabel: displayState?.market_message || '等待市場狀態',
    marketBiasLabel: compact(displayState?.marketBias, 24) || undefined,
    primaryDecision: {
      state,
      ...copy,
      reason: compact(firstText(lifecycle.decision_status.reason, narrative.today_focus.why, narrative.today_focus.summary), 88) || undefined,
    },
    mission: {
      title: compact(firstText(lifecycle.question.question, lifecycle.current_thesis.title, narrative.today_focus.headline), 72) || '等待今日主要劇本',
      explanation: compact(firstText(lifecycle.current_thesis.summary, narrative.today_focus.summary), 96) || undefined,
    },
    nextCheckpoint: splitCheckpoint(nextRaw),
    actionItems: unique([
      narrative.today_focus.action,
      lifecycle.decision_status.next_step,
      lifecycle.validation_plan.next_step,
    ], 3),
    confirmationItems: unique([
      ...lifecycle.validation_plan.steps.map((step) => firstText(step.detail, step.title)),
      narrative.intraday_progress.current_step,
      narrative.intraday_progress.next_step,
    ], 5),
    invalidationItems: unique([
      lifecycle.failure_condition.trigger,
      lifecycle.failure_condition.meaning,
      lifecycle.failure_condition.action,
      ...narrative.failure_triggers.flatMap((item) => [item.trigger, item.meaning, item.action]),
    ], 5),
    confidence: score == null ? undefined : {
      label: displayState?.confidenceLabel || '待確認',
      score,
      explanation: compact(displayState?.dataBasisNote, 72) || undefined,
    },
    opportunities,
  };
}

export function formatCheckpoint(checkpoint: DecisionPresentation['nextCheckpoint']): string {
  return checkpoint.time ? `${checkpoint.time}｜${checkpoint.label}` : checkpoint.label;
}
