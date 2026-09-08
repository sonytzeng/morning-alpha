# Subscriber state contract incident — 2026-09-08

## Production rollback: completed, not a healthy-day claim

The owner approved restoring only the pre-`fc127b0` Payload v42, Health v20,
and the three saved Publication RPC definitions and original private ACL.
The remaining candidate deployments were stopped. No producer, recovery,
notification or private RPC was invoked as part of the rollback.

| Component | Restored source | Platform version after redeployment | Verification |
| --- | --- | --- | --- |
| `get-report-payload` | Original v42, all 10 archived files | v44 | Every file byte-equal to saved v42 |
| `ma-ops-health-check` | Original v20, all 5 archived files | v22 | Every file byte-equal to saved v20 |
| Publication RPCs | Exact definitions saved before `fc127b0` | Compensating definition-only migration | Definitions, signatures, owner, security, search path and ACL equal |

Platform versions are monotonic; v44/v22 do **not** mean new candidate behavior.
Do not report the deployed platform version as v42/v20. Those are the restored
source identities.

Payload original entrypoint SHA-256:
`50869c00bb4c6cbe176eb5b05382544b3200d5f9787ba9d90830327aea047e82`.
Health original entrypoint SHA-256:
`296f4bd106e1ab00d5cf82a9637462b8091380536658964ebb2c0e073c71ba32`.
Exact saved rollback SQL SHA-256:
`0fcdfc130e3ce509fc79ed2d67fcabd27ac3caf55bd94dd053b1666b1a110627`.

The definition-only migration restored:

- `enforce_decision_snapshot_premium_90_gate_v1()`;
- `publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb)`;
- `publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)`.

Before/after query evidence found zero differences in the audited report,
decision, member-content, raw-market, immutable checkpoint and acceptance rows,
quality policy, trigger binding, Cron hash, RLS/policy hash, protected RPC ACL
and LINE receipt hash. Fetch v64 was not changed. No market-only publication
existed at rollback time. Business-data repair was neither authorized nor run.

Rollback verification artifact:
`market-publication-fc127b0-release/authorized-rollback-verification.json` in the
existing external incident-evidence directory. The original failure artifacts
and deployment source archives are retained alongside it, not overwritten.

Post-rollback anonymous payload and actual Chrome Today smoke returned HTTP 200
with the real 2026-09-08 report identity and restored insufficient-data state.
The observed 100/100 confidence and completed seven-step conclusion disappeared.
This proves restoration of the prior reader, **not** Production Acceptance PASS.
2026-09-07 and 2026-09-08 remain failed days and cannot count as automatic stable
days. No new Production deployment is authorized by this document.

## Actual regression

The candidate reader exposed an unpublished `PARTIAL` QA decision and its
confidence value to the already deployed subscriber UI. That UI interpreted
the QA `STOP` plus a legacy closing result as a completed invalidated decision.
Real captured market checkpoints were also confused with completion of a
published decision lifecycle. Restoring prior source does not erase this root
cause or convert the failed release into a successful one.

Publication, analysis completeness, recommendation eligibility, confidence and
closing verification need one versioned read contract. The new local candidate
must also sanitize legacy aliases so an old frontend cannot recover the unsafe
QA interpretation from another field. Updating a new UI alone is insufficient.

## Local candidate scope and acceptance

This follow-up changes only the read-side Payload/Subscriber state projection,
its shared pure schema, affected subscriber consumers and focused regression
evidence. No generator, Fetch, recommendation strategy, Prompt, publication
RPC, migration, Cron, Auth, RLS or delivery behavior is to be changed.

Required cases, including contradictory legacy fields, are:

| Input | Required subscriber result |
| --- | --- |
| READY + verified published identity | Current published market decision |
| PARTIAL + unpublished | Analysis incomplete; not failed, invalidated or closed |
| Market READY + recommendation BLOCKED | Market report available; no stocks or invented score |
| Closing NOT_DUE | No closing result or completed closing step |
| Closing COMPLETE + matching evidence | Closing result allowed |
| Insufficient evidence / missing confidence | Unavailable confidence, never 100 |

The same report date and revision must survive an unpublished current-day
response; a previous holiday report is not an acceptable substitute.

