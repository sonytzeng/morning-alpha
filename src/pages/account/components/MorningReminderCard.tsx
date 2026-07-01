export default function MorningReminderCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-8">
      <div className="flex items-start justify-between gap-4 mb-4 md:mb-5">
        <div>
          <h2 className="text-white font-bold text-base md:text-lg mb-1">LINE 每日提醒｜暫緩開放</h2>
          <p className="text-white/40 text-xs md:text-sm leading-relaxed">
            Morning Alpha 目前優先補強資料源、盤前判讀與盤後驗證。LINE 每日提醒會在網站本體與資料品質穩定後再開放。
          </p>
        </div>
        <div className="flex-shrink-0 pt-1">
          <div className="w-10 h-10 bg-green-500/15 rounded-xl flex items-center justify-center border border-green-500/20">
            <i className="ri-line-line text-green-400 text-sm"></i>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <i className="ri-information-line text-white/40 text-sm"></i>
          <span className="text-white/40 text-xs font-medium">目前狀態</span>
        </div>
        <p className="text-white/30 text-xs leading-relaxed">
          現階段 Morning Alpha 以網站本體穩定、資料可信度與判讀品質優化為主，LINE 每日提醒將在這些基礎完成後再行規劃。
        </p>
      </div>

      <span className="inline-flex items-center gap-2 px-5 py-3 bg-white/5 text-white/30 text-sm font-medium rounded-xl whitespace-nowrap w-full justify-center border border-white/10 opacity-50 cursor-not-allowed">
        <i className="ri-line-line"></i>
        暫緩開放
      </span>

      <p className="text-white/15 text-xs text-center mt-3">
        開放時間將於網站公告
      </p>
    </div>
  );
}