# Production incident 2026-09-08 — controlled repair

## Scope and immutable truth

Approval: user attachment `d36741d2-5b6d-403e-b1f7-87f50bdf39c8`.
Branch `codex/core-stability-20260907`, PR #108; baseline commit `ce3ff722c7247e1949b4740b20d2ccb96b1c77cf`.
Production target is **TWMarketAI / cttfzgvhiewfckydcrci** only.
This is an incident amendment, not permission to relax evidence, paid access,
AI settings, model/selection weights or preserved source declarations.
`core-stability-incident-amendment-20260908.json` pins exact changes; the original
source manifest and Product Contract baseline remain intact. CI obtains the
baseline commit and rejects any non-amended change to frozen Core files.

## First failure, not last symptom

Natural 07:00 Fetch v64 persisted 11 immutable PREMARKET rows (versions394–404),
correlation `911db387-b3f0-493d-8de8-72b52cbf013e`. Natural09:00,09:30,10:30
also persisted complete three-core-symbol evidence; v64 is not changed/deployed.
Research first failed at07:05:18. The current failed report id is
`9b3c3369-2c4b-40df-a42a-35a414103fd7`, failed decision revision
`082e552d-f637-4d49-84e5-2f8e6ceb3411` (v7).

- Sector assertions `電子權值：轉強` and `大盤：轉強` were incorrectly deduplicated
  by bare statement, ignoring subject. They are distinct assertions.
- Company relationships for3034/3529/4763/3131 were not supported by company
  evidence. They must be rejected, not reclassified as verified.
- US Labor Day left the latest completed US cash session older than the generic
  48-hour cutoff. The new explicit2026 exchange calendar accepts only that
  actual completed cash session, preserving its timestamp; no FX/rates/futures
  relaxation. Unknown calendar years fail closed.
- Public market delivery depended on paid research depth; missing stock evidence
  erased an otherwise valid market report. The two quality decisions are now separate.
- Generation/retries, publication and readers were deployed from older sources.
  Branch atomic input/publication RPC integrations were not yet the deployed code.
- Incident-only SENT receipts could be summarized as delivery success. They are
  now explicitly distinct from same-revision normal daily-report delivery.

At10:49 Taipei,9/8 still had four FAILED dispatches, zero open dead letters,
three SENT **data_incident** receipts and zero normal daily-report receipts.
These records are not rewritten. 9/7 FAIL acceptance
`c787c5ac-4b02-46cb-9116-30afd74dcb20` remains immutable.

## Behavior and compatibility

Research admission rejects unsupported/stale/missing-date company evidence,
retains evidence-backed stocks and archives rejected candidates privately.
Claim identity includes subject/event/time/condition; corroboration refs merge.
Coverage has a source/date-bearing numerator/denominator ledger. Conditional
future invalidation is a criterion, never evidence that failure already happened.
No-recommendation narrative cites the exact evidence used in its text.

Market Research requires100% coverage, zero unsupported/duplicates/contradictions,
real source completeness and editorial score>=90. Premium still independently
requires its original depth/quality. READY_NO_RECOMMENDATION is a valid market
state; missing market evidence is PARTIAL/BLOCKED, not an abstention success.
Existing HTTP/JSON aliases remain; report/recommendation/delivery states are additive.
Input leases/publication transactions prevent mixed revisions, failed atomic
publication rolls back, and reused input must still match the current publication.
Quality failures are not transient retry candidates. No second LINE invoke after
the orchestrator already attempted that action.

The reader filters future raw/radar rows before selection and withholds impossible
future checkpoint completion without modifying stored evidence. Internal full
health adds per-stage trace and does not hide a live failure when Acceptance is absent.
Frontend is always independently verified, never inferred from a database PASS.

## Validation scope

- Node22.23.1, Deno2.9.2, SupabaseCLI2.108.0; isolated stack versions and clean
  foundation documented in `core-stability-local-runtime-20260907.md`.
- Type-check/lint/build exit0;208 modules. Latest complete Node/Deno/CI results
  must correspond to final commit; prior counts are not substitutions.
- New Acceptance migration applied twice in a fresh dedicated PG test database;
  four integration groups cover atomic rollback, concurrency/input leases,
  private RPC ACL and immutable acceptance/producer evidence. No prior test DB removed.
- Actual isolated generator V9.6.1, GoTrue+Mailpit same-context PKCE, PostgREST/RLS,
  paid/free/admin server entitlement, reload,7routes×5widths (375/390/430/768/1440).
  No application console errors, no unexpected API errors; three intentional
  private-table RLS403 are separately asserted and retained in evidence.
- Only public static CDN assets were allowed outside Browser localhost; all
  product/Auth/DB/Edge traffic remained isolated. Container network is Internal=true.
