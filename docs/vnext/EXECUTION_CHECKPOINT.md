# VNext 執行 Checkpoint
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
