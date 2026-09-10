# Core Pipeline V1 — subscriber dependency inventory

Local source audit, 2026-09-09. This is a reachable-symbol/consumer inventory, not a Production, durable database, entitlement or full-E2E acceptance result. No SQL was executed. Branch: `codex/core-pipeline-consolidation-20260909`, base HEAD `6469630795fb1215595306c026437d850b668801`.

## Reproduce

```sh
node --test tests/consolidationSubscriberGraph.test.mjs tests/consolidationSubscriberEligibility.test.mjs
MA_SUBSCRIBER_GRAPH=1 node tests/consolidationSubscriberGraph.test.mjs
```

The graph test parses the actual `src/router/config.tsx` route objects, lazy imports, static imports, nested Admin routes, redirects and feature conditions. TypeScript symbol resolution follows executable function/variable references, JSX components and callbacks. Importing a utility from a module does **not** make every function in that module active. Type-only imports are not execution edges. Output includes exact current file/line/expression and classification for raw-reader candidates; the checked-in inventory rejects new owners, expressions or duplicate read sites without review.

The graph is conservative within executed function bodies; it is not path-sensitive taint analysis. Module top-level side effects, arbitrary reflection, computed dynamic keys and runtime server payloads require separate review. The only explicit security-boundary edge is the server-entitlement-guarded Voice mount, whose guard and sole caller are tested. The guard test does not replace real server authorization tests. Never report “zero raw readers” from this scan.

## Routed market consumers

| Active route | Source entry | State/content path |
| --- | --- | --- |
| `/` | `home/page.tsx#HomePage` | `useHomeDashboard` → `homeDashboardService` → selected report; projection drives market/confidence/runtime |
| `/report/today` | `report/TodayReport.tsx#TodayReport` | `useLatestReport` → `resolveMorningAlphaState` → `resolveActiveReport`; full row → projection, narrative/presentation/timeline |
| `/opportunities` | `opportunities/page.tsx#Opportunities` | `resolveActiveReport` → full row → projection → `getSubscriberOpportunityList`; independent Premium gate, canonical items only |
| `/member-note` | `member-note/page.tsx#MemberNote` | selected full row → projection → narrative/presentation/timeline; market summary outside independent Premium fragment |
| `/war-room` | `war-room/WarRoom.tsx#WarRoom` | selected full row → projection → runtime timeline; no active legacy `buildMarketState` recomputation |
| `/verification` | `verification/page.tsx#Verification` | selected full row → projection closing/runtime; route remains live despite absent Navbar link |
| `/reports` | `reports/ReportsCenter.tsx#ReportsCenter` | report adapter + historical projection; old narrative module contributes only presentation constants/utilities |
| `/reports/:reportDate` | `reports/ReportDetail.tsx#ReportDetail` | exact selected report → historical projection; no raw confidence/closing/publication reader in page |
| `/performance` | `performance/page.tsx#PerformancePage` | existing `callGetReportHistory(30)` → `selectPublicPerformanceRows` → historical projection; no client score-based same-date winner or fabricated close alias |

All nine routes must reach `src/lib/subscriberReportContract.ts#getSubscriberReportProjection` through executable symbols. `subscriberReportProjection.ts` is the stable re-export, not another implementation. `canonicalNarrative`, `decisionPresentation`, `runtimeDecisionTimeline` and Premium/opportunity adapters are consumers, not publishers.

Navbar → `MarketStatusLight` resolves its report through the same projection. Its historical `marketState` prop is not consumed by the mounted component; Home and War Room no longer perform a redundant legacy builder call. `marketStateEngine.ts#buildMarketState` remains a projection-only compatibility API with separately retained pure quote-freshness exports.

Other enabled routes include learning, account, login/callback, pricing and informational pages. They are included in the subscriber graph, not silently excluded. `/learn` and `/learn/:slug` are enabled; `/alpha-coach` is disabled by the actual feature flag. `/dashboard` and `/strategist` redirect to `/account`; `pages/dashboard/Dashboard.tsx` is not mounted. `/admin/*` has its own graph roots and is not a subscriber route.

## Remaining executable raw reads: purposes, not exemptions

