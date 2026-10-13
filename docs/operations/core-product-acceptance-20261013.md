# Issue #238｜Morning Alpha 核心功能驗收矩陣

## 範圍與證據分級

任務依據：<https://github.com/sonytzeng/morning-alpha/issues/238>。金流整合暫緩；Lemon Squeezy Test mode、Production Payment DISABLED。既有會員權益不變。

本輪 Production 僅 SELECT / catalog 讀取與網站唯讀瀏覽；沒有人工 Fetch、Report、LINE、交易、研究寫入。下列「正式」只指實際保存結果；隔離測試、原候選 CI、歷史重播不取代自然執行或真實登入。只保存非敏感彙總，不包含新聞／報告原文、收件人、會員或交易資料。

- main：`2a5d461ec3d98bfc8bc3177a295c95e299b7bda2`。
- PR #230：`a5c0ae5fc81661de87cb32e9ad9ebced2f394170`，Draft，九項 CI PASS；工作樹乾淨，ahead main 34 / behind 0。本輪沒有改它。
- 本候選獨立分支：`codex/core-acceptance-calendar-p0`，由 main 建立，避免混入 PR #230 會員／金流候選。
- PR #236/#237 僅有 Emma incident Markdown，沒有產品修復；不能當成已修復或合併它們。
- 取證日期：2026-10-13 Asia/Taipei。15:35 正式終態已保存；08:15 未親自觀察，以下早盤結果取自不可混同的當日保存證據。

## 完整功能矩陣

