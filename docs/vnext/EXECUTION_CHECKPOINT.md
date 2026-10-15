# VNext 執行 Checkpoint

## 2026-10-15 核心交付發布順序相容補正（本節優先）

PR250維持精確4219c7c不變；C更新cf3b6b2只接收P0准入及解除兩個收據hash衝突，38Runtime與SQL不變。會員接收新C，保留原固定SHA區間快取及live逐次讀取，不能用C版覆蓋掉已通過的資源控制；不新增會員功能或改政策。新C和會員HEAD各自重新核對必要Integrity／CI，前序真實SQL、Auth、RLS、回復與Responsive證據因相同產品來源而保留；不重做五小時全站驗收。此為候選本機整合，不是Production Merge／Deploy／Migration或activation。

0dd5b1a的Validate作業真實記錄先socket accepting、隨後rejecting，測試尚未開始即exit1，根因是官方Postgres image在初始化期間的socket-only bootstrap重啟，不是Owner RLS失敗。Owner backend與同workflow另外兩個衍生Postgres隔離環境使用相同啟動模式；只將這三個區塊共六個pg_isready改為-h127.0.0.1，等待最後TCP server。保留每個30次上限、network none、原Fresh DB／Owner／Clock／RLS測試及所有其他步驟。新增精確整份workflow對照斷言，只容許這六處變動，不增加timeout／retry或跳過檢查，產品Runtime／Schema不變。新無網路／無公開埠Postgres17已實測TCP第二次就緒、原Owner SQL gate全部通過，僅合成身分，不是正式會員證據。

## 核心 P0 會員整合候選（2026-10-15，最新續跑點）

本候選在獨立Worktree接合PR230 a5c0ae5與C 9da487d；不是Merge main或Production發布。PR230與main原有4個衝突，與C合併時16個來源衝突，皆保留最新C／已發布B1、A、B2的實際產品來源。38個本機Runtime與唯一C SQL逐位元保持不變，資料見core-runtime-reference-20261015.json。舊PR230不得直接覆蓋C。

只新增不可變C來源保護、會員差異外層完整性檢查、獨立loopback測試埠，並更新三項已過時的A／LINE測試契約。所有原始拒絕控制、品質門檻及會員有效權益不變；沒有重做課程或研究算法。正式付款／方案頁沿用已發布A，價格不變，不整合Lemon Squeezy。

新的GoTrue／PostgreSQL／PostgREST一次性環境使用56832／56833，不停用既有55632／55633 Preview。真實本機Free 7章、Premium／Legacy 10章、Owner維持原權益；8併發政策防重、原權益逐位元保留、未知期限不變、JWT／metadata越權拒絕，Owner不能繞過品質／授權，撤回／到期／跨帳號控制通過。合成研究與SQL訂閱狀態僅供安全控制，不能宣稱真實股票研究或付款E2E。正式Free／Premium仍沒有合法驗收身分，保持PENDING。

正式唯讀觀察：Readdy674、Reader55、Sender71均未變；10/15自然LINE Expected3／Accepted3／SENT3，Failed／DeadLetter／Duplicate0，RetryKey／Payload／Canonical綁定一致；歷史Outbox108與logs197沒有新增或更新。平台接受不是個人送達／已讀。B2 monitor已結束。10:08正式Owner後台顯示市場、報告、LINE正常及11/11盤前資料，股票評估資料不足；今日正式Operational Acceptance整體結果尚未保存，不能自行視為PASS。

P0推薦缺口矩陣與Producer兩個已合併B1依賴的部署准入，獨立在PR250 4219c7c（9/9CI）；72檔Evaluated0／BLOCKED72，不用Actual代Consensus或股數代TWD。C仍Draft、未部署，Forward／Outcome0。Owner資料授權與29項發布仍不通過；沒有公開研究。

本整合候選最終HEAD需自己的Type／Lint／Build、Fresh DB／RLS、安全封存及CI，不沿用PR230或PR250的結果。沒有Production Merge、Migration、Deploy、Cron、Secret、正式LINE、付款或會員權益操作。整體商業READY=NO、穩定0/5。

ff1b239第一輪新增會員Gate遇ECR映像資料量限流，單次重跑後通過；兩個舊Gate在15分鐘上限取消，原因是完整性鏈重複讀取相同不可變Git區間。後續僅快取完整40位SHA區間的歷史差異清單並回傳陣列副本；所有live檔案／source／guard逐次重驗，工作樹diff不快取，拒絕main等可變ref。沒有移除測試或延長timeout。另以獨立真實Auth／SQL完成固定SDK2.115.0的V8 Handler功能等效回復status Smoke，三身分200、缺失／錯誤401、GET405、權益差異0；這不證明原V8實際SDK版本或正式activation安全，原正式版本仍不修改。

CPU profile顯示重複Git child-process與檔案開啟為主要成本。再將同一次view構造的重複outer admission合併，但每個公開gate返回前仍重新驗證live source；改成單次fresh porcelain-v2 status讀取實際HEAD與dirty／untracked路徑，只快取base..完整HEAD的不可變區間，逐次比較檔案bytes處理revert／delete，不快取工作樹結果。另與原兩個uncached Git命令做完全相同集合的反例檢查。這不是跨呼叫的live驗證快取；所有既有negative controls仍執行。Type／Lint／Build及Production Runtime38／SQL均不改，原ff1b239安全封存保留，新增修正另封存。

後續補足mode-only變更／刪除／新增／revert區分；unknown untracked inventory即使讀取時消失仍拒絕，不讓新路徑被過濾掉。Academy舊mock原先攔截六參數diff，已精確改攔fresh status，保留每次讀取次數、後續raw drift、callback mutation、歷史reader再用與unknown-path全部負向控制，不刪assert。會員候選固定SDK2.115.0；替代V8及新Handler都走真實本機Auth／SQL，沒有修改正式Auth或放寬JWT。首次本機service JWT時鐘落差只改用後端真實clock，不修改產品時效條件。


## Public Free Premium Release Candidate（2026-10-12，最新續跑點）

### 2026-10-15 C永久403容量修復同步

接收C49baeba，不重做研究算法或UI，沒有新衝突。舊版在真實隔離SQL的兩筆403控制只處理第一筆、cursor0；新C將精確SOURCE_ACCESS_RESTRICTED記錄為缺資料並前進，不繞過限制、不製造成功來源。184項事件／財務拒絕控制23次分片、每次8筆；429／503的持久化重試保持不變。唯一C SQL逐位元不變，38檔中僅C自身dailyRuntime新hash；會員候選全部繼承，不能重新封存舊Runtime。a88ec51已完成10/10CI及7檔安全封存作為上一有效checkpoint；新整合HEAD必須再核對自己的受影響測試與CI，不能借用舊HEAD通過。

