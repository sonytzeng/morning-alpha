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

Entry screening costs: explicit illustrative buy/sell fee 0.1425% each, sell tax
0.3%, and 0.1% slippage each side. Not actual account charges; the unchanged
screening model excludes minimum commissions and dividends. Outcome models now
separately lock quantity and minimum commissions before evaluation. Prices are reference observations, not rounded order
instructions. Entry can only occur next legal session, strictly above trigger
and inside the locked range; gap-chasing is NOT_ENTERED. One-session expiry.

1/3/5/10/20 count TW trading sessions from the entry session. No result before
maturity/availability. **Same-bar stop and target are UNCONFIRMED, with null
return, not stop-first or favorable-first.** Daily MFE/MAE are bounds, not tick
accuracy; exact MFE, MAE and maximum drawdown stay null. `close_or_exit_drawdown`
is available only for a complete no-early-exit daily close model, NOT intraday
maximum drawdown or a capital-weighted account equity curve. Unverified adjustment/executability,
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
calculator tests modeled costs/maturity/unknown ordering, not a Production producer.

## Final Research Closure — data inventory (2026-10-08)

The two private approved capsules are still the only exported real fixtures.
`auditRetainedHistory` binds their input hashes, reuses the frozen V2 normalized
SHARES/TWD adapter, and checks every required TW trading date, positive OHLCV /
amount, duplicate session and original availability. No older bar is padded or
newly acquired data relabelled as available at the old cutoff.

| Retained cutoff | 20-session coverage | 60-session coverage | 120-session coverage | Valid sector comparison |
|---|---:|---:|---:|---:|
| 10/7 20:28 Taipei | 72/72 | 0/72 | 0/72 | 66/72 |
| 10/8 14:33 Taipei | 72/72 | 0/72 | 0/72 | 66/72 |

Each symbol has 45 retained bars. The existing acquisition requests **65 calendar
days**, not 60 trading sessions (`recommendation-stock-evidence.ts`). It is not
changed in this candidate. The prior research-only request manifest uses the existing
TW calendar to derive exact 20/60/120-session bounds, raw daily candles, bounded
attempts/timeouts/pacing, no credentials, no live calls and no Production writes.
That earlier manifest did not execute requests. The subsequent public-exchange
acquisition below is separate; it does not change these retained-cutoff counts.

Lookback inventory of the frozen models, not new thresholds:

| Model | Actual dependencies | 60/120 use in frozen V1 |
|---|---|---|
| Oversold reversal | ATR/drawdown 20; support 5; selling-pressure 6; confirmation 2 | Not consumed; long-cycle context unverified |
| Pullback | SMA20/SMA10; support 5; volume comparison 6; confirmation 2 | Not consumed; **not** a proven medium-term trend |
| Breakout | resistance/volume 20; extension SMA5; confirmation 2 | Not consumed; long-base breakout unverified |

Their maximum currently happens to be 20; this is verified formula inventory,
not an assumption that all future models need the same lookback. Adding 60/120
as a decision requirement is a separately versioned methodology change, not a
test fix. Historical completeness is audited even where the model does not use it.

The six stocks belong to two saved sectors with three total symbols each, hence
only two peers after excluding self, versus the unchanged three-peer requirement.
Read-only Production `sector_stock_map` counts confirm each sector has three
mapped and three active symbols: this is **UNIVERSE_COVERAGE_GAP**, not a parser
failure. There are no additional mapped peers to borrow. Exact symbol-level
details stay in the private local replay; no paid-data purchase is proven necessary.

### Existing lawful sources and limits

