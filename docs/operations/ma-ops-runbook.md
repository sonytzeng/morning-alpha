# MA-Ops P0 Runbook

此 runbook 是操作設計；未驗證的 cron 時間不得當作現況。所有時間均為 Asia/Taipei，只有 07:27、07:30、09:30、14:10、14:20 是 Repo UI/產品文字證據，仍需與外部 scheduler 對表。

## 1. 建議巡檢時間表草案

| 執行時間 | 巡檢 | 預期元件 | Grace | 檢查 | 異常 | 自動重試 | 通知 |
|---|---|---|---|---|---|---|---|
| 外部市場抓取 job 後（時間待提供） | Premarket inputs | market/news/core symbols | +5m | source、captured_at、TW/US basis date、missing/stale | warn→critical | market fetch 可 Level 1 | 缺哪些來源、data_as_of、下游阻塞 |
| 07:27 job 後 | Report dispatch | cron入口 | +3m | accepted 只記 dispatch，不判完成 | warning | 不自動重送 dispatch，先查 report | job/ref、target date |
| 07:30 | Daily report readiness | reports | 建議 +10m | 今日唯一、JSON contract、mode/status/date | 07:30 info/warn；07:40 critical | 否，Level 2 | report/date、missing sources、active resolver |
| 07:30 push 後 | LINE delivery | push logs | +10m | audience total、success/failed/duplicate | partial warn；全失敗 critical | 否 | 成功率、failed count；不含個資 |
| 09:30 | Opening checkpoint | intraday snapshot/radar | +10m | today/phase/captured_at、radar status | warn→critical | guard 後 Level 1 | symbols、data age、report dependency |
| 10:30 | Mid-session freshness | intraday/War Room | +10m | Observation、sync、freshness | warning | 市場抓取 Level 1；radar條件式 | stale roles/windows |
| 13:00 | Pre-close checkpoint | intraday/War Room | +10m | final intraday window、stop conditions | warning | 同上 | 尚未確認項目 |
| 13:30 後（實際 close job 待提供） | Close data | close snapshots | 建議 +30m | TAIEX/2330/TXF、strict close window | warning→critical | market fetch Level 1 | missing symbols/window |
| 14:10 | Closing completion | verification/review | +20m | v2 status/data_status/no_fake_data、review | warn；14:30 critical | 現況 Level 2 | pending reason、source、log duplication risk |
| 14:20 | Sector/performance | sector + RPC | +20m | sector date、performance row | warning | 否 | data status/sample |
| 每 5–10 分鐘 | Public synthetic | 6 pages | 5s/request | HTTP、DOM marker、error marker、date label | 2 次連續 critical | 無產品 writer；cache purge依 policy | URL、status、marker、latency |

在取得外部 cron export 前，所有「job 後」巡檢用相對觸發或人工窗口，不應自行創建固定 cron。

## 2. 異常判定

- Missing：應存在的 target-date record 在 hard deadline 後不存在。
- Stale：`captured_at/data_as_of` 不符合該 phase/session；盤前允許前一完整交易日台股基準與當日海外收盤基準，但必須明示 basis date。
- Duplicate：natural key 多筆；LINE 同 delivery key 多個 success；closing 同 version 多個 accuracy log。
- Date mismatch：today/report/data dates 不符合 market calendar 或 top-level/JSON 不一致。
- Old-as-today：active resolver 選到 `report_date != Taipei today`，且 UI 未進入 archive/review/closed fallback 並明示日期。
- Empty page：HTTP 2xx 但主要 region marker 不存在、永遠 skeleton、資料卡 0 且沒有 legitimate empty/degraded message。
- Error boundary：可辨識 error marker、uncaught JS、必要 API error；只有 HTTP 200 不能視為健康。
- Timeout：外部頁面 5 秒、單 dependency 2–3 秒為初稿；以 staging p95 校正。

## 3. Level 0–3 處理

### Level 0：只回報

