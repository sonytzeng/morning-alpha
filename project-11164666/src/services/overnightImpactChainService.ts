/**
 * Morning Alpha — Overnight Impact Chain Service
 *
 * Transforms raw market data (global news, US indices, sector scores)
 * into user-facing "今日隔夜影響鏈" (Today's Overnight Impact Chains).
 *
 * Each chain answers:
 *   昨晚發生什麼 → 台股哪些族群受影響 → 代表股與原因 → 盤中驗證點 → 失敗條件
 *
 * This service does NOT modify any database schema. It works with existing
 * data sources (market_news, market_data, reports, opening_radar, sector_rotation_scores).
 */

import type { NewsItem } from '@/services/marketNewsService';
import type { OpeningRadar } from '@/services/openingRadarService';
import type { Report } from '@/types/report';
import type { SectorRotationItem } from '@/services/sectorRotationService';

// ════════════════════════════════════════════
// Type Definitions
// ════════════════════════════════════════════

export type CatalystType =
  | 'us_tech'
  | 'us_financial'
  | 'oil_energy'
  | 'ai_cloud'
  | 'fx_dollar'
  | 'global_news'
  | 'macro'
  | 'shipping';

export type ImpactDirection = 'positive' | 'negative' | 'mixed' | 'watch';

export interface RepresentativeStock {
  symbol: string;
  name: string;
  reason: string;
  impactDirection: ImpactDirection;
}

export interface OvernightImpactChain {
  id: string;
  catalystType: CatalystType;
  catalystTitle: string;
  /** 主線排名：1=最重要，2=次重要，3=風險/反向觀察 */
  mainLineRank: number;
  /** 主線名稱，e.g. "美股半導體轉弱，台股權值股承壓" */
  mainLineTitle: string;
  catalystSummary: string;
  /** 隔夜原因：哪個美股/ADR/新聞/總經造成的 */
  overnightCause: string;
  sourceTime: string | null;
  globalDriver: string;
  taiwanImpactDirection: ImpactDirection;
  /** 台股可能影響 */
  taiwanImpact: string;
  affectedSectors: string[];
  representativeStocks: RepresentativeStock[];
  watchPoints: string[];
  /** 盤中驗證點：開盤後如何確認這條主線是否成立 */
  verificationPoints: string[];
  /** 失敗條件：什麼狀況出現代表這條主線不成立 */
  failureConditions: string;
  riskNotes: string[];
  confidenceScore: number;
  displayLabel: string;
  /** Free tier shows fewer stocks */
  freeStockLimit: number;
}

export interface BuildImpactChainsParams {
  marketNews: NewsItem[] | null;
  marketData: Array<{ symbol: string; change_percent?: number | null; name?: string }> | null;
  todayReport: Report | null;
  openingRadar: OpeningRadar | null;
  sectorRotation: SectorRotationItem[] | null;
  todayDate: string;
}

export interface ImpactChainFreshness {
  hasChains: boolean;
  chainsGenerated: number;
  isDataSufficient: boolean;
  displayTitle: string;
  warning: string;
}

// ════════════════════════════════════════════
// Catalyst → Taiwan Sector Mapping
// ════════════════════════════════════════════

interface CatalystMapping {
  type: CatalystType;
  triggerKeywords: string[];
  affectedSectors: string[];
  representativeStocks: Array<{
    symbol: string;
    name: string;
    reason: string;
  }>;
  watchPoints: string[];
  /** 盤中驗證點 — 如何確認這條主線成立 */
  verificationPoints: string[];
  /** 失敗條件 — 什麼狀況出現代表不成立 */
  failureConditions: string;
  riskNotes: string[];
  displayLabel: string;
  /** 主線名稱模板 */
  mainLineTitlePositive: string;
  mainLineTitleNegative: string;
  mainLineTitleNeutral: string;
  /** 台股影響描述 */
  taiwanImpactPositive: string;
  taiwanImpactNegative: string;
  taiwanImpactNeutral: string;
}

