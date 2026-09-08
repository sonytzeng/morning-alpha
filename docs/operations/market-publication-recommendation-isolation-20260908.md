# Market publication / recommendation isolation — 2026-09-08

## Scope and release status

Latest local status after the owner's explicit validation-order approval: **exact baseline registration and all required local checks PASS**. New-commit GitHub CI must still pass after the separately authorized feature-branch Commit/Push. Earlier refusals and failures below remain historical records, not current source defects. Production deployment/merge is not authorized; `TODAY ALL PASS` for 2026-09-08 remains **NO**.

Branch: `codex/core-stability-20260907`. Baseline for this follow-up: `3782878184515195a3c5f59988ab871dced6ec87`. Existing Draft PR: #108. This work has not been deployed, migrated, merged, or used for Production Recovery/LINE delivery. The pre-existing `docs/research` inventory files are outside this repair's commit scope.

**Production is not declared repaired.** The read-only Production probe at 2026-09-08T04:18:32.834Z returned HTTP 200, `report_date=2026-09-08`, revision `082e552d-f637-4d49-84e5-2f8e6ceb3411`, generated at `2026-09-07T23:35:11.857Z`, and canonical status `PARTIAL`. `/report/today` returned HTTP 200. This is not proof of an eligible current publication or of frontend release synchronization.

## Root causes and corrections

1. Market publication inherited stock/Premium research readiness. A valid market thesis could therefore be suppressed when company evidence was insufficient. The market gate now checks the audited market document independently; stock admission retains company provenance, freshness and existing Premium requirements.
2. SQL publication consumers accepted only recommendations/no_trade. The new, explicit `market_only` mode is WAIT, never a claim of a completed full-universe screen. Its DB contract requires identical date-bound gate proof, empty stocks, editorial >=90, coverage=100, real source references, matching passed semantic/member revision, and atomic publication.
3. Readers selected latest/current PREMARKET QA rather than the report's published decision/member pointers. Payload and delivery consumers now read those exact published pointers, including intraday revisions. A missing/mixed pointer fails closed, without silently substituting an old holiday report.
4. A weak V8 daily sentence was selected based on length/novelty before its action/checkpoint contract was checked. It now must pass the existing sentence validator; otherwise the unchanged fresh, actual-market-quote source path is considered. No Prompt, research threshold, stock scoring policy or financial percentage is invented.
5. Subscriber market-readiness must distinguish evidence eligibility from actual publication. Explicit blocked publication or PARTIAL canonical status cannot become READY. The same-day identity is retained rather than relabelling an older report as today.
6. Internal QA and engineering release state were conflated with business health. Open/Draft PR status is independent; actual failures, missing evidence and NOT_DUE are not converted to PASS.
7. LINE v59 uses a deployed Flex renderer missing from the local legacy baseline. Its verified existing rendering is retained, with a bounded market-only branch that publishes no stock cards or five-stock ranking claim and uses the exact insufficient-evidence notice. No LINE invocation is required to test its renderer and eligibility helpers.

Subscriber notice: **推薦評估證據不足，今日暫不發布正式個股推薦**.

`NO_QUALIFIED_OPPORTUNITY` requires a real complete, nonempty declared universe, matching evaluated count and no rejected/missing evidence. Empty arrays alone do not establish that result. Unsupported stocks and Opportunity Scores remain absent, not zero-filled.

## Isolated Runtime evidence

All data below are explicitly synthetic local test inputs in the existing isolated Supabase network. Auth/PKCE, PostgREST, JWT, RLS, foreign keys, triggers and publication RPCs are real local implementations. No Production user, secret, report, snapshot, provider AI call or LINE recipient was copied or contacted.

