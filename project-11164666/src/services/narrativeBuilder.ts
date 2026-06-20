import { supabase } from '@/lib/supabase';
import { mapRowToReport } from '@/services/reportService';
import { mapRowToIntradayCheck, type IntradayCheck } from '@/services/intradayCheckService';
import type { Report } from '@/types/report';
import type { SupabaseMarketData } from '@/services/marketDataService';
import {
  getSafeMarketBias,
  getSafeHomeHeadline,
  type SafeMarketBiasResult,
} from '@/services/safeMarketBias';

// ==================== NEWS TYPE (inlined to avoid circular imports) ====================

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  aiImportance: number;
  affectedMarket: string;
  impactSummary: string;
  originalUrl: string;
  affectedSector?: string;
  finalScore: number;
  isSelected: boolean;
  relatedTwNames: string[];
  category: string;
}

function convertToNewsItem(row: Record<string, unknown>): NewsItem {
  return {
    id: String(row.id || ''),
    title: String(row.title || ''),
    source: String(row.source || ''),
    publishedAt: String(row.published_at || ''),
    aiImportance: Number(row.importance_score || 0),
    affectedMarket: String(row.related_markets || ''),
    impactSummary: String(row.taiwan_impact_summary || row.summary || ''),
    originalUrl: String(row.url || ''),
    affectedSector: row.related_sectors ? String(row.related_sectors) : undefined,
    finalScore: Number(row.final_score || 0),
    isSelected: Boolean(row.is_selected),
    relatedTwNames: Array.isArray(row.related_tw_names) ? (row.related_tw_names as string[]) : [],
    category: String(row.category || 'Other'),
  };
}

// ==================== DATA FETCHERS ====================

export async function getLatestReport(): Promise<Report | null> {
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;
  const { data } = await supabase
    .from('reports')
    .select('id, report_date, market_bias, confidence_score, summary, ai_strategy_json, created_at')
    .eq('report_date', today)
    .maybeSingle();

  return data ? mapRowToReport(data as Record<string, unknown>) : null;
}

export async function getSelectedMarketNews(limit = 10): Promise<NewsItem[]> {
  const { data, error } = await supabase
    .from('market_news')
    .select('*')
    .eq('is_selected', true)
    .order('final_score', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('getSelectedMarketNews error:', error.message);
    return [];
  }

  return (data || []).map((row) => convertToNewsItem(row as Record<string, unknown>));
}

export async function getLatestMarketData(): Promise<SupabaseMarketData[]> {
  const { data, error } = await supabase
    .from('market_data')
    .select('*')
    .order('captured_at', { ascending: false });

  if (error) {
    console.error('getLatestMarketData error:', error.message);
    return [];
  }

  // Deduplicate by symbol (keep latest)
  const seen = new Set<string>();
  const deduped: SupabaseMarketData[] = [];
  for (const item of (data || [])) {
    if (!seen.has(item.symbol)) {
      seen.add(item.symbol);
      deduped.push(item as SupabaseMarketData);
    }
  }
  return deduped;
}

export async function getTodayIntradayCheck(): Promise<IntradayCheck | null> {
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('intraday_checks')
    .select('*')
    .eq('check_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getTodayIntradayCheck error:', error.message);
    return null;
  }

  return data ? mapRowToIntradayCheck(data as Record<string, unknown>) : null;
}

// ==================== NARRATIVE BUILDERS ====================

/**
 * 首頁 30 秒摘要
 * 輸出：一句話盤勢 + 資料狀態
 */
