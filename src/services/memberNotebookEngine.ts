/**
 * Morning Alpha — Member Notebook Engine
 *
 * 把既有 report + market_data + intelligence 資料轉成「每日研究員筆記」8 大段。
 * 不做假資料、不報明牌、不寫買賣建議。
 * 資料不足時誠實標記，不硬補空泛句。
 */

import type { Report } from '@/types/report';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { IntelligenceResult } from '@/services/intelligenceEngine';
import type { DisciplineAdvice } from '@/services/disciplineAdviceService';
import { renderSafeText as renderSafeValue } from '@/utils/renderSafe';
import { formatTaipeiDate } from '@/utils/tradingDay';

function renderSafeText(value: unknown, fallback = ''): string {
  return renderSafeValue(value) || fallback;
}

// ==================== OUTPUT TYPES ====================

export interface EvidenceItem {
  label: string;
  source: string;
  supports: string;
  dataAvailable: boolean;
}

export interface ImpactChainItem {
  catalyst: string;
  affectedSectors: string;
  representativeStocks: string;
  intradayWatch: string;
  failureCondition: string;
  dataAvailable: boolean;
}

export interface DontDoItem {
  text: string;
}

export interface WatchlistItem {
  name: string;
  tier: 'core' | 'secondary' | 'risk';
  reason: string;
  signalLine: string;
  strongSignal: string;
  weakSignal: string;
  dataAvailable: boolean;
}

export interface TrackingCheckpoint {
  time: string;
  question: string;
  lookFor: string;
}

export interface FailureCondition {
  scenario: string;
  condition: string;
  action: string;
}

export interface CloseVerification {
  premarketAssumption: string;
  closeResult: string;
  verdict: string;
  whereCorrect: string;
  whereOff: string;
  tomorrowAdjustment: string;
  dataAvailable: boolean;
}

export interface MemberNotebook {
  // 第一段：今日主劇本
  mainScript: {
    thesis: string;
    confidenceText: string;
    mainReason: string;
    marketScenario: string;
    confirmationCondition: string;
    dataAvailable: boolean;
  };

  // 第二段：資料證據
  evidence: EvidenceItem[];

  // 第三段：隔夜影響鏈
  impactChains: ImpactChainItem[];

  // 第四段：今日不要做清單
  dontDoList: DontDoItem[];

  // 第五段：今日觀察名單
  watchlist: WatchlistItem[];

  // 第六段：盤中追蹤計畫
  trackingPlan: TrackingCheckpoint[];

  // 第七段：失效條件
  failureConditions: FailureCondition[];

  // 第八段：收盤驗證與明日修正
  closeVerification: CloseVerification;

  // 元資料
  generatedAt: string;
  reportDate: string;
  isDataSufficient: boolean;
  isNonTradingDay: boolean;
  nonTradingDayNote: string;
}

// ==================== MAIN GENERATOR ====================

export function generateMemberNotebook(input: {
  report: Report | null;
  marketData: SupabaseMarketData[] | null;
  intelligence: IntelligenceResult | null;
  disciplineAdvice: DisciplineAdvice | null;
  isNonTradingDay: boolean;
  fallbackDate?: string | null;
}): MemberNotebook {
  const {
    report,
    marketData,
    intelligence,
    disciplineAdvice,
    isNonTradingDay,
    fallbackDate,
  } = input;

  const now = new Date().toISOString();
  const reportDate = report?.report_date || formatTaipeiDate();
  const isDataSufficient = intelligence?.is_data_sufficient ?? false;

  // ═══ V7.40: Try reading from ai_strategy_json.member_research_note first ═══
  const aiJson = (report as unknown as Record<string, unknown> | null)?.ai_strategy_json as Record<string, unknown> | null;
  const mrnFromAI = aiJson?.member_research_note as Record<string, unknown> | null;
  if (mrnFromAI && typeof mrnFromAI === 'object') {
    return buildNotebookFromAI(mrnFromAI, report, now, reportDate, isNonTradingDay, isDataSufficient, fallbackDate);
  }

  // Build each section from engine
  const mainScript = buildMainScript(report, intelligence, isDataSufficient, isNonTradingDay);
  const evidence = buildEvidence(report, marketData, intelligence, isDataSufficient);
  const impactChains = buildImpactChains(report, isDataSufficient);
  const dontDoList = buildDontDoList(report, disciplineAdvice, isNonTradingDay);
  const watchlist = buildWatchlist(report, marketData, intelligence, isDataSufficient);
  const trackingPlan = buildTrackingPlan(report, isNonTradingDay, isDataSufficient);
  const failureConditions = buildFailureConditions(report, intelligence, isDataSufficient, isNonTradingDay);
  const closeVerification = buildCloseVerification(report, isNonTradingDay, isDataSufficient);

  const nonTradingDayNote = isNonTradingDay
    ? `以下為最近交易日（${fallbackDate || reportDate}）資料，不代表今日即時數據。`
    : '';

  return {
    mainScript,
    evidence,
    impactChains,
    dontDoList,
    watchlist,
    trackingPlan,
    failureConditions,
    closeVerification,
    generatedAt: now,
    reportDate,
    isDataSufficient,
    isNonTradingDay,
    nonTradingDayNote,
  };
}

