# Morning Alpha Production Architecture v1

Status: production candidate  
Release order: migration → Edge Functions → site → replay verification

## Objective

Scale the current modular monolith to 10,000 paid subscribers without replacing
the proven report, LINE delivery, closing verification, or continuous-learning
contracts. All new paths are additive, fail-closed, traceable, and reversible.

## Runtime contracts

- `runtime_quality_policies` is the single database policy source. The matching
  pure runtime constant is `MA_RUNTIME_POLICY_V1`.
- Premium content remains fail-closed below 90. The existing database triggers
  now read the active policy instead of embedding a separate threshold.
- Every collection and report request carries a UUID correlation ID.
- `publish_decision_snapshot_v3` preserves the immutable v2 decision snapshot
  and adds an idempotent `pipeline_runs` record.
- Low coverage, low confidence, missing critical evidence, or a closed market
  produces explicit abstention metadata. Evidence-backed no-trade remains a
  valid premium outcome; unsafe output is blocked and enters safe mode.

## Canonical data layer

`fetch-market-data-v10` dual-writes the existing tables and the provider-neutral
canonical tables:

- `market_quotes`, `market_indices`, `futures_snapshots`
- `institutional_flows`, `macro_events`, `news_events`
- `company_events`, `earnings_events`, `market_snapshots`
- `data_provider_health`

Legacy readers remain unchanged during the cutover. Canonical writes are
observed before any later reader migration.

## Decision and learning lifecycle

- `strategy_registry` isolates candidate, shadow, production, retired, and
  rollback states. Promotion requires admin identity, 20 shadow samples, and a
  passing replay score.
- `strategy-replay-engine` is dry-run by default and replays only the active
  registered strategy. A weekly isolated workflow persists accuracy, Brier
  score, and historical similarity evidence.
- Existing continuous-learning rules remain the only production confidence
  adjustment path. Candidate and shadow strategies cannot affect delivery.

## Reliability and cost

- `runtime_cost_usage` and `check_runtime_cost_budget_v1` enforce a daily OpenAI
  call/token budget. An unavailable guard fails closed to deterministic output.
- `runtime_dead_letters` records exhausted idempotent recovery attempts.
- `ma-ops-safe-recovery` exposes only five allowlisted actions, defaults to
  dry-run, requires explicit approval, and writes a before/after audit row.
- `runtime_slo_definitions` and `runtime_slo_measurements` hold report,
  delivery, payload, and closing-verification objectives.

## Subscriber traffic

- Supabase Realtime remains the primary dashboard update path.
- Active-market polling is 120 seconds; off-hours and hidden-tab polling is 15
  minutes.
- Report payload and history requests share in-flight promises and a short
  user-scoped cache. Tokens never enter cache keys or logs.

## Security

- All architecture tables use forced RLS and are service-role only by default.
- `user_market_preferences` is the only direct client table and is restricted
  to `auth.uid() = user_id` for every operation.
- All security-definer functions use an empty search path and explicit object
  qualification. Execution is revoked from public, anonymous, and authenticated
  roles.

## Release and verification

1. Merge only after type-check, lint, public tests, and production build pass.
2. Run the migration workflow and confirm the new migration is applied.
3. Run the deploy workflow and confirm all Edge Functions deploy.
4. Invoke market collection with a correlation ID and verify canonical writes.
5. Invoke a non-dry strategy replay and verify its persisted run.
6. Verify the public site, tier-trimmed payload, RLS, provider health, pipeline
   linkage, cost usage, and SLO measurement.

## Rollback

- Application rollback: redeploy the previous commit. Legacy tables and readers
  remain intact.
- Strategy rollback: promote the registered rollback target; never overwrite
  historical decisions.
- Data rollback: stop canonical dual-writes. Additive tables remain private and
  can be retained for audit. Do not drop them during an incident.
- Cost or provider incident: retain deterministic output, activate safe mode,
  and use only the audited allowlisted recovery executor.