export function buildHomeSummary(
  report: Report | null,
  marketData: SupabaseMarketData[],
): {
  headline: string;
  subline: string;
  bias: string;
  score: number;
  scoreLabel: string;
  dataFresh: boolean;
  taiexChange: number | null;
  tsmcTwChange: number | null;
  tsmAdrChange: number | null;
  safeBiasResult: SafeMarketBiasResult | null;
} {
  const taiex = marketData.find((d) => d.symbol === 'TAIEX');
  const tsmcTw = marketData.find((d) => d.symbol === '2330');
  const tsmAdr = marketData.find((d) => d.symbol === 'TSM');

  const taiexChange = taiex ? Number(taiex.change_percent) : null;
  const tsmcTwChange = tsmcTw ? Number(tsmcTw.change_percent) : null;
  const tsmAdrChange = tsmAdr ? Number(tsmAdr.change_percent) : null;

  // 判斷資料新鮮度（24h 內）
  const dataFresh = (() => {
    if (!taiex?.captured_at) return false;
    const captured = new Date(taiex.captured_at).getTime();
    return Date.now() - captured < 24 * 60 * 60 * 1000;
  })();

  // Apply safe market bias
  const safeBiasResult = getSafeMarketBias(report, marketData);
  const safeHeadline = getSafeHomeHeadline(safeBiasResult, report);

  const scoreLabel = report?.confidence_label || '等待評估';
  const rawBias = report?.market_bias || '觀察中';
  const rawScore = report?.confidence_score ?? 0;

  // Use safe values
  const headline = safeHeadline.headline;
  const bias = safeBiasResult.bias;
  const score = safeHeadline.showScore ? safeHeadline.displayScore : 0;

  // 副標：用市場數據補充
  let subline = safeHeadline.subline;
  if (!subline) {
    if (dataFresh) {
      const parts: string[] = [];
      if (taiexChange !== null) {
        parts.push(`台股加權 ${taiexChange >= 0 ? '+' : ''}${taiexChange.toFixed(2)}%`);
      }
      if (tsmcTwChange !== null) {
        parts.push(`台積電 ${tsmcTwChange >= 0 ? '+' : ''}${tsmcTwChange.toFixed(2)}%`);
      }
      if (tsmAdrChange !== null) {
        parts.push(`ADR 連動 ${tsmAdrChange >= 0 ? '+' : ''}${tsmAdrChange.toFixed(2)}%`);
      }
      if (parts.length > 0) {
        subline = `最新市場：${parts.join(' · ')}`;
      }
    } else {
      subline = '市場資料更新中，請稍後查看最新盤前判斷。';
    }
  }

  return {
    headline,
    subline,
    bias,
    score,
    scoreLabel,
    dataFresh,
    taiexChange,
    tsmcTwChange,
    tsmAdrChange,
    safeBiasResult,
  };
}

/**
 * 今日觀察頁：盤中驗證語句
 * 結合 market_data 實際變化 + reports.market_bias
 */
