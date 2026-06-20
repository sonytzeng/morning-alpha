interface NewsImpactCardProps {
  data: {
    id: string;
    title: string;
    source: string;
    publishedAt: string;
    aiImportance: number;
    affectedMarket: string;
    impactSummary: string;
    originalUrl: string;
    affectedSector?: string;
  };
  index: number;
}

export default function NewsImpactCard({ data, index }: NewsImpactCardProps) {
  const importanceColor = data.aiImportance >= 90
    ? 'text-forest-400 bg-forest-500/10 border-forest-500/20'
    : data.aiImportance >= 80
      ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
      : 'text-surface-400 bg-surface-500/10 border-surface-500/20';

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-4 md:p-5 hover:border-surface-300 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 bg-navy-800 text-white text-xs font-bold rounded-full flex items-center justify-center flex-shrink-0">
            {index + 1}
          </span>
          <span className="text-surface-500 text-xs">{data.source}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${importanceColor}`}>
          AI {data.aiImportance}
        </span>
      </div>
      <h4 className="text-navy-900 font-semibold text-sm leading-relaxed mb-3">
        {data.title}
      </h4>
      <div className="mb-3">
        <span className="text-surface-400 text-xs block mb-1">可能影響市場</span>
        <span className="text-surface-600 text-xs">{data.affectedMarket}</span>
      </div>
      <p className="text-surface-500 text-xs leading-relaxed mb-3 bg-surface-50 p-3 rounded-lg border border-surface-100">
        {data.impactSummary}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-surface-400 text-xs">{data.publishedAt}</span>
        <a
          href={data.originalUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-navy-700 hover:text-navy-900 text-xs font-medium flex items-center gap-1"
        >
          原文連結 <i className="ri-external-link-line"></i>
        </a>
      </div>
    </div>
  );
}