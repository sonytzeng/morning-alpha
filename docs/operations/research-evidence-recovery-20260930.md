# 9/30 Research rejection — exact Production evidence

Scope: candidate only. Production remains unchanged. No Provider, Atomic,
Sparse Recovery, Retry, Cron, Auth/RLS, secrets or historical business edits.

## Exact root cause

`EXPECTED_PREVIOUS_TRADING_DAY = ACTUAL_LOOKUP_DATE = 2026-09-29`.
Persisted sector scores and prior Report: both 0. The retained 14:10 and 14:30
Atomic batches each have 11 distinct providers. The earlier 09:00, 09:30,
10:30 and 13:00 checkpoints have no committed rows.

The 14:30 batch `4fbc5e68-304a-4663-bec0-644a3835ad4f`, correlation
`5e236416-961d-45e7-9770-1f6c7e0bbe40`, passes the unchanged DB integrity RPC.
Payload hash: `50f0babed300dcb142671d5616fb2d57`.
The lifecycle-qualified `authoritative_market_data_snapshots_v1` returns 0
because 9/29 remains SCHEDULED/rank 0 after the preserved morning failure.
The deployed reconstruction actually ran and logged `CLOSE_BATCH_NOT_11`.
This is a **Research reader authority/dependency bug**, not missing raw evidence.

A second predicate on the same path was reproduced with the complete Report
Handler: DB `validate_core_market_publication_v1` did not recognize the already
deployed canonical reconstructed-sector source. Edge accepted it; DB rejected
it as `MARKET_SOURCE_PROVENANCE_INVALID`. The live predecessor definition MD5
is `dffd21191ed005725a522801def74dac`. This predicate is fixed only by the named
Migration candidate, not by changing quality thresholds.

## News exact diff

Required: at least **one verified relevant, traceable, catalyst-tagged news**
within rolling 48 clock hours. No fixed 5/10/12 minimum is the publication gate.
The production `memberNoteDataStatus` completeness counter is not this gate.

At 07:05, orchestration had performed only `refresh_market`; verified news = 0.
Classification for that attempt: `NEWS_FETCH_NOT_EXECUTED`. At 07:15 the natural
repair fetched 171 items, dedup retained 171, canonical selection/upsert/tagging
completed for 6; the Report accepted 5 and correctly rejected 1 for
`taiwan_market_relevance_unproven|decision_catalyst_missing`.
The 07:15 window is `[2026-09-27T23:15:04.271367Z, 2026-09-29T23:15:04.271367Z]`.
Its only remaining input gap was `sector_rotation_scores:2026-09-29`.
News fetch/filter/freshness/dedup logic is unchanged; this is not a continuing
provider shortage or an independent persistent news rejection bug.

Natural run identifiers:

- 07:05 orchestration: `474703c0-d00c-4c94-ac55-ab3498b93108`.
- 07:15 orchestration: `99d2bb72-17d6-4bc0-8593-d535a6b20345`.
- 07:15 Research input: `d854383d-1f5a-4cdf-807d-5afb0ced5585`.

## Minimal candidate

`generate-daily-report-v7` reads the immutable close rows and batch ledger and
requires the unchanged `market_checkpoint_batch_integrity_v1` proof. It checks
exact provider set/count, single batch, correlation, idempotency, date,
checkpoint, session, payload identity and original provider timestamps. It
does not advance yesterday's lifecycle or write `sector_rotation_scores`.

Canonical `source` retains the historical wire identifier
`authoritative_market_data_snapshots_v1` for deployed reader compatibility;
it is explicitly a canonical evidence identifier, **not a claim that the SQL
view was queried**. Lineage now separately records the actual
`source_table=market_checkpoint_snapshots`, unchanged Atomic authority contract,
batch/date, and `RECONSTRUCTED_FROM_AUTHORITATIVE_MARKET_EVIDENCE` basis.
Downstream shared source validation is byte-unchanged; only the Report Function
requires deployment. No historical Report evidence is impersonated.

Only Migration candidate:
`20260930005956_research_committed_close_provenance_v1.sql`.
It aligns the existing DB validator with the existing Edge canonical source,
preserving previous-trading-day/date/freshness checks, owner, ACL, signature,
security and search_path. Exact predecessor and exact repeat-successor guards
reject unknown definitions. Production execution is **not authorized yet**.

## Real Handler isolation

Inputs are saved, deidentified real 9/29 and 9/30 observations, with original
dates and values. The publication fixture is explicitly labeled **isolated
Handler output / validator projection**, never a Production Report.

Fresh PostgreSQL schema-only baseline, actual SDK/PostgREST, actual Report
Handler, actual SQL publication and LINE Handler were used. The DB/Handler
clocks share the same isolated 9/30 morning; final successful generation was
07:37, not a claim of 07:30 SLA success. No Production clock was modified.
Prior baseline test-clock artifacts were identified as TEST_ENVIRONMENT;
the migration validator uses the exact Production definition before apply.

Observed: Research READY, quality coverage 100, missing sources 0, four derived
sectors; Report HTTP 200/READY; independently audited recommendation gate
QUALIFIED, delivery projection BLOCKED where appropriate; market delivery
remains legal. The Report is created by `publish_research_bundle_v1` called by
the real Handler, never an inserted final-report fixture.

Repeated Report input returns the same Report; one persisted Report and one
decision revision. LINE first call sends 1 to the in-memory sink; second call
returns ALREADY_SENT/0. Real LINE network calls, Production tokens and real
recipients used: all 0. Deno permits network only to the explicit loopback
endpoint. No subscriber data was copied; the recipient is visibly fake.

Controlled missing-news and missing-close responses are separately labeled
negative tests and yield HTTP 409 `RESEARCH_QUALITY_REJECTED`. They do not change
the saved evidence or pretend to be original Production responses.

The replay runner is `tests/helpers/researchCrossDayHandlerReplay.mjs`, opt-in
with `--scope=ma-research-clock-20260930`, loopback port 55445, real schema-only
isolation, saved input tables, real 9/30 PREMARKET success as a precondition,
zero initial Reports/outboxes, and exactly one local fake recipient.
It rejects non-local transport. Only its documented local clock RPC is a test
seam; no provider, quality, publication or LINE decision is stubbed.

## History and release boundary

Production recheck: 9/30 PREMARKET rows = 11, Report = 0, normal LINE = 0;
9/29 sector scores = 0. No business action, Recovery or Acceptance was invoked.
Local output does not change 9/30's natural FAIL or any 07:30 SLA result.

Candidate release scope is one named Migration plus
`generate-daily-report-v7`. No other Function or Cron is required.
GitHub Gate completion does not authorize merge/deployment/migration execution;
Sony's final named Production approval is still required.
