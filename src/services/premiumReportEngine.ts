import type { Report } from '@/types/report';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { IntelligenceResult } from '@/services/intelligenceEngine';
import { normalizeStockKey, normalizeStockDisplay } from '@/utils/contentOrganizer';
import { renderSafeText, renderStockItem } from '@/utils/renderSafe';
import { formatTaipeiDate } from '@/utils/tradingDay';

// ==================== NEWS ITEM TYPE ====================

export interface PremiumNewsItem {
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

// ==================== PREMIUM REPORT OUTPUT ====================

export interface PremiumReportResult {
  // Section 1: 今日一句話結論
  oneLineConclusion: string;

  // Section 2: 今日三件最重要的事情
  topThreeThings: TopThing[];

  // Section 3: 今日可能受影響產業
  affectedSectors: AffectedSector[];

  // Section 4: 今日值得觀察個股
  stocksToWatch: StockToWatch[];

  // Section 5: 今日風險提醒
  riskReminders: RiskReminder[];

  // Section 6: 今日劇本
  scenarios: MarketScenarios;

  // Section 7: 給上班族的30秒版
  shortVersion: string;

  // Section 8: 給進階投資人的詳細版
  detailedVersion: string;

  // Section 9: 資料品質標記
  dataQuality: DataQualityMark;

