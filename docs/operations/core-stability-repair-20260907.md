# Morning Alpha 核心穩定性整合與發布審查 — 2026-09-07

## 結論與目前權限

**LOCAL FULL-CHAIN E2E = PASS（隔離合成輸入、真實 Runtime）；PRODUCTION FIXED = NO。** 最新 Gate、精確清單、Git/CI及發布限制以 [本機完整驗收結案](./core-stability-local-runtime-20260907.md) 的「最新結案」為準。下方舊計數與前一輪阻擋保留作歷史對帳，非目前驗收結果。

Sony 補充核准的兩個 Function／兩個 Trigger 已按正式契約保留；缺失的 service_role grants 已依 catalog 補齊於本機 Migration。清楚區分本機合格、正式發布、自然自動穩定日。完整任務下一個階段需獨立 Production 操作核准；不因本機 PASS 啟動收費或14日試營運。

本報告取代上一版「main / 26 files / 尚未整合漂移」的描述；舊正式查核證據仍保留並標明時間。
來源→Canonical→Evidence→Editorial→Premium→Semantic→LINE→Closing→Learning→Acceptance 必須同一交易日、同 revision 才可過關。
沒有推薦、HTTP200、網站可開，都不是核心流程 PASS；人工 Recovery、歷史補验及異常 LINE 不計自動穩定日。

實際 Git root：`/Users/sonytzeng/Documents/GitHub/morning-alpha`。
Branch：`codex/core-stability-20260907`。
HEAD / main / origin/main：`bf7efba525d7919f397b93045c3b9e10ae201067`；與 origin/main ahead/behind = 0/0。
原有未提交修改完整保留後建立分支，沒有 restore/stash/reset 或覆蓋另一個 clone。
全部變更未 staging。沒有 Commit、Push、PR、Merge、Production Migration、Deploy、Recovery、Cron、Secrets、Auth 或業務資料寫入。
PR #88、#100 未更新；Emma、Sony Content OS、Signal Lab、付款、试營運均未操作。

## 1. 前一輪 26 / 34 檔案差異：同一基準歷史對帳（目前清單見補充文件）

上一輪 repo diff（同一 HEAD）是 **26 個唯一正式檔案，+2254/-127，淨 +2127**。
介面是該輪累計 file-edit 紀錄：**34 個路徑，+14393/-165，淨 +14228**，混入八個 /tmp 檔案。

八個 temporary 路徑均位於 `/tmp/ma-core-audit-20260907/`：

| Temporary file | 最終行數 |
|---|---:|
| base-index.ts | 2810 |
| merged-index.ts | 3118 |
| base-research-master-v2.ts | 1737 |
| merged-research-master-v2.ts | 1981 |
| red/research-master-v2.test.ts | 606 |
| red/research-master-v2.ts | 1737 |
| red/research-quality-gate.test.ts | 23 |
| red/research-quality-gate.ts | 89 |
| 合計 | 12101 |

數學對帳：14228 - 2127 = 12101。累計新增差12139、刪除差38，淨值12101；多出的38行屬編輯過程的刪除/再加入，不能拿UI累計數當最終Git diff。
證據來自原任務 fileChange 紀錄與 /tmp 實檔；不是猜第二份 Repository。
八個 /tmp 檔案沒有在 Git、staging 或正式 import graph，不作部署基底。它們是比較/RED測試素材，不是另一個 clone。

**前一輪整合後剛好也有34個正式 Repository 檔案，但不是上述UI34個路徑；這不是本輪最終統計。**
其中19個 tracked修改、15個本輪新增（未追蹤）檔案。新增8個正式檔案：CI、source manifest、Production daily-delivery helper、Production candidate-evidence、preservation test、runtime integration test、Edge test loader、publicRelease regression update（此列指相對原26清單新增範圍，不表示全部是 Git untracked）。
前一輪同一 HEAD 的完整變更量：**34 files，+8673/-250**。當時Git diff --stat 只含 tracked19檔的 +1293/-250，另須加計未追蹤15檔；本輪結果以補充文件為準。

分類：P=正式部署既有能力；R=本次必要修復；T=測試/文件/CI；無關修改=0。
以下「原26」標示上一輪完整清單；其餘8列為本次核准整合所需。

