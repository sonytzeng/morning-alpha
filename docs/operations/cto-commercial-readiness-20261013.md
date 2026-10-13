# Morning Alpha CTO 商業就緒候選（Issue #238／#240）

## 驗收分層

此文件不是正式全產品完成證明。工程候選不等於正式上線；隔離負載不是正式 Supabase 容量保證。

|功能|可追溯結果|分層／剩餘阻擋|
|---|---|---|
|10/13核心市場／Atomic／盤前|11/11；六個盤中節點各11/11|PRODUCTION_VERIFIED：僅該日|
|Report／市場新聞|FULL；原始187、去黑名單185、時效71、保留80、Producer7、Preflight6、Report6|PRODUCTION_VERIFIED：不能以抓取量代替報告採用量|
|LINE V659／現有Sender V70|3/3 SENT；failed/dead-letter/duplicate0|PRODUCTION_VERIFIED：不重送、不改Sender；既有V659內容保持原樣|
|Closing／Learning|完成；重要缺失0；市場樣本1、股票0合法不適用|PRODUCTION_VERIFIED：不證明股票策略勝率|
|Operational Acceptance V2|10/13 15:25／15:35 PASS|PRODUCTION_VERIFIED；10/9休市誤報FAIL的修復為PR#239待核准SQL|
|跨頁判斷信心|同一10/13正式revision aacc53d4-ba31-4594-acb0-61161a64b973：首頁65；Today原顯示48|已確認缺陷；本候選ENGINEERING_PASS，尚未正式更新|
|正式V1推薦|72檔、評估0、BLOCKED72|NOT_READY：不能當成單純無合格股票；Reader未接72檔證據、量覆蓋及Hard Gate缺口另案|
|V2 Shadow|該日盤前READY1/WATCH3/NONE68；最終WATCH4/NONE68|Owner-only；41鎖定研究、7個1D Outcome不是交易獲利證明|
|Entry Opportunity|歷史432項：READY0/WAIT26/AVOID370/INSUFFICIENT36|研究可讀；自然Forward／Outcome尚未啟用|
|VNext短／中／長研究|歷史1／28／0；品質PASS16、PENDING13|29項時間／授權仍待確認；會員可發布0；Forward／Outcome0|
|Daily VNext Worker|PR#230已有資料Adapter、SQL、非阻塞Hook候選|OWNER_APPROVAL_REQUIRED：新Worker與持久化SQL尚未部署|
|Academy|隔離真實GoTrue登入、Free7章14題、Premium10章23題、跨帳號／登出已通過|ISOLATED_E2E_PASS；正式Owner可讀，正式Free/Premium缺合法驗收帳號|
|Owner Trading Cockpit|PR#223 merged／Function V9，正式Owner唯讀可用|未建立正式測試交易；Paper／Live帳務隔離回歸已完成，不等於策略有效|
|金流|Lemon Squeezy TEST；Production DISABLED|暫停，不修改既有價格或權益|
|五日商業穩定|獨立純判定候選已建立，08:15／15:40 Asia/Taipei|NOT_READY：目前0日；10/13不得计入，修復正式發布後才能啟動|

證據包：本機 `cto-240` 與 `issue238-owner-qa` 目錄；Production查詢只保留非敏感計數及指紋。沒有把網頁暫時載入中當成故障。

## 本候選修復