### 2026-10-15 Runner shutdown受控診斷

正式版本與main未漂移。b2d729b最終9/10 CI通過，VNext兩次收到runner shutdown signal，並非測試斷言；GitHub當日無已公告Actions事故，不推定原因。以CI相同Node22.23.1重新執行原四檔，24項斷言全部通過、0skip、175182ms；這不同於此前其他組合30項的紀錄。取樣RSS約190–280MB，不足以證明OOM；本機/usr/bin/time因sandbox不允許sysctl取得完整資源統計而exit1，不把它冒充整個命令exit0。新增只讀CI觀測wrapper，每20秒記錄資源及signal，保留原測試／10分鐘timeout／實際退出碼，不自動重試、不輸出args或env；撤銷取消不會轉成成功。這是觀測缺口修正，不宣稱已證明GitHub關閉根因。

後段受控觀測補充：Node test worker曾到3939488KiB RSS，主機available memory降到約85MB，初期低RSS不是全程上限。完整樹觀測最多32個本程序後代，避免只量到約34MB的Node --test父程序；不讀取args／env。候選只為此完整性命令設定512MiB V8 old-space預算，讓GC有界；不增加CI時間、不刪測試，任何OOM／signal／非0退出仍失敗。實際是否排除Runner shutdown必須以新HEAD自己的CI與資源紀錄判斷，不能把macOS記憶體壓力當GitHub已證明的OOM。

同Node22＋512MiB的未修復控制已真實重現`Reached heap limit / JavaScript heap out of memory`，observer正確回傳1。根因定位到V1 integration負向測試：Node MockTracker把每次同步readFileSync返回的完整Buffer與execFileSync結果持續保留，並非產品live gate需要這些歷史；原assertions使用獨立sentinelReads／inventoryReads，未讀取mock history。修復僅在這兩個mock每次呼叫清除先前未使用的追蹤紀錄，保留當次真實讀取、所有漂移注入、所有原assertions與finally restore；新增callCount<=1控制。不是快取live驗證或刪除反例。需同512MiB完整原四檔PASS及新HEAD CI才能關閉此工程阻擋，GitHub主機的實際OOM仍以其可得紀錄區分。

全站3186項回歸的舊run38228577569於45分鐘上限取消；只把Validate有限預算改為60分鐘，完整保留所有測試、Fresh DB及main新聞回歸。精確Integrity逐位元比對限定此單一預算差異。停止本輪重複本機全量程序以免封存更新競態，不將取消視為PASS；先前27項受影響控制及Type/Lint/Build已PASS，完整驗收必須以最終HEAD的全套GitHub結果成立。

本輪全站CI發現4個舊測試接線不相容：Navbar新增共用股票觀察依賴，Academy封閉loader未接；Router已是具名候選，兩項反例仍預期「未修改基線」錯誤。僅載入真實共用navigation常數並驗證雙入口與手機關閉行為，更新Router漂移的精確拒絕訊息；不移除任何負向控制、不改產品或Academy權限。必須以此修正後HEAD重新完成CI，不沿用c5337ee或更早結果。

從84b62df、乾淨工作樹及9/9 CI續跑，origin/main仍2a5d461。唯讀確認正式get-report-payload V54、V2 forward V2、LINE V70、Report V248、News64／Orchestrator45，VNext Worker與schema均未部署。正式membership設定beta_full／billing disabled／trial14，不能擅自改免費與付費邊界。匿名公開摘要10/12 HTTP200與canonical身份驗證PASS，無私有VNext資料，僅保留指紋。

候選新增Public頁面、最小Router/Navbar/Account接線、會員focus/30秒清除重驗，以及20261012080628發布審核SQL候選。Owner審核與私有research分開，獨立registry、交易式approval／revocation、8併發防重、會員投影再檢查；舊29項不公開。詳細精確Manifest及尚存商業／權限／資料前提見MEMBER_RELEASE_MANIFEST.md。

最終逐項核對補齊Free基本歷史：獨立唯讀get_vnext_free_history_v1只讀原免費版次、已核准而且權利仍有效的摘要，最多100筆；不回Premium-only或Evidence。真實隔離Auth／SQL短效紀錄驗證到期分類、免費／Premium分離、撤回立即隱藏；舊會員RPC回應保持相容。Owner股票觀察頁提供正式權限判定後的審核入口。只修改未發布SQL候選與VNext UI／測試。

Owner審核狀態追加回歸：撤回版本不能再次顯示「可核准」；已到期但合法的歷史內容仍可撤回，明確標示僅供歷史查閱。已核准／尚待完成計數互斥；不改不可變發布契約或會員權益。

重用本機隔離Auth資料庫完成新SQL/RPC驗收；fresh完整Migration由最終CI驗證。四身份1440／375／390／430實測無overflow，private資料登出清除、reload正確、pageerror0。Preview http://127.0.0.1:3221/stocks；Owner審核 /vnext/publication；不是Production身分。截圖/private/tmp/ma-vnext-member-release-qa。原公開研究數仍0，Forward0／Outcome0。

Type/Lint/Build初次通過；最終Integrity與GitHub CI以新HEAD記錄。PR仍Draft。無Production write、Merge、Deploy、Migration、Cron、Secret、Auth/RLS或訂閱修改；Production Business不能用「本輪未寫入」冒充新前後全站資料指紋。MEMBER_PRODUCT_ENGINEERING=INCOMPLETE、PRODUCTION_RELEASE_READY=NO，正式三身份E2E與自然研究PENDING。

## Daily Production Wiring P1（2026-10-12，最新續跑點）

從d7606a7、Draft PR230、9/9起始CI續跑；main為2a5d461，已保留PR235新聞修復。本輪新增runtime SQL／RPC、日期驅動official adapter、vnext-daily-research-v1及既有V2worker僅2行非阻塞hook。具名範圍與未啟用限制見DAILY_PRODUCTION_WIRING.md，不再以重跑10/8作完成標準。

Fresh DB真實SQL＋PostgREST／HTTP Worker已通過216項證據不足控制、整批回滾、併發、lease fencing、防重、晚到預測與假Outcome拒絕、Owner／會員讀取隔離；合成控制不等同Production Auth／真實Forward。10/12真實官方HTTP驗證名錄61+11、2330當月7筆量價；完整plan1420，不宣稱整批每日自然驗收。

