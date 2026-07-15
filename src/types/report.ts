export interface WatchSectorDetailed {
  sector: string;
  aiObservation: string;
  isOverheated: boolean;
  isSuitableToChase: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface TodayStrategy {
  do: string[];
  avoid: string[];
}

export interface RiskFactor {
  title: string;
  level: 'low' | 'medium' | 'high';
  description: string;
}

export interface WatchSector {
  sector: string;
  direction: string;
  reason: string;
}

export interface FocusStock {
  group: string;
  direction: string;
  reason: string;
  confidence?: number;
}

export interface TomorrowWatch {
  name: string;
  reason: string;
}

export interface GlobalEvent {
  source: string;
  event: string;
  taiwanImpact: string;
  beginnerTip: string;
  relatedSector?: string;
}

export interface AIStrategy {
  conservative?: string;
  aggressive?: string;
  overall_advice?: string;
  risk_warning?: string;
  // V7.29: Edge Function writes these into ai_strategy_json
  version?: string;
  source?: string;
  validation_status?: string;
  quality_score?: number;
  no_fake_fallback?: boolean;
  repaired_by_system?: boolean;
  overnight_impact_chains?: OvernightImpactChainJson[];
  member_reading?: string;
  impact_chain_source?: string;
  member_reading_source?: string;
}

/** Overnight impact chain as stored in ai_strategy_json.overnight_impact_chains */
export interface OvernightImpactChainJson {
  chain_title: string;
  direction: string;
  plain_language_summary?: string;
  why_it_matters: string;
  taiwan_sector_impact: string;
  affected_sectors: string[];
  representative_stocks: RepresentativeStockJson[];
  intraday_watch_points: IntradayWatchPointJson[];
  invalid_conditions: string[];
  source_events: SourceEventJson[];
}

export interface RepresentativeStockJson {
  name: string;
  symbol: string;
  role: string;
  reason: string;
}

export interface IntradayWatchPointJson {
  time: string;
  watch: string;
  bullish_confirm: string;
  bearish_confirm: string;
}

export interface SourceEventJson {
  title: string;
  source: string;
  why_it_matters: string;
}

export interface ImportantNews {
  title: string;
  summary: string;
  impact?: string;
  sectors?: string[];
}

export interface Report {
  id: string;
  report_date: string;
  summary: string | null;
  market_bias: string | null;
  confidence_score: number | null;
  confidence_label: string | null;
  can_watch: string[] | null;
  avoid_today: string[] | null;
  fear_greed: number | null;
  fear_greed_summary: string | null;
  vix: number | null;
  vix_summary: string | null;
  nasdaq_change: number | null;
  sp500_change: number | null;
  sox_change: number | null;
  taiex_futures_change: number | null;
  dxy: number | null;
  us_bond_yield: number | null;
  gold_price: number | null;
  oil_price: number | null;
  btc_price: number | null;
  risk_factors_json: RiskFactor[] | null;
  watch_sectors_json: WatchSector[] | null;
  focus_stock_json: FocusStock[] | null;
  tomorrow_watch_json: TomorrowWatch[] | null;
  global_events_json: GlobalEvent[] | null;
  ai_strategy_json: AIStrategy | null;
  important_news_json: ImportantNews[] | null;
  yesterday_summary: string | null;
  today_summary: string | null;
  created_at: string;
  // V2 新增欄位
  today_quote: string | null;
  today_strategy: TodayStrategy | null;
  watch_sectors_detailed: WatchSectorDetailed[] | null;
  ai_psychology: string | null;
  ai_retail_reminder: string | null;
  ai_confidence_reason: string | null;
  // V7 Market Intelligence Engine 新增欄位
  sentiment_score: number | null;
  sentiment_label: string | null;
  sentiment_reason: string | null;
  risk_reason: string | null;
  // V8 新增欄位
  key_drivers: string[] | null;
  raw_ai_json: Record<string, unknown> | null;
}
