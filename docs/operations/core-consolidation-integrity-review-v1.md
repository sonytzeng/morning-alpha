# Core Consolidation Integrity Review V1 — provisional attribution

Observed at **2026-09-09T02:57:43.506Z**. This inventory is read-only attribution against HEAD
`6469630795fb1215595306c026437d850b668801` on `codex/core-pipeline-consolidation-20260909`.
`origin/main` is `1bb06a047f38600be27f6e89a38b81baa5578706` (ahead 1 / behind 0).
The root and sibling agents were still editing; **these hashes are provisional,
not a final frozen candidate or an append-only approval**.

## Concurrent-edit delta at 2026-09-09T03:01:07.665Z

A second read-only pass found three files changed after the original snapshot.
The original tables below remain the earlier attribution; this delta supersedes
only the listed current hashes. There are now **3 changed protected declarations**,
with `buildHistorySummary` added to the two earlier entries. The 11 AI/prompt/
selection-policy declarations and all immutable anchors remained unchanged.
Tracked diff count remained 37 and registered file drift count remained 22.
This is still not a final source freeze.

| File | Earlier current SHA-256 | Later provisional SHA-256 |
| --- | --- | --- |
| `src/lib/subscriberReportContract.ts` | `40d205894a12a56fed14f5b73ecda3a11dc1d609e233f0d65fbc0df7215cad3c` | `f91300c20ae5cab74535949d2bae27e3706ed7dfb2d6cb66711a1d6c363d60c3` |
| `supabase/functions/get-report-payload/index.ts` | `0e8b5411a400d742e17b9620367e8bf66a88502af9f52ae6f09b82d97330746e` | `0410a147a91de72db133221f40cd14c8b486cf505c8ec8b88113e692c8e3168e` |
| `tests/coreRuntimeIntegration.test.mjs` | `210462d8713c76d837b6838b603b2e165142096a2a9e2397e64ec32ea3508579` | `13b2f7d8520d4b6c135b3f41ae6bfb48f2ec7992aabf5c34324f686da7522008` |

New protected declaration:

- Path/name: `supabase/functions/get-report-payload/index.ts#buildHistorySummary`.
- Original Production SHA-256: `0a08c59517a74a16b5c746d9b41f6a2c7e826a60e2e85b5f78c4771e72205c4a`.
- HEAD/effective registered SHA-256: `d403ea7baa3574ed6c9493296eb55df02eff1d0b957502ced7e12d5fd49d5f70`.
- Later provisional SHA-256: `b80bd0d09b6d1693a404387a796009bf1a12647985f4b68507d89a709e2eff08`.
- Reason: history/public payload forwards the explicit verified market publication
  contract into the shared subscriber Closing check, binding a frozen opening
  revision even when a newer current publication exists. A malformed present
  publication contract must fail closed; no SQL producer or durable full-chain
  execution is proven by this read-side change.

The subscriber contract now validates that explicit publication/current/opening
identity and preserves same-day due-time rules; the receipt cannot choose its
own comparison revision. The integration test additionally exercises the shared
opportunity formatter, independent paid evidence rejection, and wrong-semantic-
revision suppression. These are specific behavioral changes requiring tests,
not grandfathered by earlier file pins.

A new `tests/consolidationSubscriberEligibility.test.mjs` was observed
(10,354 bytes; SHA-256
`4505212d68e73fb1c16f7c0b7ef75d59e70c2a3f0985a0a4645ea245f2a73e34`).
The untracked candidate artifact count became 27, including that test and this
review document. The preserved unrelated set remained exactly 47. This document
is not self-hashed into its own review inventory.

## Original snapshot outcome and scope

- 37 tracked files differ from HEAD; 22 are covered by existing incident/first/second/third file pins and 15 are not covered by that registry's file set.
- All existing registered HEAD file hashes match their effective predecessor pins: **0 HEAD-to-registry drifts**. The working tree has **22 registered file drifts**. Those source changes require exact review/registration; a failed test is not an approved baseline.
- 698 Production protected declarations were compared using the same TypeScript top-level `getText` extraction as the preservation test. **2 changed versus HEAD**; no protected declaration was missing. Their original Production pins remain preserved.
- 11 explicitly identified AI prompt/abstention/selection-policy declarations match both HEAD and original Production hashes. No accidental change to those declarations was found. This does **not** claim that market selection, publication or display behavior is unchanged: the consolidation intentionally changes several of those consumers.
- 25 additional untracked candidate artifacts were inventoried separately. The known **47 preserved unrelated untracked files** are 45 duplicate-suffixed files plus two `docs/research/` artifacts; their contents were not reviewed or altered and they are not included as candidate changes.
- No registry, guard, original capture, Production source, migration definition or SQL was changed by this attribution task. Only this document is a repository write; the temporary read-only audit script is `/private/tmp/ma-consolidation-integrity-audit.mjs`.

The root's preceding diagnostic full Node result was **710 total / 636 PASS / 74 FAIL**:
72 old integrity-precondition drifts, one loopback EPERM awaiting scoped rerun,
and one real undefined-versus-null alignment failure subsequently fixed. This
inventory did not rerun or waive those tests and does not turn that result green.
Current full regression/CI/Preview outcomes must be recorded from a new exact
candidate run. DB/full E2E remain NOT_RUN. NEW_RELEASE_CANDIDATE is not READY.

## Immutable anchors — unchanged

| Artifact | HEAD and current SHA-256 |
| --- | --- |
| `docs/operations/core-stability-incident-amendment-20260908.json` | `7597edbd731636882e442faecd3bc4f8dd6f0701e07dd1ed7ddfe32e43b7505b` |
| `docs/operations/core-stability-source-manifest-20260907.json` | `bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c` |
| `docs/operations/evidence/subscriber-projection-candidate-20260909.json` | `4dbb461f7350ee3f6c8b8923174e9b4ff97d54e3220b99f9dfa7b06cdc0ea63d` |
| `tests/helpers/subscriberProjectionIntegrity.mjs` | `2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0` |
| `tests/coreProductionPreservation.test.mjs` | `c7d35e53e64b2512e09e338b4b898e86d2ed8618405860111f58e374bbf41575` |

The original source manifest hash is preserved, including every historical
Production artifact/declaration record. No live deployed source was fetched in
this task. “Original pin” below means the registry's historical
`baseline_sha256`/`production_hash` (or integrated manifest pin), not a claim
about the currently deployed source or a Git revision of Production. Raw saved
bundle-source hashes are listed separately where the manifest contains them.
A dash means no recorded original Production pin; one is never invented for a
frontend/test/new file.

## Changed registered files — exact hashes

For every row below, **HEAD equals the effective registered expected hash**.
The scope labels identify the existing registration layer, not approval of this
new change. Each current hash differs from that expected predecessor.

| File / protection scope | Preserved original pin | HEAD = registered expected | Provisional current SHA-256 |
| --- | --- | --- | --- |
| `src/lib/decisionPresentation.ts` (first.related_candidates) | — | `9f1ac35c9a6a5b809fc68a3f0276c62e0382bc87cd83603ebf331fcbe6f4a2ee` | `20843d8c46149ab0cef7dab08755aa09551164a39fc7c89e33780c9afee42f94` |
| `src/lib/runtimeDecisionTimeline.ts` (second.protected_files) | `a14950b57c9cc43416c0341d8023684041d75a9a864817f3b1767426a7eb41a4` | `9b9c86d1e98fd088a9d23a5ba2a0116a936a9d1e74235b89a896c6ae222ed55a` | `3329f669b5da5e4ef937b350b0ab9400ba4249e15717cc453856dd4d8358f094` |
| `src/lib/subscriberReportContract.ts` (second.related_candidates) | — | `ec7434a9b16ff44bcafc822faf16662dc95386fe4de0f9c8ca7fcb7abee1b346` | `40d205894a12a56fed14f5b73ecda3a11dc1d609e233f0d65fbc0df7215cad3c` |
| `src/pages/home/page.tsx` (first.related_candidates) | — | `4ee43aeaeeea561ed4e6a2bb4c558d463dd3ac2334cb836d85b77a6db88b5be0` | `d24664643cb393e130cca4dcba60c945bb3dde9b52025be4a8c1155ca3d2d6f8` |
| `src/pages/member-note/page.tsx` (first.related_candidates) | — | `e9d3feda9ccfdbc73bb622d4acc904e18e3000b235ff910eb7e7974f487d9501` | `9fa3f8d4aac669870c492b74c2c5f22d7ed856887f4e9a10acf320428fdbfb75` |
| `src/pages/opportunities/page.tsx` (first.related_candidates) | — | `5b42c634a10c219c398d6f228916970c3b661127abf4152c120dd7eccc2c5b41` | `588028bdb6103f041a3470c90da381a89184d892f3636ad3c4cde80a6fa82400` |
| `src/pages/performance/page.tsx` (first.related_candidates) | — | `b3885a1925d5ae49c0abe9f32a479f389de546fdff3e486ed4c0b89c6c4f8212` | `fb29ff4880b528a1713908832be56f92bf7aa3e640550858aa6c0bf0fc4a0fba` |
| `src/pages/report/TodayReport.tsx` (first.related_candidates) | — | `4ded92bbfffb19199b9d1b265f88a13aa5bd3cd926505f6e45e1efe9536a15d0` | `f4ea4cad59c57d353293dc38c800ee1785d85eae7f8234ac5b1dbf09c2d70cca` |
| `src/pages/reports/ReportDetail.tsx` (first.related_candidates) | — | `acbd407475c349bed9c7106aaf26f338e202d1b0b0cb3401e04384a9b95b4d94` | `4a9e9ec3d611d89fde4b7769851d89911e185b1266e1474287a99205f0bd6960` |
| `src/pages/verification/page.tsx` (first.related_candidates) | — | `509bf96964088eadd4281943ff174d1ceadcc45685a75ae10a5fe3f337249cae` | `7fcf33a5d89e9840246e49b59c787b8a2c987e8087166fe433293f9d457874b0` |
| `src/pages/war-room/WarRoom.tsx` (second.related_candidates) | — | `8b7e796f00ccd94112d4e2096fb3f19175d5007a3e82bb4ee6c395af327fb61b` | `b02138ea1078b97c36cba864256b6fe76672ee67a37c3d3c41fabdc1c6ac124e` |
| `supabase/functions/_shared/content-intelligence.ts` (incident.files) | `65ba66409373caa65c40e7dd7f5d80077b1260cbdd70aa545da403ea5f20caa0` | `623b6f6392440435434585c3633b9d4e252abf7ed005c6e9b4ce1e6242be7c98` | `1dacf2f42a7e6adb9edbdb80900a0d8e3d581e3c4fbea829d9da853708d91d8d` |
| `supabase/functions/_shared/market-report-gate.ts` (incident.files) | — | `1cec4ce674d93b639b07d6c875548b2aed11e733cd4b471ab4e6ce07520a652c` | `7a928e7fecf28a78cdc8380c01e0d0517fecd41dc58c5215abe71a6d86600993` |
| `supabase/functions/_shared/research-pipeline-contract.ts` (incident.files) | `f6b23af0719c53e3ff0a1ffe36c2847826213f0e60d0ff8e8879d3827fe7b857` | `4bd20863cb39afb2293dda274b1ad6e9618d5ddfdadafec5b65dcbf2bcfe508d` | `ba2c6c8c3fc70018315c2738c09b43aeb7f17e7ff9130a5e2d3d1076eac3db81` |
| `supabase/functions/daily-delivery-orchestrator/index.ts` (incident.files) | `97355f6d15a834e52e2fa892bd2f0b273ab8aa10902ed8ec142ad48b5019feda` | `741ff45bb1903560e5cfc87c855a40d2d4844d96d0253ac5f486077d42706c59` | `3686c3d9ffa14bdeaf76f444063659ce69294ee8f9e458669aba3cc493e09692` |
| `supabase/functions/generate-daily-report-v7/index.ts` (incident.files) | `40561b2a092af876e396bc32dc47ab58e2daeb055005fd02af08d050a123522c` | `79473cf68c334619a064120aa6d19cac961efffdd66316dcf6c3983d686039c6` | `fc49f6059d77819c580cb9690bf0afe824263fa4df9d10ac5493f2a5ecc8ea49` |
| `supabase/functions/generate-daily-report-v7/research-master-v2.ts` (incident.files) | `bcf78bb2070c0b7e622663d4df8145b2c6befe83da9b0cfe1fa1d3b70b137fc7` | `d00c0fa643709bf927d89b71a607b1887756beb3c8be028726d37e27e875275d` | `49046d4fadb133fb801ed154954f07cb521ce2afa50668cb4ea40e87119ff25c` |
| `supabase/functions/get-report-payload/index.ts` (first.files) | `3195efd17035cf81a69d01cac19c2a1f315b04a3a17faf8076c5933d8101b370` | `09a24b5e72a8eec28d58cec4020134443ae8417d5212ee9d41c306b678e245d7` | `0e8b5411a400d742e17b9620367e8bf66a88502af9f52ae6f09b82d97330746e` |
| `supabase/functions/line-daily-push/index.ts` (incident.files) | `e93a8d0f16534de99acd58916e3fc0a6bc743742540908851b05117bb74b1c2c` | `c890c749eb8dfa53462ea3b2aa7291ecfaf9ea2a80fe6e3d270723aea8bad89e` | `fd930bf8b25ab025e959e78a4e6604700ac267770ca080a5c910c55d95c9078a` |
| `supabase/functions/ma-ops-health-check/index.ts` (incident.files) | `296f4bd106e1ab00d5cf82a9637462b8091380536658964ebb2c0e073c71ba32` | `88ddffcd7cbf0975e2fb829abf076b36576499b55acd162aaa332bd2027d9557` | `0328663eb38f5c1b3b618707dee0e4781683a780727f5d4ba436172ab44fc106` |
| `tests/marketPublicationPayload.test.mjs` (first.related_candidates) | — | `eaa46c0e262768f90563e5655cd58fe490cbe0cbe911a9c15e0b10489c728edf` | `c69d8cf73d147d938a75c7709afbc735c9d1b073ed515943c9fa361b5822689c` |
| `tests/publicRelease.test.mjs` (third.files) | — | `968b476409a2990d9d5f37e62456b264a7e32c41bb90ca83777c30cbbbc8d8b1` | `8be44b3c1f5ef5774a47396222c519a4ae70d43eac609a75a7b5eb6885a04fa3` |

