# Morning Alpha Codex Setup Report

產生日期：2026-07-11（Asia/Taipei）

## Repository

- 專案：Morning Alpha
- 專案路徑：`/Users/sonytzeng/Documents/GitHub/morning-alpha`
- Git remote：`origin https://github.com/sonytzeng/morning-alpha.git`
- Branch：`main`
- HEAD：`07ef7300084b9588df054b023835847da1e81c8d`
- HEAD commit：`07ef7300 feat(reports): align reports center with Morning Alpha visual system`
- origin/main：`07ef7300084b9588df054b023835847da1e81c8d`
- Ahead / behind：`0 / 0`
- 初始化前 working tree：乾淨
- 不明既有修改：無

## Local toolchain

- Package manager：npm（存在 `package-lock.json`）
- Node：`v26.4.0`
- npm：`11.17.0`
- GitHub CLI：`2.96.0`
- GitHub CLI 登入狀態：已登入 `sonytzeng`，且 `gh api user` API 驗證成功
- React：`^19.1.2`
- React DOM：`^19.1.2`
- TypeScript：`~5.8.3`
- Vite：`^8.0.1`
- Supabase JS：`2.57.4`
- Tailwind CSS：`^3.4.17`

## Available npm scripts

- `npm run dev`：啟動 Vite 開發伺服器
- `npm run build`：執行 Vite production build
- `npm run preview`：預覽 production build
- `npm run lint`：執行 ESLint（`src` 下的 TypeScript / TSX）
- `npm run type-check`：執行 `tsc --noEmit --project tsconfig.app.json`

本次初始化未執行上述 scripts，避免產生 build cache 或非文件變更。

## Project configuration

- `package.json`：存在
- `tsconfig.json`：存在，引用 `tsconfig.app.json` 與 `tsconfig.node.json`
- `vite.config.ts`：存在；使用 React、AutoImport、`@` alias 與 Readdy preview 相關 define
- `README.md`：不存在
- 初始化前 `AGENTS.md`：不存在
- `.github/workflows`：不存在
- Readdy：Vite 設定保留 `PROJECT_ID`、`VERSION_ID`、`READDY_AI_DOMAIN` 與 preview flags；repo 中沒有可驗證的 Readdy 發布 workflow

## Supabase structure

- `supabase/config.toml`：存在
- Linked project ref：`cttfzgvhiewfckydcrci`
- `supabase/functions/`：存在
- `supabase/migrations/`：存在，共 5 個 migration 檔案
- `config.toml` 目前明確設定 `verify_jwt = false` 的 functions：
  - `generate-daily-report-v7`
  - `daily-health-check`
  - `closing-verification-engine`
  - `get-report-payload`
  - `generate-sector-rotation`

## Edge Functions

- `_shared`
- `close-market-review`
- `closing-verification-engine`
- `cron-generate-report`
- `daily-health-check`
- `fetch-global-market-news`
- `fetch-market-data-v10`
- `fetch-market-data-v7`
- `fetch-market-data-v8`
- `generate-daily-report`
- `generate-daily-report-v7`
- `generate-sector-rotation`
- `get-report-payload`
- `line-daily-push`
- `line-webhook`
- `market-source-health-check`
- `opening-market-radar`
- `push-stats`

## Migrations

- `supabase/migrations/202606210001_p4_qa_engine.sql`
- `supabase/migrations/202606230001_opening_market_radar_source_contract.sql`
- `supabase/migrations/202606260001_market_data_snapshots.sql`
- `supabase/migrations/202606260002_opening_radar_degraded_metadata.sql`
- `supabase/migrations/202607100001_public_performance_journal_rpc.sql`

## Cron, workflow, and scheduler inventory

- Repo 內沒有 `.github/workflows`，無法由 GitHub Actions 驗證正式排程。
- `supabase/functions/cron-generate-report/index.ts`：每日報告排程入口。
- `supabase/functions/fetch-market-data-v10/index.ts`：市場資料 phase writer。
- `supabase/functions/opening-market-radar/index.ts`：開盤雷達 writer。
- `supabase/functions/closing-verification-engine/index.ts`：收盤驗證引擎。
- `supabase/functions/close-market-review/index.ts`：收盤回顧。
- `supabase/functions/line-daily-push/index.ts`：LINE 每日推播。
- `src/services/systemHealthService.ts`、`src/hooks/useSystemHealthCheck.ts`、`src/hooks/useSystemHealthDashboard.ts`：前端健康檢查與排程狀態呈現。
- `project_plan.md` 提及 cron-job.org；外部 cron-job.org 任務不在 Git 版控內，本次無法由 repo 驗證實際 schedule、URL 或最近執行結果。
- `scripts/market-status-test.mjs`、`scripts/canonical-narrative-test.mjs`：本機資料模型檢查腳本，不是正式 scheduler。

