# Core Stability：本機完整 Runtime 驗收續作 — 2026-09-07

## 目前有效狀態：Production release FAIL 已回復／Fetch Contract 候選完成

**下方早先 `LOCAL_FULL_STACK_E2E = PASS` 不涵蓋真實 Fetch producer，不能再當作完整 Production release 依據。**
2026-09-07 正式 Acceptance `c787c5ac-4b02-46cb-9116-30afd74dcb20` 實際 FAIL 並永久保留：已部署 Fetch v63 只寫 `market_data_snapshots`，新的 Acceptance 卻要求 `market_checkpoint_snapshots`。先前 harness 直接填入後者，漏驗了 producer 路徑。
本輪已依精確核准回復三個原始 private RPC；沒有呼叫它們。Migration ledger `20260907114550`，body hash／signature／owner／security／search_path／ACL 全部與事前保存原版一致。詳見 `core-rpc-rollback-20260907.json`。
正式 Edge 已在前輪回復 generator v229（原v227 source）、orchestrator v29（原v27 source）、payload v42（原v40 source）；本輪沒有再部署任何 Function。既有 canonical hardening 與新增三個 private publication RPC 保留，未 DROP 資料或回寫業務結果。

### 本輪真實 Fetch 修補

- 以可核對 hash 的 Production v63 為基底，保留雙 provider lane、60秒預算、6秒 timeout／1次 retry、Fugle/TWSE fallback、Premium beneficiary 分離及六個 shared dependencies。44個具名 declarations 原樣保留；來源與候選雜湊見 `core-fetch-source-manifest-20260907.json`。
- Fetch 寫入並讀回 append-only `market_checkpoint_snapshots` 後才更新既有 compatibility tables；同 correlation + checkpoint + symbol 用 DO NOTHING，重試仍使用原保存報價，不 overwrite immutable。
- `captured_at` 是實際 collection start；`source_timestamp` 是 provider 原始時間，絕不把 quote 改標為排程時間。PREMARKET 使用 uppercase canonical identity；manual_backfill 使用獨立 RECOVERY。
- 盤中 collection windows（Asia/Taipei，右界不含）為 09:00–09:15、09:25–09:45、10:25–10:45、12:55–13:15；close collection 是14:10–14:25、14:30–14:45，涵蓋現有+5分鐘backup。PREMARKET最晚07:35。來源 freshness 仍保留原版規則，台股 intraday 再核對同 checkpoint window；close 可保留13:30/13:45官方價，不冒稱14:10價格更新。
- intraday/close 必須 TAIEX + 2330 + TXF 均有完整 evidence／canonical／compatibility write；不再只憑前兩組宣告完整。Fugle 缺 change／percent 且無 previousClose 可推導時拒絕，不補0。這是品質契約修正，不是新選股策略。
- terminal reuse 只讀原 lifecycle correlation 的 immutable evidence；若只有舊 mutable rows，回409 `TERMINAL_CHECKPOINT_EVIDENCE_MISSING`，不回填歷史、不重新抓晚到行情冒充早盤。
- lifecycle RPC 的rank-regression no-op不再當成功；核對returned checkpoint ownership／immutable metadata。保留原state-machine、Auth及權限不變。

### 重新驗證與限制

本機正式Edge Runtime1.74.1、真實local Auth/JWT、PostgREST／PG／RLS／trigger：19項場景PASS，六checkpoints×三core symbols的candidate Acceptance證據predicate18/18匹配；詳細去識別證據 `core-fetch-local-evidence-20260907.json`。
涵蓋09:27接受／09:20拒絕、缺percent拒絕、真實DB注入失敗與retry、相同correlation並行插入只留一組、PREMARKET/RECOVERY隔離、UPDATE/DELETE guard拒絕、late replay不補資料、TXF缺失不報healthy、LINE outbox未變。
供應商只在local vendor boundary回傳synthetic JSON；時間只由test wrapper控制。**不是正式資料商delivery PASS、不是今日自動穩定日，也不是Full Production Acceptance PASS。** 本輪未執行三個受限RPC，僅以同predicate唯讀查詢核對證據。
先前local502為CLI hot-reload重啟worker；並行clock fixture的提早restore也已修正，只改測試harness。修正後用新合成日期2026-09-14整批重跑PASS，沒有拿之前部分結果拼成通過。
Type-check／lint／build／Deno checks／Node及Deno regressions已重跑；以本次候選最終CI結果為準。舊測試數字不得替代本輪結果。

### 重現與下一次 Production Gate

