/**
 * Morning Alpha — Content Quality Organizer V1
 *
 * 只整理既有資料，不創造假資料。
 * 功能：股票/族群去重、風險分層提醒、觀察重點強化、會員預覽文案。
 */

import { renderSafeText, renderStockItem } from '@/utils/renderSafe';

// ═══════════════════════════════════════════════════
// 一、股票與族群去重
// ═══════════════════════════════════════════════════

/** 台灣股票代號 / 名稱 normalization mapping */
const STOCK_ALIAS_MAP: Record<string, string> = {
  '2330': '2330',
  '台積電': '2330',
  'TSMC_TW': '2330',
  'TSMC': '2330',
  'tsmc': '2330',
  '台積電(2330)': '2330',
  '台積電 (2330)': '2330',
  '2317': '2317',
  '鴻海': '2317',
  '鴻海(2317)': '2317',
  '2454': '2454',
  '聯發科': '2454',
  '聯發科(2454)': '2454',
  '3008': '3008',
  '大立光': '3008',
  '大立光(3008)': '3008',
  'TAIEX': 'TAIEX',
  '加權指數': 'TAIEX',
  '台股加權': 'TAIEX',
  'TXF': 'TXF',
  '台指期': 'TXF',
  'NVDA': 'NVDA',
  'TSM': 'TSM',
  'SPX': 'SPX',
  'SOX': 'SOX',
};

/**
 * 標準化股票 key — 讓 2330、台積電、TSMC_TW 統一成同一個 key。
 */
export function normalizeStockKey(nameOrSymbol: string): string {
  const cleaned = nameOrSymbol.trim();
  // Direct alias lookup
  if (STOCK_ALIAS_MAP[cleaned]) return STOCK_ALIAS_MAP[cleaned];
  // Try numeric code extraction: "台積電(2330)" → "2330"
  const codeMatch = cleaned.match(/\(?(\d{4})\)?/);
  if (codeMatch && STOCK_ALIAS_MAP[codeMatch[1]]) {
    return STOCK_ALIAS_MAP[codeMatch[1]];
  }
  // Return cleaned lowercase as fallback
  return cleaned.toLowerCase();
}

/**
 * 標準化股票顯示名稱 — 優先顯示「名稱(代號)」格式
 */
export function normalizeStockDisplay(stock: unknown): string {
  if (!stock) return '';
  if (typeof stock === 'string') {
    const key = normalizeStockKey(stock);
    // Reverse lookup for display
    const displayMap: Record<string, string> = {
      '2330': '台積電(2330)',
      '2317': '鴻海(2317)',
      '2454': '聯發科(2454)',
      '3008': '大立光(3008)',
      'TAIEX': '加權指數',
      'TXF': '台指期',
      'NVDA': 'NVDA',
      'TSM': 'TSM ADR',
      'SPX': 'S&P 500',
      'SOX': '費城半導體',
    };
    return displayMap[key] || stock;
  }
  if (typeof stock === 'object') {
    const s = stock as Record<string, unknown>;
    const name = renderSafeText(s.name || s.symbol || s.title || s.ticker || '');
    return normalizeStockDisplay(name);
  }
  return String(stock);
}

export interface DedupeOptions {
  /** 每個區塊最多顯示幾個項目 */
  maxItems?: number;
}

/**
 * 去重陣列 — 根據 normalizeStockKey 合併重複項目。
 * 保留第一次出現的項目，只回傳不超過 maxItems 個。
 */
export function dedupeItems<T>(
  items: T[],
  keyFn: (item: T) => string,
  options: DedupeOptions = {},
): T[] {
  const { maxItems = 3 } = options;
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
      if (result.length >= maxItems) break;
    }
  }
  return result;
}

/**
 * 對字串陣列去重（用 normalizeStockKey）
 */
export function dedupeStringItems(items: string[], maxItems = 3): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = normalizeStockKey(item);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
      if (result.length >= maxItems) break;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════
// 二、今日風險提醒（三種層級）
// ═══════════════════════════════════════════════════

export type RiskLevel = 'high' | 'medium' | 'low' | 'info';

export interface RiskEntry {
  level: RiskLevel;
  title: string;
  message: string;
}

interface RiskInput {
  confidenceScore: number | null;
  isNonTradingDay: boolean;
  marketBias: string | null;
  dataQuality: string;
  /** '震盪' in display label → range-bound market */
  isRangeBound: boolean;
  /** 是否來自 intelligence engine 的風險原因 */
  intelligenceRiskReason?: string;
}

/**
 * 根據市場狀態產生分層風險提醒。
 * 不再輸出「無風險」，永遠給有意義的提醒。
 */