const CATALYST_MAPPINGS: CatalystMapping[] = [
  // ── 1. US Tech / Semiconductor ──
  {
    type: 'us_tech',
    triggerKeywords: [
      'NVDA', 'AMD', 'AVGO', 'TSM', 'SOX', 'SOXX', 'NASDAQ',
      '半導體', '費半', '晶片', 'nvidia', 'amd', 'broadcom',
      'TSMC', '台積電ADR', 'Intel', 'INTC', 'MU',
    ],
    affectedSectors: ['半導體', 'AI 伺服器', 'PCB / CCL', '散熱'],
    representativeStocks: [
      { symbol: '2330', name: '台積電', reason: '半導體權值核心，若開低不收斂，代表大盤壓力仍在' },
      { symbol: '2454', name: '聯發科', reason: 'IC 設計代表，觀察是否跟隨半導體情緒轉弱' },
      { symbol: '2382', name: '廣達', reason: 'AI 伺服器代表，若能抗跌，代表資金仍留在 AI 鏈' },
      { symbol: '3711', name: '日月光投控', reason: '封測龍頭，半導體景氣上下游同步指標' },
      { symbol: '2383', name: '台光電', reason: '高速 CCL 材料，AI 伺服器 PCB 上游供需指標' },
    ],
    watchPoints: [
      '開盤 15 分鐘是否站回平盤',
      '台積電是否比大盤強或弱',
      '類股指數是否同步',
      '成交量是否放大承接',
    ],
    verificationPoints: [
      '開盤 15 分鐘：台積電與半導體指數是否站回平盤或持續下探',
      '10:00 前：NVDA 概念股（廣達、緯創）是否有量能承接',
      '盤中：費半走勢與台股半導體族群是否方向一致',
    ],
    failureConditions: '若台積電開低後快速站回平盤且量能放大，半導體壓力需降權；若 AI 伺服器股逆勢抗跌，代表資金仍在 AI 鏈而非全面撤退。',
    riskNotes: [
      '美股收盤後至台股開盤前可能出現新變數',
      '隔夜大漲後台股可能開高走低，需觀察盤中續航力',
      '單一美股個股波動不必然帶動台股整族群',
    ],
    displayLabel: '隔夜美股半導體',
    mainLineTitlePositive: '美股半導體轉強，台股權值股可望受惠',
    mainLineTitleNegative: '美股半導體轉弱，台股權值股承壓',
    mainLineTitleNeutral: '美股半導體震盪，台股權值股方向待確認',
    taiwanImpactPositive: '半導體族群偏多，若開盤台積電與費半同步走強，有機會帶動大盤。',
    taiwanImpactNegative: '半導體族群可能承壓，若台積電開低且賣壓擴散至 AI 伺服器與 PCB，大盤短線偏保守。',
    taiwanImpactNeutral: '半導體族群方向分歧，台積電與費半未同步，以觀察為主。',
  },

  // ── 2. US Financial / Rate / Bond Yield ──
  {
    type: 'us_financial',
    triggerKeywords: [
      'JPM', 'BAC', 'GS', '金融', '銀行', '利率', 'Fed', 'FOMC',
      '美債', '殖利率', 'treasury', 'yield', '升息', '降息',
      '金融股', 'Morgan', 'Citi', 'Wells Fargo', 'WFC',
    ],
    affectedSectors: ['金融保險', '金控', '壽險'],
    representativeStocks: [
      { symbol: '2891', name: '中信金', reason: '大型金控，對利率預期與金融情緒敏感度最高' },
      { symbol: '2881', name: '富邦金', reason: '壽險與金控雙主軸，利率變動直接影響資產評價' },
      { symbol: '2882', name: '國泰金', reason: '壽險權值代表，美債殖利率變動連動性高' },
      { symbol: '2885', name: '元大金', reason: '證券與銀行雙引擎，市場成交量與情緒指標' },
      { symbol: '2886', name: '兆豐金', reason: '外匯與企金權重高，美元走勢與利差影響大' },
    ],
    watchPoints: [
      '開盤金融指數是否有資金承接',
      '外資買賣超是否轉向金融股',
      '金融族群是否整齊上漲或僅個股表現',
    ],
    verificationPoints: [
      '開盤 30 分鐘：金融指數是否與大盤同步，還是逆勢走強（避險訊號）',
      '盤中：成交量是否放大，資金是否從電子轉向金融',
      '若金融股逆勢走強但電子股下跌，可能代表資金避險而非全面樂觀',
    ],
    failureConditions: '若金融股沒有量能且大盤由電子股主導，金融不可視為資金避險主線；若利率走勢與金融股方向背離，此主線需降權。',
    riskNotes: [
      '美國金融股與台股金融股連動並非 1:1',
      '若利率上升是因通膨疑慮，對整體股市可能是壓力而非利多',
      '金融股走強有時是資金避險訊號，不代表大盤樂觀',
    ],
    displayLabel: '隔夜美國金融',
    mainLineTitlePositive: '美金融股與利率訊號偏多，台股金融可望受惠',
    mainLineTitleNegative: '利率環境不利，金融股可能相對抗跌但不是主攻方向',
    mainLineTitleNeutral: '利率與金融訊號分歧，金融股方向待確認',
    taiwanImpactPositive: '金融股偏多觀察，若外資持續買超金融，有機會成為今日穩定力量。',
    taiwanImpactNegative: '金融股可能相對抗跌，但不代表是今日主攻方向；若利率不利，壽險評價承壓。',
    taiwanImpactNeutral: '金融股方向不明，等待更多利率與外資訊號。',
  },

  // ── 3. Oil / Energy ──
  {
    type: 'oil_energy',
    triggerKeywords: [
      'WTI', 'Brent', '原油', '油價', 'XOM', 'CVX', '能源',
      'OPEC', '石油', 'oil', 'crude', 'energy',
    ],
    affectedSectors: ['塑化', '航運', '航空'],
    representativeStocks: [
      { symbol: '1301', name: '台塑', reason: '塑化龍頭，油價變動直接影響原料成本與產品報價' },
      { symbol: '1303', name: '南亞', reason: '塑化與電子材料雙主軸，原油成本敏感度高' },
      { symbol: '1326', name: '台化', reason: '塑化一貫廠，原油價格影響上下游利差' },
      { symbol: '2618', name: '長榮航', reason: '航空燃油佔營運成本 30%+，油價變動直接影響獲利' },
      { symbol: '2610', name: '華航', reason: '航空業者，燃油成本與客運需求雙重影響' },
    ],
    watchPoints: [
      '塑化族群開盤是否反映油價變動',
      '航空股是否因油價上漲承壓',
      '航運股運價與油價的連動是否符合預期',
    ],
    verificationPoints: [
      '開盤後：塑化股是否跟隨油價方向表態',
      '若油價上漲：航空股是否承壓，資金是否轉向塑化',
      '若油價下跌：航空股是否受惠，塑化股是否承壓',
    ],
    failureConditions: '若油價變動但台股相關族群沒有反應（量價皆無），代表今日市場焦點不在油價相關；若油價暴漲暴跌但無新聞支撐，可能只是短期波動。',
    riskNotes: [
      '油價短期波動不必然改變塑化族群趨勢',
      '航空股受多重因素影響，單一油價因素不足以判斷',
      'OPEC 政策與地緣政治風險可能使油價快速逆轉',
    ],
    displayLabel: '隔夜油價能源',
    mainLineTitlePositive: '油價變動影響塑化與航運評價',
    mainLineTitleNegative: '油價變動影響塑化與航運評價',
    mainLineTitleNeutral: '油價變動影響塑化與航運評價',
    taiwanImpactPositive: '油價走勢可能影響塑化成本與航空燃油成本，觀察相關族群資金流向。',
    taiwanImpactNegative: '油價走勢可能影響塑化成本與航空燃油成本，觀察相關族群資金流向。',
    taiwanImpactNeutral: '油價方向不明，相關族群以觀察為主。',
  },

  // ── 4. AI / Cloud CAPEX ──
  {
    type: 'ai_cloud',
    triggerKeywords: [
      'AI', 'cloud', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA',
      '雲端', '資本支出', 'CAPEX', '人工智慧', '資料中心',
      'datacenter', 'Microsoft', 'Google', 'Amazon', 'Meta',
    ],
    affectedSectors: ['AI 伺服器', '散熱', '電源', 'PCB / CCL'],
    representativeStocks: [
      { symbol: '2382', name: '廣達', reason: 'AI 伺服器 ODM 龍頭，雲端 CAPEX 直接受益' },
      { symbol: '3231', name: '緯創', reason: 'AI 伺服器組裝，NVDA GPU 供應鏈核心' },
      { symbol: '6669', name: '緯穎', reason: '雲端伺服器 ODM，Meta/MSFT 供應鏈直連' },
      { symbol: '2356', name: '英業達', reason: '伺服器 ODM，受惠雲端需求擴張' },
      { symbol: '3017', name: '奇鋐', reason: '散熱模組龍頭，GPU 功耗上升直接帶動需求' },
    ],
    watchPoints: [
      'AI 伺服器族群開盤是否有量能延續',
      '是僅開高走低還是持續有買盤承接',
      '散熱與 PCB 族群是否同步轉強',
    ],
    verificationPoints: [
      '開盤後：AI 伺服器股（廣達、緯創）是否有量能承接，還是僅開高走低',
      '10:00 前：散熱股（奇鋐、雙鴻）是否跟進，族群擴散是確認關鍵',
      '若開高走低且量縮：代表追價意願不足，需降權',
    ],
    failureConditions: '若 AI 伺服器股開高走低且量能萎縮，代表資金追價意願不足；若只有單一個股強勢但其他未跟進，不可視為族群行情。',
    riskNotes: [
      'AI CAPEX 預期與實際執行之間常有落差',
      '台股 AI 鏈已多次反映預期，需注意評價是否偏高',
      '單一 CSP 調整 CAPEX 不必然代表整體趨勢轉向',
    ],
    displayLabel: '隔夜 AI 雲端',
    mainLineTitlePositive: 'AI 伺服器鏈仍有資金觀察，但需防追高',
    mainLineTitleNegative: 'AI 伺服器鏈承壓，需觀察資金是否撤出',
    mainLineTitleNeutral: 'AI 伺服器鏈方向待確認，觀察資金流向',
    taiwanImpactPositive: 'AI 伺服器族群偏多觀察，若能抗跌且量能放大，代表資金仍留在 AI 鏈。',
    taiwanImpactNegative: 'AI 伺服器族群可能承壓，若開盤後賣壓擴散至散熱與 PCB，短線應以防守為主。',
    taiwanImpactNeutral: 'AI 伺服器族群方向分歧，等待量能與族群擴散確認。',
  },

  // ── 5. FX / Dollar / TWD ──
  {
    type: 'fx_dollar',
    triggerKeywords: [
      'DXY', '美元', '匯率', '台幣', 'TWD', '外資', 'dollar',
      'USD', '新台幣', '匯市', '資金流向', 'Fed',
    ],
    affectedSectors: ['出口電子', '壽險', '金融'],
    representativeStocks: [
      { symbol: '2330', name: '台積電', reason: '外資持股比重最高，匯率直接影響外資資金流向' },
      { symbol: '2317', name: '鴻海', reason: '出口權值代表，台幣貶值有利出口競爭力' },
      { symbol: '2882', name: '國泰金', reason: '壽險海外投資部位大，匯率避險成本直接影響獲利' },
      { symbol: '2881', name: '富邦金', reason: '壽險金控，美元資產評價與匯率高度相關' },
    ],
    watchPoints: [
      '外資期現貨動向是否與匯率走勢一致',
      '台幣升貶是否帶動權值股資金流入或流出',
      '金融股是否因匯率避險需求出現異常波動',
    ],
    verificationPoints: [
      '開盤後：外資買賣超方向是否與匯率走勢一致',
      '若台幣升值：資金是否流入權值股',
      '若台幣貶值：出口股是否受惠，但外資是否撤出',
    ],
    failureConditions: '若匯率變動但外資買賣超方向相反，此主線不成立；匯率短期波動未必反映中長期資金趨勢。',
    riskNotes: [
      '匯率短期波動不一定反映外資中長期動向',
      '央行干預可能改變短期匯率走勢',
      '美元走強對出口有利但對資金流向不利，需綜合判斷',
    ],
    displayLabel: '隔夜匯率美元',
    mainLineTitlePositive: '美元與匯率變動影響外資流向與出口評價',
    mainLineTitleNegative: '美元與匯率變動影響外資流向與出口評價',
    mainLineTitleNeutral: '美元與匯率變動影響外資流向與出口評價',
    taiwanImpactPositive: '匯率走勢可能影響外資流向與出口電子股評價，觀察資金動向。',
    taiwanImpactNegative: '匯率走勢可能影響外資流向與出口電子股評價，觀察資金動向。',
    taiwanImpactNeutral: '匯率方向不明，等待更多外資與資金流向訊號。',
  },

  // ── 6. Shipping / Freight ──
  {
    type: 'shipping',
    triggerKeywords: [
      'BDI', 'SCFI', '運價', '航運', '紅海', '港口', '罷工',
      '貨櫃', '散裝', 'shipping', 'baltic', 'container', 'freight',
      'Houthi', '蘇伊士', '巴拿馬', '運河',
    ],
    affectedSectors: ['貨櫃航運', '散裝航運'],
    representativeStocks: [
      { symbol: '2603', name: '長榮', reason: '貨櫃航運龍頭，SCFI 運價直接影響營收與市場預期' },
      { symbol: '2609', name: '陽明', reason: '貨櫃航運代表，運價波動對獲利彈性大' },
      { symbol: '2615', name: '萬海', reason: '近洋貨櫃航運，區域運價敏感度高' },
      { symbol: '2606', name: '裕民', reason: '散裝航運代表，BDI 指數連動性高' },
      { symbol: '2637', name: '慧洋-KY', reason: '散裝航運，船隊規模與運價彈性高' },
    ],
    watchPoints: [
      'SCFI／BDI 指數是持續變動還是單日波動',
      '航運三雄是否同步表態',
      '地緣政治事件是否持續影響航線',
    ],
    verificationPoints: [
      '開盤後：航運三雄（長榮、陽明、萬海）是否同步反映運價變動',
      '若只有個股表現而非族群同步，不可視為產業行情',
      '確認運價變動是趨勢性還是單日事件驅動',
    ],
    failureConditions: '若運價變動但航運股沒有量價反應，此主線不成立；若運價暴漲暴跌但無供需面支撐，可能只是短期情緒。',
    riskNotes: [
      '運價波動受多重因素影響，短期不易判斷趨勢',
      '紅海／運河事件可能快速緩解，運價溢價也可能快速消失',
      '航運股波動大，需注意評價與運價是否脫鉤',
    ],
    displayLabel: '隔夜航運運價',
    mainLineTitlePositive: '運價變動影響航運族群評價',
    mainLineTitleNegative: '運價變動影響航運族群評價',
    mainLineTitleNeutral: '運價變動影響航運族群評價',
    taiwanImpactPositive: '運價上漲可能帶動航運股短線情緒，但需觀察是否為趨勢性變動。',
    taiwanImpactNegative: '運價下跌可能影響航運股評價，但航運供需面才是核心。',
    taiwanImpactNeutral: '運價方向不明，航運族群以觀察為主。',
  },

  // ── 7. Global News / Geopolitical ──
  {
    type: 'global_news',
    triggerKeywords: [
      '地緣', '戰爭', '關稅', '制裁', '貿易', '禁令',
      'china', '中國', '兩岸', '半導體禁令',
      'export control', 'chip ban', 'tariff', 'geopolitical',
    ],
    affectedSectors: ['半導體', '電子組裝', '航運'],
    representativeStocks: [
      { symbol: '2330', name: '台積電', reason: '地緣政治風險最敏感標的，供應鏈重組核心' },
      { symbol: '2317', name: '鴻海', reason: '全球佈局廣泛，關稅與貿易政策直接影響生產成本' },
      { symbol: '2454', name: '聯發科', reason: 'IC 設計出口，禁令與制裁影響終端市場' },
      { symbol: '2603', name: '長榮', reason: '全球貿易與地緣政治直接影響航線與運價' },
    ],
    watchPoints: [
      '新聞事件是否持續發酵還是單一消息',
      '半導體族群是否出現集體避險賣壓',
      '資金是否轉向內需或防禦型類股',
    ],
    verificationPoints: [
      '開盤後：相關族群是否出現集體性反應（不只是單一個股）',
      '若地緣風險升溫：資金是否轉向內需與防禦型股票',
      '事件是否持續發酵，還是開盤反映後就淡化',
    ],
    failureConditions: '若新聞事件開盤反映後快速淡化且無後續發展，此主線需降權；單一新聞消息不必然代表趨勢改變。',
    riskNotes: [
      '地緣政治事件影響範圍與持續時間難以預估',
      '單一新聞不必然改變市場中期趨勢',
      '需區分短期情緒反應與長期結構性改變',
    ],
    displayLabel: '隔夜全球事件',
    mainLineTitlePositive: '全球事件影響市場情緒，觀察資金流向',
    mainLineTitleNegative: '全球事件影響市場情緒，觀察資金流向',
    mainLineTitleNeutral: '全球事件影響市場情緒，觀察資金流向',
    taiwanImpactPositive: '外部事件可能影響台股情緒，觀察相關族群是否有資金流入。',
    taiwanImpactNegative: '外部事件可能造成避險情緒，觀察權值股與半導體是否出現賣壓。',
    taiwanImpactNeutral: '外部事件影響不明，等待更多資訊後再判斷。',
  },

  // ── 8. Macro ──
  {
    type: 'macro',
    triggerKeywords: [
      'CPI', 'PPI', 'GDP', '就業', '非農', 'ISM', 'PMI',
      '通膨', 'inflation', '失業', '初領', '經濟',
      'recession', '衰退', 'growth',
    ],
    affectedSectors: ['權值股', '金融', '營建'],
    representativeStocks: [
      { symbol: '2330', name: '台積電', reason: '總經指標影響全球科技需求預期，權值股中最敏感' },
      { symbol: '2881', name: '富邦金', reason: '總經數據影響利率預期與金融資產評價' },
      { symbol: '2882', name: '國泰金', reason: '壽險與金控，總經環境直接影響投資收益' },
      { symbol: '2317', name: '鴻海', reason: '全球製造業景氣指標受總經數據直接影響' },
    ],
    watchPoints: [
      '市場對數據的解讀是否一致',
      '權值股與金融股是否出現方向性表態',
      '外資買賣超是否反映總經預期變化',
    ],
    verificationPoints: [
      '開盤後：市場對數據的反應是否一致（多空方向統一）',
      '若數據優於預期：權值股是否有買盤承接',
      '若數據劣於預期：避險情緒是否擴散至多數族群',
    ],
    failureConditions: '若數據公佈後市場反應分歧（多空各自解讀），此主線方向不明確，不應作為主要判斷依據。',
    riskNotes: [
      '總經數據公佈常有短期劇烈波動',
      '單一數據不足以判斷趨勢，需連續觀察',
      '市場可能提前消化預期，公佈後反而反向反應',
    ],
    displayLabel: '隔夜總經指標',
    mainLineTitlePositive: '總經數據優於預期，市場情緒可望偏多',
    mainLineTitleNegative: '總經數據不如預期，市場可能轉為保守',
    mainLineTitleNeutral: '總經數據好壞參半，市場方向待確認',
    taiwanImpactPositive: '總經數據支撐多方情緒，觀察權值股與金融股是否同步走強。',
    taiwanImpactNegative: '總經數據不利，權值股可能承壓，金融股觀察利率預期變化。',
    taiwanImpactNeutral: '總經數據方向分歧，以觀察為主，等待更多訊號。',
  },
];

