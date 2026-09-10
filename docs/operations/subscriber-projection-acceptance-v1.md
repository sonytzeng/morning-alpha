# Subscriber Projection Acceptance V1

## Scope and evidence boundary

The permanent reader contract is `getSubscriberReportProjection`. The UI must not
infer publication, failure, confidence, recommendation or closing completion from
raw QA text, elapsed browser time, or a different report revision.

`tests/subscriberReportProjection.test.mjs` exercises nine required states:
READY, PARTIAL, BLOCKED, FAILED, INVALIDATED, NOT_DUE,
MARKET_READY_RECOMMENDATION_BLOCKED, MISSING_CONFIDENCE and STALE.
It adds two positive contrast states: CLOSING_COMPLETE and RUNTIME_INVALIDATED.
It also covers null payloads, multiple input envelopes, untrusted client-tier
claims, adjacent market facts around an internal score annotation, and the
sanitized captured legacy public Payload44 response.
Positive controls retain a complete same-revision closing receipt and a
published failure checkpoint with its own timestamp and evidence. Wrong-date,
wrong-revision, missing-timestamp or missing-evidence failure claims cannot
invalidate the report. Unpublished PARTIAL remains incomplete even if raw
checkpoint aliases claim failure.

The captured fixture is not synthetic market evidence. Its provenance retains
the original response SHA-256, version and report date. It omits membership,
news, raw market rows, operational fields and any user identity/credentials.
It reproduces the actual PARTIAL + STOP + 100 confidence contradiction without
re-querying Production.

## Browser matrix

`tests/browser/subscriberProjection.e2e.mjs` verifies:

- 11 states × 4 routes × 2 viewports × 3 real local server roles = 264 checks.
- Routes: Home, Today, dated report detail, Verification.
- Viewports: 390×844 and 1440×1000.
- Roles: free, paid member and server-side admin.
- Local Magic Link/PKCE, code removal, reload persistence, profile/entitlement
  re-fetch, and actual private-table RLS denial.
- Rendered status/copy, absent false 100/100 and closing completion, route HTTP
  result, horizontal overflow, CTA clipping, console errors and request storms.
- The rendered main element must carry the central projection's report date,
  revision and state; merely rendering a route or error page is insufficient.
- A complete receipt must render its actual hit/result and 1.00% synthetic close
  on the appropriate result routes, while Today marks the closing node complete.
  NOT_DUE cannot complete that node. A real synthetic same-revision failed
  checkpoint must show the invalidated/stop interpretation, not just a marker.
- Two additional free/member checks forge only the `ma_tools=1` UI preference.
  `/voice` must remain server-gated and cannot mount or request the raw QA readers.
  The authenticated identity, role and entitlement are never forged.

This is **presentation contract E2E with real local authentication**, not a new
generation/publication integration acceptance. Only the local report-reader
response is intercepted, after the same session obtains its real server tier.
Auth, profiles, membership and RLS responses are never replaced. The fixture
cannot promote a free server response into a member/admin response.

The live fixture date is explicitly supplied and must equal Asia/Taipei today.
Existing September 8 local database fixtures remain unchanged. For the PARTIAL
Browser case only, the captured legacy public shape is date-rebased as a declared
synthetic presentation fixture; its original source hash/date remain in the
evidence. STALE always retains the previous date and cannot provide fresh stock
recommendations.

All browser network requests remain local. Remote CSS/icon-font and logo requests
receive declared inert offline substitutes. Therefore these checks are not a
certification of third-party asset delivery or final font/brand pixel parity.

## Local safety gates

- Explicit scope: `ma-core-final-20260907`.
- Docker context: `colima-ma-core-20260907`.
- Network: `ma-core-final-isolated-20260907`, `Internal=true`; all selected services
  must be attached only to that network.
- The database `ma_isolated_guard.identity` must match the scope before any test.
- Existing synthetic accounts are required; no account or privilege is created.
- Signup mode is temporarily set to closed and restored so a local login cannot
  enroll or upgrade the free fixture through an unrelated beta flow.
- Reports, decisions, member content and LINE fingerprints must remain identical.
- Output directories must be new private `/private/tmp/` paths; previous failed
  evidence cannot be overwritten.
- URLs/codes, tokens, credentials and local identity emails are not retained in
  report logs. No Production endpoint, notification or provider is called.
- Source hashes are checked again after the matrix. A concurrent source change
  invalidates the acceptance run.

## Commands

Use the repository's supported Node 22 runtime. Do not install or upgrade
dependencies to conceal a validation failure.

```sh
node --experimental-strip-types --test tests/subscriberReportProjection.test.mjs

MA_LOCAL_SCOPE=ma-core-final-20260907 \
MA_SUBSCRIBER_PROJECTION_MATRIX=YES \
MA_E2E_BUSINESS_DATE=YYYY-MM-DD \
MA_E2E_OUTPUT=/private/tmp/NEW-UNIQUE-ACCEPTANCE-DIRECTORY \
MA_PLAYWRIGHT_MODULE=/ABSOLUTE/PATH/TO/EXISTING/playwright/index.mjs \
node --experimental-strip-types tests/browser/subscriberProjection.e2e.mjs
```

An unexecuted or failed matrix is not PASS. Passing these tests does not authorize
Production Deploy, Merge, Migration, Recovery, Cron changes or LINE delivery, nor
does a synthetic acceptance count as an automatic stability day.

## Verified local result — 2026-09-09

- Rendered matrix: **264/264 PASS**, 88 checks for each real server tier.
- Supplementary free/member internal preference gate: **2/2 PASS**.
- Local PKCE, reload, server entitlement and RLS: **3/3 roles PASS**.
- Unexpected console/HTTP errors, failed requests and external requests: **0**.
- Three deliberate private-table RLS denials were recorded as expected 403s.
- Reports, decision snapshots, member content and LINE fingerprints: unchanged.
- All 260 selected source hashes: unchanged during the run.
- Related Node projection/mapping/consumer contracts: **70/70 PASS**.

Immutable Browser evidence:
`/private/tmp/ma-subscriber-projection-e2e-202609090253/subscriber-projection-results.json`

SHA-256:
`7f90671b347f27fed4c70285c45fb11c8fe48406b52022019950b3c40d19adda`

The directory includes 22 admin Today screenshots. The evidence's `auth.role`
records the actual profile role; a paid member correctly remains profile role
`free` while `server_tier=member`. No role or entitlement was fabricated.

