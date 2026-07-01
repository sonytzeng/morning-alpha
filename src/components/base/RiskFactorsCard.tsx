import type { RiskFactor } from '@/services/dailyReportService';

interface Props {
  factors: RiskFactor[];
}

export default function RiskFactorsCard({ factors }: Props) {
  if (!factors || factors.length === 0) return null;

  const levelConfig: Record<string, { label: string; color: string }> = {
    low: { label: '低', color: 'text-forest-600 bg-forest-100 border-forest-200' },
    medium: { label: '中', color: 'text-amber-600 bg-amber-100 border-amber-200' },
    high: { label: '高', color: 'text-red-600 bg-red-100 border-red-200' },
  };

  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
          <i className="ri-alert-line text-red-500 text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">今日風險因素</h2>
      </div>
      <div className="space-y-3">
        {factors.map((f, idx) => {
          const cfg = levelConfig[f.level] || levelConfig.medium;
          return (
            <div key={idx} className="flex items-start gap-3 p-3 bg-surface-50 rounded-xl">
              <span className={`px-2 py-0.5 text-[11px] font-bold rounded-md border ${cfg.color} whitespace-nowrap flex-shrink-0`}>
                {cfg.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-navy-800 font-medium text-sm mb-0.5">{f.title}</p>
                {f.description && (
                  <p className="text-surface-500 text-xs leading-relaxed">{f.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}