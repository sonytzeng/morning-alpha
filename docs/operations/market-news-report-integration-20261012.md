# Market News Report Integration P0 — 2026-10-12

Candidate only, based on main `fff51d76a8e6c90768772023c37afbb112761a3a`.
Separate branch; the VNext PR230 branch is untouched. No Production mutation,
report regeneration, LINE invocation, migration, secret or schedule change.

## Exact observed path

The read-only deployed-source audit confirmed `fetch-global-market-news` V63
and `generate-daily-report-v7` V248 entrypoints match main byte-for-byte.
The reporter reads `news_events`, requires matching `news_event_tags`, maps
the canonical source/URL/title/transmission, then applies the unchanged
`filterPremiumNewsEvidence`. Only verified news enters the Evidence Index.
The zero-index result is downstream of rejection, not a missing index producer.

| Stage | Observed result / population |
| --- | --- |
| Provider batch | HTTP 200; 188 observations after provider-local processing |
| Existing normalized-title + source dedup | 188; not proof of 188 distinct events |
| Blacklist | 2 observations; independent of final Report policy |
| Retained raw rows | 80; the other 108 were not preserved |
| Retained freshness | 8 within 48h; 72 older than 48h |
| Full 188 freshness/relevance/quality funnel | UNKNOWN; not historically retained |
| Canonical requested/upserted | 2 / 2; both have catalyst tags |
| Canonical freshness at actual Report read | 2 / 2 |
| Canonical direct-market relevance | 0 / 2 |
| Canonical independent quality | 0 / 2; both fail `taiwan_market_relevance_unproven` |
| Report Evidence Index news | 0 |
| Report accepted | 0, measured from `important_news_json` |
| NEWS_CONTEXT | UNAVAILABLE; Report remains DEGRADED_PUBLISHED |

Database-side predicates were derived from the exact unchanged deployed
premium-evidence regexes (JavaScript word boundaries translated to PostgreSQL
word boundaries). Only booleans, counts, timestamps and fingerprints left the
database. No news prose, full report or credential was exported. This is a
retained-predicate audit, NOT a restored raw-provider replay. The eight retained
fresh records contain two direct-market titles without a decision catalyst;
the other six lack a direct-market title anchor. None passes all existing gates.

The two canonical rows pass source, URL, title length, freshness, transmission
and catalyst predicates; both fail direct-market relevance. Their immutable
diagnostic fingerprints and predicate outcomes are in
`tests/fixtures/market-news-integration-20261012.json`.

## Classification (do not conflate missing telemetry with zero)

- SOURCE_EMPTY: ruled out for this combined batch (188); individual source
  empty counts UNKNOWN.
- FETCH_FAILED: combined acquisition succeeded. Individual source failures
  UNKNOWN in the counters-only persisted observation.
- FRESHNESS_REJECTED: 72 of 80 retained rows. Full batch count UNKNOWN.
- RELEVANCE_REJECTED: both fresh canonical rows fail the unchanged direct-market
  predicate. This is the exact observed reason for Report Accepted = 0.
- QUALITY_REJECTED: no canonical row passes total quality; not a separate claim
  that the source, URL or directional-catalyst predicates failed.
- EVIDENCE_INDEX_MISSING: not demonstrated; no eligible canonical row exists
  that should have entered the index. Both events had tags before the reader.
- REPORT_READER_MISMATCH: not demonstrated for this run. The actual reader
  and pinned revision use the canonical path; the report records the specific
  `market_news:no_verified_relevant_items` branch, not an empty query branch.
- INTEGRATION_FAILED: no failed canonical write in this run. Two independent
  engineering defects are retention ordering and incomplete rejection telemetry.

## Cutoff, weekends and preservation

Asia/Taipei 10/12 is a trading day after the 10/9 holiday/weekend. News keeps
the existing absolute 48-hour limit; there is no weekend freshness extension.
Original publications are 10/10 12:18:00 and 22:03:09 Taipei. Canonical first
creation is 10/12 07:00:11.793721, before Report generation at 07:05:04.368563
and publication at 07:06:49.528704. Raw `market_news.created_at` is overwritten
by its existing upsert, so it is a last observation, not proven first-seen time.

