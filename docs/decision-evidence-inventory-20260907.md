# Decision V1 — real data inventory and availability boundary

Audit: 2026-09-07, Production project TWMarketAI `cttfzgvhiewfckydcrci`.
Read-only PostgreSQL catalog/count/as-of queries, repository provider contracts,
and deployed get-report-payload source. No provider invocation or Production write.

## Actual datasets (availability, not theoretical API capability)

| Source / canonical table | Actual Production inventory | Used fields / limitation |
|---|---|---|
| Fugle / Fugle futures / Finnhub → market_quotes | 625 rows; 11 trading dates 2026-08-24–09-07 | provider, symbol, trading_date, phase, value, change_percent, captured_at, ingested_at, freshness_status, quality_status, raw_payload |
| market_data_snapshots | 1,745 rows; 52 dates | Checkpoint price points, NOT 52 daily OHLCV bars. Core producer unchanged. Not a substitute for full stock history |
| market_checkpoint_snapshots | Existing immutable evidence contract | Left untouched; this reader makes no retention or natural Acceptance claim |
| Fugle stock quotes | 14 TW stocks; 2330 has 11 dates, most others 1–4 | Latest audited raw quote has current/change/change_percent but no retained volume/OHLC. Do not infer volume |
| Fugle market/futures | TAIEX/TXF over 11 dates | Actual values available by timestamp; do not use later close for a premarket revision |
| Finnhub overseas | SPX, IXIC, SOX, VIX, DXY, US10Y; NVDA, TSM | Existing actual symbols only. No persisted US equity-index futures dataset found |
| institutional_flows | **0 rows** | buy/sell/net, institution_type, symbol, currency, source_ref, captured_at. Canonical schema exists; no current producer-populated data or verified enum samples |
| earnings_events | **0 rows** | fiscal_period, revenue/EPS actual and consensus, guidance_direction, announced_at, source_ref. No actual fundamentals/earnings history to score |
| news_events | 91 rows / 22 publication dates | title, source_name, source_url, published_at, created_at. AI symbols/sectors not proof of beneficiary transmission |
| news_event_tags | 488 rows | AI classifications/scores; explicitly not numerical Decision evidence |
| research_catalysts | **0 rows** | source_refs/event_at/status supported by schema, not a populated company event feed |
| catalyst_tw_mappings | **0 rows** | source_refs, transmission, company, confirmation/invalidation. No observed fundamental mapping exists |
| sector_stock_map | 72 active symbols | Real bounded universe. Point-in-time updated_at/created_at guard; no historical membership ledger is assumed |
| sector_rotation_scores | Existing AI-derived index | Not used as measured market breadth, institutional flow, or confidence |
| model_evaluations | 32 rows / 11 period ends; sample_size 0–8 | CLE_EVALUATION_V1 evaluates a different target. No directional OOS calibration artifact |
| TWSE / TPEx | Existing official/fallback sources in repo | No populated standalone company-valuation, monthly-revenue, breadth or full OHLCV table found. Not invented |