export function buildRiskReminders(input: RiskInput): RiskEntry[] {
  const reminders: RiskEntry[] = [];

  // ── 層級 1：方向把握度不足 ──
  if (input.confidenceScore !== null && input.confidenceScore < 60) {
    reminders.push({
      level: 'high',
      title: '方向把握度不足',
      message: '方向把握度不足，不適合重倉判斷。建議等更多確認訊號出現後再評估方向。',
    });
  }

  // ── 層級 2：非交易日 ──
  if (input.isNonTradingDay) {
    reminders.push({
      level: 'info',
      title: '非交易日',
      message: '非交易日僅作最近交易日回顧，不產生今日盤中判斷。請以回顧與學習心態檢視下方資料。',
    });
  }

  // ── 層級 3：震盪盤 ──
  if (input.isRangeBound || (input.marketBias && input.marketBias.includes('震盪'))) {
    reminders.push({
      level: 'medium',
      title: '震盪盤風險',
      message: '震盪盤最容易追高殺低，今日重點是等確認而不是猜方向。不要在方向未明時勉強交易。',
    });
  }

  // ── 層級 4：資料不足 ──
  if (input.dataQuality === 'insufficient' || input.dataQuality === 'partial') {
    reminders.push({
      level: 'medium',
      title: '資料不足提醒',
      message: '部分核心市場資料尚未到位，盤前判斷權重應降低。開盤後以實際走勢為準。',
    });
  }

  // ── 層級 5：intelligence risk reason ──
  if (input.intelligenceRiskReason && input.intelligenceRiskReason.length > 0) {
    // If the risk is only about missing market_news, show as small info hint
    const isOnlyNewsMissing =
      input.intelligenceRiskReason.includes('缺少') &&
      input.intelligenceRiskReason.includes('市場新聞') &&
      !input.intelligenceRiskReason.includes('TAIEX') &&
      !input.intelligenceRiskReason.includes('2330') &&
      !input.intelligenceRiskReason.includes('TXF');
    if (isOnlyNewsMissing) {
      reminders.push({
        level: 'info',
        title: '新聞資料提示',
        message: '新聞資料尚未完整，不影響目前市場數據判斷；今日判斷以 TAIEX、2330、TXF 與主要國際指標為主。',
      });
    } else {
      reminders.push({
        level: 'low',
        title: '系統風險提醒',
        message: input.intelligenceRiskReason,
      });
    }
  }

  // ── Fallback：沒有明確風險也不要說「無風險」 ──
  if (reminders.length === 0) {
    reminders.push({
      level: 'info',
      title: '常態觀察',
      message: '目前未偵測到重大單一風險，但仍需等待開盤後確認。市場永遠有可能出現意外事件。',
    });
  }

  return reminders;
}

// ═══════════════════════════════════════════════════
// 三、今日觀察重點（有價值格式）
// ═══════════════════════════════════════════════════

export interface ObservationItem {
  /** 標題：如「台積電(2330)」 */
  title: string;
  /** 副標：如「權值風向」 */
  subtitle: string;
  /** 理由 */
  reason: string;
  /** 觀察時間 */
  watchTimes: string[];
}

interface ObservationInput {
  /** ai_strategy_json.overnight_impact_chains */
  impactChains?: Record<string, unknown>[];
  /** market_state.displayLabel */
  marketBias?: string;
  /** 是否非交易日 */
  isNonTradingDay: boolean;
}

/**
 * 從既有資料產生有價值的觀察重點。
 * 不再只顯示「台積電：影響整體市場情緒」這種空泛句。
 */
