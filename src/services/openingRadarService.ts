import { supabase } from '@/lib/supabase';

export interface OpeningRadar {
  id: string;
  report_date: string;
  radar_status: string;
  market_bias: string | null;
  confidence_score: number | null;
  taiex_change: number | null;
  txf_change: number | null;
  tsmc_change: number | null;
  spx_change: number | null;
  sox_change: number | null;
  vix_change: number | null;
  dxy_change: number | null;
  us10y_change: number | null;
  summary: string | null;
  premarket_report_id: string | null;
  premarket_bias: string | null;
  premarket_confidence: number | null;
  is_premarket_overridden: boolean;
  override_reason: string | null;
  captured_at: string | null;
  source_kind: string | null;
  data_source: string | null;
  market_data_date: string | null;
  data_status: string | null;
  missing_sources: string[];
  radar_mode: string | null;
  txf_status: string | null;
  input_source: string | null;
  created_at: string;
  updated_at: string;
}

const CONFIRMED_RADAR_STATUSES = new Set(['偏強確認', '劇本成立']);
const INSUFFICIENT_DATA_STATUSES = new Set(['insufficient', 'missing', 'stale', 'not_generated']);

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

function safeStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function hasNumericValue(value: number | null): boolean {
  return value !== null && Number.isFinite(value);
}

export function hasSufficientOpeningRadarEvidence(radar: Pick<
  OpeningRadar,
  'taiex_change' | 'txf_change' | 'tsmc_change' | 'captured_at' | 'data_status'
>): boolean {
  const coreEvidenceCount = [radar.taiex_change, radar.txf_change, radar.tsmc_change]
    .filter(hasNumericValue).length;
  const dataStatus = (radar.data_status || '').trim().toLowerCase();
  return coreEvidenceCount >= 2
    && Boolean(radar.captured_at)
    && !INSUFFICIENT_DATA_STATUSES.has(dataStatus);
}

