# C Worker R2：型別與冷啟動截止修復（2026-10-19）

R1 `5109221ae1c70405d735e7f3cffa3430a6c888fc` 的正式 CI（run39182810268／job117838988137）在 Worker entry fetch callback 的 `u`／`i` 回報 TS7006。固定本機 mjs 沒有舊遠端 d.ts 的 contextual type。本輪只補 `u:Parameters<typeof fetch>[0]`、`i?:Parameters<typeof fetch>[1]`；TypeScript 擦除後必須與 R1 entry JavaScript 完全相同，不用 any、不停用 check。

Root 同時觀察正式09:00市場已 COMMITTED11／11，但 C 反覆出現 cursor284、source286、FINISH QUEUED，再claim，09:01:51已62次 invocation。確切原因是 acquisition loop 只判斷 `now >= actionable−60秒`，過了09:00仍永久 break，未完成 plan 又 QUEUED，造成沒有進度的循環。

修正把這個 break 僅限於 **[actionable−60秒, actionable)**。08:59窗口仍鎖定真實 partial Forward；09:00及之後只繼續既有受限 cold-bootstrap plan，獨立的 `< actionable` PREDICTIONS guard完全不變。無lock、plan完成後仍以 EXPIRED／LATE_ACQUISITION_NOT_FORWARD結束，不補造晚到Forward。八次fetch上限、wall-clock budget、source reservations、retry、403拒絕、SQL lease/fence與FINISH不確定回復、既有216lock重放及到期Outcome優先全部保留。

新增真實runner合成回歸，用20個既有 PRICE plan task，分09:00／09:01／09:02三次 invocation：cursor必須單調前進、每次最多8fetch、無重複URL、收據保持新時間、PREDICTIONS與CHECKPOINT均0，最後 EXPIRED、不再繼續。原08:59:15 partial216斷言保留，另核對08:59:00與08:59:59.999；原prepared-lock／Outcome與lease拒絕測試不刪。

R2仍只有74個部署來源。Repair相較R1只改 entry 型別與 runtime cutoff條件；固定SDK Recovery仍使用原核准5f runtime／handler，僅共享entry型別字串變更。15個SDK、30個notice、其餘來源及兩個現行global V1修復都不回退。R1 catalogue、兩份args、338列 seal與原FAIL紀錄保持；R2使用獨立catalogue與ignored輸出路徑，不能覆寫R1產物。Recovery不是修復分支、原29或server ESZIP的bit-identical版本。

本機沒有Deno binary；依官方安裝文件只嘗試一次固定npm `deno@2.9.7` 到ignored工具目錄，結果ETARGET版本不存在後停止，沒有改版本或重試。**不宣告本機Deno通過**，真正Deno check仍須新精確HEAD的正式CI驗證。固定Node22的15項package／SDK控制已通過；最終runtime／歷史guard為 **93／93通過、0失敗／跳過**，含兩個08:59邊界與23項runtime測試；type-check／lint／build通過。獨立六source有限review沒有具體finding，並明示不含Deno或successor seal；不是正式Security scan。完整指紋見evidence JSON。

新342列 composition逐byte凍結R1的338列前版，不自含top，八個授權旗標false，B24及24項網站guard不變。沒有手動POST、暫停Cron、reset、部署、SQL、Secret、Auth／RLS、正式會員、Caller、公開研究、LINE或付款操作。合成時鐘／RPC不是正式自然驗收或process hard-kill保證；原遠端SDK診斷FAIL與一次guard拒絕均保留，不reset／rename／rearm。
