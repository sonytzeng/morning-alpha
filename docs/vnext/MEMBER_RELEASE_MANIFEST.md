# Morning Alpha 三層會員發布候選

本候選從 PR #230 `84b62df9e611f41f668f7b0869d5548bc47eea66` 續跑；該基線九項 CI 全部通過。PR 保持 Draft。本文件不是 Production 執行授權；Sony 核准最終 HEAD 與下列精確範圍後，才可 Merge、套用 SQL 或部署。

## 現在能提供什麼

| 身份 | 候選內容 | 目前真實股票研究 |
| --- | --- | --- |
| 未登入 | 既有 canonical 公開市場摘要、日期、原市場分析與風險連結、期間介紹、註冊與現有方案、學院介紹 | 0，不讀研究 RPC |
| 免費會員 | 伺服器核准且固定每日最多三檔的摘要、主要風險、免費學院 | 0；真實空狀態 |
| Premium 或既有完整體驗權益 | 完整已核准研究、支持／反對、條件、風險、來源、個人清單與已核准歷史 | 0；不得把29項歷史探索研究公開 |
| Owner | 上述會員視角及獨立的逐筆發布審查頁 | 未完成品質、時間、授權者不能核准 |

2026-10-12 對既有 `get-report-payload` 的匿名唯讀驗證：HTTP 200、authenticated=false、tier=free、canonical public model 有效、report_date=2026-10-12。只保存回應指紋 `1ea7d728cd04f7fcc71a50d87350c066690995520604367eb1aa2bca6c18cd92`，不保存原報告或個資。頁面顯示原日期，不將上一報告改成今天。獨立 Preview 不連線 Production，公開摘要顯示未取得，不能冒充同一張正式畫面。

## 必須由 Sony 決定的既有訂閱矛盾

Production 唯讀設定為 `signup_mode=beta_full`、`billing_mode=disabled`、trial_days=14、beta_access_ends_at=null。正式方案頁也說支付啟用後才開始試用。既有 `academy_private.access_v11()` 允許有效 beta、trial、paid_active、取消但未到期與 Owner；這是既有權益，不是本輪新增的付費授權。

因此，不能宣稱「新註冊只得 Free、只有真實付費才得 Premium」已成立，也不能把手動權益或本機 paid_active 測試當成實際付款。`apply_membership_billing_event_v1` 是既有 service-role-only 狀態／防重契約，但這輪沒有可驗證的正式 checkout、簽章 webhook、退款端到端來源。沒有新增付款系統、改價格、縮短 beta、改 trial 或修改權益。

需 Sony 一次決定：是否及何時結束既有 beta、既有使用者如何保留權益，以及目前應使用哪個已核准付款接線。若仍維持 beta，可以先核准只讀頁面，但不能宣告付費會員完整商業閉環。

## 唯一精確 Release Manifest

完整檔案與 SHA256 以同一 Git HEAD 的 `docs/vnext/transition.json` 為準；Integrity 驗證封存內容及未列名 Production 檔案逐位元不變。

依序套用以下三個**尚未在 Production 執行**的 additive candidate：

1. `20261010061630_vnext_research_projection_candidate.sql`：私有研究／來源／證據／會員最小投影、固定三檔版次、個人觀察清單。
2. `20261012054120_vnext_daily_research_runtime_candidate.sql`：Run、Source Revision、Lease、Checkpoint、不可變 Prediction、Outcome Queue、Audit、Publication Pending。
3. `20261012080628_vnext_member_publication_control_candidate.sql`：獨立審核 registry、Owner approval/revocation append-only event、防重與交易式發布。無資料授權或核准種子。

Function 部署僅兩支及其確切 import dependencies：

- 新 `vnext-daily-research-v1`：沿用現有 Gateway JWT 與 CRON_SECRET，不新增 Secret。私有 RPC、70秒工作切片／100秒 lease、有界重試，無公開研究寫入。
- 既有 `recommendation-v2-forward-worker-v1`：唯一既有 Producer 差異仍為兩行 detached enqueue；具體依賴與回復 SHA 見 `DAILY_PRODUCTION_WIRING.md`。不得批次部署其他 Function。

UI：`src/pages/vnext/MemberPage.tsx`、`MemberExperience.tsx`、`MemberNavigation.tsx`、`PublicExperience.tsx`、`OwnerPublication.tsx`、兩份 VNext CSS 及其 feature 依賴。`src/router/config.tsx` 僅掛載 `/stocks` 與 `/vnext/publication`；Navbar／Account 僅加同一股票觀察入口。不是重做首頁或會員付款頁。Readdy 必須以核准 HEAD 做精確同步；本輪沒有 Readdy Update 或 Production Publish。

