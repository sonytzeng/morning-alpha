# Owner 市場型態標籤修復

Owner cockpit 使用另一份舊標籤表，未識別既有 Producer 的 `stress`、`volatile_range`、`risk_on_trend`、`risk_off_trend`，把已知市場型態顯示為尚未確認。本次只將該標籤查詢改用已上線、未改動的 `PUBLIC_REGIMES`，保留既有 `trending`、`volatile` 舊值相容與未知值拒絕推定。既有市場結論、進場策略、股票評估、會員權益與資料契約不變。

基準 `a3602de17198dd9b769a16671ed97c4763e21cd8`。網站操作只有 `src/features/research/cockpit.ts` 一檔，原 UI 元件與中央 read model 的 bytes 保持不變；`tests/ownerCockpit.test.mjs` 增加實際元件 SSR 回歸，包括四個現行市場型態與未知值。測試 fixture 不代表 Production E2E。

新 cumulative source seal 為 `core-member-integration-20261019-owner-regime-display.json`。前一層 priced-in seal、全部歷史 manifests、原 source guards 與歷史 assertions 保持原 bytes。新單檔交付 catalogue 是 `owner-regime-display-20261019.json`；兩者均不授予部署、權益、來源准入、公開研究或付款授權。

原 B24 type-only 與 Owner copy assertions 必須繼續證明它們原本的實體來源，不能把這次 runtime label 變更說成 type-only。CI 先驗證完整當前 source seal 與當前負向測試，再以 credential persistence 關閉的固定 `a3602de17198dd9b769a16671ed97c4763e21cd8` checkout 執行五份歷史來源／type-only tests 與原 B24／Owner copy source archives。這些測試及原斷言未刪除、未跳過、未修改。其結果只表示歷史 package 回歸。

當前 `ownerCockpit.test.mjs` SSR、新單檔 source admission／負向測試、全專案 TypeScript、Lint、Build 及既有非歷史測試繼續在當前 checkout 執行。新的 Owner regime source archive 亦從當前實體檔案建立，與歷史兩份 archives 明確分開。既有 `6c89db33ade7b8f3a57e00da6708afe1958ed8f6` Worker／quarter artifacts 的固定 checkout、封裝與檢查範圍完全不變。

這不補齊 V1 財務／共識／法人證據，不改任何推薦門檻，也不代表正式會員或股票完整交付已完成。回復只恢復此單檔的封存 preimage，不回復已另行發布的 Owner 文案或中央市場 read model。