| 舊範圍 | 完整相對路徑 | 相對 HEAD 新增/刪除 | 分類與用途 |
|---|---|---:|---|
| 本次新增 | `.github/workflows/validate-release.yml` | +46/-0 | T｜只增加 Node/Deno/隔離 PostgreSQL 驗證；沒有 Deploy、Cron 或 Production secret |
| 原26 | `docs/operations/core-stability-repair-20260907.md` | +363/-0 | T｜本次範圍、驗證、阻擋與未執行的發布/回復計畫 |
| 本次新增 | `docs/operations/core-stability-source-manifest-20260907.json` | +4450/-0 | T｜Production/main/整合前/整合後雜湊；699 protected declarations 與40項 reviewed differences |
| 原26 | `src/lib/runtimeDecisionTimeline.ts` | +2/-2 | R｜修正 generic status 回傳型別，不改畫面或完成條件 |
| 原26 | `supabase/functions/_shared/content-intelligence.ts` | +45/-10 | P+R｜保留 Production 完整 no_trade research 判定；必需來源缺漏不得被當正常無推薦 |
| 本次新增 | `supabase/functions/_shared/daily-delivery-recovery.ts` | +98/-2 | P+R｜保留 V1.7 due-slot retry/phase completion；RUNNING 不當成功 |
| 原26 | `supabase/functions/_shared/premium-content-gate.ts` | +5/-8 | P+R｜沿用品質門檻，缺 Research Master/品質證據 fail closed |
| 原26 | `supabase/functions/_shared/production-architecture-core.mjs` | +21/-7 | P+R｜Canonical 空清單權威、品質計數不補零；原策略政策不變 |
| 原26 | `supabase/functions/_shared/research-pipeline-contract.test.ts` | +78/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `supabase/functions/_shared/research-pipeline-contract.ts` | +164/-0 | R｜輸入指紋、同日防護、Canonical reader、公司證據、bounded retry/automatic-day contract |
| 原26 | `supabase/functions/_shared/research-quality-gate.test.ts` | +23/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `supabase/functions/_shared/research-quality-gate.ts` | +30/-20 | P+R｜100% coverage 與必要計數嚴格驗證；不把 conditional claim 忽略後補成100 |
| 原26 | `supabase/functions/daily-delivery-orchestrator/index.ts` | +273/-52 | P+R｜保留 V1.7 checkpoint/health/closing/sector/歷史模式；回條 lineage、雙 LINE suppression、同日研究 gate |
| 本次新增 | `supabase/functions/generate-daily-report-v7/candidate-evidence.ts` | +185/-0 | P｜取自已驗證 Production source，內容逐位元正規化比對相同；不是新策略 |
| 原26 | `supabase/functions/generate-daily-report-v7/index.ts` | +328/-43 | P+R｜整合 Production 候選/AI 能力；company lineage、lease、atomic publication、精確日期 |
| 原26 | `supabase/functions/generate-daily-report-v7/market-freshness.ts` | +9/-1 | P+R｜台股代碼與過期來源判斷，不將過期資料當新行情 |
| 原26 | `supabase/functions/generate-daily-report-v7/research-master-v2.test.ts` | +37/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `supabase/functions/generate-daily-report-v7/research-master-v2.ts` | +315/-90 | P+R｜保留正式 source/representative enrichment；修 claim identity、空 canonical 與 future counterevidence |
| 原26 | `supabase/functions/get-report-payload/index.ts` | +13/-8 | R｜public/member/admin reader 使用同一 gated canonical revision；保留 admin-only 診斷 namespace |
| 原26 | `supabase/migrations/20260907030607_core_research_atomic_publication.sql` | +630/-0 | R｜3 新私有 RPC＋3 既有 RPC 修正；保留正式簽章/ACL；Acceptance 不隱含 Recovery |
| 本次新增 | `tests/coreProductionPreservation.test.mjs` | +33/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 本次新增 | `tests/coreRuntimeIntegration.test.mjs` | +182/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/fixtures/core-acceptance-schema.sql` | +520/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/fixtures/core-research-indexes.sql` | +7/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/fixtures/core-research-publish-baseline.sql` | +379/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/fixtures/core-research-schema.sql` | +83/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 本次新增 | `tests/helpers/isolatedEdgeLoader.mjs` | +52/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/marketFreshness.test.mjs` | +7/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/premiumContentGate.test.mjs` | +22/-5 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/productionReliability.test.mjs` | +20/-1 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 本次新增 | `tests/publicRelease.test.mjs` | +5/-1 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/researchPipelineDatabase.integration.mjs` | +231/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/runtimeDecisionTimeline.test.ts` | +9/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |
| 原26 | `tests/runtimeReportState.test.mjs` | +8/-0 | T｜去識別回歸／資料庫 schema 或正式 RPC 基線 fixture；不含 Production rows |

## 2. 可信 Production Source / main / 本機對照

正式 target 唯一為 TWMarketAI `cttfzgvhiewfckydcrci`。
使用 Supabase Management 唯讀 get_edge_function 取得 entrypoint 與整包相依；不是以 main 冒充 Production。
[機器可讀逐檔來源清單](./core-stability-source-manifest-20260907.json) 記錄每檔 Production raw-source SHA、正規化 SHA、main SHA、整合前 SHA、最終 SHA及分類。

| Function | Deployed version | Updated at (UTC) | 整包 artifact SHA-256 | Entrypoint raw-source SHA-256 |
|---|---:|---|---|---|
| generate-daily-report-v7 | 227 | 2026-09-02T03:36:22.943Z | `afbee9c480f1b92b7b419670bc95e32d10abd9fc1c3c37090042a88daef8002f` | `ddcf7b46b32dba1ac4ad496846aecab518409b455e1f41754972388de85a511b` |
| daily-delivery-orchestrator | 27 | 2026-09-04T03:01:45.508Z | `c41ead58b8e49fbd832febaae7cd8ad021f465b909f446bde66f7efe53022d44` | `5c711fe8b0c723929f40a6391273b3da689dfcbbea429b286f88d51ed9544a24` |
| get-report-payload | 40 | 2026-08-30T06:20:04.485Z | `2733ffe827f602941b7d5c938d58fbd332f7328fc199b7f9511a3c79b1b8febd` | `ed31ee987d4f719bb769da3ae0c6aaaf98cfabb587f4dd5a2e52f2d6ed4fdc12` |

artifact SHA 不是 entrypoint SHA；canonical_content_sha256 只 trimEnd，以排除備份自動加的最後換行，沒有忽略程式差異。
三支正式既有 verify_jwt=false；本機原 config.toml 同值，本次未改。這不是新增 no-verify workaround；Function 內部驗證仍保留，發布前須逐支再次比對。

逐項比較結果：

| 差異範圍 | Production 既有能力 | 最終整合 / 必要行為差異 |
|---|---|---|
| generator v227 vs main | Industry anchoring、known supply-chain bridge、repeat penalty、conditional recommendation、AI abstention、model/prompt/cost guard | 正式能力保留；新增 company-specific evidence、實際引用 lineage、原子發布、同日/lease |
| research-master-v2 | source context、transmission narrative、代表股來源/role enrichment | 正式能力保留；claim identity 去重、Canonical空陣列權威、future condition不能假裝反證 |
| candidate-evidence | 正式 industry relevance/bridge weights | 與正式 source 相同，沒有另建新 scoring model |
| content-intelligence | 完整 canonical no_trade research gate（章節/來源/時間軸） | 保留；缺必需sector/news或未驗證數據不得當合格no_trade |
| premium/quality | 原品質政策門檻與隔離 | 保留門檻；缺值不得補0，95%不得忽略conditional內容補成100% |
| orchestrator v27 / V1.7 | due-slot retry、歷史checkpoint/closing、sector refresh、health、phase completion | 保留；RUNNING≠成功、回條run/revision、兩種LINE suppression、拒絕把當日輸入生成歷史研究 |
| get-report-payload | server entitlement、public/premium隔離、admin診斷 | 不改權限；admin閱讀使用同Canonical投影，raw僅admin-only namespace |
| 其他相依 | Market date、internal auth、learning policy、runtime market overlay等 | 原文不變；完整相依清單見第7節 |
| Migration / tests / docs | 原RPC簽章/安全政策、既有表 | 只新增私有RPC與strict評估，測試/文件不作業務輸出 |

最新逐宣告核對 **698個 Production declarations** 原文字雜湊不變，另記錄 **41項必要修改/移除宣告** 的前後hash與行號。原699/40中的finishPipelineRun因真實Production CHECK不接受SUPPRESSED而新增必要修正；沒有刪減策略保護項目。
保護包含 OPENAI_EVIDENCE_GUARDRAILS、OPENAI_OUTPUT_ABSTENTION_RULES、system/user prompt、V10 metadata/beneficiary calculation/repeat penalty。
entrypoint request handler 不是 named declaration，另經diff與實際handler回歸審查；698不等於整檔無變更，也不是AI全文實跑保證。payload新增有界一致性重讀，解決已重現的舊report配新revision競態。
所有 source都能追溯，無 unknown-source deployment base。

## 3. 推薦差異與品質證據

| 案例 | 整合前問題 | 最終結果 / 證據 |
|---|---|---|
| 鴻海2317，有 Hon Hai公司營收新聞 | 可能和只有AI產業tag的其他候選混同 | actual buildCandidateUniverse仍eligible；公司NEWS_COMPANY進入引用；Production approved_bridge 80×0.85=68、repeat penalty0不變 |
| 同批2308/2356/2376/3037，只有相同產業tag | 鴻海公司事件被當成其他公司的催化劑 | universe保留，但eligibility=false、No Company-Specific Source Evidence；沒有新增/更換選股策略 |
| 真公司新聞位於四筆產業新聞之後 | 原reference limit4可能丟掉唯一公司證據 | 先保留company-specific ref再取既有reference limit；不得eligible卻沒有可追溯引用 |
| 台積電2330，完整Canonical＋Premium evidence fixture | 缺保留正向案例會把所有股票都清空 | actual payload handler對合格member/vip保留；同fixture轉blocked時member/admin均不顯示推薦 |
| 不同類股都「轉強」 | 只按摘要文字誤判duplicate | 保留主體/日期/source identity；不同主體留存，真正轉載合併並保留refs |
| Canonical recommendations=[] | legacy / observations可復活推薦 | 空陣列是權威，不fallback成股票推薦 |
| 必需來源缺失、coverage缺值/101 | 可能把不足資料包裝成正常no_trade | fail closed；score100不能覆蓋Evidence/Editorial/Premium/Semantic硬門檻 |

以上是去識別fixtures執行真正函式/handler，不是改寫正式9/7推薦，也不是完整重跑AI報告；沒有要求錯誤輸出維持不變。
所有來源、有效數字與現有AI/策略設定保留，未改Prompt產生新策略。

## 4. 核心修復與最後安全缺陷

- 真正影響研究的market/news/sector/policy/engine/history輸入計算fingerprint；只排除執行metadata，不宣稱不同capture時間是同輸入。
- 同日期advisory lock＋5分鐘lease/fence；相同品質失敗不重建，transient最多3次；Production orchestrator原phase retry上限4仍保留，兩種budget不同。
- reports、current Decision、Editorial、member、Semantic在同一transaction提交；部分寫入故障全部rollback；不重寫已完成runtime overlay。
- 公開、會員、admin reader、LINE summary使用同一Canonical/date/revision。原始diagnostic資料不再覆蓋Owner閱讀版。
- historical current-input regeneration在任何input write之前HTTP400；歷史checkpoint/closing/member recovery既有專用模式保留。不能將今天行情偽裝成歷史或07:30資料。
- Recovery的incident LINE及premium LINE皆受suppress_notifications管控；正常排程LINE contract不變，suppressed回條不是SENT。
- HTTP200必須success=true；RUNNING/IN_PROGRESS不當完成，quality409不是retryable成功；429/timeout/5xx有界重試。
- reconciliation只對同日/同job/同checkpoint/同endpoint、較晚成功回條及當前revision結案，原error/http/時間完整留存；不再憑DAY_COMPLETED將所有FAILED抹平。
- **Acceptance只SELECT＋append acceptance record，不再隱含呼叫reconciliation**。failed dispatch/dead letter不因監控而被修改。
- 手工Recovery從實際before_json.request_payload.report_date / target_date及after_json.response.report_date追蹤；不能被誤計自動日。
- 舊Migration草稿將reconcile return改jsonb，與Production integer不相容；已保留integer/既有DEFINER/私有ACL，並用正式原RPC先建立再升級兩次驗證。

安全審核紀錄（沒有拆分同一動作以規避）：

1. 企圖將preservation測試門檻>100改>20以縮小manifest，被拒絕；未套用。改保留699完整紀錄和原>100門檻，測試PASS。
2. RPC權限/回傳契約修正第一次被拒絕，要求證明既有能力；唯讀pg_proc證明Production本來為DEFINER、integer/uuid、僅service_role。
3. 第二次仍被拒絕，要求candidate migration重現精確ACL；實際補入每個replacement同交易內的REVOKE PUBLIC/anon/authenticated及GRANT service_role，非文字保證。
4. 上述完整修正經審核允許，本機PG升級及6個RPC權限測試PASS；沒有未處理的審核拒絕。沒有執行任何Production DDL。

## 5. 前一輪整合驗證（本輪結果以補充文件為準）

Node22.23.1；Deno2.9.2；PostgreSQL17；依package engines ^22.12.0。不是引用整合前305或310測試數。

| 驗證 | 實際結果 | 範圍/限制 |
|---|---|---|
| npm run type-check | PASS / exit0 | 全專案 |
| npm run lint | PASS / exit0 / 0 errors / 0 warnings | Repository既有script範圍src，非全Edge lint |
| npm run build | PASS / exit0 / 202 modules / 1.42s | 本機Production bundle，未發布 |
| npm run test:public | PASS / 311/311 / 0 skipped | 含5個實際函式/loopback HTTP測試與699宣告保護 |
| Deno tests | PASS / 50/50 | Master11 + Pipeline6 + Quality2 + Intraday14 + Timeline12 + Decision5 |
| deno check --no-lock | PASS / 3支exit0 | generator、orchestrator、payload |
| Deno import graph | PASS / 無unresolved dependency | G19/O9/P11 local files，remote解析成功 |
| PostgreSQL | PASS / 4/4 / 2621ms | ma_core_test11，127.0.0.1:55439 |
| Migration重複套用 | PASS / 兩次exit0 | 先建立3個真正Production RPC定義/ACL，再覆蓋；不是空schema-only |
| git diff --check | PASS | tracked+新增文件另作逐行掃描 |
| 真實隔離Auth/會員/Browser完整Network | **BLOCKED** | 不能拿loopback Auth response fixture代替 |
| 完整Production schema/RLS/FK/trigger staging | **BLOCKED** | 現有PG測試只涵蓋已擷取columns/checks/indexes/RPC，非整個Supabase環境 |
| Remote CI / final Commit | **NOT RUN / NONE** | 使用者指定必要測試前置條件尚未全部滿足 |

資料庫覆蓋：
10同時請求＋10重複請求、輸入變更、部分member insert失敗交易回滾、current pointer不變、timeout/backoff/expired lease fencing/第三次上限、quality409、HTTP200 business false、LINE全row不變、匿名/已登入不可執行六RPC、FAIL append-only、相同證據返回相同acceptance ID、Closing revision不符與0930 TXF缺值拒絕、reconciliation不結案無關job、監控不改dispatch/dead letter、巢狀Recovery metadata不能當自動日。

Edge/HTTP覆蓋：
真正get-report-payload handler＋repository Supabase SDK＋loopback HTTP；anonymous/invalid bearer/free/member/vip/admin、偽user_metadata admin不生效、同revision、lock正確、重複讀取穩定、每次最多14請求、0 diagnostics、只有預期invalid Auth401。
它使用合成身份provider/DB回應，**不證明實際GoTrue登入、簽章、完整RLS或Owner瀏覽器E2E**。測試只對隔離fixture呼叫ensure_member_entitlement，不碰正式會員。
現有遠端@supabase/supabase-js@2解析為2.115.0，前端/Node fixture使用repo固定2.57.4；這是既有remote浮動依賴風險，本輪未私自升級/改鎖版。Deno graph及check已通，真正isolated Edge/Auth E2E仍必需。

## 6. 尚未滿足的精確前置條件

原Docker/Auth環境缺口已完成：專用Colima VM、官方Supabase本機容器、GoTrue PKCE、PostgREST、實際Edge、SMTP、合成帳號與RLS驗證。未建立雲端付費環境，未借用Production Session。

真正剩餘缺口是Schema來源：Repository少6筆已部署Migration及更早的news_event_tags/Auth profile trigger定義。Management安全審核拒絕取得完整Migration SQL及Auth trigger source；沒有繞路取得。已獲允許的columns/constraints/RLS/hash metadata仍不足以證明完整trigger與immutable checkpoint行為。

本機capture_morning_alpha_acceptance_v1實際失敗於缺少public.market_checkpoint_snapshots（line69）。沒有建立空白替代表或回傳假PASS。補充文件列出精確來源版本、hash、拒絕動作及需要的有限唯讀授權。

完整正向generator→closing→learning→acceptance仍未通過，故附帶Commit/Push/Draft PR前置條件未成立。這不再是「需要測試環境」，而是可重現的Repository／Production schema來源落差。

## 7. 精確候選部署範圍（尚未核准/執行）

Migration唯一檔案：
`supabase/migrations/20260907030607_core_research_atomic_publication.sql`。

| RPC | 用途 | 權限 / 相容性 |
|---|---|---|
| claim_research_input_v1(date,text,uuid,text,text,jsonb) | date/input lease、fencing、repeat/bounded retry | 新增INVOKER；service_role only |
| finish_research_input_v1(uuid,uuid,text,jsonb,integer) | 結果/錯誤與有限backoff | 新增INVOKER；service_role only |
| publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) | report/decision/editorial/member/semantic atomic transaction | 新增INVOKER；service_role only |
| reconcile_runtime_terminal_failures_v1(date,uuid) | 同job成功證據reconciliation，保留原錯誤 | 保留integer/DEFINER/service_role only |
| capture_morning_alpha_acceptance_v1(date,text) | 分早/收盤、同revision、append-only evidence | 保留uuid/DEFINER/service_role only；不代執行Recovery |
| reconcile_runtime_http_dispatches_v1(integer) | business結果/品質/暫態錯誤分類與既有有界retry | 保留TABLE signature/DEFINER/service_role only |

不新增table，不改RLS/Auth，不backfill/delete業務資料，不設Cron。每個新/替換RPC明確REVOKE PUBLIC/anon/authenticated再GRANT service_role。
依賴既有reports、research_sessions、decision_snapshots、editorial_reviews、member_content_revisions、semantic_coherence_reviews、pipeline_runs與既有publication RPC/unique約束。
Acceptance另讀既有market checkpoint、closing、learning、LINE、health、HTTP/dead letter表。這些表沒有本輪schema變更。

正式RPC唯讀目錄證據：

| Identity | 正式return type | 正式權限 | pg_get_functiondef MD5 |
|---|---|---|---|
| `capture_morning_alpha_acceptance_v1(date,text)` | uuid | DEFINER / service_role only | `1a7ece36a370bf5b6e785e430f2f7c83` |
| `reconcile_runtime_http_dispatches_v1(integer)` | TABLE(dispatch_id uuid, dispatch_status text, http_status integer, error_code text) | DEFINER / service_role only | `79f50f6f795abce6dba04cd320d1d44d` |
| `reconcile_runtime_terminal_failures_v1(date,uuid)` | integer | DEFINER / service_role only | `ac38afda0606cc5ed09a1c3b725b0763` |

只部署三支：G=generate-daily-report-v7、O=daily-delivery-orchestrator、P=get-report-payload。
相依shared code是三個bundle內的檔案，**不代表部署其他Edge Function**；完整local import graph：

| 完整相對路徑 | Bundle |
|---|---|
| `supabase/functions/_shared/bounded-json.ts` | P |
| `supabase/functions/_shared/canonical-decision-contract.mjs` | G |
| `supabase/functions/_shared/canonical-runtime-market-status.mjs` | P |
| `supabase/functions/_shared/content-intelligence.ts` | G, O, P |
| `supabase/functions/_shared/continuous-learning-core.mjs` | G |
| `supabase/functions/_shared/daily-delivery-recovery.ts` | O |
| `supabase/functions/_shared/decision-sentence-builder.ts` | G |
| `supabase/functions/_shared/internal-function-auth.mjs` | G, O |
| `supabase/functions/_shared/market-status.ts` | G, O, P |
| `supabase/functions/_shared/member-entitlement.ts` | P |
| `supabase/functions/_shared/premium-content-gate.ts` | G, O, P |
| `supabase/functions/_shared/premium-evidence.ts` | G |
| `supabase/functions/_shared/production-architecture-core.mjs` | G, O, P |
| `supabase/functions/_shared/research-pipeline-contract.ts` | G, O, P |
| `supabase/functions/_shared/research-quality-gate.ts` | G, O, P |
| `supabase/functions/_shared/runtime-database-contract.ts` | G |
| `supabase/functions/_shared/runtime-report-state.ts` | G, P |
| `supabase/functions/daily-delivery-orchestrator/index.ts` | O |
| `supabase/functions/generate-daily-report-v7/candidate-evidence.ts` | G |
| `supabase/functions/generate-daily-report-v7/content-integrity.ts` | G |
| `supabase/functions/generate-daily-report-v7/index.ts` | G |
| `supabase/functions/generate-daily-report-v7/market-data-evidence.ts` | G |
| `supabase/functions/generate-daily-report-v7/market-freshness.ts` | G |
| `supabase/functions/generate-daily-report-v7/research-master-v2.ts` | G |
| `supabase/functions/get-report-payload/index.ts` | P |

新3RPC先上，才可部署依賴它們的generator。建議批准的非排程空檔逐支：G→O→P，每支ACTIVE/status/hash/Auth rejection通過再下一支；不得平行或bulk deploy。
沿用未修改的config.toml中現行JWT策略，不能為了部署成功改策略、Secrets或cron。
可執行命令（未執行，須後續核准）：
```bash
supabase functions deploy generate-daily-report-v7 --project-ref cttfzgvhiewfckydcrci
supabase functions deploy daily-delivery-orchestrator --project-ref cttfzgvhiewfckydcrci
supabase functions deploy get-report-payload --project-ref cttfzgvhiewfckydcrci
```
Migration必須使用審查後此單一檔案內容與正式migration機制，記錄實際ledger ID/檔案hash；不能以db push一次套用所有pending migrations。
現有deploy-morning-alpha-runtime.yml會部署16支Functions且含db push，**本次不得執行该bulk workflow**。
前端僅型別修正，不需Production frontend發布。line-daily-push、opening/closing/fetch/learning/ma-ops-safe-recovery只保留既有callee，不在部署名單。

## 8. 已保存且可執行的回復方案

備份artifact：
`/Users/sonytzeng/.codex/visualizations/2026/07/11/019f4fe6-5ca6-7c80-bd65-722d6bd0eccc/core-stability-production-rollback-20260907.tar.gz`

SHA-256：
`33ca4798727b072bf7e7f846ee281fda062006c1babe4c74d44220e97dd9b8b2`

內容：三支正式Function原始entrypoint＋全部依賴＋metadata，及3個原正式RPC的rollback-existing-rpcs.sql。未包含service keys/JWT/private key或business rows。
Production既有v227/v27/v40是回復來源，重新部署會產生新的version，不能聲稱回到相同數字version。
部署前再次取正式versions/hash；若與本artifact不符，停下重做trusted drift review，不能覆蓋之後他人修改。

受控回復（須另核准，沒有執行）：

1. 核對archive SHA，解壓到新隔離目錄；保留失敗release及正式runtime證據。
2. 每支建立獨立 `restore/<slug>/supabase/functions`，只複製archive內該slug的完整functions目錄；複製已確認與原部署相同JWT設定的config.toml，不加入Secrets。
3. 在該restore root，依序執行相同3個deploy command（指定project_ref）；或只回復本次實際部署過的支數。所有檔案必須對manifest/備份SHA。
4. 使用 `production/rollback-existing-rpcs.sql` 三個原definition建立經審查的forward回復Migration。簽章未變；ACL再次確認只有service_role，不能增加PUBLIC。
5. 新3RPC留存但舊generator不使用；不drop新ledger、不刪錯誤、不回寫舊business result、不重送LINE。
6. 回復後readonly版本/HTTP/權限/既有LINE hash驗收；不觸發報告生成。若切換會碰正在RUNNING的slot，停止並協調空檔，不能自行改Cron掩蓋。

## 9. 日期明確的無通知Recovery計畫（不執行）

目標故障交易日固定 **2026-09-07**，不是「今天」字串動態換日。
只可在三支整合版+Migration+隔離E2E+CI全部通過且另獲正式Recovery核准後執行。

- 先唯讀保存該日LINE的id/push_type/status/sent_at/payload hash，不輸出subscriber身份。
- ma-ops-safe-recovery的dry_run本身會寫recovery audit；**不是唯讀**，本輪沒有呼叫。
- 當實際台北日期仍為2026-09-07，才可針對此日existing sources執行regenerate_report。若既有輸入缺資料，只能保持blocked，不能偽造07:30 source。
- 若已到2026-09-08或以後，禁止fresh generation補成9/7：新date gate回HISTORICAL_RESEARCH_REGENERATION_UNSUPPORTED。只可評估下列既有canonical member recovery；若Canonical本身不合格，停止並另提出immutable歷史輸入replay設計，不能偷用今天行情。
- 不得用force_regenerate/skip_openai/降低Gate繞過；同輸入品質拒絕不無限重試，真正修正來源/engine才重新評估。

正式Recovery API（未執行）：
POST `https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/ma-ops-safe-recovery`
Headers使用現有approved internal credential及Content-Type，憑證由安全runtime提供，不寫文件/log。

第一階段dry-run的審查body：
```json
{
  "action": "regenerate_report",
  "dry_run": true,
  "approved": false,
  "actor": "Sony-approved-operator",
  "reason": "2026-09-07 core stability same-date repair; no notifications",
  "request_id": "<one generated UUID reused for this approval>",
  "idempotency_key": "core-stability:2026-09-07:research:v1",
  "attempt": 1,
  "payload": {
    "report_date": "2026-09-07",
    "source": "ma-ops-safe-recovery",
    "suppress_notifications": true
  }
}
```
人工確認dry-run target/date/action正確、正式核准之後，僅改dry_run=false、approved=true，保持相同request/idempotency；不是自動retry。
若只需會員read-model重建：action=`rebuild_member_content_revision`，沿用report_date/source/suppress，使用另一個明確idempotency key；由既有mode=canonical_member_recovery，不重跑AI/checkpoint/closing/learning。

若使用orchestrator recovery，必须同source/date/suppress且先確認只需要的action；兩条LINE均抑制，不能用正常deliver來「修復」舊LINE。
Recovery後LINE整组id/type/status/sent_at/hash必須完全不變；成功回條仍須查實際同revision gates，不把HTTP200當完整PASS。
9/7即使人工修好，其morning自動交付失敗與所有歷史FAIL永久保留；automatic_stable_day=false。

## 10. 上午/下午監控續排方案（不更動現行Cron）

既有查核發現08:45/08:50、15:10/15:15 health，15:25/15:35 acceptance，沒有COUNT=5停止條件。
先查現行schedule/job identity避免duplicate；保留可用下午primary+backup，新增上午必須另核准。

| 台北時間 | UTC | 工作 | 邊界 |
|---|---|---|---|
| 08:55交易日 | 00:55 | MORNING acceptance / health / canonical / gate / report LINE | 未到期checkpoint NOT_DUE，不假完成 |
| 15:35交易日 | 07:35 | FULL_DAY acceptance /6 checkpoints/Closing/CLE/HTTP/health | 既有15:25/15:35排程可reuse，不再加重複job |

僅呼叫append-only capture_morning_alpha_acceptance_v1，版本帶已核准Commit hash；不得由monitor執行Recovery/reconciler或report生成。
永久續排、無COUNT=5/五次後自動關閉；交易日由canonical Asia/Taipei calendar判斷，休市/未到期NOT_DUE不算PASS/FAIL。
只有完整FULL_DAY PASS＋automatic_stable_day=true才累積；任何真FAIL重置連續計數並保留歷史。人工/歷史補跑永不計入。
假設9/7收盤後部署且另核准監控，最早可觀察9/8、9/9、9/10、9/11、9/14五個完整交易日（仍逐日檢查休市），不是執行五次就STABLE。
通知只在新failure、狀態變更、完成或需要人員介入；不變狀態保持安靜。不啟動收費或14天試營運。

## 11. 正式核准文字草案（目前尚不應送出執行）

下列是後續獨立核准範圍，不代表本輪已獲授權：

> 待Draft PR最終Commit、CI與真實隔離Auth/完整schema驗收全部PASS，核准只套用20260907030607_core_research_atomic_publication.sql；核准依source manifest逐支部署generate-daily-report-v7、daily-delivery-orchestrator、get-report-payload及其列明相依，保留原JWT/Secrets/RLS；核准在指定日期與同input lineage下，使用既有ma-ops-safe-recovery審核流程、suppress_notifications=true完成無通知Recovery，LINE不重送不更動；核准reuse下午與新增上午append-only acceptance監控，長期續排。任一Gate失敗停止並用已驗證archive/forward SQL回復，不修改Production business result偽造成功。Merge仍須獨立核准。

當前先補第6節schema來源與完整正向E2E；不要求你在缺少E2E/CI時核准Production。

## 12. 正式狀態：保留既有失敗證據，不冒充修好

以下是**2026-09-07 12:08 Asia/Taipei**唯讀觀察，不是整合後Production結果：
- Decision `7dd500ca-ea8b-40e8-8576-547ddacf7483` v7，PARTIAL/STOP/blocked/content_score100。
- Report `45115dbb-ff2a-4af5-9fbc-e801886aa69d`；Editorial REJECTED，member PASSED0，FAILED dispatch4、dead letters0。
- 行情PREMARKET/0900/0930/1030已有成功11/11，但不能因此宣稱研究PASS。
- 只有3筆data_incident SENT，沒有正常report LINE；id e38dea05-b4ad-486c-bcd9-5cce7affe608 / e9cc96eb-fd0e-4d60-aaa5-49d3ce541fd9 / f0387c27-f7d8-424b-9ecd-dedc5788db7b。
- 三筆sent_at=2026-09-06T23:30:03.474974Z，payload MD5=db3eb54160ed68d29f21a0a2201769b8；當時兩次SELECT一致，沒有通知重送。
- 當時MORNING=FAIL，FULL_DAY=NOT_DUE，當日acceptance rows0；沒呼叫正式capture，不捏造acceptance ID。
- 當時公開payload HTTP200/free、snapshot11，revision正確；Owner raw敘事與STOP並存是已定位問題，但本輪修正未部署。
- 不拿舊Browser零overflow/Console證據當本次最終整合E2E；正式會員完整Network未驗收。

最終：**本機可審查整合已保存，工作樹未提交；正式網站尚未宣告修復，沒有啟動自動穩定日/收費/試營運。**
