import type { ImportantNews } from '@/types/report';

interface Props {
  news: ImportantNews[] | null;
}

function getBeginnerTip(sectors: string[] | undefined, impact?: string, title?: string): string {
  if (impact && impact.includes('新手')) return impact;
  if (title && title.includes('台積電')) return '台積電是台股最重要的權值股，它的消息會牽動整個大盤。新手建議先觀察大盤方向，不要單押個股。';
  if (title && title.includes('輝達') || title && title.includes('NVIDIA')) return '輝達是 AI 風潮的核心，它的消息影響台灣半導體供應鏈。不要因為一則新聞就急著買賣。';
  if (title && title.includes('聯準會') || title && title.includes('Fed')) return '聯準會決定美元利率，直接影響全球資金流向。新手只要記得：升息對股市通常不利。';
  if (title && title.includes('戰爭') || title && title.includes('衝突')) return '地緣政治事件會讓市場恐慌，但通常短暫。新手不要因為恐慌就亂賣，先看趨勢。';
  if ((sectors || []).some((s) => s.includes('AI') || s.includes('半導體'))) {
    return '可能影響台積電、聯發科等族群。不要因為一則新聞就急著買賣，先看大盤方向。';
  }
  if ((sectors || []).some((s) => s.includes('金融'))) {
    return '金融族群可能受影響，但單一消息不代表趨勢，觀察整體利率環境。';
  }
  if ((sectors || []).some((s) => s.includes('航運') || s.includes('原物料'))) {
    return '可能影響運輸與製造成本。不熟悉就先觀察，不要急著進場。';
  }
  return '對台股可能有間接影響。新手重點不在追新聞交易，而是理解「為什麼」會影響你的投資。';
}

const fallbackNews: ImportantNews[] = [
  { title: '今日尚無重大新聞，建議先觀察整體市場方向', summary: 'AI 會在有重要新聞時幫你翻譯。今天可以先專注觀察大盤與主要族群走勢。', impact: '無重大消息時，市場通常由技術面與情緒面主導。' },
];

export default function NewsExplainCard({ news }: Props) {
  const items = news?.length ? news : fallbackNews;

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">News</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">為什麼這些新聞重要？</h2>
        <p className="text-surface-500 text-sm mt-1">AI 幫你翻譯財經新聞，不是給你新聞列表</p>
      </div>
      <div className="space-y-3">
        {items.slice(0, 5).map((item, idx) => (
          <div key={idx} className="bg-white border border-surface-200 rounded-xl p-4 md:p-5 hover:border-surface-300 transition-colors">
            <h3 className="text-navy-900 font-semibold text-sm mb-2 leading-snug">{item.title}</h3>
            <p className="text-surface-600 text-sm leading-relaxed mb-3">
              <span className="text-navy-700 font-medium">為什麼重要：</span>
              {item.summary || item.impact || 'AI 正在分析這則新聞對台股的影響...'}
            </p>
            {(item.sectors && item.sectors.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {item.sectors.map((s, i) => (
                  <span key={i} className="px-2 py-0.5 bg-surface-100 text-surface-500 text-[11px] rounded-md font-medium">
                    {s}
                  </span>
                ))}
              </div>
            )}
            <p className="text-amber-700 text-xs leading-relaxed bg-amber-50 rounded-lg p-2.5">
              <span className="font-semibold">新手怎麼看：</span>
              {getBeginnerTip(item.sectors, item.impact, item.title)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}