// ═══ V7.40: Build notebook from ai_strategy_json.member_research_note ═══
function buildNotebookFromAI(
  mrnFromAI: Record<string, unknown>,
  report: Report | null,
  now: string,
  reportDate: string,
  isNonTradingDay: boolean,
  isDataSufficient: boolean,
  fallbackDate: string | null | undefined,
): MemberNotebook {
  const sections = Array.isArray(mrnFromAI.sections) ? mrnFromAI.sections as Record<string, unknown>[] : [];
  const findSection = (key: string): Record<string, unknown> | null => {
    const s = sections.find((sec) => sec.key === key);
    return s || null;
  };

  // Section 1: main_scenario
  const ms = findSection('main_scenario');
  const mainScript = {
    thesis: renderSafeText(ms?.conclusion, '今日盤前假設為' + (report?.market_bias || '觀察中')),
    confidenceText: report?.confidence_score != null ? `${report.confidence_score}/100` : '—',
    mainReason: renderSafeText(ms?.reasoning, '—'),
    marketScenario: '',
    confirmationCondition: Array.isArray(ms?.confirmation_conditions)
      ? (ms?.confirmation_conditions as string[]).join('；')
      : renderSafeText(ms?.confirmation_conditions, '開盤後觀察台積電、台指期與半導體族群方向一致性'),
    dataAvailable: !!ms,
  };

  // Section 2: evidence
  const ev = findSection('evidence');
  const evItems = Array.isArray(ev?.evidence_items) ? ev?.evidence_items as Record<string, unknown>[] : [];
  const evidence = evItems.map((ei) => ({
    label: renderSafeText(ei.signal, '市場訊號'),
    source: 'OpenAI V7.40',
    supports: renderSafeText(ei.interpretation, '—'),
    dataAvailable: true,
  }));

  // Section 3: overnight_impact_chain
  const oc = findSection('overnight_impact_chain');
  const chains = Array.isArray(oc?.chains) ? oc?.chains as Record<string, unknown>[] : [];
  const impactChains = chains.map((c) => ({
    catalyst: renderSafeText(c.catalyst, '隔夜事件'),
    affectedSectors: Array.isArray(c.affected_sectors) ? (c.affected_sectors as string[]).join('、') : renderSafeText(c.affected_sectors, '相關族群'),
    representativeStocks: Array.isArray(c.representative_stocks)
      ? (c.representative_stocks as Record<string, unknown>[]).map((s) => renderSafeText(s.name)).join('、')
      : '台積電',
    intradayWatch: Array.isArray(c.intraday_watch_points) ? (c.intraday_watch_points as string[])[0] || '開盤後觀察' : '開盤後觀察',
    failureCondition: renderSafeText(c.invalidation_condition, '若開盤方向與盤前假設相反'),
    dataAvailable: true,
  }));

  // Section 4: do_not_do
  const dnd = findSection('do_not_do');
  const dndItems = Array.isArray(dnd?.items) ? dnd?.items as string[] : [];
  const dontDoList = dndItems.length > 0
    ? dndItems.map((t) => ({ text: t }))
    : [{ text: '不要在資料不足時硬做方向判斷。' }];

  // Section 5: watchlist
  const wl = findSection('watchlist');
  const coreWatch = Array.isArray(wl?.core_watch) ? wl?.core_watch as Record<string, unknown>[] : [];
  const secWatch = Array.isArray(wl?.secondary_watch) ? wl?.secondary_watch as Record<string, unknown>[] : [];
  const riskWatch = Array.isArray(wl?.risk_watch) ? wl?.risk_watch as Record<string, unknown>[] : [];
  const watchlist: WatchlistItem[] = [
    ...coreWatch.map((w) => ({ name: renderSafeText(w.name), tier: 'core' as const, reason: renderSafeText(w.reason), signalLine: renderSafeText(w.signal), strongSignal: renderSafeText(w.strong_condition), weakSignal: renderSafeText(w.weak_condition), dataAvailable: true })),
    ...secWatch.map((w) => ({ name: renderSafeText(w.name), tier: 'secondary' as const, reason: renderSafeText(w.reason), signalLine: renderSafeText(w.signal), strongSignal: renderSafeText(w.strong_condition), weakSignal: renderSafeText(w.weak_condition), dataAvailable: true })),
    ...riskWatch.map((w) => ({ name: renderSafeText(w.name), tier: 'risk' as const, reason: renderSafeText(w.reason), signalLine: renderSafeText(w.signal), strongSignal: renderSafeText(w.strong_condition), weakSignal: renderSafeText(w.weak_condition), dataAvailable: true })),
  ];

  // Section 6: intraday_tracking
  const it = findSection('intraday_tracking');
  const timeline = Array.isArray(it?.timeline) ? it?.timeline as Record<string, unknown>[] : [];
  const trackingPlan = timeline.length > 0
    ? timeline.map((t) => ({ time: renderSafeText(t.time), question: renderSafeText(t.question), lookFor: renderSafeText(t.interpretation || t.what_to_watch) }))
    : [{ time: '09:00-09:15', question: '開盤方向是否與盤前假設一致？', lookFor: '台積電開盤方向、台指期是否支持現貨' }];

  // Section 7: invalidation
  const inv = findSection('invalidation');
  const invItems = Array.isArray(inv?.items) ? inv?.items as Record<string, unknown>[] : [];
  const failureConditions = invItems.length > 0
    ? invItems.map((i) => ({ scenario: renderSafeText(i.condition), condition: renderSafeText(i.meaning), action: renderSafeText(i.required_adjustment) }))
    : [{ scenario: '若台積電開盤方向與盤前假設相反', condition: '代表盤前判斷需要降權或修正', action: '將盤前假設降級為觀察模式' }];

  // Section 8: close_review
  const cr = findSection('close_review');
  const closeVerification: CloseVerification = {
    premarketAssumption: renderSafeText(cr?.premarket_assumption, '—'),
    closeResult: renderSafeText(cr?.close_result, '收盤驗證資料尚未產生'),
    verdict: renderSafeText(cr?.verification_result, '資料不足，不做驗證'),
    whereCorrect: renderSafeText(cr?.what_was_right, '—'),
    whereOff: renderSafeText(cr?.what_was_conservative_or_wrong, '—'),
    tomorrowAdjustment: renderSafeText(cr?.tomorrow_adjustment, '等待下一次盤前報告更新'),
    dataAvailable: !!cr,
  };

  const nonTradingDayNote = isNonTradingDay
    ? `以下為最近交易日（${fallbackDate || reportDate}）資料，不代表今日即時數據。`
    : '';

  return {
    mainScript,
    evidence,
    impactChains,
    dontDoList,
    watchlist,
    trackingPlan,
    failureConditions,
    closeVerification,
    generatedAt: now,
    reportDate,
    isDataSufficient,
    isNonTradingDay,
    nonTradingDayNote,
  };
}