Earlier failed runs remain in their original directories. They exposed missing
projection markers on ready/history route branches and two harness mismatches
(absent-vs-undefined JSON state and a layout kicker used instead of checkpoint
identity). The final run was fresh and did not reuse their passing subsets.
This result remains local presentation acceptance, **not Production acceptance**.

## Candidate scope / integrity handoff — 2026-09-09 Asia/Taipei

This is an audit snapshot at `2026-09-08T17:35:52.296Z`, not an integrity approval,
CI result, deployment authorization, or Production acceptance. Validation totals
must be supplied from the final frozen-source run; earlier totals cannot be reused.

Repository: `/Users/sonytzeng/Documents/GitHub/morning-alpha`. Branch at capture: `main`.
HEAD and origin/main both equal `1bb06a047f38600be27f6e89a38b81baa5578706`; ahead/behind is 0/0
and staging is empty. No Commit, Push, Merge, Production Publish, Backend Deploy,
Production Migration, Cron, Recovery, LINE, or business-data write is performed
by this audit.

### Exact scope and counts

The same Git HEAD baseline yields **37 modified tracked files**, **+1056 / -1115**.
There are **9 new task files**: the 8 source/test/fixture entries marked “new”
below plus this document. Thus the candidate scope is **46 files**, not an editor's
cumulative edit count. New source/test/fixture files contribute **+1147 / -0**
before this document. The whole candidate excluding this mutable audit document
is **45 files, +2203 / -1115**. The final document line count and self-hash must be
taken after the last validation update; they are deliberately not self-referential.

The remaining **47 pre-existing untracked files** are excluded, preserved and
fingerprinted separately: 2 research inventory documents and 45 “ 2” duplicate
files. They are not candidate migrations or dependencies. Do not stage them,
delete them, stash them, overwrite them, or confuse them with new work.

| Candidate file | Added / deleted versus HEAD | Candidate SHA-256 |
| --- | ---: | --- |
| `shared/subscriber-state-contract.ts` | 3 / 1 | `9e92f6d1d785632d6dd1bd3569ca581d9e14b336bc8342d452b352f0b0b9ef9e` |
| `src/components/base/MarketStatusLight.tsx` | 19 / 80 | `44fc251fc5ca474ea513f91cde0f3d7d50ff006de8e221bf3d0323fac2a416be` |
| `src/hooks/useAccountDashboard.ts` | 8 / 4 | `d1969a52f76811c2552fc67f4eec648d4b174b86cdca0398e4cec60f616cc1ea` |
| `src/lib/closingVerificationState.ts` | 10 / 9 | `b299b179946b78e3f95b23a5a8457a95c6fa6755560089d41549c73d68c136ad` |
| `src/lib/decisionPresentation.ts` | 10 / 23 | `9f1ac35c9a6a5b809fc68a3f0276c62e0382bc87cd83603ebf331fcbe6f4a2ee` |
| `src/lib/morningAlphaReportAdapter.ts` | 73 / 206 | `ac5518448fd832c3b3196ba73e34a5b4ec3651bb2924e32264785296a5ea5f91` |
| `src/lib/subscriberReportContract.ts` | 119 / 50 | `3f276ae6561ea6c3d46f455a053ab7100096ddf17de5bb5703c9a0e4d88ffe58` |
| `src/pages/account/components/MorningHeroCard.tsx` | 26 / 15 | `db29ea04c30df2cf1891043ebd39ec4581c060b315351d2fda08e42f9fc4007e` |
| `src/pages/account/components/TodayInfoCards.tsx` | 20 / 5 | `f5cee8856d9b4d3e24204543c1ec1bbb29ab6cbcdc9ce450c196a51e30827ae3` |
| `src/pages/home/page.tsx` | 56 / 112 | `4ee43aeaeeea561ed4e6a2bb4c558d463dd3ac2334cb836d85b77a6db88b5be0` |
| `src/pages/member-note/page.tsx` | 44 / 59 | `e9d3feda9ccfdbc73bb622d4acc904e18e3000b235ff910eb7e7974f487d9501` |
| `src/pages/opportunities/page.tsx` | 35 / 31 | `5b42c634a10c219c398d6f228916970c3b661127abf4152c120dd7eccc2c5b41` |
| `src/pages/performance/page.tsx` | 15 / 37 | `b3885a1925d5ae49c0abe9f32a479f389de546fdff3e486ed4c0b89c6c4f8212` |
| `src/pages/report/TodayReport.tsx` | 51 / 25 | `4ded92bbfffb19199b9d1b265f88a13aa5bd3cd926505f6e45e1efe9536a15d0` |
| `src/pages/report/components/CoreConclusionCard.tsx` | 12 / 11 | `2202c2fe875fa73fd33d018bfa476ecccdc2961928b6bcddba34b4e62bde40cc` |
| `src/pages/report/components/RetailMistakeCard.tsx` | 7 / 7 | `0be0d803cb9b1bdfb3a0019b81bc6692dde8508a42c8781d3cd16110899d5f84` |
| `src/pages/report/components/ShareQuoteCard.tsx` | 10 / 9 | `f761c44d06bbbf60f31591d775396f3710794c0f23accc91596fe831ec6a9520` |
| `src/pages/reports/ReportDetail.tsx` | 58 / 80 | `acbd407475c349bed9c7106aaf26f338e202d1b0b0cb3401e04384a9b95b4d94` |
| `src/pages/reports/ReportsCenter.tsx` | 50 / 63 | `c7ac4c1a88f8d4e9b735e5f5e6221bbf0e5addcd7183e6970e1344a7ee8cbdaa` |
| `src/pages/verification/page.tsx` | 41 / 26 | `509bf96964088eadd4281943ff174d1ceadcc45685a75ae10a5fe3f337249cae` |
| `src/pages/voice/VoicePage.tsx` | 50 / 53 | `e2cadd00d909b08e9ad178acf42c3a97931fb334481f1ceadfb8e23cdcce929b` |
| `src/pages/war-room/WarRoom.tsx` | 37 / 34 | `7fee863a21f997cf6d667715869a83de7fe8994e0ee09f090a38cf99e50b4d0d` |
| `src/services/reportService.ts` | 54 / 56 | `5296613c6c37f0df99f633032fc5838e09253aea739bb7615b60ae9ebc008295` |
| `src/services/resolveActiveReport.ts` | 16 / 54 | `8aa41928fffed876a43d9284b4d833cbe02833bb2fd7bd5769abc13e67e61454` |
| `src/types/report.ts` | 17 / 0 | `cce6211c5c724b652107d2d5fa90fcedd0a615ad4829f01e3dc65930f24f01b4` |
| `src/types/subscription.ts` | 2 / 0 | `3d7686cda93e375cf0266b2af52ad987c1b1aa451fb379f3a486d8160af67f99` |
| `supabase/functions/get-report-payload/index.ts` | 37 / 15 | `48c59788d7c64744cfba863e6f9fad44a52afdd696f0d5d973bc72d675e75735` |
| `tests/beginnerLearningAlphaCoach.test.mjs` | 18 / 2 | `2a1a7ec25f00a389862fec487ec0c2c216a13593464ae2736e30b9d9f7a5bfec` |
| `tests/decisionEvidencePipeline.test.mjs` | 9 / 2 | `8ed637a7c5027c458232d43b3ae8929e0568a3375a07c1d52dc0ce6c9bd364c2` |
| `tests/decisionLifecycle.test.ts` | 19 / 2 | `d231d343c609cac45042a123dbe7b3eedf4377d6d1921404d776b69fe8f74b1f` |
| `tests/decisionV1Product.test.mjs` | 6 / 3 | `f214bf08e8dee3bf3278d6e140a13bcec6a2aa4a1c1b785a96a8164e21e47ea6` |
| `tests/marketPublicationPayload.test.mjs` | 4 / 3 | `1f60c90e935aa87d57b7ef785ebea7f497a07e1fdd4cf4a42eb09b70ba5f37f9` |
| `tests/publicRelease.test.mjs` | 46 / 15 | `864219c887a766624bd718786bec623195290242a647941dc3b3b61904e24000` |
| `tests/runtimeDecisionTimeline.test.ts` | 29 / 7 | `53742f6e785a90387efa13a13a675566316d09a77538ca9a465358d44f3d06da` |
| `tests/runtimeReportState.test.mjs` | 30 / 6 | `6be67a6dec8df0a3667c343428df9bfc556a1040152f02d7c0bf75660a5a71bb` |
| `tests/subscriberMarketPublication.test.mjs` | 9 / 6 | `73adb14e0db42dede1142b47153c338f04de5da1ec9a5ec8713079b7a0b141e4` |
| `tests/subscriberStateFrontend.test.mjs` | 6 / 4 | `48507a97a59a29642b8fc3e8481898279fcf10ca65eeedb4373a8336e92da441` |
| `src/lib/subscriberReportProjection.ts` | 4 / 0 (new) | `d6fdb1f44eb1086d2da17d7c8d53d620e4cb36d97ec4feb59a9edb5ee35bc977` |
| `tests/accountSubscriberProjection.test.mjs` | 149 / 0 (new) | `357b3ff4e803ebd67690ff234930e8c8770317942864e08e1647f4082eab7928` |
| `tests/browser/subscriberProjection.e2e.mjs` | 267 / 0 (new) | `b26117bcccf7a86ee1d26ee1a6093ddb496e6df1df7370a66a0c10c7420e623a` |
| `tests/fixtures/subscriber-projection-legacy-payload44.json` | 106 / 0 (new) | `0b2c3bab91ef094dcd29093b5e6e0a11e22fcae922bd62d0bcf9442e419f8ec7` |
| `tests/fixtures/subscriber-projection-v1.mjs` | 84 / 0 (new) | `961f03d08691527239cb46a73a96acead63b131ef8e9a8e5a73cb69565818f44` |
| `tests/subscriberProjectionMapping.test.mjs` | 233 / 0 (new) | `6a093f0aff64f89d0411b91dd8dc94db79c7aa32f225f0d877a14432b9856fd3` |
| `tests/subscriberProjectionRoutes.test.mjs` | 133 / 0 (new) | `41c44b834798116a558ae7c8f1e08b5bf7f6e065d673f3e102c43e0f350c6ab3` |
| `tests/subscriberReportProjection.test.mjs` | 171 / 0 (new) | `3433bb78e23d3f68be64474db79595d00e3fb90589393dad06cd424a6d77d1ce` |
| `docs/operations/subscriber-projection-acceptance-v1.md` | New audit document; count after final update | Self-hash captured separately after final update |

