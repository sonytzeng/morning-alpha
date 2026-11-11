# Morning Alpha 全市場發版與回復

本文件配合 `scripts/operations/prepare-taiwan-market-release.mjs`。產生器讀取明列檔案、Git 基線、實際依賴和私人 seed 附件，輸出可核對的 source overlay。它不執行 commit、push、main 合併、SQL、正式匯入、部署、排程啟用、人工審查或會員發布。

## 發版範圍

這次交付把三市場名單、官方原件、短／中／長期規則式分析、研究參考價、私人待審版、Owner 操作與分頁會員畫面接成同一條流程。

| 部分 | 實際變更 | 完成後的狀態 |
| --- | --- | --- |
| 官方來源 | 三市場名單、當日公開 dataset、具日期的行情／估值、官方財報與月營收 CSV、可證明的 TPEx 公司行動範圍 | 保留原 bytes、來源日期、真收件時間和逐列 hash；缺件仍有原因 |
| 分析 | 每股三期間、64 股一批、全市場 immutable plan／shard／edition | `DETERMINISTIC_SCREENING`、`AS_OF_RESEARCH`；不冒稱模型生成或已驗證績效 |
| 價格參考 | 短期觀察區間，中／長期依公開數據與同業條件計算的研究參考價 | `CALCULATED_RESEARCH_ONLY`；`buy_ready=false`、`methodology_approved=false` |
| 來源綁定 | 原件 → 指定 row → 個股 packet；同業共享 input pool 仍保留每個 peer 的來源 | 來源、公司、期間、時間、完整 hash 均可核對 |
| 私人入庫 | 分段 input pool、reference registry、可接續 shard、edition 封存 | `STAGED_REVIEW_REQUIRED`，沒有自動 PASS 或自動發布 |
| Owner | 私人 edition 清單、30 卡審查頁、固定版公司／代號搜尋、單股原文、四項人工審查、提交結果讀回 | 搜尋最多 20 筆；審查狀態不預選；寫入回覆不明時不盲目重送 |
| 會員 | 當版及付費權限校驗、搜尋／篩選／游標分頁、每頁最多 60 卡 | 只有已核准、未過期且來源權利成立的版本可讀 |
| 每日作業 | GitHub OIDC → 固定 gateway RPC；盤前／盤後更新、持久 journal、來源 halt、加密 AUDIT／RESUME | 公開 Actions 只保存 ciphertext；不把 Supabase service credential 或加密 key 寫進檔案 |
| 首次資料 | 已核對 seed ZIP 的一次性私人匯入；私人 checkpoint head/pending 都不存在時才按固定 seed ID 還原 | 保留原 observation 與 first seen；不因搬移而重新宣稱已知時間 |

TXF 修補是獨立發版，不在此包。原 V1 `daily-ai-market-policy-v2.candidate.sql`、一次性歷史補抓 recovery 工具、原始資料集、私人 seed bytes、憑證、`node_modules` 和 Python bytecode 都不納入程式 ZIP。

上櫃 BVPS 方法另以官方財報的「每股參考淨值」乘同期間同業由真收盤價除淨值所得的 P/B 分位數。SQL 逐一核對提交樣本的原件、公司、財報期別、普通股身分、公司行動、至少五個其他同業及公式；長期另核三年原報品質條件。完整候選同業組由凍結的 JavaScript context 建立，SQL 沒有從全市場原件另行重建全部合格同業，不能將此驗證描述為已證明樣本沒有遺漏。這項方法仍沒有績效驗證或方法批准。

## 本輪資料與驗證版本界線

以下是 2026-11-11 已保存的兩個不同 run，不能把其驗證數字互換。依據為 `market-q3-workbench-delivery-20261111.json` 與其列出的實際 Owner／DB 回執；程式包只記錄版本及 hash，不包含研究原件。

