interface MarketIndexCardProps {
  data: {
    name: string;
    symbol: string;
    value: string;
    change: string;
    changePercent: string;
    status: 'up' | 'down' | 'flat';
    impactOnTaiwan: string;
  };
}

export default function MarketIndexCard({ data }: MarketIndexCardProps) {
  const statusColor = data.status === 'up'
    ? 'text-forest-400'
    : data.status === 'down'
      ? 'text-red-400'
      : 'text-surface-400';

  const statusBg = data.status === 'up'
    ? 'bg-forest-500/10'
    : data.status === 'down'
      ? 'bg-red-500/10'
      : 'bg-surface-500/10';

  const statusIcon = data.status === 'up'
    ? 'ri-arrow-up-line'
    : data.status === 'down'
      ? 'ri-arrow-down-line'
      : 'ri-subtract-line';

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-4 min-w-[200px] md:min-w-0 flex-shrink-0 md:flex-shrink">
      <div className="flex items-center justify-between mb-2">
        <span className="text-surface-700 font-semibold text-sm">{data.name}</span>
        <span className="text-surface-400 text-xs font-mono">{data.symbol}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-navy-900 font-bold text-lg">{data.value}</span>
        <div className={`flex items-center gap-0.5 px-2 py-0.5 rounded-md ${statusBg}`}>
          <i className={`${statusIcon} ${statusColor} text-xs`}></i>
          <span className={`text-sm font-semibold ${statusColor}`}>{data.changePercent}</span>
        </div>
      </div>
      <p className="text-surface-500 text-xs leading-relaxed">{data.impactOnTaiwan}</p>
    </div>
  );
}