// ════════════════════════════════════════════
// Helper: detect catalysts from news
// ════════════════════════════════════════════

interface DetectedCatalyst {
  mapping: CatalystMapping;
  matchCount: number;
  relevantNews: string[];
  direction: ImpactDirection;
}

function detectCatalysts(newsItems: NewsItem[], openingRadar: OpeningRadar | null, report: Report | null): DetectedCatalyst[] {
  const detected: DetectedCatalyst[] = [];
  const allNewsText = newsItems.map((n) => `${n.title} ${n.category} ${n.impactSummary || ''}`).join(' ');

  for (const mapping of CATALYST_MAPPINGS) {
    let matchCount = 0;
    const relevantNews: string[] = [];

    for (const kw of mapping.triggerKeywords) {
      if (allNewsText.toLowerCase().includes(kw.toLowerCase())) {
        matchCount++;
      }
      for (const n of newsItems) {
        const newsText = `${n.title} ${n.category || ''}`;
        if (newsText.toLowerCase().includes(kw.toLowerCase()) && !relevantNews.includes(n.title)) {
          relevantNews.push(n.title);
        }
      }
    }

    if (matchCount >= 1 || relevantNews.length > 0) {
      let direction: ImpactDirection = 'watch';
      if (report?.market_bias) {
        if (report.market_bias.includes('偏多') || report.market_bias.includes('強勢')) {
          direction = 'positive';
        } else if (report.market_bias.includes('偏弱') || report.market_bias.includes('明顯偏弱')) {
          direction = 'negative';
        } else {
          direction = 'mixed';
        }
      }
      if (openingRadar?.taiex_change !== null) {
        if (openingRadar.taiex_change > 0.5) direction = 'positive';
        else if (openingRadar.taiex_change < -0.5) direction = 'negative';
        else if (openingRadar.taiex_change !== 0) direction = 'mixed';
      }
      detected.push({ mapping, matchCount, relevantNews: relevantNews.slice(0, 3), direction });
    }
  }

  detected.sort((a, b) => b.matchCount - a.matchCount);
  return detected;
}

