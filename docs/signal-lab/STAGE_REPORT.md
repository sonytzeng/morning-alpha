# Signal Lab V1 — Stage Report

Report date: 2026-09-05 (Asia/Taipei)

## Stage status

| Stage | Status | Evidence |
|---|---|---|
| 1 — Data audit | `PASS` | Production was inspected read-only; actual history, gaps and licensing limits are documented. |
| 2 — Data foundation | `PASS_CODE` | Migration, indexes, RLS/FORCE RLS, immutable ledgers, data-quality gate, versioning and hashes exist. Production migration was not applied. |
| 3 — Engines | `PASS` | Deterministic Institutional, Technical, Market Regime and Cross Signal engines have unit coverage. |
| 4 — Backtest | `INSUFFICIENT_DATA` | Engine and synthetic calculation tests exist; no real performance result is published. |
| 4A — Validity | `INSUFFICIENT` | Historical `available_at`, corporate actions, adjusted methodology and historical universe are not proven. |
| 4B — Edge | `UNPROVEN` | Sample size is zero; no baseline or score-calibration claim is made. |
| 5 — Shadow | `PASS_CODE` | Immutable/idempotent prediction and forward-outcome infrastructure exists with zero Production integration. |
| 6 — Owner UI | `PASS_CODE` | `/signal-lab` reads only the server-verified admin API and has safe loading/unavailable states. |
| 7 — QA | `PASS_WITH_LOCAL_BUILD_ENVIRONMENT_LIMIT` | Typecheck, lint, public tests, Deno checks and Signal Lab tests pass. Local Vite transform is subject to the repository's File Provider I/O stall; CI is authoritative. |
| 8 — Draft PR | `PENDING` | Created only after final diff review, commit and CI. |

## Data state

```text
TWSE_OHLCV = UNAVAILABLE
TPEX_OHLCV = UNAVAILABLE
INSTITUTIONAL = UNAVAILABLE
TAIEX = PARTIAL_CHECKPOINT_QUOTES_ONLY
HISTORY_RANGE = 2026-06-26..2026-09-04 (not valid daily research history)
DATA_COVERAGE = 0% for the strict Signal Lab contract
```

## Validity statement

The existing Production quotes cannot be relabelled as daily OHLCV. Synthetic fixtures prove only deterministic calculations and safety gates. They are not evidence of historical hit rate, expectancy, profit factor, excess return, score calibration, or investment edge.

## Production isolation

Signal Lab does not write or import Production recommendations, reports, LINE, Premium, Content OS, Emma, Auth, or PR #100 features. No deployment, migration, schedule, secret, or Production row is changed by this development branch.
