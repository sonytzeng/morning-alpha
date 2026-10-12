# Daily Stock Intelligence P0 — 候選接線與發布阻擋

2026-10-12；PR #230 保持 Draft。從 `9443a7c6472ebcdac6d7c5f32ad6164cc08306b7` 續接。

## 真正完成與未完成的部分

本輪將既有「自然更新計畫」補為可執行的隔離研究流程：交易日／Core READY → 有界資料取得介面 → 三期間評估 → 既有三種 Entry 策略 → 不可變鎖定 → 到期觀察 → 唯讀發布資格。
不是正式 Worker，不是已部署排程。`DAILY_STOCK_INTELLIGENCE_ENGINEERING = INCOMPLETE`、`NATURAL_FORWARD_EXECUTION = NOT_ENABLED`；不可把本機流程 PASS 改稱自然營運 PASS。

| 項目 | 候選驗證 | 正式剩餘接線 |
| --- | --- | --- |
| 研究 Producer | 72 檔 × 3 期間，保存資料實際執行 | 逐日新資料的伺服器 snapshot adapter |
| 自然 Caller | READY 後背景 enqueue，不等待研究結果；休市／Core 未就緒拒絕 | 尚未掛入任何正式 Lifecycle |
| Entry | 直接重用 `research/entry-opportunity.ts`，無策略變更 | 本批缺同時點 Canonical／V2 Entry capsule，不借用 10/7、10/8 |
| Prediction | 準備批次先存 checkpoint，216 筆 append-only；同 key 換證據拒絕 | 正式 transaction／lease／最小寫入身份尚需核准 |
| Outcome | 1/5/10、20/40/60、120/180/250 交易日；追加來源版本 | 沒有成熟且完整的真實價格、權息與成交證明 |
| Publication | Eligibility 唯讀，無自動核准／發布 | 授權、時間證明、獨立審查、Sony 逐筆核准及正式投影接線 |

## 既有 Production 唯讀盤點

專案 `cttfzgvhiewfckydcrci` 的 metadata：`recommendation-v2-forward-worker-v1` V2、`entry-opportunity-shadow-v1` V3 ACTIVE；`daily-delivery-orchestrator` V45、`generate-daily-report-v7` V248、`line-daily-push` V70 ACTIVE。
V2 worker 有既有 claim/finish 與 Outcome lifecycle；它不等於 VNext 的正式 Caller。Entry V3 可接受專用 worker 身分，不能因此推論 VNext 已自然產生事前研究。
本輪只讀部署 metadata，未讀取 Secret、未呼叫研究／Report／LINE Production endpoint、未執行業務 SQL。
遠端 main 為 `2a5d461ec3d98bfc8bc3177a295c95e299b7bda2`，候選起點相對 main 為 ahead22/behind5；沒有把候選舊版全包部署或重設分支。
首次push因4個測試／CI檔與已发布PR235衝突而不觸發Actions；後續僅同步main到Draft候選，保留新聞修復原字節，完整性驗證鏈為VNext→NewsReport→Academy。沒有Merge PR230到main，沒有Production變更。

## 候選契約與反例

- 官方台股日曆有限涵蓋；10/9 休市、10/10–11 週末不呼叫 Provider。日曆外回 UNKNOWN，不推定交易日。
- request 綁定日期、checkpoint、mode、provenance、source revision/hash、可行動時間。Forward 必須當天、在可行動時間前鎖定；晚到即拒絕，不能倒填。
- 同一天同 checkpoint/mode/來源類型只允許一個 request hash。換證據不能變成第二份 authoritative prediction。
- 每 stage 最多 3 次，嘗試次數在執行前落入隔離 journal；每 call 最多20秒，單次 worker 60秒預算；中断可從完成階段續跑。
- 來源失敗與資料不足不同：provider timeout/rate-limit/invalid lineage 為執行阻擋；成功取得後缺長期必要證據為研究 `INSUFFICIENT`，不是股票不值得觀察。
- SHA256 checkpoint envelope、來源快照及 lock 重新驗證；symlink／非私有目錄／未知路徑拒絕。Prediction 與 Outcome 檔案只允許 `wx` 追加與 byte-equivalent 防重。
- 隔離 store 僅允許 `/tmp/ma-daily-intelligence-*`，不會寫入既有歷史快照或資料庫。崩潰留下的 lease 不擅自偷取；正式 adapter 必須有 transaction fencing／lease 到期契約，不能直接部署本機檔案鎖。
- research hypothesis `VNEXT_OBSERVATION_HYPOTHESIS_2.0.0`、Entry 三模型版本沿用；正式 Recommendation 未變。
- 缺同 cutoff Entry input 明確回報 missing72；不把零個執行結果稱為72個不適合進場。策略整合的216個反例屬合成控制，非真實投資結果。

## 真實保存資料驗證

行情截至 2026-10-08，原研究取得／評估時間為10/11；本次10/12只做 **HISTORICAL_REPLAY**，不將其計入Forward。
原 funnel 指紋不變：`805cfbb8ae94f0bda75a43535ceb57d314b3f1aa7fed4af12cedc0f82bcf93c3`。

| 期間 | Scanned | Qualified | Rejected | Insufficient |
| --- | ---: | ---: | ---: | ---: |
| Short | 72 | 1 | 71 | 0 |
| Medium | 72 | 28 | 44 | 0 |
| Long | 72 | 0 | 0 | 72 |

