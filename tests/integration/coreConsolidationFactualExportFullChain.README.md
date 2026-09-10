# Fresh factual-market export replay: complete local action for review

Status: PREPARATION ONLY / NOT_RUN. Recorded 2026-09-09; this is not an execution
receipt or a request to change Production. Producer source is frozen as recorded below.
No VM, container, database, account, clock, runtime source or old result was
changed while preparing this plan. Root approved this isolation direction;
the complete implementation must still pass normal tool safety review once.

## Exact boundary

| Resource | Planned exact value |
| --- | --- |
| New scope | `ma-consolidation-v1-20260909200000` |
| New root | `/private/tmp/ma-consolidation-v1-20260909200000` |
| New evidence root | `/private/tmp/ma-consolidation-v1-20260909200000-evidence` |
| New DB / Auth / REST / Kong / Mail / Edge | Only names suffixed with the new scope |
| Dedicated receiver | `local_core_boundary_ma-consolidation-v1-20260909200000` |
| New internal network | `ma-consolidation-v1-20260909200000-isolated`, `172.22.0.0/16` |
| Host and guest loopback ports | API `55501`, PostgreSQL `55502`, mail `55503`; receiver `55504` internal only |
| Existing dedicated VM only | `/private/tmp/ma-clock-20260909-183000`, instance `clock` |
| LIMA_HOME | `/private/tmp/ma-clock-20260909-183000/lima` |
| Docker transport | `unix:///private/tmp/ma-clock-20260909-183000/docker.sock` |
| Fixed boot ID | `d9f73673-b3e3-4daf-8080-13d8dde5b2c0` |
| Fixed VM config SHA256 | `d4a19ade8880a32482307128dc91c7d10e41375a7b14c087b9dc86140de8b288` |
| Manual input-only warmup / main business date | `2026-09-29` / `2026-09-30` |
| New result | A new run UUID and new append-only result; no adopted old report |

Do not create another VM or reinstall tools. Do not touch the earlier shared VM
`/private/tmp/ma-clock-20260909-020052`, its containers, clock or credentials.
New empty DB is necessary: real Fetch upserts `market_data` by symbol, so a new
date in the old DB would overwrite the retained old raw observations.

## Required preservation before any clock advance

Re-read the exact 27 business tables and all provider receipts from scope
`ma-consolidation-v1-20260909183000`; compare complete canonicalized rows with
the pinned post-409 readback, not a row-count subset. Its report date is 9/23.
Auth data is not exported. Record opaque table hashes and container identities.
Stop only that scope's exact CLI serve process and its 7 active containers;
retain containers, volumes, networks, source bundles, signing material and every
result. Do not delete, reset, recreate, rename or run Recovery against them.
Its already-retired key1 containers remain stopped and untouched.

The old 9/23 report `9db468b4-4400-4752-a588-f1d5ab785187`, snapshot
`fec4aed8-a421-4cbb-9d34-b5b7a5bf9221`, member
`7309cf47-84e1-4f8a-834d-56d07b9ed3af`, publication run
`4181aca5-2c3a-42a5-827f-b91f8682a9ec` and OPEN incident
`49ce850c-b5b9-495d-af9e-c5c1bf7bab79` are immutable retained evidence.

| Retained artifact | SHA256 |
| --- | --- |
| Old evidence/result.json: real export BOOT_ERROR 503 FAIL | `80b61c535cb1a293c810c386b75af60c71faecebee2a2794fadb0aedb554635a` |
| Old evidence-continuation-001/result.json: real export 409 FAIL | `ed3f57d6b4929d2a30cac6380e4bed77d0fc81b639c056450d8664de2e356565` |
| Old root/post-publication-export409-readback.json | `d92179edda5db4eff11aa6a5c4d74f2279763334e6172c2d285067b3f6840077` |
| Old root/executed-source-manifest.json: 65 total / 54 runtime paths | `2c833f47795bac0eb8b777fb7fcd8d08a5caab1759ceaa53428141a7e29cb389` |
| Old root/executed-source-preimages.tar | `94e39c4ae77a68499e1b4e240a82796094d8fd6c8a9de6a8f6d120a622de383d` |
| Old root/test-key-containment.json | `f38be887d412e507b0077a546d277331c7f2e36f1e666d9a37c3d18401918cd7` |

