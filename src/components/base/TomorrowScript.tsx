import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

export default function TomorrowScript({ report }: Props) {
  if (!report) return null;

  const tomorrowWatch = report.tomorrow_watch_json || [];
  const riskFactors = report.risk_factors_json || [];

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
          Tomorrow Preview
        </p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">明天市場可能劇本</h2>
        <p className="text-surface-500 text-sm mt-1">AI 幫你先想一步，不是預測，是準備</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <h3 className="text-navy-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <i className="ri-movie-line text-forest-500 text-sm"></i>
            可能劇本
          </h3>
          {tomorrowWatch.length > 0 ? (
            <div className="space-y-3">
              {tomorrowWatch.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 bg-forest-100 rounded-full flex items-center justify-center text-forest-600 text-xs font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-navy-700 text-sm font-medium">{item.name}</p>
                    <p className="text-surface-500 text-xs">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-surface-500 text-sm">AI 正在分析明天可能的市場劇本...</p>
          )}
        </div>

        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <h3 className="text-navy-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <i className="ri-alarm-warning-line text-amber-500 text-sm"></i>
            明天要注意什麼
          </h3>
          {riskFactors.length > 0 ? (
            <div className="space-y-3">
              {riskFactors.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 text-xs font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-navy-700 text-sm font-medium">{item.title}</p>
                    <p className="text-surface-500 text-xs">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-surface-500 text-sm">暫無特別風險提醒</p>
          )}
        </div>
      </div>
    </section>
  );
}