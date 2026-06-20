import type { Report } from '@/types/report';

interface WatchSectorsGridProps {
  report: Report | null;
}

function getSectorCards(report: Report | null) {
  if (!report) return [];

  const cards: {
    name: string;
    direction: string;
    reason: string;
    risk: string;
    directionColor: string;
  }[] = [];

  // From watch_sectors_detailed only. Do not synthesize static sectors when data is missing.
  const detailed = report.watch_sectors_detailed;
  if (detailed?.length) {
    detailed.forEach((d) => {
      if (cards.length >= 6) return;
      if (!cards.find((c) => c.name === d.sector)) {
        cards.push({
          name: d.sector,
          direction: d.isSuitableToChase ? '偏多' : d.isOverheated ? '過熱' : '觀察',
          reason: d.aiObservation || '持續觀察',
          risk: d.riskLevel === 'high' ? '風險較高，不適合追價' : d.riskLevel === 'medium' ? '留意盤中震盪' : '風險相對較低',
          directionColor: d.isSuitableToChase ? 'text-forest-400' : d.isOverheated ? 'text-red-400' : 'text-amber-400',
        });
      }
    });
  }

  return cards;
}

export default function WatchSectorsGrid({ report }: WatchSectorsGridProps) {
  const cards = getSectorCards(report);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-focus-3-line text-amber-400 text-sm"></i>
        </div>
        <div>
          <h2 className="text-white font-bold text-base md:text-lg">今天 AI 最關注什麼</h2>
          <p className="text-white/40 text-[10px] md:text-xs">不只是 tag，是今天盤前值得觀察的名單</p>
        </div>
      </div>

      {cards.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {cards.map((card, i) => (
            <div
              key={i}
              className="bg-navy-900/60 border border-navy-800 rounded-2xl p-4 md:p-5 hover:border-white/10 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold text-sm md:text-base">{card.name}</h3>
                <span className={`text-xs font-semibold ${card.directionColor}`}>{card.direction}</span>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-start gap-2">
                  <i className="ri-eye-line text-white/30 text-xs mt-0.5"></i>
                  <p className="text-white/70 text-xs md:text-sm leading-relaxed">{card.reason}</p>
                </div>
                <div className="flex items-start gap-2">
                  <i className="ri-alert-line text-red-400/60 text-xs mt-0.5"></i>
                  <p className="text-white/50 text-xs leading-relaxed">{card.risk}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-4 md:p-5">
          <div className="flex items-start gap-2">
            <i className="ri-database-2-line text-white/30 text-xs mt-0.5"></i>
            <p className="text-white/50 text-xs md:text-sm leading-relaxed">目前資料不足，等待盤前報告補齊觀察族群。</p>
          </div>
        </div>
      )}
    </div>
  );
}
