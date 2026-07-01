import type { Report } from '@/types/report';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { NewsItem } from '@/services/narrativeBuilder';
import {
  getSafeMarketBias,
  checkDataCompleteness,
  checkNegativeData,
  type SafeMarketBiasResult,
  type DataCompletenessResult,
  type NegativeCheckResult,
} from '@/services/safeMarketBias';

// ==================== TYPES ====================

export interface IntelligenceResult {
  // Core labels
  market_direction_label: string;
  confidence_label: string;
  data_quality_label: string;

  // Reasons
  main_reason: string;
  risk_reason: string;

  // Sector guidance
  watch_sectors: string[];
  avoid_sectors: string[];

  // Verdict
  final_verdict: string;

  // Summaries
  short_summary: string;
  homepage_headline: string;
  war_room_summary: string;
  strategist_summary: string;
  report_summary: string;

  // Debug / metadata
  is_data_sufficient: boolean;
  is_tw_data_missing: boolean;
  allow_aggressive: boolean;
  allow_directional: boolean;
  core_data_hits: number;
  core_data_total: number;
  missing_categories: string[];
  raw_bias: string;
  raw_confidence: number;
  safe_bias: string;
  safe_confidence: number;
  negative_major_count: number;
  is_bias_conflict: boolean;
  market_data_count: number;
  news_count: number;
}

// ==================== CONSTANTS ====================

const DATA_INSUFFICIENT_LABEL = '資料不足，暫不判定';
const DATA_INSUFFICIENT_CONFIDENCE_CAP = 60;
const MIN_CORE_CATEGORIES = 4;

// ==================== MAIN ENGINE ====================

/**
 * Morning Alpha Intelligence Engine V1
 *
 * Unified data integration layer that combines:
 *   1. reports (latest daily report)
 *   2. market_data (latest batch)
 *   3. market_news (today's selected news)
 *
 * Produces a single IntelligenceResult used by all frontend pages.
 * No page should have its own judgment logic — they all consume this.
 */
export function generateIntelligence(
  report: Report | null,
  marketData: SupabaseMarketData[] | null,
  marketNews: NewsItem[] | null,
): IntelligenceResult {
  // ==================== NO REPORT ====================
  if (!report) {
    return buildNoReportResult(marketData, marketNews);
  }

  // ==================== COMPUTE SAFE BIAS ====================
  const safeBias: SafeMarketBiasResult = getSafeMarketBias(report, marketData);
  const completeness: DataCompletenessResult = safeBias.debug.completeness;
  const negative: NegativeCheckResult = safeBias.debug.negative;

  // ==================== DATA QUALITY ====================
  const marketDataCount = marketData?.length ?? 0;
  const newsCount = marketNews?.length ?? 0;

  const dataQualityLabel = deriveDataQualityLabel(completeness.coreDataHits, marketDataCount);

  // ==================== BIAS CONFLICT CHECK ====================
  // If report says 強勢偏多 but NVDA/TSM/SPX data is mostly negative → conflict
  const isBiasConflict = checkBiasConflict(report.market_bias, negative);

  // ==================== MARKET DIRECTION LABEL ====================
  const marketDirectionLabel = deriveMarketDirectionLabel(
    safeBias,
    completeness,
    isBiasConflict,
  );

  // ==================== CONFIDENCE LABEL ====================
  const confidenceLabel = deriveConfidenceLabel(safeBias.confidence, safeBias.isDataSufficient);

  // ==================== MAIN REASON ====================
  const mainReason = deriveMainReason(report, safeBias, completeness, negative, marketNews);

  // ==================== RISK REASON ====================
  const riskReason = deriveRiskReason(report, safeBias, completeness, negative);

  // ==================== WATCH / AVOID SECTORS ====================
  const watchSectors = deriveWatchSectors(report, safeBias, marketNews);
  const avoidSectors = deriveAvoidSectors(report, safeBias);

  // ==================== FINAL VERDICT ====================
  const finalVerdict = deriveFinalVerdict(safeBias, completeness, isBiasConflict, negative);

  // ==================== SHORT SUMMARY ====================
  const shortSummary = deriveShortSummary(safeBias, completeness, marketDirectionLabel);

  // ==================== PAGE-SPECIFIC SUMMARIES ====================
  const homepageHeadline = deriveHomepageHeadline(safeBias, completeness, marketDirectionLabel, report);
  const warRoomSummary = deriveWarRoomSummary(safeBias, completeness, isBiasConflict, negative);
  const strategistSummary = deriveStrategistSummary(safeBias, completeness, isBiasConflict, negative);
  const reportSummary = deriveReportSummary(safeBias, completeness, isBiasConflict, negative, report);

  return {
    market_direction_label: marketDirectionLabel,
    confidence_label: confidenceLabel,
    data_quality_label: dataQualityLabel,
    main_reason: mainReason,
    risk_reason: riskReason,
    watch_sectors: watchSectors,
    avoid_sectors: avoidSectors,
    final_verdict: finalVerdict,
    short_summary: shortSummary,
    homepage_headline: homepageHeadline,
    war_room_summary: warRoomSummary,
    strategist_summary: strategistSummary,
    report_summary: reportSummary,
    // Debug
    is_data_sufficient: safeBias.isDataSufficient,
    is_tw_data_missing: safeBias.isTWDataMissing,
    allow_aggressive: safeBias.allowAggressive,
    allow_directional: safeBias.allowDirectional,
    core_data_hits: completeness.coreDataHits,
    core_data_total: completeness.totalCategories || 6,
    missing_categories: completeness.missingCategories,
    raw_bias: report.market_bias || '觀察中',
    raw_confidence: report.confidence_score ?? 0,
    safe_bias: safeBias.bias,
    safe_confidence: safeBias.confidence,
    negative_major_count: negative.negativeCount,
    is_bias_conflict: isBiasConflict,
    market_data_count: marketDataCount,
    news_count: newsCount,
  };
}