| 功能 | 已完成實作／候選 | 正式可用與本輪實證 | 未完成／阻擋／下一步 |
|---|---|---|---|
| 每日核心市場 | 現有 Atomic + Market Decision | 10/13 premarket COMMITTED 11/11，核心及 DATA_SLA PASS | 不更改 Provider/Atomic/Decision；持續以當日證據驗收，不以一次 PASS 保證永久正常 |
| 每日報告 | 現有正式 Producer | 10/13 FULL_PUBLISHED；正式報告採用 6 篇新聞 | 10/8、10/12歷史仍 DEGRADED，不能回填／重產 |
| 新聞取得與採用 | PR #235 已發布 | raw187、dedup187、blacklist2、剩185、fresh71/淘汰114；保留80；producer選7、canonical7；preflight relevance/quality6，實際 Report6 | 母數不同不能相加；producer report_accepted=null 不等於0。未保留階段不得推算 |
| LINE 自然發送 | V659模板，現部署line-daily-push V70 | 10/13 outbox3、SENT3、unique recipients3、attempts3、failed0、dead0、duplicate0；07:23:02送出，共1種payload指紋 | 本輪不群發、補發、改Dispatch；SENT是正式delivery receipt，不聲稱每人已閱讀 |
| 六個 checkpoint | 現有正式 Lifecycle | 09:00/09:30/10:30/13:00/14:10/14:30 全COMMITTED11/11 | 無需重做／重跑 |
| 收盤分析 | closing-verification-engine V33 + close-market-review V37 | 10/13高可信，missing0，14:30保存；CLOSING PASS | 不改帳務或收盤商業邏輯 |
| 市場方向 Learning | continuous-learning-engine V17 | 15:11 DAY_COMPLETED，learning COMPLETE；market prediction1、stock prediction0、stock NOT_APPLICABLE、failed0 | 不能將市場方向學習當股票選股勝率 |
| Operational Acceptance V2 | 正式分維度判定 | 15:25和15:35 PASS；REPORT/LINE/CORE/CLOSING/LEARNING/PUBLIC_PROJECTION PASS；RECOMMENDATION獨立BLOCKED | 10/9休市誤FAIL已找到兩層程式缺陷；本PR候選修復，Production仍待核准 |
| 正式 V1 推薦 | 既有 Producer/品質門檻 | 10/13 universe72、evaluated0、BLOCKED72、READY/WATCH/NONE0 | 四季完整證據0/72；institutional/catalyst/reaction缺口。不能降低門檻或以V2取代 |
| 官方財務實際值 | 現有 acquisition | 公司72、季度EPS實際72、月營收實際58、完整四季推薦證據0、guidance0、consensus0 | 有一季actual不代表四季完整，actual≠consensus，shares≠TWD |
| V2 Shadow股票研究 | 正式 V2 Worker V2 | 10/13七階段各掃72；14:30 READY0/WATCH4/NONE68/BLOCKED0；全部Owner-only | 10/12 14:30的72檔皆因BENCHMARK_SESSION_HISTORY_MISSING；保存benchmark_history為0（14:10及10/13皆20筆）。缺口正確拒絕，失敗來源未保存不能推造；不改歷史、不Promotion |
| V2 Prediction / Outcome | 既有Forward Lifecycle | 10/8–13共41筆鎖定Prediction（含多checkpoint），7筆1D OBSERVED Outcome | 41不是41檔獨立樣本；Outcome gross_of_costs + conservative日K假設，非真實成交／淨利／有效策略證明 |
| Entry三策略 | Worker V3 已部署 | 2筆HISTORICAL_REPLAY run、432策略判定；Outcome0 | 自然Forward未接入、Outcome未啟用。不得把10/7、10/8重播當事前績效 |
| VNext短中長研究 | PR230候選／既有真實保存研究 | 歷史探索short1、medium28、long0；16品質通過、13待補；Forward0/Outcome0 | 非今日推薦；全部時間／授權／Owner發布門檻仍未滿足，public0 |
| VNext每日接線 | Adapter、Worker、Lease/Checkpoint、Prediction、Outcome候選；隔離CI通過 | Production無vnext_runtime schema、無vnext-daily-research-v1 | 必須取得精確Migration + Worker + detached caller批准，不能把候選說成每天自然運作 |
| 產業／公司事件交叉分析 | 既有官方facts與候選Evidence mapping | 事件不自動利多；供應鏈無直接證據時UNKNOWN | 補可比較歷史財務、公司事件時間／原文及可證明關係；不得捏造長期研究 |
| Public市場摘要 | 既有public read model | 正式acceptance PUBLIC_PROJECTION PASS；首頁顯示10/13市場摘要、等待確認及正式推薦資料不足 | 本輪Owner瀏覽不冒充匿名完整權限E2E；不公開私人研究 |
| 免費／Premium研究 | PR230 server entitlement + publication projection候選 | 已核准公開股票研究0，不能硬湊3檔 | TWSE/TPEx書面答覆仍待確認；不得由已寄信推定授權。真實Free/Premium E2E PENDING |
| Academy | PR225/228等已發布；既有教材與進度 | Sony真實Owner：10章可讀、免費／進階分級、兩PDF入口、既有進度恢復可見；1440/375/390/430無水平溢出 | 本輪唯讀，未作答或改進度；Free/Premium真實帳號與跨帳號持久化PENDING。不重做教材／Migration |
| Owner Backend / Cockpit | 已發布，owner-trading-lab-v1 V9 | Sony已親自登入；五頁可讀、技術資料收合；三個Cockpit畫面可讀，歷史Entry明確分類，Paper/Live分頁分離 | 不新增正式測試交易；寫入/併發帳務不重跑。Owner實機唯讀PASS不等於Sony使用體驗PASS |
| 桌機／手機 | 原UI已實作 | 正式Owner五頁、Cockpit三個畫面、Academy於1440/375/390/430無水平溢出；截圖保存在本機驗收包 | Free/Premium完整流程仍需合法Session。不把Owner視為一般會員、不以候選測試代替Production |
| 支付／Legacy權益 | 舊候選保留不動 | 正式付款停用；Lemon Squeezy工作已通知暫緩 | 本輪不整合／啟用／建立測試訂閱，Legacy權益完全不改 |

## Exact root cause：休市被誤報核心故障

正式日曆 `market_calendar_session_v1('TW','2026-10-09') = false`。無10/9 Report是合法狀態，但15:25、15:35 acceptance皆FAIL：

