# Morning Alpha 產品升級計畫
## V2：從「AI 市場摘要網站」升級為「每天陪使用者做決策的 AI 盤前軍師」

### 產品定位

**不是**「股票資訊網站」
**不是**「數據 dashboard」
**是**「每天盤前陪你冷靜下來的 AI」

核心價值：
- 每天早上 07:30，使用者打開後得到「今天該怎麼做」
- 不是給更多資訊，而是幫你消化市場焦慮
- 像一個真正有經驗的盤前軍師在提醒你不要犯錯

### 整體風格

- Premium
- 神秘
- 冷靜
- 像看過很多市場循環的人
- 不浮誇、不喊單、不報明牌
- 不像投顧老師，更像真正成熟交易者

### 技術架構

- React 19 + Vite + TailwindCSS + TypeScript
- Supabase (已連接): daily_reports, reports, market_data, push_logs
- Supabase Edge Functions: cron-generate-report, fetch-market-data-v10, fetch-global-market-news, generate-daily-report-v7, opening-market-radar, close-market-review, Generate-Sector-Rotation, line-daily-push, line-webhook, market-source-health-check, push-stats
- OpenAI GPT-4o-mini 生成每日盤前簡報

---

## 升級模組清單

### 一、首頁 Hero 區塊升級
- 「今日 AI 一句話」成為 Hero 中央最大區塊
- 大字体、具有情緒感
- 黑底玻璃感、微發光
- 每天更新、Premium quote feeling

### 二、新增「今日策略」模組
- 適合：✔ ETF 分批、AI/半導體觀察、拉回低接、保守布局
- 避免：✘ 開盤追高、情緒單、重壓單一股、看到漲停就衝
- 真正盤前策略感、行動指南感

### 三、升級「今天不要做的事」
- 核心特色區塊
- 情緒價值、投資心理學感、分享性
- 深紅警示感但 Premium、不廉價

### 四、新增「今日觀察族群」
- 名稱 + AI 簡短觀察 + 是否過熱 + 是否適合追
- 不像 tag，像真正盤前觀察名單

### 五、/report/today 重構
- 從資料展示頁 →「AI 每日盤前簡報」
- 結構：今日一句話 → 市場情緒 → 今日策略 → 不要做的事 → 觀察族群 → 信心分數 → 昨天vs今天 → AI 判斷理由

### 六、OpenAI Prompt 升級
- AI 更像投資軍師、盤前教練
- 更有情緒感、行動建議、陪伴感
- 禁止空泛摘要、財經新聞語氣、機器感
- 每次生成內容不能太像昨天

### 七、AI 人格定義
- 冷靜、理性、不追高、重視風險
- 像看過很多市場循環的人
- 語氣像每天早上提醒你的 AI

### 八、分享與黏著度優化
- 每個金句卡片：複製、分享到 Threads/X、分享圖片
- 分享卡片自動生成黑底 premium 圖卡

### 九、Dashboard 升級
- 從「設定頁」→「AI 每日陪伴中心」
- 連續觀看天數、本週市場情緒變化、AI 最常提醒什麼
- LINE 推播偏好、今日 AI 提醒紀錄

### 十、全站 responsive + build 驗證
- Desktop/mobile 無 overflow
- 卡片不跑版、字體不過小
- 手機版優先
- Build 後檢查所有頁面

---

## 資料結構調整

### 新增欄位 (reports / daily_reports table)
- `today_quote`: string - 今日 AI 一句話（金句）
- `today_strategy`: string[] - 今日策略（適合做的事）
- `today_avoid`: string[] - 今日避免策略
- `watch_sectors_detailed`: JSON[] - 觀察族群詳細（含過熱判斷）
- `ai_psychology`: string - AI 心理提醒
- `ai_retail_reminder`: string - AI 對散戶提醒
- `ai_confidence_reason`: string - AI 為什麼這樣判斷

---

## 執行進度

- [x] 建立 project_plan.md
- [x] 更新資料型別 (types/report.ts)
- [x] 升級 Edge Function OpenAI Prompt (V2 Morning Alpha 人格)
- [x] 重構首頁 Hero (今日 AI 金句為核心視覚)
- [x] 新增今日策略模組 (TodayStrategyCard)
- [x] 新增今日觀察族群模組 (TodayWatchSectors)
- [x] 新增 useShareQuote hook (複製/X/Threads/圖卡)
- [x] 重構 /report/today 為 AI 盤前簡報
- [x] 升級 Dashboard 為 AI 每日陪伴中心
- [x] 升級 Account 頁面 (新增快速入口 + 更新文案)
- [x] Responsive + Build 驗證

