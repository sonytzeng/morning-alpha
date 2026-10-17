# Morning Alpha R8：可直接審閱的交付與具名決策包

本頁是 R7 的增量交付，不是 Production 授權。R7 `b29ee8a80f798c20d8ae5e9234ade8544852d10f` 的 13/13 CI、來源准入及 Owner 讀取邊界維持有效；先前 11 項來源互斥已解決。舊失敗收據保留，不再列為目前缺陷。最新交付 HEAD 與 CI 以 [PR #258](https://github.com/sonytzeng/morning-alpha/pull/258) 為準，不拿 R7 的 CI 充作新 HEAD 結果。

完整可審閱的安全版資料在 [精確發布包](evidence/owner-release-review-r8-20261017.json)：含 R7 的 188 列來源指紋及 manifest 自身（完整 PR 189 檔，不是只審 17 檔）、三份 SQL 原文、Runtime 本機／遠端閉包、22 項網站操作、必要設定及回復指紋。R8 新增的診斷程式、測試與文件另外封存於 `core-member-integration-20261017-r8.json`；不自動加入任何正式部署 payload。

R8完整PR目前為210列來源＋R8 manifest本身＝211檔；相對R7增量26檔，並非將211檔一起部署。R7的189檔數與17檔增量是保留的歷史基準，沒有改成新HEAD的驗收數。

## 真正可用與仍未完成

| 原需求 | 正式狀態與證據 | 未完成部分 |
| --- | --- | --- |
| 每日市場／報告／新聞／收盤／既有學習 | 10/16 已保存七個 checkpoint 各 11/11 COMMITTED；Report READY、新聞 6；Closing COMPLETE、Learning succeeded | 不把此營運 PASS 稱為股票推薦或全產品 PASS；Premium 研究內容仍被品質規則阻擋 |
| LINE | 10/16 應收 3、Outbox SENT 3、成功 log 3；單一原 Retry Key 與 payload 綁定完整、重複 0 | 平台接受不等於個人已讀；不人工發送或重送 |
| V1 股票推薦 | 72 檔取得基礎資料；有效評估 0、BLOCKED 72、READY/WATCH/NONE 各 0；2330 成交量缺失 0 | 五類必要證據各影響 72 檔，原因重疊；不是 72 檔分析後都不合格 |
| 短／中／長期自然研究、Entry、Prediction／Outcome | Worker V1、Runtime 及 Auth 已正式完成；R7 保留隔離接線與恢復測試 | Caller V2 尚未啟用 Hook；Run／Prediction／Outcome 各 0。250 個交易日完整 71/72，2884 缺口不補造 |
| Academy／會員／手機 | 既有正式 Academy 保留；候選用真實隔離 GoTrue/PostgREST/SQL/RLS 驗證五種身分及 375/390/430/768/1440 | 正式 Free／有效 Premium／Legacy 身分尚無合法驗收安排；不以 Owner 或隔離帳號冒充 |
| 事件／供應鏈與會員研究 | 有來源事實、研究候選與審核／投影流程 | 29 份歷史研究：品質 16 PASS、13 待補；時間與精確用途尚未全部成立，公開 0。公告不等於利多或已驗證因果 |
| 付款／五日穩定 | 付款 DISABLED；商業穩定 0/5 | 不啟用金流，不用單日營運 PASS 或歷史重播加分 |

10/17 本輪唯讀再次確認六支正式 Function 的版本／設定／ESZIP 與封存相同；正式 `institutional_flows`、`earnings_events`、`catalyst_tw_mappings`、`research_catalysts` 各 0 列。C 八張表仍 FORCE RLS，Run／Prediction／Outcome 各 0。本頁沒有執行部署、Migration、Caller、會員政策或研究發布。

逐股欄位與期間見 [72檔真實保存缺口矩陣](evidence/v1-source-gap-detail-r8-20261017.json)：72檔只有2026-Q2來源報表值，不證明單季基礎；2026-09月營收67檔，2881／2882／2884／2885／2891未保存。以保存Q2為相對基準的四季為2025-Q3、2025-Q4、2026-Q1、2026-Q2；正式完整actual＋公告前consensus＋有來源guidance列仍0。這是保存資料的界限，不宣稱已核對各公司全部最新公告；不把累計EPS相減冒充單季。

## 發布順序與一次性決策

### A｜C Caller-only，可獨立核准

只部署 `recommendation-v2-forward-worker-v1`；來源 `5f33777836778e3600e4e377fcb3cf4de690fe80`，入口 SHA256 `e8c39bb557400b8dbabf76ce841984be4c9ee60b2867bb6602e4dd2260f42c58`，SDK 2.57.4、verify_jwt=true、import_map=false、22 本機＋63 遠端來源。

**部署本身就啟用自然研究。** 不重跑 Runtime SQL、Worker、已 PASS 的 401／401／422 或已移除的臨時入口。核准後只依合法新交易日追蹤 Run、來源版本、鎖定及成熟 Outcome，不人工補跑。回復封存的 Caller V2 固定 SDK 功能等效版本，保留所有研究與稽核；不是原 ESZIP 逐位元相同。

停止：來源／設定漂移、阻塞核心服務、晚到資料倒填、未核准公開、或無法安全回復。

### B｜會員安裝、Function 與網站，與政策切換分開

合併須以 PR #258 **最新精確 HEAD** 另行具名核准。實際部署只有安全包內的三份 SQL、`member-access`（SDK 2.115.0、verify_jwt=false 的既有自訂 Auth 模式），以及 22 項網站來源操作（16 前端、6 必要型別／建置來源）。不能整包覆寫完整 PR。

SQL 安裝影響包含私有研究與發布表、RLS／ACL／RPC、既有 ensure v1 相容 wrapper 導向 v2 及 constraint；不是只有新增空表。**安裝不啟用會員政策，也不公開 29 份研究。**

Readdy 預檢必須仍是 Record 14836408／Live 674，完整回復來源 SHA256 `71f36b8103622901c8bb03a97f6c2e485fb7a1d9768eb25cf81a0bd327af2d7f`；22 檔候選 archive SHA256 `44264ed2a6ed86be077cf9b792fc410e2f9e18f24b531ec872382fac04551085`。保留其他 310 檔與三個原型別來源。發布後需真正正式身分與裝置驗收，不能延用隔離 PASS。

本輪2026-10-17 14:12 Asia/Taipei唯讀重新開啟Readdy資訊選單確認Live674，下載Record14836408完整Source Export。雖瀏覽器下載事件等待逾時，實際下載檔已落地，完整ZIP SHA256與上述回復基準一致；沒有點Update／Restore、沒有保存來源。封存對照不讀取.env內容。

回復：停止受影響入口、恢復完整 Live 674 與固定 SDK 的 V8 功能等效 member-access；保留 Schema、快照、稽核。若政策已啟用，必須保留 v2 Legacy 防護，不能回到 Beta／預設付費或刪資料。額外 SQL 修正不在原安裝授權內。

**R8 另列一項 UI 範圍補正**：`MorningHeroCard.tsx` 將寫死的「明日 07:30」改為依 Asia/Taipei 與既有官方日曆計算下一合法排程；週末、10/9休市、07:30邊界及未知日曆反例已測。它不在原22項中，安全包 `ui_schedule_addendum` 列出前後SHA及回復；若同批核准，明確為22＋1＝23項，不冒稱仍22項。未更動正式站或日曆資料，排程時間也不等於保證報告已可用。

### C｜政策啟用，獨立具名核准

`public.activate_membership_policy_candidate_v1(text)` 必須帶核准參考，使用當下 DB 時間、不可變 Legacy 快照；保留舊會員實際權益，新會員 Free，付款仍停用。短暫 auth.users/profiles SHARE 與 member_entitlements SHARE ROW EXCLUSIVE 鎖的維護窗口須核准。正式身分無法合法安排時 HOLD，不自行建立正式測試會員或改權益。

### D｜私有捕捉與 Reader：維持 HOLD

市場 BFI82U 金額候選、四季能力模組不等於正式 V1 證據已補齊。只有用途及來源條件成立，才可具名核准指定 Producer／Reader 的獨立部署；不因 A 或 B 發布而順帶部署。

一旦保存新 private receipt，**原 Reader V55 不再是安全 rollback**。必須使用 strip-only `cd3e49cb6e60908346ccb04ed5c07ee5e89412ad`，入口 SHA256 `880cf2e4d55899c780683b6378227435b3c2cce007aa34b58f759e1718ed030a`、SDK 2.115.0、40 本機＋54 遠端來源。這是經測試的功能等效回復，非原 ESZIP 一致。

Reader Smoke 另須准許原已存在的 Owner version／updated_at 同步及必要去識別稽核 append；安全包列出精確 allowlist。有效權益、歷史報告、Decision、Recommendation、LINE、付款不得改。若無法事前證明寫入範圍與事後歸因，停止 Smoke，不宣稱全部 DB 零寫入。

### E｜正式來源准入與研究公開：維持 HOLD

不以私有 capture、格式檢查、API key 存在或寄送詢問視為權利通過。TWSE 待確切用途答覆，TPEx 回覆只及實際開放授權範圍；29 研究未取得全面公開資格。每項仍須品質、時間、用途、Owner 與 Server Entitlement 全部通過。V1 門檻不變，V2 ≥20 個不同自然交易日也僅能提出 promotion review。

## 資料能力診斷，不再用格式驗證冒充來源接通

本段是獨立 **F｜有界能力診斷**，精確內容見[F具名審閱Manifest](evidence/v1-provider-capability-exact-manifest-r8-20261017.json)，包含3本機＋54遠端＋2個Deno builtin、固定SDK與設定、一次控制寫入、6個目標、2項暫時Owner UI操作及完整移除程序。不包含在A／B／C／D的核准內。

既有健康／preflight 路徑不是本案零業務寫入的季度資料能力通道：部分會保存 provider health 或 critical evidence，也沒有受限的季度 estimate 目標。未呼叫這些路徑繞過邊界。詳細既有方案／來源查核見 [能力實證與供應商問題](v1-provider-capability-evidence-20261017.md)。

新診斷候選只允許固定官方 Finnhub 目標與最多六次 GET：兩個代碼查詢，以及 2330.TW／6488.TWO 的 EPS／營收季度估計假設查詢。這兩個代碼映射仍明示未驗證；回應 200、列數或四季形狀不能證明台灣普通股覆蓋、當前帳戶授權、公告前歷史版本或會員商用權，也不能把含供應商估值的 average 當純券商 consensus。

候選短期 Owner-only 入口為 `v1-provider-capability-review-v1`，**尚未部署、尚未獲 Production 核准**。同一 Owner Session 的 getUser＋既有 Owner predicate 通過才可領取固定私有空 Bucket `v1-provider-capability-review-20261017` 的唯一 `once.json` 控制標記。全請求 15 秒、Provider 每次至多 2 秒、每份串流 64KB、零重試；不確定結果不得重試。到期 `2026-10-18T06:00:00Z` 後拒絕，不自動展延；若審核逾期須重新封存有效期與精確指紋。

待具名核准範圍必須列：新入口的精確 HEAD／依賴閉包、verify_jwt=true、固定 SDK 2.115.0、唯一私有空 Bucket／一次控制物件、現有 runtime 記憶體中的既有 key 使用、至多一次 Owner 呼叫與六次固定 GET。不新增 Secret、Cron 或既有 Auth/RLS 修改。provider 費用與帳號介面權限未證明前，不自行執行；不以此候選宣稱資料已取得。

清理：先移除新 Function 並確認不存在、等至少 15 秒且無在途請求，才檢查 Bucket。只允許預期的 `once.json` 控制物件或空狀態；其他物件立即停止，不刪除。移除該控制物件、確認空 Bucket 後移除 Bucket，驗證入口／Bucket 不存在與受保護業務指紋不變。清理不明或失敗就保留非敏感事故證據，不擴權。

## 本輪新增驗證與沿用界限

- 新增隔離測試組合187項PASS、FAIL／SKIP均0，涵蓋串流／超時、Owner邊界、固定目標、UI生命週期、登出清除、排程與發布包安全投影。只使用合成控制回應，不宣稱取得真實Provider資料。
- 最終加入完整來源准入／歷史相容／封存反例的對應回歸後，實際363項PASS、FAIL／SKIP均0。上述187是前一輪較小組合的歷史收據，不相加成不同樣本數，也不拿測試數量當股票分析成效。
- 實際匯入新Function入口與固定Supabase SDK 2.115.0：33項PASS，未授予測試程序網路或環境存取權。固定Storage的實際SDK序列化通過；仍非Production Storage／Auth驗收。
- 新Fresh DB以真實Postgres RLS及唯一索引驗證8個併發claim只有1個成功、7個防重拒絕，匿名／會員預設拒絕、會員刪除效果0、會員資料差異0；只寫隔離控制列，全部容器與網路已清理。它不是完整Production Storage服務的替身。
- 工作樹type-check、lint（零警告）、build及新Edge Deno check通過。Live674＋會員23項、Live674＋暫時Owner UI兩項分別組合建置；後者初次tsc缺少轉遞型別來源，補齊R7封存的6個build-only來源後通過，未刪斷言或增加stub。三個原有策略型別來源保留Live674原bytes，沒有部署舊Function。
- 會員23項組合不含診斷UI；Owner診斷組合不含會員政策改動。Source map逐字核對排程元件及診斷兩個TSX，沒有把後端probe打包進瀏覽器。
- 新排程畫面實際Chrome 375／390／430／1440px無水平溢出或主要文字裁切，顯示下一合法日期2026-10-19，不代表未來報告已存在。長時間不重新render的分頁跨日更新不在此修復保證內。
- R7原有來源／Auth／會員隔離／回復證據按未變bytes沿用，不冒稱本輪重新跑過；正式Free／Premium／Legacy E2E仍缺合法身分，PENDING。當前交付HEAD CI與獨立安全審查由PR連結提供，不冒用R7的13/13。

## 正式可用的誠實結論

目前網站既有市場服務仍可用，但「股票每天完成有效評估、完整會員內容及自然研究／Outcome」尚未全部正式可用。可以先分項核准 A，並獨立審閱 B；不能為了等待資料商而停掉安全工程，也不能因工程候選完備就解除資料／用途與正式身分阻擋。正式 Free／Premium E2E、成熟 Outcome、五日驗收各自記錄，付款持續 DISABLED。
