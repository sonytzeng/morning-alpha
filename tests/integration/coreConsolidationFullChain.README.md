# Core Consolidation persistent replay

This opt-in driver runs actual business handlers, Supabase Auth, PostgreSQL/RPC,
and persistence readbacks against one fresh, default-deny local stack. It does
not start a stack, author SQL, copy credentials, or replace business clocks.
The authoritative configuration schema is the executable
`validateReplayConfiguration` in `tests/helpers/coreConsolidationReplayRuntime.mjs`.

The provider fixtures are explicit **synthetic 2026-09-15/16 counterfactuals**, not
an archived vendor recording. Raw quote/news/OpenAI wire responses are served by
a test-only local Edge boundary; normalizers, evidence/quality checks, generator,
publication SQL and delivery handlers still decide every outcome. The minimal
OpenAI response is only a parseable input candidate, not a promise that editorial
quality or publication will pass. Do not turn a failure into a READY row.

## Required bootstrap receipt and configuration

Write an owner-only JSON config under `/private/tmp/<scope>/replay-config.json`.
Generate every hash from the actual reviewed input/artifact; example unit-test
hashes are deliberately not deployment configuration.

| Field | Exact requirement |
| --- | --- |
| `schema_version` | `CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V1` |
| `scope` | Fresh `ma-consolidation-v1-` plus 14 digits; must equal `MA_LOCAL_SCOPE` |
| `report_date`, `warmup_date` | Exact dates matching the chosen provider fixture; the later 9/16 control uses 9/15 warmup and retains the earlier fixture's hash |
| `scenario_kind` | `SYNTHETIC_MARKET_READY_STOCK_BLOCKED_CONTROL` |
| `historical_success_claim`, `production_operations_authorized` | Both `false` |
| `api_origin` | Explicit `http://127.0.0.1:<new-port>` |
| `network` | `<scope>-isolated`, actual Docker `Internal=true` |
| `evidence_directory` | First run `/private/tmp/<scope>-evidence`; later explicit attempt N uses `-evidence-attempt-NNN`, never overwriting an old result |
| `attempt`, `previous_attempt_results` | Attempt defaults to 1. Later attempts pin every exact prior failed result `{path,sha256}`; allowed only before any business handler call and with actual business tables still empty |
| `credentials_file` | `/private/tmp/<scope>/local-credentials.json`, owner-only, no symlink |
| `clock` | `{kind:"DEDICATED_SHARED_GUEST",configuration:{root,limaHome,instance,configPath,configSha256,bootId}}`; validated by existing VM clock helper |
| `docker` | `{kind:"IN_SAME_GUEST",guest_boot_id:<same bootId>}`; driver uses exact `limactl shell` guest Docker, not existing Colima |
| `containers` | Exactly `auth`, `db`, `edge`, `gateway`, `rest`; each `{name,image_id}` from actual inspection |
| `additional_containers` | Array of every additional network member `{name,image_id}`; none may have another network |
| `functions` | All 12 `REPLAY_FUNCTIONS`; each `{slug,entrypoint,source_sha256,bundle_file,bundle_sha256,deployed_file,vendor_boundary_only:true,business_clock_override:false}` |
| `source_files` | Complete transitive production source/import inventory `{path,sha256}` under `supabase/functions/`, `src/lib/`, `shared/`, plus the actual imported `src/features/decision-v1/contract.ts`; not just entrypoints |
| `sql_candidate` | `{path:"supabase/migrations/20260909015650_core_market_publication_contract.sql",sha256}`; must be nonempty actual reviewed SQL |
| `sql_functions` | Six `{name,definition_md5}` rows from actual reviewed `pg_get_functiondef`; inspected again before execution |
| `bootstrap_receipts` | Nonempty array `{scope,path,sha256}` for actual fresh schema-only initialization, exclusions, SQL application, local credential provenance, pinned images and bundle build commands |