## Changed files outside the existing registry file set

“Not in existing registry” is a coverage fact, not a safety exemption. These
files still require source/behavior review, candidate hashes and regression;
Closing/Learning handlers are particularly database-sensitive despite not being
in the original Generator/Orchestrator declaration manifest.

| File | HEAD SHA-256 | Provisional current SHA-256 |
| --- | --- | --- |
| `src/hooks/useLatestReport.ts` | `b79f79968334547fc36345814e6e176bb5de23380a4ff2f686b9f4001ef2fc7e` | `d4bba555eaba01674beb4f1e90e257d313d1a5d18a92d5e5e6422b31ef744a3c` |
| `src/lib/morningAlpha/resolveMorningAlphaState.ts` | `d3e3defe67f0d68294ebdb593cbc60f07c30b3c94cd5c602e95f376d2b567413` | `bd5bfefa2690558634955e42d7dd420fe9b7637d70b9f335b8ff7f53a8ac60ba` |
| `src/lib/morningAlphaDisplayState.ts` | `5093068f2bf1ffbf565f5e7ca0f97e995be14d2a043020c0e433dcadc5056ee8` | `df8665699b738758492f2d1d70c5c8c514e15cdab2cc8a63daf00bde1aaba3b1` |
| `src/lib/premiumContentAvailability.ts` | `ebdc1134f7e6229df0537e9960caad6e2419b6e3d826b9d781bf6ca3786e3590` | `2b64cfb98b50151ed21462a3ddf30846e44a9a2657b1a3bc9841f9a3fbfe8a51` |
| `src/services/closeMarketReviewService.ts` | `f4ee38e6c4736283b20f86da4e77d4be1fd3d70239893aa13bebb32a30f807e1` | `e69dc3a84e2758d345c16ac2f4321f8677df00d72e2732b1b3e24690b650025d` |
| `src/services/homeDashboardService.ts` | `457ba87e7605bf9db16e78342b4f15d54cdfbb0901facef911377c6cb04608b7` | `5f7799079c0c7750c5f22f049daa7ef5bc7f1167381ad2b4f2766e6300055974` |
| `src/services/marketStateEngine.ts` | `25b3f44f108933440b65a8d9aaa4853cc8b3f7b91dee92a55b928f4042d4d488` | `d29bb35596d457657ce61be599a65559d3bd7da3418a911aac0372403c1714ee` |
| `supabase/functions/_shared/research-pipeline-contract.test.ts` | `201228422ecde599129d36ac30737c1c3ae5bf9044891ab7d5774ab472c41625` | `6557eb1b40fbeea66bb4a929cd60ced523c368de25c90f2704b79f322d7aa7e3` |
| `supabase/functions/close-market-review/index.ts` | `5fabece5e47f5b68916c055e5ebae17eead9320727c1e7f0ffd41fedd8e89131` | `24f9f9b005e7cc84453ac78c6569098d601ef76101b0967b6143053d28e2aa49` |
| `supabase/functions/closing-verification-engine/index.ts` | `edc6850b2dbb0a143c8ee6ce31face4a550107a2a7f97656760a08ac5599fccc` | `730f0dd698c74f33fa98e8e730d32cef13e4cccaa681646df0cb92d647b8b189` |
| `supabase/functions/continuous-learning-engine/index.ts` | `c3a0dbd818c65a532614870c2f4545af6c757b69bc42edc4d61ac43de533b642` | `8b4e67a36b73b4aa3736379774c993b6446bcb357f21aeb5e756249e7cf4f54f` |
| `tests/coreRuntimeIntegration.test.mjs` | `23c83905a397e3188859cf73ac4a1c23fc1cc2c08a9b68fd647ac8cf3c274426` | `210462d8713c76d837b6838b603b2e165142096a2a9e2397e64ec32ea3508579` |
| `tests/incidentHealthContract.test.mjs` | `d08a832555316adc4ee877be560dc11e4aa4e90e4ccd2424cda7e4abdb2a456d` | `3159e4e144c272951fa88daeb2f0c884b85296b3f702f680f83845e69932cd04` |
| `tests/marketPublicationDelivery.test.mjs` | `28b2ae32ce807dca4b401d5465933d2d90955bd96eed3b1e115446b1afdd9e26` | `6ff12a69f183dd7ff69f56104c4634d9db483e42b83201e68660e98d2994373d` |
| `tests/productionReliability.test.mjs` | `a65c614b3f7bf6ebb6a858e5647372072ed68468f6afc3b3630777a814fac2b7` | `d3e5520ca4ac8e74e805663821016a6a8a43c05024e70811112e0a50320902cd` |

## Protected declaration changes

| Declaration | Original Production SHA-256 | HEAD / registered expected SHA-256 | Provisional current SHA-256 |
| --- | --- | --- | --- |
| `supabase/functions/generate-daily-report-v7/index.ts`#`attachResearchMasterV2Shadow` | `0cbfaf3f58ad40399b1082b0ff925e956a0afb7451478293e441c87a8d934123` | `3d982bf3b493e8d05f4697093784a85eeca30dd2ba1d7d93f1a97820fcfcc904` | `08247832599a3ac50a9529f81375e33f7f841c91386215245f75ec9c6a300b81` |
| `supabase/functions/daily-delivery-orchestrator/index.ts`#`checkpointResultOk` | `d5aa72c5d0a6785b1bce8886e3bfff495b576099d8fe258e2fe5b244977d1465` | `d5aa72c5d0a6785b1bce8886e3bfff495b576099d8fe258e2fe5b244977d1465` | `9dd6e260883fcc8b9b72136dfa89db9c4670a4dd6ac7b3b28626cc7535464bcc` |

- `attachResearchMasterV2Shadow` already has a historical amendment. The new
  body keeps the private stock research document, independently assembles/audits
  the market document for trading days, stores `canonical_market_state`, and
  exposes the market document through its compatibility alias. This is not an
  AI prompt edit and must not overwrite the rejected research/audit counters.
- `checkpointResultOk` has **no existing amended declaration pin**: its HEAD
  hash is the original Production hash. The changed Closing branch now requires
  success plus `CORE_CLOSING_V1`, COMPLETE market evaluation and zero reasons;
  it no longer accepts the legacy `direction_completed_data_degraded` status.
  A future exact successor must explicitly cover this new declaration change;
  merely adding a whole-file hash is insufficient for the current guard model.

Other notable source changes such as `buildCanonicalDecisionPayload`, the new
`assembleCanonicalMarketResearch`, shared publication selectors and new
Closing/Learning finalizers are **not among the 698 original protected
production declarations**. They remain covered by whole-file/candidate review,
not silently omitted from attribution.

## AI / prompt / strategy declaration check

All rows below have `current = HEAD = original Production`. The extraction was
performed for all 698 declarations first; these 11 are the explicitly
prompt/policy-named subset, including every required name asserted by
`tests/coreProductionPreservation.test.mjs`.

| Declaration (Generator unless stated) | Unchanged SHA-256 |
| --- | --- |
| `OPENAI_EVIDENCE_GUARDRAILS` | `b058f4353b375f36b318a98a2a7824a2f5232dd7d268530b9b1ab290acbfc94e` |
| `OPENAI_OUTPUT_ABSTENTION_RULES` | `7434611613edb2cc98d2c269ca30e5fc5e4e730dc8386af09c829d687a0779d4` |
| `V10_CANDIDATE_METADATA` | `8a57e42c21c7123b0cb11645503af5438ac79812b167957cf5a57c0143d3c7f2` |
| `calculateRepeatPenalty` | `bc7c57c466fbddc0669ab91d1020508d5a9087fb96b73e3f4051c8363e9406d6` |
| `calculateV10BeneficiaryPhase1Record` | `714e5ba4b3a7076ea9a6b12c904120a3bf58ca1b892a11ba5da4fbc3926adda3` |
| `buildV10MarketThesisAgentSystemPrompt` | `93503e2ac3d0d12638035413bd408d72cff9d206c0217c2edbb3c46472322487` |
| `buildV10MarketThesisAgentUserPrompt` | `034f5ed171710e10bd42dc58221e17b1b72fc2d3cf1797aa11078c4e89506f34` |
| `buildV10CandidateEvaluationAgentSystemPrompt` | `525aeed0edffa803441d5e065b5b1f6604c0d91772fdfa51c473916d15f5beae` |
| `buildV10CandidateEvaluationAgentUserPrompt` | `78eb766d2180e76a422247228f627582723e87adc09a2dd17133d4435f9aed67` |
| `buildOpenAISystemPrompt` | `9a263820bf34c4f6d4d31a757ebfaa88019acdf27cb03a10afd8ca8f3ed9dff0` |
| `buildOpenAIUserPrompt` | `52b2e2987c589074170ca4322b874161c587caf04f7069c5809cd1ab21cb4a67` |

No broad “all strategy behavior unchanged” conclusion follows. In particular,
`src/services/marketStateEngine.ts` removes local TAIEX threshold constants,
radar-derived bias/close inference, browser-time completion and fallback prose,
replacing them with a subscriber projection adapter. That is an intentional
presentation-state behavior change requiring bullish/DO_NOT_CHASE, bearish,
holiday, stale-data and wrong-revision regression. The canonical selection
policy functions above did not change.

## Semantic attribution of every tracked diff

Reasons below describe the observed source changes, not a security approval.
Declaration names are top-level AST scopes; anonymous handler/test bodies are
also included in each complete file diff/hash. Line counts are added/deleted
relative to HEAD at the observation time.