All six above were read-only re-hashed during this planning turn and matched.
New root/evidence paths were absent; `lsof` showed no listeners on 55501–55504.
These checks must be repeated at execution and are not stack readiness proofs.

## Input invariance: no fixture escape from the negative example

Predecessor is repository provider fixture
`tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260923.json`,
SHA256 `f1eda85b78645eb0c7264890cc73334e4624d5d4c0535300546f1316ad49a81a`.
Create a separate 9/30 fixture; never rewrite that file or executed copies.

Only whitelist these changes: fixture ID and top-level report/warmup dates;
phase start/end/news-source/source-market timestamps shifted exactly +7 days;
date tokens in explicit `.invalid` news URLs shifted by the same +7 days; and
non-business provenance metadata describing the new run/predecessor hash.
Keep time of day and all source-age relationships exact. Audit every changed
JSON pointer against the whitelist and inverse-transform to exact predecessor
business input. All other fields, including quote values, futures, article
titles/summaries/source identities, per-phase market observations and complete
OpenAI response/content string, must be byte-identical. No additional claim,
news article, ranking value, quality score, accepted flag, citation, READY state,
source weight, market-data URL or publication receipt may be supplied.

Negative preparation cases must reject altered AI text, quote values, article
facts/source, additional news, non-date URL changes, nonuniform timestamps,
changed importance/ranking input, old result drift, old table drift, occupied
scope/port, nonempty new DB, wrong boot/image/network/JWT mode and key1 reuse.
The new producer selection is the only intended business source delta; its
independently reviewed source hash and focused validation must be supplied by
root before new bundles are built or any business handler is invoked.

## Complete intended side effects for normal review

1. Preserve/read-verify old evidence and stop only the exact 183000 services
   above. Keep Docker/VM transport running; do not advance any earlier VM clock.
2. Create owner-only new work/evidence/config paths and one fresh internal
   network. Start six new pinned official containers plus the genuine boundary
   receiver. No shared data volume, database, user, profile or session is copied.
3. Reuse only explicitly approved effective test key2 internally from this same
   dedicated VM's 183000 scope; never output key values or assertion operands.
   Key1 is invalid and forbidden. No Production or earlier-scope key reads.
   Generate only new scope-local DB password, ordinary user password and dummy
   internal/provider credentials as necessary. Record provenance truthfully:
   signing material is reused key2, not falsely described as newly generated.
4. Register exactly one ordinary `@example.invalid` synthetic Auth user through
   normal GoTrue registration. Its normal profile trigger is allowed; no Admin,
   Member entitlement, role grant, old UUID, old session or existing-account
   update. Validate real issued JWT via `/auth/v1/user`, never claim a decoded
   JWT alone is authentication. No Auth weakening, no public-JWT exception.
5. On only the new empty DB, replay the existing exact schema-only preparation
   plus candidate SQL `353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0`.
   Preserve the seven named SQL contracts, original owner/ACL/security/search_path,
   triggers and RLS. Keep existing operational Cron/Vault/backfill exclusions;
   record each exclusion. Do not author or execute any additional SQL function.
6. Build 13 actual handlers and their complete current import graph. Keep the
   same-version `npm:...@2.57.4` to `esm.sh/...@2.57.4?target=es2022` local bundle
   mapping from the outset, with dependency resolution hashes. Preserve source
   bytes/SDK version; this is declared local packaging, not exact Production
   loader parity. Existing 2.115.0 mappings stay fixed. Archive all new harness,
   source, provider and bundle preimages before execution.
7. Attest actual mounted config: all 13 functions plus boundary `verify_jwt=true`,
   unauthorized requests rejected, real Auth validation and RLS intact. Every
   active new service belongs only to the new Internal network; Kong/Edge
   aliases are verified after CLI serve, which can otherwise attach default
   networks. VM OUTPUT/FORWARD default deny stays enabled. No external provider,
   SMTP, ContentOS or LINE request can leave the synthetic boundary.
8. Only after all old 183000 services are stopped, advance this dedicated guest
   forward to warmup 9/29, then main 9/30. Never rewind or backdate a persisted
   receipt. Verify real guest/Postgres/GoTrue/Edge clocks at every phase and
   host clock unchanged. If the permitted phase has elapsed, stop as FAIL;
   do not loosen time windows or reinterpret an expired batch.
