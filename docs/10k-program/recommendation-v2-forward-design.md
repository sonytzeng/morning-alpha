# V2 Forward lifecycle candidate

Baseline: `10208c0817718d29f9f86284c32cff5c3ffb39e6`. Status: **INCOMPLETE; not deployed**.

## Frozen research contract

`RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0` and its numerical selection rules
remain unchanged. Re-evaluation appends an observation; it never promotes or
updates an earlier WATCH. Entry remains the next TW trading session's strictly
above-20-completed-session-high condition, expiring after that session. A
checkpoint evaluation is not an instruction to enter during the checkpoint.

NONE is a completed evaluation, not a service failure. BLOCKED is a missing or
invalid dependency. Neither NONE, historical replay nor multiple symbols on one
date increases the independent Forward date count.

## Natural execution and resource isolation

The existing post-Atomic lifecycle must initiate research even if optional
Report/Research subsequently fails. All seven existing checkpoints are reused;
no new Cron is permitted. Research failure must not change Fetch, Atomic,
Report or LINE responses.

A background promise alone is not a durable queue and does not waive the Edge
runtime wall-clock limit. Every run requires a bounded lease, immutable phase
identity and retry/idempotency proof. The source Atomic batch must be same-date,
same-checkpoint, single authoritative COMMITTED 11/11. A prior checkpoint cannot
be replayed later as a fresh prediction. Backup invocations may retry an
unfinished current checkpoint, not overwrite an observation.

Resource constraint: the formal producer and research must not launch duplicate
72-stock acquisition streams against the same Fugle quota. The candidate must
prove either source reuse with unchanged timestamp/freshness checks or a shared
bounded acquisition reservation. No report credential/auth changes, arbitrary
cached-date substitution, or relaxed quality gates are permitted.

## Append-only data

Prediction metadata: phase, lock time, source batch, frozen methodology, entry,
invalidation, risk, uncalibrated confidence, evidence hash and horizons. Existing
legacy locks remain immutable. Later phase observations retain their relation to
the original PREMARKET WATCH and are not additional independent dates.

Daily snapshots preserve all 72 results, independent gate counts **and** the
cumulative intersection. Near-miss ranking is a deterministic explanatory view
of evaluated NONEs: count unmet gates, then symbol. It is not a selection rule,
probability, recommendation or fake WATCH. Maximum five; missing company names
are unavailable rather than invented.

## Outcomes and samples

Existing V2 1D means the entry session's completed close. The additional Close
view must explicitly disclose its relationship to that existing contract;
do not silently shift the old 1D/3D/5D/10D/20D horizons. No outcome before
maturity and source availability. Failed entry is NOT_ENTERED, not a zero-return
winning trade. No locked profit target exists in V2: `target_hit` must remain
null with `NO_LOCKED_PRICE_TARGET`, not inferred from a profitable close.

Returns are gross, unlevered research observations. Daily OHLC uses conservative
stop-first ordering and cannot prove exact intraday MFE/MAE. Watch, Ready,
near-miss, market decision, Owner experiments and live journals remain separate.

0–4 independent dates: insufficient; 5–19: early; 20–59: preliminary; 60+: a
larger sample, **not proof of validity**. Promotion review additionally requires
real locks, complete matured outcomes and no leakage/drift/contamination.
Promotion always requires Sony's separate approval.

## Daily continuity

Calendar-derived expected dates govern 3-day warning / 5-day degraded BLOCKED
streaks and 5-day ZERO_CANDIDATE_REVIEW. Missing executions break a confirmed
streak and are reported separately, never synthesized as NONE. A review explains
gate concentration, universe and market context; it cannot change rules.

## Release proof still required

- Durable natural trigger, concurrency/resource isolation and existing lifecycle parity.
- Fresh DB: seven phase locks, same-phase duplicates, immutable history, Owner deny paths.
- Full outcome horizons, catch-up/backlog bounds and source lineage.
- Owner near-miss / daily brief / experiment separation, desktop/mobile.
- Official universe expansion audit (candidate only, live universe stays 72).
- Integrity, type-check, lint, build, GitHub gate, approved deployment, read-only safety diff.

No test transactions, fake Forward predictions, paid data purchase, new secrets,
Cron, public research access or automatic trades are authorized by this candidate.