  // Metadata
  generatedAt: string;
  reportDate: string;
  isDataSufficient: boolean;
}

export interface TopThing {
  rank: number;
  title: string;
  detail: string;
  reason: string;
}

export interface AffectedSector {
  name: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  impactLevel: 'high' | 'medium' | 'low';
  reason: string;
}

export interface StockToWatch {
  name: string;
  ticker: string;
  sector: string;
  direction: 'attack' | 'observe' | 'defense';
  reason: string;
  confidence: number;
  source: 'report' | 'news' | 'market_data' | 'derived';
}

export interface RiskReminder {
  title: string;
  level: 'high' | 'medium' | 'low';
  description: string;
  source: string;
}

export interface MarketScenarios {
  bullish: ScenarioDetail;
  neutral: ScenarioDetail;
  bearish: ScenarioDetail;
}

export interface ScenarioDetail {
  label: string;
  probability: number;
  description: string;
  trigger: string;
}

export interface DataQualityMark {
  level: 'high' | 'medium' | 'low';
  label: string;
  color: string;
  reason: string;
  coreDataHits: number;
  coreDataTotal: number;
  marketDataCount: number;
  newsCount: number;
  hasReport: boolean;
}

// ==================== CONSTANTS ====================

const DATA_INSUFFICIENT_ONE_LINE = '今日盤勢資料不足，無法進行完整判斷。等待台股核心資料補齊後再評估。';
const DATA_INSUFFICIENT_SHORT = '今日盤前資料尚不完整，Morning Alpha 建議先以觀察為主。等待台股 TAIEX、2330 等核心指標更新後，再進行完整盤勢判斷。目前僅有小部分美股與 ADR 資料，不建議依此做出交易決策。開盤後以實際台股走勢為準。';
const DATA_INSUFFICIENT_DETAILED = '今日盤前市場資料不足，Morning Alpha 今日完整判讀無法產出完整分析。以下為目前可確認的資訊與限制。\n\n一、資料現況\n目前僅取得部分美股市場資料，台股核心指標（TAIEX 加權指數、2330 台積電現股、TXF 台指期）尚未更新。這對台股盤前判斷構成重大限制——美股 ADR 走勢雖有參考價值，但不能直接推論為台股開盤方向。\n\n二、可觀察方向\n若美股 NVDA、TSM ADR 明顯走揚，可能帶動半導體族群開盤偏強；但若台股開盤後量能不足或外資轉向，仍可能回落。\n\n三、今日建議\n以觀察為主，不建議在資料不足時建立方向性部位。優先等待以下資料到位：\n1. TAIEX 加權指數開盤價\n2. 2330 台積電現股開盤價\n3. 台指期（TXF）開盤動能\n4. 三大法人買賣超\n\n四、何時更新\n系統將在取得足夠資料後自動重新評估。請於 09:15 後回來查看完整今日判讀。';

// ==================== MAIN ENGINE ====================

export function generatePremiumReport(
  report: Report | null,
  marketData: SupabaseMarketData[] | null,
  marketNews: PremiumNewsItem[] | null,
  intelligence: IntelligenceResult | null,
): PremiumReportResult {
  const now = new Date().toISOString();
  const reportDate = report?.report_date || formatTaipeiDate();
  const isDataSufficient = intelligence?.is_data_sufficient ?? false;

  // Build each section
  const oneLineConclusion = buildOneLineConclusion(report, intelligence, marketData, isDataSufficient);
  const topThreeThings = buildTopThreeThings(report, intelligence, marketNews, marketData, isDataSufficient);
  const affectedSectors = buildAffectedSectors(report, intelligence, marketNews, marketData, isDataSufficient);
  const stocksToWatch = buildStocksToWatch(report, marketNews, marketData, intelligence, isDataSufficient);
  const riskReminders = buildRiskReminders(report, intelligence, marketNews, marketData, isDataSufficient);
  const scenarios = buildScenarios(report, intelligence, marketData, isDataSufficient);
  const shortVersion = buildShortVersion(report, intelligence, oneLineConclusion, topThreeThings, isDataSufficient);
  const detailedVersion = buildDetailedVersion(report, intelligence, marketNews, marketData, oneLineConclusion, topThreeThings, affectedSectors, riskReminders, scenarios, isDataSufficient);
  const dataQuality = buildDataQualityMark(report, intelligence, marketData, marketNews, isDataSufficient);

  return {
    oneLineConclusion,
    topThreeThings,
    affectedSectors,
    stocksToWatch,
    riskReminders,
    scenarios,
    shortVersion,
    detailedVersion,
    dataQuality,
    generatedAt: now,
    reportDate,
    isDataSufficient,
  };
}

// ==================== SECTION BUILDERS ====================

function buildOneLineConclusion(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  marketData: SupabaseMarketData[] | null,
  isDataSufficient: boolean,
): string {
  if (!report) return '今日報告尚未產生，請於 07:30 後回來查看。';

  if (!isDataSufficient) {
    if (intelligence?.missing_categories && intelligence.missing_categories.length > 0) {
      const missing = intelligence.missing_categories.slice(0, 2).join('、');
      return `今日盤前資料不足（缺少${missing}），暫不判定方向，以觀察為主。`;
    }
    return DATA_INSUFFICIENT_ONE_LINE;
  }

  // Build from report + intelligence
  const parts: string[] = [];
  const bias = intelligence?.market_direction_label || report.market_bias || '觀察中';

  if (bias.includes('偏多') && !bias.includes('偏弱') && !bias.includes('偏空')) {
    parts.push('今天盤勢偏多');
    const drivers = report.key_drivers || [];
    if (drivers.length > 0) {
      parts.push(`${drivers.slice(0, 2).join('與')}為主要動能`);
    }
  } else if (bias.includes('偏弱') || bias.includes('偏空')) {
    parts.push('今天盤勢偏保守');
    const risk = report.risk_reason;
    if (risk) {
      parts.push(risk.length > 30 ? `${risk.slice(0, 30)}...` : risk);
    }
  } else if (bias.includes('震盪')) {
    parts.push('今天盤勢震盪');
    parts.push('方向尚待確認');
  } else {
    parts.push('今天盤勢觀察中');
    parts.push('等待更多訊號確認');
  }

  // Add key observations from market data
  if (marketData && marketData.length > 0 && isDataSufficient) {
    const nvda = marketData.find((d) => d.symbol === 'NVDA');
    const tsm = marketData.find((d) => d.symbol === 'TSM');
    if (nvda && tsm) {
      const nvdaUp = nvda.change_percent > 0;
      const tsmUp = tsm.change_percent > 0;
      if (nvdaUp && tsmUp) {
        parts.push('AI 供應鏈與半導體族群偏強');
      } else if (!nvdaUp && !tsmUp) {
        parts.push('AI族群承壓');
      } else {
        parts.push('AI族群分歧');
      }
    }
    // Check 2330
    const tsmcTw = marketData.find((d) => d.symbol === '2330');
    if (tsmcTw) {
      parts.push(`短線觀察台積電與大型權值股`);
    }
  }

  // Ensure it ends with a period
  let result = parts.join('，') + '。';
  // Clean up consecutive punctuation
  result = result.replace(/[，。]{2,}/g, '。');
  result = result.replace(/^[，。]+/, '');
  return result;
}

function buildTopThreeThings(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  marketNews: PremiumNewsItem[] | null,
  marketData: SupabaseMarketData[] | null,
  isDataSufficient: boolean,
): TopThing[] {
  if (!report) return [];

  const things: TopThing[] = [];

  if (!isDataSufficient) {
    things.push({
      rank: 1,
      title: '資料不足，等待三項資料確認',
      detail: '目前核心資料命中不足，需要等待以下資料到位：TAIEX 加權指數、2330 台積電、台指期。資料到位後系統將自動更新判斷。',
      reason: `核心資料命中 ${intelligence?.core_data_hits ?? 0}/${intelligence?.core_data_total ?? 4} 類`,
    });
    things.push({
      rank: 2,
      title: '可觀察美股 ADR 方向',
      detail: '若 NVDA、TSM ADR 有明顯方向，可做為台股開盤後的參考，但不可直接推論。',
      reason: '美股 ADR 為少數可用資料',
    });
    things.push({
      rank: 3,
      title: '今日以觀察為主，不建倉',
      detail: '在台股核心資料補齊前，不建議建立方向性部位。優先以風險控管為首要任務。',
      reason: '風險優先原則',
    });
    return things;
  }

  // 1. Market direction
  const bias = intelligence?.market_direction_label || report.market_bias || '觀察中';
  things.push({
    rank: 1,
    title: `今日市場方向：${bias}`,
    detail: `${intelligence?.main_reason || ''} 判讀把握度 ${intelligence?.safe_confidence ?? report.confidence_score ?? 0}/100。`,
    reason: intelligence?.main_reason || '盤前 AI 綜合判斷',
  });

  // 2. Key drivers
  const drivers = report.key_drivers || [];
  if (drivers.length > 0) {
    things.push({
      rank: 2,
      title: `盤前主線：${drivers.slice(0, 2).join('、')}`,
      detail: drivers.length >= 3
        ? `AI 判斷 ${drivers.join('、')} 為今日核心主軸。開盤後觀察相關族群動能是否延續。`
        : `AI 判斷 ${drivers.join('、')} 為今日核心主軸。`,
      reason: 'AI 盤前主線判斷',
    });
  } else {
    // From news
    const topNews = (marketNews || [])
      .filter((n) => n.isSelected)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 3);
    if (topNews.length > 0) {
      things.push({
        rank: 2,
        title: `今日關鍵新聞：${topNews[0].title.slice(0, 40)}`,
        detail: topNews.map((n) => `· ${n.title.slice(0, 50)}${n.title.length > 50 ? '...' : ''}`).join('\n'),
        reason: '高分新聞判斷',
      });
    } else {
      things.push({
        rank: 2,
        title: '等待更多市場訊號',
        detail: '目前無明確主線訊號，建議等待開盤後觀察資金流向。',
        reason: '訊號不足',
      });
    }
  }

