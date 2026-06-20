import { supabase } from '@/lib/supabase';

export interface CloseMarketReview {
  id: string;
  report_date: string;
  premarket_bias: string | null;
  premarket_confidence: number | null;
  premarket_summary: string | null;
  opening_radar_status: string | null;
  opening_radar_bias: string | null;
  opening_radar_confidence: number | null;
  opening_radar_summary: string | null;
  actual_market_result: string | null;
  verification_result: string | null;
  verification_label: string | null;
  verification_note: string | null;
  taiex_change: number | null;
  tsmc_change: number | null;
  txf_change: number | null;
  data_quality: string | null;
  missing_data: string | null;
  intraday_correction_success: boolean;
  defensive_call_success: boolean;
  ai_too_bullish: boolean;
  ai_too_bearish: boolean;
  created_at: string;
  updated_at: string;
}

function safeString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

function safeBoolean(val: unknown, fallback = false): boolean {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  if (typeof val === 'number') return val === 1;
  return fallback;
}

export function mapRowToCloseMarketReview(row: Record<string, unknown>): CloseMarketReview {
  return {
    id: String(row.id || ''),
    report_date: String(row.report_date || ''),
    premarket_bias: safeString(row.premarket_bias),
    premarket_confidence: safeNumber(row.premarket_confidence),
    premarket_summary: safeString(row.premarket_summary),
    opening_radar_status: safeString(row.opening_radar_status),
    opening_radar_bias: safeString(row.opening_radar_bias),
    opening_radar_confidence: safeNumber(row.opening_radar_confidence),
    opening_radar_summary: safeString(row.opening_radar_summary),
    actual_market_result: safeString(row.actual_market_result),
    verification_result: safeString(row.verification_result),
    verification_label: safeString(row.verification_label),
    verification_note: safeString(row.verification_note),
    taiex_change: safeNumber(row.taiex_change),
    tsmc_change: safeNumber(row.tsmc_change),
    txf_change: safeNumber(row.txf_change),
    data_quality: safeString(row.data_quality),
    missing_data: safeString(row.missing_data),
    intraday_correction_success: safeBoolean(row.intraday_correction_success),
    defensive_call_success: safeBoolean(row.defensive_call_success),
    ai_too_bullish: safeBoolean(row.ai_too_bullish),
    ai_too_bearish: safeBoolean(row.ai_too_bearish),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

/**
 * 取得最新一筆盤後驗證（以 report_date desc 排序）
 */
export async function getLatestCloseMarketReview(): Promise<CloseMarketReview | null> {
  const { data, error } = await supabase
    .from('close_market_reviews')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getLatestCloseMarketReview error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToCloseMarketReview(data as Record<string, unknown>);
}

/**
 * 取得最近 N 筆盤後驗證（以 report_date desc 排序）
 */
export async function getRecentCloseMarketReviews(limit = 7): Promise<CloseMarketReview[]> {
  const { data, error } = await supabase
    .from('close_market_reviews')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('getRecentCloseMarketReviews error:', error.message);
    return [];
  }

  return (data || []).map((row) => mapRowToCloseMarketReview(row as Record<string, unknown>));
}

/**
 * 依 report_date 取得特定日期的盤後驗證
 */
export async function getCloseMarketReviewByDate(reportDate: string): Promise<CloseMarketReview | null> {
  const { data, error } = await supabase
    .from('close_market_reviews')
    .select('*')
    .eq('report_date', reportDate)
    .maybeSingle();

  if (error) {
    console.error('getCloseMarketReviewByDate error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToCloseMarketReview(data as Record<string, unknown>);
}

/**
 * 取得今日的盤後驗證（依台北日期查詢 close_market_reviews）
 * 只查 report_date === todayDate，不 fallback 到最新一筆或昨日
 */
export async function getTodayCloseMarketReview(): Promise<CloseMarketReview | null> {
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('close_market_reviews')
    .select('*')
    .eq('report_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getTodayCloseMarketReview error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToCloseMarketReview(data as Record<string, unknown>);
}

/**
 * 批量取得多個日期的盤後驗證
 */
export async function getCloseMarketReviewsByDates(reportDates: string[]): Promise<Map<string, CloseMarketReview>> {
  if (reportDates.length === 0) return new Map();

  const { data, error } = await supabase
    .from('close_market_reviews')
    .select('*')
    .in('report_date', reportDates);

  if (error) {
    console.error('getCloseMarketReviewsByDates error:', error.message);
    return new Map();
  }

  const result = new Map<string, CloseMarketReview>();
  for (const row of (data || [])) {
    const review = mapRowToCloseMarketReview(row as Record<string, unknown>);
    result.set(review.report_date, review);
  }
  return result;
}

/**
 * 驗證標籤對應的顯示顏色與樣式（V36: 對應新 validation_result 動態值）
 *
 * 新 validation_result 值：
 *   - 方向一致 / 大致一致 → 綠色（判斷成立）
 *   - 部分命中 / 部分命中，盤前偏保守 / 部分命中，盤前偏積極 → 琥珀色（部分）
 *   - 未命中 → 紅色（失準）
 *   - 資料不足 / 待確認 → 灰色
 */
export function getVerificationLabelStyle(label: string | null | undefined): {
  text: string;
  bg: string;
  border: string;
  icon: string;
  display: string;
} {
  if (!label) {
    return {
      text: 'text-white/30',
      bg: 'bg-white/5',
      border: 'border-white/10',
      icon: 'ri-question-line',
      display: '樣本累積中',
    };
  }

  const normalized = label.trim();

  // ── 綠色：方向一致 / 大致一致 ──
  if (normalized === '方向一致' || normalized === '大致一致' || normalized.includes('方向一致')) {
    return {
      text: 'text-emerald-200',
      bg: 'bg-emerald-500/12',
      border: 'border-emerald-400/40',
      icon: 'ri-check-double-line',
      display: '盤後驗證通過',
    };
  }

  // ── 琥珀色：部分命中 ──
  if (normalized.includes('部分命中')) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      icon: 'ri-contrast-2-line',
      display: normalized,
    };
  }

  // ── 紅色：未命中 ──
  if (normalized === '未命中') {
    return {
      text: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      icon: 'ri-close-circle-line',
      display: '未命中',
    };
  }

  // ── 灰色：資料不足 / 待確認 ──
  if (normalized === '資料不足' || normalized === '待確認') {
    return {
      text: 'text-white/30',
      bg: 'bg-white/5',
      border: 'border-white/10',
      icon: 'ri-question-line',
      display: normalized,
    };
  }

  // ── 向後相容舊值（DB 裡可能還有舊的「命中」「盤前劇本命中」「修正成功」「失準」） ──
  if (normalized === '命中' || normalized === '盤前劇本命中') {
    return {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      icon: 'ri-check-double-line',
      display: '方向一致',
    };
  }

  if (normalized === '修正成功' || normalized === '盤中修正成功') {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      icon: 'ri-loop-left-line',
      display: normalized,
    };
  }

  if (normalized === '失準' || normalized === '盤前失準') {
    return {
      text: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      icon: 'ri-close-circle-line',
      display: '未命中',
    };
  }

  return {
    text: 'text-white/30',
    bg: 'bg-white/5',
    border: 'border-white/10',
    icon: 'ri-question-line',
    display: normalized,
  };
}

// ── Data Consistency Guard ──

export interface RadarSnapshot {
  taiex_change: number | null;
  tsmc_change: number | null;
}

/**
 * 檢查 closeMarketReview 的內容是否與今日 openingRadar 的 TAIEX 方向一致。
 *
 * 防呆場景：資料庫 close_market_reviews 的 report_date 標為今天，
 * 但 actual_market_result / taiex_change 仍是昨日舊資料（例如 TAIEX +2.05%
 * 的今天，卻顯示「高風險下跌、加權 -3.48%」）。
 *
 * @returns true 表示資料一致可顯示，false 表示資料矛盾應阻擋
 */
export function isVerificationConsistentWithRadar(
  cmr: CloseMarketReview,
  radar: RadarSnapshot | null,
): { consistent: boolean; reason: string | null } {
  if (!radar) return { consistent: true, reason: null };

  const radarTaiex = radar.taiex_change;
  const cmrTaiex = cmr.taiex_change;
  const cmrText = (cmr.actual_market_result ?? '');

  // 檢查方向矛盾：今日 TAIEX 上漲，但驗證內容卻說下跌
  const radarUp = radarTaiex !== null && radarTaiex > 0;
  const cmrDown = cmrTaiex !== null && cmrTaiex < 0;
  const cmrTextDown = cmrText.includes('下跌') ||
    cmrText.includes('高風險') ||
    cmrText.includes('-3.48') ||
    cmrText.includes('-2.96');

  if (radarUp && (cmrDown || cmrTextDown)) {
    console.warn('[Morning Alpha] 今日盤後驗證資料不一致 - 已阻擋顯示', {
      todayDate: new Date().toISOString().slice(0, 10),
      verificationDate: cmr.report_date,
      todayTaiexChange: radarTaiex,
      verificationTaiexChange: cmrTaiex,
      verificationText: cmrText,
      verificationResult: cmr.verification_result,
    });
    return {
      consistent: false,
      reason: '系統偵測到驗證內容與今日盤中方向矛盾，已暫停顯示舊收盤結果。',
    };
  }

  return { consistent: true, reason: null };
}

/**
 * 計算驗證統計摘要（V36: 對應新 validation_result 動態值）
 */
export function computeVerificationStats(reviews: CloseMarketReview[]): {
  totalCount: number;
  premarketHitCount: number;
  intradayCorrectionCount: number;
  defensiveCallCount: number;
  aiMistakeCount: number;
  isSufficient: boolean;
} {
  const totalCount = reviews.length;

  if (totalCount === 0) {
    return {
      totalCount: 0,
      premarketHitCount: 0,
      intradayCorrectionCount: 0,
      defensiveCallCount: 0,
      aiMistakeCount: 0,
      isSufficient: false,
    };
  }

  let premarketHitCount = 0;
  let intradayCorrectionCount = 0;
  let defensiveCallCount = 0;
  let aiMistakeCount = 0;

  for (const r of reviews) {
    const vr = (r.verification_result || '').trim();
    const vl = (r.verification_label || '').trim();

    // 方向命中：方向一致 / 大致一致 / 部分命中 / 舊值向後相容
    if (
      vr === '方向一致' ||
      vr === '大致一致' ||
      vr.includes('部分命中') ||
      vr === '盤前劇本命中' ||
      vr === '命中' ||
      vl === '方向一致' ||
      vl === '大致一致' ||
      vl.includes('部分命中') ||
      vl === '盤前劇本命中' ||
      vl === '命中'
    ) {
      premarketHitCount++;
    }

    // 盤中修正成功
    if (
      r.intraday_correction_success ||
      vr === '盤中修正成功' ||
      vl === '修正成功'
    ) {
      intradayCorrectionCount++;
    }

    // 防守日命中
    if (r.defensive_call_success) {
      defensiveCallCount++;
    }

    // 未命中：AI 失準
    if (vr === '未命中' || r.ai_too_bullish || r.ai_too_bearish) {
      aiMistakeCount++;
    }
  }

  return {
    totalCount,
    premarketHitCount,
    intradayCorrectionCount,
    defensiveCallCount,
    aiMistakeCount,
    isSufficient: totalCount >= 3,
  };
}