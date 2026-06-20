import type { Report } from '@/types/report';
import type { SupabaseMarketData } from '@/services/marketDataService';

// ==================== TYPES ====================

export interface DataCompletenessResult {
  /** Total core categories (max 6) */
  coreDataHits: number;
  /** Total categories tracked (always 6) */
  totalCategories: number;
  /** Minimum required hits to output clear direction: 4 */
  minRequired: number;
  /** Whether we have enough data */
  isDataSufficient: boolean;
  /** Array of missing category names */
  missingCategories: string[];
  /** Individual category flags */
  hasTSM_NVDA: boolean;
  hasSPX: boolean;
  hasVIX_SOX: boolean;
  hasDXY_US10Y: boolean;
  hasTAIEX_2330: boolean;
  hasMarketNews: boolean;
}

export interface NegativeCheckResult {
  /** Count of negative symbols among NVDA/TSM/SPX */
  negativeCount: number;
  /** Whether any are significantly negative (< -1%) */
  hasSignificantDrop: boolean;
  /** Individual flags */
  nvdaNegative: boolean;
  tsmNegative: boolean;
  spxNegative: boolean;
}

export interface SafeMarketBiasResult {
  /** The safe bias label to display */
  bias: string;
  /** Capped confidence score (max 60 when data insufficient) */
  confidence: number;
  /** Whether data is sufficient for clear directional judgment */
  isDataSufficient: boolean;
  /** Whether TW data specifically is missing */
  isTWDataMissing: boolean;
  /** Whether to allow aggressive/bullish labels */
  allowAggressive: boolean;
  /** Whether to allow any directional bias at all */
  allowDirectional: boolean;
  /** Debug info */
  debug: {
    completeness: DataCompletenessResult;
    negative: NegativeCheckResult;
    confidenceOK: boolean;
    sentimentOK: boolean;
  };
}

// ==================== CONSTANTS ====================

const DATA_INSUFFICIENT_BIAS = '資料不足，暫不判定';
const DATA_INSUFFICIENT_CONFIDENCE_CAP = 60;
const MIN_CORE_CATEGORIES = 4;

// ==================== DATA COMPLETENESS CHECK ====================

/**
 * Check data completeness from report + marketData
 * Core 6 categories:
 * 1. TSM or NVDA
 * 2. SPX
 * 3. VIX or SOX
 * 4. DXY or US10Y
 * 5. TAIEX or 2330
 * 6. Latest market_news
 */