// ════════════════════════════════════════════
// Helper: generate direction label (reduced template phrases)
// ════════════════════════════════════════════

function formatDirectionLabel(direction: ImpactDirection, mapping: CatalystMapping): string {
  switch (direction) {
    case 'positive': return '偏多觀察';
    case 'negative': return '偏空觀察';
    case 'mixed': {
      // Use the mapping context to make this more specific
      if (mapping.type === 'us_tech') return '半導體方向分歧';
      if (mapping.type === 'ai_cloud') return 'AI 族群分歧';
      if (mapping.type === 'us_financial') return '金融方向待確認';
      if (mapping.type === 'macro') return '多空數據並存';
      if (mapping.type === 'oil_energy') return '油價影響分歧';
      if (mapping.type === 'fx_dollar') return '匯率訊號分歧';
      if (mapping.type === 'shipping') return '運價訊號分歧';
      return '訊號分歧觀察';
    }
    case 'watch': return '等待更多訊號';
  }
}

// ════════════════════════════════════════════
// Helper: build natural-language overnight cause
// ════════════════════════════════════════════

function buildOvernightCause(
  direction: ImpactDirection,
  mapping: CatalystMapping,
  relevantNews: string[],
  marketData: Array<{ symbol: string; change_percent?: number | null; name?: string }> | null,
): string {
  const parts: string[] = [];

  // Add specific market data if available
  if (marketData) {
    const keySymbols = getKeyMarketSymbols(mapping.type);
    for (const sym of keySymbols) {
      const item = marketData.find((m) => m.symbol === sym);
      if (item && item.change_percent !== null && item.change_percent !== undefined) {
        const name = item.name || sym;
        const pct = item.change_percent;
        const dir = pct >= 0 ? '漲' : '跌';
        parts.push(`${name}（${sym}）${dir} ${Math.abs(pct).toFixed(2)}%`);
      }
    }
  }

  // Add top news
  if (relevantNews.length > 0) {
    const newsPart = relevantNews.slice(0, 2).join('；');
    if (parts.length > 0) {
      parts.push(`新聞：${newsPart}`);
    } else {
      parts.push(newsPart);
    }
  }

  if (parts.length === 0) {
    parts.push('全球市場出現值得關注的變動');
  }

  return parts.join('。');
}