既有Preview3225可用；1440／375／390／430真實本機Auth回歸PASS，details收合／無overflow／Logout清除，截圖/private/tmp/ma-daily-qa-p1。Production操作0、Forward0、Outcome0、會員公開0。本轮未Merge／Deploy／Production Migration／Cron／Secret變更，最終HEAD需完整GitHub CI通過後才交付候選。

P1首次CI bede872：新增VNext SQL/HTTP及Auth Gate PASS。V2 Gate的5項Handler測試因封閉依賴載入器未識別新hook而於import失敗（UNEXPECTED_IMPORT）。修正只讓隔離harness載入真實hook，新增單獨enqueue計數、原Auth拒絕無enqueue及enqueue失敗不影響V2完成／Outcome；不刪既有測試、不改產品方法論。最終修正HEAD重新驗CI。

## Daily Stock Intelligence P0（2026-10-12，最新續跑點）

從9443a7c續跑；PR230 Draft，起始9CI PASS。nested工作樹原乾淨；外層舊repo未動。fetch後origin/main為2a5d461ec3d98bfc8bc3177a295c95e299b7bda2，候選原ahead22/behind5，未合併或rebase正式main。
新增隔離可執行pipeline、6-stage checkpoint、有界重試、不可變216筆鎖、到期648追蹤狀態及Owner每日研究首屏，詳DAILY_STOCK_INTELLIGENCE.md。不改研究假設、既有Entry三策略或品質門檻。
保存真實資料重播source805cfbb8未變：Short72=1/71/0；Medium72=28/44/0；Long72=0/0/72（合格/不符/不足）。216判斷＝29/115/72。取得日期與原cutoff保留，全部HISTORICAL_REPLAY，第二次ALREADY_COMPLETE。
這批缺同cutoff Canonical/V2 Entry capsule72檔，不借用其他日期。Entry整合216項不足反例為合成控制，不冒充真實判斷。Forward0、Outcome0、會員可見0。648追蹤＝360待到期／288未知，不是648績效樣本。
新增23個隔離控制（含同步enqueue/background失敗與實際鎖定檔完整性保護）；私有real replay/hash/防重PASS；沿用本機真實GoTrue/PostgREST：Owner200、Free/Premium/other403、anonymous401、direct-tier拒絕、logout refresh拒絕。沒有Production身份冒充。
Chrome全新隔離context實測1440/375/390/430無溢出，三期間數量正確、技術詳情收合、reload與logout PASS、product error0、外部network0。CUA request-header policy載入失敗，改用本機新context測試，不接Sony正式browser。截圖/private/tmp/ma-daily-qa-20261012；Preview http://127.0.0.1:3225/vnext/research。
Production只讀Function metadata：V2forward V2、Entry V3 ACTIVE；沒有VNext自然Worker。既有source acquisition是固定研究窗口，仍需正式逐日adapter、持久化transaction及Owner read接線。唯一下一manifest（未核准/未執行）列於新文件：private transactional migration、新vnext-daily-research-v1、既有V2worker非阻塞enqueue、新Owner read投影，Cron/正式業務不變。無新SQL或Function檔，不假裝它們已完成部署驗證。
正式保護檔案逐byte不變、Production writes/invocations0；沒有冒充新Production DB前後指紋。未Merge/Deploy/Migration/Cron/Secret/AuthRLS/會員公開。DAILY_STOCK_INTELLIGENCE_ENGINEERING=INCOMPLETE、NATURAL_FORWARD_EXECUTION=NOT_ENABLED、RESEARCH_ANALYSIS_VALUE=INSUFFICIENT_SAMPLE、PUBLIC_PRODUCT_APPROVAL=NO、SONY_USABILITY=PENDING。
最終Type/Lint/主Build/隔離Build/Integrity/完整scoped regression與GitHub CI須以本輪最終HEAD記錄，不沿用舊HEAD PASS。

5ba7176首次Push後CI沒有啟動：GitHub標示CONFLICTING/DIRTY。原因是main已發布PR235新聞修復也改了validate與三個完整性橋接檔。僅在Draft候選同步origin/main 2a5d461，不把PR230合併進main、不部署；新聞三個Production source與已發布seal逐byte保留。完整性鏈改為VNext→NewsReport→Academy，保留兩套全部負向控制；VNext基線升至2a5d461，validate保留main45分鐘與historical-clock測試，只保留原prebuild/TCP修正。舊日誌的ahead22/behind5是同步前狀態。

## 16 Research source/time closure（2026-10-11，最新續跑點）

續接83260adf31bc25193edef7c052c4fc2f02d67515；PR230 Draft、起始9CI PASS，origin/main fff51d76未變。未動外層工作樹。
原29研究／cutoff／funnel805cfbb8／review656dee43／admission14f5634b全部不变；不重抓211公告或重新評估引擎。16品質PASS／13PENDING／0FAIL，Forward0／Outcome0。
新增read-only publicationClearance來源用途／時間 dossier，逐來源列資料集、精確URL、使用角色、商用／衍生／再散布／顯名、相關開放資源及時間缺口。7個官方OGL資料集可依條款使用，但不是本批历史端點的自動授權；目前8個實際來源族群均仍待確認精確會員用途。Fugle未出現在本批，不列為這29項阻擋。
16項共有301筆證據引用：40筆公告時間存在／261筆原發布時間缺失。健策缺36筆，15中期各缺15筆。29項取得後PIT均PASS不等於原發布時間PASS。出表日／交易日／法定期限不得代填原發布時間。TimePASS0／Pending29，License0／29，OwnerReady0／Eligible0／Free0／Premium0。
私有source-time dossier hash67d8ab2bfb192f5c8fff37914f8947a5e64a1837c8f9fc1be07e28c9f81d03b4；只保存在/private/tmp/morning-alpha-vnext-member-admission-20261011，不提交原始量價／原文／個資。
Owner第一屏四指標品質16／時間0／授權0／可交Sony0；Desktop四欄、手機兩欄。逐股展開角色與缺少時間、精確授權查核連結；舊原文與後續獨立查核明確分開。品質篩選短1／中15，核准按鈕仍拒絕。1440／375／390／430實際innerWidth=scrollWidth，Console產品error0，截圖/private/tmp/ma-vnext-clearance-qa。
新增13項來源／時間／獨立准入控制，全scoped222PASS；Integrity16PASS；真實29私有auditPASS；Type-check/Lint/主Build/隔離BuildPASS。重用既有本機Supabase真實Auth：Owner200、未通過核准409，Free/Premium/other403、anonymous401、tier偽造與登出refresh拒絕。不是Production Owner E2E。
13項後續風險逐檔補正條件、7開放資料集精確對照、261時間缺口與Sony一次決策包見PUBLICATION_BLOCKERS.md最新章節。沒有新證據就不硬改品質結果；不是重複要求工程核准。Paid license是否必要仍未證明；未聯絡、購買或接受條款。自然更新候選有界／防重／不阻塞／不繼承核准不變，正式Runtime仍NOT_ENABLED。
依授權Commit/Push，最終GitHub CI必須綁定本輪HEAD。未Merge/Deploy/Migration/Cron/Secret/AuthRLS/會員公開；Production操作0，核心保護位元組不變，未宣稱做新Production DB指紋比對。PUBLIC_PRODUCT_APPROVAL=NO；SONY_USABILITY=PENDING。完整發布資格仍INCOMPLETE。