export function buildObservationNarrative(
  report: Report | null,
  intraday: IntradayCheck | null,
  marketData: SupabaseMarketData[],
): {
  openingStatus: string;
  openingStatusColor: string;
  taiexDirection: string;
  txfDirection: string;
  tsmcTwDirection: string;
  sectorContinuity: string;
  riskAlert: string;
  observationPoints: string[];
} {
  const taiex = marketData.find((d) => d.symbol === 'TAIEX');
  const txf = marketData.find((d) => d.symbol === 'TXF');
  const tsmcTw = marketData.find((d) => d.symbol === '2330');
  const tsmAdr = marketData.find((d) => d.symbol === 'TSM');
  const sox = marketData.find((d) => d.symbol === 'SOX');

  const taiexChange = taiex ? Number(taiex.change_percent) : null;
  const txfChange = txf ? Number(txf.change_percent) : null;
  const tsmcTwChange = tsmcTw ? Number(tsmcTw.change_percent) : null;
  const tsmAdrChange = tsmAdr ? Number(tsmAdr?.change_percent) : null;
  const soxChange = sox ? Number(sox.change_percent) : null;

  // 開盤狀態
  let openingStatus = '觀察中';
  let openingStatusColor = 'text-amber-400';

  if (intraday) {
    switch (intraday.opening_status) {
      case 'confirmed':
        openingStatus = '劇本確認：開盤方向與盤前判斷一致';
        openingStatusColor = 'text-forest-400';
        break;
      case 'strengthened':
        openingStatus = '開盤轉強：市場比盤前預期更樂觀';
        openingStatusColor = 'text-forest-400';
        break;
      case 'weakened':
        openingStatus = '開盤轉弱：市場情緒低於盤前預期';
        openingStatusColor = 'text-amber-400';
        break;
      case 'invalidated':
        openingStatus = '劇本失效：開盤方向與盤前判斷相反';
        openingStatusColor = 'text-red-400';
        break;
      case 'reversal':
        openingStatus = '市場反轉：出現反向訊號';
        openingStatusColor = 'text-red-400';
        break;
      default:
        openingStatus = '開盤資料更新中';
        openingStatusColor = 'text-amber-400';
    }
  }

  // 方向判斷
  const dir = (val: number | null): string => {
    if (val === null) return '—';
    if (val > 0.5) return '偏強';
    if (val < -0.5) return '偏弱';
    return '平盤附近';
  };

  const taiexDirection = `加權指數：${dir(taiexChange)} (${taiexChange !== null ? (taiexChange >= 0 ? '+' : '') + taiexChange.toFixed(2) + '%' : '—'})`;
  const txfDirection = `台指期：${dir(txfChange)} (${txfChange !== null ? (txfChange >= 0 ? '+' : '') + txfChange.toFixed(2) + '%' : '—'})`;
  const tsmcTwDirection = `台積電：${dir(tsmcTwChange)} (${tsmcTwChange !== null ? (tsmcTwChange >= 0 ? '+' : '') + tsmcTwChange.toFixed(2) + '%' : '—'})`;

  // 族群延續性
  let sectorContinuity = '盤中族群輪動觀察中';
  if (soxChange !== null && tsmAdrChange !== null) {
    if (soxChange > 1 && tsmAdrChange > 2) {
      sectorContinuity = '費半與 ADR 同步走強，半導體族群延續性佳';
    } else if (soxChange < -1 && tsmAdrChange < -2) {
      sectorContinuity = '費半與 ADR 同步走弱，半導體族群承壓';
    } else if (Math.abs(soxChange) < 0.5 && Math.abs(tsmAdrChange) < 1) {
      sectorContinuity = '費半與 ADR 變動不大，半導體族群觀望';
    } else {
      sectorContinuity = '費半與 ADR 方向分歧，半導體族群內部分化';
    }
  }

  // 風險提醒
  let riskAlert = '';
  const riskParts: string[] = [];
  if (taiexChange !== null && taiexChange > 1.5) {
    riskParts.push('指數開高過快，留意後續追價風險');
  }
  if (taiexChange !== null && taiexChange < -1.5) {
    riskParts.push('指數開低過深，留意恐慌性拋售');
  }
  if (txfChange !== null && taiexChange !== null && Math.abs(txfChange - taiexChange) > 0.5) {
    riskParts.push('台指期與現貨價差擴大，留意期現背離');
  }
  if (report?.risk_reason) {
    riskParts.push(report.risk_reason);
  }
  riskAlert = riskParts.length > 0 ? riskParts.join('；') : '目前盤中風險訊號正常';

  // 觀察點
  const observationPoints: string[] = [];
  observationPoints.push(taiexDirection);
  observationPoints.push(txfDirection);
  observationPoints.push(tsmcTwDirection);
  if (soxChange !== null) {
    observationPoints.push(`費半指數：${dir(soxChange)} (${soxChange >= 0 ? '+' : ''}${soxChange.toFixed(2)}%)`);
  }
  if (tsmAdrChange !== null) {
    observationPoints.push(`TSM ADR：${dir(tsmAdrChange)} (${tsmAdrChange >= 0 ? '+' : ''}${tsmAdrChange.toFixed(2)}%)`);
  }
  if (report?.key_drivers && report.key_drivers.length > 0) {
    observationPoints.push(`盤前主線：${report.key_drivers.slice(0, 2).join('、')}`);
  }

  return {
    openingStatus,
    openingStatusColor,
    taiexDirection,
    txfDirection,
    tsmcTwDirection,
    sectorContinuity,
    riskAlert,
    observationPoints,
  };
}

/**
 * AI軍師頁：盤前作戰室語句
 * 重點：「為什麼」與「看哪裡」
 */