function getKeyMarketSymbols(type: CatalystType): string[] {
  switch (type) {
    case 'us_tech': return ['NVDA', 'TSM', 'SOX'];
    case 'ai_cloud': return ['NVDA', 'MSFT', 'GOOGL'];
    case 'us_financial': return ['JPM', 'DXY'];
    case 'oil_energy': return ['WTI', 'XOM'];
    case 'fx_dollar': return ['DXY'];
    case 'shipping': return [];
    case 'global_news': return [];
    case 'macro': return ['SPX', 'VIX'];
  }
}

// ════════════════════════════════════════════
// Main Builder — Max 3 Main Lines
// ════════════════════════════════════════════

export function buildOvernightImpactChains(params: BuildImpactChainsParams): {
  chains: OvernightImpactChain[];
  freshness: ImpactChainFreshness;
} {
  const { marketNews, todayReport, openingRadar, marketData } = params;

  if (!marketNews || marketNews.length === 0) {
    return {
      chains: [],
      freshness: {
        hasChains: false,
        chainsGenerated: 0,
        isDataSufficient: false,
        displayTitle: '隔夜影響鏈尚未完整產生',
        warning: '目前缺乏足夠的全球市場新聞資料。請以盤前劇本與盤中追蹤為主。',
      },
    };
  }

  const selectedNews = marketNews.filter((n) => n.isSelected !== false && n.finalScore > 0);

  if (selectedNews.length === 0) {
    return {
      chains: [],
      freshness: {
        hasChains: false,
        chainsGenerated: 0,
        isDataSufficient: false,
        displayTitle: '隔夜影響鏈尚未完整產生',
        warning: '目前精選新聞資料不足。',
      },
    };
  }

  const detectedCatalysts = detectCatalysts(selectedNews, openingRadar, todayReport);

  if (detectedCatalysts.length === 0) {
    const topNews = selectedNews.slice(0, 3);
    return {
      chains: [buildGenericChain(topNews, todayReport, openingRadar)],
      freshness: {
        hasChains: true,
        chainsGenerated: 1,
        isDataSufficient: true,
        displayTitle: '今日隔夜影響鏈',
        warning: '',
      },
    };
  }

  // CRITICAL: Max 3 main lines
  const topCatalysts = detectedCatalysts.slice(0, 3);

  const chains: OvernightImpactChain[] = topCatalysts.map((detected, idx) => {
    const { mapping, relevantNews, direction } = detected;
    const newsTitle = relevantNews[0] || '全球市場變動';
    const rank = idx + 1;

    // Determine main line title based on direction
    let mainLineTitle: string;
    if (direction === 'positive') mainLineTitle = mapping.mainLineTitlePositive;
    else if (direction === 'negative') mainLineTitle = mapping.mainLineTitleNegative;
    else mainLineTitle = mapping.mainLineTitleNeutral;

    // Build overnight cause with specific data
    const overnightCause = buildOvernightCause(direction, mapping, relevantNews, marketData);

    // Build Taiwan impact description
    let taiwanImpact: string;
    if (direction === 'positive') taiwanImpact = mapping.taiwanImpactPositive;
    else if (direction === 'negative') taiwanImpact = mapping.taiwanImpactNegative;
    else taiwanImpact = mapping.taiwanImpactNeutral;

    // Build catalyst summary — specific and situational
    const sectorList = mapping.affectedSectors.slice(0, 3).join('、');
    let catalystSummary = '';
    if (direction === 'positive') {
      catalystSummary = `隔夜${mapping.displayLabel.replace('隔夜', '')}表現偏強。${relevantNews.length > 0 ? `主要催化：${relevantNews[0]}。` : ''}可能帶動台股${sectorList}開盤情緒，但仍需台積電與台指期在開盤後確認方向是否一致。`;
    } else if (direction === 'negative') {
      catalystSummary = `隔夜${mapping.displayLabel.replace('隔夜', '')}表現偏弱。${relevantNews.length > 0 ? `主要壓力：${relevantNews[0]}。` : ''}台股${sectorList}可能承壓，需觀察開盤後賣壓是否集中於權值股，還是擴散至多數族群。`;
    } else {
      catalystSummary = `隔夜${mapping.displayLabel.replace('隔夜', '')}出現變動。${relevantNews.length > 0 ? `主要訊號：${relevantNews[0]}。` : ''}台股${sectorList}方向需等待開盤後確認，目前不適合在訊號分歧時重倉押方向。`;
    }

    // Build display label
    const dirLabel = formatDirectionLabel(direction, mapping);

    // Build stock list (max 5)
    const stocks: RepresentativeStock[] = mapping.representativeStocks.slice(0, 5).map((s) => ({
      ...s,
      impactDirection: direction,
    }));

    return {
      id: `oic-${mapping.type}-${idx}`,
      catalystType: mapping.type,
      catalystTitle: mapping.displayLabel,
      mainLineRank: rank,
      mainLineTitle,
      catalystSummary,
      overnightCause,
      sourceTime: null,
      globalDriver: newsTitle,
      taiwanImpactDirection: direction,
      taiwanImpact,
      affectedSectors: mapping.affectedSectors,
      representativeStocks: stocks,
      watchPoints: mapping.watchPoints,
      verificationPoints: mapping.verificationPoints,
      failureConditions: mapping.failureConditions,
      riskNotes: mapping.riskNotes,
      confidenceScore: Math.min(80, 50 + detected.matchCount * 5),
      displayLabel: dirLabel,
      freeStockLimit: 3,
    };
  });

  return {
    chains,
    freshness: {
      hasChains: true,
      chainsGenerated: chains.length,
      isDataSufficient: true,
      displayTitle: '今日隔夜影響鏈',
      warning: '',
    },
  };
}

