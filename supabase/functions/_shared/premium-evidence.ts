export interface PremiumNewsEvidenceInput {
  id?: string;
  title?: string;
  source?: string;
  url?: string;
  published_at?: string | null;
  created_at?: string | null;
  related_sectors?: string[] | null;
  taiwan_impact_summary?: string | null;
}

export interface PremiumNewsEvidenceReview {
  eligible: boolean;
  reason_codes: string[];
  event_type: string;
  published_at: string | null;
}

export interface PremiumMarketEvidenceInput {
  symbol: string;
  name?: string;
  value?: number | null;
  changePercent?: number | null;
  updatedAt?: string | null;
  hasChangePercent?: boolean;
}

const DIRECT_MARKET_ANCHOR = /(?:\b(?:NVDA|NVIDIA|TSM|TSMC|SOX|NASDAQ|S&P\s?500|SPX|DOW|DJIA|VIX|DXY|US10Y|TAIEX|TXF|FOMC|FED|OPEC|WTI|BRENT|AVGO|BROADCOM|AMD|MICRON|MU|AAPL|APPLE|MSFT|MICROSOFT|META|AMZN|AMAZON|GOOGL|GOOGLE|ALPHABET|DRAM|HBM)\b|台積電|費城半導體|費半|那斯達克|標普|道瓊|美元指數|美債|債券市場|殖利率|聯準會|台指期|加權指數|半導體|chips?|memory|晶片|記憶體|先進製程|先進封裝|AI\s*(?:伺服器|基礎設施|infrastructure)|data center|cloud capex|treasury|bond market|關稅|出口管制|原油價格|\boil\b|油價|地緣政治)/i;
const TAIWAN_LINK_ANCHOR = /(?:台股|台灣|台積電|電子權值|半導體|AI\s*伺服器|供應鏈|金融|航運|塑化|外資|台指期|加權指數)/i;
const DIRECTIONAL_EVENT_ANCHOR = /(?:上修|下修|財測|財報|法說|營收|獲利|展望|資本支出|需求|訂單|產能|投資|融資|漲|跌|走強|走弱|升息|降息|利率|殖利率|匯率|美元|關稅|禁令|管制|制裁|供給|減產|增產|衝突|戰爭|guidance|earnings|revenue|profit|sales|forecast|outlook|capex|demand|orders?|capacity|record|milestone|beat|miss|upgrade|downgrade|raises?|cuts?|posts?|surge|rally|drop|fall|rise|gain|slip|decline|lower|higher|rate|yield|tariff|export (?:control|rule|restriction)|curb|sanction|supply|output|conflict|war|stake|access|debt|fund|expansion|bear case|boom-and-bust|changed)/i;
const NON_CATALYST_HEADLINE = /(?:history of|company timeline|facts\s*(?:&|and)\s*milestones|which .* better positioned|does .* leave any room|earn \d+(?:\.\d+)?%|what investors need to know|which .* stocks are moving|price target|stock forecast)/i;

function validHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseEvidenceTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyPremiumNewsEvent(textValue: unknown): string {
  const text = String(textValue ?? '').toLowerCase();
  if (/ai server|ai\s*伺服器|nvidia|nvda|blackwell|gb200|gb300|cloud capex|雲端資本支出/.test(text)) return 'ai_server';
  if (/semiconductor|chip|memory|micron|dram|hbm|半導體|晶片|記憶體|tsmc|台積電|sox|先進製程|先進封裝/.test(text)) return 'semiconductor';
  if (/fed|fomc|rate|yield|利率|殖利率|聯準會/.test(text)) return 'macro_rate';
  if (/dxy|dollar|usd|匯率|美元/.test(text)) return 'fx';
  if (/\b(?:oil|crude|wti|brent|opec)\b|原油|油價/.test(text)) return 'oil';
  if (/war|geopolitic|地緣|軍事|conflict|衝突|戰爭/.test(text)) return 'geopolitics';
  if (/tariff|關稅|trade war|export control|出口管制/.test(text)) return 'tariff';
  if (/policy|regulation|政策|法規|補助/.test(text)) return 'policy';
  if (/earnings|revenue|guidance|財報|法說|財測|營收/.test(text)) return 'earnings';
  return 'other';
}

