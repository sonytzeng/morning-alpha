# MA-Ops P0 架構設計

本文件是設計草案，不是 migration 或 Function 實作。

## 1. 架構

外部 scheduler 以短效簽章呼叫 `ma-ops-health-check`；Function 讀取 component registry，執行脫敏 read-only checks，將 run/check 寫入 ops schema並發通知。只有 allowlist 且符合 Level 1 guard 的事件可建立 recovery request；`ma-ops-safe-recovery` 再驗證 environment、approval、idempotency、cooldown、market date 與 current state，才觸發單一既有 Function。Level 2 僅建立待核准 action；Level 3 永不執行。

隔離原則：production/staging 使用不同 project、registry、scheduler credential、approval issuer 與 idempotency namespace；request 不接受任意 URL、SQL、table、Function 名稱或 payload。

## 2. Schema 草案

所有表使用 `uuid` PK、`environment text check in ('production','staging')`、`organization_id uuid not null`、`created_at timestamptz not null default now()`、`updated_at timestamptz not null default now()`。`organization_id` 預留多租戶；單組織部署仍不可省略。

### `ma_ops_runs`

欄位：`id`, scope 欄位、`run_type text`, `trigger_source text`, `scheduled_for timestamptz`, `started_at`, `finished_at`, `status text`（running/completed/warning/critical/failed/cancelled）, `today_date date`, `report_date date null`, `market_status text`, `is_trading_day boolean`, `summary jsonb`, `correlation_id uuid`, `idempotency_key text not null`, timestamps。PK `id`；unique `(organization_id,environment,idempotency_key)`；index `(environment,started_at desc)`, `(status,started_at desc)`, `(report_date)`。Retention：run summary 400 天，critical 730 天。

### `ma_ops_checks`

欄位：`id`, scope、`run_id uuid not null`, `component_key text`, `check_key text`, `severity text`（ok/info/warning/critical）, `status text`, `expected jsonb`, `observed jsonb`（脫敏）, `checked_at`, `data_as_of`, `stale_after`, `error_code`, `error_message`, `duration_ms integer`, `retryable boolean`, `idempotency_key`, timestamps。FK `run_id -> ma_ops_runs(id) on delete restrict`；unique scope+idempotency；index `(run_id)`, `(component_key,checked_at desc)`, `(severity,checked_at desc)`。Retention：明細 180 天，critical 730 天。

### `ma_ops_recovery_actions`

欄位：`id`, scope、`run_id`, `check_id`, `component_key`, `action_key`, `risk_level smallint check 0..3`, `status`（proposed/awaiting_approval/approved/running/succeeded/failed/rejected/expired/cancelled）, `requested_payload jsonb`, `guard_snapshot jsonb`, `approval_token_hash text null`, `approved_by uuid null`, `approved_at`, `approval_expires_at`, `attempt_count`, `max_attempts`, `next_attempt_at`, `started_at`, `finished_at`, `result jsonb`, `error_code`, `idempotency_key`, timestamps。FK run/check restrict；unique scope+idempotency；index status/next_attempt、component/created。Retention：730 天；approval hash 不存明文。

### `ma_ops_component_registry`

欄位：`id`, scope、`component_key`, `display_name`, `component_type`, `enabled boolean`, `owner`, `health_check_key`, `expected_schedule jsonb`, `grace_seconds integer`, `hard_deadline_seconds integer`, `dependencies jsonb`, `success_contract jsonb`, `staleness_contract jsonb`, `recovery_policy jsonb`, `allowed_recovery_actions jsonb`, `config_version integer`, timestamps。Unique `(organization_id,environment,component_key)`；index enabled/component_type。Retention：現行資料永久保留，變更另由 audit/action 記錄；不得存 secret 或完整 endpoint credential。

### RLS

全部 enable + force RLS。一般 `anon/authenticated` 無直接權限；ops viewer 只讀自己 organization/environment；ops approver 可更新 Level 2 approval 狀態但不能改 action/payload；寫入只由兩支 MA-Ops Function 的 service-role server path 完成。公開網站不得查這些表。跨 environment 永遠拒絕。

## 3. `ma-ops-health-check`

- Responsibility：只讀檢查 registry、日期/交易狀態、資料完整性、Function/頁面合成狀態；不修資料、不呼叫產品 writer。
- Request：`POST` JSON `{schema_version:"1", environment, organization_id, scheduled_for, check_set, component_keys?, dry_run:true, idempotency_key}`。禁止傳 SQL/URL/secret。
- Response：`{success, run_id, status, today_date, market_status, started_at, finished_at, checks:[{component_key,check_key,severity,error_code,data_as_of,retryable}], summary}`。
- Auth：scheduler 使用短效 JWT/HMAC；admin manual 使用已驗證 owner claim。拒絕 anon。service-role 僅 server-side 建 client 與寫 ops audit；讀產品資料採專用最小權限 RPC 為目標。
- Registry checks：market-data phases/core symbols、daily report/date contract、LINE aggregate、opening radar、War Room Observation contract、close data、closing verification、close review、performance RPC、public page synthetic markers。
- Timeout：整體 25 秒；DB check 2 秒、HTTP synthetic 5 秒；逾時記 check，不拖垮整 run。
- Retry：scheduler 對 transport failure 最多 2 次，指數退避+jitter；相同 idempotency key 回既有 run。
- Audit：記 observed 摘要/hash/count，不記 payload 原文、subscriber identity、token 或 secret。
- Error taxonomy：`AUTH_*`, `REQUEST_*`, `REGISTRY_*`, `DEPENDENCY_TIMEOUT`, `DATA_MISSING`, `DATA_STALE`, `DATA_DUPLICATE`, `DATE_MISMATCH`, `CONTRACT_INVALID`, `DEGRADED`, `PAGE_HTTP`, `PAGE_EMPTY`, `INTERNAL_*`。

