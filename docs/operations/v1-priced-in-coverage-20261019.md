# V1 全 Universe 量測完整度修正

本次修復一個程式正確性問題：原 `priced_in` 完整度取自最後通過選股篩選的清單。某檔股票即使必要證據完整，只因四季基本面不符合原條件而為 NONE，或品質門檻未通過而為 DROP，也會使其他完整股票失去全 Universe 量價涵蓋與進場環境分數。

修正把已通過原必要資料檢查、且公告後量價可觀測的輸入，與最終選股清單分開保存。全 Universe 每檔都有完整可量測輸入時，`priced_in` 才採用同一個既有分數公式；個股仍依原基本面與品質門檻決定 NONE、DROP 或 READY。未取得或晚於截止的公告後成交量，仍令全 Universe 資料不完整並拒絕推薦。

沒有改動公式、數值門檻、四季資料完整度、公告前 Consensus、Guidance、事件因果、來源與截止時間要求，也沒有改變來源准入、會員內容或公開發布規則。這是 source-only 程式修正；沒有補造股票資料，也不能把三個合成回歸當作正式股票推薦或 Production E2E。

## 精確來源與歷史封存

基準為 `6c89db33ade7b8f3a57e00da6708afe1958ed8f6`。原 `core-member-integration-20261019-owner-quarter-live.json` 的全部 bytes、既有 manifests 與 assertions 保留。新 outer seal 是 `docs/operations/evidence/core-member-integration-20261019-priced-in-coverage.json`，逐項列出當前實體來源、mode、原始基線雜湊與來源類別；不把它自身納入雜湊。

新層仍先驗證完整當前來源與 inventory，才供既有歷史消費者讀取固定父版本。未知 path、任何來源或 mode 漂移、舊 manifest 修改與未列 baseline 修改都拒絕；注入的壞 bytes 不會被歷史 view 蓋成好資料。八個發布與權限旗標一律維持 `false`，這層不授權原 D／E 或四季私有捕捉發布。

## 驗證範圍

CI 的既有 V1 evaluator 步驟保留兩個原測試檔，並明列 `tests/decisionPricedInCoverage.test.mjs` 的三個回歸：完整 mixed fundamentals 不抹除其他股票量價、完整品質拒絕仍計入 Universe 涵蓋，以及缺失／晚到的公告後量測仍全域拒絕。`tests/integrationAdmission.test.mjs` 另驗證新來源、固定舊封存、未知 path、baseline 與注入 drift 均不被新層吞掉；原斷言全部保留。

兩個歷史 materializer 原本釘住舊 evaluator 的實體 bytes，以保證已封存 Worker 與 quarter artifacts 不會混入新邏輯。這些封裝器、catalog、assertions 與原 payload 全部不改。兩個 CI workflow 先在當前 checkout 執行完整 source admission 與 integrity tests，成功後才另外 checkout 固定 `6c89db33ade7b8f3a57e00da6708afe1958ed8f6` 至 `build/priced-in-historical-base`，關閉該 checkout 的 credential 保存；只在該固定目錄以 `npm ci --ignore-scripts` 安裝歷史測試依賴。舊 Worker 封裝／runtime，以及 quarter 封裝／runtime／四份 Deno／TypeScript，明確標為歷史 artifact 回歸並各自指定此目錄，不代表新 evaluator 已進入那些舊 payload。

當前 V1 三個新回歸、原 evaluator tests、current root Deno 與其餘 current source 檢查仍在目前 checkout 執行。沒有更改整個 job 的 working directory，也沒有用歷史 checkout 掩蓋目前來源漂移。CI 邊界測試核對固定 SHA、先驗 current source、歷史步驟範圍與新 V1 仍在 current root；這仍不是部署或來源正式准入授權。

本輪不執行 Deploy、Migration、Cron、Auth、RLS、會員權益、Secrets、Provider 寫入或研究公開。真實資料仍不足的股票繼續依原條件拒絕，不能保證一定產生推薦股票。