| Case | Observed result |
| --- | --- |
| Market complete, company evidence absent | Actual V9.6.3 generator HTTP 200, READY/market_only/WAIT, editorial 100 under unchanged evaluator, coverage 100, unsupported 0, recommendations BLOCKED/empty, private Premium quality remains blocked |
| Negative publication identity | 2026-09-08 / `81a4237c-d251-475c-9818-2809275b685e`; public payload same identity and exact notice |
| Original company evidence restored | Actual V9.6.3 generator HTTP 200, QUALIFIED/Premium eligible; original 2330 retained, not an invented replacement |
| Positive publication identity | 2026-09-08 / `06df6fed-8faa-4c12-8299-e40bb60c5f0a`; public payload same identity |
| Duplicate generation | Both cases repeat HTTP 200 with `reused=true` |
| Notification/source safety | Existing local LINE outbox and market quotes hashes unchanged; original synthetic news/tags restored after tests |
| DB integration | 9 focused tests and 4 legacy tests PASS; migration applied twice, private ACL/security/signatures preserved, invalid proof rollback and original-definition rollback/reapply verified |
| Delivery eligibility | Actual generated local negative rows accepted by both current consumer helpers; recomputed and persisted proof equal; no LINE call |
| Browser auth | Free/member/admin normal local Magic Link/PKCE, server role, reload and RLS PASS; forged client role/user_metadata rejected |
| Browser current report | 19 responses use the same negative-case date/revision; no stock exposure; current report does not revert to 9/6 |
| Responsive | Home/Today/Opportunities/War Room/Research/Verification/Performance x 375/390/430/768/1440: 35 layout checks PASS, root/body overflow and CTA clipping 0 |
| Browser transport | Unexpected HTTP failures, request failures, console errors and external API attempts 0; 3 intentional RLS 403s recorded separately; 17 WebSockets without errors |

Browser inspection also identified a pre-existing local clock-fixture issue: 9/7 checkpoint completion timestamps had been retained in a 9/8 runtime overlay. The original browser run is **not** evidence that Timeline semantics passed. Its date/stock/auth/layout assertions remain valid; the read-side checkpoint guard and focused revalidation are recorded separately below.

Local evidence directory: `/private/tmp/ma-core-final-20260907`. Negative `market-gate-runtime-result.json`, positive `market-gate-positive-runtime-result.json`, `market-delivery-readonly-verification.json`, and `market-gate-browser-redacted.json`. Browser artifact SHA-256: `fed678abc39a36c4a22bcd781dff06f1d6173f76e79649c4c1751a2e99624bc9`. These are local evidence, not Production Acceptance records or automatic stable days.

### Final read-side checkpoint guard revalidation

After rebuilding the final local payload bundle, a fresh anonymous, read-only API/browser run retained the positive 2026-09-08 publication `06df6fed-8faa-4c12-8299-e40bb60c5f0a` (v6), Market READY/eligible, and its matching canonical identity. Five cross-date completion entries were downgraded to `insufficient`, with `completed_at=null` and `real_checkpoint_observation=false`; the original 9/7 times remain diagnostic evidence only. The response reports zero completed checkpoints without blocking the valid market publication.

All five actual browser sizes (375/390/430/768/1440) had zero horizontal overflow. The false 14:10 completed label is gone: it reads 「資料不足」; 14:30 reads 「等待驗證」. Console errors, unexpected HTTP errors, failed requests and external API attempts were zero. Reports, checkpoints and LINE hashes were unchanged before/after this verification. No new authentication email, fixture mutation or producer call occurred.

Evidence: `/private/tmp/ma-core-final-20260907/market-runtime-readonly-smoke.json`, SHA-256 `fd16b2fd6008ac1a3ebe00ab34035373c6d8725bc5ee4a7477501e31c6531a76`; screenshots `market-runtime-guard-today-*.png`. The five new guard regression tests pass; combined payload/runtime integration tests are 35/35 PASS. This evidence establishes rejection of false completion, not a blanket approval of every future NOT_DUE/current-node Timeline UX state.

## Permanent integrity gate — blocked, not waived

Updating `docs/operations/core-stability-incident-amendment-20260908.json` to record the final reviewed source hashes was rejected by the tool security reviewer: it could accept unreviewed Production-related drift by changing the permanent integrity baseline. Preparing that change as a temporary patch was also rejected. Neither rejected action was applied; no CLI/alternative tool is used to bypass the decision.

The original Production source manifest, original source hashes and protected Prompt/AI/strategy assertions remain in place. New functional tests do not replace these checks. Until the exact new declaration/file hashes are independently approved, a full regression/CI PASS and a new commit cannot be claimed. Existing PR CI belongs to baseline `3782878`, not this uncommitted working tree.

