import type { GlobalEvent } from '@/types/report';

interface Props {
  globalEvents: GlobalEvent[] | null;
}

const fallbackEvents: GlobalEvent[] = [
  {
    source: '全球市場',
    event: '今日全球市場訊號正常，沒有重大事件影響台股開盤。',
    taiwanImpact: '台股可能由技術面與內資情緒主導，建議觀察大盤量能。',
    beginnerTip: '沒有重大消息的日子，盤面通常較平穩，適合觀察趨勢方向。',
  },
];

export default function ImpactFlowCard({ globalEvents }: Props) {
  const events = globalEvents?.length ? globalEvents : fallbackEvents;

  // Deduplicate and limit to 6
  const seen = new Set<string>();
  const unique = events.filter((item) => {
    const key = `${item.relatedSector || 'general'}-${item.event?.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Impact Map</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">全球事件 → 台股影響</h2>
        <p className="text-surface-500 text-sm mt-1">世界上發生的事，怎麼影響你手上的股票？</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {unique.map((item, idx) => (
          <div key={`impact-${idx}`} className="bg-white border border-surface-200 rounded-xl p-4 md:p-5 hover:border-surface-300 transition-colors">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-navy-900 font-semibold text-sm">{item.source}</span>
              {item.relatedSector && (
                <span className="px-2 py-0.5 bg-surface-100 text-surface-500 text-[10px] rounded-md font-medium whitespace-nowrap">
                  {item.relatedSector}
                </span>
              )}
            </div>
            <p className="text-navy-800 text-sm leading-relaxed mb-3">{item.event}</p>
            <div className="border-t border-surface-100 pt-3 space-y-2">
              <p className="text-surface-600 text-xs leading-relaxed">
                <span className="text-forest-600 font-medium">影響台股：</span>
                {item.taiwanImpact}
              </p>
              <p className="text-surface-500 text-xs leading-relaxed">
                <span className="text-amber-600 font-medium">新手提醒：</span>
                {item.beginnerTip}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}