# VNext 驗收矩陣
|Master範圍|候選證據|目前限制|
|---|---|---|
|0/1/2 baseline/protectedcore|Git cleanbranch、PR103/225 metadata、schema/Function唯讀清單|ACTIVE非自然E2E|
|3 memberfront|四入口隔離UI；Today/Academy重用links|Production route不變|
|4 horizons|per-family contract＋tests|真實中長期證據不足|
|5 events|dedupe/version/PIT tests|自然ingestion未啟用|
|6 graph|relation/PIT/revenueexposure tests|真實關係未核准|
|7 licenses|官方條款+既有rights缺口|Fugle商用/再散布待證|
|8 schemaRLS|candidateSQL+isolatedAuth DB suite 13組PASS；8表forcedRLS|僅本機真實Auth測試身分，非ProductionOwner|
|9 FrozenV1|精確PR103pin+dependencyadapter|未merge，不改老師threshold|
|10 validation|cohortcompare/split gate|no realOOS/forwardresults|
|11 academy|PR225/228/229已完成成果沿用|Free/Premium正式E2E pending|
|12 publication|TS+SQLfailclosed|正式approvalproducer禁用|
|13 UIa11y|預定375/390/430/768/1440|待本輪browser證據|
|14 stagedrelease|RELEASE_PLAN|不含正式發布核准|
|15 resume|EXECUTION_CHECKPOINT|每階段更新|
|16/17 testsCI|28/28核心契約PASS；Deno核心PASS|完整typecheck/lint/build/Integrity受既有iCloud來源檔阻擋；最新CI待執行|
|18/19 safety|無Prodwrite/noMerge/rollbackplan|越界停止相關部分|
|20 deliverables|12份文件+source/tests/DraftPR/Preview|DraftPR待建立|
|21 success|逐項實證，不合併成假PASS|CONTINUOUS_IMPROVEMENT=NOT_OPERATIONAL|
|22 execution|本輪持續至所有安全項目完成|最後依實際證據更新|

測試Fixture明確SYNTHETIC；實際本機Auth帳號不等於Sony正式ProductionOwner。
策略工程測試不證明投資策略有效；BACKTEST_VALIDITY=INSUFFICIENT，SIGNAL_EDGE=UNPROVEN。