## Publication Blocker Closure candidate（2026-10-11，最新續跑點）

從b2ad239233c0873da0e01297b9178a2c8b5fed48原地續跑，PR230保持Draft，origin/main仍fff51d76；nested repo原工作樹乾淨，未觸碰外層既有修改。詳PUBLICATION_BLOCKERS.md與publication-review-20261011.json。
原29研究、cutoff、門檻、review656dee4368d7eb2dcffc697235ca8bf8eee69542acad1f578ca3300eab2227fd與funnel805cfbb8ae94f0bda75a43535ceb57d314b3f1aa7fed4af12cedc0f82bcf93c3均未改。Short1／Medium28／Long0、Forward0／Outcome0。
本輪後續已讀完保存索引211/211公告原文（27家公司），另核對1513／2049共四個官方窗口均無項目。先前13則checkpoint已被本節後續結果取代。正常MOPS UI查閱，無繞過限制；新查閱時間保留，不回填原研究。只保存集合指紋／收據時間／審查摘要，不存原文聯絡資料。集合逐公司對齊原事件發布時間與筆數。
獨立內容品質PASS16／FAIL0／PENDING13；Short1 PASS，Medium15 PASS／13PENDING。13項待補為1504、2308、2344、2357、2408、2618、2884、2886、2892、3037、3189、3231、3711，原因是已讀原文後的資本／融資／併購／資安／信用資產等風險或未披露資料，不再以未讀原文概括。
原發布時間PASS0／PENDING29，取得後PIT29通過；精確會員用途授權Approved0／PENDING29。Owner ready0／Publication0／Free0／Premium0。新admission離線hash14f5634b1cd8cc045085af58b3482ac94855149c7e91513703c6c259340f22c9。
Owner第一屏四類：可以核准／尚待補資料／使用權待確認／品質未通過；標明可重疊不相加，個股與技術details收合，核准按鈕不能繞過前置條件。PENDING非FAIL；內容查核與策略有效性、時間及授權不同。
既有隔離Supabase Auth：Owner read200／未完成核准409，Free/Premium/other private403、anonymous401、假client-tier拒絕、logout refresh拒絕，會員內容0。不是Sony Production E2E。未更動SQL、Function、Auth/RLS；本機Preview3223/vnext/research、3224/stocks、3222/stocks。
新增body-set完整性、錯索引、重複集合、未來查閱時間、空查詢錯誤與必要事件反例；admission/blocker51項PASS、真實29離線PASS（分類正確，不代表29全部可發布）。完整scoped213項含Integrity、本機Type／Lint／Build PASS；桌機1440及375/390/430實際寬度與scrollWidth相同、個股預設收合。最終9CI須綁定最後commit；不沿用17bd882的CI作後續HEAD證明。
Production操作0，正式保護碼不變；未重查線上DB，不冒充新Production指紋比較。未Merge／Deploy／Migration／Cron／Secret／會員公開。
剩餘不全是商業問題：13項需另版風險研究；29份原發布時間證明不可捏造；29份精確用途授權仍需Sony既有合約或授權方書面範圍。一次決策清單見PUBLICATION_BLOCKERS.md：先審既有TWSE/TPEx／實際資料授權，缺書面才決定如何詢問；尚未證明需新付費，未簽約／購買／聯繫外部。Owner單方核准不替代第三方權利。
PUBLICATION_BLOCKER_CLOSURE=INCOMPLETE；VNEXT_MEMBER_RELEASE_READY=NO；PUBLIC_PRODUCT_APPROVAL=NO。

## First Member Research Closure candidate（2026-10-11，最新續跑點）

eba0548 的VNext CI三項journal測試因Linux無/private/tmp而ENOENT，屬測試路徑錯誤。只將新測試mkdtemp根改為macOS/Linux皆有的/tmp，保留隔離前綴／權限／防重等全部assertions，重新seal並跑完整新HEAD CI。不把該失敗HEAD宣稱PASS。
最後候選檢查另補獨立審核結果runtime enum拒絕：UNKNOWN/空字串/null/undefined不能因TypeScript靜態型別而變成PASS。新增一項含4個反例，總26新控制／184scoped；真實29矩陣hash不變。最終CI以此修正HEAD為準，不沿用d82b4bb的結果。

從8c7e0c4續跑，PR230 Draft、原9CI PASS、origin/main fff51d76，工作樹原乾淨。詳FIRST_MEMBER_RESEARCH.md：新增獨立來源查核、七類阻擋矩陣、Owner前置檢查、只限loopback的append-only核准候選，以及讀取時重新驗證用途／撤回／效期的會員白名單投影。沒有改選股引擎、正式策略或SQL。
真實29項：9機械查核每項PASS（261），2独立事件／方法審核每項待補（58）；完整品質PASS0、明確FAIL0、待補29。取得時間PIT29通過；原發布時間29待補；用途授權29待確認；Owner ready0／Approved0／Free0／Premium0。原始再散布限制與自行分析用途分開，不把所有缺項叫研究失敗。
原funnel805cfbb8未改；新review656dee43、admission4cfa4fb5，固定時間08:13:04Z；私有目錄/private/tmp/morning-alpha-vnext-member-admission-20261011，舊資料不覆寫。3653相對大盤+6.31pp與成交金額1.53倍獨立重算PASS，不是機率。28中期保留逐公司證據／反證與累計財報口徑。
新25項合成安全控制（授權正向只是synthetic），總scoped183PASS；29真實離線PASS。本機現有GoTrue/PostgREST真實隔離身分與Owner/Free/Premium/anonymous、伺服器拒絕核准／logout驗證PASS，不冒充Sony Production。Owner桌機1440與375/390/430無溢出，全部卡片可讀，技術細節收合；截圖/private/tmp/ma-vnext-admission-qa。Preview仍3223研究／3224 Free／3222 Premium。
下一發布阻擋：精確資源用途證明、原發布時間證明、公司事件內文與獨立方法文件、Sony逐筆核准、正式transaction approval/published projection adapter。現有SQL候選不含新審核hash鏈，不能盲目部署；唯一下一manifest設計見新文件，尚未新增Migration。Natural Runtime未啟用，Forward0／Outcome0。Production0操作；正式保護檔案位元組不變。
本輪Type/Lint/Build已PASS，最後Integrity及9CI以本次最終HEAD為準。PR維持Draft；不Merge、Deploy、Migration、Cron、Secret、Auth/RLS或會員公開。FIRST_MEMBER_RESEARCH_ENGINEERING=INCOMPLETE、FIRST_PUBLISHABLE_RESEARCH=INCOMPLETE、VNEXT_MEMBER_RELEASE_READY=NO；不是候選工程測試通過即可公開。

