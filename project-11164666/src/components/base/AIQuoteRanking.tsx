import { useState } from 'react';

interface QuoteRankingItem {
  id: string;
  quote: string;
  context: string;
  clickRate: number;
  shareRate: number;
  avgDwellTime: string;
  trend: 'up' | 'stable' | 'new';
}

const quoteRankings: QuoteRankingItem[] = [
  {
    id: 'q-001',
    quote: '今天不是拼速度，而是拼誰比較冷靜。',
    context: '市場過熱提醒',
    clickRate: 68.4,
    shareRate: 32.1,
    avgDwellTime: '4.2s',
    trend: 'up',
  },
  {
    id: 'q-002',
    quote: '市場最危險時，通常看起來最安全。',
    context: '風險警示',
    clickRate: 61.2,
    shareRate: 28.7,
    avgDwellTime: '3.8s',
    trend: 'up',
  },
  {
    id: 'q-003',
    quote: '保留現金不是懦弱，是智慧。',
    context: '偏空市場陪伴',
    clickRate: 58.9,
    shareRate: 24.3,
    avgDwellTime: '3.5s',
    trend: 'stable',
  },
  {
    id: 'q-004',
    quote: '不要因為市場熱，就忘記風險。',
    context: '偏多市場降溫',
    clickRate: 55.1,
    shareRate: 21.8,
    avgDwellTime: '3.2s',
    trend: 'stable',
  },
  {
    id: 'q-005',
    quote: '今天有機會，但別太急。',
    context: '中性市場觀察',
    clickRate: 52.7,
    shareRate: 19.4,
    avgDwellTime: '3.0s',
    trend: 'new',
  },
  {
    id: 'q-006',
    quote: '你看到的漲停，可能已經是別人的利潤。',
    context: '追高警示',
    clickRate: 49.3,
    shareRate: 26.5,
    avgDwellTime: '3.6s',
    trend: 'up',
  },
  {
    id: 'q-007',
    quote: '市場沒有方向的時候，耐心比勇氣更重要。',
    context: '震盪市場陪伴',
    clickRate: 47.8,
    shareRate: 18.2,
    avgDwellTime: '2.9s',
    trend: 'stable',
  },
  {
    id: 'q-008',
    quote: '不是每個漲停都值得追。',
    context: 'FOMO 提醒',
    clickRate: 45.2,
    shareRate: 22.1,
    avgDwellTime: '3.1s',
    trend: 'up',
  },
];

export default function AIQuoteRanking() {
  const [sortBy, setSortBy] = useState<'clickRate' | 'shareRate' | 'dwell'>('clickRate');

  const sorted = [...quoteRankings].sort((a, b) => {
    if (sortBy === 'clickRate') return b.clickRate - a.clickRate;
    if (sortBy === 'shareRate') return b.shareRate - a.shareRate;
    return parseFloat(b.avgDwellTime) - parseFloat(a.avgDwellTime);
  });

  const trendBadge = (trend: string) => {
    if (trend === 'up') return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-50 text-forest-600 text-[10px] font-medium rounded-full"><i className="ri-arrow-up-line"></i>上升</span>;
    if (trend === 'new') return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-navy-50 text-navy-600 text-[10px] font-medium rounded-full"><i className="ri-sparkling-line"></i>新上榜</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-100 text-surface-500 text-[10px] font-medium rounded-full"><i className="ri-subtract-line"></i>持平</span>;
  };

  return (
    <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-navy-900 font-semibold text-sm">最有感 AI 提醒排行榜</h3>
          <p className="text-surface-500 text-xs mt-0.5">根據使用者點擊、分享與停留時間排序</p>
        </div>
        <div className="flex items-center gap-1.5 bg-surface-50 rounded-lg p-1">
          {[
            { key: 'clickRate' as const, label: '點擊率' },
            { key: 'shareRate' as const, label: '分享率' },
            { key: 'dwell' as const, label: '停留時間' },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortBy(opt.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                sortBy === opt.key
                  ? 'bg-white text-navy-900 shadow-sm'
                  : 'text-surface-500 hover:text-navy-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-surface-100">
        {sorted.map((item, idx) => (
          <div key={item.id} className="px-5 py-4 hover:bg-surface-50 transition-colors">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center text-white text-xs font-bold">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <p className="text-navy-900 text-sm font-medium leading-relaxed">
                    「{item.quote}」
                  </p>
                  {trendBadge(item.trend)}
                </div>
                <p className="text-surface-400 text-xs mb-2">{item.context}</p>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <i className="ri-cursor-line text-surface-400"></i>
                    <span className="text-navy-700 font-medium">{item.clickRate}%</span>
                    <span className="text-surface-400">點擊率</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <i className="ri-share-forward-line text-surface-400"></i>
                    <span className="text-navy-700 font-medium">{item.shareRate}%</span>
                    <span className="text-surface-400">分享率</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <i className="ri-time-line text-surface-400"></i>
                    <span className="text-navy-700 font-medium">{item.avgDwellTime}</span>
                    <span className="text-surface-400">平均停留</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}