# Owner Backend Simple Mode — local verification contract

## Scope and authority

The five shared Owner screens present saved operational evidence through the
read-only `get_owner_backend_status_v1` projection. They do not generate reports,
acquire market data, resend LINE, repair checkpoints, run learning, or promote
research recommendations. Refresh repeats the same read; it is not a retry of a
business operation.

The overall status follows today's saved official acceptance result. Legacy
health scores remain diagnostic history and cannot override that result. A
formal Recommendation V1 `BLOCKED` result means insufficient stock evidence,
not a Core failure and not proof that there are no opportunities. A completed
`NONE` assessment is a different state.

This document and its fixtures are local test artifacts, not Production evidence
or permission to commit, push, deploy, change Cron, or execute a migration.

## Date and completion rules

- `today_date` and `as_of` must refer to the same date in `Asia/Taipei`.
- At Taipei 00:27, a previous report retains its actual report date. Today's
  report is waiting for its scheduled work, not overdue merely because the
  calendar day changed.
- A report is complete only when its business date and publication date are
  current and its formal publication status is `PUBLISHED`. Existence alone is
  not publication.
- Prior acceptance, decision, closing, learning and recommendation results must
  not become today's completed results or today's failure incident.
- Closing completion uses the saved `closing` review, not the 14:30 runtime
  checkpoint. PASS requires today's business date, `data_quality: 高可信`,
  `missing_count: 0`, `has_result: true`, and today's valid `updated_at` no later
  than `as_of`. Missing, stale or unknown proof cannot pass. A completed review
  may record a prediction miss; completion is not prediction accuracy.
- Completed LINE and batch observations need current timestamps. Unknown
  counters, including an unknown LINE failure count, cannot yield a green PASS.
- Only the six named intraday checkpoints count; duplicate rows do not increase
  the completed-checkpoint count.
- Use the returned active SLA values. The fixture includes 07:30 delivery and
  15:00 closing deadlines, and a test changes the delivery SLA to 08:10 to prove
  the UI does not hardcode the 07:30 cutoff. A scheduled start is not a completion
  guarantee; absent or unsupported metadata is not an invented deadline.
- Use the supplied official calendar. Holidays wait for the next known trading
  session. A missing or null calendar result is unknown, not an assumed open or
  closed market.
- Cron expressions use the returned supported UTC scheduler timezone. For
  example, Sunday 23:05 UTC is Monday 07:05 Taipei; Cron day/month/weekday fields
  must be evaluated in UTC, not against the Taipei date.

## Shared screen expectations

| View key | Human-facing content | Explicit limitation |
| --- | --- | --- |
| `today` | Today's decision, report, LINE, market data and stock assessment; next scheduled update | Previous report is not today's report |
| `system` | Report, market, LINE, stock assessment, intraday and closing progress | Missing evidence is not a manufactured PASS |
| `health` | Current official operations and dated historical acceptance | Historical incidents are not silently marked repaired |
| `data` | Core, overseas, stock, news and closing data summaries | Row counts alone do not establish research quality |
| `learning` | Market-direction samples and separate stock research observations | No fabricated stock win rate, return or drawdown |

The first four views include a human-readable operational overview and action
summary. The learning view starts directly with actual 30/90-day metrics or
insufficient-data labels after its header; operational acceptance is retained
only in technical JSON so operational health is not mistaken for analysis accuracy.
LINE counts say `已發送` (sent), not `已送達`: recorded sends do not establish
recipient delivery receipts. Technical JSON is contained
in a native `<details>` element that is closed by default. It remains present
in the authorized Owner's HTML; disclosure state is not an authorization or
redaction boundary.

Loading, permission denial and read-contract failures must not show data-bearing
cards or assert a healthy result. The shared hook clears previous data at refresh
and identity changes. Generation checks reject late success and late failure
responses after logout, a new sign-in, token refresh or effect cleanup.

## Reusable synthetic UI fixture

`tests/fixtures/owner-backend-ui.mjs` has no test registration, network access,
environment-variable reads, credentials or mutable shared fixture object. Each
factory call returns a fresh object. It can be imported by the external local
visual harness without running the test suite.

```js
import {
  fixture,
  syntheticOwnerStatus,
  ownerBackendFixture,
  OWNER_BACKEND_SCENARIOS,
} from './tests/fixtures/owner-backend-ui.mjs';

const midnight = fixture('00:27:00');
const current = syntheticOwnerStatus('CURRENT_PASS');
const blocked = ownerBackendFixture('RECOMMENDATION_BLOCKED');
// Render: <OwnerSimpleView page="today" data={midnight}
//          loading={false} error="" onRefresh={() => {}} />
```

The fixture date is fixed at 2026-10-08; it does not follow the machine clock.
Scenario names are `MIDNIGHT_WAITING`, `CURRENT_PASS`,
`RECOMMENDATION_BLOCKED`, `DEGRADED`, `CORE_FAIL`, `HOLIDAY`,
`CALENDAR_UNKNOWN` and `OVERDUE`. Optional second-argument overrides are shallow
top-level replacements, with supplied values cloned to avoid caller mutation.
`fixture(time)` is a convenience wrapper for the midnight/prior-report scenario.

Label any screenshots or external preview explicitly as synthetic local tests.
Use the actual shared view and stylesheet, not a separately reimplemented UI.

## Verification and red-first findings

Run with Node 22 and TypeScript stripping; the shared-view SSR loader uses the
existing TypeScript CommonJS/JSX transpilation pattern and real React server
rendering. No additional dependencies or generated repository files are needed.

```sh
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test tests/ownerBackend.test.mjs
```

On 2026-10-08, the first targeted run recorded 33 tests: 29 passed and four failed.
After adding formal publication fixtures and splitting the stale-data checks,
the red run contained 38 tests: 32 passed and six failed:

1. Prior closing success incorrectly became today's PASS.
2. Prior closing failure incorrectly became today's incident.
3. Unknown LINE failure count incorrectly allowed PASS.
4. Prior LINE delivery timestamp incorrectly allowed PASS.
5. Prior premarket batch timestamp incorrectly allowed PASS.
6. Prior intraday batch timestamp incorrectly allowed PASS.

The main agent corrected the product status code; the test author did not relax
these assertions or modify the status implementation. With the shared pure view
and additional SSR assertions, the targeted suite passed 50/50 on Node 22.23.1,
including an execution with host timezone `Pacific/Honolulu`. This is a dated
local result; subsequent edits require a fresh run, not an inferred PASS.

After the authorized learning-overview and LINE-copy adjustments, the targeted
suite passed 52/52 in both `UTC` and `Pacific/Honolulu`. Added assertions require
30/90-day metrics directly after the learning header, acceptance retained in
collapsed technical JSON, and sent-only wording with unchanged LINE status/counts.

After the saved-close-review correction, the synthetic fixture carries explicit
current review proof and the targeted suite passed 56/56 in both timezones.
Coverage rejects checkpoint-only success and stale/missing/unknown review proof,
while preserving the distinction between completed verification and prediction hits.

Coverage includes all five screens, collapsed technical details, current official
PASS versus legacy health, missing/truncated quality measurements, publication
identity, actual SLA values, unknown calendar, UTC Cron boundaries, and a mocked
read-only RPC with logout/sign-in/token-refresh races. Unknown-status cases must
not produce a rendered green overall badge.

SSR tests prove emitted markup and default disclosure attributes, not actual
browser layout, keyboard interaction, production permission enforcement or
database correctness. The main agent's external browser harness and the separate
DB/integrity verification remain independent checks. No production access or
deployment is part of this test task.