新公開面只有 `/stocks` 公開服務介紹與既有公開市場摘要。匿名不能讀 `get_vnext_member_v1`。Free 不收到 Premium details/history/watchlist。Owner 的會員視角也不能繞過 publication gate。Owner 審核 RPC 重用既有 `is_research_owner_v1` 所映射的 Academy server entitlement，不信任 URL、metadata 或瀏覽器 tier。

## 逐筆發布資料治理

獨立 server review 綁定 observation snapshot、完整 evidence-set hash、review version、人員、品質／時間／授權文件指紋、兩種會員用途與期限。所有新表 FORCE RLS、固定 search_path、預設 EXECUTE revoke；會員及 Owner 都不能直接讀寫新審核表。

Owner 在交易式 RPC 中只能核准最新審核；重查既有嚴格來源／時效／品質 gate。8個相同併發請求只產生一次事件。相同 key 不同內容拒絕。核准與會員 copy 在同一交易，失敗不留下半份發布。撤回只追加紀錄、不抹除歷史。已發布版本不能覆寫或再次使用另一審核覆蓋；需新的不可變研究版本。新 review 或權利／時間失效後，member reader 即停止舊 visibility。

這不是授權書審核的自動替代品。29項舊研究沒有導入可發布 registry，16項先前內容品質 PASS 也沒有被當成策略有效或會員授權。精確原始時間、官方用途確認、逐筆 Sony 核准仍未完成。現有保守 SQL gate 不因本輪放寬。

每日 runtime 與 publication 私有模型仍保持分離。Worker 只保存 PENDING，不能自行核准；研究資料轉成正式審閱版本、附具獨立審核及官方授權證據仍需受控資料編輯流程。未有可審批的合法新研究前，不啟用任何自動 publishing importer，也不將舊29項補成 Forward。

## 已驗證與未驗證

- 基線九 CI PASS；本次最終 HEAD CI 以 GitHub Checks 為準，不能沿用基線結果。
- 本機真正 GoTrue + PostgREST：Owner／Free／Premium／other；Quality Pending、Licensing Pending、非Owner核准、直接API tier注入拒絕；8次併發、防重衝突、不可變、跨帳號、撤回與 logout refresh 失效通過。
- 既有 DB entitlement 在隔離環境驗證 paid_active、取消未到期保留、取消到期／expired／past_due 降級。未將退款事件猜成某個狀態，付款／退款真實 provider E2E 是 PENDING。
- Chromium 四身份，1440／375／390／430：真實登入、空投影、Owner頁拒絕、Reload／Logout、無水平溢出、零 page error。實際股票公開0。截圖在 `/private/tmp/ma-vnext-member-release-qa`。
- Fresh DB 整份新增 SQL 與所有相關檢查由新 CI step執行；不能把只更新本機函式當成一次乾淨完整 Migration。
- Production Owner／Free／Premium 登入與付款狀態未被合法驗證，全部 PENDING。不新增正式測試帳號、不改任何訂閱。
- 每日自然執行與新 Prediction／成熟 Outcome 未觀察。P1 隔離 Worker 證據保留，不重跑10/8冒充自然驗收；Forward0、Outcome0。

## 發布順序與回復

只有 Sony 對最終 SHA、三個 SQL、兩支 Function、UI 清單具名核准後才能執行。先確認備份與正式 entitlement，套用 additive SQL，再單支部署新 Worker，最後部署已核准 detached caller 與 UI。使用合法正式身份做唯讀與具名 Academy／VNext 偏好驗收；不新增交易、不改正式策略、不重產報告／補LINE。觀察下一合法交易日，不能提前稱 NATURAL PASS。

故障時回復原 Router／Navbar／Account 及 V2 caller 的 `2a5d461ec3d98bfc8bc3177a295c95e299b7bda2` 精確基線，移除新增入口／enqueue，不回復其他產品至舊版。停止新 Worker接入；保留所有不可變審核與研究資料。不得用 DROP TABLE 或 DELETE 當 rollback。若權限洩漏，先關閉新member投影入口與其新RPC，不改既有 Auth/RLS。

## 結論

目前可交付三層介面、server entitlement、防重審批與自然研究接線的候選；不是已上線的付費研究產品。正式阻擋包括 Sony精確release核准、既有 beta與付費要求的商業決定、官方資料用途回覆／時間證據、真實帳號與付款E2E、自然新研究與Outcome觀察，以及受控研究審閱資料輸入。Production 寫入0、未 Merge／Deploy／套用Migration／改Cron／Secret／正式業務；不聲稱已重新計算全站Production業務資料前後指紋。

`MEMBER_PRODUCT_ENGINEERING=INCOMPLETE`（整體正式會員目標未完成）

`PRODUCTION_RELEASE_READY=NO`

`NATURAL_STOCK_RESEARCH=PENDING`

`PUBLIC_PRODUCT_APPROVAL=NO`
