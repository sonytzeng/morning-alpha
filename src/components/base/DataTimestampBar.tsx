import { formatTaipeiTime, formatTaipeiShort } from '@/services/homeDashboardService';

interface DataTimestampBarProps {
  reportCreatedAt?: string | null;
  intradayCheckCreatedAt?: string | null;
  marketDataAt?: string | null;
  marketNewsAt?: string | null;
  loading?: boolean;
  /** 今日報告是否已產生（report_date 是否為今天） */
  hasTodayReport?: boolean;
  /** 各資料源是否為今日資料 */
  isReportToday?: boolean;
  isMarketDataToday?: boolean;
  isMarketNewsToday?: boolean;
  isIntradayToday?: boolean;
  /** V11: true when today has no report and we're showing historical fallback data */
  isHistoricalFallback?: boolean;
  /** V13: the fallback report date (e.g. "2026-06-05") */
  fallbackReportDate?: string | null;
  /** V13: the fallback report created_at time */
  fallbackReportTime?: string | null;
  /** V18: true on weekends */
  isWeekend?: boolean;
  /** V18: TXF status for display */
  txfStatus?: { hasFreshTXF: boolean; label: string } | null;
  /** V18: news count for credibility check */
  newsCount?: number;
}

export default function DataTimestampBar({
  reportCreatedAt,
  intradayCheckCreatedAt,
  marketDataAt,
  marketNewsAt,
  loading = false,
  hasTodayReport = true,
  isReportToday,
  isMarketDataToday,
  isMarketNewsToday,
  isIntradayToday,
  isHistoricalFallback = false,
  fallbackReportDate = null,
  fallbackReportTime = null,
  isWeekend = false,
  txfStatus = null,
  newsCount,
}: DataTimestampBarProps) {
  if (loading) {
    return (
      <div className="w-full animate-pulse">
        <div className="h-5 bg-white/5 rounded w-full max-w-3xl"></div>
      </div>
    );
  }

  const isNonTrading = isHistoricalFallback || isWeekend;

  // Report value
  let reportValue: string;
  let reportLabel: string;

  if (hasTodayReport) {
    reportValue = formatTaipeiShort(reportCreatedAt);
    reportLabel = '報告';
  } else if (isNonTrading && fallbackReportDate) {
    const shortDate = fallbackReportDate.length === 10
      ? `${fallbackReportDate.slice(5, 7)}/${fallbackReportDate.slice(8, 10)}`
      : fallbackReportDate;
    const timePart = fallbackReportTime ? ` ${formatTaipeiShort(fallbackReportTime).split(' ').pop() || ''}` : '';
    reportValue = `${shortDate}${timePart}`;
    reportLabel = '報告';
  } else if (isNonTrading) {
    reportValue = '暫停產生';
    reportLabel = '報告';
  } else {
    reportValue = '尚未產生';
    reportLabel = '報告 ⚠';
  }

  // Radar value — V18: TXF-aware
  let radarValue: string;
  if (isNonTrading) {
    radarValue = '非交易日暫停';
  } else {
    radarValue = formatTaipeiShort(intradayCheckCreatedAt);
  }

  // News value — V18: news count aware
  let newsValue: string;
  let newsSuffix: string | null = null;
  if (isNonTrading) {
    newsValue = '非交易日暫停';
  } else {
    newsValue = formatTaipeiShort(marketNewsAt);
    if (newsCount !== undefined && newsCount < 3 && newsCount > 0) {
      newsSuffix = '偏少';
    }
  }

  const items = [
    { label: reportLabel, value: reportValue, highlight: !isNonTrading && !hasTodayReport, stale: !isNonTrading && isReportToday === false },
    { label: '雷達', value: radarValue, highlight: false, stale: false },
    { label: '市場資料', value: formatTaipeiShort(marketDataAt), highlight: false, stale: !isNonTrading && isMarketDataToday === false && !!marketDataAt },
    { label: '最新新聞', value: newsValue, highlight: false, stale: false, suffix: newsSuffix },
  ];

  const stalenessLabel = isNonTrading ? '最近交易日' : '過期';

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] md:text-xs text-white/25">
        <span className="text-white/30 font-medium tracking-wide">資料時間</span>
        <span className="text-white/10">｜</span>
        {items.map((item, idx) => (
          <span key={item.label} className="inline-flex items-center gap-1">
            <span className={item.highlight ? 'text-amber-400/70' : item.stale ? 'text-amber-400/70' : 'text-white/20'}>{item.label}</span>
            <span className={item.highlight ? 'text-amber-300 font-medium' : item.stale ? 'text-amber-300 font-medium' : 'text-white/40 font-mono'}>
              {item.value}
              {item.stale && <span className="ml-0.5 text-amber-400/60 text-[10px]">{stalenessLabel}</span>}
              {item.suffix && <span className="ml-0.5 text-amber-400/70 text-[10px]">{item.suffix}</span>}
            </span>
            {idx < items.length - 1 && (
              <span className="text-white/10 ml-1">｜</span>
            )}
          </span>
        ))}
        {isNonTrading && (
          <span className="inline-flex items-center gap-1 text-amber-400/60 text-[10px]">
            <i className="ri-history-line"></i>
            非交易日
          </span>
        )}
        {/* V18: TXF status indicator */}
        {txfStatus && !txfStatus.hasFreshTXF && (
          <span className="inline-flex items-center gap-1 text-amber-400/70 text-[10px] ml-1">
            <i className="ri-information-line"></i>
            {txfStatus.label}
          </span>
        )}
      </div>
    </div>
  );
}