# Signal Lab V1 — Data Audit

Audit date: 2026-09-05 (Asia/Taipei)
Repository base: `f611acf72f3ce7db2846d108b17d2e63022bca08`
Production project inspected read-only: `cttfzgvhiewfckydcrci`

## Executive gate

```text
OHLCV_STATUS = UNAVAILABLE_FOR_VALID_BACKTEST
INSTITUTIONAL_STATUS = UNAVAILABLE
MARKET_INDEX_STATUS = PARTIAL_CHECKPOINT_QUOTES_ONLY
HISTORY_RANGE = 2026-06-26..2026-09-04 (sparse checkpoint quotes)
LICENSE_STATUS = MIXED; OFFICIAL_OPEN_DATA_CANDIDATES_IDENTIFIED; COMMERCIAL_PROVIDER_REVIEW_REQUIRED
BACKTEST_FEASIBILITY = INSUFFICIENT
```

The repository can support deterministic engines, immutable research records, data-quality gates, synthetic calculation tests, and a forward Shadow pipeline. It cannot currently support a defensible historical whole-market backtest. No score or prediction may be emitted from missing inputs: `status = unavailable`, `score = null`.

## Current pipeline

```text
Finnhub (US quote) ─┐
Fugle (TW quote) ───┼─> fetch-market-data-v10
TWSE MIS fallback ──┘       │
                            ├─> market_data (latest mutable display row)
                            ├─> market_data_snapshots (checkpoint rows)
                            ├─> market_quotes (canonical checkpoint quote)
                            ├─> market_indices
                            └─> futures_snapshots
```

`fetch-market-data-v10` is optimized for Morning Alpha's daily decision checkpoints, not for daily historical research bars. It does not ingest a full TWSE/TPEx universe, corporate actions, historical membership, or per-symbol institutional flow.

## Production inventory

Read-only aggregate queries were used; no production rows were changed.

| Table | Rows | Symbols | Date range | Signal Lab suitability |
|---|---:|---:|---|---|
| `market_data_snapshots` | 1,672 | 36 | 2026-06-26..2026-09-04 | Checkpoint evidence only; not daily OHLCV |
| `market_quotes` | 582 | 24 | 2026-08-24..2026-09-04 | Current/change quotes; not daily OHLCV |
| `market_indices` | 272 | 7 | 2026-08-24..2026-09-04 | Partial index checkpoints |
| `futures_snapshots` | 110 | 1 | 2026-08-24..2026-09-04 | TXF checkpoint quotes only |
| `institutional_flows` | 0 | 0 | none | Unavailable |

For `market_quotes.raw_payload`, all inspected production rows lacked complete daily `open/high/low/close/volume`:

| Provider / market | Rows inspected | Complete OHLCV |
|---|---:|---:|
| Finnhub / US | 228 | 0 |
| Fugle / TW equity/index | 244 | 0 |
| Fugle futopt / TW future | 110 | 0 |

The `market_data_snapshots` and `market_quotes` required value/change fields were complete, but those fields cannot be re-labelled as OHLCV.

## OHLCV audit

```text
TWSE_OHLCV = UNAVAILABLE_IN_REPOSITORY_AND_PRODUCTION
TPEX_OHLCV = UNAVAILABLE_IN_REPOSITORY_AND_PRODUCTION
HISTORY_START = 2026-06-26 (checkpoint quote only)
HISTORY_END = 2026-09-04
ADJUSTED_PRICE = UNAVAILABLE
CORPORATE_ACTION_SUPPORT = UNAVAILABLE
MISSING_RATE = 100% FOR REQUIRED DAILY OHLCV CONTRACT
```

The production rows contain quote values at selected checkpoints. They do not provide a daily research bar with `trading_date/open/high/low/close/volume/available_at`.

Official forward-ingestion candidates exist:

- [TWSE listed daily trades](https://data.gov.tw/dataset/11549): daily open, high, low, close, volume and turnover; OGL v1.
- [TPEx closing quotes](https://data.gov.tw/dataset/11371): daily open, high, low, close, volume and turnover; OGL v1.
- [Fugle historical candles](https://developer.fugle.tw/docs/data/http-api/historical/candles/): technically offers historical and adjusted candles, but commercial storage/derived-display rights are not established by repository evidence.

No candidate has been added to Production in this branch. The open-data adapters are a future ingestion concern; this V1 branch provides a strict storage contract and blocks absent data.

## Corporate-action audit

| Event | Current canonical support | Backtest gate |
|---|---|---|
| Cash dividend | none | blocked unless adjusted series or verified factor exists |
| Stock dividend / rights | none | blocked unless verified factor exists |
| Split | none | blocked unless verified factor exists |
| Capital reduction | none | blocked unless verified factor exists |
| Suspension | only current ticker/provider hints; no historical ledger | affected periods blocked |
| New listing | no historical universe ledger | survivorship warning |
| Delisting | no historical universe ledger | survivorship warning |

Signal Lab adds contracts for append-only corporate actions and historical universe membership, but does not fabricate or backfill those rows.

## Institutional-flow audit

```text
FOREIGN_DATA = UNAVAILABLE
TRUST_DATA = UNAVAILABLE
DEALER_DATA = UNAVAILABLE
DEALER_HEDGE_SPLIT = SCHEMA_SUPPORTED, DATA_UNAVAILABLE
HISTORY_LENGTH = 0 DAYS
SOURCE = NONE INGESTED
```

The repository defines `public.institutional_flows`, but no active writer was found and Production contains zero rows. There is no evidence that the current Fugle integration calls ownership/after-hours endpoints.

Official forward-ingestion candidates:

- [TPEx three-institution per-stock detail](https://data.gov.tw/dataset/11856), including dealer proprietary and hedge splits.
- TWSE official per-stock institutional endpoints require an explicit dataset/availability contract before implementation; no repository ingestion exists today.

Until a legally approved source is ingested with `available_at`, `InstitutionalFlowEngine` returns `unavailable` and Cross Signal emits no signal.

## Availability-time audit

Existing quote tables record `captured_at`, which is adequate for point-in-time checkpoint evidence. They do not prove when historical daily candles, institutional flows, universe membership, or corporate actions became available to a model.

Signal Lab V1 therefore requires `available_at` on every research input and rejects any input where:

```text
available_at > signal_timestamp
```

This is enforced in engine contracts and bias tests. A `trading_date` alone is never treated as proof of contemporaneous availability.

## Historical universe and survivorship

The repository does not preserve the listed/OTC universe as it existed on each historical date. Selecting today's listed securities and replaying prior dates would create survivorship bias.

```text
SURVIVORSHIP_BIAS_RISK = PRESENT
```

Historical claims remain blocked until membership history exists. Forward Shadow Mode may use a universe snapshot captured before each prediction and preserve it immutably.

## Data-quality rules

Signal generation is blocked when any critical rule fails:

- duplicate symbol/date observations;
- missing trading dates required by the feature window;
- impossible OHLC (`high < open/close/low` or `low > open/close/high`);
- non-positive prices or negative volume;
- input `available_at` after the signal timestamp;
- stale institutional data;
- unresolved corporate action inside the feature window;
- unknown trading calendar state;
- insufficient eligible-universe coverage.

Coverage is saved as `eligible_universe`, `analyzed_count`, `complete_count`, and `coverage_ratio`. A low-coverage run may not be labelled “全市場 Top 5”.

## Determinism and AI boundary

| Layer | Deterministic | AI |
|---|---|---|
| Provider normalization | yes | no |
| Data-quality gate | yes | no |
| Institutional features | yes | no |
| Technical indicators | yes | no |
| Market regime | yes | no |
| Cross Signal score | yes | no |
| Reason codes | yes | no |
| Future plain-language rendering | must preserve reason codes | optional, not in V1 |

## Stage 1 conclusion

Stage 1 passes because the actual limits are known and recorded. Historical performance remains `INSUFFICIENT`; this is not converted into a fake backtest. Development continues through deterministic engines and Shadow infrastructure while Production impact remains zero.
