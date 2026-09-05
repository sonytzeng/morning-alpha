# Signal Lab V1 — Data Acquisition and Historical Validation

Audit run: 2026-09-05 (Asia/Taipei)

Branch: `feat/signal-lab-v1`

Production writes: none

## Decision

```text
DATA_ACQUISITION = PARTIAL_OFFICIAL_FORWARD_SAMPLE
HISTORICAL_BACKTEST = BLOCKED_BY_DATA_CONTRACT
SIGNAL_EDGE = INVALID_BACKTEST
REQUIRED_SECRET_UNAVAILABLE = YES
PAID_DATA_REQUIRED = YES (institutional history / point-in-time research coverage)
COMMERCIAL_LICENSE_DECISION_REQUIRED = YES (before Fugle-derived paid-product use)
```

The official free sources are sufficient for deterministic daily forward capture. They are not a five-year historical archive. The available Production tables are checkpoint evidence, not daily OHLCV. A real V1 historical performance claim is therefore blocked rather than inferred from one-day data or synthetic fixtures.

## Provider capability matrix

| Source | Actual capability verified | History | Adjustment / actions | `available_at` | Research decision |
|---|---|---|---|---|---|
| Production `market_data_snapshots` / `market_quotes` | checkpoint value/change observations | 2026-06-26..2026-09-04, sparse | none | `captured_at` for checkpoints | operational evidence only; not OHLCV |
| TWSE `STOCK_DAY_ALL` | current listed daily OHLCV and turnover | latest trading day only | raw/unadjusted | actual fetch time can be preserved | approved forward OGL candidate |
| TPEx `tpex_mainboard_quotes` | current OTC daily OHLCV and turnover | latest trading day only | raw/unadjusted | actual fetch time can be preserved | approved forward OGL candidate |
| TWSE `MI_5MINS_HIST` | TAIEX OHLC | current month only; no volume | none | actual fetch time can be preserved | incomplete for Market Regime engine |
| TPEx `tpex_3insti_daily_trading` | current foreign/trust and aggregate dealer fields | latest trading day only | not applicable | actual fetch time can be preserved | forward partial; dealer split absent in actual OpenAPI response |
| Fugle historical candles | documented listed/OTC daily history since 2010, indices since 2015; adjusted mode | technically adequate for OHLCV/TAIEX | adjusted candles supported | original publication ledger not proven by repository access | adapter ready; credential/plan and commercial rights unresolved |
| Finnhub | existing US checkpoint quotes | no approved Taiwan research history | contract-specific | provider timestamp only | not approved for Signal Lab history |

## Reproducible acquisition

Official OpenAPI acquisition is isolated under `/tmp` and never imports into Production:

```bash
deno run \
  --allow-net=openapi.twse.com.tw,www.tpex.org.tw \
  --allow-env=FUGLE_API_KEY \
  --allow-read=/tmp \
  --allow-write=/tmp \
  scripts/signal-lab/acquire-research-data.ts \
  --source official-latest \
  --output /tmp/morning-alpha-signal-lab-official-latest

node scripts/signal-lab/import-research-dataset.mjs \
  --dataset /tmp/morning-alpha-signal-lab-official-latest \
  --database /tmp/morning-alpha-signal-lab-research.sqlite
```

The manifest records source hashes, fetch time, adapter issues, isolation flags and the fail-closed quality verdict. The SQLite database is local research storage only.

## Actual official sample

Acquired from official APIs after the 2026-09-04 close:

```text
DATASET_ROWS = 3,691 normalized rows
OHLCV_ROWS = 2,121
INSTITUTIONAL_ROWS = 1,570 (foreign + trust only)
TAIEX_PARTIAL_ROWS = 4
SYMBOL_COUNT = 2,121
START_DATE = 2026-09-04
END_DATE = 2026-09-04
TRADING_DAYS = 1
MISSING_RATE = 0 within retained one-day cross-section; historical continuity unavailable
DUPLICATE_RATE = 0
INVALID_OHLC = 0 retained rows; 37 invalid/suspended source rows rejected by adapters
INVALID_VOLUME = 0 retained rows
INSTITUTIONAL_COVERAGE = 18.5054% of required symbol/date/type cells
TAIEX_COVERAGE = 0% of complete engine contract (OHLC present, volume absent)
CORPORATE_ACTION_STATUS = INCOMPLETE
AVAILABLE_AT_STATUS = UNPROVEN_FOR_HISTORICAL_REPLAY
SURVIVORSHIP_BIAS_RISK = PRESENT
```

