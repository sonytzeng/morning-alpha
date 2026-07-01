import type { MarketSnapshot } from '@/services/marketSnapshotService';
import { buildSentimentOverview, buildMarketIndicators } from '@/services/marketSnapshotService';

interface MarketSnapshotSectionProps {
  data: MarketSnapshot | null;
}

export default function MarketSnapshotSection({ data }: MarketSnapshotSectionProps) {
  const overview = buildSentimentOverview(data);
  const indicators = buildMarketIndicators(data);

  if (!data) {
    return (
      <section className="bg-white border border-surface-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
            <i className="ri-global-line text-white text-sm"></i>
          </div>
          <h2 className="text-navy-900 font-semibold text-sm">全球市場快照</h2>
        </div>
        <div className="flex items-center gap-2 text-surface-400 text-xs py-4">
          <i className="ri-information-line"></i>
          <span>今日市場快照尚未建立</span>
        </div>
      </section>
    );
  }

  const riskColor =
    data.risk_level === 'high' || data.risk_level === '高'
      ? 'text-red-500'
      : data.risk_level === 'medium' || data.risk_level === '中'
        ? 'text-amber-500'
        : 'text-forest-500';

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-global-line text-white text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">全球市場快照</h2>
      </div>

      <div className="space-y-3">
        {/* 1. 市場情緒總覽卡 */}
        <div className="bg-navy-800 rounded-xl p-4 md:p-5">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <h3 className="text-white font-semibold text-sm mb-1">市場情緒總覽</h3>
              <p className="text-surface-300 text-xs">
                {overview?.plainSummary || '市場情緒資料整理中'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-surface-400 text-xs">市場狀態</span>
              <span className="px-2.5 py-1 bg-forest-500/10 border border-forest-500/20 text-forest-400 text-xs font-semibold rounded-full">
                {data.market_status || '觀察中'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* Fear & Greed */}
            <div className="bg-navy-700/50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <i className="ri-emotion-line text-amber-400 text-xs"></i>
                <span className="text-surface-400 text-xs">貪婪指數</span>
              </div>
              <div className="text-white font-bold text-lg mb-0.5">
                {data.fear_greed_index !== null ? data.fear_greed_index : '--'}
              </div>
              <p className="text-surface-400 text-[11px] leading-snug">
                {overview?.fearGreedLabel || '資料不足'}
              </p>
            </div>

            {/* VIX */}
            <div className="bg-navy-700/50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <i className="ri-heart-pulse-line text-red-400 text-xs"></i>
                <span className="text-surface-400 text-xs">恐慌指數 VIX</span>
              </div>
              <div className="text-white font-bold text-lg mb-0.5">
                {data.vix !== null ? data.vix.toFixed(2) : '--'}
              </div>
              <p className="text-surface-400 text-[11px] leading-snug">
                {overview?.vixLabel || '資料不足'}
              </p>
            </div>

            {/* Risk Level */}
            <div className="bg-navy-700/50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <i className="ri-shield-check-line text-blue-400 text-xs"></i>
                <span className="text-surface-400 text-xs">風險等級</span>
              </div>
              <div className={`font-bold text-lg mb-0.5 ${riskColor}`}>
                {data.risk_level || '--'}
              </div>
              <p className="text-surface-400 text-[11px] leading-snug">
                {data.risk_level === 'high' || data.risk_level === '高'
                  ? '市場不穩，新手建議觀望'
                  : data.risk_level === 'medium' || data.risk_level === '中'
                    ? '波動加大，注意風險控管'
                    : '風險可控，正常操作即可'}
              </p>
            </div>

            {/* Mini explanation */}
            <div className="bg-navy-700/50 rounded-lg p-3 flex flex-col justify-center">
              <p className="text-surface-300 text-[11px] leading-relaxed">
                <span className="text-forest-400 font-medium">貪婪指數越高</span>，代表市場越樂觀、投資人越不怕追高。
              </p>
              <p className="text-surface-300 text-[11px] leading-relaxed mt-1.5">
                <span className="text-red-400 font-medium">VIX 越高</span>，代表市場越恐慌、波動越大，新手要更小心。
              </p>
            </div>
          </div>
        </div>

        {/* 2. 全球市場指標卡片 */}
        {indicators.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {indicators.map((item) => {
              const statusColor =
                item.status === 'up'
                  ? 'text-forest-500'
                  : item.status === 'down'
                    ? 'text-red-500'
                    : 'text-surface-400';
              const statusBg =
                item.status === 'up'
                  ? 'bg-forest-500/10'
                  : item.status === 'down'
                    ? 'bg-red-500/10'
                    : 'bg-surface-500/10';
              const arrowIcon =
                item.status === 'up'
                  ? 'ri-arrow-up-line'
                  : item.status === 'down'
                    ? 'ri-arrow-down-line'
                    : 'ri-subtract-line';

              return (
                <div
                  key={item.symbol}
                  className="bg-white border border-surface-200 rounded-xl p-3 hover:border-surface-300 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-navy-900 font-semibold text-xs">{item.name}</span>
                    <span className="text-surface-400 text-[10px] font-mono">{item.symbol}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 mb-1.5">
                    <span className="text-navy-900 font-bold text-base">{item.value}</span>
                    <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${statusBg}`}>
                      <i className={`${arrowIcon} ${statusColor} text-[10px]`}></i>
                      <span className={`text-xs font-semibold ${statusColor}`}>
                        {item.changeFormatted}
                      </span>
                    </div>
                  </div>
                  <p className="text-surface-400 text-[11px] leading-snug">{item.plainText}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. 新手白話區塊 */}
        {(data.beginner_summary || data.action_suggestion) && (
          <div className="bg-forest-50 border border-forest-200 rounded-xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-forest-600 rounded-lg flex items-center justify-center">
                <i className="ri-user-smile-line text-white text-xs"></i>
              </div>
              <h3 className="text-navy-900 font-semibold text-sm">新手今天怎麼看？</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.beginner_summary && (
                <div>
                  <h4 className="text-forest-700 font-medium text-xs mb-1.5">今天市場怎麼了</h4>
                  <p className="text-navy-800 text-sm leading-relaxed">{data.beginner_summary}</p>
                </div>
              )}
              {data.action_suggestion && (
                <div>
                  <h4 className="text-forest-700 font-medium text-xs mb-1.5">新手建議這樣做</h4>
                  <p className="text-navy-800 text-sm leading-relaxed">{data.action_suggestion}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}