The six SQL names are `enforce_decision_snapshot_premium_90_gate_v1`,
`publish_research_bundle_v1`, `publish_member_content_revision_v1`,
`publish_decision_snapshot_v3`, `capture_morning_alpha_acceptance_v1`, and
`validate_core_market_publication_v1`. The driver performs fixed read-only
definition/clock checks, not arbitrary SQL execution or DDL. Applying the reviewed
SQL belongs to the separately authorized bootstrap/test scope.

`boundary` contains `slug:"local-core-consolidation-boundary"`,
`fixture_file`, `fixture_sha256`, `source_file`, `source_sha256`, `bundle_file`,
`bundle_sha256`, `deployed_file`, `egress_default_deny:true`, and `source_files`.
Its `source_files` is the exact four `{path,sha256}` entries for
`coreConsolidationBoundaryPrelude.mjs`, `coreConsolidationBoundaryServer.mjs`,
`coreConsolidationBoundaryProxy.mjs`, and `coreConsolidationVendorShapes.mjs` under `tests/helpers/`.
The server `source_file` is the exact unbundled receiver source, independently
copied to `/var/run/<scope>/boundary-source.mjs` inside the new test container.
CLI deployed paths are `/private/tmp/<scope>/supabase/functions/<slug>/index.js` including the boundary.
Inspect these actual files; do not trust a host bundle hash alone.

The receiver main-service requires a fresh persistent test volume at
`/var/run/<scope>/` containing `provider-fixture.json`, `boundary-source.mjs`,
and a writable append-only `vendor-receipts.jsonl`. Its source is bundled without
the vendor prelude into `/srv/boundary/index.ts` in a dedicated same-guest,
same-internal-network container with alias `local-core-boundary` and internal
port 8081; no host/public port is exposed. Pin it as an additional container and
as `boundary.receiver:{name,image_id,bundle_file,bundle_sha256,deployed_file}`.
Supabase userWorkers do not expose arbitrary container filesystem paths; the
JWT-verified `coreConsolidationBoundaryProxy.mjs` forwards to this test receiver
and independently reports its own actual Edge timestamp. Pin the actual proxy
bundle as `boundary.bundle_file`/`bundle_sha256`. Both clocks must agree with
PostgreSQL and Auth. Prefix only the other 12 local bundles with
`coreConsolidationBoundaryPrelude.mjs`; do not change their original source.
All internal calls use the same stack's `http://kong:8000`; verify that actual
gateway alias. Original vendor URL/query tokens are stripped from boundary
receipts. The test boundary never writes an outbox SENT status or a report.

Create local-only keys and Auth user in this fresh scope. Credentials JSON shape:
`{scope,provenance:"GENERATED_IN_THIS_ISOLATED_STACK",production_secrets_copied:false,api_origin,anon_key,service_role_key,cron_secret,auth:{email,password}}`.
The email must end in `@example.invalid`; bootstrap a real confirmed Auth user
with a generated password, not a JWT/user-response mock. No credentials belong
in the repository or evidence JSON. Provider credentials are new dummy values,
only to exercise existing enabled provider branches behind the network boundary;
never copy a real provider key. Existing provider choices/strategy stay unchanged.

## Run and result interpretation

```sh
MA_CONSOLIDATION_REPLAY=LOCAL_ONLY MA_LOCAL_SCOPE=ma-consolidation-v1-20260909133500 \
  node --experimental-strip-types tests/integration/coreConsolidationFullChain.e2e.mjs \
  --config /private/tmp/ma-consolidation-v1-20260909133500/replay-config.json
```

The phases are actual previous-close **manual input** Fetch/news/sector warmup → premarket
Fetch/news/generator → immutable publication receipt → public/authenticated
payload → actual local LINE receiver/outbox plus retry → six Fetch checkpoints
and radar → Closing plus exact receipt retry → Learning plus exact receipt retry
→ health → actual manual terminal lifecycle handler → Acceptance.
PG `clock_timestamp`, actual Edge time and a real freshly authenticated session
must agree before each phase. Only the dedicated guest clock advances; host time,
SQL time gates and production business time code remain unchanged.