| File | Diff + / - | Observed scope and semantic reason |
| --- | --- | --- |
| `src/hooks/useLatestReport.ts` | 61	246	src/hooks/useLatestReport.ts | Replace detached raw AI/closing/radar reconstruction with canonical full-envelope projection; remove legacy extraction helpers. |
| `src/lib/decisionPresentation.ts` | 12	11	src/lib/decisionPresentation.ts | Carry full report-envelope identity into decision formatting; use projected confidence/bias and suppress unqualified stocks. |
| `src/lib/morningAlpha/resolveMorningAlphaState.ts` | 47	122	src/lib/morningAlpha/resolveMorningAlphaState.ts | Align legacy resolver availability, badges and data-integrity status with shared projection. |
| `src/lib/morningAlphaDisplayState.ts` | 72	328	src/lib/morningAlphaDisplayState.ts | Replace raw confidence, browser/radar overrides and fallback narrative/state synthesis with projection adapter. |
| `src/lib/premiumContentAvailability.ts` | 31	60	src/lib/premiumContentAvailability.ts | Separate published market availability from server Premium qualification; remove client inference from stock/news counts and scores. |
| `src/lib/runtimeDecisionTimeline.ts` | 7	2	src/lib/runtimeDecisionTimeline.ts | Accept existing projection/full report envelope; retain nested AI only as explicit compatibility input. |
| `src/lib/subscriberReportContract.ts` | 2	2	src/lib/subscriberReportContract.ts | Require projected recommendation availability before adding beneficiary rows to observation sources. |
| `src/pages/home/page.tsx` | 2	12	src/pages/home/page.tsx | Pass canonical projection into runtime timeline; remove detached AI/revision reconstruction. |
| `src/pages/member-note/page.tsx` | 2	4	src/pages/member-note/page.tsx | Consume canonical projection/timeline and market availability independently of blocked recommendation/Premium lane. |
| `src/pages/opportunities/page.tsx` | 12	312	src/pages/opportunities/page.tsx | Pass canonical projection into timeline and preserve recommendation isolation. |
| `src/pages/performance/page.tsx` | 14	115	src/pages/performance/page.tsx | Replace route-local report selection/raw closing interpretation with per-day journal projection adapter; historical numerical behavior needs regression. |
| `src/pages/report/TodayReport.tsx` | 2	4	src/pages/report/TodayReport.tsx | Pass canonical projection into runtime timeline; remove detached raw-state arguments. |
| `src/pages/reports/ReportDetail.tsx` | 1	1	src/pages/reports/ReportDetail.tsx | Supply canonical projection to the historical market/Premium availability adapter. |
| `src/pages/verification/page.tsx` | 2	3	src/pages/verification/page.tsx | Use canonical projection for subscriber timeline rather than rebuilding from raw AI. |
| `src/pages/war-room/WarRoom.tsx` | 2	46	src/pages/war-room/WarRoom.tsx | Remove route-local reliability/state fallback in favor of canonical subscriber state. |
| `src/services/closeMarketReviewService.ts` | 26	43	src/services/closeMarketReviewService.ts | Only map a completed projected Closing result; remove fabricated verification time/default outcome booleans. |
| `src/services/homeDashboardService.ts` | 2	3	src/services/homeDashboardService.ts | Pass the selected full-envelope projection to Closing view adapter. |
| `src/services/marketStateEngine.ts` | 117	955	src/services/marketStateEngine.ts | Replace raw radar/closing/quote-threshold state machine with compatibility projection formatting; retain quote freshness utilities. |
| `supabase/functions/_shared/content-intelligence.ts` | 2	1	supabase/functions/_shared/content-intelligence.ts | Resolve market document through canonicalMarketState before unchanged scoped editorial evaluation. |
| `supabase/functions/_shared/market-report-gate.ts` | 9	5	supabase/functions/_shared/market-report-gate.ts | Evaluate independent market document and private stock research separately; revalidate explicit CMS identity/ledger. |
| `supabase/functions/_shared/research-pipeline-contract.test.ts` | 10	1	supabase/functions/_shared/research-pipeline-contract.test.ts | Move Premium-BLOCKED case out of required-market failure list; add explicit independence PASS and market-evidence FAIL assertions. |
| `supabase/functions/_shared/research-pipeline-contract.ts` | 7	2	supabase/functions/_shared/research-pipeline-contract.ts | Make automatic market-day proof independent of Premium depth while retaining market/semantic/delivery/closing/learning/acceptance checks. |
| `supabase/functions/close-market-review/index.ts` | 74	24	supabase/functions/close-market-review/index.ts | Validate close provenance and retry fresh-read/CAS report projection; preserve durable Closing contract. |
| `supabase/functions/closing-verification-engine/index.ts` | 146	108	supabase/functions/closing-verification-engine/index.ts | Require persisted Closing snapshot/readback and exact opening/fingerprint; shared finalizer retries CAS report and lifecycle projection. |
| `supabase/functions/continuous-learning-engine/index.ts` | 192	109	supabase/functions/continuous-learning-engine/index.ts | Bind frozen opening/CMS and durable Closing; deduplicate forecasts, preserve completed historical outcomes and retry exact run/lifecycle receipts. |
| `supabase/functions/daily-delivery-orchestrator/index.ts` | 7	71	supabase/functions/daily-delivery-orchestrator/index.ts | Delegate published-reader/eligibility to one shared module; require CORE_CLOSING_V1 COMPLETE instead of degraded legacy status. |
| `supabase/functions/generate-daily-report-v7/index.ts` | 18	17	supabase/functions/generate-daily-report-v7/index.ts | Store private stock research separately; independently assemble CMS and build decision text/source refs from its audited document. |
| `supabase/functions/generate-daily-report-v7/research-master-v2.ts` | 28	0	supabase/functions/generate-daily-report-v7/research-master-v2.ts | Add separate market assembler using existing assembly/validation with empty recommendation input; existing protected declarations unchanged. |
| `supabase/functions/get-report-payload/index.ts` | 5	29	supabase/functions/get-report-payload/index.ts | Delegate exact committed snapshot/member reads to shared selector; absent pointer cannot fall back to current QA; null/undefined no-snapshot alignment. |
| `supabase/functions/line-daily-push/index.ts` | 3	67	supabase/functions/line-daily-push/index.ts | Delegate duplicated published-evidence reader and delivery eligibility; preserve real outbox/send path. |
| `supabase/functions/ma-ops-health-check/index.ts` | 35	31	supabase/functions/ma-ops-health-check/index.ts | Use shared publication identity/eligibility and durable Closing contract; remove local latest-QA selector. |
| `tests/coreRuntimeIntegration.test.mjs` | 13	1	tests/coreRuntimeIntegration.test.mjs | Add null missing-snapshot compatibility and detached-QA rejection assertions; no existing pass waived. |
| `tests/incidentHealthContract.test.mjs` | 11	9	tests/incidentHealthContract.test.mjs | Exercise shared published reader and no-QA fallback, wiring real helper dependencies into component tests. |
| `tests/marketPublicationDelivery.test.mjs` | 3	1	tests/marketPublicationDelivery.test.mjs | Inject actual shared publication functions into isolated compatibility wrappers. |
| `tests/marketPublicationPayload.test.mjs` | 8	2	tests/marketPublicationPayload.test.mjs | Inject actual shared selectors; add missing-pointer and wrong-semantic-version negative assertions. |
| `tests/productionReliability.test.mjs` | 11	1	tests/productionReliability.test.mjs | Replace obsolete current-view source assertion with shared committed-reader/semantic identity assertions; Content OS unchanged. |
| `tests/publicRelease.test.mjs` | 9	6	tests/publicRelease.test.mjs | Redirect relocated LINE/publication source assertions to shared helper while asserting delegation, unchanged thresholds and semantic gates. |

### Test conformance is not a baseline waiver

`tests/publicRelease.test.mjs` remains pinned at
`968b476409a2990d9d5f37e62456b264a7e32c41bb90ca83777c30cbbbc8d8b1`;
its current `8be44b3c1f5ef5774a47396222c519a4ae70d43eac609a75a7b5eb6885a04fa3`
is the first expected old-integrity failure. The changed assertions verify
caller delegation plus the actual relocated shared status/90-point/semantic
checks, instead of looking for duplicated implementation text in each caller.
They still require fail-closed LINE ordering and outbox behavior. The previous
historical-date assertion registration is not rewritten.

The automatic-day test deliberately changes one product expectation: blocked
Premium depth is no longer a required-market-stage failure. Its added positive
independence assertion retains Premium BLOCKED and separately requires market
evidence failure to fail. This is an explicit Recommendation/Premium isolation
contract change; it is not approval of SQL Acceptance behavior or of a failed
historical day. Existing SQL gates remain unchanged and DB-unverified.

Payload/health test fixtures now include exact semantic revision identity and
negative missing-pointer/wrong-version cases. Component fixture success does
not replace real SQL/RLS/Auth/LINE/Closing/Acceptance execution.

## Original saved Production artifacts in the source manifest

Multiple deployments may record different bundled/canonical bytes for the same
logical file; all observed variants are retained here instead of selecting one
as “the” Production file. The immutable manifest remains the complete source.

| File / saved deployment | Source artifact SHA-256 | Canonical content SHA-256 | Integrated original pin |
| --- | --- | --- | --- |
| `supabase/functions/_shared/content-intelligence.ts` (generate-daily-report-v7) | `41f94c4096e4299090140f11eaf75a259a9409f5189ffac738c0252cd63fd3c2` | `5bb5eed0d429e55a412999e12d30ef1c9f23614d895ade67f0be8fc1db5e3d1c` | `65ba66409373caa65c40e7dd7f5d80077b1260cbdd70aa545da403ea5f20caa0` |
| `supabase/functions/_shared/content-intelligence.ts` (daily-delivery-orchestrator) | `41f94c4096e4299090140f11eaf75a259a9409f5189ffac738c0252cd63fd3c2` | `5bb5eed0d429e55a412999e12d30ef1c9f23614d895ade67f0be8fc1db5e3d1c` | `65ba66409373caa65c40e7dd7f5d80077b1260cbdd70aa545da403ea5f20caa0` |
| `supabase/functions/_shared/content-intelligence.ts` (get-report-payload) | `e463ded6f40425c00a47fc80ea81951a75dee71dd4cfd48bd9c9efa9a36f6a0d` | `dfb99cc4d63c25f948723047631e5ec85308fdbb3a9521702957e800da3ae16a` | `65ba66409373caa65c40e7dd7f5d80077b1260cbdd70aa545da403ea5f20caa0` |
| `supabase/functions/daily-delivery-orchestrator/index.ts` (daily-delivery-orchestrator) | `5c711fe8b0c723929f40a6391273b3da689dfcbbea429b286f88d51ed9544a24` | `f239e97bab8ff6d0413f5f5266724f86ef04177e5cbb7f2adec8e04498c1d5d7` | `97355f6d15a834e52e2fa892bd2f0b273ab8aa10902ed8ec142ad48b5019feda` |
| `supabase/functions/generate-daily-report-v7/index.ts` (generate-daily-report-v7) | `ddcf7b46b32dba1ac4ad496846aecab518409b455e1f41754972388de85a511b` | `40d220084e4b1aa796f1a398d5bfaba182601ac88e9aff7f230fc4a7116600b1` | `40561b2a092af876e396bc32dc47ab58e2daeb055005fd02af08d050a123522c` |
| `supabase/functions/generate-daily-report-v7/research-master-v2.ts` (generate-daily-report-v7) | `4292ef07c61e7a6e601558f80e932b871c82d74df077fec88e96d3c6b019e0a5` | `f70f94b79b8ec9ef4e1a59aa9af6f9344eff2847cc1952c8227bcd6c99504cef` | `bcf78bb2070c0b7e622663d4df8145b2c6befe83da9b0cfe1fa1d3b70b137fc7` |
| `supabase/functions/get-report-payload/index.ts` (get-report-payload) | `ed31ee987d4f719bb769da3ae0c6aaaf98cfabb587f4dd5a2e52f2d6ed4fdc12` | `1b3398905f0049807cdc3403d3f2737d0ab9e2de26ae21a3d8eaa8bff4b2c071` | `6c52774017e780a27b12950dfc314f29aaefc855b90789fc2f99ee425973fcc5` |

## New candidate artifacts — no predecessor pin

These are not registered or approved by this list. HEAD and original Production
hashes are absent by definition. New shared contracts must be included in a
future immutable candidate source/dependency artifact together with their
consumers. Source hashes below do not imply any runtime execution.

