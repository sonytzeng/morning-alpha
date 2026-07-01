import { useMemo } from 'react';
import type { Report } from '@/types/report';

interface MarketTimelineProps {
  reports: Report[];
}

export default function MarketTimeline({ reports }: MarketTimelineProps) {
  const sorted = useMemo(() => {
    return [...reports].sort((a, b) =>
      (a.report_date || '').localeCompare(b.report_date || '')
    );
  }, [reports]);

  if (reports.length === 0) {
    return (
      <div>
        <div className="mb-4 md:mb-5">
          <h2 className="text-white font-bold text-base md:text-lg mb-1">最近市場紀錄</h2>
          <p className="text-white/40 text-xs md:text-sm">過去 30 天的情緒時間軸</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="text-white/30 text-sm">尚無市場紀錄</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 md:mb-5">
        <h2 className="text-white font-bold text-base md:text-lg mb-1">最近市場紀錄</h2>
        <p className="text-white/40 text-xs md:text-sm">過去 30 天的情緒時間軸</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-6 overflow-hidden">
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
          <div className="min-w-[640px] md:min-w-0">
            <div className="relative pt-6 pb-2">
              <div className="absolute top-[34px] left-0 right-0 h-px bg-white/10"></div>
              <div className="flex items-start justify-between relative">
                {sorted.map((r, i) => {
                  const s = r.market_bias || '';
                  const isBull = s.includes('偏多');
                  const isBear = s.includes('偏空');
                  const dotColor = isBull
                    ? 'bg-forest-500 border-forest-400'
                    : isBear
                      ? 'bg-red-500 border-red-400'
                      : 'bg-amber-500 border-amber-400';

                  return (
                    <div key={r.id || i} className="flex flex-col items-center flex-1 min-w-[40px]">
                      <span className="text-white/30 text-[10px] mb-2 whitespace-nowrap">
                        {r.report_date?.slice(5)?.replace('-', '/') || ''}
                      </span>
                      <div
                        className={`w-3 h-3 rounded-full border ${dotColor} shadow-sm z-10 flex-shrink-0`}
                        title={`${r.report_date} · ${s || '觀望'}`}
                      ></div>
                      <span
                        className={`text-[10px] mt-1.5 whitespace-nowrap ${
                          isBull
                            ? 'text-forest-400'
                            : isBear
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {s || '觀望'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-5 mt-4 pt-3 border-t border-white/10">
          <span className="flex items-center gap-1.5 text-forest-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-forest-500"></span>
            偏多
          </span>
          <span className="flex items-center gap-1.5 text-amber-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            觀望
          </span>
          <span className="flex items-center gap-1.5 text-red-400 text-xs">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            偏空
          </span>
        </div>
      </div>
    </div>
  );
}