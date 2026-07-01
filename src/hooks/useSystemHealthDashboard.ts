import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ===== Types =====

export type HealthStatus = 'normal' | 'expired' | 'waiting' | 'not_connected' | 'error';

export interface ReportCard {
  source: 'reports';
  status: HealthStatus;
  reportDate: string | null;
  latestTime: string | null;
  marketBias: string | null;
  confidenceScore: number | null;
  description: string;
}

export interface MarketDataCard {
  source: 'market_data';
  status: HealthStatus;
  latestTime: string | null;
  todayCount: number;
  corePresent: number;
  coreTotal: number;
  description: string;
}

export interface MarketNewsCard {
  source: 'market_news';
  status: HealthStatus;
  latestTime: string | null;
  todayCount: number;
  selectedToday: number;
  description: string;
}

export interface TomorrowChecklistItem {
  label: string;
  description: string;
  status: 'waiting' | 'checked' | 'pending';
}

export interface TomorrowChecklist {
  status: 'waiting' | 'ready';
  items: TomorrowChecklistItem[];
  description: string;
}

export interface LinePushCard {
  source: 'line_push';
  status: HealthStatus;
  latestTime: string | null;
  todayCount: number;
  successCount: number;
  description: string;
}

export interface HealthScore {
  score: number;
  breakdown: {
    reports: number;
    marketData: number;
    marketNews: number;
    openingRadar: number;
    linePush: number;
  };
}

export interface OpeningRadarCard {
  source: 'opening_radar';
  status: HealthStatus;
  checkDate: string | null;
  radarStatus: string | null;
  marketBias: string | null;
  confidenceScore: number | null;
  isPremarketOverridden: boolean;
  overrideReason: string | null;
  description: string;
}

export interface SystemHealthDashboard {
  report: ReportCard;
  marketData: MarketDataCard;
  marketNews: MarketNewsCard;
  openingRadar: OpeningRadarCard;
  linePush: LinePushCard;
  tomorrowChecklist: TomorrowChecklist;
  healthScore: HealthScore;
  loading: boolean;
  error: string | null;
  refreshedAt: string | null;
}

// ===== Taipei date helpers =====

