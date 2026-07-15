/**
 * Intraday Bias Service — Shared across all frontend pages
 *
 * Centralizes:
 * 1. TAIEX threshold-based intraday status labels
 * 2. TXF/2330-aware data trust labels
 * 3. Time-based hero text switching
 * 4. Confidence score capping when data incomplete
 */

// ════════════════════════════════════════════
// TAIEX Threshold Constants
// ════════════════════════════════════════════

const TAIEX_WEAK_DROP = -1.00;
const TAIEX_MILD_WEAK = -0.30;
const TAIEX_MILD_STRONG = 0.30;

export type IntradayBiasLevel = 'weak_drop' | 'mild_weak' | 'range_bound' | 'mild_strong' | 'strong';

export interface IntradayBiasResult {
  stateLabel: string;
  mainText: string;
  statusColor: 'red' | 'amber' | 'gray' | 'green';
  biasLevel: IntradayBiasLevel;
}

/**
 * Determine intraday bias purely from TAIEX change percentage.
 * This is the numeric threshold version — does NOT look at radar_status strings.
 */
export function getIntradayBias(taiexChange: number | null | undefined): IntradayBiasResult {
  if (taiexChange === null || taiexChange === undefined) {
    return {
      stateLabel: '觀察中',
      mainText: '盤中資料不足，暫不判斷方向。',
      statusColor: 'gray',
      biasLevel: 'range_bound',
    };
  }

  if (taiexChange <= TAIEX_WEAK_DROP) {
    return {
      stateLabel: '盤中轉弱',
      mainText: '台股盤中明顯轉弱，先以風險控管為主，不追空也不急著接刀。',
      statusColor: 'green',
      biasLevel: 'weak_drop',
    };
  }

  if (taiexChange <= TAIEX_MILD_WEAK) {
    return {
      stateLabel: '偏弱觀察',
      mainText: '台股盤中偏弱，短線先觀察賣壓是否擴散，不宜過早判定反彈成立。',
      statusColor: 'green',
      biasLevel: 'mild_weak',
    };
  }

  if (taiexChange < TAIEX_MILD_STRONG) {
    return {
      stateLabel: '震盪觀察',
      mainText: '台股盤中仍在震盪區間，暫無明確多空方向。等待台積電與台指期出現一致性訊號後再判斷。',
      statusColor: 'amber',
      biasLevel: 'range_bound',
    };
  }

  return {
    stateLabel: '偏強觀察',
    mainText: '台股盤中轉強，但仍需確認台積電、台指期與半導體族群是否同步補上。',
    statusColor: 'red',
    biasLevel: 'mild_strong',
  };
}

// ════════════════════════════════════════════
// Data Trust (TXF/2330-aware)
// ════════════════════════════════════════════

export type DataTrustLevel = 'complete' | 'partial' | 'insufficient';

export interface DataTrustLabelResult {
  label: string;
  level: DataTrustLevel;
  missingItems: string[];
}

export interface DataTrustParams {
  hasFreshTaiex: boolean;
  hasFreshTxf: boolean;
  hasFreshTsmc: boolean;
  isWeekend: boolean;
}

/**
 * Determine data trust label based on TXF/2330 freshness.
 *
 * Rules:
 * - All 3 core data present today → 資料完整
 * - TAIEX present, but TXF or 2330 missing → 資料部分完整
 * - Only TAIEX, both TXF and 2330 missing → 資料不足
 */
export function getIntradayDataTrust(params: DataTrustParams): DataTrustLabelResult {
  const { hasFreshTaiex, hasFreshTxf, hasFreshTsmc, isWeekend } = params;
  const missing: string[] = [];

  if (!hasFreshTxf) missing.push('TXF');
  if (!hasFreshTsmc) missing.push('2330');
  if (!hasFreshTaiex) missing.push('TAIEX');

  if (isWeekend) {
    return { label: '非交易日', level: 'partial', missingItems: [] };
  }

  if (hasFreshTaiex && hasFreshTxf && hasFreshTsmc) {
    return { label: '資料完整', level: 'complete', missingItems: [] };
  }

  if (hasFreshTaiex && (hasFreshTxf || hasFreshTsmc)) {
    return { label: '資料部分完整', level: 'partial', missingItems: missing };
  }

  if (hasFreshTaiex && !hasFreshTxf && !hasFreshTsmc) {
    return { label: '資料不足', level: 'insufficient', missingItems: missing };
  }

  if (!hasFreshTaiex) {
    return { label: '資料不足', level: 'insufficient', missingItems: missing };
  }

  return { label: '資料不足', level: 'insufficient', missingItems: ['TAIEX'] };
}

// ════════════════════════════════════════════
// Hero Text (Time-based)
// ════════════════════════════════════════════

export interface HeroText {
  title: string;
  subtitle: string;
}

/**
 * Get hero title/subtitle based on Taipei time.
 *
 * 07:30~08:59 → pre-market
 * 09:00~13:30 → intraday
 * After 13:30 → post-market
 */
export function getHeroText(taipeiHour: number, isWeekend: boolean): HeroText {
  if (isWeekend) {
    return {
      title: '今天非交易日，先回看最近一次盤前劇本。',
      subtitle: '每天 07:30 前，整理全球市場、半導體、美股與台股盤前訊號，給你一份可判讀的台股盤前劇本。',
    };
  }

  if (taipeiHour < 9) {
    return {
      title: '今天開盤前，先看盤前劇本站在哪一邊。',
      subtitle: '每天 07:30 前，整理全球市場、半導體、美股與台股盤前訊號，給你一份可判讀的台股盤前劇本。',
    };
  }

  if (taipeiHour < 13 || (taipeiHour === 13 && new Date().getMinutes() < 30)) {
    return {
      title: '現在盤中，先看市場正在驗證哪個劇本。',
      subtitle: '用 TAIEX、台指期、台積電與族群輪動，確認盤前劇本是否成立。',
    };
  }

  return {
    title: '今日收盤後，等待盤後驗證完成。',
    subtitle: '收盤資料同步後，系統會檢查今日盤前劇本與盤中追蹤是否符合實際走勢。',
  };
}

