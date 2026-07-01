import type { FullReportMarketSnapshot } from '@/services/dailyReportService';

interface MarketSnapshotGridProps {
  data: FullReportMarketSnapshot | null;
}

export default function MarketSnapshotGrid({ data }: MarketSnapshotGridProps) {
  if (!data) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
            <i className="ri-global-line text-white text-sm"></i>
          </div>
          <h2 className="text-navy-900 font-semibold text-sm">全球市場快照</h2>
        </div>
        <div className="flex items-center gap-2 text-surface-400 text-xs py-3">
          <i className="ri-information-line"></i>
          <span>今日市場快照尚未建立</span>
        </div>
      </section>
    );
  }

  const hasAnyData =
    data.fear_greed_index !== undefined ||
    data.vix !== undefined ||
    data.nasdaq_change !== undefined ||
    data.sp500_change !== undefined ||
    data.dowjones_change !== undefined ||
    data.sox_change !== undefined ||
    data.taiwan_futures_change !== undefined ||
    data.gold_price !== undefined ||
    data.oil_price !== undefined ||
    data.btc_price !== undefined ||
    data.dxy_index !== undefined ||
    data.us10y_yield !== undefined;

  if (!hasAnyData) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
            <i className="ri-global-line text-white text-sm"></i>
          </div>
          <h2 className="text-navy-900 font-semibold text-sm">全球市場快照</h2>
        </div>
        <div className="flex items-center gap-2 text-surface-400 text-xs py-3">
          <i className="ri-information-line"></i>
          <span>今日市場快照尚未建立</span>
        </div>
      </section>
    );
  }

  const fearGreedLabel = (val?: number) => {
    if (val === undefined) return '--';
    if (val >= 75) return '極度貪婪';
    if (val >= 55) return '貪婪';
    if (val >= 45) return '中性';
    if (val >= 25) return '恐懼';
    return '極度恐懼';
  };

  const fearGreedColor = (val?: number) => {
    if (val === undefined) return 'text-surface-400';
    if (val >= 75) return 'text-red-400';
    if (val >= 55) return 'text-amber-400';
    if (val >= 45) return 'text-yellow-400';
    if (val >= 25) return 'text-forest-400';
    return 'text-forest-500';
  };

  const vixLabel = (val?: number) => {
    if (val === undefined) return '--';
    if (val >= 30) return '市場恐慌';
    if (val >= 20) return '有點緊張';
    return '平靜';
  };

  const vixColor = (val?: number) => {
    if (val === undefined) return 'text-surface-400';
    if (val >= 30) return 'text-red-400';
    if (val >= 20) return 'text-amber-400';
    return 'text-forest-400';
  };

  const changeStatus = (val?: number) => {
    if (val === undefined) return 'flat' as const;
    if (val > 0) return 'up' as const;
    if (val < 0) return 'down' as const;
    return 'flat' as const;
  };

  const changeColor = (status: 'up' | 'down' | 'flat') => {
    if (status === 'up') return 'text-forest-500';
    if (status === 'down') return 'text-red-500';
    return 'text-surface-400';
  };

  const changeBg = (status: 'up' | 'down' | 'flat') => {
    if (status === 'up') return 'bg-forest-500/10';
    if (status === 'down') return 'bg-red-500/10';
    return 'bg-surface-500/10';
  };

  const changeArrow = (status: 'up' | 'down' | 'flat') => {
    if (status === 'up') return 'ri-arrow-up-line';
    if (status === 'down') return 'ri-arrow-down-line';
    return 'ri-subtract-line';
  };

  const formatChange = (val?: number) => {
    if (val === undefined) return '--';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}%`;
  };

  const formatValue = (val?: number, prefix = '', suffix = '') => {
    if (val === undefined) return '--';
    return `${prefix}${val.toLocaleString('zh-TW')}${suffix}`;
  };

  const changeCards = [
    { key: 'nasdaq', label: 'Nasdaq', val: data.nasdaq_change, desc: '科技股大本營，漲跌直接影響台股 AI 股開盤氣氛' },
    { key: 'sp500', label: 'S&P 500', val: data.sp500_change, desc: '美股 500 大企業代表，全球股市風向球' },
    { key: 'dow', label: 'Dow Jones', val: data.dowjones_change, desc: '美國傳產與金融股指標，影響台灣金融族群' },
    { key: 'sox', label: 'SOX 半導體', val: data.sox_change, desc: '半導體產業風向球，和台積電、聯發科連動' },
    { key: 'taiwan', label: '台指期夜盤', val: data.taiwan_futures_change, desc: '反應國際投資人對台股看法，早上開盤參考' },
  ].filter((c) => c.val !== undefined);

  const valueCards = [
    { key: 'gold', label: '黃金', val: data.gold_price, prefix: '$', suffix: '', desc: '黃金漲代表避險情緒升溫，資金可能離開股市' },
    { key: 'oil', label: '原油', val: data.oil_price, prefix: '$', suffix: '', desc: '原油漲推高航空與塑化成本，影響相關族群獲利' },
    { key: 'btc', label: '比特幣', val: data.btc_price, prefix: '$', suffix: '', desc: '風險資產情緒指標，大漲大跌反映市場貪婪或恐慌' },
    { key: 'dxy', label: '美元指數 DXY', val: data.dxy_index, prefix: '', suffix: '', desc: '美元強弱會影響外資是否流入台股、台幣匯率' },
    { key: 'us10y', label: '美國十年債殖利率', val: data.us10y_yield, prefix: '', suffix: '%', desc: '殖利率升太高會壓抑科技股估值，影響台股電子股' },
  ].filter((c) => c.val !== undefined);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-global-line text-white text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">全球市場快照</h2>
        <span className="ml-auto text-surface-400 text-xs">昨夜收盤數據</span>
      </div>

      <div className="space-y-3">
        {/* 情緒指標大卡片 */}
        {(data.fear_greed_index !== undefined || data.vix !== undefined) && (
          <div className="bg-navy-800 rounded-xl p-4 md:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.fear_greed_index !== undefined && (
                <div className="bg-navy-700/50 rounded-lg p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <i className="ri-emotion-line text-amber-400 text-xs"></i>
                      <span className="text-surface-400 text-xs">CNN 貪婪指數</span>
                    </div>
                    <span className={`text-xs font-semibold ${fearGreedColor(data.fear_greed_index)}`}>
                      {fearGreedLabel(data.fear_greed_index)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-bold text-2xl">{data.fear_greed_index}</span>
                    <span className="text-surface-400 text-xs">/ 100</span>
                  </div>
                  <p className="text-surface-400 text-[11px] mt-1.5 leading-snug">
                    數字越高代表投資人越樂觀，超過 75 要警惕過熱，低於 25 可能是抄底機會。
                  </p>
                </div>
              )}

              {data.vix !== undefined && (
                <div className="bg-navy-700/50 rounded-lg p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <i className="ri-heart-pulse-line text-red-400 text-xs"></i>
                      <span className="text-surface-400 text-xs">恐慌指數 VIX</span>
                    </div>
                    <span className={`text-xs font-semibold ${vixColor(data.vix)}`}>
                      {vixLabel(data.vix)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-bold text-2xl">{data.vix.toFixed(2)}</span>
                  </div>
                  <p className="text-surface-400 text-[11px] mt-1.5 leading-snug">
                    VIX 越高表示市場越恐慌、波動越大。超過 30 通常代表市場在擔心大事，新手要小心。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 漲跌幅卡片 */}
        {changeCards.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {changeCards.map((card) => {
              const status = changeStatus(card.val);
              return (
                <div
                  key={card.key}
                  className="bg-white border border-surface-200 rounded-xl p-3 hover:border-surface-300 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-navy-900 font-semibold text-xs">{card.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded ${changeBg(status)}`}>
                      <i className={`${changeArrow(status)} ${changeColor(status)} text-[10px]`}></i>
                      <span className={`text-xs font-bold ${changeColor(status)}`}>
                        {formatChange(card.val)}
                      </span>
                    </div>
                  </div>
                  <p className="text-surface-400 text-[11px] leading-snug">{card.desc}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* 價格卡片 */}
        {valueCards.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {valueCards.map((card) => (
              <div
                key={card.key}
                className="bg-white border border-surface-200 rounded-xl p-3 hover:border-surface-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-navy-900 font-semibold text-xs">{card.label}</span>
                </div>
                <div className="mb-1.5">
                  <span className="text-navy-900 font-bold text-base">
                    {formatValue(card.val, card.prefix, card.suffix)}
                  </span>
                </div>
                <p className="text-surface-400 text-[11px] leading-snug">{card.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}