import { useState, useEffect } from 'react';
import { getLatestReports } from '@/services/reportService';
import type { Report } from '@/types/report';

interface SentimentDay {
  date: string;
  bias: string;
  score: number;
  shortDate: string;
}

interface SentimentChange {
  yesterday: SentimentDay;
  today: SentimentDay;
  direction: string;
  aiInterpretation: string;
}

function getSentimentLabel(bias: string, score: number): string {
  if (bias.includes('偏多') && score >= 80) return '過熱';
  if (bias.includes('偏多') && score >= 65) return '偏熱';
  if (bias.includes('偏多')) return '偏暖';
  if (bias.includes('偏空') && score <= 30) return '恐慌';
  if (bias.includes('偏空')) return '偏冷';
  return '觀望';
}

function getSentimentColor(bias: string, score: number): string {
  const label = getSentimentLabel(bias, score);
  if (label === '過熱') return 'text-red-400';
  if (label === '偏熱') return 'text-amber-400';
  if (label === '偏暖') return 'text-forest-400';
  if (label === '恐慌') return 'text-red-500';
  if (label === '偏冷') return 'text-indigo-400';
  return 'text-white/50';
}

function getSentimentBg(bias: string, score: number): string {
  const label = getSentimentLabel(bias, score);
  if (label === '過熱') return 'bg-red-500/10 border-red-500/20';
  if (label === '偏熱') return 'bg-amber-500/10 border-amber-500/20';
  if (label === '偏暖') return 'bg-forest-500/10 border-forest-500/20';
  if (label === '恐慌') return 'bg-red-500/10 border-red-500/20';
  if (label === '偏冷') return 'bg-indigo-500/10 border-indigo-500/20';
  return 'bg-white/5 border-white/10';
}

function deriveChange(today: SentimentDay, yesterday: SentimentDay): SentimentChange {
  const todayLabel = getSentimentLabel(today.bias, today.score);
  const yesterdayLabel = getSentimentLabel(yesterday.bias, yesterday.score);

  let direction = '';
  let aiInterpretation = '';

  const tempOrder = ['恐慌', '偏冷', '觀望', '偏暖', '偏熱', '過熱'];
  const todayIdx = tempOrder.indexOf(todayLabel);
  const yesterdayIdx = tempOrder.indexOf(yesterdayLabel);

  if (todayIdx > yesterdayIdx) {
    direction = '升溫';
    aiInterpretation = '市場情緒正在升溫，但不要因為今天變熱，就以為明天還會更熱。';
  } else if (todayIdx < yesterdayIdx) {
    direction = '降溫';
    aiInterpretation = '市場從昨天的熱度轉向冷靜，今天不是不能看多，而是不要再用昨天的熱度判斷今天。';
  } else {
    direction = '持平';
    aiInterpretation = '市場情緒和昨天接近，維持同樣的觀察節奏就好。';
  }

  // Override with more specific interpretations based on bias
  if (today.bias.includes('偏多') && yesterday.bias.includes('偏空')) {
    direction = '翻轉';
    aiInterpretation = '市場從偏空轉向偏多，這種翻轉日最容易犯的錯是「覺得錯過了」而急著追。';
  } else if (today.bias.includes('偏空') && yesterday.bias.includes('偏多')) {
    direction = '翻轉';
    aiInterpretation = '市場從偏多轉向偏空，這種翻轉日最容易犯的錯是「覺得只是回檔」而硬撐。';
  } else if (todayLabel === '過熱' && yesterdayLabel === '偏熱') {
    direction = '過熱';
    aiInterpretation = '市場情緒進入過熱區，這時候追價的風險遠大於機會。';
  } else if (todayLabel === '恐慌' && yesterdayLabel === '偏冷') {
    direction = '恐慌';
    aiInterpretation = '市場情緒進入恐慌區，這時候亂賣的風險比亂買更大。';
  }

  return {
    yesterday,
    today,
    direction,
    aiInterpretation,
  };
}

