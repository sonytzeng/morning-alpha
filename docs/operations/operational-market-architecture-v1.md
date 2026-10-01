# Operational Market Architecture V1 — candidate only

Production is unchanged. This contract is not a release approval.

## Verified incident

On 2026-10-01 the PREMARKET integrity RPC returned PASS for batch
`0a0df854-9d65-4d1d-97a0-02c622108e4c`, correlation
`35036ea9-a115-46f6-8d5b-c85b32a28b33`: 11 canonical providers, one committed
batch, no unbatched rows, duplicates, mixed revisions or compatibility mismatch.
Research recorder IDs `90cc9620-34be-4589-8df0-be8e292cd896` (07:05) and
`75b3318a-851f-4d10-b94b-f9f2d4d356d7` (07:15) show 100% supported market
claims and zero unsupported/duplicate/contradictory/missing-section counters.
Both were rejected solely for `research_publish_status_not_ready`.

The input manifests distinguish the actual news states: 07:05 `market_news`;
07:15 `market_news:no_verified_relevant_items`. Both have **zero qualified news**
and four sector rows. Arrival of unqualified news does not establish FULL.
The historical failure and all original evidence remain immutable.

## Dependency and publication contract

1. Validate the current business date's immutable PREMARKET batch using the
   existing 11-provider row/session validators and its actual DB integrity proof.
   Any missing provider, partial batch, bad date/session/time, mixed identity,
   duplicate batch or integrity failure is CORE_FATAL. No normal publication.
2. News, sector and research enhancements have independent availability states.
   Missing enhancements are disclosed, not invented. They cannot invalidate
   trustworthy core market data. Unknown gaps are not silently allowlisted.
3. Canonical market assertions remain independently audited: every assertion
   needs evidence; unsupported, contradictory and duplicate claims remain errors.
   Core completeness and enhancement completeness are different fields.
4. FULL requires all required enhancements. Otherwise publish DEGRADED with
   exact missing evidence, unavailable sections and confidence limitation.
5. The existing company admission/quality gate is unchanged: READY, evaluated
   NONE, or evidence-insufficient BLOCKED. None of these revoke a market report.
6. New qualified enhancement input may create a new canonical revision through
   the existing input lease/publication transaction. The first publication
   identity is retained. A new research revision is not a new normal LINE send.
7. Closing uses the frozen published market decision and actual close evidence.
   Learning is post-processing and cannot revoke a published decision.
8. Acceptance records independent CORE_MARKET, REPORT_PUBLICATION,
   RECOMMENDATION, LINE, CLOSING, LEARNING and DATA_SLA dimensions.
   SERVICE_AVAILABLE requires core+decision+publication+normal LINE, not stock
   recommendations or learning. 07:30 SLA and 08:45 deadline remain distinct.
9. Recorder remains fail-open observability. Each operational decision records
   bounded allowlisted inputs and an exact replay result; no credentials/PII.

## Candidate work and release gates

Implement shared contract; bind producer and DB validation; integrate committed
readers and lifecycle dimensions; show plain-language status in subscriber/LINE
projections. Validate retained 10/1 inputs, historical incidents, positive and
negative cases, enhancement revision/LINE dedup, closing/learning/acceptance,
and three next-day paths in isolation. External LINE dispatch is blocked.

Then Integrity, type-check, lint, build and GitHub Release CI. No historical
backfill, no Production migration/deploy, no Cron/Auth/RLS/secrets modification.
Any final Production scope requires Sony's separate approval.

## Preserved verification and reconnect continuation

The interrupted connection was an execution-environment interruption, not a
product verdict. The 31-file working tree and five saved lifecycle artifacts
were preserved. No reset, revert, Production deployment or business write was
performed. The candidate Integrity and evidence manifests were still pending.

Actual retained 10/1 market inputs produced DEGRADED, a published canonical
market decision, one local LINE send, Closing, Learning and dimensional
Acceptance with service available. FULL is a separately labeled audited
synthetic late-news control, never a claim about the actual 07:15 Production
response. Missing-sector and actual Learning-write failure controls also kept
service available. Missing core stopped Report; valid next-day evidence then
restarted normally. FULL, DEGRADED and CORE_FATAL each passed next-day recovery.
The legacy Acceptance verdict remains a diagnostic; the isolated tests did not
fabricate health-check/natural-run evidence to turn it into a natural PASS.

The new Publication validator's Atomic dependencies are captured in SQL Replay.
Multi-version read sets now retain research session version, decision current
flag and predecessor identity; defaults must not invent a second current
revision. Acceptance recordings retain service availability and all dimensions.
Twenty-six new SQL capsules replayed with all real constraints/triggers active:
Publication, Lifecycle and Acceptance each had zero contract differences.
The previous incomplete capsules and all Production history are unchanged.

Historical classification uses only retained immutable projections, not
invented raw HTTP responses: 9/21, 9/22, 9/23, 9/24 and 9/29 have no committed
PREMARKET batch and remain CORE_FATAL. 9/18 has legacy date-only cash evidence
without sufficient completed-session proof for the current contract, so it
also fails closed; no date is guessed. 9/30 and 10/1 have trusted complete core
and missing research, classified SAFE_DEGRADED. These are candidate replay
classifications, not rewritten historical results.

## Final approval scope (not executed)

One migration candidate:
`20261001065146_operational_market_architecture_v1.sql`.
It changes six named publication/acceptance/Recorder functions, guarded by
exact predecessor hashes; owner, ACL, security, search_path and RLS are unchanged.
No Provider, Atomic, Retry or Cron contract is modified; no history is backfilled.

Shared import closure requires coordinated approval for the eleven currently
deployed consumers listed in `evidence/operational-market-release-bundles-20261001.json`.
This includes four directly edited Functions and seven shared-contract readers;
it is not eleven unrelated Function changes. `alpha-coach` is a local import
consumer but is not deployed and is not proposed for new deployment.
The frontend has only the necessary plain-language report-status projection
and two display paragraphs; no new hooks, fetches, page redesign or framework.
Cron/Auth/RLS/secrets: no change. Final rollout still requires Sony approval.