Full immutable local audit manifest (includes every candidate's previous HEAD
hash plus every preserved untracked file hash):
`/private/tmp/ma-core-final-20260907/subscriber-projection-scope-20260908173552.json`
SHA-256: `e0cb4dbe26d3371be0fae70f21e0759d2f1a2db1669d8bd1cd5740cf8a7244e6`.

Exact preserved/excluded paths:

```text
docs/research/data-acquisition-inventory-v1.md
docs/research/data-gap-matrix-v1.json
supabase/functions/_shared/decision-v1-data 2.ts
supabase/functions/_shared/decision-v1-evidence 2.ts
supabase/functions/_shared/fetch-checkpoint-evidence 2.mjs
supabase/functions/_shared/line-daily-flex-message 2.mjs
supabase/functions/_shared/market-report-gate 2.ts
supabase/functions/_shared/research-pipeline-contract 2.ts
supabase/functions/_shared/research-quality-gate.test 2.ts
supabase/functions/_shared/us-cash-session-calendar 2.ts
supabase/functions/generate-daily-report-v7/candidate-evidence 2.ts
supabase/migrations/20260907030607_core_research_atomic_publication 2.sql
supabase/migrations/20260907072722_reconcile_canonical_schema_truth 2.sql
supabase/migrations/20260908020000_incident_acceptance_market_delivery 2.sql
supabase/migrations/20260908050000_market_publication_recommendation_isolation 2.sql
tests/browser/productDecision 2.html
tests/browser/productDecision 2.tsx
tests/browser/productDecision.e2e 2.mjs
tests/browser/subscriberProduct.e2e 2.mjs
tests/browser/subscriberState.e2e 2.mjs
tests/canonicalSchemaTruth.test 2.mjs
tests/coreProductionPreservation.test 2.mjs
tests/coreRuntimeIntegration.test 2.mjs
tests/decisionEvidencePipeline.test 2.mjs
tests/decisionV1Product.test 2.mjs
tests/fetchCheckpointEvidence.test 2.mjs
tests/fixtures/core-acceptance-schema 2.sql
tests/fixtures/core-canonical-foundation 2.sql
tests/fixtures/core-research-indexes 2.sql
tests/fixtures/core-research-publish-baseline 2.sql
tests/fixtures/core-research-schema 2.sql
tests/fixtures/decision-evidence-rows 2.mjs
tests/fixtures/decision-v1 2.mjs
tests/fixtures/fetch-provider-boundary 2.mjs
tests/fixtures/legacy-decision-evaluator 2.ts
tests/helpers/isolatedEdgeLoader 2.mjs
tests/incidentHealthContract.test 2.mjs
tests/integration/fetch-checkpoint-local 2.mjs
tests/marketOnlyCanonical.test 2.mjs
tests/marketPublicationDatabase.integration 2.mjs
tests/marketPublicationDelivery.test 2.mjs
tests/marketPublicationPayload.test 2.mjs
tests/productContract.test 2.mjs
tests/researchPipelineDatabase.integration 2.mjs
tests/subscriberMarketPublication.test 2.mjs
tests/subscriberStateContract.test 2.mjs
tests/subscriberStateFrontend.test 2.mjs
```

