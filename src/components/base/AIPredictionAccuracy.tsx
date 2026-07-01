import { useMemo } from 'react';
import type { Report } from '@/types/report';

interface Props {
  reports: Report[];
}

interface CheckResult {
  date: string;
  prediction: string;
  isCorrect: boolean | null;
  confidence: number;
  detail: string;
  nextDayMarkets: string;
}

function checkPredictions(reports: Report[]): CheckResult[] {
  if (reports.length < 2) return [];

  const sorted = [...reports].sort(
    (a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
  );

  const results: CheckResult[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const yesterday = sorted[i];
    const today = sorted[i + 1];

    const prediction = yesterday.market_bias || '中性';
    const nasdaq = today.nasdaq_change ?? 0;
    const sp500 = today.sp500_change ?? 0;
    const sox = today.sox_change ?? 0;
    const taiex = today.taiex_futures_change ?? 0;

    const values = [nasdaq, sp500, sox, taiex];
    const total = values.length || 1;
    const bullishCount = values.filter((v) => v > 0).length;
    const bearishCount = values.filter((v) => v < 0).length;

    const isBullishPred = prediction.includes('偏多') || prediction.includes('強勢');
    const isBearishPred = prediction.includes('偏空');

    let isCorrect: boolean | null = null;

    if (isBullishPred) {
      isCorrect = bullishCount >= total / 2;
    } else if (isBearishPred) {
      isCorrect = bearishCount >= total / 2;
    } else {
      isCorrect = Math.abs(bullishCount - bearishCount) <= Math.ceil(total / 3);
    }

    const marketStr = values
      .map((v, idx) => {
        const names = ['Nasdaq', 'S&P500', 'SOX', '台指期'];
        const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '→';
        return `${names[idx]}${arrow}`;
      })
      .join('、');

    const detail = isCorrect
      ? `昨天預測「${prediction}」，市場確實${isBullishPred ? '偏強' : isBearishPred ? '偏弱' : '震盪'}。`
      : `昨天預測「${prediction}」，但市場走向不同。`;

    results.push({
      date: yesterday.report_date,
      prediction,
      isCorrect,
      confidence: yesterday.confidence_score ?? 50,
      detail,
      nextDayMarkets: marketStr,
    });
  }

  return results.reverse();
}

export default function AIPredictionAccuracy({ reports }: Props) {
  const results = useMemo(() => checkPredictions(reports), [reports]);
  const latest = results[0] || null;
  const correctCount = results.filter((r) => r.isCorrect).length;
  const accuracy = results.length > 0 ? Math.round((correctCount / results.length) * 100) : 0;

  if (results.length === 0) {
    return (
      <section className="w-full">
        <div className="mb-5">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Trust Builder
          </p>
          <h2 className="text-navy-900 font-bold text-xl md:text-2xl">昨天 AI 說對了嗎？</h2>
          <p className="text-surface-500 text-sm mt-1">每天回來檢查，建立對 AI 的信任</p>
        </div>
        <div className="bg-white border border-surface-200 rounded-2xl p-8 text-center">
          <div className="w-12 h-12 bg-surface-100 rounded-xl flex items-center justify-center mx-auto mb-3">
            <i className="ri-question-line text-surface-400 text-xl"></i>
          </div>
          <p className="text-surface-500 text-sm">需要至少兩天的歷史資料來計算準確度</p>
          <p className="text-surface-400 text-xs mt-1">持續使用幾天後就會出現結果</p>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
          Trust Builder
        </p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">昨天 AI 說對了嗎？</h2>
        <p className="text-surface-500 text-sm mt-1">
          {results.length >= 5
            ? `最近 ${results.length} 次判斷，AI 說對了 ${correctCount} 次（${accuracy}%）`
            : '每天回來檢查，建立對 AI 的信任'}
        </p>
      </div>

      {latest && (
        <div
          className={`rounded-2xl overflow-hidden mb-4 ${
            latest.isCorrect
              ? 'bg-forest-50 border border-forest-200'
              : 'bg-amber-50 border border-amber-200'
          }`}
        >
          <div className="p-5 md:p-6">
            <div className="flex items-center gap-3 mb-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  latest.isCorrect ? 'bg-forest-100' : 'bg-amber-100'
                }`}
              >
                <i
                  className={`text-lg ${
                    latest.isCorrect ? 'ri-check-line text-forest-600' : 'ri-close-line text-amber-600'
                  }`}
                ></i>
              </div>
              <div>
                <span
                  className={`text-sm font-bold ${
                    latest.isCorrect ? 'text-forest-700' : 'text-amber-700'
                  }`}
                >
                  {latest.isCorrect ? '昨天 AI 說對了' : '昨天 AI 沒猜中'}
                </span>
                <span className="text-surface-400 text-xs ml-2">{latest.date}</span>
              </div>
            </div>

            <p
              className={`text-sm leading-relaxed mb-3 ${
                latest.isCorrect ? 'text-forest-800' : 'text-amber-800'
              }`}
            >
              {latest.detail}
            </p>

            <p className="text-surface-500 text-xs">隔日市場：{latest.nextDayMarkets}</p>
          </div>
        </div>
      )}

      {results.length > 1 && (
        <div className="bg-white border border-surface-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100">
            <h3 className="text-navy-900 font-semibold text-sm">最近判斷紀錄</h3>
          </div>
          <div className="divide-y divide-surface-100">
            {results.slice(1, 6).map((r, idx) => (
              <div key={idx} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      r.isCorrect ? 'bg-forest-100 text-forest-600' : 'bg-amber-100 text-amber-600'
                    }`}
                  >
                    <i className={r.isCorrect ? 'ri-check-line' : 'ri-close-line'}></i>
                  </span>
                  <span className="text-navy-700 text-sm">{r.date}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      r.prediction.includes('偏多')
                        ? 'bg-forest-50 text-forest-600'
                        : r.prediction.includes('偏空')
                          ? 'bg-red-50 text-red-600'
                          : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    {r.prediction}
                  </span>
                </div>
                <span className="text-surface-400 text-xs">{r.nextDayMarkets}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}