The final lifecycle path uses the existing orchestrator's explicitly manual
`health_check`/`ma-ops-safe-recovery` workflow after strict passed health readback;
the direct health handler cannot mint `DAY_COMPLETED`. This exercises real
handler-owned writes, not seeded completion. It is **not** scheduler automation
and must keep `automatic_stable_day=false`. A natural scheduler lane requires
separate actual dispatch/collector execution, not a forged scheduled label.

Failure stops at the first actual failing stage and preserves `stages.jsonl` and
`result.json`. Reusing that scope/result directory is rejected. No failed artifact
is deleted. `PASS` can only mean this single synthetic persistent handler lane
passed; it does **not** establish historical September 7–9 success, the 120-day
Learning horizon, Browser execution, CI/Readdy, Production readiness, or automatic
stable days. Original sanitized capture fixtures remain independently pinned and
their unavailable full source ledger remains `UNKNOWN`.

The separate `tests/coreConsolidationReplayPreparation.test.mjs` validates wire
shapes, isolation and readback guards only. Its passing count is not full DB E2E.

## Observed continuation 002 / 003 failures (preserved, not PASS)

Continuation 002 genuinely completed the 9/16 PREMARKET Fetch: eleven raw rows,
eleven new immutable versions 21–31, matching canonical/compatibility rows and
the actual `PREMARKET_CAPTURED` rank-10 receipt. The real news handler rejected
all four generic synthetic headlines (highest score 45, unchanged threshold 60).
There was no Generator call in this continuation. Its result remains `FAIL`
with SHA256 `e33356196e788c46f190d8f2d403c38c29a3858346b0d0e46ca794e8fb008868`;
the read-only exact input capture is pinned by
`8546d4aa79ea009d580a354789279022d23a38190955293de0a798cfc6d6d68d`.

`coreConsolidationPremarketContinuation.mjs` implements the separate, exact
`CORE_CONSOLIDATION_PREMARKET_CONTINUATION_V1` continuation 003. It does not
change the ordinary no-reuse guard. It validates all 22 actual tables, the
retained earlier failures/runner preimages, all 37 provider receipts, the
eleven PREMARKET source/value/date/correlation/version tuples, four previous-day
sector rows and four rejected raw-news rows. No report, publication, delivery,
Learning or Acceptance row may be adopted. A new exclusive result directory is
required, with real current time before 08:45; the PREMARKET Fetch is not resent.

The separately authored `full-chain-synthetic-20260916-news-v3.json` changes
only synthetic raw-news titles/summaries/unique `.invalid` URLs and correctly
shaped AI prose. It preserves quote values, phases, source times, provider labels
and original fixtures. No score, quality status, CMS or publication authority is
provided. The actual unchanged news scorer computed scores 82–92 (top Fed 92);
these measurements are not input fields. The actual news handler subsequently
persisted all six canonical events and preserved all four old rejected rows.
The pure `coreConsolidationPremarketContinuation.test.mjs` suite has 62 tests,
including mutations of both captured and current input, unexpected business
rows, source/receipt corruption and forbidden computed provider fields.

Continuation 003 then exercised real Generator authorization (anonymous 401),
the actual OpenAI-shaped local boundary, actual report/snapshot/member writes
and a real `CORE_MARKET_PUBLICATION_V1` PUBLISHED receipt. **The handler returned
409 `DELIVERY_GATE_BLOCKED`; this is still a failed chain.** Persisted content
score was 100, but the published daily sentence was replaced by the CMS
executive-summary first sentence; post-write editorial evaluation of that
different sentence scored 70, with missing action/checkpoint/change-condition
flags. No LINE, intraday, Closing, Learning or Acceptance stage ran. This exposed
a producer/projection quality-consistency defect; enriching the synthetic input
alone must not hide it, nor may its committed publication be adopted as a
successful positive control.

