export default function AdminSettings() {
  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-foreground-900 font-bold text-lg">設定</h1>
        <p className="text-foreground-500 text-sm mt-0.5">目前顯示規則說明</p>
      </div>

      {/* 目前顯示規則 */}
      <div className="bg-white border border-background-200 rounded-xl overflow-hidden divide-y divide-background-100">
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-foreground-800 text-sm font-medium">會員預覽</p>
            <p className="text-foreground-500 text-xs mt-0.5">在前台顯示會員版內容預覽區塊</p>
          </div>
          <span className="px-2.5 py-1 bg-emerald-500/8 text-emerald-600 text-xs rounded-full border border-emerald-500/20 flex-shrink-0 whitespace-nowrap">目前前端固定顯示</span>
        </div>

        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-foreground-800 text-sm font-medium">付費預告</p>
            <p className="text-foreground-500 text-xs mt-0.5">在前台顯示「早鳥名單即將開放」付費預告</p>
          </div>
          <span className="px-2.5 py-1 bg-emerald-500/8 text-emerald-600 text-xs rounded-full border border-emerald-500/20 flex-shrink-0 whitespace-nowrap">目前前端固定顯示</span>
        </div>

        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-foreground-800 text-sm font-medium">非交易日提醒</p>
            <p className="text-foreground-500 text-xs mt-0.5">非交易日在前台顯示提醒橫幅</p>
          </div>
          <span className="px-2.5 py-1 bg-sky-500/8 text-sky-600 text-xs rounded-full border border-sky-500/20 flex-shrink-0 whitespace-nowrap">目前自動判斷</span>
        </div>

        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-foreground-800 text-sm font-medium">Reels 腳本入口</p>
            <p className="text-foreground-500 text-xs mt-0.5">在後台導覽顯示腳本 / Reels 頁面</p>
          </div>
          <span className="px-2.5 py-1 bg-emerald-500/8 text-emerald-600 text-xs rounded-full border border-emerald-500/20 flex-shrink-0 whitespace-nowrap">目前後台顯示</span>
        </div>
      </div>

      {/* LINE 推播狀態說明 */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <h3 className="text-foreground-900 font-semibold text-sm mb-3">LINE 推播狀態說明</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-foreground-600">Morning Alpha LINE 官方帳號</span>
            <span className="text-foreground-400 text-xs">由 LINE Developers 管理</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-foreground-600">每日推播排程</span>
            <span className="text-foreground-400 text-xs">
              由{' '}
              <a href="https://cron-job.org" target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:text-primary-600 underline">
                cron-job.org
              </a>
              {' '}管理
            </span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-foreground-600">推播狀態確認</span>
            <span className="text-foreground-400 text-xs">請至 cron-job.org 或 LINE Official Account 後台確認</span>
          </div>
        </div>
      </div>

      {/* 提醒 */}
      <div className="bg-background-50 border border-background-200 rounded-xl p-4">
        <p className="text-foreground-400 text-xs leading-relaxed">
          <i className="ri-information-line mr-1"></i>
          這些設定目前為前端顯示規則，若未來需要永久設定，需建立後端設定表。
        </p>
      </div>
    </div>
  );
}