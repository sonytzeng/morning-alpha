# VNext 執行 Checkpoint
2026-10-10 Asia/Taipei。
Branch feat/morning-alpha-vnext-integration；基線fff51d76a8e6c90768772023c37afbb112761a3a。
完整讀取Master0–22；已重新核對PR103/225、dirtytree、remote、schema和Functionmetadata。
已完成：獨立候選contracts/engine/PIT/publication/relations/cohortcompare；private schema+RLS+readRPC候選；四入口UI；隔離Auth驗證工具。
已測：vnextContracts + vnextValidation 28/28 PASS；Deno核心三檔型別檢查PASS。
隔離SQL：本機Supabase Auth/PostgREST +新candidate schema已套用並通過13組檢查（Owner/free/premium/other登入、匿名拒絕、RLS、偽造JWT、metadata無法提升、不可變/重複、授權撤銷、hash/audience fail-closed）。這不是Sony正式身分或Production驗證。
2026-10-10 15:00本機可用性：iCloud下載已請求；node_modules以既有lockfile、offline、ignore-scripts重建完成（版本不變）。Git受dataless commit-graph阻擋；本輪指令以core.commitGraph=false避開效能快取，工作樹只有具名候選新增與Integrity successor橋接。
仍有6個既有src檔案與部分研究/設定檔未materialize，完整typecheck/Integrity/Build尚未可用；不得視為PASS。沒有刪除或重寫这些原始碼。
Preview僅綁定127.0.0.1:3220/vnext，合成資料明確標示；頁面實機載入及Responsive仍待驗。只有實際DOM/截圖通過才標Preview可用。
下一步：完成 isolated migration/Auth/negative tests；完善UI binding；Responsive/console/network；fulltests/integrity/typecheck/lint/build；commitpushDraftPR/最新CI。
不重做：Academy原創教材/PDF、PR225會員架構、PR229導覽驗收。
Hard stops：禁止merge/deploy/productionmigration/secret/cron/officialstrategy/unauthorizedpublicdata。
External gaps：無ProductionOwner目前session證據；正式Free/Premium帳號未提供；缺250D/PITUniverse/action/execution/rightsclearance；PR103未合併。
Production Migration/部署/合併/會員公開/正式推薦/LINE/Cron均未執行。Outcome正式producer與自然資料取得尚未啟用；MEASURED outcome在DB拒絕，不能用字串聲稱已成交。
新的Integrity successor只接受列名檔案及SHA，驗證全部實際baseline後才提供舊Academy gate的歷史view。此回歸仍待全量實測，不得省略或降低舊gate。
本頁是可恢復進度，不是完成證明。Draft候選可供CI檢查，但Release A/B/C均不得據此發布。
