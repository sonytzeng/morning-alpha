import { useState, useEffect } from 'react';
import {
  getMarketSourceHealth,
  computeDataTrustStatus,
  formatTaipeiDateTime,
  isDateTaipeiToday,
  type DataTrustStatus,
  type MarketSourceHealth,
} from '@/services/marketSourceHealthService';
import { formatTaipeiTime } from '@/services/homeDashboardService';
import { isProxyDataSource } from '@/utils/tradingDay';

interface DataTrustRadarProps {
  variant?: 'compact' | 'full';
  data?: DataTrustStatus | null;
  sources?: MarketSourceHealth[];
  onRefresh?: () => void;
  refreshing?: boolean;
  lastSyncAt?: string | null;
  /** V11: true when today is non-trading day and showing historical fallback data */
  isHistoricalFallback?: boolean;
  /** V20: override badge label with marketStateEngine data quality */
  dataQualityOverride?: string | null;
}

export default function DataTrustRadar({
  variant = 'compact',
  data,
  sources: externalSources,
  onRefresh,
  refreshing = false,
  lastSyncAt,
  isHistoricalFallback = false,
  dataQualityOverride,
}: DataTrustRadarProps) {
  const [status, setStatus] = useState<DataTrustStatus | null>(data ?? null);
  const [sources, setSources] = useState<MarketSourceHealth[]>(externalSources ?? []);
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setStatus(data);
      setLoading(false);
      return;
    }
    if (externalSources && externalSources.length > 0) {
      setSources(externalSources);
      setStatus(computeDataTrustStatus(externalSources));
      setLoading(false);
      return;
    }

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const healthData = await getMarketSourceHealth();
        setSources(healthData);
        setStatus(computeDataTrustStatus(healthData));
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取資料可信度失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [data, externalSources]);

  if (loading) {
    return (
      <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6 animate-pulse">
        <div className="h-4 bg-white/5 rounded w-32 mb-3"></div>
        <div className="h-3 bg-white/5 rounded w-full mb-2"></div>
        <div className="h-3 bg-white/5 rounded w-3/4"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-2 text-amber-400 text-sm">
          <i className="ri-error-warning-line"></i>
          <span>資料可信度檢查暫時無法載入</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  // 安全預設：staleness 可能在某些極端情況下為 null/undefined
  const safeStaleness = status.staleness ?? { marketDataToday: false, marketNewsToday: false, reportToday: false, intradayToday: false };

  const isFull = variant === 'full';

  return (
    <div className={`bg-navy-900/60 border border-navy-800 rounded-2xl ${isFull ? 'p-5 md:p-6' : 'p-4 md:p-5'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-white/5 rounded-xl flex items-center justify-center flex-shrink-0">
            <i className="ri-radar-line text-white/40 text-sm md:text-base"></i>
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm md:text-base">資料可信度雷達</h3>
            <p className="text-white/30 text-xs">今天 AI 報告用了哪些真實資料</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/70 text-xs rounded-lg transition-colors border border-white/10 disabled:opacity-50 whitespace-nowrap"
            >
              <i className={`ri-refresh-line ${refreshing ? 'animate-spin' : ''}`}></i>
              重新整理
            </button>
          )}
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium ${status.statusColor} ${status.statusBg} ${status.statusBorder}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${dataQualityOverride
              ? (dataQualityOverride === '資料完整' ? 'bg-forest-400' : dataQualityOverride === '資料部分完整' ? 'bg-amber-400' : 'bg-red-400')
              : (status.overallStatus === 'complete' ? 'bg-forest-400' : status.overallStatus === 'partial' ? 'bg-amber-400' : 'bg-red-400')}`}></div>
            {dataQualityOverride || status.statusLabel}
          </span>
        </div>
      </div>

      {/* Data Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 mb-4 md:mb-5">
        <div className="p-2.5 md:p-3 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">市場資料</p>
          <p className="text-white/70 text-sm font-medium">
            {formatTaipeiDateTime(status.marketDataLatestAt)}
            {status.marketDataLatestAt && !safeStaleness.marketDataToday && !isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400 text-[10px] font-normal">(過期)</span>
            )}
            {status.marketDataLatestAt && !safeStaleness.marketDataToday && isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400/70 text-[10px] font-normal">(最近交易日)</span>
            )}
          </p>
        </div>
        <div className="p-2.5 md:p-3 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">最新新聞</p>
          <p className="text-white/70 text-sm font-medium">
            {formatTaipeiDateTime(status.marketNewsLatestAt)}
            {status.marketNewsLatestAt && !safeStaleness.marketNewsToday && !isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400 text-[10px] font-normal">(過期)</span>
            )}
            {status.marketNewsLatestAt && !safeStaleness.marketNewsToday && isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400/70 text-[10px] font-normal">(最近交易日)</span>
            )}
          </p>
        </div>
        <div className="p-2.5 md:p-3 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">AI 精選</p>
          <p className="text-white/70 text-sm font-medium">
            {status.selectedNewsCount} 則
          </p>
        </div>
        <div className="p-2.5 md:p-3 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">今日報告</p>
          <p className="text-white/70 text-sm font-medium">
            {status.todayReportExists
              ? formatTaipeiDateTime(status.todayReportCreatedAt)
              : isHistoricalFallback
              ? '最近交易日報告可用'
              : '尚未產生'}
            {status.todayReportExists && !safeStaleness.reportToday && !isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400 text-[10px] font-normal">(過期)</span>
            )}
            {status.todayReportExists && !safeStaleness.reportToday && isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400/70 text-[10px] font-normal">(最近交易日)</span>
            )}
            {!status.todayReportExists && isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400/70 text-[10px] font-normal">(最近交易日)</span>
            )}
          </p>
        </div>
        <div className="p-2.5 md:p-3 rounded-xl bg-white/[0.02] border border-white/5 col-span-2 md:col-span-1">
          <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">開盤雷達</p>
          <p className="text-white/70 text-sm font-medium">
            {status.todayIntradayExists
              ? (status.todayIntradayCreatedAt
                ? formatTaipeiDateTime(status.todayIntradayCreatedAt)
                : '已更新')
              : '等待中'}
            {status.todayIntradayCreatedAt && !safeStaleness.intradayToday && !isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400 text-[10px] font-normal">(過期)</span>
            )}
            {status.todayIntradayCreatedAt && !safeStaleness.intradayToday && isHistoricalFallback && (
              <span className="ml-1.5 text-amber-400/70 text-[10px] font-normal">(最近交易日)</span>
            )}
          </p>
        </div>
      </div>

      {/* Warning / Info */}
      {status.warningMessage && (
        <div className="mb-3 p-2.5 md:p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 flex items-start gap-2">
          <i className="ri-error-warning-line text-amber-400 text-sm mt-0.5 flex-shrink-0"></i>
          <p className="text-amber-300/80 text-xs leading-relaxed">{status.warningMessage}</p>
        </div>
      )}

      {/* Sources detail (full only) */}
      {isFull && sources.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">資料來源狀態</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {sources.map((source) => {
              const statusColor = source.status === 'healthy'
                ? 'text-forest-400'
                : source.status === 'warning'
                  ? 'text-amber-400'
                  : source.status === 'error'
                    ? 'text-red-400'
                    : 'text-white/30';
              const icon = source.status === 'healthy'
                ? 'ri-checkbox-circle-line'
                : source.status === 'warning'
                  ? 'ri-error-warning-line'
                  : 'ri-close-circle-line';
              return (
                <div key={source.source_name} className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center gap-2">
                  <i className={`${icon} ${statusColor} text-sm`}></i>
                  <div className="min-w-0 flex-1">
                    <p className="text-white/60 text-xs font-medium truncate">
                      {source.source_name}
                      {isProxyDataSource(source.source_name) && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-normal">
                          代理指標
                        </span>
                      )}
                    </p>
                    <p className="text-white/30 text-[10px]">
                      {formatTaipeiDateTime(source.latest_data_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer: last sync time */}
      <div className="mt-3 pt-3 border-t border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-2">
            <i className="ri-information-line text-white/30 text-sm mt-0.5 flex-shrink-0"></i>
            <p className="text-white/30 text-xs leading-relaxed">
              資料可信度雷達顯示 Morning Alpha 今日使用的資料來源新鮮度與完整度。
              {!status.hasTaiex && !status.hasTxf && ' 台股開盤驗證資料不足，開盤雷達可能僅能參考權值股訊號。'}
              {status.hasTaiex && ' 台股大盤資料已更新，開盤雷達可正常運作。'}
            </p>
          </div>
          <p className="text-white/15 text-[9px] mt-2 leading-relaxed">
            顏色採台股慣例：紅＝偏多，綠＝偏空，黃＝觀察，不代表買賣建議。
          </p>
          {lastSyncAt && (
            <span className="text-white/20 text-[10px] font-mono whitespace-nowrap flex-shrink-0 ml-3">
              最後同步：{formatTaipeiTime(lastSyncAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}