1. Today第一層沿用既有正式 `projection.confidence`，不再把 `productDecision.model_confidence` 的資料品質48冒充市場判斷信心65。品質與校準資訊預設收合；原計算完全保留。缺失不借值，0仍為0，新分數82亦可正確顯示。
2. Pricing清楚標明未開放付款；Navbar「14天完整試用」改為「會員方案」。NT$199與14天只保留為既有規劃，不產生試用、不改權益。
3. 新增獨立商業穩定判定，不改Operational Acceptance V2。正式發布SHA／Owner核准／驗證時間、自然只讀AM/PM、官方交易日、不可計未來觀測或歷史重播、任一天失敗重算。合法BLOCKED只有在評估完成且無管線缺陷時可計入。
4. 新增隔離容量腳本及CI。完整旧Integrity鏈逐層驗證真實候選後，才還原不可變前一層；保留未知路徑、未封存修改、核心漂移及授權升級拒絕測試。
5. 正式匿名績效頁10/13顯示英文 `down`、10/12 `flat`：只翻譯既有方向為收盤偏空／震盪，不改結果或樣本統計；會員中心重複h1改為區塊h2，保留原外觀。
6. 今日節點全部完成後沒有下一個時間時，不再顯示孤立的「｜」；已有時間的節點仍保留原時間，不推算新排程。
7. 歷史報告卡原把行動標籤當成市場方向，造成已發布且收盤通過卻顯示分析不足；改讀已驗證projection的方向欄位，不推導缺少的Action。未發布資料仍顯示歷史資料不足，品牌名稱不再重複。
8. 首頁相同正式句子不在相邻摘要重複；「最新市場資料時間」與「報告產生時間」分清。舊發布素材頁缺社群素材不再說LINE未接入，不改V659文案生成或Sender；頁外標題改白字，真實素材日期與查詢日期分開。
9. CI官方註記證實Research Foundation10分鐘、Owner Lab及V2 Shadow各15分鐘逾時（runs38404236250／38404236185／38404236341），沒有斷言失敗證據。這三項增加至30分鐘有界時限；測試確認原工作流所有命令與權限不變。Integrity只快取Git路徑清單，以相关資料夾及Git index/HEAD時間／inode資料失效；任何非忽略的未追蹤資料夾會強制重新查詢，避免空資料夾內新增深層檔案被藏住。每個候選與受保護來源的實際位元仍逐次核對，沒有快取授權或跳過測試。實際同一Node程序的深層未知檔案控制已拒絕，移除自建控制後恢復PASS。

