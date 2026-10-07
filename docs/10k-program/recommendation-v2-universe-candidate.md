# TRADEABLE_TW_UNIVERSE — audit candidate only

Read-only audit at **2026-10-07T13:49:12.680Z**. Production remains
`RESEARCH_UNIVERSE_72`; no subscriptions, stock additions or paid calls made.
Reproduce with `node --experimental-strip-types scripts/audit-v2-universe.mjs`.
Source bodies are not persisted; the script emits aggregate metadata only.

| Official source | Profile rows | Four-digit company candidates | Quote joined | Positive close | Industry present | One-day amount ≥ TWD50m |
|---|---:|---:|---:|---:|---:|---:|
| TWSE | 1,095 | 1,089 | 1,087 | 1,087 | 1,089 | 423 |
| TPEx | 893 | 893 | 887 | 873 | 893 | 199 |
| Total | 1,988 | 1,982 | 1,974 | 1,960 | 1,982 | 622 |

Zero duplicate symbols. Existing 72 all appear in the official company list and
quote join. The TWSE quote date was **2026-10-06**; TPEx **2026-10-07**.
These are **not one common as-of session** and cannot support a combined live
evaluation. A join or positive close is not verified freshness, tradability or
20-day coverage. The 622 figure is only a single-day liquidity proxy, not the
frozen V2 20-session liquidity test.

Sources (all HTTP200 during this audit):

- [TWSE company profiles](https://openapi.twse.com.tw/v1/opendata/t187ap03_L)
- [TWSE daily quotes](https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL)
- [TPEx company profiles](https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O)
- [TPEx daily quotes](https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes)

## Admission/exclusion contract for a future candidate

Company-profile intersection only: exclude warrants, ETFs, ETNs, preferred
shares, emerging-market listings and other non-common-stock products. Four
digits is only an initial filter, **not proof of ordinary-share classification**.
Require an authoritative instrument type and active listing; exclude suspended,
delisted, special-treatment or non-tradable instruments until their contracts
are explicitly covered. IPOs with fewer than 20 complete sessions are unavailable,
not zero-filled. A company industry code still requires a reviewed canonical
sector mapping and enough peers; the current 72 mappings cannot be extrapolated.

Before expansion, every admitted stock must have all 20 completed OHLC/volume/
TWD-amount sessions, phase-valid current quote, compatible benchmark, actual
institutional shares, fundamentals and source-traceable events under unchanged
V2 rules. This expanded history/acquisition has **not** been executed. Coverage
for those requirements is therefore **UNMEASURED**, not 1,982/1,982.

## Capacity and cost

The [official Fugle plan table](https://developer.fugle.tw/docs/pricing/), checked
2026-10-07 (page updated Sep30), caps stock historical requests at **60/minute**
across the listed personal tiers. Intraday limits differ (60/600/2,000 per minute).
Developer list price is TWD1,499/month or14,990/year; advanced2,999/month or29,990/year.
These are public plan prices, **not Sony's verified invoice/entitlements**.
No purchase is proposed or made; the audit uses existing public official sources.

At the candidate's conservative single 1.2-second acquisition permit:

- 72 history requests: ~86 seconds of pacing, excluding responses/retries.
- 1,982 history requests: ~2,378 seconds (**39.6 minutes**) before retries.
- History + intraday quote for 1,982: ~4,757 seconds (**79.3 minutes**), before
  sources and retries. The historical quota alone implies at least33 minutes.

These are explicit lower-bound estimates, **not measured full-universe runtime**.
A single current Edge request cannot safely perform this expansion. It would
need separately reviewed durable chunking, quota coordination with the formal
producer, persisted shared completed-session evidence and fault/catch-up proofs.
Buying the higher personal tier does not remove the historical60/minute limit.
Additional provider cost is **not proven necessary**; first validate batching,
coverage and data-use rights under the existing plan. Live universe stays72.
