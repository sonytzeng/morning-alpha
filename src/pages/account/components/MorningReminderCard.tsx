export default function MorningReminderCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-8">
      <div className="flex items-start justify-between gap-4 mb-4 md:mb-5">
        <div>
          <h2 className="text-white font-bold text-base md:text-lg mb-1">LINE 每日提醒｜公開測試中</h2>
          <p className="text-white/40 text-xs md:text-sm leading-relaxed">
            已加入測試名單的使用者會在交易日收到盤前重點與當日完整報告連結；正式付費方案尚未開放。
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
          公開測試會持續驗證 07:30 盤前送達、同日冪等與內容品質。若當日資料不完整，提醒會明確降級，不以固定模板假裝完成分析。
        </p>
      </div>

      <span className="inline-flex items-center gap-2 px-5 py-3 bg-white/5 text-white/30 text-sm font-medium rounded-xl whitespace-nowrap w-full justify-center border border-white/10 opacity-50 cursor-not-allowed">
        <i className="ri-line-line"></i>
        公開測試中
      </span>

      <p className="text-white/15 text-xs text-center mt-3">
        正式訂閱開放時間將於網站公告
      </p>
    </div>
  );
}
