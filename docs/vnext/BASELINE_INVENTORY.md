# VNext 基線盤點
查證時間：2026-10-10 Asia/Taipei。Repository：sonytzeng/morning-alpha。
實際根目錄：project-11164666/p0-checkpoint-atomicity。開始時 working tree 乾淨，舊分支 codex/academy-navigation-p0 比 origin/main 落後 1 個 merge commit。
沒有既有 VNext branch/checkpoint，故從最新 main 建立 feat/morning-alpha-vnext-integration。
基線 main：fff51d76a8e6c90768772023c37afbb112761a3a。origin/HEAD 指向舊分支，沒有把它誤當 main。

|功能|狀態|證據與限制|
|---|---|---|
|Academy V1.1|PRODUCTION_VERIFIED（Owner）；會員 E2E PENDING|PR225 merged 4fc31f3b4bd6c9c14863dd12a0861fb8bc7bc3c7，八項 CI SUCCESS；PR228/229 已合併，Readdy672 前輪實機記錄|
|Academy router/原創 PDF/7章14題/10章23題/進度|PRODUCTION_VERIFIED（既有驗收）|docs/academy/v11/ACCEPTANCE.md；候選不重製教材、不改 rights 或檔案指紋|
|Signal Lab Frozen V1|CODE_ONLY|PR103 OPEN DRAFT，568694f92072d049e35cd2d8fd148db6d3547154，原 validate SUCCESS；未合併，不能引用其舊 CI 宣稱本候選 PASS|
|Teacher Logic|CODE_ONLY / UNRESOLVED|私人研究候選，不公開私人講義，不接正式 Recommendation|
|Entry Opportunity|PRODUCTION_VERIFIED（部署清單）；分析價值 INSUFFICIENT|entry-opportunity-shadow-v1 V3 ACTIVE；已保存歷史與事前預測必須區分|
|Owner Trading Lab|PRODUCTION_VERIFIED（部署清單）|owner-trading-lab-v1 V9 ACTIVE；不碰交易與帳務|
|VNext events/graph/horizons|PREVIEW_ONLY / CODE_ONLY|本候選的隔離契約、RPC 與 UI；無 Production caller/公開入口|
|長期 OOS / Forward 優勢|BLOCKED|缺 250D 以上可得時間、歷史 Universe、完整公司行動與成熟 Outcome|
|AI coach|NOT_IMPLEMENTED / DISABLED|productFeatures.alpha_coach.enabled=false；沒有啟用新付費 AI|

既有每日日報、Market Decision、Premium、LINE、Provider、Public Projection、Closing、Learning、checkpoints 全部保留原檔案與正式判定。它們的每日自然結果不能由本次 UI/契約测试推定。