  // 3. Risk / Warning
  const risk = intelligence?.risk_reason || report.risk_reason;
  if (risk && risk.length > 0) {
    things.push({
      rank: 3,
      title: '主要風險提醒',
      detail: risk.length > 120 ? `${risk.slice(0, 120)}...` : risk,
      reason: '風險評估',
    });
  } else {
    things.push({
      rank: 3,
      title: '保持紀律，遵守停損',
      detail: '今日無明確重大風險，但仍需遵守停損紀律。市場永遠是對的，判斷錯誤時果斷認賠。',
      reason: '風險管理',
    });
  }

  return things;
}

function buildAffectedSectors(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  marketNews: PremiumNewsItem[] | null,
  marketData: SupabaseMarketData[] | null,
  isDataSufficient: boolean,
): AffectedSector[] {
  if (!report) return [];

  const sectors: Map<string, AffectedSector> = new Map();

  if (!isDataSufficient) {
    // Only list sectors from limited data, mark as neutral
    if (marketData && marketData.length > 0) {
      const semiData = marketData.filter((d) => ['NVDA', 'TSM', 'SOX'].includes(d.symbol));
      if (semiData.length > 0) {
        const anyDown = semiData.some((d) => d.change_percent < 0);
        sectors.set('半導體', {
          name: '半導體',
          direction: anyDown ? 'bearish' : 'neutral',
          impactLevel: 'medium',
          reason: '僅有部分美股 ADR 資料，台股實際走勢待確認',
        });
      }
    }
    sectors.set('整體市場', {
      name: '整體市場',
      direction: 'neutral',
      impactLevel: 'medium',
      reason: '資料不足，無法判斷方向',
    });
    return Array.from(sectors.values());
  }

  // From report watch sectors
  const watchSectors = report.watch_sectors_json || [];
  watchSectors.forEach((ws) => {
    const dir = ws.direction?.includes('空') || ws.direction?.includes('弱') ? 'bearish' as const
      : ws.direction?.includes('多') || ws.direction?.includes('強') ? 'bullish' as const
      : 'neutral' as const;
    sectors.set(ws.sector, {
      name: ws.sector,
      direction: dir,
      impactLevel: 'medium',
      reason: ws.reason || 'AI 盤前判斷',
    });
  });

  // From intelligence watch/avoid sectors
  const watchSectorsIntel = intelligence?.watch_sectors || [];
  watchSectorsIntel.forEach((s) => {
    if (!sectors.has(s)) {
      sectors.set(s, {
        name: s,
        direction: 'bullish',
        impactLevel: 'medium',
        reason: '盤前主線判斷',
      });
    }
  });

  // From news categories
  if (marketNews && marketNews.length > 0) {
    const catCounts = new Map<string, number>();
    marketNews.forEach((n) => {
      if (n.category && n.category !== 'Other') {
        catCounts.set(n.category, (catCounts.get(n.category) || 0) + 1);
      }
    });

    // Map common categories to Chinese sector names
    const catMap: Record<string, string> = {
      'Semiconductor': '半導體',
      'AI': 'AI 伺服器',
      'Tech': '科技',
      'Finance': '金融',
      'Shipping': '航運',
      'Energy': '能源',
      'Tourism': '觀光',
      'Manufacturing': '製造業',
      'Healthcare': '生技醫療',
      'Retail': '零售',
    };

    [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([cat, count]) => {
        const name = catMap[cat] || cat;
        if (!sectors.has(name)) {
          sectors.set(name, {
            name,
            direction: 'neutral',
            impactLevel: count >= 3 ? 'high' : count >= 2 ? 'medium' : 'low',
            reason: `${count} 則相關新聞提及`,
          });
        }
      });
  }

  // From market data
  if (marketData && marketData.length > 0) {
    const semiSymbols = ['NVDA', 'TSM', 'SOX', 'SMH'];
    const semiData = marketData.filter((d) => semiSymbols.includes(d.symbol));
    const semiUp = semiData.filter((d) => d.change_percent > 0.5).length;
    const semiDown = semiData.filter((d) => d.change_percent < -0.5).length;
    if (semiData.length > 0) {
      const existing = sectors.get('半導體');
      if (!existing || existing.direction === 'neutral') {
        sectors.set('半導體', {
          name: '半導體',
          direction: semiUp > semiDown ? 'bullish' : semiDown > semiUp ? 'bearish' : 'neutral',
          impactLevel: 'high',
          reason: `美股半導體指標：${semiUp} 漲 ${semiDown} 跌`,
        });
      }
    }
  }

  // Dedup: only keep unique by normalized name
  const seenNames = new Set<string>();
  const deduped = Array.from(sectors.values()).filter((s) => {
    const key = normalizeStockKey(s.name);
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });
  return deduped.slice(0, 8);
}