function getTaipeiToday(): string {
  const now = new Date();
  const taipei = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const y = taipei.getFullYear();
  const m = String(taipei.getMonth() + 1).padStart(2, '0');
  const d = String(taipei.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTaipeiNow(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

function isBeforeNextDay730(): boolean {
  const tw = getTaipeiNow();
  const tomorrow730 = new Date(tw);
  tomorrow730.setDate(tomorrow730.getDate() + 1);
  tomorrow730.setHours(7, 30, 0, 0);
  return tw < tomorrow730;
}

function isBeforeTodayOpen(): boolean {
  const tw = getTaipeiNow();
  const hour = tw.getHours();
  const minute = tw.getMinutes();
  return hour < 7 || (hour === 7 && minute < 30);
}

// ===== Per-source fetchers =====

async function fetchReportCard(): Promise<ReportCard> {
  try {
    const today = getTaipeiToday();
    const { data, error } = await supabase
      .from('reports')
      .select('report_date, created_at, market_bias, confidence_score')
      .eq('report_date', today)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      // No report for today yet — check if we're before next day's 07:30
      if (isBeforeNextDay730()) {
        return {
          source: 'reports',
          status: 'waiting',
          reportDate: null,
          latestTime: null,
          marketBias: null,
          confidenceScore: null,
          description: '今日報告尚未產生，等待排程執行。',
        };
      }
      return {
        source: 'reports',
        status: 'expired',
        reportDate: null,
        latestTime: null,
        marketBias: null,
        confidenceScore: null,
        description: '今日報告尚未產生，已超過排程時間，請檢查 cron 是否正常。',
      };
    }

    const row = data as Record<string, unknown>;
    const createdAt = row.created_at ? String(row.created_at) : null;

    return {
      source: 'reports',
      status: 'normal',
      reportDate: String(row.report_date || ''),
      latestTime: createdAt,
      marketBias: row.market_bias ? String(row.market_bias) : null,
      confidenceScore: row.confidence_score ? Number(row.confidence_score) : null,
      description: `今日報告已生成，市場方向：${row.market_bias || '無'}，劇本成立度：${row.confidence_score ?? '無'}/100。`,
    };
  } catch {
    return {
      source: 'reports',
      status: 'error',
      reportDate: null,
      latestTime: null,
      marketBias: null,
      confidenceScore: null,
      description: '讀取 reports 資料表失敗，請檢查資料庫連線。',
    };
  }
}

async function fetchMarketDataCard(): Promise<MarketDataCard> {
  try {
    const today = getTaipeiToday();
    const todayStart = `${today}T00:00:00+08:00`;

    const { data: todayData, error } = await supabase
      .from('market_data')
      .select('symbol, captured_at')
      .gte('captured_at', todayStart);

    if (error) throw error;

    if (!todayData || todayData.length === 0) {
      if (isBeforeTodayOpen()) {
        return {
          source: 'market_data',
          status: 'normal',
          latestTime: null,
          todayCount: 0,
          corePresent: 0,
          coreTotal: 4,
          description: '等待今日市場開盤後更新。',
        };
      }
      return {
        source: 'market_data',
        status: 'expired',
        latestTime: null,
        todayCount: 0,
        corePresent: 0,
        coreTotal: 4,
        description: '市場資料尚未更新至今日。請檢查 cron-job.org 的 fetch-market-data-v10 排程是否正常執行。',
      };
    }

    // Check core symbols: NVDA, TSM, SPX — at least 2 needed
    const rows = todayData as Array<{ symbol: string; captured_at: string }>;
    const symbols = new Set(rows.map((r) => r.symbol));
    const coreRequired = ['NVDA', 'TSM', 'SPX'];
    const present = coreRequired.filter((s) => symbols.has(s));
    const missing = coreRequired.filter((s) => !symbols.has(s));
    const coreOk = present.length >= 2;

    const latestTime = rows.reduce((max, r) => (r.captured_at > max ? r.captured_at : max), rows[0].captured_at);

    // Add TW-specific note
    const twSymbols = ['TAIEX', 'TXF', '2330'];
    const twPresent = twSymbols.filter((s) => symbols.has(s));
    const twMissing = twSymbols.filter((s) => !symbols.has(s));

    let desc = coreOk
      ? `今日已擷取 ${rows.length} 筆市場資料，核心指標 ${present.length}/${coreRequired.length} 存在。`
      : `今日已擷取 ${rows.length} 筆市場資料，但核心指標僅 ${present.length}/${coreRequired.length}，缺少 ${missing.join('、')}。`;

    if (twMissing.length > 0) {
      desc += ` 台股資料缺少 ${twMissing.join('、')}。`;
    }

    return {
      source: 'market_data',
      status: coreOk ? 'normal' : 'expired',
      latestTime,
      todayCount: rows.length,
      corePresent: present.length,
      coreTotal: coreRequired.length,
      description: desc,
    };
  } catch {
    return {
      source: 'market_data',
      status: 'error',
      latestTime: null,
      todayCount: 0,
      corePresent: 0,
      coreTotal: 3,
      description: '讀取 market_data 資料表失敗，請檢查資料庫連線。',
    };
  }
}

async function fetchMarketNewsCard(): Promise<MarketNewsCard> {
  try {
    const today = getTaipeiToday();
    const todayStart = `${today}T00:00:00+08:00`;

    const { data: todayRows, error } = await supabase
      .from('market_news')
      .select('is_selected, created_at')
      .gte('created_at', todayStart);

    if (error) throw error;

    if (!todayRows || todayRows.length === 0) {
      if (isBeforeNextDay730()) {
        return {
          source: 'market_news',
          status: 'waiting',
          latestTime: null,
          todayCount: 0,
          selectedToday: 0,
          description: '等待排程執行，今日新聞尚未擷取。',
        };
      }
      return {
        source: 'market_news',
        status: 'expired',
        latestTime: null,
        todayCount: 0,
        selectedToday: 0,
        description: '今日新聞尚未擷取，請檢查新聞排程。',
      };
    }

    const rows = todayRows as Array<{ is_selected: boolean; created_at: string }>;
    const selectedToday = rows.filter((r) => r.is_selected).length;
    const todayCount = rows.length;
    const latestTime = rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), rows[0].created_at);

    return {
      source: 'market_news',
      status: 'normal',
      latestTime,
      todayCount,
      selectedToday,
      description: `今日共 ${todayCount} 則新聞，已選中 ${selectedToday} 則。`,
    };
  } catch {
    return {
      source: 'market_news',
      status: 'error',
      latestTime: null,
      todayCount: 0,
      selectedToday: 0,
      description: '讀取 market_news 資料表失敗，請檢查資料庫連線。',
    };
  }
}