The outstanding review concerns recording the necessary generator sentence selector/version, payload read-side selectors, delivery consumer selectors, preserved Production Flex dependency, and their strict contract checks—not authorizing weaker research gates, new strategy, Auth/RLS changes, Production writes or deployment.

## Production release plan — NOT EXECUTED

This is a proposed coordinated release, requiring separate explicit approval after the permanent integrity gate and final-head CI pass.

1. Re-read Production versions, original function bodies/private ACL, trigger binding and quality policy immediately before release. Stop on unexplained drift. Saved observed versions: generator 229, payload 42, LINE 59, orchestrator 29, health 20. Preserve their existing JWT strategy and secrets; do not use a new `verify_jwt=false` workaround.
2. Review/apply **only** `supabase/migrations/20260908050000_market_publication_recommendation_isolation.sql`. It replaces `enforce_decision_snapshot_premium_90_gate_v1`, `publish_research_bundle_v1`, and `publish_member_content_revision_v1`, preserving signatures, owner, security/search_path, private ACL and existing trigger binding. No table, RLS, Auth, Cron, Acceptance or reconciliation replacement is included.
3. Do **not** run a bulk `db push` of pending branch history. In particular `20260908020000_incident_acceptance_market_delivery.sql` and earlier canonical/atomic migrations are not approved by this plan; their presence in isolated CI is not deployment authority.
4. Deploy compatible readers/consumers before the generator: get-report-payload, ma-ops-health-check, line-daily-push, daily-delivery-orchestrator, then generate-daily-report-v7, sequentially with their exact tested imports. Publish the matching frontend only under separate frontend approval. All dependency hashes must match the final approved commit.
5. Do not redeploy Fetch v64, Acceptance/reconciler, opening/closing/learning, safe-recovery, Cron, Emma, Content OS or Signal Lab merely because a shared file is referenced. No manual production generation or LINE test send is part of this plan.
6. After deployment use status/compile/Auth rejection and read-only payload/route evidence; observe the next natural producer run. Actual 9/8 historical failures remain failures. No manually generated/recovered date enters automatic stability metrics.

### Rollback constraints

The original three SQL definitions/private ACL are saved outside the repository in `market-publication-20260908/rollback-executable-20260908T034606Z.sql`, SHA-256 `0fcdfc130e3ce509fc79ed2d67fcabd27ac3caf55bd94dd053b1666b1a110627`. Original deployed Function source archives are versioned and hashed separately; they must be refreshed if Production drifts.

Before any market-only row is published, exact original-definition rollback/reapply is locally verified. **After a new-mode row exists, do not blindly roll all readers/SQL back to versions that cannot read it.** Stop the new producer first, retain compatible safe readers and schema, and use a separately reviewed forward correction. Never delete, relabel or rewrite a business row, historical evidence or LINE receipt to make rollback appear successful. No rollback is executed in this task.

## Final local checks and file scope

- Type-check: exit 0. Repository lint (`eslint src`, max warnings 0): exit 0. Production build: exit 0, 209 modules, 1.29 seconds.
- Integrated Edge check: all six entrypoints exit 0. Deno contracts: 57 passed / 0 failed.
- Full Node regression: **456 passed / 2 failed / 458 total**. Failures are `coreProductionPreservation.test.mjs` and `productContract.test.mjs` source-hash assertions. They remain failures; no skip, altered threshold, or integrity bypass was applied.
- LINE consumer/Flex focused tests: 10/10; public-release tests: 51/51. Original v59 renderer hash `595c4812faecdac6bb78f68e182454448b367db9f95e946a910d0c932def18d8`; bounded candidate hash `ae170ab38e1640c55ed02b93446b94a1911c9f9bf98caf19db5ff58ba84f4f9a`. Existing recommendation/no_trade output matches original golden JSON hashes. Existing v59 does not display analysis/data-cutoff times; no new time UI is claimed.
- `git diff --check`: PASS. Staging area empty. Branch/upstream 0/0 at unchanged HEAD `3782878184515195a3c5f59988ab871dced6ec87`; main unchanged at `bf7efba525d7919f397b93045c3b9e10ae201067`.
- No new Commit/Push/CI run, Merge, Production Deploy, Migration, Cron change, business-data write or LINE dispatch in this follow-up. No automatic stable day is claimed.

37 repair files (tracked changes plus scoped untracked additions; not editor edit-history count):

