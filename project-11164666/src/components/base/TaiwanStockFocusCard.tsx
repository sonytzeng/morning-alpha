import type { TaiwanStockFocusItem } from '@/services/dailyReportService';

interface Props {
  items: TaiwanStockFocusItem[];
}

export default function TaiwanStockFocusCard({ items }: Props) {
  if (!items || items.length === 0) return null;

  const dirColor = (dir: string) => {
    const d = dir.toLowerCase();
    if (d.includes('多') || d.includes('漲') || d.includes('強') || d.includes('積極')) {
      return 'text-forest-600 bg-forest-100 border-forest-200';
    }
    if (d.includes('空') || d.includes('跌') || d.includes('弱') || d.includes('避開')) {
      return 'text-red-600 bg-red-100 border-red-200';
    }
    return 'text-surface-600 bg-surface-100 border-surface-200';
  };

  return (
    <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 bg-navy-50 rounded-lg flex items-center justify-center">
          <i className="ri-building-2-line text-navy-600 text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">台股重點族群</h2>
      </div>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-start gap-3 p-3 bg-surface-50 rounded-xl">
            <span className={`px-2 py-0.5 text-[11px] font-bold rounded-md border ${dirColor(item.direction)} whitespace-nowrap flex-shrink-0`}>
              {item.direction}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-navy-800 font-medium text-sm mb-0.5">{item.group}</p>
              {item.reason && <p className="text-surface-500 text-xs leading-relaxed">{item.reason}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}