- [Fugle historical candles](https://developer.fugle.tw/docs/data/http-api/historical/candles/): daily candles supply volume in shares and turnover in TWD. A research query can request a longer date range. Vendor-adjusted histories may reflect subsequent actions; a response fetched now is not an as-of historical input.
- [Fugle dividends](https://developer.fugle.tw/docs/data/http-api/corporate-actions/dividends/) and [capital changes](https://developer.fugle.tw/docs/data/http-api/corporate-actions/capital-changes/): documented event sources for dividends, rights, splits and capital reductions. These APIs have plan restrictions; this task did not read credentials or claim Production entitlement. Combined rights/dividend value is not cash alone. Split direction/ratio and cash entitlement need source-specific interpretation.
- [TWSE daily history](https://wwwc.twse.com.tw/zh/trading/historical/stock-day.html) and [ex-right results](https://wwwc.twse.com.tw/zh/announcement/ex-right/twt49u.html): existing official alternatives, not a new paid vendor. The ex-right table excludes certain combined reduction/demerger cases and is not alone proof of complete company actions.
- [TPEx ex-right results](https://www.tpex.org.tw/zh-tw/announce/market/ex/cal.html) and [capital-reduction reference](https://www.tpex.org.tw/en-us/announce/market/reduction/reference.html): exchange-specific official sources; reference-price changes must not be treated as trading gains or substituted for cash entitlement.

Read-only schema inventory found no dedicated corporate-action/dividend/split
tables in `public`. The 10/7–10/8 Provider Recorder endpoint inventory contains
market quotes/tickers, not a corporate-action feed. The immutable V2 capsules
retain stock daily histories but no complete action coverage or ordered trade
path. These are distinct stores; do not infer an action-free window from an empty
Recorder lookup. At that inventory checkpoint, source acquisition/entitlement and
as-of adjustment proof were **NOT VERIFIED**, not SOURCE_EMPTY or paid-source-required.

### Outcome contract v2 (not Entry strategy v2)

`ENTRY_OUTCOME_2.0.0` supersedes the draft stop-first calculator without changing
any Entry strategy, threshold, Prediction, Production record or existing V2.

1. A prospective lock digest binds symbol, strategy version, evidence hash,
   evidence cutoff, evaluation/lock times, full prediction (including horizons,
   trigger/invalidation/expiry) and cost assumptions. Cutoff <= evaluation <=
   lock < the next eligible open. The one-session entry window remains frozen.
   First tradable session after the signal is reported separately from that
   locked strategy window: pre-open, intraday-next-trade and holiday/after-close
   paths differ. The actual first executable tick always remains unconfirmed.
   A hash is an integrity check, not proof of database immutability; no new
   Outcome store RPC is enabled and the existing candidate triggers remain.
2. An intraday daily-bar crossing cannot prove the first executable price or
   whether an earlier low preceded entry: UNCONFIRMED, no reported return.
   No crossing before expiry, opening invalidation, opening above the range,
   or slippage outside the range have separate NOT_ENTERED reasons. Missing /
   zero-volume sessions are unavailable, not a fabricated no-trade or flat return.
3. An eligible opening observation can yield only **MODELLED**, never OBSERVED.
   Queue priority, limit locks, suspension and trade capacity are not proved by
   positive daily volume. Opening-gap exits are conservative hypotheses. If both
   stop and target occur in a day without opening-order evidence, no path is
   assumed. A minute bar with both levels would have the same ambiguity.
4. Stock and benchmark require separate complete-window action coverage, source
   reference, availability and content hash. Later adjusted candles are rejected.
   An action in the window yields `CORPORATE_ACTION_TOTAL_RETURN_LEDGER_REQUIRED`:
   cash/rights entitlements, split share ratios and the stop-adjustment policy
   cannot be invented. **The candidate does not yet calculate adjusted outcomes
   across these events.** Caller boolean `adjustment_verified/executable` removed.
5. Model costs bind quantity, minimum commissions, two-sided fees/slippage and
   sell tax. Conservative CEIL_TWD rounding and 0.3% tax are research assumptions,
   not Sony account charges or a day-trade tax claim. Actual broker fees differ;
   see [TWSE trading mechanism](https://www.twse.com.tw/en/products/system/trading.html).
   No change to entry-screening thresholds or risk/reward policy.
6. Five horizon maturities use trading sessions, not calendar days. Benchmarks
   must have the same sessions and known availability. An index close cannot
   stand for the benchmark at an intraday stop/target exit;
   such benchmark/excess returns remain null. Daily excursion bounds
   are separate from exact MFE/MAE; an exit-day partial path is not used to credit
   unseen extrema. Intraday maximum drawdown is unavailable without ordered data.
7. Model returns never enter observed Forward win-rate/expectancy/drawdown
   summaries. Historical/synthetic rows remain excluded; duplicate IDs/horizons
   must agree exactly. Forward Sample = 0, observed Outcome Sample = 0.

The actual retained two-date replay still yields 432 judgments: READY 0, WAIT 26,
AVOID 370, INSUFFICIENT 36; original V2 fact/status diff = 0. There is no real
ENTRY_READY lock or matured fill in these fixtures to manufacture an Outcome.
This task closes the unsafe draft **assumptions**, not the missing real evidence.
Daily-path ambiguity, long-lookback coverage, action/entitlement lineage and
ordered executable Outcome evidence remain explicit research gaps. No claim of
crash-bottom, pullback-continuation or breakout profitability is made.

### Exact release boundary

The only existing release candidates remain the additive
`20261008081315_entry_opportunity_owner_shadow_v1.sql`,
`entry-opportunity-shadow-v1` and the Owner UI mount/component, all **not deployed**.
No additional migration/function/secret/Cron/Auth/RLS change is introduced here.
The new audit and Outcome modules run offline only. Production acquisition of
longer/action histories and a verified Outcome persistence producer are not
silently enabled by this PR; a concrete runtime manifest and Sony approval are
required before those Production changes. Existing Forward records are untouched.

## Evidence and acceptance ledger

Production read-only metadata: retained V2 runs cover 10/7 (one) and 10/8 (seven).
Sony subsequently authorized a minimized, deidentified **private** export for
these two dates. The repository is public, so no Production fixture, per-stock
result, screenshot or raw capsule is committed or uploaded to public CI.
Database-side explicit field projection excludes contacts, users, Owner trades,
credentials, news text and unneeded Provider payload. Strict nested field/URL
allowlists and credential/PII scanning precede use. Local directory is 0700,
fixtures/screenshots 0600, outside Git; no Production writes were performed.

Selection is the latest immutable retained run per authorized date, not a
retrospectively invented premarket run. 10/7 cutoff is **20:28:24.170 Taipei**;
10/8 cutoff is **14:33:01.624 Taipei**. Earlier 10/8 checkpoints are not claimed
as replayed. Both contain 72 symbols, 45 retained normalized daily bars each;
the frozen validator requires the final twenty consecutive completed sessions.
No bar, source publication or acquisition timestamp is moved backward.

The original full-input hash is retained-ledger attestation only. A separately
pinned projection hash is recomputed locally; a projection never masquerades
as the full capsule or enters the Production persistence RPC. Both dates
reproduce all 72 original V2 statuses **and** market/liquidity/relative/sector/
fundamental/institutional facts exactly. Original V2 is not modified.

| Date | Strategy | Ready | Wait | Avoid | Insufficient |
|---|---|---:|---:|---:|---:|
| 10/7 | Oversold reversal | 0 | 3 | 63 | 6 |
| 10/7 | Pullback | 0 | 1 | 65 | 6 |
| 10/7 | Breakout | 0 | 7 | 59 | 6 |
| 10/8 | Oversold reversal | 0 | 7 | 59 | 6 |
| 10/8 | Pullback | 0 | 3 | 63 | 6 |
| 10/8 | Breakout | 0 | 5 | 61 | 6 |

Totals: 432 strategy-symbol evaluations, Ready 0 / Wait 26 / Avoid 370 /
Insufficient 36. Six symbols per date have only two mapped same-sector peers
instead of the existing three required for sector comparison; this is a saved
universe coverage limitation, not missing OHLC or a reason to lower a gate.
Eight symbols per date retain official events requiring impact review. No
announcement is automatically bullish. Exact private per-symbol missing fields
are returned by the local replay tool, not uploaded to GitHub.

Run locally with `MA_ENTRY_PRIVATE_FIXTURE_DIR=<private directory>` and
`node --experimental-strip-types tests/entryOpportunityRealReplay.integration.mjs`.
The gate refuses public CI, fixtures inside the repo, symlinks, broad filesystem
permissions, unexpected fields, altered hashes or saved V2 result drift.
Missing/future market, future candles and missing fundamentals are explicitly
labelled counterfactual negative controls; all reject, and direction-label-only
changes do not authorize entry. CI runs the same projection/privacy machinery
with **SYNTHETIC_TEST** inputs; its green status does NOT claim access to private
Production evidence. Private local real replay and public CI are separate gates.

Owner UI candidate was rendered with these real outputs at 1440/375/390/430,
through the existing network-none isolation DB Owner check, with all external
browser requests blocked. Both dates, all three strategy tabs, contrast,
overflow, collapsed details, anonymous/member/paid/logout denial passed.
This is an isolated research view, NOT Production deployment or Sony's personal
usability acceptance. Two local historical replays are not two saved Production
Entry runs and never count as Forward or Outcome samples.

Existing repository retained 10/2, 10/5, 10/6 source replay demonstrates missing
twenty-session stock candles and correctly rejects evaluation. It does not
validate a profitable strategy. No synthetic bars are relabelled real.

| Scenario | Engineering boundary | Real historical strategy validation |
|---|---|---|
| Rising market / overextension | isolated test | UNVERIFIED |
| Falling market / reversal independence | isolated test | UNVERIFIED |
| Range | isolated + both real as-of cutoffs | Decision replay PASS; investment outcome UNVERIFIED |
| False breakout | isolated + retained price-pattern risk flags | Risk detection replay only; outcome UNVERIFIED |
| Sharp decline then bounce | isolated test | UNVERIFIED |
| Trend pullback then continuation | isolated test | UNVERIFIED |

Fresh network-none PostgreSQL: actual existing Phase1 Owner gate, new migration,
duplicate application rejection, append-only, duplicate research idempotency,
source/hash mismatch and backdated Forward rejection. Browser 1440/375/390/430
uses that isolated DB/RLS and blocks external network. Its synthetic Owner is
NOT Sony Production Owner proof. Production Session not used.

## Historical Evidence P0 — executed public-source research acquisition

Continued from approved `93a8ff77f0259780049922761802f6cc9bcc88d2`.
No Production credential, Function invocation, SQL write, deployment, Migration,
existing Prediction update or official Universe expansion was used.

The local research CLI now acquires existing lawful public exchange data, with
one global in-process 1.5-second request interval, concurrency one, 20-second
request timeout, at most three attempts and capped Retry-After/backoff. Monthly
TWSE requests and date-batched TPEx requests are normalized before writing an
immutable hash-checked private cache outside this public repository. Company
directory responses are whitelisted to symbol/industry/exchange/listing date;
officers, contacts and all other fields are discarded in memory. Files are 0600,
directories 0700. No raw Production fixture or provider/company payload is added
to Git. Cache failures/duplicates/schema drift are explicit, never zero-filled.

| Final raw-price research coverage, ending 2026-10-07 | OHLC | Volume (shares) | Amount (TWD) |
|---|---:|---:|---:|
| 20 completed TW sessions | 72/72 | 72/72 | 72/72 |
| 60 completed TW sessions | 72/72 | 72/72 | 72/72 |
| 120 completed TW sessions | 72/72 | 72/72 | 72/72 |

All 8,640 symbol-session rows in the final 120-session window satisfy the current
calendar, date uniqueness, positive values and OHLC consistency. This is
**RETROSPECTIVE_PUBLIC_ACQUISITION**, with actual receipt timestamps on October8,
not evidence available at either previously locked October7/8 cutoff. Original
capsules remain 45 bars and are neither extended nor relabelled. A cache-only
repeat required zero network requests (549 cache hits), with unchanged coverage.

### Exact source reconciliation and adapter correction

- [TWSE stock history](https://www.twse.com.tw/zh/trading/historical/stock-day.html): daily stock/month API supplies shares and TWD.
- [TPEx individual history](https://www.tpex.org.tw/zh-tw/mainboard/trading/info/stock-pricing.html): rounded lots/thousands of TWD, explicitly **excluding block trades**. Multiplying by 1,000 does not restore precision or missing trades. It is retained for diagnosis only, never silently substituted into the final exact series.
- [TPEx stock quotes](https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html): exact shares/TWD including odd-lot, afterhours and block trades; one request/date serves all eleven in-scope TPEx stocks, filtered before caching. Date, schema and units are pinned; no fallback to the rounded monthly source.

Initial monthly-source comparison exposed 1,978 field differences across 22
date/symbol pairs, all TPEx volume/amount; OHLC matched. Switching the research
adapter to the exact all-trade daily source yielded **6,480 overlapping retained
bars / 144 date-symbol comparisons / zero field differences** across all six
OHLCV/amount fields. Original Fugle evidence was not changed. This is a fixed
research source-scope integration issue, not a Production Provider patch.
Both acquisition passes had zero 429, timeout, exhausted retry or missing-symbol
failures. Tests pin both unit/scoping contracts and reject wrong symbol/date,
duplicate rows, partial sessions, changed units and unavailable prices.

### Six missing peers: research expansion proposal, not a remap

The original thematic groups still contain only two other peers each. Current
exchange company classifications identify broader potential research pools:

| Symbols | Official industry code | Other listed/OTC ordinary symbols in that current industry |
|---|---|---:|
| 1590 / 2049 / 4566 | 05 | 100 |
| 2208 / 2634 | 15 | 33 |
| 8033 | 20 | 93 |

These public industry codes are **not equivalent** to the saved robotics or
defense/aerospace themes; current listing status is not historical tradability.
The private audit contains source-linked proposed peers and marks which are in
the72. Proposal: separately curate economically comparable research peers using
issuer business evidence, effective membership dates, same-cutoff candles and
suspension/tradability checks; compare the broader industry baseline alongside
the existing theme. Do not substitute it for the original required three peers,
change official Recommendation Universe, or backdate classification. Saved
sector coverage remains 66/72; six gaps are honestly unresolved.

### Corporate actions and adjustment safety

The same date range was checked against six official feeds: TWSE/TPEx ex-right,
capital reduction and par-value-change results. Relevant results: 60 TWSE plus8
TPEx ex-right events; zero in-scope reduction or par-value events in these queried
feeds/windows. All60 TWSE dividend detail records were additionally fetched;
TPEx exposes cash/bonus data directly. All68 events have sourced cash-per-share
values, eight have positive bonus-share allocations, one TWSE event has cash
subscription shares. Reference values, effective dates, receipt times and source
URLs are retained without applying an adjustment. Combined rights/dividend
value is never treated as cash; a price ratio is never invented as a split ratio.

Sources: [TWSE ex-right](https://www.twse.com.tw/zh/announcement/ex-right/twt49u.html),
[TWSE reduction](https://www.twse.com.tw/zh/announcement/reduction/twtauu.html),
[TWSE par value](https://www.twse.com.tw/zh/announcement/change/twtb8u.html),
[TPEx ex-right](https://www.tpex.org.tw/zh-tw/announce/market/ex/cal.html),
[TPEx reduction](https://www.tpex.org.tw/zh-tw/announce/market/reduction/reference.html),
[TPEx par value](https://www.tpex.org.tw/zh-tw/announce/market/change/reference.html).

This inventory is **not COMPLETE_ACTION_CLEARANCE**. A complete rights/demerger/
other-action feed, cash/payment/share-entitlement ledger, benchmark adjustment
and prelocked trigger/stop adjustment policy remain absent. Therefore adjusted
returns remain ineligible. No estimated factor or zero dividend fills the gap.
Existing paid Fugle action entitlement was not read or assumed; a new paid source
has not been shown necessary by this task.

### Historical shapes versus executable investment outcomes

An explicitly ex-post price-shape index finds crash/bounce, pullback/rise,
breakout continuation, false breakouts, gap failures and high-volatility windows
in these real public prices. It uses later bars **only to label the subsequent
shape**, not as model input or locked evidence. Search predicates are separate
diagnostic labels, not modified strategy thresholds. Windows carry known-action
or incomplete-action warnings. The index is not a backtest, has no returns or
win rate, and never writes a Prediction. Real as-of validation of those six
strategy/outcome scenarios remains **UNVERIFIED** without contemporaneous
fundamental/sector/event evidence and execution-order proof.

The two approved real retained replays still reproduce 432 decisions exactly:
READY0 / WAIT26 / AVOID370 / INSUFFICIENT36. They remain historical only.
Forward Sample0; observed Outcome Sample0. Outcome regression continues to
verify next legal session, no chase/gap invalidation, trigger expiry, suspension,
costs/slippage, 1/3/5/10/20 maturity, missing benchmark and ambiguous same-bar
stop/target. Daily OHLC never proves an actual fill or precise MFE/MAE/drawdown.
No Paper Trade or synthetic performance is generated.

Local commands (both environment paths must be private directories outside Git):

```sh
node --experimental-strip-types research/entry-history-acquire.mjs
node --experimental-strip-types research/entry-corporate-actions.mjs
node --experimental-strip-types research/entry-history-review.mjs
```

Use `MA_ENTRY_PRIVATE_FIXTURE_DIR` for the authorized existing minimized capsules
and `MA_ENTRY_HISTORY_CACHE_DIR` for private public-source cache/reports. Defaults
target the approved October8 study; acquisition is not a scheduled Producer.
No new Production release permission is requested for these local-only tools.

## Release manifest / current limits

Candidate only: one named Migration, one named new Function, two Owner UI files
and direct research/tests/CI/Integrity documentation. No Production writes,
no existing Forward mutation, no Methodology promotion, no Paper Trade creation.
New Owner policies are limited to the three new tables and reuse the current
Owner truth; they still require Sony's explicit Production Migration approval.
Real same-cutoff replay for the two authorized dates is complete. Neither date
proves a major crash reversal or subsequent profitable trend continuation.
Executable/adjustment-source lineage, broader scenario coverage and complete
outcome persistence/runtime verification remain required before the full
engineering program can honestly be called COMPLETE. No new candidate Product
Bug was demonstrated by these two real replays; no strategy threshold was
changed to force READY. No investment validity claim is authorized.

`ENTRY_INTELLIGENCE_ENGINEERING = INCOMPLETE`
`ENTRY_INTELLIGENCE_ANALYSIS_VALUE = INSUFFICIENT_SAMPLE`
`SONY_USABILITY = PENDING`
`PUBLIC_PRODUCT_APPROVAL = NO`
