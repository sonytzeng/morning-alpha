# Market News Persistent Degradation — 2026-10-08

## Evidence and exact root cause

Read-only Production audit, project cttfzgvhiewfckydcrci. Twenty TW sessions are taken from the deployed market_calendar_session_v1 function through 2026-10-08 (not calendar weekdays). 9/28 is not part of this audit. No Production mutations or live provider invocation were performed.

Deployed daily-delivery-orchestrator V42 and fetch-global-market-news V62 match the base source byte-for-byte, including the Atomic gate. Base: 8500f0ec050cff4f948c43ae9e6236aa4d2a58ea.

Root: INTEGRATION_FAILED / NEWS_PRODUCER_STARVATION. The refresh plan originally includes refresh_news, but gatePremarketActionsOnAtomicEvidence replaces the entire plan with refresh_market while the morning Atomic batch is absent. Generate-phase filtering also excludes news. Once a DEGRADED report is legitimately publishable, subsequent repair plans are empty. There is no independent news Cron. The successful degraded-publication contract is not itself an error and must not be reverted.

Durable pipeline_runs confirm no news acquisition on 10/2, 10/5, 10/6, 10/7 or 10/8. Each day has refresh_market -> regenerate_report -> no repair -> delivery. Last market_news upsert is 2026-10-01 07:35:01.664 Taipei. Latest canonical news published 9/30 22:45 Taipei; it fails the unchanged direct-market relevance and decision-catalyst checks even while fresh on 10/1–10/2. By 10/5 all retained canonical news is stale. These downstream rejections must not be mislabeled as a fresh Provider outage.

## Twenty-session retained counters

Counts below are sums of per-invocation durable responses, **including repeat fetch/upsert observations**, not unique articles across a day. Canonical upserts are not equivalent to Report quality approval. Canonical new rows are the currently retained created_at counts. Report accepted is the actual important_news_json item count; 0 can also mean no report due to an independent historical failure.

| TW business date | successful calls / observed calls | raw observations | per-call dedup observations | canonical upserts | canonical new rows | Report accepted | acquisition classification |
|---|---:|---:|---:|---:|---:|---:|---|
| 2026-09-09 | 1/1 | 192 | 192 | 11 | 7 | 8 | Producer ran; final report governed separately |
| 2026-09-10 | 1/1 | 176 | 176 | 12 | 9 | 8 | Producer ran; final report governed separately |
| 2026-09-11 | 1/1 | 173 | 173 | 12 | 10 | 8 | Producer ran; final report governed separately |
| 2026-09-14 | 7/7 | 1173 | 1173 | 5 | 5 | 0 | Producer ran; final report governed separately |
| 2026-09-15 | 7/7 | 1205 | 1205 | 36 | 13 | 0 | Producer ran; final report governed separately |
| 2026-09-16 | 7/7 | 1242 | 1242 | 63 | 16 | 0 | Producer ran; final report governed separately |
| 2026-09-17 | 7/7 | 1213 | 1213 | 66 | 13 | 0 | Producer ran; final report governed separately |
| 2026-09-18 | 19/19 | 3225 | 3225 | 168 | 22 | 0 | Producer ran; final report governed separately |
| 2026-09-21 | 19/19 | 3337 | 3318 | 12 | 7 | 0 | Producer ran; final report governed separately |
| 2026-09-22 | 19/19 | 3409 | 3390 | 42 | 9 | 0 | Producer ran; final report governed separately |
| 2026-09-23 | 7/7 | 1197 | 1197 | 48 | 13 | 0 | Producer ran; final report governed separately |
| 2026-09-24 | 0/0 | 0 | 0 | 0 | 0 | 0 | INTEGRATION_FAILED: producer not scheduled |
| 2026-09-29 | 0/0 | 0 | 0 | 0 | 0 | 0 | INTEGRATION_FAILED: producer not scheduled |
| 2026-09-30 | 5/5 | 856 | 856 | 30 | 6 | 0 | Producer ran; final report governed separately |
| 2026-10-01 | 5/5 | 885 | 885 | 5 | 1 | 0 | Producer ran; final report governed separately |
| 2026-10-02 | 0/0 | 0 | 0 | 0 | 0 | 0 | INTEGRATION_FAILED: producer not scheduled |
| 2026-10-05 | 0/0 | 0 | 0 | 0 | 0 | 0 | INTEGRATION_FAILED: producer not scheduled |
| 2026-10-06 | 0/0 | 0 | 0 | 0 | 0 | 0 | INTEGRATION_FAILED: producer not scheduled |
| 2026-10-07 | 0/0 | 0 | 0 | 0 | 0 | 0 | INTEGRATION_FAILED: producer not scheduled |
| 2026-10-08 | 0/0 | 0 | 0 | 0 | 0 | 0 | INTEGRATION_FAILED: producer not scheduled |

Totals: 105/105 observed fetch results successful, across 13/20 trading days; 7/20 days have no acquisition. Raw 18,283; within-call dedup 18,245; canonical upserts 510; actual Report accepted 24 (8 each on 9/9, 9/10, 9/11). No malformed/future publication timestamp rejection was retained in these invocation counters; 46 blacklist observations were retained.