// ==================== SECTION 1: 今日主劇本 ====================

function buildMainScript(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  isDataSufficient: boolean,
  isNonTradingDay: boolean,
): MemberNotebook['mainScript'] {
  if (!report) {
    return {
      thesis: '報告尚未生成',
      confidenceText: '—',
      mainReason: '每日 07:30 自動生成，請稍後回來查看。',
      marketScenario: '等待報告生成',
      confirmationCondition: '等待報告生成後提供確認條件',
      dataAvailable: false,
    };
  }

  if (!isDataSufficient) {
    return {
      thesis: '資料不足，暫不判定方向',
      confidenceText: `核心資料命中 ${intelligence?.core_data_hits ?? 0}/${intelligence?.core_data_total ?? 6} 類`,
      mainReason: `缺少關鍵資料：${intelligence?.missing_categories?.join('、') || '台股核心資料'}，無法形成完整盤前判斷。`,
      marketScenario: '以觀察為主，等待核心資料補齊後重新評估。目前不宜建立方向性判斷。',
      confirmationCondition: `等待 ${intelligence?.missing_categories?.slice(0, 3).join('、') || '核心資料'} 到位後，重新評估盤前劇本。`,
      dataAvailable: true,
    };
  }

  if (isNonTradingDay) {
    return {
      thesis: report.market_bias || '觀察中',
      confidenceText: report.confidence_score != null ? `${report.confidence_score}/100` : '—',
      mainReason: '非交易日，以下為最近交易日盤前假設回顧。非即時判斷，僅供學習參考。',
      marketScenario: '非交易日無市場情境更新，以下為最近交易日記錄。',
      confirmationCondition: '下一個交易日開盤後重新驗證。',
      dataAvailable: true,
    };
  }

  const bias = intelligence?.market_direction_label || report.market_bias || '觀察中';
  const confidence = intelligence?.safe_confidence ?? report.confidence_score ?? 0;
  const mainReason = intelligence?.main_reason || '盤前 AI 綜合判斷';

  // Build a real thesis, not a label
  let thesis = '';
  if (bias.includes('偏多') && !bias.includes('偏弱') && !bias.includes('偏空')) {
    thesis = `今日主劇本不是全面偏多，而是${bias}。`;
  } else if (bias.includes('偏弱') || bias.includes('偏空')) {
    thesis = `今日主劇本偏向保守，判斷為${bias}。`;
  } else if (bias.includes('震盪')) {
    thesis = `今日主劇本為中性震盪，方向尚待確認。`;
  } else if (bias.includes('分歧') || bias.includes('等待')) {
    thesis = `今日多空訊號分歧，劇本以等待確認為主。`;
  } else {
    thesis = `今日盤前主劇本：${bias}。`;
  }

  // Add contextual depth
  const drivers = report.key_drivers || [];
  if (drivers.length > 0) {
    thesis += `主要觀察線索來自${drivers.slice(0, 3).join('、')}。`;
  }

  const confidenceText = confidence > 0 ? `${confidence}/100` : '—';

  // Market scenario - what's the most important context today
  const marketScenario = intelligence?.report_summary || report.summary || buildDefaultScenario(bias, report);

  // Confirmation condition - what needs to happen to validate this thesis
  const confirmationCondition = buildConfirmationCondition(report, bias);

  return {
    thesis,
    confidenceText,
    mainReason: mainReason.length > 0 ? mainReason : '盤前 AI 綜合判斷',
    marketScenario,
    confirmationCondition,
    dataAvailable: true,
  };
}

