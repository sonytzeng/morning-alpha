export interface ReportSummary {
  oneSentence: string;
  date: string;
  marketStatus: string;
  confidenceScore: number;
}

export const todayReport: ReportSummary = {
  oneSentence:
    '美股科技股反彈、費半走強，AI 與半導體族群盤前情緒偏多，但美元轉強可能影響外資布局意願。',
  date: '2026-05-25',
  marketStatus: '偏多',
  confidenceScore: 78,
};

export interface AIAnalysisSection {
  sector: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentLabel: string;
  analysis: string;
  keyDrivers: string[];
}

export const aiAnalysisSections: AIAnalysisSection[] = [
  {
    sector: '大盤情緒',
    sentiment: 'bullish',
    sentimentLabel: '偏多',
    analysis:
      '美股三大指數收高，科技股帶動 Nasdaq 漲逾 1%，S&P 500 穩健上漲。費半大漲 3.6%，顯示半導體產業動能強勁。台股開盤前市場情緒偏向正面。',
    keyDrivers: ['美股科技股反彈', '費半指數大漲', 'NVIDIA 財報超預期'],
  },
  {
    sector: 'AI / 半導體',
    sentiment: 'bullish',
    sentimentLabel: '強勢',
    analysis:
      'NVIDIA 財報全面超預期，AI 晶片需求未見放緩。台積電 ADR 大漲 3.8%，反映市場對先進製程需求樂觀。聯發科、日月光等供應鏈可望同步受關注。',
    keyDrivers: ['NVIDIA 財報亮眼', '台積電 ADR 大漲', 'AI 需求持續'],
  },
  {
    sector: '金融',
    sentiment: 'neutral',
    sentimentLabel: '震盪',
    analysis:
      '美國十年期公債殖利率升至 4.28%，對金融股評價帶來觀察。但降息預期升溫，長期對銀行淨利息收入有利。金融股盤前中性觀察。',
    keyDrivers: ['美債殖利率上升', 'Fed 降息預期', '台灣金控評價合理'],
  },
  {
    sector: '航運',
    sentiment: 'bearish',
    sentimentLabel: '偏弱',
    analysis:
      '油價因中東地緣風險反彈，WTI 漲至 78.45 美元。航運成本增加，航空股與貨櫃航運短期承壓。觀察油價走勢與運價變化。',
    keyDrivers: ['油價上漲', '中東地緣風險', '運價波動'],
  },
  {
    sector: '傳產',
    sentiment: 'neutral',
    sentimentLabel: '觀察',
    analysis:
      '中國製造業 PMI 回升至擴張區間，對台灣機械與電子零組件出口為正向訊號。但原物料價格波動，傳產族群維持觀望態度。',
    keyDrivers: ['中國 PMI 回升', '原物料價格波動', '台灣出口數據'],
  },
  {
    sector: 'ETF 投資人觀察',
    sentiment: 'bullish',
    sentimentLabel: '積極',
    analysis:
      '0050、0056 等台灣大盤 ETF 成分股整體偏多，半導體權值股帶動指數。外資若回補，ETF 可能有資金流入。',
    keyDrivers: ['成分股整體偏多', '外資動向', 'ETF 資金流向'],
  },
];

export interface HistoricalReport {
  id: string;
  date: string;
  title: string;
  sentiment: string;
  confidenceScore: number;
  highlights: string[];
}

export const historicalReports: HistoricalReport[] = [
  {
    id: 'rep-001',
    date: '2026-05-24',
    title: '美股拉回整理，台股盤前情緒觀望',
    sentiment: '震盪',
    confidenceScore: 62,
    highlights: ['Nasdaq 小幅拉回', '台積電 ADR 持平', '美元震盪'],
  },
  {
    id: 'rep-002',
    date: '2026-05-23',
    title: 'Fed 會議紀要偏鷹，科技股承壓',
    sentiment: '偏空',
    confidenceScore: 55,
    highlights: ['Fed 暗示延緩降息', '科技股估值觀察', '美債殖利率上升'],
  },
  {
    id: 'rep-003',
    date: '2026-05-22',
    title: '費半創新高，半導體族群強勢',
    sentiment: '偏多',
    confidenceScore: 82,
    highlights: ['費半創歷史新高', '台積電 ADR 大漲', 'AI 需求強勁'],
  },
  {
    id: 'rep-004',
    date: '2026-05-21',
    title: '地緣風險升溫，避險情緒增加',
    sentiment: '偏空',
    confidenceScore: 48,
    highlights: ['中東緊張情勢', '黃金上漲', '原油波動加劇'],
  },
  {
    id: 'rep-005',
    date: '2026-05-20',
    title: '科技巨頭法說會帶動，盤前情緒正面',
    sentiment: '偏多',
    confidenceScore: 71,
    highlights: ['微軟、Google 財報亮眼', '雲端需求強勁', 'AI 投資持續'],
  },
  {
    id: 'rep-006',
    date: '2026-05-19',
    title: '通膨數據干擾，市場等待方向',
    sentiment: '震盪',
    confidenceScore: 58,
    highlights: ['通膨數據混合', '市場觀望 Fed 動向', '美元震盪'],
  },
  {
    id: 'rep-007',
    date: '2026-05-18',
    title: '零售銷售數據強勁，經濟軟著陸預期',
    sentiment: '偏多',
    confidenceScore: 74,
    highlights: ['零售銷售超預期', '消費力道穩健', '景氣循環股受關注'],
  },
];