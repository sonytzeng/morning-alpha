import { supabase } from '@/lib/supabase';

export interface MarketSnapshot {
  id: string;
  fear_greed_index: number | null;
  vix: number | null;
  nasdaq_change: number | null;
  sp500_change: number | null;
  dowjones_change: number | null;
  sox_change: number | null;
  taiwan_futures_change: number | null;
  gold_price: number | null;
  oil_price: number | null;
  btc_price: number | null;
  dxy_index: number | null;
  us10y_yield: number | null;
  market_status: string | null;
  risk_level: string | null;
  beginner_summary: string | null;
  action_suggestion: string | null;
  created_at: string;
}

export interface MarketIndicator {
  name: string;
  symbol: string;
  value: string;
  change: number | null;
  changeFormatted: string;
  status: 'up' | 'down' | 'flat';
  plainText: string;
}

export interface SentimentOverview {
  marketStatus: string;
  riskLevel: string;
  fearGreed: number | null;
  vix: number | null;
  fearGreedLabel: string;
  vixLabel: string;
  plainSummary: string;
}

export async function fetchLatestMarketSnapshot(): Promise<MarketSnapshot | null> {
  const { data, error } = await supabase
    .from('market_snapshot')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`讀取市場快照失敗: ${error.message}`);
  return data as MarketSnapshot | null;
}

export function buildSentimentOverview(snapshot: MarketSnapshot | null): SentimentOverview | null {
  if (!snapshot) return null;

  const fearGreed = snapshot.fear_greed_index;
  const vix = snapshot.vix;

  let fearGreedLabel = '資料不足';
  if (fearGreed !== null) {
    if (fearGreed >= 75) fearGreedLabel = '貪婪——市場過熱，追漲要小心';
    else if (fearGreed >= 55) fearGreedLabel = '樂觀——偏多氣氛，但別追高';
    else if (fearGreed >= 45) fearGreedLabel = '中性——市場在觀望';
    else if (fearGreed >= 25) fearGreedLabel = '恐懼——可能有便宜可撿';
    else fearGreedLabel = '極度恐懼——可能是進場時機';
  }

  let vixLabel = '資料不足';
  if (vix !== null) {
    if (vix >= 30) vixLabel = '恐慌——市場很不穩定';
    else if (vix >= 22) vixLabel = '警戒——波動正在放大';
    else if (vix >= 15) vixLabel = '正常——波動不大';
    else vixLabel = '平靜——市場很安穩';
  }

  const plainSummary = `貪婪指數 ${fearGreed !== null ? fearGreed : '--'}（${fearGreedLabel.split('——')[0]}），波動率指數 ${vix !== null ? vix.toFixed(2) : '--'}（${vixLabel.split('——')[0]}）`;

  return {
    marketStatus: snapshot.market_status || '觀察中',
    riskLevel: snapshot.risk_level || '資料不足',
    fearGreed,
    vix,
    fearGreedLabel,
    vixLabel,
    plainSummary,
  };
}

export function buildMarketIndicators(snapshot: MarketSnapshot | null): MarketIndicator[] {
  if (!snapshot) return [];

  const items: MarketIndicator[] = [];

  function add(
    name: string,
    symbol: string,
    change: number | null,
    format: (v: number) => string,
    plainText: string
  ) {
    if (change === null) return;
    const status: 'up' | 'down' | 'flat' = change > 0.01 ? 'up' : change < -0.01 ? 'down' : 'flat';
    items.push({
      name,
      symbol,
      value: format(change),
      change,
      changeFormatted: change > 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`,
      status,
      plainText,
    });
  }

  add('Nasdaq', 'NDX', snapshot.nasdaq_change, (v) => `${v.toFixed(2)}%`, '美股科技股走向');
  add('S&P 500', 'SPX', snapshot.sp500_change, (v) => `${v.toFixed(2)}%`, '美股大盤整體表現');
  add('Dow Jones', 'DJI', snapshot.dowjones_change, (v) => `${v.toFixed(2)}%`, '美國傳產龍頭走勢');
  add('SOX 半導體', 'SOX', snapshot.sox_change, (v) => `${v.toFixed(2)}%`, '半導體族群動向');
  add('台指期夜盤', 'TX', snapshot.taiwan_futures_change, (v) => `${v.toFixed(2)}%`, '台股隔日開盤參考');
  add('黃金', 'GOLD', snapshot.gold_price, (v) => `$${v.toFixed(0)}`, '避險資產價格');
  add('原油', 'WTI', snapshot.oil_price, (v) => `$${v.toFixed(2)}`, '能源成本與通膨信號');
  add('比特幣', 'BTC', snapshot.btc_price, (v) => `$${v.toLocaleString()}`, '風險資產情緒指標');
  add('美元指數', 'DXY', snapshot.dxy_index, (v) => `${v.toFixed(2)}`, '美元強弱影響出口股');
  add('美國十年債殖利率', 'US10Y', snapshot.us10y_yield, (v) => `${v.toFixed(2)}%`, '資金成本與科技股估值');

  return items;
}