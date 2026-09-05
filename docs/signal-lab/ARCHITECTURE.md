# Signal Lab V1 — Architecture

## Boundary

Signal Lab is a parallel research system. It does not import from, write to, or change the Production Recommendation contract, daily report, LINE, Premium gate, Content OS, Emma, or PR #100 features.

```text
Approved point-in-time inputs
  -> DataQualityGate
  -> InstitutionalFlowEngine
  -> TechnicalAnalysisEngine
  -> MarketRegimeEngine
  -> CrossSignalEngine
  -> immutable signal_lab_signal_predictions
  -> horizon maturity
  -> signal_lab_signal_outcomes
  -> Backtest / Forward Test metrics
  -> owner-only signal-lab-api
  -> /signal-lab
```

## Why table prefixes are used

The existing repository places server-owned canonical tables in the `public` schema and accesses them through Supabase's PostgREST client from Edge Functions. A private `signal_lab` schema would either need to be exposed to the Data API or require a new RPC-only access layer. V1 uses explicit `signal_lab_*` prefixes to avoid changing the project's Data API schema configuration.

Every Signal Lab table:

- has RLS and FORCE RLS enabled;
- revokes access from `PUBLIC`, `anon`, and `authenticated`;
- grants server access only to `service_role`;
- is exposed to the browser only through an Edge Function that validates the authenticated user and `profiles.role = admin` server-side.

## Input truth contract

All observations carry:

- `provider`
- `source_dataset`
- `trading_date`
- `available_at`
- `source_ref`
- `source_hash`

The point-in-time input boundary also requires an immutable TWSE/TPEx trading calendar. Missing sessions are evaluated against that calendar; weekends, exchange holidays, weather closures, and absent provider rows are never conflated.

Input timestamp is part of the prediction snapshot. A row is rejected when its `available_at` is after the signal timestamp. Corporate actions and historical universe membership are first-class contracts, not ignored footnotes.

## Scores

V1 weights are transparent and versioned:

```text
Technical       40%
Institutional   35%
Volume          15%
Market Regime   10%
```

They are a research hypothesis, not a permanent production rule. If any mandatory component is unavailable or blocked, Signal Lab emits no `signal_score`.

Labels are research language only:

```text
STRONG_POSITIVE
POSITIVE
NEUTRAL
NEGATIVE
STRONG_NEGATIVE
```

`BUY` and `SELL` are intentionally absent.

## Explainability

All explanations originate in deterministic reason codes. No LLM creates causal claims. A future translation layer may render a reason code in zh-TW but must not add evidence or change direction.

## Prediction and outcome lifecycle

- A prediction is immutable after insertion.
- Same input hash + strategy + feature version returns the same calculation.
- A changed input hash creates a distinct calculation version; it never overwrites the prior prediction.
- Outcomes mature at 1D/5D/10D/20D/60D and may be updated from pending to complete.
- Backtest experiments save every parameter set and its validity/edge status.

## Backtest gate

No historical performance is published unless all are proven:

- point-in-time `available_at`;
- no future pivot leakage;
- corporate-action treatment;
- historical universe membership;
- train/validation/out-of-sample separation;
- non-zero versioned transaction costs.

The current repository fails this gate because those historical inputs do not exist. Synthetic tests validate calculations only; they are never presented as investment performance.

## Shadow gate

Shadow infrastructure is safe to merge while remaining inactive:

- no Cron is added;
- no Function is deployed;
- no Production migration is applied;
- no Production recommendation reads Signal Lab tables;
- the owner UI shows `尚無足夠資料` until the strict contracts are satisfied.
