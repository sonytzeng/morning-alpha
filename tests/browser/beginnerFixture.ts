// Synthetic test-only data, never a current report and never persisted remotely.
export const BEGINNER_FIXTURE = {
  todayDate: '2026-09-04',
  reportDate: '2026-09-04',
  action: 'ACT',
  premiumEligible: true,
  decisionMode: 'recommendations',
  isHistoricalFallback: false,
  stocks: [
    { symbol: '2330', name: '台積電（測試資料）', reason: '測試情境：用已確認的量價與相對大盤證據呈現長繁體中文，這不是今日投資建議。' },
    { symbol: '2317', name: '鴻海（測試資料）', reason: '測試情境：代表股與產業同步，仍需持續核對失效條件。' },
    { symbol: '3661', name: '世芯（測試資料）', reason: '測試情境：驗證第三張內容與手機文字換行，不代表正式推薦。' },
  ],
};