### Behavior and security review boundaries

- One dependency-free `getSubscriberReportProjection` implementation remains
  inside `src/lib/subscriberReportContract.ts`. The frontend entry point and root
  shared module are re-exports, not duplicate state engines.
- Payload public/history/envelope consumers now expose the same projection and
  suppress raw confidence/closing aliases unless the existing publication and
  same-revision evidence contract permits them. Resolver/service/adapter preserve
  canonical identity instead of inventing a revision from a date or choosing an
  older READY report over the server-selected current PARTIAL.
- Home, Today, ReportDetail, ReportsCenter, War Room, Verification, Performance,
  Research, Opportunities, Navbar and Account report summaries consume this
  projection. Recommendations are restricted to the canonical qualified items;
  date-only close-review labels cannot replace the canonical closing outcome.
  `neutral` is an explicitly completed observation, not a hit/miss metric sample.
- The Account change removes row-existence “normal” status and 0/100 fallback.
  The Voice change closes a real subscriber/internal boundary: the existing
  `getCurrentEntitlement()` must report a logged-in server-admin before
  `InternalVoicePage` mounts or starts its raw QA readers. Auth transitions
  immediately invalidate access. `ma_tools` remains an internal display
  preference only and cannot authorize access.
- **No Backend Auth rule, Auth configuration, role row, entitlement mutation,
  RLS/ACL grant, secret, or JWT strategy changes.** No changes to the entitlement
  service, Supabase client/config, feature flags, database schema/migrations,
  Fetch/Generator/Publication/Closing/Learning producers, Cron or LINE delivery.
  The only changed Edge entry point is the read-only `get-report-payload`.
- Existing inaccessible/unmounted legacy display components are not counted as
  current route exposure. This is justified by the real router/import graph,
  not by a filename containing “admin”. `/dashboard` redirects to `/account`;
  the independently mounted `/voice` reader now has the server gate above.
- Legacy public Performance rows lacking canonical publication/revision and
  complete same-revision closing receipt remain insufficient and excluded from
  metrics. This is safe suppression, **not evidence that all existing Production
  history can render complete results**. No missing receipt is synthesized.
- Regression fixtures are local synthetic presentation evidence except the
  explicitly sanitized, provenance-retained legacy Payload44 fixture. No test
  data is a new historical market observation or automatic stability day.
  Final regression/CI/Readdy counts remain pending the parent acceptance run.

### Protected source differences: approval still required

The existing integrity registry is unchanged:
`docs/operations/core-stability-incident-amendment-20260908.json`,
HEAD/current SHA-256
`343495f199d47aa1263d3014e433d028641fd1c85e2dfb786e8fcdd3095450d2`.

“Original Production baseline” below means the saved historical baseline in that
registry, **not a new live Production read**. “Previous approved file hash” equals
the current HEAD source and existing `files[].incident_sha256`.

| Protected file | Original Production baseline SHA-256 (preserve) | Previous approved file SHA-256 (preserve) | New candidate SHA-256 (not yet registered) |
| --- | --- | --- | --- |
| `src/services/resolveActiveReport.ts` | `1400690c2f8ffcafff0061e3cbfc35ab5a6276de0fc668359a32ebcf86af5f61` | `7878c8cf7d3f46502bd4d4005804e5bf3aa31faca4acec087c9cf6c346d20a0c` | `8aa41928fffed876a43d9284b4d833cbe02833bb2fd7bd5769abc13e67e61454` |
| `supabase/functions/get-report-payload/index.ts` | `3195efd17035cf81a69d01cac19c2a1f315b04a3a17faf8076c5933d8101b370` | `2a22a1403ed22a09b2e2aa0bebd829d02b81ec3866511df2585307053efeb441` | `48c59788d7c64744cfba863e6f9fad44a52afdd696f0d5d973bc72d675e75735` |

One protected declaration changes independently of the whole-file hashes:

| Declaration | Original Production SHA-256 | Previous registered SHA-256 | Candidate SHA-256 |
| --- | --- | --- | --- |
| `supabase/functions/get-report-payload/index.ts:buildHistorySummary` | `0a08c59517a74a16b5c746d9b41f6a2c7e826a60e2e85b5f78c4771e72205c4a` | `0f2ace90c60a7f0d340b069e3e4e414b5fe1dc95a270c79db20230631d252366` | `451fb4e64a57bf2d334544ea8f71f06b24e0caf631dc95fb7616a22fca482470` |

Reasons: Payload public/history output uses the single projection; history carries
the projected same-revision closing receipt and suppresses unpublished/raw
confidence. Resolver preserves the server-selected identity and projected
presentation, removing local raw-confidence and synthetic-revision fallbacks.
No change to these readers authorizes publication or recommendation evidence.

Exact tracked source diff reference:

```sh
git diff --binary 1bb06a047f38600be27f6e89a38b81baa5578706 -- supabase/functions/get-report-payload/index.ts src/services/resolveActiveReport.ts
```

Saved diff:
`/private/tmp/ma-core-final-20260907/subscriber-projection-protected-diff-20260908173552.patch`
SHA-256: `120de25f0fca5db6aa3765591fa0291a58a540415702af2056e1e9f5238bd569`.
All tracked changes are reviewable via `git diff 1bb06a0 -- <listed-path>`;
new files require review of their full source, not only Git's tracked diff.

