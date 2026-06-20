import type { Report, RiskFactor, WatchSector } from '@/types/report';

interface Props {
  report: Report | null;
}

const fallbackRisks: { title: string; level: 'low' | 'medium' | 'high'; description: string }[] = [
  { title: '美元走強', level: 'medium', description: '美元偏強時資金可能回流美國，亞洲股市短線觀察。' },
  { title: '美債殖利率上升', level: 'medium', description: '借錢成本變高，對科技股估值有壓力。' },
  { title: '短線漲多', level: 'low', description: '如果前幾天漲太多，今天可能獲利了結賣壓。' },
  { title: '國際油價波動', level: 'low', description: '油價影響運輸與製造成本，也牽動通膨預期。' },
];

const fallbackSectors: { sector: string; direction: string; reason: string }[] = [
  { sector: 'ETF', direction: '觀察', reason: '適合新手了解大盤方向，波動相對較小。' },
  { sector: 'AI / 半導體', direction: '觀察', reason: '趨勢相關性高，但波動也大，建議先觀察。' },
  { sector: '金融', direction: '中性', reason: '較穩定的族群，適合保守型投資人了解。' },
  { sector: '電子', direction: '觀察', reason: '與大盤連動強，適合趨勢明確時列入觀察。' },
];

const levelConfig: Record<string, { label: string; color: string; badge: string }> = {
  low: { label: '低', color: 'text-forest-600', badge: 'bg-forest-100 border-forest-200' },
  medium: { label: '中', color: 'text-amber-600', badge: 'bg-amber-100 border-amber-200' },
  high: { label: '高', color: 'text-red-600', badge: 'bg-red-100 border-red-200' },
};

const directionStyle = (direction: string) => {
  if (direction.includes('偏多') || direction.includes('漲') || direction.includes('多')) {
    return { dot: 'bg-forest-500', text: 'text-forest-700', bg: 'bg-forest-50' };
  }
  if (direction.includes('偏空') || direction.includes('跌') || direction.includes('空')) {
    return { dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' };
  }
  return { dot: 'bg-surface-400', text: 'text-surface-600', bg: 'bg-surface-50' };
};

export default function RiskObservationSection({ report }: Props) {
  if (!report) return null;

  const risks: RiskFactor[] = report.risk_factors_json?.length ? report.risk_factors_json : fallbackRisks;
  const sectors: WatchSector[] = report.watch_sectors_json?.length ? report.watch_sectors_json : fallbackSectors;

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Risk & Opportunity</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今日風險與觀察重點</h2>
        <p className="text-surface-500 text-sm mt-1">風險不是壞事，知道風險在哪裡才能保護自己</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        {/* 左欄：風險 */}
        <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center">
              <i className="ri-alert-line text-red-500 text-sm"></i>
            </div>
            <h3 className="text-navy-900 font-semibold text-sm">今天要注意的風險</h3>
          </div>
          <div className="space-y-3">
            {risks.slice(0, 5).map((f, idx) => {
              const cfg = levelConfig[f.level] || levelConfig.medium;
              return (
                <div key={`risk-${idx}`} className="flex items-start gap-3 p-3 bg-surface-50 rounded-xl">
                  <span className={`px-2 py-0.5 text-[11px] font-bold rounded-md border ${cfg.badge} whitespace-nowrap flex-shrink-0 mt-0.5`}>
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

        {/* 右欄：觀察方向 */}
        <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 bg-forest-50 rounded-lg flex items-center justify-center">
              <i className="ri-eye-line text-forest-500 text-sm"></i>
            </div>
            <h3 className="text-navy-900 font-semibold text-sm">今天可以觀察的方向</h3>
          </div>
          <div className="space-y-3">
            {sectors.slice(0, 5).map((s, idx) => {
              const style = directionStyle(s.direction);
              return (
                <div key={`sector-${idx}`} className={`flex items-start gap-3 p-3 rounded-xl ${style.bg}`}>
                  <span className={`w-2 h-2 rounded-full ${style.dot} flex-shrink-0 mt-1.5`}></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-navy-800 font-medium text-sm">{s.sector}</span>
                      <span className={`text-xs font-medium ${style.text}`}>{s.direction}</span>
                    </div>
                    {s.reason && (
                      <p className="text-surface-500 text-xs leading-relaxed">{s.reason}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}