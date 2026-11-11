# 全市場每日準備與待審入庫

## 現有可執行入口

`scripts/operations/run-taiwan-market-daily.mjs` 直接串接現有官方擷取器、全市場名單、資料正常化、規則式分析引擎及 V2 私有 staging adapter。它從三市場官方名單取得股票數，沒有 72 檔或 216 張卡片上限。

預設會取得三份公司名單及來源目錄目前列出的 52 個每日 dataset，共 55 次具上限的官方公開請求。每個來源一次、不跟隨 redirect、不自動重試；資料來源增減時由目錄決定，仍受 100 個來源上限約束。所有成功與失敗 receipt 都留下，缺資料由分析引擎逐股、逐期間表達。任一市場當次名單沒有成功取得時，整個全市場準備停止，不能以昨日快取名單假稱今日名單取得成功。

```bash
node --experimental-strip-types scripts/operations/run-taiwan-market-daily.mjs \
  --output /durable/morning-alpha/taiwan-market \
  --slot POSTCLOSE \
  --input-cache /durable/morning-alpha/taiwan-market/input-cache
```

`--slot` 是排程與防重的身分。實際來源日期及 cutoff 一律取真實接收時間與時鐘；手動晚跑 PREMARKET 不會把傍晚取得的資料回填成早上已知。新的 snapshot 必須使用當日台北日期。已存在的 snapshot 可透過 `--business-date YYYY-MM-DD` 讀回，未完成的下載不能在隔日繼續冒充前日取得。

已取得的官方原件可以直接離線接入，不需要重新下載：

```bash
node --experimental-strip-types scripts/operations/run-taiwan-market-daily.mjs \
  --output /durable/morning-alpha/taiwan-market \
  --slot POSTCLOSE \
  --acquisition-dir /retained/taiwan-market-YYYYMMDD
```

此目錄使用現有 `acquisition-*.json` / `TAIWAN_PUBLIC_ACQUISITION_V1`。會選各來源最新紀錄，包含失敗紀錄；不能挑舊的成功回覆蓋過新的失敗。此模式沒有 provider 請求。

## 每日輸入更新與可攜快取

`research/taiwan-market-input-cache.mjs` 是每日輸入更新器，`scripts/operations/refresh-taiwan-market-inputs.mjs` 是其可執行入口。主 runner 在當日三市場名單與公開資料取得後、凍結 cutoff 前呼叫更新器。它產出同一版 `history_file`、`financial_history_file`、`retained_captures_file`、`actions_source_manifest_file`，以及可核對的 `manifest_file` / `manifest_hash`；主流程不再依賴某一天手動填入的 scratch 路徑。

更新範圍明確限定為：

- 追加最新已完成交易日的 TPEx 全市場日行情，先在完整 62 日窗口找出未取得日期，再套來源 halt、未知結果及失敗額度檢查，每次最多排入 5 個可執行缺日，優先較新的缺日；未入選日期仍列 deferred。日用索引保留 62 個交易日。這是供 60 日研究分析使用的資料窗口，不是策略驗證所需的歷史樣本數。
- 取得具日期的 TWSE `BWIBBU_d`。已受安全拒絕的 TWSE `MI_INDEX` 和三類 TWSE ACTION 保持來源停止狀態，不能靠換日期或名稱重試。
- 需要時取得 TWSE 已結束月份的官方月營收頁，再依原頁真實下載表單取得 CSV；11 日是明列的查詢排程參數，不代表資料已公布的證明。實際期間、內容與可得時間以原件為準。
- 官方 INCOME／BALANCE 原始列揭露年季或同一季完整內容發生變化時，排入該市場／報表／期間的取得。V3 content version 覆蓋該期各產業全部公司與財務欄，僅排除出表日期；不能只看第一家公司。CASHFLOW 使用同市場已揭露期間作為查詢觸發，當期另依實際台北日期每日核對一次；仍須真正取得並驗證現金流量 HTML／CSV，不能把查詢觸發當成現金流量已可得。
- 公司行動每次由三份原始 TPEx 回覆建立證據；查詢起日是 62 交易日首日與期末前 180 日兩者較早者，用於既定 BVPS freshness 窗口，不延伸未取得的覆蓋。任何缺表、期間不足或語意不明都保留不完整狀態，不自動把舊覆蓋延伸到新日期。

每個 task 最多 8 個 HTTP 請求、每個 host 至少 2 秒間隔；更新器每次最多 16 個 task、64 個請求及 25 分鐘。503 / 502 / 504 / 已記錄的網路逾時最多 2 次不同 attempt，間隔至少 24 小時。同一報表的 logical scope 仍是市場、報表種類與期間；content version／每日 CF 日期只區分需核對的內容，所有版本共用 UNKNOWN 與來源 halt，當次成功世代共用失敗次數與 cooldown，不能靠改日期或檔名重置額度。403、429 或原始回覆中的安全拒絕訊息會保存 endpoint scope 的停止紀錄；未知結果不會自動重送。已完成 worker 結果而尚未完成 cache commit 時，可以從原 `result.json` 離線續辦。