export function buildAdvisorNarrative(
  report: Report | null,
  news: NewsItem[],
  marketData: SupabaseMarketData[],
): {
  marketMood: string;
  mainTheme: string;
  beneficiaryDirections: string[];
  riskDirections: string[];
  watchList: string[];
  whyNow: string;
  whereToWatch: string;
  aiQuote: string;
  isDataInsufficient: boolean;
  dataInsufficientReason: string;
} {
  const safeBias = getSafeMarketBias(report, marketData);

  if (!report) {
    return {
      marketMood: '盤前資料整理中',
      mainTheme: '等待報告生成',
      beneficiaryDirections: [],
      riskDirections: [],
      watchList: [],
      whyNow: '每日 07:30 自動生成盤前作戰室',
      whereToWatch: '請稍後查看最新判斷',
      aiQuote: '',
      isDataInsufficient: true,
      dataInsufficientReason: '報告尚未生成',
    };
  }

  if (!safeBias.isDataSufficient || safeBias.isTWDataMissing) {
    return {
      marketMood: `今日市場方向：${safeBias.bias}`,
      mainTheme: `可觀察方向：美股科技股與 ADR 走勢`,
      beneficiaryDirections: [],
      riskDirections: [safeBias.debug.completeness.missingCategories.length > 0
        ? `主要風險提醒：台股本地資料缺失，缺少 ${safeBias.debug.completeness.missingCategories.join('、')}，不能直接推論今日台股開盤方向。`
        : '主要風險提醒：台股本地資料缺失，不能直接推論今日台股開盤方向。'],
      watchList: [],
      whyNow: safeBias.debug.completeness.missingCategories.length > 0
        ? `目前僅取得部分美股與 ADR 資料（核心資料命中 ${safeBias.debug.completeness.coreDataHits}/6 類），台股核心資料尚未完整。`
        : '台股核心資料尚未完整，不輸出強勢方向。',
      whereToWatch: '等待台股核心資料補齊後，才能進行完整盤勢判斷。',
      aiQuote: report.today_quote || '',
      isDataInsufficient: true,
      dataInsufficientReason: `核心資料命中 ${safeBias.debug.completeness.coreDataHits}/6 類，缺少 ${safeBias.debug.completeness.missingCategories.join('、')}`,
    };
  }

  // 市場情緒
  const marketMood = report.sentiment_reason || report.ai_psychology || `今日盤前情緒：${report.market_bias || '觀察中'}。`;

  // 今日主線
  const mainTheme = report.key_drivers && report.key_drivers.length > 0
    ? report.key_drivers.join('；')
    : report.summary
      ? report.summary.split(/[。\n]/).filter((s) => s.length > 10 && s.length < 80)[0] || '主線整理中'
      : '主線整理中';

  // 受惠方向
  const beneficiaryDirections: string[] = [];
  if (report.can_watch && report.can_watch.length > 0) {
    beneficiaryDirections.push(...report.can_watch.slice(0, 4));
  }
  // 從新聞中補充
  const newsCategories = new Set<string>();
  news.forEach((n) => {
    if (n.category && n.category !== 'Other') newsCategories.add(n.category);
  });
  if (newsCategories.has('Semiconductor')) beneficiaryDirections.push('半導體供應鏈');
  if (newsCategories.has('AI')) beneficiaryDirections.push('AI 相關族群');

  // 風險方向
  const riskDirections: string[] = [];
  if (report.avoid_today && report.avoid_today.length > 0) {
    riskDirections.push(...report.avoid_today.slice(0, 3));
  }
  if (report.risk_reason) {
    riskDirections.push(report.risk_reason);
  }

  // 觀察清單
  const watchList: string[] = [];
  if (report.can_watch && report.can_watch.length > 0) {
    watchList.push(...report.can_watch.slice(0, 6));
  }
  // 從新聞的台股映射補充
  const twNames = new Set<string>();
  news.forEach((n) => {
    (n.relatedTwNames || []).forEach((name) => twNames.add(name));
  });
  if (twNames.size > 0) {
    Array.from(twNames).slice(0, 4).forEach((name) => {
      if (!watchList.includes(name)) watchList.push(name);
    });
  }

  // 為什麼現在要注意
  const whyNow = report.ai_confidence_reason || report.ai_psychology || '';

  // 看哪裡
  const whereToWatch = report.today_strategy?.do
    ? `盤中留意：${report.today_strategy.do.slice(0, 3).join('、')}。`
    : report.key_drivers
      ? `重點觀察：${report.key_drivers.slice(0, 3).join('、')}。`
      : '';

  // AI 語錄
  const aiQuote = report.today_quote || '';

  return {
    marketMood,
    mainTheme,
    beneficiaryDirections: [...new Set(beneficiaryDirections)].slice(0, 6),
    riskDirections: [...new Set(riskDirections)].slice(0, 5),
    watchList: [...new Set(watchList)].slice(0, 8),
    whyNow,
    whereToWatch,
    aiQuote,
    isDataInsufficient: false,
    dataInsufficientReason: '',
  };
}

/**
 * 劇本驗證頁：驗證語句
 * 比對盤前劇本 vs 開盤結果
 */
