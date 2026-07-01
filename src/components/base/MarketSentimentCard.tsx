interface MarketSentimentCardProps {
  data: {
    score: number;
    label: string;
    confidence: number;
    sectors: string[];
    updatedAt: string;
  };
  compact?: boolean;
}

export default function MarketSentimentCard({ data, compact = false }: MarketSentimentCardProps) {
  const getSentimentColor = (label: string) => {
    if (label.includes('偏多') || label.includes('強勢')) return 'text-forest-400 bg-forest-500/10 border-forest-500/20';
    if (label.includes('偏空') || label.includes('偏弱')) return 'text-red-400 bg-red-500/10 border-red-500/20';
    return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
  };

  const getScoreColor = (score: number) => {
    if (score >= 60) return 'text-forest-400';
    if (score <= 40) return 'text-red-400';
    return 'text-yellow-400';
  };

  if (compact) {
    return (
      <div className="bg-navy-800/50 border border-navy-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-surface-400 text-sm font-medium">今日市場情緒</span>
          <span className="text-surface-500 text-xs">{data.updatedAt}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-full text-sm font-semibold border ${getSentimentColor(data.label)}`}>
            {data.label}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-surface-400 text-xs">劇本成立度</span>
              <span className={`text-sm font-bold ${getScoreColor(data.confidence)}`}>{data.confidence}/100</span>
            </div>
            <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${data.confidence >= 60 ? 'bg-forest-500' : data.confidence <= 40 ? 'bg-red-500' : 'bg-yellow-500'}`}
                style={{ width: `${data.confidence}%` }}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.sectors.map((sector) => (
            <span key={sector} className="px-2 py-0.5 bg-navy-700 text-surface-300 text-xs rounded-md">
              {sector}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-navy-800/50 border border-navy-700 rounded-xl p-5 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-base">今日市場情緒</h3>
        <span className="text-surface-500 text-sm">{data.updatedAt}</span>
      </div>
      <div className="flex items-center gap-4 mb-5">
        <div className={`px-4 py-2 rounded-full text-lg font-bold border ${getSentimentColor(data.label)}`}>
          {data.label}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-surface-400 text-sm">劇本成立度</span>
            <span className={`text-base font-bold ${getScoreColor(data.confidence)}`}>{data.confidence} / 100</span>
          </div>
          <div className="h-2 bg-navy-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${data.confidence >= 60 ? 'bg-forest-500' : data.confidence <= 40 ? 'bg-red-500' : 'bg-yellow-500'}`}
              style={{ width: `${data.confidence}%` }}
            />
          </div>
        </div>
      </div>
      <div>
        <span className="text-surface-400 text-sm block mb-2">主要影響族群</span>
        <div className="flex flex-wrap gap-2">
          {data.sectors.map((sector) => (
            <span key={sector} className="px-3 py-1.5 bg-navy-700 text-surface-200 text-sm rounded-md border border-navy-600">
              {sector}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}