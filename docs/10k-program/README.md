# Morning Alpha 10K Product Program — Phase 1 candidate

Audit date: 2026-10-04 (Asia/Taipei). Base: `3b33db3688ba350da0372b50f3391da922b639ea`.

This is a foundation candidate, **not** a claim of investment alpha, 10,000-user capacity, production rollout, or a completed Signal Lab. Production is unchanged. No strategy, promotion, public member feature, scheduled writer, provider fetch, or LINE dispatch is authorized by this candidate.

## A. CURRENT_STATE_AUDIT

The audit combines repository inspection and read-only production catalog/aggregate queries. No member identities, credentials, raw private responses, or market business rows are exported. “Complete” below is limited to the named capability; it is not a new certification of the entire platform.

| Asset | State before Phase 1 | Evidence / reuse / limitation |
| --- | --- | --- |
| Provider / Atomic / market phase / retry | ALREADY_COMPLETE (existing implementation) | Existing contracts and release evidence remain frozen. No fresh live pipeline invocation or new large Chaos run. |
| Operational FULL / DEGRADED / CORE_FATAL | ALREADY_COMPLETE (existing implementation) | Reuse `operational-market-contract.mjs`, canonical snapshots and operational integrity gates; research must never turn trustworthy core data into CORE_FATAL. |
| Canonical decision lineage | PARTIAL for this program | `decision_snapshots` versions/fingerprints exist. Reuse their IDs, dates and generated report level; do not infer these independently. Historical methodology identifiers may be absent. |
| Predictions / outcomes / cases | PARTIAL | Existing CLE schema, `learning_predictions`, `prediction_outcomes`, `prediction_reviews`, `learning_cases`. No duplicate engine/tables. Predictions are append-only; outcomes are updated by CLE, so new measurements freeze the source outcome at observation time. |
| Rules / backtests | PARTIAL | Existing `learning_rules`, `rule_backtests`, `model_evaluations` and promotion guard. Production aggregate: 0 rules and 0 backtests. Schema or test code is not a validated method. |
| Learning Center | PARTIAL | Existing `src/pages/admin/learning` and `get-learning-center`. Endpoint checks `profiles.role=admin`; that is not the new explicitly enrolled Sony-only owner boundary. Existing CLE tables inspected have FORCE RLS and no anon/authenticated table grants. |
| Calibration / no auto-optimization | NEEDS_REDESIGN (policy review, not changed) | `continuous-learning-core.mjs::calibrateConfidence` uses evaluations after sample >=20, capped adjustment; `generate-daily-report-v7` consumes existing calibration. This is an existing runtime dependency, not authorized for modification here. Future methodology promotion requires separate evidence and owner approval. New tables do not feed that path. |
| Feature Registry / AnalysisGraph / Signal | MISSING as dedicated versioned research foundation | Add a registry/schema, not a second provider adapter or finished scoring engine. |
| Teacher Method / Rule Candidate / forward validation | MISSING as an end-to-end owner workflow | Preserve source→claim→versioned hypothesis. Do not mark a teacher method validated because it is stored. |
| Owner Analysis Center | PARTIAL / new read-only foundation candidate | Existing learning views are reusable; this candidate adds `/admin/analysis` with metadata and explicit “not measured” states, not a complete cockpit. |
| Member product / trust | PARTIAL | Homepage, Today, War Room, Verification, membership and canonical public read paths exist. Future trust page needs honest denominators and unsuccessful/NONE days, not just UI work. |
| LINE fan-out | PARTIAL for 10K certification | Existing canonical payload, batch multicast, outbox claim/idempotency and retry are reusable. End-to-end 10K fan-out, dead-letter recovery and delivery latency are not certified by this audit. |
| Report immutability | PARTIAL | Canonical decision snapshots are versioned; legacy report storage/publication paths are not equivalent to blanket immutable-report storage. Do not rewrite historical reports in Phase 1. |
| Cache / entitlement / Realtime / cost | PARTIAL or NOT_MEASURED | Existing RPC/read and entitlement paths are reusable. No measured 10K concurrency, cache-date/revision isolation load result, p95 latency, per-active-subscriber cost or payment outage simulation in this round. |

