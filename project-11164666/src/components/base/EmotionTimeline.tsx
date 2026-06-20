import { useState, useEffect } from 'react';
import { getLatestReports } from '@/services/reportService';
import type { Report } from '@/types/report';

interface Props {
  days?: number;
}

interface DayMood {
  date: string;
  label: string;
  bias: string;
  score: number;
  summary: string;
}

function getMoodLabel(report: Report): string {
  const bias = report.market_bias || '中性';
  const score = report.confidence_score ?? 50;

  if ((bias.includes('強勢') || bias.includes('偏多')) && score >= 80) return 'AI 過熱';
  if (bias.includes('偏多') && score >= 65) return '貪婪';
  if (bias.includes('偏多')) return '偏多';
  if (bias.includes('偏空') && score <= 30) return '恐慌';
  if (bias.includes('偏空') && score <= 45) return '避險';
  if (bias.includes('偏空')) return '偏空';
  if (score <= 40) return '保守';
  if (score >= 65) return '觀望';
  return '觀望';
}

function getMoodColor(label: string): { bg: string; text: string; bar: string; dot: string } {
  switch (label) {
    case 'AI 過熱':
      return { bg: 'bg-red-500', text: 'text-red-500', bar: 'bg-red-500', dot: 'bg-red-500' };
    case '貪婪':
      return { bg: 'bg-amber-500', text: 'text-amber-500', bar: 'bg-amber-500', dot: 'bg-amber-500' };
    case '偏多':
      return { bg: 'bg-forest-500', text: 'text-forest-500', bar: 'bg-forest-500', dot: 'bg-forest-500' };
    case '觀望':
      return { bg: 'bg-surface-400', text: 'text-surface-500', bar: 'bg-surface-400', dot: 'bg-surface-400' };
    case '保守':
      return { bg: 'bg-slate-400', text: 'text-slate-500', bar: 'bg-slate-400', dot: 'bg-slate-400' };
    case '偏空':
      return { bg: 'bg-orange-500', text: 'text-orange-500', bar: 'bg-orange-500', dot: 'bg-orange-500' };
    case '避險':
      return { bg: 'bg-navy-700', text: 'text-navy-500', bar: 'bg-navy-700', dot: 'bg-navy-700' };
    case '恐慌':
      return { bg: 'bg-red-600', text: 'text-red-600', bar: 'bg-red-600', dot: 'bg-red-600' };
    default:
      return { bg: 'bg-surface-400', text: 'text-surface-500', bar: 'bg-surface-400', dot: 'bg-surface-400' };
  }
}

export default function EmotionTimeline({ days = 7 }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getLatestReports(days);
        setReports(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [days]);

  const timeline: DayMood[] = reports
    .slice()
    .sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime())
    .map((r) => ({
      date: r.report_date,
      label: getMoodLabel(r),
      bias: r.market_bias || '中性',
      score: r.confidence_score ?? 50,
      summary: r.summary?.slice(0, 40) || '市場整理中',
    }));

  if (loading) {
    return (
      <section className="w-full">
        <div className="mb-5">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Mood Timeline
          </p>
          <h2 className="text-navy-900 font-bold text-xl md:text-2xl">
            {days > 7 ? `${days} 天市場情緒時間軸` : '這幾天市場情緒變化'}
          </h2>
        </div>
        <div className="bg-white border border-surface-200 rounded-2xl p-6 animate-pulse h-48"></div>
      </section>
    );
  }

  if (timeline.length === 0) {
    const fallback: DayMood[] = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const dateStr = d.toISOString().slice(0, 10);
      const moods = ['觀望', '偏多', '貪婪', 'AI 過熱', '偏多', '保守', '偏空', '避險', '恐慌', '觀望'];
      const scores = [52, 65, 82, 88, 72, 45, 38, 30, 25, 55];
      return {
        date: dateStr,
        label: moods[i % moods.length],
        bias: ['震盪', '偏多', '偏多觀察', '偏多觀察', '偏多', '震盪', '偏空', '偏空', '偏空', '震盪'][i % 10],
        score: scores[i % scores.length],
        summary: '市場整理中',
      };
    });
    return <TimelineContent timeline={fallback} days={days} />;
  }

  return <TimelineContent timeline={timeline} days={days} />;
}