The exact 003 result is
`de115a8a414a4620923b742a84b019fc18c7dc151603c6912e1d92d2cce7459f`;
the full local readback is
`54626f84d0750c7a1139f658b96d335a61cbb88e6e751772775f7041676a9619`.
Its actual 53 business-source/12 bundle preimages are archived under the scope's
`continuation-003-business-preimages/`, manifest SHA256
`df87896fab28219d12b1e3fc001d6287d216203bab7edc34fc4562014a5eb25f`.
Original fixtures, all failed results, four runner preimages and prior rows
remain unchanged. These local synthetic observations are not September 9
historical success, a natural stable day, or full E2E PASS.

## Preserved cold-start failures and explicit input continuation

The initial 9/15 close warmup failed honestly: actual Fetch persisted nine raw,
immutable, canonical and compatibility rows, but the existing lifecycle rejected
rank 0 → `CLOSE_1430_CAPTURED` rank 100. Attempt 002 remains `FAIL`; those rows
do not establish a successful close checkpoint or a natural stable day.

The existing `manual_backfill` / `manual` Fetch path is the legitimate fresh
input bootstrap: it creates actual `RECOVERY` evidence and `MANUAL_CAPTURED`
rank 0. The next day's report can consume actual previous-day sector scores
produced from close-window snapshots/raw prices, without inventing a previous
report or lifecycle. The driver does not author or seed either state.

Continuation 001 reached that real manual producer: eleven additional immutable,
canonical and compatibility rows plus a real successful rank-zero receipt were
committed. Its HTTP response was cut off by the test loopback proxy's retained
five-second socket timeout; its result is still `FAIL`, not a recovered HTTP
success. The proxy has a separately recorded local-only correction. Any resumed
manual input must be verified from exact durable evidence, never blindly resent.

`coreConsolidationContinuation.mjs` has a separate opt-in manifest schema,
`CORE_CONSOLIDATION_WARMUP_CONTINUATION_V1`. It does not alter the ordinary
same-scope retry prohibition. Each continuation uses a new exclusive evidence
directory, pins the original config/failed result/readback, and verifies all 22
actual input/business tables (an HTTP 404 is not an empty table). Continuation
001 admits only the original nine failed-close input rows; continuation 002
additionally verifies the eleven actual manual inputs, their sole rank-zero
lifecycle, the original failed HTTP result and archived prior runner bytes.
All reports, publications, dispatches, subscribers, Closing and Learning rows
must still be absent. Provider requests and responses are independently
reconstructed from the explicitly synthetic fixture and checked against the
append-only receipt hashes and persisted source/value/time/correlation/version.

The exact existing canonical SQL numeric scales are checked separately:
`market_quotes.value` uses eight decimal places and `change_percent` six, with
decimal round-half-away-from-zero. Raw, provider and immutable values are not
rounded; no epsilon tolerance is allowed. Every main-day checkpoint also reads
the actual raw table and validates exact source/provider, correlation, business
date, phase, checkpoint and immutable version across canonical/compatibility
rows. Existing inverse IEF→US10Y semantics require the exact producer mapping,
not a fixture-supplied arbitrary sign.

An approved payload-only source successor must use a separate config and receipt.
Original 53 source files and 12 bundles remain archived byte-for-byte; only the
exact `get-report-payload` source/bundle can change. Date, SQL, Auth credentials,
network, provider fixture, other handlers and previous receipts cannot change.
The ordinary source/SQL/actual-container checks then run against the active
config. A changed source is not permission to relabel any earlier attempt PASS.

These preparation and negative tests are not full-chain success evidence.
The 9/16 main business chain has not completed; no historical event, Production
readiness, automatic stable day or 120-day Learning success is claimed.

## New 9/17 persistent chain: terminal SQL failure retained

The independent scope `ma-consolidation-v1-20260909154500` uses its own
`172.19.0.0/16` Internal network, fresh Auth credentials and six official local
services plus a no-host-port synthetic receiver. The old scope and every failed
attempt remain intact. The host clock was not changed; PostgreSQL, real Auth,
Edge and receiver were witnessed on the same dedicated guest clock.

`full-chain-synthetic-20260917.json` is a new, explicitly synthetic provider
input, not a historical capture. Its raw narrative includes the actual quoted
market variables, 09:30 conditional validation and stop condition; no score,
CMS, publication state or accepted evidence is supplied by that fixture.
Real Generator and assembler produced the canonical document, scored its exact
published text, and committed the report/snapshot/member/run through actual SQL.