export function buildObservationFocus(input: ObservationInput): ObservationItem[] {
  const items: ObservationItem[] = [];

  // V7.54: Only show non-trading message on actual weekends — not when data basis differs
  if (input.isNonTradingDay) {
    items.push({
      title: '非交易日',
      subtitle: '回顧模式',
      reason: '此項目僅作盤前觀察，不作買賣建議。非交易日以回顧最近交易日資料為主。',
      watchTimes: [],
    });
    return items;
  }

  const chains = input.impactChains || [];

  for (const chain of chains.slice(0, 3)) {
    const c = chain as Record<string, unknown>;

    // Extract stocks
    const stocks = Array.isArray(c.representative_stocks) ? c.representative_stocks : [];
    // Extract sectors
    const sectors = Array.isArray(c.affected_sectors) ? c.affected_sectors : [];
    // Extract watch points
    const watchPoints = Array.isArray(c.intraday_watch_points) ? c.intraday_watch_points : [];

    // Determine title from first stock
    const firstStock = stocks.length > 0 ? stocks[0] : null;
    const title = normalizeStockDisplay(firstStock || sectors[0] || '');

    // Subtitle from chain theme or first stock role
    const stockObj = firstStock && typeof firstStock === 'object' ? (firstStock as Record<string, unknown>) : null;
    const subtitle = renderSafeText(c.chain_title || c.theme || (stockObj?.role) || '觀察中');

    // Build reason
    let reason = renderSafeText(c.plain_language_summary || c.summary || '');
    if (!reason || reason.length < 15) {
      // Build from stock role + reason
      const stockReason = stockObj?.reason ? renderSafeText(stockObj.reason) : '';
      if (stockReason) {
        reason = `若${title}開盤後走勢與盤前假設不一致，代表盤前劇本需要降權觀察。${stockReason}`;
      } else {
        reason = `若${title}開盤後走勢與盤前假設不一致，代表盤前劇本需要降權觀察。`;
      }
    }

    // Watch times
    const times: string[] = [];
    if (watchPoints.length > 0) {
      times.push(...watchPoints.slice(0, 3).map(renderSafeText).filter(Boolean));
    }
    if (times.length === 0) {
      times.push('09:00 開盤確認', '10:30 盤中確認', '13:00 收盤前確認');
    }

    if (title) {
      items.push({ title, subtitle, reason, watchTimes: times });
    }
  }

  // Default fallback items if nothing found
  if (items.length === 0) {
    items.push({
      title: '台積電（2330）',
      subtitle: '權值風向',
      reason: '觀察台積電是否延續早盤強勢，若漲幅明顯收斂，電子權值股續航力需要重新確認。',
      watchTimes: ['09:00 開盤', '10:30 確認', '13:00 收盤前'],
    });
    items.push({
      title: '台指期（TXF）',
      subtitle: '期現基差',
      reason: '觀察台指期是否持續領先現貨，若期現貨方向背離，盤前偏多假設需降級。',
      watchTimes: ['09:00 開盤', '10:30 確認', '13:00 收盤前'],
    });
    items.push({
      title: '主流族群',
      subtitle: '方向確認',
      reason: '觀察半導體、AI 伺服器、電源與散熱是否同步延續，若只剩單一族群撐盤，偏多判斷不可過度放大。',
      watchTimes: ['09:00 開盤', '10:30 確認', '13:00 收盤前'],
    });
  }

  return items.slice(0, 3);
}

// ═══════════════════════════════════════════════════
// 四、會員預覽吸引文案
// ═══════════════════════════════════════════════════

export const MEMBER_PREVIEW = {
  title: '會員完整判讀會多看到什麼？',
  subtitle: '免費版看今日摘要；會員版會看完整盤前邏輯、隔夜影響鏈、盤中修正與收盤驗證。',
  items: [
    {
      title: '完整盤前腳本',
      desc: '拆解美股、半導體、台積電、台指期與新聞催化因子，判斷今天市場站在哪一邊。',
    },
    {
      title: '隔夜影響鏈',
      desc: '把海外新聞與美股變化，連到台股族群、代表個股與今日觀察點。',
    },
    {
      title: '今日不要做清單',
      desc: '列出今天盤中最容易犯的交易錯誤，例如追高、過度解讀、方向未確認就重倉。',
    },
    {
      title: '盤中追蹤修正',
      desc: '開盤後檢查盤前假設是否仍成立，若市場方向改變，提示需要降權或修正的觀察重點。',
    },
    {
      title: '收盤驗證與明日觀察',
      desc: '收盤後回看今日盤前假設、盤中追蹤與實際結果是否一致，累積隔日判斷依據。',
    },
  ],
  ctaText: '先免費看每日摘要，等系統穩定後再開放早鳥訂閱',
  ctaButton: '早鳥訂閱即將開放',
  disclaimer: '目前公開測試階段，系統穩定後將開放早鳥名單；不會強迫付費。',
};

// ═══════════════════════════════════════════════════
// 五、首頁免費摘要收斂（只保留 5 項）
// ═══════════════════════════════════════════════════

export const HOME_FREE_SECTIONS = [
  '今日狀態',
  '今日一句話',
  '今天不要做',
  '今日心法',
  '查看最近交易日判斷',
] as const;

// ═══════════════════════════════════════════════════
// 六、會員完整判讀價值區 — 首頁用（5 項核心）
// ═══════════════════════════════════════════════════

