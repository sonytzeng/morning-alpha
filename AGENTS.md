# Morning Alpha Codex Rules

## Project identity
- 本專案是 Morning Alpha 台股決策系統。
- 核心功能包含：
  - 每日 07:30 報告
  - 全球市場與美股資料
  - 台指期與台股劇本
  - War Room
  - Daily Playbook
  - Decision Review
  - Performance
  - closing verification
  - opening radar
  - LINE daily push
- 不得混入 AnJill Studio、LoanCRM、安心借貸網、Drumio 的商業邏輯。

## Default workflow
每次收到任務時必須依序執行：
1. 確認 branch、working tree、HEAD、origin/main。
2. 檢查本機是否 ahead/behind。
3. 讀取相關資料流、Schema、Edge Function 與前端檔案。
4. 先提出執行計畫。
5. 僅修改與任務直接相關的檔案。
6. 執行可用的驗證。
7. 回報實際修改、風險與 Git 狀態。
8. 未獲得明確指示前，不得 commit、push、deploy 或執行 migration。

## Absolute safety rules
- 禁止自動 Push。
- 禁止自動 Deploy。
- 禁止自動執行 Supabase Migration。
- 禁止自動執行 Edge Function deploy。
- 禁止修改 production secrets。
- 禁止修改 Supabase URL、anon key、service-role key。
- 禁止修改 Cron schedule，除非任務明確要求。
- 禁止直接改正式資料。
- 禁止執行 destructive SQL。
- 禁止刪除 reports、market data、performance、verification 或 subscriber 資料。
- 禁止 force push。
- 禁止 git reset --hard。
- 禁止 git clean -fd。
- 禁止重寫 Git history。
- working tree 有不明修改時必須停止並回報。

## Git rules
- 預設 branch 為 main。
- Commit 前必須得到明確核准。
- Push 前必須得到明確核准。
- Deploy 前必須再次取得獨立核准。
- Migration 前必須再次取得獨立核准。
- Commit 前必須回報：
  - git status -sb
  - git diff --name-only
  - git diff --check
  - build 結果
  - type-check 結果
  - lint 結果
- Commit 訊息使用 Conventional Commits。
- 不得提交 .env、credentials、token、node_modules、build cache 或暫存檔。

## Validation
修改完成後，依 package.json 實際存在的 scripts 執行：
- npm run type-check
- npm run build
- npm run lint

如果 script 不存在，不得自行杜撰。

若修改 Edge Function：
- 執行對應的 type check、Deno check 或專案現有驗證方式。
- 不得因驗證失敗而關閉型別檢查。
- 不得大量使用 any。
- 不得移除防呆。
- 不得只修前端而忽略 Backend Schema 不一致。

## Market date model
日期邏輯必須區分：
- today_date：Asia/Taipei 今日日期
- report_date：報告所屬市場日期
- data_as_of：資料實際更新時間
- market_status：open / closed
- is_trading_day：true / false
- report_mode：normal_overnight / weekend_digest / holiday_digest / 其他既有模式

禁止：
- 用舊報告日期冒充今日日期
- 用 holiday report 當成今天資料
- 混用 today_date 與 report_date
- 直接用瀏覽器本地時區取代 Asia/Taipei
- 在週末或休市日顯示錯誤的開盤狀態

## Report engine rules
涉及每日報告時必須先檢查：
- generate-daily-report-v7
- fetch-market-data-v10
- opening-market-radar
- closing-verification-engine
- close-market-review
- line-daily-push
- reports Schema
- ai_strategy_json
- closing_verification_v2
- report_mode
- market_status
- is_trading_day

不得：
- 任意改動既有 JSON contract
- 移除現有欄位
- 讓舊報告解析失敗
- 直接覆蓋正式報告
- 未驗證就 Deploy

新增欄位時必須：
- backward compatible
- 有 fallback
- 前後端同步
- 說明舊資料如何處理
- 檢查 RLS 與 public RPC

## Performance page rules
歷史績效頁需優先讀取既有公開 RPC 或既有資料來源。
不得直接讓 anon 讀取完整 reports 表。
必須檢查：
- public RPC
- reports RLS
- closing_verification_v2
- hit_or_miss
- data_status
- opening_bias
- actual_direction
- confidence_score
- report_date

任何績效數字都不得以假資料補齊。
資料不足時必須清楚標示。

## War Room rules
War Room 是 Decision Monitor，不是長文閱讀頁。
修改時優先：
- 壓縮卡片高度
- 保留劇本名稱
- 保留目前狀態
- 保留代表股
- 保留下一個確認時間或停止條件
- 避免塞入完整報告內容

不得破壞：
- Observation role
- decision_step
- next_role
- confirmation_checklist
- risk_checklist
- capital_rotation_path
- external_priority
- decision_confidence

## Supabase and RLS rules
- reports、subscriptions、profiles、performance、market data 等表必須維持 RLS。
- anon 不得直接讀取敏感原始資料。
- 公開頁面優先透過最小權限 RPC。
- service-role 只能存在 Edge Function。
- 不得把 service-role 暴露到前端。
- migration 必須可重複執行或明確防重。
- RPC 與 Policy 名稱不得重複建立。
- 多表操作優先 transaction/RPC。

## Edge Function rules
任何 Edge Function 修改前必須先確認：
- function 名稱
- 本機檔案
- deployed function 是否同名
- version
- updated_at
- imports
- env vars
- request contract
- response contract

Deploy 前必須：
1. npm build/type-check 通過
2. function 本身驗證通過
3. git diff --check 通過
4. 回報實際修改檔案
5. 獨立取得 Deploy 核准

禁止一次 Deploy 多支 Function，除非任務明確要求。

## Readdy rules
- Readdy 適合 UI、版面與 Preview。
- GitHub main 才是程式碼真相來源。
- 不得假設 Readdy Preview 已同步 GitHub。
- 不得因 Preview 看起來正常就省略 Git 驗證。
- 修改 UI 時優先最小 diff。
- 不得為了視覺調整破壞資料模型或報告 Contract。

## Response format
每次完成任務後固定回報：
1. 任務目標或 Root Cause
2. 修改檔案
3. 實際修改
4. 驗證結果
5. Git 狀態
6. HEAD
7. origin/main
8. 是否 Commit
9. 是否 Push
10. 是否 Deploy
11. 是否執行 Migration
12. 是否修改 Cron
13. 尚存風險
