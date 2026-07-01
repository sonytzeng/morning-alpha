import { supabase } from '@/lib/supabase';

export interface SupabaseDailyReport {
  id: string;
  market_sentiment: string;
  confidence_score: number;
  summary: string | null;
  public_summary: string | null;
  pro_content: string | null;
  full_report: Record<string, unknown> | string | null;
  status: string;
  report_date: string;
  created_at: string;
}

export interface MarketSentiment {
  score: number;
  label: string;
  confidence: number;
  sectors: string[];
  updatedAt: string;
}

export interface ReportSummary {
  oneSentence: string;
  date: string;
  marketStatus: string;
  confidenceScore: number;
}

export interface AIAnalysisSection {
  sector: string;
  title?: string;
  summary?: string;
  impact?: string;
  outlook?: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentLabel: string;
  analysis: string;
  keyDrivers: string[];
}

export interface HistoricalReport {
  id: string;
  date: string;
  title: string;
  sentiment: string;
  confidenceScore: number;
  highlights: string[];
}

export interface WatchItem {
  id: string;
  title: string;
  category: string;
  description: string;
}

export interface MarketIndex {
  name: string;
  symbol: string;
  value: string;
  change: string;
  changePercent: string;
  status: 'up' | 'down' | 'flat';
  impactOnTaiwan: string;
}

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
}

export interface AIConclusion {
  verdict: string;
  layoutAdvice: string;
  riskLevel: string;
  summary: string;
  oneSentence?: string;
}

export interface PanicIndex {
  level: 'smooth' | 'caution' | 'high';
  label: string;
  score: number;
  description: string;
}

export interface BeginnerAdvice {
  dos: string[];
  donts: string[];
  watchList: string[];
}

export interface SectorSignal {
  sector: string;
  signal: 'bullish' | 'neutral' | 'bearish';
  signalLabel: string;
  plainAdvice: string;
}

export interface FullReportMarketSnapshot {
  fear_greed_index?: number;
  vix?: number;
  nasdaq_change?: number;
  sp500_change?: number;
  dowjones_change?: number;
  sox_change?: number;
  taiwan_futures_change?: number;
  gold_price?: number;
  oil_price?: number;
  btc_price?: number;
  dxy_index?: number;
  us10y_yield?: number;
}

export interface MarketSnapshotAnalysis {
  fear_greed_explanation?: string;
  vix_explanation?: string;
  us_market_explanation?: string;
  commodity_explanation?: string;
}

export interface ImpactMapItem {
  id: string;
  source: string;
  event: string;
  taiwanImpact: string;
  beginnerTip: string;
  relatedSector?: string;
}

export function convertToMarketSentiment(report: SupabaseDailyReport): MarketSentiment {
  const label = report.market_sentiment || '震盪';
  const score = label === '偏多' ? 70 : label === '偏空' ? 30 : 50;
  return {
    score,
    label,
    confidence: report.confidence_score || 0,
    sectors: ['AI', '半導體', '金融', '航運'],
    updatedAt: report.report_date + ' 07:30',
  };
}

export function convertToReportSummary(report: SupabaseDailyReport): ReportSummary {
  return {
    oneSentence: report.summary || '今日報告已生成，請查看完整內容',
    date: report.report_date,
    marketStatus: report.market_sentiment || '震盪',
    confidenceScore: report.confidence_score || 0,
  };
}

export function parseFullReport(
  fullReport: Record<string, unknown> | string | null
): Record<string, unknown> | null {
  if (!fullReport) return null;
  if (typeof fullReport === 'object') return fullReport;
  try {
    return JSON.parse(fullReport);
  } catch {
    return null;
  }
}

function inferSentimentFromText(text: string): 'bullish' | 'bearish' | 'neutral' {
  if (!text) return 'neutral';
  const t = text.toLowerCase();
  const bullishWords = ['漲', '多', '強', '升', '積極', '看好', '偏多', '上漲', '正向', '樂觀', '突破'];
  const bearishWords = ['跌', '空', '弱', '降', '悲觀', '看淡', '偏空', '下跌', '負向', '壓力', '風險', '衰退'];

  let b = 0;
  let s = 0;
  for (const w of bullishWords) if (t.includes(w)) b++;
  for (const w of bearishWords) if (t.includes(w)) s++;

  if (b > s) return 'bullish';
  if (s > b) return 'bearish';
  return 'neutral';
}

function sentimentToLabel(s: 'bullish' | 'bearish' | 'neutral'): string {
  return s === 'bullish' ? '偏多' : s === 'bearish' ? '偏空' : '震盪';
}

