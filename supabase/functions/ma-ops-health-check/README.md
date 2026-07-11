# MA-Ops Health Check (P1)

`ma-ops-health-check` 是 P1 唯讀監控入口。它只讀既有業務資料，並在非 `dry_run` 時寫入 `ma_ops_runs` 與 `ma_ops_checks`。它不修改任何業務資料，也不執行 recovery。

## Auth

沿用專案內部 Cron 模式：呼叫端必須在 `x-cron-secret` 帶入 runtime 的 `CRON_SECRET`。兩者先各自計算 SHA-256，再以固定 32-byte XOR 累積做 constant-time comparison；缺失、空值與原始長度差異都會拒絕。Secret 或 digest 不得放入原始碼、log、metadata、文件、response 或前端。Function 使用 runtime 的 `SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 建立 server-only client。

## Request

```json
{
  "environment": "production",
  "check_type": "full",
  "target_date": "2026-07-11",
  "dry_run": true,
  "components": ["daily-report-exists", "daily-report-contract"],
  "request_id": "scheduler-run-20260711-0730"
}
```

- `environment`: `production | staging | development`，預設 `production`。
- `check_type`: `full | premarket | report | opening | intraday | closing | performance | synthetic`，預設 `full`。
- `target_date`: `YYYY-MM-DD`；省略時以 `Asia/Taipei` 今日日期為準。
- `dry_run=true`: 執行唯讀 checks，不寫入 MA-Ops tables；`run_id` 為 `null`。
- `components`: 可省略；提供時只接受已知 check key。
- `request_id`: 可省略；提供時用於非 dry-run idempotency key。

## Response

```json
{
  "ok": true,
  "run_id": null,
  "environment": "production",
  "check_type": "full",
  "target_date": "2026-07-11",
  "status": "warning",
  "severity": "warning",
  "summary": { "passed": 8, "warning": 1, "failed": 0, "skipped": 2 },
  "checks": [],
  "recovery_attempted": false,
  "generated_at": "2026-07-11T00:00:00.000Z"
}
```

錯誤格式為 `{ "ok": false, "error_code": "INVALID_REQUEST", "message": "...", "request_id": "..." }`。

## Checks

- `market-data-freshness`
- `daily-report-exists`
- `daily-report-date-consistency`
- `daily-report-contract`
- `opening-radar-exists`
- `opening-radar-freshness`
- `war-room-contract`
- `closing-verification-status`
- `performance-source-availability`
- `public-site-synthetic-config`：只驗證 URL 設定，P1 不發 HTTP。
- `line-push-delivery`：P1 固定 `skipped`，尚無已驗證 audience baseline 與 delivery natural key。

## Error codes

`UNAUTHORIZED`, `INVALID_REQUEST`, `INVALID_TARGET_DATE`, `DATABASE_QUERY_FAILED`, `REPORT_MISSING`, `REPORT_STALE`, `REPORT_DATE_MISMATCH`, `REPORT_CONTRACT_INVALID`, `RADAR_MISSING`, `RADAR_STALE`, `WAR_ROOM_CONTRACT_INVALID`, `CLOSING_VERIFICATION_PENDING`, `PERFORMANCE_SOURCE_UNAVAILABLE`, `CHECK_NOT_IMPLEMENTABLE_FROM_CURRENT_SCHEMA`, `IDEMPOTENT_RESULT_REUSED`, `IDEMPOTENT_RUN_IN_PROGRESS`, `INTERNAL_ERROR`。

## Idempotency

非 dry-run 且有 `request_id` 時，key 是 `maops:p1:<environment>:<check_type>:<target_date>:<request_id>`。DB unique constraint 是最後防線；已完成相同 key 回既有結果並標示 `IDEMPOTENT_RESULT_REUSED`。若同 key run 仍是 `running`，Function 不執行 checks、不建立第二筆 run，回 HTTP 202、`in_progress=true` 與 `IDEMPOTENT_RUN_IN_PROGRESS`。Insert unique race 會再次查詢並套用相同 completed/running contract。無 request ID 與 dry-run 均不參與重用。同一排程 instance 必須重用 request ID。

HTTP 202 範例：

```json
{
  "ok": true,
  "run_id": "existing-run-uuid",
  "environment": "production",
  "check_type": "full",
  "target_date": "2026-07-11",
  "status": "running",
  "severity": "info",
  "summary": { "passed": 0, "warning": 0, "failed": 0, "skipped": 0 },
  "checks": [],
  "recovery_attempted": false,
  "generated_at": "2026-07-11T00:00:00.000Z",
  "in_progress": true,
  "error_code": "IDEMPOTENT_RUN_IN_PROGRESS"
}
```

## Timeout 與 audit write consistency

Read-only checks 使用 3 秒 client-side timeout；底層 read 若稍後完成不會產生資料副作用。`ma_ops_runs.insert`、`ma_ops_checks.insert` 與 `ma_ops_runs.update` 不使用 `Promise.race` timeout，而是直接等待 Supabase response，以避免自行製造 unknown commit state。Run 建立後的 persistence 由統一 try/catch/finally 收斂；checks insert 或 final update 失敗時，會盡力把 run 更新為 `failed` 並記錄 `AUDIT_PERSISTENCE_FAILED`。平台層 request/DB timeout 後，呼叫端應以相同 idempotency key 查詢狀態，不得假設未提交。

## 已知本機驗證環境

- Node `26.4.0` 在目前環境曾造成 tsc、ESLint 與 Vite 異常停滯。
- Node `24.14.0` 能完成 type-check command，並揭露 `src/` 既有 TypeScript errors；不得宣稱 type-check 通過。
- 驗證 runtime 暫以 Node 24 LTS 為準，直到 Node 26 相容性完成驗證。
- `Documents/GitHub` 可能受 macOS File Provider/iCloud metadata 影響；ESLint module loading 與 Vite PostCSS/caniuse-lite 曾出現極慢 filesystem I/O。後續應搬至非 File Provider 管理路徑後重驗。
- npm build、lint、type-check 與 Deno compile validation 均尚未通過或完成。

## P1 限制與未實作

- 不執行 Migration、Deploy、Cron 或 recovery。
- 不呼叫其他 Edge Function、正式 API 或 public site。
- 不做自動 retry、報告重建、Radar 重跑、LINE 重送或 cache purge。
- 不 seed registry，未驗證 production metadata、正式資料或正式 RLS。
- freshness SLA、交易行事曆 deadline 與完整 synthetic DOM check 待 P2。

## Deploy 前檢查清單

1. Review migration、constraints、RLS 與 grants。
2. 在隔離環境獨立核准並執行 Migration。
3. 設定 runtime secrets，不輸出 secret 值。
4. 執行 Deno check、type-check、lint、build、`git diff --check`。
5. 先以 staging + `dry_run=true` 驗證。
6. 獨立取得 Deploy 核准；P1 不建立排程。

此 Function 不得用於自動修復。