- `.github/workflows/validate-release.yml`
- `docs/operations/core-stability-incident-amendment-20260908.json`
- `docs/operations/market-publication-recommendation-isolation-20260908.md`
- `docs/product-contract-v1.md`
- `src/features/decision-v1/DecisionBrief.tsx`
- `src/features/decision-v1/presentation.ts`
- `src/lib/canonicalNarrative.ts`
- `src/lib/decisionPresentation.ts`
- `src/lib/subscriberReportContract.ts`
- `src/pages/report/BeginnerTodayView.tsx`
- `src/pages/report/TodayReport.tsx`
- `src/services/resolveActiveReport.ts`
- `src/types/subscription.ts`
- `supabase/functions/_shared/canonical-decision-contract.mjs`
- `supabase/functions/_shared/content-intelligence.ts`
- `supabase/functions/_shared/line-daily-flex-message.mjs`
- `supabase/functions/_shared/market-report-gate.ts`
- `supabase/functions/_shared/production-architecture-core.mjs`
- `supabase/functions/_shared/research-pipeline-contract.ts`
- `supabase/functions/daily-delivery-orchestrator/index.ts`
- `supabase/functions/generate-daily-report-v7/index.ts`
- `supabase/functions/generate-daily-report-v7/research-master-v2.test.ts`
- `supabase/functions/generate-daily-report-v7/research-master-v2.ts`
- `supabase/functions/get-report-payload/index.ts`
- `supabase/functions/line-daily-push/index.ts`
- `supabase/functions/ma-ops-health-check/index.ts`
- `supabase/migrations/20260908050000_market_publication_recommendation_isolation.sql`
- `tests/beginnerLearningAlphaCoach.test.mjs`
- `tests/coreRuntimeIntegration.test.mjs`
- `tests/decisionSentenceBuilder.test.mjs`
- `tests/incidentHealthContract.test.mjs`
- `tests/marketOnlyCanonical.test.mjs`
- `tests/marketPublicationDatabase.integration.mjs`
- `tests/marketPublicationDelivery.test.mjs`
- `tests/marketPublicationPayload.test.mjs`
- `tests/publicRelease.test.mjs`
- `tests/subscriberMarketPublication.test.mjs`

The two pre-existing untracked research inventory documents remain intact and excluded. Temporary container data, credentials, screenshots and local test artifacts are not added to the repository.

## Explicit integrity approval follow-up — 2026-09-08

The earlier failed run above is retained as history, not replaced with a PASS. The owner subsequently gave `INTEGRITY_BASELINE_APPROVAL`, limited to this branch and reviewed differences. This section records the new review and fresh results; **it does not activate new integrity hashes**.

### Immutable reviewed candidate and original provenance

- Candidate Git base/HEAD: `3782878184515195a3c5f59988ab871dced6ec87`; no candidate commit exists yet. Branch/upstream remain 0/0. `origin/main` remains `bf7efba525d7919f397b93045c3b9e10ae201067`.
- Reviewed source patch SHA-256: `75a95ba5964cb9b52a7495f75096940ddcfc854be248d65098cecd305e4cf894`, covering 34 source/test/workflow/SQL files. All 34 file hashes were rechecked with zero mismatch.
- Permanent actual source diff: `docs/operations/evidence/market-publication-candidate-20260908.json`. Its `patch_lines.join('\n')` reconstructs the exact patch, including the final newline, and matches the SHA above. JSON encoding preserves patch whitespace without introducing trailing-whitespace violations into documentation.
- Original Production manifest remains unchanged: `core-stability-source-manifest-20260907.json`, SHA-256 `bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c`. Its earlier Production versions 227/27/40 and all original hashes are not replaced by the later saved incident versions below.
- Saved later Production sources are independently hash-verified in `/private/tmp/ma-incident-20260908-rollback/manifest.json` and complete `baseline-<function>.json` archives under the existing `visualizations/.../incident-20260908/` directory. These are observed deployment sources, **not an inferred Production Git SHA**. Exact Production Git commit provenance remains UNKNOWN where the platform archive does not identify it.
- Current registry still hashes to `3527515caed03256c20b086d6f5e0bef5b5ab6d66affc04276c12b12a61ddeea`, byte-identical to the pre-attempt saved registry. Neither original source manifest nor either integrity test was edited by this approval follow-up.