## First Publishable Research P0（2026-10-11，最新續跑點）

從e7eb499e續跑，PR230 Draft、原9CI PASS、工作樹乾淨。原216筆研究snapshot仍805cfbb8ae94f0bda75a43535ceb57d314b3f1aa7fed4af12cedc0f82bcf93c3，沒有改探索方法或正式推薦。新增29筆不可變Quality/用途授權/時間審查；短1、中28、長0。完整公開品質0、用途未確認29、時間待補29、公開核准0；Free/Premium真實可見0。不是股票沒有價值，而是未具備可公開證明。
私有固定06:51:33Z審查hash42007620154ca26707fcaf8c8f38d8be02472a0ec7755a147430cba49aad13aa，存放/private/tmp/morning-alpha-vnext-first-publication-20261011；原始快取與歷史鎖未修改。詳FIRST_PUBLICATION_REVIEW.md逐公司清單與具體剩餘清單。
3653雙來源相對表現、法人分歧與注意交易待查分開呈現。28家公司依自己的營收、法人和同期累計財報顯示反證，不將YTD當單季EPS。公告只有索引；官方MOPS入口實際回覆存取限制，未繞過、未假裝完成內文查核。
Owner Preview http://127.0.0.1:3223/vnext/research 新增「值得研究／還不能公開／已核准會員內容」。會員Preview仍3224/stocks（Free）、3222/stocks（Premium），真實空狀態。技術詳細資料收合，全部28中期卡可逐批查看。
新增25項synthetic protocol controls與私有29筆real offline audit PASS；本機既有Supabase真實Auth owner/free/premium/other驗證新reviewpayload boundary、DB空投影、direct-tier拒絕與logout PASS。不冒充Production E2E。Desktop1440與Mobile375/390/430已實際檢查無橫向溢出，來源展開亦無溢出。乾淨Owner登入→登出→Reload拒絕、Free/Premium三期間真實空狀態PASS；截圖/private/tmp/ma-vnext-first-review-qa。最終Type/Lint/Build/Integrity及9CI以本次HEAD為準。
新增審查投影只接受可信server policy，研究hash與審查hash雙綁定；真實未核准，正向路徑只有清楚標記的合成控制。自然更新僅有界append-only計畫，不啟用排程，不繼承前一公開核准；Forward0/Outcome0。無新SQL、Function、Auth/RLS、Secret、Cron或Production操作。
FIRST_PUBLISHABLE_RESEARCH=INCOMPLETE；VNEXT_MEMBER_RELEASE_READY=NO；SONY_USABILITY=PENDING；PUBLIC_PRODUCT_APPROVAL=NO。

## Real Stock Research P0（2026-10-11，最新續跑點）

從5dfcb9f續接，PR230 Draft，origin/main fff51d76，原9CI PASS、working tree乾淨。細節與缺口見REAL_STOCK_RESEARCH.md。本輪不重做已PASS Academy／Entry／Cockpit／既有會員架構。
新增官方歷史營收37月份窗口、法人20日、財報及現金流10期、事件2月份。私有最小快取不進Git：stock `/private/tmp/morning-alpha-vnext-real-stock-20261011`，context `/private/tmp/morning-alpha-vnext-stock-context-20261011`。最後snapshot hash見真實離線測試。
短期72=1合格+71不符；中期72=28合格+44不符；長期72全不足；沿用既有未Promotion研究假設，不改參數。29筆觀察全部尚不能公開（授權、原發布時間、方法品質及逐筆核准）。Free/Premium真實公開0，Forward0/Outcome0。最新月份不同：9月58檔，其餘14檔8月；各自最新往回36月72/72，不冒充9月完整。
本輪修復官方舊路徑404、事件必要日期參數、金融負淨營收整批誤拒、累計財報口徑映射。28筆同比基期不適用保留null，不當抓取失敗；HTTP失敗0。長期可比較單季EPS、Capex、估值／需求／競爭優勢與事件內容審核仍不足，不捏造。
Owner Preview沿用http://127.0.0.1:3223/vnext/research；Free/Premium真實空內容預覽可用/stocks。以既有本機Supabase Auth/PostgREST驗證owner/free/premium/other、Owner-only、直接API提高tier拒絕及Logout；本次有傳入實際新funnel核對hash。非Production身份。
Owner實機：1440/768/430/390/375無水平溢出，技術details預設收合，可展開來源；三期間數量與支持／反對內容核對、登出即清除私有資料、Console error/warn=0。截圖/private/tmp/ma-vnext-real-stock-qa。Sony usability仍PENDING。
候選新增16項合成negative controls及獨立私有真實離線測試；舊history/sources hash未變，新事實回灌舊cutoff=0。最終工程與9項GitHub Gate以新HEAD為準，不沿用旧結果。
Production操作0、業務程式逐byte受Integrity保護；本輪未重新擷取Production DB指紋。未Merge／Deploy／Migration／Cron／Secret／Auth/RLS／會員公開。自然研究只有有界、不可變、防重且不阻塞Core的純計畫；正式caller/outcome均未啟用。