export function reviewPremiumNewsEvidence(
  item: PremiumNewsEvidenceInput,
  nowMs = Date.now(),
  maxAgeHours = 48,
): PremiumNewsEvidenceReview {
  const reasonCodes: string[] = [];
  const title = String(item.title ?? '').replace(/\s+/g, ' ').trim();
  const source = String(item.source ?? '').trim();
  const impact = String(item.taiwan_impact_summary ?? '').replace(/\s+/g, ' ').trim();
  const publishedAt = item.published_at || item.created_at || null;
  const publishedMs = parseEvidenceTime(publishedAt);
  const combined = `${title} ${impact}`;

  if (title.length < 12) reasonCodes.push('headline_too_short');
  if (source.length < 2) reasonCodes.push('source_missing');
  if (!validHttpUrl(item.url)) reasonCodes.push('url_missing_or_invalid');
  if (publishedMs === null) {
    reasonCodes.push('published_at_missing_or_invalid');
  } else {
    const ageHours = (nowMs - publishedMs) / 3_600_000;
    if (ageHours < -1 || ageHours > maxAgeHours) reasonCodes.push('outside_freshness_window');
  }

  const hasDirectAnchor = DIRECT_MARKET_ANCHOR.test(title);
  const hasTaiwanTransmission = TAIWAN_LINK_ANCHOR.test(impact);
  if (!hasDirectAnchor) reasonCodes.push('taiwan_market_relevance_unproven');
  if (!hasTaiwanTransmission) reasonCodes.push('taiwan_transmission_missing');
  if (!DIRECTIONAL_EVENT_ANCHOR.test(combined)) reasonCodes.push('decision_catalyst_missing');
  if (NON_CATALYST_HEADLINE.test(title)) reasonCodes.push('non_catalyst_editorial_headline');

  return {
    eligible: reasonCodes.length === 0,
    reason_codes: Array.from(new Set(reasonCodes)),
    event_type: classifyPremiumNewsEvent(combined),
    published_at: publishedAt,
  };
}

export function filterPremiumNewsEvidence<T extends PremiumNewsEvidenceInput>(
  items: T[],
  nowMs = Date.now(),
): { verified: T[]; rejected: Array<{ item: T; reason_codes: string[] }> } {
  const verified: T[] = [];
  const rejected: Array<{ item: T; reason_codes: string[] }> = [];
  for (const item of items) {
    const review = reviewPremiumNewsEvidence(item, nowMs);
    if (review.eligible) verified.push(item);
    else rejected.push({ item, reason_codes: review.reason_codes });
  }
  return { verified, rejected };
}

export function normalizePremiumMarketEvidence(
  item: PremiumMarketEvidenceInput,
  nowMs = Date.now(),
): Record<string, unknown> | null {
  const changePercent = Number(item.changePercent);
  const updatedMs = parseEvidenceTime(item.updatedAt);
  const explicitlyMissing = item.hasChangePercent === false;
  if (explicitlyMissing || !Number.isFinite(changePercent) || updatedMs === null) return null;
  const ageHours = (nowMs - updatedMs) / 3_600_000;
  const freshness = ageHours <= 18 ? 'fresh' : ageHours <= 48 ? 'recent' : 'stale';
  const direction = changePercent > 0.25 ? 'up' : changePercent < -0.25 ? 'down' : 'flat';
  return {
    symbol: String(item.symbol || '').trim().toUpperCase(),
    name: String(item.name || item.symbol || '').trim(),
    value: Number.isFinite(Number(item.value)) ? Number(item.value) : null,
    change_percent: changePercent,
    direction,
    captured_at: item.updatedAt,
    updated_at: item.updatedAt,
    source: 'market_data',
    provider: 'supabase_market_data',
    freshness_status: freshness,
  };
}
