// A separate composition seal. Child receipts keep their original bytes and
// are tested at immutable parent trees, only AFTER the complete live tree is
// admitted here. This is source integrity, never deployment authorization.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
export const INTEGRATION_BASE='754850ba1c66329d12eac8e98ab799e0a0c9123e';
const MEMBER_FORK='cf3b6b21c9e3d022a8132ed3b566b544d290a48f';
export const INTEGRATION_PARENTS=Object.freeze({core:'bc48d784487fd5ae63ac2bb9c28d9343de41034f',member:'bcf665cad237e9c5e76c9abdd12cc12d5133aaed'});
export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-original-ingress.json';
export const ORIGINAL_INGRESS_BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
export const FROZEN_COLD_SOURCE_MANIFEST='docs/operations/evidence/core-member-integration-20261019-cold-source-priority.json';
// Exact candidate engineering scope, not a deployment or source-rights grant.
export const ORIGINAL_INGRESS_DELTAS=Object.freeze([
 '.github/workflows/original-observation-ingress.yml',
 'docs/operations/original-observation-ingress-20261019.md',
 'src/features/vnext/contracts.ts',
 'src/features/vnext/engine.ts',
 'src/features/vnext/originalIngress.ts',
 'supabase/migrations/20261019123345_original_observation_ingress_candidate_v1.sql',
 'tests/coldSourcePriorityAdmission.test.mjs',
 'tests/helpers/integrationAdmission.mjs',
 'tests/originalIngressAdmission.test.mjs',
 'tests/r10FunctionalSourceClosure.test.mjs',
 'tests/vnextContracts.test.mjs',
 'tests/vnextOriginalIngress.test.mjs',
 'tests/vnextOriginalIngressDatabase.integration.mjs',
 'tests/vnextOriginalTimestamp.test.ts',
].sort());
const PRIOR_INTEGRATION='8146eb4be02acd1a8ccf55e9b47c48cae762dc5e';
const FROZEN_INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261017.json';
const PRIOR_R2='cc167304814b2223977a36802b2666ea8203ff36';
const FROZEN_R2_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r2.json';
const PRIOR_R3='8320a544726ee3f5e4be47d53288416e091b6211';
const FROZEN_R3_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r3.json';
const PRIOR_R4='6a06ea7fd35265a3be39463dd1b68698ca1a9c22';
const FROZEN_R4_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r4.json';
const PRIOR_R5='bfc2bcc482f961124c1c89265f89254de910428e';
const FROZEN_R5_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r5.json';
const PRIOR_R6='1a3b8c902a9b08b69525aea5a280bf546295ffe4';
const FROZEN_R6_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r6.json';
const PRIOR_R7='b29ee8a80f798c20d8ae5e9234ade8544852d10f';
const FROZEN_R7_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r7.json';
const PRIOR_R8='d04de5da23fea367b7eab23d6c5cc42c3b25b3d5';
const FROZEN_R8_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r8.json';
const PRIOR_R9='882d6799e4646c7917621843a65b960f7a7666ed';
const FROZEN_R9_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r9.json';
const PRIOR_R10='cb678aeee5601c71f9b943cddff861763effc753';
const FROZEN_R10_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r10.json';
const PRIOR_MEMBER_CONTINUITY='588e83f3012a31469d5c58b6874ec49c98a2e4b9';
const FROZEN_MEMBER_CONTINUITY_MANIFEST='docs/operations/evidence/core-member-integration-20261018-continuity.json';
const PRIOR_FRONTEND_TYPES='a2c1de5d552d9754015112fbc0049bcd3f04cf38';
const FROZEN_FRONTEND_TYPES_MANIFEST='docs/operations/evidence/core-member-integration-20261018-frontend-types.json';
const PRIOR_OFFICIAL_ACTUALS='8c13ed18636ca3382f88a635f1404192ebbc74d1';
const FROZEN_OFFICIAL_ACTUALS_MANIFEST='docs/operations/evidence/core-member-integration-20261018-official-actuals.json';
const PRIOR_EVIDENCE_CLOSURE='b07001e55f7c7892f2b46094da1d117a050b95dc';
const FROZEN_EVIDENCE_CLOSURE_MANIFEST='docs/operations/evidence/core-member-integration-20261019-evidence-closure.json';
const PRIOR_FINANCIAL_PROFILE='106bc79f69677c778d4cf237c9d06daadd9c6f21';
const FROZEN_FINANCIAL_PROFILE_MANIFEST='docs/operations/evidence/core-member-integration-20261019-financial-profile.json';
const PRIOR_LEASE_HANDOFF='2976f752679263aaaf8b03e2a9474be63b0c1c86';
const FROZEN_LEASE_HANDOFF_MANIFEST='docs/operations/evidence/core-member-integration-20261019-lease-handoff.json';
const PRIOR_MARKET_REGIME='77888f0ed88648790179d00bd511682721fae67f';
const FROZEN_MARKET_REGIME_MANIFEST='docs/operations/evidence/core-member-integration-20261019-market-regime.json';
const PRIOR_MARKET_REGIME_R2='2e2027ba731b3b77eebd9bb9255be25d4708738b';
const FROZEN_MARKET_REGIME_R2_MANIFEST='docs/operations/evidence/core-member-integration-20261019-market-regime-r2.json';
const PRIOR_LOCAL_SDK='5109221ae1c70405d735e7f3cffa3430a6c888fc';
const FROZEN_LOCAL_SDK_MANIFEST='docs/operations/evidence/core-member-integration-20261019-c-worker-local-sdk.json';
const PRIOR_C_WORKER_LOCAL_SDK_R2='27875d458eb9321ea45c5175b815c878532e81b6';
const FROZEN_C_WORKER_LOCAL_SDK_R2_MANIFEST='docs/operations/evidence/core-member-integration-20261019-c-worker-local-sdk-r2.json';
const PRIOR_OWNER_STATUS_COPY='ff88a4ed7ce10116a6fad84110770953941fcd08';
const FROZEN_OWNER_STATUS_COPY_MANIFEST='docs/operations/evidence/core-member-integration-20261019-owner-status-copy.json';
const PRIOR_OWNER_QUARTER_ACTUALS='bd941dc3ead8eb66eeaf2b21ca13acf1c90f98e4';
const FROZEN_OWNER_QUARTER_ACTUALS_MANIFEST='docs/operations/evidence/core-member-integration-20261019-owner-quarter-actuals.json';
const PRIOR_OWNER_QUARTER_LIVE='6c89db33ade7b8f3a57e00da6708afe1958ed8f6';
const FROZEN_OWNER_QUARTER_LIVE_MANIFEST='docs/operations/evidence/core-member-integration-20261019-owner-quarter-live.json';
const PRIOR_PRICED_IN_COVERAGE='a3602de17198dd9b769a16671ed97c4763e21cd8';
const FROZEN_PRICED_IN_COVERAGE_MANIFEST='docs/operations/evidence/core-member-integration-20261019-priced-in-coverage.json';
const PRIOR_OWNER_REGIME_DISPLAY='6b7017fcbb9fa2fd085f9658eca4d6ce382c32a3';
const FROZEN_OWNER_REGIME_DISPLAY_MANIFEST='docs/operations/evidence/core-member-integration-20261019-owner-regime-display.json';
const PRIOR_SOURCE_ACQUISITION='965263fe15dc672cac6c61af06bfd14d69044dd3';
const FROZEN_SOURCE_ACQUISITION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-source-acquisition.json';
const PRIOR_C_WORKER_RPC_DIAGNOSTICS='9de380f6d8473e920e19d955d0782950ed4cae2f';
const FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST='docs/operations/evidence/core-member-integration-20261019-c-worker-rpc-diagnostics.json';
const PRIOR_RETAINED_QUARTER_FAMILY='a1f4abb2d73ee6495fc1c212f774c2f2dd627771';
const FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST='docs/operations/evidence/core-member-integration-20261019-retained-quarter-family.json';
const PRIOR_PRODUCER15_MONTHLY='fda6d637ebf35ce545a31ddba3ad2e2b4724e7a8';
const FROZEN_PRODUCER15_MONTHLY_MANIFEST='docs/operations/evidence/core-member-integration-20261019-producer15-monthly-release.json';
// Explicitly reviewed composition deltas. No patterns, glob, deployment flags,
// automatic inventory admission or addition to any previous release catalogue.
export const INTEGRATION_DELTAS=Object.freeze([
 FROZEN_COLD_SOURCE_MANIFEST,
 ...ORIGINAL_INGRESS_DELTAS,
 FROZEN_PRODUCER15_MONTHLY_MANIFEST,
 'src/features/vnext/dailyAdapter.ts',
 'tests/vnextDailyDatabase.integration.mjs',
 'tests/vnextColdSourcePriority.test.mjs',
 'tests/coldSourcePriorityAdmission.test.mjs',
 'docs/operations/cold-source-priority-20261019.md',
 'docs/operations/evidence/cold-source-priority-20261019.json',
 'scripts/operations/cold-source-priority-20261019/materialize.mjs',
 'scripts/operations/cold-source-priority-20261019/release-catalog.json',
 FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST,
 'docs/operations/evidence/producer15-monthly-source-admission-20261019.json',
 'tests/producer15MonthlyAdmission.test.mjs',
 'scripts/operations/producer15-monthly-release-20261019/release-catalog.json',
 'scripts/operations/producer15-monthly-release-20261019/materialize.mjs',
 'scripts/operations/producer15-monthly-release-20261019/README.md',
 'tests/producer15MonthlyRelease.test.mjs',
 FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST,
 'docs/operations/evidence/retained-quarter-family-20261019.json',
 'docs/operations/retained-quarter-family-20261019.md',
 'tests/retainedQuarterFamilyAdmission.test.mjs',
 'scripts/vnext/research-funnel.mjs',
 'research/retained-quarter-financials.ts',
 'tests/vnextRetainedQuarterFinancials.test.mjs',
 FROZEN_SOURCE_ACQUISITION_MANIFEST,
 'docs/operations/evidence/c-worker-rpc-diagnostics-20261019.json',
 'docs/operations/c-worker-rpc-diagnostics-20261019.md',
 'tests/cWorkerRpcDiagnosticsAdmission.test.mjs',
 'tests/cWorkerRpcFailureDiagnostics.integration.mjs',
 FROZEN_OWNER_REGIME_DISPLAY_MANIFEST,
 'docs/operations/evidence/source-acquisition-close-20261019.json',
 'docs/operations/source-acquisition-close-20261019.md',
 'tests/helpers/sourceAcquisitionCloseAdmission.mjs',
 'tests/recommendationV2SourceAcquisitionAdmission.test.mjs',
 'supabase/functions/_shared/recommendation-monthly-response-sharing.ts',
 'supabase/functions/_shared/recommendation-v2-forward-outcomes.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'tests/recommendationV2ForwardOutcomes.test.mjs',
 'tests/recommendationV2FugleRuntime.test.mjs',
 'tests/recommendationV2MonthlyResponseSharing.test.mjs',
 FROZEN_PRICED_IN_COVERAGE_MANIFEST,
 'docs/operations/evidence/owner-regime-display-20261019.json',
 'tests/helpers/ownerRegimeDisplayAdmission.mjs',
 'tests/ownerRegimeDisplayAdmission.test.mjs',
 'docs/operations/owner-regime-display-20261019.md',
 FROZEN_OWNER_QUARTER_LIVE_MANIFEST,
 'tests/decisionPricedInCoverage.test.mjs',
 'docs/operations/v1-priced-in-coverage-20261019.md',
 FROZEN_OWNER_QUARTER_ACTUALS_MANIFEST,
 '.github/workflows/owner-quarter-live-candidate.yml',
 'scripts/operations/owner-quarter-live-release-20261019/compiler-webauthn-dom-5.8.3.d.ts',
 'scripts/operations/owner-quarter-live-release-20261019/compiler-webauthn-dom-5.8.3.provenance.json',
 'scripts/operations/owner-quarter-live-release-20261019/compiler-typescript-LICENSE.txt',
 'docs/operations/evidence/owner-quarter-live-review-20261019.json',
 'docs/operations/owner-quarter-live-closure-20261019.md',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/node-type-originals.json.gz',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/producer15-sdk-source-catalog.json',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/producer15-sdk-source-files.json.gz',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/producer15-source-catalog.json',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/producer15-source-files.json.gz',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/reader-type-originals.json.gz',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/reader56-source-catalog.json',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/reader56-source-files.json.gz',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/type-closure-catalog.json',
 'scripts/operations/owner-quarter-live-release-20261019/baseline/type-closure-files.json.gz',
 'scripts/operations/owner-quarter-live-release-20261019/check-typescript.mjs',
 'scripts/operations/owner-quarter-live-release-20261019/entry-edits.json',
 'scripts/operations/owner-quarter-live-release-20261019/materialize.mjs',
 'scripts/operations/owner-quarter-live-release-20261019/prepare-check-sources.mjs',
 'scripts/operations/owner-quarter-live-release-20261019/producer-entry.patch',
 'scripts/operations/owner-quarter-live-release-20261019/producer-recovery-entry.patch',
 'scripts/operations/owner-quarter-live-release-20261019/reader-entry.patch',
 'scripts/operations/owner-quarter-live-release-20261019/reader-recovery-entry.patch',
 'scripts/operations/owner-quarter-live-release-20261019/release-catalog.json',
 'supabase/functions/_shared/recommendation-owner-quarter-capsule.ts',
 'supabase/functions/_shared/research-owner-quarter-field-access.ts',
 'tests/helpers/ownerQuarterLiveRuntimeHarness.mjs',
 'tests/ownerQuarterLiveRelease.test.mjs',
 'tests/ownerQuarterLiveRuntime.integration.mjs',
 FROZEN_OWNER_STATUS_COPY_MANIFEST,
 'src/pages/admin/analysis/LineDecisionPreview.tsx','src/pages/admin/analysis/OwnerQuarterActualsView.tsx',
 'supabase/functions/_shared/recommendation-foundation-candidate.ts',
 'supabase/functions/_shared/recommendation-quarter-actuals-candidate.ts',
 'supabase/functions/_shared/retained-2330-quarter-actuals-20261019.json',
 'tests/ownerQuarterActualsView.test.mjs','tests/recommendationQuarterActualsCandidate.test.mjs',
 'docs/operations/owner-quarter-actuals-20261019.md',
 'docs/operations/evidence/owner-quarter-actuals-review-20261019.json',
 FROZEN_C_WORKER_LOCAL_SDK_R2_MANIFEST,
 'tests/ownerCockpit.test.mjs','tests/helpers/ownerStatusCopyAdmission.mjs',
 'tests/ownerStatusCopyAdmission.test.mjs',
 'docs/operations/owner-status-copy-20261019.md',
 'docs/operations/evidence/owner-status-copy-20261019.json',
 FROZEN_LOCAL_SDK_MANIFEST,
 'scripts/operations/c-worker-local-sdk-release-20261019/release-catalog-r2.json',
 'docs/operations/c-worker-local-sdk-r2-20261019.md',
 'docs/operations/evidence/c-worker-local-sdk-r2-review-20261019.json',
 FROZEN_MARKET_REGIME_R2_MANIFEST,
 'supabase/functions/_shared/_fixed_c_worker_sdk/0bce189b17b39939428919945e6a261663cfa3fb43d7be83b97eef1655ffa196.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/8474f19a1f21e74abb020fc7894da0ae847ad881f5684adafe32f7d0262077cf.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/855779118b7c638eea0976ec4b331a7e741f69dd35c7e97b5be927345723dc04.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/9135c3f83ea833d80bfd11156d394d0ba84f2442e97e084887e406bff42f4456.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/98f2f4377da15fb84145ccb88d0745c482475b7004afef619afec387d83b2653.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/9be86b9f10fafb9db714e142be218b2876d16f7a228c1cc0cd8403239abd8da3.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/a0943b39916396be354a3d6b9a13dcd2b7eb9fae6d00629f2b409e518f1663dd.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/a67bcb8e00c067cc250bc24dd01da1277ed6452066387425b7b2cc11732e8867.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/b77ee1984adac5aca840baa3f11d3265a040c49f1ada99afefad72df1c43e353.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/bb93fdafb91b4dd70fa236164dbf6ce27358fe93c4c9297643576dbce326a1c8.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/c4510bd92ebd6222ba56cabdd658d09feeb964f64a728107a089635edd6bf7de.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/c769f61979cd626fc8d202ae9955a3a810ae59bd552c56e138fb1daeb7e2c99b.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/ccf2406bf8d2b9519c34c0c07dc74130ef4f7b3df582408b597e8078b222f45e.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/d6476eb760b326c6efa9534e2de942be23983f472c9b8459c0effa4c263980e9.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/NOTICE.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/PROVENANCE.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/jsdom-tr46/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/jsdom-webidl-conversions/LICENSE.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/jsdom-webidl-conversions/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/jsdom-webidl-conversions/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/jsdom-whatwg-url/LICENSE.txt',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/jsdom-whatwg-url/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/jsdom-whatwg-url/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-auth-js/LICENSE',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-auth-js/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-auth-js/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-functions-js/LICENSE',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-functions-js/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-functions-js/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-node-fetch/LICENSE.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-node-fetch/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-node-fetch/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-postgrest-js/LICENSE',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-postgrest-js/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-postgrest-js/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-realtime-js/LICENSE.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-realtime-js/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-realtime-js/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-storage-js/LICENSE',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-storage-js/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-storage-js/package.json',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-supabase-js/LICENSE',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-supabase-js/README.md',
 'supabase/functions/_shared/_fixed_c_worker_sdk/licenses/supabase-supabase-js/package.json',
 'supabase/functions/vnext-daily-research-v1/index.ts',
 'scripts/operations/c-worker-local-sdk-release-20261019/release-catalog.json',
 'scripts/operations/c-worker-local-sdk-release-20261019/materialize.mjs',
 'tests/cWorkerLocalSdkRelease.test.mjs',
 'tests/cWorkerLocalSdkRuntime.integration.mjs',
 'tests/helpers/cWorkerLocalSdkNetworkDenied.cjs',
 'docs/operations/c-worker-local-sdk-release-20261019.md',
 'docs/operations/evidence/c-worker-local-sdk-release-review-20261019.json',
 FROZEN_MARKET_REGIME_MANIFEST,
 'docs/operations/market-regime-historical-review-20261019.md',
 'docs/operations/evidence/market-regime-historical-review-20261019.json',
 FROZEN_LEASE_HANDOFF_MANIFEST,
 'src/lib/publicMarketReadModel.ts','tests/publicMarketProjection.test.mjs',
 'tests/helpers/coreContentOsCapturedReplay.mjs',
 'docs/operations/market-regime-compatibility-20261019.md',
 'docs/operations/evidence/market-regime-compatibility-review-20261019.json',
 '.github/workflows/c-worker-sdk-freshness-20261019.yml',
 'scripts/operations/sdk-public-freshness-20261019/sdk_public_freshness.py',
 'scripts/operations/sdk-public-freshness-20261019/sdk-freshness-plan.json',
 'scripts/operations/sdk-public-freshness-20261019/test_sdk_public_freshness_offline.py',
 FROZEN_FINANCIAL_PROFILE_MANIFEST,
 'src/features/vnext/dailyRuntime.ts','supabase/functions/vnext-daily-research-v1/handler.ts',
 'tests/vnextDailyRuntimeRecovery.test.mjs',
 'docs/operations/research-lease-handoff-20261019.md',
 'docs/operations/evidence/research-lease-handoff-review-20261019.json',
 '.nvmrc','.github/workflows/core-member-integration.yml',
 '.github/workflows/analysis-intelligence.yml','.github/workflows/academy-v11.yml',
 '.github/workflows/checkpoint-atomicity-validation.yml','.github/workflows/entry-opportunity.yml',
 '.github/workflows/owner-cockpit.yml','.github/workflows/owner-trading-lab.yml',
 '.github/workflows/recommendation-v2-shadow.yml','.github/workflows/research-foundation.yml',
 '.github/workflows/staged-release-240.yml','.github/workflows/validate-release.yml',
 '.github/workflows/vnext-candidate.yml','.github/workflows/core-evidence-candidate.yml',
 FROZEN_INTEGRATION_MANIFEST,FROZEN_R2_MANIFEST,FROZEN_R3_MANIFEST,FROZEN_R4_MANIFEST,FROZEN_R5_MANIFEST,FROZEN_R6_MANIFEST,FROZEN_R7_MANIFEST,FROZEN_R8_MANIFEST,FROZEN_R9_MANIFEST,FROZEN_R10_MANIFEST,FROZEN_MEMBER_CONTINUITY_MANIFEST,FROZEN_FRONTEND_TYPES_MANIFEST,FROZEN_OFFICIAL_ACTUALS_MANIFEST,FROZEN_EVIDENCE_CLOSURE_MANIFEST,
 'supabase/functions/_shared/decision-v1-evidence.ts',
 'tests/decisionEvidencePipeline.test.mjs','tests/recommendationPhase.test.mjs',
 'docs/operations/recommendation-evidence-closure-20261019.md',
 'docs/operations/evidence/recommendation-evidence-closure-review-20261019.json',
 'docs/operations/financial-quarter-profile-20261019.md',
 'docs/operations/evidence/financial-quarter-profile-review-20261019.json',
 'src/features/decision-v1/contract.ts','src/features/research/tradingLab.ts',
 'src/features/research/cockpit.ts','src/pages/admin/analysis/EntryOpportunity.tsx',
 'src/pages/admin/analysis/OwnerCockpit.tsx','src/types/research-source-contracts.ts',
 'tests/researchSourceContracts.types.ts','tests/researchSourceContracts.test.mjs',
 'tests/helpers/frontendTypeClosureAdmission.mjs','tests/frontendTypeClosureAdmission.test.mjs',
 'docs/operations/evidence/frontend-type-closure-20261018.json',
 'src/features/vnext/member.ts','src/pages/vnext/MemberPage.tsx',
 'tests/vnextMemberContinuity.test.mjs','tests/helpers/memberContinuityAdmission.mjs',
 'tests/memberContinuityAdmission.test.mjs',
 'docs/operations/evidence/member-continuity-20261018.json',
 'scripts/vnext/event-alignment-refresh.mjs','tests/eventAlignmentRefresh.test.mjs',
 'research/recommendation-issuer-event-review-candidate.ts','tests/recommendationIssuerEventReview.test.mjs',
 'tests/fixtures/issuer-event-review-official-facts-20261017.json',
 'docs/operations/core-delivery-r10-20261017.md',
 'docs/operations/evidence/r10-functional-source-closure-20261017.json',
 'docs/operations/evidence/r10-provider-capability-review-20261017.json',
 'tests/r10FunctionalSourceClosure.test.mjs',
 'docs/operations/evidence/r9-functional-source-closure-20261017.json',
 'docs/operations/core-delivery-r9-20261017.md',
 'src/hooks/useAccountDashboard.ts','src/pages/account/Account.tsx',
 'tests/accountDashboardIdentity.test.mjs','tests/accountHistoricalFallback.test.mjs',
 'supabase/functions/_shared/recommendation-official-actuals.ts',
 'scripts/official-actuals/inline_xbrl.py','tests/test_inline_xbrl.py',
 'supabase/functions/_shared/recommendation-financial-actuals-candidate.ts',
 'tests/recommendationFinancialActualsCandidate.test.mjs','tests/stockOfficialActuals.test.mjs',
 'tests/fixtures/financial-actuals-official-candidate.json',
 'research/recommendation-event-alignment-candidate.ts','scripts/vnext/event-alignment-audit.mjs',
 'tests/recommendationEventAlignment.test.mjs','tests/recommendationEventAlignmentReal.integration.mjs',
 'tests/r9FunctionalSourceClosure.test.mjs',
 'docs/operations/evidence/owner-release-review-r8-20261017.json',
 'docs/operations/evidence/v1-source-gap-detail-r8-20261017.json',
 'docs/operations/evidence/v1-provider-capability-exact-manifest-r8-20261017.json',
 'docs/operations/owner-release-decisions-r8-20261017.md',
 'docs/operations/v1-provider-capability-evidence-20261017.md',
 'scripts/capability/finnhub-quarterly-probe.mjs',
 'tests/finnhubQuarterlyProbe.test.mjs','tests/ownerReleaseReviewPackage.test.mjs',
 'supabase/functions/v1-provider-capability-review-v1/handler.ts',
 'supabase/functions/v1-provider-capability-review-v1/index.ts',
 'tests/providerCapabilityOwnerBoundary.test.mjs',
 'src/pages/account/components/MorningHeroCard.tsx',
 'tests/accountSubscriberProjection.test.mjs','tests/accountReportSchedule.test.mjs',
 'scripts/vnext/membership-preview.mjs','tests/browser/membership.harness.tsx',
 'tests/providerCapabilityClaimDatabase.integration.mjs',
 'tests/providerCapabilityEntry.sdk.test.ts',
 'src/pages/admin/analysis/ProviderCapabilityReview.tsx',
 'src/pages/admin/analysis/page.tsx','tests/providerCapabilityReviewUi.test.mjs',
 'tests/ownerAccountAnalysisNavigation.test.mjs','tests/analysisIntelligenceUI.test.mjs',
 'docs/operations/core-member-integration-20261017.md',
 'docs/operations/v1-source-capability-20261017.md',
 'scripts/academy-v11/auth-environment.mjs',
 'supabase/functions/get-report-payload/index.ts',
 'supabase/functions/_shared/research-owner-field-access.ts',
 'supabase/functions/_shared/recommendation-consensus-capability-candidate.ts',
 'tests/helpers/integrationAdmission.mjs','tests/integrationAdmission.test.mjs',
 'tests/helpers/coreEvidenceCandidateIntegrity.mjs','tests/coreEvidenceCandidateIntegrity.test.mjs',
 'tests/helpers/vnextIntegrity.mjs','tests/vnextIntegrity.test.mjs',
 'tests/helpers/stagedReleaseIntegrity.mjs','tests/stagedReleaseIntegrity.test.mjs',
 'tests/recommendationMarketInstitutionalCandidate.test.mjs',
 'tests/researchOwnerFieldAccess.test.mjs','tests/researchOwnerFieldAccess.sdk.test.ts',
 'tests/recommendationConsensusCapability.test.mjs',
 'tests/academyV11Integrity.test.mjs','tests/helpers/marketNewsReportIntegrity.mjs',
 'tests/helpers/recommendationHistoricalBatch.mjs','tests/recommendationHistoricalBatch.test.mjs',
 'tests/analysisIntelligencePersistenceIntegrity.test.mjs',
 'tests/analysisIntelligenceIntegrity.test.mjs',
 'tests/analysisIntelligencePreviousIntegrity.test.mjs',
 'tests/analysisIntelligenceShadowAuthIntegrity.test.mjs',
 'tests/ownerTradingLabIntegrity.test.mjs','tests/researchFoundation.test.mjs',
 'tests/helpers/v2HistoricalBatch.mjs',
 'tests/recommendationV2Integrity.test.mjs','tests/recommendationV2ForwardIntegrity.test.mjs',
 'tests/recommendationV2RuntimeIntegrity.test.mjs',
].sort());
const root=new URL('../../',import.meta.url);
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,encoding:'utf8',maxBuffer:64e6});
export const integrationHash=b=>createHash('sha256').update(b).digest('hex');
const trees=new Map();
// Prior receipts need one immutable blob each, not an entire historical tree
// retained in the 512MiB test worker. Live files/validation are never cached.
const frozenReceipts=new Map();
function frozenReceipt(revision,path){
 assert.match(revision,/^[a-f0-9]{40}$/);
 const key=revision+':'+path;
 if(!frozenReceipts.has(key)){
  const rows=git(['--no-replace-objects','ls-tree','-z',revision,'--',path]).split('\0').filter(Boolean);
  assert.equal(rows.length,1);const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');
  assert.equal(name,path);assert.equal(mode,'100644');assert.equal(type,'blob');assert.match(oid,/^[a-f0-9]{40}$/);
  const bytes=execFileSync('git',['--no-replace-objects','cat-file','blob',oid],{cwd:root,maxBuffer:1024*1024});
  frozenReceipts.set(key,Buffer.from(bytes));
 }
 return Buffer.from(frozenReceipts.get(key));
}
function tree(revision){
 assert.match(revision,/^[a-f0-9]{40}$/,'INTEGRATION_IMMUTABLE_PARENT');
 if(!trees.has(revision)){
  const rows=git(['ls-tree','-rz',revision]).split('\0').filter(Boolean).map(r=>{const [meta,path]=r.split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(type,'blob');assert.match(mode,/^100(644|755)$/);return {path,mode,oid};});
  const bytes=execFileSync('git',['--no-replace-objects','cat-file','--batch'],{cwd:root,input:rows.map(r=>r.oid).join('\n')+'\n',maxBuffer:64e6});
  let at=0;const result=new Map();for(const row of rows){const end=bytes.indexOf(10,at);assert(end>=at);const [oid,type,n]=bytes.subarray(at,end).toString().split(' '),size=Number(n);assert.equal(oid,row.oid);assert.equal(type,'blob');assert(Number.isSafeInteger(size)&&size>=0);at=end+1;assert.equal(bytes[at+size],10);const body=Buffer.from(bytes.subarray(at,at+size));result.set(row.path,{...row,bytes:body,sha256:integrationHash(body)});at+=size+1;}assert.equal(at,bytes.length);trees.set(revision,result);
 }
 return trees.get(revision);
}
export function integrationParentRead(view,path){const row=tree(INTEGRATION_PARENTS[view]).get(path);if(!row)throw Object.assign(Error('INTEGRATION_PARENT_ABSENT:'+path),{code:'ENOENT'});return Buffer.from(row.bytes);}
const parentRanges=new Map();let fixedScope;
export function integrationParentPaths(view,base){
 assert(Object.hasOwn(INTEGRATION_PARENTS,view),'INTEGRATION_UNKNOWN_PARENT');
 assert.match(base,/^[a-f0-9]{40}$/,'IMMUTABLE_GIT_REVISION_REQUIRED');
 const key=base+':'+INTEGRATION_PARENTS[view];
 if(!parentRanges.has(key))parentRanges.set(key,Object.freeze(git(['diff','--no-renames','--name-only','-z',base,INTEGRATION_PARENTS[view],'--']).split('\0').filter(Boolean).sort()));
 return [...parentRanges.get(key)];
}
export function readRegularIntegrationFile(url){assert(lstatSync(url).isFile()&&!lstatSync(url).isSymbolicLink(),'INTEGRATION_REGULAR_FILE');return readFileSync(url);}
export function integrationPhysicalRead(path){return readRegularIntegrationFile(new URL(path,root));}
export function integrationPhysicalMode(path){return lstatSync(new URL(path,root)).mode&0o111?'100755':'100644';}
export function integrationInventory(){return [...new Set([...git(['diff','--no-renames','--name-only','-z',INTEGRATION_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();}
export function integrationScope(){
 // Member branched before later main receipts. Those inherited main changes
 // are NOT deletions/replacements authorized by its candidate.
 if(!fixedScope){
  assert.equal(git(['merge-base',INTEGRATION_PARENTS.core,INTEGRATION_PARENTS.member]).trim(),MEMBER_FORK,'INTEGRATION_PARENT_FORK');
  fixedScope=Object.freeze([...new Set([...integrationParentPaths('core',INTEGRATION_BASE),...integrationParentPaths('member',MEMBER_FORK),...INTEGRATION_DELTAS])].sort());
 }
 return [...fixedScope];
}
function verifyOriginalIngressBoundary(read,mode){
 assert.deepEqual(Buffer.from(read(FROZEN_COLD_SOURCE_MANIFEST)),frozenReceipt(ORIGINAL_INGRESS_BASE,FROZEN_COLD_SOURCE_MANIFEST),'INTEGRATION_COLD_SOURCE_RECEIPT_DRIFT');
 const allowed=new Set(ORIGINAL_INGRESS_DELTAS);
 // A newly rehashed composition must not admit unrelated historical drift.
 // In particular, old catalogues, workflows and authorization receipts stay exact.
 for(const [path,row] of tree(ORIGINAL_INGRESS_BASE))if(!allowed.has(path)){
  // Keep the established exact first-line diagnostic contract. The earlier
  // full-tree guard adds context, but must not masquerade as a legacy failure.
  assert.equal(integrationHash(read(path)),row.sha256,'INTEGRATION_SOURCE_DRIFT:'+path+'\nINTEGRATION_ORIGINAL_BASE_DRIFT');
  assert.equal(mode(path),row.mode,'INTEGRATION_ORIGINAL_BASE_MODE:'+path);
 }
}
/** Pure final-seal builder: returns JSON data, never writes or admits missing files.
 * Call only once all exact candidate paths exist; rerun after every source change.
 * The composition manifest itself is intentionally outside its own files array. */
export function createOriginalIngressComposition(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyOriginalIngressBoundary(read,mode);
 const scope=integrationScope(),baseline=tree(INTEGRATION_BASE),prior=tree(ORIGINAL_INGRESS_BASE),allowed=new Set(ORIGINAL_INGRESS_DELTAS);
 assert.deepEqual([...paths].sort(),[...scope,INTEGRATION_MANIFEST].sort(),'INTEGRATION_UNKNOWN_PATH');
 const old=JSON.parse(frozenReceipt(ORIGINAL_INGRESS_BASE,FROZEN_COLD_SOURCE_MANIFEST)),oldRows=new Map(old.files.map(row=>[row.path,row]));
 const files=scope.map(path=>{
  const after_sha256=integrationHash(read(path)),fileMode=mode(path);assert.match(fileMode,/^100(644|755)$/);
  if(!allowed.has(path)){const frozen=prior.get(path);assert(frozen,'INTEGRATION_UNREVIEWED_PATH:'+path);assert.equal(after_sha256,frozen.sha256,'INTEGRATION_SOURCE_DRIFT:'+path+'\nINTEGRATION_ORIGINAL_BASE_DRIFT');assert.equal(fileMode,frozen.mode);}
  return {path,before_sha256:baseline.get(path)?.sha256??null,after_sha256,mode:fileMode,
   origin:INTEGRATION_DELTAS.includes(path)?'composition':oldRows.get(path).origin};
 });
 return {...old,files};
}
export function verifyIntegrationCandidate(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyOriginalIngressBoundary(read,mode);
 const m=JSON.parse(read(INTEGRATION_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','parents','files','production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].sort());
 assert.equal(m.schema,'CORE_MEMBER_COMPOSITION_V1');assert.equal(m.base,INTEGRATION_BASE);assert.deepEqual(m.parents,INTEGRATION_PARENTS);
 assert.deepEqual(Buffer.from(read(FROZEN_INTEGRATION_MANIFEST)),frozenReceipt(PRIOR_INTEGRATION,FROZEN_INTEGRATION_MANIFEST),'INTEGRATION_PRIOR_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R2_MANIFEST)),frozenReceipt(PRIOR_R2,FROZEN_R2_MANIFEST),'INTEGRATION_R2_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R3_MANIFEST)),frozenReceipt(PRIOR_R3,FROZEN_R3_MANIFEST),'INTEGRATION_R3_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R4_MANIFEST)),frozenReceipt(PRIOR_R4,FROZEN_R4_MANIFEST),'INTEGRATION_R4_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R5_MANIFEST)),frozenReceipt(PRIOR_R5,FROZEN_R5_MANIFEST),'INTEGRATION_R5_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R6_MANIFEST)),frozenReceipt(PRIOR_R6,FROZEN_R6_MANIFEST),'INTEGRATION_R6_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R7_MANIFEST)),frozenReceipt(PRIOR_R7,FROZEN_R7_MANIFEST),'INTEGRATION_R7_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R8_MANIFEST)),frozenReceipt(PRIOR_R8,FROZEN_R8_MANIFEST),'INTEGRATION_R8_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R9_MANIFEST)),frozenReceipt(PRIOR_R9,FROZEN_R9_MANIFEST),'INTEGRATION_R9_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R10_MANIFEST)),frozenReceipt(PRIOR_R10,FROZEN_R10_MANIFEST),'INTEGRATION_R10_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_MEMBER_CONTINUITY_MANIFEST)),frozenReceipt(PRIOR_MEMBER_CONTINUITY,FROZEN_MEMBER_CONTINUITY_MANIFEST),'INTEGRATION_MEMBER_CONTINUITY_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_FRONTEND_TYPES_MANIFEST)),frozenReceipt(PRIOR_FRONTEND_TYPES,FROZEN_FRONTEND_TYPES_MANIFEST),'INTEGRATION_FRONTEND_TYPES_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_OFFICIAL_ACTUALS_MANIFEST)),frozenReceipt(PRIOR_OFFICIAL_ACTUALS,FROZEN_OFFICIAL_ACTUALS_MANIFEST),'INTEGRATION_OFFICIAL_ACTUALS_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_EVIDENCE_CLOSURE_MANIFEST)),frozenReceipt(PRIOR_EVIDENCE_CLOSURE,FROZEN_EVIDENCE_CLOSURE_MANIFEST),'INTEGRATION_EVIDENCE_CLOSURE_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_FINANCIAL_PROFILE_MANIFEST)),frozenReceipt(PRIOR_FINANCIAL_PROFILE,FROZEN_FINANCIAL_PROFILE_MANIFEST),'INTEGRATION_FINANCIAL_PROFILE_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_LEASE_HANDOFF_MANIFEST)),frozenReceipt(PRIOR_LEASE_HANDOFF,FROZEN_LEASE_HANDOFF_MANIFEST),'INTEGRATION_LEASE_HANDOFF_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_MARKET_REGIME_MANIFEST)),frozenReceipt(PRIOR_MARKET_REGIME,FROZEN_MARKET_REGIME_MANIFEST),'INTEGRATION_MARKET_REGIME_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_MARKET_REGIME_R2_MANIFEST)),frozenReceipt(PRIOR_MARKET_REGIME_R2,FROZEN_MARKET_REGIME_R2_MANIFEST),'INTEGRATION_MARKET_REGIME_R2_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_LOCAL_SDK_MANIFEST)),frozenReceipt(PRIOR_LOCAL_SDK,FROZEN_LOCAL_SDK_MANIFEST),'INTEGRATION_LOCAL_SDK_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_C_WORKER_LOCAL_SDK_R2_MANIFEST)),frozenReceipt(PRIOR_C_WORKER_LOCAL_SDK_R2,FROZEN_C_WORKER_LOCAL_SDK_R2_MANIFEST),'INTEGRATION_C_WORKER_LOCAL_SDK_R2_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_OWNER_STATUS_COPY_MANIFEST)),frozenReceipt(PRIOR_OWNER_STATUS_COPY,FROZEN_OWNER_STATUS_COPY_MANIFEST),'INTEGRATION_OWNER_STATUS_COPY_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_OWNER_QUARTER_ACTUALS_MANIFEST)),frozenReceipt(PRIOR_OWNER_QUARTER_ACTUALS,FROZEN_OWNER_QUARTER_ACTUALS_MANIFEST),'INTEGRATION_OWNER_QUARTER_ACTUALS_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_OWNER_QUARTER_LIVE_MANIFEST)),frozenReceipt(PRIOR_OWNER_QUARTER_LIVE,FROZEN_OWNER_QUARTER_LIVE_MANIFEST),'INTEGRATION_OWNER_QUARTER_LIVE_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_PRICED_IN_COVERAGE_MANIFEST)),frozenReceipt(PRIOR_PRICED_IN_COVERAGE,FROZEN_PRICED_IN_COVERAGE_MANIFEST),'INTEGRATION_PRICED_IN_COVERAGE_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_OWNER_REGIME_DISPLAY_MANIFEST)),frozenReceipt(PRIOR_OWNER_REGIME_DISPLAY,FROZEN_OWNER_REGIME_DISPLAY_MANIFEST),'INTEGRATION_OWNER_REGIME_DISPLAY_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_SOURCE_ACQUISITION_MANIFEST)),frozenReceipt(PRIOR_SOURCE_ACQUISITION,FROZEN_SOURCE_ACQUISITION_MANIFEST),'INTEGRATION_SOURCE_ACQUISITION_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST)),frozenReceipt(PRIOR_C_WORKER_RPC_DIAGNOSTICS,FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST),'INTEGRATION_C_WORKER_RPC_DIAGNOSTICS_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST)),frozenReceipt(PRIOR_RETAINED_QUARTER_FAMILY,FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST),'INTEGRATION_RETAINED_QUARTER_FAMILY_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_PRODUCER15_MONTHLY_MANIFEST)),frozenReceipt(PRIOR_PRODUCER15_MONTHLY,FROZEN_PRODUCER15_MONTHLY_MANIFEST),'INTEGRATION_PRODUCER15_MONTHLY_RECEIPT_DRIFT');
 for(const flag of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[flag],false,'INTEGRATION_FORBIDDEN:'+flag);
 const scope=integrationScope();
 assert.deepEqual(m.files.map(r=>r.path),scope,'INTEGRATION_EXACT_SCOPE');
 assert.deepEqual([...paths].sort(),[...scope,INTEGRATION_MANIFEST].sort(),'INTEGRATION_UNKNOWN_PATH');
 const baseline=tree(INTEGRATION_BASE);
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256','mode','origin'].sort());
  const before=baseline.get(row.path);assert.equal(row.before_sha256,before?before.sha256:null);
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.equal(integrationHash(read(row.path)),row.after_sha256,'INTEGRATION_SOURCE_DRIFT:'+row.path);
  assert.equal(mode(row.path),row.mode,'INTEGRATION_MODE_DRIFT:'+row.path);assert.match(row.mode,/^100(644|755)$/);
  if(INTEGRATION_DELTAS.includes(row.path))assert.equal(row.origin,'composition');
  else{
   assert(['core','member','shared'].includes(row.origin));const sources=row.origin==='shared'?['core','member']:[row.origin];
   for(const source of sources){const parent=tree(INTEGRATION_PARENTS[source]).get(row.path);assert(parent);assert.equal(row.after_sha256,parent.sha256,'INTEGRATION_PARENT_SOURCE:'+row.path);assert.equal(row.mode,parent.mode);}
  }
 }
 // Unchanged baseline bytes and modes remain protected too. This detects an
 // incomplete/falsified inventory, not just alterations to named new files.
 const listed=new Set(m.files.map(r=>r.path));for(const [path,row]of baseline)if(!listed.has(path)){
  assert.equal(integrationHash(read(path)),row.sha256,'INTEGRATION_BASELINE_DRIFT:'+path);assert.equal(mode(path),row.mode,'INTEGRATION_BASELINE_MODE:'+path);
 }
 return m;
}
// Translation never erases injected consumer bytes. The caller must run full
// admission at its public boundary, then reread/validate again before return.
// Every translated byte must equal the current exact seal, not a filename.
// Decode only: a single cache entry keyed by the complete freshly-read JSON
// bytes. It never caches filesystem reads, hashes, modes, status, admission or
// validation outcomes. Malformed replacement text throws, never falls back.
let decodedBytes,decodedRows;
export function integrationSealRow(path,bytes){
 if(!decodedBytes||!decodedBytes.equals(bytes)){
  const m=JSON.parse(bytes),rows=m.files.map(row=>Object.freeze({...row}));
  decodedRows=rows;decodedBytes=Buffer.from(bytes);
 }
 return decodedRows.find(row=>row.path===path);
}
export function integrationHistoricalRead(view,path,bytes){
 const row=integrationSealRow(path,integrationPhysicalRead(INTEGRATION_MANIFEST));
 const base=tree(INTEGRATION_BASE).get(path),expected=row?.after_sha256??base?.sha256??null,mode=row?.mode??base?.mode;
 if(!expected||integrationHash(bytes)!==expected)return bytes;
 assert.equal(integrationHash(integrationPhysicalRead(path)),expected,'INTEGRATION_CHANGED_AFTER_ADMISSION:'+path);
 assert.equal(integrationPhysicalMode(path),mode,'INTEGRATION_CHANGED_MODE:'+path);
 return integrationParentRead(view,path);
}
export function integrationHistoricalReader(view,source=integrationPhysicalRead){return path=>{
 const value=source(path),bytes=Buffer.from(value);
 // A JS string with unpaired surrogates cannot round-trip through UTF-8.
 // Preserve that injected value verbatim; never normalize it into valid bytes
 // that could look like an exact admitted source and erase the mutation.
 if(typeof value==='string'&&bytes.toString('utf8')!==value)return value;
 const restored=integrationHistoricalRead(view,path,bytes);
 // Preserve an injected text reader's representation. Turning its UTF-8 view
 // of an unchanged binary baseline into a Buffer is not byte-preserving; the
 // older text-aware validator must receive the original text representation.
 // Mandatory physical admission remains binary and independently fail closed.
 return typeof value==='string'?(restored.equals(bytes)?value:restored.toString('utf8')):restored;
};}