合計216項判斷：29合格、115不符、72資料不足；不是216檔。Short合格為健策3653，仍是研究觀察，非買進推薦。
原獨立品質16 PASS／13 PENDING保留；本次沒有撤銷、重寫或自動升級既有審查。
本機保存216筆研究鎖、648個期限追蹤狀態：360待到期、288未知（已到期但缺價格或超出日曆涵蓋）。**Outcome Sample=0**，648不能當作已完成績效。
第二次 `ALREADY_COMPLETE`，鎖定批次未增加；Forecast/Forward Sample=0；Publication Eligible=0；Free/Premium Visible=0。
真實 payload 僅在0700隔離私有目錄，沒有提交原始行情／研究資料到Git或CI；CI只跑明確標示的合成控制。

## Outcome 不誤報績效

只有完整訊號後交易日窗口、時間有效價格與基準才顯示 raw price observations。
若訊號在09:00後，日K含訊號前價格，回 `INTRADAY_POST_SIGNAL_PATH_MISSING`。
不以日K推定進場觸發或成交；同日停損／停利順序、手續費、稅、滑價、跳空可成交性無證明時為UNKNOWN。
公司行動只有索引或範圍不完整，不產生調整後報酬。公司權息查核不代替基準調整證明；相對報酬仍null。
`net_return`、MFE、MAE、最大回撤與實際成本在本批均null，`performance_eligible=false`。真實Outcome成熟後，仍需独立來源adapter及保守可執行性審查。

## Owner Preview與安全

本機URL：`http://127.0.0.1:3225/vnext/research`。
第一屏「今天有哪些值得研究的股票？」明確寫今天尚無自然新研究；保留10/8行情日期，不冒充今日推薦。
三期間、合格／不符／資料不足、條件與風險可操作；技術資料、歷史審核預設收合。
既有本機GoTrue真實登入／PostgREST Owner判定：Owner200，Free/Premium/other403，anonymous401；直接tier參數拒絕，logout refresh拒絕。
這是**真實本機隔離Auth**，不是Sony Production Owner或正式會員E2E。
1440／375／390／430全新Chrome context實測：無水平溢出，三期間數量正確，Reload保留合法Session，登出後研究從DOM消失、Reload不可讀。網頁產品error0，外部network0。
截圖：`/private/tmp/ma-daily-qa-20261012`；私有Source不用送外部Preview服務。

## 唯一下一階段正式接線 Manifest（待核准，不是本輪已部署清單）

不能把既有 `20261010061630_vnext_research_projection_candidate.sql` 直接當成本次完整正式發布：它沒有本輪 checkpoint/lease/hash/quality-admission鏈。

1. **新增候選 Migration（需先產生精確檔名、Fresh DB及具名核准）**：在新VNext私有範圍新增 run/checkpoint、lease fencing、immutable source/prediction/outcome/audit transactional RPC；沿用既有Owner truth，不開底層表給會員。不覆寫任何既有Prediction。此檔本輪未建立或執行，不能以概括授權代替最終SQL審查。
2. **新研究 Worker候選名稱 `vnext-daily-research-v1`（尚未建立／部署）**：server-only acquisition/read adapter、持久化worker、Outcome分批，重用本輪純函式；不得讓Owner Browser持高權限寫入。Machine identity沿用的精確可行範圍須先審核，若需新Secret另列，不擴用既有Entry/V2 token。
3. **既有 `recommendation-v2-forward-worker-v1` 的獨立非阻塞enqueue接點（尚未修改）**：保留其策略/排程/驗證/Outcome原語意。只能在原checkpoint完成後非阻塞排隊，失敗僅記錄自己的待恢復狀態；Core/Report/LINE不等待、不重跑。
4. **新Owner read projection／UI入口**：只有Owner能讀私人研究，會員仍經既有Server Entitlement與Published Projection。正式路由與發布另審，不把本機 `/__vnext_owner_research` 當成Production API。
5. **真實資料adapter**：既有官方歷史取得程式是固定研究窗口（例如營收月份2023-09至2026-09、事件9/10月），不能直接排程宣称每天增量。需將取得窗口明確版本化成交易日衍生、有界批次與快取；同cutoff Canonical/V2 Entry、合法公司行動與Outcome基準也須有正式Producer。
6. **回復／隔離**：先關閉新的enqueue與Owner入口，保留append-only資料，不刪除研究、會員或業務紀錄；原V2worker精確部署來源保留可回復。Cron/LINE/Report/正式Recommendation均NO CHANGE。

這是一份待核准的精確元件／資料權限範圍，不宣稱未產生的Migration檔或Function已有CI驗證。最終部署前應一次封存具名SQL、Function source/hash、身份、權限及回復基線。未完成這些不得Merge或部署。

## 驗證命令與證據範圍

- `node --experimental-strip-types --test tests/vnextDailyIntelligence.test.mjs`：23項候選控制，與真實研究績效分開；包含同步enqueue/background失敗不冒泡到Core、完成後實際鎖定檔遭更改拒絕。
- `tests/vnextDailyReal.integration.mjs`：既有私有快照離線216判斷、648追蹤狀態、immutable/idempotency/hash，network0。
- `tests/vnextDailyAuth.integration.mjs`：本機真實Auth四身份，無Production。
- `tests/browser/vnextDaily.e2e.mjs`：真實本機Auth、尺寸、三期間、reload/logout；不使用tier選擇器。
- type-check/lint/build、VNext regression/integrity、GitHub CI必須以最終HEAD為準，結果記錄在Checkpoint及交付回報。
- 本輪新增SQL=0，Fresh DB不重跑已通過的原Schema；沿用相同隔離Schema指紋並驗證實際讀權限。
- Production writes/invocations/deploy/migrations=0；所有正式業務檔案仍受Integrity逐位元保護。**未重新做Production DB前後指紋，因此不虛稱新的一次線上業務資料比對。**

`RESEARCH_ANALYSIS_VALUE = INSUFFICIENT_SAMPLE`；`PUBLIC_PRODUCT_APPROVAL = NO`；`SONY_USABILITY = PENDING`。
