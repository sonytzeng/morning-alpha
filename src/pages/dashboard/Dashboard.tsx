import { Link } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import type { Report } from '@/types/report';
import {
  getSentimentColor,
  getMarketBiasLabel,
  formatTaipeiDateTime,
} from '@/services/narrativeBuilder';
import { LINE_ADD_FRIEND_URL } from '@/config/brand';
import { trackEvent } from '@/utils/analytics';
import { useLatestReport } from '@/hooks/useLatestReport';
import { getStrategyMode, type OpeningRadar } from '@/services/openingRadarService';
import { deriveMarketHealthScore, getDayStatus, getPremarketDayStatus, getMarketHealthColor } from '@/services/marketHealthScore';
import { isTaipeiWeekendToday } from '@/utils/tradingDay';
import {
  fetchSectorRotationScores,
  groupSectors,
  deriveSectorAdvice,
  getSignalColor,
  computeSectorRotationFreshness,
  type SectorRotationItem,
  type SectorGroups,
  type SectorAdvice,
  type SectorRotationFreshness,
} from '@/services/sectorRotationService';
import type { SupabaseMarketData } from '@/services/marketDataService';
import { getTXFDisplayStatus } from '@/services/marketDataService';

// ── Types ──
interface TopThreeItem {
  number: number;
  title: string;
  detail: string;
}

interface StrategyAdvice {
  title: string;
  approach: string;
  entry: string;
  stopLoss: string;
  confidence: string;
}

// ── Sanitize risk reason ──
function sanitizeRiskReason(riskReason: string | null | undefined, marketData: Array<{ symbol?: string }> | null): string {
  if (!riskReason) return '';
  if (!marketData || marketData.length === 0) return riskReason;
  const symbols = marketData.map((m) => (m.symbol || '').toUpperCase());
  const hasTSM = symbols.includes('TSM');
  const hasNVDA = symbols.includes('NVDA');
  if (hasTSM && hasNVDA && /缺少.*(TSM|NVDA|數據|资料)/.test(riskReason)) {
    return '部分國際資料可能非即時，請以資料可信度雷達為準。';
  }
  return riskReason;
}

// ── Derive top 3 ──
function deriveTopThree(
  report: Report | null,
  displayMode: string,
  displayLabel: string,
  displaySummary: string,
  effectiveBias: string,
  safeAllowAggressive: boolean,
  safeAllowDirectional: boolean,
  isWeekend: boolean,
  isHistoricalFallback: boolean,
  fallbackReportDate: string | null,
  marketData: Array<{ symbol?: string }> | null,
): TopThreeItem[] {
  if (!report) return [];
  if (isWeekend && isHistoricalFallback) {
    const dateStr = fallbackReportDate || '最近交易日';
    return [
      { number: 1, title: '今日市場狀態：等待日', detail: `今天非交易日。顯示${dateStr}的盤前劇本，下一個交易日開盤後更新。` },
      { number: 2, title: '非交易日不追價、不猜方向', detail: '週末消息變化可能影響下個交易日開盤。回看最近交易日劇本，等待下一個交易日再做判斷。' },
      { number: 3, title: '等待下一個交易日', detail: '先觀察國際市場與台指期變化。週末累積的市場情緒，會在週一開盤時一次反映。' },
    ];
  }

  const items: TopThreeItem[] = [];
  let idx = 1;
  const weakDisplays = ['radar_weak', 'radar_very_weak'];
  const isOverridden = weakDisplays.includes(displayMode);
  const isDataInsufficient = (displayMode === 'data_insufficient' || (!report && !safeAllowDirectional)) && !isOverridden;
  const isWeak = displayMode === 'radar_weak' || displayMode === 'radar_very_weak';

  const biasMap: Record<string, string> = {
    '強勢偏多': '盤前 AI 判斷市場方向明確偏多，權值股與主流族群有機會延續動能。',
    '偏多觀察': '市場偏多格局，但台股核心指標不足或盤中訊號不明確，建議觀察後再決策。',
    '中性偏多': '市場在中性格局中略偏多，方向尚待確認。建議等待更明確訊號。',
    '中性震盪': '市場處於震盪格局，方向不明確。建議降低部位，等待方向確認。',
    '偏弱觀察': '市場偏弱壓力增加，防禦型配置優先。優先控風險，暫停追多。',
    '明顯偏弱': '市場空方力道強勁，盤前偏多假設已失效。今日不應追多，等待止穩訊號。',
    '資料不足，暫不判定': '目前核心資料不足，無法判定今日市場方向。建議以觀察為主，不做方向性交易。',
  };

  let statusTitle: string;
  let statusDetail: string;
  if (isDataInsufficient) {
    statusTitle = '今日市場狀態：資料不足，暫不判定';
    statusDetail = '台股核心指標不足。目前僅作資訊觀察，不作完整盤勢結論。等待核心資料補齊後再評估。';
  } else if (isOverridden) {
    statusTitle = displayLabel;
    statusDetail = displaySummary;
  } else {
    statusTitle = `今日市場狀態：${effectiveBias}`;
    statusDetail = biasMap[effectiveBias] || `目前市場方向為 ${effectiveBias}，需觀察開盤後實際動能確認。`;
  }
  items.push({ number: idx++, title: statusTitle, detail: statusDetail });

  if (!isWeak && !isDataInsufficient) {
    const drivers = report.key_drivers || [];
    if (drivers.length > 0) {
      items.push({ number: idx++, title: `主線訊號：${drivers.slice(0, 2).join('、')}`, detail: `盤前判斷 ${drivers.slice(0, 3).join('、')} 為今日核心主軸。開盤後若相關族群動能持續，今日盤勢有機會維持正面格局。` });
    }
  } else if (isDataInsufficient) {
    items.push({ number: idx++, title: '目前僅作資訊觀察 · 不建倉', detail: '資料不足時不宜建立方向性部位。今日以觀察市場為主，等待台股核心資料補齊後再做判斷。' });
  } else {
    items.push({ number: idx++, title: '今日防守觀察 · 不追多', detail: '盤前偏多假設已被開盤後實際走勢推翻。今日重點：觀察權值股是否止跌、降低追價意願、以風險控管為優先。' });
  }

  const rawRiskReason = report.risk_reason;
  const riskReason = sanitizeRiskReason(rawRiskReason, marketData);
  if (isDataInsufficient) {
    items.push({ number: idx++, title: '資料不足 · 等待台股核心資料補齊', detail: '目前僅取得部分美股與 ADR 資料，不能直接推論今日台股開盤方向。等待 TAIEX / 2330 / TXF 資料更新。' });
  } else if (isWeak) {
    items.push({ number: idx++, title: '盤中轉弱 · 優先控風險', detail: '不用盤前新聞硬做多。等待止穩訊號出現再評估，先保護資金安全。' });
  } else if (riskReason) {
    items.push({ number: idx++, title: '主要風險提醒', detail: riskReason.length > 100 ? riskReason.slice(0, 100) + '...' : riskReason });
  } else {
    items.push({ number: idx++, title: '保持紀律', detail: '今日無明確重大風險，但仍需遵守停損紀律。市場永遠是對的，判斷錯誤時果斷認賠。' });
  }

  return items;
}

