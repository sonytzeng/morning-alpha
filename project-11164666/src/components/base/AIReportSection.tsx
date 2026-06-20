interface AIAnalysisSection {
  sector: string;
  title?: string;
  summary?: string;
  impact?: string;
  outlook?: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentLabel: string;
  analysis: string;
  keyDrivers: string[];
}

interface AIReportSectionProps {
  data: AIAnalysisSection;
}

export default function AIReportSection({ data }: AIReportSectionProps) {
  const sentimentConfig = {
    bullish: {
      label: '偏多',
      color: 'text-forest-400 bg-forest-500/10 border-forest-500/20',
      icon: 'ri-arrow-up-line',
      dot: 'bg-forest-500',
    },
    bearish: {
      label: '偏空',
      color: 'text-red-400 bg-red-500/10 border-red-500/20',
      icon: 'ri-arrow-down-line',
      dot: 'bg-red-500',
    },
    neutral: {
      label: '震盪',
      color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
      icon: 'ri-arrow-left-right-line',
      dot: 'bg-yellow-500',
    },
  };

  const config = sentimentConfig[data.sentiment];

  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6 hover:border-surface-300 transition-colors h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${config.dot}`}></div>
          <h4 className="text-navy-900 font-bold text-sm">{data.title || data.sector}</h4>
        </div>
        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.color}`}>
          <i className={`${config.icon} text-xs`}></i>
          {data.sentimentLabel}
        </div>
      </div>

      {(data.summary || data.analysis) && (
        <p className="text-surface-700 text-sm leading-relaxed mb-4 flex-1">
          {data.summary || data.analysis}
        </p>
      )}

      {data.impact && (
        <div className="mb-3 p-3 bg-navy-50 rounded-xl border border-navy-100">
          <span className="text-navy-600 text-[11px] font-semibold block mb-1">可能影響</span>
          <p className="text-navy-800 text-xs leading-relaxed">{data.impact}</p>
        </div>
      )}

      {data.outlook && (
        <div className="mb-3 p-3 bg-surface-50 rounded-xl border border-surface-100">
          <span className="text-surface-500 text-[11px] font-semibold block mb-1">後續觀察</span>
          <p className="text-surface-700 text-xs leading-relaxed">{data.outlook}</p>
        </div>
      )}

      {data.keyDrivers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
          {data.keyDrivers.map((driver) => (
            <span
              key={driver}
              className="px-2.5 py-1 bg-surface-100 text-surface-600 text-xs rounded-md font-medium"
            >
              {driver}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}