// ════════════════════════════════════════════
// Fallback: generic chain from news
// ════════════════════════════════════════════

function buildGenericChain(
  topNews: NewsItem[],
  _report: Report | null,
  _openingRadar: OpeningRadar | null,
): OvernightImpactChain {
  const newsTitles = topNews.map((n) => n.title);
  const categories = [...new Set(topNews.map((n) => n.category || '').filter(Boolean))];

  return {
    id: 'oic-generic-0',
    catalystType: 'global_news',
    catalystTitle: '隔夜全球市場焦點',
    mainLineRank: 1,
    mainLineTitle: '全球市場出現值得關注的變動',
    catalystSummary: `昨晚全球市場出現值得關注的變動。主要焦點：${newsTitles.slice(0, 3).join('；')}。開盤後需觀察台股權值股與各族群反應，確認這些外部因素是否真的在台股發酵。`,
    overnightCause: `主要新聞：${newsTitles.slice(0, 2).join('；')}`,
    sourceTime: null,
    globalDriver: newsTitles[0] || '全球市場',
    taiwanImpactDirection: 'watch',
    taiwanImpact: '外部事件可能影響台股情緒，但實際影響需開盤後確認。',
    affectedSectors: categories.length > 0 ? categories.slice(0, 3) : ['權值股', '電子', '金融'],
    representativeStocks: [
      { symbol: '2330', name: '台積電', reason: '大盤權值龍頭，市場方向性指標', impactDirection: 'watch' },
      { symbol: '2454', name: '聯發科', reason: 'IC 設計權值，對市場情緒敏感', impactDirection: 'watch' },
      { symbol: '2881', name: '富邦金', reason: '金控指標，利率與總經環境觀察重點', impactDirection: 'watch' },
    ],
    watchPoints: [
      '開盤後權值股是否出現方向性表態',
      '各族群資金是集中還是分散',
      '外資期現貨動向是否一致',
    ],
    verificationPoints: [
      '開盤 30 分鐘：權值股是否有明確方向',
      '族群是否同步或各自表現',
      '量能是否足夠支撐方向',
    ],
    failureConditions: '若開盤後各族群各自表現、無一致性方向，此主線無法成立；市場可能維持個股表現而非趨勢行情。',
    riskNotes: [
      '全球新聞影響不必然立即反映在台股',
      '需區分短期情緒與中期趨勢',
    ],
    confidenceScore: 50,
    displayLabel: '開盤觀察',
    freeStockLimit: 2,
  };
}