async function fetchLinePushCard(): Promise<LinePushCard> {
  try {
    const today = getTaipeiToday();
    const todayStart = `${today}T00:00:00+08:00`;

    const { data: todayRows, error } = await supabase
      .from('line_push_logs')
      .select('status, created_at')
      .gte('created_at', todayStart);

    if (error) throw error;

    if (!todayRows || todayRows.length === 0) {
      if (isBeforeNextDay730()) {
        return {
          source: 'line_push',
          status: 'normal',
          latestTime: null,
          todayCount: 0,
          successCount: 0,
          description: '等待今日 LINE 推播排程執行。',
        };
      }
      return {
        source: 'line_push',
        status: 'not_connected',
        latestTime: null,
        todayCount: 0,
        successCount: 0,
        description: '今日尚無推播紀錄，請確認 LINE 推播排程是否正常。',
      };
    }

    const rows = todayRows as Array<{ status: string; created_at: string }>;
    const todayCount = rows.length;
    const successCount = rows.filter((r) => r.status === 'success').length;
    const latestTime = rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), rows[0].created_at);

    return {
      source: 'line_push',
      status: 'normal',
      latestTime,
      todayCount,
      successCount,
      description: `今日推播 ${todayCount} 則，成功 ${successCount} 則。`,
    };
  } catch {
    return {
      source: 'line_push',
      status: 'not_connected',
      latestTime: null,
      todayCount: 0,
      successCount: 0,
      description: 'LINE 推播尚未接入，請確認 line_push_logs 資料表是否有資料。',
    };
  }
}

async function fetchOpeningRadarCard(): Promise<OpeningRadarCard> {
  try {
    const today = getTaipeiToday();
    const { data, error } = await supabase
      .from('opening_market_radar')
      .select('report_date, radar_status, market_bias, confidence_score, is_premarket_overridden, override_reason')
      .eq('report_date', today)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      if (isBeforeNextDay730()) {
        return {
          source: 'opening_radar',
          status: 'waiting',
          checkDate: null,
          radarStatus: null,
          marketBias: null,
          confidenceScore: null,
          isPremarketOverridden: false,
          overrideReason: null,
          description: '等待開盤後執行開盤雷達。',
        };
      }
      return {
        source: 'opening_radar',
        status: 'expired',
        checkDate: null,
        radarStatus: null,
        marketBias: null,
        confidenceScore: null,
        isPremarketOverridden: false,
        overrideReason: null,
        description: '今日開盤雷達尚未執行，請檢查排程。',
      };
    }

    const row = data as Record<string, unknown>;
    const isOverridden = Boolean(row.is_premarket_overridden);
    const radarStatus = row.radar_status ? String(row.radar_status) : null;

    return {
      source: 'opening_radar',
      status: 'normal',
      checkDate: String(row.report_date || ''),
      radarStatus,
      marketBias: row.market_bias ? String(row.market_bias) : null,
      confidenceScore: row.confidence_score ? Number(row.confidence_score) : null,
      isPremarketOverridden: isOverridden,
      overrideReason: row.override_reason ? String(row.override_reason) : null,
      description: isOverridden
        ? `開盤雷達已執行：${radarStatus}。盤前劇本已被推翻，此為正常風控狀態。`
        : `開盤雷達已執行：${radarStatus || '觀察中'}。`,
    };
  } catch {
    return {
      source: 'opening_radar',
      status: 'error',
      checkDate: null,
      radarStatus: null,
      marketBias: null,
      confidenceScore: null,
      isPremarketOverridden: false,
      overrideReason: null,
      description: '讀取 opening_market_radar 資料表失敗。',
    };
  }
}

function buildTomorrowChecklist(
  _report: ReportCard,
  _marketData: MarketDataCard,
  _marketNews: MarketNewsCard,
  _linePush: LinePushCard,
): TomorrowChecklist {
  if (isBeforeNextDay730()) {
    return {
      status: 'waiting',
      items: [
        { label: '每日報告生成', description: '等待明日排程執行', status: 'waiting' },
        { label: '市場資料擷取', description: '等待明日排程執行', status: 'waiting' },
        { label: '全球新聞擷取', description: '等待明日排程執行', status: 'waiting' },
        { label: 'LINE 推播', description: '等待明日排程執行', status: 'waiting' },
      ],
      description: '等待明日排程執行',
    };
  }

  // After 07:30 — show readiness
  return {
    status: 'ready',
    items: [
      { label: '每日報告生成', description: '排程已就緒，等待 cron-generate-report 觸發', status: 'pending' },
      { label: '市場資料擷取', description: '排程已就緒，等待 fetch-market-data 觸發', status: 'pending' },
      { label: '全球新聞擷取', description: '排程已就緒，等待 fetch-global-market-news 觸發', status: 'pending' },
      { label: 'LINE 推播', description: '排程已就緒，等待 line-daily-push 觸發', status: 'pending' },
    ],
    description: '排程已過觸發時間，等待執行。',
  };
}