| New path | Bytes | Provisional SHA-256 / status |
| --- | --- | --- |
| `docs/operations/core-pipeline-consolidation-v1-replay.md` | 48812 | `98a9c82a1e54cf1839844bcd7889374bfc9774ea24389dd10d6e820484b35296` |
| `src/lib/performanceJournalProjection.ts` | 2089 | `a1e62d977d1208fc163bc58899af7acbfb6af93c44a88769c89a8ca6fcd19664` |
| `src/lib/subscriberOpportunities.ts` | 1056 | `b6355c3ff7b61da32e51e169b94c4f79462f67a244547c44f1a7304ab2395f0b` |
| `supabase/functions/_shared/canonical-market-state.ts` | 5189 | `43b2d0744932a58936a0f2bfb47f1bb0ae8800e28ead23b28c6f5280cff422fb` |
| `supabase/functions/_shared/closing-learning-contract.ts` | 21304 | `24eaa5915b836e737622a0a759b71f88c15719e68a41998a30dc74cd752d7d54` |
| `supabase/functions/_shared/market-publication-contract.ts` | 7602 | `8b20ae973c9004756b38446d8bdb5ba7c184c97e261b6a3ff6b61500871c7331` |
| `supabase/migrations/20260909015650_core_market_publication_contract.sql` | 0 | EMPTY; SQL authoring blocked; no definitions reviewed/executed |
| `tests/closingLearningContract.test.mjs` | 35841 | `8815fe213c0697d96249ddcf80fe5b3de0360dbeea404e9cbea6f9c27ffd14e9` |
| `tests/consolidationMarketEvidence.test.mjs` | 6181 | `0782db7b70b8d4122c5651ce2eeda4874a768823f4028c52f1ac7e5559a0ac9d` |
| `tests/consolidationMarketStateAdapter.test.mjs` | 12458 | `27c1585f94b66af8e0e3c6f4c303b5a1eb20f50dfb7b05286c1f7428a0012e61` |
| `tests/consolidationSubscriberBoundary.test.mjs` | 6345 | `5100f30a498a4bc7957ad6553ecfb7b1f200ed914fa5b56e138ddc53f1273ba9` |
| `tests/consolidationSubscriberLoaders.test.mjs` | 6742 | `ab8cc3ff6134f57f78f0fed2279cdb38db4db4c7752f7b41e3d44b7db2bb7aab` |
| `tests/fixtures/consolidation-v1/captures/2026-09-07-fetch-persistence.json` | 3030 | `72382ea27f76d54b388188bb72c0685546e73a1b78ae10827bdeefbaa2ab7be6` |
| `tests/fixtures/consolidation-v1/captures/2026-09-08-quality-projection.json` | 3110 | `9d06a150df101d27c15c1d84ac63e459f3c8b870ba906aa07f13209d0b81fecc` |
| `tests/fixtures/consolidation-v1/captures/2026-09-09-premarket-quality.json` | 6920 | `6c7bfa621f62c89aa9ec8387e09cba43caf591c6ee28e73a3ff9b46810a99868` |
| `tests/fixtures/consolidation-v1/clock.test.mjs` | 2957 | `48ea5227d0083ce0efa3ebb607b62cb9495725b9a09b520ada1408fed040929d` |
| `tests/fixtures/consolidation-v1/index.mjs` | 2859 | `69c8b11597a84be895bbe172ba25556f6311558ff092e2d6069a08ec17a229db` |
| `tests/fixtures/consolidation-v1/manifest.json` | 1527 | `7ca6fcca0386978da0f727bc0eb40c66963f43d30a7dc1b42d50fb65e7a2a33c` |
| `tests/fixtures/consolidation-v1/offline.test.mjs` | 5452 | `364cd3c2cc9266e65c424c7b18dd2c3ee9f257ac39f7ec2dadbb93b984373d78` |
| `tests/fixtures/consolidation-v1/provider-chain.test.mjs` | 12032 | `057eee8073ce75fea72c903baf03609f13b1aaea990c83d8af23270a1401c710` |
| `tests/fixtures/consolidation-v1/providers/synthetic-20260714.json` | 1953 | `6aab9b5f4ea89e607eafd3a8e673dc8c38a61e6697312485c3f68dd37ebf5ab6` |
| `tests/fixtures/consolidation-v1/scenarios/market-only-counterfactual.json` | 1611 | `9049ff39d407451690245feb81723d951ad7054d98b39b5fa72484dc2c4c0fd6` |
| `tests/helpers/consolidationLocalScope.mjs` | 4460 | `20d01432bf6e920527c3a317a5bf78fca898e62fd3dfc2cb4f2d827df2254e44` |
| `tests/helpers/consolidationProviderReplay.mjs` | 3486 | `dc5fe1c4da2eb6e26edf5666aab7fbaf2cb383c36292e21ac98be3f23cd10092` |
| `tests/helpers/consolidationVmClock.mjs` | 6208 | `319f910c2b13a60aed31c821c0b1b84f9fa99644ab8d36659289fa40fa8b2db6` |

The new migration path was inspected with file metadata only and is **0 bytes**.
Do not treat it as implemented schema, an executable migration, or an alternate
route around the rejected SQL authoring operation. No rejected SQL is preserved
in this review document.

## Unknowns, exclusions and final-registration prerequisites

- **Provisional hashes:** active root/agent edits may invalidate rows after the
  timestamp. Source freeze plus a fresh complete hash/diff inventory is required
  before a final registration; do not automatically accept the newest hash.
- **No unexplained path silently admitted:** the tracked/new paths above map to
  the assigned consolidation work, but this attribution is not a line-by-line
  completed security or behavioral review. Large frontend adapters, performance
  read-model suppression, new shared contracts, durable write ordering and
  current test expectation changes remain exact-review items. A new unmatched
  path or declaration at final freeze must be flagged, not absorbed by glob.
- **Production originals:** the existing registry, manifest, artifact and guard
  bytes are unchanged; original pins are preserved. Live Production bundle
  identity/version is not reverified by this read-only local inventory.
- **Database risk:** current TS Closing/CLE guards still need real trigger/RLS,
  CAS/concurrency, lifecycle-rank/no-op and historical-outcome write-count
  verification. Counts are UNKNOWN, not zero. No source hash authorizes SQL.
- **Protected guard coverage:** old guards intentionally reject new source until
  an exact, independently anchored append-only successor is reviewed. Preserve
  the complete prior registry/history, original Production hashes, exact path
  and declaration sets, reversible preimages/patches, meaningful reasons and
  source rollback references. Do not disable a guard or register a failing
  assertion/result as acceptable.
- **Final evidence:** only fresh tests against the eventual frozen candidate,
  including original tests and new negatives, may establish regression status.
  A source registration must still require full validation and must not claim
  Production/merge/migration/automatic-stability authority.

The known unrelated preservation set is listed for scope separation only:

- `docs/research/data-acquisition-inventory-v1.md`
- `docs/research/data-gap-matrix-v1.json`
- `supabase/functions/_shared/decision-v1-data 2.ts`
- `supabase/functions/_shared/decision-v1-evidence 2.ts`
- `supabase/functions/_shared/fetch-checkpoint-evidence 2.mjs`
- `supabase/functions/_shared/line-daily-flex-message 2.mjs`
- `supabase/functions/_shared/market-report-gate 2.ts`
- `supabase/functions/_shared/research-pipeline-contract 2.ts`
- `supabase/functions/_shared/research-quality-gate.test 2.ts`
- `supabase/functions/_shared/us-cash-session-calendar 2.ts`
- `supabase/functions/generate-daily-report-v7/candidate-evidence 2.ts`
- `supabase/migrations/20260907030607_core_research_atomic_publication 2.sql`
- `supabase/migrations/20260907072722_reconcile_canonical_schema_truth 2.sql`
- `supabase/migrations/20260908020000_incident_acceptance_market_delivery 2.sql`
- `supabase/migrations/20260908050000_market_publication_recommendation_isolation 2.sql`
- `tests/browser/productDecision 2.html`
- `tests/browser/productDecision 2.tsx`
- `tests/browser/productDecision.e2e 2.mjs`
- `tests/browser/subscriberProduct.e2e 2.mjs`
- `tests/browser/subscriberState.e2e 2.mjs`
- `tests/canonicalSchemaTruth.test 2.mjs`
- `tests/coreProductionPreservation.test 2.mjs`
- `tests/coreRuntimeIntegration.test 2.mjs`
- `tests/decisionEvidencePipeline.test 2.mjs`
- `tests/decisionV1Product.test 2.mjs`
- `tests/fetchCheckpointEvidence.test 2.mjs`
- `tests/fixtures/core-acceptance-schema 2.sql`
- `tests/fixtures/core-canonical-foundation 2.sql`
- `tests/fixtures/core-research-indexes 2.sql`
- `tests/fixtures/core-research-publish-baseline 2.sql`
- `tests/fixtures/core-research-schema 2.sql`
- `tests/fixtures/decision-evidence-rows 2.mjs`
- `tests/fixtures/decision-v1 2.mjs`
- `tests/fixtures/fetch-provider-boundary 2.mjs`
- `tests/fixtures/legacy-decision-evaluator 2.ts`
- `tests/helpers/isolatedEdgeLoader 2.mjs`
- `tests/incidentHealthContract.test 2.mjs`
- `tests/integration/fetch-checkpoint-local 2.mjs`
- `tests/marketOnlyCanonical.test 2.mjs`
- `tests/marketPublicationDatabase.integration 2.mjs`
- `tests/marketPublicationDelivery.test 2.mjs`
- `tests/marketPublicationPayload.test 2.mjs`
- `tests/productContract.test 2.mjs`
- `tests/researchPipelineDatabase.integration 2.mjs`
- `tests/subscriberMarketPublication.test 2.mjs`
- `tests/subscriberStateContract.test 2.mjs`
- `tests/subscriberStateFrontend.test 2.mjs`

No commit, push, deploy, migration, Cron, Production API, secret access or VM
operation was performed by this read-only attribution task. The Supabase skill
was used to preserve the distinction between source review and actual
SQL/Auth/RLS verification; no database query was substituted for the blocked
migration work.

## Frozen-source refresh — 2026-09-09T03:09:34.689Z

This timestamped refresh preserves both earlier snapshots above. It supersedes their current-source hashes only; it is neither baseline registration nor a test waiver. The independently observed result is **4 protected declaration changes, not 3**: the final frozen-opening formatter also changes `buildClosingVerdict`.

Scope after excluding the known 47 preserved, unrelated untracked paths: **38 tracked modified paths + 31 new candidate paths = 69 paths**, including this self-referential audit document and one empty blocked SQL artifact. There are 68 nonempty candidate paths. Tracked-only Git diff is **+1,169 / −2,785**; no untracked line counts are folded into that tally. Of the 38 tracked paths, **23 drift from an existing registered candidate hash** and 15 have no existing registry pin. All 698 protected declarations were compared: 4 changed and 694 unchanged; none were missing. All 11 named AI/prompt/policy declaration pins remain equal to Production and HEAD.

HEAD remains `6469630795fb1215595306c026437d850b668801`; origin/main remains `1bb06a047f38600be27f6e89a38b81baa5578706` (ahead 1 / behind 0). The old registry SHA-256 remains `7597edbd731636882e442faecd3bc4f8dd6f0701e07dd1ed7ddfe32e43b7505b` at this pre-registration snapshot. Every original Production pin, previous approval layer, source manifest, first artifact and existing guard anchor listed above remains preserved.

### Complete frozen tracked source hashes