function TimelineContent({ timeline, days }: { timeline: DayMood[]; days: number }) {
  const isWide = days > 7;

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
          Mood Timeline
        </p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">
          {days > 7 ? `${days} 天市場情緒時間軸` : '這幾天市場情緒變化'}
        </h2>
        <p className="text-surface-500 text-sm mt-1">
          {days > 7 ? '標示恐慌、貪婪、AI 過熱、避險、保守、觀望' : '每天回來看，今天變成什麼情緒'}
        </p>
      </div>

      <div className="bg-white border border-surface-200 rounded-2xl p-4 md:p-6 overflow-hidden">
        {isWide ? (
          <div className="overflow-x-auto pb-2 -mx-2 px-2">
            <div className="min-w-[600px] md:min-w-[800px]">
              <div className="relative flex items-center mb-4 pt-2">
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-surface-200 -translate-y-1/2"></div>
                <div className="relative flex justify-between w-full">
                  {timeline.map((day, idx) => {
                    const colors = getMoodColor(day.label);
                    const isToday = idx === timeline.length - 1;
                    return (
                      <div key={idx} className="flex flex-col items-center gap-1.5 relative">
                        <div
                          className={`w-3 h-3 rounded-full border-2 border-white ${colors.dot} ${isToday ? 'ring-2 ring-offset-2 ring-navy-800' : ''}`}
                          title={`${day.date}: ${day.label} (${day.score})`}
                        ></div>
                        <span className={`text-[10px] font-bold ${colors.text} whitespace-nowrap`}>
                          {day.label}
                        </span>
                        <span className="text-[9px] text-surface-400">
                          {day.date.slice(5).replace('-', '/')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-end gap-1 h-24">
                {timeline.map((day, idx) => {
                  const colors = getMoodColor(day.label);
                  const isToday = idx === timeline.length - 1;
                  const barHeight = Math.max(15, (day.score / 100) * 100);
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-surface-500 font-medium">{day.score}</span>
                      <div
                        className={`w-full rounded-t-sm transition-all duration-500 ${colors.bar} ${isToday ? 'opacity-100' : 'opacity-50'}`}
                        style={{ height: `${barHeight}%` }}
                      ></div>
                      <span className="text-[9px] text-surface-400 text-center truncate w-full">
                        {isToday ? '今天' : `${day.date.slice(8)}日`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto pb-2 -mx-2 px-2">
            <div className="min-w-[400px] md:min-w-[500px]">
              <div className="relative flex items-center mb-6">
                <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-surface-200 -translate-y-1/2"></div>
                <div className="relative flex justify-between w-full">
                  {timeline.map((day, idx) => {
                    const colors = getMoodColor(day.label);
                    const isToday = idx === timeline.length - 1;
                    return (
                      <div key={idx} className="flex flex-col items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded-full border-2 border-white ${colors.dot} ${isToday ? 'ring-2 ring-offset-2 ring-navy-800' : ''}`}
                        ></div>
                        <span className={`text-xs font-bold ${colors.text}`}>{day.label}</span>
                        <span className="text-[10px] text-surface-400">
                          {day.date.slice(5).replace('-', '/')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-end gap-2 h-28">
              {timeline.map((day, idx) => {
                const colors = getMoodColor(day.label);
                const isToday = idx === timeline.length - 1;
                const barHeight = Math.max(20, (day.score / 100) * 100);
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className="text-[10px] text-surface-500 font-medium">{day.score}</span>
                    <div
                      className={`w-full max-w-12 rounded-t-md transition-all duration-500 ${colors.bar} ${isToday ? 'opacity-100' : 'opacity-60'}`}
                      style={{ height: `${barHeight}%` }}
                    ></div>
                    <span className="text-[10px] text-surface-400 text-center truncate w-full">
                      {isToday ? '今天' : `${day.date.slice(8)}日`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}