export function extractAIAnalysisSections(
  parsedReport: Record<string, unknown> | null
): AIAnalysisSection[] {
  if (!parsedReport) return [];

  const sections: AIAnalysisSection[] = [];

  // ===== NEW STRUCTURE: object blocks with title/summary/impact/outlook =====
  const newSectorMap = [
    { key: 'finance', defaultTitle: '金融產業' },
    { key: 'ai', defaultTitle: 'AI 產業' },
    { key: 'semiconductors', defaultTitle: '半導體' },
    { key: 'geopolitics', defaultTitle: '地緣政治' },
    { key: 'energy', defaultTitle: '能源' },
    { key: 'taiwan_outlook', defaultTitle: '台股展望' },
  ];

  for (const { key, defaultTitle } of newSectorMap) {
    const content = parsedReport[key];
    if (!content || typeof content !== 'object' || Array.isArray(content)) continue;

    const c = content as Record<string, unknown>;
    const title = String(c.title || defaultTitle);
    const summary = String(c.summary || '');
    const impact = String(c.impact || '');
    const outlook = String(c.outlook || '');

    if (!title && !summary && !impact && !outlook) continue;

    const sentiment = inferSentimentFromText(summary + impact + outlook);
    const combinedAnalysis = [summary, impact && `可能影響：${impact}`, outlook && `後續觀察：${outlook}`]
      .filter(Boolean)
      .join('\n\n');

    sections.push({
      sector: title,
      title,
      summary,
      impact,
      outlook,
      sentiment,
      sentimentLabel: sentimentToLabel(sentiment),
      analysis: combinedAnalysis || summary,
      keyDrivers: [],
    });
  }

  // ===== OLD STRUCTURE: string blocks =====
  const sectorMap: Record<string, { sector: string; sentimentLabel: string; defaultSentiment: 'bullish' | 'bearish' | 'neutral' }> = {
    overall_market: { sector: '大盤情緒', sentimentLabel: '偏多', defaultSentiment: 'bullish' },
    semiconductor: { sector: 'AI / 半導體', sentimentLabel: '強勢', defaultSentiment: 'bullish' },
    finance: { sector: '金融', sentimentLabel: '震盪', defaultSentiment: 'neutral' },
    shipping: { sector: '航運', sentimentLabel: '偏弱', defaultSentiment: 'bearish' },
    traditional: { sector: '傳產', sentimentLabel: '觀察', defaultSentiment: 'neutral' },
    etf: { sector: 'ETF 投資人觀察', sentimentLabel: '積極', defaultSentiment: 'bullish' },
  };

  for (const [key, config] of Object.entries(sectorMap)) {
    // Skip if already handled by new structure
    if (sections.some((s) => s.sector === config.sector)) continue;

    const content = parsedReport[key];
    if (typeof content === 'string' && content.trim()) {
      sections.push({
        sector: config.sector,
        sentiment: config.defaultSentiment,
        sentimentLabel: config.sentimentLabel,
        analysis: content,
        keyDrivers: [],
      });
    }
  }

  // ===== LEGACY: sectors array =====
  if (parsedReport.sectors && Array.isArray(parsedReport.sectors)) {
    for (const s of parsedReport.sectors) {
      if (typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>).name === 'string') {
        const sector = s as Record<string, unknown>;
        const rawSentiment = String(sector.sentiment || 'neutral');
        const sentiment: 'bullish' | 'bearish' | 'neutral' =
          rawSentiment === 'bullish' ? 'bullish' : rawSentiment === 'bearish' ? 'bearish' : 'neutral';

        sections.push({
          sector: String(sector.name),
          sentiment,
          sentimentLabel: String(sector.label || '觀察'),
          analysis: String(sector.analysis || ''),
          keyDrivers: Array.isArray(sector.drivers) ? sector.drivers.map(String) : [],
        });
      }
    }
  }

  return sections;
}

export function extractWatchItems(parsedReport: Record<string, unknown> | null): WatchItem[] {
  if (!parsedReport) return [];

  const watchPoints = parsedReport.watch_points;
  if (!Array.isArray(watchPoints)) return [];

  return watchPoints.map((wp, idx) => {
    if (typeof wp === 'string') {
      return {
        id: `watch-${idx}`,
        title: wp,
        category: '觀察',
        description: '',
      };
    }
    if (typeof wp === 'object' && wp !== null) {
      const w = wp as Record<string, unknown>;
      return {
        id: `watch-${idx}`,
        title: String(w.title || w.name || `觀察重點 ${idx + 1}`),
        category: String(w.category || '觀察'),
        description: String(w.description || ''),
      };
    }
    return {
      id: `watch-${idx}`,
      title: String(wp),
      category: '觀察',
      description: '',
    };
  });
}