| Path | Existing pin scope | Original Production pin (when present) | Exact HEAD preimage SHA-256 | Frozen current SHA-256 |
| --- | --- | --- | --- | --- |
| `src/hooks/useLatestReport.ts` | not_in_existing_registry | none; no invented Production claim | `b79f79968334547fc36345814e6e176bb5de23380a4ff2f686b9f4001ef2fc7e` | `0473cd648b88b1a4bfce877ae32aca3b907876fb92d187b7124eff6bb001e364` |
| `src/lib/decisionPresentation.ts` | first.related_candidates | none; no invented Production claim | `9f1ac35c9a6a5b809fc68a3f0276c62e0382bc87cd83603ebf331fcbe6f4a2ee` | `20843d8c46149ab0cef7dab08755aa09551164a39fc7c89e33780c9afee42f94` |
| `src/lib/morningAlpha/resolveMorningAlphaState.ts` | not_in_existing_registry | none; no invented Production claim | `d3e3defe67f0d68294ebdb593cbc60f07c30b3c94cd5c602e95f376d2b567413` | `bd5bfefa2690558634955e42d7dd420fe9b7637d70b9f335b8ff7f53a8ac60ba` |
| `src/lib/morningAlphaDisplayState.ts` | not_in_existing_registry | none; no invented Production claim | `5093068f2bf1ffbf565f5e7ca0f97e995be14d2a043020c0e433dcadc5056ee8` | `df8665699b738758492f2d1d70c5c8c514e15cdab2cc8a63daf00bde1aaba3b1` |
| `src/lib/premiumContentAvailability.ts` | not_in_existing_registry | none; no invented Production claim | `ebdc1134f7e6229df0537e9960caad6e2419b6e3d826b9d781bf6ca3786e3590` | `2b64cfb98b50151ed21462a3ddf30846e44a9a2657b1a3bc9841f9a3fbfe8a51` |
| `src/lib/runtimeDecisionTimeline.ts` | second.protected_files | `a14950b57c9cc43416c0341d8023684041d75a9a864817f3b1767426a7eb41a4` | `9b9c86d1e98fd088a9d23a5ba2a0116a936a9d1e74235b89a896c6ae222ed55a` | `3329f669b5da5e4ef937b350b0ab9400ba4249e15717cc453856dd4d8358f094` |
| `src/lib/subscriberReportContract.ts` | second.related_candidates | none; no invented Production claim | `ec7434a9b16ff44bcafc822faf16662dc95386fe4de0f9c8ca7fcb7abee1b346` | `4bfc6bbac43c55d44b90355af131f119058aa4824c1f0fff0b48fc5755ff4f23` |
| `src/pages/home/page.tsx` | first.related_candidates | none; no invented Production claim | `4ee43aeaeeea561ed4e6a2bb4c558d463dd3ac2334cb836d85b77a6db88b5be0` | `d24664643cb393e130cca4dcba60c945bb3dde9b52025be4a8c1155ca3d2d6f8` |
| `src/pages/member-note/page.tsx` | first.related_candidates | none; no invented Production claim | `e9d3feda9ccfdbc73bb622d4acc904e18e3000b235ff910eb7e7974f487d9501` | `9fa3f8d4aac669870c492b74c2c5f22d7ed856887f4e9a10acf320428fdbfb75` |
| `src/pages/opportunities/page.tsx` | first.related_candidates | none; no invented Production claim | `5b42c634a10c219c398d6f228916970c3b661127abf4152c120dd7eccc2c5b41` | `588028bdb6103f041a3470c90da381a89184d892f3636ad3c4cde80a6fa82400` |
| `src/pages/performance/page.tsx` | first.related_candidates | none; no invented Production claim | `b3885a1925d5ae49c0abe9f32a479f389de546fdff3e486ed4c0b89c6c4f8212` | `fb29ff4880b528a1713908832be56f92bf7aa3e640550858aa6c0bf0fc4a0fba` |
| `src/pages/report/TodayReport.tsx` | first.related_candidates | none; no invented Production claim | `4ded92bbfffb19199b9d1b265f88a13aa5bd3cd926505f6e45e1efe9536a15d0` | `f4ea4cad59c57d353293dc38c800ee1785d85eae7f8234ac5b1dbf09c2d70cca` |
| `src/pages/reports/ReportDetail.tsx` | first.related_candidates | none; no invented Production claim | `acbd407475c349bed9c7106aaf26f338e202d1b0b0cb3401e04384a9b95b4d94` | `4a9e9ec3d611d89fde4b7769851d89911e185b1266e1474287a99205f0bd6960` |
| `src/pages/verification/page.tsx` | first.related_candidates | none; no invented Production claim | `509bf96964088eadd4281943ff174d1ceadcc45685a75ae10a5fe3f337249cae` | `7fcf33a5d89e9840246e49b59c787b8a2c987e8087166fe433293f9d457874b0` |
| `src/pages/war-room/WarRoom.tsx` | second.related_candidates | none; no invented Production claim | `8b7e796f00ccd94112d4e2096fb3f19175d5007a3e82bb4ee6c395af327fb61b` | `b02138ea1078b97c36cba864256b6fe76672ee67a37c3d3c41fabdc1c6ac124e` |
| `src/services/closeMarketReviewService.ts` | not_in_existing_registry | none; no invented Production claim | `f4ee38e6c4736283b20f86da4e77d4be1fd3d70239893aa13bebb32a30f807e1` | `f177db7c4da628dc8414bc27fe72a3ce5266a9bddf4a8016ca74f90c7214e5fb` |
| `src/services/homeDashboardService.ts` | not_in_existing_registry | none; no invented Production claim | `457ba87e7605bf9db16e78342b4f15d54cdfbb0901facef911377c6cb04608b7` | `5f7799079c0c7750c5f22f049daa7ef5bc7f1167381ad2b4f2766e6300055974` |
| `src/services/marketStateEngine.ts` | not_in_existing_registry | none; no invented Production claim | `25b3f44f108933440b65a8d9aaa4853cc8b3f7b91dee92a55b928f4042d4d488` | `d29bb35596d457657ce61be599a65559d3bd7da3418a911aac0372403c1714ee` |
| `supabase/functions/_shared/content-intelligence.ts` | incident.files | `65ba66409373caa65c40e7dd7f5d80077b1260cbdd70aa545da403ea5f20caa0` | `623b6f6392440435434585c3633b9d4e252abf7ed005c6e9b4ce1e6242be7c98` | `1dacf2f42a7e6adb9edbdb80900a0d8e3d581e3c4fbea829d9da853708d91d8d` |
| `supabase/functions/_shared/market-report-gate.ts` | incident.files | none; no invented Production claim | `1cec4ce674d93b639b07d6c875548b2aed11e733cd4b471ab4e6ce07520a652c` | `7a928e7fecf28a78cdc8380c01e0d0517fecd41dc58c5215abe71a6d86600993` |
| `supabase/functions/_shared/research-pipeline-contract.test.ts` | not_in_existing_registry | none; no invented Production claim | `201228422ecde599129d36ac30737c1c3ae5bf9044891ab7d5774ab472c41625` | `6557eb1b40fbeea66bb4a929cd60ced523c368de25c90f2704b79f322d7aa7e3` |
| `supabase/functions/_shared/research-pipeline-contract.ts` | incident.files | `f6b23af0719c53e3ff0a1ffe36c2847826213f0e60d0ff8e8879d3827fe7b857` | `4bd20863cb39afb2293dda274b1ad6e9618d5ddfdadafec5b65dcbf2bcfe508d` | `ba2c6c8c3fc70018315c2738c09b43aeb7f17e7ff9130a5e2d3d1076eac3db81` |
| `supabase/functions/close-market-review/index.ts` | not_in_existing_registry | none; no invented Production claim | `5fabece5e47f5b68916c055e5ebae17eead9320727c1e7f0ffd41fedd8e89131` | `24f9f9b005e7cc84453ac78c6569098d601ef76101b0967b6143053d28e2aa49` |
| `supabase/functions/closing-verification-engine/index.ts` | not_in_existing_registry | none; no invented Production claim | `edc6850b2dbb0a143c8ee6ce31face4a550107a2a7f97656760a08ac5599fccc` | `730f0dd698c74f33fa98e8e730d32cef13e4cccaa681646df0cb92d647b8b189` |
| `supabase/functions/continuous-learning-engine/index.ts` | not_in_existing_registry | none; no invented Production claim | `c3a0dbd818c65a532614870c2f4545af6c757b69bc42edc4d61ac43de533b642` | `8b4e67a36b73b4aa3736379774c993b6446bcb357f21aeb5e756249e7cf4f54f` |
| `supabase/functions/daily-delivery-orchestrator/index.ts` | incident.files | `97355f6d15a834e52e2fa892bd2f0b273ab8aa10902ed8ec142ad48b5019feda` | `741ff45bb1903560e5cfc87c855a40d2d4844d96d0253ac5f486077d42706c59` | `3686c3d9ffa14bdeaf76f444063659ce69294ee8f9e458669aba3cc493e09692` |
| `supabase/functions/generate-daily-report-v7/index.ts` | incident.files | `40561b2a092af876e396bc32dc47ab58e2daeb055005fd02af08d050a123522c` | `79473cf68c334619a064120aa6d19cac961efffdd66316dcf6c3983d686039c6` | `fc49f6059d77819c580cb9690bf0afe824263fa4df9d10ac5493f2a5ecc8ea49` |
| `supabase/functions/generate-daily-report-v7/research-master-v2.ts` | incident.files | `bcf78bb2070c0b7e622663d4df8145b2c6befe83da9b0cfe1fa1d3b70b137fc7` | `d00c0fa643709bf927d89b71a607b1887756beb3c8be028726d37e27e875275d` | `49046d4fadb133fb801ed154954f07cb521ce2afa50668cb4ea40e87119ff25c` |
| `supabase/functions/get-report-payload/index.ts` | first.files | `3195efd17035cf81a69d01cac19c2a1f315b04a3a17faf8076c5933d8101b370` | `09a24b5e72a8eec28d58cec4020134443ae8417d5212ee9d41c306b678e245d7` | `583a2d8f596f97c8ff609ef99c1a3b6c936098bd97333392533e5e2e3accae15` |
| `supabase/functions/line-daily-push/index.ts` | incident.files | `e93a8d0f16534de99acd58916e3fc0a6bc743742540908851b05117bb74b1c2c` | `c890c749eb8dfa53462ea3b2aa7291ecfaf9ea2a80fe6e3d270723aea8bad89e` | `fd930bf8b25ab025e959e78a4e6604700ac267770ca080a5c910c55d95c9078a` |
| `supabase/functions/ma-ops-health-check/index.ts` | incident.files | `296f4bd106e1ab00d5cf82a9637462b8091380536658964ebb2c0e073c71ba32` | `88ddffcd7cbf0975e2fb829abf076b36576499b55acd162aaa332bd2027d9557` | `0328663eb38f5c1b3b618707dee0e4781683a780727f5d4ba436172ab44fc106` |
| `tests/accountSubscriberProjection.test.mjs` | second.related_candidates | none; no invented Production claim | `0b6dea9f80335d2f82e48334eadfecbe3d9836843b4162ee2ce63ca8eb038231` | `68e7618483b99751fdc3a76ef7c5d772b0de002ea91945f297a8f853f8f4ec31` |
| `tests/coreRuntimeIntegration.test.mjs` | not_in_existing_registry | none; no invented Production claim | `23c83905a397e3188859cf73ac4a1c23fc1cc2c08a9b68fd647ac8cf3c274426` | `13b2f7d8520d4b6c135b3f41ae6bfb48f2ec7992aabf5c34324f686da7522008` |
| `tests/incidentHealthContract.test.mjs` | not_in_existing_registry | none; no invented Production claim | `d08a832555316adc4ee877be560dc11e4aa4e90e4ccd2424cda7e4abdb2a456d` | `3159e4e144c272951fa88daeb2f0c884b85296b3f702f680f83845e69932cd04` |
| `tests/marketPublicationDelivery.test.mjs` | not_in_existing_registry | none; no invented Production claim | `28b2ae32ce807dca4b401d5465933d2d90955bd96eed3b1e115446b1afdd9e26` | `6ff12a69f183dd7ff69f56104c4634d9db483e42b83201e68660e98d2994373d` |
| `tests/marketPublicationPayload.test.mjs` | first.related_candidates | none; no invented Production claim | `eaa46c0e262768f90563e5655cd58fe490cbe0cbe911a9c15e0b10489c728edf` | `1bdedc04964b1cb78800b0cb5371a64e6c7c31b0af53646151ec70ab3b5dbecd` |
| `tests/productionReliability.test.mjs` | not_in_existing_registry | none; no invented Production claim | `a65c614b3f7bf6ebb6a858e5647372072ed68468f6afc3b3630777a814fac2b7` | `d3e5520ca4ac8e74e805663821016a6a8a43c05024e70811112e0a50320902cd` |
| `tests/publicRelease.test.mjs` | third.files | none; no invented Production claim | `968b476409a2990d9d5f37e62456b264a7e32c41bb90ca83777c30cbbbc8d8b1` | `48d6daf4d16cd8c7b393ad6b41f23b1090a6e9f20a61968ac93d1ff8773c242f` |

### Exact protected declaration successors requiring explicit review

| Path / declaration | Original Production SHA-256 | HEAD / predecessor SHA-256 | Frozen current SHA-256 |
| --- | --- | --- | --- |
| `supabase/functions/generate-daily-report-v7/index.ts#attachResearchMasterV2Shadow` | `0cbfaf3f58ad40399b1082b0ff925e956a0afb7451478293e441c87a8d934123` | `3d982bf3b493e8d05f4697093784a85eeca30dd2ba1d7d93f1a97820fcfcc904` | `08247832599a3ac50a9529f81375e33f7f841c91386215245f75ec9c6a300b81` |
| `supabase/functions/daily-delivery-orchestrator/index.ts#checkpointResultOk` | `d5aa72c5d0a6785b1bce8886e3bfff495b576099d8fe258e2fe5b244977d1465` | `d5aa72c5d0a6785b1bce8886e3bfff495b576099d8fe258e2fe5b244977d1465` | `9dd6e260883fcc8b9b72136dfa89db9c4670a4dd6ac7b3b28626cc7535464bcc` |
| `supabase/functions/get-report-payload/index.ts#buildClosingVerdict` | `77c393f6db9ea14bbbfc5d2a4d5b712cd3af4912fd095accc874b883c27f108c` | `103825987247c69b0c1a1eb645da27394f9d80c49ee830ce9685b881d600f927` | `e69fcb80f9800ecb9fb77f3a636dcee9060d897f6db057dfad2deebd9a0e593e` |
| `supabase/functions/get-report-payload/index.ts#buildHistorySummary` | `0a08c59517a74a16b5c746d9b41f6a2c7e826a60e2e85b5f78c4771e72205c4a` | `d403ea7baa3574ed6c9493296eb55df02eff1d0b957502ced7e12d5fd49d5f70` | `b80bd0d09b6d1693a404387a796009bf1a12647985f4b68507d89a709e2eff08` |

- `attachResearchMasterV2Shadow`: retain private stock research while independently assembling/auditing the canonical market document; no AI prompt replacement.
- `checkpointResultOk`: require a durable COMPLETE closing contract and complete market evaluation with no blocking reasons. This declaration has **no prior incident amendment**; no existing declaration entry may be rewritten to disguise that fact.
- `buildClosingVerdict`: preserve the real producer receipt's `opening_bias`, `opening_confidence`, `predicted_bias`, and `predicted_confidence`, so a frozen opening never borrows a later publication's thesis. Missing data remain null; shifted-opening summary remains null because the current receipt producer does not persist it.
- `buildHistorySummary`: forward the versioned market-publication contract to the shared state/projection and history reader; do not use receipt self-identity as publication authority.

