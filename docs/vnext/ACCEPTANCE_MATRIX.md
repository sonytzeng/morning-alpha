# VNext 驗收矩陣
|Master範圍|候選證據|目前限制|
|---|---|---|
|0/1/2 baseline/protectedcore|Git cleanbranch、PR103/225 metadata、schema/Function唯讀清單|ACTIVE非自然E2E|
|3 memberfront|四入口隔離UI；Today/Academy重用links|Production route不變|
|4 horizons|per-family contract＋tests|真實中長期證據不足|
|5 events|dedupe/version/PIT tests|自然ingestion未啟用|
|6 graph|relation/PIT/revenueexposure tests|真實關係未核准|
|7 licenses|官方條款+既有rights缺口|Fugle商用/再散布待證|
|8 schemaRLS|candidateSQL+isolatedAuth DB suite 16組PASS；8表forcedRLS；原始PostgreSQL response前端解析PASS|僅本機真實Auth測試身分，非ProductionOwner|
|9 FrozenV1|精確PR103pin+dependencyadapter|未merge，不改老師threshold|
|10 validation|cohortcompare/split gate|no realOOS/forwardresults|
|11 academy|PR225/228/229已完成成果沿用|Free/Premium正式E2E pending|
|12 publication|TS+SQLfailclosed|正式approvalproducer禁用|
|13 UIa11y|375/390/430/768/1440無水平溢出；Owner/Free/Premium真實本機Auth；登出清除；鍵盤展開、來源連結、桌機/手機截圖|合成行情不是真實研究；Sony正式Owner尚待驗收|
|14 stagedrelease|RELEASE_PLAN|不含正式發布核准|
|15 resume|EXECUTION_CHECKPOINT|每階段更新|
|16/17 testsCI|30/30核心契約PASS；Deno、typecheck/lint/build PASS；iCloud阻擋已解除|PR230最新HEAD需重新驗證全量CI，不沿用舊HEAD|
|18/19 safety|無Prodwrite/noMerge/rollbackplan|越界停止相關部分|
|20 deliverables|12份文件+source/tests/DraftPR230；http://127.0.0.1:3220/vnext實際可用|loopback隔離Preview，非Production發布|
|21 success|逐項實證，不合併成假PASS|CONTINUOUS_IMPROVEMENT=NOT_OPERATIONAL|
|22 execution|本輪持續至所有安全項目完成|最後依實際證據更新|

測試Fixture明確SYNTHETIC；實際本機Auth帳號不等於Sony正式ProductionOwner。
策略工程測試不證明投資策略有效；BACKTEST_VALIDITY=INSUFFICIENT，SIGNAL_EDGE=UNPROVEN。

## Browser實際證據（2026-10-10）
股票觀察與產業頁於五個指定尺寸，document.scrollWidth等於viewport，主要元素無右側溢出。來源details預設收合、Enter可操作。免費中期Empty、Premium長期Empty、會員Industry Empty都由伺服器projection決定，不是前端隱藏。Owner Industry包含2個同事件版本及1個UNKNOWN關係。Academy連結打開原10章Premium頁面，原教學圖和題庫可讀；不重新宣稱既有Academy全部正式E2E。

## 尚未成立的最高Gate
DATA_QUALITY（真實多週期/PIT）、BACKTEST_VALIDITY、FORWARD_VALIDATION、OWNER_ACCEPTANCE、正式MEMBER_EXPERIENCE仍未PASS。Production metadata ACTIVE不能取代自然穩定性驗證；本輪未執行正式業務操作或匯出完整業務快照。CONTINUOUS_IMPROVEMENT=NOT_OPERATIONAL。
