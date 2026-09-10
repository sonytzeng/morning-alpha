# Fresh 13-handler local public-export replay — execution review artifact

Status: source preparation only. The new VM, containers, database, credentials,
Auth identity and 13-handler business chain have **not been created or run**.
The 33 preparation checks are not a Supabase or publication PASS.

## Exact isolation boundary

| Resource | Exact proposed value |
| --- | --- |
| Scope | `ma-consolidation-v1-20260909183000` |
| Work directory | `/private/tmp/ma-consolidation-v1-20260909183000` |
| Evidence directory | `/private/tmp/ma-consolidation-v1-20260909183000-evidence` |
| New dedicated VM root | `/private/tmp/ma-clock-20260909-183000` |
| New LIMA_HOME / instance | `/private/tmp/ma-clock-20260909-183000/lima` / `clock` |
| Docker transport | `unix:///private/tmp/ma-clock-20260909-183000/docker.sock` |
| Internal-only network | `ma-consolidation-v1-20260909183000-isolated`, `172.21.0.0/16` |
| Loopback API / PostgreSQL / mail / receiver / optional frontend | `55491 / 55492 / 55493 / 55494 / 4326` |
| Synthetic dates | manual input-only warmup `2026-09-22`; main `2026-09-23` |
| Runtime config schema | `CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V3` |

The old VM `/private/tmp/ma-clock-20260909-020052` is forbidden as the clock
boundary. Its boot ID `2879f43f-0819-4a08-88dc-195166474350` is explicitly rejected.
No shared guest clock may be advanced: that would also affect old Auth runtimes.
The new VM needs a newly observed boot ID and an exact configuration hash; these
cannot be invented in this preparation artifact. The existing host clock is
never changed. The new guest clock only moves forward after identity checks.

Use the already cached local VM/container tooling and official images. A fresh
VM disk may use the cached base image bytes, never an old VM disk, volume, data,
Auth session, `.env`, Vault or credentials. The previously used local base image
digest was `sha256:1fc0354f4f99734ce3886628cc7af8b0437c1a1d391b126bd09cba0df35ee53f`;
its bytes must be verified before use, not downloaded or substituted silently.
The VM must retain `plain: true`, `mounts: []`, `networks: []`, no SSH-agent/key
forwarding, default-deny IPv4/IPv6 OUTPUT/FORWARD, no host resolver, and verified
disabled guest time synchronization. Do not create fake service/clock witnesses
if the fresh OS differs from the previous VM; report the actual dependency.

## Intended side effects, subject to normal safety review

1. Create only the exact new VM root, private Docker configuration, work and
   evidence directories. Refuse existing paths, occupied ports, old containers,
   old network membership and nonempty database tables. Keep all previous
   environments, FAIL/PASS files and original 96-run hashes intact.
2. Start a new local VM from the verified base image; create one internal Docker
   network and loopback-only SSH/proxy transport. Copy only immutable official
   image layers from the local cache. No vendor/business internet egress.
3. Start new PostgreSQL, GoTrue, REST, Kong, mail and Edge containers plus the
   existing genuine local provider receiver. All containers must belong only to
   this new network. No Realtime, Studio, Storage or external SMTP is required
   for this API/persistence lane. No service in any previous scope is restarted.
4. Generate fresh local JWT signing material, DB password, internal test token,
   dummy provider/LINE tokens and one `@example.invalid` Auth fixture password.
   Store owner-only, do not print values, do not read/copy old local or Production
   secrets, and do not put credentials in repository files or evidence output.
   Create **one ordinary synthetic Auth user** in the new GoTrue instance using
   its normal API. No Admin/Member entitlement fixture, existing account update,
   role grant, Auth bypass or session transplant is permitted.
5. Initialize only the new empty PostgreSQL instance with the existing schema
   preparation exclusions and exact reviewed candidate SQL
   `353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0`.
   Preserve signatures, owners, ACLs, SECURITY modes, search_path, RLS and real
   trigger attachments. Do not replay operational Cron/Vault/owner backfills.
   The existing `record_content_os_incident_v1` and
   `resolve_content_os_incident_v1` definitions are not rewritten.
6. Build all 13 actual handlers from the reviewed source/import inventory with
   official pinned SDK dependencies. External quote/news/AI/LINE calls terminate
   only at the declared synthetic provider boundary. Do not replace the database
   transport, business clock, Auth validation, quality scores or RPC responses.
   Keep `verify_jwt = true` for **all 13 handlers and the boundary function**.
   Verify the actual mounted configuration and unauthorized HTTP rejection;
   do not rely solely on a self-declared config field.
7. Run the new fresh-only driver. Every required business table starts empty.
   The existing lawful manual warmup Fetch is input bootstrap only. The main
   date uses real Fetch → news → sector → Generator → atomic publication →
   payload → ContentOS export → local LINE → six intraday/close checkpoints →
   Opening/Closing → Learning → actual manual terminal handler → export retry →
   Acceptance. Preserve every stage request, response, durable receipt and FAIL.
   Only the new synthetic LINE subscriber is inserted; no real/existing recipient
   exists in this fresh database. Future Learning outcomes remain honestly
   pending; they are not completed to make the test pass.

These actions are not a retry of the refused public `verify_jwt=false` sibling
gateway, Realtime technical initialization or extra role-fixture actions. They
must be presented together, with these distinctions, to normal tool safety
review before execution. A denial is recorded and respected, not rerouted.