export function extractMarketSnapshotFromFullReport(
  parsedReport: Record<string, unknown> | null
): MarketIndex[] {
  if (!parsedReport) return [];

  // ===== NEW: object format market_snapshot =====
  const snapshotObj = parsedReport.market_snapshot;
  if (snapshotObj && typeof snapshotObj === 'object' && !Array.isArray(snapshotObj)) {
    const ms = snapshotObj as Record<string, unknown>;
    const indicators: MarketIndex[] = [];

    const addIndicator = (
      name: string,
      symbol: string,
      rawValue: unknown,
      rawChange: unknown,
      impactOnTaiwan: string
    ) => {
      if (rawValue === undefined && rawChange === undefined) return;
      const value = rawValue !== undefined ? String(rawValue) : '--';
      const changeNum = Number(rawChange) || 0;
      const isUp = changeNum > 0;
      const isDown = changeNum < 0;
      const status: 'up' | 'down' | 'flat' = isUp ? 'up' : isDown ? 'down' : 'flat';

      indicators.push({
        name,
        symbol,
        value,
        change: isUp ? `+${changeNum.toFixed(2)}` : `${changeNum.toFixed(2)}`,
        changePercent: isUp ? `+${changeNum.toFixed(2)}%` : `${changeNum.toFixed(2)}%`,
        status,
        impactOnTaiwan,
      });
    };

    addIndicator('Nasdaq', 'IXIC', ms.nasdaq_change, ms.nasdaq_change, '科技族群風向球');
    addIndicator('S&P 500', 'SPX', ms.sp500_change, ms.sp500_change, '美股大盤代表');
    addIndicator('Dow Jones', 'DJI', ms.dowjones_change, ms.dowjones_change, '傳產與金融指標');
    addIndicator('SOX 半導體', 'SOX', ms.sox_change, ms.sox_change, '台積電、聯發科直接相關');
    addIndicator('台指期夜盤', 'TX', ms.taiwan_futures_change, ms.taiwan_futures_change, '隔日台股開盤參考');
    addIndicator('黃金', 'XAU', ms.gold_price, undefined, '避險資產指標');
    addIndicator('原油', 'WTI', ms.oil_price, undefined, '通膨與運輸成本');
    addIndicator('比特幣', 'BTC', ms.btc_price, undefined, '風險資產情緒');
    addIndicator('美元指數', 'DXY', ms.dxy_index, undefined, '台幣匯率、外資流向');
    addIndicator('美國十年債', 'US10Y', ms.us10y_yield, undefined, '全球資金成本基準');

    return indicators;
  }

  // ===== Legacy: array format =====
  const snapshot = parsedReport.market_snapshot;
  if (!Array.isArray(snapshot)) return [];

  return snapshot
    .map((item, idx) => {
      if (typeof item !== 'object' || item === null) return null;
      const i = item as Record<string, unknown>;
      const changePercent = Number(i.changePercent || i.change_percent || 0);
      const isUp = changePercent > 0;
      const isDown = changePercent < 0;
      const status: 'up' | 'down' | 'flat' = isUp ? 'up' : isDown ? 'down' : 'flat';

      return {
        name: String(i.name || ''),
        symbol: String(i.symbol || ''),
        value: String(i.value || ''),
        change: isUp ? `+${changePercent.toFixed(2)}` : `${changePercent.toFixed(2)}`,
        changePercent: isUp ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`,
        status,
        impactOnTaiwan: String(i.impactOnTaiwan || i.impact_on_taiwan || ''),
      };
    })
    .filter((item): item is MarketIndex => item !== null);
}

export function extractMarketSnapshotFromFullReportObject(
  parsedReport: Record<string, unknown> | null
): FullReportMarketSnapshot | null {
  if (!parsedReport?.market_snapshot) return null;
  const ms = parsedReport.market_snapshot;
  if (typeof ms !== 'object' || ms === null || Array.isArray(ms)) return null;
  const obj = ms as Record<string, unknown>;

  const num = (k: string) => (obj[k] !== undefined ? Number(obj[k]) : undefined);

  return {
    fear_greed_index: num('fear_greed_index'),
    vix: num('vix'),
    nasdaq_change: num('nasdaq_change'),
    sp500_change: num('sp500_change'),
    dowjones_change: num('dowjones_change'),
    sox_change: num('sox_change'),
    taiwan_futures_change: num('taiwan_futures_change'),
    gold_price: num('gold_price'),
    oil_price: num('oil_price'),
    btc_price: num('btc_price'),
    dxy_index: num('dxy_index'),
    us10y_yield: num('us10y_yield'),
  };
}

export function extractMarketSnapshotAnalysis(
  parsedReport: Record<string, unknown> | null
): MarketSnapshotAnalysis | null {
  if (!parsedReport?.market_snapshot_analysis) return null;
  const msa = parsedReport.market_snapshot_analysis;
  if (typeof msa !== 'object' || msa === null) return null;
  const obj = msa as Record<string, unknown>;

  return {
    fear_greed_explanation: obj.fear_greed_explanation !== undefined ? String(obj.fear_greed_explanation) : undefined,
    vix_explanation: obj.vix_explanation !== undefined ? String(obj.vix_explanation) : undefined,
    us_market_explanation: obj.us_market_explanation !== undefined ? String(obj.us_market_explanation) : undefined,
    commodity_explanation: obj.commodity_explanation !== undefined ? String(obj.commodity_explanation) : undefined,
  };
}

export function extractTopNewsFromFullReport(
  parsedReport: Record<string, unknown> | null
): NewsItem[] {
  if (!parsedReport) return [];
  const news = parsedReport.top_news;
  if (!Array.isArray(news)) return [];

  return news
    .map((item, idx) => {
      if (typeof item !== 'object' || item === null) return null;
      const n = item as Record<string, unknown>;
      return {
        id: String(n.id || `news-${idx}`),
        title: String(n.title || ''),
        source: String(n.source || ''),
        publishedAt: String(n.publishedAt || n.published_at || ''),
        aiImportance: Number(n.aiImportance || n.importance_score || 0),
        affectedMarket: String(n.affectedMarket || n.related_markets || ''),
        impactSummary: String(n.impactSummary || n.taiwan_impact_summary || n.summary || ''),
        originalUrl: String(n.originalUrl || n.url || ''),
        affectedSector: String(n.affectedSector || n.related_sectors || ''),
      };
    })
    .filter((item): item is NewsItem => item !== null);
}

export function extractAIConclusion(
  parsedReport: Record<string, unknown> | null,
  report: SupabaseDailyReport | null
): AIConclusion {
  // ===== NEW FIELDS: beginner_translation + today_action_style =====
  if (parsedReport?.beginner_translation || parsedReport?.today_action_style) {
    const sentiment = report?.market_sentiment || '震盪';
    const confidence = report?.confidence_score || 50;

    let layoutAdvice = '保守觀察';
    let riskLevel = '風險可控';

    // Safety: never output aggressive advice when confidence < 70
    if (confidence < 70) {
      layoutAdvice = '保守觀察';
      riskLevel = 'AI 把握度不足，暫不建議積極操作';
    } else if (sentiment.includes('偏多') || sentiment.includes('強勢')) {
      layoutAdvice = confidence >= 75 ? '偏積極' : '保守為主';
      riskLevel = confidence >= 75 ? '注意過熱風險' : '風險可控';
    } else if (sentiment.includes('偏空') || sentiment.includes('偏弱')) {
      layoutAdvice = '觀望或減碼';
      riskLevel = '風險較高，小心為上';
    }

    return {
      verdict: String(parsedReport.today_action_style || '觀望'),
      layoutAdvice,
      riskLevel,
      summary: String(parsedReport.beginner_translation || report?.summary || '今日市場資訊整理中'),
      oneSentence: report?.summary || '',
    };
  }

  // ===== Try structured field (legacy) =====
  const conclusion = parsedReport?.ai_conclusion || parsedReport?.beginner_summary || parsedReport?.plain_summary;
  if (conclusion && typeof conclusion === 'object') {
    const c = conclusion as Record<string, unknown>;
    return {
      verdict: String(c.verdict || c.layout_suitability || '觀望'),
      layoutAdvice: String(c.layout_advice || c.risk_appetite || '保守觀察'),
      riskLevel: String(c.risk_level || c.risk_warning || '風險可控'),
      summary: String(c.summary || report?.summary || '今日市場資訊整理中'),
      oneSentence: report?.summary || '',
    };
  }

  // ===== Fallback: generate from report fields =====
  const sentiment = report?.market_sentiment || '震盪';
  const confidence = report?.confidence_score || 50;
  const summary = report?.summary || '今日市場資訊整理中';

  let verdict = '觀望';
  let layoutAdvice = '保守觀察';
  let riskLevel = '風險可控';

  if (sentiment.includes('偏多') || sentiment.includes('強勢')) {
    verdict = confidence >= 75 ? '適合積極布局' : '可小額試水';
    layoutAdvice = confidence >= 75 ? '偏積極' : '保守為主';
    riskLevel = confidence >= 75 ? '注意過熱風險' : '風險可控';
  } else if (sentiment.includes('偏空') || sentiment.includes('偏弱')) {
    verdict = '不適合進場';
    layoutAdvice = '觀望或減碼';
    riskLevel = '風險較高，小心為上';
  } else {
    verdict = '觀望';
    layoutAdvice = '保守為主';
    riskLevel = '風險中等';
  }

  return { verdict, layoutAdvice, riskLevel, summary, oneSentence: report?.summary || '' };
}

export function extractPanicIndex(
  parsedReport: Record<string, unknown> | null,
  report: SupabaseDailyReport | null
): PanicIndex {
  // Try structured field first
  const panic = parsedReport?.panic_index || parsedReport?.risk_gauge;
  if (panic && typeof panic === 'object') {
    const p = panic as Record<string, unknown>;
    const levelRaw = String(p.level || p.risk_level || 'smooth');
    const level: 'smooth' | 'caution' | 'high' =
      levelRaw === 'high' || levelRaw === 'danger' || levelRaw === '高風險' ? 'high' :
      levelRaw === 'caution' || levelRaw === '小心' || levelRaw === 'medium' ? 'caution' : 'smooth';
    return {
      level,
      label: level === 'smooth' ? '平穩' : level === 'caution' ? '小心' : '高風險',
      score: Number(p.score || p.value || 50),
      description: String(p.description || p.message || ''),
    };
  }

  // Fallback: derive from confidence_score and market_sentiment
  const confidence = report?.confidence_score || 50;
  const sentiment = report?.market_sentiment || '震盪';

  let level: 'smooth' | 'caution' | 'high' = 'smooth';
  let label = '平穩';
  let score = 30;
  let description = '市場波動不大，正常操作即可';

  if (sentiment.includes('偏多') && confidence >= 80) {
    level = 'caution';
    label = '小心';
    score = 65;
    description = '市場樂觀情緒升溫，注意是否過熱';
  } else if (sentiment.includes('偏空') || confidence <= 40) {
    level = 'high';
    label = '高風險';
    score = 85;
    description = '市場不確定性高，建議觀望或減碼';
  } else if (sentiment.includes('偏多') && confidence >= 60) {
    level = 'smooth';
    label = '平穩';
    score = 45;
    description = '市場方向較明確，風險可控';
  } else {
    level = 'caution';
    label = '小心';
    score = 55;
    description = '市場方向不明，保持靈活';
  }

  return { level, label, score, description };
}

export function extractBeginnerAdvice(
  parsedReport: Record<string, unknown> | null
): BeginnerAdvice {
  // ===== NEW FIELDS: what_to_watch_today + what_not_to_do =====
  const watchToday = parsedReport?.what_to_watch_today;
  const notToDo = parsedReport?.what_not_to_do;

  if (watchToday || notToDo) {
    let dos: string[] = [];
    let donts: string[] = [];

    if (Array.isArray(watchToday)) {
      dos = watchToday.map(String).filter(Boolean);
    } else if (typeof watchToday === 'string' && watchToday.trim()) {
      dos = [watchToday.trim()];
    }

    if (Array.isArray(notToDo)) {
      donts = notToDo.map(String).filter(Boolean);
    } else if (typeof notToDo === 'string' && notToDo.trim()) {
      donts = [notToDo.trim()];
    }

    return { dos, donts, watchList: [] };
  }

  // ===== Legacy structured field =====
  const advice = parsedReport?.beginner_advice || parsedReport?.newbie_tips;
  if (advice && typeof advice === 'object' && !Array.isArray(advice)) {
    const a = advice as Record<string, unknown>;
    return {
      dos: Array.isArray(a.dos) ? a.dos.map(String) : Array.isArray(a.should_do) ? a.should_do.map(String) : [],
      donts: Array.isArray(a.donts) ? a.donts.map(String) : Array.isArray(a.avoid) ? a.avoid.map(String) : [],
      watchList: Array.isArray(a.watch) ? a.watch.map(String) : Array.isArray(a.watch_list) ? a.watch_list.map(String) : [],
    };
  }

  // ===== Fallback: generate from sector analyses =====
  const sectors = extractAIAnalysisSections(parsedReport);
  const dos: string[] = [];
  const donts: string[] = [];
  const watchList: string[] = [];

  for (const s of sectors) {
    if (s.sentiment === 'bullish') {
      watchList.push(`關注${s.sector.replace('產業', '').replace('族群', '')}相關標的`);
      if (s.summary) dos.push(`可研究${s.sector.replace('產業', '')}趨勢`);
    } else if (s.sentiment === 'bearish') {
      donts.push(`暫時避開${s.sector.replace('產業', '')}`);
    }
  }

  if (dos.length === 0) dos.push('先觀察大盤方向，不急著進場');
  if (donts.length === 0) donts.push('不要追漲殺跌，保持冷靜');
  if (watchList.length === 0) watchList.push('觀察大盤指數走向，等待主流族群方向確認');

  dos.push('設定停損點，控制風險');
  donts.push('不要一次 All In，分批布局');

  return { dos, donts, watchList };
}

export function extractSectorSignals(
  parsedReport: Record<string, unknown> | null
): SectorSignal[] {
  // ===== NEW FIELD: sector_direction array =====
  const sectorDirection = parsedReport?.sector_direction;
  if (Array.isArray(sectorDirection)) {
    return sectorDirection.map((item, idx) => {
      const s = item as Record<string, unknown>;
      const direction = String(s.direction || '中性');
      let signal: 'bullish' | 'neutral' | 'bearish' = 'neutral';
      if (direction.includes('偏多') || direction.includes('多') || direction.includes('漲') || direction.includes('積極') || direction.includes('強')) {
        signal = 'bullish';
      } else if (direction.includes('偏空') || direction.includes('空') || direction.includes('跌') || direction.includes('弱') || direction.includes('避開')) {
        signal = 'bearish';
      }

      return {
        sector: String(s.sector || `族群 ${idx + 1}`),
        signal,
        signalLabel: direction,
        plainAdvice: String(s.reason || ''),
      };
    });
  }

  // ===== Fallback: derive from extracted sector analyses =====
  const sectors = extractAIAnalysisSections(parsedReport);
  const knownSectors = ['AI / 半導體', '金融', '航運', 'ETF'];

  const signals: SectorSignal[] = [];

  for (const known of knownSectors) {
    const matched = sectors.find((s) =>
      s.sector.includes('半導體') || s.sector.includes('AI')
        ? known === 'AI / 半導體'
        : s.sector.includes('金融') || s.sector.includes('銀行')
          ? known === '金融'
          : s.sector.includes('航運') || s.sector.includes('運輸')
            ? known === '航運'
            : s.sector.includes('ETF')
              ? known === 'ETF'
              : false
    );

    if (matched) {
      signals.push({
        sector: known,
        signal: matched.sentiment,
        signalLabel: matched.sentimentLabel,
        plainAdvice:
          matched.summary?.slice(0, 40) + (matched.summary && matched.summary.length > 40 ? '...' : '') ||
          (matched.sentiment === 'bullish' ? '趨勢偏強，可關注' : matched.sentiment === 'bearish' ? '壓力較大，觀望' : '方向不明，等等看'),
      });
    } else {
      signals.push({
        sector: known,
        signal: 'neutral',
        signalLabel: '中性',
        plainAdvice: '暫無明確訊號，觀望為主',
      });
    }
  }

  return signals;
}

// Queries

export async function fetchLatestPublishedReport(): Promise<SupabaseDailyReport | null> {
  // 使用台北日期，避免 UTC 跨日問題
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;
  
  // 優先查今日報告
  const { data: todayData, error: todayError } = await supabase
    .from('reports')
    .select('*')
    .eq('report_date', today)
    .maybeSingle();

  if (!todayError && todayData) return todayData;
  if (todayError) console.error('fetchLatestPublishedReport (today) error:', todayError.message);

  // 今日沒有 → fallback 到最新一筆（供歷史報告/舊頁面使用）
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`讀取報告失敗: ${error.message}`);
  return data;
}

export function extractImpactMapData(
  parsedReport: Record<string, unknown> | null,
  report: SupabaseDailyReport | null
): ImpactMapItem[] {
  if (!parsedReport) return [];

  const items: ImpactMapItem[] = [];
  let idx = 0;

  const addItem = (
    source: string,
    event: string,
    taiwanImpact: string,
    beginnerTip: string,
    relatedSector?: string
  ) => {
    const cleanEvent = event.length > 140 ? event.slice(0, 140) + '...' : event;
    items.push({
      id: `impact-${idx++}`,
      source,
      event: cleanEvent,
      taiwanImpact,
      beginnerTip,
      relatedSector,
    });
  };

  // 1. Market snapshot analysis
  const msa = parsedReport.market_snapshot_analysis;
  if (msa && typeof msa === 'object' && !Array.isArray(msa)) {
    const obj = msa as Record<string, unknown>;
    if (obj.fear_greed_explanation && String(obj.fear_greed_explanation).trim()) {
      addItem(
        'CNN 貪婪指數',
        String(obj.fear_greed_explanation),
        '反映投資人整體情緒，影響全球資金流向台股',
        '貪婪指數越高代表大家越樂觀，但過熱時反而要提高警覺，不要追高'
      );
    }
    if (obj.vix_explanation && String(obj.vix_explanation).trim()) {
      addItem(
        'VIX 恐慌指數',
        String(obj.vix_explanation),
        '波動越大，台股開盤越容易出現跳空走勢',
        'VIX 飆高代表市場在擔心大事，新手這幾天建議先觀望、不要急著進場'
      );
    }
    if (obj.us_market_explanation && String(obj.us_market_explanation).trim()) {
      addItem(
        '美股市場',
        String(obj.us_market_explanation),
        '科技股與台積電 ADR 連動，直接影響台股電子股開盤氣氛',
        '美股漲，台股通常開高；美股大跌，台股早上可能承壓，先觀察再決定'
      );
    }
    if (obj.commodity_explanation && String(obj.commodity_explanation).trim()) {
      addItem(
        '黃金 / 原油 / 比特幣',
        String(obj.commodity_explanation),
        '原油漲推高航空與塑化成本，黃金漲代表避險情緒升溫',
        '原物料價格變動會間接影響部分台股的獲利能力，新手可先了解相關族群'
      );
    }
  }

  // 2. Sector analyses
  const sectorMap: Record<string, { name: string; taiwanSector: string }> = {
    semiconductor: { name: '半導體 / AI', taiwanSector: '台積電、聯發科、AI 供應鏈相關' },
    ai: { name: 'AI 產業', taiwanSector: '伺服器、散熱、IC 設計相關' },
    finance: { name: '金融', taiwanSector: '金控股、銀行股、保險股' },
    shipping: { name: '航運', taiwanSector: '貨櫃三雄、散裝航運、物流相關' },
    traditional_industry: { name: '傳統產業', taiwanSector: '塑化、鋼鐵、紡織、水泥' },
    traditional: { name: '傳統產業', taiwanSector: '塑化、鋼鐵、紡織、水泥' },
    etf_observation: { name: 'ETF', taiwanSector: '0050、0056、00878 等大盤 ETF' },
    etf: { name: 'ETF', taiwanSector: '0050、0056、00878 等大盤 ETF' },
    overall_market: { name: '大盤情緒', taiwanSector: '加權指數、櫃買指數整體走向' },
    geopolitics: { name: '地緣政治', taiwanSector: '出口型產業、電子股受國際情勢影響' },
    energy: { name: '能源', taiwanSector: '塑化、化工、運輸成本相關' },
  };

  for (const [key, config] of Object.entries(sectorMap)) {
    const content = parsedReport[key];
    if (!content) continue;

    let text = '';
    if (typeof content === 'string' && content.trim()) {
      text = content.trim();
    } else if (typeof content === 'object' && !Array.isArray(content)) {
      const c = content as Record<string, unknown>;
      const parts = [c.summary, c.impact, c.outlook].filter(Boolean).map(String);
      text = parts.join('；');
    }

    if (!text) continue;

    const sentiment = inferSentimentFromText(text);
    let taiwanImpact = `${config.taiwanSector} 今天可能受市場關注`;
    let beginnerTip = '這個族群的相關股票今天可能有波動，新手可以先觀察再決定';

    if (sentiment === 'bullish') {
      taiwanImpact = `${config.taiwanSector} 今天可能較受市場關注`;
      beginnerTip = '這個族群趨勢偏強，但新手還是建議先觀察、不要追高，分批布局較穩';
    } else if (sentiment === 'bearish') {
      taiwanImpact = `${config.taiwanSector} 今天可能承受市場壓力`;
      beginnerTip = '這個族群趨勢偏弱，新手建議觀望，不要急著進場撿便宜，等趨勢明朗';
    }

    addItem(config.name, text, taiwanImpact, beginnerTip, config.name);
  }

  // 3. Fallback from report sentiment + confidence
  if (items.length === 0 && report) {
    const sentiment = report.market_sentiment || '震盪';
    const confidence = report.confidence_score || 50;
    if (sentiment.includes('偏多')) {
      addItem(
        '大盤整體',
        `AI 判斷市場情緒${sentiment}，判讀把握度 ${confidence}/100`,
        '台股開盤可能較有支撐，電子股氣氛可能較好',
        confidence >= 75
          ? '市場氣氛不錯，但新手還是建議分批進場，不要一次重壓'
          : '市場有偏多跡象，但還不夠強，建議小額觀察'
      );
    } else if (sentiment.includes('偏空')) {
      addItem(
        '大盤整體',
        `AI 判斷市場情緒${sentiment}，判讀把握度 ${confidence}/100`,
        '台股開盤可能承壓，開盤後可能震盪',
        '市場氣氛偏弱，新手今天建議觀望，不要急著進場'
      );
    } else {
      addItem(
        '大盤整體',
        `AI 判斷市場情緒${sentiment}，判讀把握度 ${confidence}/100`,
        '市場方向尚不明確，開盤後可能來回震盪',
        '市場還在觀望，新手今天適合觀察學習，不要急著操作'
      );
    }
  }

  return items.slice(0, 8);
}

export async function fetchRecentReports(limit = 7): Promise<SupabaseDailyReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`讀取報告失敗: ${error.message}`);
  return data || [];
}

export async function fetchAllReports(): Promise<SupabaseDailyReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('report_date', { ascending: false });

  if (error) throw new Error(`讀取報告失敗: ${error.message}`);
  return data || [];
}

export async function fetchHistoricalReports(limit = 7): Promise<HistoricalReport[]> {
  const items = await fetchRecentReports(limit);
  return items.map((r) => ({
    id: r.id,
    date: r.report_date,
    title: r.summary || `${r.report_date} 盤前報告`,
    sentiment: r.market_sentiment || '震盪',
    confidenceScore: r.confidence_score || 0,
    highlights: [r.market_sentiment || '震盪'],
  }));
}

// ===== NEW INTERFACES for V3 Redesign =====

export interface RiskFactor {
  title: string;
  level: 'low' | 'medium' | 'high';
  description: string;
}

export interface OpportunityItem {
  area: string;
  reason: string;
}

export interface TaiwanStockFocusItem {
  group: string;
  direction: string;
  reason: string;
}

export interface TomorrowWatchItem {
  name: string;
  reason: string;
}

export interface ImportantNewsItem {
  title: string;
  summary: string;
  impact?: string;
  sectors?: string[];
}

// ===== NEW EXTRACTORS for V3 Redesign =====

function parseObjectArray(val: unknown): Record<string, unknown>[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
  return [];
}

function inferRiskLevelFromText(text: string): 'low' | 'medium' | 'high' {
  const t = text.toLowerCase();
  if (t.includes('高') || t.includes('嚴重') || t.includes('重大') || t.includes('警戒') || t.includes('危機')) return 'high';
  if (t.includes('低') || t.includes('輕微') || t.includes('小') || t.includes('可控')) return 'low';
  return 'medium';
}

export function extractRiskFactors(parsedReport: Record<string, unknown> | null): RiskFactor[] {
  if (!parsedReport) return [];
  const raw = parsedReport.risk_factors;

  const arr = parseObjectArray(raw);
  if (arr.length > 0) {
    return arr.map((item) => {
      const sev = String(item.severity || item.level || item.risk_level || 'medium').toLowerCase();
      const level: 'low' | 'medium' | 'high' =
        sev === '高' || sev === 'high' || sev === '嚴重' || sev === 'danger' ? 'high' :
        sev === '低' || sev === 'low' || sev === '輕微' || sev === '輕' ? 'low' : 'medium';
      return {
        title: String(item.title || item.factor || item.name || '風險因素'),
        level,
        description: String(item.impact || item.description || item.detail || item.reason || ''),
      };
    });
  }

  // String array fallback
  if (Array.isArray(raw)) {
    const strs = raw.map(String).filter(Boolean);
    if (strs.length > 0) {
      return strs.map((s) => ({ title: s, level: inferRiskLevelFromText(s), description: '' }));
    }
  }

  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[\n,，;；]/).map((s) => s.trim()).filter(Boolean).map((s) => ({
      title: s,
      level: inferRiskLevelFromText(s),
      description: '',
    }));
  }

  return [];
}

export function extractOpportunityFocus(parsedReport: Record<string, unknown> | null): OpportunityItem[] {
  if (!parsedReport) return [];
  const raw = parsedReport.opportunity_focus;

  const arr = parseObjectArray(raw);
  if (arr.length > 0) {
    return arr.map((item) => ({
      area: String(item.title || item.area || item.opportunity || item.name || item.focus || '觀察方向'),
      reason: String(item.reason || item.why || item.description || ''),
    }));
  }

  if (Array.isArray(raw)) {
    const strs = raw.map(String).filter(Boolean);
    if (strs.length > 0) return strs.map((s) => ({ area: s, reason: '' }));
  }

  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[\n,，;；]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ area: s, reason: '' }));
  }

  return [];
}

export function extractTaiwanStockFocus(parsedReport: Record<string, unknown> | null): TaiwanStockFocusItem[] {
  if (!parsedReport) return [];
  const raw = parsedReport.taiwan_stock_focus;

  const arr = parseObjectArray(raw);
  if (arr.length > 0) {
    return arr.map((item) => ({
      group: String(item.theme || item.group || item.sector || item.name || '重點族群'),
      direction: String(item.direction || item.trend || '觀察'),
      reason: String(item.reason || item.why || ''),
    }));
  }

  if (Array.isArray(raw)) {
    const strs = raw.map(String).filter(Boolean);
    if (strs.length > 0) return strs.map((s) => ({ group: s, direction: '觀察', reason: '' }));
  }

  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[\n,，;；]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ group: s, direction: '觀察', reason: '' }));
  }

  return [];
}

export function extractTomorrowWatchlist(parsedReport: Record<string, unknown> | null): TomorrowWatchItem[] {
  if (!parsedReport) return [];
  const raw = parsedReport.tomorrow_watchlist;

  const arr = parseObjectArray(raw);
  if (arr.length > 0) {
    return arr.map((item) => ({
      name: String(item.name || item.stock || item.item || item.title || '觀察標的'),
      reason: String(item.reason || item.why || item.note || ''),
    }));
  }

  if (Array.isArray(raw)) {
    const strs = raw.map(String).filter(Boolean);
    if (strs.length > 0) return strs.map((s) => ({ name: s, reason: '' }));
  }

  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[\n,，;；]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ name: s, reason: '' }));
  }

  return [];
}

export function extractImportantNewsFromFullReport(parsedReport: Record<string, unknown> | null): ImportantNewsItem[] {
  if (!parsedReport) return [];
  const raw = parsedReport.important_news;

  const arr = parseObjectArray(raw);
  if (arr.length > 0) {
    return arr.map((item) => ({
      title: String(item.title || item.headline || '重要新聞'),
      summary: String(item.summary || item.explanation || item.description || item.content || ''),
      impact: String(item.impact || item.effect || item.taiwan_impact || ''),
      sectors: Array.isArray(item.sectors)
        ? item.sectors.map(String).filter(Boolean)
        : Array.isArray(item.related_sectors)
          ? item.related_sectors.map(String).filter(Boolean)
          : Array.isArray(item.affected_sectors)
            ? item.affected_sectors.map(String).filter(Boolean)
            : item.related_sector
              ? String(item.related_sector).split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
              : [],
    }));
  }

  if (typeof raw === 'string' && raw.trim()) {
    return [{ title: raw.trim(), summary: '', sectors: [] }];
  }

  return [];
}

export function extractActionSuggestion(parsedReport: Record<string, unknown> | null): string {
  if (!parsedReport) return '';
  const suggestion = parsedReport.action_suggestion || parsedReport.action_suggestions || parsedReport.today_action;
  if (typeof suggestion === 'string' && suggestion.trim()) return suggestion.trim();
  return '';
}

export interface YesterdayCompare {
  hasYesterday: boolean;
  yesterdaySentence: string;
  yesterdaySentiment: string;
  yesterdayConfidence: number;
  todayValidation: string;
}

export async function fetchYesterdayReport(): Promise<SupabaseDailyReport | null> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('report_date', yStr)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data;
}

export function buildYesterdayCompare(
  yesterday: SupabaseDailyReport | null,
  today: SupabaseDailyReport | null
): YesterdayCompare {
  if (!yesterday || !today) {
    return {
      hasYesterday: false,
      yesterdaySentence: '',
      yesterdaySentiment: '',
      yesterdayConfidence: 0,
      todayValidation: '',
    };
  }

  const ySent = yesterday.market_sentiment || '震盪';
  const tSent = today.market_sentiment || '震盪';
  const yConf = yesterday.confidence_score || 50;
  const tConf = today.confidence_score || 50;

  let validation = '';
  if (ySent.includes('偏多') && tSent.includes('偏多')) {
    validation = '昨日 AI 判斷偏多，今日持續偏多，趨勢延續。';
  } else if (ySent.includes('偏空') && tSent.includes('偏空')) {
    validation = '昨日 AI 判斷偏空，今日持續偏空，市場壓力尚未解除。';
  } else if (ySent.includes('偏多') && (tSent.includes('震盪') || tSent.includes('中性'))) {
    validation = '昨日 AI 判斷偏多，今日轉為震盪，市場動能略為收斂。';
  } else if (ySent.includes('震盪') && tSent.includes('偏多')) {
    validation = '昨日 AI 判斷震盪，今日轉為偏多，市場氣氛有所改善。';
  } else if (ySent.includes('震盪') && tSent.includes('偏空')) {
    validation = '昨日 AI 判斷震盪，今日轉為偏空，市場出現壓力。';
  } else {
    validation = `昨日 AI 判斷${ySent}（把握度 ${yConf}），今日轉為${tSent}（把握度 ${tConf}），市場情緒有所變化。`;
  }

  return {
    hasYesterday: true,
    yesterdaySentence: yesterday.summary || `昨日 AI 判斷${ySent}` || '',
    yesterdaySentiment: ySent,
    yesterdayConfidence: yConf,
    todayValidation: validation,
  };
}