// ==================== HELPER: No Report ====================

function buildNoReportResult(
  marketData: SupabaseMarketData[] | null,
  marketNews: NewsItem[] | null,
): IntelligenceResult {
  return {
    market_direction_label: '尚未生成報告',
    confidence_label: '無資料',
    data_quality_label: '報告未生成',
    main_reason: 'Morning Alpha 每天 07:30 自動生成當日報告。',
    risk_reason: '',
    watch_sectors: [],
    avoid_sectors: [],
    final_verdict: '等待今日報告生成',
    short_summary: '今日報告尚未產生，請稍後再查看。',
    homepage_headline: '今日報告尚未產生',
    war_room_summary: '作戰室尚未就緒，每日 07:30 自動更新。',
    strategist_summary: 'AI 策略報告尚未產生，請於 07:30 後回來查看。',
    report_summary: '今日報告尚未產生，每日 07:30 自動生成。',
    is_data_sufficient: false,
    is_tw_data_missing: true,
    allow_aggressive: false,
    allow_directional: false,
    core_data_hits: 0,
    core_data_total: 6,
    missing_categories: ['報告未生成'],
    raw_bias: '—',
    raw_confidence: 0,
    safe_bias: '尚未生成報告',
    safe_confidence: 0,
    negative_major_count: 0,
    is_bias_conflict: false,
    market_data_count: marketData?.length ?? 0,
    news_count: marketNews?.length ?? 0,
  };
}

// ==================== DERIVATION FUNCTIONS ====================

function deriveDataQualityLabel(coreHits: number, marketDataCount: number): string {
  if (coreHits >= 6) return '完整';
  if (coreHits >= 5) return '良好';
  if (coreHits >= 4) return '可接受';
  if (coreHits >= 3) return '不足';
  // Even if core hits are low, if raw market_data has many entries, it might be a data freshness issue
  if (marketDataCount >= 6 && coreHits >= 2) return '部分資料缺失';
  return '嚴重不足';
}

function checkBiasConflict(
  rawBias: string | null | undefined,
  negative: NegativeCheckResult,
): boolean {
  const bias = rawBias || '';
  const isBullishReport = bias.includes('強勢偏多') || bias.includes('偏多');
  const hasNegativeData = negative.negativeCount >= 2 || negative.hasSignificantDrop;

  // Report says bullish but market data is negative → conflict
  return isBullishReport && hasNegativeData;
}

function deriveMarketDirectionLabel(
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  isBiasConflict: boolean,
): string {
  if (!safeBias.isDataSufficient || safeBias.isTWDataMissing) {
    return DATA_INSUFFICIENT_LABEL;
  }

  if (isBiasConflict) {
    return '多空訊號分歧，等待確認';
  }

  if (!safeBias.allowDirectional) {
    return '市場偏弱 · 觀察中';
  }

  if (!safeBias.allowAggressive) {
    return '盤前結構偏弱 · 觀察確認';
  }

  // Map safe bias to display label
  const bias = safeBias.bias;
  if (bias.includes('強勢偏多')) return '盤前結構偏多';
  if (bias.includes('偏多')) return '盤前結構偏多';
  if (bias.includes('偏空') || bias.includes('偏弱')) return '盤前結構偏弱';
  if (bias.includes('震盪')) return '盤前結構震盪';
  if (bias.includes('反彈') || bias.includes('驗證')) return safeBias.bias;
  if (bias.includes('修復') || bias.includes('觀察')) return safeBias.bias;
  return safeBias.bias;
}

function deriveConfidenceLabel(confidence: number, isDataSufficient: boolean): string {
  if (!isDataSufficient) return '資料不足 · 僅供參考';
  if (confidence >= 85) return '高度把握';
  if (confidence >= 70) return '中度把握';
  if (confidence >= 50) return '低度把握';
  return '把握度不足';
}