| Artifact | Saved Production version / updated UTC | Production source SHA-256 | Reviewed candidate source SHA-256 |
| --- | --- | --- | --- |
| Generator index | 229 / 2026-09-07 10:50:31.625 | `fef92b2edd3a17c2b1a7ab93b78c8e5015cc040657e28b8f57674219e2b30f96` | `79473cf68c334619a064120aa6d19cac961efffdd66316dcf6c3983d686039c6` |
| Payload index | 42 / 2026-09-07 10:49:23.543 | `50869c00bb4c6cbe176eb5b05382544b3200d5f9787ba9d90830327aea047e82` | `0794ca0c295c2ac2c415f17416dfe04601b5be8db057f4ce790bc04ac6253e3e` |
| Orchestrator index | 29 / 2026-09-07 10:50:21.883 | `c24eb655a0b0c121728a099e73562817296fa671573c252a407fb6dfd598f626` | `741ff45bb1903560e5cfc87c855a40d2d4844d96d0253ac5f486077d42706c59` |
| LINE index | 59 / 2026-09-04 03:58:16.360 | `df561b1e1252260dd989e732e71fe398ffddde6bbde1c3527c8f96d16983a96f` | `c890c749eb8dfa53462ea3b2aa7291ecfaf9ea2a80fe6e3d270723aea8bad89e` |
| LINE Flex dependency | included in v59 | `595c4812faecdac6bb78f68e182454448b367db9f95e946a910d0c932def18d8` | `ae170ab38e1640c55ed02b93446b94a1911c9f9bf98caf19db5ff58ba84f4f9a` |
| Health index | 20 / 2026-09-02 03:46:18.363 | `296f4bd106e1ab00d5cf82a9637462b8091380536658964ebb2c0e073c71ba32` | `88ddffcd7cbf0975e2fb829abf076b36576499b55acd162aaa332bd2027d9557` |

The generator, payload and orchestrator version values above are saved source observations, not claims of a fresh live deployment check. Health was independently read-only rechecked and remained v20. No deployment was performed.

### Difference-by-difference behavior and security review

1. **Generator and market/research dependencies.** The exact diff separates the audited market document from rejected private company evidence, validates the selected daily sentence against the unchanged action/checkpoint validator, and versions the coordinated contract as V9.6.3. Actual market quote fallback remains evidence-bound. Market editorial >=90, coverage=100 and unsupported/duplicate/contradictory/missing counters=0 remain enforced. Semantic proof must be valid and same-date. The existing model calls, prompts, scoring/ranking and candidate metadata are unchanged against both saved Production and HEAD. `buildCandidateUniverse` differs from saved Production but not HEAD: this is previously committed company-evidence tightening, not a new strategy in this follow-up.
2. **Payload / canonical / frontend.** The published report, decision and member revision pointers, including intraday, are authoritative; a newer internal QA candidate cannot replace them. Public subscriber AI and admin raw QA are distinct. Runtime overlays are same-revision and completion timestamps are checked after merging; cross-date/future/unproven completion is insufficient, not silently completed. Existing entitlement resolution, CORS/body limits and authorization declarations match Production/HEAD. The existing `ensure_member_entitlement_v1` call remains: this is no new privilege change, not a claim that normal entitlement resolution has no pre-existing side effects.
3. **Orchestrator / delivery eligibility.** Exact published identity and independent market eligibility replace paid-note readiness as the market delivery dependency. Recommendation evidence admission remains independent and strict. Prior HEAD recovery suppression, bounded retry, date validation and outbox idempotency remain; they are not newly authorized Production execution. No dispatch or recovery is invoked during review.
4. **LINE v59 preservation.** Original recommendation/no-trade Flex output is retained. The market-only addition has no stock cards or five-stock-ranking assertion and uses the exact insufficient-evidence notice. Review found one real missing Production capability: Flex messages have `altText`, so storing only `message.text` lost their audit preview. The candidate now restores the exact v59 expression `firstText(args.message.altText, args.message.text).slice(0, 200)`. The whole `deliverOutboxMessage` declaration equals v59, SHA-256 `42da0492a4528e4f46aa51d39af5d53c7ccdea8c3629d7b1ca911e025ddc1c11`. A new actual-function test covers Flex priority, text fallback and the 200-character cap with a memory-only sink and no LINE request. This concrete defect was fixed before freezing the final artifact; it was not registered as an accepted regression.
5. **Health.** Production business health and engineering release status are separate. Open/Draft PRs alone are not business failure; real missing quality evidence, failed runtime or notification issues still fail. Prior historical failures and NOT_DUE semantics are not converted to PASS.
6. **Publication SQL.** Only the already listed three replacement definitions are in the proposed new migration. Signatures, security/search_path, owner, private ACL and trigger binding are preserved. Same-date identical proof, empty stock arrays for market-only, matching semantic/member revisions and atomic rollback remain mandatory. RLS is not relaxed. Local migration/ACL tests do not authorize Production migration.
7. **Recommendation contract.** Stock evidence must have actual company provenance, be nonfuture and within 48 hours, and not be stale/expired/invalid/conflicting. Missing stock evidence produces no stock or synthetic score. `NO_QUALIFIED_OPPORTUNITY` requires a positive complete declared universe, matching evaluated count, same-date/revision evidence and complete assessment. Empty recommendations alone are not enough.
8. **Rollback.** Original function/source/import archives are the rollback targets, not a fabricated Git revision. The three saved original SQL definitions/private ACL hash remains `0fcdfc130e3ce509fc79ed2d67fcabd27ac3caf55bd94dd053b1666b1a110627`. Before new-mode rows exist, original-definition rollback/reapply is locally tested. Afterwards, stop the new producer and retain compatible readers/schema pending forward correction. Never delete or relabel evidence or replay LINE to simulate recovery.

