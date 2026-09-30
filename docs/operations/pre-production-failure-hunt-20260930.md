# Morning Alpha — 2026-09-30 Pre-Production Failure Hunt

## 結論與邊界

A–J 已逐項稽核；確認 **6 個獨立可達根因**，不能宣稱已清零或可發布。
本輪沒有修改產品來源、Production、Cron、秘密、Auth/RLS 或歷史資料。
沒有執行 Migration，沒有發布 Function，沒有真實 LINE，沒有 Recovery。
測試只在無外部派送的本機隔離環境，或使用純函式／回滾交易。

完整機器可讀清單：[FAILURE_HUNT_INVENTORY](evidence/pre-production-failure-hunt-20260930.json)。
其中記錄每項 ID、PATH、REAL_REACHABLE、SEVERITY、ROOT_CAUSE、PRODUCTION_IMPACT、FIX_REQUIRED。

基線 main：`2e530bc0db49bf76d6188642b79e112b339872aa`。
工作樹 HEAD：`54ad5d54c95fa75222a6bc3da699f11ad788558b`；與 main 內容相同，落後一個 merge commit。
既有 PR #171 的成功 Gate 不代表本次新候選已通過 Gate。

## 六個根因

### FH-01 — 正式下游仍打包舊版來源驗證器（P0）

同一份以 9/29→9/30 真實保存輸入，由隔離真實 Report Handler 產生的市場文件：

- main canonical validator：READY。
- 正式 LINE v60：完整 Handler 回 HTTP 409 `MARKET_REPORT_NOT_ELIGIBLE`。
- 正式 Closing v25 共用 gate：`OPENING_FROZEN_MARKET_DOCUMENT_UNVERIFIED`；main 同輸入 PUBLISHED。

旧 canonical source allowlist 不接受 `authoritative_market_data_snapshots_v1` 的
`previous_trading_day` 衍生來源。相同舊 hash 也存在 close-market-review v29、
continuous-learning-engine v9、ma-ops-health-check v24。
這五支 consumer 是同一部署根因，不算五顆 Bug。

之前本機全鏈使用 main LINE code，沒有驗證實際部署 v60 的依賴包；因此本機通過不能覆蓋此差異。
沒有把隔離生成的 Report 冒充 Production 曾發布的 Report；真實 LINE calls = 0。

最小修復：同步五支 consumer 的同一 canonical contract，不調降來源驗證；發布 Gate 必須驗證各 bundle dependency hashes。

### FH-02 — 官方臺股日曆漏列休市日（P0）

[TWSE 2026 開休市表](https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html)
與 Edge／DB／frontend 既有日曆不同，漏列 02/12、02/13、05/01、09/28、10/26、12/25。

9/29 兩筆原始 Recorder ticker 的 envelope 是 09/24。
目前期望前一交易日 09/28，所以判 STALE；隔離 prototype **只修官方日曆**，
兩筆原始 payload 不變即通過，session 正確為 09/24：

- TAIEX：`60f30b8b-92f8-49bc-85c5-dd22c4a6cfc4`。
- 2330：`eff2be6f-2023-41ed-8a11-89294f14cb6a`。

未來 10/27 同一錯誤會找不存在的 10/26 session／前日 close evidence。
不能靠修改历史 FAIL 解決；需要官方 calendar 版本與 Edge／DB parity。
7/10 既有特殊休市紀錄未刪改；此次沒有核准重新解釋其歷史。

### FH-03 — Finnhub 八組只檢查年齡、沒有嚴格檢查最新完成 session（P1）

對 9/30 保存的真實 Finnhub response fields，僅把 `t` 減 24 小時：
SPX、IXIC、SOX、NVDA、TSM、VIX、DXY、US10Y 全部仍通過 Adapter、Edge contract、實際 DB row guard。
原始價格／漲跌等資料未造假；mutation 明確標示，未回寫既有證據。

DB 測試使用已存在 batch 的 validation/reuse 分支，並在 read-only transaction 回滾；
證明的是 row predicate 過度接受，**不是**聲稱已把過期資料寫進正式或既有隔離 batch。

