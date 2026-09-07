# Morning Alpha Product Contract V1

Status: LOCAL PRODUCT CANDIDATE — not a Production release or a calibrated trading strategy.
Owner specification: Decision Engine V1 / Subscriber UX approval, 2026-09-07.

## Release boundary (mandatory)

Fetch v64 is awaiting the **2026-09-08 natural Production Acceptance**. This product change must not modify, deploy, replay or advance Core Fetch, Acceptance, Cron, Publication, LINE, Closing or Learning producers. No Production writes, Migration, Merge or deployment are authorized by this candidate.

Frozen source baseline: `dcf1a8c976b5e78a00356d4443930191731f119a`.
`tests/productContract.test.mjs` retains the original bytes of 109 Supabase/workflow/core-reader files. The only user-approved exception for this follow-up is the read-side `get-report-payload` adapter and two newly added `decision-v1-*` modules. `coreProductionPreservation.test.mjs` removes exactly that additive block and checks the previous reader's complete source hash, including Auth, entitlement, retry and publication-alignment code. No Core producer pin was refreshed.

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

## Canonical server Decision Evidence Payload

`src/features/decision-v1/contract.ts` defines the typed output. `engine.ts` now contains labels and an empty-state constructor only; it performs **no score calculation**. The original hypothetical measured-input evaluator is archived under `tests/fixtures` solely to retain regression fixtures; it is absent from the product import graph and build.

The additive server field is `payload.decision_engine_v1` (`schema_version: decision-evidence-v1`). The existing report adapter exposes that server payload in its effective AI view, without recomputing scores. React accepts only the validated output, exactly matching the server-resolved `report_date`, `revision_id`, `generated_at`. `data_as_of` is actual eligible market observation time, never later than generation. The report date must be Taipei today. Raw factor inputs, unsupported percentages, future or mismatched identities fail closed.

`get-report-payload` locally reads eight existing canonical datasets through `decision-v1-data.ts` and derives the output in `decision-v1-evidence.ts`. Each query is bounded, has a 4-second abort, and requires both observation and first-availability timestamps no later than the published revision. Query failure/truncation is an explicit gap. No insert, update, RPC, external provider/AI request, producer import or schema change is introduced. This is an **as-of read model**, not an immutable stored Decision ledger. A SHA-256 `assessment_id` makes changed inputs/missingness detectable independently of the published revision; public/member projections share that assessment hash. No deployment has been performed.

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
| Direction Probability | No valid out-of-sample calibration exists; always null with `INSUFFICIENT_HISTORY` | Never substituted with CLE accuracy or legacy confidence |
| Direction evidence score | Five fresh quotes TAIEX/TXF/2330/SOX/SPX; mean normalized signed price-change pressure | Deterministic quality index, **not probability**; missing/conflicting markets → null |
| Model Confidence | Equal mean of audited-factor coverage, timestamp freshness, independent-source coverage, sign agreement and calibration evidence coverage | Missing factors reduce coverage; no calibration/source evidence contributes 0 coverage, not fabricated raw values. No market evidence → null |
| Entry Environment | Mean of regime, inverse risk, inverse 20-close price position, explicit-universe breadth, institutional flow, sourced catalyst availability, inverse price response, evidence quality | Any required factor missing → null. Valuation unavailable is declared/excluded and lowers confidence, never imputed |
| Opportunity Score | Five evidence-based dimensions: inverse priced-in, four-quarter earnings agreement, institutional net/gross, volume ratio, relative performance | Incomplete candidate/universe → no recommendation; complete candidate score <50 can be excluded |
| Priced-in | Six measured components: pre-event return, post-event return, relative return, volume ratio, 20-close price position, sector reaction | Missing pre/post data/volume/sector → no stock score; no sentiment substitution |

These quality indices and guardrail thresholds are transparent **prospective V1 policy**, not empirically calibrated probabilities or expected returns. Calibration cannot be enabled by increasing a `sample_count` field: a separate point-in-time, out-of-sample contract and validation is required. Current CLE rows (0–8 samples) have a different target and are not used as directional calibration.

Freshness is evaluated at the published revision's generation cutoff. Taiwan quotes have a conservative 20-hour cutoff, overseas quotes 80 hours; premarket weekend/holiday gaps are explicitly unavailable, never refreshed by retrieval time. News window begins previous Taipei calendar day 16:00 and ends at assessment; only source-linked, already ingested events qualify. Financial checks need four consecutive sourced quarters, newest ≤120 days and full four-quarter range ≤550 days. Latest provider values never retroactively fill a morning decision. Browser time never completes a checkpoint.

## Decision safeguards

- Action enum: ACTIVE_WATCH, WAIT_FOR_PULLBACK, WAIT_FOR_CONFIRMATION, HOLD_WATCH, DO_NOT_CHASE, DEFENSIVE, AVOID, NO_QUALIFIED_OPPORTUNITY, INSUFFICIENT_DATA, NOT_APPLICABLE. No BUY output.
- A complete, evidence-backed empty screening result is `NO_QUALIFIED_OPPORTUNITY`; absent screening, rejected candidates or missing quality fields are `INSUFFICIENT_DATA`. A broken pipeline must not look like a legitimate no-opportunity day.
- Missing calibration prohibits probability, not transparent deterministic evidence indices. Missing required entry data prevents ACTIVE_WATCH. Withheld member content is distinct from an incomplete screen. Server projection only exposes company cards already in the same approved member revision's published symbols. Existing publisher SELECTIVE/TRADE enums permit paid observations but are not treated as completed entry checkpoints; their new ACTIVE_WATCH is capped at WAIT_FOR_CONFIRMATION.
- EXTENDED or company priced-in ≥80 → DO_NOT_CHASE. Market risk ≥70 or RISK_OFF → defensive. Entry score <50 → wait for better conditions. Model-confidence quality <50 cannot upgrade an active watch. These are reviewable candidate guardrails, not provider facts.
- Company fundamental damage / company-specific negative / evidenced failed confirmation → AVOID, regardless of how far price fell.
- Broad selloff requires sourced company transmission, four consecutive revenue/EPS actual-versus-consensus checks, non-reduced guidance, institutional support and price/volume/sector evidence before MISPRICING_CANDIDATE. "Intact" refers narrowly to those observed filings, not a guarantee about balance-sheet health or future earnings. Valuation remains explicitly unavailable; this is relative selloff observation, not a claim of intrinsic undervaluation. Still WAIT_FOR_CONFIRMATION, never BUY.
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

Remaining release gates: natural Core Production Acceptance; complete real source datasets described in `decision-evidence-inventory-20260907.md`; genuine calibrated history and prospective collection; separate Product deployment approval. Local wiring/CI PASS does not mean real recommendations or Production readiness. No Frozen Core change is authorized to fill those gaps.

## Education references

Retain term-level links. This revision verified the official [TWSE investor education portal](https://investoredu.twse.com.tw/Pages/TWSE.aspx), [valuation definitions and limitations](https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html) and [institutional flow statistics](https://www.twse.com.tw/zh/trading/foreign/bfi82u.html). Analogies are educational, not live advice or trade recommendations.