### Baseline registration refused — exact outcome

The attempted history-preserving registration would have recorded the previous complete registration, untouched original Production manifest hash, later saved Production versions/source hashes, exact candidate diff/hash, approval source/recorded timestamp, reasons and rollback targets. It targeted the four known stale file registrations, four reviewed declaration registrations and the preserved v59 Flex dependency. No unknown declaration was accepted by its preflight.

The tool security reviewer **rejected the write** because full regression and CI were not complete and the permanent register could hide unverified Production-related differences. The change was not applied. It was not split into smaller edits or written through another tool. The temporary proposed update is not an approved baseline or rollback artifact. This remains an authorization/verification-order gate, not a reason to remove integrity tests.

### Fresh checks against the final reviewed source

| Check | Result |
| --- | --- |
| Node 22.23.1 `npm run test:public` | **457 PASS / 2 FAIL / 459**, exit 1, 6.195s; no skips |
| Integrity tests | Both FAIL on the unchanged registry's old file hashes; assertions were not waived |
| Deno 2.9.2 six contract suites | **57/57 PASS**, exit 0 |
| Isolated PostgreSQL 17.11 | **13/13 PASS** (legacy 4 + focused 9); migration twice PASS |
| Type-check | PASS, standalone exit 0 |
| Lint | PASS, exit 0, 0 errors / 0 warnings |
| Build | PASS, exit 0, 209 modules, 1.44s |
| Six integrated Edge checks | PASS, exit 0; Fetch is compile-only, not modified/deployed |
| `git diff --check` | PASS; scoped untracked files also checked for whitespace |
| GitHub candidate CI | **NOT RUN**: remote is still the old committed SHA; cannot count its PASS for this artifact |

The first sandboxed Node attempt additionally hit `listen EPERM 127.0.0.1`; the authorized loopback rerun completed and removed that environment-only failure, leaving exactly the two genuine integrity assertions. No runtime assertion was skipped.

Fresh DB evidence: `/private/tmp/ma-core-final-20260907/market-publication-final-db-202609080514-result.json`, SHA-256 `b8fd95805a1e6337589d344c4770e236f89893212f832e837bc211bf7a5bcbe2`. New databases `ma_core_test202609080514` and `ma_market_publication_test202609080514` were guarded to actual loopback PostgreSQL; existing databases/evidence were preserved. The result records `registryUpdateApplied=false` and unchanged registry hash. These are isolated test fixtures, not Production Acceptance.

