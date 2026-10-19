# 從實際 Producer15／Reader56 準備四季 Owner 研究閉包

本候選只有 Source 與離線封裝；沒有部署、自然資料捕捉啟用、SQL、Provider 呼叫或 Secret 讀取。基準為 `bd941dc3ead8eb66eeaf2b21ca13acf1c90f98e4`，原 PR271 的14檔、357列 seal、四季 helper／來源包／UI 都不改寫。既有 Git Producer／Reader／foundation 全部保留原 bytes；部署候選完全由實際正式基線加小 patch 重建，不取整包 Git 入口。

## 四個可讀、固定的產物

| Variant | runtime | type-only | static | 合計 | 用途 |
| --- | ---: | ---: | ---: | ---: | --- |
| `producer` | 39 | 176 | 36 | 251 | 原15加 quarter-only capsule；同版SDK本機化 |
| `producer-recovery` | 35 | 176 | 36 | 247 | 原15業務行為；停止建立 capsule |
| `reader` | 55 | 170 | 20 | 245 | 原56加同請求 Owner核對／已存 capsule／strip |
| `reader-recovery` | 51 | 170 | 20 | 241 | 所有人都strip新私有祖先；無新Owner RPC |

`scripts/operations/owner-quarter-live-release-20261019/materialize.mjs` 僅接受這四個 variant。固定 ignored build 目的地使用 `wx`，不能覆寫舊產物，不能指定 ref／路徑／任意來源。來源缺失、雜湊或長度漂移一律拒絕，不下載、不 lazy-fetch。完整來源列表與 payload hashes 在 `release-catalog.json`；四份 `*-entry.patch` 是供人工審閱的小差異，不改 global 來源。

原 Producer15 20檔已逐一核對固定 Git `5f337778…`。Producer20檔與Reader56 50檔各保留成 deterministic gzip；Reader由實際已部署 payload留存，逐檔 SHA 與原 bundle／部署收據分開記錄。Producer 原 SDK63份也保留為離線來源鏈，不能視為新網路 freshness 證明。先前失敗的 SDK batch 不重試、不重設。

Producer SDK 唯一 import 明列改用 PR269 已保留的同版2.57.4、15個 local modules＋30份 upstream notices／provenance；沒有換版，也不是原 ESZIP 位元相同回復。Reader12個實際 vendored2.115 modules 與 public model `9f99fd79…` 完全保留。兩邊 SDK 都使用真正官方 declarations：Producer原63 body內48份；Reader精確2.115本地套件42份，另有8套件原LICENSE與package metadata共16份。既有官方 `@types/node`26.0.0／`undici-types`8.3.0及原文LICENSE／metadata提供Buffer／NodeJS等ambient，未另安裝或抓取。新增Phoenix1.6.7兩份原LICENSE／metadata；不能用舊30份notice概括2.115新依賴。所有原文、機械literal trace、type/static分類與hash在type catalog及gzip，沒有手寫SDK façade、`any`／`no-check`／`skipLibCheck`。

原Reader懸空type註解改指真實已封存SDK declaration wrapper；Producer也補同樣明示type入口。declaration module literals使用.js／.mjs別名保持普通value/type exports，獨立compiler-only map精確映回真實.d.ts／.d.mts及既有type-only phase。Node／Undici原文保持不變。此map只在build中的Deno check config使用，Function payload沒有import_map。四份須各自建立獨立編譯program，避免多份Node ambient重複宣告。原兩份business evaluator／official parser global files與實際15／56業務bytes均不回退。全部runtime emission與11/11測試時固定snapshot的JavaScript逐檔相同；SDK runtime SHA也相同。

## 不依賴市場法人 capture

新增的 typed `recommendation-owner-quarter-capsule.ts` 只依賴既有 stock saved-reader／phase、PR271 quarter helper、留存 JSON 與 hash contract。封裝完全沒有 `recommendation-foundation-candidate.ts` 或 `recommendation-market-institutional-candidate.ts`，也不呼叫 `acquireMarketInstitutionalTwd`／`withMarketInstitutionalEvidence`。

Producer 先照原15產生正式 proof，再在 PREMARKET、同 report date／correlation／cutoff 下附加 `RECOMMENDATION_OWNER_QUARTER_RECEIPT_V1`。只有來源包建立時間不晚於新的 evidence cutoff 才能建立 capsule；不修改 acquisition cache 的既有 payload，不補寫過去 Report，不改正式 decision。09:00起不擴大成盤中新捕捉；10/19 07:06舊早報不能使用01:12Z之後才建立的新來源包。

候選在合法當日PREMARKET／UNIVERSE72的新proof可附加capsule；沒有新增DB exactly-once鎖或Report首次存在查核，依賴原Caller／Producer的idempotency與新saved-proof綁定。若未來發布，新增保存位置為原報告生成流程的 `reports.ai_strategy_json.recommendation_stock_evidence.foundation_candidate` 的私有 capsule，仍須依既有自然 Producer／Report 流程發生。本候選沒有執行該流程。D 的這個新私有捕捉範圍保持未啟用，與市場法人 capture 分開；E正式來源准入、會員研究公開及歷史29份公開繼續 HOLD。