**Required next integrity operation: explicit append-only candidate approval.**
Request permission to append exactly the 2 protected file candidate hashes and
the 1 `buildHistorySummary` declaration hash above, with this source-diff
reference, reasons, approval provenance/time, and the previous approved source
as the comparison/rollback target. Preserve all original Production hashes,
previous registrations and prior approval history. Do not overwrite an old
baseline, approve unknown drift, remove a failing integrity test, or relabel
unexecuted tests as passing. If any listed source hash changes, regenerate and
re-review this snapshot before requesting approval.

This document and local manifest **do not update the integrity registry**.
Protected hash-pin failures remain genuine unapproved-candidate failures until
the separate append-only approval and registry operation are complete. They
cannot be waived to obtain CI. Any subsequent Production release or rollback
also requires its own gate; a saved comparison target is not deployment approval.

### Superseding candidate proposal — Payload sentence aliases

This append-only audit update was captured at `2026-09-08T17:48:03.122Z`. It supersedes
the candidate hashes/counts above where explicitly listed; the prior snapshot,
saved diff, original Production hashes and previous registered hashes remain
retained. This is still **not an integrity-registry approval**.

The final bounded audit reproduced a real read-contract contradiction using
actual Payload functions and existing synthetic rows: READY + PUBLISHED with
canonical confidence null returned a suppressed projection but still exposed
`模型信心 100/100` in legacy sentence aliases. No Production request was made.
The minimal fix supplies the legitimate legacy sentence as projection input
before validation, then derives public/canonical sentence aliases and history
summary solely from `marketDecision.summary ?? statusLabel`. Suppressed text
cannot fall back to the raw generated sentence. Adjacent semicolon-delimited
market facts remain intact. There is no change to Auth, queries, publication or
recommendation gates, central projection logic, UI, schema or producers.

| Changed since 17:35 snapshot | Previous unregistered candidate SHA-256 | Superseding candidate SHA-256 |
| --- | --- | --- |
| `supabase/functions/get-report-payload/index.ts` | `48c59788d7c64744cfba863e6f9fad44a52afdd696f0d5d973bc72d675e75735` | `09a24b5e72a8eec28d58cec4020134443ae8417d5212ee9d41c306b678e245d7` |
| `tests/marketPublicationPayload.test.mjs` | `1f60c90e935aa87d57b7ef785ebea7f497a07e1fdd4cf4a42eb09b70ba5f37f9` | `eaa46c0e262768f90563e5655cd58fe490cbe0cbe911a9c15e0b10489c728edf` |
| `tests/publicRelease.test.mjs` | `864219c887a766624bd718786bec623195290242a647941dc3b3b61904e24000` | `c07dfa43c3c97e2c39d414067edbe56af4a9be2041ea90c55d93cb189d9a2a35` |
| `tests/browser/subscriberProjection.e2e.mjs` | `b26117bcccf7a86ee1d26ee1a6093ddb496e6df1df7370a66a0c10c7420e623a` | `c01d6179d01efd814fa6b8deeeb29c45e1ea4aa10bf3db9b5f183125824558e6` |

The public-release and Browser test hashes above include the already completed
parent acceptance changes; they are not additional application changes made by
the Payload alias fix.

Protected `buildHistorySummary` declaration's previous **unregistered candidate**
hash `451fb4e64a57bf2d334544ea8f71f06b24e0caf631dc95fb7616a22fca482470`
is superseded by
`d403ea7baa3574ed6c9493296eb55df02eff1d0b957502ced7e12d5fd49d5f70`.
Its original Production and previous registered hashes in the earlier table
remain unchanged. Resolver's candidate remains
`8aa41928fffed876a43d9284b4d833cbe02833bb2fd7bd5769abc13e67e61454`.

The required separate append-only approval must therefore reference the final
Payload whole-file hash `09a24b5e72a8eec28d58cec4020134443ae8417d5212ee9d41c306b678e245d7`,
the unchanged Resolver candidate, and this final history declaration hash—not
the earlier unregistered candidates. No existing integrity test/pin is bypassed.

Focused validation executed against this candidate:

- Actual Payload Node regression: **25 passed / 0 failed**, exit 0; 2 new tests
  cover public/member/VIP/admin aliases, historical summaries, suppressed score
  prose, retained legitimate market facts, and validated legacy sentence input.
- `deno check --no-lock supabase/functions/get-report-payload/index.ts`:
  **exit 0**, Deno 2.9.2.
- `git diff --check`: **exit 0**.
- No frontend/app source changed after the Browser source freeze. Parent must
  report final full Node/Edge/CI results separately; these focused results are
  not a substitute for the full regression.

Same Git HEAD baseline now has **37 tracked modified files, +1104 / -1118**,
plus 8 new non-document task files totaling **1149 lines**. Candidate scope
remains **46 files including this document**; excluding this mutable document,
**45 files, +2253 / -1118**. The 47 pre-existing untracked files were rehashed:
**0 changed**. Staging remains empty; HEAD/origin/main unchanged.

Superseding complete scope manifest:
`/private/tmp/ma-core-final-20260907/subscriber-projection-scope-20260908174803.json`
SHA-256 `c7216f14454f0f73b3b7e8adf9b28390ceffe508450d658d6e99c3ac3b6c26bd`.

Superseding exact protected source diff versus HEAD `1bb06a0`:
`/private/tmp/ma-core-final-20260907/subscriber-projection-protected-diff-20260908174803.patch`
SHA-256 `7f8abe21abf2004fe26861306b200ab9f9b4b8070f1c457f9a31ea409e665c50`.

The original registry SHA remains
`343495f199d47aa1263d3014e433d028641fd1c85e2dfb786e8fcdd3095450d2`.
No Commit, Push, Merge, Deploy, Production Publish, Migration, Cron, Recovery,
LINE operation or Production data write was performed for this update.

## Final frozen-source validation — 2026-09-09 Asia/Taipei

This result supersedes pending validation counts above, not the integrity
registry or a Production acceptance record.