Read-only GitHub check: Draft PR #108 remains OPEN/DRAFT at `3782878184515195a3c5f59988ab871dced6ec87`; workflow run `34181691227` was SUCCESS at that old SHA (completed 2026-09-08T02:56:08Z). GitHub cannot test an uncommitted/unpushed working tree. The requested "new candidate CI PASS before Commit/Push" ordering cannot currently be fulfilled; local workflow-equivalent tests are not reported as GitHub CI.

**2026-09-08 `TODAY ALL PASS = NO`.** No Production failure is erased and no manual or local test day enters automatic stability metrics. No Commit, Push, Merge, Production Deploy/Migration, Cron change, business-data write or LINE send was performed in this follow-up.

### Final fresh Browser result and closeout

Fresh isolated Browser E2E finished exit 0: 3 real local PKCE roles (free, paid-active member, owner admin) x 7 routes x 5 viewports (375/390/430/768/1440) = **105/105 PASS**. Reload, server-side entitlement and RLS checks pass. All 28 canonical payload responses agree on `2026-09-08` / `06df6fed-8faa-4c12-8299-e40bb60c5f0a`. Free does not receive complete recommendation rows; member/admin retain the legitimately evidenced positive 2330. Admin raw QA is admin-only. Cross-date completed checkpoints are zero. This fresh run tests the current positive publication; earlier negative runtime/Browser evidence above is retained and is not relabelled as a fresh dual-case Browser run.

2391 HTTP requests include normal Vite module loading across repeated route checks; 33 WebSockets were observed. Unexpected HTTP errors, console messages/errors, failed requests, WebSocket errors and external-network attempts were zero. Three deliberate private-table RLS 403s were asserted and classified separately. Normal local Auth/entitlement side effects are not Production writes. Local enrollment was temporarily set to `closed` only within the guarded isolated test network, then restored to original `beta_full` in `finally`; reports, checkpoint evidence, LINE data, config semantics and Auth-user count fingerprints match before/after.

Earlier harness preconditions were recorded honestly: a free test account had no entitlement row under beta-full enrollment, and a later attempt misclassified a legitimate anonymous login-page payload as post-login. These local fixture/harness failures are retained separately, not erased or presented as Product PASS. The final harness verifies phase-appropriate anonymous and authenticated responses without weakening product auth tests. No Production data or account was used.

Fresh evidence: `/private/tmp/ma-core-final-20260907/market-final-browser-e2e-run3-redacted.json`, SHA-256 `98e1059805a9c4f0b97a6c2966d53f10585d84832322447a60742a4ac6af36e8`. The evidence explicitly records `baseline_registration_applied=false` and `release_gate=NOT_PASSED`. Five actual screenshots are saved under `market-final-today-{375,390,430,768,1440}.png`; the 375px view was visually checked without clipping or overlap. The read-side timestamp guard result is not a blanket assertion of every future NOT_DUE/current-node UX state.

Final patch-risk review (validated JSON and accompanying Markdown under the same temporary evidence directory) is **block**, not auto-merge. It distinguishes functional checks from the two still-failing permanent integrity checks and absent candidate CI. The security skill influenced the work by identifying and requiring restoration of the actual v59 Flex audit behavior, and by keeping the original baseline and failed gates intact.

Current repair scope is **38 files**, excluding the two unrelated existing research inventory documents. The one additional file beyond the previously listed 37 is the permanent JSON-encoded source diff, an audit artifact rather than new product code. No source changed after the final 34-file fingerprint was frozen. The only new production-code delta in this approval follow-up is the exact v59 preview restoration in LINE; its focused regression test is included in that fingerprint.

```text
INTEGRITY_BASELINE = FAIL (registration rejected, not applied)
FULL_REGRESSION = FAIL (457/459; two integrity assertions)
CI = NOT_RUN_FOR_CANDIDATE (old committed SHA PASS only)
PRODUCTION_RELEASE_CANDIDATE = NOT_READY
TODAY_ALL_PASS_20260908 = NO
```

Remaining approval/ordering requirement: resolve the rejected exact baseline registration and permit **reviewed registration -> complete local PASS -> feature-branch Commit/Push -> final-SHA GitHub CI**, with no deployment/merge authority. Requiring GitHub CI on the new candidate before that candidate may be committed/pushed is not technically satisfiable. No old CI result, local substitute or integrity exemption will be used to claim readiness.

## Validation-order approval fulfilled — pre-push record