// ── Derive strategy advice ──
function deriveStrategyAdvice(mode: ReturnType<typeof getStrategyMode>, report: Report | null, isDataInsufficient: boolean): StrategyAdvice[] {
  const strategies: StrategyAdvice[] = [];
  const canWatch = report?.can_watch || [];
  if (isDataInsufficient) {
    strategies.push({ title: '等待資料模式', approach: '台股核心指標不足時，暫不判定方向，仍可觀察類股輪動與市場結構變化。', entry: '等待核心資料（TAIEX、2330、TXF）到位後再評估。', stopLoss: '不建倉，不需設停損。', confidence: '目前資料不足，僅供盤前觀察。' });
    return strategies;
  }
  strategies.push({ title: '積極模式', approach: canWatch.length > 0 ? `集中火力於 ${canWatch.slice(0, 2).join('、')} 等主流方向，可在確認開盤動能後加碼。` : '可積極布局主流族群，追蹤權值股與題材股的輪動節奏。', entry: '開盤後 15 分鐘確認動能後分批進場。', stopLoss: '個股跌破開盤價 2% 或大盤跌破開盤價 1% 減碼。', confidence: '需高市場共識與量能配合。' });
  strategies.push({ title: '觀察模式', approach: canWatch.length > 0 ? `以 ${canWatch.slice(0, 3).join('、')} 為核心觀察方向，搭配部分防禦型配置。` : '均衡配置，以主流族群為核心，搭配適量防禦型持股。', entry: '等待開盤後方向確認再分批進場，不急於搶進。', stopLoss: '個股跌破前日收盤價 3% 或大盤跌破 5 日線減碼。', confidence: '適合大多數交易日。' });
  strategies.push({ title: '防守模式', approach: '現金為王，持股部位控制在 3 成以下。優先控風險，降低追價意願。', entry: '僅在有明確止穩訊號時少量試單。', stopLoss: '任何持股跌破成本 2% 立即出場，不留倉。', confidence: '風險優先，寧可少賺不願多賠。' });
  return strategies;
}

// ── Helper: within 12 hours check ──
function isWithin12Hours(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return diffMs >= 0 && diffMs <= 12 * 60 * 60 * 1000;
}

function getTaipeiDateStringHelper(dateStr: string): string {
  const d = new Date(dateStr);
  const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return `${tw.getFullYear()}-${String(tw.getMonth() + 1).padStart(2, '0')}-${String(tw.getDate()).padStart(2, '0')}`;
}

// ════════════════════════════════════════════
// DYNAMIC CONTENT GENERATORS
// ════════════════════════════════════════════

/** Generate "現在不適合做什麼" list from market data + bias */
function generateDontDoList(
  marketBias: string | null | undefined,
  marketData: Array<{ symbol?: string; change_percent?: number }> | null,
  openingRadar: OpeningRadar | null,
  hasTXF: boolean,
  sectorStrongCount: number,
): string[] {
  const bias = marketBias || '';
  const radarStatus = openingRadar?.radar_status || '';
  const isWeak = bias.includes('弱') || bias.includes('防守') || bias.includes('風險')
    || radarStatus === '明顯偏弱' || radarStatus === '盤中轉弱';

  const items: string[] = [];
  items.push('不適合追高、搶反彈');

  if (isWeak) {
    items.push('不適合重倉押單一方向');
    items.push('不適合看到反彈就當作轉強');
  }

  if (!hasTXF) {
    items.push('不適合用盤中訊號做過度確認（TXF 暫缺降低確認度）');
  }

  // Check SOX/NVDA/TSM/SPX majority down
  const keySymbols = ['SOX', 'NVDA', 'TSM', 'SPX'];
  const downCount = (marketData || []).filter((md) => {
    const sym = (md.symbol || '').toUpperCase();
    return keySymbols.includes(sym) && (md.change_percent ?? 0) < 0;
  }).length;

  if (downCount >= 3) {
    items.push('不適合用國際強勢當作台股做多理由');
  }

  if (sectorStrongCount === 0 && !isWeak) {
    items.push('不適合在無明顯主流時押注單一族群');
  }

  return items.slice(0, 4);
}

/** Generate "現在應該看什麼" list from market data + sector rotation */
function generateShouldWatchList(
  marketBias: string | null | undefined,
  marketData: Array<{ symbol?: string; change_percent?: number; name?: string }> | null,
  sectorStrongItems: SectorRotationItem[],
  hasTXF: boolean,
  openingRadar: OpeningRadar | null,
): string[] {
  const bias = marketBias || '';
  const radarStatus = openingRadar?.radar_status || '';
  const isWeak = bias.includes('弱') || bias.includes('防守') || bias.includes('風險')
    || radarStatus === '明顯偏弱' || radarStatus === '盤中轉弱';

  const items: string[] = [];

  const taiex = marketData?.find((md) => (md.symbol || '').toUpperCase() === 'TAIEX');
  const tsmc = marketData?.find((md) => (md.symbol || '') === '2330');

  if (taiex && (taiex.change_percent ?? 0) < -0.3) {
    items.push('權值股是否止跌');
  }

  if (tsmc && (tsmc.change_percent ?? 0) < -0.3) {
    items.push('台積電是否收斂跌幅');
  }

  // Sector rotation observations
  if (sectorStrongItems.length > 0 && isWeak) {
    const names = sectorStrongItems.slice(0, 3).map((s) => s.sector).join('、');
    items.push(`${names}等防守型類股是否延續抗跌`);
  }

  if (sectorStrongItems.length > 0) {
    items.push('高分類股是否只是相對抗跌，不代表可以追價');
  }

  if (!hasTXF) {
    items.push('關注開盤後 TAIEX 與 2330 實際走勢（TXF 暫缺）');
  }

  // Fallback
  if (items.length === 0) {
    items.push('權值股與主流族群開盤後方向');
    items.push('成交量是否放大確認');
  }

  return items.slice(0, 4);
}

/** Generate AI 軍師建議 (human-readable condition-based advice) */
function generateAIAdvice(
  marketBias: string | null | undefined,
  openingRadar: OpeningRadar | null,
  sectorStrongItems: SectorRotationItem[],
  isDataInsufficient: boolean,
): string {
  const bias = marketBias || '';
  const radarStatus = openingRadar?.radar_status || '';
  const isHighRisk = bias.includes('高風險') || bias.includes('明顯偏弱') || radarStatus === '明顯偏弱';
  const isWeak = isHighRisk || bias.includes('偏弱') || bias.includes('防守') || radarStatus === '盤中轉弱';
  const isNeutral = bias.includes('中性') || bias.includes('震盪');
  const isBullish = bias.includes('偏多') || bias.includes('強勢');

  if (isDataInsufficient) {
    return '目前資料不足，不做方向性判斷。請等待市場資料、類股輪動與新聞更新後再重新整理。';
  }

  if (isHighRisk || isWeak) {
    const strongNames = sectorStrongItems.length > 0
      ? sectorStrongItems.slice(0, 3).map((s) => s.sector).join('、')
      : '相對抗跌族群';
    return `今天以風險控管優先。盤前與盤中訊號偏弱時，不要急著找多方題材；先觀察權值股跌幅是否收斂、台積電是否止穩，以及${strongNames}是否能撐到盤中後段。`;
  }

  if (isNeutral) {
    return '今天不是明確進攻盤，重點是確認主流是否延續。若高分族群能維持相對強勢，再考慮納入觀察；若大盤轉弱，優先降低追價。';
  }

  if (isBullish) {
    return '今天可觀察主流族群延續性，但仍需確認成交量與權值股同步，避免只看題材股表現。';
  }

  return '今天以觀察為主，不急於進場。等待開盤後確認方向再決定策略。';
}

