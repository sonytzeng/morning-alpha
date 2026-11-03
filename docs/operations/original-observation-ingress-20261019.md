# 原始 Observation 原子接線候選（2026-10-19）

本文件不是發布授權。PR #280 的唯一 Worker 修正已另依 Owner 核准發布；本增量未執行 Production SQL、未部署、未啟用 Caller 或會員內容。

## 已完成的正式限定發布

- PR #280 核准 HEAD：`ded0e08c9615d3a8da4615e9fdfebd6eb9f28ee0`，13/13 CI。
- Merge：`7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3`，merge tree 等於核准候選。
- `vnext-daily-research-v1` V3 → V4 ACTIVE；JWT=true、SDK=2.57.4，44/44 實際 Runtime 來源符合清單。
- Candidate payload：`34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762`。
- V4 ESZIP：`91bf73939e5dfde0740f7ba1ebf43830789d08b46cc1f8885583e451764501db`。
- Recovery payload：`782bf24f65c44a120e6c4e37251116ce910936f0897f08f85d02f3abdea54513`；固定 SDK 來源功能等效，非原 ESZIP 逐位元一致。
- 其餘35支 Function、27張受檢業務表的完整列數／資料指紋、Migration／Cron／RLS／Policy 指紋不變。
- 無憑證 Gateway HTTP401；沒有人工業務 POST、歷史重跑、Prediction／Outcome 寫入或 LINE 外送。沿用未變的 Auth 正向證據，未冒稱重新執行。
- 會員資料列完整指紋本次未另蒐集，不冒稱額外正式會員 E2E。

原封存來源、候選前的未部署標示保留；最新正式收據另記錄於 PR #280 Conversation。自然 Worker4 批次尚未觀察，不能用本次 Smoke 代替。

## 真正缺少的原子流程

原 `lockObservation` 只驗證並回傳物件，不寫入資料庫。C Runtime 的 Prediction 與原始 Observation 有不同方法、證據、hash 和條件契約；不能以 C `QUALIFIED` 或 `lock_hash` 直接填入。

新候選是一個後端固定 RPC 與型別化消費端：

`既有 C 不可變鎖定（僅 lineage）＋既有原始證據 registry → 原始期間 required kinds／時間／內用權利檢查 → 新交易時間 Observation → exact evidence links → immutable ingress receipt`

它不建立來源、License、品質審查或 Owner 核准，不直接寫入正式 V1 推薦、會員 copy、每日免費清單或 Outcome。正式 V1 `decision_v1` 的金融／法人／事件門檻完全未變。

### 必要限制

- C 行情／研究 cutoff、run、Source Revision、payload canonical hash、原始身分與截止時間取自已提交資料，非呼叫端宣稱；不採用 C 研究分數或狀態。
- 所有原始 Evidence 必須已存在、同股票、品質與相關性通過、原始發布／首次取得時間已保存；`available_at` 及 `last_verified_at` 均不得晚於 C cutoff。
- 原 SHORT 仍需量價、法人、新聞、技術結構；MEDIUM 仍需營收、訂單、Guidance、法人、產業事件；LONG 仍需需求、護城河、供應鏈、EPS、Margin、CapEx、估值。沒有共用分數或減少 required kinds。
- 只要求私有保存／衍生內用的已登錄使用權；不偽造會員商用或再散布許可。會員發布保留原本更強的獨立品質、時間、授權、Owner、Entitlement Gate。
- 尚無可重現的原始條件狀態 Producer，首版只接受兩類條件均為 `UNKNOWN`，狀態僅為 `WATCHING`。不能自報 `CONFIRMED`／`NOT_MET`，不是買點或正式 READY。
- Observation 由資料庫 transaction timestamp 保存到微秒；舊 C shared `validTime` 仍只接受毫秒，未修改的 Caller 不會被意外放寬。只有原始 Observation Engine 使用精確微秒比較。
- 首版 canonical envelope 僅承接 registry ID 為 lowercase hex64 的來源。非 hex ID 明確拒絕，不能改名、以 snapshot hash 冒充 ID 或複製假來源。SQL 的 byte ordering 已與實際 JS runtime 的 hex 排序及 UTF-8 hash 向量核對。
- 初版來源 URL envelope 限 DNS HTTPS、不含 port／credential／百分比編碼 query key；不符合時拒絕，不代換來源。此為安全序列化限制，不是來源權利證明。
- 相同 request key／內容回讀原 sealed receipt；不同內容衝突。一份 C Prediction 不能換防重鍵重複建立。回覆不確定時沒有自動重試或換鍵。
- 交易最後及 deferred exact-set constraint 再驗證，禁止同交易後續額外加連結；任何錯誤全部 rollback。

## 精確候選安裝範圍（目前 NO-GO）

SQL：`supabase/migrations/20261019123345_original_observation_ingress_candidate_v1.sql`，由 Supabase CLI 產生檔名。

新增：