---

## V2.5：盤後驗證顯示 (2026.06.06)

### 新增功能
- **首頁盤後驗證小卡**：在 Today Snapshot 區顯示最新 close_market_reviews 的驗證結果、實際市場結果與解讀
- **信任中心升級**：/verification 讀取最近 7 筆 close_market_reviews，顯示四張統計卡（盤前命中、盤中修正成功、防守日命中、AI 失準提醒）+ 最新驗證詳情
- **歷史報告驗證標籤**：/reports 每張報告卡顯示對應的驗證結果標籤（命中/修正成功/失準/樣本累積中）
- 資料不足時顯示「樣本累積中」而非假數據
- 使用 report_date（台北日期）對應資料

### 技術細節
- 新增 `src/services/closeMarketReviewService.ts`：型別定義、mapper、資料查詢函式
- `CloseMarketReview` 型別對應 public.close_market_reviews 所有欄位
- `loadHomeDashboardData()` 並行載入盤後驗證資料
- `useHomeDashboard` hook 加入 close_market_reviews Realtime 訂閱
- 批量查詢最佳化：`getCloseMarketReviewsByDates()` 一次取多筆日期對應資料

### 資料來源
- public.close_market_reviews（由 close-market-review Edge Function + cron-job.org 自動產生）
- 以 report_date 為主鍵對應 reports 日期

---

## V2.6 — 盤前作戰室 /war-room 補齊一眼看懂 + 盤後驗證 (2026-06-06)

- WarRoom 新增「一眼看懂」今日狀態 banner（防守日/等待日/進攻日/高風險日）+ 07:30/09:15 時間線
- WarRoom 接上 close_market_reviews（getLatestCloseMarketReview），顯示盤後驗證 badge + 收盤結果 + 驗證說明
- WarRoom 資料完整度從「X/Y 類」改成白話（完整/中可信/偏低/等待中）
- WarRoom top bar 數字標籤加「AI判斷」前綴，避免誤導成市場分數

---

## V3：前台產品化改版 (2026.06.13)

### 目標
- 公開頁瘦身：首頁 5 秒內看懂市場方向
- 會員價值重排：5 個模組清楚展示會員每天多看到什麼
- 提高付費訂閱轉換
- 技術資料只留 /admin/system-health

### 三層頁面結構
1. **公開訪客層**：首頁、今日免費摘要、部分今日判斷
2. **會員內容層**：完整盤前腳本、影響鏈、盤中追蹤、收盤驗證、完整報告
3. **管理者檢查層**：/admin/system-health，放完整技術檢查、資料來源、cron、symbol、品質驗證

### 修改內容
- 首頁 Hero 保留 4 重點：市場方向、今日一句話、今日不要做、CTA
- 新增 3 信任標籤：真資料生成、每日 07:30 更新、收盤後回測驗證
- 移除 DataTrustRadar 與技術資料來源標註
- 合併「為什麼值得訂閱」「收盤驗證價值」「早鳥訂閱」為單一價值區塊
- 會員預覽改名「會員每天會多看到什麼」
- /report/today 隱藏公開版技術欄位（confidence_score, quality_score, data source footnotes）
- /war-room 標題改為「盤中追蹤」
- 全站 CTA 統一為「解鎖完整盤前判讀」「加入早鳥通知」「查看今日免費摘要」

### 文案定位
- 不是報明牌，是盤前判斷流程
- 不只看漲跌，而是回看盤前假設、盤中追蹤與收盤驗證是否一致
- 每天 07:30 給你一套市場導航，讓你少一點情緒交易
- 會員版不是多幾則新聞，而是完整拆解「為什麼、看哪裡、錯了怎麼辦」

### 修改檔案
- src/pages/home/page.tsx — Hero + 信任標籤 + 非交易日提示 + 會員預覽重命名 + 合併底部區段
- src/pages/report/TodayReport.tsx — 隱藏技術欄位 + 信任標籤 + 移除 data source footnotes
- src/pages/war-room/WarRoom.tsx — 標題更新為盤中追蹤