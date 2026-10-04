# Phase 1 local candidate verification

2026-10-04; Node 22.23.1; PostgreSQL 17; no production writes.

| Check | Actual result | Scope |
| --- | --- | --- |
| Foundation + existing operational/public Integrity | 22/22 PASS | Exact 142-file core freeze and unchanged predecessor integrity. |
| Fresh isolated database | 90 assertions PASS | New `ma_10k_phase1_test3`, real RLS/ACL/FK/trigger behavior; synthetic dependency schema, no production copy. |
| Role matrix | PASS | Anonymous denied; member/paid/unlisted admin see no research rows; explicitly enrolled synthetic owner read-only; service role insert/read only. |
| Source linkage | PASS | Wrong date/revision/report level rejected, late FORWARD and future signal rejected, frozen outcomes survive source correction, invalid outcome rejected. |
| Immutability | PASS | Update/delete/truncate rejected; no new promotion function; duplicate measurement rejected. |
| Type-check | PASS with project-local type roots | External ancestor `react 2` / `react-dom 2` dirs cause the unmodified local command to fail. No source/config relaxation; `npm run type-check -- --typeRoots ./node_modules/@types` passes. Clean GitHub must run standard command. |
| Lint | PASS | `npm run lint`, zero warnings. |
| Build | PASS | `npm run build`, Vite 8.0.16. |
| Browser desktop/mobile | PASS | Isolated agent-browser session, local synthetic data, 1280-wide and 390-wide view; 11 features and explicit unmeasured quality, no overflow or Vite overlay. |
| Browser authorization states | PASS | Paid denied; stale in-flight owner response after sign-out stays denied; absent RPC is unavailable, not production fallback. Real SQL authorization is separately tested above. |
| Browser external resource count | 0 | CSP + local-only browser allowlist; production Supabase module replaced by test-only mock. No real identity used. |
| Browser page errors | 0 | Dedicated synthetic preview session only; no access to other browser tabs. |
| Production strategy / Recommendation / LINE / Cron | NO CHANGE | No core/shared/function edits; no fetch/dispatch/deploy/migration invoked. |

The browser harness is serve-only: `MA_RESEARCH_PREVIEW=SYNTHETIC_ONLY node node_modules/vite/bin/vite.js --config tests/browser/researchFoundation.vite.ts`. It does not load production `.env` or the production Vite config. Screenshots are local temporary evidence, not proof of production availability.

GitHub results must be read from the PR at its exact HEAD, not inferred from this local evidence. Required candidate gates: unchanged **Validate release** and additive **Research foundation gate**. No merge or production operation is authorized by this document.

First GitHub attempt at `556a88a`: research/RLS gate passed, as did the clean standard type-check and lint. Full Release CI exposed the tracked new workflow as an unregistered Core-inventory successor (32 dependent Integrity failures with the same cause). The narrow test-only successor adapter and exact three-file transition now preserve all earlier manifests/hashes and reject unknown candidate drift. No business implementation was changed to address that gate.

Follow-up local candidate/lineage run: 36/36 PASS (`researchFoundation`, `researchFoundationIntegrity`, `publicProjectionIntegrity`, `operationalMarketIntegrity`, `premarketAtomicInventory`). This includes unknown-file/hash/predecessor/renamed-migration rejection and preservation of the original 109→110 inventory; no expected-count relaxation.

Additional directly affected historical Integrity suites: 125/125 PASS (`consolidationAcceptanceDefaultIntegrity`, `consolidationDeliveryIntegrity`, `consolidationIntegrity`, `productionReliabilityBaselineTransition`). Original protection against co-mutated manifests, source tampering, omitted registrations and authority escalation remains active.

Interpretation limits: schema lineage is not a finished evidence resolver or sealed full AnalysisGraph producer; Phase 2 must validate each referenced evidence ID and the complete graph before calculating analysis metrics. Method feature associations, complete hypothesis validation, forward collection and production promotion remain future reviewed workflows. No research row in this candidate can be consumed by an existing production strategy path.