Additional reviewed tracked test since the earlier snapshot: `tests/accountSubscriberProjection.test.mjs` now asserts the actual canonical opportunity formatter and headline count, rejects blocked Premium stock rows, and removes raw preview/count inference. This is an explicit test-contract change, not reclassification of a failed Integrity baseline.

### Complete new candidate artifact hashes at the same timestamp

| Path | Bytes | Snapshot SHA-256 / qualification |
| --- | ---: | --- |
| `docs/operations/core-consolidation-integrity-review-v1.md` | 40428 | SELF: pre-append hash `8ace65da400f46f3884c9db1b8f1aa4785939015cfcc2745c123807ea4ec34a9`; excluded from final self-digest claims |
| `docs/operations/core-consolidation-local-sql-approval-v1.md` | 4227 | `6d56a6cc2761ab3f3eb19813901f1f02c204bb9a8f124230cacf2e183c6065ae` |
| `docs/operations/core-pipeline-consolidation-v1-replay.md` | 48812 | `98a9c82a1e54cf1839844bcd7889374bfc9774ea24389dd10d6e820484b35296` |
| `docs/operations/core-pipeline-subscriber-graph-v1.md` | 10376 | `b1382e5317a94fb7d8478ba0d0a0aa58ae409ab69c1810b68dd128dade8f3b7e` |
| `src/lib/performanceJournalProjection.ts` | 2089 | `a1e62d977d1208fc163bc58899af7acbfb6af93c44a88769c89a8ca6fcd19664` |
| `src/lib/subscriberOpportunities.ts` | 1056 | `b6355c3ff7b61da32e51e169b94c4f79462f67a244547c44f1a7304ab2395f0b` |
| `supabase/functions/_shared/canonical-market-state.ts` | 5189 | `43b2d0744932a58936a0f2bfb47f1bb0ae8800e28ead23b28c6f5280cff422fb` |
| `supabase/functions/_shared/closing-learning-contract.ts` | 21304 | `24eaa5915b836e737622a0a759b71f88c15719e68a41998a30dc74cd752d7d54` |
| `supabase/functions/_shared/market-publication-contract.ts` | 7602 | `8b20ae973c9004756b38446d8bdb5ba7c184c97e261b6a3ff6b61500871c7331` |
| `supabase/migrations/20260909015650_core_market_publication_contract.sql` | 0 | EMPTY BLOCKED SQL ARTIFACT; no content read, authored, hashed or executed by this audit; excluded from executable/registration scope |
| `tests/closingLearningContract.test.mjs` | 35841 | `8815fe213c0697d96249ddcf80fe5b3de0360dbeea404e9cbea6f9c27ffd14e9` |
| `tests/consolidationMarketEvidence.test.mjs` | 6181 | `0782db7b70b8d4122c5651ce2eeda4874a768823f4028c52f1ac7e5559a0ac9d` |
| `tests/consolidationMarketStateAdapter.test.mjs` | 12458 | `27c1585f94b66af8e0e3c6f4c303b5a1eb20f50dfb7b05286c1f7428a0012e61` |
| `tests/consolidationSubscriberBoundary.test.mjs` | 6345 | `5100f30a498a4bc7957ad6553ecfb7b1f200ed914fa5b56e138ddc53f1273ba9` |
| `tests/consolidationSubscriberEligibility.test.mjs` | 10354 | `4505212d68e73fb1c16f7c0b7ef75d59e70c2a3f0985a0a4645ea245f2a73e34` |
| `tests/consolidationSubscriberGraph.test.mjs` | 16736 | `aa841f7b585c9c3a90aff5196152ff8dabc84cf85b81b68c6b2b27584136d412` |
| `tests/consolidationSubscriberLoaders.test.mjs` | 10785 | `ad27c44e5d0b7a2a2402a43129eac1686ffc2d6d976a69f05300a33a70a825c2` |
| `tests/fixtures/consolidation-v1/captures/2026-09-07-fetch-persistence.json` | 3030 | `72382ea27f76d54b388188bb72c0685546e73a1b78ae10827bdeefbaa2ab7be6` |
| `tests/fixtures/consolidation-v1/captures/2026-09-08-quality-projection.json` | 3110 | `9d06a150df101d27c15c1d84ac63e459f3c8b870ba906aa07f13209d0b81fecc` |
| `tests/fixtures/consolidation-v1/captures/2026-09-09-premarket-quality.json` | 6920 | `6c7bfa621f62c89aa9ec8387e09cba43caf591c6ee28e73a3ff9b46810a99868` |
| `tests/fixtures/consolidation-v1/clock.test.mjs` | 2957 | `48ea5227d0083ce0efa3ebb607b62cb9495725b9a09b520ada1408fed040929d` |
| `tests/fixtures/consolidation-v1/index.mjs` | 2859 | `69c8b11597a84be895bbe172ba25556f6311558ff092e2d6069a08ec17a229db` |
| `tests/fixtures/consolidation-v1/manifest.json` | 1527 | `7ca6fcca0386978da0f727bc0eb40c66963f43d30a7dc1b42d50fb65e7a2a33c` |
| `tests/fixtures/consolidation-v1/offline.test.mjs` | 5452 | `364cd3c2cc9266e65c424c7b18dd2c3ee9f257ac39f7ec2dadbb93b984373d78` |
| `tests/fixtures/consolidation-v1/provider-chain.test.mjs` | 12032 | `057eee8073ce75fea72c903baf03609f13b1aaea990c83d8af23270a1401c710` |
| `tests/fixtures/consolidation-v1/providers/synthetic-20260714.json` | 1953 | `6aab9b5f4ea89e607eafd3a8e673dc8c38a61e6697312485c3f68dd37ebf5ab6` |
| `tests/fixtures/consolidation-v1/scenarios/market-only-counterfactual.json` | 1611 | `9049ff39d407451690245feb81723d951ad7054d98b39b5fa72484dc2c4c0fd6` |
| `tests/helpers/consolidationLocalScope.mjs` | 4460 | `20d01432bf6e920527c3a317a5bf78fca898e62fd3dfc2cb4f2d827df2254e44` |
| `tests/helpers/consolidationProviderReplay.mjs` | 3486 | `dc5fe1c4da2eb6e26edf5666aab7fbaf2cb383c36292e21ac98be3f23cd10092` |
| `tests/helpers/consolidationVmClock.mjs` | 6208 | `319f910c2b13a60aed31c821c0b1b84f9fa99644ab8d36659289fa40fa8b2db6` |
| `tests/subscriberFrozenOpening.test.mjs` | 10268 | `4682d8d54e8f1c9b063d3ac881ee45146ba4ef7bf16ecad2f6335647a4ae75c4` |

These complete hash inventories are timestamped observations, not authority to include every file in a commit. The 47 preserved paths remain unreviewed and excluded. This document's final hash must be recorded externally after its last append; the self row is deliberately not described as its final digest.

### Validation and remaining boundary

Root reported the fresh, frozen application candidate as Node **761 total / 689 pass / 72 Integrity failures** before any fourth-layer registration. Type-check, lint and build passed (203 modules, 1.34 s); 9 Edge checks and 58 Deno tests passed. These are root-reported results, not a new run by this attribution task. No fourth-layer result, full DB E2E, Browser, CI, Readdy Preview or readiness is claimed here.

The only actual safety-review denial remains local SQL migration authoring. See [the named local SQL approval scope](core-consolidation-local-sql-approval-v1.md). No refused SQL definitions are copied into this document. Real PostgreSQL/Auth/Edge same-clock replay, real handler persistence, database publication/RLS and full acceptance remain **NOT_RUN**; fixtures or a VM clock probe are not full E2E evidence.

## Authorized fourth-layer registration — audited 2026-09-09T03:27:24Z

The later owner instruction explicitly continued reversible local/branch Integrity append-only work: 「在可逆、本機／Branch、測試、Integrity append-only、Commit、Push、CI、Readdy Preview 範圍內，沿用先前完整預先核准，不要再次詢問 Sony。」 This is provenance from the current user message, not an invented new attachment or user-message timestamp. The prior full Consolidation V1 attachment was read in full and cross-checked. The timestamps here and in the artifact are audit recording/observation times.

Exactly one fourth section, `core_pipeline_consolidation_registration`, was appended. It registers the independently reviewed **23 changed previously registered paths**, **15 additional changed tracked candidates**, **26 directly related new runtime/test/fixture/helper paths**, and **4 protected declaration successors**. It does not register any migration, the 47 known unrelated paths, or operational review documents. No old `files`, `modified_declarations`, Production hashes, approval history, or first/second/third registration was edited. The old full registry now exists as the exact reconstructed predecessor, not as a falsely unchanged complete current file.

| Independent anchor | SHA-256 |
| --- | --- |
| Complete predecessor registry (remove only fourth section and use canonical JSON serialization) | `7597edbd731636882e442faecd3bc4f8dd6f0701e07dd1ed7ddfe32e43b7505b` |
| Current full registry including fourth section | `0c3e060ed49f6812db13839409fb48b0642deb11df2f391ff58d48f7ca5a4ae0` |
| `docs/operations/evidence/core-consolidation-candidate-20260909.json` | `e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315` |
| Complete fourth section | `01804c4ed0b2f55071bac23bd575a26964c683714fea2262aa4eeeccb0bdafab` |
| Exact source patch (`patch_lines.join('\n')`) | `36abc6f3e6a33a1dd142ae68319e33c852098a34939836dc8aa1668123d8bd7d` |
| Unmodified original three-layer verifier | `2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0` |

The immutable candidate artifact contains original Production hashes when an actual predecessor Production pin exists, exact HEAD/current file hashes, exact patch bytes, per-path semantic reasons, rollback references and explicit approval provenance. It records absence rather than inventing an original/Production hash for new files. Its 11 AI/evidence/strategy policy rows have identical Production/predecessor/current hashes. `checkpointResultOk` is explicitly marked as lacking any old incident amendment; its new exact override is not inserted into old entries.

The dedicated verifier pins artifact, section, source patch, complete old registry, original guard and Production manifest independently. It caches observed source bytes, checks exact finite path/declaration allowlists, reverses strict UTF-8 unified patches (including original EOF/newline state), reconstructs all 38 existing source preimages and absence for all 26 new files, and only then calls the unchanged original three-layer resolver. Every one of 698 protected declarations is checked against the effective predecessor or one of the four exact reviewed successors. No caller may infer a blanket protected-declaration exemption from an approved file.

The final two provenance reasons explicitly cover all frozen-opening changes: `subscriberReportContract.ts` includes strict date/current-revision/frozen-opening publication identity and durable receipt binding plus receipt-derived `openingDecision`; `get-report-payload/index.ts` includes the four real opening fields and current/history persisted publication-contract propagation. Missing shifted-opening summary stays null; nothing manufactures completion or a thesis.

### Separately reviewed verifier/test plumbing

These Integrity implementation files are not circularly treated as application-source candidates inside their own artifact. Their exact review snapshot is recorded below. Rollback is their fixed HEAD source for existing files, or removal of only the explicitly new helper/test. All changes are local test/metadata plumbing authorized by the owner instruction; no application source was changed after the frozen snapshot.

| File | HEAD SHA-256 | Current SHA-256 | Reviewed effect |
| --- | --- | --- | --- |
| `tests/helpers/consolidationIntegrity.mjs` | new | `0994de2d3326de77b1f9c3aa2bdae601758c3dc30fbcbef9197a69b6a7bdbe1a` | Independent fourth-layer verifier; exact allowlists and predecessor reconstruction, not a latest-hash waiver. |
| `tests/consolidationIntegrity.test.mjs` | new | `968e50b57da286924b4658d85b26802cc27b7fa59ca9e43d2fa1c2225708e13b` | 41 positive/negative checks authored independently; mutations are in memory only. |
| `tests/subscriberProjectionIntegrity.test.mjs` | `eb5dbd2f00f982623040e8a6f746f711c584b3717f944e20304cb98463bba96d` | `5ddf1dc40cf4e51d60fabae8fd5300fff8b2aa4bfabca52d06f211529690daf6` | Bootstrap only: verify fourth layer, then pass reconstructed predecessor registry/readSource to the unchanged original verifier and every existing assertion. |
| `tests/coreProductionPreservation.test.mjs` | `c7d35e53e64b2512e09e338b4b898e86d2ed8618405860111f58e374bbf41575` | `bb2859b169e4962507ca984be5ae1432ecc472504b3cd3edc9dbe13e623dbcf1` | Use verified fourth hashes for current amended files/declarations; original integrated-source assertions use exact reconstructed predecessors. Original Production pin checks remain. |
| `tests/productContract.test.mjs` | `4ee7f1afd7f22171eecf013fec641948ed8a0d3f3f57977060b7daace548b665` | `df060cb1f0fb570891055b45c9226c28ed23aa1f3dd6aad7502de086ca2bf653` | Preserve original aggregate source hash/count assertions over exact predecessors; exclude only the already validated exact new-file allowlist from historical tracked-file count. |

