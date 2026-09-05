# Signal Lab V1 — Shadow Runbook

## Current activation state

```text
PRODUCTION_MIGRATION = NO
FUNCTION_DEPLOY = NO
CRON = NO
PRODUCTION_RECOMMENDATION_IMPACT = ZERO
```

The Shadow pipeline is implemented but intentionally inactive. It must not be scheduled or deployed from this branch. A future activation requires separate approval for the migration, the three Signal Lab Functions, licensed input ingestion, and operational scheduling.

## Runtime sequence

```text
licensed point-in-time input ingestion
  -> immutable daily prices / institutional inputs / trading calendar / universe / actions
  -> signal-lab-shadow
      -> strict Data Quality Gate
      -> institutional, technical and market-regime features
      -> Cross Signal
      -> immutable prediction or zero output
  -> wait for a real trading-horizon maturity
  -> signal-lab-outcomes
      -> evidence-aligned 1D / 5D / 10D / 20D / 60D outcomes
  -> owner-only signal-lab-api
  -> /signal-lab
```

## Preconditions for any non-local run

- The migration was applied to the intended non-Production test project and all tables have RLS plus FORCE RLS.
- Each input dataset has an approved commercial-use decision and attribution contract.
- `available_at`, source reference, source hash, historical universe and Taiwan trading-calendar rows are complete.
- OHLCV is adjusted or explicitly `not_required`; unresolved corporate actions block scoring.
- Coverage is at least 70%; a missing required component yields `score = null` and no prediction.
- Function JWT verification remains enabled.
- The caller is service role or an authenticated server-verified admin.

## Safe test order

1. Apply the migration to an isolated test project only.
2. Ingest a fixed, licensed fixture with point-in-time provenance.
3. Invoke `signal-lab-shadow` once and record the run and prediction counts.
4. Invoke it again with identical input; expect the existing run and zero duplicate predictions.
5. Change one input revision; expect a higher calculation version and preservation of the prior prediction.
6. Advance only fixture time and add real maturity prices before invoking `signal-lab-outcomes`.
7. Repeat outcome evaluation; expect zero duplicate horizon rows.
8. Verify anon/authenticated clients cannot read or write any `signal_lab_*` table.

## Stop conditions

Do not activate when any of the following is true:

- a provider license is `LEGAL_REVIEW_REQUIRED`;
- point-in-time availability cannot be proven;
- the trading calendar or historical universe is absent;
- corporate-action adjustment is unresolved;
- coverage is below the threshold;
- deployment would require changing Production recommendations, daily reports, LINE, Premium, Content OS, Emma, Auth, or PR #100.

## Promotion boundary

Engineering completion does not prove investment edge. Promotion beyond internal Shadow Mode requires adequate out-of-sample and forward samples across market regimes, baseline outperformance, score calibration, an independent review, and separate Production approval.