10. 真實歷史報告詳細頁會依方向標籤生成固定09:15、0.5%與1%條件，與當日正式09:30條件不一致；本候選移除這些UI推定，重用Canonical解釋的已保存條件，原數值不改、缺失不補。個股未發布與市場報告FULL分開標示，沒有逐項缺失原因時不猜品質失敗；診斷分數預設收合。
11. 獨立風險審查補強內層Canonical的報告日期、snapshot ID及正整數版本綁定。正式Reader的匿名泛用觀察骨架沒有這些識別，不能冒充「當時保存的條件」；保留真實空狀態。另一個CI實證競態run38418097840：pg_isready接到initdb暫時Unix socket，隨後重啟造成psql socket不存在，SQL/RLS尚未開始。只把Entry隔離等待改為容器內TCP、30次上限與最後fail-closed確認，所有Deno/SQL/RLS/UI命令保留。依據：[官方Postgres容器entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh)，暫時daemon使用空listen_addresses。
12. 完整CI run38419954873有六項實際失敗且60分鐘逾時，不隱藏為「單純逾時」：兩项舊Academy控制仍預期Calendar層錯誤／舊diff參數；兩項完整性控制碰上networkObserver首次Build暫時清空auto-imports.d.ts；Performance隔離loader未注入真實顯示helper；新歷史prose版本綁定read-site尚未列入精確圖譜。修正直接測試依賴與最新CTO層級，所有原拒絕控制保留；新增該唯一symbol/read-site的用途分類，沒有整檔豁免。將既有Build移至公開並行測試前，保留每一個SQL／Edge／RLS命令與權限；完整release有界時限120分鐘。新增逐字比較回歸確認只有時限與Build順序改變。該舊run不得列PASS，後續以新HEAD全套終態為準。
13. 精確HEAD6f987ec的完整release兩次在約7／8分鐘被取消，官方註記只有operation canceled，沒有斷言或OOM原因證據；不得先推定記憶體問題。Academy另遭官方映像Rate exceeded，同HEAD第二次通過。完整公開回歸改成四份獨立runner、每份單一測試程序、各120分鐘有界時限。清單仍由未改的package.json原glob與實際tests目錄產生；聯集、無重複、無遗漏與非法參數皆經獨立負面控制。所有四份成功才執行原SQL／Edge／RLS工作，不使用skip/filter/continue-on-error，不移除既有業務／安全斷言，僅更新必要測試接線並新增分片負面控制。每30秒只輸出非敏感runner記憶體統計，協助辨識未知平台取消；新的候選另綁HEAD及完整CI結果。
14. 10/14跨日實機驗證Today已有保護：今天判斷尚未產生時，不展示10/13行情；不另改既有跨日契約。靜態資料流另證明所有節點完成的空時間會以includes('')匹配第一個09:30盤前條件。本候選只在時間非空時匹配正式條件；空值／未匹配不借第一筆，真實09:30仍保留。另有10add26分片3官方runner shutdown證據，不能歸因為OOM或測試失敗；歷史失敗照實保留。
15. Academy官方固定GoTrue映像多次下載限速，未開始Auth測試；增加同一來源、同一tag的三次下載重試、20秒間隔、3分鐘step上限，全部失敗即拒絕，不換Registry或憑證。逐字比較保留所有原Auth／RLS步驟。分片另外記錄Node實際可讀的OS總／可用記憶體；cgroup資料不可取得時仍明示未知，不把shutdown當OOM。Sony已確認目前無合法正式Free／Premium驗收身分，維持PENDING，不建立Production測試帳號、不改權益。
16. 精確HEAD0b73596分片3再次收到runner shutdown；記錄的MemFree從約15.5GB降至0.32GB，但這不是Linux MemAvailable，不能以此證明OOM。相同HEAD的完整Academy Integrity九項，在本機以2048MiB V8 old-space設定通過，206.360秒、無skip/cancel；最後程序RSS樣本約2.2GiB，並非總RSS上限證明。本候選只為完整公開測試執行器增加同一有界old-space參數，保持每個原測試檔案、所有斷言與fail-closed退出；另保存MemAvailable而不混同MemFree。此為CI資源控制，不是假稱已證明shutdown根因或降低產品門檻。[Node官方參數說明](https://nodejs.org/download/release/v22.13.0/docs/api/cli.html#--max-old-space-sizesize-in-mib)指出接近old-space上限時會增加垃圾回收；它不是程序總RSS硬上限。

另案：舊 `/admin/publish` 對匿名可見空素材框架；正式Reader仍裁切權限，本次未觀察私人內容洩露。是否保留一般管理員既有素材權限、或改為具名Owner-only，需先確認安全／Legacy權益規則，不自行修改正式Auth或RLS。Chrome新分頁已恢復Sony正式Owner；五頁後台、交易中心三分頁與Academy已完成四尺寸唯讀截圖，無溢出、技術詳細資料收合，Console error/warn0。既有研究顯示的DOWN/FLAT翻譯已在PR#239，不重做；正式未發布前不冒稱已修好。

正式唯讀SRE樣本：10/13 07:00–15:45，Gateway1649筆／Function170筆皆5xx0、4290；Gateway有5筆401/403，尚未分類，不直接視為產品故障。Report Reader38筆Function execution P95 3991ms；此非HTTP端到端或10k尖峰量測，且未保存各內部階段耗時，不能斷言某個4秒timeout就是原因。已列獨立效能Incident，核心受保護Reader不得擅改或部署。

## 真實容量測試與限制

PostgreSQL17.11，ARM64，Docker主機4CPU／約7.74GiB；容器network=none。10,000隔離合成帳號、100,000進度資料；實際SQL/RLS/RPC，不是正式登入身分。

|持續連線併發|20秒實際交易樣本|P95毫秒|每秒交易|失敗率|
|---|---:|---:|---:|---:|
|10|190331|1.932|9516.30|0%|
|30|150184|6.685|7508.03|0%|
|50|123557|13.472|6177.61|0%|

每筆交易包含會員目錄、Premium教材與自身進度RPC。自身查詢以主鍵Bitmap Index Scan讀10列，100k資料下實際EXPLAIN執行0.843ms。跨帳號0列、Premium到期拒絕、Legacy未知到期保留均經真實SQL測試。

補充既有隔離GoTrue／PostgREST真實登入與唯讀HTTP短負載：3個合法隔離帳號（非10k帳號情境），Free7章、Premium與Owner10章，Free直接要求Premium教材403。併發10／30／50分別60／180／300次目錄請求，P95 23.503／39.921／43.909ms，Throughput1285.52／1913.51／2164.65 RPS，error0。僅短突發，不是持續HTTP容量保證。3次登入最大182.984ms，樣本太少不宣告Auth P95。全程無Production憑證、權益或學習進度寫入。

**尚未量測**：正式Supabase硬體、10k帳號HTTP端到端、Auth尖峰、Edge冷啟動、CDN、長期研究Worker、LINE真實10k收件者。不能將本表宣告成整個平台可服務10k付費會員。

建議下一隔離情境：10k帳號、每日2次登入、5分鐘晨間尖峰中10%帳號讀8個頁面（約26.7HTTP RPS），分別測30/100/300活動Session；每人活動不等於每人持續DB連線。驗收目標：一般讀取HTTP P95<500ms、錯誤率<0.5%；登入P95<1500ms、無越權；該目標尚未達正式量測證明。

### 成本與營運風險

官方來源查核於2026-10-13：

- [Supabase官方價目](https://supabase.com/pricing)：Pro由USD25/月起；10kMAU低於含100kMAU，但CPU、Egress與Function呼叫仍依實際需求。不能把起價當平台總費用，未確認現有Production方案／帳單。
- 10k人×22交易日×每天1則 = 220,000 LINE收件訊息，不是20個multicast請求只算20則。現Sender每批500、每輪claim1000、最多10輪，正常無錯的上界恰為10k；沒有剩餘容量餘裕，重試與timeout仍需隔離完整Outbox壓測，禁止直接改Dispatch。
- [LINE官方2026年11月調價公告](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/)：11/1起高用量NT1400、含6000則，加購前50k每則0.20、其後0.15。上述220k假設的新制估計NT36,000/月未稅（1400+10000+24600），不是目前實際帳单或現行10月份價格；亦非購買核准。
- Provider、Readdy、LLM與現有LINE方案／未稅成本尚待合法帳單證據，未承諾新付款。

### 容量審查矩陣

|層|已有證據|未完成／下一驗收|
|---|---|---|
|DB/index/RLS|上述真實隔離SQL、範圍主鍵查詢、跨帳號拒絕|Production EXPLAIN與方案資源、研究批次熱點仍待只讀量測|
|Auth/Entitlement|既有隔離GoTrue真登入及本次到期/Legacy SQL|正式Free/Premium E2E與隔離Auth負載|
|Edge/API|正式單次只讀頁面可用；隔離PostgREST50併發P95 43.909ms|正式Edge端到端峰值、429退避、冷啟動尚未量測|
|Cache/CDN|Vite分包，不能共用私人教材快取|正式Cache headers／命中率／私有回應cache隔離|
|Worker/Recovery|VNext Lease／Idempotency／immutable候選與隔離測試|未部署，自然恢復NOT_ENABLED|
|LINE|正式3人自然SENT；500batch/1000claim/10pass|10k隔離Outbox+transport/time budget量測；不發LINE|
|Webhook|付款停用|依Owner要求暫停，不新增測試或支付服務|
|Observability|pipeline/status/funnel/dispatch已有彙總|商業AM/PM採集器與連續5日不可偽造證據尚未接入|

## 五日穩定啟動前置

先修复并經Owner核准發布全部重大缺陷（含Today顯示、PR#239日曆、推薦資料Reader與受保護證據整合），正式Free/Premium權限驗收與自然VNext接線另具名核准。保留發佈SHA與時間，以現有正式台股日曆為准，AM08:15與PM15:40只讀記錄證據。現在沒有啟動Cron、沒有把10/13算成穩定日、沒有宣告COMMERCIAL_STABILITY_GATE PASS。

## 回復與公開界線

所有本輪變更仅為獨立UI／測試候選；不改Market Decision、正式推薦、Report、LINE、Provider／Atomic、Academy、Entry、Cockpit、Auth/RLS、Secrets或Cron。正式Free/Premium研究維持真實空狀態，等待授權與Owner逐筆審核。實際逐頁截图與最新CI狀態在交付證據包另列，不以Build PASS取代產品驗收。
