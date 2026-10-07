# Recommendation Hard-Gate Closure — candidate, 2026-10-07

## Status and safety

Base: `82600edeef0fbc37fbfa64c939ade72315458e1b` (merged PR200).
This change is a candidate, not a release. No Production invocation, write,
deployment, migration, Cron, credential extraction, Auth/RLS change, formal
threshold change or methodology promotion is performed. Existing V1 source is
byte-identical. Tests use synthetic transports or the already sealed, sanitized
retained evidence capsule; neither is called live acquisition.

New deployable candidate: `recommendation-stock-evidence-smoke-v1` only.
Official-event integration and V2 research comparison have NO Production handler
import. V2 has no network/DB/UI entry and is only run in the local Owner-authorized
research workflow. It does not create a second Owner authorization scheme.

## Exact required-gate origin

Git `ce3ff722c7247e1949b4740b20d2ccb96b1c77cf` (2026-09-07,
`feat(decision): connect canonical payload to real evidence`) introduced the
read model/evaluator and tests. The Git author is the repository owner account;
that is authorship metadata, NOT proof Sony explicitly specified every numeric
predicate. Product requirements demand institutional/fundamental/company-event
reasoning. The inspected requirements do not specify that a normalized flow
ratio must be TWD, or that each of four quarters must beat BOTH consensus series.
Those precise rules are repository V1 policy, not measured profitability facts.

Sources:

- `docs/product-contract-v1.md`: prospective, uncalibrated V1 methodology;
  entry factor mean and equal-weight opportunity model, source-linked catalyst,
  four-quarter actual/consensus agreement, guidance not reduced.
- `docs/decision-evidence-inventory-20260907.md`: already recorded all four
  relevant tables as zero and explicitly did not claim Product Candidate Ready.
- `supabase/functions/_shared/decision-v1-data.ts`: the eight audited read paths.
- `supabase/functions/_shared/decision-v1-evidence.ts`: `flowsFor`,
  `fundamentals`, catalyst mapping/event alignment, phase reasons, entry factors.
- `tests/decisionEvidencePipeline.test.mjs`,
  `tests/fixtures/decision-evidence-rows.mjs`: positive tests contain explicitly
  synthetic complete flows/consensus/mappings, not actual supplier deliveries.
- `tests/recommendationRetainedReplay.test.mjs`: retained real inputs fail closed.
- `docs/10k-program/recommendation-phase-candidate.md`: PR199 preserved these
  gates while changing only phase semantics; PR200 added price/volume/actuals,
  not producers for these three gates.

## Production evidence audit (read-only)

2026-10-07 aggregate queries, no raw response/PII/secret exported:

| Production table | retained rows | nonzero rows | first available | last available | inserts / updates / deletes in current PG stats |
|---|---:|---:|---|---|---|
| institutional_flows | 0 | 0 | null | null | 0 / 0 / 0 |
| earnings_events | 0 | 0 | null | null | 0 / 0 / 0 |
| research_catalysts | 0 | 0 | null | null | 0 / 0 / 0 |
| catalyst_tw_mappings | 0 | 0 | null | null | 0 / 0 / 0 |

Database stats-reset timestamp observed: 2026-05-07T18:19:10.020686Z.
PG stats are not an immutable all-history audit ledger (per-table resets are
possible); do not use these alone to prove no row ever existed. Combined with
the September inventory, Git history, current readers, deployed Function
inventory and absence of public SQL writer routines, there is no observed
Production producer or historical delivered record for these required inputs.
`EVER_PRODUCED_IN_PRODUCTION = NO` means no evidence of delivery in the audited
retained history, NOT a claim about inaccessible/deleted external history.

Repository write-path search found readers but no writer for these four tables.
Production public `pg_proc` definition search for the four table names returned
no routines. Deployed inventory has stock price/actual acquisition and global
news functions, not these required-data producers. Historical Git
`568694f92072d049e35cd2d8fd148db6d3547154` is NOT an exception: its institutional
data importer writes `/tmp` research SQLite and asserts
`researchUseOnly=true, productionImported=false`. It does not feed the public
Production `institutional_flows` table.

`news_events` has 231 retained rows, first creation
2026-08-23T23:00:12.066549Z, last 2026-09-30T23:15:04.223786Z. News existing
somewhere is not evidence of a current, company-linked Catalyst producer.

## Gate-by-gate findings

### Institutional — METHODOLOGY_OVERCONSTRAINED