| 版本 | 固定 run hash | 已完成的驗證 |
| --- | --- | --- |
| 新 Q3 工作台 | `e3cef91f68874bf9ce54bb06e59a39bbaa6173cdd6a78c453fb5fe85d0cd422b` | 2,365 股／7,095 卡／37 shards；4,544 個研究參考（短 1,762／中 1,799／長 983）；已輸出 HTML、驗實際輸出 JavaScript，**尚未全批 stage 到資料庫** |
| r5 本地真 SQL 版 | `99e8d8261bd4114440a1abfe386e2cdc2136278e8d0397af936b6ff84b7c5fee` | 4,576 個 references 與 37 shards 真 SQL 入庫；Owner 讀完整 237 頁／7,095 卡；edition `d05a79867eb002463958617d81385c7e0d79b519a8ba9528ace0e0ca61beba38` |

新版 Q3 HTML SHA-256 為 `827cbbc5039f176a4cd2f69f7d5c55e5eea43cc7097a578bf84a75697b4937d0`，cutoff 是 `2026-11-11T13:28:15.235Z`。兩版都沒有本輪人工 PASS 或會員發布；r5 的 0 review／publication 是本地 DB 證據，新 Q3 尚未 stage，不能宣稱已有其 DB／Owner 全批驗收。兩者都不是正式環境或自然 OIDC 執行證據。

## Git 基線和 main 合併

產生器把執行時的完整 Git HEAD 寫入 manifest，並逐檔保存本輪 candidate SHA-256、原 HEAD bytes／SHA-256、mode 和新增／修改身分。SHA-256 綁的是實際檔案原文；Git blob ID 另外記錄。

**這是指定 feature HEAD 上的本輪 source overlay，不代表整條 feature 分支已完成合併審查。** 2026-11-11 的唯讀遠端核對為：

| 項目 | 唯讀核對結果 |
| --- | --- |
| remote main | `7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3` |
| remote feature | `6ccf241896f16e52c28c407e8285826f43be27de` |
| GitHub merge base | remote main |
| GitHub compare | ahead 108、behind 0 |
| main → feature tree 差異 | 665 份檔案：新增 566、修改 99；不含本輪尚未提交的 overlay |

上述是一次已保存的遠端觀察和對應 Git tree 核對，不是未來部署時仍相同的保證。Local shallow `rev-list` 的數量不能替代遠端完整 compare。正式前端合併前必須再固定 main／feature／merge base 和完整差異；不能用此包的檔案數宣稱其餘 108 個 commits 都已審查。665 份既有差異與本輪 overlay 有重疊路徑，最終合併範圍必須按實際 tree 核對，不能直接相加檔案數。

`--remote-comparison` 會把保存的唯讀 comparison receipt 原 bytes hash 列入 manifest；`--main-tree-review` 另外綁定相同 feature HEAD 的 tree review 原回執及其範圍。兩者都不發起 GitHub 請求，打包器不把它們轉成 merge 授權或逐 commit 審查通過。

## 操作授權

Manifest 保存實際 `AGENTS.md` 的原文 SHA-256。該檔要求 commit、push 取得明確核准，migration 和 deploy 另有各自核准；現有排程不可自行修改。打包、測試或檔案核對本身不產生這些授權。已取得的明確授權按其確切範圍沿用，不能把未授權的動作加入執行。

本輪只準備 source overlay、SQL 候選、workflow 候選與外部私人 seed 清單。正式 SQL 套用、私人匯入、gateway 部署、main 合併／前端部署和新 workflow 啟用必須有對應的明確授權；Owner 的人工審查及發布也不由這份程式包代為執行。

## 先建立 inventory，再凍結

### 1. Inventory

在來源仍可能調整時，只建立精確清單。此模式不產生 ZIP。

```bash
node scripts/operations/prepare-taiwan-market-release.mjs \
  --mode inventory \
  --output /absolute/release-inventory \
  --seed-directory /absolute/private-seed-preparation \
  --remote-comparison /absolute/saved-remote-comparison.json \
  --main-tree-review /absolute/saved-main-tree-review.json
```

`--seed-directory` 在初次 inventory 可以省略；正式 freeze 需要具體 seed。輸出目錄必須是 repo 外的新目錄，不能覆寫舊結果。

Inventory 會輸出 `manifest.json`、`release-brief.md`、`checksums.sha256`。Manifest 明列：

