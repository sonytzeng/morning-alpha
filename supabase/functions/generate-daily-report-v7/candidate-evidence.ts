export type CandidateEvidenceLike = {
  title?: unknown;
  summary?: unknown;
  evidence_type?: unknown;
  raw_reference?: unknown;
};

const TAG_ALIASES: Record<string, RegExp[]> = {
  AI_SERVER: [/\bAI\b/i, /AI[ _-]?SERVER/i, /AI伺服器/i, /資料中心/i, /雲端資本支出/i, /\bNVDA\b/i, /NVIDIA/i, /BROADCOM/i, /GB200|GB300|BLACKWELL/i],
  SEMICONDUCTOR: [/SEMICONDUCTOR/i, /半導體/i, /晶片/i, /先進製程/i, /\bSOX\b/i, /\bTSM(?:C)?\b/i, /\b2330(?:\.TW)?\b/i],
  ELECTRONIC_BLUE_CHIP: [/電子權值/i, /\bTAIEX\b/i, /\bTWII\b/i, /\bTXF\b/i, /\b2330(?:\.TW)?\b/i],
  RATE: [/\bRATE(?:S)?\b/i, /RATE HIKE/i, /\bYIELD(?:S)?\b/i, /\bUS10Y\b/i, /殖利率/i, /利率/i, /\bFED\b/i, /INFLATION/i, /通膨/i],
  FX: [/\bDXY\b/i, /\bUSD\b/i, /匯率/i, /美元/i, /台幣/i],
  FINANCIAL: [/FINANCIAL/i, /金融/i, /金控/i, /銀行/i, /壽險/i],
  DEFENSIVE: [/DEFENSIVE/i, /防禦/i, /避險/i, /低波動/i, /高現金流/i],
  TELECOM: [/TELECOM/i, /電信/i],
  CONSTRUCTION_ASSET: [/CONSTRUCTION/i, /REAL ESTATE/i, /營建/i, /房市/i, /建材/i, /資產股/i],
  SHIPPING: [/SHIPPING/i, /FREIGHT/i, /航運/i, /貨櫃/i, /散裝/i, /運價/i, /紅海/i],
  PETROCHEMICAL: [/PETROCHEMICAL/i, /石化/i, /塑化/i],
  OIL: [/\bOIL\b/i, /\bWTI\b/i, /\bCRUDE\b/i, /原油/i, /油價/i],
  AUTO_EV: [/AUTO(?:MOTIVE)?/i, /\bEV\b/i, /汽車/i, /電動車/i, /車用/i],
  GREEN_POWER_GRID: [/GREEN ENERGY/i, /POWER GRID/i, /重電/i, /綠能/i, /電網/i, /儲能/i],
  PCB_CCL: [/\bPCB\b/i, /\bCCL\b/i, /\bABF\b/i, /載板/i, /銅箔基板/i],
  COOLING: [/COOLING/i, /散熱/i, /水冷/i, /均熱片/i],
  HIGH_SPEED_OPTICAL: [/OPTICAL/i, /\bCPO\b/i, /光通訊/i, /高速傳輸/i, /矽光子/i],
  MEMORY: [/MEMORY/i, /\bDRAM\b/i, /\bNAND\b/i, /\bHBM\b/i, /記憶體/i],
  IC_DESIGN: [/IC[ _-]?DESIGN/i, /\bASIC\b/i, /IC設計/i, /矽智財/i],
  SEMI_EQUIPMENT_MATERIALS: [/SEMI[ _-]?EQUIPMENT/i, /先進封裝/i, /半導體設備/i, /半導體材料/i],
  RETAIL_CONSUMER: [/RETAIL/i, /CONSUMER/i, /百貨/i, /零售/i, /消費/i, /內需/i, /通路/i],
  FOOD: [/\bFOOD\b/i, /食品/i, /飼料/i, /民生/i],
  STEEL: [/\bSTEEL\b/i, /鋼鐵/i, /鋼價/i],
  CEMENT: [/CEMENT/i, /水泥/i],
  BIOTECH_HEALTHCARE: [/BIOTECH/i, /HEALTHCARE/i, /生技/i, /醫療/i, /製藥/i, /新藥/i],
  DEFENSE_DRONE: [/DEFEN[CS]E/i, /\bDRONE\b/i, /軍工/i, /無人機/i, /航太/i],
  CYBERSECURITY_SOFTWARE: [/CYBER/i, /SOFTWARE/i, /資安/i, /軟體/i, /系統整合/i],
  GAMING_CONTENT: [/GAMING/i, /遊戲/i, /文化內容/i],
  POLICY: [/\bPOLICY\b/i, /政策/i, /補助/i, /法規/i],
  TARIFF: [/TARIFF/i, /關稅/i, /貿易戰/i],
  GEOPOLITICS: [/GEOPOLITIC/i, /地緣/i, /戰爭/i, /衝突/i],
  EARNINGS: [/EARNINGS/i, /財報/i, /法說/i, /指引/i, /營收/i],
};

const RISK_MARKET_SYMBOLS = new Set(['TAIEX', 'TWII', 'TXF', 'SPX', 'IXIC', 'SOX', 'NVDA', 'TSM', 'VIX', 'DXY', 'US10Y']);

function normalizeTag(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export function evidenceSemanticTags(item: CandidateEvidenceLike): Set<string> {
  const title = String(item.title ?? '').trim();
  const text = [title, item.summary, item.raw_reference].map((value) => String(value ?? '')).join(' ');
  const tags = new Set<string>();
  for (const [tag, patterns] of Object.entries(TAG_ALIASES)) {
    if (patterns.some((pattern) => pattern.test(text))) tags.add(tag);
  }
  const titleSymbol = title.toUpperCase().replace(/\.TW$/, '');
  if (/^[A-Z0-9^]{2,10}$/.test(titleSymbol)) tags.add(titleSymbol);
  if (RISK_MARKET_SYMBOLS.has(titleSymbol)) tags.add('MARKET_RISK');
  if (String(item.evidence_type ?? '').toLowerCase() === 'previous_validation') tags.add('PREVIOUS_VALIDATION');
  return tags;
}

export function candidateEvidenceMatches(candidateTags: string[], item: CandidateEvidenceLike): boolean {
  const candidate = new Set(candidateTags.map(normalizeTag).filter(Boolean));
  const evidence = evidenceSemanticTags(item);
  for (const tag of candidate) {
    if (evidence.has(tag)) return true;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactToken = new RegExp(`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`, 'i');
    const text = [item.title, item.summary].map((value) => String(value ?? '')).join(' ');
    if (exactToken.test(text)) return true;
  }
  return candidate.has('DEFENSIVE') && (evidence.has('MARKET_RISK') || evidence.has('RATE') || evidence.has('FX'));
}
