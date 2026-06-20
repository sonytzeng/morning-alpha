import { Link } from 'react-router-dom';
import type { Report } from '@/types/report';
import { formatTaipeiTimeShort } from '@/hooks/useAccountDashboard';

interface MorningHeroCardProps {
  todayReport: Report | null;
  hasTodayReport: boolean;
  streak: number;
  isWeekend: boolean;
  hasAnyReport: boolean;
}

function getStageMessage(count: number): string | null {
  if (count >= 30) return '市場會淘汰情緒化的人，但會留下穩定的人。';
  if (count >= 14) return '真正的投資，不是每天交易，而是每天觀察。';
  if (count >= 7) return '你開始比大部分人更穩定了。';
  if (count >= 3) return '開始養成每天先觀察市場的習慣。';
  return null;
}

function getMoodClasses(bias: string | undefined) {
  if (!bias) {
    return {
      dot: 'bg-amber-400',
      glow: '',
      border: 'border-amber-500/30',
      bg: 'bg-amber-500/10',
      color: 'amber',
      textClass: 'text-amber-300',
    };
  }
  if (bias.includes('偏多')) {
    return {
      dot: 'bg-forest-400',
      glow: '',
      border: 'border-forest-500/30',
      bg: 'bg-forest-500/10',
      color: 'forest',
      textClass: 'text-forest-300',
    };
  }
  if (bias.includes('偏空')) {
    return {
      dot: 'bg-red-400',
      glow: '',
      border: 'border-red-500/30',
      bg: 'bg-red-500/10',
      color: 'red',
      textClass: 'text-red-300',
    };
  }
  return {
    dot: 'bg-amber-400',
    glow: '',
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/10',
    color: 'amber',
    textClass: 'text-amber-300',
  };
}

export default function MorningHeroCard({ todayReport, hasTodayReport, streak, isWeekend, hasAnyReport }: MorningHeroCardProps) {
  const bias = todayReport?.market_bias || '';
  const score = todayReport?.confidence_score ?? 0;
  const reportDate = todayReport?.report_date || '';
  const createdAt = todayReport?.created_at || '';
  const mood = getMoodClasses(bias);

  function getStatusBadge() {
    if (hasTodayReport) {
      return (
        <>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${mood.border} ${mood.bg} text-xs font-semibold ${mood.textClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${mood.dot} animate-pulse`}></span>
            {bias}
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-medium text-white/60">
            <i className="ri-brain-line text-amber-400 text-[10px]"></i>
            判讀把握度 {score}/100
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-forest-500/30 bg-forest-500/10 text-xs font-medium text-forest-300">
            <i className="ri-check-double-line text-forest-400 text-[10px]"></i>
            最近交易日報告已產生
          </span>
        </>
      );
    }

    if (isWeekend && hasAnyReport) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-xs font-semibold text-sky-300">
          <i className="ri-calendar-line text-sky-400 text-[10px]"></i>
          今天非交易日，顯示最近交易日資料
        </span>
      );
    }

    if (hasAnyReport) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-forest-500/30 bg-forest-500/10 text-xs font-semibold text-forest-300">
          <i className="ri-check-double-line text-forest-400 text-[10px]"></i>
          最近交易日報告已產生
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-white/30">
        <i className="ri-information-line text-white/30 text-[10px]"></i>
        尚無報告資料
      </span>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-8">
      <div className="relative">
        {/* Top badges row */}
        <div className="flex flex-wrap items-center gap-2 mb-4 md:mb-5">
          {getStatusBadge()}
        </div>

        {/* Title */}
        <h1 className="text-white font-bold text-xl md:text-2xl lg:text-3xl mb-2 leading-tight">
          Morning Alpha 觀察中心
        </h1>
        <p className="text-white/40 text-sm md:text-base mb-5 md:mb-6 max-w-xl">
          每天 07:30，AI 幫你整理今日盤前狀態、市場資料新鮮度與風險提醒。
        </p>

        {/* Info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {/* Report date & time */}
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 flex items-center justify-center">
                <i className="ri-calendar-check-line text-forest-400 text-base"></i>
              </div>
              <span className="text-white/40 text-xs font-medium">最近報告</span>
            </div>
            {hasTodayReport ? (
              <>
                <p className="text-white font-bold text-sm">{reportDate}</p>
                <p className="text-white/30 text-[11px] mt-0.5">產生時間 {formatTaipeiTimeShort(createdAt)}</p>
              </>
            ) : hasAnyReport && isWeekend ? (
              <>
                <p className="text-sky-400 text-sm font-medium">最近交易日</p>
                {reportDate && <p className="text-white/30 text-[11px] mt-0.5">{reportDate}</p>}
              </>
            ) : hasAnyReport ? (
              <p className="text-sky-400 text-sm font-medium">最近交易日資料</p>
            ) : (
              <p className="text-white/30 text-sm font-medium">尚無報告</p>
            )}
          </div>

          {/* Market bias + confidence */}
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 flex items-center justify-center">
                <i className="ri-line-chart-line text-amber-400 text-base"></i>
              </div>
              <span className="text-white/40 text-xs font-medium">盤前判斷</span>
            </div>
            {hasTodayReport ? (
              <>
                <p className={`font-bold text-sm ${mood.textClass}`}>{bias || '—'}</p>
                <p className="text-white/30 text-[11px] mt-0.5">把握度 {score}/100</p>
              </>
            ) : (
              <p className="text-amber-400 text-sm font-medium">等待生成</p>
            )}
          </div>

          {/* Next update */}
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 flex items-center justify-center">
                <i className="ri-time-line text-sky-400 text-base"></i>
              </div>
              <span className="text-white/40 text-xs font-medium">下次更新</span>
            </div>
            <p className="text-white font-bold text-sm">明日 07:30</p>
            <p className="text-white/30 text-[11px] mt-0.5">AI 盤前自動生成</p>
          </div>

          {/* Streak */}
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 flex items-center justify-center">
                <i className="ri-fire-line text-orange-400 text-base"></i>
              </div>
              <span className="text-white/40 text-xs font-medium">連續報報</span>
            </div>
            <p className="text-white font-bold text-sm">
              {streak > 0 ? `${streak} 天` : '—'}
            </p>
            {getStageMessage(streak) && (
              <p className="text-white/20 text-[11px] mt-0.5 leading-relaxed">{getStageMessage(streak)}</p>
            )}
          </div>
        </div>

        {/* CTA row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-5 md:mt-6 pt-4 border-t border-white/5">
          {hasTodayReport ? (
            <Link
              to="/report/today"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-forest-600 hover:bg-forest-500 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap min-h-[44px]"
            >
              查看今日完整判斷
              <i className="ri-arrow-right-line"></i>
            </Link>
          ) : (
            <Link
              to="/reports"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/15 text-white font-medium text-sm rounded-xl transition-colors whitespace-nowrap min-h-[44px] border border-white/10"
            >
              <i className="ri-history-line"></i>
              查看歷史報告
            </Link>
          )}
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 text-white/70 font-medium text-sm rounded-xl transition-colors whitespace-nowrap min-h-[44px] border border-white/10"
          >
            回首頁
            <i className="ri-arrow-right-line"></i>
          </Link>
        </div>
      </div>
    </div>
  );
}