- 固定 allowlist 的每份來源及 baseline hash，沒有使用整個 repo 的 wildcard 打包。
- Node／Edge／會員入口的靜態依賴。未變更的 repo 依賴必須逐份等於 Git HEAD，不能偷偷帶入本輪範圍外的修改。
- Python 動態 loader 的明列依賴、來源目錄 JSON、Node 版本與 Python 套件。
- 每份 candidate SQL、rollback SQL 的執行順序與 hash。
- Gateway 原文、workflow 候選原文與將來啟用的確切路徑。
- Repository 指令原文 hash、main → feature 已保存差異與本輪 overlay 的不同範圍。
- 私人 seed 與匯入 SQL 的外部附件 hash／size；資料原文不放進程式 ZIP。
- 仍未由本產生器執行的 runtime、正式環境與負載驗證。

### 2. Freeze

停止修改本輪 allowlist 後，以剛核對的完整 HEAD 和 inventory 執行：

```bash
node scripts/operations/prepare-taiwan-market-release.mjs \
  --mode freeze \
  --output /absolute/frozen-release \
  --expected-head FULL_40_CHARACTER_GIT_HEAD \
  --expected-inventory /absolute/release-inventory/manifest.json \
  --seed-directory /absolute/private-seed-preparation \
  --remote-comparison /absolute/saved-remote-comparison.json \
  --main-tree-review /absolute/saved-main-tree-review.json
```

若檔案、Git HEAD、依賴、seed 或 comparison 附件有漂移，freeze 拒絕混用舊 inventory。產生器先在新暫存目錄完成驗證，再原子移成輸出目錄。

Freeze 產物：

| 產物 | 內容 |
| --- | --- |
| `taiwan-market-candidate.zip` | 明列來源原文、SQL 清單、workflow 啟用描述、完整新 Edge Function 部署 JSON、source manifest |
| `taiwan-market-rollback.zip` | 本輪已追蹤檔案的 exact HEAD 原文、逆序 rollback SQL、需比對 hash 才可移除的新增檔清單 |
| `manifest.json` | 全部 source／baseline／附件／ZIP 的 bytes 和 SHA-256 |
| `release-brief.md` | 可直接審閱的具體範圍、權限、回復與未驗證項目 |
| `checksums.sha256` | 兩個 ZIP、manifest 和 brief 的 hash |

ZIP 使用固定 timestamp、檔案順序和權限；每份 entry 都讀回比對原 bytes。`--self-test` 只用臨時合成檔驗證這個封裝機制，不封存 WIP repo。

## 資料庫候選安裝順序

所有 SQL 都仍是候選，位於 `research/`，沒有放進會自動執行的 migration 路徑。前置條件包含原有 Auth、會員權益、研究 Owner 和來源權利資料結構；候選本身的 prerequisite／MD5 guard 必須成立。

