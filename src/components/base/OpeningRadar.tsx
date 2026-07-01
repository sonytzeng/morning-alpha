import { useEffect, useState } from 'react';
import { getTodayOpeningRadar, type OpeningRadar as OpeningRadarData } from '@/services/openingRadarService';
import { trackEvent } from '@/utils/analytics';

interface Props {
  variant?: 'compact' | 'full';
  intradayCheck?: OpeningRadarData | null;
}

function statusLabel(status: string | null): string {
  if (!status) return '資料更新中';
  switch (status) {
    case '劇本成立':
      return '開盤驗證通過';
    case '明顯偏弱':
      return '開盤弱化';
    case '盤中轉弱':
      return '開盤弱化';
    case '資料不足':
      return '開盤資料不足';
    case '反彈驗證中':
      return '反彈驗證中';
    case '劇本初步成立':
      return '劇本初步成立';
    default:
      return status || '觀察中';
  }
}

function statusStyle(status: string | null) {
  if (!status) {
    return {
      badge: 'bg-white/5 border-white/10 text-white/40',
      dot: 'bg-white/30',
      border: 'border-navy-800',
      bg: 'bg-navy-900/60',
    };
  }
  if (status === '劇本成立' || status === '劇本初步成立') {
    return {
      badge: 'bg-forest-500/15 border-forest-500/30 text-forest-400',
      dot: 'bg-forest-400',
      border: 'border-forest-500/20',
      bg: 'bg-forest-500/[0.04]',
    };
  }
  if (status === '明顯偏弱' || status === '盤中轉弱') {
    return {
      badge: 'bg-red-500/15 border-red-500/30 text-red-400',
      dot: 'bg-red-400',
      border: 'border-red-500/20',
      bg: 'bg-red-500/[0.04]',
    };
  }
  if (status === '反彈驗證中') {
    return {
      badge: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
      dot: 'bg-amber-400',
      border: 'border-amber-500/20',
      bg: 'bg-amber-500/[0.04]',
    };
  }
  if (status === '資料不足') {
    return {
      badge: 'bg-white/5 border-white/10 text-white/40',
      dot: 'bg-white/30',
      border: 'border-white/10',
      bg: 'bg-white/[0.02]',
    };
  }
  return {
    badge: 'bg-white/5 border-white/10 text-white/40',
    dot: 'bg-white/30',
    border: 'border-navy-800',
    bg: 'bg-navy-900/60',
  };
}

function scenarioLabel(result: string | null): string {
  if (!result) return '等待確認';
  if (result.includes('資料不足') || result.includes('權值股偏弱') || result.includes('權值股偏強')) {
    return result;
  }
  return result;
}

function scenarioStyle(result: string | null) {
  if (!result) {
    return { text: 'text-white/40', bg: 'bg-white/5' };
  }
  if (result.includes('失效')) {
    return { text: 'text-red-400', bg: 'bg-red-500/10' };
  }
  if (result.includes('上修') || result.includes('成立')) {
    return { text: 'text-forest-400', bg: 'bg-forest-500/10' };
  }
  if (result.includes('反轉')) {
    return { text: 'text-amber-400', bg: 'bg-amber-500/10' };
  }
  if (result.includes('資料不足') || result.includes('權值股偏弱') || result.includes('權值股偏強')) {
    return { text: 'text-white/40', bg: 'bg-white/5' };
  }
  return { text: 'text-white/60', bg: 'bg-white/5' };
}