// ════════════════════════════════════════════
// Sector rotation → Post-market verification
// ════════════════════════════════════════════

export function getSectorRotationVerificationTitle(
  marketPhase: string,
  hasTodayData: boolean,
  hasReferenceData: boolean,
): string {
  if (marketPhase === 'after_close_verified' && hasTodayData) {
    return '今日類股輪動驗證';
  }
  if (marketPhase === 'pre_market' || marketPhase === 'intraday') {
    return hasReferenceData ? '上一交易日類股輪動參考' : '類股輪動資料參考';
  }
  if (marketPhase === 'after_close_pending') {
    return '今日類股輪動同步中';
  }
  return '類股輪動資料';
}

export function getSectorRotationVerificationNote(
  marketPhase: string,
  hasTodayData: boolean,
  scoreDate: string | null,
  expectedDate: string,
): string {
  if (marketPhase === 'after_close_verified' && hasTodayData) {
    return '今日收盤後類股輪動已產生，可用來檢查早上隔夜影響鏈推估的族群是否真的在台股中發酵。';
  }
  if (marketPhase === 'pre_market' || marketPhase === 'intraday') {
    return `盤前與盤中階段，系統先根據隔夜美股與全球新聞產生影響鏈；真正的今日類股輪動需等台股收盤後才能驗證。${scoreDate ? `目前參考資料日期為 ${scoreDate}。` : ''}`;
  }
  if (marketPhase === 'after_close_pending') {
    return '今日已收盤，系統正在等待類股輪動分數更新完成，完成後可用來驗證隔夜影響鏈是否成立。';
  }
  return '';
}