1. 沿用已驗證隔離stack，先由local-contract檢查`MA_LOCAL_SCOPE=ma-core-final-20260907`、Internal=true網路與DB identity；不可改連Production。
2. 用原固定SDK import-map bundle實際Fetch entrypoint；只在本機bundle前加`tests/fixtures/fetch-provider-boundary.mjs`，local env使用無效vendor fixture keys，不能把wrapper部署到Production。CLI hot-reload穩定後才開始測試。
3. `MA_LOCAL_SCOPE=ma-core-final-20260907 MA_FETCH_TEST_DATE=2026-09-14 node tests/integration/fetch-checkpoint-local.mjs`。整批重新執行需使用乾淨的合成交易日／隔離庫，不清除既有immutable evidence。原子publication完整測試另由既有CI isolated PG執行，非Production呼叫。
4. 最新核准只允許三個原版RPC回復；新Fetch artifact不在先前SHA6dd7的production release內，**本轮不自行Deploy新Fetch、不重新發布三支已回復的Function、不重新套用forward Acceptance定义**。
5. 下次正式發布必須以新的最終CI SHA審查：先讀回rollback baselines與table RLS/guard，再發布Fetch（entrypoint +原6shared +新fetch-checkpoint-evidence.mjs），唯讀等自然checkpoint形成持久證據；不得以09/07回填或人工advance補驗。Generator／orchestrator／payload與三個forward RPC是否再次發布，必須單獨以完整依賴與來源版本核准。
6. Fetch回復方案：重部署保存的v63 entrypoint與原6shared，保持原JWT策略；不可DELETE已保留的證據。Acceptance三原版private定義與ACL回復基線已保存。
7. 現在Production Gate仍FAIL；Core Gate之前不進Decision Engine/Subscriber UX發布、不啟動14日穩定認證。原09/07fail、缺原始immutable與正常LINE未成功等歷史事實不改寫。

## 歷史結案：本機 Core Stability Gate（被上述真實Fetch驗收範圍更正）

LOCAL_FULL_STACK_E2E = PASS（合成來源、真實本機 Runtime）；PRODUCTION_FIXED = NO。
Schema source blocker 已由 Sony 的逐物件核准解除，沒有繞過原安全審核。
本輪可提交獨立 Draft PR；正式 Migration／Deploy／Recovery／Merge 均仍未獲本輪授權。
完整任務依既定顺序停在下一個 Production-safe 操作核准 Gate，不能以本機 PASS 宣稱正式分析完成，也未啟動收費、試營運或14日自然穩定觀察。

### 實際重建與函式一致性

- 全新 `ma-core-final-20260907`，API54371／DB54372／Mailpit54374／Frontend4313；專用 `ma-core-final-isolated-20260907` Internal=true；所有容器只接此網路。連線前驗證 scope、網路與 local identity table。
- Supabase CLI2.108.0、Node22.23.1、Deno2.9.2；PG17.6.1.139、GoTrue2.191.0、PostgREST14.13、Edge1.74.2（runtime banner1.74.1）、Kong2.8.1、Mailpit1.30.2、Realtime2.108.0。其他專案容器與舊測試環境保留。
- 空 public schema／零 Auth user 起始，15張 schema-only legacy foundation來自已去敏 Production catalog；`tests/fixtures/core-canonical-foundation.sql` 有明確本機 GUC guard，不是待套用的 Production migration。
- 25個必要schema檔依序重播PASS；候選Migration重複套用PASS。81張表的欄位（型別/default/nullability/identity）及RLS/FORCE RLS雜湊全部相同；62FK、17public triggers實際存在。
- 六張不在本次閉環路徑的表未重建：content_engagement_events、decision_snapshot_market_evidence、early_access_signups、market_data_history、market_source_health、voice_reports。**不宣稱整個Production資料庫零差異**。Cron/Vault/Owner資料/其他產品排除。
- `advance_trading_day_state_v1` MD5 `a1af0d71f9ef824c5876816a2040fcc9`、DEFINER、空search_path、service_role-only；`set_updated_at` MD5 `9b1889f56258bf9d6554213c05019c76`、INVOKER、public search_path及原ACL不變。
- sector_stock_map的BEFORE UPDATE使用set_updated_at/NOW；market_patterns的BEFORE UPDATE仍使用cle_set_updated_at_v1/clock_timestamp，未錯換成另一個時間函式。真實執行DEGRADED core完整/不完整、terminal保護及兩Trigger，PASS。
- Fresh local的health/CVE曾因六張表缺service_role grants回500。已唯讀核對Production原ACL後，在canonical migration明確保留；未修改客戶角色/RLS/正式資料。

### 完整閉環證據（不是假HTTP成功）

