interface SentimentGaugeProps {
  score: number;
  marketStatus?: string;
}

export default function SentimentGauge({ score, marketStatus }: SentimentGaugeProps) {
  const getConfig = (s: number) => {
    if (s <= 30) return { label: '高風險', color: 'text-red-400', bg: 'bg-red-500', zone: 'red' };
    if (s <= 50) return { label: '偏保守', color: 'text-amber-400', bg: 'bg-amber-500', zone: 'amber' };
    if (s <= 70) return { label: '震盪', color: 'text-yellow-400', bg: 'bg-yellow-500', zone: 'yellow' };
    if (s <= 85) return { label: '偏多', color: 'text-forest-400', bg: 'bg-forest-500', zone: 'green' };
    return { label: '強勢', color: 'text-forest-300', bg: 'bg-forest-600', zone: 'strong' };
  };

  const config = getConfig(score);

  const getExplanation = (s: number, status?: string) => {
    if (s <= 30) return '市場不確定性高，波動可能很大，新手建議先觀望，不要急著進場。';
    if (s <= 50) return '市場方向不太明確，氣氛偏保守，建議小額觀察或等待更清楚的訊號。';
    if (s <= 70) return '市場多空交戰，可能有短線震盪，不適合重壓單一股票，分散風險較好。';
    if (s <= 85) return '市場氣氛偏多，但還是可能有短線拉回，新手建議分批布局、不要追高。';
    return '市場情緒強勢，趨勢相對明確，但仍要設定停損、控制風險。';
  };

  const markerPosition = Math.min(100, Math.max(0, score));

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-dashboard-3-line text-white text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">今日情緒燈號</h2>
        <span className="ml-auto text-surface-400 text-xs">劇本成立度 {score}/100</span>
      </div>

      <div className="flex items-center gap-4 md:gap-6 mb-5">
        <div className={`w-16 h-16 md:w-20 md:h-20 ${config.bg} rounded-2xl flex flex-col items-center justify-center flex-shrink-0`}>
          <span className="text-white font-bold text-xl md:text-2xl">{score}</span>
          <span className="text-white/80 text-[10px] font-medium">/100</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-3 h-3 rounded-full ${config.bg}`}></div>
            <span className={`font-bold text-base md:text-lg ${config.color}`}>{config.label}</span>
          </div>
          <p className="text-surface-600 text-sm leading-relaxed">
            {getExplanation(score, marketStatus)}
          </p>
        </div>
      </div>

      {/* Segmented bar */}
      <div className="relative mb-2">
        <div className="flex h-3 rounded-full overflow-hidden">
          <div className="bg-red-500 h-full" style={{ width: '30%' }}></div>
          <div className="bg-amber-500 h-full" style={{ width: '20%' }}></div>
          <div className="bg-yellow-500 h-full" style={{ width: '20%' }}></div>
          <div className="bg-forest-500 h-full" style={{ width: '15%' }}></div>
          <div className="bg-forest-600 h-full" style={{ width: '15%' }}></div>
        </div>
        {/* Marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-navy-800 rounded-full"
          style={{ left: `calc(${markerPosition}% - 8px)` }}
        ></div>
      </div>

      {/* Zone labels */}
      <div className="flex justify-between text-[10px] text-surface-400 px-0.5">
        <span>高風險</span>
        <span>保守</span>
        <span>震盪</span>
        <span>偏多</span>
        <span>強勢</span>
      </div>
    </div>
  );
}