export default function MarketSentimentContinuation() {
  const [change, setChange] = useState<SentimentChange | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const reports = await getLatestReports(2);
        if (reports.length >= 2) {
          const today = reports[0];
          const yesterday = reports[1];
          setChange(deriveChange(
            {
              date: today.report_date,
              bias: today.market_bias || '觀望',
              score: today.confidence_score ?? 50,
              shortDate: today.report_date.slice(5).replace('-', '/'),
            },
            {
              date: yesterday.report_date,
              bias: yesterday.market_bias || '觀望',
              score: yesterday.confidence_score ?? 50,
              shortDate: yesterday.report_date.slice(5).replace('-', '/'),
            }
          ));
        } else if (reports.length === 1) {
          const today = reports[0];
          setChange({
            yesterday: {
              date: '昨日',
              bias: '資料不足',
              score: 50,
              shortDate: '--',
            },
            today: {
              date: today.report_date,
              bias: today.market_bias || '觀望',
              score: today.confidence_score ?? 50,
              shortDate: today.report_date.slice(5).replace('-', '/'),
            },
            direction: '觀察',
            aiInterpretation: '今天開始記錄市場情緒變化，明天回來看連續性。',
          });
        }
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
        <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6 animate-pulse">
          <div className="h-4 bg-white/5 rounded w-1/3 mb-4"></div>
          <div className="h-3 bg-white/5 rounded w-2/3 mb-2"></div>
          <div className="h-3 bg-white/5 rounded w-1/2"></div>
        </div>
      </section>
    );
  }

  if (!change) {
    return (
      <section className="w-full">
        <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
          <div className="mb-4">
            <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold mb-1">SENTIMENT CONTINUATION</p>
            <h2 className="text-white font-bold text-xl md:text-2xl">市場情緒連續劇</h2>
            <p className="text-white/40 text-sm mt-1">不是每天重新猜一次，而是看市場情緒正在怎麼變。</p>
          </div>
          <p className="text-white/40 text-sm">資料累積中，從今天開始記錄市場情緒連續性。</p>
        </div>
      </section>
    );
  }

  const todayLabel = getSentimentLabel(change.today.bias, change.today.score);
  const yesterdayLabel = getSentimentLabel(change.yesterday.bias, change.yesterday.score);
  const todayColor = getSentimentColor(change.today.bias, change.today.score);
  const yesterdayColor = getSentimentColor(change.yesterday.bias, change.yesterday.score);
  const todayBg = getSentimentBg(change.today.bias, change.today.score);
  const yesterdayBg = getSentimentBg(change.yesterday.bias, change.yesterday.score);

  const directionColor = change.direction === '升溫' || change.direction === '過熱'
    ? 'text-red-400'
    : change.direction === '翻轉'
      ? 'text-amber-400'
      : change.direction === '降溫' || change.direction === '恐慌'
        ? 'text-indigo-400'
        : 'text-white/50';

  const directionBg = change.direction === '升溫' || change.direction === '過熱'
    ? 'bg-red-500/10 border-red-500/20'
    : change.direction === '翻轉'
      ? 'bg-amber-500/10 border-amber-500/20'
      : change.direction === '降溫' || change.direction === '恐慌'
        ? 'bg-indigo-500/10 border-indigo-500/20'
        : 'bg-white/5 border-white/10';

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">SENTIMENT CONTINUATION</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
            <i className="ri-film-line"></i>
            連續追蹤
          </span>
        </div>
        <h2 className="text-white font-bold text-xl md:text-2xl">市場情緒連續劇</h2>
        <p className="text-white/40 text-sm mt-1">不是每天重新猜一次，而是看市場情緒正在怎麼變。</p>
      </div>

      <div className="bg-navy-900/60 border border-navy-800 rounded-2xl overflow-hidden">
        {/* 情緒變化時間軸 */}
        <div className="p-5 md:p-6">
          <div className="flex items-center gap-3 md:gap-4 mb-5">
            {/* 昨天 */}
            <div className={`flex-1 p-4 rounded-xl border ${yesterdayBg}`}>
              <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">昨天</p>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${yesterdayColor}`}>{yesterdayLabel}</span>
                <span className="text-white/20 text-xs">{change.yesterday.shortDate}</span>
              </div>
            </div>

            {/* 箭頭 */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <i className="ri-arrow-right-line text-white/20 text-lg"></i>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${directionBg} ${directionColor}`}>
                {change.direction}
              </span>
            </div>

            {/* 今天 */}
            <div className={`flex-1 p-4 rounded-xl border ${todayBg}`}>
              <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">今天</p>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${todayColor}`}>{todayLabel}</span>
                <span className="text-white/20 text-xs">{change.today.shortDate}</span>
              </div>
            </div>
          </div>

          {/* AI 解讀 */}
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 md:p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center flex-shrink-0">
                <i className="ri-brain-line text-white/40 text-sm"></i>
              </div>
              <div>
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5">AI 解讀</p>
                <p className="text-white/80 text-sm md:text-base font-medium leading-relaxed">
                  {change.aiInterpretation}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 底部提示 */}
        <div className="px-5 md:px-6 py-3 bg-navy-950/50 border-t border-navy-800">
          <p className="text-white/30 text-xs text-center">
            市場情緒不是一天的事，連續看三天，比單日猜測更有價值。
          </p>
        </div>
      </div>
    </section>
  );
}