# VNext 執行 Checkpoint
2026-10-10 Asia/Taipei。
Branch feat/morning-alpha-vnext-integration；基線fff51d76a8e6c90768772023c37afbb112761a3a。
完整讀取Master0–22；已重新核對PR103/225、dirtytree、remote、schema和Functionmetadata。
已完成：獨立候選contracts/engine/PIT/publication/relations/cohortcompare；private schema+RLS+readRPC候選；四入口UI；隔離Auth驗證工具。
已測：vnextContracts + vnextValidation 30/30 PASS；Deno核心三檔型別檢查PASS。
隔離SQL：本機Supabase Auth/PostgREST +新candidate schema已套用並通過16組檢查（Owner/free/premium/other登入、匿名拒絕、RLS、偽造JWT、metadata無法提升、不可變/重複、授權撤銷、hash/audience fail-closed、實際PostgreSQL JSON前端解析、Owner產業研究不外露、Outcome append-only修訂與週期邊界）。這不是Sony正式身分或Production驗證。
2026-10-10 15:00本機可用性：iCloud下載已請求；node_modules以既有lockfile、offline、ignore-scripts重建完成（版本不變）。Git受dataless commit-graph阻擋；本輪指令以core.commitGraph=false避開效能快取，工作樹只有具名候選新增與Integrity successor橋接。
iCloud既有source與research已恢復，未改寫原始碼。Type-check、Lint、Build本機PASS；本輪保留core.commitGraph=false指令級繞開dataless可選快取，未改Git設定。
Preview：http://127.0.0.1:3220/vnext，僅loopback，所有資料明確標示SYNTHETIC。Codex IAB實測Owner三週期、事件兩次更新合為一件、UNKNOWN公司關係；免費只讀核准SHORT，Premium只讀核准SHORT/MEDIUM，未核准LONG及Industry拒絕；登出清除，Reload保留合法Session。375/390/430/768/1440 DOM量測無水平溢出，桌機及手機截圖已檢查；鍵盤可展開來源；Academy入口實際重用既有Premium10章頁面。沒有重做Academy教材。
修復真實整合問題：PostgreSQL六位微秒時間戳被前端嚴格三位解析器誤拒；僅read projection驗證相容格式且保留原始值，不放寬研究PIT時間規則。三種週期的示範條件各自使用對應證據，不用同一量價故事代替。
Draft PR #230：https://github.com/sonytzeng/morning-alpha/pull/230。首次HEAD1747855：8個獨立Gate PASS；Validate release的2942項測試中3項舊Integrity銜接失敗。已逐項修正具名successor校驗、原始位元組測試與新增檔案inventory，未刪除檢查或更改受保護商業碼；最新HEAD必須重新取得CI，不能沿用首次結果。
下一步：依本文件與git status核對最新HEAD、sealed manifest、最新PR checks；若CI普通回歸則修候選，不Merge或部署。最終遠端CI證據以PR #230最新HEAD的Checks為準。
不重做：Academy原創教材/PDF、PR225會員架構、PR229導覽驗收。
Hard stops：禁止merge/deploy/productionmigration/secret/cron/officialstrategy/unauthorizedpublicdata。
External gaps：無ProductionOwner目前session證據；正式Free/Premium帳號未提供；缺250D/PITUniverse/action/execution/rightsclearance；PR103未合併。
Production Migration/部署/合併/會員公開/正式推薦/LINE/Cron均未執行。Outcome正式producer與自然資料取得尚未啟用；MEASURED outcome在DB拒絕，不能用字串聲稱已成交。
新的Integrity successor只接受列名檔案及SHA，驗證全部實際baseline後才提供舊Academy gate的歷史view。只快取immutable Git blob；live baseline與candidate每次重讀；縮減重複全樹掃描不省略實際檢查。
本頁是可恢復進度，不是Production完成證明。Draft候選可供CI檢查，但Release A/B/C均不得據此發布。CONSOLE須以修正熱更新dispose後的乾淨頁面為準；API正反HTTP由16組隔離套件驗證，瀏覽器不匯出Token或原始流量。
