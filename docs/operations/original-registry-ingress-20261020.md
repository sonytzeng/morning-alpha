# 已核准來源登錄至原子 Observation 接線（未部署）

本增量承接 PR #281，不是正式 V1 股票推薦、不建立新來源的核准權，也沒有把 C QUALIFIED 當成正式推薦。原始 ingress、時間與品質門檻保留。`originalRegistryIngress.ts` 只承接既有且已獨立核准的 Registry；真實來源供給、onboarding authority、公司因果、正式條件 Producer、原 V1 評估及會員發布仍是獨立前置事項。

## 實作

- 私有 server-owned pins 綁定來源紀錄；原件、品質及用途審核文件均須重新讀取並核對 SHA256，沒有 artifact 不可只提供漂亮的 hash。
- Quality、rights reviewer 與 Producer／capture 身分分開；當次核准遭撤銷、過期或資料版本改變即拒絕。這些身分配置必須來自受控後端，不是 request body。
- 固定新 RPC `ingest_vnext_original_registry_candidate_v1(uuid,jsonb,jsonb)` 在同一 transaction 內核對既有 Evidence／License 完整資料列指紋、Registry version、獨立 authority、期限及撤銷，再呼叫原始 ingress。多餘／缺少來源、品質或權利不符、未滿期間必要種類皆拒絕。延後至交易提交的 guard 再驗有效期，解決讀取通過後才撤銷／到期的競爭條件。
- 新私有 `original_registry_candidate` schema 四表（authorities／versions／revocations／write_guards）強制 RLS、append-only；應用角色及service_role無表DML，沒有真實核准種子。可信DB管理流程仍須在獨立來源、品質及內部用途審查後安裝精確紀錄；不能以hash或reviewer字串自行核准。
- 固定雙ID read RPC `read_original_registry_source_candidate_v1(text,uuid)` 僅service_role可執行，與writer均核對當下資格；read不是可重複使用的授權憑證。原未含Registry資格的直接ingress撤銷service_role EXECUTE，函式內容與資料保留，避免繞過wrapper。
- 不新增會員 API、授權核准 writer 或公開內容；conditions 仍僅 UNKNOWN，Observation 僅 WATCHING／RESEARCH_ONLY。不自動重試不確定提交。

SQL 實體是 `src/features/vnext/originalRegistryIngress.candidate.sql`，刻意不放入自動 migration 目錄。只有候選；不能直接部署空入口以宣稱產品完成。service_role 原本的信任邊界沒有擴張，後端 adapter 也不是替代來源核准／審核制度的安全界線。

## 驗證與回復

合成 controls 與 PostgreSQL17 Fresh DB 驗證包含八路併發、同鍵重播、不同內容衝突、版本錯配、空來源、越權拒絕、transaction rollback、精確 Evidence 集合及零會員發布。新增讀後撤銷、傳輸／提交到期、authority／review過期、無authority、直接舊API拒絕與失聯提交測試；支援單次READ COMMITTED RPC交易，不宣稱保護可手動提前執行deferred constraints的任意特權SQL交易。這些不是實際股票研究或 Production E2E。既有測試斷言與歷史封存保留，最新完整來源另封存。

若日後獲精確發布核准，停止方式是撤銷上述read／writer兩個新RPC的service_role EXECUTE，停止新caller；保留新schema、所有來源、Observation、不可變收據及稽核資料。不得重新授予舊直接ingress EXECUTE作回復，否則繞過Registry檢查。不刪歷史資料、不倒退不安全的 Reader、不改會員權益。當前沒有啟用任何 caller，因此本輪沒有正式資源可回復。

**Production GO = NO。** 未取得真實已核准來源、完整原始條件、合法用途與獨立審查前，不提出空 Observation 的正式執行。付款停用，研究不公開。

## GitHub CI 續跑補正

`d74a25d`的Registry FreshDB job揭露CI runner沒有預先建立`ma-runtime-sparse-ci`映像；本機已有映像不代表新runner已有。現於該job使用既有`tests/fixtures/runtime-sparse-postgres.Dockerfile`明確準備相同測試image，執行時仍`--pull=never`、network-none／tmpfs，沒有變更SQL或門檻。

啟動失敗時原本的finally cleanup錯誤會遮蔽primary錯誤；新版本保留有界phase／分類／exit code，不輸出原Docker／SQL錯誤或環境值。沒有捕捉到容器ID時，必須用精確名稱證明不存在才記`NOT_CREATED`，仍是失敗而不是PASS；已有物件、inspect不明或cleanup失敗一律失敗，不盲刪。專屬24項單測與FreshDB16類／cleanup實測通過；修正後GitHub CI另行記錄，不把前次失敗改寫成通過。這是安全scan完成後的獨立CI支援增量，不冒稱同一scan digest。