Line references describe this audited source snapshot; the command above supplies current lines after later edits.

| Exact symbol / current lines | Classification and downstream consequence |
| --- | --- |
| `subscriberReportContract.ts#getSubscriberReportProjection` (around 243–289) | Central wire authority. Reads canonical/publication/confidence/closing fields with identity validation; new durable Closing changes belong here, not in pages. |
| `canonicalNarrative.ts#buildTodayFocus`:188 | `canonical_decision.reasons` supplies prose only after `projection.analysisAvailable`. Headline, action and confidence remain projected; a content quote is not a second publication decision. |
| `morningAlphaReportAdapter.ts#normalizeMorningAlphaReport`:358,464 | Raw content-gate status is retained in diagnostics. `publishReady`, `canPublish` and public confidence come from the projection. |
| `premiumContentAvailability.ts#resolvePremiumContentAvailability`:37 | Preserves explicit server `premium_content_status === eligible` as an **independent** Premium qualifier, conjunctive with projected market availability. Scores/news/stocks cannot infer Premium eligibility. |
| `reportService.ts#mapRowToReport`:100–106 | Copies canonical/content-gate/status/close fields into a report transport. It resolves the original full row first; copied fields are not a new state selection. |
| `openingRadarService.ts#mapRowToOpeningRadar`:87,118 | Still executed as an embedded-radar compatibility mapper by `resolveMorningAlphaState`. Contains a legacy score cap/default. Current active pages do not render that mapped radar confidence as subscriber confidence. This is **not** an unreachable module and must not be counted as removed. |
| `aiStrategyParser.ts#parseV8BeneficiaryChain`:512 | Executed legacy V8 structural parsing includes a score default. Its V8 score is not the active projected subscriber score. |
| `aiStrategyParser.ts#parseAIStrategy`:613,776,890 | Executed compatibility parsing still retains free-summary confidence/default, closing object and content-gate diagnostics. These are not active page state gates; parent adapters project the public values. Retain this debt explicitly rather than claiming no raw reads. |

The last two compatibility families remain source-level risks if a new caller later consumes their raw state/score outputs. The exact-read inventory catches changed sites; a field-use/data-flow review is still necessary for new consumers. It does not prove semantic safety merely because a read has a classification.

## Non-subscriber / orphan symbols

`VoicePage` itself is routed. It checks `getCurrentEntitlement()`, requires logged-in Admin status, resets on Auth changes and returns before mounting `InternalVoicePage` while unchecked/unauthorized. Only that checked mount edge reaches `voiceScriptEngine#generateVoiceScript`, `buildVoiceScript1Min`, `buildVoiceScript3Min` and their raw score formatting (144,554,640,728). The graph tests this exact edge rather than exempting `VoicePage.tsx` wholesale.

The following symbol bodies are not reachable from enabled subscriber route roots, even where their containing module is imported:

- `narrativeBuilder#buildHomeSummary`, `buildObservationNarrative`, `buildVerificationNarrative`; active historical pages use `getSentimentColor`, `formatTaipeiDateTime` or `MARKET_BIAS_EXPLANATION` only.
- `safeMarketBias#getSafeMarketBias` and `memberNotebookEngine#generateMemberNotebook`.
- `intradayTrackingResolver#resolveIntradayTrackingState` (retained type contract is not a runtime call).
- `closingVerificationState#resolveClosingVerificationState`; `decisionEvidence` has active pure presentation helpers, but its legacy runtime builder is not thereby executed.
- `warRoomPresentationMapper` runtime mapper; active War Room imports its shape as a type.
- `pages/dashboard/Dashboard.tsx`; a source file and old link target are not a mounted route.

No deletion or blanket renaming of these orphan/QA implementations is necessary for this convergence.

## Performance backend boundary — existing history contract convergence

The old `get_public_performance_journal(integer)` definition in `20260825083924_public_close_reconciliation.sql`:4–22 remains untouched. It returns flat fields and its `ranked_reports` CTE (:30–39) ranks raw closing status; its reconciliation joins reviews by date. It is **no longer called by either active subscriber consumer**: Home's latest public close and Performance both use the already existing `get-report-payload` history contract, capped at 30 rows. No new SQL/RPC, permission or RLS change was added for this repair.