function buildDefaultScenario(bias: string, report: Report): string {
  const drivers = (report.key_drivers || []).join('、');
  if (bias.includes('震盪')) {
    return `盤前主軸以震盪觀察為主${drivers ? `，${drivers}為今日核心觀察線索` : ''}。開盤後需確認權值股方向一致性，若方向分歧，震盪格局將延續。`;
  }
  if (bias.includes('偏多')) {
    return `盤前主軸偏多${drivers ? `，${drivers}帶動市場情緒` : ''}。開盤後需確認量能是否放大、權值股是否同步走強。若量能不足或權值股分歧，盤前偏多假設需降權。`;
  }
  if (bias.includes('偏弱') || bias.includes('偏空')) {
    return `盤前主軸偏保守${drivers ? `，${drivers}承壓` : ''}。開盤後需觀察賣壓是否集中在權值股，以及是否有止穩訊號。不宜在賣壓未消化前追空。`;
  }
  return `盤前主軸以觀察為主${drivers ? `，${drivers}為今日核心觀察線索` : ''}。開盤後以實際資金流向為準。`;
}

function buildConfirmationCondition(report: Report, bias: string): string {
  const aiJson = (report as unknown as Record<string, unknown> | null)?.ai_strategy_json as Record<string, unknown> | null;
  if (aiJson?.confirmation_condition && typeof aiJson.confirmation_condition === 'string') {
    return aiJson.confirmation_condition;
  }

  if (bias.includes('震盪')) {
    return '開盤後 30 分鐘內，若權值股與台指期方向一致且量能放大，代表震盪格局可能打破。若方向分歧且量縮，震盪將延續。';
  }
  if (bias.includes('偏多')) {
    return '開盤後台積電需強於大盤，半導體族群需有擴散訊號，且台指期應支持現貨方向。若三者缺一，盤前偏多假設降權。';
  }
  if (bias.includes('偏弱') || bias.includes('偏空')) {
    return '開盤後若權值股全面走弱且量能放大，盤前偏保守判斷成立。若出現低接買盤且權值股止穩，代表賣壓可能已消化。';
  }
  return '開盤後觀察台積電、台指期與半導體族群方向一致性，確認盤前假設是否成立。';
}

// ==================== SECTION 2: 資料證據 ====================

