import type { OpportunityItem } from '@/services/dailyReportService';

interface Props {
  items: OpportunityItem[];
}

export default function OpportunityFocusCard({ items }: Props) {
  if (!items || items.length === 0) return null;

  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 bg-forest-50 rounded-lg flex items-center justify-center">
          <i className="ri-focus-3-line text-forest-500 text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">今日可觀察方向</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item, idx) => (
          <div key={idx} className="bg-surface-50 border border-surface-100 rounded-xl p-4 hover:border-surface-200 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-arrow-right-circle-line text-forest-400 text-sm"></i>
              <span className="text-navy-800 font-semibold text-sm">{item.area}</span>
            </div>
            {item.reason && <p className="text-surface-500 text-xs leading-relaxed">{item.reason}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}