History reads reports once, then batches current/opening/closing snapshot IDs (maximum 90), exact publication receipts, and pinned member/semantic rows in parallel: four bounded data queries, not N full report contexts. The existing `evaluatePublishedMarketDelivery` remains the publication authority. Its explicit `historicalRead: true` mode relaxes only the delivery-specific same-day constraint; the projection retains the actual server `today_date`. All default LINE/orchestrator delivery callers still reject history. The shared opening and closing validators bind the successful research-input run, frozen PREMARKET identity, exact durable CLOSING snapshot, market quote source/window and fingerprint. Raw report closing aliases and date-joined reviews cannot provide these receipts.

Public history is an allowlist: true report/revision/date/generation, projected status/confidence, core-market closing metrics, safe existing review prose and receipt identifiers. No stock list, private member body, arbitrary generated text or research document is serialized. Actual V2 producers omit the legacy `missing_data` alias; only the validated contract's calculated market reason codes supply that compatibility field. Present contradictory missing-data declarations cannot be normalized to success. Structured `tomorrow_adjustment` preserves only its existing public `keep`, `downgrade` and `watch_tomorrow` string fields.

The client preserves genuine proof-bearing rows: identical repeats collapse, contradictory same-date rows block **only that date**, and missing receipts keep their real date as insufficient. It never ranks by score, substitutes report date for revision identity, fills missing prices/scores, or uses browser time to qualify history. `tests/consolidationPerformanceHistory.test.mjs` covers positive history, actual V2 producer shape, real zero values, wrong identities, absent receipts, late openings, frozen opening versus later publication, private-stock non-leakage and bounded queries. The loopback SDK history regression checks all four requests and a durable positive outcome; it is synthetic HTTP/DB contract evidence, not real Auth or persisted producer E2E. Production historical sample counts and Readdy Host Build are not claimed restored by these local checks.

## Delivery and recommendation convergence

### General/current payload authority

The general `get-report-payload` reader now reuses the same bounded evidence
loader as history: exact current/opening/closing snapshot IDs, pinned member and
semantic identity, and actual successful publication receipts. These three batch
reads replace the old separate current/member/date-current-closing queries, so
the general context remains ten reads and history remains four including reports.
No permission, Auth, tier, RLS, SQL definition or public stock allowlist changed.

`buildPublicPayload` consumes `evaluatePublishedMarketDelivery().eligible` and its
projected summary, direction, confidence and recommendation state. A mutable
failed draft cannot revoke valid frozen publication, nor can a healthy draft
repair absent/corrupt frozen proof. CORE closing uses `validateOpeningPublication`,
`resolveClosingReceiptPointer` and `evaluateClosingContract` against the exact
durable body; raw closing aliases and date-joined reviews cannot supply proof.
Member stock aliases consume the public recommendation result while retaining
independent Premium and entitlement checks. The strict shared legacy publication
branch remains available; malformed CORE proof never falls back to legacy.
News, quotes and other diagnostic/content transports are not new state authorities
and were not reworked by this fix.

`consolidationCurrentPayloadAuthority.test.mjs` runs 16 actual-handler/installed-SDK
cases with synthetic loopback DB/Auth HTTP responses: verified market/zero close,
the four original authority counterexamples, wrong date/revision/opening, late
opening, PARTIAL/100, qualified company+Premium positive control, independent
Premium/stock failures, canonical empty-list non-revival, and explicit query
failure. Existing payload and SDK suites retain their stock/tier/no-leakage
assertions using genuine assembler-produced fixtures. This is reader-contract
evidence, not real Auth/RLS, persisted publication, provider or Production E2E.

“Zero active unauthorized subscriber state decisions” refers only to the reviewed
reachable consumer paths and these executable authority boundaries. It does not
mean zero raw wire parsing: the 27 classified candidate sites above, transport
copies, diagnostics, and compatibility parser/radar outputs remain explicit debt.
New consumers still require symbol-level use review, not a whole-file exemption.

