# C Worker 固定本機 SDK 的可重現來源（2026-10-19）

這是 Root 選定的零遠端 SDK 技術候選與 Git 重現來源準備，尚未部署。新增 15 個已保存 SDK module 與 30 個 notice／license／provenance 靜態檔，只把 Worker entry 的精確 SDK import 改為本機固定路徑；entry 其餘 bytes 不變，不把候選 74 檔整包覆蓋 repository。

目前 global `decision-v1-evidence.ts` 與 `recommendation-official-actuals.ts` 的兩項 V1 新修復完整保留。Worker 原核准閉包需要的兩份舊邏輯只由 materializer 讀不可變 `5f33777836778e3600e4e377fcb3cf4de690fe80`；其餘來源逐檔讀 current repository，驗證精確長度與 SHA256。即使輸出舊邏輯，也會核對兩份 current 檔仍是新修復 hash。Git 子程序使用固定最小環境、禁止 lazy fetch／互動、停用 system/global config 並使用 `--no-replace-objects`，不以缺物件為理由抓網路。

Materializer 只接受 `repair`／`recovery` 固定 enum、固定 Git commit 與兩個 ignored build filename，不能傳 ref、來源 root 或任意輸出路徑。驗完整 74 個唯一檔案與整檔 fingerprint 後，以 `wx` 寫出；既有檔案不覆蓋，symlink 來源／輸出祖先拒絕。

| 變體 | 檔案 | 整檔 SHA256 | Bytes |
| --- | ---: | --- | ---: |
| repair | 74 | `a3b1c87f4532057f77355908e4c9ab5dc7de3e601e91aeb23363c2b69f13fd41` | 901300 |
| functional fixed-SDK recovery | 74 | `ec4b0f46a70bbbb7c3735bd70880746a3373860ef5db051afd4c04986b113610` | 899143 |

Recovery 只將 runtime／handler 換回同一核准 5f 的原 bytes，保留同一個本機 SDK import、15 個 SDK 與 30 個靜態檔。它是可操作的固定 SDK 功能回復，不是原 29 檔或 server ESZIP 的逐 byte 相同版。原 29 檔 rollback SHA `61fe22e2d966b76340f5c508344de2f89f22f7971f36a516c2218c112d1a89a9` 保留為歷史，仍依賴遠端 CDN；原 remote SDK 診斷 FAIL 完整保留，本輪沒有改 gate、改名、重設、rearm 或冒稱其 PASS。

固定 Node22.14 實測 15／15 通過、0 失敗／跳過：6 項包裝負向測試、1 項 runtime static／literal-dynamic 閉包檢查，以及同一已審 harness 的 repair／recovery 各 4 項真實 SDK 測試。兩版皆拒絕缺失／錯誤／Owner／browser identity，合法 internal 配無效 scope 為422且零 RPC，canonical publication wait 30秒只交接一次。模擬 FINISH 拒絕時，repair 等到 lease expiry 的101秒交接一次，recovery 保留原37秒停止、零交接。時間為加速合成時鐘，RPC／continuation 是合成 ports，不是正式 Gateway、Auth 或研究 E2E。

Runtime 測試沿用已審 harness，移除外部暫存路徑與遠端來源需求；使用專用 `.integration.mjs` 路徑及 VM flag，避免既有 `test:public` glob 無旗標載入 VM 而失敗，不跳過測試、不改既有 script。CI 增加兩個固定物化命令與 network-denied SDK 測試，原檢查全保留。Type-check／lint／build 本輪均通過；九組歷史 guard 回歸 **92／92 通過、0 失敗／跳過**；所有原 assertions 保留。獨立五檔有限 review 沒有具體 finding，另有6項實體拒絕反例通過；這不是正式 Security scan，也不把不同控制組加總為獨立案例。結果與 log 指紋列於 evidence JSON。

15 個 SDK 只有既有 import／export／literal dynamic import 字串機械轉成本機，原其他 bytes／comments 不變。28 份官方原文與9份 full license 保存。Storage 原 Apache2 LICENSE 與 MIT package metadata 都保留，不改寫差異；tr46 0.0.3 原始 upstream 沒有 full license text，保留原 MIT／author metadata，不替換其他版本，也不宣告法律完整性。30 個靜態檔不被 runtime import；平台 ESZIP 是否保留未用靜態檔尚未證明。

新 composition 以 2e 的284列 R2 seal 為不可變前版，逐 byte 驗證後加入精確來源，新的338列 scope／56個變更檔逐項列明，top 不自含自身，八個授權旗標維持 false，B24 與24項網站 guard 不變。所有歷史 assertions 保留；Worker entry 歷史視圖由現有 exact historical reader 在完整新 admission 後還原，不改成新 hash 來通過舊核准包。

本機 network preload 限制正常 fetch／HTTP／HTTPS／net／TLS／DNS 入口，不是 OS sandbox 或 escape-proof 保證。五個 literal fallback 邊只證明靜態閉包，未動態跑完所有 fallback；process hard-kill 後的恢復、平台 ESZIP、正式持續交接與完整研究結果都不能由本輪合成測試宣告完成。沒有部署、Secrets、SQL、Auth／RLS、Cron、會員權益、Caller、研究公開、LINE 或付款變更。