function buildEvidence(
  report: Report | null,
  marketData: SupabaseMarketData[] | null,
  intelligence: IntelligenceResult | null,
  isDataSufficient: boolean,
): EvidenceItem[] {
  if (!report || !isDataSufficient) {
    if (intelligence?.missing_categories && intelligence.missing_categories.length > 0) {
      return intelligence.missing_categories.slice(0, 3).map((cat) => ({
        label: cat,
        source: '核心資料',
        supports: `資料缺失，無法用於今日判斷`,
        dataAvailable: false,
      }));
    }
    return [{
      label: '核心市場資料',
      source: 'reports / market_data',
      supports: '資料不足，無法形成判斷依據',
      dataAvailable: false,
    }];
  }

  const items: EvidenceItem[] = [];

  // 1. Market bias + confidence
  items.push({
    label: '盤前 AI 方向判斷',
    source: ' Morning Alpha Intelligence Engine',
    supports: `盤前假設為${report.market_bias || '觀察中'}，這是今日所有判斷的基礎方向。`,
    dataAvailable: true,
  });

  // 2. Key drivers
  const drivers = report.key_drivers || [];
  if (drivers.length > 0) {
    items.push({
      label: '今日盤前主線',
      source: 'AI 盤前主線判斷',
      supports: `${drivers.slice(0, 3).join('、')} 為今日核心觀察方向，代表 AI 判斷這些線索最可能影響盤勢。`,
      dataAvailable: true,
    });
  }

  // 3-5. Semi data from marketData
  if (marketData && marketData.length > 0) {
    const nvda = marketData.find((d) => d.symbol === 'NVDA');
    const tsm = marketData.find((d) => d.symbol === 'TSM');
    const spx = marketData.find((d) => d.symbol === 'SPX');

    if (nvda && nvda.change_percent != null) {
      const dir = nvda.change_percent >= 0 ? '上漲' : '下跌';
      items.push({
        label: 'NVDA 走勢',
        source: 'market_data (美股)',
        supports: `NVDA ${dir} ${Math.abs(nvda.change_percent).toFixed(2)}%，${nvda.change_percent >= 0 ? '支持半導體風險偏好，若台積電開盤能同步反映，代表 AI 線索仍有支撐' : '代表 AI 風險偏好降溫，若台積電開盤跟跌，半導體族群將承壓'}。`,
        dataAvailable: true,
      });
    }

    if (tsm && tsm.change_percent != null) {
      const dir = tsm.change_percent >= 0 ? '上漲' : '下跌';
      items.push({
        label: 'TSM ADR 走勢',
        source: 'market_data (美股 ADR)',
        supports: `TSM ADR ${dir} ${Math.abs(tsm.change_percent).toFixed(2)}%，${tsm.change_percent >= 0 ? '代表外資對台積電短線偏正面，可觀察開盤後是否反映到台積電現股' : '代表外資對台積電短線偏保守，開盤後需觀察台積電現股是否跟跌'}。`,
        dataAvailable: true,
      });
    }

    if (spx && spx.change_percent != null) {
      const dir = spx.change_percent >= 0 ? '上漲' : '下跌';
      items.push({
        label: 'S&P 500 走勢',
        source: 'market_data (美股大盤)',
        supports: `S&P 500 ${dir} ${Math.abs(spx.change_percent).toFixed(2)}%，${spx.change_percent >= 0 ? '代表美股整體風險偏好穩定，對台股開盤有正面參考' : '代表美股整體風險偏好降溫，需觀察台股開盤是否跟跌'}。`,
        dataAvailable: true,
      });
    }
  }

  // If we have fewer than 3 items, add from report summary
  if (items.length < 3 && report.summary) {
    items.push({
      label: '今日盤前摘要',
      source: 'reports',
      supports: report.summary.length > 100 ? `${report.summary.slice(0, 100)}...` : report.summary,
      dataAvailable: true,
    });
  }

  // If still too few, add a risk note
  if (items.length < 3) {
    items.push({
      label: '風險提示',
      source: '系統判斷',
      supports: report.risk_reason || '目前資料量偏少，盤前判斷權重應降低。開盤後以實際走勢為準。',
      dataAvailable: true,
    });
  }

  return items.slice(0, 5);
}

// ==================== SECTION 3: 隔夜影響鏈 ====================

