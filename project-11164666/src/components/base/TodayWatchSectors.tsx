import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

function getHeatLabel(overheated: boolean, suitable: boolean, risk: string) {
  if (overheated) return { text: '過熱', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
  if (risk === 'high') return { text: '偏高溫', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
  if (suitable) return { text: '可關注', color: 'text-forest-400', bg: 'bg-forest-500/10', border: 'border-forest-500/20' };
  return { text: '觀察中', color: 'text-surface-400', bg: 'bg-surface-500/10', border: 'border-surface-500/20' };
}

function getRiskLabel(level: string) {
  switch (level) {
    case 'high': return { text: '高風險', color: 'text-red-400', dot: 'bg-red-400' };
    case 'low': return { text: '低風險', color: 'text-forest-400', dot: 'bg-forest-400' };
    default: return { text: '中風險', color: 'text-amber-400', dot: 'bg-amber-400' };
  }
}

export default function TodayWatchSectors({ report }: Props) {
  if (!report) return null;

  const sectors = report.watch_sectors_detailed || [];

  if (sectors.length === 0) {
    return (
      <section className="w-full">
        <div className="mb-5">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Watchlist
          </p>
          <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今日觀察族群</h2>
          <p className="text-surface-500 text-sm mt-1">目前無觀察族群資料</p>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
          Watchlist
        </p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今日觀察族群</h2>
        <p className="text-surface-500 text-sm mt-1">以下族群資料來自今日報告</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {sectors.map((sector, idx) => {
          const heat = getHeatLabel(sector.isOverheated, sector.isSuitableToChase, sector.riskLevel);
          const risk = getRiskLabel(sector.riskLevel);

          return (
            <div
              key={idx}
              className="bg-navy-900 rounded-2xl overflow-hidden border border-navy-800 transition-all duration-300 hover:border-navy-700"
            >
              <div className="p-4 md:p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-3 md:mb-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 md:w-8 md:h-8 ${heat.bg} rounded-lg flex items-center justify-center border ${heat.border}`}>
                      <i className="ri-radar-line text-sm" style={{ color: heat.color.replace('text-', '') === 'red-400' ? '#f87171' : heat.color.replace('text-', '') === 'forest-400' ? '#34d399' : heat.color.replace('text-', '') === 'amber-400' ? '#fbbf24' : '#94a3b8' }}></i>
                    </div>
                    <h3 className="text-white text-sm md:text-base font-semibold">{sector.sector}</h3>
                  </div>
                  <span className={`text-[10px] md:text-xs font-medium px-2 py-0.5 rounded-full border ${heat.border} ${heat.color}`}>
                    {heat.text}
                  </span>
                </div>

                {/* AI Observation */}
                <p className="text-surface-300 text-xs md:text-sm leading-relaxed mb-3 md:mb-4">
                  {sector.aiObservation}
                </p>

                {/* Meta row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${risk.dot}`}></div>
                    <span className={`text-[10px] md:text-xs ${risk.color}`}>{risk.text}</span>
                  </div>
                  {sector.isSuitableToChase && (
                    <span className="text-[10px] md:text-xs text-forest-400 bg-forest-500/10 px-2 py-0.5 rounded-full border border-forest-500/20">
                      可適度關注
                    </span>
                  )}
                  {sector.isOverheated && (
                    <span className="text-[10px] md:text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
                      不宜追價
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}