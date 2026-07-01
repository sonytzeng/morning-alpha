import { getPreviousTradingDay } from '@/utils/tradingDay';
import { supabase } from '@/lib/supabase';

// ── Types ──

export interface SectorRotationItem {
  id: string;
  score_date: string;
  sector: string;
  rotation_score: number;
  direction: string;
  signal_label: string;
  news_score: number | null;
  market_score: number | null;
  global_score: number | null;
  risk_score: number | null;
  confidence_score: number | null;
  leading_symbols: string[] | null;
  summary: string | null;
  generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SectorRotationResult {
  items: SectorRotationItem[];
  scoreDate: string | null;
  totalCount: number;
  rawRowCount: number;
  error: string | null;
  debugInfo: string;
  /** Latest generated_at among today's items (null if no today data) */
  generatedAt: string | null;
}

// ── Safe leading_symbols parser ──

function parseLeadingSymbols(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const strings = raw.filter((v): v is string => typeof v === 'string');
    return strings.length > 0 ? strings : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const strings = parsed.filter((v): v is string => typeof v === 'string');
        return strings.length > 0 ? strings : null;
      }
      return [trimmed];
    } catch {
      const parts = trimmed.split(/[,;，；\s]+/).filter(Boolean);
      return parts.length > 0 ? parts : [trimmed];
    }
  }
  return null;
}

// ── Color mapping for signal labels ──

export function getSignalColor(label: string): {
  text: string;
  bg: string;
  border: string;
  dot: string;
} {
  const l = (label || '').trim();
  if (l.includes('相對抗跌') || l.includes('強勢') || l.includes('偏強')) {
    return {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      dot: 'bg-emerald-400',
    };
  }
  if (l.includes('防守觀察') || l.includes('觀察')) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      dot: 'bg-amber-400',
    };
  }
  if (l.includes('偏弱觀察')) {
    return {
      text: 'text-orange-400',
      bg: 'bg-orange-500/10',
      border: 'border-orange-500/20',
      dot: 'bg-orange-400',
    };
  }
  if (l.includes('避開觀察') || l.includes('弱勢') || l.includes('risk_off')) {
    return {
      text: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
      dot: 'bg-red-400',
    };
  }
  return {
    text: 'text-white/60',
    bg: 'bg-white/5',
    border: 'border-white/10',
    dot: 'bg-white/40',
  };
}

// ── Safe number parser ──

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function safeStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function safeStrOrNull(v: unknown): string | null {
  const s = safeStr(v);
  return s.length > 0 ? s : null;
}

// ── Map direction to display text ──

function mapDirection(direction: string, signalLabel: string): string {
  const d = (direction || '').trim().toLowerCase();
  if (d === 'relative_strength') return '相對抗跌';
  if (d === 'defensive_watch') return '防守觀察';
  if (d === 'weak') return '偏弱觀察';
  if (d === 'risk_off') return '避開觀察';
  // Fallback: use signal_label as direction display
  return signalLabel || direction || '';
}

// ── Fetch sector rotation scores (two-step query to avoid date/timestamp mismatch) ──