| Gate | Actual result |
| --- | --- |
| Type-check | PASS, exit 0 |
| Repository lint | PASS, exit 0, 0 errors / 0 warnings |
| Production build (local) | PASS, 209 modules, 6.49s, exit 0 |
| Local Readdy-compatible packaging build | PASS, 209 modules, 21.60s, exit 0; no root shared/server directory included |
| Node full regression | **FAIL: 543 passed / 545, 2 integrity-pin failures, 0 skipped** |
| Actual Payload regression | PASS, 25/25, including suppressed-confidence sentence aliases |
| Deno regression | PASS, 57/57 |
| Edge checks | PASS, 6/6: generator, orchestrator, payload, fetch, LINE reader, health |
| Local database integration | PASS, 13/13; database sources unchanged after execution |
| State × Route × viewport × real local tier | PASS, 264/264, plus 2/2 internal-route preference denials |
| Live subscriber raw-confidence direct reads | 0; guarded route/component/reader graph, internal raw QA excluded |
| git diff --check | PASS |
| Actual Readdy-host build | NOT EXECUTED for this uncommitted candidate |
| New candidate GitHub CI | NOT EXECUTED; integrity gate remains closed |

The final Node, Deno and Edge logs are respectively
`/private/tmp/ma-subscriber-projection-terminal-node.log`,
`/private/tmp/ma-subscriber-projection-terminal-deno.log`, and
`/private/tmp/ma-subscriber-projection-terminal-edge.log`.
All 404 selected source/test inputs were unchanged throughout those runs.
Source fingerprint: `d21948adc454f5775996e36722c614f5b76ec70e333025f67bc2ad15a0b93a73`.
Test-input fingerprint: `0f2dc71fc83fdb51a5e201d4bc388e0bfb252f2a523de19270fd43eff30f53f5`.
After the Payload-only alias fix, all 260 Browser source hashes and all 268
local packaging-build source hashes were independently checked against the
current tree: **0 changed**. Those frontend results therefore remain applicable;
they do not substitute for the separately executed actual Payload tests.

The two failed tests are the protected Production-dependency preservation pin
and the Core-freeze/canonical-reader pin. Both encounter the final unregistered
Payload hash first. The complete protected diff above additionally enumerates
the Resolver file and history declaration. No assertion, hash pin, old baseline,
or security gate was removed or bypassed. Full regression is **not PASS**.

Next authorization required: review the superseding exact source diff and grant
append-only integrity registration for its two file hashes and one declaration,
preserving all Production and earlier approved hashes. Then rerun the complete
gate before any separately authorized candidate Commit/Push, new-SHA CI and
Readdy Preview synchronization. No Production Publish is authorized by this
document, and failed Version 641 must not be republished.

Final Git: `main`, HEAD and origin/main both
`1bb06a047f38600be27f6e89a38b81baa5578706`, ahead/behind 0/0, staging empty;
the 46-file local candidate is uncommitted and all 47 pre-existing untracked
files are preserved. No Commit, Push, Merge, Deploy, Production migration,
Cron change, Recovery, LINE operation or Production data write occurred.

**NEW_RELEASE_CANDIDATE = NOT_READY** until integrity, new-SHA CI and actual
Readdy-host gates have all passed. Local synthetic presentation acceptance is
not a natural Production stability day and does not rewrite any prior failure.

## Owner-approved append-only registration and fresh regression

The next explicit owner approval authorized append-only registration of this
reviewed Subscriber Projection candidate and fresh validation. Registration was
recorded at `2026-09-08T18:19:54.394Z` (2026-09-09 Asia/Taipei), not inferred from
the user message timestamp. The prior NOT_READY/failed test records above are
retained, not relabeled as earlier success.

The original registry is unchanged after removing only the newly appended
`subscriber_projection_candidate_registration` property: 24 file records,
34 declarations and five approval-history records exactly match Git baseline
`1bb06a047f38600be27f6e89a38b81baa5578706`; normalized SHA-256 remains
`343495f199d47aa1263d3014e433d028641fd1c85e2dfb786e8fcdd3095450d2`.
No old Production hash, prior candidate hash, approval or failure was removed.

Permanent source evidence is now stored in
`docs/operations/evidence/subscriber-projection-candidate-20260909.json`:
SHA-256 `4dbb461f7350ee3f6c8b8923174e9b4ff97d54e3220b99f9dfa7b06cdc0ea63d`.
Its exact protected patch still hashes to
`7f8abe21abf2004fe26861306b200ab9f9b4b8070f1c457f9a31ea409e665c50`.
All 45 reviewed non-document candidate files have original/candidate hashes,
reasons, diff references, rollback references and approval provenance. The two
protected file successors and one declaration successor use the final hashes
already reviewed above. The saved Production v42 source is explicitly
distinguished from the previous approved repository pin; no deployment occurred.

The existing integrity assertions now resolve only these exact approved
successors through `tests/helpers/subscriberProjectionIntegrity.mjs`. It checks
independently fixed old-registry, artifact and patch digests, exact scope and
old-hash chain, metadata and actual candidate bytes. The original 109-file
aggregate, all actual-file comparisons, protected declarations and AI/strategy
exclusions remain intact. Fifteen dedicated positive/negative tests reject
missing approval, unknown/duplicate paths, wrong old/Production hashes, changed
history, tampered artifacts/source, absent provenance/rollback and improper
Production/Merge authority. This is not a latest-hash fallback or an exemption.

Fresh results after registration:

| Gate | Result |
| --- | --- |
| Full approved Node manifest | **560/560 PASS**, 48 files, exit 0, zero skipped |
| Focused Integrity | **19/19 PASS**, including 15 successor-safety tests |
| Deno | **57/57 PASS**, Deno 2.9.2 |
| Edge checks | **6/6 PASS** |
| Type-check / lint | **PASS**, exits 0; lint zero errors/warnings |
| Local production build | **PASS**, 209 modules, 1.51s, Node 22.23.1 |
| Local DB integration | **13/13 PASS**, actual isolated PostgreSQL 17.11 |
| Fresh local Readdy-compatible build | **PASS**, 268 copied inputs, 209 modules, 3.70s, exit 0 |
| Browser evidence/source recheck | Prior 264/264 + 2/2 role-boundary PASS remains matched to all 260 unchanged app inputs; not rerun this baseline-only turn |
| git diff --check | **PASS** |