2026-10-10 Asia/Taipei。
Branch feat/morning-alpha-vnext-integration；基線fff51d76a8e6c90768772023c37afbb112761a3a。
完整讀取Master0–22；已重新核對PR103/225、dirtytree、remote、schema和Functionmetadata。
已完成：獨立候選contracts/engine/PIT/publication/relations/cohortcompare；private schema+RLS+readRPC候選；四入口UI；隔離Auth驗證工具。
已測：vnextContracts + vnextValidation原30/30 PASS；最終加入歷史分類negative control後為31項，必須以本HEAD測試結果確認。Deno核心三檔型別檢查PASS。
隔離SQL：本機Supabase Auth/PostgREST +新candidate schema已套用並通過17組檢查（Owner/free/premium/other登入、匿名拒絕、RLS、偽造JWT、metadata無法提升、不可變/重複、授權撤銷、hash/audience fail-closed、實際PostgreSQL JSON前端解析、Owner產業研究不外露、Outcome append-only修訂與週期邊界、歷史/過期projection）。這不是Sony正式身分或Production驗證。
2026-10-10 15:00本機可用性：iCloud下載已請求；node_modules以既有lockfile、offline、ignore-scripts重建完成（版本不變）。Git受dataless commit-graph阻擋；本輪指令以core.commitGraph=false避開效能快取，工作樹只有具名候選新增與Integrity successor橋接。
iCloud既有source與research已恢復，未改寫原始碼。Type-check、Lint、Build本機PASS；本輪保留core.commitGraph=false指令級繞開dataless可選快取，未改Git設定。
Preview：http://127.0.0.1:3220/vnext，僅loopback，所有資料明確標示SYNTHETIC。Codex IAB實測Owner三週期、事件兩次更新合為一件、UNKNOWN公司關係；免費只讀核准SHORT，Premium只讀核准SHORT/MEDIUM，未核准LONG及Industry拒絕；登出清除，Reload保留合法Session。375/390/430/768/1440 DOM量測無水平溢出，桌機及手機截圖已檢查；鍵盤可展開來源；Academy入口實際重用既有Premium10章頁面。沒有重做Academy教材。
修復真實整合問題：PostgreSQL六位微秒時間戳被前端嚴格三位解析器誤拒；僅read projection驗證相容格式且保留原始值，不放寬研究PIT時間規則。三種週期的示範條件各自使用對應證據，不用同一量價故事代替。
最終稽核補強：Owner卡片保留歷史／事前研究分類、原始資料時間與建立時間，過期狀態由唯讀projection如實呈現，不修改鎖定結果；會員解析器也拒絕Historical Replay。新增真實DB rollback驗證歷史分類與過期狀態，避免Owner把重播誤認成當前觀察。
Draft PR #230：https://github.com/sonytzeng/morning-alpha/pull/230。首次HEAD1747855：8個獨立Gate PASS；Validate release的2942項測試中3項舊Integrity銜接失敗。已逐項修正具名successor校驗、原始位元組測試與新增檔案inventory，未刪除檢查或更改受保護商業碼；最新HEAD必須重新取得CI，不能沿用首次結果。
下一步：依本文件與git status核對最新HEAD、sealed manifest、最新PR checks；若CI普通回歸則修候選，不Merge或部署。最終遠端CI證據以PR #230最新HEAD的Checks為準。
不重做：Academy原創教材/PDF、PR225會員架構、PR229導覽驗收。
Hard stops：禁止merge/deploy/productionmigration/secret/cron/officialstrategy/unauthorizedpublicdata。
External gaps：無ProductionOwner目前session證據；正式Free/Premium帳號未提供；缺250D/PITUniverse/action/execution/rightsclearance；PR103未合併。
Production Migration/部署/合併/會員公開/正式推薦/LINE/Cron均未執行。Outcome正式producer與自然資料取得尚未啟用；MEASURED outcome在DB拒絕，不能用字串聲稱已成交。
新的Integrity successor只接受列名檔案及SHA，驗證全部實際baseline後才提供舊Academy gate的歷史view。只快取immutable Git blob；live baseline與candidate每次重讀；縮減重複全樹掃描不省略實際檢查。
CI預算修復：run38035354393/job114164533153於20m14s被取消；GitHub annotation明確為「exceeded the maximum execution time of 20m0s」，當時已进入後續隔離PostgreSQL測試。只將原Validate工作timeout從20延長至40分鐘，新增逐byte測試證明其餘steps、permissions、觸發條件完全不變。不刪測試、不降低門檻。Academy官方映像Registry限流經有界重試恢復PASS。最終HEAD仍須完整重跑。
本機完整回歸的38項loopback測試被sandbox listen EPERM阻擋；使用合法本機綁定復驗相關3檔48/48 PASS。舊完整run為避免混合版本已停止，不能宣稱單次全量PASS；完整證據以最後HEAD GitHub Validate為準。
本頁是可恢復進度，不是Production完成證明。Draft候選可供CI檢查，但Release A/B/C均不得據此發布。CONSOLE修正熱更新dispose後乾淨頁面0 error/0 warning；API正反HTTP由17組隔離套件驗證，瀏覽器不匯出Token或原始流量。

## Release B 真實資料續跑（2026-10-10）
核對原HEAD9f993568與PR230 Draft、9項CI成功；原成果保留，不重做Academy或原Schema。
本輪新增細節見RELEASE_B_REAL_EVIDENCE.md。兩日私有最小膠囊先審核hash與敏感欄位，原截止20D72/72；後來官方快取20/60/120D72/72但拒絕回灌原截止，250D0/72。
432項三期間研究全部資料不足，沒有製造合格標的；能閱讀真實量價、法人股數、月營收與報表EPS，尚缺原發布／首次取得等時間、事件內文與中長期證據。EPS單季／累計口徑未知，未代猜。
Preview更新為http://127.0.0.1:3220/vnext/research（Owner-only、真實保存歷史）；舊/vnext保留明確合成的原候選驗收頁。
Owner/free/premium/other使用真正本機Supabase Auth；真實研究僅Owner ALLOW，其他全部DENY，query role與偽造JWT也拒絕。Production Owner仍PENDING，不能混稱。
Browser已實測10/7、10/8、三期間、9/12事件、公司關係未知、搜尋排序、details收合／展開、登入／登出、375/390/430/768/1440無水平溢出。PDF/Academy既有PASS工作未重做。
本輪18項新增unit/negative，加原31核心契約；私有真實replay不進公開CI。僅更新白名單與精確SHA successor，必須以最終候選再跑Integrity/Type-check/Lint/Build/GitHub CI。
原唯一Migration內容未變、新Function=0；不Merge/Deploy/Production寫入。Forward/Outcome=0、Analysis Value=INSUFFICIENT_SAMPLE。