export function checkDataCompleteness(
  report: Report | null,
  marketData?: SupabaseMarketData[] | null,
): DataCompletenessResult {
  if (!report) {
    return {
      coreDataHits: 0,
      totalCategories: 6,
      minRequired: MIN_CORE_CATEGORIES,
      isDataSufficient: false,
      missingCategories: ['報告未生成'],
      hasTSM_NVDA: false,
      hasSPX: false,
      hasVIX_SOX: false,
      hasDXY_US10Y: false,
      hasTAIEX_2330: false,
      hasMarketNews: false,
    };
  }

  // ── Build symbol set from marketData (for supplementary checks) ──
  const mdSymbols = new Set((marketData || []).map((d) => (d.symbol || '').toUpperCase()));

  // 1. TSM or NVDA: check report mentions AND marketData symbols
  const keyDrivers = (report.key_drivers || []).map((d) => d.toLowerCase());
  const canWatch = (report.can_watch || []).map((w) => w.toLowerCase());
  const allMentions = [...keyDrivers, ...canWatch].join(' ');
  const hasTSM_NVDA_Report =
    allMentions.includes('tsm') ||
    allMentions.includes('nvda') ||
    allMentions.includes('nvidia') ||
    allMentions.includes('台積電') ||
    allMentions.includes('輝達');
  const hasTSM_NVDA_MD = mdSymbols.has('TSM') || mdSymbols.has('NVDA');
  const hasTSM_NVDA = hasTSM_NVDA_Report || hasTSM_NVDA_MD;

  // 2. SPX: check report field AND marketData
  const hasSPX_Report = report.sp500_change !== null && report.sp500_change !== undefined;
  const hasSPX_MD = mdSymbols.has('SPX');
  const hasSPX = hasSPX_Report || hasSPX_MD;

  // 3. VIX or SOX: check report fields AND marketData
  const hasVIX_SOX_Report =
    (report.vix !== null && report.vix !== undefined) ||
    (report.sox_change !== null && report.sox_change !== undefined);
  const hasVIX_SOX_MD = mdSymbols.has('VIX') || mdSymbols.has('SOX');
  const hasVIX_SOX = hasVIX_SOX_Report || hasVIX_SOX_MD;

  // 4. DXY or US10Y: check report fields AND marketData
  const hasDXY_US10Y_Report =
    (report.dxy !== null && report.dxy !== undefined) ||
    (report.us_bond_yield !== null && report.us_bond_yield !== undefined);
  const hasDXY_US10Y_MD = mdSymbols.has('DXY') || mdSymbols.has('US10Y');
  const hasDXY_US10Y = hasDXY_US10Y_Report || hasDXY_US10Y_MD;

  // 5. TAIEX or 2330: check report field AND marketData
  const hasTAIEX_2330_Report =
    (report.taiex_futures_change !== null && report.taiex_futures_change !== undefined);
  const hasTAIEX_2330_MD = mdSymbols.has('TAIEX') || mdSymbols.has('2330');
  const effectiveHasTAIEX_2330 = hasTAIEX_2330_Report || hasTAIEX_2330_MD;

  // 6. Market news: check report fields
  const hasMarketNews =
    (report.important_news_json !== null &&
      report.important_news_json !== undefined &&
      Array.isArray(report.important_news_json) &&
      report.important_news_json.length > 0) ||
    (report.summary !== null && report.summary !== undefined && report.summary.length > 20);

  // Count hits
  const checks: [boolean, string][] = [
    [hasTSM_NVDA, 'TSM/NVDA 數據'],
    [hasSPX, 'SPX 數據'],
    [hasVIX_SOX, 'VIX/SOX 數據'],
    [hasDXY_US10Y, 'DXY/US10Y 數據'],
    [effectiveHasTAIEX_2330, 'TAIEX/2330 數據'],
    [hasMarketNews, '市場新聞數據'],
  ];

  const coreDataHits = checks.filter(([hit]) => hit).length;
  const missingCategories = checks.filter(([hit]) => !hit).map(([, name]) => name);

  return {
    coreDataHits,
    totalCategories: 6,
    minRequired: MIN_CORE_CATEGORIES,
    isDataSufficient: coreDataHits >= MIN_CORE_CATEGORIES,
    missingCategories,
    hasTSM_NVDA,
    hasSPX,
    hasVIX_SOX,
    hasDXY_US10Y,
    hasTAIEX_2330: effectiveHasTAIEX_2330,
    hasMarketNews,
  };
}

// ==================== NEGATIVE CHECK ====================

/**
 * Check if NVDA/TSM/SPX have negative changes
 * Uses report fallback values + marketData
 */
export function checkNegativeData(
  report: Report | null,
  marketData?: SupabaseMarketData[] | null,
): NegativeCheckResult {
  let nvdaChange: number | null = null;
  let tsmChange: number | null = null;
  let spxChange: number | null = null;

  // From report fields
  spxChange = report?.sp500_change ?? null;

  // From marketData
  if (marketData) {
    const nvda = marketData.find((d) => d.symbol === 'NVDA');
    const tsm = marketData.find((d) => d.symbol === 'TSM');
    const spx = marketData.find((d) => d.symbol === 'SPX');
    if (nvda) nvdaChange = Number(nvda.change_percent) || 0;
    if (tsm) tsmChange = Number(tsm.change_percent) || 0;
    if (spx) spxChange = Number(spx.change_percent) || 0;
  }

  // From report: nasdaq_change could proxy for NVDA (imperfect but better than nothing)
  if (nvdaChange === null && report?.nasdaq_change !== null && report?.nasdaq_change !== undefined) {
    // Use nasdaq as proxy only if we don't have direct NVDA data
    // But we still mark nvdaNegative based on the Nasdaq direction as a rough indicator
    nvdaChange = report.nasdaq_change;
  }

  const nvdaNegative = nvdaChange !== null && nvdaChange < -0.05;
  const tsmNegative = tsmChange !== null && tsmChange < -0.05;
  const spxNegative = spxChange !== null && spxChange < -0.05;

  const negativeCount = [nvdaNegative, tsmNegative, spxNegative].filter(Boolean).length;
  const hasSignificantDrop =
    (nvdaChange !== null && nvdaChange < -1) ||
    (tsmChange !== null && tsmChange < -1) ||
    (spxChange !== null && spxChange < -1);

  return {
    negativeCount,
    hasSignificantDrop,
    nvdaNegative,
    tsmNegative,
    spxNegative,
  };
}

// ==================== MAIN SAFE BIAS FUNCTION ====================

