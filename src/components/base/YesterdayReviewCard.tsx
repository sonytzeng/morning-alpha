import type { YesterdayCompare } from '@/services/dailyReportService';

interface Props {
  compare: YesterdayCompare;
  todaySentiment: string;
  todayConfidence: number;
}

export default function YesterdayReviewCard({ compare, todaySentiment, todayConfidence }: Props) {
  if (!compare.hasYesterday) {
    return (
      <section className="bg-surface-50 border border-surface-200 rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-surface-200 rounded-lg flex items-center justify-center">
            <i className="ri-history-line text-surface-500 text-sm"></i>
          </div>
          <h2 className="text-navy-900 font-semibold text-base">昨天 AI 說了什麼？</h2>
        </div>
        <p className="text-surface-500 text-sm leading-relaxed">
          這是 AI 市場觀察的第一期報告，還沒有昨日資料可以比對。從明天開始，你可以看到 AI 預測與實際市場走勢的對照，建立長期信任感。
        </p>
      </section>
    );
  }

  const yBull = compare.yesterdaySentiment.includes('偏多') || compare.yesterdaySentiment.includes('強勢');
  const yBear = compare.yesterdaySentiment.includes('偏空') || compare.yesterdaySentiment.includes('弱');
  const tBull = todaySentiment.includes('偏多') || todaySentiment.includes('強勢');
  const tBear = todaySentiment.includes('偏空') || todaySentiment.includes('弱');

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Yesterday vs Today</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">昨天 AI 說了什麼？</h2>
        <p className="text-surface-500 text-sm mt-1">看看 AI 昨天的判斷，今天驗證得怎麼樣</p>
      </div>

      <div className="bg-white border border-surface-200 rounded-2xl p-5 md:p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 昨日 */}
          <div className="border-r-0 md:border-r border-surface-200 pr-0 md:pr-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-surface-400 text-xs font-medium uppercase tracking-wider">昨日 AI 判斷</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                yBull ? 'bg-forest-100 text-forest-700' : yBear ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {compare.yesterdaySentiment}
              </span>
            </div>
            <p className="text-navy-900 text-sm leading-relaxed mb-2">{compare.yesterdaySentence}</p>
            <p className="text-surface-400 text-xs">劇本成立度：{compare.yesterdayConfidence}/100</p>
          </div>

          {/* 今日 */}
          <div className="pl-0 md:pl-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-surface-400 text-xs font-medium uppercase tracking-wider">今日驗證</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                tBull ? 'bg-forest-100 text-forest-700' : tBear ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {todaySentiment}
              </span>
            </div>
            <p className="text-navy-900 text-sm leading-relaxed mb-2">{compare.todayValidation}</p>
            <p className="text-surface-400 text-xs">今日劇本成立度：{todayConfidence}/100</p>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-surface-200">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-forest-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <i className="ri-lightbulb-line text-forest-500 text-sm"></i>
            </div>
            <div>
              <p className="text-navy-800 font-medium text-sm mb-1">AI 學習中</p>
              <p className="text-surface-500 text-xs leading-relaxed">
                AI 每天分析全球數據與新聞，持續調整判斷邏輯。歷史對照不是為了證明 AI 多準，而是幫你建立「市場判斷」的連續感，讓你每天更了解市場在想什麼。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}