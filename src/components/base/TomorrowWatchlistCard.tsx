import type { TomorrowWatch } from '@/types/report';

interface Props {
  tomorrowWatch: TomorrowWatch[] | null;
}

const fallbackTomorrow: TomorrowWatch[] = [
  { name: '美股科技股走勢', reason: '美股收盤方向會影響明天台股開盤情緒，尤其是科技股。' },
  { name: '美債殖利率變化', reason: '利率高低直接影響資金成本與科技股估值，是明天盤前必看指標。' },
  { name: '台指期夜盤表現', reason: '台指期夜盤是「提前開盤的台股」，直接影響明天開盤位置。' },
  { name: '外資是否回補台股', reason: '外資動向是台股重要風向球，如果連續買超代表看好後市。' },
];

export default function TomorrowWatchlistCard({ tomorrowWatch }: Props) {
  const items = tomorrowWatch?.length ? tomorrowWatch : fallbackTomorrow;

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Tomorrow</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">明天要看什麼</h2>
        <p className="text-surface-500 text-sm mt-1">今天收盤後到明天開盤前，這些訊號會影響你的決策</p>
      </div>
      <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6">
        <div className="space-y-4">
          {items.slice(0, 6).map((item, idx) => (
            <div key={idx} className="flex items-start gap-3">
              <div className="w-7 h-7 bg-navy-800 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-[10px] font-bold">{idx + 1}</span>
              </div>
              <div>
                <p className="text-navy-800 font-medium text-sm">{item.name}</p>
                {item.reason && <p className="text-surface-500 text-xs leading-relaxed mt-1">{item.reason}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}