| 序 | Candidate | 依賴及效果 |
| --- | --- | --- |
| 1 | `daily-ai-market-v2.candidate.sql` | 建立獨立 `vnext_market` 私有資料結構、來源、分批、版次、原有會員 gate |
| 2 | `daily-ai-market-financial-csv.candidate.sql` | CP950 原 bytes、BIG5/WIN950 往返與解碼後 CSV row；保留兩種 hash |
| 3 | `daily-ai-market-revenue-csv.candidate.sql` | UTF8 BOM 月營收原件、完整 CSV matrix |
| 4 | `daily-ai-market-public-supplements.candidate.sql` | 精確日期的 TWSE valuation 和三份 TPEx ACTION 原表 |
| 5 | `daily-ai-market-action-coverage.candidate.sql` | 原表完整性、範圍、逐股命中／absence proof，原單列驗證保持 |
| 6 | `daily-ai-market-action-evidence-id.candidate.sql` | 精確接受由原 hash 推出的 replay／全市場 evidence ID；時間檢查不變 |
| 7 | `daily-ai-market-references.candidate.sql` | 私有共享輸入、研究參考價與同 edition 結果／會員投影 |
| 8 | `daily-ai-market-reference-chunks.candidate.sql` | 每段最多 1 MB／256 nodes；先核 raw bindings，最後合併 exact pool |
| 9 | `daily-ai-market-reference-capacity.candidate.sql` | 只把分段傳輸的 assembled pool 上限從 32 MB 改為 64 MB；legacy 單次 RPC 仍 32 MB |
| 10 | `daily-ai-market-bvps.candidate.sql` | 官方申報每股淨值、同業衍生 PB 的來源及數學檢查；不能補造官方 PB 或改寫財報期間 |
| 11 | `daily-ai-market-reference-performance.candidate.sql` | 每批只抽取一次共享 inputs／bindings；只遞迴容器，保留原 scalar 深度、identity、來源數及所有原件／方法 gate |
| 12 | `daily-ai-market-short-scope.candidate.sql` | 短期觀察區間嚴格接受 TWSE `OFFICIAL_STOCK_DAY` 或 TPEx 完整成交 scope；拒絕跨市場混用 |
| 13 | `daily-ai-market-owner-review.candidate.sql` | 私人清單、人工四項審查、命令回執讀回 |
| 14 | `daily-ai-market-owner-search.candidate.sql` | 同版 universe 的公司／代號搜尋；保留三層 Owner gate，最多 20 筆，不加 OIDC 能力 |
| 15 | `daily-ai-market-seed.candidate.sql` | 私人 seed manifest／chunk／completion；三寫兩讀的 service-only 入口 |
| 16 | `daily-ai-market-checkpoints.candidate.sql` | private key、immutable archive/version、pending/head CAS；需 `extensions.gen_random_bytes(integer)`，不授予匿名或會員讀 key 的能力 |

Seed 只依賴第 1 步；checkpoint 另需既有 pgcrypto 隨機來源。固定順序讓整份審閱和執行清單一致。不可跳過 guard、改成無條件 `CREATE OR REPLACE` 或把不符的正式資料結構當成同一基線。

每個步驟都有同名 `.rollback.sql`。容量 extension 以精確函式 MD5 為前後條件；不改已驗證的 chunk candidate 原文。

## 每日作業的啟用順序

1. 按已核准的精確 source 範圍處理 commit／push，核對正式前端所需的完整 main 合併 tree；這不會自動執行 research 目錄的候選 SQL。
2. 依上表套用已核准的 SQL，保留每步 guard 與回執。
3. 一次性匯入受審私人 seed，核對 manifest、所有 chunks 與完整 seed ID 的完成狀態。
4. 部署並驗證 `taiwan-market-worker-v2` 的精確來源、OIDC scope 及固定 RPC 能力；Actions 不新增 Supabase service credential。
5. 依另行固定的 main 合併範圍部署前端。原 V1 fallback 仍有自己的權限檢查；缺少正式 V2 版本時不能展示私人草稿。
6. 前述依賴成立後，才把受審 workflow 原文啟用於固定 main 路徑。首次自然執行須確認實際來源收件、同版入庫和待審完成回執；不把手動測試時間改成排程時間。

步驟可由一份明確授權列出，但執行前必須能確認各項都在該授權範圍內。此文件及 inventory 不執行以上操作。

## Gateway 與每日 workflow

新 Function 名稱是 `taiwan-market-worker-v2`，只有 entry 和 `_shared/taiwan-market-worker-gateway.mjs` 兩份來源。`verify_jwt=false` 對應由程式驗證 GitHub OIDC 的設計，不是匿名寫入。Gateway 驗證 RS256、issuer、audience、repository／owner ID、main ref、workflow ref、event、token 時間與其他固定 claims。

部署前要先唯讀確認同名 Function 是否不存在；若已存在，需保存該實際版本的完整 bytes 和 metadata，不能直接把它視為本包可覆寫的新函式。這個來源包不冒稱已取得未知的正式 Function rollback。

Service credential 只從 Supabase Function 既有環境讀取。Actions 使用 GitHub 內建 OIDC，固定 RPC 白名單沒有 review、Owner approve、來源權利修改或 seed 寫入入口。