### Production aggregate evidence (not performance claims)

- 44 CLE predictions; date range 2026-08-24 through 2026-10-02; 8 distinct dates with pre-open predictions.
- Outcome rows: 89 completed/complete; 104 insufficient_data/insufficient_data; 15 inconclusive/invalid_prediction; 12 pending/insufficient_data.
- A prediction can have multiple horizons. **89 outcomes are not 89 independent days**, and 8 pre-open dates are not 8 fully audited forward samples.
- Existing rules and backtests each have 0 rows. No dedicated feature/signal/teacher/methodology research tables were present at audit time.
- Aggregate profile roles are one member and one admin; no identity was exported and no owner was inferred or enrolled from this fact.
- Catalog inspection verified RLS + FORCE RLS and absence of anon/authenticated table grants for existing `learning_predictions`, `prediction_outcomes`, `learning_rules`, `rule_backtests`, `learning_cases`, `model_evaluations`.
- All observations above are an audit snapshot, not a permanent assertion about future production counts.

## B. TARGET_ARCHITECTURE

```text
A. Existing data / operational core (FROZEN)
   Providers → Atomic → Canonical Decision → Report → LINE → Closing / CLE
                           │ read immutable IDs / revision / evidence-as-of
                           ▼
B. Isolated owner research (SHADOW)
   Feature Registry → AnalysisGraph → Signal / conflict / change / invalidation
   Teacher Source → Claim → MethodVersion → RuleCandidate → existing CLE links
   Frozen Prediction + Outcome observation → separate DATA / ANALYSIS / DECISION metrics
                           │ owner-only read RPC, no production feedback edge
                           ▼
   Owner Analysis Center → future reviewed Promotion Candidate (NOT implemented)

C. Member product / trust (future separately approved release)
   Canonical Decision / Report only → read many / revision-keyed cache / fan-out
   No member access to B, no per-member AI recomputation
```

Phase 1 stores seven new public research tables plus a private owner enrollment table. Prediction, outcome, rule and canonical IDs reference existing assets. `research_method_versions` shares TeacherMethod/RuleCandidate version mechanics instead of building duplicate execution engines. Source provenance and rule conditions are structured; changing a rule requires a new version linked to its predecessor.

`research_analysis_graphs` binds the exact snapshot/date/revision/fingerprint, FULL/DEGRADED and available source methodology. Missing historical methodology stays NULL, not a fabricated “V1”. The new `RESEARCH_FOUNDATION_V1` denotes a Shadow schema, never the production decision methodology. HISTORICAL_REPLAY is explicitly different from FORWARD; pre-open forward records cannot be backdated after 09:00. Intraday forward evaluation requires its own future contract, not misuse of the morning metric.

Quality observations reference CLE predictions/outcomes, preserve a whitelisted outcome snapshot and content identity, and cannot be overwritten. Later CLE outcome correction produces a new observed version rather than silently changing old measurements. The hash is an equality fingerprint, not an adversarial authenticity signature. Service role can insert/read new research rows, but cannot update/delete/truncate them; triggers also reject ordinary owner-level SQL mutation. No claim of protection against a database superuser deliberately dropping those controls.

### Quality metrics contract (foundation now, calculators in Phase 4)

| Dimension | Required measurement inputs | Exclusions / honesty rule |
| --- | --- | --- |
| DATA | freshness, completeness, session correctness, atomic integrity | Deterministic components; no AI opinion and no conflation with outcome success. |
| ANALYSIS | evidence coverage, supporting/contradicting signals, change detection, invalidation, calibration | Evidence IDs must be resolved by the future producer. An ID-shaped string or populated schema is not analysis validation. |
| DECISION | immutable pre-outcome prediction, direction/regime/action, legal outcome session/path, methodology and horizon | Missing/stale/invalid/pending outcomes excluded with reasons; failures/NONE days not removed merely to improve results. |

