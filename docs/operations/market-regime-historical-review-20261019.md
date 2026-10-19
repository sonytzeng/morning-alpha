# 市場狀態歷史發布包驗證修正（2026-10-19）

PR #268 首個 HEAD `77888f0ed88648790179d00bd511682721fae67f` 的遠端整合 CI 在 `ownerReleaseReviewPackage.test.mjs:81` 失敗。原 R8 Reader 發布目錄仍正確要求歷史 model SHA `7eb821c30d873516ebd73aee3c171352eb93af4034218f36d8f3972f140b24d0`；測試卻直接讀到已另行准入的新 canonical-regime model SHA `9f99fd79e0dcbf1e10fcfabd12896230f4d77ca5a30c3f3560f50af45dc4684e`。這是歷史發布包測試讀取接線缺漏，不能修改原 R8 目錄、移除斷言，或把原失敗改稱通過。

本輪只把精確 `src/lib/publicMarketReadModel.ts` 路徑加入既有 `decision-v1-evidence.ts` 歷史讀取分支。測試先執行完整 `verifyIntegrationCandidate()`，再以 `integrationHistoricalRead('core', name, rawRead(name))` 還原不可變 `bc48d784487fd5ae63ac2bb9c28d9343de41034f` 的 bytes。所有原斷言保留；現行 model 仍由新 seal 與 projection tests 驗證。歷史 adapter 僅在輸入吻合新 seal 時還原，並重查實體 bytes／mode；注入錯誤或未知路徑不得被乾淨歷史 bytes 覆蓋。

前版 281 列封存 SHA `88ddad7247dd98ab1cfe508b32ed39ac21e87e172b359527211ad8fcba52e2fd`、原修復說明及 review 全部不變。新 helper 逐 byte 比對該 seal 與首個 HEAD 保存版本；後繼 top 精確 284 列，只新增前版 seal 與本輪兩份文件，不自含自身。B24 實體 guard、24 項網站來源、三個凍結來源均不修改；四個已列入 scope 的 SDK CI 來源另有下述平台更正，八個發布／權益／付款旗標維持 false。

驗證結果另列於同名 evidence JSON；本輪重跑 Owner R8 package、integration、member continuity、frontend type closure 與 projection tests。產品 Runtime／TypeScript 來源完全不變，type-check／lint／build 沿用原封存通過結果，不冒稱本輪重新執行。首次遠端失敗（run `39179779491`／job `117829867772`）持續保留，新本機測試結果不代表該次 CI 已成功。固定 Node `22.14.0` 的最終來源五組測試為 **57／57 通過、0 失敗／跳過**，更新後 SDK 離線控制另 **26／26 通過**，均保留完整本機 log 指紋。Node `24.19.0` 初次五組測試另為 57／57 通過，不加總為獨立案例。

Root 與 R8 reviewer 另發現初版 SDK workflow 在 job env 使用不允許的 `runner.temp` context。精確更正把該值移到執行 step env，artifact 路徑移到 step with，並將 workflow、plan、checker 與測試的 action 一致改為 `synchronize`，讓這次實際來源修正 push 能觸發平台驗證。workflow 路徑、display name、plan ID、run1／attempt1、68 個固定項目、URL／hash／限流均不變；若平台已消耗 run1，新 run2 會在任何 HTTP 前拒絕。R8 的 `CI_WORKFLOW_SEMANTIC_CORRECTION_REVIEW_SAFE.json`（SHA256 `e371e506f67528f5652986d694c3b26d37bfa84032f1490033126f00d29d779a`）明確取代舊 workflow 可執行性的判讀；原 YAML parse 與離線控制未驗證平台 context 位置。前版四檔保留於不可變 HEAD，原失敗不改寫；沒有 run 紀錄不代表尚未消耗、fresh bytes 通過或部署成功。

本輪沒有改名、刪除、重建或重設一次 SDK fresh workflow，沒有 Commit／Push／部署、SQL、Auth／RLS、Cron、Secrets、正式會員權益、研究公開、LINE 或付款操作。此修正只恢復歷史驗收的正確來源讀取，不能宣告全功能或正式 E2E 完成。
