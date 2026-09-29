# 9/29 Runtime Sparse Recovery — candidate evidence

Production predecessor: `2a5a8f1dd72db370a0eed787e96da5f48f9f5212`.
Exact live lifecycle definition MD5: `b8499733b0eb7ac12565594aecce9928`.
Candidate lifecycle definition MD5: `c0f2f9a050448d6810cfdda614626529`.

Only candidate migration:
`20260929145000_runtime_checkpoint_sparse_recovery_v1.sql`.
Function deployment: NONE. Cron/Auth/RLS/Secrets/data changes: NONE.
No historical business rows are modified by the migration.

## Real incident / fresh isolated replay

The 9/29 natural 14:10 and 14:30 Recorder captures each contain 11 valid
providers. Their original source timestamps, dates, IDs and input hashes are
retained in the sanitized fixture. Fixture SHA256:
`713f669627f92d5f3eae6791016e352bb0b72316a87087dbe58c43dd11a510aa`.

1410 correlation: `e73c95da-2afa-4f56-b724-3e0aa290c2d1`.
1430 correlation: `5e236416-961d-45e7-9770-1f6c7e0bbe40`.
TXF source timestamp: `2026-09-29T05:45:00.060Z` in both captures.

Before: the exact live RPC rejected current=0/requested=90 and 100.
After: the real unchanged Atomic RPC commits the exact original records;
the candidate lifecycle RPC admits 1410 sparse recovery then sequential 1430.
The actual authoritative reader exposes exactly 22 rows. Retry produces no
extra snapshot, batch or lifecycle success. The earlier failed premarket JSON
is byte-identical. Tomorrow's state is absent, not silently populated.

Negative local cases reject absent/partial batches, wrong date/checkpoint,
wrong correlation/idempotency, fabricated batch IDs, mixed correlations,
stale/future evidence, invalid sessions and stale/future commit timestamps.
Duplicate authoritative batches fail the existing database uniqueness rule.
SCHEDULED/RUNNING/SKIPPED predecessors do not qualify as terminal failures.
All ordinary sequential state transitions remain identical to the predecessor.
The Atomic definition, owner, ACL, defaults and search_path remain unchanged.

## Actual unchanged downstream Handler observations

A fresh schema-only local database was used, not Production business data.
The real Deno handlers and their actual SDK run against isolated PostgREST.
The network allowlist is loopback-only. Only local dummy credentials exist.

- `generate-sector-rotation`: HTTP 200, success=true, 4 real derived sector rows
  from the two genuine close batches (11 latest provider values).
- `generate-daily-report-v7`: HTTP 409, `RESEARCH_QUALITY_REJECTED`.
  Missing previous-trading-day 9/28 close evidence is not replaced with today's
  close evidence. The empty schema-only fixture also lacks full morning inputs
  and runtime policy. This is NOT a completed positive Report replay.
- `close-market-review`: HTTP 404, `REPORT_NOT_FOUND`.
- `closing-verification-engine`: HTTP 404, `MISSING_REPORT`, no_fake_data=true.
- `continuous-learning-engine`: HTTP 409, `CANONICAL_REPORT_MISSING`.
- `line-daily-push`, with a local fake token and all external dispatch blocked:
  HTTP 200, `NO_REPORT_FOR_TODAY`; no real LINE calls and no production token.
- Actual isolated Acceptance RPC: FAIL, readiness FAIL, delivery SLA FAIL.
  No next-day `trading_day_state` row was created. This is the expected negative
  history-preservation result, not a successful counterfactual full day.

These are expected safe rejections with no morning publication, not proof of a
new independent Product Bug and not a full successful Shadow certification.
Do not treat a data-absent test environment as a positive full-chain pass.

`FUGLE_RENEWAL_FULL_LIFECYCLE = NOT_PROVEN`.
Production migration admission still requires the separately requested complete
Shadow gate. The original 9/29 PREMARKET 0 / Report 0 / normal LINE 0 and failure
evidence remain untouched. No deployed fix, natural PASS, Closing success,
Learning success or Acceptance success is claimed by this artifact.

## Release test environment findings

Three existing DB suites failed solely because their synthetic holiday-return
positive control was dated 9/28, now beyond the genuine 08:45 deadline. Their
original real incident fixtures are unchanged. Only that synthetic control is
moved to the next configured holiday return, 10/12 (previous session 10/8).
No assertion or deadline is removed. This is TEST_FIXTURE_DRIFT, not a second
Product Bug. The new 9/29 exact-evidence regression instead uses an isolated
PostgreSQL process clock, retaining every real Recorder timestamp unchanged.
