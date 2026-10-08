# Entry Opportunity Intelligence V1 — Owner-only candidate

Baseline: `97d219ddf75a7edd788de5272533e17ffcaaf686` (Market News P0 released).
Production deployment is NOT authorized by this candidate. No Core, V1, V2,
Report, LINE, existing prediction, schedule, secret or existing security policy
is modified. Market News natural acceptance remains an independent heartbeat.

## Decision contract and honest methodology

Three frozen versions: `OVERSOLD_REVERSAL_1.0.0`, `PULLBACK_ENTRY_1.0.0`,
`BREAKOUT_CONTINUATION_1.0.0`. Each symbol has three separate predictions and
outcomes. Counts are **strategy-symbol observations**, not unique stocks.
The scanned/universe denominators are stocks. The existing scope is 72, not
the whole Taiwan exchange. No stock is silently skipped.

Market Direction and Regime are copied from the as-of Canonical snapshot,
never recalculated or overwritten. Changing only bullish/bearish market labels
does not change an entry judgment. Relative strength and sector support are
independent measured inputs, not a blanket bullish/bearish veto.

This is a completed-session model: twenty consecutive completed TW sessions
ending at the previous legal session. The ten/twenty-session trend is NOT a
claim about sixty-day or longer trends. Intraday partial candles are not compared
with full-session volume. Confirmation means a setup confirmed by completed
evidence, not that a later executable fill already occurred.

Reversal: >=2 ATR drawdown, within 1 ATR of five-session support, decreasing
down-bar volume across two three-session windows, and close above the prior
high. Pullback: SMA10>SMA20, support proximity, price>=SMA20, shrinking volume,
close recovery and nonnegative same-session relative strength. Breakout: close
above the prior nineteen highs, volume >=1.5 prior average, sector/relative
strength support. A high above resistance but close below it is a false-breakout
risk. Extension >2 ATR above SMA5 is a chase veto, even in a rising market.

Actual negative revenue YoY/MoM or reported negative EPS is adverse evidence;
missing revenue cannot stand for healthy fundamentals. EPS trend and consensus
are not invented from Actual. Recent official events are review-required, never
automatically bullish. Input freshness/session validation stays in the existing
V2 adapter and the new independent as-of validator; both hashes are retained.

These are **unvalidated research hypotheses**, not official Recommendation
threshold changes. ENTRY_READY is not a buy order or success probability.
Evidence confidence is only required-field completeness; probability remains
null and calibration is INSUFFICIENT_SAMPLE.

## Price, risk and execution

Reference range is a derived trigger through trigger+0.25 ATR. Reversal and
pullback use observed resistance as the target scenario; breakout uses measured
prior range. No valid geometry means no fabricated prices. Net reward/risk >=2,
maximum model risk 8%, and average twenty-session amount >=TWD50m are frozen
research assumptions. They never change V1/V2.

Costs: explicit illustrative buy/sell fee 0.1425% each, sell tax 0.3%, and
0.1% slippage each side. Not actual account charges; minimum commissions and
dividends are excluded. Prices are reference observations, not rounded order
instructions. Entry can only occur next legal session, strictly above trigger
and inside the locked range; gap-chasing is NOT_ENTERED. One-session expiry.

1/3/5/10/20 count TW trading sessions from the entry session. No result before
maturity/availability. Same-bar stop and target use conservative stop-first;
daily MFE/MAE are bounds, not tick accuracy. `close_or_exit_drawdown` uses daily
closes and model exits, NOT intraday maximum drawdown or a capital-weighted
account equity curve. Unverified adjustment/executability,
missing benchmark/session, suspended/zero-volume bars are unavailable, never
zero-return wins. Historical, synthetic and missing-provenance records are
excluded from Forward statistics.

## Storage and authorization candidate

One additive migration: `20261008081315_entry_opportunity_owner_shadow_v1.sql`.
New append-only runs, per-strategy predictions, outcomes; immutable update /
delete / truncate triggers; source-run reference; exact-hash idempotency and
fresh-current FORWARD lock guard. Owner reads reuse `is_research_owner_v1()`;
anon/member/paid/logout denied. Only the server role can execute new store RPCs;
Owner browser only reads. Existing roles/policies/functions are unchanged.
Outcome tables have no write grants or write RPC in this draft; performance
cannot be persisted from unverified caller-supplied execution flags.

One new Function candidate: `entry-opportunity-shadow-v1` (NOT deployed).
Gateway JWT plus existing internal credential validator, explicitly excluding
service-role fallback. Origin/browser requests denied. Reads a named retained
V2 capsule and as-of Canonical state, recomputes the hash and both models, and
writes only new research tables. No quotes/news acquisition, dispatch, orders,
new secret or Cron. No existing natural Caller has been modified to invoke it.
Activation/automatic forward scheduling needs a separately reviewed release
manifest; no claim of natural daily execution is made here.

Outcome persistence would require retained adjustment/executability proof, not
a caller-provided true flag. The current saved V2 source contract has no such
proof. The attempted write RPC was removed before sealing this draft; this is
an explicit data integration gap. **Do not activate automatic outcome recording
or pretend the complete Forward lifecycle is ready.** The isolated pure outcome
calculator tests modeled costs/maturity/stop ordering, not a Production producer.

## Evidence and acceptance ledger

Production read-only metadata: retained V2 runs cover 10/7 (one) and 10/8 (seven).
Security review denied copying full Production evidence/result JSON. No such
copy was made. Sony was asked separately for minimal deidentified fixture
export permission; pending at this candidate checkpoint.

Existing repository retained 10/2, 10/5, 10/6 source replay demonstrates missing
twenty-session stock candles and correctly rejects evaluation. It does not
validate a profitable strategy. No synthetic bars are relabelled real.

| Scenario | Engineering boundary | Real historical strategy validation |
|---|---|---|
| Rising market / overextension | isolated test | UNVERIFIED |
| Falling market / reversal independence | isolated test | UNVERIFIED |
| Range | isolated test | UNVERIFIED |
| False breakout | isolated test | UNVERIFIED |
| Sharp decline then bounce | isolated test | UNVERIFIED |
| Trend pullback then continuation | isolated test | UNVERIFIED |

Fresh network-none PostgreSQL: actual existing Phase1 Owner gate, new migration,
duplicate application rejection, append-only, duplicate research idempotency,
source/hash mismatch and backdated Forward rejection. Browser 1440/375/390/430
uses that isolated DB/RLS and blocks external network. Its synthetic Owner is
NOT Sony Production Owner proof. Production Session not used.

## Release manifest / current limits

Candidate only: one named Migration, one named new Function, two Owner UI files
and direct research/tests/CI/Integrity documentation. No Production writes,
no existing Forward mutation, no Methodology promotion, no Paper Trade creation.
New Owner policies are limited to the three new tables and reuse the current
Owner truth; they still require Sony's explicit Production Migration approval.
Real same-cutoff replay coverage, executable-source lineage and complete
outcome persistence/runtime verification remain required before engineering
can honestly be called COMPLETE. No investment validity claim is authorized.

`ENTRY_INTELLIGENCE_ENGINEERING = INCOMPLETE`
`ENTRY_INTELLIGENCE_ANALYSIS_VALUE = INSUFFICIENT_SAMPLE`
`SONY_USABILITY = PENDING`
`PUBLIC_PRODUCT_APPROVAL = NO`
