import { useState } from 'react';
import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

interface MarketCard {
  key: string;
  label: string;
  value: string;
  status: 'up' | 'down' | 'flat';
  plainText: string;
  taiwanImpact: string;
  beginnerTip: string;
}

export default function MarketDataCards({ report }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (!report) return null;

  const allCards: MarketCard[] = [];

  // 1. 美股 (Nasdaq + S&P 500 平均)
  if (report.nasdaq_change != null || report.sp500_change != null) {
    const nasdaq = report.nasdaq_change ?? 0;
    const sp = report.sp500_change ?? 0;
    const count = (report.nasdaq_change != null ? 1 : 0) + (report.sp500_change != null ? 1 : 0);
    const avg = count > 0 ? (nasdaq + sp) / count : 0;
    const isUp = avg > 0;
    const isBig = Math.abs(avg) > 1;
    allCards.push({
      key: 'us_market',
      label: '美股（Nasdaq / S&P 500）',
      value: `${isUp ? '+' : ''}${avg.toFixed(2)}%`,
      status: isUp ? 'up' : 'down',
      plainText: isBig
        ? isUp
          ? '美股大漲，市場情緒正面，今天早上台股開盤可能受到鼓舞。'
          : '美股明顯下跌，台股早上開盤可能承受賣壓。'
        : isUp
          ? '美股小漲，整體氣氛還可以，對台股沒有太大壓力。'
          : '美股小跌，開盤可能稍微整理，但不算嚴重。',
      taiwanImpact: isUp ? '電子股、科技股可能較活躍。' : '電子股可能開盤承壓，留意盤中是否止跌。',
      beginnerTip: '美股是台股開盤的重要參考，但不要只看一天，連續幾天的趨勢更重要。',
    });
  }

  // 2. SOX 半導體
  if (report.sox_change != null) {
    const val = report.sox_change;
    const isUp = val > 0;
    const isBig = Math.abs(val) > 1.5;
    allCards.push({
      key: 'sox',
      label: 'AI / 半導體（SOX）',
      value: `${isUp ? '+' : ''}${val.toFixed(2)}%`,
      status: isUp ? 'up' : 'down',
      plainText: isBig
        ? isUp
          ? '半導體族群大漲，AI 相關股票可能受到激勵。'
          : '半導體族群明顯走弱，AI 相關股票可能承壓。'
        : isUp
          ? '半導體小漲，相關族群氣氛還可以。'
          : '半導體小跌，相關族群可能稍微整理。',
      taiwanImpact: isUp ? '台積電、聯發科、相關供應鏈可能較活躍。' : '半導體相關個股可能開盤承壓。',
      beginnerTip: 'SOX 是半導體的「體溫計」，大漲不代表個股一定漲，但方向值得參考。',
    });
  }

  // 3. VIX 恐慌指數
  if (report.vix != null) {
    const val = report.vix;
    allCards.push({
      key: 'vix',
      label: 'VIX 恐慌指數',
      value: val.toFixed(1),
      status: val >= 25 ? 'down' : val >= 18 ? 'flat' : 'up',
      plainText:
        val >= 25
          ? '市場有點緊張，波動可能比較大，新手要小心。'
          : val >= 18
            ? '市場有一點不安，但還在正常範圍內。'
            : '市場很平靜，沒什麼人在恐慌，趨勢可能較穩定。',
      taiwanImpact: val >= 25 ? '波動大時台股也容易跟著震盪，不要追高殺低。' : '平靜時趨勢較容易延續，適合觀察方向。',
      beginnerTip: 'VIX 是市場的「壓力計」，數字越高代表大家越緊張，波動可能越大。',
    });
  }

  // 4. 美國十年債殖利率
  if (report.us_bond_yield != null) {
    const val = report.us_bond_yield;
    allCards.push({
      key: 'us10y',
      label: '美國十年債殖利率',
      value: `${val.toFixed(2)}%`,
      status: val > 4.3 ? 'down' : 'flat',
      plainText:
        val > 4.5
          ? '借錢成本飆高，科技股估值容易被壓抑，市場壓力大。'
          : val > 4.0
            ? '利率偏高，對成長股（AI、科技）不太友善，要留意。'
            : val > 3.5
              ? '利率中等，沒有太大壓力，市場還算舒服。'
              : '資金成本低，對股市是比較有利的環境。',
      taiwanImpact: val > 4.0 ? '科技股、高成長族群估值容易被壓縮。' : '低利率環境對股市較友善。',
      beginnerTip: '殖利率是「借錢的成本」，越高代表錢越貴，對成長股越不利。',
    });
  }

  // 5. 台指期夜盤
  if (report.taiex_futures_change != null) {
    const val = report.taiex_futures_change;
    const isUp = val > 0;
    allCards.push({
      key: 'tx',
      label: '台指期夜盤',
      value: `${isUp ? '+' : ''}${val.toFixed(2)}%`,
      status: isUp ? 'up' : 'down',
      plainText: isUp
        ? val > 0.5
          ? '外資昨晚看好台股，今天早上可能開高。'
          : '台指期小漲，開盤氣氛中性偏多。'
        : val < -0.5
          ? '外資期貨走弱，早上開盤可能承壓。'
          : '台指期小跌，開盤可能稍微整理。',
      taiwanImpact: '直接影響今天台股開盤位置與盤初方向。',
      beginnerTip: '台指期是「提前開盤的台股」，漲跌不代表整天走勢，但影響開盤氣氛。',
    });
  }

  // 6. 美元指數
  if (report.dxy != null) {
    const val = report.dxy;
    allCards.push({
      key: 'dxy',
      label: '美元指數',
      value: val.toFixed(1),
      status: val > 103 ? 'up' : 'flat',
      plainText:
        val > 105
          ? '美元超強，資金可能被美國吸走，亞洲股市壓力較大。'
          : val > 103
            ? '美元偏強，資金可能回流美國，亞洲股市短線觀察。'
            : val > 100
              ? '美元正常，對台股影響不大。'
              : '美元偏弱，資金可能流向亞洲，對台股有利。',
      taiwanImpact: val > 103 ? '電子出口股可能受壓，留意匯率影響。' : '資金回流亞洲時，台股可能有支撐。',
      beginnerTip: '美元強弱會影響資金流向，強美元時新興市場股市通常較弱。',
    });
  }

  // 7. 黃金
  if (report.gold_price != null) {
    const val = report.gold_price;
    allCards.push({
      key: 'gold',
      label: '黃金',
      value: `$${val.toFixed(0)}`,
      status: 'flat',
      plainText:
        val > 2300
          ? '黃金處於高檔，市場避險情緒較濃，可能有大事讓大家擔心。'
          : val > 2000
            ? '黃金價格偏高，避險需求存在，但不至於恐慌。'
            : '黃金價格正常，避險情緒不算特別強烈。',
      taiwanImpact: '黃金大漲時通常代表市場擔心什麼，台股可能受情緒影響。',
      beginnerTip: '黃金是「避險資產」，漲太多時代表大家在害怕，要留意市場情緒。',
    });
  }

  // 8. 原油
  if (report.oil_price != null) {
    const val = report.oil_price;
    allCards.push({
      key: 'oil',
      label: '原油',
      value: `$${val.toFixed(1)}`,
      status: val > 85 ? 'down' : val < 65 ? 'up' : 'flat',
      plainText:
        val > 90
          ? '油價飆高，通膨壓力回來，央行可能更難降息。'
          : val > 80
            ? '油價偏高，對運輸和製造成本有壓力。'
            : val > 65
              ? '油價正常，沒有特別的通膨壓力訊號。'
              : '油價偏低，通膨壓力小，但可能反映需求疲軟。',
      taiwanImpact: '油價影響運輸股、塑化股成本，也影響整體通膨預期。',
      beginnerTip: '油價漲會讓運輸、製造業成本變高，也可能讓央行不敢降息。',
    });
  }

  const primaryKeys = ['us_market', 'sox', 'vix', 'us10y'];
  const primaryCards = allCards.filter((c) => primaryKeys.includes(c.key));
  const extraCards = allCards.filter((c) => !primaryKeys.includes(c.key));
  const displayCards = showAll ? allCards : primaryCards;

  if (allCards.length === 0) {
    return (
      <section>
        <div className="mb-4">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Market Data</p>
          <h2 className="text-navy-900 font-bold text-xl md:text-2xl">市場數據白話翻譯</h2>
        </div>
        <div className="bg-white border border-surface-200 rounded-2xl p-6 text-center">
          <p className="text-surface-500 text-sm">今日暫無即時數據，AI 會以其他市場訊號輔助判斷。</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Market Data</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">市場數據白話翻譯</h2>
        <p className="text-surface-500 text-sm mt-1">AI 為什麼在意這些數字？幫你翻譯成白話</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {displayCards.map((card) => (
          <div
            key={card.key}
            className="bg-white border border-surface-200 rounded-xl p-4 hover:border-surface-300 transition-colors flex flex-col"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-navy-700 font-semibold text-sm">{card.label}</span>
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                  card.status === 'up'
                    ? 'bg-forest-100 text-forest-700'
                    : card.status === 'down'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-surface-100 text-surface-600'
                }`}
              >
                {card.value}
              </span>
            </div>
            <p className="text-navy-700 text-sm leading-relaxed mb-3 flex-1">{card.plainText}</p>
            <div className="border-t border-surface-100 pt-3 mt-auto space-y-1.5">
              <p className="text-surface-500 text-xs leading-relaxed">
                <span className="text-forest-600 font-medium">對台股：</span>
                {card.taiwanImpact}
              </p>
              <p className="text-surface-400 text-xs leading-relaxed">
                <span className="text-amber-600 font-medium">新手提醒：</span>
                {card.beginnerTip}
              </p>
            </div>
          </div>
        ))}
      </div>

      {extraCards.length > 0 && (
        <div className="text-center mt-4">
          <button
            onClick={() => setShowAll(!showAll)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-surface-200 hover:border-surface-300 text-surface-600 text-xs font-medium rounded-lg transition-colors"
          >
            {showAll ? (
              <>
                <i className="ri-arrow-up-s-line"></i>
                收起其他數據
              </>
            ) : (
              <>
                <i className="ri-arrow-down-s-line"></i>
                展開更多（{extraCards.length} 項）
              </>
            )}
          </button>
        </div>
      )}
    </section>
  );
}