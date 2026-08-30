import {
  RUNTIME_QUALITY_POLICY,
  gradeContentScore,
} from './production-architecture-core.mjs';

export type ContentQualityGrade = 'reject' | 'degraded' | 'publish' | 'high_quality';

export interface ContentScoreBreakdown {
  evidence: number;
  freshness: number;
  taiwan_relevance: number;
  specificity: number;
  actionability: number;
  risk: number;
  originality: number;
  readability: number;
}

export interface ContentIntelligenceResult {
  score: number;
  grade: ContentQualityGrade;
  publishable: boolean;
  reason_codes: string[];
  generic_flags: string[];
  breakdown: ContentScoreBreakdown;
}

export interface DecisionSentenceValueResult {
  eligible: boolean;
  flags: string[];
  concrete_marker_count: number;
  has_action: boolean;
  has_checkpoint: boolean;
  has_change_condition: boolean;
}

type JsonRecord = Record<string, unknown>;

const GENERIC_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'generic_market_changes', pattern: /市場(?:瞬息萬變|變化快速|變化多端)/ },
  { code: 'generic_watch_risk', pattern: /(?:留意|注意|關注)(?:市場)?風險/ },
  { code: 'generic_wait_and_see', pattern: /(?:持續|密切)?觀察市場(?:後續)?變化/ },
  { code: 'generic_invest_carefully', pattern: /投資(?:人)?(?:仍需|應)?謹慎/ },
  { code: 'generic_data_pending', pattern: /等待資料(?:確認|更新)|資料不足.*觀察/ },
  { code: 'broken_english_chinese_join', pattern: /(?:\b[A-Za-z][A-Za-z'-]*[ \t]+){3,}\b[A-Za-z][A-Za-z'-]*(?=[\u3400-\u9fff])/ },
];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
    : [];
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Do not splice a truncated English headline directly into a Chinese product
 * sentence. The source reference remains available in the evidence contract;
 * this helper only replaces an unsafe display lead with a factual category
 * label and does not translate or invent the headline's meaning.
 */
