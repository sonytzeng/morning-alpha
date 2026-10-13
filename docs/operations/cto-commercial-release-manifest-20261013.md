# Morning Alpha 精確發布候選清單

本文件只供Sony核准；不表示已發布。PR#230保持Draft、付款TEST且DISABLED。

## A｜本次CTO UI候選

Git基線：PR#239 HEAD `4348efaff4514a43473d111950083799a23c79c2`；正式main `2a5d461ec3d98bfc8bc3177a295c95e299b7bda2`。

Runtime檔案只有：

- `src/features/decision-v1/DecisionBrief.tsx`：正式projection判斷信心與資料品質分開。
- `src/features/decision-v1/subscriber.css`：三指標布局、收合詳細資訊44px操作目標。
- `src/pages/report/TodayReport.tsx`：傳入正式confidence。
- `src/components/feature/Navbar.tsx`：會員方案入口，不假宣告試用已開始。
- `src/pages/pricing/Pricing.tsx`：付款停用與預定方案說明。
- `src/lib/performanceDirectionPresentation.ts`、`src/pages/performance/page.tsx`：只翻譯既有收盤方向，不改統計。
- `src/pages/account/components/MorningHeroCard.tsx`：重複頁面標題改為區塊標題，外觀不變。
- `src/lib/historicalReportCardPresentation.ts`、`src/pages/reports/ReportsCenter.tsx`：歷史卡正確使用市場方向，不以行動缺失誤標資料不足；不改共享正式projection。
- `src/lib/historicalReportEvidencePresentation.ts`、`src/pages/reports/ReportDetail.tsx`：只讀已保存Canonical確認／失效條件；移除依市場方向自行生成的09:15及固定門檻。缺失不補造，個股未發布不等於市場報告未完成，技術分數收合。不改正式Report或其發布規則。
- `src/pages/home/page.tsx`：相同正式句子去重、最新資料與報告產生時間標示分開。
- `src/pages/admin/scripts/page.tsx`：舊社群素材缺失不誤標正式LINE未接入；僅UI說明和標題對比，不改生成／Copy內容或Sender。
- `src/features/operations/commercialStability.mjs`：純候選驗收規則，沒有排程或Production寫入。

其他僅為直接測試、CI、隔離負載腳本、文件與精確完整性封存；SHA256見 `evidence/cto-commercial-transition-20261013.json`。不得以封存文件中的false變更為true代替Owner授權。

本候選沒有Migration、Edge Function、Secret、Cron、Auth/RLS、付款或正式策略變更。Merge及Readdy同步／Publish均需Sony对最新精確HEAD核准；不能整包覆寫Readdy。驗證1440/375/390/430、相同revision跨頁信心、缺資料與0值、試用不啟動、會員權益原樣。失敗回復上述UI與顯示映射到既有已知正常版，不刪資料，不改LINE。

## B｜PR#239獨立日曆修復

唯一SQL：`20261013073004_operational_acceptance_calendar_guard_v1.sql`；兩個既有Operational Acceptance函式重用正式台股日曆，將休市與coverage未知分類，保持判斷、LINE、Report品質規則不變。已隔離Fresh DB及CI，Production尚未執行。完整Manifest見Issue238交付 `PR239_RELEASE_MANIFEST.md`；不得混同本次UI核准。

## C｜推薦Reader／量覆蓋獨立Incident

已證明：正式get-report-payload讀Core quote而不是完整72檔股票Evidence，2330 quote與stock evidence同時段覆寫；部署依賴35/36一致，1個旧phase module差異非目前主因。修复需要具名涉及 `get-report-payload`、`decision-v1-data`／`decision-v1-evidence` 的資料選取／映射；仍在受保護邊界，不能自行以CTO授權修改。詳見既有 `REPORT_READER_EVIDENCE_INCIDENT.md`。即使修好，不得放寬Institutional TWD、Consensus等正式品質門檻，真缺口要獨立保留。

## D｜VNext最小自然Worker Release

來源PR#230 HEAD `a5c0ae5fc81661de87cb32e9ad9ebced2f394170`。

- SQL：`20261012054120_vnext_daily_research_runtime_candidate.sql`。
- 新Function：`vnext-daily-research-v1`。
- 必要既有非阻塞Lifecycle Hook與精確shared dependency：以已交付 `VNEXT_MINIMAL_RELEASE_MANIFEST.md` 的39檔指紋為准。
- 不新增Cron／Secret，不把歷史Replay變Forward，不自動公開會員內容。

需另切最小Release候選，不可直接Merge整包PR#230（含未核准member/payment schema）。Owner確認完整SHA、SQL、Function、權限、Data Licensing、回復後才能部署。

## 未核准內容

不含資料購買、TWSE／TPEx商業授權決定、29項會員研究公開、修改推薦門檻、金流啟用或真實交易。正式Free/Premium合法帳號未提供的驗收項目保留PENDING。Chrome新分頁已恢復Sony正式Owner，五頁後台、Cockpit三分頁及Academy完成1440/375/390/430唯讀驗收；沒有提交交易或學習資料，畫面證據在交付包。