function buildStocksToWatch(
  report: Report | null,
  marketNews: PremiumNewsItem[] | null,
  marketData: SupabaseMarketData[] | null,
  intelligence: IntelligenceResult | null,
  isDataSufficient: boolean,
): StockToWatch[] {
  if (!report) return [];

  const stocks: Map<string, StockToWatch> = new Map();

  if (!isDataSufficient) {
    return [];
  }

  // From report focus_stock_json — real data only, no hardcoded scores
  const focusStocks = report.focus_stock_json || [];
  focusStocks.slice(0, 6).forEach((fs) => {
    const key = normalizeStockKey(fs.group);
    if (!stocks.has(key)) {
      stocks.set(key, {
        name: fs.group,
        ticker: '',
        sector: fs.group,
        direction: fs.direction?.includes('觀') ? 'observe' : fs.direction?.includes('防') ? 'defense' : 'attack',
        reason: fs.reason || '報告所列觀察標的',
        confidence: fs.confidence ?? 0,
        source: 'report',
      });
    }
  });

  // From news related TW names — only if confidence data exists naturally
  if (marketNews && marketNews.length > 0) {
    marketNews
      .filter((n) => n.isSelected)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 6)
      .forEach((n) => {
        (n.relatedTwNames || []).forEach((name) => {
          const key = normalizeStockKey(name);
          if (!stocks.has(key)) {
            stocks.set(key, {
              name,
              ticker: '',
              sector: n.category || 'Other',
              direction: n.finalScore >= 80 ? 'attack' : 'observe',
              reason: n.title.slice(0, 60),
              confidence: n.finalScore,
              source: 'news',
            });
          }
        });
      });
  }

  // From market data — only show actual tickers with real data
  if (marketData && marketData.length > 0) {
    const twStocks = marketData.filter((d) => d.market === 'TW' || d.symbol === '2330' || d.symbol === 'TAIEX');
    twStocks.sort((a, b) => Math.abs(b.change_percent) - Math.abs(a.change_percent))
      .slice(0, 5)
      .forEach((d) => {
        const key = normalizeStockKey(d.name || d.symbol);
        if (!stocks.has(key)) {
          stocks.set(key, {
            name: d.name || d.symbol,
            ticker: d.symbol,
            sector: d.market || '台股',
            direction: d.change_percent > 0 ? 'attack' : d.change_percent < -1 ? 'defense' : 'observe',
            reason: `變動 ${d.change_percent >= 0 ? '+' : ''}${d.change_percent.toFixed(2)}%`,
            confidence: Math.abs(d.change_percent) * 10,
            source: 'market_data',
          });
        }
      });
  }

  return Array.from(stocks.values()).slice(0, 12);
}

