import type { Report } from '@/types/report';

interface TodayStrategySectionProps {
  report: Report | null;
}

function getDoItems(report: Report | null): string[] {
  if (!report) return [];

  const items: string[] = [];

  const strategy = report.ai_strategy_json;
  if (strategy?.overall_advice) items.push(strategy.overall_advice);
  if (strategy?.conservative) items.push(strategy.conservative);

  const canWatch = report.can_watch;
  if (canWatch?.length) {
    canWatch.forEach((w) => {
      if (!items.includes(w)) items.push(w);
    });
  }

  // Fallback defaults
  if (items.length === 0) {
    return [
      '開盤先觀察量能，不急著追',
      'ETF 可作為保守資金停泊參考',
      '偏多時仍建議分批，不要一次重壓',
      '先確認強勢族群是否續航再判斷',
    ];
  }

  return items.slice(0, 6);
}

function getAvoidItems(report: Report | null): string[] {
  if (!report) return [];

  const items: string[] = [];

  const strategy = report.ai_strategy_json;
  if (strategy?.risk_warning) items.push(strategy.risk_warning);

  const avoidToday = report.avoid_today;
  if (avoidToday?.length) {
    avoidToday.forEach((a) => {
      if (!items.includes(a)) items.push(a);
    });
  }

  const risks = report.risk_factors_json;
  if (risks?.length) {
    risks.forEach((r) => {
      if (r.description && !items.includes(r.description)) items.push(r.description);
    });
  }

  // Fallback defaults
  if (items.length === 0) {
    return [
      '開盤追高，容易買在情緒最高點',
      '重壓單一股，分散風險是基本功',
      '因為市場偏多就失去風險意識',
      '看到漲停就衝，漲停不代表明天還漲',
    ];
  }

  return items.slice(0, 6);
}

export default function TodayStrategySection({ report }: TodayStrategySectionProps) {
  const doItems = getDoItems(report);
  const avoidItems = getAvoidItems(report);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-compass-3-line text-amber-400 text-sm"></i>
        </div>
        <div>
          <h2 className="text-white font-bold text-base md:text-lg">今日策略</h2>
          <p className="text-white/40 text-[10px] md:text-xs">AI 把今天盤前該做與不該做的事整理給你</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {/* 左欄：今天適合 */}
        <div className="bg-forest-500/5 border border-forest-500/15 rounded-2xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <div className="w-7 h-7 bg-forest-500/15 rounded-lg flex items-center justify-center">
              <i className="ri-check-line text-forest-400 text-sm"></i>
            </div>
            <span className="text-forest-400 text-sm font-semibold">今天適合</span>
          </div>
          <ul className="space-y-2.5 md:space-y-3">
            {doItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-5 h-5 bg-forest-500/15 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-check-line text-forest-400 text-[10px]"></i>
                </span>
                <span className="text-white/80 text-sm leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 右欄：今天避免 */}
        <div className="bg-red-500/5 border border-red-500/15 rounded-2xl p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <div className="w-7 h-7 bg-red-500/15 rounded-lg flex items-center justify-center">
              <i className="ri-close-line text-red-400 text-sm"></i>
            </div>
            <span className="text-red-400 text-sm font-semibold">今天避免</span>
          </div>
          <ul className="space-y-2.5 md:space-y-3">
            {avoidItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-5 h-5 bg-red-500/15 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-close-line text-red-400 text-[10px]"></i>
                </span>
                <span className="text-white/80 text-sm leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="text-white/25 text-[10px] text-center">
        以上為 AI 市場觀察，不構成投資建議。所有決策請自行判斷。
      </p>
    </div>
  );
}