`12合成market rows + 3公司/產業news + 前交易日sector → 真實generator → Evidence/Editorial/Premium/Semantic → 原子publication → 真實payload → LINE測試接收器 → 六checkpoint → close review → Closing → CLE → Acceptance`

| Gate | 最終結果 |
|---|---|
| Generation | HTTP200，data_quality complete，Research coverage100，unsupported0；原候選6檔只保留公司來源支持的2330，其他候選不藉產業tag復活 |
| Quality負向 | 匿名401、歷史輸入400、缺來源409 RESEARCH_QUALITY_REJECTED；既有report不變 |
| Atomic/FK/RLS | 真實PostgREST，10並行claim只有1lease；5次reuse；真實member trigger故障時5表全部回滾；不存在Auth user FK拒絕；匿名RPC401 |
| Reader競態 | 真實publication在兩次讀取間commit，最多重讀一次；新revision配新來源；仍不同則409，不回混合payload |
| Public/member/Admin | 同report_date/canonical revision/主句；匿名與free看public，member/admin看合格2330；client tier/user_metadata不能升級 |
| LINE | 真實line-daily-push只在vendor fetch邊界使用本機接收器；1次HTTP200、第二次ALREADY_SENT；收到的payload與outbox完全一致；正式LINE未呼叫 |
| Closing | strict-close review200、CVE200 complete/hit，opening_decision_snapshot_id為同一盤前revision；6個獨立合成checkpoint輸入保留identity |
| Learning | 真實CLE200：2predictions/10outcomes/2reviews/2cases；failed0；同來源再次執行reuse；不改Production規則 |
| Acceptance | 真實health/orchestrator/append-only RPC：verdict PASS、blocking[]；manual_intervention=true、automatic_stable_day=false |
| Recovery | 真實canonical_member_recovery重跑2次HTTP200、同member revision重用、notifications_sent0，既有LINE outbox雜湊完全不变；未重跑checkpoint/Closing/Learning |

本機日期2026-09-07；report `0aeb4c7e-5290-4145-993d-deca0da475c2`；canonical `84cd3054-c9aa-4cd9-a614-fc8702cc3034`；Closing `4be9e8f5-9bf0-489a-ba57-fa549474d74d`；Learning run `3bd7ddb0-442a-496d-95c8-c2a8251e6111`；Acceptance `9493dab8-35ce-46ce-8d63-514b3a589476`。
這些均為本機合成識別，不是Production驗收紀錄。9/4缺資料FAIL與先前測試失敗均保留，未抹除。人工執行不準時與來源provenance未自動驗證，所以不計自動穩定日。

外部替身：market/news/sector只使用可重現合成輸入；OpenAI使用既有skip_openai deterministic路徑，保留正式Prompt/模型設定但未花費AI費用；GoTrue email送本機Mailpit；LINE只在外部provider邊界改送本機receiver；fonts/CDN/logo網路被阻擋。Auth/JWT、DB/RLS/FK/trigger、實際Edge與RPC、Closing/CLE均真實執行。不得把上述結果當正式資料商、OpenAI或LINE供應商交付成功。

### Browser抓到的必要mapping修復

1. Canonical member的intraday_validation/invalidation是字串陣列，舊mapper只讀物件，誤丟驗證與風險；現在兼容原物件與新字串，不從時鐘生成完成。
2. `range`是market_regime，不得覆蓋market_bias；public payload恢復真正方向欄位，regime仍保留在canonical_decision。
3. verified close新增COMPLETED呈現，不當INSUFFICIENT，也不升級成ACT。WAIT/no_trade不因收盤被說成失敗；真正runtime failure才STOP。
4. Recovery後股票的transmission_path/confirmation_condition/taiwan_supply_chain_relation正式欄位未被Opportunities讀取；補alias後保留有證據的2330，缺條件仍隱藏。未改篩選策略或樣式。
5. Today原本把未發生的invalidation condition標為「目前失敗原因」；現在只在STOP且runtimeFailure時顯示實際runtime reason，不捏造失敗。

最終Browser：Free/Member/Admin真實同context PKCE、server profile/entitlement、Reload、RLS全部PASS；7頁Home/Today/Opportunities/War Room/Research/Verification/Performance HTTP200，35組375/390/430/768/1440測量horizontal overflow0，內容主句與revision一致。
1120 response、48 API response；3個故意RLS403，其餘非預期API错误0；Realtime phx_reply ok、socket errors0；pageerror0、warning0。總console error99＝96外部資產被隔離防護阻擋＋3故意RLS403；不宣稱總console0。截圖/Network已去除Auth query/token，外部產品未受影響。