`fetchPublishedDeliveryEvidence` resolves the exact committed snapshot, member
identity and actual `pipeline_runs` receipt. LINE, orchestrator and daily-report
Health call `evaluatePublishedMarketDelivery` once and consume its eligibility,
reason codes and sole Subscriber Projection. LINE no longer has a second raw
bias/date/recommendation gate or formatter. Its existing Flex renderer is retained;
an eligible projection is not itself proof of a sent LINE receipt.

A present CORE publication is validated against frozen market evidence, exact
source tuples and committed semantic/publication identity, not mutable private
research counters. Legacy payloads still require their existing actual market,
editorial and semantic proof; corrupt CORE proof never falls back to legacy.

The sole recommendation projection distinguishes an explicitly empty/invalid
canonical candidate list from fields omitted by a server-trimmed Free payload.
Explicit emptiness cannot revive raw stock aliases or claim a completed universe;
server redaction cannot be misrepresented as a failed evidence assessment. Neither
case fabricates recommendations or changes entitlements. Market availability
remains independent of both cases.

## Regression scope

`consolidationSubscriberEligibility.test.mjs` exercises the real projection and adapters: PARTIAL/blocked failures, full-envelope identity contradictions, explicit Premium blocked despite qualified market/stocks, diagnostic null versus real zero, no fake no-qualified outcome, qualified V10 positive control, preserved selected historical rows and per-date conflict fail-closed behavior. `consolidationSubscriberBoundary` and `consolidationMarketStateAdapter` cover full-row formatter/timeline authority and clock/quote non-promotion.

React best-practices review kept these as pure derived adapters, removed redundant Opportunity state/effect work, and preserved the existing UI/access checks. Passing these local tests is not a provider replay, publication receipt, durable DB integration or complete browser-to-database acceptance result.

## Frozen editorial and Browser v6 evidence — 2026-09-09

The latest shared editorial boundary grades market prose from the canonical
market document only. Raw quote/free/member/reason/sector aliases cannot change
that grade. Actual `content_evidence_quality`, `data_quality` and
`missing_sources` measurements are frozen with the document; absent or invalid
measurements fail closed rather than borrowing current draft QA. The committed
publication reader recomputes that same frozen editorial result and rejects a
stored-score mismatch. Canonical research coverage 100 is not editorial 100,
and the existing editorial threshold remains 90. The corresponding canonical,
Generator and frozen-publication focused suites passed 36, 20 and 31 cases.

The completed Browser v6 artifact is
`/private/tmp/ma-consolidation-history-1312-20260909-v6/consolidation-subscriber-matrix-results.json`,
SHA-256 `855f2b3b5f64df9bb904bef648bc7fbd30ef530255b7efd2989fab72a2766bd1`.
It contains **1,312 unique PASS cells**: 14 states × five report routes × four
roles × widths 375/390/430/1440 = 1,120, plus six history states × Home/Performance
× the same roles/widths = 192. Anonymous, Member, Admin and Free each completed
280 main and 48 history cells. The run also checked 288 expanded checkpoint
disclosures and three non-Admin forged-Voice-preference denials, and saved 208
screenshots. Every cell returned HTTP 200 with zero overflow/clipping. All 291
local import-closure hashes matched both at completion and independent readback.
The evidence collection interval was 08:17:46.780–08:38:17.809 UTC, 1,231 seconds.

Auth/PKCE, server tiers and private-table RLS were real on the existing isolated
`ma-core-final-20260907` stack. Exactly four intentional private-table probes
were denied: Anonymous HTTP 401 and Member/Admin/Free HTTP 403, all PostgreSQL
`42501` with null private data. Unexpected console/HTTP/request-failure/route
errors and external requests were zero. Report responses were explicitly
synthetic; history used the actual handler and SDK against synthetic loopback DB
responses, four bounded queries per scenario and zero persisted fixture rows.
Fonts/CDN CSS and Readdy images remained declared static asset doubles. This
does not prove provider, persisted Generator/publication, terminal/Acceptance,
Production, CI-ready or Readdy-host acceptance.

Normal local login side effects remain disclosed: Member/Admin/Free each sent
one activation and 6/5/6 report-reader ensure calls. Effective privileges stayed
unchanged; existing Admin owner UPSERTs may update version/timestamps, so no
whole-database-unchanged claim is made. Free reused its existing expired
entitlement. SQL executions, Auth configuration changes, new fixture writes and
Production requests were zero.

