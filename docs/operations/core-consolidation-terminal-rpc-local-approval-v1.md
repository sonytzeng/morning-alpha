# Core Consolidation — exact terminal RPC local approval boundary

## Proven failure, not a Production monitoring wait

The real isolated full-chain attempt `42894738-5b25-4d13-84c6-6e5ee8fb2fdf`
in `ma-consolidation-v1-20260909154500` stopped at the actual orchestrator's
terminal reconciliation call with HTTP 409:
`TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED`.
The synthetic business date was 2026-09-17. Generator, atomic publication,
public/member payload, one local LINE receipt plus deduplication, all six
checkpoints, Closing, Learning, and closing health had already passed their
actual-handler/persistence assertions. Acceptance was not reached. The result
remains FAIL, with SHA-256
`15ecbabac65df46280bd342c5191a636708b06f96ffe6ead75ccdab19c8ae7ca`.
External provider/AI/LINE transports were explicit local test doubles; Auth,
RLS, SQL functions, handlers and persisted receipts were real local execution.

The read-only database join proved that the same current PREMARKET snapshot
is READY, its member revision is PASSED, its editorial review is APPROVED,
and the exact snapshot/member/version semantic review is PASSED with no reasons.
Its decision mode is `market_only`. The old SQL allows only `recommendations`
or `no_trade`, so that predicate is false. There are no failed dispatches or
dead letters in this fresh scope, but the function raises before examining them.
Skipping the function or relabeling the report `no_trade` would mask the defect.

Source: `supabase/migrations/20260907030607_core_research_atomic_publication.sql`,
lines 178–224, file SHA-256
`a3a683a947fd8a16e155ac3c09e4434599ac5e28e133882a37ef495c79b3f542`.
Caller: `supabase/functions/daily-delivery-orchestrator/index.ts`, the existing
`health_check` / explicit manual recovery terminal branch.

## Exact preserved catalog contract

| Property | Actual isolated catalog value |
| --- | --- |
| Function | `public.reconcile_runtime_terminal_failures_v1(date,uuid)` |
| Parameters | `p_business_date date, p_correlation_id uuid`, no defaults |
| Return | `integer` |
| Owner | `postgres` |
| Security | `SECURITY DEFINER` |
| Search path | empty string |
| ACL | `{postgres=X/postgres,service_role=X/postgres}` |
| PUBLIC / anon / authenticated execution | denied |
| service_role execution | allowed |
| Catalog definition SHA-256 | `56c218ab3052929ea74f3de9326112d423cc56f6a90e0c9504a1bca40567a2c7` |
| Catalog body SHA-256 | `9b6ef871f024a917c9483ffaddf16aa0bbcf7a5b8e26c537d9aeefd671e760c5` |

The catalog body matches the existing migration body byte-for-byte. This is
local catalog evidence, not a new claim about deployed Production source.
No RPC was invoked by this diagnostic query, and no business row was changed.
The full scope/network/catalog/join diagnostic is preserved at
`/private/tmp/ma-terminal-reconciliation-readonly-audit-20260909.json`, SHA-256
`24379f16d8b52c5c8963e4d4c30faeb5efc93c2e47d975c577798ed21fe77337`.

## Historical approval boundary before the explicit terminal extension

`core-consolidation-local-sql-approval-v1.md` and the latest explicit instruction
authorize exactly five existing publication/trigger/acceptance functions plus
one private validator. This terminal SECURITY DEFINER function is a **sixth
existing function**, not one of those five. The proposed repair is not authored
or applied under that narrower permission. Old migrations, original definitions,
original ACL and all failed artifacts remain unchanged. No Integrity seal claims
that this unimplemented repair is approved or tested.

## Minimal additional authorization requested

> 核准僅在 `codex/core-pipeline-consolidation-20260909` 的本機 candidate
> migration 中追加修正既有
> `public.reconcile_runtime_terminal_failures_v1(date,uuid) RETURNS integer`。
> 將其 publication 前提收斂至既有 canonical Market Publication validator
> 與精確已提交 receipt／report／snapshot／member identity，讓有效
> `market_only` 不被 Recommendation gate 反向阻擋；不得只略過 gate。
> 保留原 signature、default、owner、private ACL、SECURITY DEFINER、
> 空 search_path、same-job/checkpoint/endpoint durable-success replacement
> 規則及原始 FAIL 證據；不改舊 migration，不降低 Evidence／Auth／RLS。
> 核准在全新、無外網的隔離本機 Supabase 執行重複套用、ACL parity、
> 正反例與完整閉環測試。不得手動改 business outcome 或 lifecycle 湊 PASS。
> 本次不包含 Production Migration、Deploy、Recovery、Cron、LINE、
> 會員或市場歷史資料修改。

