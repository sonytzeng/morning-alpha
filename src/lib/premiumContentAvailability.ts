import { getSubscriberReportProjection, type SubscriberReportProjection } from './subscriberReportProjection.ts';

export interface PremiumContentAvailability {
  status: 'eligible' | 'degraded' | 'blocked';
  eligible: boolean;
  marketContentAvailable: boolean;
  decisionMode: 'recommendations' | 'no_trade' | 'blocked';
  reasonCodes: string[];
  memberValueScore: number | null;
  freshNewsCount: number;
}
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function diagnosticNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Compatibility view, not a research evaluator. Preserve the independent
 * server Premium qualification; never infer it from scores, news or stocks.
 * A published market narrative is available independently of Premium/stocks. */
export function resolvePremiumContentAvailability(
  value: unknown,
  suppliedProjection?: SubscriberReportProjection,
): PremiumContentAvailability {
  const projection = suppliedProjection ?? getSubscriberReportProjection(value);
  const outer = asRecord(value);
  const payload = outer.payload === undefined ? outer : asRecord(outer.payload);
  const ai = payload.ai_strategy_json === undefined ? payload : asRecord(payload.ai_strategy_json);
  const explicitStatus = String(ai.premium_content_status ?? '').trim().toLowerCase();
  const memberValueScore = diagnosticNumber(ai.member_value_score);
  const importantNews = Array.isArray(ai.important_news) ? ai.important_news.length : 0;
  const explicitNewsCount = diagnosticNumber(ai.fresh_news_count);
  const freshNewsCount = explicitNewsCount !== null && Number.isInteger(explicitNewsCount) && explicitNewsCount >= 0
    ? explicitNewsCount : importantNews;
  const marketContentAvailable = projection.analysisAvailable;
  const eligible = marketContentAvailable && explicitStatus === 'eligible';
  const decisionMode = projection.recommendation.available ? 'recommendations'
    : marketContentAvailable && projection.recommendation.status === 'NO_QUALIFIED_OPPORTUNITY' ? 'no_trade' : 'blocked';

  return {
    status: eligible ? 'eligible' : explicitStatus === 'degraded' ? 'degraded' : 'blocked',
    eligible,
    marketContentAvailable,
    decisionMode,
    reasonCodes: !marketContentAvailable ? [projection.evidence.status] : eligible ? [] : ['PREMIUM_CONTENT_NOT_ELIGIBLE'],
    memberValueScore,
    freshNewsCount,
  };
}