建立 run/check、附 data_as_of/target date/evidence 摘要，通知 owner。適用於首次 warning、外部 cron 不可見、低信心資料品質、Performance 樣本不足。

### Level 1：安全自動重試

先確認 environment、target date、market status、upstream、natural key、current state、cooldown、attempt budget；取得 lock，執行一次 allowlisted action，再由獨立 health check 驗證。任何 guard 不通過立即降為 Level 0/2。現階段可候選：市場 fetch、Opening Radar；cache purge 需先定義精確範圍。

### Level 2：人工核准

產生 action preview（原因、target、payload摘要、before hash、影響、rollback/compensation、expiry），由 approver 簽一次性 token。適用報告重跑、Closing Verification 現況重跑、LINE failed-only 重送、狀態/JSON修補、production cache purge。批准後仍要重跑 guards；token 不可跨 action/date/env。

### Level 3：禁止自動

Cron 修改、Deploy、Migration、RLS、secret、任意 SQL、正式資料刪除/覆蓋。MA-Ops 只能開 incident 與提供人工 runbook，不提供執行 endpoint。

## 4. 元件處置

- Market data missing/stale：先驗 market calendar/provider；若 trading day 且 phase 正確、未超 attempt budget，Level 1 重抓；否則回報。
- Report missing：確認 inputs 與 cron dispatch；不可因入口 200 判完成。Level 2 才可重跑 V7；完成後先驗證網站，再另行決定 push。
- LINE partial failure：禁止全量重送。只建立 failed-only recipient set、delivery idempotency key、內容 hash與上限，人工核准。
- Opening Radar missing：確認今日 report 與 fresh intraday snapshot；符合才 Level 1。若資料不足則保持 degraded，不覆寫成 healthy。
- War Room empty：先修 report/radar resolver inputs；不得直接手補 Observation JSON。
- Close data missing：只重抓真實 close data；維持 pending/no_fake_data。
- Closing Verification pending：現況 insert log 可能重複，先 Level 2；補 unique/dedupe 後再評估 Level 1。
- Performance missing：驗 RPC 與 upstream verification；不得寫假績效或開 anon 直讀 reports。
- Public page unhealthy：連續兩次 synthetic 失敗才 critical；若 API 健康而 SPA 空白，交前端 incident。不可用資料 mutation掩蓋。

## 5. 人工核准點

核准畫面必須列出 action、environment、organization、target date、incident/check、current state、preconditions、預期 mutation、外部訊息影響、idempotency key、expiry。報告重跑與 LINE 重送分開核准；Deploy/Migration/Cron 即使人工也不透過 MA-Ops 執行。

## 6. Emergency stop

全域 `recovery_enabled=false`、environment kill switch、component disable、action denylist、最大每日 actions、consecutive-failure breaker。觸發條件：日期模型矛盾、重複 LINE、跨 environment、approval 驗證失敗、連續 recovery 失敗、market calendar 不確定、觀測到非 allowlist mutation。Stop 後 health checks 繼續，recovery 全拒絕並通知 owner。

## 7. Rollback / compensation

- Level 1 優先使用可重算 upsert，不以 delete rollback。
- 每次 mutation 前記 record version/hash；使用 compare-and-set，狀態已變則停止。
- 報告/JSON若未來允許修補，先保存 immutable snapshot/reference；rollback 也需 Level 2。
- LINE 無法 rollback，只能停止後續批次與發更正訊息；更正仍需人工核准。
- 已送出的外部請求、provider 成本與使用者通知視為不可逆副作用。
- DB/Function/Cron 變更不屬 MA-Ops recovery；沿正式 release/migration rollback 流程。

## 8. 下一階段進入條件

取得 cron-job.org export（遮蔽 secret）、Supabase deployed functions metadata、正式 schema/RLS dump（唯讀且遮蔽敏感值）、staging latency baseline、LINE delivery natural key 定義、closing accuracy log dedupe 方案、正式 route/DOM health marker 對照。完成前不啟用 production 自動修復。