export function normalizeEvidenceLeadForChineseSentence(value: unknown): string {
  const text = asText(value).replace(/\s+/g, ' ').replace(/[。；;，,!?！？]+$/g, '').trim();
  if (!text) return '隔夜市場消息與台股現貨訊號';
  const latinWords = text.match(/\b[A-Za-z][A-Za-z'-]*\b/g) || [];
  const hasChinese = /[\u3400-\u9fff]/.test(text);
  if (!hasChinese && latinWords.length >= 3) return '隔夜市場消息與台股現貨訊號';
  return text.slice(0, 28);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isTraceableNewsEvidence(row: JsonRecord): boolean {
  return /^https?:\/\//i.test(asText(row.url))
    && asText(row.source).length >= 2
    && Boolean(Date.parse(asText(row.published_at)));
}

/**
 * Preserve an explicit Taiwan transmission in the canonical report contract.
 * When the model omits it, only promote a traceable, already-normalized Taiwan
 * impact statement from fresh news evidence. This does not infer a new thesis.
 */
export function deriveEvidenceBackedTaiwanTransmission(
  aiValue: unknown,
  importantNewsValue: unknown,
): string {
  const ai = asRecord(aiValue);
  const note = asRecord(ai.member_research_note_v2);
  const existing = firstText(ai.taiwan_transmission, note.taiwan_transmission);
  if (existing.length >= 12) return existing;

  const evidence = asRecords(importantNewsValue).find((row) => {
    const impact = firstText(row.taiwan_impact_summary);
    return impact.length >= 12 && isTraceableNewsEvidence(row);
  });
  if (!evidence) return '';

  const impact = firstText(evidence.taiwan_impact_summary).replace(/\s+/g, ' ').trim();
  return `${impact}；盤中以 TAIEX、2330 與相關族群量價同步驗證。`;
}

const OPTIONAL_DECISION_SOURCE_GAP = /^(?:unavailable_market_data:)?TXF:no_authorized_source_or_contract_mapping$/i;
const OPTIONAL_NO_TRADE_CONTEXT_GAP = /^sector_rotation_scores:\d{4}-\d{2}-\d{2}$/i;

export function isDecisionCriticalMissingSource(
  source: string,
  mode: 'recommendations' | 'no_trade',
): boolean {
  return !OPTIONAL_DECISION_SOURCE_GAP.test(source)
    && !(mode === 'no_trade' && OPTIONAL_NO_TRADE_CONTEXT_GAP.test(source));
}

function declaredMissingSources(ai: JsonRecord): string[] {
  const detail = asRecord(ai.data_quality_detail);
  return unique([
    ai.missing_sources,
    detail.missing_sources,
  ].flatMap((value) => Array.isArray(value) ? value.map((item) => asText(item)) : []));
}

function hasAuditableCurrentEvidence(ai: JsonRecord): boolean {
  const evidenceQuality = asRecord(ai.content_evidence_quality);
  if (asText(evidenceQuality.contract_version) !== 'PREMIUM_EVIDENCE_V1') return false;
  const verifiedNewsCount = Math.max(0, Number(evidenceQuality.verified_news_count) || 0);
  const verifiedMarketCount = Math.max(0, Number(evidenceQuality.verified_market_count) || 0);
  return verifiedNewsCount + verifiedMarketCount > 0
    && (verifiedNewsCount === 0 || evidenceQuality.all_news_traceable === true)
    && Math.max(0, Number(evidenceQuality.blank_market_change_count) || 0) === 0;
}

function hasCompleteDecisionEvidence(
  ai: JsonRecord,
  mode: 'recommendations' | 'no_trade',
): boolean {
  if (!hasAuditableCurrentEvidence(ai)) return false;
  if (mode === 'no_trade') {
    const observations = asRecords(ai.v10_observation_watchlist);
    return observations.length >= 3 && observations.every(hasSpecificSource);
  }
  const recommendations = recommendationRows(ai);
  return recommendations.length > 0
    && recommendations.every(hasSpecificSource)
    && recommendationFieldCoverage(
      recommendations,
      ['transmission_logic', 'reason_chain', 'causal_chain', 'reason', 'why_this_stock'],
      24,
    )
    && recommendationFieldCoverage(
      recommendations,
      ['taiwan_supply_chain_link', 'supply_chain_relationship', 'company_relationship', 'why_this_stock'],
      12,
    )
    && recommendationFieldCoverage(
      recommendations,
      ['intraday_validation', 'validation_signal', 'confirmation_signal', 'watch_point'],
      12,
    )
    && recommendationFieldCoverage(
      recommendations,
      ['invalidation_condition', 'not_buy_signal', 'risk_note', 'risk'],
      12,
    );
}

/**
 * TXF is an important confirmation source, not a critical cash-market dependency.
 * A declared entitlement gap may stay visible in either decision mode when every
 * other missing-source entry is absent. Recommendation evidence still has to pass
 * the per-stock traceability, transmission and invalidation gates.
 */
export function hasDecisionGradeSourceCoverage(
  aiValue: unknown,
  mode: 'recommendations' | 'no_trade',
): boolean {
  const ai = asRecord(aiValue);
  if (asText(ai.data_quality).toLowerCase() === 'complete') return true;
  const missingSources = declaredMissingSources(ai);
  const completeDecisionEvidence = hasCompleteDecisionEvidence(ai, mode);
  if (missingSources.length === 0) return completeDecisionEvidence;
  return missingSources.every((source) => {
    if (!isDecisionCriticalMissingSource(source, mode)) return true;
    return OPTIONAL_NO_TRADE_CONTEXT_GAP.test(source) && completeDecisionEvidence;
  });
}

function recommendationRows(ai: JsonRecord): JsonRecord[] {
  const v10 = asRecords(ai.today_beneficiary_stocks_v10);
  if (ai.v10_beneficiary_enabled === true || String(ai.v10_beneficiary_enabled).toLowerCase() === 'true') {
    return v10;
  }
  if (v10.length > 0) return v10;
  const today = asRecords(ai.today_beneficiary_stocks);
  return today.length > 0 ? today : asRecords(ai.beneficiary_stocks);
}

function sourceText(row: JsonRecord): string {
  const arraySources = [
    row.data_basis,
    row.source_refs,
    row.source_signals,
    row.evidence,
    row.evidence_inputs,
    row.supporting_evidence,
  ].flatMap((value) => Array.isArray(value) ? value : []);
  return firstText(
    row.data_basis,
    row.evidence_source,
    row.source_reference,
    row.source,
    ...arraySources,
  );
}

function hasSpecificSource(row: JsonRecord): boolean {
  const source = sourceText(row);
  return source.length >= 8
    && !/市場數據綜合判斷|情境觸發|綜合研判|未提供|unknown|existing_beneficiary_stock/i.test(source)
    && /https?:\/\/|\b(?:MD|NEWS|SEC|VAL)\d{3}\b|market_data[:.]|sector_rotation_scores[:.]|reports:/i.test(source);
}

function recommendationFieldCoverage(rows: JsonRecord[], keys: string[], minimumLength: number): boolean {
  return rows.length > 0 && rows.every((row) => firstText(...keys.map((key) => row[key])).length >= minimumLength);
}

function getDailySentence(ai: JsonRecord): string {
  const v8 = asRecord(ai.v8_daily_sentence);
  const free = asRecord(ai.free_summary);
  return firstText(ai.today_quote, v8.sentence, ai.daily_sentence, free.one_sentence, free.summary);
}

function getReasons(ai: JsonRecord): unknown[] {
  const note = asRecord(ai.member_research_note_v2);
  const thesis = asRecord(ai.market_thesis);
  const candidates = [
    thesis.reasons,
    note.key_reasons,
    ai.key_drivers,
    ai.reasoning_chain,
  ];
  return candidates.find(Array.isArray) as unknown[] || [];
}

function getSectors(ai: JsonRecord): unknown[] {
  const candidates = [ai.preferred_sectors, ai.watch_sectors_detailed, ai.watch_sectors];
  return candidates.find(Array.isArray) as unknown[] || [];
}

function hasConcreteMarker(text: string): boolean {
  return /(?:\d{2,4}(?:\.\d+)?%?|09:30|10:30|13:00|台指期|台積電|費半|SOX|NASDAQ|S&P|NVIDIA|NVDA|TSM|美債|美元|半導體|金融|航運|AI)/i.test(text);
}

const CONCRETE_MARKER_PATTERNS = [
  /\d{1,2}:\d{2}/,
  /[+-]?\d+(?:\.\d+)?%/,
  /(?:加權指數|TAIEX)/i,
  /(?:台指期|TXF)/i,
  /(?:台積電|2330|TSM(?:C)?)/i,
  /(?:費半|SOX|NASDAQ|S&P|NVIDIA|NVDA)/i,
  /(?:金融|半導體|航運|AI\s*伺服器|電子權值|成交量|量價)/i,
  /(?:美元|美債|殖利率|原油|VIX)/i,
];

/**
 * A conversion-grade daily sentence is a compact decision contract, not a
 * status label. It must tell a reader what the evidence is, what to do now,
 * when to re-check, and what observable condition changes the decision.
 */
export function evaluateDecisionSentenceValue(
  value: unknown,
  options: { require_checkpoint?: boolean } = {},
): DecisionSentenceValueResult {
  const sentence = asText(value).replace(/\s+/g, ' ').trim();
  const requireCheckpoint = options.require_checkpoint !== false;
  const concreteMarkerCount = CONCRETE_MARKER_PATTERNS
    .filter((pattern) => pattern.test(sentence))
    .length;
  const hasAction = /(?:不追價|不建立|不進場|不擴大|不把.{0,12}列為|撤回|停止|降低曝險|保留現金|依(?:原定)?計畫執行|只做|確認後才|成立後才)/.test(sentence);
  const hasCheckpoint = /\b(?:09:00|09:30|10:30|13:00|14:10|14:30)\b/.test(sentence);
  const hasChangeCondition = /(?:若|如果|只有|除非|一旦|未.{0,18}前|確認後才|成立後才|失效就|否則)/.test(sentence);
  const genericWaitOnly = /^(?:今日)?(?:暫不|先不|現在不要)?追價[，,\s]*(?:等待|持續等待)(?:關鍵條件)?驗證[。.]?$/.test(sentence)
    || /^(?:等待|持續等待)(?:關鍵條件)?確認[。.]?$/.test(sentence);
  const malformedLanguage = /(?:若\s*){2,}|(?:如果\s*){2,}|不再支(?=[，,。；;])/u.test(sentence);
  const flags: string[] = [];
  if (sentence.length < 36) flags.push('daily_sentence_too_thin');
  if (genericWaitOnly) flags.push('generic_wait_only');
  if (malformedLanguage) flags.push('daily_sentence_language_malformed');
  if (concreteMarkerCount < 2) flags.push('daily_sentence_evidence_density_low');
  if (!hasAction) flags.push('daily_sentence_action_missing');
  if (requireCheckpoint && !hasCheckpoint) flags.push('daily_sentence_checkpoint_missing');
  if (!hasChangeCondition) flags.push('daily_sentence_change_condition_missing');
  return {
    eligible: flags.length === 0,
    flags: unique(flags),
    concrete_marker_count: concreteMarkerCount,
    has_action: hasAction,
    has_checkpoint: hasCheckpoint,
    has_change_condition: hasChangeCondition,
  };
}

export function detectGenericContent(aiValue: unknown): string[] {
  const ai = asRecord(aiValue);
  const note = asRecord(ai.member_research_note_v2);
  const text = [
    getDailySentence(ai),
    firstText(asRecord(ai.free_summary).one_sentence),
    firstText(note.subscriber_value_sentence),
    firstText(note.core_reasoning),
  ].filter(Boolean).join(' ');

  const flags = GENERIC_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ code }) => code);

  if (text && text.length < 20) flags.push('content_too_short');
  if (text && !hasConcreteMarker(text)) flags.push('concrete_market_marker_missing');
  return unique(flags);
}