Workflow 候選來源：

```text
research/taiwan-market-daily.workflow.candidate.yml
```

經核准後的啟用位置必須是：

```text
.github/workflows/taiwan-market-daily.yml
```

這個路徑參與 OIDC claims；換檔名、分支或 reusable workflow 不能假稱同一授權。候選 schedule 為台北工作日 06:40 與 18:30，使用現有市場日曆，未知日曆不執行。當次 actual cutoff、來源收件時間、原 expiry 和 claim UUID 不因重跑而倒填或延長。

候選 workflow 的 job 上限為 90 分鐘。第一個可執行步驟設定 88 分鐘的共同安全 deadline，checkout、setup、private restore／seed 下載都消耗同一預算。開始 source work 前先保留 20 分鐘：prepare／串流加密最多 8 分鐘、兩個 ciphertext 上傳各 2 分鐘、讀回與 seal 最多 7 分鐘、最後確認 1 分鐘。工作最多跑兩個原 40 分鐘 invocation；第二段只接續同一 snapshot 的明確資源暫停，沒有 `--resume`。剩餘預算不足不開新段，硬中止保留 IN_FLIGHT／UNKNOWN 且該 job 不成功。85 秒 gateway RPC、單次來源 16 MB、每日新原件 128 MB 都未放寬。這些是程式邊界，native Node 22／OIDC 自然執行仍未實測，不是 90 分鐘必然完成的保證。

Workflow 啟用不修改原 V1 cron。相同候選檔需要獨立核准其實際移入 `.github/workflows/`、原文固定的 seed ID、保留期限及正式 staging endpoint；不需要另設 repository variable。

## 公開 repository 的加密續辦與容量邊界

GitHub 官方說明指出，有 repository 讀取權的人可以下載 workflow artifacts，而 fork PR 可以讀取 base branch 的 cache。因此本候選完全移除 plaintext Actions cache 與整目錄 artifact upload，只上傳兩個 AES-256-GCM ciphertext。參考：[artifact 讀取權限](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)、[cache 存取限制](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)。

`get_daily_ai_market_worker_checkpoint_v2`、`begin_daily_ai_market_worker_checkpoint_v2`、`seal_daily_ai_market_worker_checkpoint_v2` 都僅允許 service role，gateway 再要求固定 main workflow 的嚴格 GitHub OIDC。資料庫用 pgcrypto 產生每次 32-byte key；key 只進 worker 記憶體，沒有新 secret、key file、public log 或會員讀取入口。每次 begin 先保存 pending，之後才取得新來源或 staging。另一筆 pending 尚未釐清時，不可從舊 head 或固定 seed 重新開始。

| Ciphertext | 保存內容 | 指標 |
| --- | --- | --- |
| AUDIT | 本次完整工作樹，包括原始資料、原 journal、成功／失敗／未知紀錄與尚未精簡的副本 | expanded source 合計最多 8 GiB |
| RESUME | current input closure、最多兩個 cache run 索引、全部未完成 snapshots／UUID／cutoff／expiry，以及 UNKNOWN／halts／必要原件 | expanded 合計最多 4 GiB |

每份至多 50,000 檔、單檔 256 MiB、ciphertext 2 GiB；超出時明確停止，不刪失敗紀錄或來源來湊容量。兩份使用不同 12-byte nonce、16-byte GCM tag，AAD 綁 checkpoint/context/kind/manifest。真正上傳後，程式按固定 repository／run／artifact ID 重新下載並比對 ciphertext SHA，才把 archive descriptor 與 private head 原子 seal。seal 回覆不明只讀回一次，沒有自動重送 mutation。

精簡只寫新副本。已確認 `STAGED_REVIEW_REQUIRED` 的 completed snapshot 仍保留原 state；其大型衍生副本只有在完整 AUDIT 與 RESUME 都核對成功後，才不帶入下一個工作目錄。所有未完成 snapshot 完整保留，source firstSeen 不改。原 working root 不刪除；OS process lock 只在 RESUME 副本移除，其原文仍在 AUDIT，實際 in-flight journal 不清除。

