import type { Report, RiskFactor, WatchSector } from '@/types/report';

interface Props {
  report: Report | null;
}

// Auto-generate beginner-friendly explanations for common watch items
const watchExplanations: Record<string, string> = {
  'ETF': '適合慢慢觀察，不需要一次買滿，可以先認識大盤走向。',
  'AI': '如果市場偏多，可以列入觀察清單，但不要因為新聞就急著買。',
  '半導體': '趨勢相關性高，但波動也大，建議先觀察再決定。',
  '台積電': '大型權值股，適合理解大盤方向時列入觀察。',
  '聯發科': '波動可能比台積電大，適合對半導體有基本了解後再觀察。',
  '電子': '科技股為主的族群，和市場情緒連動強，適合趨勢明確時觀察。',
  '金融': '較穩定的族群，適合保守型投資人慢慢了解。',
  '傳產': '與景氣循環相關，適合長期觀察而非短線操作。',
  '航運': '波動大，不熟悉時建議先看整體貨運指數趨勢。',
};

const avoidExplanations: Record<string, string> = {
  '追高': '已經大漲的股票不要急著追，容易買在短線高點。',
  '當沖': '新手今天不適合用高風險方式操作，先學會看趨勢更重要。',
  '槓桿': '借錢投資風險極高，在市場方向不明時尤其危險。',
  '融資': '放大虧損的風險很大，新手建議只用現金操作。',
  '期貨': '高槓桿商品，一個波動可能就損失慘重，不建議新手碰。',
  '選擇權': '複雜度很高，建議對市場有基本認識後再考慮。',
  '放空': '與趨勢作對風險大，方向判斷錯誤時虧損可能無上限。',
  '重押': '把錢集中在少數股票上，一旦走錯方向很難承受。',
};

function getWatchExplanation(item: string): string {
  for (const [key, val] of Object.entries(watchExplanations)) {
    if (item.includes(key)) return val;
  }
  return '這個方向可以列入觀察清單，但記得先看整體大盤方向再決定。';
}

function getAvoidExplanation(item: string): string {
  for (const [key, val] of Object.entries(avoidExplanations)) {
    if (item.includes(key)) return val;
  }
  return '這個操作今天風險偏高，建議先觀察市場方向再決定。';
}

export default function BeginnerDoDontCard({ report }: Props) {
  if (!report) return null;

  // Fallback data
  const canWatchFallback = ['ETF', 'AI / 半導體'];
  const avoidTodayFallback = ['追高', '當沖', '槓桿'];

  const canWatch = report.can_watch?.length ? report.can_watch : canWatchFallback;
  const avoidToday = report.avoid_today?.length ? report.avoid_today : avoidTodayFallback;

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">If You Are New Today</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">如果你今天是新手，先看這裡</h2>
        <p className="text-surface-500 text-sm mt-1">AI 像朋友一樣提醒你今天怎麼做</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        {/* 左卡：今天可以觀察 */}
        <div className="bg-forest-50 border border-forest-200 rounded-2xl p-5 md:p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-10 h-10 bg-forest-500 rounded-xl flex items-center justify-center">
              <i className="ri-check-double-line text-white text-lg"></i>
            </div>
            <div>
              <h3 className="text-forest-900 font-bold text-base">今天可以觀察</h3>
              <p className="text-forest-700 text-xs">這些方向 AI 覺得適合慢慢了解</p>
            </div>
          </div>
          <div className="space-y-4">
            {canWatch.map((item, idx) => (
              <div key={`do-${idx}`} className="flex items-start gap-3">
                <div className="w-6 h-6 bg-forest-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-check-line text-white text-xs"></i>
                </div>
                <div>
                  <p className="text-navy-800 text-sm font-medium">{item}</p>
                  <p className="text-surface-500 text-xs leading-relaxed mt-0.5">{getWatchExplanation(item)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右卡：今天先不要做 */}
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 md:p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center">
              <i className="ri-forbid-line text-white text-lg"></i>
            </div>
            <div>
              <h3 className="text-red-900 font-bold text-base">今天先不要做</h3>
              <p className="text-red-700 text-xs">這些操作今天風險比較高</p>
            </div>
          </div>
          <div className="space-y-4">
            {avoidToday.map((item, idx) => (
              <div key={`dont-${idx}`} className="flex items-start gap-3">
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-close-line text-white text-xs"></i>
                </div>
                <div>
                  <p className="text-navy-800 text-sm font-medium">{item}</p>
                  <p className="text-surface-500 text-xs leading-relaxed mt-0.5">{getAvoidExplanation(item)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}