function deriveMainReason(
  report: Report,
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  negative: NegativeCheckResult,
  marketNews: NewsItem[] | null,
): string {
  if (!safeBias.isDataSufficient) {
    return `核心資料僅命中 ${completeness.coreDataHits}/${completeness.totalCategories || 6} 類，缺少 ${completeness.missingCategories.join('、')}，無法形成完整盤前判斷。`;
  }

  // Check negative semiconductor data
  if (negative.negativeCount >= 2) {
    return 'NVDA/TSM/SPX 多數指標偏弱，半導體承壓，AI 題材需觀察。短線等待確認訊號。';
  }

  if (negative.hasSignificantDrop) {
    return '關鍵指標 NVDA 或 TSM 跌幅超過 1%，半導體族群短線承壓，需觀察後續動能。';
  }

  // Use report key_drivers
  const drivers = report.key_drivers || [];
  if (drivers.length > 0) {
    return `盤前主線：${drivers.slice(0, 3).join('、')}。${safeBias.bias}。`;
  }

  // Fallback: use news categories
  if (marketNews && marketNews.length > 0) {
    const cats = [...new Set(marketNews.map((n) => n.category).filter((c) => c && c !== 'Other'))];
    if (cats.length > 0) {
      return `新聞聚焦：${cats.slice(0, 3).join('、')}。${safeBias.bias}。`;
    }
  }

  return `市場方向：${safeBias.bias}。等待更多資料確認。`;
}

function deriveRiskReason(
  report: Report,
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  negative: NegativeCheckResult,
): string {
  const parts: string[] = [];

  if (!safeBias.isDataSufficient) {
    parts.push('台股本地資料缺失，不能直接推論今日台股開盤方向。');
  }

  if (safeBias.isTWDataMissing) {
    parts.push('台股核心資料（TAIEX/2330/TXF）尚未更新，無法確認台股開盤方向。');
  }

  if (negative.negativeCount >= 2) {
    parts.push('NVDA、TSM、SPX 中多數指標下跌，短線反轉風險升高。');
  } else if (negative.hasSignificantDrop) {
    parts.push('關鍵指標出現明顯跌幅（&lt; -1%），留意開盤後續壓力。');
  }

  // Add report risk_reason if not already covered
  if (report.risk_reason && report.risk_reason.length > 0) {
    const existingText = parts.join(' ');
    if (!existingText.includes(report.risk_reason.slice(0, 20))) {
      parts.push(report.risk_reason);
    }
  }

  // Data quality concern
  if (completeness.missingCategories.length > 0 && completeness.missingCategories.length <= 2) {
    parts.push(`注意：缺少 ${completeness.missingCategories.join('、')}。`);
  }

  return parts.length > 0 ? parts.join(' ') : '目前無明確風險訊號，但仍需遵守停損紀律。';
}

function deriveWatchSectors(
  report: Report,
  safeBias: SafeMarketBiasResult,
  marketNews: NewsItem[] | null,
): string[] {
  const sectors = new Set<string>();

  if (!safeBias.allowDirectional) {
    return [];
  }

  // From report can_watch
  const canWatch = report.can_watch || [];
  canWatch.slice(0, 3).forEach((w) => sectors.add(w));

  // From key_drivers
  const drivers = report.key_drivers || [];
  drivers.slice(0, 2).forEach((d) => sectors.add(d));

  // From news categories (frequency-based)
  if (marketNews && marketNews.length > 0) {
    const catCounts = new Map<string, number>();
    marketNews.forEach((n) => {
      if (n.category && n.category !== 'Other') {
        catCounts.set(n.category, (catCounts.get(n.category) || 0) + 1);
      }
    });
    [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([cat]) => sectors.add(cat));
  }

  return [...sectors].slice(0, 5);
}

function deriveAvoidSectors(
  report: Report,
  safeBias: SafeMarketBiasResult,
): string[] {
  const sectors = new Set<string>();

  const avoidToday = report.avoid_today || [];
  avoidToday.forEach((a) => sectors.add(a));

  const riskFactors = report.risk_factors_json || [];
  riskFactors.forEach((rf) => {
    if (rf.title) sectors.add(rf.title);
  });

  // If semiconductor is weak, add it
  if (!safeBias.allowDirectional && safeBias.debug.negative.negativeCount >= 2) {
    sectors.add('半導體（短線承壓）');
  }

  return [...sectors].slice(0, 5);
}

