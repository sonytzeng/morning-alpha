# 9/21 Production vs Certified Parity Report

Status: confirmed Production parity failure; no Production mutation performed.

## Production timeline (Asia/Taipei)

- 06:50 preflight: Global 8 PASS, TXF PASS, TAIEX/2330 WAITING (`PROVIDER_DATA_NOT_READY`).
- 07:00–07:30: every market refresh rejected the previous-session TAIEX/2330 payloads; Atomic remained 0.
- 07:35: TAIEX/2330 provider failures disappeared and all 11 provider slots passed the Edge assembly validator. The DB RPC rejected the batch with `ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID`.
- 07:40–08:35: scheduled retries continued and reached the same DB rejection.
- 08:45: the readiness deadline produced the safe terminal failure and data-incident delivery. No PREMARKET batch, snapshot, or report was created.

## Layer parity

| Layer | Production evidence | Certified behavior | Parity |
| --- | --- | --- | --- |
| 06:50 Preflight | Accepted TXF after-hours evidence across the weekend | Shared Edge validator accepts up to seven-day PREMARKET evidence | Yes at Edge layer |
| 07:00 Fetch | Rejected old TAIEX/2330 until current ticker dates appeared | Same provider adapters are deployed from main | Yes |
| Provider Adapter | TAIEX/2330 became valid at 07:35; TXF stayed on the latest after-hours session | Same adapters and mappings | Yes |
| Readiness/Freshness | Edge assembly accepted 11 rows at 07:35 | Local validator accepted equivalent PREMARKET rows | Yes within Edge code |
| Retry Orchestrator | Natural retries ran after 07:30 through 08:45 | Bounded retry model | Yes |
| Pipeline Deadline | `pipeline_runs.deadline_at=07:30` retained delivery SLA metadata | Certification expects late recovery to retain SLA MISS | Yes; does not gate retry |
| Atomic DB Contract | Rejects every TW row whose source timestamp calendar date differs from business date | DB tests rewrote all TW source timestamps to the synthetic business date | No |
| Report trigger | Not eligible because Atomic remained 0 | Report only follows committed 11/11 | Yes |
| Daily Delivery | Recorded dependency failures while evidence was absent | Safe fail | Functionally safe, but state labels are noisy |
| Final Deadline | Dispatches and DB readiness boundary use 08:45 | 08:45 terminal deadline | Yes |

## Exact rejected contract

- Provider: `TXF`
- Field: `source_timestamp` / `captured_session_date`
- Production session: Fugle futures `afterhours`
- Provider session date: `2026-09-18`
- Source timestamp: `2026-09-19 05:00:00 Asia/Taipei`
- Intended evidence business date: `2026-09-21`
- Existing DB expectation: every TW source timestamp must have calendar date `2026-09-21`
- Correct expectation: TAIEX/2330 remain same-business-date; TXF PREMARKET after-hours must preserve the real timestamp and validate its session-to-business-date lineage.

This conclusion is exhaustive: the Edge assembly already validated provider identity, positive values, numeric changes, source presence, seven-day freshness, capture identity, provider set, and row cardinality. TAIEX/2330 normalize their newly-current ticker dates to 2026-09-21. The only stricter DB-only predicate left is the blanket TW same-calendar-date check, and TXF is the only Taiwan row whose legitimate Monday premarket session crosses the weekend.

## Why certification missed it

Classification:

- `ATOMIC_CONTRACT_DRIFT`: Edge and DB enforced different PREMARKET Taiwan timestamp rules.
- `FIXTURE_NOT_REPRESENTATIVE`: the DB chaos test replaced every TW source timestamp with the synthetic business date before commit.
- `RUNTIME_ORCHESTRATION_DRIFT`: the Full-Day fixture retained the weekend TXF timestamp but did not exercise that exact row through the Production DB Atomic predicate.

The synthetic Full-Day fixture for 2026-09-21 already contained TXF source time `2026-09-18T21:00:00Z` (2026-09-19 05:00 Asia/Taipei), but the DB gate test used a transformed same-date timestamp. The split let both suites pass independently while the real combined path failed.

## Required minimal candidate

1. One additive migration must update `commit_market_checkpoint_batch_v1` so only TXF PREMARKET after-hours evidence can use its real cross-calendar session timestamp. TAIEX/2330 same-date protection, 11-provider cardinality, Atomic transactionality, and 08:45 deadline remain unchanged.
2. Shared TXF validation must bind the provider session date to the intended trading business date and reject stale or mislabeled sessions.
3. Edge and DB validators must return the same provider/field classification for an invalid row.
4. The 9/21 fixture must pass through Provider Adapter -> Readiness -> Retry -> DB Atomic -> Report decision without rewriting timestamps.
5. While Atomic is absent, the orchestrator must retain `WAITING_FOR_PROVIDER_DATA` / Atomic-contract state and avoid reporting a synthetic `regenerate_report` failure.

## Historical preservation

The read-only audit observed zero 2026-09-21 PREMARKET batches, zero PREMARKET rows, and zero reports. This report does not recover or rewrite 9/21.