function computeHealthScore(
  report: ReportCard,
  marketData: MarketDataCard,
  marketNews: MarketNewsCard,
  openingRadar: OpeningRadarCard,
  linePush: LinePushCard,
  _reportConfidenceScore?: number | null,
  _marketDataCorePresent?: number,
  _marketDataCoreTotal?: number,
): HealthScore {
  // Base scores per category
  const hasReport = report.status === 'normal';
  const hasMarketData = marketData.status === 'normal' && marketData.todayCount >= 3;
  const hasMarketNews = marketNews.status === 'normal' && marketNews.todayCount >= 10;
  const hasLinePush = linePush.status === 'normal' || linePush.status === 'waiting';

  // Report score
  const reportsScore = hasReport ? 25 : 0;

  // Market data score
  const marketDataScore = hasMarketData ? 25 : 0;

  // Market news score
  const marketNewsScore = hasMarketNews ? 25 : 0;

  // Opening radar score: only if opened (>09:15)
  const openingRadarScore = openingRadar.status === 'normal' ? 25 : 0;

  // LINE score
  const linePushScore = hasLinePush ? 25 : 0;

  const breakdown = {
    reports: reportsScore,
    marketData: marketDataScore,
    marketNews: marketNewsScore,
    openingRadar: openingRadarScore,
    linePush: linePushScore,
  };

  let score = reportsScore + marketDataScore + marketNewsScore + openingRadarScore + linePushScore;

  // ── SAFETY CAPS ──
  const coreRatio = marketData.coreTotal > 0 ? marketData.corePresent / marketData.coreTotal : 0;
  const confidenceScore = report.confidenceScore ?? 0;

  // Cap 1: Market data core insufficient → max 75
  if (marketData.corePresent < 3 && score > 75) {
    score = 75;
  }

  // Cap 2: Report confidence < 70 → max 70
  if (confidenceScore > 0 && confidenceScore < 70 && score > 70) {
    score = 70;
  }

  // Cap 3: Report vs market data conflict
  // (if report bias is bullish but core market data is negative)
  const isReportBullish = (report.marketBias || '').includes('強勢偏多') || (report.marketBias || '').includes('偏多');
  const isMarketDataWeak = coreRatio < 0.5 && marketData.todayCount < 5;
  if (isReportBullish && isMarketDataWeak && score > 60) {
    score = 60;
  }

  return { score: Math.max(0, Math.min(100, score)), breakdown };
}

// ===== Main hook =====

async function loadDashboard(): Promise<SystemHealthDashboard> {
  const [report, marketData, marketNews, openingRadar, linePush] = await Promise.all([
    fetchReportCard(),
    fetchMarketDataCard(),
    fetchMarketNewsCard(),
    fetchOpeningRadarCard(),
    fetchLinePushCard(),
  ]);

  const tomorrowChecklist = buildTomorrowChecklist(report, marketData, marketNews, linePush);
  const healthScore = computeHealthScore(report, marketData, marketNews, openingRadar, linePush);

  return {
    report,
    marketData,
    marketNews,
    openingRadar,
    linePush,
    tomorrowChecklist,
    healthScore,
    loading: false,
    error: null,
    refreshedAt: new Date().toISOString(),
  };
}

export function useSystemHealthDashboard() {
  const [data, setData] = useState<SystemHealthDashboard>({
    report: { source: 'reports', status: 'error', reportDate: null, latestTime: null, marketBias: null, confidenceScore: null, description: '載入中...' },
    marketData: { source: 'market_data', status: 'error', latestTime: null, todayCount: 0, corePresent: 0, coreTotal: 4, description: '載入中...' },
    marketNews: { source: 'market_news', status: 'error', latestTime: null, todayCount: 0, selectedToday: 0, description: '載入中...' },
    openingRadar: { source: 'opening_radar', status: 'error', checkDate: null, radarStatus: null, marketBias: null, confidenceScore: null, isPremarketOverridden: false, overrideReason: null, description: '載入中...' },
    linePush: { source: 'line_push', status: 'not_connected', latestTime: null, todayCount: 0, successCount: 0, description: '載入中...' },
    tomorrowChecklist: { status: 'waiting', items: [], description: '載入中...' },
    healthScore: { score: 0, breakdown: { reports: 0, marketData: 0, marketNews: 0, openingRadar: 0, linePush: 0 } },
    loading: true,
    error: null,
    refreshedAt: null,
  });

  const load = useCallback(async () => {
    const d = await loadDashboard();
    setData(d);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading: data.loading, error: data.error, refresh: load };
}

export { getTaipeiToday };