### 最終程式驗證

Node320/320；Deno50/50；三支Edge check exit0；npm type-check exit0；Lint exit0/0warnings；Build exit0/202modules/1.68s；git diff --check PASS。獨立真實PG CI等價Integration4/4（同migration兩次、grants、原子/並行/重試、HTTP reconciliation、immutable acceptance）。最後來源manifest保護698個Production宣告原文，41項必要差異附前後hash；沒有更換AI/策略參數。

### Git交付與正式發布邊界

最終實際清單由Git取得：44個檔案、+10108/-272（24 tracked修改＋20新增）；較前39檔多5個必要frontend mapping consumer，非Subscriber UX重設計。下方35/36/26/34都是歷史，不再是最終範圍。無.env、容器資料、Credentials、原始Mailpit信、暫存比較檔或Production個資納入提交。
Branch `codex/core-stability-20260907`；base `bf7efba525d7919f397b93045c3b9e10ae201067`；本文件隨最終候選Commit提交，Commit/PR/CI識別以PR及結案回報為準，不自填未知SHA。

下一個精確Gate是**獨立Production操作核准**，不是仍缺本機工具。此時沒有Production Migration/Deploy/Recovery/Cron/Merge/LINE重送，也不繼續跨越到Decision Engine／Subscriber UX正式發布。

發布計畫（只交付，不執行）：

1. 核对最終PR SHA/CI、Production版本v227(generator)/v27(orchestrator)/v40(payload)及manifest來源hash，取得部署當下rollback artifact；若漂移重新唯讀比對，不用舊來源盲蓋。
2. `20260907072722_reconcile_canonical_schema_truth.sql`目前只獲本機核准。Production已有對應objects；先做object-level dry diff，取得單獨Auth trigger/ACL核准後才可正式套用。它不是遺漏的歷史migration通行證；news_event_tags移除client TRUNCATE是刻意least-privilege差異。絕不db push整批pending檔。
3. 正式原子RPC候選僅 `20260907030607_core_research_atomic_publication.sql`，SHA256 `a3a683a947fd8a16e155ac3c09e4434599ac5e28e133882a37ef495c79b3f542`。依6RPC簽章/ACL與已有表檢查後单檔套用，記錄migration ledger。新增RPC只給service_role，多表同transaction；舊reader兼容。
4. 逐支部署 `generate-daily-report-v7` → `daily-delivery-orchestrator` → `get-report-payload`，完整相依範圍見source manifest（含新增research-pipeline-contract與candidate-evidence）。每支完成Auth/CORS/compile/status後再下一支，不部署LINE、Closing、Learning、Emma、ContentOS或SignalLab；既有JWT/Secrets不改。
5. 本輪五個frontend mapping修復需另核准前端bundle發布；不可說只部署Edge就已修好畫面。保留目前Readdy版本，按同SHA Preview驗收再Publish；不用Auto-Fix。
6. Recovery指定2026-09-07：若執行時仍為台北9/7且fresh來源/正式safe-recovery dry-run通過，才以suppress_notifications=true生成；到了9/8或以後禁止拿新行情補9/7，只可同日原始evidence與合格canonical的member-only correction。先核對已送LINE receipt hash；前後必須完全相同且通知0；不足就拒絕，不硬補成功。
7. 回復：停止新版本入口，不刪業務row；從已保存且hash確認的三支原source artifact逐支重部署（新version號，不偽稱回舊號）；只以保存的 `rollback-existing-rpcs.sql` 原簽章/ACL作經核准forward rollback，保留新增稽核資料與RLS，不DROP表；前端回原保留版本。先以local真實RPC驗過原/新相容性。任何回復另記錄實際結果。
8. Production Smoke/Acceptance需重新實測真實資料、same report/revision、供應商receipt、安全Entitlement。只有其PASS後才依原任務接續Decision Engine V1及Subscriber UX/Product Contract，不能把本機分數或本文件當其PASS。
9. 14-day monitoring規格：Asia/Taipei平日08:55 MORNING、15:35 FULL_DAY，既有append-only acceptance RPC；非交易日/未到期NOT_DUE，失敗永久保留，人工Recovery與incident delivery不計穩定日。持續排程直到明確14日目標完成，沒有執行5次就停的上限。正式Gate通過前不啟用，不修改Cron。

具體待核准文字：核准以本Draft PR最終CI PASS的SHA為唯一release artifact，在部署當下重新確認Production來源/rollback基線後，單獨審核上述canonical reconciliation所需差異、套用指定atomic migration、依序部署三支Function與最小前端mapping，執行指定日期無通知safe recovery及唯讀Production Smoke/append-only Acceptance；不重送LINE、不改業務結果、不改Secrets/RLS策略、不把人工Recovery計自動穩定日。Merge需另外核准。**本輪未執行上述正式動作。**

