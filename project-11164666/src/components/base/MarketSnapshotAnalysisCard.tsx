import type { MarketSnapshotAnalysis } from '@/services/dailyReportService';

interface MarketSnapshotAnalysisCardProps {
  data: MarketSnapshotAnalysis | null;
}

export default function MarketSnapshotAnalysisCard({ data }: MarketSnapshotAnalysisCardProps) {
  if (!data) return null;

  const hasAny =
    data.fear_greed_explanation ||
    data.vix_explanation ||
    data.us_market_explanation ||
    data.commodity_explanation;

  if (!hasAny) return null;

  const items = [
    {
      key: 'fear_greed',
      icon: 'ri-emotion-line',
      iconColor: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      title: '貪婪指數怎麼看？',
      content: data.fear_greed_explanation,
    },
    {
      key: 'vix',
      icon: 'ri-heart-pulse-line',
      iconColor: 'text-red-400',
      bgColor: 'bg-red-500/10',
      title: '恐慌指數 VIX 在說什麼？',
      content: data.vix_explanation,
    },
    {
      key: 'us_market',
      icon: 'ri-line-chart-line',
      iconColor: 'text-forest-400',
      bgColor: 'bg-forest-500/10',
      title: '美股昨晚怎麼了？',
      content: data.us_market_explanation,
    },
    {
      key: 'commodity',
      icon: 'ri-oil-line',
      iconColor: 'text-surface-300',
      bgColor: 'bg-surface-500/10',
      title: '黃金、原油、比特幣呢？',
      content: data.commodity_explanation,
    },
  ].filter((item) => item.content);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-translate-2 text-white text-sm"></i>
        </div>
        <h2 className="text-navy-900 font-semibold text-sm">市場數據白話解釋</h2>
        <span className="ml-auto text-surface-400 text-xs">AI 幫你翻譯</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((item) => (
          <div
            key={item.key}
            className="bg-navy-800 border border-navy-700 rounded-xl p-4 hover:border-navy-600 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <div className={`w-7 h-7 ${item.bgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                <i className={`${item.icon} ${item.iconColor} text-xs`}></i>
              </div>
              <h3 className="text-white font-semibold text-xs">{item.title}</h3>
            </div>
            <p className="text-surface-300 text-sm leading-relaxed">{item.content}</p>
          </div>
        ))}
      </div>
    </section>
  );
}