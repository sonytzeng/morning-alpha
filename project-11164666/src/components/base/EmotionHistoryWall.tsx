import { useState, useEffect } from 'react';
import { getLatestReports } from '@/services/reportService';
import type { Report } from '@/types/report';

interface EmotionDay {
  id: string;
  date: string;
  bias: string;
  score: number;
  summary: string;
  shortDate: string;
}

function getEmotionLabel(bias: string, score: number): { label: string; color: string; bg: string; border: string } {
  if (bias.includes('偏多') && score >= 75) {
    return { label: '偏多', color: 'text-forest-400', bg: 'bg-forest-500/10', border: 'border-forest-500/20' };
  }
  if (bias.includes('偏多')) {
    return { label: '偏多', color: 'text-forest-300', bg: 'bg-forest-500/8', border: 'border-forest-500/15' };
  }
  if (bias.includes('偏空') && score <= 40) {
    return { label: '偏空', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' };
  }
  if (bias.includes('偏空')) {
    return { label: '偏空', color: 'text-red-300', bg: 'bg-red-500/8', border: 'border-red-500/15' };
  }
  return { label: '震盪', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
}

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return dateStr;
}

export default function EmotionHistoryWall() {
  const [days, setDays] = useState<EmotionDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const reports = await getLatestReports(30);
        const mapped = reports
          .slice()
          .sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime())
          .map((r) => ({
            id: r.id,
            date: r.report_date,
            bias: r.market_bias || '震盪',
            score: r.confidence_score ?? 50,
            summary: r.summary?.slice(0, 45) || '市場整理中',
            shortDate: formatShortDate(r.report_date),
          }));
        setDays(mapped);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <section className="w-full">
        <div className="mb-5">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Emotion Wall</p>
          <h2 className="text-navy-900 font-bold text-xl md:text-2xl">最近市場情緒</h2>
          <p className="text-surface-500 text-sm mt-1">AI 每天記錄市場的心情</p>
        </div>
        <div className="bg-white border border-surface-200 rounded-2xl p-6 animate-pulse h-48"></div>
      </section>
    );
  }

  if (days.length === 0) {
    return (
      <section className="w-full">
        <div className="mb-5">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Emotion Wall</p>
          <h2 className="text-navy-900 font-bold text-xl md:text-2xl">最近市場情緒</h2>
          <p className="text-surface-500 text-sm mt-1">AI 每天記錄市場的心情</p>
        </div>
        <div className="bg-white border border-surface-200 rounded-2xl p-6 text-center">
          <p className="text-surface-500 text-sm">情緒紀錄準備中，明天開始會顯示。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Emotion Wall</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">最近市場情緒</h2>
        <p className="text-surface-500 text-sm mt-1">AI 每天記錄市場的心情</p>
      </div>

      <div className="relative">
        <div className="overflow-x-auto pb-3 -mx-4 px-4 scrollbar-hide">
          <div className="flex gap-3 min-w-max">
            {days.map((day, idx) => {
              const style = getEmotionLabel(day.bias, day.score);
              const isToday = idx === days.length - 1;
              return (
                <div
                  key={day.id}
                  className={`flex-shrink-0 w-40 rounded-xl border p-4 transition-all ${
                    isToday ? `${style.bg} ${style.border} ring-1 ring-offset-2 ring-navy-900/10` : 'bg-white border-surface-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-surface-500 text-[10px]">{day.shortDate}</span>
                    <span className={`text-xs font-bold ${style.color}`}>{style.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className={`text-2xl font-bold ${style.color}`}>{day.score}</span>
                    <span className="text-surface-400 text-[10px]">/100</span>
                  </div>
                  <p className="text-surface-500 text-[11px] leading-relaxed line-clamp-2">
                    {day.summary}
                  </p>
                  {isToday && (
                    <div className="mt-2 pt-2 border-t border-surface-100">
                      <span className="text-[10px] text-forest-500 font-medium">今天</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-3 w-8 bg-gradient-to-r from-surface-50 to-transparent pointer-events-none"></div>
        <div className="absolute right-0 top-0 bottom-3 w-8 bg-gradient-to-l from-surface-50 to-transparent pointer-events-none"></div>
      </div>
    </section>
  );
}