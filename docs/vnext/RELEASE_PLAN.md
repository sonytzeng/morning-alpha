# A / B / C 發布計畫（本次不執行）
## Release A
重用已完成每日分析和Academy。前輪Owner正式已驗收；Free/Premium正式E2E仍待合法身份，SONY_USABILITY未代答。自然市場/LINE結果獨立追蹤，不因VNext新UI重驗或改寫。
## Release B
本 Draft PR 的 events/graph/horizon contracts + private migration candidate + minimal read projection + local UI。
上線前需Sony具名核准Merge、唯一candidate migration、正式UIroute接入與發布；沒有新Secret/Cron/付費API。
安全驗收：isolated Auth/DB PASS後仍需Production Owner/Member session；只讀smoke、業務count/diff、publicationleaknegative。
資料授權未確認則僅Owner研究，不得公開給會員。
## Release C
PR103独立驗收、足夠PIT歷史與adjustment/execution來源、OOS/walk-forward/Forward成熟Outcome、OwnerUsability與Sony核准。未達則不Promotion。

## 精確候選 Manifest
Migration candidate：20261010061630_vnext_research_projection_candidate.sql（只在隔離DB執行）
Function deployment：NONE
Cron/Secrets/existingAuth/RLS：NO CHANGE
UI：src/pages/vnext，暫不改production router；既有Academy與Today入口不修改。
Public trade/Recommendation/Report/LINE：NO CHANGE

## Rollback
候選目前未接Production，停止Preview即可。未来批准上线后，UI回復原版本/關閉新入口；新表保留只讀隔離、不刪研究或會員紀錄。撤回發布用追加audit，不能改历史Prediction。任何数据泄漏停止ReleaseB，不修改Core消除告警。
