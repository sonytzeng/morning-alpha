import { useMemo } from 'react';
import type { Report } from '@/types/report';

interface MarketRhythmCardProps {
  reports: Report[];
}

export default function MarketRhythmCard({ reports }: MarketRhythmCardProps) {
  const stats = useMemo(() => {
    let bullish = 0;
    let neutral = 0;
    let bearish = 0;
    for (const r of reports) {
      const s = r.market_bias || '';
      if (s.includes('偏多')) bullish++;
      else if (s.includes('偏空')) bearish++;
      else neutral++;
    }
    return { bullish, neutral, bearish, total: reports.length };
  }, [reports]);

  const total = stats.total || 1;
  const bullishPct = Math.round((stats.bullish / total) * 100);
  const neutralPct = Math.round((stats.neutral / total) * 100);
  const bearishPct = 100 - bullishPct - neutralPct;

  const dominant = stats.bullish > stats.bearish
    ? '偏多'
    : stats.bearish > stats.bullish
      ? '偏空'
      : '觀望';

  const observation = stats.bullish >= 4
    ? '最近比較容易在市場偏多時停留較久，可能正在進入追價情緒。'
    : stats.bearish >= 4
      ? '最近市場偏空天數較多，保持觀察是對的。不要因為跌多了就急著抄底。'
      : '最近市場情緒比較分散，這種時候最適合練習冷靜觀察。';

  if (reports.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-8">
        <h2 className="text-white font-bold text-base md:text-lg mb-1">最近市場節奏</h2>
        <p className="text-white/40 text-xs md:text-sm mb-5">尚無足夠數據來分析市場節奏。</p>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
          <p className="text-white/30 text-sm">AI 報告產生後，市場節奏將會自動累積</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-8">
      <h2 className="text-white font-bold text-base md:text-lg mb-1">最近市場節奏</h2>
      <p className="text-white/40 text-xs md:text-sm mb-5 md:mb-6">
        AI 正在觀察市場情緒變化與方向節奏。
      </p>

      {/* Sentiment pills */}
      <div className="flex flex-wrap gap-2 mb-5 md:mb-6">
        {reports.slice(0, 7).map((r, i) => {
          const s = r.market_bias || '';
          const isBull = s.includes('偏多');
          const isBear = s.includes('偏空');
          return (
            <div
              key={r.id || i}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
                isBull
                  ? 'bg-forest-500/15 text-forest-300 border border-forest-500/20'
                  : isBear
                    ? 'bg-red-500/15 text-red-300 border border-red-500/20'
                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                isBull ? 'bg-forest-400' : isBear ? 'bg-red-400' : 'bg-amber-400'
              }`}></span>
              <span className="hidden sm:inline">{r.report_date?.slice(5) || ''}</span>
              <span>{s || '觀望'}</span>
            </div>
          );
        })}
      </div>

      {/* Mini bar chart */}
      <div className="flex items-center gap-3 mb-5 md:mb-6">
        <div className="flex-1 h-3 rounded-full overflow-hidden bg-white/10 flex">
          {bullishPct > 0 && (
            <div
              className="h-full bg-forest-500"
              style={{ width: `${bullishPct}%` }}
              title={`偏多 ${stats.bullish} 天`}
            ></div>
          )}
          {neutralPct > 0 && (
            <div
              className="h-full bg-amber-500"
              style={{ width: `${neutralPct}%` }}
              title={`觀望 ${stats.neutral} 天`}
            ></div>
          )}
          {bearishPct > 0 && (
            <div
              className="h-full bg-red-500"
              style={{ width: `${bearishPct}%` }}
              title={`偏空 ${stats.bearish} 天`}
            ></div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-5 md:mb-6 text-xs">
        <span className="flex items-center gap-1.5 text-forest-300">
          <span className="w-2 h-2 rounded-full bg-forest-500"></span>
          偏多 {stats.bullish} 天
        </span>
        <span className="flex items-center gap-1.5 text-amber-300">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          觀望 {stats.neutral} 天
        </span>
        <span className="flex items-center gap-1.5 text-red-300">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          偏空 {stats.bearish} 天
        </span>
      </div>

      {/* AI Observation */}
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-brain-line text-amber-400 text-sm"></i>
          </div>
          <div>
            <p className="text-amber-300 text-xs font-semibold mb-1">AI 觀察</p>
            <p className="text-white/60 text-sm leading-relaxed">{observation}</p>
            <p className="text-white/30 text-[11px] mt-2">
              過去 7 天市場主要情緒：{dominant}（{Math.max(stats.bullish, stats.neutral, stats.bearish)} 天）
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}