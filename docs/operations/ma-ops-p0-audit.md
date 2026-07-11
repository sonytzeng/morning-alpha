# Morning Alpha Operations Agent P0 現況稽核

稽核日期：2026-07-11（Asia/Taipei）
範圍：Repo 唯讀證據；未呼叫正式 API、資料庫或外部排程平台。

## 1. Git 基線

- Branch：`main`
- HEAD / `origin/main`：`0bcf660d7ede5970629409a437ce4c031359f88b`
- ahead / behind：`0 / 0`
- 起始 working tree：乾淨
- Remote：`origin` 指向 Morning Alpha GitHub repository

## 2. 排程來源結論

- Repo 無 `.github/workflows`，沒有可證明的 GitHub Actions 排程。
- Repo migrations 無 `pg_cron` job；`supabase/config.toml` 只含 Function 設定，不能證明 Supabase Cron。
- 程式與管理頁明示排程由外部 `cron-job.org` 管理；實際 job、啟用狀態、timezone、headers、retry、最近結果均需人工提供外部設定。
- 下表時間是 Repo 顯示的「預期產品時間／檢查時間」，不是已驗證的外部 cron 設定。所有 endpoint 皆為 `POST /functions/v1/<slug>`；Base URL 不記錄於本文件。

| 工作 | 本機檔案 | Repo 可證明時間 | 位置 | Auth | 成功 / 失敗 | Retry、冪等與副作用 |
|---|---|---|---|---|---|---|
| `fetch-market-data-v10` | `supabase/functions/fetch-market-data-v10/index.ts` | phase 由時間推導；UI 提及 09:30/10:30/13:00，實際 cron 不可證明 | 外部設定待提供 | `x-cron-secret` | 200 且 `success=true`；401/500，或 200 但核心 symbol 不完整 | provider 內建有限 retry；`market_data_snapshots` 以 symbol/date/phase upsert，較安全；`market_data` 亦 upsert。錯誤 phase/force_run 會污染時序 |
| `cron-generate-report` | `supabase/functions/cron-generate-report/index.ts` | 管理頁標示 07:27；外部設定不可證明 | 外部 cron 入口 | `x-cron-secret` | 200 僅代表 accepted，不代表報告完成；401/405/500 | fire-and-forget，呼叫端 retry 可能併發觸發 V7；需後驗 reports |
| `generate-daily-report-v7` | `supabase/functions/generate-daily-report-v7/index.ts` | 產品承諾 07:30 前可用；實際 cron 不可證明 | 由 cron 入口或受控工具觸發 | `x-cron-secret` | 200、`success=true`、report write 後查回成功；非 2xx/`success=false`/查回失敗 | 依 `report_date` 寫入但現有唯一約束未在 Repo migrations 完整可見；重跑可改寫今日報告與 AI JSON，須人工核准 |
| `line-daily-push` | `supabase/functions/line-daily-push/index.ts` | 管理頁標示 07:30；實際 cron 不可證明 | 外部設定待提供 | `x-cron-secret` | 200 且 subscriber 統計合理；單筆仍可能 failed | 無全域 delivery idempotency；會送外部訊息、新增 `line_push_logs`、更新 subscriber，重跑可能重送 |
| `opening-market-radar` | `supabase/functions/opening-market-radar/index.ts` | UI 以 09:30 為完成點；報告另列 09:30/10:30/13:00 驗證窗 | 外部設定待提供 | cron secret 或受允許 Bearer | 200、`success=true` 且 row/report patch 完成；也可能 200 `success=false` 表示資料不足 | `opening_market_radar` 對 report_date upsert，另 patch reports JSON；條件式安全，錯誤資料時間會覆蓋 |
| `closing-verification-engine` | `supabase/functions/closing-verification-engine/index.ts` | 收盤後；Repo 未證明 cron 時間 | 外部設定待提供 | `x-cron-secret` | completed；缺 close data 回 `success=false`, `NO_CLOSE_DATA`, pending | 完成時 insert `prediction_accuracy_logs` 後 patch report，無明確防重，重跑可重複 log |
| `close-market-review` | `supabase/functions/close-market-review/index.ts` | UI 以 14:10 為完成點 | 外部設定待提供 | cron secret 或受允許 Bearer | 200 且 upsert 完成；500 或 200 降級/等待 | `close_market_reviews` 對 report_date upsert；會覆寫同日 review，須檢查 close window |
| `generate-sector-rotation` | `supabase/functions/generate-sector-rotation/index.ts` | UI 以 14:20 為完成點 | 外部設定待提供 | `x-cron-secret` | Repo 未做完整本輪契約深查 | 非本題主清單但為報告上游；排程待人工提供 |
| `daily-health-check` | `supabase/functions/daily-health-check/index.ts` | 無可證明時間 | 未證明有排程 | `x-cron-secret` | insert `system_health_logs` 後 success | insert-only，重跑會多筆；適合作為 MA-Ops 參考，非完整 health system |