## 歷史紀錄（以下為前輪狀態，保留失敗證據，非目前Gate）

### 前輪結論

LOCAL_FULL_STACK_E2E = **PARTIAL / BLOCKED_BY_SCHEMA_SOURCE**。不是Production PASS。
本機環境已實際建立並完成真實PKCE、權限、核心頁面與原子發布驗證；不能將合成publication fixture當成完整AI生成研究。
必要完整E2E未全過，故尚未Commit、Push或建立Draft PR，CI亦尚未有本輪Commit可驗。

### Sony提供定義後的實作續作（目前狀態）

三個Auth／immutable函式的正規化MD5已與Production catalog一致；已建立真正Migration `20260907072722_reconcile_canonical_schema_truth.sql`。其中包含Production table/constraint/index/RLS、正確的GENERATED ALWAYS identity及兩個Auth trigger，並將news_event_tags的公開角色收斂為SELECT，避免TRUNCATE繞過RLS。
使用新的ma-core-clean-20260907專案、獨立internal network及54351/54352/54354連接埠，保留原測試環境。全新空資料庫重播25個schema檔全部PASS（含15個去敏legacy foundation tables與Repository必要Migrations）；沒有複製舊測試row／Production user。
新Migration額外套用兩次PASS；真實GoTrue＋Mailpit＋PKCE的Free/Member/Admin三組測試PASS，profiles由Auth trigger自動建立，惡意user_metadata仍只得到free；Email更新由真實Auth觸發同步。session重新建立client後由server驗證保持，這是SDK驗證，不冒稱Browser E2E。
真實不可變UPDATE/DELETE guard、RECOVERY identity分離、公開TRUNCATE拒絕均PASS。Acceptance RPC已正常執行並保存空交易日FAIL（id 5b89693f-999e-4f51-a7c5-3fa2d61a2f29）；這證明缺表已解，不代表完整交易鏈通過。
新阻擋：已唯讀取得Production `advance_trading_day_state_v1`（MD5 a1af0d71f9ef824c5876816a2040fcc9）與`set_updated_at`（MD5 9b1889f56258bf9d6554213c05019c76）既有定義。但將其與sector_stock_map／market_patterns更新trigger納入本機canonical Migration遭安全審核拒絕。兩個工作目錄已證明同一Git root/HEAD/origin，generator及Closing依賴亦已查明；提交這些證據後仍被拒絕，要求知悉風險後重新明確核准。被拒補丁未寫入、未換通道執行。
唯一需補充核准的具體動作：在codex/core-stability-20260907本機Migration納入上述兩函式及兩個既有更新trigger，保留Production簽章、既有DEFINER及service_role-only lifecycle ACL；可能影響DEGRADED/core-complete的狀態推進與updated_at，須重新做clean bootstrap及完整鏈回歸。不是修改Production、不是新策略、不是修改三個Sony已提供函式。
完整Generation/Closing/Learning/Acceptance正向E2E尚未完成，因此不Commit/Push/PR/CI/Deploy、不進Decision Engine或UX發布、不啟動14日觀察。原有修補完整保留。

### 後續 Track A1 逐物件授權查核（2026-09-07 07:18 UTC）

最新任務附件為2314d593-b50a-40fc-8f9c-9cfd93374aa6，明確要求依序A1至Production驗證後才做Decision Engine／Subscriber UX／14日觀察。
本輪沒有重讀歷史Migration全文，改依核准的object-level catalog取得market_checkpoint_snapshots及news_event_tags：欄位、約束、索引、RLS/FORCE RLS、policies、grants、trigger名稱與定義。去識別來源保存在core-schema-truth-20260907.json，沒有業務row、Auth user或Vault資料。
但對public.handle_new_user()、public.handle_user_email_update()、public.reject_immutable_market_checkpoint_mutation_v1()的pg_get_functiondef唯讀查詢，安全審核仍拒絕，理由為可能包含敏感Auth實作、內部URL或秘密，且視完整函式來源授權不足。這是執行工具的安全拒絕，不是使用者沒有批准Track A1。
沒有拆分相同全文動作、改走CLI/dump或用假函式繞過。尚缺完整定義，故不產生假裝完整的sanitized migration、不把既有污染過的測試庫當clean bootstrap，不開始Track B／C發布。
唯一人工替代：由管理者提供上述三個函式經去敏的schema-only SQL檔，不含Secret、Vault、使用者row。取得後先核對已保存來源識別、補齊canonical manifest，再完成乾淨重建與後續Gate。
另在catalog發現news_event_tags對anon/authenticated保有TRUNCATE權限；RLS不保護TRUNCATE。這是須在本機驗證與後續最小權限修補處理的既有風險，本輪未執行TRUNCATE、未改Production grants，也未聲稱具有公開HTTP可利用路徑。
本輪僅新增上述schema manifest並更新本文件；原35檔修補保留，總候選範圍變為36檔。下方35檔及測試數字為前一次完整本機驗證的時間點，不代表本輪A3已通過。

