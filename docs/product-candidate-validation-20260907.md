# Decision V1 / Subscriber UX local candidate — 2026-09-07

## Boundary

Branch: `codex/core-stability-20260907`. Product diff baseline: `dcf1a8c976b5e78a00356d4443930191731f119a`.

No Production deployment, merge, migration, cron change, report generation, recovery, LINE dispatch or business write was performed for this candidate. Fetch v64 and the 2026-09-08 natural Acceptance remain untouched. The frozen Core source manifest (110 tracked files) passes its SHA-256 regression pin.

The earlier Core commits remain on this development branch. Do not mistake the entire PR-versus-main diff for the product-only diff. Review this product commit separately; do not deploy all PR files as a product release.

## Final local evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| TypeScript | PASS / exit 0 | Node 22.23.1, `npm run type-check` |
| ESLint | PASS / 0 errors / 0 warnings | `npm run lint` |
| Production build | PASS / exit 0 | Vite 8.0.16, 209 modules, 3.53 seconds; plugin-timing advisory only |
| Node regression | 375 PASS / 0 failed / 0 skipped | `node --test tests/*.test.mjs` |
| New product tests | 37 PASS | 34 Decision/education/forward cases + 3 Product Contract checks, included in 375 |
| Deno regression | 50 PASS / 0 failed | Research pipeline, quality, master narrative, intraday contract, Runtime Timeline and Decision Lifecycle |
| CSS parse/scope | PASS | PostCSS parse; all selectors scoped; no duplicate selector in a media context, fixed-height clipping or global override |
| Diff whitespace | PASS | `git diff --check` |
| Fixture build exclusion | PASS | No synthetic company/model marker in emitted application JS |
| Local Auth | PASS | Real isolated GoTrue email/PKCE, server profile admin, server entitlement admin, callback code removed |
| Actual page E2E | 24 layout checks PASS | Six routes × 375/390/430/1440; HTTP 200, first-screen answer, no horizontal overflow |
| New assessment UI | 20 scenario/size checks PASS | Five explicitly synthetic scenarios × four widths |
| Learn | PASS | All 33 identities retained, six-stage reading, real search/category/deep-link/dialog |
| Accessibility / reload | PASS | Focus trap, Esc, focus restore, scroll unlock, Owner beginner-mode reload |
| Disabled coach | PASS | Existing safe 404 remains; feature flags unchanged |
| Console / network | PASS | 0 errors, 0 warnings, 0 unexpected HTTP failures, 0 Production API requests |

Actual routes: `/report/today`, `/war-room`, `/verification`, `/performance`, `/learn`, `/learn/price-earnings-ratio`. Heights: 812/844/932/1000. Both additional Today answers, not just the H1, must fit the first screen.

Synthetic scenarios: extended price / missing assessment / completed empty screening / fundamental damage / intact broad selloff. These use real new UI components but are **not** provider, Auth or Production evidence. Missing assessment hides company cards. No-chase/defensive/waiting market states constrain company actions. Missing calibration never becomes a completed no-opportunity screen.

Browser artifacts are kept outside Git at:
`/Users/sonytzeng/.codex/visualizations/2026/07/11/019f4fe6-5ca6-7c80-bd65-722d6bd0eccc/product-v1-20260907/`

Files: `browser-results.json`, `decision-browser-results.json`, and per-route/per-scenario PNGs. JSON retains paths/statuses and synthetic role results, never passwords, session tokens, Auth codes or request bodies.

The isolated stack uses ports 4313/54371/54374 and the `ma-core-final-20260907` database scope marker. Existing synthetic local users and local SMTP are used. No Production session is moved. External brand/font static resources are permitted in the real-page run; Production APIs are blocked. The fixture run blocks all non-loopback requests.

## Before / after

- Today: dashboard/workbench heading → three immediate answers, separately labelled direction/confidence/entry/regime, compact market measurements and expandable validation.
- Intraday: completed could imply confirmation → answer driven by actual confirmation/failure/closing evidence; checkpoint history remains available on demand.
- Closing: generic progress question → verified outcome, partial/insufficient or non-trading answer; complete status alone is not complete evidence.
- Performance: promotional interpretation prevented by explicit complete closing data + real direction; future categories/horizons reserved without invented returns.
- Learn: 33 identities, aliases, sources and gates preserved; life example and practical use now precede misconceptions/risk. Learn follows decision pages in navigation.
- Shared semantic colors accompany text labels; no new animation, all new CSS is scoped.

## Honest readiness / remaining gates

The **local read-model and Subscriber UX implementation** is validated and reviewable. Full live Decision V1 integration is not yet complete: the frozen producer does not emit the new calibrated/factor evidence contract. Legacy market text remains readable; missing V1 scores stay unavailable. The optional V1 input is not fabricated from prose or old confidence.

Before an end-to-end data-backed Product candidate can be declared complete:

1. Pass the natural Core Production Acceptance gate independently; do not count this local run as a stable Production day.
2. Integrate the approved V1 producer input and public/member projection after the Core freeze. Verify real calibrated direction, measured factor provenance and canonical identity through the actual payload, not only synthetic scenarios.
3. Keep forward-validation displays unpopulated until actual approved observation data and trading-session horizons exist. This candidate only reserves the requested categories/horizons.
4. Obtain separate Product deployment/merge approval. CI success does not approve Production release.

CI evidence must be attached to the new product commit, not reused from the prior Core commit. This document records local results; the final handoff supplies the actual CI run URL and SHA after push.
