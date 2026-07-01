export default function ClosingReflection() {
  return (
    <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
      <div className="mb-4 md:mb-5">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
            CLOSING REFLECTION
          </p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
            <i className="ri-moon-line"></i>
            收盤前提醒
          </span>
        </div>
        <h2 className="text-white font-bold text-base md:text-lg">
          收盤前，問自己三個問題
        </h2>
        <p className="text-white/40 text-sm mt-1 leading-relaxed">
          不是檢查帳面，是檢查今天的自己有沒有被市場牽著走。
        </p>
      </div>

      <div className="space-y-3 md:space-y-4">
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-forest-400 text-sm font-bold">1</span>
          </div>
          <div>
            <span className="text-white font-medium text-sm">今天有沒有因為市場很熱就追高？</span>
            <p className="text-white/50 text-sm leading-relaxed mt-0.5">
              如果早上看到大漲就衝進去，這不是策略，是反應。明天記得回來看今天這個衝動的結果。
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-forest-400 text-sm font-bold">2</span>
          </div>
          <div>
            <span className="text-white font-medium text-sm">今天有沒有把新聞情緒當成操作依據？</span>
            <p className="text-white/50 text-sm leading-relaxed mt-0.5">
              新聞是市場情緒的放大器，不是你的策略。今天有沒有因為某條新聞就改變了原本的想法？
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-forest-400 text-sm font-bold">3</span>
          </div>
          <div>
            <span className="text-white font-medium text-sm">明天如果開盤反向，我是否還能接受今天的決定？</span>
            <p className="text-white/50 text-sm leading-relaxed mt-0.5">
              這是最重要的問題。如果你的決定會讓你明天睡不著，那今天就不該做。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}