function deriveFinalVerdict(
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  isBiasConflict: boolean,
  negative: NegativeCheckResult,
): string {
  if (!safeBias.isDataSufficient) {
    return `觀察中 · 資料不足（核心資料 ${completeness.coreDataHits}/${completeness.totalCategories || 6}）。等待台股核心資料補齊後重新評估。`;
  }

  if (safeBias.isTWDataMissing) {
    return '觀察中 · 台股資料不足。美股 ADR 走勢可參考，但不可直接推論台股開盤方向。';
  }

  if (isBiasConflict) {
    return '多空訊號分歧 · 等待確認。報告偏多但實際市場數據偏弱，暫不建立方向性判斷。';
  }

  if (!safeBias.allowDirectional) {
    return '市場偏弱 · 保守觀察。不建議追多，等待止穩訊號。';
  }

  if (!safeBias.allowAggressive) {
    return '盤前結構偏弱 · 觀察確認。可參考但需等開盤驗證。';
  }

  return `${safeBias.bias} · 盤前結構成立。開盤後觀察動能延續性。`;
}

function deriveShortSummary(
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  directionLabel: string,
): string {
  if (!safeBias.isDataSufficient) {
    return `資料不足（${completeness.coreDataHits}/6），暫不判斷方向。`;
  }
  return `${directionLabel}，把握度 ${safeBias.confidence}/100。`;
}

function deriveHomepageHeadline(
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  directionLabel: string,
  _report: Report,
): string {
  if (!safeBias.isDataSufficient) {
    return `資料不足，今日盤前暫不判定（核心資料 ${completeness.coreDataHits}/${completeness.totalCategories || 6}）`;
  }

  if (!safeBias.allowDirectional) {
    return `盤前結構偏弱 · 保守觀察（成立度 ${safeBias.confidence} 分）`;
  }

  return `${directionLabel}，成立度 ${safeBias.confidence} 分`;
}

function deriveWarRoomSummary(
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  isBiasConflict: boolean,
  negative: NegativeCheckResult,
): string {
  if (!safeBias.isDataSufficient || safeBias.isTWDataMissing) {
    return `台股本地資料不足（${completeness.coreDataHits}/${completeness.totalCategories || 6}），尚未形成可靠進攻劇本。等待核心資料補齊。`;
  }

  if (isBiasConflict) {
    return '報告與市場數據矛盾，暫不建立攻擊名單。等待訊號一致後再評估。';
  }

  if (!safeBias.allowAggressive) {
    return '市場訊號偏弱，建議以防守觀察為主。暫不建立攻擊方向。';
  }

  if (negative.negativeCount >= 2) {
    return '美股半導體指標偏弱，今日以防守為主。可觀察避險方向。';
  }

  return `盤前結構：${safeBias.bias}。攻擊方向以新聞熱點與盤前主線為主，開盤後確認動能。`;
}

function deriveStrategistSummary(
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  isBiasConflict: boolean,
  negative: NegativeCheckResult,
): string {
  if (!safeBias.isDataSufficient) {
    return `核心資料不足（${completeness.coreDataHits}/${completeness.totalCategories || 6}），無法判定今日方向。建議以觀察為主，不建倉。`;
  }

  if (safeBias.isTWDataMissing) {
    return '台股核心資料缺失，不能直接推論今日台股開盤方向。目前僅作資訊觀察。';
  }

  if (isBiasConflict) {
    return '多空訊號分歧。報告偏多但數據偏弱，暫不給交易方向。等待確認後再評估。';
  }

  if (!safeBias.allowDirectional) {
    return '市場偏弱，建議輕倉或觀望。今日以風險控管為優先，不追多。';
  }

  if (!safeBias.allowAggressive) {
    return '盤前結構偏弱，可觀察但不建議激進進場。等待開盤後確認動能。';
  }

  if (negative.negativeCount >= 1) {
    return '部分指標偏弱，建議謹慎觀察。確認開盤動能後再進場。';
  }

  return `盤前結構：${safeBias.bias}。若開盤後動能持續，可適度參與主流方向。`;
}

function deriveReportSummary(
  safeBias: SafeMarketBiasResult,
  completeness: DataCompletenessResult,
  isBiasConflict: boolean,
  negative: NegativeCheckResult,
  _report: Report,
): string {
  if (!safeBias.isDataSufficient) {
    return `資料不足（${completeness.coreDataHits}/${completeness.totalCategories || 6}），暫不判定方向。等待台股核心資料補齊。`;
  }

  if (safeBias.isTWDataMissing) {
    return '台股資料缺失，美股 ADR 走勢僅供參考。開盤後以實際台股走勢為準。';
  }

  if (isBiasConflict) {
    return '報告與市場數據矛盾，盤前假設需等開盤驗證。目前以觀察為主。';
  }

  if (!safeBias.allowDirectional) {
    return '市場偏弱，盤前假設：觀察中。開盤後以實際走勢為準，不預設方向。';
  }

  return `盤前假設：${safeBias.bias}（成立度 ${safeBias.confidence}/100）。開盤後驗證方向一致性。`;
}