Reader 先沿用 `persistedRecommendationReaderInput`，核對同份 Report 的 canonical revision、correlation、Producer decision 與 cutoff。只有同請求真實 Auth user ID 與 user-scoped `is_research_owner_v1()` literal true 通過，才從已存在的 matching capsule 建 Owner study。Owner 判斷不使用 service-role Authorization；沒有新 Auth／RLS／權益規則。既有DB特權admin信任仍存在：當前reports RLS只准profiles.role=admin，現有admin1位亦在啟用Owner allowlist；既有predicate另外要求owner_access.enabled。不能宣稱未來任何admin都被DB自動限制成Owner-only，新增／變更admin需重審。未保存 capsule 就保持缺失，Reader 不建立 capsule、不新增來源、不延長可用時間。

非 Owner admin 的 `admin_source_report`、一般會員、匿名及 history 都移除整個私有祖先，保留其他診斷；Owner查核失敗同樣拒絕。正式 Member／subscriber input 與正式 proof 保持原15／56行為。四筆 Actual 仍缺公告版本、Consensus／Guidance及正式准入，不會把72檔升成 READY。

## 未來發布與回復的硬邊界

目前沒有任何發布授權或執行。若之後這個精確候選獲准，必須先讓 Reader 的拒絕／strip 能力生效，再讓 Producer 自然保存新 receipt；不手動補跑，不把本輪的合成 Report 當正式資料。真實 Generator248的完整 source passthrough 仍需獨立核對；本輪只證明原 retained Git 的 acquisition passthrough 與實際封裝函式在合成 Report 中相容。

首次保存私有 capsule 之後，安全回復是 Producer recovery（35 runtime）停止新capsule、Reader recovery（51 runtime）繼續strip；不得只退回 untouched Reader56，因為已保存的私有祖先仍在。保留原 Report，不刪資料、不回填、不重置 cache。正式基線／SDK／來源指紋漂移、任何非預期 Provider 或 table mutation 都停止。

## 驗證界線

測試直接執行 materialized Producer39 runtime／Reader55 runtime及兩個 functional recovery 的實際 SDK與 entrypoint，不拿 current Git handler 代替。來源／恢復／靜態 closure 及 capsule、Owner、raw-admin stripping、Member、history、phase與舊報告拒絕均有具體離線控制。資料與 Auth／SQL ports 明示合成；原 `ensure_member_entitlement_v1`／既有 projection receipt RPC 的合成行為不能稱為「所有 RPC 無寫入語意」。網路阻擋 preload 不是 OS sandbox，也不是正式 Gateway／Owner E2E。

本機沒有 Deno，不安裝猜測版本、不重啟已停止安裝。CI 新增步驟只 materialize 同一閉包，再以 `deno check --no-remote --cached-only` 驗四個實際入口；未拿本機 TypeScript PASS 冒稱 Deno PASS。本機4份actual artifacts各自嚴格TypeScript檢查0 diagnostics，型別只來自artifact保留來源（無外部node_modules types），不等於Deno編譯通過。原98項缺型別與後續type-port／多program預檢失敗log仍保留；沒有刪錯誤證據。新獨立workflow不修改原357列封存內的CI檔；實際Deno編譯與精確HEAD CI仍待Root Commit／Push後取得，不盲稱PASS。

Root於2026-10-19 02:21Z fresh唯讀核對actual15／56來源，Producer20＋Reader50共70/70與基線bytes相同：`ACTUAL15_READER56_BASELINE_FRESH_MATCH_SAFE.json`。獨立有限runtime覆核無具體finding（`LIMITED_OWNER_QUARTER_RUNTIME_REVIEW_SAFE.json`，SHA4444df88…），不等於正式安全scan或Production E2E。最終standalone review inventory綁定本候選每個新檔與immutable bd941來源，原357列seal保持原文；唯一current top successor逐列加入本候選，原guard保留unknown拒絕及注入drift驗證。

首次精確HEAD CI（3fb6546e，run39190275844）已執行實際Deno check，Producer報80項TS2307：官方Node index內bare triple-slash path未經Deno解析，後三份未執行；不是PASS。修正只在compiler-only config按原宣告所在目錄建立80個精確scoped local aliases，所有target必須已封存在相同artifact，官方type與runtime bytes不改。四個Deno步驟在setup成功後各自執行，任一失敗仍令job失敗，不跳過後續錯誤診斷。

另已唯讀核對實際Generator248的來源與Atomic／sidecar函式。acquisition可保存至Report的ai_strategy_json與raw_ai_json；member／LINE白名單未選該祖先。既有sidecar先作DB白名單投影，已用純合成SELECT證實移除該祖先；未執行記錄RPC或任何業務寫入。此資料流驗證不取代自然保存、Owner E2E或D範圍發布核准。
