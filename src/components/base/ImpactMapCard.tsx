interface ImpactMapItem {
  id: string;
  source: string;
  event: string;
  taiwanImpact: string;
  beginnerTip: string;
  relatedSector?: string;
}

interface ImpactMapCardProps {
  items: ImpactMapItem[];
}

export default function ImpactMapCard({ items }: ImpactMapCardProps) {
  if (!items || items.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-route-line text-white text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">全球事件 → 台股影響地圖</h2>
        <span className="ml-auto text-surface-400 text-xs">事件傳導鏈</span>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="bg-white border border-surface-200 rounded-xl p-4 md:p-5 hover:border-surface-300 transition-colors">
            {/* Step 1: Event */}
            <div className="flex items-start gap-3 mb-3">
              <div className="w-7 h-7 bg-navy-800 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-global-line text-white text-xs"></i>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-navy-900 font-semibold text-xs">{item.source}</span>
                  {item.relatedSector && (
                    <span className="px-1.5 py-0.5 bg-surface-100 text-surface-500 text-[10px] rounded-md whitespace-nowrap">
                      {item.relatedSector}
                    </span>
                  )}
                </div>
                <p className="text-surface-600 text-sm leading-relaxed">{item.event}</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center gap-2 ml-3.5 mb-3">
              <div className="w-px h-6 bg-surface-200"></div>
              <div className="flex items-center gap-1 text-surface-400 text-xs">
                <i className="ri-arrow-down-line"></i>
                <span className="text-surface-500 font-medium">對台股可能影響</span>
              </div>
            </div>

            {/* Step 2: Taiwan Impact */}
            <div className="flex items-start gap-3 mb-3 ml-3.5">
              <div className="w-7 h-7 bg-forest-600 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-map-pin-line text-white text-xs"></i>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-navy-800 text-sm leading-relaxed font-medium">{item.taiwanImpact}</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center gap-2 ml-3.5 mb-3">
              <div className="w-px h-6 bg-surface-200"></div>
              <div className="flex items-center gap-1 text-surface-400 text-xs">
                <i className="ri-arrow-down-line"></i>
                <span className="text-surface-500 font-medium">新手怎麼看</span>
              </div>
            </div>

            {/* Step 3: Beginner Tip */}
            <div className="flex items-start gap-3 ml-3.5">
              <div className="w-7 h-7 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-user-smile-line text-white text-xs"></i>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-surface-600 text-sm leading-relaxed">{item.beginnerTip}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}