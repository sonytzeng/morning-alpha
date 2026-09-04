export const ALPHA_COACH_REFUSAL = '目前 Morning Alpha 的正式資料不足以支持這個結論，我不會自行推測。';

export const ALPHA_COACH_MAX_QUESTION_LENGTH = 280;

export type AlphaCoachSource = {
  id: string;
  label: string;
  url?: string;
  data_as_of?: string;
};

export type AlphaCoachAnswer = {
  plain_explanation: string;
  relation_to_today: string;
  supporting_evidence: string[];
  confirmation_conditions: string[];
  invalidation_conditions: string[];
  data_source_and_time: string;
};

export type AlphaCoachContextGateInput = {
  today: string;
  reportDate?: unknown;
  reportId?: unknown;
  snapshotStatus?: unknown;
  snapshotSessionType?: unknown;
  snapshotIsCurrent?: unknown;
  snapshotId?: unknown;
  snapshotVersion?: unknown;
  memberStatus?: unknown;
  semanticStatus?: unknown;
  memberReportId?: unknown;
  memberSnapshotId?: unknown;
  memberSnapshotVersion?: unknown;
  premiumEligible?: unknown;
  sourceCount?: number;
};

export type AlphaCoachContextGateResult = {
  eligible: boolean;
  reasonCodes: string[];
};

const INJECTION_PATTERNS = [
  /ignore\s+(all|any|the|previous)/i,
  /忽略.{0,8}(前面|以上|系統|規則|指令)/,
  /(system|developer)\s*(prompt|message|instruction)/i,
  /顯示.{0,8}(提示詞|系統指令|隱藏指令)/,
  /jailbreak|越獄/i,
  /service[_ -]?role|supabase[_ -]?key|api[_ -]?key/i,
];

const PERSONAL_ADVICE_PATTERNS = [
  /我有\s*\d+\s*(張|股)/,
  /成本.{0,6}\d/,
  /我的持股|我的部位|幫我下單|買幾張|賣幾張|應該買多少|all[ -]?in/i,
];

function presentText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function presentNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeAlphaCoachQuestion(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function validateAlphaCoachQuestion(value: unknown): { valid: boolean; question: string; reason?: string } {
  const question = normalizeAlphaCoachQuestion(value);
  if (!question) return { valid: false, question, reason: 'QUESTION_REQUIRED' };
  if (question.length > ALPHA_COACH_MAX_QUESTION_LENGTH) return { valid: false, question, reason: 'QUESTION_TOO_LONG' };
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(question))) return { valid: false, question, reason: 'PROMPT_INJECTION_BLOCKED' };
  if (PERSONAL_ADVICE_PATTERNS.some((pattern) => pattern.test(question))) return { valid: false, question, reason: 'PERSONAL_ADVICE_BLOCKED' };
  return { valid: true, question };
}

export function evaluateAlphaCoachContext(input: AlphaCoachContextGateInput): AlphaCoachContextGateResult {
  const reasons: string[] = [];
  const snapshotVersion = presentNumber(input.snapshotVersion);
  const memberSnapshotVersion = presentNumber(input.memberSnapshotVersion);
  if (presentText(input.reportDate) !== input.today) reasons.push('STALE_OR_MISSING_REPORT');
  if (presentText(input.snapshotStatus).toUpperCase() !== 'READY') reasons.push('SNAPSHOT_NOT_READY');
  if (presentText(input.snapshotSessionType).toUpperCase() !== 'PREMARKET') reasons.push('SNAPSHOT_SESSION_INVALID');
  if (input.snapshotIsCurrent !== true) reasons.push('SNAPSHOT_NOT_CURRENT');
  if (!presentText(input.snapshotId) || !snapshotVersion) reasons.push('SNAPSHOT_IDENTITY_MISSING');
  if (presentText(input.memberStatus).toUpperCase() !== 'PASSED') reasons.push('MEMBER_CONTENT_NOT_PASSED');
  if (presentText(input.semanticStatus).toUpperCase() !== 'PASSED') reasons.push('SEMANTIC_GATE_NOT_PASSED');
  if (presentText(input.reportId) !== presentText(input.memberReportId)) reasons.push('REPORT_REVISION_MISMATCH');
  if (presentText(input.snapshotId) !== presentText(input.memberSnapshotId) || snapshotVersion !== memberSnapshotVersion) {
    reasons.push('SNAPSHOT_REVISION_MISMATCH');
  }
  if (input.premiumEligible !== true) reasons.push('PREMIUM_GATE_NOT_ELIGIBLE');
  if (!input.sourceCount || input.sourceCount < 1) reasons.push('SOURCES_MISSING');
  return { eligible: reasons.length === 0, reasonCodes: reasons };
}

export function buildGroundedAlphaCoachAnswer(input: {
  plainExplanation: string;
  relationToToday: string;
  supportingEvidence: string[];
  confirmationConditions: string[];
  invalidationConditions: string[];
  dataAsOf: string;
  sources: AlphaCoachSource[];
}): AlphaCoachAnswer | null {
  const evidence = input.supportingEvidence.map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const confirmation = input.confirmationConditions.map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const invalidation = input.invalidationConditions.map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const primarySource = input.sources[0];
  if (!input.plainExplanation.trim() || !input.relationToToday.trim() || !input.dataAsOf.trim() || !primarySource) return null;
  if (evidence.length === 0 || confirmation.length === 0 || invalidation.length === 0) return null;
  const cite = `[${primarySource.id}]`;
  return {
    plain_explanation: input.plainExplanation.trim(),
    relation_to_today: `${input.relationToToday.trim()} ${cite}`,
    supporting_evidence: evidence.map((item) => `${item} ${cite}`),
    confirmation_conditions: confirmation,
    invalidation_conditions: invalidation,
    data_source_and_time: `${primarySource.label}；資料時間 ${input.dataAsOf} ${cite}`,
  };
}

export function alphaCoachSourcesAreValid(answer: unknown, sources: AlphaCoachSource[]): boolean {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) || sources.length === 0) return false;
  const row = answer as Record<string, unknown>;
  const requiredText = ['plain_explanation', 'relation_to_today', 'data_source_and_time'];
  const requiredLists = ['supporting_evidence', 'confirmation_conditions', 'invalidation_conditions'];
  if (!requiredText.every((key) => presentText(row[key]).length >= 4)) return false;
  if (!requiredLists.every((key) => Array.isArray(row[key]) && (row[key] as unknown[]).length > 0)) return false;
  const combined = JSON.stringify(answer);
  const refs = [...combined.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
  if (refs.length === 0) return false;
  const validIds = new Set(sources.map((source) => source.id));
  return refs.every((ref) => validIds.has(ref));
}
