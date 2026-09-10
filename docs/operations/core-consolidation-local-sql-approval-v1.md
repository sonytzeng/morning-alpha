# Core Consolidation — exact local SQL safety boundary

## Status

### Named local approval received; isolated validation in progress

The latest Owner instruction explicitly authorizes this exact migration file,
the five existing functions and one private validator below, and isolated local
execution while retaining their signatures/defaults/owner/private ACL/security,
search path and trigger semantics. It does **not** authorize Production SQL,
business writes, Cron, Recovery, LINE, deploy or merge.

The complete local SQL patch was accepted after that new named authorization.
Candidate SHA-256:
`9ffeab7260179ce68b2160dc1daec365841cbe4e554910717bc9060ff53df869`.
Fresh loopback database regression run 06 passed **11/11** in 14.73 seconds,
including two applications, all five original catalog contracts, trigger/RLS
parity, atomic rollback/reuse, independent market versus stock evidence, frozen
opening identity, durable Closing/Learning receipts and raw producer lineage.
The test does not rewrite the preserved synthetic September 7/8 failure rows,
and historical/manual replay cannot become an automatic stability day.

The subsequent fresh loopback run 07 passed **12/12** in 23.59 seconds
(`/tmp/ma-core-consolidation-db-20260909-07.log`). It retains the original 11
database cases and adds a 17-negative-case transport proof test for the CI
service. CI may target only its verified local Docker Postgres service, not an
arbitrary server address. Candidate SQL remains hash-identical; the database
test SHA-256 is
`66933cf5e44a8fd44f11d2b33140b6a273eb3ae9b500fade56ff6ae3cff78d6a`.
This local result is not a completed GitHub Actions run.

A separate new Supabase stack, `ma-consolidation-v1-20260909133500`, rebuilt
the canonical foundation and the 31 tracked/explicit candidate migration inputs.
Operational-only exclusions are recorded per statement, not silently skipped.
Its post-rebuild Auth users, reports, raw snapshots and immutable checkpoints
are all empty. All six services attach only to its `Internal=true` network in
the dedicated shared-clock VM. Host access uses loopback-only proxies; the VM
retains default-deny external egress. This is **Clean Rebuild PASS**, not yet a
complete real-handler E2E result.

### Preserved earlier refusal record

### Reviewed local evidence-contract revision (run 09)

The final reviewed local SQL source is now
`2b92f90af55ae0ec6a61ca4a6bdc0e3333a1f80b298e1c2c1a2877f37917838f`.
Run 09 passed **13/13** isolated database cases in 32.38 seconds. The original
12 cases remain; the added parity group rejects missing/foreign canonical
evidence IDs, unknown or missing freshness, and duplicate source tuples. Actual
producer `previous_trading_day` / `previous_report` contexts are accepted only
for their corresponding dated sector/report sources. No evidence threshold,
Auth rule or ACL was relaxed. The original run 06/07 records above are retained,
not relabeled as results for this new source.

The same hash was applied to the dedicated shared-clock local Supabase after
the earlier clean schema rebuild. This reapplication independently verified all
six function catalog metadata records and all public trigger definitions were
unchanged; reports, raw snapshots, immutable snapshots, decisions and dispatches
remained zero. The new receipt is
`/private/tmp/ma-consolidation-v1-20260909133500/schema-reviewed-reapply-20260909-09.json`.
The original rebuild receipt and failed bootstrap attempt remain intact.
This demonstrates the final local SQL state and preserved private contract,
not completed real-handler E2E or Production acceptance.

### Earlier safety-review context (unchanged)

The branch is `codex/core-pipeline-consolidation-20260909`, based on
`6469630795fb1215595306c026437d850b668801`. Production observation is not the
reason work was blocked. The earlier security-review refusal was
**authoring replacement SQL definitions**, not running Production SQL.

The denied target is
`supabase/migrations/20260909015650_core_market_publication_contract.sql`.
It remained empty at that refusal. No candidate migration had been applied to
any database. The denied action was not split or moved to a different execution
channel; authoring resumed only after the new explicit named approval above.

The reviewer treated the replacement publication/acceptance functions,
trigger function and owner/grant statements as production-sensitive migration
scope requiring explicit named authorization even for local authoring. The
existing general branch/consolidation approval did not satisfy that review.

## Exact authoring scope requiring authorization

| Existing function | Signature to retain | Existing security mode |
| --- | --- | --- |
| `enforce_decision_snapshot_premium_90_gate_v1` | `()` returns trigger | INVOKER |
| `publish_research_bundle_v1` | `(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)` returns jsonb | INVOKER |
| `publish_member_content_revision_v1` | `(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb)` returns uuid | DEFINER |
| `publish_decision_snapshot_v3` | `(date,text,uuid,jsonb,uuid,text,integer)` returns uuid | DEFINER |
| `capture_morning_alpha_acceptance_v1` | `(date,text)` returns uuid | DEFINER |

