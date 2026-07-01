import { formatTaipeiTimeShort } from '@/hooks/useAccountDashboard';
import type { Report } from '@/types/report';

interface TodayInfoCardsProps {
  todayReport: Report | null;
  hasTodayReport: boolean;
  marketDataLatestAt: string | null;
  isMarketDataToday: boolean;
  marketNewsLatestAt: string | null;
  /** AI 精選新聞數 (is_selected=true) */
  selectedNewsCount: number;
  /** 今日總新聞數 */
  totalNewsCount: number;
  isMarketNewsToday: boolean;
  intradayLatestAt: string | null;
  intradayCheckDate: string | null;
  hasIntradayData: boolean;
  isIntradayToday: boolean;
  intradayRadarStatus: string | null;
  intradayRadarBias: string | null;
  intradayRadarSummary: string | null;
  isWeekend: boolean;
  fallbackReportDate: string | null;
  isTXFAvailable: boolean;
}

export default function TodayInfoCards({
  todayReport,
  hasTodayReport,
  marketDataLatestAt,
  isMarketDataToday,
  marketNewsLatestAt,
  selectedNewsCount,
  totalNewsCount,
  isMarketNewsToday,
  intradayLatestAt,
  intradayCheckDate,
  hasIntradayData,
  isIntradayToday,
  intradayRadarStatus,
  intradayRadarBias,
  intradayRadarSummary,
  isWeekend,
  fallbackReportDate,
  isTXFAvailable,
}: TodayInfoCardsProps) {
  function getDataStatusLabel(isToday: boolean) {
    if (isToday) {
      return (
        <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 border border-forest-500/20 rounded-full text-forest-400 text-[10px] font-medium">
          <i className="ri-checkbox-circle-line"></i>
          今日
        </span>
      );
    }
    if (isWeekend) {
      return (
        <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded-full text-sky-400 text-[10px] font-medium">
          <i className="ri-calendar-line"></i>
          非交易日
        </span>
      );
    }
    return (
      <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 text-[10px] font-medium">
        <i className="ri-error-warning-line"></i>
        待更新
      </span>
    );
  }

  function getFreshnessIcon(isToday: boolean, hasData: boolean) {
    if (isToday) return 'bg-forest-500/15 border-forest-500/20';
    if (!hasData) return 'bg-white/5 border-white/10';
    if (isWeekend) return 'bg-sky-500/15 border-sky-500/20';
    return 'bg-amber-500/15 border-amber-500/20';
  }

  function getFreshnessIconClass(isToday: boolean, hasData: boolean) {
    if (isToday) return 'text-forest-400';
    if (!hasData) return 'text-white/30';
    if (isWeekend) return 'text-sky-400';
    return 'text-amber-400';
  }

  function getReportStatusText() {
    if (hasTodayReport) return null;
    if (isWeekend && fallbackReportDate) return `今天非交易日，最近交易日報告：${fallbackReportDate}`;
    if (isWeekend) return '今天非交易日，顯示最近交易日資料';
    return '等待今日報告產生';
  }

  function getReportStatusTextClass() {
    if (hasTodayReport) return '';
    if (isWeekend) return 'text-sky-400 text-xs';
    return 'text-amber-400 text-xs';
  }

  return (
    <div>
      <div className="mb-4 md:mb-5">
        <h2 className="text-white font-bold text-base md:text-lg mb-1">
          {hasTodayReport ? '今日情報狀態' : isWeekend ? '最近交易日情報狀態' : '今日情報狀態'}
        </h2>
        <p className="text-white/40 text-xs md:text-sm">
          檢視 Morning Alpha 各資料來源的最新狀態。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        {/* Card 1: Report */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-forest-500/15 rounded-lg flex items-center justify-center border border-forest-500/20">
              <i className="ri-file-list-3-line text-forest-400 text-sm"></i>
            </div>
            <div>
              <p className="text-white text-sm font-semibold">盤前報告</p>
              <p className="text-white/30 text-[10px]">AI 盤前分析</p>
            </div>
            {hasTodayReport && (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 border border-forest-500/20 rounded-full text-forest-400 text-[10px] font-medium">
                <i className="ri-checkbox-circle-line"></i>
                正常
              </span>
            )}
            {!hasTodayReport && isWeekend && (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 rounded-full text-sky-400 text-[10px] font-medium">
                <i className="ri-calendar-line"></i>
                非交易日
              </span>
            )}
          </div>
          {hasTodayReport ? (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">日期</span>
                <span className="text-white text-xs font-medium">{todayReport?.report_date || '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">盤前訊號</span>
                <span className="text-white text-xs font-medium">{todayReport?.market_bias || '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">判讀把握度</span>
                <span className="text-white text-xs font-medium">{todayReport?.confidence_score ?? '—'}/100</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">產生時間</span>
                <span className="text-white text-xs font-medium">{formatTaipeiTimeShort(todayReport?.created_at)}</span>
              </div>
            </div>
          ) : (
            <p className={getReportStatusTextClass()}>{getReportStatusText()}</p>
          )}
          {!hasTodayReport && isWeekend && fallbackReportDate && (
            <div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-center">
              <span className="text-white/40 text-xs">報告日期</span>
              <span className="text-sky-400 text-xs font-medium">{fallbackReportDate}</span>
            </div>
          )}
        </div>

        {/* Card 2: Market Data */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 ${getFreshnessIcon(isMarketDataToday, !!marketDataLatestAt)} rounded-lg flex items-center justify-center border`}>
              <i className={`ri-database-2-line ${getFreshnessIconClass(isMarketDataToday, !!marketDataLatestAt)} text-sm`}></i>
            </div>
            <div>
              <p className="text-white text-sm font-semibold">市場資料</p>
              <p className="text-white/30 text-[10px]">美股 / 費半 / 台指期</p>
            </div>
            {getDataStatusLabel(isMarketDataToday)}
          </div>
          {marketDataLatestAt ? (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">最新時間</span>
                <span className={`text-xs font-medium ${isMarketDataToday ? 'text-white' : 'text-amber-400'}`}>
                  {formatTaipeiTimeShort(marketDataLatestAt)}
                </span>
              </div>
              {!isMarketDataToday && isWeekend && (
                <p className="text-sky-400/80 text-[11px]">非交易日不要求更新至今日，目前顯示最近交易日資料</p>
              )}
              {!isMarketDataToday && !isWeekend && (
                <p className="text-amber-400/80 text-[11px]">市場資料尚未更新至今日</p>
              )}
            </div>
          ) : (
            <p className="text-white/30 text-xs">尚無資料</p>
          )}
        </div>

        {/* Card 3: Market News */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 ${getFreshnessIcon(isMarketNewsToday, !!marketNewsLatestAt)} rounded-lg flex items-center justify-center border`}>
              <i className={`ri-newspaper-line ${getFreshnessIconClass(isMarketNewsToday, !!marketNewsLatestAt)} text-sm`}></i>
            </div>
            <div>
              <p className="text-white text-sm font-semibold">最新新聞</p>
              <p className="text-white/30 text-[10px]">全球市場快訊</p>
            </div>
            {getDataStatusLabel(isMarketNewsToday)}
          </div>
          {marketNewsLatestAt ? (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">最新時間</span>
                <span className={`text-xs font-medium ${isMarketNewsToday ? 'text-white' : 'text-amber-400'}`}>
                  {formatTaipeiTimeShort(marketNewsLatestAt)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">精選新聞</span>
                <span className="text-white text-xs font-medium">{selectedNewsCount} 則</span>
              </div>
              {totalNewsCount > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40 text-xs">今日總新聞</span>
                  <span className="text-white/50 text-xs">{totalNewsCount} 則</span>
                </div>
              )}
              {!isMarketNewsToday && (
                <p className="text-sky-400/80 text-[11px]">
                  {isWeekend
                    ? '目前顯示最近可用新聞；週末與非交易時段新聞量可能較少'
                    : '最新新聞尚未更新至今日'}
                </p>
              )}
            </div>
          ) : (
            <p className="text-white/30 text-xs">尚無資料</p>
          )}
        </div>

        {/* Card 4: Opening Radar (Intraday) — 依實際 radar_status 顯示 */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 ${getFreshnessIcon(isIntradayToday, hasIntradayData)} rounded-lg flex items-center justify-center border`}>
              <i className={`ri-radar-line ${getFreshnessIconClass(isIntradayToday, hasIntradayData)} text-sm`}></i>
            </div>
            <div>
              <p className="text-white text-sm font-semibold">開盤雷達</p>
              <p className="text-white/30 text-[10px]">09:15 開盤校正</p>
            </div>
            {isIntradayToday ? (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 border border-forest-500/20 rounded-full text-forest-400 text-[10px] font-medium">
                <i className="ri-checkbox-circle-line"></i>
                今日
              </span>
            ) : hasIntradayData ? getDataStatusLabel(false) : (
              <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-white/30 text-[10px] font-medium">
                <i className="ri-question-mark"></i>
                無資料
              </span>
            )}
          </div>
          {hasIntradayData && intradayCheckDate ? (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-white/40 text-xs">日期</span>
                <span className={`text-xs font-medium ${isIntradayToday ? 'text-white' : 'text-amber-400'}`}>
                  {intradayCheckDate}
                </span>
              </div>
              {intradayLatestAt && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40 text-xs">時間</span>
                  <span className="text-white text-xs font-medium">{formatTaipeiTimeShort(intradayLatestAt)}</span>
                </div>
              )}
              {intradayRadarStatus && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40 text-xs">雷達狀態</span>
                  <span className={`text-xs font-semibold ${
                    intradayRadarStatus === '明顯偏弱' || intradayRadarStatus === '盤中轉弱'
                      ? 'text-red-400'
                      : intradayRadarStatus === '劇本成立'
                      ? 'text-forest-400'
                      : 'text-amber-400'
                  }`}>{intradayRadarStatus}</span>
                </div>
              )}
              {intradayRadarBias && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40 text-xs">市場判斷</span>
                  <span className="text-white text-xs font-medium">{intradayRadarBias}</span>
                </div>
              )}
              {!isIntradayToday && intradayCheckDate && (
                <p className="text-sky-400/80 text-[11px]">
                  最後雷達：{intradayCheckDate}，待今日更新
                </p>
              )}
            </div>
          ) : hasIntradayData && !intradayCheckDate ? (
            <p className="text-amber-400/80 text-xs">雷達資料讀取異常，缺少 report_date</p>
          ) : !hasIntradayData ? (
            <p className="text-white/30 text-xs">尚未產生</p>
          ) : null}
        </div>
      </div>

      {/* Global status */}
      <div className="mt-4">
        {hasTodayReport && isMarketDataToday && isMarketNewsToday && isIntradayToday && isTXFAvailable ? (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-forest-500/20 bg-forest-500/10">
            <i className="ri-checkbox-circle-line text-forest-400 text-sm"></i>
            <span className="text-forest-300 text-xs font-medium">資料完整 — 所有來源皆已更新至今日</span>
          </div>
        ) : hasTodayReport && isMarketDataToday && isMarketNewsToday && isIntradayToday && !isTXFAvailable ? (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/10">
            <i className="ri-error-warning-line text-amber-400 text-sm"></i>
            <span className="text-amber-300 text-xs font-medium">TXF 暫缺，不影響大盤方向，但降低期貨確認度</span>
          </div>
        ) : hasTodayReport && totalNewsCount >= 30 && selectedNewsCount < 3 ? (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/10">
            <i className="ri-error-warning-line text-amber-400 text-sm"></i>
            <span className="text-amber-300 text-xs font-medium">今日新聞已更新（{totalNewsCount} 則），但 AI 精選較少（{selectedNewsCount} 則），目前以最新新聞輔助判斷</span>
          </div>
        ) : hasTodayReport ? (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/10">
            <i className="ri-error-warning-line text-amber-400 text-sm"></i>
            <span className="text-amber-300 text-xs font-medium">報告已產生，但部分資料來源尚未更新</span>
          </div>
        ) : isWeekend ? (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-sky-500/20 bg-sky-500/10">
            <i className="ri-calendar-line text-sky-400 text-sm"></i>
            <span className="text-sky-300 text-xs font-medium">今天非交易日，顯示最近交易日資料</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-xl border border-white/10 bg-white/[0.03]">
            <i className="ri-information-line text-white/30 text-sm"></i>
            <span className="text-white/30 text-xs font-medium">等待今日報告產生</span>
          </div>
        )}
      </div>
    </div>
  );
}