## Exact image inputs to re-verify in the new guest

| Component | Previously verified official image ID (immutable input only) |
| --- | --- |
| PostgreSQL | `sha256:f6cdd6bf9b556934e8a761d92d082488db206deeec9349c4e938a72d65677e80` |
| GoTrue | `sha256:b629f4d0a3a3f59e3429b1128d6f437d61db6cc1d0d067b35dad1042e88c0504` |
| REST | `sha256:488093de819567422bc1d37cb79da6e84bca3726bac321daeed618f0ed957888` |
| Kong | `sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d` |
| Mail | `sha256:37a38e48e9338cd7e89dfeb487f37b02ebfcd9cb23111bed2d345e79d37d6dd6` |
| Edge / receiver | `sha256:ac1fdaad6d62b892f3309578006ce208f4150bf2c484113cf2c32655ec7e6893` |

Observed local build tools: Node `22.23.1`, Supabase CLI `2.108.0`. CLI `start
--help` was read: it supports `--network-id` and `--exclude`; do not use
`--ignore-health-check`. No CLI `start` has been executed for this new scope.

## New source files and predecessor preservation

- `coreConsolidationPublicExportFullChain.e2e.mjs` is an independent copy of the
  sealed 12-handler driver (`b100f04377ab1d3da8f430dde3deb5ca0063ba07ea94fc09ea7722e9f135fa7c`).
  Changes: exact fresh V3 scope, separate helper import, method-aware GET export,
  true frozen citation identity checks before and after Closing, and explicit
  projection-only Acceptance scope. Old continuation branches cannot be entered.
- `../helpers/coreConsolidationPublicExportRuntime.mjs` copies the old runtime
  (`973000439d48b9341aa246d90aaa00198b70cf535889f715a5b586d4c60aa178`).
  Changes: sole new scope/13th handler, fresh-only config, all-JWT-true and one
  new-identity requirements, rejection of the shared VM, and scoped result labels.
  Eight original clock/credential/lineage/network/SQL-readback functions remain
  byte-identical and are independently checked by the preparation suite.
- `coreConsolidationPublicExportPrepareLocal.mjs` copies the old preparation
  (`a754b1dde917ace6f413aee6378a5073bd9a048fcb53cbe2fed4faad32fd1e7e`).
  Changes: only the new scope/network/socket and exact candidate SQL hash. It
  has not been executed and does not start a VM or generate credentials.
- `../fixtures/consolidation-v1/providers/full-chain-synthetic-20260923.json`
  retains the previous raw quote/AI prose bytes while advancing explicit source
  dates and unique `.invalid` news URLs. No citation ledger, audit score, accepted
  news flag, READY row or publication success is seeded.
- `../coreConsolidationPublicExportPreparation.test.mjs` covers 33 pure cases,
  including old-scope/clock/credential rejection and preserved predecessor pins.

Final candidate source pins must include the entire transitive import graph, not
only these changed sources. At review preparation, the relevant final bytes were:

| Source | SHA256 |
| --- | --- |
| ContentOS export | `b9430383ba63262bb9b10cacd2084d9c97a95f30090aa14b81c12e56834b7e61` |
| Canonical source metadata | `18c2aaed96714e76a2e7633a77d1107b212026ef8a9c5735829deadd8524febd` |
| Publication reader | `8ac709a88205190931c2c6a6ea7b0112e7d37ef21f0d12530bdf9da50cf09cf3` |
| Research assembler | `ae69f1cea99fb05be3168f6fd6f7627db3a18af600ed58247287bf62cfbaec46` |
| Generator | `b642e59f5a914c778270e358c81d4eeee92695a0ffb4b95d02558c43dc8d6e8a` |

## Commands after complete scope and bootstrap review

Pure preparation (already run; no external effects):

```sh
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test tests/coreConsolidationPublicExportPreparation.test.mjs
```

Only after a reviewed fresh stack is created and its actual source/image/JWT/
network/clock/bootstrap receipt manifest has been verified:

```sh
MA_LOCAL_SCOPE=ma-consolidation-v1-20260909183000 MA_CONSOLIDATION_REPLAY=LOCAL_ONLY DOCKER_HOST=unix:///private/tmp/ma-clock-20260909-183000/docker.sock /opt/homebrew/opt/node@22/bin/node tests/integration/coreConsolidationPublicExportPrepareLocal.mjs
MA_LOCAL_SCOPE=ma-consolidation-v1-20260909183000 MA_CONSOLIDATION_REPLAY=LOCAL_ONLY /opt/homebrew/opt/node@22/bin/node --experimental-strip-types tests/integration/coreConsolidationPublicExportFullChain.e2e.mjs --config /private/tmp/ma-consolidation-v1-20260909183000/replay-config.json
```

The new VM bootstrap, per-function JWT attestation, source/bundle manifest and
one-user Auth receipt still need implementation and review before these commands
are runnable. This document does not stand in for those receipts. No existing
96-run PASS or restored-output/counterfactual test result is adopted by this lane.
Even an eventual PASS means synthetic local source projection and durable core
processing, with `automatic_stable_day=false`; it does not demonstrate the external
ContentOS consumer, Production delivery, Realtime or anonymous Browser parity.