新報表必須核對全部 parent 公司與全部實際 CSV export 才能替換 current 文件集合；只下載到部分產業時保存新觀察但保留原完整 current 集合。完整新原文的財務內容相同時仍保留舊 observation 與 firstSeen，只追加本次核對時間。下載失敗不會清空舊財報、舊行情或來源原件。新的輸入 manifest 仍會列出既有資料、實際日期與此次缺件；來源 stale 與方法 gate 由後續分析繼續判定。所有已保存 observation 的 raw bytes、raw hash、原 receipt、first seen 與來源日期保留；只有新索引、追加的新 observation 與新 manifest 產生新 hash。

首次初始化使用明確的 `TAIWAN_INPUT_CACHE_SEED_V1` 清單。它引用已驗證財報 manifest、歷史 checkpoint、對應原始資料目錄、三份 ACTION 原件及補充原件。初始化只讀原件；輸出的 `objects/`、索引與 manifest 使用可攜式相對路徑，原 receipt 內的舊本機路徑保留為原始紀錄，不拿來當搬移後的存取路徑。

```bash
node scripts/operations/refresh-taiwan-market-inputs.mjs \
  --cache /durable/morning-alpha/taiwan-market/input-cache \
  --universe /retained/verified-universe.json \
  --seed /retained/verified-input-seed.json \
  --acquisition-dir /retained/current-public-captures \
  --slot POSTCLOSE --offline

node scripts/operations/refresh-taiwan-market-inputs.mjs \
  --read-manifest /durable/morning-alpha/taiwan-market/input-cache/latest.json
```

`--offline` 會完成真實原件驗證、保存與輸入建置，但不執行待抓來源，也不把當日網路更新標成已完成。沒有 seed 或 cache 時明確回 `BOOTSTRAP_REQUIRED`，不能悄悄改用空財務資料。

## 日曆與資料日期

使用既有 `supabase/functions/_shared/market-session-contract.mjs`，版本來自同目錄的 canonical calendar JSON。休市日留下 `SKIPPED_MARKET_CLOSED`；日曆未涵蓋時留下 `BLOCKED_CALENDAR_UNCOVERED`。沒有新增另一份假期清單。

完整日資料的界線與現有價格計算器一致：台北 17:05 前期待上一個已完成交易日，17:05 後的交易日才期待當日。預計執行時間為台北 06:40、18:30。`freshness.json` 按市場記錄期望行情日期、實際日期分布、有當日可用行情、其他日期與缺行情數。完整日行情是否涵蓋零股、盤後或鉅額交易仍由來源原件與引擎的 session scope 決定。

所有選定來源的當次擷取完成後才凍結 cutoff，名單、work plan、facts、各股 packet 使用同一個 cutoff。`source_as_of` 不會改成 cutoff。到期時間在第一次準備時固定為 cutoff 後 24 小時，續跑不延長。

## 快照與原件

輸出目錄結構：

| 路徑 | 用途 |
| --- | --- |
| `objects/<原文SHA>.<格式>` | 逐位元保存的官方原件；相同內容共用同一檔 |
| `capture-index/<hash前兩碼>/<source指紋>.json` | 同 source ID、URL、格式、原文 SHA 的最早實存 receipt；每次只讀單一索引 |
| `snapshots/YYYY-MM-DD/SLOT/state.json` | 下載與 RPC durable journal、cutoff、原到期時間、已確認結果 |
| `snapshots/.../acquisition/` | 當日每個來源的成功與失敗擷取紀錄 |
| `snapshots/.../universe.json` | 三市場名單與來源 hash |
| `snapshots/.../work-plan.json` | 每批最多 64 股的不可變工作清單 |
| `snapshots/.../facts.json` | 官方原欄位正常化結果、缺件與 source row binding |
| `snapshots/.../shards/<id>.json` | 個股 packet、三期間研究分析、完成統計 |
| `snapshots/.../research.json` | 真引擎 run hash、方法版本、分析涵蓋率、價格研究、缺件清單及 shard 原文 hash |
| `snapshots/.../freshness.json` | 日曆及各市場實際行情日期涵蓋率 |

今天再次取得相同內容時，今天的 receipt 仍單獨保存；evidence 可以共用最早已保留且原文 hash 完全相符的 receipt。沒有舊原件便不能聲稱更早已知。新的私人 checkpoint 是續辦狀態來源；既有 head 的 artifact 遺失或 pending 未釐清時停止，不退回舊 seed。任何路徑都不能從資料日期反推 first seen。