The first run persisted eleven legitimate 9/16 manual input rows but failed a
runner assertion because the requested correlation had been placed in the body
instead of Fetch's `x-correlation-id` header. HTTP 200 and that runner FAIL are
separate facts. Its result hash is
`1d254ccbd968ebf21e9f433d266f9f98386d74c0b34afcac0ec78fa6e72b5a84`.
The separate `coreConsolidationFreshManualContinuation.mjs` admits only that
exact scope/config/schema/readback/failure/source archive and eleven provider
request/response proofs. All 22 tables must be read successfully and match;
all non-input business tables must be empty. It never resends Fetch, adopts a
publication, rewrites the original result or alters the general reuse guard.

Actual continuation 001 completed all seven main-date Fetch checkpoints,
Generator publication, report Health, real anon/authenticated payload reads,
local-only LINE send/outbox retry, Closing and immutable receipt retry,
current/history Closing readers, and Learning with unchanged raw prediction
and outcome sets on retry. The market publication is `market_only`, score 100,
coverage 100; individual stocks remain blocked. Its Closing and Learning
contracts are genuinely COMPLETE, not fixture-provided statuses.

**The chain nevertheless failed at terminal recovery.** The actual orchestrator
advanced the lifecycle to rank 150, then its existing
`reconcile_runtime_terminal_failures_v1(date,uuid)` call returned
`TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED` (HTTP 409).
The exact same PREMARKET/current/READY snapshot has Editorial APPROVED and its
bound member/Semantic PASSED. The old SQL predicate permits only
`recommendations` and `no_trade`, excluding this valid `market_only` publication.
There are zero Acceptance rows, dispatches and dead letters. The partial
`DAY_COMPLETED` lifecycle is not a completed recovery or full-chain PASS.

This sixth existing RPC is outside the currently approved five existing
functions plus private validator. No new definition, QA/lifecycle alteration,
terminal bypass or Acceptance call was executed to work around that boundary.
The downstream 15:35 Acceptance stage remains NOT_RUN.

Permanent minimal evidence is indexed in
`tests/fixtures/consolidation-v1/local-failures/index.json`, with a hash-pinned
`terminal-market-only-20260917.json` capture. Credentials, Auth users, subscriber
identifiers and provider request headers are excluded. The full owner-only
local artifacts remain under `/private/tmp/ma-consolidation-v1-20260909154500`:

- continuation result: `15ecbabac65df46280bd342c5191a636708b06f96ffe6ead75ccdab19c8ae7ca`;
- exact table/provider readback: `945c036b12c89ab403db8715a109883929bef2190fabf9ce8874fbd54f1e271b`;
- catalog/predicate capture: `0577554c7521c4ddcb556ebeb5143d748408e06de9fb21a30591a58d50c9df89`;
- 53 business sources, 12 bundles and supporting preimages:
  `f15111ab8465987214b73b94ba6d316b466986c490ef243be2b954720206d019`;
- executed continuation's five runner preimages:
  `21cbdbc92b2e1c56bc1dbbf78185c615364c956100b252707a92fdbd05025cbd`.

The stopped runner's final source-check dispatcher was also corrected to route
fresh-manual manifests to their exact loader. That branch was not reached by
the failed business chain. Positive/negative regression checks cover all three
continuation schemas and reject cross-schema fallback. The complete new pure
guard/header/router/evidence suite passes 66 tests; this is not full E2E PASS.
No handler was replayed after terminal failure. No Production operation,
natural scheduler, automatic stable day, browser execution in this lane, or
120-day Learning result is claimed.

## Subsequent named terminal approval: fresh 9/21 chain PASS

