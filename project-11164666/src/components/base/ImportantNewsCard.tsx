import type { ImportantNewsItem } from '@/services/dailyReportService';

interface Props {
  items: ImportantNewsItem[];
}

export default function ImportantNewsCard({ items }: Props) {
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-4">
      {items.map((item, idx) => (
        <div
          key={idx}
          className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6 hover:border-surface-300 transition-colors"
        >
          <div className="flex items-start gap-3 mb-4">
            <span className="w-8 h-8 bg-navy-800 text-white text-xs font-bold rounded-lg flex items-center justify-center flex-shrink-0">
              {idx + 1}
            </span>
            <h3 className="text-navy-900 font-bold text-base md:text-lg leading-snug">{item.title}</h3>
          </div>

          <div className="bg-navy-50 border border-navy-100 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <i className="ri-lightbulb-line text-amber-500 text-xs"></i>
              <span className="text-navy-700 font-medium text-xs">為什麼這個新聞重要？</span>
            </div>
            <p className="text-navy-800 text-sm leading-relaxed">
              {item.summary || item.impact || 'AI 正在分析這則新聞對台股的影響...'}
            </p>
          </div>

          {item.sectors && item.sectors.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-surface-400 text-xs">可能影響族群：</span>
              {item.sectors.map((s) => (
                <span
                  key={s}
                  className="px-2.5 py-1 bg-surface-100 text-surface-600 text-xs rounded-md font-medium whitespace-nowrap"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}