1. `capture_morning_alpha_acceptance_v1(date,text)`只依週末或reports JSON的`is_trading_day=false`，沒有報告時將平日休市判為FULL_DAY並累加故障。
2. `enforce_atomic_checkpoint_acceptance_v1()`寫入驗收時，再無條件對六個當日checkpoint判定到期，將NOT_DUE改為FAIL。只改第一層仍會失敗，Fresh DB已重現。

最小候選：兩層都依**既有正式交易日曆**；超出日曆覆蓋必須拒絕未知，不得當休市。真交易日缺資料照FAIL，偽造報告休市或NOT_DUE標籤不能跳過驗證。既有歷史FAIL不改寫。

## 兩項只讀顯示修復候選

1. `/account`把新聞發布日必須等於台北今天，誤當成Report是否已採用：10/13正式Report已採用6篇，但前一日下午發布的合格新聞仍顯示「待更新」。新增純函式只讀既有server-trimmed `important_news`採用清單；核對數量與原發布時間不晚於報告產生時間，未知、空清單、未發布／歷史報告仍不宣稱完整。不新增品質／時效門檻，不以抓取數冒充採用數。
2. Owner Cockpit支持／反對理由的`UP/DOWN/FLAT`及指數縮寫僅做繁體中文顯示翻譯，保留所有原數字、正負號、方向與未知內容，不改研究結果。

前端範圍：`src/lib/reportNewsPresentation.ts`、`TodayInfoCards.tsx`、`src/features/research/cockpit.ts`、`OwnerCockpit.tsx`及直接測試。Readdy正式發布仍需Sony核准；本輪沒有Publish。React檢查：均為render-time純函式，沒有新增Effect、網路請求、套件或帳務操作。

## 推薦獨立阻擋與新核准邊界

2330的`20_DAILY_VOLUMES_MISSING`已精確證明是讀取衝突，不是本次歷史Provider未取得：

- 正式10/13研究cutoff：`2026-10-12T23:06:42.018Z`。
- 成功capture於`23:05:30.616Z`已取得43筆正規化日K；10/8與10/12成交股數皆為正，單位SHARES，早於cutoff。
- 同日同一13:30的Core `market_quotes`版本沒有成交量。`decision-v1-evidence.ts`先按時間／ID排序，`bars()`再以交易日去重；核心UUID排在`stock-evidence:`前，覆蓋完整capture。
- 所有72檔的法人TWD、四季Actual+Consensus及公司事件映射仍缺；**修一項成交量衝突不會把72檔直接變成合格推薦**。

Issue #238禁止未另行核准修改受保護Recommendation邏輯。本輪只診斷，不改檔。最小待核准候選範圍：`supabase/functions/_shared/decision-v1-evidence.ts`的同日量價選擇、直接單元／負向測試及必要Integrity manifest；保留cutoff、來源追溯、價格衝突fail-closed與所有正式門檻。不得擇優價格、補零、合成未證明成交量；完成候選後才列出精確部署SHA與必要consumer，不先部署。

另外，V1四季Consensus／法人TWD與事件因果映射缺口屬方法論／Producer能力邊界；既有V2 Shadow保持平行研究，不自行Promotion。這些不能包裝成「今天沒有股票達標」。

### 唯一日曆修復 Release Manifest（尚未授權執行）

- 唯一Migration：`20261013073004_operational_acceptance_calendar_guard_v1.sql`。
- 只修改上述兩個驗收SQL函式；**零Edge Function部署、零Cron/Secret/Auth/RLS變更**。
- 前置prosrc MD5：capture `9d0c66a17d93fa3d6319fa309ae4ca7b`；trigger `aaca0aeed381e54a1333bc2385cbf04e`。不符整筆交易失敗，不做模糊patch。
- 正式函式ACL皆postgres/service_role EXECUTE；capture SECURITY DEFINER、trigger SECURITY INVOKER；兩者固定空search_path，必須保持。
- 不更動Atomic collection/commit/integrity函式、Report、Decision、Recommendation、LINE；無業務DML、無歷史重寫。
- 風險：驗收排程判斷錯誤可能誤報／漏報；交易日缺資料、假休市標籤、越界日曆、匿名／會員拒絕、其他函式逐位元不變必驗。
- 回復：發布前取這兩個精確前置function definition及ACL指紋；一個transaction只還原這兩個definition，驗證hash/ACL；不刪除已保存觀察。不得回滾其他正式功能。
- 部署後只能新增當下合法觀察，不得覆寫10/9歷史。正式Merge／Migration需Sony具名批准。