Provider documentation supports capabilities, **not proof of purchased entitlement or
ingested history**: [Fugle historical candles](https://developer.fugle.tw/docs/data/http-api/historical/candles/),
[Fugle intraday API](https://developer.fugle.tw/),
[TWSE PE/PB](https://www.twse.com.tw/zh/trading/historical/bwibbu-day.html),
[TWSE institutional data](https://www.twse.com.tw/IIH2/zh/company/investors.html).
No new subscription, endpoint call, service or dataset purchase was made.

## Source → factor → contribution → provenance

All consumed numeric values reject null/undefined/blank/non-finite input. Financial
numeric strings are parsed only after the original value's presence is validated.

| Factor | Actual source / timestamp | Freshness / normalization / contribution |
|---|---|---|
| Direction pressure | Five fixed market_quotes symbols; captured_at + ingested_at | Taiwan ≤20h, overseas ≤80h at revision cutoff; mean((tanh(change_percent/2)+1)/2). Quality index, never probability |
| Regime | Same TAIEX/TXF changes | Both ≤−3% → RISK_OFF; absolute index change ≥3% → HIGH_VOLATILITY; otherwise directional pressure trend/range |
| Risk | TAIEX/TXF | mean(min(abs(change_percent)/5,1)); inverse contribution to entry |
| Price position | 20 unique phase=close dates | Current position in 20 closing-price range, not intraday high/low or RSI; inverse entry contribution |
| Breadth | Complete 72-stock active-universe fresh quotes | advancing / covered universe; no partial set or index proxy; **not exchange-wide breadth** |
| Institutions | Three same-date/currency institutional_flows | (net / gross +1)/2, buy−sell must reconcile to net. Accepted explicit labels foreign/investment_trust/dealer are a read contract; current empty Production table does not validate a producer enum |
| Catalyst | news_events actual source URL / published_at / created_at | Previous Taipei day 16:00 through revision cutoff; identical syndicated headline dedup; availability score only, not bullishness |
| Company/fundamental | Four consecutive earnings_events quarters + canonical source-linked mapping | Latest ≤120d, four-quarter range ≤550d; reported revenue/EPS vs sourced consensus and guidance, not LLM assertion |
| Priced-in | Six pre-event closing bars, actual later quote, benchmark alignment, volume, two sector peers | pre/post/relative return + volume ratio + 20-close price position + sector reaction; all component values and row IDs saved; no sentiment substitute |
| Evidence quality | Availability map | present factors / all factors. Absence is measured as lack of coverage, never a synthetic market observation |
| Model confidence | coverage + freshness + independent-source coverage + directional sign agreement + calibration evidence | Equal mean quality coverage. No independent source/calibration evidence contributes zero coverage and remains labelled unavailable; no market evidence → null |
| Valuation | None persisted | UNAVAILABLE; no PE/PB/fair-value inference from news or price |
| Calibration | No valid directional artifact | INSUFFICIENT_HISTORY; probability always null even if a CLE row has high accuracy/sample_count |

Every Evidence record retains table, row_id, source, observed_at, available_at,
fields, age, report_date and revision_id. Every Score retains numerical inputs,
version, equation and evidence_ids. Read-model assessment_id is SHA-256 of the
unprojected output, shared across server entitlement projections. A changed read
is detectable; **this is not an immutable Decision ledger**.

## Observed 2026-09-07 premarket replay

- Canonical PREMARKET revision `7dd500ca-ea8b-40e8-8576-547ddacf7483`, generated
  `2026-09-06T23:35:13.775Z` (Taipei 07:35), published action STOP, status PARTIAL.
- Point-in-time SQL selected 593 quotes, 9 news, 72 universe rows, 30 CLE evaluations;
  flows/earnings/catalysts/company mappings all zero. All observations and first
  availability were bounded by that revision, so later 09:30/close data is excluded.
- One unique sourced fresh macro news item after syndicated-headline dedup. Its
  source URL and published_at are retained; company/sector benefit and fundamental
  impact remain **UNAVAILABLE**, not the AI tag's assumed 12 beneficiaries.
- 72 evaluated-universe identities, zero complete company assessments, 72 explicit
  rejected/missing datasets; stock_opportunities=0; action=INSUFFICIENT_DATA.
- Probability=null; entry=null. Deterministic confidence=13.1/100 is an explicit
  coverage index with inputs 0.1 completeness, 0.3551605 freshness, 0 independent
  source coverage, 0.2 sign agreement, 0 calibration evidence. It is not a forecast.
- Conservative Taiwan freshness rejects Friday quotes at Monday 07:35; that is an
  explicit calendar/session data gap, not permission to replace source timestamps.
- No finding changes or upgrades 9/7 natural Core FAIL/Acceptance records.

## Exact missing data and history required

1. **Full allowed-universe daily prices and volumes**: at least 20 complete trading
   sessions per each of 72 stocks and TAIEX; raw history currently 11 dates, most
   stocks only 1–4, and volume/OHLC absent from stored latest provider quote.
   Intraday/post-event price+volume and at least six pre-event closes are needed
   for priced-in; no post-event market observation → no reaction claim.
2. **Institutional flows**: three institutions, stock and market aggregate, source
   time, consistent units/currency; current date or last valid session explicitly
   mapped by a future approved provider/calendar contract. Currently 0 rows.
3. **Financial reports**: four consecutive quarters per stock with sourced actual
   revenue/EPS, consensus and guidance, newest within 120 days. Currently 0 rows.
   Monthly revenue/valuation/balance-sheet dataset is also absent; do not claim a
   complete intrinsic-value or balance-sheet evaluation.
4. **Company event lineage**: verified news/filing linked through catalyst mapping
   to company and that filing's source; source-specific confirmation/invalidation.
   Current mapping rows 0. Existing generic AI classification is insufficient.
5. **Breadth and sector reaction**: complete same-session universe quote coverage
   and at least two sector peers; current 14-stock sporadic coverage is not enough.
6. **Calibration**: current 11 trading dates and 0–8 CLE samples are inadequate and
   wrong-target. Future study should pre-register horizons/labels, retain ≥252
   trading days of features and ≥200 independent, strictly out-of-sample labelled
   observations across regimes (more if correlated). These are planning floors,
   not proof of calibration; evaluate confidence intervals, Brier/calibration error
   and leakage before any probability display. No arbitrary day-count enables it.

## Deployed / repository drift and release boundary

Production get-report-payload v42 bundle SHA:
`4fb67826dedbdfa0d3e518507828e7c1e3fffef163fa457136b921b26161eb71`.
Read-only source extract SHA:
`ed31ee987d4f719bb769da3ae0c6aaaf98cfabb587f4dd5a2e52f2d6ed4fdc12`.
Pre-work branch reader SHA:
`6c52774017e780a27b12950dfc314f29aaefc855b90789fc2f99ee425973fcc5`.
Differences are the previous Core canonical Admin projection, snapshot-sourced
identity/confidence, sentence consistency and bounded published-revision re-read.
All are preserved byte-for-byte outside this newly approved additive read block.

Actual dependency changes: `get-report-payload/index.ts` plus
`_shared/decision-v1-data.ts`, `_shared/decision-v1-evidence.ts`. Type-only contract
import is erased when bundled (verified local Deno bundle); frontend never imports
Edge runtime code. No other Function, Migration, Cron or Publication file changed.
Frontend decodes final scores only. Legacy fixture evaluator is test-only.

Rollback for a future separately approved release: restore the saved prior reader
bundle and prior frontend build together. No data rollback is needed because this
candidate only reads; **no release/rollback was executed in this task**.

## Verification status

The new real-shape regression matrix covers stale news, missing institutions,
conflicts, no-chase, intact/damaged selloff, no fake scores, no lookahead, query
failure/truncation, independent entitlement projection, complete-empty screening,
and repeatable assessment identity. Real-shaped fixtures are synthetic, clearly
labelled; they are not evidence of paid-provider availability.

Actual isolated Supabase HTTP: 200, free payload, no QUERY_FAILED, matching revision
and decision-evidence-v1 output. Existing local market/news rows flow into it.
Browser: true local GoTrue PKCE and server admin entitlement; 6 routes × 4 sizes
(375/390/430/1440), 24 responsive checks; 0 console errors/warnings, 0 Production
requests, 14 returned Decision payloads sharing one revision/assessment hash,
reload and glossary PASS. Synthetic local credentials/market data only; no copied
Production Owner session. Production read-only market replay is separate evidence.

Final local validation: TypeScript exit 0; ESLint exit 0 / no warnings;
Vite build exit 0 (208 modules, 1.41s); Node 398/398; Deno evidence 23/23;
existing Core Deno regressions 50/50; reader Deno check and both new modules'
Deno lint exit 0; git diff --check PASS. The isolated browser was rerun after
the final reader behavior change and again passed all 24 viewport checks.
CI for the resulting commit is recorded in the task final report and PR comment.
Do not count fixture/browser success as a complete real stock opportunity pipeline.

`PRODUCT_CANDIDATE_READY = NO` until these real dataset gaps and the independent
natural Core/Production release gates are satisfied. No new service purchase.
