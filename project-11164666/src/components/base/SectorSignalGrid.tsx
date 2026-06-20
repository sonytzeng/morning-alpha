interface SectorSignal {
  sector: string;
  signal: 'bullish' | 'neutral' | 'bearish';
  signalLabel: string;
  plainAdvice: string;
}

interface SectorSignalGridProps {
  signals: SectorSignal[];
}

export default function SectorSignalGrid({ signals }: SectorSignalGridProps) {
  const signalConfig = {
    bullish: {
      icon: 'ri-arrow-up-line',
      color: 'text-forest-400 bg-forest-500/10 border-forest-500/20',
      bar: 'bg-forest-500',
    },
    neutral: {
      icon: 'ri-arrow-left-right-line',
      color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
      bar: 'bg-yellow-500',
    },
    bearish: {
      icon: 'ri-arrow-down-line',
      color: 'text-red-400 bg-red-500/10 border-red-500/20',
      bar: 'bg-red-500',
    },
  };

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-radar-line text-white text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">今日族群方向</h2>
        <span className="ml-auto text-surface-400 text-xs">依族群分類</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {signals.map((s) => {
          const cfg = signalConfig[s.signal];
          return (
            <div
              key={s.sector}
              className="flex items-center gap-3 bg-surface-50 border border-surface-200 rounded-lg p-3 hover:border-surface-300 transition-colors"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 border ${cfg.color}`}>
                <i className={`${cfg.icon} text-sm`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-navy-900 font-semibold text-sm">{s.sector}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.color}`}>
                    {s.signalLabel}
                  </span>
                </div>
                <p className="text-surface-500 text-xs leading-relaxed truncate">{s.plainAdvice}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}