One new private validator is proposed:
`validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)`
returning jsonb, INVOKER, empty `search_path`, postgres owner and
service-role-only execution. It must not become an anon/authenticated RPC.

The existing trigger attachment is
`decision_snapshots_premium_90_gate BEFORE INSERT OR UPDATE OF
status, content_score, decision_mode ON public.decision_snapshots`.
Its timing, events and attachment are to be retained, not replaced with a
new lifecycle trigger. Existing function defaults, owner, private grants,
security mode and `search_path` must be checked against the captured schema.
No RLS/Auth/ACL weakening is authorized or proposed.

## Intended behavior — not an executed result

- Replace duplicated market-publication evaluations with one strict,
  evidence-bound market contract; market coverage and unsupported-claim
  requirements remain 100% / 0, with the existing editorial and semantic gates.
- Keep stock recommendation evidence independent. Suppress unsupported stock
  claims instead of lowering their gate or blocking an otherwise valid market
  publication.
- Persist the same atomic publication identity and a frozen original opening
  identity. Do not select an unrelated current QA revision.
- Require durable real closing, learning and delivery receipts for acceptance.
  A mock result, elapsed time or a manual recovery is never an automatic
  stability day.

The full chain cannot be declared passing while its actual SQL publication,
trigger and acceptance contracts still execute the old coupled behavior.
Pure tests or earlier isolated-stack results cannot replace this verification.

## Minimal explicit approval text

> 核准僅在 `codex/core-pipeline-consolidation-20260909` 本機分支編寫
> `20260909015650_core_market_publication_contract.sql`，更新上表五個具名
> Function，新增上列 private validator，並在全新、loopback、無外網的
> 隔離 Supabase DB 執行 migration 重複套用與完整閉環測試。保留既有
> Function signature/defaults、owner/private ACL、security/search_path、
> trigger timing/event/attachment，不降低 RLS/Auth/Evidence Gate。
> 本次不核准任何 Production Migration、Deploy、Recovery、Cron、
> LINE、會員或歷史市場資料變更。

After that named local scope clears safety review, finish the SQL contract,
fresh-stack real-handler E2E, exact append-only integrity registration, full
regression, then the already-authorized branch Commit/Push/CI/Preview gates.
The final Production Release Gate remains separate.

## Sixth existing terminal function: approved local successor and DB15 evidence

Sony subsequently gave separate, explicit local authorization for the existing
`reconcile_runtime_terminal_failures_v1(date,uuid) RETURNS integer` in this
same candidate migration. The exact boundary and preserved catalog evidence
are recorded in `core-consolidation-terminal-rpc-local-approval-v1.md`.
The source now contains six existing functions plus the same private validator;
old migration files, original ACL and earlier failed artifacts remain intact.

DB14 completed 21/22, exit 1 (24.581 seconds). Its new diagnostic-status
negative incorrectly treated private member quality as a market gate. That test
expectation was corrected to the already-reviewed diagnostic isolation contract,
not by weakening the validator. Actual member canonical-text/identity, semantic,
receipt and frozen-evidence negatives remain strict. Both the DB14 database and
`/private/tmp/ma-core-consolidation-db-20260909-14.log` are retained as FAIL.

The reviewed successor also rejects missing/insufficient frozen quality and
co-mutated canonical identity/version in both Terminal and Acceptance. It reads
actual frozen metadata; no `complete` measurement is fabricated by the SQL
wrapper. Fresh DB15 passed **24/24**, exit 0, **108.138 seconds**, Node 22.23.1.
All original 15 test callback bytes are unchanged; nine new cases cover sixth
function catalog parity after repeated application, real market-only receipt
positive and fail-closed negatives, private-QA isolation, original failed receipt
and attempt preservation, same-job-only replacement, transaction rollback,
concurrent idempotency and absence of artificial natural-stability completion.

| Evidence | SHA-256 |
| --- | --- |
| Candidate SQL | `353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0` |
| `tests/coreConsolidationDatabase.integration.mjs` | `d88db9bfb8ef8ba45b7a71e4fbeb73d2c0bf07a88781446d448ac00b421641e8` |
| `/private/tmp/ma-core-consolidation-db-20260909-15.log` | `f808d1e489814e57658a8d2d9bd52b048aa32a65e4b0df958bb56fdb582d6dfb` |
| Ordered original 15 name/body-SHA map | `dbbafade8d4b46d897db16decf64d3b31d1f8e86d084924deae24dcd10b65f81` |

Catalog checks preserve all six original signatures/defaults, owner/private
ACL/security/search_path, the unchanged V2 primitive, original trigger/RLS
metadata and September 7/8 FAIL fixtures. This result is a fresh isolated SQL
regression, not real-handler full-chain PASS or Production acceptance. The
previous terminal replay FAIL is not relabeled, and Seventh Integrity remains
unsealed pending the actual replay and exact final source review.
