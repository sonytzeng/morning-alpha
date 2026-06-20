import MarketStatusLight from '@/components/base/MarketStatusLight';
import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

export default function MorningRitual({ report }: Props) {
  const updateTime = report?.created_at
    ? new Date(report.created_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '07:30';

  const bias = report?.market_bias || '震盪';
  const score = report?.confidence_score ?? 50;

  const todayObservation = () => {
    if (bias.includes('偏多') && score >= 75) return 'AI 注意到市場情緒偏熱，今天會持續觀察是否有人追過頭。';
    if (bias.includes('偏多')) return 'AI 看到市場有方向，但還在觀察動能是否足夠。';
    if (bias.includes('偏空') && score <= 40) return 'AI 偵測到市場壓力較大，正在觀察恐慌是否過度。';
    if (bias.includes('偏空')) return 'AI 注意到市場偏弱，但情緒還沒有到恐慌的程度。';
    return 'AI 還在觀察市場方向，目前沒有明確訊號。';
  };

  return (
    <section className="w-full">
      <div className="bg-navy-900 rounded-2xl overflow-hidden">
        <div className="relative p-4 md:p-6">
          {/* Subtle glow behind */}
          <div className="absolute top-0 right-0 w-48 md:w-64 h-48 md:h-64 bg-forest-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4"></div>

          <div className="relative">
            {/* Header row */}
            <div className="flex items-center justify-between mb-4 md:mb-5 flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 md:w-8 md:h-8 bg-forest-500/15 rounded-lg flex items-center justify-center">
                  <i className="ri-sun-line text-forest-400 text-sm animate-breathing-slow"></i>
                </div>
                <div>
                  <p className="text-white text-xs md:text-sm font-semibold">AI 已於 {updateTime} 完成市場觀察</p>
                  <p className="text-surface-500 text-[10px] md:text-xs">下次觀察時間：明天 07:30</p>
                </div>
              </div>
              <MarketStatusLight compact />
            </div>

            {/* Status cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
              <div className="bg-navy-800/60 rounded-xl p-3 md:p-4 border border-navy-700/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${bias.includes('偏多') ? 'bg-forest-400' : bias.includes('偏空') ? 'bg-red-400' : 'bg-amber-400'}`}></div>
                  <span className="text-surface-400 text-[10px] uppercase tracking-wider font-semibold">今日狀態</span>
                </div>
                <p className="text-white text-sm font-medium">
                  {bias.includes('偏多') ? '市場偏多' : bias.includes('偏空') ? '市場偏空' : '市場震盪'}
                </p>
                <p className="text-surface-500 text-xs mt-1">AI 把握度 {score}/100</p>
              </div>

              <div className="bg-navy-800/60 rounded-xl p-3 md:p-4 border border-navy-700/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${score >= 75 ? 'bg-amber-400' : score <= 40 ? 'bg-red-400' : 'bg-forest-400'}`}></div>
                  <span className="text-surface-400 text-[10px] uppercase tracking-wider font-semibold">AI 態度</span>
                </div>
                <p className="text-white text-sm font-medium">
                  {score >= 75 ? '偏保守' : score <= 40 ? '偏謹慎' : '穩定觀察'}
                </p>
                <p className="text-surface-500 text-xs mt-1">
                  {score >= 75 ? '過熱時要更小心' : score <= 40 ? '恐慌時不躁進' : '不疾不徐'}
                </p>
              </div>

              <div className="bg-navy-800/60 rounded-xl p-3 md:p-4 border border-navy-700/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-surface-500"></div>
                  <span className="text-surface-400 text-[10px] uppercase tracking-wider font-semibold">今日觀察</span>
                </div>
                <p className="text-white text-sm font-medium leading-relaxed">
                  {todayObservation()}
                </p>
              </div>
            </div>

            {/* Breathing indicator */}
            <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-navy-800 flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full bg-forest-400 animate-breathing"
                ></div>
                <span className="text-surface-500 text-[10px]">AI 持續監控市場情緒中</span>
              </div>
              <div className="flex-1"></div>
              <span className="text-surface-600 text-[10px] hidden sm:inline">09:00 - 13:30 盤中觀察</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}