同日同 slot 重跑沿用原快照，不重新下載、不變更 cutoff、不重算已保存研究。程式、目錄或必要輸入發生漂移會明確拒絕與原快照混用。

## 歷史資料接入

`--history <checkpoint.json>` 接受包含 `stocks` 的既存價格歷史 checkpoint；`--financial-history <manifest.json>` 會透過真實 loader 驗證財報文件與每筆 record hash。`--actions-source-manifest <manifest.json>` 只能提供三份原始 ACTION bytes 與 receipts，由來源 parser 自行建立覆蓋；不能傳入呼叫者自行宣稱的 complete flag。每日排程應使用 `--input-cache` 動態取得同一版輸入，個別路徑只用於已保存快照的明確離線接入。

歷史 evidence 若引用每日 55 份原件之外的 capture，需另外提供：

```json
{
  "schema": "TAIWAN_RETAINED_CAPTURES_V1",
  "captures": [
    {
      "receipt": "此處應為完整 TAIWAN_PUBLIC_SOURCE_RECEIPT_V1 物件",
      "raw_path": "相對於此 manifest 或絕對路徑的原文檔"
    }
  ]
}
```

使用 `--retained-captures <manifest.json>`。每筆需要實際 bytes、SHA、來源身分、接收時間與 packet 引用一致。只有 metadata 而沒有原件時可以保存研究計算，但入庫會回 `BLOCKED_CAPTURE_PROOF`。MOPS 財報使用官方原 CP950 CSV；後端驗證原始 bytea、BIG5/WIN950 往返、UTF8 解碼 hash 與原 CSV matrix row。HTML 只作來源表單、欄位與期間核對，不轉成 JSON 冒充官方原件。

## 私有 staging 與復原

CLI 預設不寫資料庫。程式介面 `runTaiwanMarketDaily(options,{rpc})` 或 `--stage --rpc-module <已審查的伺服器轉接模組>` 才會呼叫既有 staging adapter。模組只需 export `rpc(name,args)`，回傳既有 `{data,error}`；此程式不讀 `.env`、不發現或輸出 credentials、不把 service role 放入 GitHub 或瀏覽器。

實際呼叫順序：

1. 保存並驗證全部會引用的原始 capture。
2. `stage_daily_ai_market_work_plan_v2` 登記名單與 64 股分批 plan。
3. 有研究參考價時，逐段保存共享 input pool，完整 hash finalize 後才保存 bounded reference batches。
4. 先保存 request UUID，再 `claim_daily_ai_market_shard_v2`；只回傳該批原本準備的資料。
5. `stage_daily_ai_market_shard_with_references_v2` 保存 packet／analysis／reference binding；沒有參考價的批次沿原 `stage_daily_ai_market_shard_v2`。
6. 明確取得 `NO_WORK` 且 remaining、exhausted 都為 0 後，才 `finish_daily_ai_market_edition_v2`。

完成狀態是 `STAGED_REVIEW_REQUIRED`，不是核准或發布。沒有任何程式路徑呼叫 review、Owner approve、會員發布或來源權利核准。

網路回覆不明時同一輪立即停，不自行重試。人工釐清後才可顯式使用原 UUID、原參數、原 expiry 續辦；原低階 CLI 的 `--resume` 會走既有 immutable RPC 防重契約，不能將它誤稱全部都是唯讀查詢。每日 checkpoint workflow 不會傳這個旗標；已完成的 shard 不重算。capture、plan、finish 的 SQL 原文防重亦使用原參數。明確 `REJECTED` 或 `LEASE_EXPIRED` 不會因 `--resume` 被重試。單輪 shard 上限預設 64；達上限只回 `STAGING_PAUSED_RESOURCE_LIMIT`，下一輪從原 journal 接續。

## 加密 checkpoint 與候選排程

`research/taiwan-market-daily.workflow.candidate.yml` 位於非啟用目錄，尚未移入 `.github/workflows/`。它使用目前 `.nvmrc`、Python 3.12、lxml 6.1.1，保留 2 GiB Node old-space、每份原件最多 16 MB、每日新原件合計 128 MB、gateway 每個 RPC 85 秒。2 GiB 是 V8 old-space，不能寫成整個作業只需要 2 GiB RAM。

候選 job 上限 90 分鐘。第一個可執行步驟在 checkout／setup 前設定共同的 88 分鐘安全 deadline；還原 seed／checkpoint 也扣同一時間。source work 開始前先保留 20 分鐘：prepare／AES archive 合計 8 分鐘、兩個 ciphertext 上傳各 2 分鐘、readback／seal 7 分鐘、最後確認 1 分鐘。剩餘預算太少不開始新 segment，沒有另起 82 分鐘時鐘。最多兩個原 40 分鐘 invocation；只在 `ACQUISITION_PAUSED_RESOURCE_LIMIT` 或 `STAGING_PAUSED_RESOURCE_LIMIT`、沒有 IN_FLIGHT／UNKNOWN／rejection 時，使用相同 day／slot／snapshot 再跑一次。第二段不延長 cutoff／expiry，也不加 `--resume`。

