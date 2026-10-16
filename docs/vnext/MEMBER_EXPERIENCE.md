# VNext 會員研究體驗 V1 — 未發布候選

從 PR #230 / `2af00e1094304a6f8c624ea93ccffe8b4b56238b` 續跑。保持 Draft。
沒有 Merge、Production 部署、Migration、會員公開發布、付費來源、Secret 或 Cron。

## 使用體驗與入口

候選路由 `/stocks`：股票觀察，短期／中期／長期使用既有獨立研究模型，不重做 Engine。
`MemberNavigation` 共用同一 `MEMBER_NAVIGATION`，涵蓋桌機、手機及 `/account` 入口元件。
目前只掛載於本機隔離 harness，沒有改正式 Router/Navbar/Account，避免候選功能提前出現在會員站。
未來核准 UI release 時須把同一元件／route 接至正式站，不能把本輪 Preview 宣稱已上線。

第一屏回答為什麼觀察、觀察多久、確認條件、風險／失效及下次檢查時間；Premium 詳細依據預設收合。
免費最多三檔是**每台北日固定股票名單**，不是只限制一次請求三筆。固定三個 slot 不可覆写；撤回不補位，不能靠切換期間或直接 API 取得第4檔。
同一股票若有多個核准期間可分頁閱讀；不把同一分數當三種策略。
免費資料在 DB 已移除 Premium 詳細依據、個人清單、歷史；不是 CSS 隱藏。
Premium／Owner 的會員視角也只讀已核准公開資料。Owner 私有研究仍從獨立 Owner RPC 讀取。

## 伺服器契約

唯一候選 Migration 仍為 `20261010061630_vnext_research_projection_candidate.sql`，從未套用 Production。
沿用正式 `academy_private.access_v11()`／`is_research_owner_v1()`，不修改既有判定。
無 tier、user_id、日期、symbol 或 horizon 讀取參數，不能用 client tier、URL、localStorage、user_metadata升權。

- `get_vnext_member_v1()`：分級最小投影；anon 無 EXECUTE；私有 schema/table 無會員原始讀取權。
- `set_vnext_watch_v1(text,boolean)`：僅 Premium／Owner，身份從 auth.uid()，只能追蹤合法可讀研究；每人鎖定、防重、最多200個有效追蹤。只寫候選研究偏好，不是交易。
- 原 `get_vnext_observations_v1()` 收斂為 Owner-only，避免兩條投影造成會員繞過。
- 新增 `member_copy`、`member_daily_edition`、`member_watch_events`。新表強制 RLS，固定 search_path，預設 EXECUTE revoke，Owner 也不能從 API 直接取新私表。
- 偏好事件 append-only；使用者A不能讀B的資料。降級即失去完整依據／清單／歷史的讀取權。

## Publication 與資料權利

`member_copy` 必須在原 observation 完整 publication gate 成立時才可新增；綁定不可變 approval ID/hash。
保留來源商用／再散布條件、PIT、每期間必要 evidence、真實symbol關聯、失效條件、審閱期限。
支持／反對分類由已審閱的具名 evidence 綁定，不能從新聞語氣自行猜。
事件只允許相同 cutoff 內已確認且 symbol-linked 的 fact；審查時鎖定事件 revision，後來新增的倒填日期版本不能替換已審內容。關聯必須 DOCUMENTED／VERIFIED，有直接來源，禁止從 INDUSTRY 推定供應鏈。
未核准事件／未知關聯顯示「尚無已核准資料／無法確認」，不製造利多利空。
到期研究只有原先通過完整 gate、審閱身份未撤回且授權仍有效才可在 Premium 歷史顯示；不當成今天有效候選。
Outcome producer 仍 NOT_ENABLED；不提供測試勝率或虛構報酬。

正式市場摘要只沿用 `get-report-payload` 的 canonical public model及原 envelope identity。無合法摘要就顯示未知及正式市場入口，不重算方向。
隔離 Preview 明確不連線 Production Core，此摘要為「未取得」，不是用假的正常狀態代替。

## 真實研究與示範分開

真實已保存證據缺口保持：250市場交易日71/72、精確歷史發布時間／財務與事件不足、多數供應鏈未知；Forward=0、Outcome=0。
目前**沒有會員公開核准資料**，合法真實會員投影應為空。不得把本輪功能／安全正向 fixture 當成正式股票觀察。
所有正向 UI 測試公司明確標「非真實股票」，頁首固定隔離資料警語；不修改私人真實 evidence、不提交原始 provider payload。

## 驗證與預覽

`node --experimental-strip-types scripts/vnext/member-isolation.mjs`：全新 disposable Postgres17 +真實 Supabase Auth +PostgREST。
本機 Owner／Free／Premium／Other 測試帳號用密碼登入；不是 Sony 正式身分，不是前端 role selector。
`MA_VNEXT_KEEP_PREVIEW=ISOLATED_ONLY MA_VNEXT_PORT=3221 ...` 可保留本機 Preview。
Owner、Free、Premium、匿名拒絕、舊私有 API 拒絕、raw tables 拒絕、query body越權拒絕、user_metadata升權拒絕、觀察清單防重與重登保存、跨帳號隔離、降級與撤回 fail closed均由DB/API驗證。
瀏覽器驗收與最終 Gate 結果記錄於 EXECUTION_CHECKPOINT。

## 唯一待核准 Release Manifest（本輪不執行）

1. PR #230 最終經驗收 HEAD 的 Merge。
2. 唯一 additive migration：`20261010061630_vnext_research_projection_candidate.sql`（含11個新私有表／新候選RPC，不改既有Production表／policy）。
3. Owner/member UI candidate `/stocks` 與同源 Desktop/Mobile/Account入口，正式 Router 的精確掛載差異需在發布候選中再確認。
4. Function deployment：NONE；新 Secret/Cron：NONE；既有 Auth/RLS：NO CHANGE。
5. 正式 Owner／Free／Premium 身分驗收及非Academy/非VNext業務資料唯讀diff。
6. **資料公開另受逐筆合法再散布與研究審查控制**。UI部署不會自動核准私有研究或合成fixture；無核准資料就空狀態。

`VNEXT_MEMBER_PRODUCTION = NOT_DEPLOYED`
`SONY_USABILITY = PENDING`
`PUBLIC_PRODUCT_APPROVAL = NO`
