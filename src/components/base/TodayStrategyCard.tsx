import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

export default function TodayStrategyCard({ report }: Props) {
  if (!report) return null;

  const strategy = report.today_strategy;

  if (!strategy) {
    return (
      <section className="w-full">
        <div className="mb-5">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
            Action Plan
          </p>
          <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今日策略</h2>
          <p className="text-surface-500 text-sm mt-1">今日策略尚未生成</p>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">
          Action Plan
        </p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今日策略</h2>
        <p className="text-surface-500 text-sm mt-1">以下策略來自今日報告</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {/* Do */}
        <div className="bg-navy-900 rounded-2xl overflow-hidden border border-navy-800">
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-navy-800 bg-forest-500/5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 md:w-8 md:h-8 bg-forest-500/15 rounded-lg flex items-center justify-center">
                <i className="ri-check-line text-forest-400 text-sm md:text-base"></i>
              </div>
              <div>
                <p className="text-white text-sm font-semibold">適合今天</p>
                <p className="text-surface-500 text-[10px]">報告建議的行動</p>
              </div>
            </div>
          </div>
          <div className="p-4 md:p-5 space-y-2.5 md:space-y-3">
            {strategy.do.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 md:p-3.5 bg-forest-500/[0.04] border border-forest-500/10 rounded-xl"
              >
                <div className="w-5 h-5 md:w-6 md:h-6 bg-forest-500/15 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-check-line text-forest-400 text-[10px] md:text-xs"></i>
                </div>
                <p className="text-surface-200 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Avoid */}
        <div className="bg-navy-900 rounded-2xl overflow-hidden border border-navy-800">
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-navy-800 bg-red-500/5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 md:w-8 md:h-8 bg-red-500/15 rounded-lg flex items-center justify-center">
                <i className="ri-close-line text-red-400 text-sm md:text-base"></i>
              </div>
              <div>
                <p className="text-white text-sm font-semibold">今天避免</p>
                <p className="text-surface-500 text-[10px]">報告提醒的紀律</p>
              </div>
            </div>
          </div>
          <div className="p-4 md:p-5 space-y-2.5 md:space-y-3">
            {strategy.avoid.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 md:p-3.5 bg-red-500/[0.04] border border-red-500/10 rounded-xl"
              >
                <div className="w-5 h-5 md:w-6 md:h-6 bg-red-500/15 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-close-line text-red-400 text-[10px] md:text-xs"></i>
                </div>
                <p className="text-surface-200 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}