At a **strict 07:00:00 cutoff, available news = 0**. The deployed lifecycle
starts acquisition at 07:00 and generation at 07:05; it cannot prove acquisition
before 07:00. This candidate does not change that schedule or relabel cutoff
times. Any requirement for pre-07:00 acquisition requires a separate explicit
schedule decision. No later news is used to repair the historical report.

## Minimal candidate and what it does NOT claim

1. Retain current articles before stale high-scoring audit rows under the
   existing 80-row cap; preserve score order inside the freshness buckets.
   Keep the existing scoring/classification functions and selected cap of 12.
   Invalid/future/stale items cannot be selected. This fixes a reproducible
   retention-starvation defect; discarded 10/12 rows cannot be reconstructed,
   so it is NOT claimed to explain all 108 omitted observations or create a
   qualified 10/12 article.
2. Preserve a counters-only sequential funnel: invalid records/timestamps,
   duplicates, blacklist, freshness, unchanged producer selection, retention
   caps, canonical request count, and unchanged Report-policy preflight.
3. Sanitize that funnel into the existing optional-news pipeline observation.
   Preflight is explicitly `CANONICAL_REQUESTED_NOT_REPORT_ACCEPTED`;
   `evidence_index` and `report_accepted` remain null in the producer receipt.
   Canonical write success, tags and actual Report acceptance remain separately
   verified. No provider prose or arbitrary error key is retained.

No modification to Report reader, prompts, market direction, recommendation,
LINE, Atomic, news quality regexes, minimum scores or provider acquisition APIs.
The original quality rejection is preserved. Completing this engineering
candidate does not prove a future FULL report or availability of qualifying
news. No need for a new paid source has been established.

## Validation evidence

- Real 10/12 retained predicate counts and chronological evidence: 0 accepted
  remains 0; full discarded observations explicitly UNKNOWN.
- Network-denied actual producer handler: original Auth and provider parser,
  dedup, timestamp controls, stale/fresh cap regression, local writes and
  telemetry forwarding. Inputs are explicitly synthetic negative/positive
  controls, never claimed as real reporting success.
- Unchanged actual Report reader with tag/freshness/relevance rejection controls.
- Byte parity of Report, LINE, Atomic, Recommendation, all news scoring/provider
  functions and quality policy; strict new transition gate before all previous
  immutable integrity gates (no old seal rewritten).
- The complete release workflow timeout is 45 minutes (previously 20). The
  immutable predecessor chain and isolated database replay are retained in full;
  no check, assertion or acceptance condition is removed. This is CI capacity,
  not a Production timeout or schedule change.
- The original fresh-DB TXF replay hit `PREMARKET_READINESS_DEADLINE_EXCEEDED`
  when the real CI clock crossed 10/12 08:45. Three existing fixed-date session
  replays now use the existing network-none clock-pinned PostgreSQL image at
  10/12 08:35 Taipei through a test-only psql transport. All production SQL,
  row contracts, ACL checks and negative assertions remain byte-identical.

## Exact release manifest — NOT AUTHORIZED TO EXECUTE

Candidate functions, in a separately approved release:

- `fetch-global-market-news`: retention order + additive telemetry only.
- `daily-delivery-orchestrator`: its entrypoint is unchanged; rebundle the
  amended `_shared/market-news-acquisition.ts` for counters-only persistence.
- New `_shared/market-news-retention.ts`; unchanged transitive policy dependencies
  `premium-evidence.ts`, `us-cash-session-calendar.ts`, `market-calendar-data.json`
  and any imports required by that unchanged calendar are bundled, not modified.

Migration: NONE. Cron / Secrets / Auth / RLS / quality thresholds: NO CHANGE.
`generate-daily-report-v7`, LINE and other Functions: DO NOT DEPLOY.
Rollback: exact prior deployed V63 news and V43 orchestrator bundles; retain
existing custom authentication, configuration and all historical rows. Never
rerun historical reports or LINE to test either version.

After separately authorized deployment, use no-send checks, then an actual
future natural slot. Require saved full-batch counters, publication/availability
times, canonical write/tag success, actual independent Report acceptance and
NEWS_CONTEXT. Capture success alone is never FULL. Until then:
`NATURAL_REPORT_FULL = PENDING` (10/12 remains DEGRADED).