The preceding 9/17 account is an immutable historical failure, not the current
authorization state. Sony subsequently explicitly approved the named terminal
RPC's local candidate change. The independently reviewed candidate SQL
`353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0`
passed the separate 24-case DB lane before being applied to a third **empty**
scope, `ma-consolidation-v1-20260909170000`. No old report, lifecycle, publication
or LINE send was adopted. The original failed scope's complete 22-table row sets
were subsequently read and proved unchanged, and its exact result remains FAIL.

The new scope uses Internal network `172.20.0.0/16`, API `127.0.0.1:55481`, its own
new local Auth credentials and the same pinned official runtime images/shared
guest boot. The V2 config accepts only this exact scope/origin/subnet and the
seven named SQL definitions; the original V1/six-definition configs and guards
are retained. Host time is unchanged. The guest clock only advanced.

The new `full-chain-synthetic-20260921.json` supplies provider-shaped inputs:
Friday 9/18 manual warmup and Monday 9/21 main chain. Friday cash and night-session
timestamps are retained instead of fabricating Sunday prices. Warmup and main
news use distinct synthetic `.invalid` URLs, preventing cross-day deduplication
from silently reusing stale news. The optional dated TXF fallback is the actual
October contract. Only raw inputs are supplied; no quality score, READY row,
accepted evidence, lifecycle, publication or Closing outcome is seeded.

The actual runner completed with exit 0, **96 recorded stages**, run
`dbc23233-8aba-4c82-aa2a-d77c1828752f`. It exercised real Fetch persistence,
news/sector producers, Generator/atomic publication, current and history payload
readers with real Auth, one local-only LINE send and exact outbox retry, seven
main-date checkpoints, Closing receipt/fingerprint retry, Learning raw prediction
and outcome set retry, terminal reconciliation, and the 15:35 private Acceptance
RPC. Final source, deployed bundle, SQL and immutable checkpoint checks passed.
The publication is market-only with measured score/coverage 100; stocks remain
blocked. Both MORNING and FULL_DAY Acceptance rows are actual persisted PASS.

This is a **synthetic-provider, manually driven local full persistent chain**,
not a Production or natural scheduler pass. FULL_DAY Acceptance explicitly says
`manual_intervention=true`, `automatic_stable_day=false`, and keeps both
`MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER` and `AUTOMATION_PROVENANCE_UNVERIFIED`.
Its frontend status remains `EXTERNAL_SMOKE_REQUIRED`; the separate Browser lane
must supply its own evidence. Intraday/close Learning outcomes are completed;
1D/3D/5D are still pending. No 120-day Learning result is inferred.

Permanent sanitized output evidence (never input for business-state seeding):
`tests/fixtures/consolidation-v1/local-runs/full-chain-market-only-20260921.json`.
The owner-only original artifacts remain under the exact third scope:

- `/private/tmp/ma-consolidation-v1-20260909170000-evidence/result.json`:
  `d0e53dc47ff0e28b86c6cd419d0798da2855e51d19c21115b669ba3363cc8d50`;
- `actual-chain-final-readback.json` (24 real tables, 92 provider-boundary receipts):
  `7d6a7fd5ebcf48a6ee0916d58f8c0d13565009138cbb4f6e6b837b39ec4f9963`;
- `replay-config.json`: `3e5eb1a0d22d21c1ae16b5a108c99fc3bfb016577571cd1ae02790332a610edc`;
- `executed-source-preimages/manifest.json` (76 exact files: 53 business sources,
  12 bundles and 11 runner/boundary/SQL/provider inputs):
  `ac344f3ece3e85d701f8ebef0cf9115f9c883bae352ea6a78f220b68a2c2681e`;
- `prior-terminal-failure-preservation.json` (all 22 old tables unchanged):
  `00c2cd4a378edd34c348b1d448e01930af7a696196f4d890be5cf03c048ff131`.

A separate, later read-only diagnostic initially queried the nonexistent table
`research_publication_runs` and correctly failed on HTTP 404. Its FAIL receipt is
retained as `final-readback-diagnostic-attempt-001.json`. The real authority is
`pipeline_runs`, already in the base inventory; an independent v2 diagnostic
captured the actual 24 tables without replaying any business operation. This
diagnostic correction did not alter the original completed chain's result.