Freshness-pass, relevance-pass and quality-pass counts over **all raw provider responses** were not retained. filter_stats is overlapping score counts after the 80-item cap, not a sequential rejection funnel. market_news.created_at is rewritten on upsert. Neither is a valid substitute for missing stage telemetry. Do not report those unavailable counts as zero or fabricate a historical raw replay.

A separate local replay of the retained canonical rows at each 07:30 cutoff (requires created_at and published_at <= cutoff, plus existing 48h policy) yields fresh/quality counts:

- 9/9 16/10; 9/10 13/8; 9/11 14/10; 9/14 5/1; 9/15 14/8; 9/16 28/16; 9/17 27/12; 9/18 26/14.
- 9/21 6/3; 9/22 11/1; 9/23 19/7; 9/24 8/3; 9/29 0/0; 9/30 6/5; 10/1 1/0; 10/2 1/0; 10/5–10/8 0/0.

This is **retained-current-row retrospective quality replay**, not a restored immutable raw capture or proof of which items a historical Handler loaded. Historical freshness/relevance/quality attribution outside the saved responses remains incomplete. The 10/1 retained irrelevant tanker headline is correctly rejected; no relaxation is proposed.

## Sources and classification

Existing sources are GNews, Finnhub and optional NewsAPI. Saved last responses report GNews configured, Finnhub configured, NewsAPI not configured. GNews 429 occurs repeatedly, but the combined fetch still returned data via Finnhub and any successful GNews query. There is no evidence supporting the claim that another paid API is necessary. Current Provider health after 10/1 has not been live-probed; no credentials were read.

- SOURCE_EMPTY: only an actual successful empty source response; not inferred from a missing invocation.
- FETCH_FAILED: a failed transport/provider invocation, e.g. recorded GNews 429 (partial-source failure, not whole batch failure).
- FRESHNESS_REJECTED: a known item outside 48 hours (true for all retained rows on 10/5–10/8).
- RELEVANCE_REJECTED: retained 10/1–10/2 canonical headline lacks direct market anchor.
- QUALITY_REJECTED: a known item fails the unchanged decision-catalyst/traceability gate.
- INTEGRATION_FAILED: no scheduled producer, or a failed canonical write. Persistent October starvation is the former.

## Minimal candidate

Only daily-delivery-orchestrator plus new shared optional-news acquisition module. Preserve the Atomic guard and existing core action results exactly. In the already-existing 07:00 refresh slot (07:00 <= Taipei time < 07:05), with no report and no forced regeneration, start the existing news function beside the existing market fetch. Skip if refresh_news is already planned. Existing pipeline lease prevents duplicate slot execution.

Use existing internal auth, two bounded 60-second calls and the existing 5-second retry pause. Nominal total client bound 125 seconds fits the primary 07:00–07:05 interval; a delayed 07:03 watchdog may finish after the first generation but before the 07:30 SLA. This is a bounded opportunity, not a guarantee of provider data. An abort is not represented as a successful fetch. Optional errors are separately recorded and cannot enter Atomic/report/delivery dependency results. No new schedule, new provider, new Secret, schema or migration. The unchanged producer owns dedup, published_at, relevance, canonical writes and quality scoring. The unchanged Report reader/quality gate decides acceptance.

New counters-only news_acquisition observation is stored in existing pipeline_runs.provider_status; it does not preserve Provider logs, raw URLs, response bodies, credentials or PII. Successful capture is explicitly CAPTURED_PENDING_REPORT_QUALITY, never automatic Report PASS. Missing filter telemetry is explicitly unknown.

## Verification and limitations

Actual orchestrator entrypoint/auth/planner/Atomic gate/finish handler is loaded in a network-denied VM with explicit local DB/provider doubles. For five affected dates, compare the exact deployed/base entrypoint against candidate: original invokes only market; candidate invokes news + market; business response is identical. The news response is a retained Production counter projection, not synthetic news content and not a fresh Production response. Negative 401/429/500 cases keep core result unchanged, retry bounded, and duplicate claimed slot makes no calls. No actual report or LINE dispatch occurs.

Retained real canonical articles independently pass the unchanged quality gate at legitimate historical cutoffs (e.g. 9/30); stale and irrelevant controls continue to fail. No claim is made that historical reports are recovered or that future full reports are guaranteed. Full recovery needs this candidate deployed with explicit approval, then an actual future natural refresh showing qualified fresh canonical news before the report deadline. A 48h provider data outage can still legally produce DEGRADED.

## Release boundary

Candidate only. Request approval to deploy **daily-delivery-orchestrator**, including market-news-acquisition.ts. No other Function; Migration NONE; Cron/Auth/RLS/Secrets unchanged. No historical backfill, Report regeneration, LINE send or Production business write in this investigation. Protected source/hash tests assert Decision/Recommendation/Report/LINE/Provider/Atomic code unchanged. A deployed-before/after Business Diff has not been claimed because no deployment occurred.

Previous Owner Backend/LINE/Core manifests are immutable. The new explicit candidate transition validates exact file set, hashes and predecessor before reconstructing historical test readers. No integrity skip or assertion relaxation.