export async function fetchSectorRotationScores(): Promise<SectorRotationResult> {
  try {
    console.log('[sectorRotation] Step 1: finding latest score_date...');

    // ── Step 1: get the latest score_date ──
    const { data: latestRow, error: latestErr } = await supabase
      .from('sector_rotation_scores')
      .select('score_date')
      .order('score_date', { ascending: false })
      .limit(1);

    if (latestErr) {
      console.error('[sectorRotation] Latest date query error:', latestErr);
      return {
        items: [],
        scoreDate: null,
        totalCount: 0,
        rawRowCount: 0,
        error: latestErr.message,
        debugInfo: `資料來源：sector_rotation_scores｜錯誤：${latestErr.message}`,
        generatedAt: null,
      };
    }

    if (!latestRow || latestRow.length === 0) {
      console.warn('[sectorRotation] No data in sector_rotation_scores');
      return {
        items: [],
        scoreDate: null,
        totalCount: 0,
        rawRowCount: 0,
        error: null,
        debugInfo: '資料來源：sector_rotation_scores｜筆數：0｜狀態：查無任何資料',
        generatedAt: null,
      };
    }

    const latestDateRaw = latestRow[0].score_date;
    const latestDateStr = String(latestDateRaw ?? '').slice(0, 10);
    console.log('[sectorRotation] Latest score_date:', latestDateStr);

    // ── Step 2: fetch all rows for that date, ordered by rotation_score desc ──
    console.log('[sectorRotation] Step 2: fetching rows for date:', latestDateStr);

    const { data, error, status, statusText } = await supabase
      .from('sector_rotation_scores')
      .select('*')
      .eq('score_date', latestDateStr)
      .order('rotation_score', { ascending: false })
      .limit(100);

    console.log('[sectorRotation] Query status:', status, statusText);
    console.log('[sectorRotation] Data length:', data?.length ?? 0);
    console.log('[sectorRotation] Error:', error?.message ?? 'none');

    if (error) {
      console.error('[sectorRotation] Query error:', error);
      return {
        items: [],
        scoreDate: latestDateStr,
        totalCount: 0,
        rawRowCount: 0,
        error: error.message,
        debugInfo: `資料來源：sector_rotation_scores｜資料日：${latestDateStr}｜筆數：0｜錯誤：${error.message}`,
        generatedAt: null,
      };
    }

    if (!data || data.length === 0) {
      console.warn('[sectorRotation] No rows for date:', latestDateStr);
      return {
        items: [],
        scoreDate: latestDateStr,
        totalCount: 0,
        rawRowCount: 0,
        error: null,
        debugInfo: `資料來源：sector_rotation_scores｜資料日：${latestDateStr}｜筆數：0`,
        generatedAt: null,
      };
    }

    const rawRowCount = data.length;

    const items: SectorRotationItem[] = (data as Record<string, unknown>[]).map((row) => mapRow(row));

    // Compute latest generated_at among today's items
    const todayOrLatestStr = latestDateStr;
    const todayItems = items.filter((item) => item.score_date === todayOrLatestStr);
    const generatedAt = todayItems.reduce((latest: string | null, item) => {
      const gen = item.generated_at || item.created_at || item.updated_at;
      if (!gen) return latest;
      return !latest || gen > latest ? gen : latest;
    }, null as string | null);

    // Log first 3 items for debugging
    console.log('[sectorRotation] First 3 items:', items.slice(0, 3).map(i => ({
      sector: i.sector,
      rotation_score: i.rotation_score,
      signal_label: i.signal_label,
    })));

    const debugInfo = `資料來源：sector_rotation_scores｜資料日：${latestDateStr}｜筆數：${items.length}`;

    return {
      items,
      scoreDate: latestDateStr,
      totalCount: items.length,
      rawRowCount,
      error: null,
      debugInfo,
      generatedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '類股輪動讀取失敗';
    console.error('[sectorRotation] Caught error:', err);
    return {
      items: [],
      scoreDate: null,
      totalCount: 0,
      rawRowCount: 0,
      error: msg,
      debugInfo: `資料來源：sector_rotation_scores｜錯誤：${msg}`,
      generatedAt: null,
    };
  }
}

/**
 * Get sector rotation scores for a specific date (today only).
 * Does NOT fall back to previous dates.
 */
export async function getTodaySectorRotation(todayDate: string): Promise<SectorRotationResult> {
  try {
    const { data, error } = await supabase
      .from('sector_rotation_scores')
      .select('*')
      .eq('score_date', todayDate)
      .order('rotation_score', { ascending: false })
      .limit(100);

    if (error) {
      return {
        items: [],
        scoreDate: null,
        totalCount: 0,
        rawRowCount: 0,
        error: error.message,
        debugInfo: `getTodaySectorRotation｜${todayDate}｜錯誤：${error.message}`,
        generatedAt: null,
      };
    }

    if (!data || data.length === 0) {
      return {
        items: [],
        scoreDate: null,
        totalCount: 0,
        rawRowCount: 0,
        error: null,
        debugInfo: `getTodaySectorRotation｜${todayDate}｜今日無類股輪動資料`,
        generatedAt: null,
      };
    }

    const items = (data as Record<string, unknown>[]).map((row) => mapRow(row));
    const generatedAt = items.reduce((latest: string | null, item) => {
      const gen = item.generated_at || item.created_at || item.updated_at;
      if (!gen) return latest;
      return !latest || gen > latest ? gen : latest;
    }, null as string | null);
    return {
      items,
      scoreDate: todayDate,
      totalCount: items.length,
      rawRowCount: data.length,
      error: null,
      debugInfo: `getTodaySectorRotation｜${todayDate}｜${items.length} 筆`,
      generatedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '類股輪動讀取失敗';
    return {
      items: [],
      scoreDate: null,
      totalCount: 0,
      rawRowCount: 0,
      error: msg,
      debugInfo: `getTodaySectorRotation｜${todayDate}｜錯誤：${msg}`,
      generatedAt: null,
    };
  }
}

/**
 * Get the latest available sector rotation scores.
 * Suitable for "latest available reference" display.
 * Note: if the latest date !== todayDate, this should NOT be used as "today" strategy.
 */
export async function getLatestSectorRotation(): Promise<SectorRotationResult> {
  return fetchSectorRotationScores();
}

/**
 * Get sector rotation scores for a specific date.
 */
export async function getSectorRotationByDate(date: string): Promise<SectorRotationResult> {
  try {
    const { data, error } = await supabase
      .from('sector_rotation_scores')
      .select('*')
      .eq('score_date', date)
      .order('rotation_score', { ascending: false })
      .limit(100);

    if (error) {
      return {
        items: [],
        scoreDate: null,
        totalCount: 0,
        rawRowCount: 0,
        error: error.message,
        debugInfo: `getSectorRotationByDate｜${date}｜錯誤：${error.message}`,
        generatedAt: null,
      };
    }

    if (!data || data.length === 0) {
      return {
        items: [],
        scoreDate: null,
        totalCount: 0,
        rawRowCount: 0,
        error: null,
        debugInfo: `getSectorRotationByDate｜${date}｜無資料`,
        generatedAt: null,
      };
    }

    const items = (data as Record<string, unknown>[]).map((row) => mapRow(row));
    const generatedAt = items.reduce((latest: string | null, item) => {
      const gen = item.generated_at || item.created_at || item.updated_at;
      if (!gen) return latest;
      return !latest || gen > latest ? gen : latest;
    }, null as string | null);
    return {
      items,
      scoreDate: date,
      totalCount: items.length,
      rawRowCount: data.length,
      error: null,
      debugInfo: `getSectorRotationByDate｜${date}｜${items.length} 筆`,
      generatedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '類股輪動讀取失敗';
    return {
      items: [],
      scoreDate: null,
      totalCount: 0,
      rawRowCount: 0,
      error: msg,
      debugInfo: `getSectorRotationByDate｜${date}｜錯誤：${msg}`,
      generatedAt: null,
    };
  }
}

// ── Map a raw row to SectorRotationItem ──

function mapRow(row: Record<string, unknown>): SectorRotationItem {
  const sector = safeStr(row.sector);
  const signalLabel = safeStr(row.signal_label);
  const direction = safeStr(row.direction);

  return {
    id: sector || `unknown-${Math.random().toString(36).slice(2, 8)}`,
    score_date: safeStr(row.score_date),
    sector,
    rotation_score: safeNum(row.rotation_score) ?? 0,
    direction: mapDirection(direction, signalLabel),
    signal_label: signalLabel,
    news_score: safeNum(row.news_score),
    market_score: safeNum(row.market_score),
    global_score: safeNum(row.global_score),
    risk_score: safeNum(row.risk_score),
    confidence_score: safeNum(row.confidence_score),
    leading_symbols: parseLeadingSymbols(row.leading_symbols),
    summary: safeStrOrNull(row.summary),
    generated_at: safeStrOrNull(row.generated_at),
    created_at: safeStrOrNull(row.created_at),
    updated_at: safeStrOrNull(row.updated_at),
  };
}

// ── Derive sector groups ──

export interface SectorGroups {
  strong: SectorRotationItem[];
  watch: SectorRotationItem[];
  avoid: SectorRotationItem[];
}

export function groupSectors(items: SectorRotationItem[]): SectorGroups {
  if (!items || items.length === 0) {
    return { strong: [], watch: [], avoid: [] };
  }

  // Top 3 by rotation_score → 相對強勢 / 防守觀察
  const strong = items.slice(0, 3);

  // Next up to 7 (indices 3-9) → 觀察或避開 (total at least 7 items visible)
  const watch = items.slice(3, 10);

  // Avoid: items with signal_label containing 避開觀察 or risk_off or lowest rotation_score
  const avoidLabels = items.filter(
    (s) => s.signal_label.includes('避開觀察') || s.signal_label.toLowerCase().includes('risk_off'),
  );
  const avoid =
    avoidLabels.length >= 2
      ? avoidLabels.slice(0, 3)
      : [...avoidLabels, ...items.slice(-Math.max(0, 3 - avoidLabels.length))].slice(0, 3);

  return { strong, watch, avoid };
}

// ── Derive AI advice from sector rotation ──

export interface SectorAdvice {
  shouldNotDo: string;
  shouldWatch: string;
  shouldAvoid: string;
  avoidSectors: string[];
  watchSectors: string[];
}

export function deriveSectorAdvice(
  groups: SectorGroups,
  marketBias: string | null | undefined,
): SectorAdvice {
  const bias = marketBias || '';
  const isHighRisk =
    bias.includes('高風險') || bias.includes('偏弱') || bias.includes('明顯偏弱');
  const strongHasOnlyDefensive = groups.strong.every((s) =>
    s.signal_label.includes('相對抗跌'),
  );

  // "現在不適合"
  let shouldNotDo: string;
  if (isHighRisk || strongHasOnlyDefensive) {
    shouldNotDo =
      '目前盤勢偏弱，AI 軍師不建議追價、搶反彈、重倉押方向。先看哪些族群抗跌、哪些族群跌勢擴大。';
  } else if (groups.strong.length === 0) {
    shouldNotDo =
      '目前類股輪動資料不足，暫不判定方向。等待資料更新後再評估。';
  } else {
    shouldNotDo =
      '市場方向尚未明朗，避免重倉押注單一族群。先觀察強勢族群是否延續。';
  }

  // "現在應該看"
  const watchNames = groups.strong.map((s) => s.sector);
  let shouldWatch: string;
  if (watchNames.length > 0) {
    const contextLabel = isHighRisk ? '高風險盤面中' : '目前盤面中';
    shouldWatch = `這些不是買進訊號，而是${contextLabel}相對值得觀察的族群：${watchNames.join('、')}。這是盤前觀察，不代表買進建議。`;
  } else {
    shouldWatch = '目前尚無明確相對強勢族群，等待類股輪動資料更新。';
  }

  // "現在要避開"
  const avoidNames = groups.avoid.map((s) => s.sector);
  let shouldAvoid: string;
  if (avoidNames.length > 0) {
    shouldAvoid = `這些族群短線盤面壓力較大，除非開盤後出現明確止跌，不建議優先追蹤：${avoidNames.join('、')}。`;
  } else if (groups.strong.length > 0) {
    shouldAvoid = '目前無明確弱勢族群，但仍需注意高檔震盪風險。';
  } else {
    shouldAvoid = '資料不足，無法判定需避開的族群。';
  }

  return {
    shouldNotDo,
    shouldWatch,
    shouldAvoid,
    avoidSectors: avoidNames,
    watchSectors: watchNames,
  };
}

// ═══════════════════════════════════════════════════════════
// Sector Rotation Freshness — expectedSectorDate logic
// ═══════════════════════════════════════════════════════════

export interface SectorRotationFreshness {
  /** The date we EXPECT sector data to be from, based on marketPhase */
  expectedSectorDate: string;
  /** The latest score_date actually available in sector_rotation_scores */
  latestSectorDate: string | null;
  /** Whether sector_rotation_scores has data for expectedSectorDate */
  hasExpectedSectorData: boolean;
  /** Whether sector_rotation_scores has data for todayDate (only true after close) */
  hasTodaySectorData: boolean;
  /** True when latestSectorDate < expectedSectorDate — data is too old */
  isStale: boolean;
  /** True when data is for today but was generated before 14:15 — not final */
  isPremature: boolean;
  /** User-facing title for the sector data block */
  displayTitle: string;
  /** User-facing warning message */
  warning: string;
  /** Only true when after_close_verified AND latestSectorDate === todayDate */
  canUseAsTodayStrategy: boolean;
  /** True when latestSectorDate === expectedSectorDate — usable as reference */
  canUseAsReference: boolean;
  itemCount: number;
}

/**
 * Check if a generated_at timestamp falls before Taipei 14:15 on the given date.
 * Uses generated_at (preferred) or created_at/updated_at from item data.
 * Returns false if no timestamp is available (assume valid).
 */
export function isBeforeMarketCloseTaipei(
  generatedAt: string | null,
  scoreDate: string,
  todayDate: string,
): boolean {
  // Only applicable when scoreDate is today
  if (scoreDate !== todayDate) return false;
  if (!generatedAt) return false;

  try {
    const genDate = new Date(generatedAt);
    if (isNaN(genDate.getTime())) return false;

    // Convert to Taipei time
    const tw = new Date(genDate.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const hour = tw.getHours();
    const minute = tw.getMinutes();

    // Before 14:15 = premature
    return hour < 14 || (hour === 14 && minute < 15);
  } catch {
    return false;
  }
}

/**
 * Determine which sector_rotation_scores date is appropriate for the current
 * market phase, and whether the available data is fresh enough.
 *
 * Logic:
 * - pre_market / intraday: expectedSectorDate = previousTradingDay
 * - after_close_pending:     expectedSectorDate = previousTradingDay (today not yet generated)
 * - after_close_verified:    expectedSectorDate = todayDate
 *
 * canUseAsTodayStrategy: ONLY when after_close_verified AND data exists for todayDate
 * canUseAsReference:     when data exists for expectedSectorDate
 * isStale:               when latestSectorDate < expectedSectorDate
 */
export function getSectorRotationFreshness(params: {
  todayDate: string;
  marketPhase: string;
}): {
  expectedSectorDate: string;
  latestSectorDate: string | null;
  displayTitle: string;
  warning: string;
} {
  const { todayDate, marketPhase } = params;

  // Determine expected date based on market phase
  let expectedSectorDate: string;
  if (marketPhase === 'after_close_verified') {
    // After close: we expect today's sector data
    expectedSectorDate = todayDate;
  } else {
    // pre_market, intraday, after_close_pending → use previous trading day
    expectedSectorDate = getPreviousTradingDay(todayDate);
  }

  // Pre-fetch state: caller hasn't provided actual data yet
  // Return expected date + placeholder defaults
  const baseWarning =
    marketPhase === 'pre_market' || marketPhase === 'intraday'
      ? '盤前與盤中階段，系統先根據隔夜影響鏈產生盤前判斷；類股輪動需等收盤後才能驗證。'
      : marketPhase === 'after_close_pending'
      ? `今日已收盤，等待 ${todayDate} 類股輪動分數更新完成。`
      : `等待 ${todayDate} 類股輪動驗證結果。`;

  return {
    expectedSectorDate,
    latestSectorDate: null, // caller must fill in after fetch
    displayTitle:
      marketPhase === 'after_close_verified'
        ? '今日類股輪動同步中'
        : '類股輪動資料載入中',
    warning: baseWarning,
  };
}

/**
 * Full freshness check — call AFTER sector data is fetched.
 * Pass the result from fetchSectorRotationScores() or getTodaySectorRotation().
 */
export function computeSectorRotationFreshness(
  result: SectorRotationResult,
  todayDate: string,
  marketPhase: string,
): SectorRotationFreshness {
  const expectedSectorDate = marketPhase === 'after_close_verified'
    ? todayDate
    : getPreviousTradingDay(todayDate);

  const latestSectorDate = result.scoreDate;
  const hasTodaySectorData = latestSectorDate === todayDate;
  const hasExpectedSectorData = latestSectorDate === expectedSectorDate;
  const isStale = latestSectorDate !== null && latestSectorDate < expectedSectorDate && !hasExpectedSectorData;

  // ═══ CHECK: Is today's data premature (generated before 14:15)? ═══
  const isPremature = hasTodaySectorData &&
    isBeforeMarketCloseTaipei(result.generatedAt, result.scoreDate!, todayDate);

  // ═══ Derived: canUseAsTodayStrategy is FALSE when premature ═══
  const canUseAsTodayStrategy = marketPhase === 'after_close_verified' && hasTodaySectorData && !isPremature;
  const canUseAsReference = hasExpectedSectorData;

  let displayTitle = '';
  let warning = '';

  if (result.items.length === 0 || latestSectorDate === null) {
    displayTitle = '類股輪動資料尚未產生';
    warning = '尚無任何類股輪動資料，今日族群主策略暫不產生。';
  } else if (isPremature) {
    // Today's data exists but was generated before 14:15 — not final
    displayTitle = '今日類股輪動需待收盤後驗證';
    warning = '今日類股輪動資料於 14:15 前產生，可能非最終收盤後驗證結果。系統將在 14:20 後重新產生正式收盤驗證資料，請稍後再查看。';
  } else if (canUseAsTodayStrategy) {
    displayTitle = '今日收盤後類股輪動';
    warning = '';
  } else if (canUseAsReference) {
    if (marketPhase === 'pre_market' || marketPhase === 'intraday') {
      displayTitle = '上一交易日類股輪動參考';
      warning = `此資料為 ${expectedSectorDate} 收盤後類股輪動，作為今日盤前與盤中參考，不代表今日收盤後結果。`;
    } else if (marketPhase === 'after_close_pending') {
      displayTitle = '上一交易日類股輪動參考';
      warning = `此資料為 ${expectedSectorDate} 收盤後類股輪動。今日收盤後類股輪動尚未完成。`;
    } else {
      displayTitle = '今日收盤後類股輪動';
      warning = '';
    }
  } else if (isStale) {
    displayTitle = '類股資料過舊，暫不採用';
    warning = `目前最新類股資料為 ${latestSectorDate}，未更新至 ${expectedSectorDate}。今日族群主策略暫不採用類股輪動，請以盤前劇本與盤中追蹤為主。`;
  } else if (marketPhase === 'after_close_verified' && !hasTodaySectorData) {
    displayTitle = '今日類股輪動同步中';
    warning = '今日已收盤，系統正在等待類股輪動分數更新完成。';
  } else {
    displayTitle = '類股資料尚未更新';
    warning = `今日類股輪動資料尚未同步完成，暫不產生今日族群主策略。請以盤前劇本、盤中追蹤與收盤驗證為主。`;
  }

  return {
    expectedSectorDate,
    latestSectorDate,
    hasExpectedSectorData,
    hasTodaySectorData,
    isStale,
    isPremature,
    displayTitle,
    warning,
    canUseAsTodayStrategy,
    canUseAsReference,
    itemCount: result.items.length,
  };
}