function buildRiskReminders(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  marketNews: PremiumNewsItem[] | null,
  marketData: SupabaseMarketData[] | null,
  isDataSufficient: boolean,
): RiskReminder[] {
  const reminders: RiskReminder[] = [];

  if (!report) return [];

  // Data insufficient risk
  if (!isDataSufficient) {
    reminders.push({
      title: '資料不足風險',
      level: 'high',
      description: intelligence?.missing_categories
        ? `缺少核心資料：${intelligence.missing_categories.join('、')}。台股本地資料缺失，不可據此做出方向性交易決策。`
        : '市場資料不足，不具備完整盤前判斷條件。任何方向性結論都可能誤導。',
      source: '資料品質檢查',
    });
    return reminders;
  }

  // From report risk factors
  const riskFactors = report.risk_factors_json || [];
  riskFactors.forEach((rf) => {
    reminders.push({
      title: rf.title,
      level: rf.level,
      description: rf.description,
      source: 'AI 風險評估',
    });
  });

  // From intelligence
  if (intelligence?.risk_reason && intelligence.risk_reason.length > 0) {
    reminders.push({
      title: '綜合風險提醒',
      level: 'medium',
      description: intelligence.risk_reason,
      source: 'Intelligence Engine',
    });
  }

  // From market data negative signals
  if (marketData && marketData.length > 0) {
    const majorDown = marketData.filter(
      (d) => d.change_percent < -1 && ['NVDA', 'TSM', 'SPX', 'SOX'].includes(d.symbol),
    );
    if (majorDown.length >= 2) {
      reminders.push({
        title: '美股半導體指標偏弱',
        level: 'high',
        description: `${majorDown.map((d) => d.symbol).join('、')} 跌幅超過 1%，短線反轉風險升高。留意台股開盤後半導體族群賣壓。`,
        source: 'market_data',
      });
    } else if (majorDown.length === 1) {
      reminders.push({
        title: '個別指標偏弱',
        level: 'medium',
        description: `${majorDown[0].symbol} 跌幅 ${majorDown[0].change_percent.toFixed(2)}%，觀察是否拖累相關族群。`,
        source: 'market_data',
      });
    }
  }

  // From news
  if (marketNews && marketNews.length > 0) {
    const riskNews = marketNews.filter(
      (n) => n.title.includes('跌') || n.title.includes('弱') || n.title.includes('風險') || n.title.includes('警告'),
    );
    if (riskNews.length > 0) {
      reminders.push({
        title: '新聞面風險訊號',
        level: 'medium',
        description: riskNews.slice(0, 3).map((n) => n.title).join('；'),
        source: 'market_news',
      });
    }
  }

  // Add baseline reminder with better text
  reminders.push({
    title: '常態觀察',
    level: 'low',
    description: '目前未偵測到重大單一風險，但仍需等待開盤後確認。市場永遠有可能出現意外事件。所有 AI 判斷僅供參考，不構成買賣建議。',
    source: '系統提示',
  });

  return reminders.slice(0, 8);
}