## 4. `ma-ops-safe-recovery`

- Responsibility：只執行 registry allowlist 的單一 recovery，先重新讀 current state 並套 guard。
- Request：`{schema_version:"1", environment, organization_id, action_key, component_key, incident_run_id, check_id, target_date, dry_run, idempotency_key, approval_token?}`。
- Response：`{success, action_id, status, executed, guard_results, downstream_job_ref?, error_code}`；不回傳 secret/產品原始資料。
- Auth：machine identity + action-specific scope；Level 2 額外一次性 approval token（含 action、target、env、expiry、nonce，server 儲存 hash）。Level 3 一律拒絕。
- Timeout：自身 20 秒；對長工作採 dispatch + verification run，不把 accepted 當完成。
- Retry：只對未產生副作用的 transport error；最大 1 次。idempotency unique + distributed lock + cooldown。
- Audit：每次 proposed/guard/approval/dispatch/result 都寫 action；保留 correlation ID。
- Error taxonomy：`RECOVERY_NOT_ALLOWED`, `APPROVAL_REQUIRED/INVALID/EXPIRED`, `GUARD_FAILED`, `ALREADY_HEALTHY`, `COOLDOWN_ACTIVE`, `IDEMPOTENCY_CONFLICT`, `UPSTREAM_NOT_READY`, `MARKET_DATE_MISMATCH`, `DISPATCH_FAILED`, `VERIFY_FAILED`。
- service-role 邊界：只在 Function runtime；不可回傳/轉送到 browser；不可接受任意 table mutation。

### Recovery allowlist

Level 1 候選僅：同 target date/phase 重抓市場資料；在今日 trading day、report 存在、intraday snapshot 新鮮時重跑 Opening Radar；在真實 close snapshot 齊全且 accuracy log/report 尚未完成時重跑 closing verification（現況未有強 dedupe，因此上線前先降為 Level 2）；cache purge 只限 versioned public render cache 且不影響資料。

禁止清單：任意 SQL、報告 JSON patch、狀態強制更新、LINE 重送、Cron/Deploy/Migration/RLS/secret、正式資料 delete/overwrite、force/backfill 任意日期、任意 URL/function。

## 5. 風險分級

| 操作 | Level | 風險 / 冪等條件 / 副作用 | Recovery Guard | Approval token |
|---|---:|---|---|---|
| 重跑市場資料 | 1 | date+phase+symbol upsert；provider 成本/錯 phase | trading day、allowlisted phase、freshness 缺口、單日次數/cooldown | 否 |
| 重跑報告 | 2 | 可能覆寫今日判斷、重耗 AI | 上游齊、同日 lock、保存前後 hash、禁止自動發布/推播 | 是 |
| 重跑 Opening Radar | 1 | report_date upsert + patch JSON | 今日 report、fresh intraday、尚未 healthy、單次 lock | 否 |
| 重跑 Closing Verification | 2（完成 dedupe 後可評估 1） | accuracy log duplicate + report patch | 真 close、unique action/log、pending-only | 是 |
| 重送 LINE | 2 | 使用者收到重複訊息 | delivery key、failed-only audience、內容 hash、批次上限 | 是 |
| 清 Cache | 1/2 | 可能造成流量尖峰；若範圍未知則 2 | allowlisted cache key、staging probe、rate limit | prod 建議是 |
| 更新報告狀態 | 2 | 偽造完成狀態 | 必須由原始證據推導、CAS、before/after audit | 是 |
| 修補 JSON | 2 | contract/歷史資料破壞 | schema validation、backup/hash、單 row CAS | 是 |
| 修改 Cron | 3 | 全流程時間與重複執行風險 | 不提供自動路徑 | 不適用 |
| Deploy Function | 3 | production code 變更 | 走既有人工 release 流程 | 不適用 |
| Migration / RLS | 3 | schema/權限風險 | 走人工 review + migration | 不適用 |
| 正式資料刪除/覆蓋 | 3 | 不可逆與稽核風險 | 禁止 | 不適用 |

Level 0 是偵測、紀錄、通知，不做 mutation。Level 1 仍需預先核准 policy，不等於可任意執行。

## 6. Idempotency 設計

Key 格式：`maops:v1:<env>:<org>:<action-or-check>:<component>:<target-date>:<phase-or-contract-version>`。DB unique constraint 是最後防線；先取得 advisory/distributed lock，再重讀 current state。每個 writer 用 compare-and-set 或既有 natural key，記 input hash/output hash。Dispatch accepted 與 verified success 分開；verification 必須由後續 health run 判定。LINE key 至少包含 subscriber、report_date、template/version、content hash；closing log 必須補 `(report_date, verification_version)` 唯一策略後才可 Level 1。
