import { useState, useEffect } from 'react';
import { mapRowToReport } from '@/services/reportService';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import type { Report } from '@/types/report';
import type { IntradayCheck } from '@/services/intradayCheckService';
import type { MarketState } from '@/services/marketStateEngine';
import { getSubscriberReportProjection } from '@/lib/subscriberReportProjection';

export type MarketStatus = 'calm' | 'overheat' | 'panic' | 'fear' | 'watch' | 'opening_strengthened' | 'opening_weakened' | 'opening_confirmed' | 'opening_invalidated' | 'rebound_verification' | 'waiting_premarket' | 'premarket_generated' | 'after_close_pending' | 'non_trading_with_data' | 'non_trading_no_data';

interface StatusConfig {
  label: string;
  icon: string;
  color: string;
  bgClass: string;
  textClass: string;
  description: string;
}

const STATUS_MAP: Record<MarketStatus, StatusConfig> = {
  waiting_premarket: {
    label: '等待盤前',
    icon: 'ri-time-line',
    color: '#94a3b8',
    bgClass: 'bg-white/5',
    textClass: 'text-white/50',
    description: '尚未到盤前劇本產生時間，每日 07:30 自動生成。',
  },
  premarket_generated: {
    label: '盤前已生成',
    icon: 'ri-file-text-line',
    color: '#22c55e',
    bgClass: 'bg-forest-500/10',
    textClass: 'text-forest-400',
    description: '盤前劇本已產生，等待開盤驗證。',
  },
  after_close_pending: {
    label: '收盤待驗證',
    icon: 'ri-hourglass-line',
    color: '#f59e0b',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    description: '今日已收盤，等待今日收盤資料與驗證結果。',
  },
  calm: {
    label: '盤前中性',
    icon: 'ri-checkbox-circle-line',
    color: '#22c55e',
    bgClass: 'bg-forest-500/10',
    textClass: 'text-forest-400',
    description: '盤前資料平穩，等待開盤後確認。',
  },
  overheat: {
    label: '盤前偏多',
    icon: 'ri-fire-line',
    color: '#f59e0b',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    description: '盤前訊號偏多，開盤後觀察是否延續。',
  },
  panic: {
    label: '盤前偏空',
    icon: 'ri-alert-line',
    color: '#ef4444',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
    description: '盤前訊號偏空，開盤後留意是否止穩。',
  },
  fear: {
    label: '盤前偏弱',
    icon: 'ri-shield-flash-line',
    color: '#6366f1',
    bgClass: 'bg-indigo-500/10',
    textClass: 'text-indigo-400',
    description: '盤前資料偏弱，觀望為主。',
  },
  watch: {
    label: '盤前觀望',
    icon: 'ri-eye-line',
    color: '#94a3b8',
    bgClass: 'bg-white/5',
    textClass: 'text-white/50',
    description: '盤前資料尚不完整，等待開盤後確認。',
  },
  opening_strengthened: {
    label: '開盤轉強',
    icon: 'ri-arrow-up-line',
    color: '#22c55e',
    bgClass: 'bg-forest-500/10',
    textClass: 'text-forest-400',
    description: '開盤後市場轉強，盤前劇本被強化。',
  },
  opening_weakened: {
    label: '開盤轉弱',
    icon: 'ri-arrow-down-line',
    color: '#ef4444',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
    description: '開盤後市場轉弱，早盤觀察權值股是否止穩。',
  },
  opening_confirmed: {
    label: '劇本確認中',
    icon: 'ri-check-line',
    color: '#22c55e',
    bgClass: 'bg-forest-500/10',
    textClass: 'text-forest-400',
    description: '開盤後市場表態與盤前劇本一致。',
  },
  opening_invalidated: {
    label: '劇本偏移',
    icon: 'ri-alert-line',
    color: '#ef4444',
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
    description: '開盤後市場表態與盤前劇本不一致，請以開盤雷達為準。',
  },
  rebound_verification: {
    label: '反彈驗證日',
    icon: 'ri-refresh-line',
    color: '#f59e0b',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    description: '盤前劇本為反彈驗證日，開盤後確認權值股承接。',
  },
  non_trading_with_data: {
    label: '非交易日｜最近資料',
    icon: 'ri-calendar-event-line',
    color: '#94a3b8',
    bgClass: 'bg-slate-500/10',
    textClass: 'text-slate-400',
    description: '今天非交易日，顯示最近交易日資料與驗證結果。',
  },
  non_trading_no_data: {
    label: '非交易日',
    icon: 'ri-calendar-line',
    color: '#94a3b8',
    bgClass: 'bg-white/5',
    textClass: 'text-white/50',
    description: '今天非交易日，系統暫停。下一個交易日恢復。',
  },
};

function deriveStatus(report: Report | null): MarketStatus {
  const projection = getSubscriberReportProjection(report);
  if (projection.closing.state === 'NOT_APPLICABLE') return 'non_trading_no_data';
  if (!projection.analysisAvailable) return 'watch';
  if (projection.marketDecision.action === 'STOP') return 'panic';
  if (projection.marketDecision.action === 'ACT') return 'calm';
  return 'watch';
}