function gradeForScore(score: number): ContentQualityGrade {
  return gradeContentScore(score, RUNTIME_QUALITY_POLICY) as ContentQualityGrade;
}

export function evaluateContentIntelligence(
  aiValue: unknown,
  _importantNewsCount: number,
): ContentIntelligenceResult {
  const ai = asRecord(aiValue);
  const note = asRecord(ai.member_research_note_v2);
  const recommendations = recommendationRows(ai);
  const observations = asRecords(ai.v10_observation_watchlist);
  const noTradeMode = recommendations.length === 0
    && String(ai.v10_data_quality_status).toLowerCase() === 'insufficient_positive_evidence'
    && observations.length >= 3;
  const decisionSourceCoverage = hasDecisionGradeSourceCoverage(
    ai,
    noTradeMode ? 'no_trade' : 'recommendations',
  );
  const dailySentence = getDailySentence(ai);
  const dailySentenceValue = evaluateDecisionSentenceValue(dailySentence);
  const reasons = getReasons(ai);
  const sectors = getSectors(ai);
  const genericFlags = unique([
    ...detectGenericContent(ai),
    ...dailySentenceValue.flags,
  ]);
  const evidenceQuality = asRecord(ai.content_evidence_quality);
  const hasEvidenceContract = asText(evidenceQuality.contract_version) === 'PREMIUM_EVIDENCE_V1';
  const verifiedNewsCount = hasEvidenceContract
    ? Math.max(0, Number(evidenceQuality.verified_news_count) || 0)
    : 0;
  const verifiedMarketCount = hasEvidenceContract
    ? Math.max(0, Number(evidenceQuality.verified_market_count) || 0)
    : 0;
  const verifiedCatalystCount = verifiedNewsCount + verifiedMarketCount;
  const allNewsTraceable = evidenceQuality.all_news_traceable === true;
  const blankMarketChangeCount = Math.max(0, Number(evidenceQuality.blank_market_change_count) || 0);
  const allSourcesSpecific = recommendations.length > 0
    ? recommendations.every(hasSpecificSource)
    : noTradeMode && observations.every((row) => hasSpecificSource(row));
  const eventCoverage = recommendations.length > 0 && recommendations.every((row) => {
    const eventLabel = firstText(row.trigger_event, row.catalyst, row.event_source);
    const traceableSource = sourceText(row);
    return `${eventLabel} | ${traceableSource}`.trim().length >= 10 && hasSpecificSource(row);
  });
  const transmissionCoverage = recommendationFieldCoverage(
    recommendations,
    ['transmission_logic', 'reason_chain', 'causal_chain', 'reason', 'why_this_stock'],
    24,
  );
  const taiwanCoverage = recommendationFieldCoverage(
    recommendations,
    ['taiwan_supply_chain_link', 'supply_chain_relationship', 'company_relationship', 'why_this_stock'],
    12,
  );
  const confirmationCoverage = recommendationFieldCoverage(
    recommendations,
    ['intraday_validation', 'validation_signal', 'confirmation_signal', 'watch_point'],
    12,
  );
  const invalidationCoverage = recommendationFieldCoverage(
    recommendations,
    ['invalidation_condition', 'not_buy_signal', 'risk_note', 'risk'],
    12,
  );

  const evidence = Math.min(20,
    (verifiedCatalystCount > 0 ? 8 : 0)
    + (allSourcesSpecific ? 8 : 0)
    + (recommendations.length > 0 || noTradeMode ? 4 : 0));
  const freshness = Math.min(15,
    (decisionSourceCoverage ? 10 : 0)
    + (verifiedCatalystCount > 0 && (verifiedNewsCount === 0 || allNewsTraceable) ? 5 : 0));
  const taiwanRelevance = Math.min(15,
    (taiwanCoverage || noTradeMode ? 10 : 0)
    + (firstText(ai.taiwan_transmission, note.taiwan_transmission).length >= 12 || taiwanCoverage ? 5 : 0));
  const specificity = Math.min(10,
    (dailySentenceValue.concrete_marker_count >= 2 ? 6 : 0)
    + (eventCoverage || noTradeMode ? 4 : 0));
  const actionability = Math.min(15,
    (dailySentenceValue.has_action ? 4 : 0)
    + (confirmationCoverage || (noTradeMode && dailySentenceValue.has_checkpoint) ? 6 : 0)
    + (invalidationCoverage || (noTradeMode && dailySentenceValue.has_change_condition) ? 5 : 0));
  const risk = invalidationCoverage || (noTradeMode && dailySentenceValue.has_change_condition) ? 10 : 0;
  const originality = genericFlags.length === 0 ? 5 : Math.max(0, 5 - genericFlags.length * 2);
  const readability = Math.min(10,
    (dailySentence.length >= 20 && dailySentence.length <= 100 ? 4 : 0)
    + (reasons.length <= 3 ? 3 : 0)
    + (sectors.length <= 3 ? 3 : 0));

  const breakdown: ContentScoreBreakdown = {
    evidence,
    freshness,
    taiwan_relevance: taiwanRelevance,
    specificity,
    actionability,
    risk,
    originality,
    readability,
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const reasonCodes: string[] = [];
  if (evidence < 16) reasonCodes.push('evidence_score_low');
  if (freshness < 12) reasonCodes.push('freshness_score_low');
  if (taiwanRelevance < 12) reasonCodes.push('taiwan_relevance_low');
  if (specificity < 8) reasonCodes.push('specificity_score_low');
  if (actionability < 12) reasonCodes.push('actionability_score_low');
  if (risk < 10) reasonCodes.push('risk_definition_incomplete');
  if (recommendations.length > 0 && (!eventCoverage || !transmissionCoverage || !taiwanCoverage || !confirmationCoverage || !invalidationCoverage || !allSourcesSpecific)) {
    reasonCodes.push('recommendation_reasoning_incomplete');
  }
  if (!recommendations.length && !noTradeMode) reasonCodes.push('decision_mode_incomplete');
  if (genericFlags.length > 0) reasonCodes.push('generic_content_detected');
  if (!hasEvidenceContract) reasonCodes.push('evidence_quality_contract_missing');
  if (verifiedCatalystCount < 1) reasonCodes.push('verified_catalyst_evidence_missing');
  if (verifiedNewsCount > 0 && !allNewsTraceable) reasonCodes.push('news_traceability_incomplete');
  if (blankMarketChangeCount > 0) reasonCodes.push('blank_market_change_detected');
  if (score < RUNTIME_QUALITY_POLICY.premium_publish_min) reasonCodes.push('content_score_below_90');

  const grade = gradeForScore(score);
  const hardFailure = reasonCodes.some((reason) => [
    'recommendation_reasoning_incomplete',
    'decision_mode_incomplete',
    'generic_content_detected',
    'evidence_quality_contract_missing',
    'verified_catalyst_evidence_missing',
    'news_traceability_incomplete',
    'blank_market_change_detected',
  ].includes(reason));
  return {
    score,
    grade,
    publishable: score >= RUNTIME_QUALITY_POLICY.premium_publish_min && !hardFailure,
    reason_codes: unique(reasonCodes),
    generic_flags: genericFlags,
    breakdown,
  };
}