function buildScenarios(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  marketData: SupabaseMarketData[] | null,
  isDataSufficient: boolean,
): MarketScenarios {
  if (!report || !isDataSufficient) {
    return {
      bullish: {
        label: '樂觀劇本',
        probability: 20,
        description: '資料不足，無法建立樂觀劇本。等待核心資料補齊。',
        trigger: '待資料補齊後評估',
      },
      neutral: {
        label: '中性劇本',
        probability: 60,
        description: '以觀察為主，等待市場訊號明確。不在資料不足時猜方向。',
        trigger: '等待開盤後市場方向確認',
      },
      bearish: {
        label: '保守劇本',
        probability: 20,
        description: '資料不足時以風險控管為優先。不建立方向性部位。',
        trigger: '若開盤後指數明顯走弱，維持觀望',
      },
    };
  }

  const bias = intelligence?.market_direction_label || report.market_bias || '觀察中';
  const drivers = (report.key_drivers || []).slice(0, 2).join('、');
  const risk = report.risk_reason || '無明確重大風險';
  const confidence = intelligence?.safe_confidence ?? report.confidence_score ?? 60;

  // Determine probability distribution
  let bullProb: number;
  let neutralProb: number;
  let bearProb: number;

  if (bias.includes('偏多') && !bias.includes('偏弱') && !bias.includes('偏空')) {
    bullProb = Math.min(confidence - 10, 60);
    neutralProb = 30;
    bearProb = 100 - bullProb - neutralProb;
  } else if (bias.includes('偏弱') || bias.includes('偏空')) {
    bearProb = Math.min(confidence - 10, 60);
    neutralProb = 30;
    bullProb = 100 - bearProb - neutralProb;
  } else {
    bullProb = 30;
    neutralProb = 40;
    bearProb = 30;
  }

  // Determine which scenario has triggers from market data
  let bullishTrigger = '開盤後確認動能延續，量能放大';
  let bearishTrigger = '開盤後指標轉弱，量能萎縮';

  if (marketData && marketData.length > 0) {
    const nvda = marketData.find((d) => d.symbol === 'NVDA');
    const tsm = marketData.find((d) => d.symbol === 'TSM');
    if (nvda && tsm) {
      if (nvda.change_percent > 2 && tsm.change_percent > 2) {
        bullishTrigger = 'NVDA 與 TSM 同步大漲，半導體族群若開盤後延續動能，可望帶動大盤';
      } else if (nvda.change_percent < -1 || tsm.change_percent < -1) {
        bearishTrigger = 'NVDA 或 TSM 走弱，若台積電開盤跟跌，大盤將承壓';
      }
    }
  }

  return {
    bullish: {
      label: '樂觀劇本',
      probability: bullProb,
      description: drivers
        ? `${drivers}帶動大盤走強，開盤後若量能放大、權值股買盤積極，指數有機會挑戰前高。把握度來自 ${drivers} 的盤前訊號。`
        : '市場開盤後走強，權值股帶動大盤向上。若量能放大、買盤積極，指數有機會挑戰前高。',
      trigger: bullishTrigger,
    },
    neutral: {
      label: '中性劇本',
      probability: neutralProb,
      description: '市場開盤後狹幅震盪，方向尚待確認。主流族群內部分化，資金輪動快速。可在確認方向後再調整部位。',
      trigger: '開盤後 30 分鐘內無明確方向，維持觀望',
    },
    bearish: {
      label: '保守劇本',
      probability: bearProb,
      description: risk
        ? `${risk.slice(0, 50)}${risk.length > 50 ? '...' : ''} 可能造成市場轉弱。若開盤後指數明顯走弱，應優先控風險。短線以防守觀察為主，不追多。`
        : '市場開盤後走弱，多數權值股下跌。若指數跌破關鍵支撐，應優先控風險。短線以防守觀察為主。',
      trigger: bearishTrigger,
    },
  };
}

function buildShortVersion(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  oneLine: string,
  topThree: TopThing[],
  isDataSufficient: boolean,
): string {
  if (!report) return '今日報告尚未產生。Morning Alpha 每天 07:30 自動生成盤前分析，請稍後再回來查看。';

  if (!isDataSufficient) return DATA_INSUFFICIENT_SHORT;

  // Build concise summary: one-line + top 3 condensed
  const parts: string[] = [oneLine];
  topThree.forEach((t) => {
    parts.push(`${t.title}：${t.detail.slice(0, 80)}`);
  });

  const result = parts.join(' ');
  // Trim to roughly 150 Chinese characters
  return result.length > 200 ? `${result.slice(0, 197)}...` : result;
}

