interface Props {
  style: string;
  riskHint?: string;
}

export default function ActionStyleCard({ style, riskHint }: Props) {
  if (!style || !style.trim()) return null;

  const configs: Record<string, { textColor: string; bg: string; border: string; icon: string; desc: string }> = {
    '保守觀望': {
      textColor: 'text-amber-400',
      bg: 'bg-amber-500',
      border: 'border-amber-500/30',
      icon: 'ri-eye-line',
      desc: '市場方向不明，先觀察不操作',
    },
    '小額分批': {
      textColor: 'text-yellow-400',
      bg: 'bg-yellow-500',
      border: 'border-yellow-500/30',
      icon: 'ri-split-cells-horizontal',
      desc: '不一次投入，慢慢試水溫',
    },
    '積極觀察': {
      textColor: 'text-forest-400',
      bg: 'bg-forest-500',
      border: 'border-forest-500/30',
      icon: 'ri-radar-line',
      desc: '趨勢偏強，但仍要控制風險',
    },
    '降低風險': {
      textColor: 'text-red-400',
      bg: 'bg-red-500',
      border: 'border-red-500/30',
      icon: 'ri-shield-check-line',
      desc: '市場波動加大，優先保護本金',
    },
  };

  let key = Object.keys(configs).find((k) => style.includes(k));
  if (!key) {
    if (style.includes('觀望') || style.includes('保守')) key = '保守觀望';
    else if (style.includes('分批') || style.includes('小額')) key = '小額分批';
    else if (style.includes('積極') || style.includes('偏多')) key = '積極觀察';
    else if (style.includes('降低') || style.includes('減碼') || style.includes('避開') || style.includes('風險')) key = '降低風險';
    else key = '保守觀望';
  }

  const cfg = configs[key];

  return (
    <div className="bg-navy-800 border border-navy-700 rounded-2xl p-5 md:p-6">
      <div className="flex items-center gap-2 mb-5">
        <span className="text-surface-400 text-[10px] uppercase tracking-wider font-semibold">Today Action Style</span>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-5">
        <div className={`${cfg.bg} ${cfg.border} border px-5 py-3 rounded-xl flex items-center gap-2`}>
          <i className={`${cfg.icon} text-white text-lg`}></i>
          <span className="text-white font-bold text-lg whitespace-nowrap">{style}</span>
        </div>
        <span className="text-surface-300 text-sm">{cfg.desc}</span>
      </div>

      {riskHint && (
        <div className="bg-navy-900/50 rounded-xl p-4 border border-navy-700">
          <div className="flex items-start gap-2">
            <i className="ri-error-warning-line text-amber-400 text-sm mt-0.5 flex-shrink-0"></i>
            <p className="text-surface-300 text-sm leading-relaxed">{riskHint}</p>
          </div>
        </div>
      )}
    </div>
  );
}