# 10/20 C Worker CPU 修復候選

正式自然批次在07:53完成cursor1358/1358，但第151次執行停於ACQUISITION attempt1、completed[]、227-byte checkpoint、0 Prediction。Worker4 execution330bcb0f-7efd-4a27-a7d1-d747d065745d於07:53:38記錄CPUTime shutdown、CPU2582ms、memory199805514bytes；這證明CPU終止，不證明單一函式的精確耗時。沒有重設或人工重跑此批次。

固定唯讀統計：1358份已保存normalized receipts、24489rows、18484223 JSON bytes。這是metadata查核，未把來源內容下載到public Git。09:00仍為原Forward期限。

修改僅限既有C runtime計算：同一entry的canonical bytes只序列化一次，每股證據hash只算一次供原三期限共用；digest逐筆執行避免72份大型buffer同時存在。原snapshotHash、研究方法、hash格式及每筆lock hash不變。大型輸入使用既有CHECKPOINT先封存acquired，在原ACQUISITION／RESEARCH／ENTRY完成後分次續接；原lock／Outcome／publication順序保持同次完成。小輸入行為不變。

prepared acquisition保留原evidence_cutoff／snapshot_hash，後續不重讀SOURCES／ENTRY_SOURCE、不重取Provider；initial attempt保存也保留SQL已綁定acquired。已有key但未保存input的歷史中斷不重設、不重建舊request、不回填Forward。過09:00仍拒絕新鎖。沒有SQL／Cron／Auth／RLS／會員權益／付款／LINE變更。

隔離合成Node24工作量：72股×250bar、8662004byte input；原計算CPU5448.166ms，shared-entry候選1305.320ms，原完整216lock產生。這是本機單次診斷，不能當Edge CPU保證、Production Forward或真實股票推薦。新測試逐筆核對舊canonical hash、分段／一次執行216lock逐位元相同、input綁定、防重與截止拒絕。

前次本機回歸的原來源准入反例因新候選尚未封存正確拒絕，沒有關閉。另立完整current composition；Worker4封存與assertions保持不變，在精確7bfcfcd8來源執行。current product／hash／恢復／RLS控制仍在current HEAD執行。

目前候選尚未Merge／Deploy。必須完成精確HEAD CI、獨立安全審閱、實際Worker4來源再核對及唯一C Worker candidate/recovery封存後，才可在既有授權內發布。新原子Observation PR281維持Draft／NO-GO，D/E與會員公開HOLD維持；C216私有locks也不是正式推薦。沒有降低原始三期間品質、買資料或修改權利。

平台依據：https://supabase.com/docs/guides/functions/limits（10/20查核CPU2s／256MB）；changelog的未來TLS淘汰不適用此CPU終止。Markdown摘要入口讀取content-type失敗，已改讀官方HTML changelog；沒有更換SDK。

驗證中的失敗保留：最初新來源反例的巨大Buffer差異格式化造成測試process被OS終止(exit137)，已將本輪新增receipt檢查改為完整Buffer.equals加固定錯誤文字；比較仍逐位元，反例沒有移除。既有integrationAdmission.test.mjs的三項舊workflow精確字串斷言，在精確7bfcfcd8基線同樣失敗；本輪未改該檔，也不宣稱這三項PASS。新的current來源准入與舊Worker4四項完整原斷言另行執行。

獨立安全掃描未列PASS：目前通道能讀security-diff-scan主技能，卻無法讀取其要求的config-preflight.md，也未提供對應Security掃描工具。沒有建立空scan或自簽安全成功。先完成程式、原有反例與精確CI；在可用安全通道完成獨立審閱前保持Draft／不部署。這不是要求Owner重給既有一般修復授權。

第一版遠端HEAD a4944fe的actual-source-only工作有兩項原Worker4來源assertion失敗：季度artifact workflow仍在current CPU來源執行舊Worker4封存proof。修正該job選擇current CPU完整准入，並另外於精確7bfc checkout執行全部原Worker4四項proof。未改原assertions、Runtime、SQL或candidate/recovery bytes；新增workflow路由反例控制，失敗紀錄保留。

第二版a5c633f0的actual-source-only成功，但integration在Deno2.9.7找不到npm:@types/node而失敗；validate的原Atomic回歸在寫死2026-10-20的衍生資料過08:45後遭原截止規則拒絕。CI現在固定相同Deno2.9.7並明確使用全域cache解析（--node-modules-dir=none），不關閉型別檢查、不變更SDK或原發布bytes。Atomic只在原guard確認的隔離DB讀取當地明日建立合成衍生資料，保持原相對日期、秒數／quote epoch一致；保留歷史fixture、原SQL及所有邊界／缺值拒絕。正式環境不改時間、不補跑。新離線日期反例另驗跨年／閏日與歷史fixture不變。本機npm registry沒有Deno2.9.7包，該精確compiler須由新HEAD CI驗證，不能拿本機2.5.4冒稱2.9.7成功。

此增量本機5項日期／准入控制PASS，4項原Atomic row-contract控制PASS。第一次完整歷史premarketAtomicInventory診斷執行中修改了本說明、未同步新seal，得到6PASS／10FAIL，正確拒絕SOURCE_DRIFT；並非可列PASS的結果。先重新封存全部來源，再執行對應原檔，不修改或跳過其assertions。本機沒有Postgres／Docker；原DB回歸待新精確CI。Deno2.5.4使用新cache flag時遭本機registry連線拒絕，未當作compiler PASS；原2.5.4已完成的來源型別證據保留，不覆蓋新2.9.7待驗狀態。此增量Runtime三檔與candidate／recovery payload SHA均不變。

第三版1eda03cf已有12／13必要CI成功（另SDK hash工作為不適用skipped，不列PASS），原validate／Atomic DB與vnext-isolation均成功。integration已通過Deno2.9.7及原SDK／候選／回復型別檢查，最後停在R10舊B24來源封存仍要求舊contracts.ts指紋。只將整份未修改的R10五項原assertions接到既有精確7bfc歷史checkout，current事件對齊／issuer review與CPU完整准入仍驗current HEAD；不改舊hash、不刪assert、不把舊來源當新Runtime驗證。新增精確接線與原test bytes不變的控制，Runtime與發布payload不變。先前本機session50682已不可存取，終態未保存，明確UNKNOWN；不虛列其PASS，也不因它重跑無關歷史測試。