The preceding v5 artifact remains **FAIL**, SHA-256
`15679da61fddc34845c430ed5b648de5cc58baee9e7ed1244159553195eda773`,
at the corresponding `...-v5/consolidation-subscriber-matrix-results.json` path.
It stopped after 430 main and 48 history cells at an immediate `main` count of
zero during Member/MISSING_CONFIDENCE ReportDetail navigation. React's lazy
route fallback legitimately has no `main`; network idle alone was not a UI
readiness condition. The runner-only successor waits for the actual visible
subscriber shell within the existing timeout, retains exact single-main,
identity/state/content assertions, and records the attempted cell before
navigation plus sanitized failure diagnostics. All 290 other guarded sources
were unchanged. v6 reran every cell; it does not relabel v5 or v4 evidence.
Final runner SHA-256:
`ba98ca8fe88211601be6af20a0f2d4b3e25938b3e00645e671693c3ce5cab61f`.

The Browser closure is an evidence boundary, not a repository-wide seal: SQL,
separate persistent-replay configuration and these explanatory documents are
outside its imports. Changes only there do not invalidate the unchanged v6
presentation result, but are not validated by it. Any change to a guarded
source requires fresh affected Browser evidence. The reviewed zero-value claim
remains **zero active unauthorized subscriber state decisions in the named
reachable paths**, never zero raw wire parsing or a blanket module exemption.

## Current four-role Browser receipt — 2026-09-09, Eighth candidate

The unchanged full runner was rerun against the current candidate, not inferred
from v6 or the earlier Anonymous-only 328-cell receipt. Result:
`/private/tmp/ma-consolidation-history-1312-eighth-20260909-v1/consolidation-subscriber-matrix-results.json`,
SHA-256 `cdd7793aa81d7c916cd5e84b491235e5b05853b2b121428d2e63576a110b1141`:
**PASS, exit 0, 1,312 cells** (1,120 main + 192 history). Anonymous, Member,
Admin and Free each completed 280 + 48 cells across 375/390/430/1440 widths;
288 checkpoint disclosures and three non-Admin Voice denials also passed.
Runner SHA-256 remains
`ba98ca8fe88211601be6af20a0f2d4b3e25938b3e00645e671693c3ce5cab61f`.
All 290 current guarded source hashes matched before and after; the SHA-256 of
the JSON-serialized, path-sorted `[path, hash]` pairs is
`47224ed59227f42d4645e6481bd2e33866c1a169be8f0be14e9343f3ab3a47e8` on both sides.

The same isolated `ma-core-final-20260907` stack used real local PKCE, existing
accounts, server tiers and RLS. Of 99,371 responses, only the four deliberate
private-table probes failed (Anonymous 401; other roles 403; exact PostgreSQL
`42501`). Unexpected HTTP/console/request-failure/route errors were zero.
Report responses remained declared synthetic local fixtures; history retained
the actual handler/SDK fixture boundary. Static font/CDN/image doubles were
unchanged. This is not a persisted producer, Production or Readdy Host claim.

The initial attempt was rejected before process creation over Admin membership
UPSERT side effects. The user then precisely authorized the existing local
Admin normal-login UPSERT/version/timestamp effects; the same complete action
passed normal review, without splitting or bypassing Auth. The prior refusal
and all earlier failed evidence remain preserved. Member/Admin/Free each sent
one normal activation and 6/5/6 reader-ensure calls; effective privileges stayed
unchanged. Existing Admin version/timestamps may change and are not exposed by
the public status response, so no whole-database-unchanged claim is made. Free
reused its existing expired entitlement. New identity/entitlement fixture
writes, direct test SQL, Auth configuration writes and Production requests were
zero; no RLS/ACL/JWT/gateway changes were made.

The separate true persisted-data Browser smoke for the synthetic 2026-09-30
fresh replay is pending at this receipt. Its real payload/Auth/transport results
must be reported separately, including any anonymous-gateway or missing-Realtime
failure; these cannot be waived or replaced by this fixture-matrix PASS.
