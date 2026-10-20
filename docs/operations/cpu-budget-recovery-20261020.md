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