Artifacts 保留 90 天，這不是永久保存服務。既有 head 指到的 ciphertext 遺失、過期、hash 錯誤或 tag 驗證失敗時會停止，不能退回 seed 丟掉 UNKNOWN／來源停止紀錄。容量與來源／失敗 ledger 仍持續監控；達硬上限需要明確處理，不是假設無限可用。回退須保留 private key／archive／pointer 資料，否則既有 ciphertext 將無法還原。

## 一次性私人 seed 匯入

`scripts/operations/prepare-taiwan-market-seed.py` 只準備資料與 SQL，不執行 SQL。它的輸出契約為：

```text
Morning_Alpha_Taiwan_Private_Seed_YYYYMMDD.zip
seed-manifest.json
seed-file-manifest.json
preparation-receipt.json
private-import-sql/000-manifest.sql
private-import-sql/001-chunk-000.sql ...
private-import-sql/999-finalize.sql
```

全市場程式 release 只把上述附件的 hash／size 放進 manifest。ZIP、原件與含 base64 的匯入 SQL 屬於另一份私人附件，不放進程式 candidate ZIP，也不發布公開 GitHub Release。

三個一次性匯入入口只有 `service_role`：

1. `stage_daily_ai_market_worker_seed_v2(text,text)`
2. `stage_daily_ai_market_worker_seed_chunk_v2(text,integer,text,text)`
3. `finalize_daily_ai_market_worker_seed_v2(text,text)`

正式匯入前，核准範圍必須含 exact ZIP SHA-256、manifest hash、完整 chunk 數量、每份匯入 SQL 的 hash。回覆不明不重送；先查同一不可變 ID 的明確狀態。既有 seed 不覆寫，後續更新用新的 seed ID。

SQL 驗證 ZIP 整包 hash、目錄、大小、數量與完整性；bootstrap 再驗實際解壓 bytes、CRC、cache-state／latest／parts hashes，原子安裝到不存在的目錄。OIDC 只可讀兩個明指已 complete seed ID 的 reader，沒有 latest/list 或修改能力。

Workflow 呼叫的 checkpoint CLI 固定新版 seed ID `e98b83f8f74149d559d33218d50d43a0ef50b16ab74c42e54ec0be44277f5584`；只有私人 `head=null` 且 `pending=null` 時才可首次 bootstrap。發版生成器核對 CLI 唯一 `REVIEWED_INPUT_SEED_ID` 與 `private_seed.seed_id` 完全一致，不需要 repository variable。這份 Q3／V3 seed 為 101,576,032 bytes、97 chunks、6,213 files，解壓後 651,189,849 bytes；共準備 99 份私人匯入 SQL（manifest＋97 chunks＋finalize），全部尚未執行。資料與舊 seed 都不覆寫。後續換 seed 必須連同受審 CLI 原碼一起固定。手動 seed reader 仍可依明確 ID 執行：

```bash
node scripts/operations/bootstrap-taiwan-market-seed.mjs \
  --seed-id EXACT_REVIEWED_ZIP_SHA256 \
  --cache /absolute/absent-input-cache
```

這個動作沒有研究審查或來源使用權批准的效果。

## Owner 審查與會員發布

軟體部署、資料入庫、Owner 審查和會員發布是不同操作。每日作業最後只產生待審 edition。

`/stocks/market-review` 需要登入、會員 Owner 身分及 `is_research_owner_v1()`。每份審查都由 server 綁定實際 `auth.uid()`，需要明確的四項狀態與文件；狀態不預選。提交回覆不明時保留 command ID，先使用唯讀回執核對，不新增一份未知重複審查。

公開來源可下載不等於已取得商用／儲存／衍生用途批准。既有 `source_licenses` 檢查仍適用於該版完整來源集合，包括同業估值引用的 peer sources。沒有符合條件的審查、來源權利或當版 Owner 發布事件時，會員 reader 不提供私人準備物。

免費會員維持固定三檔後再搜尋／篩選，不透過不同查詢繞過數量限制；研究價格為 null。付費／試用會員仍逐次檢查權益與期限。新版游標綁 edition、research／price revision、subject、tier、query 和 expiry。