- 私有 `vnext_private.original_ingress_receipts`，FORCE RLS、無 anon／authenticated／service_role raw table grant。
- 四個私有 helper：`original_canonical_v1(jsonb)`、`original_iso_v1(timestamptz)`、`original_text_units_v1(text)`、`original_ingress_seal_v1()`，均撤銷 PUBLIC 等 execute。
- 僅 service_role 可執行 `public.ingest_vnext_original_observation_candidate_v1(uuid,jsonb)`。
- 私有新表 immutable trigger；既有 evidence-link 表與新 receipt 表各加一個 deferred exact-set constraint trigger，不修改既有 Policy。

程式：`src/features/vnext/originalIngress.ts`、原始 `contracts.ts`／`engine.ts` 的時間精度增量。沒有新的 Edge Function、部署 payload、SDK 更新或現有 Worker 寫入 Hook。本機真實 HTTP 呼叫端與原始 Engine 回讀驗證已接通；正式自然 Producer 的啟用仍不能在缺少原始來源與條件判定器時宣告完成。

停止／回復：只撤銷新 RPC 的 service_role execute，不刪 Schema、來源、Observation、receipt 或稽核，不退舊 Reader、不改既有 Worker。先停止新的後端 ingress 呼叫，確認沒有在途交易，再執行限定 revoke；孤立測試已證明新寫入停止、既有封存保持不變。**沒有取得本 SQL、RPC 安裝或正式呼叫的核准。**

需要上線前重新封存 SQL 及所有來源 hash、精確部署者／呼叫者範圍、DB 前後定義與實際資料資格。不能只因隔離合成控制通過就提早啟用。

## 實際驗證

新驗證涵蓋 PostgreSQL17／PostgREST14.13、實際 SQL、八請求併發、相同與衝突防重鍵、中文／控制字元／非 BMP canonical parity、微秒相等／未來1µs拒絕、三期間不同證據、缺值／過期／權利拒絕、崩潰 rollback、遺失回覆對帳、同交易多加連結拒絕、FORCE RLS、停止 revoke 後保存不變。

隔離 C／來源是明確合成控制，不是真實股票研究、正式 Auth、自然 Forward、成效或會員 Production E2E。既有原測試斷言保留；新來源需通過新的完整 composition admission 後才使用固定歷史讀取。

## 真實資料與正式產品仍未交付的部分

最近保存的正式 V1 是 Universe72／Evaluated0／BLOCKED72，READY／WATCH／NONE均0。六項重疊阻擋各72：逐股三法人、完整四季基本面、來源公司事件映射、事件對齊量價反應、市場法人、市場催化。不是72檔都已分析後不合格。

- 已保存72×20＝1,440個量價交易日、TAIEX20日、72檔各至少2個同業；成交量缺失0。不能重列舊138個價格缺口。
- 最新 Actual 月營收72／reported EPS72，不等於四季可比 Actual／Consensus／Guidance。
- 2330已保存四季單季EPS／營收8個數值欄位，包 hash `6b2775376d09849c27523248c27cde889c49b1aaaac8a9e535fb91282e276dc7`，可用既有私有 Adapter；公告時間、版本鏈、Consensus、可靠方向仍不足，不能回填10/19較早盤前 cutoff。
- 七檔金融21份原件的既有收據為66個直接單季金融科目、3季度，非連續四季；不能用金融4XXXX淨收益當淨利或任意接 generic revenue consensus。
- 在可讀 workspace、歷史交接根、本機暫存與16個封裝檔共2,749個目錄項，尚未定位2330私有12-facts包／21份金融原件；不宣稱全域不存在。已核對 XBRL parser hash `b9bac33dcbe745c51d649d81d7d5391b74d9a29abd8ae70ef4bfdc214c733428`；未以合成 fixture 冒稱重播原件。
- 現有 T86／Fugle 是股數；市場 BFI82U 總額不能填逐股三法人；TEJ 已查候選口徑為收盤價×股數，不能當真實成交價金。尚未證明現有帳戶可取所需逐股實際 TWD。
- 公告前、同口徑四季 Consensus revision 與 Guidance 的現有產品／歷史權限／合法用途仍未證明；不能寫成「只差 Mapping」，也不能推定必須購買。
- 2330真實事件／Guidance已有有來源的待審草案；沒有可自動升為因果 PASS 的審查證據。公告存在／LLM分類不等於核准。
- 正式 Owner `/account` 的永久 Owner 標示與 `/stocks` 三期間均0已實際讀取；Free／Premium正式合法身分仍不足，不能以此 Owner Session 冒充。既有會員隔離測試只沿用其隔離範圍。

下一個客觀里程碑：下一合法自然批次驗證 Worker4 是否能在截止前完成保存；同時取得可驗證的原始證據／時間／產品用途後，才能讓原始評估與此原子入口接通。不能為了畫面有股票而接受 C合格標籤、填零、倒填時間、購買資料或公開29份舊研究。

`STOCK_RECOMMENDATION_DELIVERED = NO`

`PAYMENT = DISABLED`