/** Get news impact category label */
function getNewsImpactLabel(news: { category?: string; relatedTwNames?: string[]; affectedMarket?: string }): string {
  const cat = (news.category || '').toLowerCase();
  const market = (news.affectedMarket || '').toLowerCase();
  const twNames = news.relatedTwNames || [];

  if (cat.includes('semiconductor') || market.includes('半導体') || market.includes('semiconductor')
    || twNames.some((n) => n.includes('半導'))) {
    return '半導體';
  }
  if (cat.includes('ai') || market.includes('ai') || twNames.some((n) => n.includes('AI'))) {
    return 'AI';
  }
  if (market.includes('台股') || market.includes('taiwan') || market.includes('taipei')) {
    return '台股';
  }
  if (market.includes('匯率') || market.includes('currency') || market.includes('forex') || market.includes('dxy')) {
    return '匯率';
  }
  if (market.includes('利率') || market.includes('rate') || market.includes('fed') || market.includes('treasury')) {
    return '利率';
  }
  if (market.includes('原油') || market.includes('oil') || market.includes('commodity') || market.includes('原物料')) {
    return '原物料';
  }
  if (market.includes('全球') || market.includes('global') || market.includes('風險') || market.includes('risk')) {
    return '全球風險';
  }
  if (twNames.length > 0) {
    return '台股相關';
  }
  return '一般市場新聞';
}

/** Build overnight highlights from raw market_news — max 3, Chinese-only, free-tier friendly */
interface OvernightHighlight {
  title: string;
  impactDirection: string;
  intradayNote: string;
}