- Actual9/8 source-shape read-only contract replay: original79% with four
  unsupported stocks becomes a source-bound100% market document after excluding
  those stocks. This is **not** actual OpenAI or provider end-to-end delivery.
- Local generator uses synthetic provider/news inputs and `skip_openai`; LINE
  boundary uses isolated receiver/suppression. Production supplier/LLM/LINE
  success must be established separately. No synthetic source is deployed.
- A proposed broad local fixture DELETE was rejected by safety review and never
  executed. It was abandoned, not split or retried through another channel.

## Deployment artifacts and order

Save/read back existing sources plus files, entrypoint, import-map, version,
updated_at, verify_jwt and SHA256 outside Git. Baselines:

|Function|Version|Entrypoint SHA256|
|---|---:|---|
|generate-daily-report-v7|229|fef92b2edd3a17c2b1a7ab93b78c8e5015cc040657e28b8f57674219e2b30f96|
|daily-delivery-orchestrator|29|c24eb655a0b0c121728a099e73562817296fa671573c252a407fb6dfd598f626|
|get-report-payload|42|50869c00bb4c6cbe176eb5b05382544b3200d5f9787ba9d90830327aea047e82|
|line-daily-push|59|df561b1e1252260dd989e732e71fe398ffddde6bbde1c3527c8f96d16983a96f|
|ma-ops-health-check|20|296f4bd106e1ab00d5cf82a9637462b8091380536658964ebb2c0e073c71ba32|

All five already use verify_jwt=false with their existing internal/server Auth;
keep that strategy exactly, do not use it as a new workaround or alter Secrets.
Include each function's actual recursive relative imports (not just entrypoint).

1. Final commit+CI, fresh target/version/hash/ACL check and rollback artifacts.
2. Apply **only** `20260908020000_incident_acceptance_market_delivery.sql`.
   Replaces only `capture_morning_alpha_acceptance_v1(date,text)` preserving
   SECURITY DEFINER/search_path=''/postgres owner/private service_role execute.
   It appends audit observations only; no dispatch/Recovery/business result writes.
   **Never replay20260907030607 in Production.** Its two reconciler changes were
   rolled back and are not part of this release. Current original MD5s:
   capture `1a7ece36a370bf5b6e785e430f2f7c83`, HTTP reconciler
   `79f50f6f795abce6dba04cd320d1d44d`, terminal reconciler
   `ac38afda0606cc5ed09a1c3b725b0763`.
3. Sequential deployment: get-report-payload → line-daily-push →
   ma-ops-health-check → generate-daily-report-v7 → daily-delivery-orchestrator.
   Readers first are backward-compatible; validate each before progressing.
4. Explicit9/8 approved `ma-ops-safe-recovery` regenerate_report request with
   report_date, unique request/idempotency id, actor/reason,
   **suppress_notifications=true**, current real sources and original AI policy.
   No checkpoint backfill, no direct status edits, no skipped OpenAI for Production.
5. Read source/input lineage/publication/member/public revision; run real-origin
   HTTP/Browser/Auth smoke. Compare LINE outbox hash/count with saved baseline.
   Append Acceptance using its approved RPC, never manually invoke the two reconcilers.
6. Wait for naturally due Closing/Learning; record NOT_DUE/WAITING before then.

## Rollback and release limits

On unexpected Auth/RLS/Publication/Payload regression: stop downstream execution;
redeploy only changed functions from saved baseline files in reverse order,
then restore saved original capture SQL/private ACL. Function version numbers
advance on rollback; verify source hash instead of pretending the old number returns.
Do not delete new audit/revision rows or revert business data to fake success.
Never roll back the two unchanged reconciler RPCs or Fetch v64.

This release does not touch frontend bundles, pricing, subscriptions, Owner data,
Secrets, Cron, Emma, Content OS, Signal Lab or unrelated PRs. Existing cron is
09:00/09:30/10:30/13:00/14:10/14:30 (+5min watchdog), CLE14:40/14:50,
report health08:45/08:50, closing health15:10/15:15, acceptance15:25/15:35 Taipei.
The requested11:00/13:30 checkpoints are **not** present in this deployed contract;
do not claim they ran or manufacture them. Any schedule expansion needs a separate
tested runtime/dispatch contract and explicit operational scope.

9/8 cannot become an automatic stable day after manual intervention or incident
delivery. Since three notifications were already delivered, do not resend them
to manufacture a normal-delivery PASS. Record actual end-to-end FAIL if normal
same-revision delivery is absent, even when the report repair itself succeeds.
Production success is recorded only after actual deployment/invocation and due
Acceptance; this document and local CI are not a Production success claim.
