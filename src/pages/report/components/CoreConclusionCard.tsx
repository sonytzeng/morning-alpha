import type { Report } from '@/types/report';
import { BRAND_ICON_URL, BRAND_NAME } from '@/config/brand';
import { getSubscriberReportProjection } from '@/lib/subscriberReportProjection';

interface CoreConclusionCardProps {
  report: Report | null;
}

export default function CoreConclusionCard({ report }: CoreConclusionCardProps) {
  if (!report) return null;

  const projection = getSubscriberReportProjection(report);
  const bias = projection.marketDecision.label;
  const score = projection.confidence.value;
  const label = projection.confidence.label;
  const mainQuote = projection.marketDecision.summary ?? projection.statusLabel;

  const biasStyle = (() => {
    if (bias.includes('偏多')) return {
      badge: 'bg-forest-500/15 border-forest-500/30 text-forest-400',
      bar: 'bg-forest-500',
      icon: 'ri-arrow-up-line',
    };
    if (bias.includes('偏空')) return {
      badge: 'bg-red-500/15 border-red-500/30 text-red-400',
      bar: 'bg-red-500',
      icon: 'ri-arrow-down-line',
    };
    return {
      badge: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
      bar: 'bg-amber-500',
      icon: 'ri-more-line',
    };
  })();

  return (
    <div className="relative bg-navy-900/80 border border-navy-800 rounded-2xl p-6 md:p-8 overflow-hidden">
      {/* Subtle glow */}
      <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full blur-[80px] opacity-[0.06] bg-white pointer-events-none"></div>

      <div className="relative">
        {/* Top row: badges */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${biasStyle.badge}`}>
            <i className={`${biasStyle.icon} text-xs`}></i>
            {bias}｜{score === null ? label : `${score}/100`}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/60 text-xs font-medium">
            <img
              src={BRAND_ICON_URL}
              alt={BRAND_NAME}
              className="w-3.5 h-3.5 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            {projection.statusLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/5 bg-white/3 text-white/40 text-[10px]">
            <i className="ri-time-line text-[10px]"></i>
            {projection.identity.reportDate}
          </span>
        </div>

        {/* Main quote — big & emotional */}
        <div className="mb-5">
          <i className="ri-double-quotes-l text-white/10 text-2xl md:text-3xl mb-2 block"></i>
          <p className="text-white text-xl md:text-2xl lg:text-[26px] font-bold leading-snug tracking-tight">
            「{mainQuote}」
          </p>
        </div>

        {/* Consistency bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-white/40 text-[10px] uppercase tracking-wider">劇本成立度</span>
            <span className={`text-xs font-bold ${bias.includes('偏多') ? 'text-forest-400' : bias.includes('偏空') ? 'text-red-400' : 'text-amber-400'}`}>
              {score === null ? label : `${score}/100`}
            </span>
          </div>
          <div className="h-2 bg-navy-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${biasStyle.bar} rounded-full transition-all duration-700`}
              style={{ width: `${score ?? 0}%` }}
            ></div>
          </div>
          <p className="text-white/25 text-[10px] mt-1.5">劇本成立度代表盤前訊號一致程度，不代表漲跌保證</p>
        </div>

        {/* Tomorrow update hint */}
        <div className="flex items-center gap-2 text-white/30 text-xs">
          <i className="ri-refresh-line text-[10px]"></i>
          <span>明天 07:30 AI 會再幫你看一次市場</span>
        </div>
      </div>
    </div>
  );
}