interface Props {
  compact?: boolean;
  report?: Report | null;
  intradayCheck?: IntradayCheck | null;
  marketState?: MarketState | null;
  displayLabelOverride?: string;
}

function useMarketStatus(report?: Report | null) {
  const [status, setStatus] = useState<MarketStatus>('watch');
  const [config, setConfig] = useState<StatusConfig>(STATUS_MAP.watch);
  const [resolvedReport, setResolvedReport] = useState<Report | null>(null);

  useEffect(() => {
    if (report) {
      const s = deriveStatus(report);
      setStatus(s);
      setConfig(STATUS_MAP[s]);
      setResolvedReport(report || null);
      return;
    }
    async function load() {
      try {
        const resolved = await resolveActiveMorningAlphaReport();
        const r = resolved.rawRow && !resolved.isHistoricalFallback
          ? mapRowToReport(resolved.rawRow as unknown as Record<string, unknown>)
          : null;
        const s = deriveStatus(r);
        setStatus(s);
        setConfig(STATUS_MAP[s]);
        setResolvedReport(r);
      } catch {
        // keep default
      }
    }
    load();
  }, [report]);

  return { status, config, resolvedReport };
}

export default function MarketStatusLight({ compact = false, report }: Props) {
  // Legacy display overrides remain source-compatible props, not authority to
  // bypass subscriber publication/evidence gates. The clock is display-only.
  const { resolvedReport } = useMarketStatus(report);
  const projection = getSubscriberReportProjection(report ?? resolvedReport);
  const currentTime = new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  const displayLabel = projection.marketDecision.label;

  // V15: Derive chip colors from actual market_bias text — NOT from engine riskTone
  // Colors per bias type: 偏多=rose, 偏空=emerald, 中性/震盪=amber, no data=slate
  const biasColor = (() => {
    const label = displayLabel || '';
    if (label.includes('偏多') || label.includes('偏強') || label.includes('強多')) return 'rose';
    if (label.includes('偏空') || label.includes('偏弱') || label.includes('強空')) return 'emerald';
    if (label.includes('震盪') || label.includes('中性') || label.includes('觀察') || label.includes('盤整')) return 'amber';
    if (label.includes('收盤') || label.includes('盤前已生成') || label.includes('盤前中性')) return 'emerald';
    if (label.includes('盤前偏多')) return 'rose';
    if (label.includes('盤前偏空') || label.includes('盤前偏弱')) return 'emerald';
    if (label.includes('開盤轉強') || label.includes('劇本確認')) return 'emerald';
    if (label.includes('開盤轉弱') || label.includes('劇本偏移')) return 'rose';
    if (label.includes('反彈')) return 'amber';
    if (label.includes('非交易日') && label.includes('最近資料')) return 'amber';
    return 'slate';
  })();

  const chipColorMap: Record<string, { color: string; bg: string; text: string; border: string; dot: string }> = {
    rose:    { color: '#fb7185', bg: 'bg-rose-500/15',   text: 'text-rose-300',   border: 'border-rose-400/35',   dot: 'bg-rose-400' },
    emerald: { color: '#34d399', bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-400/35', dot: 'bg-emerald-400' },
    amber:   { color: '#fbbf24', bg: 'bg-amber-500/15',   text: 'text-amber-300',   border: 'border-amber-400/35',   dot: 'bg-amber-400' },
    slate:   { color: '#94a3b8', bg: 'bg-slate-700/70',   text: 'text-slate-300',   border: 'border-slate-500/40',   dot: 'bg-slate-400' },
  };

  const chip = chipColorMap[biasColor] || chipColorMap.slate;
  const statusColor = chip.color;
  const statusBgClass = chip.bg;
  const statusTextClass = chip.text;

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${statusBgClass} ${chip.border}`}>
        <div className={`w-1.5 h-1.5 rounded-full animate-live-pulse ${chip.dot}`}></div>
        <span className={`text-[10px] font-semibold tracking-wide ${statusTextClass}`}>
          {displayLabel}
        </span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-navy-900/80 border border-navy-800 rounded-lg">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full animate-live-pulse ${chip.dot}`}
            style={{ boxShadow: `0 0 8px ${statusColor}40` }}
          ></div>
          <span className={`text-xs font-semibold tracking-wide ${statusTextClass}`}>
            {displayLabel}
          </span>
        </div>
        
        <div className="w-px h-4 bg-white/10"></div>
        
        <div className="flex items-center gap-1.5">
          <i className="ri-time-line text-white/30 text-[10px]"></i>
          <span className="text-white/40 text-[10px] font-mono">{currentTime}</span>
        </div>
        
        <div className="hidden sm:flex items-center gap-1.5 ml-auto">
          <i className="ri-radar-line text-white/30 text-[10px]"></i>
          <span className="text-white/30 text-[10px]">
            狀態已同步
          </span>
        </div>
      </div>
    </div>
  );
}
