export const ALPHA_COACH_REFUSAL = '目前 Morning Alpha 的正式資料不足以支持這個結論，我不會自行推測。';

export const ALPHA_COACH_MAX_QUESTION_LENGTH = 280;

export type AlphaCoachSource = {
  id: string;
  label: string;
  url?: string;
  data_as_of?: string;
  supports?: AlphaCoachClaimKind[];
};

export type AlphaCoachClaimKind =
  | 'plain_explanation'
  | 'relation_to_today'
  | 'supporting_evidence'
  | 'confirmation_conditions'
  | 'invalidation_conditions'
  | 'data_source_and_time';

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
  /買(?:進|入)?價|賣(?:出)?價|進場價|停損價|目標價|買賣點/i,
  /投入(?:多少|\s*\d)|配置(?:多少|\s*\d)|資金(?:投入|配置).{0,8}\d/i,
  /保證.{0,8}(獲利|賺錢)|一定(?:會)?(?:上漲|大漲|獲利|賺錢)/i,
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
    : [];
}

/** Production reports store news in important_news_json; ai_strategy_json.important_news is legacy-compatible only. */
export function normalizeReportImportantNews(reportValue: unknown): Record<string, unknown>[] {
  const report = asRecord(reportValue);
  const productionRows = asRecords(report.important_news_json);
  if (productionRows.length > 0) return productionRows;
  return asRecords(asRecord(report.ai_strategy_json).important_news);
}

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
  if (!input.plainExplanation.trim() || !input.relationToToday.trim() || !input.dataAsOf.trim()) return null;
  if (evidence.length === 0 || confirmation.length === 0 || invalidation.length === 0) return null;
  const sourceFor = (claim: AlphaCoachClaimKind): AlphaCoachSource | undefined => {
    const candidates = input.sources.filter((source) => source.supports?.includes(claim));
    if (claim === 'plain_explanation') return candidates.find((source) => Boolean(source.url)) || candidates[0];
    return candidates[0];
  };
  const citations = {
    plain: sourceFor('plain_explanation'),
    relation: sourceFor('relation_to_today'),
    evidence: sourceFor('supporting_evidence'),
    confirmation: sourceFor('confirmation_conditions'),
    invalidation: sourceFor('invalidation_conditions'),
    data: sourceFor('data_source_and_time'),
  };
  if (Object.values(citations).some((source) => !source)) return null;
  const cite = (source: AlphaCoachSource | undefined) => `[${source?.id}]`;
  return {
    plain_explanation: `${input.plainExplanation.trim()} ${cite(citations.plain)}`,
    relation_to_today: `${input.relationToToday.trim()} ${cite(citations.relation)}`,
    supporting_evidence: evidence.map((item) => `${item} ${cite(citations.evidence)}`),
    confirmation_conditions: confirmation.map((item) => `${item} ${cite(citations.confirmation)}`),
    invalidation_conditions: invalidation.map((item) => `${item} ${cite(citations.invalidation)}`),
    data_source_and_time: `資料時間 ${input.dataAsOf} ${cite(citations.data)}`,
  };
}

export function alphaCoachSourcesAreValid(answer: unknown, sources: AlphaCoachSource[]): boolean {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) || sources.length === 0) return false;
  const row = answer as Record<string, unknown>;
  const requiredText = ['plain_explanation', 'relation_to_today', 'data_source_and_time'];
  const requiredLists = ['supporting_evidence', 'confirmation_conditions', 'invalidation_conditions'];
  if (!requiredText.every((key) => presentText(row[key]).length >= 4)) return false;
  if (!requiredLists.every((key) => Array.isArray(row[key]) && (row[key] as unknown[]).length > 0)) return false;
  const validSources = new Map<string, AlphaCoachSource>();
  for (const source of sources) {
    if (!/^S\d+$/.test(source.id) || !presentText(source.label) || validSources.has(source.id)) return false;
    if (source.url && !/^https:\/\//i.test(source.url)) return false;
    validSources.set(source.id, source);
  }
  const claimValues: Array<[AlphaCoachClaimKind, string[]]> = [
    ['plain_explanation', [presentText(row.plain_explanation)]],
    ['relation_to_today', [presentText(row.relation_to_today)]],
    ['supporting_evidence', (row.supporting_evidence as unknown[]).map(presentText)],
    ['confirmation_conditions', (row.confirmation_conditions as unknown[]).map(presentText)],
    ['invalidation_conditions', (row.invalidation_conditions as unknown[]).map(presentText)],
    ['data_source_and_time', [presentText(row.data_source_and_time)]],
  ];
  return claimValues.every(([claim, values]) => values.every((value) => {
    const refs = [...value.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]);
    if (refs.length === 0) return false;
    return refs.every((ref) => validSources.get(ref)?.supports?.includes(claim) === true);
  }));
}
