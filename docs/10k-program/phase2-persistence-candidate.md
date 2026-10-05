# Phase 2 Shadow Persistence candidate — NOT released

## Exact 0-row boundary

Read-only inspection on 2026-10-05 found the deployed `research-analysis-shadow-v1`
V2 ACTIVE, the expected research migrations present, and **zero**
`research_daily_analysis` rows. Retained PREMARKET input for 2026-09-30,
2026-10-01 and 2026-10-02 contains 11 rows each with PASS integrity. The production
worker is **A: on-demand**. No matching Cron or DB dispatch function exists, and
the released application contains no lifecycle caller. The inspected last-24-hour
function log window contained no worker invocation (this is not an all-time claim).
The previously accepted replay used an isolated sink; it was not a Production write.

```text
Production immutable evidence: EXISTS (three dates, 11/11)
  -> formal caller / dispatch: NOT CONFIGURED <-- first 0-row boundary
  -> V2 Handler / engine: callable, not automatically invoked
  -> write attempt/result: no persisted receipt; not a proven rejected write
  -> research_daily_analysis: 0
  -> get_owner_analysis_v1: latest = null
  -> Owner UI: legitimately empty
```

The released design explicitly deferred lifecycle activation. An ACTIVE function
does not imply an active pipeline. No Auth, Provider, Atomic, research strategy,
or business availability failure was found at this boundary.

## Candidate flow and authority

```text
Retained immutable input (isolation only)
 -> actual research-analysis-shadow-v1 Handler + existing internal Auth validator
 -> research_analysis_input_v1 -> actual analysis engine
 -> store_research_analysis_v1 -> append-only research_daily_analysis
 -> research_historical_replay_v1 / research_forward_shadow_v1 (security invoker)
 -> get_owner_analysis_v2(mode, date) -> Owner UI catalogue + selected artifact
```

Authority is `(business_date, analysis_cutoff_at, methodology_id,
methodology_version, observation_kind)`. The worker lookup and database uniqueness
use the same key. A replay cannot satisfy a Forward lookup. A duplicate obtains
the original ID/hash; conflicting recomputation cannot replace it. Existing
append-only triggers continue to reject UPDATE, DELETE and TRUNCATE. Outcome,
invalidation and calibration remain separately appended observations.

No existing research or business rows are seeded, backfilled or rewritten by the
migration. It verifies the exact released store function source MD5 before changing
only the two research uniqueness keys, store RPC and adding two views/one read RPC.
Historical migrations, hashes and the 142-file Core freeze are preserved.

## Persisted contract

`research_daily_analysis` retains business date, cutoff, observation kind,
methodology ID/version, created_at, input/previous input snapshots, structured
analysis, prediction hash and compute time. Structured analysis retains source
evidence IDs; feature versions; signal versions; quality/missing components;
regime/direction/risk/action/confidence; supporting/contradicting/conflict;
what_changed; invalidation; and report_level. These are explicit decision features,
not private chain-of-thought. `created_at` is exposed as `replay_created_at` for
historical records. `production_eligible=false` remains mandatory.

Separate RLS-preserving projections expose `HISTORICAL_REPLAY` versus
`FORWARD_SHADOW` (the latter maps to the existing stored `FORWARD` enum). Historical
rows explicitly carry NOT_FORWARD and NOT_PRODUCTION_DECISION. The Owner catalogue
is bounded to 90 dates and returns one selected artifact, not an unbounded dump.
The original v1 read RPC remains available for old clients.

Forward remains disabled operationally. Its existing activation/cutoff/current-day
guards remain intact; the candidate also rejects an already-known dated outcome.
Only a locked, timely, outcome-unknown Forward record can increase the Forward
sample (distinct business dates). Historical replay count is independent.

## Isolated verification evidence

Fresh database applies the exact research migration chain with a research-only
dependency scaffold. This is not a claim to replay every historic production
migration. Retained source fixtures are unchanged. No final analysis is seeded:
the actual Handler executes the engine and writer three times through a local SQL
transport. Remote imports are replaced only at the SDK transport boundary;
unexpected external network calls throw. Test identities and credentials are
explicitly synthetic and never represent Sony's real session.

