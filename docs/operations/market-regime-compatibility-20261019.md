# 市場狀態讀取相容修復（2026-10-19）

10/19 的公開 Recorder 固定欄位輸入已有合法 `stress`、`publication_verified=true`、`FULL` 報告與完整 11 來源盤前證據，股票證據則獨立為 `BLOCKED`。舊 `PUBLIC_REGIMES` 不認得正式 Producer 的 `stress`，導致公開市場 read model 為 `null`。只把該輸入的 regime 改為舊有 `range` 即可建立 model，證明此例的拒絕原因是詞彙不相容；不能把它解釋成市場未發布或股票已可推薦。

本次只在 `src/lib/publicMarketReadModel.ts` 加入正式 `classifyMarketRegime` 已使用的 `stress`、`volatile_range`、`risk_on_trend`、`risk_off_trend`。五個歷史 wire 值及原標籤全部保留。方向、action、publication、canonical／member revision、原子 batch／proof、11 來源數、時序檢查、checkpoint、Closing 與 learning 邏輯均未修改。未知、大小寫不同、尾隨空白及原型名稱仍拒絕。合法市場模型可供 subscriber 顯示，但 V1 股票仍為 `BLOCKED`、推薦 items 仍為空。

10/19 輸入取自 capsule `8a6994f2-d3d1-4793-ae92-7517187d2666`，記錄時間 `2026-10-18T23:40:29.771728Z`。保存的是選定公開 contract 欄位，不包含報告正文、會員內容、headers 或憑證。subscriber envelope 與負向變異均為隔離測試，不能冒稱完整正式報告、網站或推薦 E2E。

`tests/helpers/coreContentOsCapturedReplay.mjs` 保留歷史實際 SDK `2.57.4`，只把 Git Reader 的精確 `https://esm.sh/@supabase/supabase-js@2.115.0` 映射至獨立安裝的同版 SDK；每個 handler 必須只載入一個精確版本。實際 handler 保留原 Auth／validator，只使用 loopback DB transport。CI 額外固定安裝 `@supabase/supabase-js@2.115.0` 並執行 20 項 projection tests，沒有升級產品 dependency 或改 lockfile。正式 Reader55 的部署來源另已包含 12 個固定本機 SDK module；此 CI 安裝不代表正式環境需要重新下載 SDK。

驗證分開計量：既有 165 項隔離 controls 通過；本輪 20 項 projection tests、三組 admission 共 30 項測試、完整 type-check、lint、build 通過；對上述三個凍結來源的獨立有限審查另有 43 項測試與 2,271 項 controls 通過，未發現具體可報告問題。這些控制組可能重疊，不加總成獨立測試數，也不是正式 Security scan 或 Production E2E，亦不涵蓋之後新增的 composition 或獨立 SDK CI 檔。原 165 控制報告中的 SDK mismatch 限制原樣保留；後續精確雙版本 helper 與 43 項實際 handler 測試另行證明相容修正。

本機驗證使用 Node `24.19.0`；既有整合 CI 目標仍為 `22.14.0`，本輪不把本機通過宣告成遠端 CI 成功。獨立 fresh SDK CI 固定為 `.github/workflows/c-worker-sdk-freshness-20261019.yml` 與 `scripts/operations/sdk-public-freshness-20261019/` 內的 checker、catalog、offline tests 三檔，只能在同 repository 的指定分支首個 PR opened event、run1／attempt1執行固定公開 URL GET／hash。63 個 canonical 加 5 個精確單跳 alias，共 68 個邏輯項目、最多 73 次 wire GET，不執行依賴程式、不讀 Secrets、不連 Supabase 或正式資料。root 已逐函式有限審閱此 checker，另以 `ADOPTED_FOUR_FILE_REVIEW_BINDING_SAFE.json`（SHA256 `1d8df6aec5b35158d0ecd8db3384699ca5209f04b9431ad92ccabf12aa4e2fbd`）綁定採用後四檔的精確 bytes；26 項離線控制測試通過，並非正式 Security scan。公開 CI 檢查尚未執行，不代表 fresh bytes、Supabase、ESZIP 或部署通過，原本機 FAIL 證據保留。第一次 workflow run 即使 preflight 失敗也視為已消耗；不得改名重設或自動 rerun。其他分支或 fork 的 job 直接 skip。

Composition 以 `2976f752679263aaaf8b03e2a9474be63b0c1c86` 的 271 列 lease-handoff seal 為不可變前版，逐 byte 比對舊 seal。新 top seal 只封存精確來源範圍，不把自身放入 files；八個發布／權益／付款旗標均維持 false。既有拒絕測試、B24 實體檔案 guard、24 項網站來源包與所有舊 seal 不變。獨立 SDK CI 控制檔由 root 指定精確路徑後才加入 scope，不用 pattern 或自動盤點擴大允許範圍。

本輪沒有 commit、push、部署、Migration、Auth／RLS、Cron、Secrets、會員政策、研究公開、LINE 或付款變更，也沒有本輪 SDK 下載。未宣告全功能上線或目前正式 Reader 已因本候選修復。未來若發布，仍須核對實際 Reader／網站閉包及正式讀取結果；回復只反轉這個精確 patch，不刪資料、不改既有研究或權益。
