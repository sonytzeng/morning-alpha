export interface SavedQuote {
  id: string;
  text: string;
  date: string;
  sentiment: string;
  sentimentColor: string;
}

export const savedQuotes: SavedQuote[] = [
  {
    id: 'q1',
    text: '今天最危險的不是下跌，是你看到別人賺錢後開始失控。',
    date: '2026-05-26',
    sentiment: '偏多',
    sentimentColor: 'forest',
  },
  {
    id: 'q2',
    text: '市場情緒會傳染，但節奏必須自己守住。',
    date: '2026-05-22',
    sentiment: '觀望',
    sentimentColor: 'amber',
  },
  {
    id: 'q3',
    text: '不要因為一次上漲，就忘記風險還在。',
    date: '2026-05-20',
    sentiment: '偏多',
    sentimentColor: 'forest',
  },
  {
    id: 'q4',
    text: '今天不是賺最多的人贏，是活到下週的人贏。',
    date: '2026-05-18',
    sentiment: '偏空',
    sentimentColor: 'red',
  },
  {
    id: 'q5',
    text: '保留現金不是懦弱，是智慧。',
    date: '2026-05-15',
    sentiment: '偏空',
    sentimentColor: 'red',
  },
  {
    id: 'q6',
    text: '市場沒有方向的時候，耐心比勇氣更重要。',
    date: '2026-05-12',
    sentiment: '觀望',
    sentimentColor: 'amber',
  },
];