function buildImpactChains(
  report: Report | null,
  isDataSufficient: boolean,
): ImpactChainItem[] {
  if (!report || !isDataSufficient) {
    return [{
      catalyst: '資料不足',
      affectedSectors: '—',
      representativeStocks: '—',
      intradayWatch: '等待核心資料補齊',
      failureCondition: '—',
      dataAvailable: false,
    }];
  }

  const aiJson = (report as unknown as Record<string, unknown> | null)?.ai_strategy_json as Record<string, unknown> | null;
  const chains = Array.isArray(aiJson?.overnight_impact_chains)
    ? (aiJson?.overnight_impact_chains as Record<string, unknown>[])
    : [];

  if (chains.length === 0) {
    // Build from report data
    const items: ImpactChainItem[] = [];
    const drivers = report.key_drivers || [];
    const watchSectors = report.watch_sectors_json || [];

    if (drivers.length > 0) {
      items.push({
        catalyst: drivers.slice(0, 2).join('、'),
        affectedSectors: watchSectors.slice(0, 2).map((sector) => renderSafeText(sector.sector)).join('、') || '相關族群',
        representativeStocks: '台積電',
        intradayWatch: '開盤後 30 分鐘觀察資金是否延續到相關族群',
        failureCondition: '若開盤後資金未擴散，代表盤前主軸未被市場確認',
        dataAvailable: true,
      });
    }
    if (items.length === 0) {
      items.push({
        catalyst: '尚無明確隔夜影響鏈',
        affectedSectors: '—',
        representativeStocks: '台積電、台指期',
        intradayWatch: '等待開盤後觀察資金流向',
        failureCondition: '—',
        dataAvailable: true,
      });
    }
    return items;
  }

  return chains.slice(0, 3).map((c) => {
    const chain = c as Record<string, unknown>;
    return {
      catalyst: renderSafeText(chain.catalyst || chain.chain_title || chain.theme || '隔夜事件'),
      affectedSectors: Array.isArray(chain.affected_sectors)
        ? chain.affected_sectors.map((sector: unknown) => renderSafeText(sector)).join('、')
        : renderSafeText(chain.affected_sectors || '相關族群'),
      representativeStocks: Array.isArray(chain.representative_stocks)
        ? chain.representative_stocks.map((s: unknown) =>
            typeof s === 'object' ? renderSafeText((s as Record<string, unknown>).name || (s as Record<string, unknown>).symbol) : renderSafeText(s)
          ).join('、')
        : renderSafeText(chain.representative_stocks || '台積電'),
      intradayWatch: renderSafeText(chain.intraday_watch_points?.[0] || chain.intraday_watch || '開盤後觀察資金延續性'),
      failureCondition: renderSafeText(chain.failure_condition || '若開盤後資金未擴散或方向不一致，代表此影響鏈未被市場確認'),
      dataAvailable: true,
    };
  });
}

// ==================== SECTION 4: 今日不要做清單 ====================

function buildDontDoList(
  report: Report | null,
  disciplineAdvice: DisciplineAdvice | null,
  isNonTradingDay: boolean,
): DontDoItem[] {
  if (isNonTradingDay) {
    return [
      { text: '不要在非交易日硬做今日判斷。回顧的目的是學習，不是找理由合理化之前的錯誤。' },
      { text: '不要用非交易日的回顧資料做下一個交易日的交易決策。' },
      { text: '不要在沒有即時市場資料時，主觀推導方向性結論。' },
    ];
  }

  if (disciplineAdvice?.premiumDontDos && disciplineAdvice.premiumDontDos.length > 0) {
    return disciplineAdvice.premiumDontDos.slice(0, 5).map((text) => ({ text }));
  }

  // Fallback — still useful, not empty
  const dontDos: DontDoItem[] = [];

  // Try to get from report
  const aiJson = (report as unknown as Record<string, unknown> | null)?.ai_strategy_json as Record<string, unknown> | null;
  if (Array.isArray(aiJson?.avoid_today)) {
    (aiJson?.avoid_today as unknown[]).slice(0, 5).forEach((a) => {
      dontDos.push({ text: renderSafeText(a) });
    });
  }

  if (dontDos.length === 0) {
    dontDos.push({ text: '不要只因為前一天美股走勢，就直接推論今日台股方向。開盤後以實際資金流向為準。' });
    dontDos.push({ text: '不要在台積電與台指期不同步時，急著追任何族群。方向不一致時風險最高。' });
    dontDos.push({ text: '不要把開盤前 15 分鐘的強弱當成全天方向。開盤情緒不等於全日趨勢。' });
    dontDos.push({ text: '不要在資料不足時硬做方向判斷。等待多個指標同步確認後再行動。' });
    dontDos.push({ text: '不要忽略收盤驗證，因為收盤才是檢查盤前劇本是否成立的關鍵。' });
  }

  return dontDos.slice(0, 5);
}

// ==================== SECTION 5: 今日觀察名單 ====================