410 final source/test/registry/evidence inputs stayed unchanged during the final
Node/Integrity/Deno/Edge run. Fingerprint:
`b1aa1d0baf616b1f6a824ecc3c3def2d36fdcab093ca236ea086154c2725a80d`.
Logs: `/private/tmp/ma-subscriber-approved-baseline-20260909-final-{node,integrity,deno,edge}.log`.
The full Node command explicitly uses tracked tests plus the five approved new
suites; it does not execute preserved, out-of-scope File Provider ` 2` copies.
The literal local npm glob would include those untracked copies, unlike a clean
candidate Git checkout; it was intentionally not represented as executed.

Fresh DB artifact:
`/private/tmp/ma-core-final-20260907/subscriber-projection-db-20260908181753-result.json`,
SHA-256 `746ce814866bb81ff6bfa81a7b506bba8854399c22b00553adca090359f7ef49`.
Two new local databases only; original test databases retained. Migration
fixtures were tested only on loopback `127.0.0.1:55439`, never Production.

Fresh packaging artifact:
`/private/tmp/ma-subscriber-projection-build-202609090239-approved/result.json`.
It contains src/public/root configs only, without root shared/server code,
environment files or credentials. This is **not an actual Readdy-host build**.

### Remaining remote candidate handoff

Browser control was recovered through a new read-only Readdy tab. The existing
project remains connected to `sonytzeng/morning-alpha` and Preview Version 641
(`/preview/f1fd69c3-51fe-40d6-a2e3-b8f62112861e/13731421`), not this candidate.
Only GitHub connection/settings were read; no Pull, Push, reset, Auto-Fix,
configuration change or Publish occurred. The temporary inspection tab closed;
the original user tab was preserved.

`.github/workflows/validate-release.yml` accepts a remote committed ref via
PR-to-main or workflow_dispatch and checks out GitHub code. It has no local
working-tree/artifact input. Therefore neither old-main CI nor Version 641 can
serve as evidence for this new candidate. Current owner approval expressly
covers Baseline/validation, while AGENTS.md separately requires explicit
Commit/Push authorization; no new Git commit/ref was created by inference.

**Next required authority: Commit/Push this reviewed candidate to a named
feature branch for new-SHA CI and authorize that same candidate's Preview sync
path.** Do not update or merge main just to satisfy Readdy. If Readdy's available
sync path requires main, obtain a separate reviewed main-integration approval
rather than silently broadening this one. Production Publish remains prohibited.

`INTEGRITY_BASELINE = PASS`; `FULL_LOCAL_REGRESSION = PASS`;
`CI = NOT_RUN_NEW_REF_REQUIRED`; `READDY_BUILD = NOT_RUN_NEW_CANDIDATE_REQUIRED`;
`NEW_RELEASE_CANDIDATE = NOT_READY` pending those remote gates.
No Commit, Push, Merge, Deploy, Production Migration, Cron, Recovery, LINE or
Production business-data write was performed.

## Overnight closure authorization and additional checkpoint boundary

The subsequent owner-authored `Overnight Production Closure` request explicitly
authorizes the reviewed candidate's Commit/Push/PR/CI, main-to-Readdy handoff,
Preview/build, coordinated Payload/frontend release and saved-source rollback.
It supersedes the remote authorization blocker above; it does not rewrite the
scope or historical authority recorded in the immutable earlier registration.
Production business-data changes, member changes, historical LINE replay,
Gate weakening and artificial stable-day credit remain prohibited.

Fresh remote main was still `1bb06a047f38600be27f6e89a38b81baa5578706`.
The working candidate was isolated on `codex/subscriber-projection-20260909`.
The 47 existing out-of-scope untracked files remain excluded and preserved.
Fresh Node 560/560, Deno 57/57, Edge 6/6, type-check, lint, build (209 modules,
19.88 seconds) and diff checks passed before the additional audit below.
Fresh isolated PostgreSQL integration again passed 13/13; evidence is
`/private/tmp/ma-core-final-20260907/subscriber-projection-db-20260908190200-result.json`.
Only the two new loopback databases were used; no Production SQL mutation ran.

The broader raw-state audit reproduced an additional consumer boundary defect:
War Room's `getRuntimeCheckpointState` use could accept a completed checkpoint
from a previous report date/revision and upgrade a current READY/ACT headline.
The callback accepted nonempty evidence without binding canonical identity.
The overnight approval explicitly permits this minimal central-contract repair;
the fix must be a Projection-owned checkpoint proof, not another route-local
interpretation. Original pre-fix source bytes and the interrupted prior Browser
run are retained. Its 197 completed cells do not count as final passing evidence.
The final candidate must re-run the matrix with War Room included.

Production rollback preflight confirmed Readdy live Version 638 remains active;
Payload platform v44 contains the original v42 ten-file source, and Fetch v64
is unchanged. Fresh complete source archives are in
`/private/tmp/ma-subscriber-rollback-readonly-20260909/`.
No deployment has occurred at this checkpoint.

### Read-only Production Auth verification boundary

The existing Production `ensure_member_entitlement_v1` performs writes for a
valid authenticated caller, including an admin entitlement upsert/version bump.
Both the preserved and candidate Payload invoke that unchanged RPC. Therefore
Production Owner-session route smoke would violate this request's no-member-
modification boundary. Production smoke uses anonymous reads, OPTIONS, invalid-
credential rejection and catalog/source parity; actual role/PKCE/entitlement
and private-table RLS behavior are exercised in the isolated local matrix.
Do not claim Production authenticated read-only E2E was run or alter the RPC
just to make acceptance easier.

## Shared Narrative Repair — frozen-source local acceptance, 2026-09-09

This appended result supersedes earlier candidate test totals, not their
historical records. The former 264-cell result cannot certify the additional
checkpoint/narrative changes. September 7/8 Production FAIL and Version 641
Smoke FAIL remain unchanged. No local fixture is a natural stability day.

### Root cause and single interpreter

`canonicalNarrative.ts` previously reconstructed completion from raw checkpoint
and closing aliases after the central Projection had already rejected them.
Account separately trusted an opening-radar label/date. V11 observations exposed
unbound per-stock confidence. A stale War Room early return used a raw date and
omitted the canonical root identity markers.