## Evidence Foundation P0（2026-10-10）
續接ebcbb4a；原PR230 Draft9項CI成功，workingtree乾淨。新增官方250日資料與來源候選，詳EVIDENCE_FOUNDATION.md。
快取：/private/tmp/morning-alpha-vnext-foundation-20261010（0700）；真實資料不進Git/CI/Readdy。上市61、上櫃11，初次620個量價GET含2次有界重試、重用486舊快取。重播快取618 hits／486 reuse／0 requests。
市場250日71/72；2884 2025-11-05官方停牌OHLC缺失，保留249/250。額外原官方9/24紀錄作warmup後，250筆真實成交日觀測72/72；不混用兩種coverage。
81筆除權息、6類官方來源成功；完整權益未證明，adjusted returns禁用。當期月營收/EPS各72；重訊來源6+4筆，本72檔當期命中0，不能宣稱完整歷史事件。
1條已核對關係3653→2330（2025supplier award），來源為官方公司網頁工具人工核對+TWSE英文名驗證，不聲稱現在訂單/產品/獲利。自動GET403如實記錄，沒有繞過。
歷史兩日原snapshot不變，新資料舊cutoff admissible=[0,0]。Forward=0、Outcome=0。純daily incremental planner，不新增排程或Production caller。
Owner摘要重用真實隔離Supabase Auth，非Owner/偽造/跨來源/寫入拒絕；Browser Owner讀取PASS，375/390/430/768/1440無overflow、技術預設收合、登出立即清除、0consoleerrors。這不是Sony正式Owner驗收。
本輪本機iCloud產生17個node_modules/@types/* 2空目錄，僅rmdir已確認空目錄後Type-check/Lint/Build恢復；依賴與lockfile未改。
Owner Preview仍http://127.0.0.1:3220/vnext/research，MA_VNEXT_FOUNDATION_DIR啟用新摘要；既有DB指紋核對後重用，不重做Migration。
原RLS/Migration/Function/Production router不變。本輪新增16項unitnegative及私有offline real audit；最終CI須取本次HEAD，不沿用舊9項PASS。

## Member Experience V1（2026-10-10）
續接2af00e1094304a6f8c624ea93ccffe8b4b56238b；起始branch乾淨、PR230 Draft、9項GitHub Gate成功。沒有重做Engine／資料取得／Academy／Entry／Cockpit。
新增範圍及唯一未執行Release Manifest見MEMBER_EXPERIENCE.md。仍使用原唯一候選migration，擴充11個私有RLS表及會員最小projection／個人watch RPC；沒有套用Production或修改既有Auth/RLS。
新Fresh DB本機Postgres17＋真正Supabase Auth＋PostgREST：原17項驗證及會員13組契約PASS。新增每日固定3檔、metadata／query／direct API否決、跨帳號清單隔離／重登持久化、降級、撤回、事件revision鎖定與過期歷史負向測試。合成測試結果不代表投資價值或Production身分驗收。
瀏覽器：本機Free只見3檔且無Premium details DOM；切換中期無合格資料如實空狀態。Premium短4／中1／長1（全為具名示範資料），完整支持／反對／事件／直接關係可展開；歷史1筆到期示範只顯示尚未成熟，不顯示報酬。清單加入→Reload→登出→重登保留；另一Owner帳號清單0，無跨帳號洩漏。匿名／登出顯示登入入口，私人卡片清除。URL tier=premium 無法提升Free。
Desktop/Mobile共用導覽與Account入口點擊PASS。Free與Premium各於375／390／430／768／1440實際量測innerWidth等於指定寬度，document scrollWidth一致、水平溢出0；Premium details預設收合。修正驗收工具只對當前選中頁生效的視窗設定後重新截圖，未將手機截圖冒充桌機。乾淨Premium頁console error=0。
Preview：Free http://127.0.0.1:3221/stocks；Premium http://127.0.0.1:3222/stocks；Owner私有研究 http://127.0.0.1:3220/vnext/research。不同origin隔離本機Session，頁首永久標示測試公司／非真實行情。截圖在/private/tmp/ma-vnext-member-qa/{free,premium}-{desktop,mobile}.png，不含憑證／會員資料。
市場摘要只解析既有canonical envelope；保存10/2真實契約單元驗證保留原report日期。隔離站沒有Production Core連線，顯示「未取得」而不是假市場判斷。
目前可公開真實研究仍0筆：再散布權利／逐筆審查未核准。既有真實250日缺口與Forward=0／Outcome=0不變。正向合成UI fixtures只證明產品流程與隔離安全，不會进入正式會員資料。
本輪新增15項member unit／negative，加原66項為81項PASS；原與新Integrity共15項PASS。Type-check／Lint／主bundle及獨立candidate bundle已通過，最終封存後重驗。CI必須以本次最終HEAD為準，不沿用起始9項PASS。
正式Router/Navbar/Account未改，會員导航只存在候選；未Merge／未Deploy／未執行Production Migration／未公開會員。Production Decision／Recommendation／Report／LINE受保護位元組未變，Production業務寫入0；本輪沒有以新的線上DB指紋冒充比較證據。
VNEXT_MEMBER_PRODUCTION=NOT_DEPLOYED；SONY_USABILITY=PENDING；PUBLIC_PRODUCT_APPROVAL=NO。

## Research & Publication P0（2026-10-11）
續接aae3b490551e2ce99e7bd08b7f64be7ca7077cf0，PR230 Draft、9項CI成功、工作樹乾淨、origin/main仍fff51d76。
研究與公開審查已分離；新細節見RESEARCH_PUBLICATION_FUNNEL.md。保留V1原契約、DB admission及歷史鎖。新增未Promotion的VNEXT_OBSERVATION_HYPOTHESIS_2.0.0：短期原始成交參與／當日形狀、中期營收／法人連續性、長期財務／公司證據。不是Recommendation V2或策略有效性證明。
真實資料hash不變、離線讀取0網路。10/8行情、10/10實際取得截止：短期掃描72／評估72／符合1／不符71／不足0；中長期各掃描72／評估0／不足72。短期符合1仍因用途授權、發布時間與研究／逐筆公開審核被擋。Free/Premium真實公開0，不建立假approval。
舊TWSE快取session_scope缺值只在精確官方STOCK_DAY＋symbol＋month映射，無原始資料修改。未知published_at仍null；只允許after-receipt觀察、不回填歷史。舊10/7與10/8鎖不改，Forward0／Outcome0。
新的用途授權候選區分原始行情、官方事實與自行分析；衍生許可不等於raw許可，raw許可也不推定衍生；實際權利未知仍拒絕。現有DB V1 policy未自動改成V2，日後需精確整合Manifest及重新安全驗證。
Owner Preview沿用http://127.0.0.1:3223/vnext/research，新增中文漏斗；既有會員頁面/正式Router不變。這是隔離真實Auth驗收，不是Production Owner或會員E2E。
最終HEAD須重新通過CI；本輪不Merge/Deploy/Migration/Cron/Secret/Production寫入。Production受保護原碼全部逐byte Integrity核對。
RESEARCH_FUNNEL/PUBLICATION_FUNNEL是候選診斷Gate；VNEXT_MEMBER_RELEASE_READY=NO，PUBLIC_PRODUCT_APPROVAL=NO。

## Member Publication Readiness P0（2026-10-10～11）
續接6ddff21058ae59bd83ecbaf0ba51211d195b0f1f；起始PR230 Draft、9項CI成功、工作樹乾淨。本輪未修改SQL或Production。
新增離線來源授權及公開準備審查，詳MEMBER_PUBLICATION_READINESS.md與DATA_LICENSE_AUDIT.md。六個官方OGL資料集精確綁定資源/API，而非全站授權；歷史行情查詢、Fugle契約及公司官網再散布仍未釐清。沒有採購或自行接受新契約。
既有history/sources hash不變，72×3=216份真實清單，三期間evidence_ready=0、member_eligible=0。缺時間保留null，單期營收/EPS不冒充趨勢或Consensus；查詢新增資料不回填舊截止。Forward/Outcome均0。
新增9項negative/unit及私有real audit，原Publication Gate、candidate migration與既有core受保護內容未變。隔離append-only撤回示範approval，會員不再看到合成正向測試股票。最終檢查補入非必要EPS／營收背景的授權與時間稽核，未知網址不能成為可點擊連結。
新的Preview http://127.0.0.1:3223/stocks 與 /vnext/research；重用原隔離Auth/DB，不重做Production Migration。本機真實Free/Premium/Owner登入、非Owner拒絕、Logout清除、Reload拒絕、1440/768/430/390/375無溢出PASS；不是正式會員E2E。
自然更新只驗證現有bounded incremental planner：Core未完就延後、固定cursor、單併發、timeout/retry有界。Production沒有VNext Caller，NATURAL_UPDATE_RUNTIME=NOT_ENABLED。
本輪普通工程驗證完成後依授權Commit/Push；PR維持Draft，最終CI結果以新HEAD Checks為準。禁止Merge/Deploy/ProductionMigration/會員公開；VNEXT_MEMBER_RELEASE_READY=NO、PUBLIC_PRODUCT_APPROVAL=NO。

## Real Stock P0 最終 CI 競爭修復
44c3c363 的八項 Gate 通過，Validate run38104636136 的3048項公開測試僅1失敗：dedicated Auth Integrity讀取auto-imports.d.ts時得到0 bytes，預期2276 bytes。實際路徑為beginnerOwnerE2EContract匯入networkObserver.test，在缺out時啟動Vite Build；AutoImport使用非原子writeFile重寫dts，與平行全樹Integrity競爭。不是研究或Production原碼變更。
只把既有Validate Build移到test:public之前；不增刪Gate、不放寬Integrity、不改產品Vite設定。精確baseline測試核對只有原預算變更與此步驟重排，原commands多重集合相同。最終修復HEAD重新跑九項CI，不將44c3失敗宣稱PASS。

f776292 的公開測試與incident captures已全部通過；run38106378293在後續Owner隔離Postgres啟動探測失敗（socket accepting→rejecting），與Cockpit run38106378329第一次socket accepting→no response同型。Cockpit同HEAD有界重跑PASS，但不把暫態重跑當永久修復。
官方docker-library/postgres/docker-entrypoint.sh的docker_temp_server_start設定listen_addresses=''，初始化暫用伺服器只有Unix socket；初始化完成即stop，再啟動正式伺服器。因此只將上述兩個已證實受影響CI的docker exec pg_isready指定-h 127.0.0.1，仍在--network none容器內，不開host port、不改Auth、不改SQL／帳務。Validate六處與Cockpit兩處精確替換，新增byte-exact negative guard，不增刪任何既有測試。
來源：https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh 。最終HEAD重新執行Gate；Production仍0操作。
# 2026-10-13 會員政策／付款 P0

從 `da6bb56` 續跑；PR230仍Draft，origin/main=`2a5d461`。正式只讀確認2帳號、1Owner永久、1非Owner active profile無期限且無canonical；payment disabled、billing events0、provider/customer/subscription綁定0。沒有可驗證Merchant/Checkout/簽章Webhook；Stripe SDK不等於接線。member-access V8來源與main相同。

新增 `20261013045054_membership_legacy_policy_candidate.sql`，安裝不生效；另核准activation才採DB現在時間、不可變快照、保留既有權益，新會員Free。新member-access只換service-only activation RPC及policy receipt，Auth/resolver不改。未執行Production SQL。四SQL／三Function精確候選與回復見 `MEMBER_RELEASE_MANIFEST.md`；完整稽核／決策見 `MEMBERSHIP_PAYMENT_READINESS.md`。

真實本機GoTrue+PostgREST+FreshDB驗證：八併發防重、未知期限保留、原期限／永久／trial不漂移、metadata拒絕、Free7章與完整10章、VNext一致且未核准研究不可見、Logout/relogin。付款狀態只有既有SQL控制測試，Provider Sandbox/簽章/退款仍PENDING，不能宣告正式收款可用。

隔離Preview `http://127.0.0.1:3225/membership`，另`/pricing`、`/stocks`；五身份1440/375/390/430截圖 `/private/tmp/ma-membership-policy-qa`。會員卡、登入及方案copy不再承諾自動14日試用。沒有新正式價格、權益縮期、Secrets、Cron或付款服務。

原 Analysis CI run38237299118 在相同HEAD同條件有限重跑一次仍20min超時；40個已完成斷言PASS，單個歷史完整性檢查716082ms。候選僅budget改40min，所有測試原樣保留；新HEAD實際CI以PR Checks為準，不沿用取消結果。

最後交叉檢查補正：既有get-report-payload呼叫ensure_member_entitlement_v1，unknown config=free會落入舊Beta分支。相同候選SQL將舊實作原文移private，保留v1同名同權限wrapper導向v2；Report Function檔案不改、不增加部署。測試兩入口生效前後、8併發與新Free，避免只驗會員頁漏掉報告路徑。

不要重開其他已結案工程或心跳。下一步是最新HEAD CI、精確Manifest與既有付款商合法測試設定；Merge/Production部署/切換仍須具名核准。29項舊研究未公開，Forward0、Outcome0。
# 2026-10-15 staged receipt view correction

After the six TCP-only isolated PostgreSQL readiness changes, CI correctly
detected that the staged receipt test compared live VNext workflow bytes with
the older staged receipt. The admission implementation was already restoring
and validating the exact predecessor. The test now uses that same admitted
predecessor for the historical comparison, retains live admission and all
tamper-denial checks, and adds an explicit newer-workflow tamper negative
control. No product runtime, SQL, permission, threshold or timeout changed.