function buildWatchlist(
  report: Report | null,
  marketData: SupabaseMarketData[] | null,
  intelligence: IntelligenceResult | null,
  isDataSufficient: boolean,
): WatchlistItem[] {
  if (!report || !isDataSufficient) {
    return [{
      name: '資料不足',
      tier: 'core',
      reason: '核心資料不足，無法建立觀察名單',
      signalLine: '—',
      strongSignal: '—',
      weakSignal: '—',
      dataAvailable: false,
    }];
  }

  const items: WatchlistItem[] = [];

  // Core: always watch TSM, TAIEX, TXF
  items.push({
    name: '台積電 (2330)',
    tier: 'core',
    reason: '權值龍頭，外資態度指標。台積電走勢直接影響大盤方向與半導體族群情緒。',
    signalLine: '外資買賣超 + ADR 溢價',
    strongSignal: '台積電強於大盤、外資連續買超、ADR 溢價擴大',
    weakSignal: '台積電弱於大盤、外資轉賣、ADR 溢價收窄',
    dataAvailable: true,
  });

  items.push({
    name: '台指期 (TXF)',
    tier: 'core',
    reason: '期現基差與未平倉變化反映法人對方向的押注。期現背離時不宜單邊重押。',
    signalLine: '期現價差 + 未平倉量變化',
    strongSignal: '期指領先現貨且正價差擴大、未平倉增加',
    weakSignal: '期指落後現貨或逆價差擴大、未平倉減少',
    dataAvailable: true,
  });

  // From report watch sectors
  const watchSectors = report.watch_sectors_json || [];
  watchSectors.slice(0, 3).forEach((ws) => {
    const name = renderSafeText(ws.sector);
    if (!items.some((i) => i.name === name)) {
      items.push({
        name,
        tier: 'secondary',
        reason: renderSafeText(ws.reason) || '盤前主線相關族群',
        signalLine: '族群內權值股方向一致性',
        strongSignal: '族群內多數股票同步走強、量能放大',
        weakSignal: '族群內部分化、龍頭股無力帶動',
        dataAvailable: true,
      });
    }
  });

  // From intelligence watch sectors
  const intelWatch = intelligence?.watch_sectors || [];
  intelWatch.slice(0, 3).forEach((s) => {
    if (!items.some((i) => i.name === s)) {
      items.push({
        name: s,
        tier: 'secondary',
        reason: 'AI 盤前判斷關注',
        signalLine: '開盤後資金延續性',
        strongSignal: '開盤後資金持續流入、族群聯動',
        weakSignal: '開盤後資金流出、族群無法擴散',
        dataAvailable: true,
      });
    }
  });

  // Risk watch from avoid sectors
  const avoidSectors = intelligence?.avoid_sectors || [];
  avoidSectors.slice(0, 2).forEach((s) => {
    if (!items.some((i) => i.name === s)) {
      items.push({
        name: s,
        tier: 'risk',
        reason: '系統標記為今日需謹慎觀察',
        signalLine: '是否出現大幅波動或資金撤出',
        strongSignal: '不適用（風險觀察項目）',
        weakSignal: '若該族群明顯走弱，需降低相關部位曝險',
        dataAvailable: true,
      });
    }
  });

  return items.slice(0, 8);
}

// ==================== SECTION 6: 盤中追蹤計畫 ====================

function buildTrackingPlan(
  report: Report | null,
  isNonTradingDay: boolean,
  isDataSufficient: boolean,
): TrackingCheckpoint[] {
  if (isNonTradingDay) {
    return [{
      time: '非交易日',
      question: '非交易日不產生盤中追蹤計畫',
      lookFor: '請在下一個交易日前回來查看最新追蹤計畫。',
    }];
  }

  if (!isDataSufficient || !report) {
    return [{
      time: '資料不足',
      question: '等待核心資料補齊',
      lookFor: `缺少 ${(report as unknown as Record<string, unknown> | null)?.ai_strategy_json ? '部分盤前資料' : '核心市場資料'}，資料到位後自動更新追蹤計畫。`,
    }];
  }

  const bias = report.market_bias || '觀察中';
  const isRangeBound = bias.includes('震盪');

  const checkpoints: TrackingCheckpoint[] = [
    {
      time: '09:00～09:15',
      question: '開盤方向是否與盤前劇本一致？',
      lookFor: isRangeBound
        ? '開盤後方向是否明確，還是狹幅震盪。若開盤即出現明顯方向，需檢查盤前震盪假設是否仍成立。'
        : '台積電與台指期是否同步朝盤前假設方向移動。若開盤方向與盤前劇本相反，需立即降權盤前判斷。',
    },
    {
      time: '09:30',
      question: '權值股與族群是否同步？',
      lookFor: '台積電是否強於大盤（若盤前偏多）或弱於大盤（若盤前偏保守）。半導體族群是否有擴散訊號。金融或傳產是否拖累指數。',
    },
    {
      time: '10:30',
      question: '資金是否擴散或只集中少數股票？',
      lookFor: '若資金只集中 1～2 檔權值股而非擴散至族群，代表市場信心不足。若族群全面聯動且量能放大，盤前劇本可信度提高。',
    },
    {
      time: '13:00 前',
      question: '是否接近收盤驗證條件？',
      lookFor: '確認今日盤前假設是否在盤中被驗證或修正。若盤中出現明顯與盤前不一致的訊號，記錄下來作為收盤驗證的素材。開高後是否出現明顯賣壓或開低後是否出現低接買盤。',
    },
  ];

  return checkpoints;
}

// ==================== SECTION 7: 失效條件 ====================

