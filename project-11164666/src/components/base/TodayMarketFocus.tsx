import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

function getFocusData(report: Report | null): {
  group: string;
  why: string;
  confirm: string;
  mistake: string;
} {
  // 優先使用 watch_sectors_detailed
  const detailed = report?.watch_sectors_detailed;
  if (detailed && detailed.length > 0) {
    const top = detailed[0];
    const bias = report?.market_bias || '震盪';
    return {
      group: top.sector,
      why:
        bias.includes('偏多')
          ? '市場情緒偏多時，資金容易先往高關注族群集中。'
          : bias.includes('偏空')
            ? '市場偏弱時，部分族群反而出現資金避險的現象。'
            : '市場沒有明確方向時，某些族群會因為短期事件而輪動。',
      confirm: '不要只看第一波上漲，要看 10:30 前主流族群是否仍有延續。',
      mistake: '看到熱門股一開高就急著追，結果買在情緒最滿的位置。',
    };
  }

  // fallback 用 watch_sectors_json
  const sectors = report?.watch_sectors_json;
  if (sectors && sectors.length > 0) {
    const top = sectors[0];
    return {
      group: top.sector,
      why: top.reason || '市場資金有聚集跡象，值得開盤後觀察延續性。',
      confirm: '不要只看第一波上漲，要看 10:30 前主流族群是否仍有延續。',
      mistake: '看到熱門股一開高就急著追，結果買在情緒最滿的位置。',
    };
  }

  // 用 market_bias 推斷
  const bias = report?.market_bias || '震盪';
  if (bias.includes('偏多')) {
    return {
      group: 'AI / 半導體',
      why: '市場情緒偏多時，資金容易先往高關注族群集中。',
      confirm: '不要只看第一波上漲，要看 10:30 前主流族群是否仍有延續。',
      mistake: '看到熱門股一開高就急著追，結果買在情緒最滿的位置。',
    };
  }
  if (bias.includes('偏空')) {
    return {
      group: '防禦型族群',
      why: '市場偏弱時，資金會尋找避風港與相對抗跌標的。',
      confirm: '觀察避險族群是否持續吸金，還是只是短暫輪動。',
      mistake: '看到防禦族群漲就以為安全，結果買在輪動尾端。',
    };
  }

  return {
    group: '主流族群',
    why: '市場方向不明，但輪動快速時，先觀察資金集中方向比亂操作重要。',
    confirm: '開盤後 30 分鐘確認族群延續性，不要看第一根就決定。',
    mistake: '今天沒有明確方向，最容易犯的錯是硬找機會進場。',
  };
}

export default function TodayMarketFocus({ report }: Props) {
  const data = getFocusData(report);

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold mb-1">MARKET FOCUS</p>
        <h2 className="text-white font-bold text-base md:text-lg">今天市場焦點</h2>
        <p className="text-white/40 text-sm mt-1">今天不是要追哪一檔，而是先看資金往哪裡集中。</p>
      </div>

      <div className="bg-navy-900/60 border border-navy-800 rounded-2xl overflow-hidden">
        {/* 主要觀察族群 */}
        <div className="p-5 md:p-6 border-b border-navy-800">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-forest-500/10 rounded-lg flex items-center justify-center border border-forest-500/20">
              <i className="ri-focus-3-line text-forest-400 text-sm"></i>
            </div>
            <span className="text-white/60 text-xs font-medium">主要觀察族群</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-white font-bold text-lg md:text-xl">{data.group}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 border border-forest-500/20 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-forest-400"></div>
              <span className="text-forest-400 text-[10px] font-medium">觀察中</span>
            </span>
          </div>
          <p className="text-white/50 text-sm leading-relaxed">{data.why}</p>
        </div>

        {/* 為什麼今天值得看 + 開盤後要確認什麼 */}
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="p-5 md:p-6 border-b md:border-b-0 md:border-r border-navy-800">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-amber-500/10 rounded-lg flex items-center justify-center border border-amber-500/20">
                <i className="ri-eye-line text-amber-400 text-xs"></i>
              </div>
              <span className="text-white/60 text-xs font-medium">開盤後要確認什麼</span>
            </div>
            <p className="text-white/70 text-sm leading-relaxed">{data.confirm}</p>
          </div>

          <div className="p-5 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
                <i className="ri-alert-line text-red-400 text-xs"></i>
              </div>
              <span className="text-white/60 text-xs font-medium">今天最容易犯的錯</span>
            </div>
            <p className="text-white/70 text-sm leading-relaxed">{data.mistake}</p>
          </div>
        </div>
      </div>
    </section>
  );
}