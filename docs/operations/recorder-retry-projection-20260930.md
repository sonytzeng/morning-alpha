# Recorder 08:45 Projection candidate — 2026-09-30

## Scope and exact cause

Sony authorized candidate / fresh isolation / Commit / Push / PR / GitHub CI only.
Production execution needs separate approval. No Edge Function, Cron, Auth/RLS,
Secret, business contract or historical data change is part of this candidate.

`RECORDER_PROJECTION_REPLAY_DRIFT` is confirmed, not a Deadline business failure.
The deployed SQL projection's finite object-key allowlist drops all thirteen
`premarket_readiness_retry_HHMM` entries from `checkpoint_status`. The Retry
Dispatcher produces those keys correctly. Neither cleanup nor the terminal
business rule is responsible. Dispatch `correlation_id` and `retry_count` also
need to be retained as observation context, without changing their producer.

Exact reproducer (local Shadow running Production code and the hash-identical
Production SQL predecessor; NOT represented as a real Production raw capture):

- Evidence ID: `a115e332-cabe-42af-b0f6-2d7ccc151bf8`.
- SOURCE_EVENT: second `advance_trading_day_state_v1` SCHEDULED call for
  `2026-09-30 / premarket_readiness_retry_0845`, with original request correlation
  `4f3a25ef-ec47-4608-9094-b3c32a52167b`.
- EXPECTED_RECORDER_ROW: the input and expected output keep the existing
  `checkpoint_status.premarket_readiness_retry_0845` entry, including its original
  SCHEDULED status/correlation; duplicate scheduling preserves the first state.
- ACTUAL_RECORDER_ROW: that entry is absent from both projected read-set and
  projected expected state. `last_correlation_id` itself was already retained.
- MISSING_FIELD_OR_PATH:
  `database_inputs.tables.trading_day_state[0].checkpoint_status.premarket_readiness_retry_0845`.
- CORRELATION_BEFORE (original result's last correlation):
  `1fbeb9d8-99ad-4989-91f3-e3f2a9ccb914`.
- CORRELATION_REPLAY (old lossy projection):
  `4f3a25ef-ec47-4608-9094-b3c32a52167b`.

With the state entry missing, replay executes a new SCHEDULED transition instead
of the existing-checkpoint idempotent branch. That is the exact one-field diff.
Production read-only function metadata matched the three predecessor hashes
guarded by the migration; no Production business data was modified.

## Sole migration and unchanged privileges

`20260930080719_recorder_retry_projection_parity_v1.sql` changes only:

1. `project_critical_sql_input_v1`: thirteen exact bounded Retry keys and count.
2. `critical_sql_replay_inputs_v1`: original dispatch identity/count, projection
   version, and a minimal current-day provider failure classification.
3. `record_critical_contract_evidence_v1`: immutable source event identity,
   explicit original correlation, attempt metadata and capture origin.
4. One partial unique source-event index on the existing private Recorder table.

No wildcard admission; no 08:40 or 08:50 Retry. No business SQL function changed.
Fresh DB verifies every other public function hash and all function owner, ACL,
security, defaults and search_path values remain unchanged. Existing RLS and
append-only behavior remain unchanged. Recorder storage errors remain fail-open.

Each 08:45 scheduling observation says `FINAL_DEADLINE_ATTEMPT` and
`AT_FINAL_DEADLINE`; its `DISPATCHED` state is the actual pre-handler observation,
not a fabricated assertion that the handler has already terminated. The actual
unchanged Orchestrator is separately executed and verified as terminal FAILED
with deadline reached, zero Atomic/Report/normal LINE and one incident alert.

## Replay / evidence honesty

New SQL evidence is labelled `CRITICAL_SQL_RETRY_PROJECTION_V2`. Captures retain
`source_correlation_id`; offline replay keeps the same source identity and has
a different `replay_execution_id`. The isolated runner labels `REPLAY` and sets
the Recorder origin to REPLAY so it cannot append a fake PRODUCTION_CAPTURE.
Shadow inputs/captures are labelled SHADOW_CAPTURE. The replay runner never
rewrites source evidence and compares its before/after fingerprint.

Record-once means the same exact source event cannot be duplicated; two actual
dispatch attempts retain two distinct genuine observations. Replay creates no
third original observation. Old incomplete state capsules are preserved and
classified `LEGACY_RECORDER_PROJECTION_INCOMPLETE`, never reconstructed as fake
historical 08:45 evidence. Args-only Publication validation does not use the
Lifecycle state projection and is replayed according to its own unchanged SQL
signature/read-set.

## Verification

- Stock PostgreSQL 17 fresh schema: all 13 slots × 2 real dispatch attempts =
  26 captures; exact SQL execution replay, all four requested diffs zero.
- Existing business function bodies, function privileges and RLS unchanged;
  duplicate migration rejected by exact predecessor guard; 90-day retention,
  append-only, cleanup preservation, secret/PII rejection, Recorder fail-open.
- Six isolated real-handler regressions: 429 at 07:40, timeout at 08:00,
  malformed at 08:30, 500 at 08:35 recover once; 403 remains non-retryable;
  unresolved 08:45 and duplicate schedule retain zero business output / alert
  once. Recoveries after 07:30 retain SLA MISS. All external LINE blocked.
- SQL replay of those same new capsules: 32/32 deterministic; source unchanged.
- Affected retained-history / Recorder tests: 49/49; 9/29→9/30 Research: 6/6.
  The 9/21, 9/22, 9/23, 9/24, 9/29 and 9/30 incident controls remain intact.
- Type-check and lint: PASS. Build: PASS in the clean Node 22 validation tree;
  271 source/config/package inputs verified byte-identical. The original local
  build process stalled; no product/dependency/config workaround was committed.
- Exact successor Integrity manifest retains the entire six-bug predecessor,
  expected file set and hashes. GitHub CI is required before final approval.

No large Chaos / 1000 faults / five-day certification was rerun. No Production
migration, function deployment, business invocation or historical recovery.

## Requested eventual release

Only the named migration, after this PR passes required GitHub gates and Sony
separately authorizes Production. No Function and no Cron. Read-only smoke then
checks exact Recorder function hashes, unchanged business/privilege hashes,
immutable old evidence and historical FAIL fingerprints; no manual business run.