最小修復：按實際來源 SPY/QQQ/SOXX/NVDA/TSM/VXX/UUP/IEF 的市場日曆，
要求最新合法完成 session，保留 age、future、shape 等防線，Edge 與 DB 同步。
不能把 VIX/DXY/US10Y proxy 當成另三個任意寬鬆時區。

### FH-04 — Provider 根因被不同分類與 Atomic 摘要遮蔽（P2）

同一 HTTP 403，Preflight classifier 是 AUTHENTICATION_FAILED，Fetch classifier 是 BLOCKED_BY_SUBSCRIPTION。
9/28、9/29 真實 health 紀錄的 provider failures 保存了 entitlement 根因，
但 top-level `last_error_code` 被 assembly cardinality 優先改成 ATOMIC_CHECKPOINT_COMMIT_FAILED。
這不是真正的 DB commit failure；詳細證據仍在，不能說所有資訊均遺失。

最小修復：一個 failure classifier、一個明確 root-cause precedence。
只有真的進 DB commit 並失敗才標 Atomic commit failure，不改 11/11 Gate。

### FH-05 — Recorder 失敗路徑不是同一 Adapter／結果（P1）

13 筆真實 Recorder FAIL 中，5 筆無法重播相同原因。
三筆 `provider=twse` 被 endpointAdapterKind 選成 FUGLE_TAIWAN_CORE；
隔離只改 adapter identity 即恢復同一 Evidence Contract 原因。
另兩筆 Fugle STALE result 在 normalize→null 後失去原始 adapter failureCode。

最小修復：保存且重播實際 adapter identity／可重建的拒絕結果，分開 raw adapter replay 與 normalized evidence replay。
不得直接把 stored reason 當重播答案，也不得改原 Recorder rows。

### FH-06 — 額外 Readiness Retry Cron 的入口已沒有 producer（P1）

正式 `invoke_premarket_readiness_retry_v1` 只接受 pipeline `provider_not_ready=true`
或 health `PROVIDER_DATA_NOT_READY`；目前 Fetch 只消費該碼，沒有生產該狀態的有效路徑。

直接執行目前 Fetch 原碼的 waiting expression，對受控 429、500、timeout：
transport retryable=true，但 waiting=false，無法進 07:40–08:35 dispatcher。
所以「Cron ACTIVE」不等於這個 bounded recovery 路徑可到達。
這是 source reachability＋實際 expression 證據；沒有冒充完成整支修復後 Handler 測試。

最小修復：共用明確可重試的 readiness state 接回既有時槽；deadline 仍 08:45，
07:30 SLA 仍 MISS，401/403/invalid data 不可被改成無限 retry。
Cron schedule 本身不需要修改。

## A–J 處置矩陣

| 項目 | 實際結果／限制 |
|---|---|
| A Single Source | 17個規則群組：2個canonical、14個有獨立重複判定、1個inactive；逐項分類見JSON。14不是14顆Bug。 |
| B Boundary | TXF兩邊界、07:30、08:45、09:00、News48h ±1ms通過；Closing18:00+1ms有predicate差異。正常14:10/14:30 collection與source<=capture防線使它不能進自然鏈，列風險不算已證實可達Bug。08:00只是Acceptance phase，不是仍有效的readiness截止。 |
| C Cross-day | 原close充足時 Report/Closing/Learning/Acceptance failure並非重建必要條件；10項直接回歸通過。官方日曆錯誤仍能令前日lookup錯日期，計FH02。資料不足仍拒絕。未宣稱每種狀態都新跑了完整Handler。 |
| D State | 實際同hash DB：16個sequential ranks通過，六個後續checkpoint 11/11可恢復；10/11、duplicate、stale被拒；後段wrong correlation被拒。0900 trusted metadata shortcut不單獨驗DB lineage，是防禦缺口，但正式Fetch先驗Atomic identity，未證明自然可達錯誤，不能列Product Bug。 |
| E Mutation | 有原始Recorder的9/24、9/29、9/30保留原始類型；9/21–23依各fixture原標籤，9/23上午仍RAW_NOT_RETAINED。51個adapter probe、51個boundary/classifier observations與31個state observations保存於JSON；觀察到反例不等於全PASS。 |
| F Decoupling | main 市場／推薦分離正確；現有直接回歸通過。不將FH01下游舊包拒絕誤算成新的Recommendation策略Bug。 |
| G Closing/Learning/Acceptance | exact opening revision、market-only stock NOT_APPLICABLE規則正確；正式舊bundle仍受FH01影響；Learning真正市場evidence不足時Acceptance FAIL合理，不得改成PASS。 |
| H Provider | 9格HTTP failure matrix已比對；FH04與FH06分別是診斷和recovery入口問題。 |
| I Recorder | 目前只有Fetch＋Preflight寫入，共1760 rows、各11 keys。至少6類重播缺口：Provider失敗重播、Research、Report、Closing、Learning、Acceptance。下游成功receipt不等於所有失敗輸入已保存。 |
| J Config | 12支bundle逐檔hash：5支完全一致、7支有差異；其中5支共享FH01。radar只有未使用新增export差異；news正式版多429 cooldown，不是目前Production bug，候選應將main保留此保護而非部署掉它。Cron同schedule+command重複=0。Migration版本由工具生成時間但名稱／definition lineage吻合，不修改ledger洗成一致。 |

