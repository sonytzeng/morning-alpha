# Phase 2 Previous Comparison P0 candidate

Base: `2b87c2134ac2449ba93c7a54a4de20c1f5017822` (released PR191).
Production remains unchanged by this candidate. Readdy646 stays unpublished.

## Exact cause and preserved evidence
The released input RPC searched 45 days for the latest committed PREMARKET Atomic
proof. On9/30 that selected9/18, skipping the actual9/29 trading day. The current
day's11/11 is valid;9/18's retained pre-contract cash session is incompatible with
today's validator. The analyzer computed the prior day as a mandatory dependency.
The old test database omitted9/18 and the helper supplied a null prior pointer.
The added real Production input fixture retains that pointer, row IDs, dates and
proofs unmodified; it contains only the allowlisted research reader output.

## Contract
`PREVIOUS_VALID_COMPARISON_V1` uses the existing official TW calendar in JS and its
existing DB equivalent. It only admits the actual previous trading day; no search
to a distant fallback day. `previous_trading_day` is the calendar candidate;
`previous_comparable_evidence_day` is that day only after availability, as-of,
Atomic and unchanged current-contract validation, otherwise null/NONE.

Current computation validates OUTSIDE the enhancement boundary. Missing providers,
wrong date/session, stale/future rows, mixed batch/correlation/revision remain
rejected. The resolver never fabricates data or relaxes a current Core check.

Missing/null/incompatible/distant/incomplete/late prior evidence yields
PREVIOUS_COMPARISON_UNAVAILABLE, missing_component PREVIOUS_DAY_COMPARISON,
quality.change_detection UNAVAILABLE and empty what_changed. Features, signals,
cross signals, both evidence camps, conflict and invalidation remain available.
Prior transport failure is also unavailable; current transport failure rejects.

Core evidence coverage stays100. Analysis evidence coverage is11/12=91.6667 when
the comparison component is missing, with explicit5-point uncalibrated confidence
penalty plus its existing0.2 evidence-score weight. Confidence never goes below0.
Shadow action thresholds still apply. No calibrated accuracy/performance claim.
The metadata preserves the reason and calendar version. Existing artifacts are
append-only and are not recomputed/overwritten or converted into Forward samples.

## Isolation verification
Exact real-input worker replay:3 current analyses(9/30,10/1,10/2),5 safe rejects
(9/21,22,23,24,29),1 successful analysis with comparison unavailable(9/30).
10/2 retains range/BULLISH/HIGH/WAIT and confidence17.3047.
A–E, transport failures, holiday/Monday and current-core negatives are regression
cases; synthetic mutations are controls, never represented as Production evidence.
Fresh DB first reproduces the old9/18 selection, then applies the guarded successor
and exercises the REAL input and store RPCs, immutable replay/idempotency and RLS.
Owner/ACL/security/search_path unchanged. No business writes or Forward samples.

## Release request (not authorized yet)
Only migration `20261005103458_analysis_previous_comparison_nonblocking_v1.sql`;
only Function `research-analysis-shadow-v1` (shared research modules compiled in);
only Phase2 Owner UI unavailable-comparison presentation. No Cron, Auth, RLS,
Secrets or Core deployment. Original migration and Integrity hashes stay intact.
Sony must separately approve Production migration, function release and UI publish.
