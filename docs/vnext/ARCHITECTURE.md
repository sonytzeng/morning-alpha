# VNext 隔離架構
## 資料流
合法已授權來源 → 最小來源 envelope → PIT/品質/授權 gate → 單一事件版本線與供應鏈關係 → 短／中／長獨立觀察 → 不可變 lock → 事後 Outcome → 版本比較。
會員：既有 Supabase Auth → 既有 server entitlement → 新只讀 published projection → 白話卡片。
Owner：同一正式 Owner predicate；可讀研究候選，但不因此授權會員公開。

## 不可跨越的界線
沒有 caller 接入 generate-daily-report、Recommendation 或 LINE。
候選 /vnext 僅由 loopback Preview entry 啟動，未加入 Production router。
既有 Today 與 Academy 用入口重用，無複製商業邏輯。
source licenses/evidence/events/relations/observations/outcomes/publication audit 在 vnext_private；default revoke、forced RLS；Owner only raw select；會員只讀 explicit approved minimal projection。
public RPC 沒有 tier/user_id 引數；使用 academy_private.access_v11()，不讀 client metadata。
沒有公開寫入 RPC。研究寫入與 publication approval producer 尚未啟用；不造假把表存在當成自然執行。

## 依賴
Release A：既有 main Academy（PR225/228/229）及既有每日服務。
Release B：本分支新增契約＋候選 migration＋隔離 UI。
Release C：PR103 Frozen V1 尚未合併，使用 pin 合約；需獨立核准且資料足夠才啟用實際比較。
Core 最高 PASS/DEGRADED/CORE_FAIL 原封不動；觀察狀態不是正式交易行動。