Rolling windows: 5/20/60/90 **independent trading days**, separated by methodology, horizon and FULL/DEGRADED. `<5` = INSUFFICIENT_SAMPLE; 5–19 = EARLY_SIGNAL; 20–59 = PRELIMINARY; >=60 = MEANINGFUL_SAMPLE, not proof of profitability. Confidence calibration needs reliability bins and empirical outcomes; 87 points is not 87% success. Direction hit rate, regime fit, WAIT opportunity cost / AVOID avoided drawdown / ENTER result, recommendation return/MFE/MAE, baseline comparisons and interval uncertainty are not implemented or claimed yet. No trustworthy intraday path means no invented MFE/MAE.

### Security boundary

- Default is **deny**, including the existing admin, until one named owner is enrolled with a separately approved release operation.
- Membership, paid entitlement, guessed URL and user-editable metadata cannot grant research access. A private singleton ACL AND the existing admin role are required; request UID comes from `auth.uid()`.
- New tables have FORCE RLS, no anonymous grants, authenticated owner-only SELECT, no member write grants and no Realtime publication. No public view exposes them.
- `get_research_foundation_v1` is security-invoker and returns only foundation metadata/counts; no write/promotion action, credentials, subscriber PII or raw payloads. `is_research_owner_v1` is a narrow security-definer boolean with an empty search path and no identity argument.
- The new Owner page is safe when the migration is absent: unavailable/denied, no production fallback. Sign-out/sign-in clears data and invalidates in-flight responses.
- Existing learning/admin APIs remain unchanged under freeze; do not represent all legacy internal surfaces as Sony-only just because the new research tables pass RLS.

## C. GAP_ANALYSIS

1. **Research execution:** schemas exist in this candidate; no scheduled signal production, evidence-ID resolver, conflict/change analysis, AI synthesis or automatic score computation. Phase 2 must prove lineage and lookahead safety on real retained evidence.
2. **Method validation:** no Teacher ingestion, backtest/OOS splits, transaction costs, walk-forward runner or daily forward collection in Phase 1. Reuse CLE stores, add adapters instead of duplicating them.
3. **Quality evidence:** outcome rows require eligibility audit, independent-day counting, methodology grouping and confidence intervals. No broad “analysis has value” claim is justified now: INSUFFICIENT_SAMPLE.
4. **Promotion safety:** no new approval/promote API/button. Existing CLE calibration policy requires explicit future review; this candidate must not influence it. No automatic weights/thresholds or live A/B member recommendations.
5. **Owner product:** read-only registry and honest unavailable metrics are delivered, not the full service/data/analysis/decision/outcome cockpit, error library or one-click research workflow.
6. **Member trust:** risk/invalidation/top reasons, FULL/DEGRADED interpretation and historical fair-performance presentation remain a later separately approved product release; no internal data exposed now.
7. **10K scale/cost:** compute-once/read-many architecture exists partially but needs controlled load and fan-out testing, RLS/query plan review, bounded retries/DLQ, cache revision isolation and cost telemetry. No “10K ready” assertion.
8. **Supply chain:** clean `npm ci` reported existing dependency advisories (1 moderate, 12 high); dependency versions/lockfile are unchanged. They need separate triage, not an unrelated auto-upgrade hidden in this research candidate.

Master coverage: 0–4 core freeze; 5–12 feature/analysis foundation; 13–24 methodology and CLE reuse; 25–33 quality specification; 34–43 owner workflows/gaps; 44–51 member trust/report immutability; 52–59 fan-out/cache/security/cost/AI provenance; 60–74 explainability/calibration/methodology isolation; 75–88 trust/alerts/audit/quality/cockpit; 89–100 staged release and evidence gates. This is a coverage map for audit/planning, **not** a claim that those items are all implemented.

## D. PHASE_PLAN

