import { useState, useEffect } from 'react';
import { getLatestReports } from '@/services/reportService';
import type { Report } from '@/types/report';

type DeviationStatus = 'stable' | 'shifting' | 'invalidated';

interface DeviationState {
  status: DeviationStatus;
  title: string;
  description: string;
  conditions: string[];
  lastCheck: string;
}

function deriveDeviationStatus(report: Report | null): DeviationState {
  if (!report) {
    return {
      status: 'stable',
      title: '尚未偏移',
      description: '目前市場仍接近早上的主情境，但 10:30 前仍要確認主流族群是否延續。',
      conditions: [
        '電子權值股仍維持強勢',
        '主流熱區沒有快速退潮',
        '成交量維持正常水準',
      ],
      lastCheck: '07:30',
    };
  }

  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;

  // 根據劇本成立度和 bias 推斷偏移狀態
  let status: DeviationStatus = 'stable';
  if (score < 35) {
    status = 'invalidated';
  } else if (score < 55) {
    status = 'shifting';
  }

  const titleMap: Record<DeviationStatus, string> = {
    stable: '尚未偏移',
    shifting: '可能偏移',
    invalidated: '劇本失效',
  };

  const descMap: Record<DeviationStatus, string> = {
    stable: '目前市場仍接近早上的主情境，但 10:30 前仍要確認主流族群是否延續。',
    shifting: '市場開始出現與早上劇本不一致的訊號，先不要用盤前情緒追價。',
    invalidated: '早上的主情境已經開始失效，現在重點不是猜低點，而是先停止用舊劇本判斷。',
  };

  const conditions: string[] = [];
  if (bias.includes('偏多')) {
    conditions.push('電子權值股是否續強');
    conditions.push('主流熱區是否延續');
    conditions.push('10:30 前量能是否放大');
  } else if (bias.includes('偏空')) {
    conditions.push('避險族群是否有資金進駐');
    conditions.push('恐慌情緒是否擴散');
    conditions.push('指數是否持續下跌');
  } else {
    conditions.push('主流族群方向是否明確');
    conditions.push('輪動速度是否過快');
    conditions.push('成交量是否萎縮');
  }

  return {
    status,
    title: titleMap[status],
    description: descMap[status],
    conditions,
    lastCheck: '07:30',
  };
}

function statusStyle(status: DeviationStatus) {
  switch (status) {
    case 'stable':
      return {
        border: 'border-forest-500/20',
        bg: 'bg-forest-500/[0.04]',
        badge: 'bg-forest-500/10 border-forest-500/20 text-forest-400',
        dot: 'bg-forest-400',
        icon: 'ri-check-line',
        iconColor: 'text-forest-400',
        iconBg: 'bg-forest-500/10',
        title: 'text-forest-400',
      };
    case 'shifting':
      return {
        border: 'border-amber-500/20',
        bg: 'bg-amber-500/[0.04]',
        badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
        dot: 'bg-amber-400',
        icon: 'ri-alert-line',
        iconColor: 'text-amber-400',
        iconBg: 'bg-amber-500/10',
        title: 'text-amber-400',
      };
    case 'invalidated':
      return {
        border: 'border-red-500/20',
        bg: 'bg-red-500/[0.04]',
        badge: 'bg-red-500/10 border-red-500/20 text-red-400',
        dot: 'bg-red-400',
        icon: 'ri-close-circle-line',
        iconColor: 'text-red-400',
        iconBg: 'bg-red-500/10',
        title: 'text-red-400',
      };
  }
}

export default function MarketDeviationAlert() {
  const [state, setState] = useState<DeviationState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const reports = await getLatestReports(1);
        setState(deriveDeviationStatus(reports[0] || null));
      } catch {
        setState(deriveDeviationStatus(null));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <section className="w-full">
        <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6 animate-pulse">
          <div className="h-4 bg-white/5 rounded w-1/3 mb-4"></div>
          <div className="h-3 bg-white/5 rounded w-2/3 mb-2"></div>
          <div className="h-3 bg-white/5 rounded w-1/2"></div>
        </div>
      </section>
    );
  }

  if (!state) return null;

  const style = statusStyle(state.status);
  const currentTime = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">DEVIATION ALERT</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] font-medium rounded-full border border-red-500/20">
            <i className="ri-radar-line animate-data-pulse"></i>
            偏移監測
          </span>
        </div>
        <h2 className="text-white font-bold text-xl md:text-2xl">市場偏移警報</h2>
        <p className="text-white/40 text-sm mt-1">讓你知道目前市場有沒有偏離早上的劇本。</p>
      </div>

      <div className={`bg-navy-900/60 border rounded-2xl overflow-hidden ${style.border}`}>
        {/* 狀態列 */}
        <div className={`px-5 md:px-6 py-4 md:py-5 border-b ${style.border} ${style.bg}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 ${style.iconBg} rounded-xl flex items-center justify-center border ${style.border} flex-shrink-0`}>
              <i className={`${style.icon} ${style.iconColor} text-sm`}></i>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <div className={`w-2 h-2 rounded-full ${style.dot} animate-live-pulse`}></div>
                <span className={`text-sm font-bold ${style.title}`}>{state.title}</span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${style.badge} font-medium`}>
                {state.status === 'stable' ? '盤前情境維持' : state.status === 'shifting' ? '需要留意' : '建議修正'}
              </span>
            </div>
          </div>
          <p className="text-white/70 text-sm leading-relaxed">{state.description}</p>
        </div>

        {/* 檢查條件 */}
        <div className="px-5 md:px-6 py-4 md:py-5">
          <p className="text-white/40 text-[10px] uppercase tracking-wider mb-3">盤中檢查條件</p>
          <div className="space-y-2">
            {state.conditions.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-5 h-5 bg-navy-800 rounded-md flex items-center justify-center flex-shrink-0">
                  <span className="text-white/30 text-[10px] font-bold">{idx + 1}</span>
                </div>
                <p className="text-white/60 text-sm">{cond}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 底部提示 */}
        <div className="px-5 md:px-6 py-3 bg-navy-950/50 border-t border-navy-800">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-data-pulse"></div>
            <p className="text-white/30 text-xs">
              盤中校正功能規劃中。現在先以 07:30 盤前劇本與失效條件作為檢查依據。
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-white/20 text-[10px]">
            <i className="ri-time-line"></i>
            <span className="font-mono">最後檢查：{currentTime}</span>
          </div>
        </div>
      </div>
    </section>
  );
}