其他相關工作：`fetch-global-market-news` 是報告上游；`market-source-health-check` 是來源檢查；均存在 Function，但外部 schedule 無 Repo 證據。舊 `fetch-market-data-v7/v8`、`generate-daily-report` 已標示 deprecated，不應排程。

## 3. 每日資料生命週期

`market_data / market_data_snapshots` → `reports` → `line_push_logs` → `opening_market_radar` + report JSON → War Room resolver → close phase data → `closing_verification_v2` + `prediction_accuracy_logs` → `close_market_reviews` → `get_public_performance_journal()` → Performance。

| 階段 | 上游 | 寫入與主要欄位 | 完成判定 / 時間與延遲草案 | 前台 / 失敗影響 / 安全重試 |
|---|---|---|---|---|
| 市場資料 | Provider、market calendar | `market_data`; snapshots: symbol, trading_date, phase, captured_at, source | 核心 symbols 齊、日期/phase 正確；應早於下游，grace 依外部 cron 補證 | 全站；缺失使報告降級。相同 date/phase 可重試 |
| 報告 | 市場資料、新聞、前交易日 sector/review | `reports`: report_date, market_bias, confidence_score, ai_strategy_json, created/updated_at | 今日唯一可用報告、write-readback；07:30 產品目標，建議 +10m grace | Home/Today/Playbook/War Room；缺失全站降級。重跑需核准 |
| LINE | 今日 report、subscriber | `line_push_logs`: subscriber/user, report_date, status, message/error；subscriber.last_pushed_at | 每個目標有單一成功 delivery | 外部訊息；失敗不影響網站。不可盲重跑 |
| Opening Radar | 今日 report、intraday snapshot | `opening_market_radar`: report_date, radar_status, captured_at, market_data_date, data_status, missing_sources, radar_mode, txf_status；patch ai JSON | trading day 09:30 檢查點後 row 新鮮，建議 +10m | War Room/Today；缺失維持盤前狀態。守門後可重試 |
| War Room | report JSON、radar、close review | 本身主要為 resolver/read model；Observation roles 在 ai JSON | `decision_step/next_role/confirmation_checklist/risk_checklist/capital_rotation_path/external_priority/decision_confidence` 可解析 | `/war-room`；失敗為空卡/錯日期。通常修上游，不直接修 UI 資料 |
| 收盤資料 | Provider | snapshots phase=`close`、核心 TAIEX/2330/TXF captured_at | 嚴格收盤窗口且 trading_date 今日；13:30 後，建議 30m grace | 驗證上游；缺失必須 pending、不得假資料。可重抓 |
| Closing Verification | 今日 report、close data、radar、sector | patch `ai_strategy_json.closing_verification_v2`; insert accuracy log | status completed 或方向完成但 degraded；UI 14:10 參考 | Today/Review/Performance；無 close data 保持 pending。需 dedupe 才自動重試 |
| Close Review | report、market data、radar | `close_market_reviews` report_date unique/upsert、verification fields | 同日 review 存在且 close data 合法；UI 14:10 參考 | Decision Review/Verification；條件式可重試 |
| Performance | reports + public RPC | 不另寫；RPC 輸出 status/data_status/hit_or_miss/opening_bias/actual_direction 等 | 每交易日最多一個可信 journal row；收盤驗證後更新 | `/performance`；不足應明示，不得補假資料。修復上游，不寫績效值 |

## 4. 日型態

- 正常交易日：完整執行；`today_date=Asia/Taipei 今日`，`report_date=市場所屬日`，收盤驗證只接受真實 close window。
- 週末：market status=`WEEKEND`、`is_trading_day=false`；資料抓取/radar/close verification 多數 skip。報告支援 digest/休市內容，但不得把最近交易日冒充今天。
- TWSE 假日：`HOLIDAY`；同週末原則，保留 holiday/next_trading_day。
- 臨時/颱風休市：`TYPHOON` 或 `EMERGENCY_CLOSE`；目前 exceptional closure 是程式內年度表，無 DB calendar。LINE 對 typhoon 有特殊分支，必須人工確認內容與排程。
- API 降級：報告可 deterministic fallback，並寫 `data_quality/missing_sources`；不得把 degraded 標成 complete。Opening Radar 有 degraded metadata；closing 缺真實資料必須 pending。

## 5. 完成與異常判定

