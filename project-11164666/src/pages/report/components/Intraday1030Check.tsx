export default function Intraday1030Check() {
  return (
    <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
      <div className="mb-4 md:mb-5">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
            10:30 CHECKPOINT
          </p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
            <i className="ri-time-line"></i>
            盤中確認
          </span>
        </div>
        <h2 className="text-white font-bold text-base md:text-lg">
          10:30 前，只確認一件事
        </h2>
        <p className="text-white/40 text-sm mt-1 leading-relaxed">
          早盤最容易騙人的地方，是第一波很熱，但主流沒有延續。
        </p>
      </div>

      <div className="space-y-3 md:space-y-4">
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <i className="ri-cpu-line text-amber-400 text-sm"></i>
          </div>
          <div>
            <span className="text-white font-medium text-sm">半導體是否續強</span>
            <p className="text-white/50 text-sm leading-relaxed mt-0.5">
              如果台積電、聯發科早盤衝高後開始回落，代表今天盤前偏多訊號可能失效。
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <i className="ri-expand-right-line text-amber-400 text-sm"></i>
          </div>
          <div>
            <span className="text-white font-medium text-sm">主流族群是否擴散</span>
            <p className="text-white/50 text-sm leading-relaxed mt-0.5">
              如果只有單一族群強，其他都沒動，這種「獨強」往往撐不久。
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <i className="ri-arrow-down-line text-amber-400 text-sm"></i>
          </div>
          <div>
            <span className="text-white font-medium text-sm">指數是否開高走低</span>
            <p className="text-white/50 text-sm leading-relaxed mt-0.5">
              開高走低是盤前偏多劇本最常見的失效模式，不要追在第一波高點。
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 md:gap-4">
          <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <i className="ri-bar-chart-line text-amber-400 text-sm"></i>
          </div>
          <div>
            <span className="text-white font-medium text-sm">成交量是否放大但價格不跟</span>
            <p className="text-white/50 text-sm leading-relaxed mt-0.5">
              量增價不動代表多空激烈交戰，這種時候不要急著選邊站。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}