interface AIConclusionProps {
  data: {
    verdict: string;
    layoutAdvice: string;
    riskLevel: string;
    summary: string;
    oneSentence?: string;
  };
}

export default function AIConclusionCard({ data }: AIConclusionProps) {
  const isBullish = data.verdict.includes('適合') || data.verdict.includes('積極') || data.verdict.includes('偏多');
  const isBearish = data.verdict.includes('不適合') || data.verdict.includes('避開') || data.verdict.includes('偏空') || data.verdict.includes('降低');
  const isCautious = data.verdict.includes('觀望') || data.verdict.includes('保守') || data.verdict.includes('分批');

  const verdictColor = isBullish
    ? 'bg-forest-500/10 border-forest-500/20 text-forest-400'
    : isBearish
      ? 'bg-red-500/10 border-red-500/20 text-red-400'
      : 'bg-amber-500/10 border-amber-500/20 text-amber-400';

  const verdictBg = isBullish
    ? 'bg-forest-500'
    : isBearish
      ? 'bg-red-500'
      : 'bg-amber-500';

  const verdictIcon = isBullish
    ? 'ri-arrow-up-circle-line'
    : isBearish
      ? 'ri-arrow-down-circle-line'
      : 'ri-indeterminate-circle-line';

  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-forest-500/15 rounded-lg flex items-center justify-center">
          <i className="ri-sparkling-2-line text-forest-400 text-sm"></i>
        </div>
        <h2 className="text-white font-semibold text-sm">今日 AI 懶人結論</h2>
        <span className="ml-auto text-surface-500 text-xs">3 秒看懂今天</span>
      </div>

      {/* One Sentence Summary - Big */}
      {data.oneSentence && (
        <div className="mb-5">
          <div className="bg-navy-900/60 border border-navy-700 rounded-xl p-4 md:p-5">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 ${verdictBg} rounded-full flex items-center justify-center flex-shrink-0 mt-0.5`}>
                <i className={`${verdictIcon} text-white text-lg`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-base md:text-lg leading-relaxed mb-2">
                  {data.oneSentence}
                </p>
                {data.verdict && (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${verdictColor}`}>
                    <i className={`${verdictIcon} text-xs`}></i>
                    {data.verdict}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary text */}
      {data.summary && (
        <p className="text-surface-300 text-sm leading-relaxed mb-5">
          {data.summary}
        </p>
      )}

      {/* 3 detail cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-navy-900/60 border border-navy-700 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <i className="ri-funds-line text-forest-400 text-xs"></i>
            <span className="text-surface-400 text-xs">今天適合布局嗎</span>
          </div>
          <p className="text-white font-semibold text-sm">{data.verdict || '觀望'}</p>
        </div>

        <div className="bg-navy-900/60 border border-navy-700 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <i className="ri-scales-3-line text-surface-300 text-xs"></i>
            <span className="text-surface-400 text-xs">保守還是積極</span>
          </div>
          <p className="text-white font-semibold text-sm">{data.layoutAdvice || '保守觀察'}</p>
        </div>

        <div className="bg-navy-900/60 border border-navy-700 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <i className="ri-error-warning-line text-red-400 text-xs"></i>
            <span className="text-surface-400 text-xs">有風險嗎</span>
          </div>
          <p className="text-white font-semibold text-sm">{data.riskLevel || '風險可控'}</p>
        </div>
      </div>
    </div>
  );
}