The existing dependency-free `subscriberReportContract.ts` is still the only
state interpreter. It now owns `runtime.decisionEvidence`, using the same
published identity, checkpoint proof and closing receipt. Confirmation requires
meaningful checklist and complete numeric TAIEX/TXF/2330 inputs; availability
alone cannot manufacture proof. `canonicalNarrative.ts` consumes this projection
once. The server-selected rawRow owns both identity and explanatory source;
unrelated caller AI/member prose cannot override it. PARTIAL prose and NOT_DUE
closing remain incomplete. A bound closing hit is not rewritten by an earlier
failed intraday checkpoint.

Account's display-only checkpoint formatter accepts Projection, not raw radar
or caller-forged view props. V11 retains qualified observation identity/prose
but suppresses unsupported stock confidence rather than substituting a report
score. War Room's stale branch uses projection.historical and projection.identity
for its copy, link and root markers. No new translator, strategy, provider,
threshold, Auth/RLS, Cron, LINE or producer modification is introduced.

Full executable dependency audit: ten subscriber entrypoints, 80 reachable files
(79 code plus CSS), no new/removed/unresolved import. Actual rendered raw-state
bypasses: **0**. Internal/producer/unused raw readers are explicitly classified,
not incorrectly claimed absent from a global text search. Detailed graph:
`/private/tmp/ma-subscriber-final-reader-graph-20260909-complete.json`
SHA-256 `3924ca94f7ae71629a7ae3ee057bfffa2b311512f04c42050c4a1c44ab2622be`.
Audit: `/private/tmp/ma-subscriber-final-reader-audit-20260909-complete.md`.

### Append-only integrity and retained diagnostics

The original registry and first 45-source artifact are unchanged. The second
registration adds exactly 15 reviewed successor sources with full inline diffs,
predecessor hashes, reasons, owner-approval provenance and rollback references.
Its section SHA-256 is
`38b047ec1839597bb5e11396e831bb4f6c241c34e6823ecfe6c917f6b80983e9`;
its inline source patch is
`031c7413437fd26fe80dcd10bab38203d2d8ddf24398b0ede0dcd3a118a5c00f`.
All 15 predecessors are reconstructed byte-for-byte, not asserted from labels.

A third, test-only successor preserves the complete second registry
`2356082045202008439e56d85a81e197937ec565b08b1cbc1a22bbdd93293518`.
It changes only the old publicRelease raw-date assertion into three stronger
canonical branch/identity/no-raw checks. Third section:
`38f7a84399d22ded1de328d866edab5185a1bf03230e4774a6afd38166427a6f`.
Final registry:
`7597edbd731636882e442faecd3bc4f8dd6f0701e07dd1ed7ddfe32e43b7505b`.
Independent fixed anchors and exact-scope negative tests reject unknown source,
rewritten history, new authority or simultaneous mutable-hash self-approval.

Preserved diagnostic failures include 580/585 and 582/585 Node runs, the
390-cell Browser attempt stopping at row 88 on the missing stale War Room
marker, and the 617/618 Node run with the obsolete raw-date assertion. Their
directories remain intact. A prior patch prediction added blank lines to pure
deletion hunks; corrected reverse-preimage/transpiled comparison proved the
applied canonicalNarrative source hash below, without changing the old artifact.
No failed test or unknown source was registered as approved behavior.

### Final local gates (fresh, same application source)

| Gate | Actual result |
| --- | --- |
| Integrity | 71/71 PASS; 70 exact positive/tamper cases plus protected Production declarations |
| Node | 640/640 PASS, 48 approved suites, zero failed/skipped |
| Deno | 57/57 PASS; Deno 2.9.2 |
| Edge check | Six entrypoints PASS, exit 0 |
| Type-check / lint | Both exit 0; zero lint errors/warnings |
| Build | Exit 0; 208 modules, 1.43s, Node 22.23.1 |
| Isolated DB | 13/13 PASS; real PostgreSQL 17.11, local migrations applied twice |
| Browser state/route/role/viewport | 390/390 PASS, fresh complete run |
| git diff --check | PASS |
| Local Readdy-compatible packaging | PASS; 268 inputs, 208 modules, 1.55s |

Final command/log/source manifest:
`/private/tmp/ma-shared-narrative-final-202609090830/result.json`, SHA-256
`6439521b16eef42d17ac0b249243b415d97c5d078b4a34866a3e264cecaf98a1`.
All selected source/test inputs remained unchanged during validation.
The Node manifest excludes the 47 preserved, unrelated untracked files.

DB evidence:
`/private/tmp/ma-core-final-20260907/subscriber-projection-db-20260909074500-result.json`,
SHA-256 `b4af81446e8696ba7dea47d4e4a49ff8d469304f4cab507847b48e58446eef06`.
Only two newly named loopback databases were created; previous databases remain.
Registry and all tracked DB fixtures/migrations matched their reviewed sources.
No Production SQL was executed by the DB test.

Browser evidence:
`/private/tmp/ma-shared-narrative-browser-202609090812/subscriber-projection-results.json`,
SHA-256 `705e48bdb004b1351ed1c876f779abcde52542156a4801115e6af3c542166b47`.
Thirteen states × five routes × two viewports × three actual local server tiers.
Routes: Home, Today, dated report, Verification and War Room. Viewports: 390×844
and 1440×1000. Real local PKCE, entitlement/RLS and reload remain required;
only declared local report-reader fixtures and external asset substitutes are
used. The test preserves existing business rows, local signup configuration
and app-source hashes. Expected deliberate private-table RLS denials are not
misreported as product network regressions. This is not Production Owner E2E.

Local packaging evidence:
`/private/tmp/ma-subscriber-projection-build-202609090813-cache-authorized/result.json`,
SHA-256 `ae30a262ac8ef4079cc6da8a90698e0c93e3474869a1430b02bb74e8702d3bc9`.
Only src/public/root configs are packaged; no root shared/server/env/.git input.
The earlier sandbox cache-write EPERM was retained and resolved with scoped
cache access, not source changes. A local packaging PASS is not hosted Readdy
Build evidence; exact new-SHA CI and hosted Preview still follow this record.

`SHARED_NARRATIVE_PROJECTION = PASS`; stale-date, wrong-revision and
missing-evidence false completion are zero in the executable positive/negative
matrix. The actual narrative SHA is
`8a034bb6f6675891e79f098a2b25c0dadc4d5f1888c525b503853edcfce4f069`.
Current Projection SHA is
`ec7434a9b16ff44bcafc822faf16662dc95386fe4de0f9c8ca7fcb7abee1b346`.
No Production release or automatic business-day PASS is claimed at this point.