| Phase | Build / reuse | Exit gate before advancing |
| --- | --- | --- |
| 1 Foundation | This candidate: registry, versioned graph/signal/method schema, CLE references, owner access, quality foundation, read-only Owner shell | Fresh DB, role matrix, immutability/lineage, exact core freeze, Integrity/type/lint/build, both GitHub workflows. Production approval still separate. |
| 2 Structured analysis | Real evidence → features/signals → conflict/change/invalidation graph; deterministic contribution contracts | Exact evidence resolution, no future/stale inputs, FULL/DEGRADED consistency, no production feedback dependency. |
| 3 Research workflow | Teacher source/claim UI, candidate rules, reuse backtests, OOS/walk-forward, Shadow collection | Reproducible versioned splits/costs and synthetic-vs-real labels; no live recommendation effect. |
| 4 Decision quality | Reuse CLE outcomes/cases; eligibility, 5/20/60/90 windows, separate three quality dimensions/calibration | Independent samples, failure-inclusive denominator, baselines/uncertainty, no fake prices or MFE/MAE; explicit policy review before any promotion. |
| 5 Owner center | Inspector, regime/method breakdown, error library, review workflow | Owner-only REST/RPC/Realtime/View/Function/URL tests; human approval audit; no automatic promotion. |
| 6 Member / trust | Clear canonical action/reasons/risk, true performance presentation | Enough forward evidence, same canonical decision, no internal research exposure, separate owner release approval. |
| 7 Scale / cost | Read cache, query/index budgets, fan-out/DLQ, SLO/latency and daily cost | Controlled 10K read/delivery tests, idempotency, cross-date/revision safety, measured provider/AI/LINE/storage/per-active cost. |

## E. PHASE_1 IMPLEMENTATION CANDIDATE

- One additive forward-only migration: `20261004033642_intelligence_foundation_owner_shadow_v1.sql`.
- Seven append-only research tables; private owner enrollment is deliberately empty.
- Eleven feature-role definitions reference current contracts; no copied adapter or new trading threshold.
- Existing Prediction/Outcome/CLE IDs reused; versioned immutable observations, FULL/DEGRADED and methodology linkage.
- `/admin/analysis` owner-gated read-only candidate; no promoted strategy, fake metric or research write UI.
- Required candidate workflow `Research foundation gate` supplements unchanged `Validate release`. Original sealed CI hash and all predecessor baselines remain intact; **both** workflows must pass before a future release request.
- `phase1-core-freeze.json` pins exact paths + SHA-256 for 142 existing shared/function/migration files to the base above. This is additive protection, not a replacement of existing Integrity.

### Verification and scope

Fresh DB uses `tests/fixtures/research-foundation-dependencies.sql`: explicitly synthetic, minimal used-column contracts for existing dependencies, with real PostgreSQL RLS/triggers/functions. It is **not** a replay of all historical migrations and contains no production rows. Candidate duplicate application is rejected by the forward-only schema guard. Existing production catalogs were inspected read-only for used-column compatibility; original release workflow continues its existing integration gates.

```sh
node --test tests/researchFoundation.test.mjs tests/publicProjectionIntegrity.test.mjs tests/operationalMarketIntegrity.test.mjs
MA_ISOLATED_TEST_DB=ma_10k_phase1_test1 MA_TEST_PGPORT=55439 node tests/researchFoundationDatabase.integration.mjs
npm run type-check
npm run lint
npm run build
```

Local isolated Docker alternative: `MA_TEST_DOCKER_CONTAINER=ma-10k-phase1-db`; container is network-none, each run requires a new database name, and refuses to reset an existing DB. Browser preview is synthetic/loopback only with the Supabase import replaced, no production login or requests. Local ancestor `node_modules/@types/react 2` pollution was isolated with `npm run type-check -- --typeRoots ./node_modules/@types`; the unchanged standard command must independently pass in clean GitHub CI. No compiler flag disabling checks was used.

### Release boundary

This PR may be committed/pushed/tested. It must **not** be merged/deployed/migrated as an implied production approval. Required future approval: the named migration, exact Owner identity enrollment, and Owner-only UI release. Edge Functions: NONE. Public UI: NONE. Cron: NONE. No business backfill/history rewrites. If the Owner enrollment is not authorized, access remains denied. Phase 1 has no analytics writer; lack of new measurements is intentional, not grounds to invoke the production pipeline.