## VNext最小正式接線清單（本輪不執行）

以PR230精確HEAD為候選來源，保留Draft。研究接線與付款／Legacy政策必須拆開：

1. 唯一最小Runtime SQL：`20261012054120_vnext_daily_research_runtime_candidate.sql`；vnext_runtime獨立Run/Checkpoint/Lease/SourceRevision/Prediction/Outcome/Audit/Publication結構及transactional RPC。
2. Runtime-only不需要一起執行研究會員Projection `20261010061630_vnext_research_projection_candidate.sql`；本最小包不公開會員研究。
3. Owner逐筆發布候選SQL `20261012080628_vnext_member_publication_control_candidate.sql`亦排除；尚無合法內容，不能隨研究Worker自動公開。
4. 新Worker `vnext-daily-research-v1`，既有`recommendation-v2-forward-worker-v1`只加detached enqueue及精確shared dependency；使用既有合法身份，不新增Secret/Cron。
5. **排除**`20261013045054_membership_legacy_policy_candidate.sql`與`member-access`會員政策／付款改動。不得直接整包合併PR230當部署。
6. 前置：逐檔fingerprint、正式schema/ACL差異、退回caller原版的rollback、部署後Production-like readonly確認，再觀察新交易日Forward，不回填歷史。

這是待Sony審閱的範圍清單，**不是已發布或已取得Migration授權**。精確獨立release SHA須由研究接線候選切分驗證後提出；不可在付款暫緩下混合promotion。

## 驗收與Git回報

本候選保留完整舊版Integrity gate，新增精確sealed transition；每個候選檔案hash、保護路徑、未知新增、manifest權限提升及歷史reader掩蓋修改均有負向測試。沒有降低測試標準。

PR239的83079b4版本shadow-analysis CI（run38369646940/job115203161111）因10分鐘上限被取消，沒有斷言失敗證據。只將該job有界時限調整為40分鐘，完整validate調整為60分鐘，沿用PR230已通過的時限；所有測試、資料庫、Auth與Deno步驟保持不變。最終結果必須以新HEAD的完整CI為準，不能把逾時當作通過。

本輪沒有Production寫入／部署／Migration／Cron／Secret修改；業務邏輯code diff為0。自然系統持續產生資料，**不宣稱全資料庫筆數或fingerprint在整輪期間靜止**。

LOCAL_CALENDAR_TESTS = PASS（Fresh DB、真實SQL、休市／交易日、範圍外日曆、ACL、歷史保護、防重與精確rollback全部通過）
TYPE_CHECK = PASS
LINT = PASS
BUILD = PASS
INTEGRITY = PENDING
CI = PENDING

上述待執行的完整回歸與CI結果以本PR精確HEAD的Checks與交付紀錄為準；此文件不預先宣稱成功。正式 `/report/today`、`/war-room`、`/verification`、`/performance`已用Sony Session唯讀驗收：1440/375/390/430無水平溢出，10/13收盤顯示完整成立，績效顯示有效樣本與限制，不將市場方向命中冒充股票交易獲利。

核心產品總狀態：**INCOMPLETE**。待正式日曆／顯示修復批准、自然研究接線精確release批准、2330推薦讀取修復具名範圍、必要Evidence完整性／方法論決策、資料授權／時間證明及合法會員實機驗收。Sony使用體驗仍PENDING，未核准研究不得公開。