Fresh final-source contract, old-client compatibility, actual isolated
Auth/Payload/Browser state matrix, DB integration, type-check, lint, build,
Edge/Deno, integrity and CI evidence is required. Earlier green counts belong
to the failed candidate and cannot be reused as proof for this fix.

Until those checks complete, the new candidate is NOT_READY. Even when they
pass, it stops at a new Production Deployment Approval Gate; `fc127b0` must
not be redeployed.

## Final local evidence (not Production acceptance)

The frozen source patch is
`docs/operations/evidence/subscriber-state-candidate-20260908-v6.json`,
SHA-256 `0fea753d274be2c3a28246d36001992ca8c332bc92f30ad9ca4fc9138c88ecd4`
of `patch_lines.join('\n')`, based on
`fc127b0cbb1169974d44df3fc43fa009e1e5740f`. All 22 source/test/contract-document
hashes matched before and after the final local run. Earlier source artifacts
are retained as incident lineage, not represented as fully passing candidates.

| Exact-source local check | Result |
| --- | --- |
| Node 22.23.1, `node --test tests/*.test.mjs` | 492 passed, 0 failed |
| Deno 2.9.2 contract suite | 57 passed, 0 failed |
| Six existing Edge entrypoints, `deno check --no-lock` | Exit 0 |
| Isolated PostgreSQL migration twice / atomicity / publication | 13 passed, 0 failed |
| Type-check | Exit 0 |
| Lint, including the shared pure contract | 0 errors / 0 warnings |
| Production build (local artifact only) | Exit 0, 2.91 seconds |
| Original integrity checks | 4 passed, no original baseline/test changes |
| `git diff --check` | Exit 0 |
| Actual isolated Browser | 252 passed, 0 failed |

The Browser total is 105 baseline route/role/viewport cases, 140 cases covering
seven subscriber states across four routes at 375/390/430/768/1440 pixels, and
seven real history-payload assertions. It uses local Auth/PKCE, server-derived
free/member/admin entitlements, real RLS and real Edge responses; it does not
intercept Product payloads or fabricate browser authority. Local provider input
is synthetic and cannot prove official market/provider delivery.

Browser result SHA-256:
`c856be995e42000522f0b8708dc1435498d8e1303aff07511bda1ad87b8203e5`
(`ma-subscriber-state-e2e-20260908T1007-v6/subscriber-state-results.json` in
private temporary evidence). It records 59 checked payloads and 4,706 HTTP
responses, zero unexpected HTTP/Console/request/WebSocket failures and three
intentional private-table HTTP 403 rejections. All synthetic business fixture
fingerprints were restored exactly; Production requests were zero.

DB result SHA-256:
`2e699cdcd1462813fe11dc4161f04509e2570afd34da13563b7301b265111caa`
(`ma-core-final-20260907/subscriber-state-final-db-202609081105-result.json`).
Only two newly named loopback test databases were used; earlier databases and
failure evidence were retained.

The actual Browser uncovered three additional consumer defects, fixed without
changing market/research gates: incomplete analysis was hidden in Home details;
the recommendation-blocked notice was not visible and empty lists implied a
completed stock screen; and Home's Morning Brief repeated an internal
`綜合評分 100/100` reason. The final read-side reason projection drops only
standalone unbound assessment-score clauses, retaining adjacent market facts
and legitimate numeric facts. Formal canonical confidence 90 and qualified
stock 2330 remain visible in positive controls. Missing canonical confidence
is unavailable, not a quality-score fallback. A separate evidenced Decision V1
model-confidence value is not relabelled as canonical report confidence.

The three obsolete source-copy assertions demanding empty-list success claims
were replaced with stricter assertions requiring the actual blocked notice and
forbidding unsupported completed-screen claims. Browser state assertions were
not relaxed. Failed V3/V4/V5 runs and the V5 failure-only H2 diagnostic remain
preserved; none count toward the final 252 passing cases.

This is local validation only. New-commit CI must pass after the authorized
feature-branch commit/push. The old `fc127b0` CI is not new-candidate evidence.
No additional Production deploy, migration, merge, notification, recovery or
business-data write is authorized or performed by these tests.