export const MEMBER_VALUE_HOME = {
  sectionTitle: '會員版會強在哪裡？',
  subtitle:
    '免費版看今日大方向與一句提醒；會員版每天打開就是一套完整的盤前研究員筆記——從主劇本到收盤驗證，不用自己拼湊新聞。',
  items: [
    {
      id: 'full-script',
      question: '今天市場為什麼站在這一邊？',
      title: '完整盤前劇本',
      desc: '拆解美股、半導體、台積電、台指期、匯率與新聞催化因子，形成今日盤前主劇本，包含成立條件與失效條件。',
      tag: '盤前核心',
    },
    {
      id: 'impact-chain',
      question: '昨晚發生的事，今天會影響誰？',
      title: '隔夜影響鏈',
      desc: '把海外新聞與美股變化，連到台股族群、代表個股與盤中觀察點，不只看新聞標題，而是看因果鏈。',
      tag: '因果鏈',
    },
    {
      id: 'dont-do',
      question: '先避開今天最容易犯的錯',
      title: '今日不要做清單',
      desc: '3～5 條直接有用的行為提醒——例如追高、錯把反彈當轉強、方向未確認就重倉。',
      tag: '風險控管',
    },
    {
      id: 'intraday',
      question: '開盤後，盤前劇本有沒有被市場驗證？',
      title: '盤中追蹤修正',
      desc: '09:15 後檢查盤前假設是否仍成立，若市場方向改變，提示需要降權或修正的觀察重點。',
      tag: '盤中校正',
    },
    {
      id: 'close-review',
      question: '每天回測一次，累積更穩的市場節奏',
      title: '收盤驗證與隔日觀察',
      desc: '收盤後回看盤前假設、盤中追蹤與實際結果是否一致，整理隔日需要注意的風險與修正方向。',
      tag: '驗證回饋',
    },
  ],
  ctaText: '先免費看每日摘要，等系統穩定後再開放早鳥訂閱',
  ctaButton: '早鳥訂閱即將開放',
  disclaimer: '目前公開測試階段，系統穩定後才會開放早鳥名單；不會強迫付費。',
};

// ═══════════════════════════════════════════════════
// 七、會員完整判讀預覽 — /report/today 用（8 段研究筆記）
// ═══════════════════════════════════════════════════

export const MEMBER_VALUE_TODAY = {
  // Layer 1 — title shown above free content
  layer1Title: '第一層：今日核心判斷（免費可看）',
  layer1Desc: '盤前假設、方向把握度、內容品質、今日一句話 — 每天開盤前先看這個。',

  // Layer 2 — 會員 8 段研究筆記
  layer2Title: '第二層：會員完整研究筆記',
  layer2Desc:
    '以下 8 段內容不是新聞摘要，而是每天盤前的研究員判斷框架。免費版只顯示前 1～2 行預覽，會員解鎖後可看完整內容。',
  lockHint: '會員解鎖後可查看完整研究筆記、盤中驗證與收盤修正。',
  sections: [
    {
      id: 'main-script',
      title: '一、今日主劇本',
      desc: '今日盤前假設、把握度、主要原因、市場情境、成立條件。',
      previewHint: '會員解鎖後可看完整主劇本與確認條件',
    },
    {
      id: 'evidence',
      title: '二、資料證據',
      desc: '3～5 筆資料證據，每筆說明它支持什麼判斷。',
      previewHint: '會員解鎖後可看完整資料證據清單',
    },
    {
      id: 'impact-chains',
      title: '三、隔夜影響鏈',
      desc: '昨晚發生的事如何影響台股族群、代表觀察股、盤中觀察點與失效條件。',
      previewHint: '會員解鎖後可看完整影響鏈與代表個股',
    },
    {
      id: 'dont-do',
      title: '四、今日不要做清單',
      desc: '今天盤中最容易犯的 3～5 個交易錯誤。',
      previewHint: '會員解鎖後可看完整 3～5 條不要做清單',
    },
    {
      id: 'watchlist',
      title: '五、今日觀察名單',
      desc: '核心觀察、次要觀察、風險觀察三個層級，每檔都說明為什麼要觀察。',
      previewHint: '會員解鎖後可看完整觀察名單與強弱判斷',
    },
    {
      id: 'tracking',
      title: '六、盤中追蹤計畫',
      desc: '09:00～13:00 四個時間點的明確觀察問題。',
      previewHint: '會員解鎖後可看完整盤中追蹤時間表',
    },
    {
      id: 'failure-conditions',
      title: '七、失效條件',
      desc: '什麼情況代表今天判斷錯了，以及對應的修正動作。',
      previewHint: '會員解鎖後可看完整失效條件與修正方案',
    },
    {
      id: 'close-verification',
      title: '八、收盤驗證與明日修正',
      desc: '盤前假設 vs. 收盤結果，誠實回看哪裡對、哪裡偏保守或失準。',
      previewHint: '會員解鎖後可看完整收盤驗證與明日修正',
    },
  ],

  // Layer 3 — retention value
  layer3Title: '為什麼這會讓你每天想回來？',
  layer3Points: [
    '不是報明牌，而是每天建立市場判斷節奏。',
    '不是追新聞，而是把新聞、指數、族群與個股串成因果鏈。',
    '不是只看漲跌，而是每天盤後驗證，累積下一次更穩的判斷。',
  ],
};