Read-only direct comparison proved every reconstructed existing file equals `git show 6469630795fb1215595306c026437d850b668801:<path>` byte-for-byte (**38/38**). Direct string comparison also proved the entire original `tests/subscriberProjectionIntegrity.test.mjs` body starting at `const hash =` through EOF is byte-identical to HEAD: all original 70 test assertions/negative cases are retained. They execute the original verifier against verified predecessor bytes, not an unconditional pass stub. The unchanged original helper hash is independently asserted in the new verifier and new tests.

New negatives cover unknown/duplicate/excluded paths; unknown Auth or duplicate declaration overrides; original Production file/declaration/history mutation; source+patch+mutable-registry simultaneous mutation; missing new runtime source; exact checkpoint override mutation; adjacent Auth and AI/evidence policy mutation; unmodified old helper/manifest/first-artifact mutation; and attempts to enable Production/SQL/merge/stability authority or waive fresh validation. Every negative verifies the clean complete fourth candidate first so unrelated drift cannot count as successful tamper detection.

### Actual local validation

Command executed with Node v22.23.1:

```sh
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test \
  tests/consolidationIntegrity.test.mjs \
  tests/subscriberProjectionIntegrity.test.mjs \
  tests/coreProductionPreservation.test.mjs \
  tests/productContract.test.mjs
```

Result: **115 total / 115 passed / 0 failed / 0 skipped**, exit 0 (9.83 s). This combines 41 new fourth-layer checks with 74 existing preservation/product/legacy checks. Dedicated helper syntax check and tracked `git diff --check` also exited 0. Fresh full-repository Node/build/Edge/Deno results are owned by root and are not inferred from this targeted run. The earlier 72 Integrity failures remain documented above as the true pre-registration result; they were not renamed a baseline or waived.

Post-plumbing working-tree tally at this audit: **42 tracked changed paths + 34 untracked candidate paths**, excluding exactly **47 preserved unrelated untracked paths**; one candidate path remains the empty, blocked SQL artifact and is not registered or executed. Tracked-only diff is **+1,941 / −2,792**. The source-registration set remains the exact 64 frozen runtime/test paths, not this larger working-tree inventory.

Integrity completion does not imply new SQL publication authority or a complete production-handler replay. The named local migration safety-review blocker remains unchanged; new Consolidation SQL and the full Fetch → persisted publication → closing/learning → acceptance chain remain **NOT_RUN**. Existing SQL baseline checks and synthetic local response Browser checks are distinct lanes. No Production call/write, secret access, VM operation, commit, push, deploy, migration or Cron change was performed by this Integrity registration task. `NEW_RELEASE_CANDIDATE` is not declared READY.

## Authorized fifth-layer delivery/projection successor — audited 2026-09-09T04:25:23Z

The current user message's reversible branch/test/Integrity append-only preapproval remains the provenance; no new attachment or owner-message timestamp is invented. Root reviewed and accepted the exact shared publication / LINE / orchestrator / health / sole Subscriber projection changes before registration. This fifth section is `core_market_delivery_projection_registration`, approval `CORE_MARKET_DELIVERY_PROJECTION_APPEND_20260909`. Its authority flags explicitly exclude Production, SQL authoring/execution, merge, automatic stability-day credit, and replacement of fresh validation.

The source remedy keeps a committed market publication independent of current private stock/member QA. CORE delivery requires an actual successful existing research-input run receipt with exact report/date/snapshot/member identity and PASSED committed semantic result; the frozen independently audited market document and exact source ledger must agree. Legacy 90–100/PASSED proof stays intact; CORE also requires 100% snapshot coverage and complete source freshness. Invalid/present CORE does not fall back. All modes require nonempty exact committed pointers. LINE consumes the central subscriber projection and audited market fields, cannot recover stocks/copy from raw aliases, and cannot promote a committed market-only/no-trade mode from newer stock QA. Explicit empty/invalid canonical recommendation lists are handled by the sole Subscriber projection; legitimate Free omission remains redacted, not a fabricated evidence failure.

### Exact fifth anchors and raw predecessor preservation

| Anchor | SHA-256 |
| --- | --- |
| Exact original Fourth raw registry bytes | `0c3e060ed49f6812db13839409fb48b0642deb11df2f391ff58d48f7ca5a4ae0` |
| Independently fixed normalized Fourth object | `11a4149d0d24b80f9a9fe31364b369c90b09df72feeb971792cbfbd27476610a` |
| Full registry including Fifth | `e5f0c29c7b371a0d9ec36bf63f9bb4f2b384218a277dc239cd4ba50b1362ff5d` |
| Fifth artifact `docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json` | `861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056` |
| Fifth complete section | `36f073ab70754343b39b0c02edfe00e777c116d147708f7a87725a7af9eb0475` |
| Fifth exact source patch | `12298ea146d188910154593866b80422520efd3df3482c372d00274250831eda` |
| Fifth helper `tests/helpers/consolidationDeliveryIntegrity.mjs` | `3770a8e3305933f5f42add561ac5b8cbd98273c036c15a49c6c44338c0a2e23c` |
| Unchanged Fourth artifact | `e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315` |
| Unchanged Fourth helper | `0994de2d3326de77b1f9c3aa2bdae601758c3dc30fbcbef9197a69b6a7bdbe1a` |
| Unchanged original three-layer helper | `2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0` |

The first targeted Fifth bootstrap exposed a serialization bug: the old approved append preserved a newline before its separator comma, so the complete raw Fourth SHA is not its normalized-object SHA. That failed run is not counted as a successful negative or renamed a baseline. Only the new Fifth helper was corrected: it now separately pins the parsed predecessor object, removes exactly the fixed Fifth append suffix from actual registry bytes, reconstructs the raw Fourth bytes, checks the original `0c3e…` digest, and checks raw/parsed predecessor agreement. No original registry field, formatting, old artifact, guard, Production pin, or earlier assertion was changed to resolve this.

### Exact 15-path scope

There are **11 existing Fourth candidates/plumbing preimages + 4 directly related new tests**. This is the finite reviewed source set, not a blanket current-working-tree allowance. Source patch bytes, per-path reasons, rollback preimages and provenance are in the immutable artifact.

| Path | Exact Fourth preimage SHA-256 | Exact Fifth candidate SHA-256 |
| --- | --- | --- |
| `src/lib/subscriberReportContract.ts` | `4bfc6bbac43c55d44b90355af131f119058aa4824c1f0fff0b48fc5755ff4f23` | `940e7356dbe36a7a8b066f2af695daf495fc1c2998ddb356d273e705dc60c1d8` |
| `supabase/functions/_shared/market-publication-contract.ts` | `8b20ae973c9004756b38446d8bdb5ba7c184c97e261b6a3ff6b61500871c7331` | `604f9bde16467755fe6172262db199b3dd89375b4a891feaf299dc5849484301` |
| `supabase/functions/line-daily-push/index.ts` | `fd930bf8b25ab025e959e78a4e6604700ac267770ca080a5c910c55d95c9078a` | `6a659df04f16b4553f2f5e18a6fb8f0a1f0b866bbc4e1a9b00d83f0bd80c695c` |
| `supabase/functions/daily-delivery-orchestrator/index.ts` | `3686c3d9ffa14bdeaf76f444063659ce69294ee8f9e458669aba3cc493e09692` | `95551e7a2fc60b4cf9c4d3a2c230b573b34990b51d44168a8da45b5eb870bacb` |
| `supabase/functions/ma-ops-health-check/index.ts` | `0328663eb38f5c1b3b618707dee0e4781683a780727f5d4ba436172ab44fc106` | `f2d5ddd6772c0af2fd28eb35c4e966d089c6fe2aaf2feb320ca3d3861793d651` |
| `tests/incidentHealthContract.test.mjs` | `3159e4e144c272951fa88daeb2f0c884b85296b3f702f680f83845e69932cd04` | `8a76b1ba6e70a886a00c22fd574af5370ea75acc1f67ddda2b5f1ceebab7c83c` |
| `tests/marketPublicationDelivery.test.mjs` | `6ff12a69f183dd7ff69f56104c4634d9db483e42b83201e68660e98d2994373d` | `e8b1ffdf2070e6a9c000d4802b452abd12f859b1331d4c2cc2a3904ba8217457` |
| `tests/coreProductionPreservation.test.mjs` | `bb2859b169e4962507ca984be5ae1432ecc472504b3cd3edc9dbe13e623dbcf1` | `9a12284eece945e9815b2306411ec85b90ddfabcaf4e59f9bd9b80a23f02d37d` |
| `tests/productContract.test.mjs` | `df060cb1f0fb570891055b45c9226c28ed23aa1f3dd6aad7502de086ca2bf653` | `e7b87644d51c85c545462882678f8579351e2bc7b3cc13f08d4d0ac6e773a1d0` |
| `tests/subscriberProjectionIntegrity.test.mjs` | `5ddf1dc40cf4e51d60fabae8fd5300fff8b2aa4bfabca52d06f211529690daf6` | `55197d4a98b6e9652e17e4903f97b74ba91ed2352d473fa5e2f978bc6633aedf` |
| `tests/consolidationIntegrity.test.mjs` | `968e50b57da286924b4658d85b26802cc27b7fa59ca9e43d2fa1c2225708e13b` | `031f73152a786b954d3ffe01ddbfa4ddff51e642dd507b929db93166c45cfce4` |
| `tests/consolidationLineProjection.test.mjs` | absent (new) | `b858599f301903f698d0baa0f1469a28a49cc1e33716b791c6801844874bb447` |
| `tests/consolidationPublicationConsumers.test.mjs` | absent (new) | `a90d956c587ab2e3b593207198b45dffb9f0c24c89100a4a556f6e828e9d8a13` |
| `tests/consolidationRecommendationProjection.test.mjs` | absent (new) | `0f1132b97c73eb6acef76c1ffa3a506ccabd65a91a88ba555026fb7d4b16aea4` |
| `tests/browser/consolidationSubscriberMatrix.e2e.mjs` | absent (new) | `c3308073328fc1b71cd4d1ad2204186875454ed6cd35dfd2ec2a1772b7b44d7d` |

The four new paths reconstruct absence at the Fourth predecessor. The Fifth helper and its independently authored negative suite are verifier plumbing, not circularly included in their own source artifact. Unknown paths, migration paths, path traversal, secrets, the 47 known unrelated untracked files and research side files cannot be admitted by mutable metadata.

### Exact two protected declaration successors

Every protected declaration is checked against the verified effective Fourth hash, except these two exact, independently pinned successors. No AI/evidence/prompt/strategy declaration is added to the allowlist; the 11 prior AI policy pins remain byte-identical.

| Declaration | Original Production SHA-256 | Exact Fourth SHA-256 | Exact Fifth SHA-256 |
| --- | --- | --- | --- |
| `supabase/functions/daily-delivery-orchestrator/index.ts#DeliveryState` | `88beae04190ec5051b6d372da20a36256601af01382e7732e6163a334af580ce` | `6b2bd31eb391acce768c171ed47cac8f7fed122c4ea631593d8efaad589bd04a` | `0756ce17b86605f0d2ab419e81bd8525d9c1cf437a134d93400fdbd948fd11fc` |
| `supabase/functions/daily-delivery-orchestrator/index.ts#loadDeliveryState` | `9271dcebe511028f6a66ba0b43447e938f8fcbccc4de9f3d2b7fb111b67c9e97` | `b845c65d103382fe82571b1be9107aa53832abd69d9bc5d87bcff98ca8df4d7e` | `435a3c8c7335820330e076fa5345da48f44344083b39bd35288bd8c3d390cd63` |

The prior Fourth `checkpointResultOk` override remains effective and unchanged. An approved orchestrator file is not permission to change adjacent `authorizeRequest` or any other unregistered declaration.

### Original assertions and actual local verification

Only setup/import wiring above the existing `const hash =` markers changed in the old 70- and 41-test files. Full assertion/helper bodies through EOF remain independently byte-pinned:

| Preserved assertion body | SHA-256 |
| --- | --- |
| Original 70 prior-layer assertions | `a0e57cb4abcbacf66cf71b3785d426a6ea51f541e69b98021f814b8e9fcca2d2` |
| Original 41 Fourth-layer assertions | `a336572755e95da10e00add17ac4d62c0588cb9e615fc56f32c44813fb8f3f9a` |

