import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

function getInvalidationConditions(report: Report | null): string[] {
  if (!report) return [];

  const conditions: string[] = [];

  // Only from real data — risk_factors_json and avoid_today
  const risks = report.risk_factors_json;
  if (risks && risks.length > 0) {
    risks.slice(0, 3).forEach((r) => {
      if (r.description) conditions.push(r.description);
    });
  }

  const avoid = report.avoid_today;
  if (avoid && avoid.length > 0) {
    avoid.slice(0, 3 - conditions.length).forEach((a) => {
      if (!conditions.includes(a)) conditions.push(a);
    });
  }

  if (conditions.length === 0) return [];

  return conditions.slice(0, 3);
}

function getLatestReminder(report: Report | null): string {
  if (!report) return '目前尚無盤前報告資料，請稍後重新整理。';

  // 優先使用 summary
  if (report.summary) {
    return report.summary.length > 60
      ? report.summary.slice(0, 60) + '...'
      : report.summary;
  }

  // 其次用 avoid_today
  if (report.avoid_today && report.avoid_today.length > 0) {
    return report.avoid_today[0];
  }

  return '今日報告已產生，請查看詳細內容。';
}

export default function TodayJudgmentStatus({ report }: Props) {
  const bias = report?.market_bias || '震盪';
  const score = report?.confidence_score ?? 50;
  const conditions = getInvalidationConditions(report);
  const reminder = getLatestReminder(report);
  const updateTime = report?.report_date
    ? `${report.report_date} 07:30`
    : '今日 07:30';

  // V7: use sentiment_score + sentiment_label when available
  const sentimentScore = report?.sentiment_score ?? score;
  const sentimentLabel = report?.sentiment_label || null;
  const displayBiasLabel = sentimentLabel
    ? `${sentimentLabel}｜${sentimentScore}/100`
    : `${bias}｜${score}/100`;

  const biasBadge = bias.includes('偏多')
    ? 'bg-rose-500/15 border-rose-400/35 text-rose-300'
    : bias.includes('偏空')
      ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
      : 'bg-amber-500/15 border-amber-400/35 text-amber-300';

  const biasIcon = bias.includes('偏多')
    ? 'ri-arrow-up-line'
    : bias.includes('偏空')
      ? 'ri-arrow-down-line'
      : 'ri-more-line';

  return (
    <section className="w-full">
      <div className="mb-4 md:mb-5">
        <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold mb-1">
          JUDGMENT STATUS
        </p>
        <h2 className="text-white font-bold text-base md:text-lg">今日判斷狀態</h2>
        <p className="text-white/40 text-sm mt-1">
          盤前主情境已建立，10:30 前先觀察主流族群是否延續。
        </p>
      </div>

      <div className="bg-navy-900/80 border border-navy-800 rounded-2xl overflow-hidden">
        {/* 頂部狀態列 */}
        <div className="px-5 md:px-6 py-4 md:py-5 border-b border-navy-800">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            {/* 盤前主情境 */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
                <i className={`${biasIcon} text-white/60 text-base`}></i>
              </div>
              <div>
                <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">盤前主情境</p>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-sm font-semibold ${biasBadge}`}>
                  <i className={`${biasIcon} text-xs`}></i>
                  {displayBiasLabel}
                </span>
              </div>
            </div>

            <div className="hidden sm:block w-px h-10 bg-navy-800"></div>

            {/* 目前狀態 */}
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">目前狀態</p>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
                <span className="text-amber-300 text-sm font-medium">等待 10:30 盤中確認</span>
              </div>
            </div>

            <div className="hidden sm:block w-px h-10 bg-navy-800"></div>

            {/* 劇本成立度 */}
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider">劇本成立度</p>
              <div className="h-1.5 bg-navy-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${bias.includes('偏多') ? 'bg-rose-500' : bias.includes('偏空') ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${score}%` }}
                ></div>
              </div>
              <p className="text-white/25 text-[10px] mt-1">代表盤前訊號一致程度，不代表漲跌保證</p>
            </div>
          </div>
        </div>

        {/* 失效條件 */}
        {conditions.length > 0 && (
          <div className="px-5 md:px-6 py-4 md:py-5 border-b border-navy-800">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-3">失效條件</p>
            <div className="space-y-2">
              {conditions.map((cond, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-5 h-5 bg-navy-800 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                    <i className="ri-close-line text-red-400/70 text-[10px]"></i>
                  </div>
                  <p className="text-white/60 text-sm leading-relaxed">{cond}</p>
                </div>
              ))}
            </div>
            <p className="text-white/25 text-[10px] mt-2">
              以上條件出現時，代表盤前劇本可能需要修正。
            </p>
          </div>
        )}

        {/* 最新提醒 + 時間 */}
        <div className="px-5 md:px-6 py-4 md:py-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <div className="flex-1">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5">最新提醒</p>
            <p className="text-white/80 text-sm font-medium leading-relaxed">
              {reminder}
            </p>
          </div>
          <div className="sm:text-right flex-shrink-0">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">最後更新</p>
            <div className="flex items-center gap-1.5 text-white/50 text-xs">
              <i className="ri-time-line text-[10px]"></i>
              <span>{updateTime}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}