// ════════════════════════════════════════════
// Confidence Cap (Data-incomplete downgrade)
// ════════════════════════════════════════════

export interface ConfidenceCapParams {
  hasFreshTxf: boolean;
  hasFreshTsmc: boolean;
  isWeekend: boolean;
  isHistoricalFallback: boolean;
  newsCount: number;
}

/**
 * Cap intraday confidence score when core data is incomplete.
 *
 * Rules:
 * - All core data present → max 85
 * - TXF or 2330 missing → max 65
 * - Both TXF and 2330 missing → max 55
 */
export function getIntradayConfidenceCap(params: ConfidenceCapParams): {
  maxScore: number;
  label: string;
} {
  const { hasFreshTxf, hasFreshTsmc, isWeekend, isHistoricalFallback, newsCount } = params;

  if (isWeekend || isHistoricalFallback) {
    return { maxScore: 50, label: '非交易日，把握度不適用' };
  }

  if (!hasFreshTxf && !hasFreshTsmc) {
    return { maxScore: 55, label: 'TXF 與 2330 皆缺，把握度上限 55/100' };
  }

  if (!hasFreshTxf || !hasFreshTsmc) {
    return { maxScore: 65, label: '核心資料不完整，把握度上限 65/100' };
  }

  if (newsCount < 3) {
    return { maxScore: 82, label: '新聞量偏少，把握度上限 82/100' };
  }

  return { maxScore: 85, label: '核心資料完整，把握度上限 85/100' };
}

// ════════════════════════════════════════════
// Final Verdict Helper (for /report/today)
// ════════════════════════════════════════════

export interface FinalVerdictResult {
  verdict: string;
  reason: string;
  rhythm: string;
  color: string;
  bg: string;
}

/**
 * Generate Final Verdict text from TAIEX change + data completeness.
 * Used in /report/today Final Verdict section.
 */
export function getFinalVerdict(
  taiexChange: number | null,
  hasFreshTxf: boolean,
  hasFreshTsmc: boolean,
  isAfterMarket: boolean,
  openingRadarSummary: string | null,
): FinalVerdictResult {
  if (taiexChange === null) {
    return {
      verdict: '盤中結論：觀察中',
      reason: '盤中資料不足，暫不判斷方向。',
      rhythm: '等待核心資料補齊後再評估。',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    };
  }

  if (isAfterMarket) {
    return {
      verdict: '今日已收盤，等待盤後驗證完成。',
      reason: '收盤後系統將對今日盤前劇本與盤中追蹤進行驗證。',
      rhythm: '暫不產生今日最終結論，避免使用盤中或昨日資料替代。',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    };
  }

  const dataIssues: string[] = [];
  if (!hasFreshTxf) dataIssues.push('TXF 暫缺');
  if (!hasFreshTsmc) dataIssues.push('2330 非今日即時');
  const dataNote = dataIssues.length > 0 ? `，${dataIssues.join('、')}，盤中判斷需降權處理` : '';

  if (taiexChange <= -1.00) {
    return {
      verdict: '盤中結論：盤中轉弱',
      reason: `TAIEX 盤中明顯轉弱（${taiexChange.toFixed(2)}%）${dataNote}。${openingRadarSummary || ''}`,
      rhythm: '先以風險控管為主，不追空也不急著接刀。',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    };
  }

  if (taiexChange <= -0.30) {
    return {
      verdict: '盤中結論：偏弱觀察',
      reason: `TAIEX 盤中轉弱（${taiexChange.toFixed(2)}%）${dataNote}。${openingRadarSummary || ''}`,
      rhythm: '先降低追價與重倉風險，觀察權值股與台指期是否補上確認訊號。',
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    };
  }

  if (taiexChange < 0.30) {
    return {
      verdict: '盤中結論：震盪觀察',
      reason: `TAIEX 盤中震盪（${taiexChange >= 0 ? '+' : ''}${taiexChange.toFixed(2)}%），未有明確多空方向。`,
      rhythm: '等待台積電與台指期同步確認方向，不躁進。沒有方向時，觀察本身就是一種判斷。',
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    };
  }

  return {
    verdict: '盤中結論：偏強觀察',
    reason: `TAIEX 盤中轉強（+${taiexChange.toFixed(2)}%）${dataNote}。${openingRadarSummary || ''}`,
    rhythm: '觀察權值股與半導體族群是否同步補上確認訊號，不追高。',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
  };
}

// ════════════════════════════════════════════
// After-market helper
// ════════════════════════════════════════════

/**
 * Check if it's after Taiwan market close (13:30).
 * Static version that doesn't import from utils to avoid circular deps.
 */
export function isAfterMarketCloseNow(): boolean {
  const now = new Date();
  const tw = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const hour = tw.getHours();
  const minute = tw.getMinutes();
  return hour > 13 || (hour === 13 && minute >= 30);
}

/**
 * Get current Taipei hour.
 */
export function getTaipeiHour(): number {
  const now = new Date();
  const tw = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return tw.getHours();
}