function buildFailureConditions(
  report: Report | null,
  intelligence: IntelligenceResult | null,
  isDataSufficient: boolean,
  isNonTradingDay: boolean,
): FailureCondition[] {
  if (isNonTradingDay || !report || !isDataSufficient) {
    return [{
      scenario: '資料不足或非交易日',
      condition: '不適用',
      action: '等待下一個交易日或資料補齊後再評估失效條件。',
    }];
  }

  const bias = intelligence?.market_direction_label || report.market_bias || '觀察中';
  const conditions: FailureCondition[] = [];

  if (bias.includes('震盪')) {
    conditions.push({
      scenario: '盤前判斷中性震盪，但開盤後權值股全面轉強且量能擴大',
      condition: '若開盤後 30 分鐘內，權值股同步走強且量能明顯放大，代表市場方向已表態',
      action: '盤前震盪假設需要降權。若量能持續擴大且族群擴散，應轉為追蹤偏多情境。',
    });
    conditions.push({
      scenario: '盤前判斷中性震盪，但開盤後權值股全面轉弱且賣壓集中',
      condition: '若開盤後台積電明顯走弱、台指期轉弱、半導體族群全面下跌',
      action: '盤前震盪假設偏樂觀，市場實際偏弱。應轉為風險控管模式，不宜追空也不宜接刀。',
    });
  } else if (bias.includes('偏多')) {
    conditions.push({
      scenario: '盤前判斷偏多觀察，但台積電開高走低、台指期轉弱',
      condition: '台積電開高後明顯回落、台指期無法同步走強、半導體族群無法擴散',
      action: '盤前偏多假設失效。市場雖有利多但資金不買單，應降權盤前判斷，以觀察為主。',
    });
    conditions.push({
      scenario: '盤前判斷偏多，但開盤後量能萎縮、只漲權值不漲族群',
      condition: '指數上漲但多數個股未跟進，量能明顯不足',
      action: '盤前偏多假設部分成立但強度不足，不宜追高。等待量能確認後再調整部位。',
    });
  } else if (bias.includes('偏弱') || bias.includes('偏空')) {
    conditions.push({
      scenario: '盤前判斷偏保守，但市場低開高走且族群擴散',
      condition: '開盤雖弱但 30 分鐘內出現明顯低接買盤，權值股止穩反彈，族群跟進',
      action: '盤前保守判斷需要修正。賣壓已被消化，市場轉為反彈或偏多情境。',
    });
  }

  // Universal failure conditions
  conditions.push({
    scenario: '主要 Symbol 資料不足',
    condition: '若核心觀察標的（台積電、台指期、加權指數）資料不完整或延遲',
    action: '不得產生強方向結論。以觀察為主，等待資料補齊。',
  });

  conditions.push({
    scenario: '盤中出現重大新聞或事件',
    condition: '若盤中出現非預期的重大新聞（如政策變動、國際事件），改變市場原本方向',
    action: '盤前劇本立即降權，以事件後的新市場共識為判斷基礎。',
  });

  return conditions.slice(0, 4);
}

// ==================== SECTION 8: 收盤驗證與明日修正 ====================

function buildCloseVerification(
  report: Report | null,
  isNonTradingDay: boolean,
  isDataSufficient: boolean,
): CloseVerification {
  if (isNonTradingDay || !report) {
    return {
      premarketAssumption: report?.market_bias || '—',
      closeResult: '非交易日，無收盤資料',
      verdict: '資料不足，不做驗證',
      whereCorrect: '—',
      whereOff: '—',
      tomorrowAdjustment: '等待下一個交易日開盤後重新建立盤前假設。',
      dataAvailable: false,
    };
  }

  if (!isDataSufficient) {
    return {
      premarketAssumption: report.market_bias || '觀察中',
      closeResult: '資料不足，無法進行收盤驗證',
      verdict: '資料不足，不做驗證',
      whereCorrect: '—',
      whereOff: '—',
      tomorrowAdjustment: '等待核心資料補齊後進行收盤驗證。',
      dataAvailable: false,
    };
  }

  // Try to get close verification from ai_strategy_json
  const aiJson = (report as unknown as Record<string, unknown> | null)?.ai_strategy_json as Record<string, unknown> | null;
  const memberReading = aiJson?.member_reading as Record<string, unknown> | null;

  return {
    premarketAssumption: `盤前假設：${report.market_bias || '觀察中'}（把握度 ${report.confidence_score ?? '—'}/100）`,
    closeResult: renderSafeText(memberReading?.close_result || '收盤驗證資料尚未產生'),
    verdict: renderSafeText(memberReading?.verdict || '資料不足，不做驗證'),
    whereCorrect: renderSafeText(memberReading?.where_correct || '—'),
    whereOff: renderSafeText(memberReading?.where_off || '—'),
    tomorrowAdjustment: renderSafeText(memberReading?.tomorrow_adjustment || '等待下一次盤前報告更新，比對今日盤前假設與收盤結果，修正明日觀察方向。'),
    dataAvailable: !!memberReading?.close_result,
  };
}
