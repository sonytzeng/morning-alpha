# PRODUCTION_INCIDENT_REPLAY_RUNBOOK

## Purpose

Use retained, deidentified Provider Evidence to reproduce the exact provider and
market-contract decision without contacting Fugle, Finnhub, TWSE, LINE, or any
other external service. Recorder rows are observability data only. They never
authorize a Snapshot, Report, Recommendation, LINE delivery, Closing, Learning,
or Acceptance write.

## Capture contract

`production_provider_evidence` contains one immutable row per required provider
and attempt. Relevant checkpoints are `readiness_0650`, `PREMARKET` (07:00 and
bounded retries), `0900`, `0930`, `1030`, `1300`, `1410`, and `1430`. The close
checkpoints contain the provider evidence required by Closing.

Each row records business/checkpoint identity, recovery and transport attempts,
provider/symbol/endpoint class, envelope and evidence-session dates, source
timestamp, normalized session, phase, freshness and contract result, adapter and
contract versions, normalized evidence, response shape, sanitized payload hash,
and the minimum sanitized replay payload.

The recorder strips credential, token, cookie, recipient, member, contact, and
other sensitive keys before hashing or insertion. It has a 128 KiB database
bound per row, an 11-row bound per invocation, and a 1.5-second background-write
bound. Recorder failure is logged as an observability failure and cannot change
the business response.

## Incident workflow

1. Locate the incident by `business_date`, `checkpoint`, `attempt`, and
   `correlation_id`. Preserve every retry row; do not select only the latest.
2. Confirm `provider_key` covers the expected 11-provider set for that attempt.
3. Export only the `replay_payload`, contract metadata, and hashes to an isolated
   workspace. Never export Production credentials or member data.
4. Run the repository replay tool:

   ```sh
   node scripts/replay-recorded-provider-evidence.mjs /absolute/path/to/sanitized-evidence.json
   ```

5. Compare the replayed adapter, normalization, freshness, contract result, and
   Atomic candidate result with the stored values. A mismatch is an exact
   Contract Diff and must become a regression fixture before a product fix.
6. Classify the root cause. Never call a provider again to replace the incident
   evidence, and never synthesize a missing Production response.
7. Keep incident exports deidentified and delete temporary local exports after
   the regression evidence is reviewed.

## Retention and cleanup

Rows are retained for at least 90 calendar days (more than 30 trading days under
normal calendars). Cleanup is manual/service-role-only, bounded to 5,000 expired
rows per call, and can delete only rows whose `retention_until` has passed and
whose `recorded_at` is at least 90 days old:

```sql
select public.cleanup_expired_production_provider_evidence_v1(1000);
```

There is no new Cron. Cleanup touches only the recorder table.

## Historical gap: 2026-09-23 morning

The full 06:50 and 07:00 raw Provider responses were not retained before this
recorder existed. Their permanent status is `REAL_RAW_EVIDENCE_NOT_RETAINED`.
Metadata and hashes may be used as historical facts, but no synthetic payload may
be presented as real 9/23 Production evidence. The 9/23 morning outcome remains
FAIL regardless of later checkpoints.