function buildDetailedVersion(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  marketNews: PremiumNewsItem[] | null,
  marketData: SupabaseMarketData[] | null,
  oneLine: string,
  topThree: TopThing[],
  affectedSectors: AffectedSector[],
  riskReminders: RiskReminder[],
  scenarios: MarketScenarios,
  isDataSufficient: boolean,
): string {
  if (!report) return '今日報告尚未產生，無法建立詳細版分析。請於 07:30 後回來查看 Morning Alpha 今日完整判讀。';
  if (!isDataSufficient) return DATA_INSUFFICIENT_DETAILED;

  const sections: string[] = [];

  // Title
  sections.push(`Morning Alpha 今日完整判讀 — ${report.report_date}`);

  // 1. Conclusion
  sections.push('\n一、今日盤勢結論');
  sections.push(oneLine);

  // 2. Top 3
  sections.push('\n二、今日三件最重要的事');
  topThree.forEach((t) => {
    sections.push(`${t.rank}. ${t.title}`);
    sections.push(`   ${t.detail}`);
  });

  // 3. Affected sectors
  if (affectedSectors.length > 0) {
    sections.push('\n三、今日可能受影響產業');
    affectedSectors.forEach((s) => {
      const dirLabel = s.direction === 'bullish' ? '看多' : s.direction === 'bearish' ? '看空' : '中性';
      sections.push(`· ${s.name}（${dirLabel}）：${s.reason}`);
    });
  }

  // 4. Risk
  if (riskReminders.length > 0) {
    sections.push('\n四、今日風險提醒');
    riskReminders.forEach((r) => {
      const levelLabel = r.level === 'high' ? '⚠️ 高' : r.level === 'medium' ? '⚡ 中' : 'ℹ️ 低';
      sections.push(`· [${levelLabel}] ${r.title}`);
      sections.push(`  ${r.description}`);
    });
  }

  // 5. Scenarios
  sections.push('\n五、今日劇本分析');
  sections.push(`樂觀劇本（機率 ${scenarios.bullish.probability}%）：${scenarios.bullish.description}`);
  sections.push(`觸發條件：${scenarios.bullish.trigger}`);
  sections.push(`中性劇本（機率 ${scenarios.neutral.probability}%）：${scenarios.neutral.description}`);
  sections.push(`保守劇本（機率 ${scenarios.bearish.probability}%）：${scenarios.bearish.description}`);
  sections.push(`觸發條件：${scenarios.bearish.trigger}`);

  // 6. Key market data
  if (marketData && marketData.length > 0) {
    sections.push('\n六、關鍵市場數據');
    const keySymbols = ['NVDA', 'TSM', 'SPX', 'SOX', 'VIX', 'DXY', '2330', 'TAIEX'];
    marketData
      .filter((d) => keySymbols.includes(d.symbol))
      .sort((a, b) => keySymbols.indexOf(a.symbol) - keySymbols.indexOf(b.symbol))
      .forEach((d) => {
        const pctStr = d.change_percent >= 0 ? `+${d.change_percent.toFixed(2)}%` : `${d.change_percent.toFixed(2)}%`;
        sections.push(`· ${d.symbol}（${d.name || d.symbol}）：${d.value}（${pctStr}）`);
      });
  }

  // 7. Key news
  if (marketNews && marketNews.length > 0) {
    sections.push('\n七、重點新聞');
    marketNews
      .filter((n) => n.isSelected)
      .slice(0, 5)
      .forEach((n) => {
        sections.push(`· ${n.title}（${n.source}，重要性 ${n.finalScore}）`);
      });
  }

  // 8. Data quality
  const quality = buildDataQualityMark(report, intelligence, marketData, marketNews, isDataSufficient);
  sections.push(`\n八、資料可信度：${quality.label}（核心資料 ${quality.coreDataHits}/${quality.coreDataTotal} 類，market_data ${quality.marketDataCount} 筆，新聞 ${quality.newsCount} 則）`);

  // 9. Disclaimer
  sections.push('\n⚠️ 免責聲明：本報告為 AI 自動生成，僅供參考，不構成任何買賣建議。投資決策請自行評估風險。');

  return sections.join('\n');
}