這個 repository 是公開的。GitHub 官方文件說明 artifact 可由 repository 讀者下載，fork PR 亦可讀 base cache；因此候選移除了 plaintext `actions/cache` 和整目錄 artifact。參考：[artifact 權限](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)、[cache 範圍](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)。Actions 只保存 `audit.bin` 與 `resume.bin`，stdout／stderr 與研究 JSON 留在本機加密來源樹內，不公開輸出。

`start → work → prepare → upload ciphertext → readback/seal → finish` 使用 `scripts/operations/taiwan-market-checkpoint.mjs`。啟動先呼叫私人 `get_daily_ai_market_worker_checkpoint_v2()`：有 pending 就停止等待明確核對；有 sealed head 就驗固定 GitHub repository／run／artifact ID，SHA 與 AES-GCM tag 全通過後才還原。只有 head 和 pending 都是 null 才讀固定 seed `e98b83f8f74149d559d33218d50d43a0ef50b16ab74c42e54ec0be44277f5584`。這是已核對新版 Q3／V3 的 101,576,032-byte ZIP、97 chunks、6,213 files，原 1 GiB expanded seed gate沒有放寬。private pointer 非空時，seed 絕不能作為失敗 fallback。

取得新來源或 staging 前先 `begin_daily_ai_market_worker_checkpoint_v2` 持久保存 pending，資料庫產生新的 32-byte key。key 只在服務端 RPC 與 worker 記憶體，沒有額外 Supabase secret、key file、會員接口或 public log。兩個 archive 使用不同 12-byte nonce、16-byte tag，AAD 綁完整 checkpoint/context/kind/manifest。

| Archive | 保留內容 | 上限 |
| --- | --- | --- |
| AUDIT | 本次完整原工作樹，包含所有成功／失敗／未知紀錄和待審結果 | expanded 8 GiB |
| RESUME | current input closure、最多兩個 cache run 索引、所有未完成 snapshot 的 chunks／references／UUID／cutoff／expiry／原件與 halt／UNKNOWN ledger | expanded 4 GiB |

兩份都最多 50,000 檔、單檔 256 MiB、ciphertext 2 GiB。精簡只建立新副本，不刪 original root。completed snapshot 只有真 `STAGED_REVIEW_REQUIRED` 與確認 finish 才可不再複製大型 derived 檔；state 仍保留。uncertain attempt 全部原目錄保留。process lock 在副本移除，但原文在 AUDIT、實際 in-flight journal 不清除。

真正上傳後逐份讀回 ciphertext 比對 SHA，再呼叫 `seal_daily_ai_market_worker_checkpoint_v2`，以同一 transaction 保存 immutable archive binding 並 CAS 前移 head／清 pending。begin／seal ACK 不明只讀回一次，不自動重送 mutation。未知或非終態工作即使 archive 保存成功，`finish` 仍令 job 失敗，不能顯示綠色成功。

Artifacts 保留 90 天，並不是永久保存。既有 head 指到的 ciphertext 缺失、過期或驗證失敗時停止，不能用舊 seed 消除 UNKNOWN／halts。restore／publish 效果分開；checkpoint 不會建立 PASS、修改來源權利、Owner approve 或會員發布。Native Node 22／OIDC／GitHub 實際上傳和完整 90 分鐘自然執行尚未驗證，本地 PGlite／AES roundtrip 不替代這些證據。

每日 planner 另保留 `report_requests` 舊期補件佇列：原本失敗的 2024Q4 等報表不會因 catalog 已換到新季度而消失。原 URL、表單、task ID 與 receipt 原文 hash 都要匹配，這只能觸發同一公開查詢的有界恢復，不能當成財報已公布的證據。達到重試上限、權限來源停用或請求證據不完整時，缺件和原因仍寫入 manifest；不自動重設次數。

目前 `.github/workflows/morning-alpha-runtime-checkpoints.yml` 是手動 checkpoint 入口，盤前會呼叫既有 daily-delivery-orchestrator。既有 v1 股票 intake 的日曆 guard 維持台北 06:50–09:00 且沿舊自然排程。兩者沒有直接執行本 Node / Python bulk downloader 的介面。最小正式接線是先審核本候選 workflow 與原件保存政策，再提供經既有伺服器授權的 staging transport；不能僅改 v1 的 72 檔常數或把 service key 塞入前端。

本檔與程式的驗證涵蓋資料完整性、重跑、防重、過期、權限拒絕與待審 gate。合成 RPC 測試與本地 PostgreSQL 真 SQL 測試需分開報告；兩者都不構成方法合理性核准、正式會員發布或一萬人容量認證。