The same four-file Node v22.23.1 command shown above was executed after the Fifth correction: **115 total / 115 passed / 0 failed / 0 skipped**, exit 0, **7.09 s**. This is all 41 Fourth checks, all 70 older checks, and four preservation/product checks, with all original guard implementations executing on exact reconstructed predecessors. New Fifth negative tests were still being authored independently at this recording time; no unexecuted negative suite result is claimed here. Tracked `git diff --check` exited 0.

A separate read-only comparison also passed **11/11 exact Fourth preimage checks**: seven runtime/existing-test preimages were independently forward-reconstructed from the immutable Fourth artifact plus HEAD and compared byte-for-byte; the four preservation callers matched the independent exact Fourth SHA values already recorded in the preceding section of this document. All four new-candidate absences and both old assertion-body pins were separately checked.

Root reported the fresh source-focused lane **96/96 passed** (actual isolated shared/LINE/consumer/projection functions against synthetic in-memory rows). Type/lint/build, 58 Deno cases, 9 Edge checks, nested 17 and graph 6 checks passed; the unchanged legacy DB baseline was 9/9 passed, not the new Consolidation SQL. Browser 1120 v2 was still running at this recording; its frozen harness hash is recorded as source, not as a successful run.

No SQL authoring/execution, Production call/write, secret access, host/VM change, commit, push, deploy or Cron modification was performed by this Fifth registration. The named local SQL-authoring safety refusal remains; new Consolidation SQL and full producer→persisted publication→Closing/Learning→Acceptance E2E remain **NOT_RUN**. The ordinary TypeScript remedy and its Integrity result do not grant publication-write authority or make this candidate READY.

## Authorized sixth-layer test-compatibility successor — audited 2026-09-09T04:49:29Z

This is a test-only append under the same current-owner reversible local/Branch/test/Integrity preapproval; the timestamp is audit-recorded time, not an invented owner-message timestamp. Root and an independent reviewer inspected all seven affected cases before registration. Runtime and Browser sources remain exactly frozen at Fifth. No SQL or protected declaration override is authorized by Sixth, and the original Production hashes, earlier approval sections, artifacts and guard implementations remain unchanged.

The initial full Node result remains **945 total / 937 passed / 8 failed**: one local loopback-listen permission failure was separately rerun by root with **9/9 passed**; seven source-text expectations referenced removed inline consumer logic. Those seven tests were corrected to inspect the actual central authority and formatter, not bypassed or accepted as a failing baseline. The dedicated three-file run passed **88/88**, with exactly the same 88 named test cases. **81 unrelated case bodies remain byte-identical**; 12 stale assertion calls were replaced, and assertion calls across the seven reviewed cases increased from **131 to 162**. Auth, outbox, retry, Cron, SQL and other unaffected checks remain.

### Exact Sixth and predecessor anchors

| Anchor | SHA-256 |
| --- | --- |
| Exact raw Fifth registry | `e5f0c29c7b371a0d9ec36bf63f9bb4f2b384218a277dc239cd4ba50b1362ff5d` |
| Independently fixed normalized Fifth object | `8df45d8b4d7f367f015313282a5c6272003ca5eeee0b8fcde8309283356585ee` |
| Full registry including Sixth | `8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737` |
| Sixth artifact `docs/operations/evidence/core-consolidation-test-wiring-20260909.json` | `69cf698d21fb306a002025d1edd04e4b1a825baf905698724e40f0cae8d52d96` |
| Sixth complete section | `b33572e43b278ac2c05292841a065575069229eed896bec9cc8d0ac35d40d207` |
| Sixth exact test-source patch | `0356eeeeb8ba7914f66eb9bae18080d9ac43ce4ac6cdb87e6b7cd4dd6194f6a8` |
| Sixth helper `tests/helpers/consolidationTestWiringIntegrity.mjs` | `f4d367c84bb6ad4267d4f07a41341c9421d6c36eec2c659cbc4f82825e049630` |
| Unchanged Fifth helper | `3770a8e3305933f5f42add561ac5b8cbd98273c036c15a49c6c44338c0a2e23c` |
| Unchanged Fifth artifact | `861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056` |
| Exact complete Fifth 66-test preimage | `a150cc75f4e4581823299106f2b07164c493cbd415b84bf2189d585fed1a69fd` |

Section `core_delivery_test_wiring_registration` / approval `CORE_DELIVERY_TEST_WIRING_APPEND_20260909` contains exactly eight existing top-level tests, no new candidate and no declaration. All eight preimages were independently reconstructed and checked before header changes: the three compatibility files from immutable Fifth/Fourth patches plus HEAD; the five caller files against independently recorded frozen Fifth hashes. With only those three test preimages substituted, the unchanged original five guards passed. After installation, Sixth strictly reverses its fixed patch to the same eight original hashes, reconstructs exact raw Fifth registry bytes, and executes the unchanged Fifth resolver, which in turn executes the earlier guards. Its raw-registry reader returns the true predecessor bytes, not a normalized substitute.

| Path | Exact Fifth preimage SHA-256 | Exact Sixth candidate SHA-256 |
| --- | --- | --- |
| `tests/productionLivePipeline.test.mjs` | `7360317de86fbb5b990321a9aa01be19464032b54175303a5efb8f625fca0a79` | `9021c72366b2b5a31ec9f9b53fb12ed52dd0047c8f543028cbbd87de629ea0e8` |
| `tests/productionReliability.test.mjs` | `d3e5520ca4ac8e74e805663821016a6a8a43c05024e70811112e0a50320902cd` | `6d3f3efbe352dc6e7d01023aeda8e8ca0319e6a12da60eb0f2bdce57aae6b972` |
| `tests/publicRelease.test.mjs` | `48d6daf4d16cd8c7b393ad6b41f23b1090a6e9f20a61968ac93d1ff8773c242f` | `50e3d73e61ce45b2dd788e5b1edb3c5659f6a882121b3b4d49894d340ecccecc` |
| `tests/coreProductionPreservation.test.mjs` | `9a12284eece945e9815b2306411ec85b90ddfabcaf4e59f9bd9b80a23f02d37d` | `3b6868dfbc66468e69310c92becd680ef229295572467da8dcbfd09dfcfa7dbb` |
| `tests/productContract.test.mjs` | `e7b87644d51c85c545462882678f8579351e2bc7b3cc13f08d4d0ac6e773a1d0` | `f043d7c4950ce65722f5096d837fcfc9b5bb5e2d58c727f639120031a64a5ac4` |
| `tests/subscriberProjectionIntegrity.test.mjs` | `55197d4a98b6e9652e17e4903f97b74ba91ed2352d473fa5e2f978bc6633aedf` | `7c46acda33afb4baf10cbc8075af4e3a80d01df77fd4887de3d42a302d250dfb` |
| `tests/consolidationIntegrity.test.mjs` | `031f73152a786b954d3ffe01ddbfa4ddff51e642dd507b929db93166c45cfce4` | `25c68862cec342dc3701e7606bd11f1dd8e74daad60ab2b441589166c4b57f15` |
| `tests/consolidationDeliveryIntegrity.test.mjs` | `a150cc75f4e4581823299106f2b07164c493cbd415b84bf2189d585fed1a69fd` | `936a357b1c50083ed5c8882a70b96be8891f75fb97859eff8d688d40a1671e75` |

Only setup/import routing changes in the five preservation callers. No assertion body in the old 70, Fourth 41 or Fifth 66 suite changes; the helper independently checks both current and reconstructed bodies from `const hash =` through EOF:

| Immutable assertion/helper body | SHA-256 |
| --- | --- |
| `tests/subscriberProjectionIntegrity.test.mjs` | `a0e57cb4abcbacf66cf71b3785d426a6ea51f541e69b98021f814b8e9fcca2d2` |
| `tests/consolidationIntegrity.test.mjs` | `a336572755e95da10e00add17ac4d62c0588cb9e615fc56f32c44813fb8f3f9a` |
| `tests/consolidationDeliveryIntegrity.test.mjs` | `7ae34c94c8069a49ac5f335dfb65aac772794f8581cfe0bf9a12a8338e797f4b` |

### Seven equivalent-or-stronger compatibility cases

| Reviewed case | Assertion calls before → after |
| --- | --- |
| `tests/productionLivePipeline.test.mjs` — daily sentence rejects stale report dates and delivery fails closed | 4 → 8 |
| `tests/productionReliability.test.mjs` — delivery, payload, and Content OS all require the same semantic member revision | 15 → 20 |
| `tests/publicRelease.test.mjs` — LINE delivery is fail-closed and persists per-subscriber retries | 17 → 21 |
| `tests/publicRelease.test.mjs` — runtime deployment and missing checkpoint schedules are reproducible | 54 → 61 |
| `tests/publicRelease.test.mjs` — LINE retains verified Production v59 Flex layout and refuses evidence-blocked stock delivery | 11 → 17 |
| `tests/publicRelease.test.mjs` — report, site payload, and LINE converge on the same immutable decision snapshot | 18 → 21 |
| `tests/publicRelease.test.mjs` — LINE daily push is paginated, multicast, retry-safe, and subscriber-idempotent | 12 → 14 |

The replacement checks preserve leading report-date rejection in the central result and prove the existing fail-closed guard occurs before normal LINE outbox delivery; bind committed CORE semantic run/report/snapshot/member identity while retaining legacy PASSED proof; retain frozen CMS/source-ledger and 90/100 quality boundaries while treating newer raw private counters as diagnostics; and verify exact snapshot pointers plus authoritative projection-only summary/stocks. The real isolated LINE formatter is exercised with blocked-stock/no-raw-alias-leak, invalid/PARTIAL publication rejection and qualified-stock positive controls. These are synthetic local contract controls, not a Production vendor delivery or full persisted publication replay.

### Actual verification at this audit

Command (Node v22.23.1):

```sh
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test \
  tests/consolidationDeliveryIntegrity.test.mjs \
  tests/consolidationIntegrity.test.mjs \
  tests/subscriberProjectionIntegrity.test.mjs \
  tests/coreProductionPreservation.test.mjs \
  tests/productContract.test.mjs
```

Result: **181/181 passed**, 0 failed/skipped, exit 0, **13.98 s**. These are every original 70 + Fourth 41 + Fifth 66 test and four preservation/product cases, not an assertion-count reduction. The original fifth-only independent negative run previously passed **66/66** in **18.37 s**. Dedicated Sixth negatives are independently being authored at this recording and are not yet claimed as passed. `git diff --check` exited 0. An initial patch-emitter formatting error applied no files; the stale pre-installation guard failures from that attempt are neither a new baseline nor successful negative tests. Only the intended complete patch was then applied; no fixed predecessor artifact or guard was changed to resolve the emitter issue.

Root reported Browser final v2 **1120/1120 passed**, with frozen runner SHA `c3308073328fc1b71cd4d1ad2204186875454ed6cd35dfd2ec2a1772b7b44d7d` and receipt SHA `23ab60dc8d1c86b810e2421a2299be19032d0086451c891f6651f3c8ecbcc409`; this uses real local PKCE/RLS plus synthetic local report responses, not the complete producer/new-SQL chain. Root owns final fresh full Node/build/Edge results after the Sixth negative suite; no full-repository pass is inferred from this targeted result.

All 47 unrelated untracked paths and the empty safety-refused SQL file are excluded from Sixth. No runtime/Browser edit, Production call/write, secret access, host/VM operation, commit, push, deploy, migration or Cron change was performed by this registration. The specifically refused local SQL-authoring action is unchanged and not retried. New Consolidation SQL and the complete Fetch → persisted publication → Closing/Learning → Acceptance replay remain **NOT_RUN**; this test-only successor does not grant publication-write authority or declare the candidate READY.

### Completed Sixth negative and full-Node evidence

The independent new `tests/consolidationTestWiringIntegrity.test.mjs` is frozen at
SHA-256 `5214c37d29af5a98dce1335b92ecb53beba1b364ef30253885f688492a512c93`.
Its executed result is **92/92 PASS**, exit 0, 17.48 seconds; log:
`/private/tmp/ma-consolidation-sixth-negative-20260909.log`.
Root read all 292 lines of this test and all 283 lines of the new verifier, then
independently executed the exact predecessor reconstruction successfully.
The negative suite verifies every original guard/body remains effective and
rejects source, patch, hash, path, old approval, runtime and authority tampering.
All tampering is in memory, not edits of baseline or Production files.

Root's subsequent `npm run test:public` completed **1,037/1,037 PASS**, exit 0,
zero skipped/failed, 29.446 seconds. Log:
`/private/tmp/ma-consolidation-sixth-full-node-20260909.log`.
The 181 preserved cases and 92 Sixth cases are included in that total. The
earlier failed complete run is still retained separately. These results establish
the local Node/Integrity gate only; they do not claim new-SQL, real persisted-chain,
new-commit CI, actual Readdy host or Production acceptance success.