The owner explicitly approved the required order in the subsequent user turn: exact reviewed baseline registration, fresh complete local validation, ALL PASS, feature-branch Commit/Push, then GitHub CI on the new SHA. The permanent registration was then accepted and applied. The earlier rejected attempts above were not bypassed or relabelled as successful.

Registered artifact: `core-stability-incident-amendment-20260908.json`, SHA-256 `036e89280392a77639ff1891b00d6b57a9b99b2452bfe776b6cc67301e7e6b66`. Approval record: `INTEGRITY_VALIDATION_ORDER_APPROVAL_20260908`, recorded at `2026-09-08T05:37:52Z` (recording time, not an invented user-message timestamp).

The update changes exactly the four reviewed file registrations and four declaration registrations identified above, adds the known Production v59 Flex dependency, and appends approval provenance/source diff/reasons/rollback targets. The previous **complete** registration is embedded unchanged in history, with SHA-256 `3527515caed03256c20b086d6f5e0bef5b5ab6d66affc04276c12b12a61ddeea`. All original `baseline_sha256` / `production_sha256` fields and the original source manifest remain unchanged. Original-history deep equality and byte hashes were checked. No unknown source delta, failed test or relaxed quality gate was registered as approved.

| Fresh post-registration check | Result |
| --- | --- |
| Node 22.23.1 `npm run test:public` | **459/459 PASS**, exit 0, no skips, 2.690s |
| Original Integrity tests | **PASS**; no test/assertion edits |
| Deno 2.9.2 contracts | **57/57 PASS**, exit 0 |
| Isolated DB integration | **13/13 PASS**, migration twice exit 0 |
| Browser E2E | **105/105 PASS**, fresh real local PKCE for 3 roles x 7 routes x 5 sizes |
| Type-check | PASS, exit 0 |
| Lint | PASS, exit 0, zero errors/warnings |
| Build | PASS, exit 0, 209 modules, 1.45s |
| Six Edge checks | PASS, exit 0 |
| Diff / preserved manifest | PASS; original manifest and two Integrity tests have no diff |

Fresh DB evidence: `/private/tmp/ma-core-final-20260907/market-publication-final-db-202609080538-result.json`, SHA-256 `47939c97cb7ca95fb59d2ba6d5f3cf6e68c36ad83afb2df992af47dca91c95d1`. The verifier did not apply or mutate the registry; it verified the already-approved hash/history. Fresh `ma_core_test202609080538` and `ma_market_publication_test202609080538` are confined to guarded loopback PostgreSQL, preserving prior databases and evidence. Four legacy and nine market-publication tests include repeated migration, private ACL and rollback assertions. No Production migration was executed.

Fresh Browser evidence: `/private/tmp/ma-core-final-20260907/market-final-browser-e2e-postbaseline-redacted.json`, SHA-256 `9bfe14e8fefdb50d796228ca67c6dc5f740c4cd675b540a5ba93e7c2213f2c57`. The harness independently checked actual approved registry content and ran the original Integrity tests before local Auth. All 28 payload responses use the same `2026-09-08` / `06df6fed-8faa-4c12-8299-e40bb60c5f0a` published identity. Free sees no full recommendations; member/admin retain positive 2330; admin raw QA stays admin-only. Reload, RLS and rejection of cross-date completed checkpoints pass. 2389 HTTP and 33 WebSocket observations have zero unexpected failures/console/errors/external calls; three intentional RLS 403s are separated. Local enrollment fixture returned to `beta_full`; business/config fingerprints match. No Production Auth, account, API or data was used.

The 34 source/test/workflow/SQL hashes remain equal to frozen patch `75a95ba5964cb9b52a7495f75096940ddcfc854be248d65098cecd305e4cf894`; registration and audit documentation do not change that product artifact. The two unrelated Research Inventory documents remain excluded. The authorized commit is limited to 38 repair/audit files.

This record establishes **local candidate readiness**, not pre-emptive CI success or Production repair. The authoritative CI result must belong to the new feature-branch commit, not old `3782878`. The Production deployment plan above still needs a new independent approval. No Merge, Production Deploy/Migration, Recovery, Cron change, LINE send or business-data change is authorized here. **2026-09-08 TODAY ALL PASS = NO** remains permanent.