## Report engine core files

- `supabase/functions/generate-daily-report-v7/index.ts`
- `supabase/functions/fetch-market-data-v10/index.ts`
- `supabase/functions/fetch-global-market-news/index.ts`
- `supabase/functions/opening-market-radar/index.ts`
- `supabase/functions/generate-sector-rotation/index.ts`
- `supabase/functions/closing-verification-engine/index.ts`
- `supabase/functions/close-market-review/index.ts`
- `supabase/functions/get-report-payload/index.ts`
- `supabase/functions/line-daily-push/index.ts`
- `supabase/functions/_shared/market-status.ts`
- `src/services/resolveActiveReport.ts`
- `src/lib/morningAlphaReportAdapter.ts`
- `src/lib/morningAlphaDisplayState.ts`
- `src/lib/canonicalNarrative.ts`
- `src/services/intradayTrackingResolver.ts`
- `src/types/report.ts`

## Performance data source

- Page：`src/pages/performance/page.tsx`
- Public RPC：`public.get_public_performance_journal(p_limit integer default 90)`
- Migration：`supabase/migrations/202607100001_public_performance_journal_rpc.sql`
- Frontend call：`supabase.rpc('get_public_performance_journal', { p_limit: 90 })`
- Performance 頁目前透過最小權限 RPC 讀取公開績效資料，不直接由 anon 查完整 `reports`。

## War Room core files

- Page：`src/pages/war-room/WarRoom.tsx`
- Market status source：`src/utils/tradingDay.ts` 的 `resolveMarketStatus()`
- Display state：`src/lib/morningAlphaDisplayState.ts`
- Active report resolver：`src/services/resolveActiveReport.ts`
- Report adapter：`src/lib/morningAlphaReportAdapter.ts`
- Intraday resolver：`src/services/intradayTrackingResolver.ts`
- Observation UI：`src/components/v11/V11ObservationSection.tsx`
- War Room 目前以 `resolveMarketStatus()` 判斷非交易日，並保留 Decision Monitor 與 Observation V2 欄位相容性。

## Standard validation commands

依 `package.json` 實際 scripts：

```bash
npm run type-check
npm run build
npm run lint
git diff --check
git status -sb
git diff --name-only
```

Edge Function 修改時另依 function 與本機工具狀態執行對應 Deno check 或既有驗證方式；不得自行假設所有 function 共用同一驗證命令。

## Known risks

- GitHub CLI 已登入且 API 驗證成功；後續仍需依任務授權範圍使用 `gh` 查詢或執行 GitHub 操作。
- 外部 cron-job.org 任務不在 repo 內，Git 無法證明正式排程是否存在、是否啟用或最近是否成功。
- Repo 沒有 `.github/workflows`，GitHub push 不代表 Edge Functions 會自動部署。
- Repo 根目錄存在 `.env`；本次未讀取其內容。必須持續避免提交或輸出任何 secret。
- `supabase/config.toml` 只列出部分 functions 的 JWT 設定，其他 function 的正式部署設定需在部署前逐支核對。
- `src/data/mockDailyReport.ts`、`src/mocks/reportData.ts` 與部分舊版 report services 仍存在；正式資料鏈修改時需確認沒有把 mock 或 legacy fallback 帶入公開頁。
- 專案同時保留 legacy 與 V7/V10/V11 資料結構；任何 contract 修改都必須維持舊報告相容性。
- 初始化工作只建立規則與盤點文件，沒有執行 runtime、build、type-check、lint、遠端 Supabase 或 Readdy 驗證。

## Initialization safety record

- 修改產品功能：否
- 修改 `src/`：否
- 修改 `supabase/`：否
- 修改 package files：否
- 安裝依賴：否
- Commit：否
- Push：否
- Deploy：否
- Migration：否
- Cron 修改：否
