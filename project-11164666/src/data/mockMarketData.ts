export interface MarketIndex {
  name: string;
  symbol: string;
  value: string;
  change: string;
  changePercent: string;
  status: 'up' | 'down' | 'flat';
  impactOnTaiwan: string;
}

export const globalMarketIndices: MarketIndex[] = [
  {
    name: 'Nasdaq',
    symbol: 'IXIC',
    value: '17,832.15',
    change: '+245.67',
    changePercent: '+1.40%',
    status: 'up',
    impactOnTaiwan: '科技股帶動電子族群盤前氣氛偏多',
  },
  {
    name: 'S&P 500',
    symbol: 'SPX',
    value: '5,487.32',
    change: '+38.91',
    changePercent: '+0.71%',
    status: 'up',
    impactOnTaiwan: '美股大盤穩健，有利台股開盤信心',
  },
  {
    name: 'Dow Jones',
    symbol: 'DJI',
    value: '39,875.44',
    change: '-12.34',
    changePercent: '-0.03%',
    status: 'down',
    impactOnTaiwan: '傳產族群受壓，影響有限',
  },
  {
    name: '費城半導體指數',
    symbol: 'SOX',
    value: '5,124.78',
    change: '+178.45',
    changePercent: '+3.61%',
    status: 'up',
    impactOnTaiwan: '半導體強勢，台積電、聯發科可望受關注',
  },
  {
    name: '台積電 ADR',
    symbol: 'TSM',
    value: '168.92',
    change: '+6.23',
    changePercent: '+3.83%',
    status: 'up',
    impactOnTaiwan: 'ADR 強勢，台積電現股盤前預期受關注',
  },
  {
    name: '美元指數',
    symbol: 'DXY',
    value: '104.32',
    change: '+0.45',
    changePercent: '+0.43%',
    status: 'up',
    impactOnTaiwan: '美元轉強，可能影響外資布局意願',
  },
  {
    name: '美國十年期公債殖利率',
    symbol: 'US10Y',
    value: '4.28%',
    change: '+0.08',
    changePercent: '+1.90%',
    status: 'up',
    impactOnTaiwan: '殖利率上升，科技股估值面臨觀察',
  },
  {
    name: '原油 (WTI)',
    symbol: 'CL',
    value: '78.45',
    change: '+1.23',
    changePercent: '+1.59%',
    status: 'up',
    impactOnTaiwan: '油價上漲，航空與塑化成本增加',
  },
  {
    name: '黃金',
    symbol: 'GC',
    value: '2,345.60',
    change: '-8.40',
    changePercent: '-0.36%',
    status: 'down',
    impactOnTaiwan: '黃金回檔，避險情緒稍降',
  },
];

export interface MarketSentiment {
  score: number;
  label: string;
  confidence: number;
  sectors: string[];
  updatedAt: string;
}

export const todayMarketSentiment: MarketSentiment = {
  score: 68,
  label: '偏多',
  confidence: 78,
  sectors: ['AI', '半導體', '金融', '航運'],
  updatedAt: '今日 07:30',
};

export interface SectorData {
  name: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentLabel: string;
  change: string;
  description: string;
}

export const sectorSentiments: SectorData[] = [
  {
    name: '大盤情緒',
    sentiment: 'bullish',
    sentimentLabel: '偏多',
    change: '+0.8%',
    description: '美股科技股反彈帶動，台股盤前情緒偏多',
  },
  {
    name: 'AI / 半導體',
    sentiment: 'bullish',
    sentimentLabel: '強勢',
    change: '+3.2%',
    description: '費半大漲、台積電 ADR 強勢，AI 族群動能延續受關注',
  },
  {
    name: '金融',
    sentiment: 'neutral',
    sentimentLabel: '震盪',
    change: '-0.1%',
    description: '美債殖利率上升，金融股評價中性觀察',
  },
  {
    name: '航運',
    sentiment: 'bearish',
    sentimentLabel: '偏弱',
    change: '-1.2%',
    description: '油價上漲增加成本，航運族群短期承壓',
  },
  {
    name: '傳產',
    sentiment: 'neutral',
    sentimentLabel: '觀察',
    change: '+0.2%',
    description: '原物料價格波動，傳產族群維持觀望',
  },
  {
    name: 'ETF 投資人',
    sentiment: 'bullish',
    sentimentLabel: '積極',
    change: '+1.5%',
    description: '0050、0056 成分股整體偏多',
  },
];

export interface CommodityRate {
  name: string;
  symbol: string;
  value: string;
  change: string;
  status: 'up' | 'down' | 'flat';
}

export const commodityRates: CommodityRate[] = [
  { name: '美元/台幣', symbol: 'USDTWD', value: '32.45', change: '+0.12', status: 'up' },
  { name: '日圓/美元', symbol: 'JPYUSD', value: '157.32', change: '-0.45', status: 'down' },
  { name: '歐元/美元', symbol: 'EURUSD', value: '1.0724', change: '-0.0032', status: 'down' },
  { name: '原油 (Brent)', symbol: 'BZ', value: '82.15', change: '+1.05', status: 'up' },
  { name: '天然氣', symbol: 'NG', value: '2.85', change: '-0.08', status: 'down' },
  { name: '銅', symbol: 'HG', value: '4.52', change: '+0.12', status: 'up' },
  { name: '比特幣', symbol: 'BTC', value: '67,450', change: '+2,340', status: 'up' },
];

export const dailySentimentHistory = [
  { date: '05/19', score: 45, label: '震盪' },
  { date: '05/20', score: 52, label: '偏多' },
  { date: '05/21', score: 38, label: '偏空' },
  { date: '05/22', score: 61, label: '偏多' },
  { date: '05/23', score: 55, label: '偏多' },
  { date: '05/24', score: 42, label: '震盪' },
  { date: '05/25', score: 68, label: '偏多' },
];