隔離測試中的13:00/14:10/14:30 timestamp/session mutation有明確標籤；不冒充新取得的9/30真實capture。
31項state observations含16-rank sequential這一組與30個checkpoint cases；並非31個完整Lifecycle。

## 一次收斂的候選範圍（不是 Release Candidate READY）

這六項共用一份變更清單、Evidence regression與受控Release Gate，不做六輪臨時發布。

1. 共用官方calendar、latest US cash-session、failure taxonomy、Recorder adapter/result修正。
2. Atomic DB session/calendar predicate與既有Retry dispatcher入口需新Migration。
3. Canonical consumer五支bundle需同步main已修內容。
4. Calendar dependency closure共10支：fetch-market-data-v10、market-readiness-preflight、
   generate-daily-report-v7、daily-delivery-orchestrator、line-daily-push、
   closing-verification-engine、close-market-review、continuous-learning-engine、
   opening-market-radar、ma-ops-health-check。這是待審查依賴範圍，**不是本輪部署授權**。
5. downstream failure capsules是另具名的可觀測性範圍，需最小allowlist／去識別／fail-open設計；
   不默認擴大既有Provider Recorder table或把整個response存下來。
6. 不改Recommendation策略、LINE文案、Cron時槽、權限、Secrets、歷史資料。

本輪禁止執行Migration，因此目前只能保留上述合併修復範圍與隔離prototype。
未建立正式Migration檔，未修改sealed manifest，未把舊基線CI當本輪候選CI。
接續需Sony核准：在全新隔離DB驗證本範圍的新Migration；候選完成後Commit／Push／PR／GitHub Gate。
這個核准不包含Merge、Production Migration或Function deployment，Production仍維持NO CHANGE。

## 驗證與檔案

- 新重播：exact deployed LINE Handler 409、deployed Closing shared gate BLOCKED、main 同輸入READY/PUBLISHED。
- 官方calendar隔離prototype：两筆9/29真實payload不變通過。
- 既有直接回歸：Publication/Closing/Learning 75/75；Cross-day 10/10；9/21–24 contract 21/21。
- 既有基線Integrity：200/200；沒有skip、allowlist放寬或historical hash重寫。
- Node 22.23.1：type-check通過；Lint在受限與標準主機環境都無輸出停滯，獨立Build亦未完成；已停止本輪自有程序，不列PASS。這是未完成的本機工具驗證，不是新增Product Bug。
- GitHub唯讀再次確認：main仍為上述SHA；PR #171已MERGED、validate SUCCESS。這是既有基線Gate，不是本轮新候選Gate。
- 未執行新的GitHub Release CI；未重跑47 Chaos、1000 Fault、5-Day。
- 稽核腳本與deidentified原始輸入留在 `/tmp/ma-hunt-0930/`；本文件與JSON只存結果、Evidence ID和hash，無replay payload、秘密或PII。
- 本輪Repository只新增本Markdown與JSON；Commit/Push/Deploy/Migration/Cron皆NONE。

**結論：不是Closure完成。Production已知可達根因仍為6；修復候選尚未通過Release Gate。**