| Date | Saved engine result | Confidence |
|---|---|---:|
| 2026-09-30 | Core PASS; What Changed UNAVAILABLE; PREVIOUS_COMPARISON_UNAVAILABLE; WAIT | 3.8821 |
| 2026-10-01 | PASS; missing evidence retained honestly; WAIT | 7.8816 |
| 2026-10-02 | PASS; range / BULLISH / HIGH / WAIT | 17.3047 |

Each stored artifact replays deterministically from its retained inputs with the
same prediction hash, 33 features, 11 signals and 3 cross-signals. Retry returns
the same artifact without another source read/write. Historical count = 3;
Forward = 0; Analysis Value = INSUFFICIENT_SAMPLE. Missing Core and injected
Shadow write failure reject only the sidecar, with `production_affected=false`.

Fresh-DB ACL/RLS tests: anonymous denied; normal/paid/unlisted-admin denied;
missing subject denied; explicitly enrolled synthetic owner allowed; service
role allowed. Views execute with invoker privileges; no policy or Owner truth is
changed. Browser tests read these persisted artifacts through the real new RPC
using the isolated owner role, with a visibly synthetic UI-auth harness. Desktop
and 390x844 render correctly; no horizontal overflow; date/mode switching and
logout removal pass. This is **not** real Production Owner acceptance.

Local TypeScript initially encountered empty duplicate `@types/* 2` directories
in the developer environment. Empty local duplicates were removed. Parent-folder
duplicates were not modified; the Node 22 local check uses explicit project
`--typeRoots ./node_modules/@types`. CI uses the unchanged plain type-check command
in a clean checkout. No type assertions or checks are weakened.

## Forward trigger proposal — design only, NOT activated

Prefer the existing lifecycle's successful PREMARKET authoritative 11/11 commit
event, after the business transaction commits. It may asynchronously enqueue an
independent research request with a fixed original cutoff and authority key. The
business response must not await that request or depend on research availability.
No DB trigger inside the Atomic transaction, no synchronous Shadow dependency.

Proposed bounds: dispatch only after trusted Core READY, before the existing
08:45 readiness deadline and while Outcome is unknown; at most three attempts
within five minutes of the original cutoff, never after the deadline. The writer
still enforces its current-time/cutoff/activation/outcome rules. Retries preserve
cutoff/mode; they never fabricate a fresh authority. Failures are research-only
observations and cannot affect Decision, Recommendation, Report, LINE, Closing,
Learning or Acceptance. No Cron is needed for this proposed event path. Actual
caller/queue integration and activation need Sony's separate approval and are
not included in this candidate.

## Release scope and remaining approval

Candidate only: `20261005130832_analysis_shadow_persistence_v1.sql`,
`research-analysis-shadow-v1`, and three Owner UI files (`intelligence.ts`,
`page.tsx`, `IntelligenceView.tsx`). No Core function, Cron, Auth configuration,
RLS policy, Secret, member navigation or business strategy changes.

After GitHub gates, request separate approval for the unique migration, worker
release, three explicit HISTORICAL_REPLAY engine requests using retained source
evidence, and the new Owner UI version. Production currently remains 645.
Do not publish 647. A Readdy candidate cannot show the new production RPC's data
until the migration and authorized historical worker calls are released; do not
work around that dependency with seeded UI results or uploaded research evidence.

No Production operation in this task dispatches the worker or writes business or
research records. No Forward activation, natural-day success or calibrated
analysis value is claimed.

Readdy created **Version 648** (preview build 14547145), source-only three-file
successor to the 647 candidate. It reports Build successful and explicitly
acknowledges the unreleased read-RPC dependency. It is NOT published; live 645
is preserved. The three-day interactive data acceptance above is the local
isolated DB preview, not an assertion that Readdy can access those local rows.

Production read-only before/after aggregate hashes/counts were identical for
decision_snapshots, reports, line_delivery_outbox, prediction_outcomes,
learning_predictions, market_checkpoint_batches, Cron and Owner function truth.
The full local public-test pass initially encountered sandbox localhost-listen
EPERM errors, plus the old foundation test's graph-as-sample assumption. Only
that directly affected test was updated to assert the new mode-separated count
contract; network tests are rerun with localhost listening permission. No skips,
weakened assertions or business fixes are introduced for these environment gates.