V1 requires exactly foreign/trust/dealer, one row each, same expected completed
session and symbol, available by cutoff, valid sources, finite nonnegative
buy/sell, consistent net, currency TWD, positive gross. The actual factor is
`(sum(net) / sum(buy + sell) + 1) / 2`; stock confirmation requires >0.5.
It protects against recommending without independent institutional direction.
There is no absolute TWD buying-size threshold in this factor.

PRODUCER_EXISTS=NO; PRODUCTION_SOURCE=none wired to required TWD contract;
EVER_PRODUCED_IN_PRODUCTION=NO (audit definition above); count=0; first/last=null.
Therefore its current pipeline also has `UNSATISFIABLE_REQUIRED_EVIDENCE` status.

[Fugle official institutional-trades contract](https://developer.fugle.tw/docs/data/http-api/ownership/institutional-trades/)
provides shares, not TWD. Same-stock share net/gross can measure a versioned
direction/pressure hypothesis without currency fabrication. It is NOT exact
TWD-weighted equivalence, cannot be aggregated across differently priced stocks
as market money flow, and does not satisfy V1 as written. V2 retains SHARES
units. TAIEX market-level TWD requirement is NOT bypassed by stock shares.
Missing provider dates are not observed zero; combined dealer data must not
double-count dealer components. Current account entitlement is unproven; no
paid API was called or bought during this audit.

### Consensus — REQUIRED_CORE_BUT_NO_PRODUCER

V1 requires four consecutive quarters, recent latest quarter, actual AND
consensus revenue/EPS, latest guidance up/stable/down, source/availability.
All four quarters beating both expectations plus no reduced guidance means
`intact`. Reduced guidance or BOTH latest misses means `damaged`.
Complete mixed beats/misses can be neither and currently receive a missing
fundamental-evidence reason. This is an over-strict evidence/state-design
finding, not proof of a missing quote and not silently patched in V1.

Purpose: earnings agreement/surprise relative to expectations, used in damage,
mispricing and opportunity calculations. This is not valuation estimation.
PRODUCER_EXISTS=NO; PRODUCTION_SOURCE=none for point-in-time consensus/guidance;
EVER_PRODUCED_IN_PRODUCTION=NO; count=0; first/last=null.
Status: `UNSATISFIABLE_REQUIRED_EVIDENCE`.

TWSE/TPEx actuals exist and PR200 acquired company/current monthly revenue/EPS
metadata (not consensus). Actual growth/YoY/EPS trend answers a DIFFERENT
question. It cannot establish earnings surprise. V2 uses a new actual-growth
hypothesis with five consecutive known-unit quarters, cutoff/availability and
source checks. Current latest-only actual endpoints do not prove that full
history. Historical provider coverage/licensing must be verified before use.
No claim a new paid provider is definitely necessary; none is purchased.

### Company Catalyst — INTEGRATION_GAP

V1 requires source-linked current news -> catalyst -> company mapping,
transmission/supply-chain/invalidation text, link to the latest fundamental
source, six pre-event bars and event-aligned price/volume/benchmark/sector.
Purpose: do not chase a company without a sourced causal hypothesis; a market
headline alone is not a company benefit. Coupling the mapping to the consensus
fundamental's latest source also propagates the consensus gap into this gate.

PRODUCER_EXISTS=NO; PRODUCTION_SOURCE=global news only, no required company
catalyst/mapping producer; EVER_PRODUCED_IN_PRODUCTION=NO; count=0;
first/last=null. Current pipeline status: `UNSATISFIABLE_REQUIRED_EVIDENCE`.

Public source checks on 2026-10-07:

- [TWSE official API](https://openapi.twse.com.tw/), documented
  `/v1/opendata/t187ap04_L`: HTTP200,54 rows, company/date/time/subject fields.
- [TPEx official API](https://www.tpex.org.tw/openapi/), documented
  `/openapi/v1/mopsfin_t187ap04_O`: HTTP200,29 rows, company/date/time/subject.

These prove an accessible official event FACT source, not a positive event for
all72 stocks. Candidate adapter preserves source/hash/publication/receipt,
deduplicates and rejects invalid/future times. It drops free text/contact
fields and records bullishness=null, impact_review=REQUIRED. No automatic
positive mapping, fake supply-chain transmission or historical backfill.

The candidate adapter itself was also run against both public endpoints:
TWSE HTTP200/PASS,9 events for8 of the72 symbols; TPEx HTTP200/PASS,0 events
within the72. Only aggregate counts were reported; raw_retained=false and
bullish_inference=false for both. This is a live public-source format check,
not a Fugle entitlement test or a Production Recommendation result.

## Counts (different denominators, not summed as exclusive categories)

- Exactly one final class per gate: Institutional METHODOLOGY_OVERCONSTRAINED;
  Consensus REQUIRED_CORE_BUT_NO_PRODUCER; Catalyst INTEGRATION_GAP.
- Current required gates with no observed Production producer: **3/3**.
- Sourced company-event integration gap established with live public200: **1**.
- Exact V1 requirements fully produced/satisfied in Production: **0/3**.
- Independently meaningful evidence purposes: all3; source-feasible event fact
  is1, alternative stock-share direction is1 with entitlement unproven. Neither
  is proof the complete original V1 gate is currently satisfied.
- New acquisition/integration required for all3. A new provider/source for the
  exact expectations question remains1 unresolved data-source requirement;
  paid-provider necessity remains **NOT PROVEN**.

## V2 comparison: conservative, explicit scope

`research/recommendation-v2-shadow.ts` calls the UNCHANGED V1 evaluator with the
original data. Both versions consume the same hashed bundle, with alternatives
kept in distinct shares/actuals/official-event fields (never relabeled TWD or
consensus). The V2 result is a research-observation candidate, not formal
Recommendation output, not V1's entry WATCH and never `READY`.

Real retained 2026-10-06 bundle: **V1 BLOCKED72/72, V2 BLOCKED72/72**. Still lacks
real quote histories, shares/actual-history/company events; no synthetic fill.
Explicitly synthetic same-input controls: V1 BLOCKED; V2 research WATCH when
alternative observations and unchanged market/price/sector safety prerequisites
are complete; V2 NONE when observed pressure/growth rejects; V2 BLOCKED for
missing/stale/future/duplicate/unit-conflict/source failures. No performance
inference. Forward sample0, calibration INSUFFICIENT_SAMPLE.

Event price reaction / reviewed company transmission / prospective entry are
NOT implemented as an alternative actionable score. Research WATCH expressly
keeps entry_evaluation=NOT_RUN and ready_candidate=false. A subsequent reviewed
methodology and Forward study is required; this candidate does not use a
successful synthetic WATCH as permission to publish recommendations.

## Runtime caller and actual live-smoke boundary

The new caller reuses `authorizeInternalRequest` without changing its validator;
JWT gateway remains default ON. Owner/member JWT does not equal an internal
worker. Incoming Origin is rejected, no CORS, fixed target/project, strict date,
mode and correlation fields. It reads CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY
only inside Edge Runtime and uses the existing target's separate JWT gateway
and internal-token headers. No alternate secret guesses.

SMOKE_2330 calls exactly one stock. BOUNDED_72 first performs a NEW successful
2330 validation in the same request; never trusts an external prior-pass flag.
Maximum2 target invocations,55s total,26s each; target preserves6-way bounded
provider acquisition, max3 retries/task and its22s bound. Counts are recomputed
from exact symbol/endpoint sets and validated available/source/session times,
consecutive20-day OHLC/volume/amount and existing phase freshness rules.
Target responses are size-bounded; only coverage/status metadata is returned.

IMPORTANT: this wrapper does not magically solve its own inbound authentication.
The current tool context has no approved server-runtime execution primitive
that can invoke it using a runtime-held identity. Existing natural report
handler has that identity, but manually calling it would risk report writes,
and changing/deploying it is outside this scope. No DB/Vault identity is assumed
equivalent. No startup self-invocation or anonymous management-token bypass.

Thus Production2330 and72 coverage remain **NOT_EXECUTED**, not PASS. Candidate
deployment plus a reviewed existing authenticated runtime caller is a release
prerequisite. If that needs changing another Function/Auth/Cron/Secret, obtain
named scope approval, not a workaround. This PR creates no such trigger.

## Verification and release scope

Affected transport/auth/session/official-event/V2/retained-replay tests, Deno,
type-check, lint, build, Fresh isolated DB regression and exact Integrity seal.
GitHub required Release gates run on the immutable candidate commit.
No need to rerun unrelated47/1000 Chaos. No migration, Cron, new Secret, RLS,
formal Decision/Recommendation/Report/LINE modification. Business diff from
this task=0 because no Production mutation/Function invocation is performed;
not a claim about unrelated naturally scheduled concurrent activity.

Conclusion: current0 recommendations are structurally blocked by required
evidence without a Production producer. The available evidence cannot establish
that the market has no qualified opportunities. Price acquisition alone will
not close these three gates, and V2 cannot honestly claim READY without new,
traceable data and prospective validation.
