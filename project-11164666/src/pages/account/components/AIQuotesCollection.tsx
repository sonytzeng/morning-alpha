import type { Report } from '@/types/report';

interface AIQuotesCollectionProps {
  recentReports: Report[];
}

export default function AIQuotesCollection({ recentReports }: AIQuotesCollectionProps) {
  // Extract quotes from real reports — use report summaries with sentiment context
  const quotes = recentReports
    .filter((r) => r.report_date)
    .slice(0, 6)
    .map((r) => {
      const bias = r.market_bias || '';
      const sentiment = bias.includes('偏多') ? '偏多' : bias.includes('偏空') ? '偏空' : '觀望';
      return {
        id: r.id || r.report_date || '',
        date: r.report_date || '',
        sentiment,
        text: r.today_summary || r.market_bias || '今日市場資訊整理中',
      };
    });

  if (quotes.length === 0) {
    return (
      <div>
        <div className="mb-4 md:mb-5">
          <h2 className="text-white font-bold text-base md:text-lg mb-1">AI 軍師語錄</h2>
          <p className="text-white/40 text-xs md:text-sm">
            那些值得你在市場混亂時重新閱讀的提醒。
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center mx-auto mb-3">
            <i className="ri-book-open-line text-white/30 text-lg"></i>
          </div>
          <p className="text-white/30 text-sm">尚無語錄</p>
          <p className="text-white/15 text-xs mt-1">AI 報告產生後，每日語錄將會自動收錄於此</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 md:mb-5">
        <h2 className="text-white font-bold text-base md:text-lg mb-1">AI 軍師語錄</h2>
        <p className="text-white/40 text-xs md:text-sm">
          那些值得你在市場混亂時重新閱讀的提醒。
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {quotes.map((quote) => {
          const moodDot = quote.sentiment.includes('偏多')
            ? 'bg-forest-400'
            : quote.sentiment.includes('偏空')
              ? 'bg-red-400'
              : 'bg-amber-400';

          const moodBorder = quote.sentiment.includes('偏多')
            ? 'border-forest-500/20'
            : quote.sentiment.includes('偏空')
              ? 'border-red-500/20'
              : 'border-amber-500/20';

          const moodBg = quote.sentiment.includes('偏多')
            ? 'bg-forest-500/15 text-forest-300'
            : quote.sentiment.includes('偏空')
              ? 'bg-red-500/15 text-red-300'
              : 'bg-amber-500/15 text-amber-300';

          return (
            <div
              key={quote.id}
              className="group relative rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5 transition-all duration-300 hover:border-white/[0.15]"
            >
              {/* Top row: date + sentiment */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${moodDot}`}></span>
                  <span className="text-white/30 text-[11px]">{quote.date}</span>
                </div>
              </div>

              {/* Quote text */}
              <p className="text-white/80 text-sm leading-relaxed mb-3">
                {quote.text}
              </p>

              {/* Sentiment tag */}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${moodBg}`}>
                {quote.sentiment}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}