## 1. 固定版本與隔離

| 項目 | 版本／識別 |
|---|---|
| Node | 22.23.1，符合package engines ^22.12.0 |
| Deno / Supabase CLI | 2.9.2 / 2.108.0 |
| Colima / Lima | 0.10.3 / 2.2.0 |
| Docker CLI / VM Engine | 29.8.0 / 29.5.2 |
| 專用VM | ma-core-20260907，VZ/aarch64，4CPU/8GiB/35GiB |
| Docker context | colima-ma-core-20260907；未切換全域預設context |
| Local project | ma-core-fullstack-20260907 |
| Network | ma-core-isolated-20260907，Internal=true |
| Frontend / API / DB / Mailpit | 127.0.0.1:4310 / :54341 / :54342 / :54344 |
| PostgreSQL image | public.ecr.aws/supabase/postgres:17.6.1.139 |
| GoTrue / PostgREST | v2.191.0 / v14.13 |
| Edge Runtime image | v1.74.2；runtime banner實際1.74.1，Deno2.1.4相容 |
| Kong / Mailpit / Realtime | 2.8.1 / v1.30.2 / v2.108.0 |
| Browser | 既有Chrome，獨立headless context；bundled Playwright1.62.1 |

本機設定與harness只在/private/tmp/ma-core-fullstack-20260907，不改正式supabase/config.toml或前端正式連線設定。
Vite測試plugin只將實際app的Supabase URL/anon key替換成本機CLI產生的值；PKCE、Auth、entitlement與資料查詢仍走真正GoTrue/PostgREST/Edge。
Edge使用原始整合source的offline bundle；SDK固定2.115.0、target=es2022以避免離線Edge載入Node polyfill型別依賴。不是假Auth handler。
Production既有三支及member-access gateway verify_jwt=false未改；本機沿用其原application JWT/internal auth驗證，不以改正式JWT策略規避問題。

Docker29的internal-only network不發布host ports，因此使用VM127.0.0.1固定三個port的窄範圍TCP入口代理。只解析同internal network已知db/kong/mailpit容器，不提供任意URL代理、不授予container internet egress。
沒有複製Production Secrets/Vault/users/subscriber rows，也未開正式排程。測試身分由本機GoTrue正常建立；profile/entitlement為明確synthetic server fixtures。
郵件送至本機Mailpit；付費AI未呼叫（generator負向測試使用既有skip_openai）。LINE使用不可投遞synthetic prior receipt；尚未完成實際LINE local receiver正向交付，不能宣稱供應商成功。

## 2. Schema重建與真正阻擋

已從Repository重播22個必要Migration，另依允許的Production只讀catalog建立14個前置foundation tables與daily_reports FK依賴。
完整statement manifest列出原始SHA與排除原因：Cron/Vault初始化、Production Owner email backfill、Emma、Alpha Coach均不執行。RPC/約束/安全Gate沒有stub成成功。
本機實際具有79個public tables、62個FK、15個非內建public triggers；cron.job不存在。
候選Migration在此真正Supabase DB額外重播兩次PASS；6個RPC均anon/authenticated不可execute、service_role可execute。

Production存在、Repository未收錄的Migration來源：

| Version | 名稱 | 原始statements MD5 |
|---|---|---|
| 20260828051007 | qualify_runtime_http_reconciler_dispatch_status | 03ac675b92c428ab9ef9c390798d4bf2 |
| 20260828053022 | retain_immutable_market_checkpoint_evidence | b9ec5c62d1d87b77bff4ddd20bdc3020 |
| 20260828082702 | classify_quality_blocks_and_reconcile_runtime_incidents | cf3ad9d9507356a3652f436e379bf82b |
| 20260828083852 | advance_core_complete_degraded_lifecycle | 8d3123267efbde90dea6fb6aecbcad92 |
| 20260830061746 | reconcile_acceptance_and_replay_idempotency | 378150fff4d67834aa995fd68efd85d0 |
| 20260830062715 | allow_terminal_reconciliation_after_quality_block | 797ccd512170bda9f64ee29f69ecdc1a |

