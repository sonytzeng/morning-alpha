# Recommendation V2 — prospective Owner-only research

Status: implementation candidate, NOT released or promoted. Predecessor:
`b00856329d8edd5467c9470cb147c85b8819908c`. V1 is immutable.

## Research question

V1 asks about institutional TWD and earnings expectations surprise. V2 asks
whether observable trend/relative strength, actual growth and institutional
**shares** support a prospective, conditional long observation. These are
different hypotheses; V2 is not evidence that V1's unavailable inputs are zero.
No success probability, performance claim or automatic promotion is permitted.

## Producers and availability

* Reuse the bounded stock capture and canonical sector universe, at the same
  final cutoff as V1. Do not refetch quotes independently for a comparison.
* Fugle institutional-trades officially reports shares, excludes foreign dealers
  from foreign investor totals, and requires developer/advanced entitlement.
  Do not presume entitlement or purchase it. The underlying official TWSE T86
  and TPEx daily institutional datasets are credential-free alternatives.
* TWSE/TPEx monthly revenue supplies actual same-month YoY and preceding-month
  MoM. Ratios are computed from same-row amounts and reconciled with reported
  percentages. No amount is converted to TWD without a stated source unit.
* Official quarterly financial disclosures may be year-to-date. Keep their
  period/basis explicit; never invent standalone quarterly EPS, EPS trend or
  consensus from a latest YTD value. Missing history is PARTIAL.
* An official company event is context requiring review, never a bullish score.
* Every observation has source, source session/period and actual availability.
  Retrieval now does not establish historical availability.
* Production read-only audit found missing local TAIEX closes on 9/11 and 9/16.
  Shadow alone can acquire the matching 20 completed sessions from TWSE's
  official MI_5MINS_HIST monthly history (at most three months, two readers,
  bounded retries). Actual retrieval time is retained. Conflicting local/official
  values fail closed. This does not backfill market_quotes or alter V1 inputs.
  Contract: https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?response=html

## Isolation and natural execution design

The existing authenticated stock producer is the acquisition boundary. A new
Owner-only Shadow module must not become a requirement for its V1 response.
It must not export research into reports, LINE, formal recommendations or member
RPCs. No new Cron, Secret, browser write authority or Core auth policy.

Before wiring persistence, prove bounded runtime and fail-open behavior. Reuse
`is_research_owner_v1()` for new research read policies, not a second Owner test.
The original V1 calculation and response remain independently testable.

## Prospective evaluation requirements

Prediction cutoff, actual server lock time, methodology version, evidence hash,
entry, invalidation and horizons are immutable. Entry must occur strictly after
the lock. Retry cannot replace the first authoritative prediction for a date.
Historical/replayed observations never contribute Forward samples.

Evaluate 1/3/5/10/20 **trading sessions**, with actual entry and available daily
bars. Missing/delisted/suspended/adjustment-ambiguous paths remain unavailable,
not zero-return wins. With daily OHLC, same-bar entry/stop ordering is ambiguous:
use conservative ordering and disclose it. Outcomes are gross of costs unless
actual costs exist. Report MFE, MAE, return, win/loss, expectancy, profit factor
and drawdown with denominators; no fabricated zero losses/infinite profit factor.

Forward sample count means distinct prospectively locked trading dates, not 72
correlated stocks per day. At least 20 dates permits a review request only;
Sony alone can approve promotion. All current performance remains unproven.

## Release evidence (not yet complete)

Must prove source contracts, same-cutoff V1/V2 comparison, fail-open isolation,
immutable/idempotent DB locks, Owner/anonymous/member access, session outcome
boundaries, Owner UI, Fresh DB, Integrity, full release CI and live runtime.
No PARTIAL candidate may be reported as daily natural execution PASS.

Local candidate verification: 12 prospective/source/outcome unit tests, four
sidecar fail-open tests, seven Owner UI state/race tests, and a fresh isolated
PostgreSQL migration pass. Owner RLS allows only the existing Owner truth;
anonymous/member/paid reads are denied. All five JS/DB outcome horizons,
immutability, concurrent first-lock, evidence tampering and idempotency pass.
Loopback-only browser verification passes at 1440/375/390/430px and denies after
logout, with zero external dispatch. Synthetic samples remain isolated; these
are not Production Forward observations or Sony usability approval.

Natural wiring is the existing report producer proof callback, followed by a
bounded EdgeRuntime.waitUntil research sidecar using a separate client. Core
critical recorder inputs are not enlarged. The acquisition/Smoke endpoint only
calculates a capsule and never persists predictions. No new scheduler exists.
Storage failure or no waitUntil runtime cannot change V1's decision proof.

Outcomes are conditional, unlevered **price-only** research, gross of costs and
excluding cash distributions. Daily high/low excursion bounds are conservative,
not exact tick paths. A split/adjustment ambiguity is not evidence of investable
total return. Performance must never be described as Sony's actual trades.
The UI suppresses aggregate claims when the bounded outcome read is truncated.
Quarterly EPS is as reported; standalone quarter basis, EPS trend and growth
acceleration remain PARTIAL until a genuine comparable history exists.
