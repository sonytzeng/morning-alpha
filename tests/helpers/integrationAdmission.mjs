// A separate composition seal. Child receipts keep their original bytes and
// are tested at immutable parent trees, only AFTER the complete live tree is
// admitted here. This is source integrity, never deployment authorization.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdtempSync,rmSync,existsSync,symlinkSync,mkdirSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const INTEGRATION_BASE='754850ba1c66329d12eac8e98ab799e0a0c9123e';
const MEMBER_FORK='cf3b6b21c9e3d022a8132ed3b566b544d290a48f';
export const INTEGRATION_PARENTS=Object.freeze({core:'bc48d784487fd5ae63ac2bb9c28d9343de41034f',member:'bcf665cad237e9c5e76c9abdd12cc12d5133aaed'});
export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261020-v1-source-union-r3.json';
export const FROZEN_SOURCE_UNION_R2='docs/operations/evidence/core-member-integration-20261020-v1-source-union-normalizer-r2.json';
export const SOURCE_UNION_R3_BASE='8c110263ddcf83e4471dfc8e32adafd1c47c2c40';
// Independently reviewed exact source pins, independent of the generated current seal.
// These are eight code/document deltas, NOT source/financial/member admission.
// The old 8fbe normalizer identity below remains a historical identity forever.
export const SOURCE_UNION_R3_FILES=Object.freeze([
 {group:'pdf',path:'scripts/official-actuals/issuer-pdf-descriptor.py',mode:'100644',before_sha256:'0f4157dc10f423dec8fbd0e56bef8e9e81e4a9bc3120dec01f791bf22f123d6b',after_sha256:'7bd1404ddebe07ee270710cfe0b1ca28beca265df41c427508a836dc9be6f023'},
 {group:'pdf',path:'tests/test_issuer_pdf_descriptor.py',mode:'100644',before_sha256:'f2e797e40e65e4f76eb6668fd1747ccfbcf99e8534cd1c6d9e3d3cd4aefff94f',after_sha256:'8cf96a4b157d2793456484e1b79283312585e51c42048f0ba26946edac3381eb'},
 {group:'capacity',path:'scripts/operations/member-capacity-20261020.mjs',mode:'100644',before_sha256:null,after_sha256:'419fd0c889ab586cc295ad4b04d2a216c73c5242340a10063b0091c836e6cca9'},
 {group:'capacity',path:'tests/memberCapacityModel.test.mjs',mode:'100644',before_sha256:null,after_sha256:'c8a338b6cfcf2128ddf2857b02e51fab3338bae800206e4e48abcb03bf9fb5e7'},
 {group:'delivery',path:'docs/operations/PRODUCT_DELIVERY_MASTER.md',mode:'100644',before_sha256:null,after_sha256:'cedd01ff53c9157b4d83a65b7c68636caa22a17f5fdf173dc5d81d67ac5fe1d9'},
 {group:'evaluator',path:'supabase/functions/_shared/decision-v1-evidence.ts',mode:'100644',before_sha256:'327928dd61babe767873a38ddc1cd933ce440d0f8fc6c269f4bcc8b4bdd37156',after_sha256:'007ddabb324fdebaed71551c17653a839dac994d70a6d0b2a6c864855e2720a6'},
 {group:'evaluator',path:'tests/v1FundamentalRevisionSelection.test.mjs',mode:'100644',before_sha256:null,after_sha256:'dc03cb448fb2328de9476c9936060da20838df24fdbb61d4e30ec3fd51feb985'},
 {group:'evaluator',path:'tests/v1FundamentalRevisionDatabase.integration.mjs',mode:'100644',before_sha256:null,after_sha256:'57a848d6c4c1dcf57f267b16fcfc1a64c91bbbcf8e070c4c3a8a66210c6fdd58'},
].map(Object.freeze));
export const FROZEN_SOURCE_UNION='docs/operations/evidence/core-member-integration-20261020-v1-source-union.json';
export const FROZEN_SOURCE_UNION_NORMALIZER='docs/operations/evidence/core-member-integration-20261020-v1-source-union-normalizer.json';
export const SOURCE_UNION_NORMALIZER_PRIOR_PARENT='4469d69cdcbcdf0cf176b592f158977a7980e1a3';
export const SOURCE_UNION_NORMALIZER_BASE='c1318bfe8d32f774ecbc1ba17787832bb745b489';
export const SOURCE_UNION_NORMALIZER_PARENT='8fbe1fc3b2fa675594a4cf4f61298e312d133db3';
export const SOURCE_UNION_NORMALIZER_FILES=Object.freeze([
 Object.freeze({path:'scripts/official-actuals/issuer-pdf-descriptor.py',mode:'100644',sha256:'0f4157dc10f423dec8fbd0e56bef8e9e81e4a9bc3120dec01f791bf22f123d6b'}),
 Object.freeze({path:'tests/test_issuer_pdf_descriptor.py',mode:'100644',sha256:'f2e797e40e65e4f76eb6668fd1747ccfbcf99e8534cd1c6d9e3d3cd4aefff94f'}),
]);
export const SOURCE_UNION_BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
export const SOURCE_UNION_PARENTS=Object.freeze({actual:'64565b5e44568c5c653bd2007992d482df36e60f',registry:'1db13616337633d4765db4650dd27f5dc68c0bd6'});
export const REGISTRY_SUPPORT_PARENT='d74a25d803b6fe6a7dc9e21cef06c3e1306ec559';
export const REGISTRY_SUPPORT_PATHS=Object.freeze([
 '.github/workflows/original-observation-ingress.yml',
 'docs/operations/evidence/core-member-integration-20261020-registry-ingress.json',
 'docs/operations/original-registry-ingress-20261020.md',
 'tests/fixtures/originalRegistryIngress.mjs',
 'tests/vnextOriginalRegistryIngress.test.mjs',
 'tests/vnextOriginalRegistryIngressDatabase.integration.mjs',
].sort());
export const SOURCE_UNION_SUPPORT=Object.freeze([
 '.github/workflows/core-member-integration.yml',
 '.github/workflows/v1-source-integration.yml',
 'tests/helpers/integrationAdmission.mjs',
 'tests/originalIngressAdmission.test.mjs',
 'tests/officialPublicAdmission.test.mjs',
].sort());
const FROZEN_ACTUAL='docs/operations/evidence/core-member-integration-20261020-v1-actual-canonical.json';
const FROZEN_REGISTRY='docs/operations/evidence/core-member-integration-20261020-registry-ingress.json';
const FROZEN_CONTINUOUS_LIFECYCLE='docs/operations/evidence/core-member-integration-20261020-continuous-lifecycle.json';
const V1_ACTUAL_PARENT='3f494a209079801525a0f6208707c8b3d3d61155';
export const OFFICIAL_PUBLIC_BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
const PRIOR_CONTINUOUS_BASE='af22f6b77f564cf9374b2a4415632ea8f38ea1c4';
const FROZEN_OFFICIAL_PUBLIC='docs/operations/evidence/core-member-integration-20261020-official-public.json';
const FROZEN_COLD_SOURCE='docs/operations/evidence/core-member-integration-20261019-cold-source-priority.json';
export const OFFICIAL_PUBLIC_DELTAS=Object.freeze([
 '.github/workflows/core-member-integration.yml',
 '.github/workflows/official-public-source.yml',
 '.github/workflows/validate-release.yml',
 'docs/operations/official-public-source-wiring-20261020.md',
 'docs/operations/evidence/official-public-source-results-20261020.json',
 'research/recommendation-official-source-join.ts',
 'scripts/official-actuals/acquire-public-evidence.mjs',
 'scripts/official-actuals/evaluate-public-v1.mjs',
 'tests/officialPublicAcquisition.test.mjs',
 'tests/officialPublicV1Evaluation.test.mjs',
 'tests/officialV1SourceJoin.test.mjs',
 'tests/officialPublicAdmission.test.mjs',
 'tests/helpers/integrationAdmission.mjs',
 'tests/helpers/clockedPsql.mjs',
 'tests/coldSourcePriorityAdmission.test.mjs',
 'tests/r10FunctionalSourceClosure.test.mjs',
 'docs/operations/forward-cutoff-20261020.md',
 'docs/operations/evidence/worker4-exact-readback-20261020.json',
 'docs/operations/evidence/forward-cutoff-acceptance-20261020.json',
 'scripts/operations/forward-cutoff-20261020/materialize.mjs',
 'scripts/operations/forward-cutoff-20261020/release-catalog.json',
 'src/features/vnext/dailyRuntime.ts',
 'tests/forwardCutoffAdmission.test.mjs',
 'tests/vnextForwardCutoffRuntime.test.mjs',
 FROZEN_OFFICIAL_PUBLIC,
 '.github/workflows/continuous-research-lifecycle.yml',
 'supabase/functions/_shared/continuous-learning-core.mjs',
 'supabase/functions/continuous-learning-engine/index.ts',
 'tests/continuousLearningTemporal.test.mjs',
 'tests/vnextOutcomeCacheRecovery.test.mjs',
 'docs/operations/continuous-research-lifecycle-20261020.md',
 'docs/operations/evidence/continuous-research-lifecycle-20261020.json',
 'docs/operations/evidence/learning-v17-exact-readback-20261020.json',
 'scripts/operations/continuous-learning-20261020/materialize.mjs',
 'scripts/operations/continuous-learning-20261020/release-catalog.json',
 'tests/continuousLearningRelease.test.mjs',
 'tests/vnextContinuousUpdate.test.mjs',
 'supabase/functions/_shared/continuous-learning-fixed-sdk.d.ts',
 FROZEN_CONTINUOUS_LIFECYCLE,
 '.github/workflows/v1-actual-canonical.yml',
 'docs/operations/v1-actual-canonical-20261020.md',
 'docs/operations/evidence/issuer-financial-pdf-20261020.json',
 'scripts/official-actuals/issuer-financial-pdf.py',
 'scripts/operations/financial-response-period-20261020/materialize.mjs',
 'scripts/operations/financial-response-period-20261020/release-catalog.json',
 'scripts/vnext/stock-evidence.mjs',
 'src/features/vnext/dailyAdapter.ts',
 'src/features/vnext/dailyIntelligence.ts',
 'src/features/vnext/dailyParsers.mjs',
 'src/features/vnext/v1ActualCanonical.ts',
 'supabase/migrations/20261020070000_v1_actual_canonical_candidate.sql',
 'tests/fixtures/v1ActualCanonical-synthetic.sql',
 'tests/v1ActualCanonical.test.mjs',
 'tests/v1ActualCanonicalSql.integration.mjs',
 'tests/v1FinancialPeriodRelease.test.mjs',
 'tests/vnextFinancialResponsePeriod.test.mjs',
 'tests/test_issuer_financial_pdf.py',
 'tests/vnextColdSourcePriority.test.mjs',
 'tests/vnextDailyWiring.test.mjs',
 'tests/vnextStockResearch.test.mjs',
].sort());
const FROZEN_ORIGINAL_INGRESS='docs/operations/evidence/core-member-integration-20261019-original-ingress.json';
const ORIGINAL_REGISTRY_PARENT='ccd47f83b06d26f89027e644f31824dfd929b2d4';
export const ORIGINAL_INGRESS_BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
export const FROZEN_COLD_SOURCE_MANIFEST='docs/operations/evidence/core-member-integration-20261019-cold-source-priority.json';
// Exact candidate engineering scope, not a deployment or source-rights grant.
export const ORIGINAL_INGRESS_DELTAS=Object.freeze([
 '.github/workflows/original-observation-ingress.yml',
 '.github/workflows/validate-release.yml',
 'tests/helpers/clockedPsql.mjs',
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
 FROZEN_ORIGINAL_INGRESS,
 'docs/operations/original-registry-ingress-20261020.md',
 'src/features/vnext/originalRegistryIngress.ts',
 'src/features/vnext/originalRegistryIngress.candidate.sql',
 'tests/fixtures/originalRegistryIngress.mjs',
 'tests/vnextOriginalRegistryIngress.test.mjs',
 'tests/vnextOriginalRegistryIngressDatabase.integration.mjs',
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
 FROZEN_COLD_SOURCE,
 ...OFFICIAL_PUBLIC_DELTAS,
 ...ORIGINAL_INGRESS_DELTAS,
 FROZEN_ACTUAL,FROZEN_REGISTRY,...SOURCE_UNION_SUPPORT,
 FROZEN_SOURCE_UNION,FROZEN_SOURCE_UNION_NORMALIZER,...SOURCE_UNION_NORMALIZER_FILES.map(row=>row.path),
 FROZEN_SOURCE_UNION_R2,...SOURCE_UNION_R3_FILES.map(row=>row.path),
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
// Only immutable Git objects define inherited source bytes. The current seal
// cannot turn a changed Runtime/SQL/catalogue into an approved parent source.
const unionBlobs=new Map();
function unionBlob(revision,path){
 const key=revision+':'+path;
 if(!unionBlobs.has(key)){
  const rows=git(['ls-tree','-z',revision,'--',path]).split('\0').filter(Boolean);
  if(!rows.length){unionBlobs.set(key,null);return null;}
  assert.equal(rows.length,1);const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');
  assert.equal(name,path);assert.equal(type,'blob');assert.match(mode,/^100(644|755)$/);
  const bytes=execFileSync('git',['--no-replace-objects','cat-file','blob',oid],{cwd:root,maxBuffer:8e6});
  unionBlobs.set(key,{mode,sha256:integrationHash(bytes),bytes});
 }
 return unionBlobs.get(key);
}
export function sourceUnionParentRead(view,path){
 assert(Object.hasOwn(SOURCE_UNION_PARENTS,view),'UNION_UNKNOWN_PARENT');
 const row=unionBlob(SOURCE_UNION_PARENTS[view],path);assert(row,'UNION_PARENT_ABSENT:'+path);
 return Buffer.from(row.bytes);
}
// This is a two-file code-source pin, NOT PDF/financial/source-rights admission.
export function sourceUnionNormalizerLineage(){
 assert.match(SOURCE_UNION_NORMALIZER_PARENT,/^[a-f0-9]{40}$/,'UNION_NORMALIZER_IMMUTABLE_PARENT');
 assert.match(SOURCE_UNION_NORMALIZER_BASE,/^[a-f0-9]{40}$/,'UNION_NORMALIZER_IMMUTABLE_BASE');
 assert.deepEqual(git(['rev-list','--parents','-n','1',SOURCE_UNION_NORMALIZER_PARENT]).trim().split(' '),
  [SOURCE_UNION_NORMALIZER_PARENT,SOURCE_UNION_NORMALIZER_BASE],'UNION_NORMALIZER_PARENT');
 const fields=git(['diff','--no-renames','--name-status','-z',SOURCE_UNION_NORMALIZER_BASE,SOURCE_UNION_NORMALIZER_PARENT,'--']).split('\0').filter(Boolean);
 assert.equal(fields.length,4,'UNION_NORMALIZER_EXACT_SCOPE');
 const delta=[];for(let i=0;i<fields.length;i+=2)delta.push({status:fields[i],path:fields[i+1]});
 assert.deepEqual(delta,SOURCE_UNION_NORMALIZER_FILES.map(({path})=>({status:'A',path})),'UNION_NORMALIZER_EXACT_SCOPE');
 for(const file of SOURCE_UNION_NORMALIZER_FILES){
  assert(!SOURCE_UNION_SUPPORT.includes(file.path),'UNION_NORMALIZER_SUPPORT_OVERLAP');
  for(const revision of [SOURCE_UNION_NORMALIZER_BASE,...Object.values(SOURCE_UNION_PARENTS)])assert.equal(unionBlob(revision,file.path),null,'UNION_NORMALIZER_NOT_NEW:'+file.path);
  const row=unionBlob(SOURCE_UNION_NORMALIZER_PARENT,file.path);
  assert(row,'UNION_NORMALIZER_ABSENT:'+file.path);
  assert.equal(row.mode,'100644','UNION_NORMALIZER_MODE:'+file.path);
  assert.equal(row.mode,file.mode,'UNION_NORMALIZER_MODE:'+file.path);
  assert.equal(row.sha256,file.sha256,'UNION_NORMALIZER_BLOB_DRIFT:'+file.path);
 }
 return {parent:SOURCE_UNION_NORMALIZER_PARENT,base:SOURCE_UNION_NORMALIZER_BASE,
  files:SOURCE_UNION_NORMALIZER_FILES.map(row=>({...row})),source_admission:false,canonical_admission:false};
}
export function sourceUnionR3Lineage(){
 const prior_root={revision:SOURCE_UNION_R3_BASE,path:FROZEN_SOURCE_UNION_R2,sha256:'d9252d66bf79c19cc1074bd4817a894dea97339927f286a1bf3554e24bf1ec1a'};
 const rootRow=unionBlob(prior_root.revision,prior_root.path);
 assert.equal(rootRow?.sha256,prior_root.sha256,'UNION_R3_PRIOR_ROOT_DRIFT');assert.equal(rootRow?.mode,'100644','UNION_R3_PRIOR_ROOT_MODE');
 assert.equal(SOURCE_UNION_R3_FILES.length,8,'UNION_R3_EXACT_EIGHT');
 assert.equal(new Set(SOURCE_UNION_R3_FILES.map(row=>row.path)).size,8,'UNION_R3_UNIQUE_PATHS');
 for(const file of SOURCE_UNION_R3_FILES){
  assert(!SOURCE_UNION_SUPPORT.includes(file.path),'UNION_R3_SUPPORT_OVERLAP');
  const old=unionBlob(SOURCE_UNION_R3_BASE,file.path);
  assert.equal(old?.sha256??null,file.before_sha256,'UNION_R3_BEFORE_DRIFT:'+file.path);
  if(old)assert.equal(old.mode,'100644','UNION_R3_BEFORE_MODE:'+file.path);
  assert.equal(file.mode,'100644');assert.match(file.after_sha256,/^[a-f0-9]{64}$/);
 }
 const prior_proof={revision:SOURCE_UNION_R3_BASE,tests:21,files:[
  {path:'tests/helpers/integrationAdmission.mjs',sha256:'252551e68f1c94f6d7b6940f132391821ebf19c12faf5f89faaa6ebd844d58ec'},
  {path:'tests/originalIngressAdmission.test.mjs',sha256:'cc7c424011386b49dd5c01f8b6e37762be0b495fea3a27950ac66eb1c446ca57'},
  {path:'tests/officialPublicAdmission.test.mjs',sha256:'253a4c4c6d346f31a39a105b94473a3ccf6467893bcbfb678af196e11f2cf998'},
  {path:'.github/workflows/v1-source-integration.yml',sha256:'2d8b2095fca1e61e2b40430cf2394f18c78b36f6857927c6440690f71e486311'},
 ]};
 for(const file of prior_proof.files){const row=unionBlob(prior_proof.revision,file.path);assert.equal(row?.sha256,file.sha256,'UNION_R3_PRIOR_PROOF_DRIFT');assert.equal(row?.mode,'100644');}
 return {schema:'V1_SOURCE_UNION_R3_EXACT_DELTA_1',base:SOURCE_UNION_R3_BASE,prior_root,prior_proof,
  files:SOURCE_UNION_R3_FILES.map(row=>({...row})),normalizer_version:'R3_VERSIONED_DELTA_NOT_8FBE_BLOBS',
  source_admission:false,canonical_admission:false,worker_payload_changed:false,cle_payload_changed:false,
  capacity_evidence:'SYNTHETIC_LOCAL_SQL_MODEL_NOT_PRODUCTION_10000_MEMBER_PASS',
  evaluator_evidence:'MEMORY_BASIS_CONTROL_AND_FRESH_DB_FIXTURE_NOT_PRODUCTION_ROLE_OR_RAW_PAYLOAD_PROOF'};
}
export function sourceUnionLineage(){
 const receipts=[
  {view:'actual',revision:SOURCE_UNION_PARENTS.actual,path:FROZEN_ACTUAL,sha256:'c23aa84a894faf51c536d34d51586a3cca6dd24a6c3d44026a7f5fcb9f54d1ee'},
  {view:'registry',revision:SOURCE_UNION_PARENTS.registry,path:FROZEN_REGISTRY,sha256:'0fe3ec91a03ebeeec1ac8d3fa00e44aa295bf74dbe25c6a620d55b4e3ea35c06'},
  {view:'registry_prior',revision:REGISTRY_SUPPORT_PARENT,path:FROZEN_REGISTRY,sha256:'c73698b0e0280e48130e0876e79205c7457916d67fe47d4ff38b1164bf939ba3'},
  {view:'union_prior',revision:SOURCE_UNION_NORMALIZER_BASE,path:FROZEN_SOURCE_UNION,sha256:'b9869544786b66e75c38e390550494307dabef4c549745a66f84bd79a1b74d0f'},
  {view:'normalizer_prior',revision:SOURCE_UNION_NORMALIZER_PRIOR_PARENT,path:FROZEN_SOURCE_UNION_NORMALIZER,sha256:'ac75c13d9314a90cdeb28fb361bb7cc3543946848126a4339d003b7cb9fb97d8'},
 ];
 for(const r of receipts)assert.equal(unionBlob(r.revision,r.path)?.sha256,r.sha256,'UNION_PINNED_RECEIPT_DRIFT');
 const historical_proof={revision:'965263fe15dc672cac6c61af06bfd14d69044dd3',path:'tests/integrationAdmission.test.mjs',sha256:'539e44ccda3168a0b0fdb13ef8fb700b93e994d763f8f0a8a981c720a56cdcbf'};
 assert.equal(unionBlob(historical_proof.revision,historical_proof.path)?.sha256,historical_proof.sha256,'UNION_HISTORICAL_PROOF_DRIFT');
 // The old 20-test PASS is referenced at its exact parent, not rerun or counted
 // as current execution. Its original 9ff/505-row assertions remain immutable.
 const prior_normalizer_proof={revision:SOURCE_UNION_NORMALIZER_PRIOR_PARENT,
  execution:'PINNED_PRIOR_PASS_REFERENCE_NOT_CURRENT',verified_prior_tests:20,
  files:[
   {path:'tests/originalIngressAdmission.test.mjs',sha256:'d79ca4e92357f06b8fef2f105adfa87c0dd1f5deeea91f7f4eab977b411fcb48'},
   {path:'tests/officialPublicAdmission.test.mjs',sha256:'253a4c4c6d346f31a39a105b94473a3ccf6467893bcbfb678af196e11f2cf998'},
   {path:'.github/workflows/v1-source-integration.yml',sha256:'2d8b2095fca1e61e2b40430cf2394f18c78b36f6857927c6440690f71e486311'},
  ]};
 for(const file of prior_normalizer_proof.files){const row=unionBlob(prior_normalizer_proof.revision,file.path);
  assert.equal(row?.sha256,file.sha256,'UNION_PRIOR_NORMALIZER_PROOF_DRIFT');assert.equal(row?.mode,'100644','UNION_PRIOR_NORMALIZER_PROOF_MODE');}
 return {schema:'V1_SOURCE_UNION_CANDIDATE_1',base:SOURCE_UNION_BASE,parents:{...SOURCE_UNION_PARENTS},
  registry_support:{parent:REGISTRY_SUPPORT_PARENT,paths:[...REGISTRY_SUPPORT_PATHS]},receipts,
  historical_proof,prior_normalizer_proof,normalizer:sourceUnionNormalizerLineage(),r3:sourceUnionR3Lineage(),support_paths:[...SOURCE_UNION_SUPPORT],source_authorities_shared:false,member_gate_changed:false};
}
let unionExpected;
function sourceUnionExpected(){
 if(!unionExpected){
  assert.equal(git(['merge-base',SOURCE_UNION_PARENTS.actual,SOURCE_UNION_PARENTS.registry]).trim(),SOURCE_UNION_BASE,'UNION_PARENT_FORK');
  assert.equal(git(['rev-parse',SOURCE_UNION_PARENTS.registry+'^']).trim(),REGISTRY_SUPPORT_PARENT,'UNION_SUPPORT_PARENT');
  const delta=(a,b)=>git(['diff','--no-renames','--name-only','-z',a,b,'--']).split('\0').filter(Boolean).sort();
  assert.deepEqual(delta(REGISTRY_SUPPORT_PARENT,SOURCE_UNION_PARENTS.registry),REGISTRY_SUPPORT_PATHS,'UNION_EXACT_SUPPORT_SCOPE');
  const a=delta(SOURCE_UNION_BASE,SOURCE_UNION_PARENTS.actual),b=delta(SOURCE_UNION_BASE,SOURCE_UNION_PARENTS.registry);
  const allowed={actual:new Set([...OFFICIAL_PUBLIC_DELTAS,FROZEN_ACTUAL]),registry:new Set([...ORIGINAL_INGRESS_DELTAS,FROZEN_REGISTRY])};
  for(const [view,paths]of [['actual',a],['registry',b]])for(const p of paths)assert(allowed[view].has(p),'UNION_UNREVIEWED_PARENT_DELTA:'+p);
  const expected=new Map(tree(SOURCE_UNION_BASE)),support=new Set(SOURCE_UNION_SUPPORT);
  const equal=(x,y)=>x?.sha256===y?.sha256&&x?.mode===y?.mode;
  for(const p of new Set([...a,...b])){
   if(support.has(p))continue;
   const old=expected.get(p),left=unionBlob(SOURCE_UNION_PARENTS.actual,p),right=unionBlob(SOURCE_UNION_PARENTS.registry,p);
   const selected=equal(left,right)?left:equal(left,old)?right:equal(right,old)?left:null;
   assert(selected,'UNION_UNRESOLVED_SOURCE_CONFLICT:'+p);
   expected.set(p,selected);
  }
  assert(!expected.has(FROZEN_SOURCE_UNION),'UNION_PRIOR_RECEIPT_OVERLAP');
  expected.set(FROZEN_SOURCE_UNION,unionBlob(SOURCE_UNION_NORMALIZER_BASE,FROZEN_SOURCE_UNION));
  assert(!expected.has(FROZEN_SOURCE_UNION_NORMALIZER),'UNION_PRIOR_RECEIPT_OVERLAP');
  expected.set(FROZEN_SOURCE_UNION_NORMALIZER,unionBlob(SOURCE_UNION_NORMALIZER_PRIOR_PARENT,FROZEN_SOURCE_UNION_NORMALIZER));
  for(const file of SOURCE_UNION_NORMALIZER_FILES){
   assert(!expected.has(file.path)&&!support.has(file.path),'UNION_NORMALIZER_SOURCE_OVERLAP:'+file.path);
   expected.set(file.path,unionBlob(SOURCE_UNION_NORMALIZER_PARENT,file.path));
  }
  // Exact reviewed replacements only, after reconstructing both original parents
  // and the historical 8fbe blobs. No prefix, manifest hash or caller exemption.
  assert(!expected.has(FROZEN_SOURCE_UNION_R2),'UNION_R3_PRIOR_RECEIPT_OVERLAP');
  expected.set(FROZEN_SOURCE_UNION_R2,unionBlob(SOURCE_UNION_R3_BASE,FROZEN_SOURCE_UNION_R2));
  for(const file of SOURCE_UNION_R3_FILES){
   assert.equal(expected.get(file.path)?.sha256??null,file.before_sha256,'UNION_R3_BEFORE_COMPOSITION:'+file.path);
   expected.set(file.path,{mode:file.mode,sha256:file.after_sha256});
  }
  for(const p of support)expected.delete(p);
  unionExpected=expected;
 }
 return unionExpected;
}
function verifySourceUnionBoundary(read,mode){
 sourceUnionLineage();
 for(const [p,row]of sourceUnionExpected()){
  assert.equal(integrationHash(read(p)),row.sha256,'INTEGRATION_SOURCE_DRIFT:'+p);
  assert.equal(mode(p),row.mode,'INTEGRATION_MODE_DRIFT:'+p);
 }
 for(const p of SOURCE_UNION_SUPPORT)assert.equal(mode(p),'100644','INTEGRATION_MODE_DRIFT:'+p);
 assert.deepEqual(Buffer.from(read(FROZEN_ORIGINAL_INGRESS)),frozenReceipt(ORIGINAL_REGISTRY_PARENT,FROZEN_ORIGINAL_INGRESS),'INTEGRATION_ORIGINAL_INGRESS_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_CONTINUOUS_LIFECYCLE)),frozenReceipt(V1_ACTUAL_PARENT,FROZEN_CONTINUOUS_LIFECYCLE),'INTEGRATION_CONTINUOUS_LIFECYCLE_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_OFFICIAL_PUBLIC)),frozenReceipt(PRIOR_CONTINUOUS_BASE,FROZEN_OFFICIAL_PUBLIC),'INTEGRATION_OFFICIAL_PUBLIC_RECEIPT_DRIFT');
}
export function createSourceUnionComposition(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifySourceUnionBoundary(read,mode);
 const scope=integrationScope(),baseline=tree(INTEGRATION_BASE);
 assert.deepEqual([...paths].sort(),[...scope,INTEGRATION_MANIFEST].sort(),'INTEGRATION_UNKNOWN_PATH');
 const old=JSON.parse(frozenReceipt(SOURCE_UNION_BASE,FROZEN_COLD_SOURCE)),oldRows=new Map(old.files.map(r=>[r.path,r]));
 return {...old,source_union:sourceUnionLineage(),files:scope.map(path=>({
  path,before_sha256:baseline.get(path)?.sha256??null,after_sha256:integrationHash(read(path)),mode:mode(path),
  origin:INTEGRATION_DELTAS.includes(path)?'composition':oldRows.get(path).origin,
 }))};
}
// Compatibility names preserve existing consumers, but both now verify the ONE
// complete current union. Original parent assertions execute only at their pin.
export const createOriginalIngressComposition=createSourceUnionComposition;
export const createOfficialPublicComposition=createSourceUnionComposition;
const pinnedProofs=Object.freeze({
 actual:{revision:SOURCE_UNION_PARENTS.actual,tests:['tests/officialPublicAdmission.test.mjs','tests/forwardCutoffAdmission.test.mjs']},
 registry:{revision:SOURCE_UNION_PARENTS.registry,tests:['tests/originalIngressAdmission.test.mjs']},
 historical:{revision:'965263fe15dc672cac6c61af06bfd14d69044dd3',tests:['tests/integrationAdmission.test.mjs']},
 union:{revision:SOURCE_UNION_NORMALIZER_BASE,tests:['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']},
 r2:{revision:SOURCE_UNION_R3_BASE,tests:['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']},
});
export function verifySourceUnionPinnedProof(view){
 assert(Object.hasOwn(pinnedProofs,view),'UNION_UNKNOWN_PARENT');
 verifyIntegrationCandidate();
 const proof=pinnedProofs[view];
 const folder=mkdtempSync(join(tmpdir(),'ma-union-parent-')),checkout=join(folder,'source');
 const env={PATH:process.env.PATH,LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
  GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
 try{
  execFileSync('git',['-c','core.hooksPath=/dev/null','clone','--shared','--no-checkout','--',fileURLToPath(root),checkout],{env,stdio:['ignore','pipe','pipe']});
  execFileSync('git',['-c','core.hooksPath=/dev/null','--no-replace-objects','checkout','--detach',proof.revision],{cwd:checkout,env,stdio:['ignore','pipe','pipe']});
  for(const p of proof.tests)assert.deepEqual(readFileSync(join(checkout,p)),unionBlob(proof.revision,p).bytes,'UNION_PINNED_PROOF_DRIFT');
  const modules=new URL('node_modules',root);
  if(existsSync(modules)){
   const target=join(checkout,'node_modules');mkdirSync(target);
   for(const name of readdirSync(modules))symlinkSync(join(fileURLToPath(modules),name),join(target,name));
  }
  const output=execFileSync(process.execPath,['--experimental-strip-types','--test','--test-reporter=tap','--test-concurrency=1',...proof.tests],{
   cwd:checkout,env:{...env,NODE_OPTIONS:'--experimental-strip-types'},encoding:'utf8',maxBuffer:8e6,timeout:view==='r2'?180000:120000,
  });
  const count=view==='union'?13:view==='r2'?21:null;
  if(count!==null)for(const [name,n]of [['tests',count],['pass',count],['fail',0],['cancelled',0],['skipped',0]])assert.match(output,new RegExp('^# '+name+' '+n+'$','m'),'UNION_PRIOR_ALL_ASSERTIONS');
 }finally{rmSync(folder,{recursive:true,force:true});assert(!existsSync(folder),'UNION_PINNED_CLEANUP_FAILED');}
 verifyIntegrationCandidate();
 const count=view==='union'?13:view==='r2'?21:null;
 return {revision:proof.revision,tests:[...proof.tests],cleanup:'VERIFIED_REMOVED',...(count===null?{}:{tests_run:count,tests_passed:count})};
}
export function verifyIntegrationCandidate(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifySourceUnionBoundary(read,mode);
 assert.equal(mode(INTEGRATION_MANIFEST),'100644','INTEGRATION_MANIFEST_MODE_DRIFT');
 const m=JSON.parse(read(INTEGRATION_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','parents','files','source_union','production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].sort());
 assert.deepEqual(m.source_union,sourceUnionLineage(),'UNION_LINEAGE_DRIFT');
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
