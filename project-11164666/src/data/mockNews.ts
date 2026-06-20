export interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  aiImportance: number;
  affectedMarket: string;
  impactSummary: string;
  originalUrl: string;
  affectedSector?: string;
}

export const newsItems: NewsItem[] = [
  {
    id: 'news-001',
    title: 'NVIDIA 財報超預期，AI 晶片需求持續強勁',
    source: 'Reuters',
    publishedAt: '2026-05-25 03:45',
    aiImportance: 95,
    affectedMarket: '科技股、半導體',
    affectedSector: 'AI / 半導體',
    impactSummary: 'NVIDIA 營收與獲利均超預期，AI 晶片需求未見放緩，對台積電、聯發科等台灣供應鏈為正向訊號。',
    originalUrl: 'https://www.reuters.com',
  },
  {
    id: 'news-002',
    title: '美國通膨數據降溫，Fed 降息預期升溫',
    source: 'Bloomberg',
    publishedAt: '2026-05-25 02:12',
    aiImportance: 92,
    affectedMarket: '全球股市、美元',
    affectedSector: '大盤情緒',
    impactSummary: 'CPI 數據低於預期，市場預期 Fed 今年可能降息兩次，有利全球股市風險偏好回升。',
    originalUrl: 'https://www.bloomberg.com',
  },
  {
    id: 'news-003',
    title: '台積電熊本廠正式啟用，擴大全球布局',
    source: 'Nikkei Asia',
    publishedAt: '2026-05-25 01:30',
    aiImportance: 88,
    affectedMarket: '半導體、日圓',
    affectedSector: 'AI / 半導體',
    impactSummary: '台積電日本熊本廠啟用，強化亞洲供應鏈韌性，對日圓與日本股市有正向影響。',
    originalUrl: 'https://asia.nikkei.com',
  },
  {
    id: 'news-004',
    title: '中國製造業 PMI 回升至擴張區間',
    source: 'Financial Times',
    publishedAt: '2026-05-24 23:50',
    aiImportance: 85,
    affectedMarket: '原物料、台灣出口',
    affectedSector: '傳產',
    impactSummary: '中國製造業 PMI 重回 50 以上，需求回暖可能帶動台灣電子零組件與機械出口。',
    originalUrl: 'https://www.ft.com',
  },
  {
    id: 'news-005',
    title: '油價因中東地緣風險上升而反彈',
    source: 'CNBC',
    publishedAt: '2026-05-24 22:15',
    aiImportance: 78,
    affectedMarket: '能源、航空',
    affectedSector: '航運',
    impactSummary: '中東地區緊張情勢加劇，油價短線反彈，航空與塑化族群成本壓力增加。',
    originalUrl: 'https://www.cnbc.com',
  },
  {
    id: 'news-006',
    title: '韓國半導體出口額連續三月成長',
    source: 'Korea Herald',
    publishedAt: '2026-05-24 21:40',
    aiImportance: 76,
    affectedMarket: '半導體、記憶體',
    affectedSector: 'AI / 半導體',
    impactSummary: '韓國半導體出口持續成長，反映全球記憶體與晶片需求穩健，對台灣供應鏈為正向訊號。',
    originalUrl: 'https://www.koreaherald.com',
  },
  {
    id: 'news-007',
    title: '日本央行暗示可能調整寬鬆政策',
    source: 'Nikkei Asia',
    publishedAt: '2026-05-24 20:15',
    aiImportance: 72,
    affectedMarket: '日圓、亞洲匯率',
    affectedSector: '金融',
    impactSummary: '日銀釋放政策調整訊號，日圓可能走強，亞洲匯率連動受關注。',
    originalUrl: 'https://asia.nikkei.com',
  },
];

export interface WatchItem {
  id: string;
  title: string;
  category: string;
  description: string;
}

export const todayWatchItems: WatchItem[] = [
  {
    id: 'watch-001',
    title: '台積電 ADR 是否延續強勢',
    category: '半導體',
    description: 'ADR 大漲 3.8%，觀察開盤後是否帶動台積電現股與相關供應鏈跟進。',
  },
  {
    id: 'watch-002',
    title: '外資是否回補電子權值股',
    category: '資金流向',
    description: '美元轉強可能影響外資意願，觀察外資在期現貨的布局方向。',
  },
  {
    id: 'watch-003',
    title: '台幣匯率變化',
    category: '匯率',
    description: '美元指數上升，台幣是否偏弱，影響外資匯入成本。',
  },
  {
    id: 'watch-004',
    title: '油價是否影響航空與塑化',
    category: '傳產',
    description: '原油上漲，觀察航空股與塑化股的成本傳導反應。',
  },
  {
    id: 'watch-005',
    title: '美債殖利率是否影響科技股估值',
    category: '利率',
    description: '十年期殖利率升至 4.28%，高估值科技股可能面臨評價調整觀察。',
  },
];