# Morning Alpha Product Contract V1

Status: LOCAL PRODUCT CANDIDATE — not a Production release or a calibrated trading strategy.
Owner specification: Decision Engine V1 / Subscriber UX approval, 2026-09-07.

## Release boundary (mandatory)

Fetch v64 is awaiting the **2026-09-08 natural Production Acceptance**. This product change must not modify, deploy, replay or advance Core Fetch, Acceptance, Cron, Publication, LINE, Closing or Learning producers. No Production writes, Migration, Merge or deployment are authorized by this candidate.

Frozen source baseline: `dcf1a8c976b5e78a00356d4443930191731f119a`.
`tests/productContract.test.mjs` pins the 110 tracked Supabase/workflow/core-reader files with a deterministic content hash. The pin can only change with a separately approved Core release, not to make this product's tests pass.

The reading contract is independent from backend implementation. Backend maintenance must preserve the questions, states, evidence requirements, identity and access boundaries below. A legitimate producer fix must rerun product tests; it must not restore the old dashboard UI.

## One question per page

| Page | First-screen answer | Detail order |
| --- | --- | --- |
| Today | How is the market viewed / what to do now / any qualified opportunity? | Separate direction, confidence, entry and regime → evidence and opportunities → market measurements → expandable verification → next step |
| Intraday | Did the morning judgment change? | Action + reason → optional checkpoint history → new evidence; completed is not the same as confirmed |
| Closing | Did the judgment hold? | Verified outcome or honest pending/non-trading state → original hypothesis → optional checkpoints → lessons |
| Performance | Has MA been useful over time? | Valid sample count before claims → daily audit ledger → forward-validation dimensions and methods |
| Learn | Understand before acting | Plain language → life analogy → why MA watches → today's use → misconception → risk → original source |

Navigation: Today → Intraday → Closing → Performance → Learn → Account/Login. Identical priority on mobile. Learn's 33 slugs, aliases, five categories, search, deep links and authoritative sources stay intact.

Semantic colors are **not the only state signal**: green opportunity/confirmed; amber waiting/no-chase; red risk/invalid; blue information; neutral reading. Labels accompany color. Premium dark is retained. Main answer must fit the first screen at 375/390/430/1440, with no horizontal overflow. Long text is not clipped. Dialog must trap focus, close on Esc, restore focus and restore body scrolling. This release adds no animation.

## Canonical typed product input

`src/features/decision-v1/contract.ts` defines `DecisionInput`, `Decision`, `Evidence`, `Score`, `OpportunityInput` and `Transmission`. `engine.ts` is pure: no HTTP, database, Supabase, timers or side effects.

The **optional** read-side extension is `ai_strategy_json.decision_engine_v1` (`contract_version: decision-v1`). It is only accepted when `report_date`, `revision_id` and `generated_at` exactly match the existing **server resolver's** identity. `data_as_of` must not be later than generation, and generation must belong to the Taipei report day. Cross-day/future/mixed-revision evidence is rejected.

This candidate does **not** populate that extension in Production. Today's existing producer does not yet deliver the complete calibrated/factor evidence. Absent input is explicitly unavailable; legacy `confidence_score`, radar confidence and arbitrary prose never become new scores. No API/Schema/Prompt change is hidden in a frontend fallback.

Legacy compatibility:

- Existing server-trimmed market view and published explanation remain readable, clearly separate from the missing V1 assessment.
- Existing stock observations require canonical `ACT`, Premium eligible, `recommendations`, today's report, no historical fallback, and reason + confirmation + invalidation. They are labelled published observations, not newly scored opportunities.
- If a V1 input exists but is invalid, it cannot fall back to legacy recommendations. A newer malformed assessment cannot be hidden by an older good one.
- A valid V1 assessment cannot override a published STOP or promote a published WAIT. The server entitlement remains authoritative; no query/localStorage/user-metadata role override.
- Beginner Mode retains existing Owner/Admin-only feature gate. Alpha Coach remains disabled. No feature flag changes.

## Scores are separate and traceable

All scores retain `score_version`, measured inputs, evidence IDs and calculation provenance. No multiplication into a buy probability. No LLM-supplied numerical rating.

| Output | V1 calculation / requirements | Honest missing behavior |
| --- | --- | --- |
| Direction Probability | Explicit sample-out-of-training calibrated model result, model version, calibration ending strictly before assessment, at least 20 integer samples and calibration evidence | No probability; **not** substituted with confidence |
| Model Confidence | 100 × (equal mean of measured completeness, freshness, source agreement, signal agreement, historical calibration − measured missing-evidence penalty), clamped 0–100 | Any absent/invalid measurement → unavailable |
| Entry Environment | Equal mean ×100 of regime fit, risk/reward, valuation, price position, catalyst, fundamental impact, not-priced-in, institutional condition, evidence quality, historical validation | All ten evidence-backed ratios required |
| Opportunity Score | Same ten dimensions evaluated for the company, independently from market entry score | No incomplete company ranking |
| Catalyst / Priced-in / Risk / Mispricing | Explicit measured ratios ×100 with evidence | No default 75/80/90 or null-to-zero |

These quality indices and guardrail thresholds are transparent **V1 candidate policy**, not an empirically calibrated win rate. Parameters are source-controlled and must undergo forward validation before a commercial predictive claim. The 20-sample floor is a display floor, not proof of statistical validity.