## 全功能回復順序

1. 停止新 workflow，取消其新工作並關閉新 gateway。對未知回覆先核對同一請求的既有回執，不建立新 ID 重送。
2. 依 manifest 的逆向 SQL 順序停用 extensions；先撤 checkpoint RPC 執行權但保留 key／archive／pointer；`daily-ai-market-short-scope.rollback.sql` 先回復 projection，再執行 `daily-ai-market-reference-performance.rollback.sql`，兩者都必須先於 `daily-ai-market-bvps.rollback.sql`，使 reference staging 函式依序恢復到 BVPS 的預期 MD5，再恢復原 references 版本；`daily-ai-market-v2.rollback.sql` 必須最後執行。Owner 和 worker 寫入停止，V2 member 回覆明確 disabled，讓已實作的畫面回到另有權限檢查的 V1。
3. 完整保留來源、seed、input chunks、計算、研究版、審查與 publication events，不做資料刪除或時間改寫。
4. 需要還原本輪程式 overlay 時，先核對目前檔案仍等於 candidate SHA，再使用 rollback ZIP 的 Git 基線 bytes。新增檔只能按明列路徑及 candidate hash 移除。
5. 正式前端使用事先固定的實際部署 rollback。Feature HEAD 的局部 source restore 不是 main／Readdy 完整部署的替代品。

單獨回復容量 extension 會恢復 32 MB 分段上限；已完成的大 pool 仍可讀及 exact replay，但未完成且超過 32 MB 的 pool 不能繼續完成。先停止 worker，再選擇完整功能停用或經審查的修復；不刪除部分資料讓它看似沒發生過。

## 環境與驗證界線

- Node 版本從實際 `.nvmrc` 原文記錄；目前是 22.14.0，daily 命令需要 `--experimental-strip-types`。本機 Node 24 的通過紀錄不能自動標成 Node 22 通過。
- 已完成的每日離線準備使用 Node 24.22.1、V8 old-space 上限 2,048 MB；實際 total RSS 約 3.35 GiB，不能描述為只需 2 GB 總記憶體。這份準備結果不包含正式網路擷取、OIDC 或 native DB 全程時間。
- Python 固定 3.12，HTML parser 為 `lxml==6.1.1`；worker 與原擷取器依賴由固定清單提供。
- 本地 PGlite 可驗 SQL、RLS、角色、不可變、防重與真資料 hash；它不是正式 Supabase，也不構成正式 Deno／OIDC 自然執行驗收。
- CP950 fixture 解碼與已另做的 native PostgreSQL 編碼證據須分別保留。不能把本機 fixture lookup 說成每份資料已在正式庫完成往返驗證。
- 分段真資料耗時、單頁 60 卡及集合查詢是已測的具體結構／執行證據。沒有一萬會員的正式併發、頻率、資源與 Auth 負載測試，就不能標示 10,000 人容量已驗證。
- 正式環境觀察需使用自然排程與 actual timestamps。來源權益拒絕或安全 halt 不因發版而解除，不換日期、帳戶、來源名稱繞過停止紀錄。

## 關鍵執行指標

- 清單與封裝：exact source snapshot、Git HEAD、SQL／rollback 順序、private seed 和外部附件均有可比對 hash。
- 每日更新：實際來源日期、來源 halt、缺件、同股三期間結果、64 股 shard 完成率與未知 ACK 可接續性。
- 價格輸入：每段 ≤1 MB／256 nodes、全池 ≤64 MB、raw bindings ≤60,000、完整 pool／body hash 相同；legacy RPC 保持 32 MB。
- 私人匯入：所有 seed chunks 與整包 hash 完成後才可由 OIDC 讀取；匯入不產生 review／publication。
- 會員交付：只有同版審查、來源權利、Owner 發布、會員權益和時間條件全部成立才顯示；未成立時保留明確狀態。
- 尚未驗證的 Node 22、Deno／OIDC、正式 DB 全流程與一萬人負載，必須各自補上真實證據，不以打包成功替代。
