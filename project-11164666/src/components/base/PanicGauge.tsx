interface PanicGaugeProps {
  data: {
    level: 'smooth' | 'caution' | 'high';
    label: string;
    score: number;
    description: string;
  };
}

export default function PanicGauge({ data }: PanicGaugeProps) {
  const config = {
    smooth: {
      color: 'bg-forest-500',
      bg: 'bg-forest-500/10 border-forest-500/20',
      text: 'text-forest-400',
      icon: 'ri-emotion-happy-line',
      barColor: 'from-forest-500 to-forest-400',
      zone: '低風險區',
    },
    caution: {
      color: 'bg-yellow-500',
      bg: 'bg-yellow-500/10 border-yellow-500/20',
      text: 'text-yellow-400',
      icon: 'ri-alert-line',
      barColor: 'from-yellow-500 to-yellow-400',
      zone: '警戒區',
    },
    high: {
      color: 'bg-red-500',
      bg: 'bg-red-500/10 border-red-500/20',
      text: 'text-red-400',
      icon: 'ri-fire-line',
      barColor: 'from-red-500 to-red-400',
      zone: '高風險區',
    },
  };

  const c = config[data.level];

  // Clamp score between 0-100 for bar width
  const barWidth = Math.min(100, Math.max(0, data.score));

  return (
    <div className={`rounded-xl border p-5 md:p-6 ${c.bg}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
            <i className={`${c.icon} ${c.text} text-sm`}></i>
          </div>
          <h2 className="text-white font-semibold text-sm">市場恐慌指數</h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${c.color} text-white`}>
          {data.label}
        </span>
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-surface-400 text-xs">恐慌程度</span>
          <span className={`text-sm font-bold ${c.text}`}>{data.score}/100</span>
        </div>
        <div className="h-3 bg-navy-900/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${c.barColor} transition-all duration-700`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-forest-400 text-[10px]">平穩</span>
          <span className="text-yellow-400 text-[10px]">小心</span>
          <span className="text-red-400 text-[10px]">高風險</span>
        </div>
      </div>

      <div className="flex items-start gap-2 bg-navy-900/40 rounded-lg p-3">
        <i className={`${c.icon} ${c.text} text-sm mt-0.5 flex-shrink-0`}></i>
        <div>
          <p className="text-white text-sm font-medium mb-0.5">{c.zone}</p>
          <p className="text-surface-400 text-xs leading-relaxed">{data.description}</p>
        </div>
      </div>
    </div>
  );
}