Production market_checkpoint_snapshots為14columns、RLS/FORCE RLS、1trigger；news_event_tags為16columns、RLS。兩表皆不在本機重播結果。
真正執行capture_morning_alpha_acceptance_v1('2026-09-04','LOCAL_SCHEMA_PROBE')失敗：

```text
ERROR: relation "public.market_checkpoint_snapshots" does not exist
CONTEXT: capture_morning_alpha_acceptance_v1(date,text) line 69 at IF
```

Auth原有trigger來源也不在repo：

| Trigger | Function | SECURITY DEFINER | prosrc MD5 |
|---|---|---|---|
| on_auth_user_created | public.handle_new_user | true | 2d178e8b187903b59cf1c2f05fe08afd |
| on_auth_user_email_updated | public.handle_user_email_update | true | 42f084213419c92c51eb33cea107ad11 |

已完成Auth不等於Auth trigger parity：本機profile由測試fixture建立，不能宣稱正式自動profile trigger已驗證。

### 安全審核的確切拒絕

- 動作：唯讀select上述6筆supabase_migrations.schema_migrations.statements完整SQL。審核拒絕理由：歷史Migration可能包含Vault/credential/內部URL，現授權不足以輸出完整內容。
- 改先取得names、長度、MD5、configuration/credential風險boolean（均false）後，再嘗試有限且hash受限的全文取得仍被拒絕。已停止全文擷取；沒有以CLI/dump/拆分pg_proc繞過。
- Auth trigger metadata查詢含pg_get_triggerdef及functiondef hash/risk檢查亦被拒絕。之後只取得名稱、DEFINER與prosrc hash，未取得body。
- 需要精確追加權限：只讀取得這6筆Migration及兩個Auth trigger/function的完整schema-only原始定義，以及news_event_tags的canonical DDL；在本機檢查/遮罩任何credential literal，不輸出secret，不查Vault、不查user rows、不修改Production。或由管理者提供同範圍已去敏的schema-only檔案。

不能自行補寫immutable guard或Auth trigger宣称相同。尚未執行的完整正向生成、實際Closing/Learning/Acceptance及供應商替身交付，都受此基線不完整影響。

## 3. 本輪真實Runtime抓到並修正的缺陷

### A. Recovery狀態違反Production CHECK

Production pipeline_runs_delivery_status_check僅允許NOT_DUE/PENDING/SENT/INCIDENT_SENT/FAILED。
原修補將SUPPRESSED寫入該欄位，會使finishPipelineRun更新失敗。
現在DB欄位為NOT_DUE（此Recovery不排程交付），provider_status仍保留delivery_status=SUPPRESSED與suppress_notifications=true。
既有五種交付狀態不變、不新增enum、不改Schema、不偽裝SENT。
真實local CHECK更新PASS；兩次相同member recovery HTTP409/CANONICAL_CONTRACT_INCOMPLETE，Gate拒絕不被豁免，member revision reuse、notifications_sent=0、整個LINE outbox hash不變。

### B. 原子Writer之外的多查詢Reader競態

實際PostgREST舊report GET回應完成後，插入真正publish_research_bundle_v1提交，再讓原payload handler繼續context查詢。
修正前：HTTP200回新revision，但important_news仍舊來源，mixed_revision=true。
修正後：檢查report/decision/member的report_date、report_id、decision revision；不符最多再讀一次，22個DB讀取request後新revision配新來源，mixed_revision=false。
若仍不一致回409/REPORT_REVISION_CHANGED、payload=null，不持續retry。重讀本身失敗回503。
沒有atomic metadata的legacy report仍走原契約；同decision的合法member-only correction可使用較新member revision。
變更不改策略、AI prompt、品質門檻或Entitlement。

## 4. 實際驗證結果（最終Source）