The added regression must test a real committed market-only positive control,
wrong/missing publication receipt and revision negatives, absent/mismatched
semantic/evidence negatives, unchanged recommendation rejection, same-job only
terminal replacement, no duplicate dispatch, original failure preservation, and
no artificial automatic-stability day. The existing six SQL definitions and
their parity tests must remain intact.

After this exact local scope is approved: author the bounded forward migration,
clean rebuild, run the real terminal and Acceptance path, re-run the frozen
state/route/Browser and full regression gates, then append the exact reviewed
integrity successor and continue the previously approved branch Commit/Push/CI
and Readdy Preview workflow. Production remains untouched.

## Explicit local extension received — 2026-09-09

Sony explicitly approved the existing `reconcile_runtime_terminal_failures_v1(date,uuid)`
definition in the current local candidate migration, preserving its signature,
owner, private ACL, security/search_path and historical failure evidence. This
adds one named existing function to the prior five-function scope; it does not
authorize any Production invocation, migration, recovery or business-data write.
The preceding denied/unimplemented attempt and failed replay remain preserved.

The candidate reads the report-bound committed revision/member and exact
successful atomic publication receipt, reuses the existing private market
validator on the frozen documents, and preserves same-job/checkpoint/endpoint
later-success reconciliation. It no longer uses mutable `is_current` research QA
or a two-mode recommendation whitelist as the market terminal authority.
No RPC is executed by the migration itself. Full-chain, adversarial persistence
and catalog parity results must be recorded separately before claiming PASS.

## Local regression record — DB14 retained, DB15 passed

DB14 (`ma_core_consolidation_test202609092014`) finished **21/22**, exit 1,
in 24.581 seconds. Its only failure was a new test expecting the receipt-bound
member row's private diagnostic `status='BLOCKED'` to veto market publication.
That expectation was inconsistent with the existing market authority contract:
private member status/content-score/evidence-score are diagnostics, while the
frozen market evidence/editorial, exact member canonical text/identity, semantic
review and actual publication receipt remain mandatory. The business validator
was not weakened to make the test pass. The new test was corrected to assert
diagnostic isolation, with separate canonical-text/identity corruption negatives.
The original DB14 and `/private/tmp/ma-core-consolidation-db-20260909-14.log`
remain unchanged; this is not a passing result for that earlier source.

Independent review additionally found two real fail-closed gaps, repaired in
the approved functions: frozen `data_quality`/`missing_sources` must be consumed
as persisted rather than reconstructed as a hard-coded success; and canonical
snapshot ID/version must match the actual bound row even when multiple JSON
copies are co-mutated consistently. Terminal and Acceptance both reuse the
same private validator. The fixture freezes the producer's existing measured
`data_quality`, `missing_sources` and `content_evidence_quality`; it does not
derive those measurements from a desired score.

DB15 (`ma_core_consolidation_test202609092015`) passed **24/24**, exit 0,
in **108.138 seconds**, using Node **22.23.1** and the existing guarded
`127.0.0.1:55439` PostgreSQL harness. Candidate SQL SHA-256:
`353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0`.
Test source `tests/coreConsolidationDatabase.integration.mjs` SHA-256:
`d88db9bfb8ef8ba45b7a71e4fbeb73d2c0bf07a88781446d448ac00b421641e8`.
Log `/private/tmp/ma-core-consolidation-db-20260909-15.log` SHA-256:
`f808d1e489814e57658a8d2d9bd52b048aa32a65e4b0df958bb56fdb582d6dfb`.

The original **15 test callbacks remain byte-identical**; their ordered
name/body-SHA map hashes to
`dbbafade8d4b46d897db16decf64d3b31d1f8e86d084924deae24dcd10b65f81`.
Nine appended cases verify the sixth original catalog contract across two
applications; real atomic market-only publication returning zero repairs;
durable identity/semantic/frozen-evidence rejection; private diagnostic and
new-current-QA isolation; eight independent Acceptance negatives; thirteen
same-job/checkpoint/endpoint/time/response matching negatives; all three original
failed statuses with original payload/attempt preservation; atomic rollback on
a later persistence failure; and two independent psql clients repairing once
with an exact zero-effect retry. Owner/private ACL/security/search_path,
original trigger/RLS metadata and September 7/8 FAIL fixtures are preserved.
No dispatch, LINE receipt, lifecycle completion or natural-stability day is
created by a zero-repair terminal call.

These are isolated database regressions with explicitly synthetic provider and
historical timing fixtures, not a completed real-handler full-chain replay.
The earlier full-chain terminal FAIL remains FAIL; Acceptance and final Seventh
Integrity sealing still require their separately recorded actual replay result.
No Production SQL, deployment, Cron or historical business-data operation occurred.
