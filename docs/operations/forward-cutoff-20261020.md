# C Forward 截止修復：同一交付候選中的限定 Worker 發布包

## 真實現況與根因界線

10/20 晨間驗收的純彙總查詢於台北09:37取得終態：C Run EXPIRED，152次 invocation，cursor1358/plan1358，source tasks1360/saved1358，source_revision=null，Prediction0、Outcome0；終態時間09:00:44.52989，原因 LATE_ACQUISITION_NOT_FORWARD。兩筆未保存來源的原因未由核准的最小查詢回傳，維持 UNKNOWN；完整計畫進度不是完整資料證明。

正式 V1 同日報告仍為72/0/72（Universe/Evaluated/BLOCKED）；READY/WATCH/NONE皆0。六個重疊缺口各72，不能說成72檔全部評估後不合格。正式頁重新載入後顯示10/20摘要，三個期間皆無可公開觀察。C探索性研究、正式V1、會員Published及投資績效是不同結果。

動態時鐘控制已重現「聚合／鎖定工作跨過截止」的可達風險；沒有足夠自然時序證據指認該152次Run的實際慢段。先前短收據的版本文字不能證明per-run欄位：本次已核准最小查詢沒有讀該欄位，正確結果為 UNKNOWN_NOT_QUERIED；V4 ACTIVE及44/44是另一次正式來源唯讀核對。

## 最小實作，不改策略

只有 `src/features/vnext/dailyRuntime.ts` 改變正式執行閉包：

- 在原09:00前預留180秒操作準備，不延長actionable cutoff、不降低研究條件；45秒聚合准入、20秒階段及5秒寫入預算是排程保護，不保證無界延遲能成功。
- 以已保存且不可變的acquired checkpoint續跑，避免每次重做全部來源聚合；缺資料仍明確不足。
- 獨立review重現首個attempt只有request_hash、未保存acquired會令續跑版本衝突；首次attempt-before-work現同時固定已組合快照，後續仍經原資料驗證，不把封存當品質通過。舊key-only狀態明確拒絕，不猜測截止時間或重置attempt。
- 階段邊界重新查時間；SQL仍為新Prediction提交的最後時間否決者，不回填或改寫Forward。
- 成功提交即標記已鎖；回覆跨截止不把既有合法提交誤標成新晚插。
- 原Canonical等待、過期後合法快取bootstrap、prepared exact replay、既有Lease fencing及獨立Outcome sweep保留。

BLOCKED回覆本身 `continue=false`。第二次重領必須是下一個既有且合法的同日Lifecycle Caller；新控制不假裝有立即自動續跑。原SQL允許BLOCKED重領，COMPLETE/EXPIRED無成熟Outcome則拒絕，日期及512次上限不變。

## 驗收證據

[實際晨間彙總、隔離SQL/HTTP及限制](evidence/forward-cutoff-acceptance-20261020.json)；[正式Worker4逐檔唯讀指紋](evidence/worker4-exact-readback-20261020.json)。

Fresh DB／真實PostgREST測試通過：原子提交、late veto、100秒Lease／fencing、RLS、匿名與Free/Premium拒絕、Owner RPC、崩潰及失聯回覆後exact replay、成熟Outcome、append-only及回復保留稽核。只有本機控制時鐘／合成身分；不是Production Auth、自然Forward或報酬證明。專用容器已清除。

原有Recovery及cold-source功能斷言不刪；新的動態時間控制在當前來源執行。舊來源封存斷言仍固定在7bfc完整執行，先驗當前完整composition。原SQL、Auth、Caller、Producer16、Reader57、LINE71及策略門檻逐位元未改。真實retained大型聚合效能尚未實測；操作預留不是Production SLA。

## 精確發布範圍與相依

本修復與官方來源工程收斂於同一Draft PR，避免兩套composition互相衝突。完整來源封存是 `core-member-integration-20261020-official-public.json`，不是全量部署清單。官方財務／公告runner與PR281 Observation入口不在此Worker payload，也不啟用正式來源准入或會員發布。

[固定release catalog](../../scripts/operations/forward-cutoff-20261020/release-catalog.json)與materializer以本機Git固定7bfc組回正式Worker4的78項payload／44項runtime，再只替換dailyRuntime。SDK固定2.57.4、verify_jwt=true、import_map=false；34項static/license/type依賴及順序完整保留。candidate／recovery都先驗當前完整來源，source drift、mode drift、未知檔或catalog漂移即拒絕。

僅供Owner具名核准的動作：精確HEAD Ready／Merge，以及單一 `vnext-daily-research-v1` payload部署。沒有Migration、新Auth入口、Caller／Cron／Secrets、Producer／Reader／LINE、會員政策、研究公開或付款變更。

## 發布前、Smoke、停止條件

重新核對main、候選HEAD／CI、Production Worker4 version/ESZIP/44-source及另外四支受保護Function指紋；任一漂移或無法安全回復，停止，不自動擴範圍。

發布後只驗ACTIVE、JWT、完整來源、既有權限及無憑證負向拒絕，不人工執行研究、Provider、Report或LINE。Auth實作與既有R7正負向來源完全相同，可按逐位元證據沿用；不重建臨時Smoke入口、不要求Owner搬Token。正向自然執行與新Forward／成熟Outcome必須待下一個合法自然批次，不能以隔離216筆不足判斷當正式成功。

只有取得精確發布核准且實際部署後，才依核准範圍設定自然追蹤。原10/20失敗monitor已終態停止；現在沒有宣稱新的背景研究驗收在進行。五日穩定維持0/5，付款DISABLED。

## 精確回復

recovery是已唯讀核對44/44的Worker4 candidate source/dependencies payload，SHA256 `34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762`；不是Worker3 recovery。原實體ESZIP為 `91bf73939e5dfde0740f7ba1ebf43830789d08b46cc1f8885583e451764501db`；功能等效重建不冒稱實體ESZIP逐位元一致。

重大Auth、資料隔離、重複Prediction或核心服務異常時停止新發布／驗收，依具名核准回復這單一Function，保留Schema、來源、Prediction、Outcome及Audit。不刪資料、不reset/rearm舊Run、不改Cron／Secrets／權益，不補跑10/20。

隔離Commit／Push／Draft PR由既有Owner工程授權執行；本文及候選PASS不構成正式Merge或Deploy核准。股票原始完整交付仍未完成。