export function buildVerificationNarrative(
  report: Report | null,
  intraday: IntradayCheck | null,
  news: NewsItem[],
): {
  premarketAssumption: string;
  openingResult: string;
  isConfirmed: boolean;
  confirmationScore: number;
  verifiedNews: NewsItem[];
  keyMismatch: string;
  narrative: string;
} {
  if (!report) {
    return {
      premarketAssumption: '盤前劇本尚未生成',
      openingResult: '等待開盤資料',
      isConfirmed: false,
      confirmationScore: 0,
      verifiedNews: [],
      keyMismatch: '',
      narrative: '今日盤前劇本尚未生成，系統會在 07:30 前自動更新。',
    };
  }

  const premarketAssumption = `盤前假設：${report.market_bias || '觀察中'}（判讀把握度 ${report.confidence_score ?? 0}/100）。${report.key_drivers && report.key_drivers.length > 0 ? `主線為${report.key_drivers.slice(0, 2).join('、')}。` : ''}`;

  let openingResult = '開盤資料尚未更新';
  let isConfirmed = false;
  let confirmationScore = 0;
  let keyMismatch = '';

  if (intraday) {
    switch (intraday.opening_status) {
      case 'confirmed':
        openingResult = '開盤結果：劇本被市場確認。';
        isConfirmed = true;
        confirmationScore = 85;
        break;
      case 'strengthened':
        openingResult = '開盤結果：劇本不僅確認，市場比預期更強。';
        isConfirmed = true;
        confirmationScore = 95;
        break;
      case 'weakened':
        openingResult = '開盤結果：劇本方向大致成立，但強度低於預期。';
        isConfirmed = true;
        confirmationScore = 60;
        keyMismatch = '市場強度低於盤前預期';
        break;
      case 'invalidated':
        openingResult = '開盤結果：劇本方向與市場實際走勢相反。';
        isConfirmed = false;
        confirmationScore = 20;
        keyMismatch = '盤前判斷與市場實際走勢不一致';
        break;
      case 'reversal':
        openingResult = '開盤結果：市場出現反轉訊號，劇本需重新評估。';
        isConfirmed = false;
        confirmationScore = 15;
        keyMismatch = '市場出現反向訊號';
        break;
      default:
        openingResult = '開盤資料更新中，等待 09:15 驗證結果。';
        confirmationScore = 50;
    }
  }

  // 已驗證的新聞（選中的新聞）
  const verifiedNews = news.slice(0, 5);

  // 整合敘事
  let narrative = premarketAssumption + '\n' + openingResult;
  if (keyMismatch) {
    narrative += `\n差異點：${keyMismatch}。`;
  }
  if (verifiedNews.length > 0) {
    const newsCategories = [...new Set(verifiedNews.map((n) => n.category).filter(Boolean))];
    if (newsCategories.length > 0) {
      narrative += `\n高分新聞類別：${newsCategories.join('、')}。`;
    }
  }

  return {
    premarketAssumption,
    openingResult,
    isConfirmed,
    confirmationScore,
    verifiedNews,
    keyMismatch,
    narrative,
  };
}

// ==================== SHARED HELPERS ====================

/**
 * 市場資料變化（用於 bias label 覆蓋判斷）
 */
export interface MarketDataChanges {
  taiexChange: number | null;
  tsmcTwChange: number | null;
  tsmAdrChange: number | null;
}

/**
 * 取得市場方向顯示標籤。
 * Priority: safe market bias if data insufficient, otherwise raw bias.
 */
export function getMarketBiasLabel(
  bias: string | null | undefined,
  _score?: number | null | undefined,
  _marketChanges?: MarketDataChanges,
): string {
  const raw = bias || '觀察中';
  // Never output "強勢偏多" directly if data might be insufficient —
  // callers should use getSafeMarketBias() instead. This is a fallback.
  return raw;
}

/** 說明文字，各頁面共用 */
export const MARKET_BIAS_EXPLANATION = '判讀把握度代表資料一致性，不代表漲跌保證。市場方向代表今日盤勢強弱判讀。';

export function getSentimentColor(bias: string | null | undefined) {
  const b = bias || '';
  if (b.includes('偏多') || b.includes('偏強') || b.includes('強多')) {
    return {
      text: 'text-rose-300',
      bg: 'bg-rose-500',
      border: 'border-rose-400/35',
      badge: 'bg-rose-500/15 text-rose-300 border-rose-400/35',
      progress: 'text-rose-300',
      light: 'bg-rose-400',
      dot: 'bg-rose-400',
    };
  }
  if (b.includes('偏空') || b.includes('偏弱') || b.includes('強空')) {
    return {
      text: 'text-emerald-300',
      bg: 'bg-emerald-500',
      border: 'border-emerald-400/35',
      badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35',
      progress: 'text-emerald-300',
      light: 'bg-emerald-400',
      dot: 'bg-emerald-400',
    };
  }
  return {
    text: 'text-amber-300',
    bg: 'bg-amber-500',
    border: 'border-amber-400/35',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-400/35',
    progress: 'text-amber-300',
    light: 'bg-amber-400',
    dot: 'bg-amber-400',
  };
}

export function formatTaipeiDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

export function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;
  return dateStr.startsWith(today);
}

export function isStale(dateStr: string | null | undefined, hours = 24): boolean {
  if (!dateStr) return true;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return true;
    return Date.now() - d.getTime() > hours * 60 * 60 * 1000;
  } catch {
    return true;
  }
}