9. Run actual warmup Fetch/news/sector input bootstrap, then fresh main Fetch →
   news → Generator → atomic publication → true Payload → true ContentOS export
   → local-only LINE → six 09:00/09:30/10:30/13:00/14:10/14:30 checkpoints →
   Opening/Closing → CLE → terminal reconciliation → final export/Acceptance.
   Read back raw/immutable/canonical lineage, exact publication/source tuples,
   local outbox/receiver delivery, durable close/learning receipts and retry
   row identity. No READY/report/closing/lifecycle/Acceptance seeding. Insert
   only the explicitly synthetic local LINE receiver subscription used by the
   existing driver, never a real or existing recipient.
10. Preserve every HTTP/row response, source manifest, failed attempt and
   automatic-stability flags. A failure stops that chain; no automatic resume,
   deletion, old-incident resolution or fixture supplementation to force PASS.

The 13 exact functions are fetch-market-data-v10, fetch-global-market-news,
generate-sector-rotation, generate-daily-report-v7, get-report-payload,
line-daily-push, opening-market-radar, close-market-review,
closing-verification-engine, continuous-learning-engine,
daily-delivery-orchestrator, ma-ops-health-check, content-os-morning-alpha-source.

## New implementation files, after producer freeze

Use new scope-specific helper/prepare/driver/test/fixture files; do not edit the
executed 183000 helper, original 13-driver, continuation driver or old README.
Proposed names:

- tests/helpers/coreConsolidationFactualExportRuntime.mjs
- tests/integration/coreConsolidationFactualExportPrepareLocal.mjs
- tests/integration/coreConsolidationFactualExportFullChain.e2e.mjs
- tests/coreConsolidationFactualExportPreparation.test.mjs
- tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260930.json
- tests/integration/coreConsolidationFactualExportFullChain.README.md

The old business stage tail is the reference, not proof of a new run. The new
guard must pin the exact 200000 scope, the stopped-old-scope preservation receipt,
same dedicated boot/key2 provenance, and fresh-only tables. No generic arbitrary
scope, URL, date, credential or predecessor adoption override is permitted.

Execution is gated by source freeze + actual focused tests, fixture invariance
proof, executable whole-action review artifact and normal tool authorization.
No bootstrap command has been submitted for this new scope. Prior denied public
JWT=false, Realtime and role-fixture actions are not retried or bundled into it.
Even an eventual local PASS is synthetic/manual (`automatic_stable_day=false`),
not historical 9/23 success, natural Production stability, external ContentOS
delivery, anonymous Browser or Realtime validation.

## Source preparation outcome

The six new scope-specific files are implemented. The pure preparation suite
passes 75/75 checks, including canonical holiday/weekend rejection, whole-input date invariance, old-source pins,
all 27 retained-table guards, key2-only provenance and exact business-stage tail
preservation. Producer source is now frozen at SHA256
`6d767876c0899af5524c6e3225854dfe72ef02cb8c41b4feb9ed275025dce2e5`;
its independently executed focused suite passed 23/23 and combined suite 230/230.
No fresh-scope bootstrap or business chain has executed as of these source bytes.
Keep this preparation document immutable once its execution manifest is pinned;
record actual results separately, including any failure.


## Retained non-executed holiday preparation

The first scope preparation selected 9/25 incorrectly; the existing canonical
calendar identifies it as the Mid-Autumn holiday. No bootstrap, clock, Auth or
business call occurred. Its 66/66 checks were technical preparation only, not a
trading-day or E2E PASS. All six prior source bytes are retained in
`/private/tmp/ma-factual-export-20260925-unexecuted-source-preimages.tar`, SHA256
`723b986204591b65cc9cbe5e9833c70a2ab82f60b84e9aaf8dabb25105a56d93`.
The original `full-chain-synthetic-20260925.json` remains unchanged in the repo.
The corrected 9/29→9/30 fixture is an exact +7-day transform of executed 9/23,
checked against both the canonical Taiwan calendar and completed New York cash
sessions. The old holiday source is never passed to the runner.