The 0% historical missing claim is explicitly avoided: `MISSING_RATE = 0` only describes the retained one-day cross-section. It is not evidence of historical coverage.

## Adapter safety

- missing, blank and non-numeric fields are rejected; never converted to zero;
- ROC dates are normalized without browser locale or host timezone;
- non-stock alphanumeric securities are excluded from the V1 common-stock universe;
- official raw daily prices remain `adjustmentStatus = unavailable`;
- Fugle backfilled rows keep acquisition time as `availableAt` until an audited publication-time ledger exists;
- TPEx aggregate dealer flow is not relabelled as proprietary or hedge flow;
- TAIEX rows without volume remain partial and cannot enter `MarketRegimeEngine`;
- every acquired source is hashed and the raw response is retained only in the isolated `/tmp` dataset.

## Frozen V1 validity run

Command:

```bash
deno run --allow-read=/tmp --allow-write=/tmp \
  scripts/signal-lab/run-frozen-v1-validation.ts \
  --dataset /tmp/morning-alpha-signal-lab-official-latest
```

The command exits `4` by design when data validity fails. Actual result:

```text
BACKTEST_VALIDITY = INSUFFICIENT
BIAS_FLAGS = ADJUSTED_PRICE_METHODOLOGY_UNKNOWN,
             AVAILABLE_AT_UNPROVEN,
             CORPORATE_ACTION_HANDLING_MISSING,
             LOOK_AHEAD_BIAS_RISK,
             SURVIVORSHIP_BIAS_RISK
TRAIN = NOT_RUN_INVALID_DATASET
VALIDATION = NOT_RUN_INVALID_DATASET
OUT_OF_SAMPLE = NOT_RUN_INVALID_DATASET
WALK_FORWARD = NOT_RUN_INVALID_DATASET
V1_SAMPLE_SIZE = 0
ALL_PERFORMANCE_METRICS = NULL
ALL_BASELINES = NULL
SCORE_CALIBRATION = INSUFFICIENT
SIGNAL_EDGE = INVALID_BACKTEST
```

Synthetic tests still validate math, chronology, costs, calibration grouping and immutable outcome identity. They are not performance evidence.

## Hard stop evidence

The historical adapter was invoked with `FUGLE_API_KEY` explicitly unset. It returned exit code `3` and only:

```json
{"status":"blocked","code":"REQUIRED_SECRET_UNAVAILABLE","secretName":"FUGLE_API_KEY","secretValueLogged":false}
```

No key value was read or logged. Repository and local environment evidence do not establish the Production key's plan, historical entitlement, storage permission or derived-commercial rights.

The free official endpoints cannot supply five years of institutional history, historical universe membership, full corporate actions and TAIEX volume. A paid or separately licensed historical source is therefore required for a defensible whole-market V1 backtest.

## Data acquisition decision request

| Dataset | Provider candidate | Public price | License type | History | API | Commercial use | Why required | Expected signal value |
|---|---|---:|---|---|---|---|---|---|
| Adjusted TWSE/TPEx OHLCV + TAIEX | existing Fugle plan, if entitled | basic free; Developer NT$1,499/mo; Advanced NT$2,999/mo | provider/upstream exchange contract | stocks 2010+, index 2015+ | yes | legal confirmation required | technical/regime history | technical + market-regime validation |
| Per-stock foreign/trust/dealer proprietary/dealer hedge | enterprise or licensed Taiwan market-data vendor | quote required | commercial research/data license | target >= 5 years | required | must include internal model/storage rights | InstitutionalFlowEngine mandatory input | institutional attribution and cross-signal test |
| Historical universe + corporate actions | licensed Taiwan reference-data source | quote required | reference-data license | target >= 5 years | preferred | internal storage/derived analytics required | eliminate survivorship and action bias | backtest validity, not alpha by itself |

No purchase or plan upgrade was performed.

## Next safe action

1. Verify the existing Fugle account plan and historical endpoint entitlement without exposing the key.
2. Obtain written confirmation for internal historical storage, derived analytics and future paid-product use.
3. Select a licensed source for five-year institutional flows plus point-in-time universe/corporate actions.
4. Re-run the same immutable manifest, quality gate and Frozen V1 validity command.
5. Only after all gates pass, execute Train/Validation/OOS and walk-forward metrics without changing V1 parameters.
