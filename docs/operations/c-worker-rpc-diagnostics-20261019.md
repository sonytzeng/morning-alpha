# C 工作 RPC 安全錯誤分類

10/19 C 原工作在第285項（TWSE 2421、2026年7月價格）已保存一次來源預約，尚無該項來源收據或失敗分類。預約提交不證明 Provider 抓取已開始。07:14只有固定 `DATABASE_RPC_REJECTED`；已保存的窄時間窗 server RPC 為HTTP200、Postgres未見非正常SQLSTATE，仍不足以辨識客戶端回應、傳輸或平台中斷原因。

本候選只改 `vnext-daily-research-v1/index.ts` 的錯誤觀測。日誌只允許三個固定RPC、十三個固定runtime operation、逐字列舉的SQLSTATE／PostgREST／timeout分類。未知值一律generic。沒有輸出錯誤文字、details、hint、呼叫參數、run id、來源、URL、headers、body、token或signal reason。原 `FORWARD_TIME_INVALID` 精確比較、其他拒絕、Auth、固定SDK、8000ms timeout、租約、09:00截止、512次預算及背景交接不變；日誌sink失敗不改拒絕結果。

原Worker2封存仍為74檔、44個runtime、30個靜態來源。候選只改入口一檔，其他73檔不變；原Worker2修復包SHA256 `0d88f57588d02cb63ba467a3803b44815110a67ad5712e40903c241806bd02d2` 保留作精確回復。候選payload SHA256 `c86202f3123aeddefc6ca39efdca0b25cfcadee955527cff7c1a92a7dee6e7d9`。這不是先前Worker1功能等效回復包，也不混入Caller、Producer或Reader部署。

新SDK合成控制實際載入固定SDK、候選入口及44個runtime模組，驗證成功資料原樣返回、固定RPC／operation、SQLSTATE／PGRST、未知值、timeout code、原拒絕及日誌sink失敗。測試只使用合成身分／錯誤，網路port預載拒絕。Node24本機8項與原恢復23項通過；Node22與Deno以本候選精確HEAD的新CI為準。合成 `TimeoutError.code=23` 經真SDK被保留，不代表已觀察Production Deno的真實8秒timeout。

新外層來源封存固定接續已公開PR276 commit `965263fe15dc672cac6c61af06bfd14d69044dd3`。原source-acquisition seal、helper、三項來源斷言和原integration assertions均不修改。因舊proof固定保護舊C入口及當時CI bytes，CI在完整當前來源准入之後，將它們原封放到固定965 checkout執行；當前C全來源漂移／模式／未知路徑負控、SDK協定、Deno與既有行為測試保持當前checkout。

V2 job只將唯一精確檔名 `recommendationV2SourceAcquisitionAdmission.test.mjs` 的歷史來源proof交給上述固定965步驟；所有其他V2行為測試仍在當前checkout執行，明確核對只移動一檔。沒有刪除斷言、變更舊manifest或用舊來源代替新入口的驗證。

原public SDK freshness workflow、plan、checker及offline assertions保持原bytes。雖然workflow名稱仍寫single opened，965中的實際條件是 `synchronize`、固定 `codex/market-regime-compatibility-20261019` 分支、首次workflow run及首次attempt；新C分支不符合，沒有重啟它的公共來源取得。SKIPPED不記PASS。原63個canonical／5個alias檢查只對原SDK計畫，不檢查新C入口，其早期remote-SDK repair包指紋也不是本候選fixed-SDK包；當前入口仍由新VM協定及Deno直接驗證。

這個修復讓下一個合法自然工作失敗時可定位RPC界線，不證明原07:14根因已修復或下一日研究已通過。當日已耗盡工作不重設、不重跑、不倒填。PR合併、CI或此診斷發布都不代表正式短中長推薦及會員端到端驗收完成。無Migration、Cron、Secret、Auth/RLS、權益、研究公開、付款或LINE操作。

PR277第一輪真實CI另發現Owner quarter workflow仍在當前checkout執行舊integration assertions，其中原workflow完整位元斷言與這次合法CI分離不相容。此增量只將該job的當前precheck改為C當前來源負控；原15項integration與3項source-acquisition assertions繼續在Core固定965原封執行。新負控逐字核對Owner quarter workflow只更換這個測試selector，其餘歷史封裝、TypeScript、Deno、拒絕與執行順序全部保留。第一輪失敗保留，不以這項修正冒稱新CI已通過。