function buildDataQualityMark(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  marketData: SupabaseMarketData[] | null,
  marketNews: PremiumNewsItem[] | null,
  isDataSufficient: boolean,
): DataQualityMark {
  const coreDataHits = intelligence?.core_data_hits ?? 0;
  const coreDataTotal = intelligence?.core_data_total ?? 4;
  const marketDataCount = marketData?.length ?? 0;
  const newsCount = marketNews?.length ?? 0;

  if (!report) {
    return {
      level: 'low',
      label: '低可信',
      color: 'text-red-400',
      reason: '報告未生成',
      coreDataHits: 0,
      coreDataTotal,
      marketDataCount,
      newsCount,
      hasReport: false,
    };
  }

  if (!isDataSufficient) {
    const ratio = coreDataHits / coreDataTotal;
    if (ratio >= 0.5) {
      return {
        level: 'medium',
        label: '中可信',
        color: 'text-amber-400',
        reason: `核心資料不足（${coreDataHits}/${coreDataTotal}），缺少 ${intelligence?.missing_categories?.join('、') || '部分類別'}`,
        coreDataHits,
        coreDataTotal,
        marketDataCount,
        newsCount,
        hasReport: true,
      };
    }
    return {
      level: 'low',
      label: '低可信',
      color: 'text-red-400',
      reason: `核心資料嚴重不足（${coreDataHits}/${coreDataTotal}），缺少 ${intelligence?.missing_categories?.join('、') || '多數類別'}`,
      coreDataHits,
      coreDataTotal,
      marketDataCount,
      newsCount,
      hasReport: true,
    };
  }

  // High quality: all core data present, sufficient market_data, fresh news
  if (coreDataHits >= 5 && marketDataCount >= 8 && newsCount >= 5) {
    return {
      level: 'high',
      label: '高可信',
      color: 'text-forest-400',
      reason: `核心資料完整（${coreDataHits}/${coreDataTotal}），market_data ${marketDataCount} 筆，新聞 ${newsCount} 則`,
      coreDataHits,
      coreDataTotal,
      marketDataCount,
      newsCount,
      hasReport: true,
    };
  }

  return {
    level: 'medium',
    label: '中可信',
    color: 'text-amber-400',
    reason: `核心資料 ${coreDataHits}/${coreDataTotal}，market_data ${marketDataCount} 筆，新聞 ${newsCount} 則`,
    coreDataHits,
    coreDataTotal,
    marketDataCount,
    newsCount,
    hasReport: true,
  };
}

// ==================== SECTION ACCESSORS ====================

/**
 * Get just the one-line conclusion for the home page
 */
export function getHomePageSection(premium: PremiumReportResult): {
  headline: string;
  qualityBadge: { level: string; color: string };
} {
  return {
    headline: premium.oneLineConclusion,
    qualityBadge: {
      level: premium.dataQuality.label,
      color: premium.dataQuality.color,
    },
  };
}

/**
 * Get the top 3 things for the war room page
 */
export function getWarRoomSection(premium: PremiumReportResult): {
  topThree: TopThing[];
  isDataSufficient: boolean;
} {
  return {
    topThree: premium.topThreeThings,
    isDataSufficient: premium.isDataSufficient,
  };
}

/**
 * Get the scenario analysis for the strategist page
 */
export function getStrategistSection(premium: PremiumReportResult): {
  scenarios: MarketScenarios;
  affectedSectors: AffectedSector[];
  isDataSufficient: boolean;
} {
  return {
    scenarios: premium.scenarios,
    affectedSectors: premium.affectedSectors,
    isDataSufficient: premium.isDataSufficient,
  };
}

/**
 * Get the full report for the today-report page
 */
export function getTodayReportSection(premium: PremiumReportResult): {
  oneLineConclusion: string;
  topThreeThings: TopThing[];
  affectedSectors: AffectedSector[];
  stocksToWatch: StockToWatch[];
  riskReminders: RiskReminder[];
  scenarios: MarketScenarios;
  shortVersion: string;
  detailedVersion: string;
  dataQuality: DataQualityMark;
  isDataSufficient: boolean;
} {
  return {
    oneLineConclusion: premium.oneLineConclusion,
    topThreeThings: premium.topThreeThings,
    affectedSectors: premium.affectedSectors,
    stocksToWatch: premium.stocksToWatch,
    riskReminders: premium.riskReminders,
    scenarios: premium.scenarios,
    shortVersion: premium.shortVersion,
    detailedVersion: premium.detailedVersion,
    dataQuality: premium.dataQuality,
    isDataSufficient: premium.isDataSufficient,
  };
}