/**
 * Get a safe market bias judgment that prevents overly optimistic
 * displays when data is insufficient.
 *
 * Rules:
 * - If core data < 4 categories → data insufficient
 * - If TAIEX + 2330 both missing → no 強勢偏多, even if US stocks are up
 * - If NVDA/TSM/SPX have ≥ 2 negative → no 強勢偏多
 * - If confidence_score < 70, even if sentiment_score high → no 強勢偏多
 */
export function getSafeMarketBias(
  report: Report | null,
  marketData?: SupabaseMarketData[] | null,
): SafeMarketBiasResult {
  if (!report) {
    return {
      bias: '尚未生成報告',
      confidence: 0,
      isDataSufficient: false,
      isTWDataMissing: true,
      allowAggressive: false,
      allowDirectional: false,
      debug: {
        completeness: checkDataCompleteness(null),
        negative: { negativeCount: 0, hasSignificantDrop: false, nvdaNegative: false, tsmNegative: false, spxNegative: false },
        confidenceOK: false,
        sentimentOK: false,
      },
    };
  }

  const completeness = checkDataCompleteness(report, marketData);
  const negative = checkNegativeData(report, marketData);

  const rawBias = report.market_bias || '觀察中';
  const rawConfidence = report.confidence_score ?? 0;
  const rawSentiment = report.sentiment_score ?? rawConfidence;

  // Rule: confidence_score < 70 can't be 強勢偏多
  const confidenceOK = rawConfidence >= 70;

  // Rule: sentimentOK if not conflicting severely
  const sentimentOK = !(rawConfidence < 70 && rawSentiment >= 85);

  // Build safe bias
  let bias = rawBias;
  let confidence = rawConfidence;
  let isDataSufficient = completeness.isDataSufficient;
  let isTWDataMissing = !completeness.hasTAIEX_2330;
  let allowAggressive = true;
  let allowDirectional = true;

  // Rule 1: Data completeness < 4 categories → insufficient
  if (!completeness.isDataSufficient) {
    bias = DATA_INSUFFICIENT_BIAS;
    confidence = Math.min(confidence, DATA_INSUFFICIENT_CONFIDENCE_CAP);
    isDataSufficient = false;
    allowAggressive = false;
    allowDirectional = false;
  }

  // Rule 2: TAIEX + 2330 both missing → no 強勢偏多
  if (isTWDataMissing && bias.includes('強勢偏多')) {
    bias = '美股科技股偏強，但台股本地資料不足';
    confidence = Math.min(confidence, DATA_INSUFFICIENT_CONFIDENCE_CAP);
    allowAggressive = false;
  }

  // Also for 偏多 when TW data missing
  if (isTWDataMissing && (bias.includes('偏多') && !bias.includes('偏空') && !bias.includes('資料不足'))) {
    bias = '美股科技股偏強，但台股本地資料不足，暫不做完整盤前結論';
    confidence = Math.min(confidence, DATA_INSUFFICIENT_CONFIDENCE_CAP);
    allowDirectional = false;
  }

  // Rule 3: Negative data rule - NVDA/TSM/SPX have ≥ 2 negative → no 強勢偏多
  if (negative.negativeCount >= 2 && (bias.includes('強勢偏多') || bias.includes('偏多') && !bias.includes('偏空'))) {
    bias = '市場偏弱 · 觀察中 · 保守模式';
    confidence = Math.min(confidence, 55);
    allowAggressive = false;
    allowDirectional = false;
  }

  // Rule 4: Significant drop (< -1%)
  if (negative.hasSignificantDrop && bias.includes('偏多') && !bias.includes('偏空')) {
    bias = '市場偏弱 · 觀察中 · 保守模式';
    confidence = Math.min(confidence, 50);
    allowAggressive = false;
    allowDirectional = false;
  }

  // Rule 5: confidence_score < 70 → no 強勢偏多
  if (!confidenceOK && bias.includes('強勢偏多')) {
    bias = 'AI 把握度不足，僅作觀察參考';;
    confidence = Math.min(confidence, DATA_INSUFFICIENT_CONFIDENCE_CAP);
    allowAggressive = false;
  }

  // Rule 6: sentiment_score conflicting
  if (!sentimentOK) {
    bias = 'AI 把握度不足，僅作觀察參考';;
    confidence = Math.min(confidence, DATA_INSUFFICIENT_CONFIDENCE_CAP);
    allowAggressive = false;
    allowDirectional = false;
  }

  return {
    bias,
    confidence,
    isDataSufficient,
    isTWDataMissing,
    allowAggressive,
    allowDirectional,
    debug: {
      completeness,
      negative,
      confidenceOK,
      sentimentOK,
    },
  };
}