Evidence freshness is evaluated at the immutable `data_as_of`, not used to advance any browser timeline. Maximum age: market 24h (permits prior overseas session), event 96h, fundamental 120 days, calibration 365 days; all evidence must still be attached to the same report day/revision. Provider session-specific validity remains the upstream producer's responsibility. Browser clock never completes a checkpoint.

## Decision safeguards

- Action enum: ACTIVE_WATCH, WAIT_FOR_PULLBACK, WAIT_FOR_CONFIRMATION, HOLD_WATCH, DO_NOT_CHASE, DEFENSIVE, AVOID, NO_QUALIFIED_OPPORTUNITY, INSUFFICIENT_DATA, NOT_APPLICABLE. No BUY output.
- A complete, evidence-backed empty screening result is `NO_QUALIFIED_OPPORTUNITY`; absent screening, rejected candidates or missing quality fields are `INSUFFICIENT_DATA`. A broken pipeline must not look like a legitimate no-opportunity day.
- Missing direction calibration also keeps the new assessment incomplete. Market-level no-chase, defensive and waiting gates propagate to company cards; a green company card cannot contradict the global entry restriction. Withheld member content is distinguished from an incomplete assessment.
- EXTENDED or company priced-in ≥80 → DO_NOT_CHASE. Market risk ≥70 or RISK_OFF → defensive. Entry score <50 → wait for better conditions. Model-confidence quality <50 cannot upgrade an active watch. These are reviewable candidate guardrails, not provider facts.
- Company fundamental damage / company-specific negative / evidenced failed confirmation → AVOID, regardless of how far price fell.
- Broad selloff with intact fundamentals is only a MISPRICING_CANDIDATE after company-specific negative, revenue exposure, supply chain, guidance, sector demand, institutional, valuation and price-reaction checks are complete. Still WAIT_FOR_CONFIRMATION; a high mispricing score cannot create BUY.
- Every company needs thesis, full transmission, market/event/fundamental evidence, action, and explicit invalidation. Sector names alone do not imply company benefit.
- Transmission: Catalyst → Cause → Market → Sector → Company exposure → Fundamental impact → Price reaction → Priced-in → Risk/reward → Action. Missing steps reject the candidate.
- COMPLETED/FAILED confirmation requires corresponding evidence. Prose containing ready/成立/確認/失效/跌破/停止 has no state authority.
- Normalize `2344`, `TWSE:2344`, `2344.TW` identically. Merge compatible evidence and invalidation. Conflicting duplicate judgments fail closed; never choose the bullish duplicate.
- Subscriber summaries never render raw operational error codes, secret data or internal maintenance links. Debug evidence remains in tests/audit artifacts, not a new subscriber QA dashboard.

## Performance / forward validation

The current public RPC remains `get_public_performance_journal`; anon never gains raw reports-table access. Both outcome evidence and an explicit complete closing data status are required. `insufficient_data`, degraded, missing, pending, non-trading and future records are excluded and visibly counted, never disguised as hit/miss.

Forward contract is reserved in `forwardValidation.ts`: freeze original revision/time/symbol, category (Direction / DO_NOT_CHASE / Mispricing), due trading-session horizon (1/5/20/60), actual observation time, evidence, and natural execution. Due dates must come from the canonical trading calendar, **not calendar-day arithmetic**. No future lookahead, revised thesis, replay or recovery enters a natural sample. Deduplicate revision/symbol/category/horizon; conflicting outcomes exclude that identity.

Never aggregate different categories/horizons into one success claim. Until a real, approved read source exists, the forward section explains what will be measured and says no mature evidence exists. No fabricated return, denominator or simulated historical success is published.

## Regression and acceptance commands

Use Node 22 (repository `.nvmrc`).

```sh
npm run type-check
npm run lint
npm run test:public
npm run build
git diff --check
```

Node public tests include product state matrices, score provenance, malformed inputs, stale/revision mismatch, no-chase, damage/mispricing, incomplete vs no-qualified, company checks, duplicate conflicts, forward denominator and all 33 learning definitions. Existing Core regression and CI checks remain unchanged.

Browser:

- `tests/browser/subscriberProduct.e2e.mjs` uses existing isolated Supabase `ma-core-final-20260907` at 54371 and its isolated preview at 4313. It checks the database scope marker before any login. Existing synthetic local Owner uses real GoTrue PKCE → server profile/entitlement → actual page loaders. One local SMTP message per run; no Production session, user or secret is copied. Production API requests are blocked. Only brand/font static hosts may be read.
- `tests/browser/productDecision.e2e.mjs` renders `productDecision.html` under that loopback dev server. These are visibly labelled synthetic UI fixtures, not Auth/provider/Production evidence. All external networking is blocked. Five scenarios × four sizes; not included in application build/router.
- Provide `MA_LOCAL_SCOPE=ma-core-final-20260907`, `MA_E2E_OUTPUT=/private/tmp/<evidence-dir>` and `MA_PLAYWRIGHT_MODULE=<installed playwright module>`; no new runtime dependency is needed. See script headers for precise boundaries.

Remaining release gates: natural Core Production Acceptance; approved producer integration for V1 inputs and public/member projection; calibrated data and prospective performance collection; separate Product deployment approval. Local/CI PASS does not satisfy any of these Production gates.

## Education references

Retain term-level links. This revision verified the official [TWSE investor education portal](https://investoredu.twse.com.tw/Pages/TWSE.aspx), [valuation definitions and limitations](https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html) and [institutional flow statistics](https://www.twse.com.tw/zh/trading/foreign/bfi82u.html). Analogies are educational, not live advice or trade recommendations.