function formatChange(val: number | null): string {
  if (val === null || val === undefined) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function changeColor(val: number | null): string {
  if (val === null || val === undefined) return 'text-white/30';
  if (val > 0) return 'text-forest-400';
  if (val < 0) return 'text-red-400';
  return 'text-white/40';
}

function dataWarningBanner() {
  return (
    <div className="mb-4 p-3 md:p-4 rounded-xl bg-amber-500/[0.04] border border-amber-500/15">
      <div className="flex items-start gap-2">
        <div className="w-4 h-4 flex items-center justify-center mt-0.5 flex-shrink-0">
          <i className="ri-alert-line text-amber-400 text-xs"></i>
        </div>
        <p className="text-amber-300/70 text-sm leading-relaxed">
          目前尚未取得台股大盤或台指期資料，僅顯示部分權值股訊號，暫不判定劇本成立或失效。
        </p>
      </div>
    </div>
  );
}

function compactView(check: OpeningRadarData) {
  const style = statusStyle(check.radar_status);
  const statusText = check.radar_status || '觀察中';
  const isUnknown = check.radar_status === '資料不足';
  const isWeak = check.radar_status === '明顯偏弱' || check.radar_status === '盤中轉弱';

  // Format time from updated_at (preferred) or created_at
  const displayTime = check.updated_at
    ? new Date(check.updated_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
    : check.created_at
    ? new Date(check.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} p-4 md:p-5`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${style.dot} animate-pulse`}></div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${style.badge}`}>
            {statusText}
          </span>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isWeak ? 'bg-red-500/10 text-red-400' : isUnknown ? 'bg-white/5 text-white/40' : 'bg-forest-500/10 text-forest-400'}`}>
          {isWeak ? '盤前劇本失準' : '開盤驗證通過'}
        </span>
      </div>

      <p className="text-white/70 text-sm leading-relaxed mb-3">
        {check.summary || '開盤雷達更新中...'}
      </p>

      {isUnknown && dataWarningBanner()}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-white/25 text-[10px] uppercase tracking-wider">台股</p>
            <p className={`text-sm font-semibold ${changeColor(check.taiex_change ?? null)}`}>
              {formatChange(check.taiex_change ?? null)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-white/25 text-[10px] uppercase tracking-wider">台指期</p>
            <p className={`text-sm font-semibold ${changeColor(check.txf_change ?? null)}`}>
              {formatChange(check.txf_change ?? null)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-white/25 text-[10px] uppercase tracking-wider">台積電</p>
            <p className={`text-sm font-semibold ${changeColor(check.tsmc_change ?? null)}`}>
              {formatChange(check.tsmc_change ?? null)}
            </p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-white/25 text-[10px] uppercase tracking-wider">更新時間</p>
          <p className="text-white/40 text-xs">{displayTime}</p>
        </div>
      </div>
    </div>
  );
}

function emptyView() {
  return (
    <div className="rounded-2xl border border-navy-800 bg-navy-900/60 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse"></div>
        <span className="text-white/30 text-xs font-medium px-2.5 py-1 rounded-full border border-white/10 bg-white/5">
          等待更新
        </span>
      </div>
      <p className="text-white/50 text-sm leading-relaxed">
        開盤雷達將於 09:30 更新，用來確認盤前劇本是否被市場驗證。
      </p>
      <div className="mt-3 flex items-center gap-1.5 text-white/20 text-xs">
        <i className="ri-time-line text-[10px]"></i>
        <span>預計更新時間：09:30</span>
      </div>
    </div>
  );
}

function fullView(check: OpeningRadarData) {
  const style = statusStyle(check.radar_status);
  const statusText = check.radar_status || '觀察中';
  const isUnknown = check.radar_status === '資料不足';
  const isWeak = check.radar_status === '明顯偏弱' || check.radar_status === '盤中轉弱';
  const isConfirmed = check.radar_status === '劇本成立';

  // Format time from updated_at (preferred) or created_at
  const displayTime = check.updated_at
    ? new Date(check.updated_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
    : check.created_at
    ? new Date(check.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  return (
    <div className={`rounded-2xl border ${style.border} ${style.bg} p-5 md:p-6`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-5">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${style.dot} animate-pulse`}></div>
          <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${style.badge}`}>
            {statusText}
          </span>
        </div>
        <div className="hidden sm:block w-px h-6 bg-white/10"></div>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${isWeak ? 'bg-red-500/10 text-red-400' : isConfirmed ? 'bg-forest-500/10 text-forest-400' : isUnknown ? 'bg-white/5 text-white/40' : 'bg-amber-500/10 text-amber-400'}`}>
          {isWeak ? '盤前劇本失準 · 開盤驗證失敗' : isConfirmed ? '盤前劇本成立 · 開盤驗證通過' : statusText}
        </span>
      </div>

      {/* Data Warning */}
      {isUnknown && dataWarningBanner()}

      {/* Data Grid */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-5">
        <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台股變化</p>
          <p className={`text-base md:text-lg font-bold ${changeColor(check.taiex_change ?? null)}`}>
            {formatChange(check.taiex_change ?? null)}
          </p>
        </div>
        <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台指變化</p>
          <p className={`text-base md:text-lg font-bold ${changeColor(check.txf_change ?? null)}`}>
            {formatChange(check.txf_change ?? null)}
          </p>
        </div>
        <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台積電變化</p>
          <p className={`text-base md:text-lg font-bold ${changeColor(check.tsmc_change ?? null)}`}>
            {formatChange(check.tsmc_change ?? null)}
          </p>
        </div>
      </div>

      {/* AI Summary */}
      <div className="mb-4 p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
        <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">AI 校正</p>
        <p className="text-white/80 text-sm leading-relaxed font-medium">
          {check.summary || '開盤雷達更新中...'}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <div className="flex items-center gap-1.5 text-white/20 text-xs">
          <i className="ri-time-line text-[10px]"></i>
          <span>更新時間 {displayTime}</span>
        </div>
        <button
          onClick={() => {
            trackEvent('refresh_opening_radar', { location: 'report_today' });
            window.location.reload();
          }}
          className="inline-flex items-center gap-1.5 text-white/30 hover:text-white/50 text-xs transition-colors"
        >
          <i className="ri-refresh-line text-[10px]"></i>
          重新整理
        </button>
      </div>
    </div>
  );
}

export default function OpeningRadar({ variant = 'compact', intradayCheck: externalCheck }: Props) {
  const [check, setCheck] = useState<OpeningRadarData | null>(externalCheck ?? null);
  const [loading, setLoading] = useState(!externalCheck);

  useEffect(() => {
    if (externalCheck !== undefined) {
      setCheck(externalCheck);
      setLoading(false);
      return;
    }

    async function load() {
      try {
        setLoading(true);
        const data = await getTodayOpeningRadar();
        setCheck(data);
      } catch (err) {
        console.error('OpeningRadar load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [externalCheck]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-navy-800 bg-navy-900/60 p-4 md:p-5 animate-pulse">
        <div className="h-3 bg-white/5 rounded w-32 mb-3"></div>
        <div className="h-4 bg-white/5 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-white/5 rounded w-1/2"></div>
      </div>
    );
  }

  if (!check) {
    return emptyView();
  }

  if (variant === 'compact') {
    return compactView(check);
  }

  return fullView(check);
}