// ==================== DISPLAY HELPERS ====================

/**
 * Get the strategy mode label based on safe bias
 */
export function getSafeStrategyLabel(
  allowAggressive: boolean,
  allowDirectional: boolean,
): { mode: string; label: string; labelEn: string } {
  if (!allowDirectional) {
    return { mode: 'observe', label: '觀察模式', labelEn: 'OBSERVE ONLY' };
  }
  if (!allowAggressive) {
    return { mode: 'cautious', label: '謹慎模式', labelEn: 'CAUTIOUS' };
  }
  return { mode: 'active', label: '活躍模式', labelEn: 'ACTIVE' };
}

/**
 * Get a safe headline for the home page snapshot
 */
export function getSafeHomeHeadline(
  result: SafeMarketBiasResult,
  report: Report | null,
): {
  headline: string;
  subline: string;
  showScore: boolean;
  displayScore: number;
} {
  if (!report) {
    return {
      headline: '今日報告尚未產生',
      subline: 'Morning Alpha 每天 07:30 自動生成當日報告。',
      showScore: false,
      displayScore: 0,
    };
  }

  if (!result.isDataSufficient) {
    return {
      headline: '資料不足，今日盤前暫不判定',
      subline: `目前只取得部分美股與 ADR 資料（核心資料命中 ${result.debug.completeness.coreDataHits}/6 類），台股核心資料尚未完整，不輸出強勢方向。`,
      showScore: true,
      displayScore: Math.min(result.confidence, 60),
    };
  }

  if (result.isTWDataMissing) {
    return {
      headline: '美股科技股偏強，但台股本地資料不足，暫不做完整盤前結論',
      subline: `缺少類別：${result.debug.completeness.missingCategories.join('、')}。等待台股核心資料補齊。`,
      showScore: true,
      displayScore: Math.min(result.confidence, 60),
    };
  }

  if (!result.allowAggressive && result.allowDirectional) {
    return {
      headline: `盤前訊號：${result.bias}，劇本成立度 ${result.confidence} 分`,
      subline: '目前僅作資訊觀察，不作完整盤勢結論。',
      showScore: true,
      displayScore: result.confidence,
    };
  }

  return {
    headline: `盤前訊號：${result.bias}，劇本成立度 ${result.confidence} 分`,
    subline: '',
    showScore: true,
    displayScore: result.confidence,
  };
}

/**
 * Get the AI Strategist opening text
 */
export function getSafeStrategistOpening(
  result: SafeMarketBiasResult,
): {
  marketDirection: string;
  observableDirection: string;
  riskReminder: string;
} {
  if (!result.isDataSufficient) {
    return {
      marketDirection: '資料不足，暫不判定',
      observableDirection: '美股科技股與 ADR 走勢',
      riskReminder: '台股本地資料缺失，不能直接推論今日台股開盤方向',
    };
  }

  if (result.isTWDataMissing) {
    return {
      marketDirection: '資料不足，暫不判定',
      observableDirection: '美股科技股與 ADR 走勢',
      riskReminder: '台股本地資料缺失，不能直接推論今日台股開盤方向',
    };
  }

  if (!result.allowAggressive) {
    return {
      marketDirection: result.bias,
      observableDirection: '觀察權值股與主流族群動向',
      riskReminder: '市場訊號偏弱，建議以防守觀察為主',
    };
  }

  return {
    marketDirection: result.bias,
    observableDirection: '權值股與主流族群',
    riskReminder: '開盤後確認動能延續性',
  };
}

/**
 * Get the War Room attack direction label
 */
export function getSafeWarRoomAttackLabel(result: SafeMarketBiasResult): {
  showAttackDirections: boolean;
  attackLabel: string;
  attackReason: string;
} {
  if (!result.isDataSufficient || result.isTWDataMissing) {
    return {
      showAttackDirections: false,
      attackLabel: '今日暫不列攻擊方向',
      attackReason: '台股本地資料不足，尚未形成可靠進攻劇本。',
    };
  }

  if (!result.allowAggressive) {
    return {
      showAttackDirections: false,
      attackLabel: '今日暫不列攻擊方向',
      attackReason: '市場訊號偏弱，建議以防守觀察為主。',
    };
  }

  return {
    showAttackDirections: true,
    attackLabel: '今日攻擊方向',
    attackReason: '',
  };
}