| Gate | 結果 / 證據範圍 |
|---|---|
| PKCE / Reload | free、paid_active member、server admin(owner)，3/3；GoTrue verify303→token200，code移除 |
| Entitlement / RLS | 3/3實際profiles僅自身；member_entitlements直接REST三次預期403；偽localStorage及user_metadata不升級free |
| Public / member read | actual Edge HTTP200，同2026-09-07/revision；free鎖股票，member/admin有合成2330 |
| Atomic publication | 10並行claim一lease、5重讀reuse、缺coverage拒絕、member trigger故障回滾5表、成功同revision |
| FK / 私有RPC | 不存在Auth user的entitlement被FK拒絕；anonymous publication RPC401 |
| Generator負向 | real Edge：匿名401、舊日期400、缺來源409/RESEARCH_QUALITY_REJECTED；既有report hash不變 |
| Recovery suppression | real member recovery兩次都不寫/重送既有LINE；合成不完整研究仍409，不當正向PASS |
| Reader race | 真實DB timing-barrier測試before mixed=true；after mixed=false、最多一次重讀 |
| Migration replay | 候選Migration兩次exit0；6個RPC ACL正確；不等於缺失Production migrations已重建 |
| Type-check / Lint | exit0 / exit0，0 errors、0 warnings |
| Build | exit0，202modules，1.37s |
| Node regressions | 313/313，0failed |
| Deno / Edge | 50/50；generator/orchestrator/payload三支check exit0 |
| Diff check | PASS |
| Full source→LINE→Closing→Learning→Acceptance | **BLOCKED / 尚未完成**，不可用上述分段PASS取代 |

Browser實際用同一合成Admin登入context走Home/Today/Opportunities/War Room/Research/Verification/Performance，7/7路由HTTP200、非空main。
第一輪全頁記錄1120個response、48個本機API response，3個刻意RLS403；另有Realtime未啟用造成WebSocket500。已補啟官方Realtime，restart前後reports/outbox hash及Auth users數量相同。
最終v5重驗：1120response、48個本機API response、非預期HTTP錯誤0；3個刻意RLS403；Realtime websocket errors=0、兩個phx_reply=ok；pageerror=0、console warning=0。舊v4失敗紀錄仍保留。
總console error=99，其中96個是阻擋外部fonts/CDN/logo資產，3個是故意的RLS拒絕。不能將總console數字宣稱0，但沒有未解釋的產品JS錯誤。
Google fonts/cdnjs/Readdy logo等外部資產由網路防護阻擋；這些console記錄保留，不宣稱總console=0。未將Supabase API response改成fixture成功回應。

## 5. Git與交付

Branch仍codex/core-stability-20260907，HEAD/origin/main仍bf7efba525d7919f397b93045c3b9e10ae201067。
本輪真正程式修正：daily-delivery-orchestrator/index.ts、get-report-payload/index.ts；回歸在tests/coreRuntimeIntegration.test.mjs，來源manifest與文件同步。
其餘既有修補保留；同HEAD最終Git清單為35檔（tracked19＋untracked16），+8902/-253；tracked單獨+1332/-253。完整路徑為主報告第1節的34檔加本補充文件，主報告逐檔舊行數僅是歷史紀錄。本機容器資料、tmp harness、Auth session及非去識別檔案不納入Git。
COMMIT_SHA=NONE；DRAFT_PR_URL=NONE；CI_STATUS=NOT_RUN。必要完整E2E未過，不滿足附帶核准Commit條件。
未Merge、未Production Deploy/Migration/Recovery/Cron/Secrets/Auth變更、未重送LINE；PR88/100/103未操作。

去識別證據與可重現harness保存於Codex工作產出目錄的core-stability-local-runtime-20260907.tar.gz；只含白名單scripts、catalog metadata與去除query/token的斷言紀錄，不含環境憑證、Mailpit原信、Cookie/JWT、container volumes。這是本機測試artifact，不列入Git diff。

## 6. 正式發布方案（尚不可執行）

精確部署範圍不增加：generate-daily-report-v7、daily-delivery-orchestrator、get-report-payload及來源manifest列明的全部相依。
唯一候選Migration：20260907030607_core_research_atomic_publication.sql，SHA256 a3a683a947fd8a16e155ac3c09e4434599ac5e28e133882a37ef495c79b3f542。
先完成來源基線/完整隔離E2E/最終Commit與CI；再核准Migration→generator→orchestrator→payload，逐支驗證，保留現行JWT/Secrets。
回復：以已保存Production source archive重部署原三支，再用已驗證原3個RPC定義/ACL做forward rollback，不刪業務row或LINE收據。
2026-09-07Recovery只在實際台北今日仍是9/7時使用現有safe-recovery dry-run審核後無通知生成；到9/8後不得用當日行情補9/7，僅允許既有同日Canonical member correction且Canonical本身合格。
08:55 MORNING與15:35 FULL_DAY驗收方案沿用主報告；不設五次後停止，人工Recovery不累積自動穩定日，未到期NOT_DUE。

核准文字草案：待來源基線、完整本機E2E、Draft PR最終SHA及CI全部PASS，另核准唯一上述Migration及三支Function逐支受控部署、指定日期suppress_notifications=true的safe-recovery、長期append-only上午/下午監控；禁止LINE重送、商業結果竄改或人工Recovery計入自動穩定日。現在不執行此草案。
