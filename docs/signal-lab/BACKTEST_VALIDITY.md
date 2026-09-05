# Signal Lab V1 — Backtest Validity

## Current verdict

```text
BACKTEST_VALIDITY = INSUFFICIENT
SIGNAL_EDGE = UNPROVEN
```

This is a data-lineage verdict, not an engine failure.

## Required evidence and current state

| Gate | Requirement | Current state |
|---|---|---|
| Look-ahead | every input has `available_at <= signal_timestamp` | absent for historical OHLCV/institutional data |
| Corporate actions | adjusted series or verified action factors | absent |
| Universe | membership as known on each signal date | absent |
| OHLCV | daily complete bars, adequate lookback | absent |
| Institutional | foreign/trust/dealer history with publication time | absent |
| Cost | versioned commission, tax, slippage | architecture ready |
| Split | train/validation/out-of-sample | engine ready, real data unavailable |
| Baselines | TAIEX, random eligible, simple momentum | engine contract ready, real data unavailable |

## Prohibited claims

Synthetic fixtures may validate math, idempotency, leakage guards, score calibration grouping, and cost application. They do not establish hit rate, expectancy, profit factor, or excess return.

No CAGR is calculated because there is no complete portfolio strategy.

## Forward validation path

The defensible path is to ingest legally approved daily observations prospectively, preserve their availability and universe snapshots, emit immutable Shadow predictions, then evaluate outcomes as horizons mature. Until sample size spans multiple regimes, `SIGNAL_EDGE` remains `PENDING_TIME` or `UNPROVEN`.