export function mapRowToOpeningRadar(row: Record<string, unknown>): OpeningRadar {
  const radar: OpeningRadar = {
    id: String(row.id || ''),
    report_date: String(row.report_date || ''),
    radar_status: String(row.radar_status || 'unknown'),
    market_bias: safeString(row.market_bias),
    confidence_score: safeNumber(row.confidence_score),
    taiex_change: safeNumber(row.taiex_change),
    txf_change: safeNumber(row.txf_change),
    tsmc_change: safeNumber(row.tsmc_change),
    spx_change: safeNumber(row.spx_change),
    sox_change: safeNumber(row.sox_change),
    vix_change: safeNumber(row.vix_change),
    dxy_change: safeNumber(row.dxy_change),
    us10y_change: safeNumber(row.us10y_change),
    summary: safeString(row.summary),
    premarket_report_id: safeString(row.premarket_report_id),
    premarket_bias: safeString(row.premarket_bias),
    premarket_confidence: safeNumber(row.premarket_confidence),
    is_premarket_overridden: safeBoolean(row.is_premarket_overridden),
    override_reason: safeString(row.override_reason),
    captured_at: safeString(row.captured_at),
    source_kind: safeString(row.source_kind),
    data_source: safeString(row.data_source),
    market_data_date: safeString(row.market_data_date),
    data_status: safeString(row.data_status),
    missing_sources: safeStringArray(row.missing_sources),
    radar_mode: safeString(row.radar_mode),
    txf_status: safeString(row.txf_status),
    input_source: safeString(row.input_source),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
  if (CONFIRMED_RADAR_STATUSES.has(radar.radar_status) && !hasSufficientOpeningRadarEvidence(radar)) {
    return {
      ...radar,
      radar_status: '資料不足',
      confidence_score: Math.min(radar.confidence_score ?? 0, 60),
      is_premarket_overridden: false,
      summary: '台股核心市場快照不足，原始狀態不採信，暫不判定劇本成立。',
    };
  }
  return radar;
}

export async function getTodayOpeningRadar(): Promise<OpeningRadar | null> {
  // Compute Taipei today (YYYY-MM-DD) to match the Edge Function's report_date format
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;

  // Priority: report_date = today, ordered by updated_at desc, then created_at desc
  const { data, error } = await supabase
    .from('opening_market_radar')
    .select('*')
    .eq('report_date', today)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getTodayOpeningRadar error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToOpeningRadar(data as Record<string, unknown>);
}

/**
 * Determines the effective display mode based on opening radar.
 * Priority: opening_market_radar > reports > market_data
 *
 * Returns the effective market bias and whether premarket was overridden.
 */
export function getEffectiveDisplayState(
  openingRadar: OpeningRadar | null,
  reportMarketBias: string | null | undefined,
  reportConfidence: number | null | undefined,
): {
  effectiveBias: string;
  effectiveConfidence: number;
  isOverridden: boolean;
  displayMode: 'premarket_script' | 'radar_weak' | 'radar_very_weak' | 'radar_confirmed' | 'data_insufficient' | 'waiting';
  displayLabel: string;
  displaySummary: string;
} {
  // No opening radar → use reports data as premarket script
  if (!openingRadar) {
    const now = new Date();
    const twHour = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getHours();
    const isAfterOpen = twHour >= 9;

    return {
      effectiveBias: reportMarketBias || '觀察中',
      effectiveConfidence: reportConfidence ?? 0,
      isOverridden: false,
      displayMode: isAfterOpen ? 'waiting' : 'premarket_script',
      displayLabel: isAfterOpen ? '等待開盤雷達更新' : '盤前劇本',
      displaySummary: isAfterOpen ? '開盤後請等待 Radar 更新以確認方向。' : '基於 07:30 盤前假設。',
    };
  }

  const hasSufficientEvidence = hasSufficientOpeningRadarEvidence(openingRadar);
  const claimedConfirmed = CONFIRMED_RADAR_STATUSES.has(openingRadar.radar_status);
  const status = claimedConfirmed && !hasSufficientEvidence
    ? '資料不足'
    : openingRadar.radar_status;

  // 明顯偏弱
  if (status === '明顯偏弱') {
    return {
      effectiveBias: '明顯偏弱',
      effectiveConfidence: openingRadar.confidence_score ?? 30,
      isOverridden: openingRadar.is_premarket_overridden,
      displayMode: 'radar_very_weak',
      displayLabel: '開盤明顯轉弱',
      displaySummary: openingRadar.summary || '台股開盤明顯轉弱，已推翻盤前假設，今日以風險控管為主。',
    };
  }

  // 盤中轉弱
  if (status === '盤中轉弱') {
    return {
      effectiveBias: '偏弱觀察',
      effectiveConfidence: openingRadar.confidence_score ?? 45,
      isOverridden: openingRadar.is_premarket_overridden,
      displayMode: 'radar_weak',
      displayLabel: '盤中轉弱 · 風險觀察',
      displaySummary: openingRadar.summary || '開盤後實際走勢轉弱，今日以風險觀察為主。',
    };
  }

  // 資料不足
  if (status === '資料不足') {
    return {
      effectiveBias: '資料不足',
      effectiveConfidence: openingRadar.confidence_score ?? 60,
      isOverridden: false,
      displayMode: 'data_insufficient',
      displayLabel: '資料不足 · 暫不判定方向',
      displaySummary: openingRadar.summary || '台股核心指標不足，暫不判定盤中方向。',
    };
  }

  // ═══ 反彈驗證中 ═══
  if (status === '反彈驗證中') {
    return {
      effectiveBias: openingRadar.market_bias || '反彈驗證中',
      effectiveConfidence: openingRadar.confidence_score ?? 55,
      isOverridden: false,
      displayMode: 'premarket_script',
      displayLabel: '盤中確認不足 · 等待訊號',
      displaySummary: openingRadar.summary || '開盤後方向初步偏正向，但確認訊號不足，等待權值股確認。',
    };
  }

  // ═══ 劇本初步成立（舊值向後相容） ═══
  if (status === '劇本初步成立') {
    return {
      effectiveBias: openingRadar.market_bias || '劇本初步成立',
      effectiveConfidence: openingRadar.confidence_score ?? 65,
      isOverridden: false,
      displayMode: 'radar_confirmed',
      displayLabel: '盤中偏強 · 等待確認',
      displaySummary: openingRadar.summary || '開盤走勢偏強，觀察量能與權值股延續性。',
    };
  }

  // ═══ 偏強確認（V3.1 新值）or 劇本成立（V3.0 舊值向後相容） ═══
  const isConfirmed = (status === '偏強確認' || status === '劇本成立') && hasSufficientEvidence;
  return {
    effectiveBias: openingRadar.market_bias || reportMarketBias || '觀察中',
    effectiveConfidence: openingRadar.confidence_score ?? reportConfidence ?? 0,
    isOverridden: false,
    displayMode: isConfirmed ? 'radar_confirmed' : 'premarket_script',
    displayLabel: isConfirmed ? '盤中偏強 · 訊號確認' : '盤中觀察中',
    displaySummary: openingRadar.summary || (isConfirmed
      ? '開盤後實際走勢偏強，盤中訊號獲得確認。'
      : '開盤後無明確方向訊號，繼續觀察。'),
  };
}

/**
 * Strategy mode based on opening radar status
 */
export function getStrategyMode(displayMode: string): {
  mode: 'aggressive' | 'observe' | 'wait' | 'defensive' | 'no_trade';
  label: string;
  color: string;
  bg: string;
  border: string;
} {
  switch (displayMode) {
    case 'radar_confirmed':
      return { mode: 'aggressive', label: '積極模式', color: 'text-forest-400', bg: 'bg-forest-500/10', border: 'border-forest-500/20' };
    case 'premarket_script':
      return { mode: 'observe', label: '觀察模式', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
    case 'waiting':
      return { mode: 'wait', label: '等待模式', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
    case 'radar_weak':
      return { mode: 'defensive', label: '防守模式', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
    case 'radar_very_weak':
      return { mode: 'defensive', label: '防守模式', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
    case 'data_insufficient':
      return { mode: 'no_trade', label: '不交易觀察模式', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20' };
    default:
      return { mode: 'wait', label: '等待模式', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
  }
}