function buildOvernightHighlights(
  newsItems: Array<{
    category?: string;
    title: string;
    impactSummary?: string;
    affectedSector?: string;
    relatedTwNames?: string[];
    affectedMarket?: string;
  }>,
  marketBias: string | null | undefined,
): OvernightHighlight[] {
  if (!newsItems || newsItems.length === 0) return [];

  const CATEGORY_CN: Record<string, string> = {
    Semiconductor: '半導體',
    AI: 'AI 與雲端',
    Finance: '金融',
    Shipping: '航運',
    Oil: '能源與原物料',
    Macro: '總經與利率',
    Tech: '科技硬體',
    Geopolitical: '地緣政治',
    Currency: '匯率',
    Other: '全球市場',
  };

  // Group by category
  const groups: Record<string, typeof newsItems> = {};
  for (const item of newsItems) {
    const cat = item.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  // Sort groups by size descending
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  // Bias-based default direction phrases
  const isBullish = marketBias?.includes('偏多') || marketBias?.includes('強勢');
  const isBearish = marketBias?.includes('偏弱') || marketBias?.includes('防守');

  const highlights: OvernightHighlight[] = [];

  for (const [cat, items] of sorted) {
    if (highlights.length >= 3) break;
    const cnSector = CATEGORY_CN[cat] || cat;

    // Collect Chinese impact summaries if available
    const chineseSummary = items.find((n) => {
      const s = n.impactSummary || '';
      return /[\u4e00-\u9fff]/.test(s);
    })?.impactSummary || '';

    // Collect related TW names
    const twNamesAll = [...new Set(items.flatMap((n) => n.relatedTwNames || []))].slice(0, 3);

    // Collect affected sectors
    const sectors = [...new Set(items.filter((n) => n.affectedSector).map((n) => n.affectedSector!))].slice(0, 3);

    // Build title
    let title: string;
    if (cat === 'Semiconductor') {
      title = 'AI 晶片與客製化運算需求仍強';
    } else if (cat === 'AI') {
      title = 'AI 雲端資本支出與伺服器需求延續';
    } else if (cat === 'Finance') {
      title = '金融股與利率環境變動';
    } else if (cat === 'Macro') {
      title = '總經指標與市場情緒變動';
    } else if (cat === 'Shipping') {
      title = '運價與航運供需變化';
    } else {
      title = `${cnSector}相關新聞重點`;
    }

    // Build impact direction
    let impactDirection: string;
    const sectorList = sectors.length > 0 ? sectors.join('、') : cnSector;
    if (chineseSummary && chineseSummary.length > 5) {
      impactDirection = chineseSummary.length > 60 ? chineseSummary.slice(0, 60) + '...' : chineseSummary;
    } else if (isBullish) {
      impactDirection = `${sectorList}偏正向觀察，若開盤後權值股同步走強，有機會延續。`;
    } else if (isBearish) {
      impactDirection = `${sectorList}需觀察是否有賣壓，短線以防守配置優先。`;
    } else {
      impactDirection = `${sectorList}方向待開盤確認，目前以觀察為主。`;
    }

    // Build intraday note
    let intradayNote: string;
    if (twNamesAll.length > 0) {
      const stockList = twNamesAll.join('、');
      intradayNote = `若台積電與台指期同步強勢，偏多假設成立機率提高；觀察${stockList}等代表股是否延續隔夜趨勢，若只有單一族群上漲，需降低判斷強度。`;
    } else if (cat === 'Semiconductor' || cat === 'AI') {
      intradayNote = '若台積電與台指期同步強勢，偏多假設成立機率提高；若只有單一族群上漲，需降低判斷強度。';
    } else if (cat === 'Finance') {
      intradayNote = '觀察金融指數與大盤是否同步，若金融股逆勢走強，可能代表資金避險而非全面樂觀。';
    } else {
      intradayNote = '開盤後觀察相關族群是否有量能承接，若僅開高走低，代表追價意願不足。';
    }

    highlights.push({ title, impactDirection, intradayNote });
  }

  return highlights;
}

/** Get market data latest update time */
function getMarketDataLatestTime(marketData: Array<{ captured_at?: string; updated_at?: string }> | null): string {
  if (!marketData || marketData.length === 0) return '—';
  const maxDate = marketData.reduce((latest, md) => {
    const dateStr = md.updated_at || md.captured_at;
    if (!dateStr) return latest;
    return dateStr > latest ? dateStr : latest;
  }, '');
  if (!maxDate) return '—';
  try {
    const d = new Date(maxDate);
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

/** Get confidence label */
function getConfidenceLabel(score: number | null | undefined): { label: string; color: string } {
  const s = score ?? 0;
  if (s >= 75) return { label: '高可信', color: 'text-forest-400' };
  if (s >= 50) return { label: '中可信', color: 'text-amber-400' };
  if (s > 0) return { label: '低可信', color: 'text-red-400' };
  return { label: '待評估', color: 'text-white/40' };
}

// ════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════
export default function StrategistPage() {
  const hookData = useLatestReport();
  const {
    report, hasTodayReport, isLoading: hookLoading, error: hookError, inconsistencyWarning,
    displayMode, displayLabel, displaySummary, effectiveBias, effectiveConfidence,
    isPremarketOverridden, openingRadar,
    safeBiasLabel, safeConfidence, safeAllowAggressive, safeAllowDirectional, safeStrategyLabel,
    intelligence, premiumReport,
    isHistoricalFallback, fallbackReportDate,
    marketData: hookMarketData,
    marketNews: hookMarketNews,
  } = hookData;

  const isWeekend = isTaipeiWeekendToday();

  // ── Sector rotation data (independent fetch) ──
  const [sectorItems, setSectorItems] = useState<SectorRotationItem[]>([]);
  const [sectorScoreDate, setSectorScoreDate] = useState<string | null>(null);
  const [sectorLoading, setSectorLoading] = useState(true);
  const [sectorError, setSectorError] = useState<string | null>(null);
  const [sectorDebugInfo, setSectorDebugInfo] = useState<string>('');
  const [sectorRawCount, setSectorRawCount] = useState<number>(0);
  const [sectorFreshness, setSectorFreshness] = useState<SectorRotationFreshness | null>(null);

  const loadSectors = useCallback(async () => {
    try {
      setSectorLoading(true);
      setSectorError(null);
      const result = await fetchSectorRotationScores();
      setSectorItems(result.items);
      setSectorScoreDate(result.scoreDate);
      setSectorError(result.error);
      setSectorDebugInfo(result.debugInfo);
      setSectorRawCount(result.rawRowCount);
      // V27: Compute freshness
      const todayStr = (() => {
        const d = new Date();
        const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
        return `${tw.getFullYear()}-${String(tw.getMonth() + 1).padStart(2, '0')}-${String(tw.getDate()).padStart(2, '0')}`;
      })();
      // Compute market phase for freshness (simplified - Dashboard doesn't have closeVerification)
      const now = new Date();
      const taipeiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      const hour = taipeiNow.getHours();
      const min = taipeiNow.getMinutes();
      const afterClose = hour > 13 || (hour === 13 && min >= 30);
      let phaseForFreshness: string;
      if (isWeekend) phaseForFreshness = 'pre_market';
      else if (afterClose) phaseForFreshness = 'after_close_pending';
      else if (hour < 9) phaseForFreshness = 'pre_market';
      else phaseForFreshness = 'intraday';
      setSectorFreshness(computeSectorRotationFreshness(result, todayStr, phaseForFreshness));
    } catch (err) {
      setSectorError(err instanceof Error ? err.message : '類股輪動讀取失敗');
      setSectorItems([]);
      setSectorDebugInfo(`例外錯誤：${err instanceof Error ? err.message : '未知'}`);
      setSectorFreshness(null);
    } finally {
      setSectorLoading(false);
    }
  }, [isWeekend]);

  useEffect(() => {
    loadSectors();
  }, [loadSectors]);

  // ── Derived state ──
  const noReportForDisplay = !report && !hookLoading;
  const strategyMode = getStrategyMode(displayMode);
  const strategyAdvice = deriveStrategyAdvice(strategyMode, report, intelligence ? !intelligence.allow_directional : (!safeAllowDirectional || displayMode === 'data_insufficient'));
  const displayBias = intelligence?.market_direction_label ?? safeBiasLabel;
  const sentimentColor = getSentimentColor(report?.market_bias);

  const md2330Dash = hookMarketData?.find((md) => md.symbol === '2330') ?? null;
  const mdTXFDash = hookMarketData?.find((md) => md.symbol === 'TXF') ?? null;
  const hasTSMCData = openingRadar?.tsmc_change !== null || md2330Dash !== null;
  const hasTXFDataDash = openingRadar?.txf_change !== null || (mdTXFDash !== null && isWithin12Hours(mdTXFDash.updated_at || mdTXFDash.captured_at));

  const reportDate = report?.report_date ?? null;
  const radarDate = openingRadar?.report_date ?? null;
  const marketDataLatestAt = hookMarketData && hookMarketData.length > 0
    ? hookMarketData.reduce((latest, md) => {
        const captureDate = md.captured_at ? getTaipeiDateStringHelper(md.captured_at) : null;
        return captureDate && captureDate > latest ? captureDate : latest;
      }, '')
    : null;
  const isDateInconsistent = reportDate && radarDate && reportDate !== radarDate;

  const marketHealth = deriveMarketHealthScore(openingRadar?.radar_status ?? null, openingRadar?.market_bias ?? null, report?.market_bias ?? null);

  const dayStatus = openingRadar
    ? getDayStatus(openingRadar.radar_status, openingRadar.market_bias, report?.market_bias ?? null, openingRadar.taiex_change, openingRadar.tsmc_change)
    : getPremarketDayStatus(report?.market_bias ?? null);

  const isWeak = displayMode === 'radar_weak' || displayMode === 'radar_very_weak';
  const isDataInsufficient = !report && !openingRadar;

  const effectiveDayStatus = (isWeekend && isHistoricalFallback)
    ? {
        stateLabel: '等待日',
        mainSentence: '今天非交易日，不追價、不猜方向。',
        actionAdvice: '回看最近交易日劇本，等待下一個交易日。',
        whatToAvoid: '非交易日不追價、不猜方向',
        whatToWatch: '回看最近交易日劇本，等待下一個交易日',
        badgeText: 'text-sky-400',
        badgeBg: 'bg-sky-500/10',
        badgeBorder: 'border-sky-500/20',
        dotColor: 'bg-sky-400',
      }
    : dayStatus;

  // ── Sector rotation display data ──
  const sectorGroups: SectorGroups = groupSectors(sectorItems);
  const sectorAdvice: SectorAdvice = deriveSectorAdvice(sectorGroups, report?.market_bias);

  // ── TXF status ──
  const txfStatus = getTXFDisplayStatus(hookMarketData);

  // ── News items ──
  const newsItems = hookMarketNews || [];
  const newsCount = newsItems.length;

  // ── Dynamic content ──
  const highRiskOrWeak = dayStatus.stateLabel === '高風險日' || dayStatus.stateLabel === '防守日' || dayStatus.stateLabel === '偏防守'
    || effectiveBias.includes('弱') || effectiveBias.includes('防守') || effectiveBias.includes('風險')
    || isPremarketOverridden;

  const dontDoList = generateDontDoList(
    report?.market_bias, hookMarketData, openingRadar, hasTXFDataDash, sectorGroups.strong.length,
  );

  const shouldWatchList = generateShouldWatchList(
    report?.market_bias, hookMarketData, sectorGroups.strong, hasTXFDataDash, openingRadar,
  );

  const aiAdvice = generateAIAdvice(
    report?.market_bias, openingRadar, sectorGroups.strong, isDataInsufficient && sectorItems.length === 0,
  );

  const confidenceLabel = getConfidenceLabel(effectiveConfidence);

  // Market data latest time
  const mdLatestTime = getMarketDataLatestTime(hookMarketData);

  // ═══ LOADING STATE ═══
  if (hookLoading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-amber-400/60 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-white/50 text-sm">Morning Alpha 觀察中心 · 正在分析策略...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ═══ ERROR STATE ═══
  if (hookError) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-error-warning-line text-red-500 text-3xl mb-3 block" />
            <h2 className="text-white font-semibold text-base mb-2">策略顧問暫時無法載入</h2>
            <p className="text-white/50 text-sm mb-4">目前資料讀取失敗，請稍後重新整理。系統不會使用假資料。</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10">
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ═══ EMPTY REPORT STATE ═══
  if (noReportForDisplay) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-brain-line text-white/20 text-3xl mb-3 block" />
            <h2 className="text-white font-semibold text-base mb-2">尚無任何報告資料</h2>
            <p className="text-white/50 text-sm mb-4">
              目前沒有任何盤前報告。請確認資料來源是否正常運作。
            </p>
            <Link to="/" className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10">
              <i className="ri-arrow-left-line" />
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ════════════════════════════════════════════
  // MAIN RENDER
  // ════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* ── HEADER ── */}
        <div className="border-b border-navy-800 bg-navy-900/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-amber-500/15 flex items-center justify-center">
                <i className="ri-brain-line text-amber-400 text-sm" />
              </div>
              <h1 className="text-white font-bold text-sm md:text-base whitespace-nowrap">
                Morning Alpha 觀察中心 / 策略顧問
              </h1>
              <span className="text-white/20 text-xs hidden sm:inline">|</span>
              <span className="text-white/40 text-xs whitespace-nowrap hidden sm:inline">
                {isHistoricalFallback && fallbackReportDate
                  ? `資料日期：${fallbackReportDate}`
                  : isWeekend ? '非交易日 · 最近資料' : '策略顧問'}
              </span>
            </div>
            {isHistoricalFallback && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 text-[10px] font-medium">
                <i className="ri-time-line text-[9px]"></i>
                非交易日，顯示最近資料
              </span>
            )}
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${strategyMode.bg} ${strategyMode.color} ${strategyMode.border}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${strategyMode.mode === 'aggressive' ? 'bg-forest-400' : strategyMode.mode === 'defensive' ? 'bg-red-400' : strategyMode.mode === 'no_trade' ? 'bg-gray-400' : 'bg-amber-400'}`}></div>
              {strategyMode.label}
            </span>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">

          {/* ═══ Premarket Override Alert ═══ */}
          {isPremarketOverridden && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-alert-fill text-red-400 text-[10px]" />
              </div>
              <div>
                <p className="text-red-400 font-semibold text-sm">盤前劇本失準 · 開盤驗證失敗</p>
                <p className="text-red-400/60 text-xs mt-1">{displaySummary} 今日改以風險控管為主，不建議追價。</p>
              </div>
            </div>
          )}

          {/* ═══ Radar Freshness Status ═══ */}
          {(() => {
            const now = new Date();
            const taipeiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
            const hour = taipeiNow.getHours();
            const min = taipeiNow.getMinutes();
            const isPast0930 = hour > 9 || (hour === 9 && min >= 30);
            const radarDate = openingRadar?.report_date || null;
            const todayStr = (() => {
              const d = new Date();
              const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
              return `${tw.getFullYear()}-${String(tw.getMonth() + 1).padStart(2, '0')}-${String(tw.getDate()).padStart(2, '0')}`;
            })();
            const hasTodayRadar = radarDate === todayStr;
            const radarStale = !!radarDate && radarDate < todayStr;
            const hasNoRadar = !radarDate;

            if (hasNoRadar && isPast0930) {
              return (
                <div className="bg-amber-500/[0.07] border border-amber-400/30 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-5 h-5 rounded bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className="ri-time-line text-amber-400 text-[10px]" />
                  </div>
                  <div>
                    <p className="text-amber-300 font-semibold text-sm">09:30 盤中雷達尚未更新</p>
                    <p className="text-amber-400/60 text-xs mt-1">
                      目前已超過 09:30，但今日盤中雷達尚未更新。以下內容為盤前判斷，不等於盤中實際走勢。請以市場實際報價為主。
                    </p>
                  </div>
                </div>
              );
            }

            if (radarStale && isPast0930) {
              return (
                <div className="bg-red-500/[0.07] border border-red-400/30 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className="ri-alert-line text-red-400 text-[10px]" />
                  </div>
                  <div>
                    <p className="text-red-300 font-semibold text-sm">盤中雷達資料過期</p>
                    <p className="text-red-400/60 text-xs mt-1">
                      目前最新雷達日期為 {radarDate}，小於今日 {todayStr}。以下內容為盤前判斷與過期雷達資料。
                    </p>
                  </div>
                </div>
              );
            }

            if (hasTodayRadar) {
              return (
                <div className="bg-emerald-500/[0.06] border border-emerald-400/25 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className="ri-check-double-line text-emerald-400 text-[10px]" />
                  </div>
                  <div>
                    <p className="text-emerald-300 font-semibold text-sm">09:30 盤中雷達已更新</p>
                    <p className="text-emerald-400/60 text-xs mt-1">
                      今日盤中雷達已更新（{radarDate}），以下內容結合盤前判斷與開盤後實際市場資料。
                    </p>
                  </div>
                </div>
              );
            }

            // Before 09:30 — radar not yet expected
            if (!isPast0930) {
              return (
                <div className="bg-sky-500/[0.05] border border-sky-400/20 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-5 h-5 rounded bg-sky-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className="ri-information-line text-sky-400 text-[10px]" />
                  </div>
                  <div>
                    <p className="text-sky-300 font-semibold text-sm">盤前模式 · 等待開盤雷達</p>
                    <p className="text-sky-400/60 text-xs mt-1">
                      目前尚未到 09:30，盤中雷達尚未產生。以下內容為今日盤前判斷，開盤後將自動更新。
                    </p>
                  </div>
                </div>
              );
            }

            return null;
          })()}

          {/* ═══ Inconsistency Warning ═══ */}
          {inconsistencyWarning && !isPremarketOverridden && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-alert-fill text-red-400 text-[10px]" />
              </div>
              <div>
                <p className="text-red-400 font-semibold text-sm">{inconsistencyWarning}</p>
                <p className="text-red-400/60 text-xs mt-1">目前報告 confidence_score &gt;= 90 但 market_bias 包含「震盪」，請檢查 generate-daily-report-v7 的評分與用詞邏輯。</p>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════ */}
          {/* SECTION 1 — 今日總判斷卡 */}
          {/* ════════════════════════════════════════════ */}
          <section>
            <div className={`rounded-2xl border p-5 md:p-6 ${
              isWeak ? 'bg-red-500/[0.03] border-red-500/20' :
              isDataInsufficient ? 'bg-amber-500/[0.03] border-amber-500/20' :
              'bg-navy-900/60 border-amber-500/10'
            }`}>
              {/* Row 1: 今日狀態 + 信心 + 可信度 */}
              <div className="flex items-start gap-4 mb-5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0 ${
                  isWeak ? 'bg-red-500/10 border-red-500/20' :
                  isDataInsufficient ? 'bg-amber-500/10 border-amber-500/20' :
                  'bg-amber-500/10 border-amber-500/20'
                }`}>
                  <i className={`text-sm ${isWeak ? 'ri-shield-flash-line text-red-400' : isDataInsufficient ? 'ri-information-line text-amber-400' : 'ri-compass-3-line text-amber-400'}`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider">
                    {isHistoricalFallback || isWeekend ? '最近交易日狀態' : '今日狀態'}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap mt-0.5">
                    <p className={`text-lg font-bold ${isWeak ? 'text-red-400' : isDataInsufficient ? 'text-amber-400' : 'text-white'}`}>
                      {effectiveDayStatus.stateLabel}
                    </p>
                    <span className="text-white/30 text-xs">{report?.market_bias || ''}</span>
                  </div>
                  <p className="text-white/50 text-xs mt-1 leading-relaxed">{effectiveDayStatus.mainSentence}</p>
                </div>
              </div>

              {/* Row 2: 信心 + 可信度 + 策略模式 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">盤前方向把握度</p>
                  <p className={`text-sm font-bold ${confidenceLabel.color}`}>
                    {report?.confidence_score != null ? `${report.confidence_score}/100` : '—'}
                  </p>
                  <p className="text-white/20 text-[9px] mt-0.5">代表方向判斷信心，不等於內容品質</p>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">資料可信度</p>
                  <p className={`text-sm font-bold ${
                    !hasTSMCData ? 'text-red-400' : !hasTXFDataDash ? 'text-amber-400' : 'text-forest-400'
                  }`}>
                    {!hasTSMCData ? '低可信' : !hasTXFDataDash ? '中可信' : '高可信'}
                  </p>
                  {!hasTXFDataDash && (
                    <p className="text-amber-400/60 text-[10px] mt-0.5">TXF 暫缺，確認度降低</p>
                  )}
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">策略模式</p>
                  <p className={`text-sm font-bold ${strategyMode.color}`}>
                    {strategyMode.mode === 'aggressive' ? '積極模式' :
                     strategyMode.mode === 'defensive' ? '防守模式' :
                     strategyMode.mode === 'no_trade' ? '等待資料模式' :
                     strategyMode.mode === 'wait' ? '等待模式' : '觀察模式'}
                  </p>
                  {dayStatus.stateLabel === '高風險日' && (
                    <p className="text-red-400/60 text-[10px] mt-0.5">風險優先，不進攻</p>
                  )}
                </div>
              </div>

              {/* Row 3: 關鍵市場數據快覽 */}
              {hookMarketData && hookMarketData.length > 0 && (
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">關鍵市場數據</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    {['TAIEX', '2330', 'TXF', 'SPX', 'SOX', 'NVDA', 'TSM', 'VIX'].map((sym) => {
                      const md = hookMarketData.find((m) => m.symbol === sym);
                      if (!md) {
                        if (sym === 'TXF') {
                          return (
                            <span key={sym} className="text-amber-400/60 text-xs inline-flex items-center gap-1">
                              <span className="text-white/20 text-[10px]">{sym}</span>
                              <span>暫缺</span>
                            </span>
                          );
                        }
                        return null;
                      }
                      const cp = md.change_percent != null ? Number(md.change_percent) : 0;
                      const isUp = cp > 0;
                      const isDown = cp < 0;
                      const color = isUp ? 'text-forest-400' : isDown ? 'text-red-400' : 'text-white/50';
                      return (
                        <span key={sym} className="text-xs inline-flex items-center gap-1">
                          <span className="text-white/30 text-[10px]">{sym}</span>
                          <span className={color}>
                            {isUp ? '+' : ''}{cp.toFixed(2)}%
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ════════════════════════════════════════════ */}
          {/* SECTION 2 — 現在不適合做什麼 */}
          {/* ════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded bg-red-500/15 flex items-center justify-center">
                <i className="ri-close-circle-line text-red-400 text-[10px]" />
              </div>
              <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">現在不適合做什麼</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dontDoList.map((item, idx) => (
                <div key={idx} className="rounded-xl p-4 bg-red-500/[0.03] border border-red-500/10 flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-red-400 text-[10px] font-bold">{idx + 1}</span>
                  </div>
                  <p className="text-white/70 text-sm leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ════════════════════════════════════════════ */}
          {/* SECTION 3 — 現在應該看什麼 */}
          {/* ════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded bg-forest-500/15 flex items-center justify-center">
                <i className="ri-eye-line text-forest-400 text-[10px]" />
              </div>
              <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">現在應該看什麼</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {shouldWatchList.map((item, idx) => (
                <div key={idx} className="rounded-xl p-4 bg-forest-500/[0.03] border border-forest-500/10 flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-forest-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-forest-400 text-[10px] font-bold">{idx + 1}</span>
                  </div>
                  <p className="text-white/70 text-sm leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ════════════════════════════════════════════ */}
          {/* SECTION 4 — 今日類股輪動 */}
          {/* ════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded bg-emerald-500/15 flex items-center justify-center">
                <i className="ri-pie-chart-2-line text-emerald-400 text-[10px]" />
              </div>
              <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">
                {sectorFreshness?.isStale ? '類股資料尚未更新' : sectorFreshness?.isPremature ? '今日類股輪動需待收盤後驗證' : '今日類股輪動'}
              </h2>
              {sectorScoreDate && (
                <span className="text-white/30 text-[10px] ml-auto">{sectorScoreDate}</span>
              )}
              {sectorFreshness?.isStale && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 text-[10px] font-medium ml-auto">
                  <i className="ri-history-line"></i>
                  非今日
                </span>
              )}
            </div>

            {/* V27: Stale sector data warning */}
            {sectorFreshness?.isStale && (
              <div className="bg-amber-500/[0.05] border border-amber-500/15 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className="ri-history-line text-amber-400 text-xs" />
                  </div>
                  <div>
                    <p className="text-amber-400 font-semibold text-sm mb-1">類股資料尚未更新</p>
                    <p className="text-amber-400/70 text-xs leading-relaxed">{sectorFreshness.warning}</p>
                    {sectorDebugInfo && (
                      <p className="text-white/15 text-[9px] mt-1 font-mono">{sectorDebugInfo}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Premature sector data warning — generated before 14:15 */}
            {sectorFreshness?.isPremature && (
              <div className="bg-amber-500/[0.05] border border-amber-500/15 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className="ri-time-line text-amber-400 text-xs" />
                  </div>
                  <div>
                    <p className="text-amber-400 font-semibold text-sm mb-1">今日類股輪動需待收盤後驗證</p>
                    <p className="text-amber-400/70 text-xs leading-relaxed">{sectorFreshness.warning}</p>
                    {sectorDebugInfo && (
                      <p className="text-white/15 text-[9px] mt-1 font-mono">{sectorDebugInfo}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {sectorLoading ? (
              <div className="bg-navy-900/80 border border-navy-800 rounded-xl p-5 text-center">
                <div className="w-5 h-5 border-2 border-white/20 border-t-amber-400/60 rounded-full animate-spin mx-auto mb-2" />
                <p className="text-white/40 text-sm">讀取類股輪動資料...</p>
              </div>
            ) : sectorItems.length === 0 ? (
              <div className="bg-navy-900/80 border border-navy-800 rounded-xl p-5">
                <i className="ri-database-2-line text-white/20 text-2xl mb-2 block text-center" />
                <p className="text-white/50 text-sm text-center">類股輪動資料尚未產生，請稍後重新整理。</p>
                {sectorError && (
                  <p className="text-red-400/60 text-xs mt-2 text-center">讀取失敗：{sectorError}</p>
                )}
                {sectorDebugInfo && (
                  <div className="mt-4 p-3 rounded-lg bg-amber-500/[0.04] border border-amber-500/10">
                    <p className="text-amber-400/50 text-[10px] uppercase tracking-wider mb-1.5">診斷資訊</p>
                    <p className="text-white/50 text-[11px] leading-relaxed break-all">{sectorDebugInfo}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {/* 相對抗跌 / 可觀察 — Top 6 */}
                {sectorGroups.strong.length > 0 && (
                  <div>
                    <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 pl-1">
                      {sectorFreshness?.isStale ? '上一交易日類股資料參考' : '相對抗跌 / 可觀察'}
                      {sectorFreshness?.isStale && sectorScoreDate && (
                        <span className="text-amber-400/60 ml-1">（{sectorScoreDate}）</span>
                      )}
                    </p>
                    {sectorFreshness?.isStale && (
                      <p className="text-amber-400/50 text-[10px] mb-2 pl-1">
                        此資料不代表今日類股輪動，僅作為上一交易日參考。
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sectorGroups.strong.map((s) => {
                        const colors = getSignalColor(s.signal_label);
                        return (
                          <div key={s.id} className="rounded-xl p-4 bg-navy-900/80 border border-navy-800 hover:border-navy-700 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${colors.dot}`}></div>
                                <span className="text-white text-sm font-semibold">{s.sector}</span>
                              </div>
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                                {s.direction || s.signal_label}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-white/30 text-[10px]">輪動分數</span>
                              <span className="text-white/80 text-sm font-bold tabular-nums">
                                {typeof s.rotation_score === 'number' ? s.rotation_score.toFixed(1) : '—'}
                              </span>
                            </div>
                            {s.summary && (
                              <p className="text-white/45 text-xs leading-relaxed line-clamp-2">{s.summary}</p>
                            )}
                            {s.leading_symbols && s.leading_symbols.length > 0 && (
                              <p className="text-white/40 text-[10px] mt-2">
                                代表股：{s.leading_symbols.slice(0, 5).join('、')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 避開觀察 — Bottom up to 6 */}
                {sectorGroups.avoid.length > 0 && (
                  <div>
                    <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 pl-1">
                      避開觀察
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sectorGroups.avoid.slice(0, 6).map((s) => {
                        const colors = getSignalColor(s.signal_label);
                        return (
                          <div key={s.id} className="rounded-xl p-4 bg-navy-900/60 border border-navy-800 hover:border-navy-700 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${colors.dot}`}></div>
                                <span className="text-white/80 text-sm font-medium">{s.sector}</span>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                                {s.direction || s.signal_label}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-white/30 text-[10px]">輪動分數</span>
                              <span className="text-white/60 text-sm font-semibold tabular-nums">
                                {typeof s.rotation_score === 'number' ? s.rotation_score.toFixed(1) : '—'}
                              </span>
                            </div>
                            {s.leading_symbols && s.leading_symbols.length > 0 && (
                              <p className="text-white/40 text-[10px] mt-2">
                                代表股：{s.leading_symbols.slice(0, 3).join('、')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Also show watch group if there are items beyond strong+avoid */}
                {sectorGroups.watch.length > 0 && (
                  <div>
                    <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2 pl-1">
                      觀察中
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {sectorGroups.watch.map((s) => {
                        const colors = getSignalColor(s.signal_label);
                        return (
                          <div key={s.id} className="rounded-xl p-4 bg-navy-900/60 border border-navy-800 hover:border-navy-700 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${colors.dot}`}></div>
                                <span className="text-white/80 text-sm font-medium">{s.sector}</span>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${colors.bg} ${colors.text} ${colors.border}`}>
                                {s.direction || s.signal_label}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-white/30 text-[10px]">輪動分數</span>
                              <span className="text-white/60 text-sm font-semibold tabular-nums">
                                {typeof s.rotation_score === 'number' ? s.rotation_score.toFixed(1) : '—'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Disclaimer */}
                <p className="text-white/20 text-[10px] text-center mt-3">
                  這是盤勢偏弱時的相對強弱觀察，不代表買進建議。
                </p>

                {/* Debug hint */}
                <div className="mt-2 p-3 rounded-lg bg-forest-500/[0.03] border border-forest-500/10">
                  <p className="text-forest-400/50 text-[10px] uppercase tracking-wider mb-1">資料診斷</p>
                  <p className="text-white/50 text-[11px] leading-relaxed">
                    資料來源：sector_rotation_scores｜資料日：{sectorScoreDate || '—'}｜筆數：{sectorItems.length}｜原始回傳：{sectorRawCount} 筆
                  </p>
                  {sectorDebugInfo && (
                    <p className="text-white/30 text-[9px] mt-1 leading-relaxed break-all">{sectorDebugInfo}</p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ════════════════════════════════════════════ */}
          {/* SECTION 5 — AI 軍師建議 */}
          {/* ════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded bg-amber-500/15 flex items-center justify-center">
                <i className="ri-lightbulb-line text-amber-400 text-[10px]" />
              </div>
              <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">策略顧問</h2>
            </div>

            <div className={`rounded-xl p-5 md:p-6 ${
              highRiskOrWeak ? 'bg-red-500/[0.03] border border-red-500/10' :
              isDataInsufficient ? 'bg-amber-500/[0.03] border border-amber-500/10' :
              'bg-navy-900/80 border border-amber-500/10'
            }`}>
              <div className="flex items-start gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                  highRiskOrWeak ? 'bg-red-500/10 border-red-500/20' :
                  isDataInsufficient ? 'bg-amber-500/10 border-amber-500/20' :
                  'bg-amber-500/10 border-amber-500/20'
                }`}>
                  <i className={`text-sm ${
                    highRiskOrWeak ? 'ri-shield-flash-line text-red-400' :
                    isDataInsufficient ? 'ri-information-line text-amber-400' :
                    'ri-brain-line text-amber-400'
                  }`} />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm mb-3">策略顧問 · {strategyMode.label}</p>
                  <div className={`rounded-xl p-4 ${
                    highRiskOrWeak ? 'bg-red-500/[0.03] border border-red-500/10' :
                    isDataInsufficient ? 'bg-amber-500/[0.03] border border-amber-500/10' :
                    'bg-amber-500/[0.03] border border-amber-500/10'
                  }`}>
                    <p className="text-white/75 text-sm leading-relaxed whitespace-pre-line">{aiAdvice}</p>
                  </div>

                  {/* Summary: what to avoid + what to watch in compact format */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    <div className="rounded-lg p-3 bg-red-500/[0.03] border border-red-500/10">
                      <p className="text-red-400/60 text-[10px] uppercase tracking-wider mb-1">現在不適合</p>
                      <p className="text-white/60 text-xs leading-relaxed">{sectorAdvice.shouldNotDo}</p>
                    </div>
                    <div className="rounded-lg p-3 bg-forest-500/[0.03] border border-forest-500/10">
                      <p className="text-forest-400/60 text-[10px] uppercase tracking-wider mb-1">現在應該看</p>
                      <p className="text-white/60 text-xs leading-relaxed">{sectorAdvice.shouldWatch}</p>
                    </div>
                  </div>

                  {/* Data attribution */}
                  {openingRadar && (
                    <p className="text-white/25 text-[10px] mt-3">
                      開盤雷達：{openingRadar.radar_status} · {displayLabel}
                    </p>
                  )}
                  {!openingRadar && report?.created_at && (
                    <p className="text-white/25 text-[10px] mt-3">
                      基於 {formatTaipeiDateTime(report.created_at)} 盤前報告
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════ */}
          {/* SECTION 6 — 隔夜重點整理 */}
          {/* ════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded bg-sky-500/15 flex items-center justify-center">
                <i className="ri-moon-clear-line text-sky-400 text-[10px]" />
              </div>
              <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">隔夜重點整理</h2>
              <span className="text-white/20 text-[10px] ml-auto">
                隔夜美股、新聞與國際指標整理
              </span>
            </div>

            {(() => {
              const highlights = buildOvernightHighlights(newsItems, report?.market_bias);

              if (highlights.length === 0) {
                return (
                  <div className="bg-navy-900/80 border border-navy-800 rounded-xl p-5">
                    <i className="ri-moon-clear-line text-white/20 text-2xl mb-2 block text-center" />
                    <p className="text-white/50 text-sm text-center">隔夜重點整理尚未產生</p>
                    <p className="text-white/30 text-xs mt-1 text-center">
                      隔夜市場資訊由市場新聞、美股數據與國際指標彙整。目前資料不足，請以今日盤前判斷為主。
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {highlights.map((item, idx) => (
                    <div key={idx} className="rounded-xl p-4 md:p-5 bg-navy-900/80 border border-navy-800 hover:border-navy-700 transition-colors">
                      {/* Title row */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/15 text-sky-400 text-[10px] font-bold flex-shrink-0">
                          {idx + 1}
                        </span>
                        <h3 className="text-white text-sm font-semibold">{item.title}</h3>
                      </div>

                      {/* Impact direction */}
                      <div className="flex items-start gap-2 mb-2">
                        <span className="text-sky-400/60 text-[10px] uppercase tracking-wider flex-shrink-0 mt-0.5">影響方向</span>
                        <p className="text-white/65 text-xs leading-relaxed">{item.impactDirection}</p>
                      </div>

                      {/* Intraday note */}
                      <div className="flex items-start gap-2">
                        <span className="text-amber-400/60 text-[10px] uppercase tracking-wider flex-shrink-0 mt-0.5">盤中觀察</span>
                        <p className="text-white/55 text-xs leading-relaxed">{item.intradayNote}</p>
                      </div>
                    </div>
                  ))}

                  {/* Footer note */}
                  <p className="text-white/20 text-[10px] text-center">
                    隔夜重點整理由系統根據隔夜市場新聞、美股數據與國際指標自動彙整。
                    {newsCount > 0 && <> 今日共 {newsCount} 則新聞作為資料來源。</>}
                  </p>
                </div>
              );
            })()}
          </section>

          {/* ════════════════════════════════════════════ */}
          {/* SECTION 7 — 資料狀態 */}
          {/* ════════════════════════════════════════════ */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-5 h-5 rounded bg-white/10 flex items-center justify-center">
                <i className="ri-database-2-line text-white/40 text-[10px]" />
              </div>
              <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">資料狀態</h2>
            </div>

            <div className="rounded-xl p-5 bg-navy-900/80 border border-navy-800">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">報告日期</p>
                  <p className="text-white/70 text-sm">{reportDate || '—'}</p>
                </div>
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">台股盤前基準</p>
                  <p className="text-white/70 text-sm">{reportDate || '—'} 收盤</p>
                </div>
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">盤中雷達基準</p>
                  <p className="text-white/70 text-sm">{radarDate || (openingRadar ? '雷達已載入' : '尚未更新')}</p>
                  {radarDate && reportDate && radarDate !== reportDate && (
                    <p className="text-amber-400/60 text-[10px]">非今日</p>
                  )}
                </div>
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">隔夜重點來源</p>
                  <p className="text-white/70 text-sm">{newsCount} 則</p>
                </div>
              </div>

              <div className="border-t border-navy-800 mt-4 pt-4 flex items-center gap-4 flex-wrap">
                {/* TXF status */}
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-white/30 text-[10px]">TXF</span>
                  {hasTXFDataDash ? (
                    <span className="text-forest-400 text-xs font-medium">有效</span>
                  ) : (
                    <span className="text-amber-400 text-xs font-medium" title={txfStatus.label}>
                      暫缺，方向確認度降低
                    </span>
                  )}
                </div>

                {/* 2330 status */}
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-white/30 text-[10px]">2330</span>
                  {hasTSMCData ? (
                    <span className="text-forest-400 text-xs font-medium">有效</span>
                  ) : (
                    <span className="text-red-400 text-xs font-medium">暫缺</span>
                  )}
                </div>

                {/* Proxy indicator */}
                {hookMarketData && hookMarketData.some((md) => (md.source || '').toLowerCase().includes('proxy')) && (
                  <span className="text-amber-400/70 text-xs inline-flex items-center gap-1">
                    <i className="ri-information-line"></i>部分資料使用代理數據
                  </span>
                )}

                {/* Date inconsistency */}
                {isDateInconsistent && (
                  <span className="text-amber-400/70 text-xs inline-flex items-center gap-1">
                    <i className="ri-information-line"></i>資料日期不一致
                  </span>
                )}

                {/* Historical fallback indicator */}
                {isHistoricalFallback && (
                  <span className="text-amber-400/70 text-xs inline-flex items-center gap-1">
                    <i className="ri-time-line"></i>使用歷史報告（{fallbackReportDate}）
                  </span>
                )}
              </div>

              {/* Sector data note */}
              {sectorItems.length === 0 && !sectorLoading && !sectorError && (
                <p className="text-white/25 text-xs mt-3">
                  類股輪動暫缺，AI 軍師建議仍基於盤前報告與市場資料。
                </p>
              )}
            </div>
          </section>

          {/* ════════════════════════════════════════════ */}
          {/* BONUS — 今日劇本分析 (Premium Report) */}
          {/* ════════════════════════════════════════════ */}
          {premiumReport && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded bg-forest-500/15 flex items-center justify-center">
                  <i className="ri-file-chart-line text-forest-400 text-[10px]" />
                </div>
                <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">
                  {isHistoricalFallback || isWeekend ? '最近交易日劇本分析' : '今日劇本分析'}
                </h2>
                {!premiumReport.isDataSufficient && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 text-[10px] font-medium ml-auto">
                    資料不足 · 僅供參考
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl p-4 md:p-5 bg-navy-900/80 border border-forest-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded bg-forest-500/15 flex items-center justify-center">
                      <i className="ri-arrow-up-line text-forest-400 text-[10px]" />
                    </div>
                    <span className="text-forest-400 text-sm font-semibold">{premiumReport.scenarios.bullish.label}</span>
                  </div>
                  <p className="text-white/50 text-xs leading-relaxed mb-2">{premiumReport.scenarios.bullish.description}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-forest-500 rounded-full" style={{ width: `${premiumReport.scenarios.bullish.probability}%` }} />
                    </div>
                    <span className="text-forest-400 text-xs font-bold tabular-nums">{premiumReport.scenarios.bullish.probability}%</span>
                  </div>
                </div>

                <div className="rounded-xl p-4 md:p-5 bg-navy-900/80 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded bg-amber-500/15 flex items-center justify-center">
                      <i className="ri-arrow-right-line text-amber-400 text-[10px]" />
                    </div>
                    <span className="text-amber-400 text-sm font-semibold">{premiumReport.scenarios.neutral.label}</span>
                  </div>
                  <p className="text-white/50 text-xs leading-relaxed mb-2">{premiumReport.scenarios.neutral.description}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${premiumReport.scenarios.neutral.probability}%` }} />
                    </div>
                    <span className="text-amber-400 text-xs font-bold tabular-nums">{premiumReport.scenarios.neutral.probability}%</span>
                  </div>
                </div>

                <div className="rounded-xl p-4 md:p-5 bg-navy-900/80 border border-red-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded bg-red-500/15 flex items-center justify-center">
                      <i className="ri-arrow-down-line text-red-400 text-[10px]" />
                    </div>
                    <span className="text-red-400 text-sm font-semibold">{premiumReport.scenarios.bearish.label}</span>
                  </div>
                  <p className="text-white/50 text-xs leading-relaxed mb-2">{premiumReport.scenarios.bearish.description}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: `${premiumReport.scenarios.bearish.probability}%` }} />
                    </div>
                    <span className="text-red-400 text-xs font-bold tabular-nums">{premiumReport.scenarios.bearish.probability}%</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ═══ CTA ═══ */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-center pt-2 pb-4">
            <Link to="/war-room" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 text-white/70 text-sm rounded-xl transition-colors border border-white/10 whitespace-nowrap">
              <i className="ri-sword-line" />
              回到盤前作戰室
            </Link>
            <Link to="/report/today" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-forest-600 hover:bg-forest-500 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap">
              <i className="ri-line-chart-line" />
              進入盤中追蹤
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