共通規則：Normal=日期一致、唯一、必要欄位完整且在容許窗；Warning=partial/degraded 或超過 soft grace；Critical=缺失、日期錯置、契約無法解析、超過 hard deadline。Stale 以 `data_as_of/captured_at/updated_at` 對應該市場 session 判斷，不以 UTC 日曆日粗判。

| 對象 | Normal | Warning / Stale | Critical / Missing | Duplicate、日期錯置與舊報告冒充 |
|---|---|---|---|---|
| `reports` | 今日應有一筆可信 row | data_quality degraded、必要 JSON fallback | 今日交易日 hard deadline 後無 row | 同 report_date 多筆；`report_date != today_date` 卻被 active resolver 選為今日即 Critical |
| 日期欄位 | today=台北日；report=市場日；data_as_of=來源時間 | 合法前交易日盤前基準但標示不足 | future date、跨日錯配 | top-level 與 JSON 日期不一致；latest-created 不等於 active-today |
| market flags/mode | OPEN+true+normal_overnight 或正確 closed mode | 未知 mode 但保守顯示 | OPEN/false、WEEKEND/true 等矛盾 | 舊 report 的 flags 被套用今日 |
| `ai_strategy_json` | 可解析、核心 contract 存在 | missing_sources、partial/insufficient 有明示 | malformed、空物件、必要決策欄缺失 | 禁止手工 patch；schema version/fallback 必須相容 |
| `closing_verification_v2` | completed + complete；方向與來源可追 | degraded 或 pending 尚在 grace | 交易日 hard deadline 後 pending/missing，或 no_fake_data 破壞 | report_date 不符；多 accuracy logs；舊 verification 嵌入今日 report |
| Opening Radar | 同 report_date、market_data_date、captured_at 新鮮 | degraded/missing_sources 或稍晚 | trading day hard deadline 後無 row | report_date unique 預期；錯用昨日 intraday 即 Critical |
| War Room Observation | 五類角色/流程欄可解析 | confidence 低或 checklist partial | 今日 report 存在但視圖空/throw | 顯示 reportDate 非今日且未標 review mode |
| LINE Push | 每 subscriber/report/template 一個 success | 部分 failed | 全部失敗、報告未 ready 卻推送 | 同 delivery key 多個 success 是 duplicate incident |
| Performance | RPC row 與 completed verification 一致 | 樣本不足/degraded 明示 | RPC error、假補值、敏感 reports 直讀 | RPC 已 rank duplicate reports；仍應警告底層 duplicate |

## 6. 公開網站健康

正式 host 無 Repo 可驗證部署設定；本輪未呼叫正式站。外部巡檢可做 HTTP/DOM，但資料真偽最好由專用 health endpoint 回傳脫敏狀態。

| 頁面 | 路由 | HTTP / 必要資料 | 空白、錯誤、timeout、日期 | 外部可驗 / Endpoint |
|---|---|---|---|---|
| Home | `/` | 2xx；active report/market state | root 無主要內容、error UI、>5s；顯示日期需符合台北日/休市模式 | DOM 可；建議 health |
| Today | `/report/today` | 2xx；report、market bias、JSON | skeleton 不退、報告缺失未明示、日期冒充 | DOM 可；需要 health |
| Daily Playbook | Repo 對應會員研究筆記 `/member-note`；產品名稱映射需確認 | 2xx；member note v2 | 內容區空/contract error/錯日期 | DOM 可；需要 health |
| War Room | `/war-room` | 2xx；report + radar/Observation | 卡片全空、error boundary、錯模式 | DOM 可；需要 health |
| Decision Review | Repo 最接近 `/verification`；正式命名/路由需確認 | 2xx；report/radar/close review | 收盤後無狀態且未標 pending | DOM 可；需要 health |
| Performance | `/performance` | 2xx；public RPC | chart/table 空但未標資料不足、RPC error | DOM 可；RPC health 足夠但建議聚合 health |

Error boundary 應以可辨識 DOM marker/telemetry 判定；目前僅靠 HTTP 200 無法排除 SPA 空畫面。建議外部 timeout 5 秒、單 API 3 秒，數值待 staging 基準校正。

## 7. Repo 無法驗證項目

外部 cron-job.org job 清單、timezone、headers、retry、timeout、啟用狀態與歷史；Supabase 已部署 Function 名稱/version/updated_at；正式 DB 完整 schema/constraints/RLS；正式 host/deployment；production/staging secrets 是否齊全；正式資料新鮮度與 row counts；LINE 實際受眾與 delivery；TWSE 最新臨時休市來源。這些都需要人工提供外部設定或下一階段受控只讀存取。
