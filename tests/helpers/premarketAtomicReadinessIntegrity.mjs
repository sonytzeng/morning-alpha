import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_EXPORT_ARTIFACT_PATH,
  resolveConsolidationPublicExportIntegrity,
} from './consolidationPublicExportIntegrity.mjs';
import { readReviewedGitPredecessor, resolveReviewedBaselineTransition } from './reviewedBaselineTransition.mjs';
import { recommendationTransition, readRecommendationPredecessor } from './recommendationPhaseIntegrity.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const predecessorCommit = 'c77798272c34a7be42de376a19ad2d7dc90877a7';
const namedMigration = 'supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql';
const namedMigrationHash = '32e3828364e6e69d83b675c8f3ab6a1f0b580d7e9cbcdee987620fe5d0c708ad';
const scopes = ['supabase', '.github/workflows', 'src/lib/decisionEvidence.ts',
  'src/lib/runtimeDecisionTimeline.ts', 'src/services/resolveActiveReport.ts'];
const approvedHistoricalExceptions = new Set([
  'supabase/functions/get-report-payload/index.ts',
  'supabase/functions/_shared/decision-v1-data.ts',
  'supabase/functions/_shared/decision-v1-evidence.ts',
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n');

export function verifyPremarketAtomicCoreInventory(registry, integrity, readSource = read) {
  const inventory = JSON.parse(readSource('docs/operations/evidence/premarket-atomic-core-inventory-20260917.json'));
  assert.equal(inventory.schema_version, 'PREMARKET_ATOMIC_CORE_INVENTORY_V1');
  assert.equal(inventory.predecessor_commit, predecessorCommit);
  assert.equal(inventory.predecessor_count, 109);
  assert.equal(inventory.candidate_count, 110);
  assert.deepEqual(inventory.reviewed_addition, { path: namedMigration, sha256: namedMigrationHash });
  assert.equal(inventory.predecessor.length, 109);
  const rows = inventory.predecessor;
  const paths = rows.map(row => row.path);
  assert.equal(new Set(paths).size, 109);
  assert.deepEqual(paths, [...paths].sort());
  const historicalAdditions = new Set(registry.files.filter(row => row.baseline_sha256 === null).map(row => row.path));
  const availableToReviewedLayer = path => {
    try { readSource(path); return true; } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  };
  const include = path => availableToReviewedLayer(path) && !approvedHistoricalExceptions.has(path) && !historicalAdditions.has(path)
    && (!integrity.newCandidatePaths.includes(path) || path === namedMigration);
  const predecessorPaths = git(['ls-tree', '-r', '--name-only', predecessorCommit, '--', ...scopes]).filter(include);
  assert.deepEqual(paths, predecessorPaths, 'the exact sealed 109-file predecessor set must survive');
  const candidatePaths = git(['ls-files', ...scopes]).filter(include);
  assert.deepEqual(candidatePaths, [...paths, namedMigration].sort(),
    'the sole added Core file must be the named premarket Atomic migration');
  for (const row of rows) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(execFileSync('git', ['show', `${predecessorCommit}:${row.path}`], { cwd: root })),
      row.sha256, `predecessor hash drift: ${row.path}`);
    assert.equal(sha256(readSource(row.path)), row.sha256, `candidate hash drift: ${row.path}`);
  }
  assert.equal(sha256(readSource(namedMigration)), namedMigrationHash);
  return { predecessor_count: 109, candidate_count: 110, reviewed_addition: namedMigration };
}

function resolvePremarketAtomicReadinessBaseline(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/premarket-atomic-readiness-baseline-transition-20260917.json'));
  const integrity = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_PREMARKET_READINESS_20260917',
    verifyPredecessor: predecessorRead => resolveConsolidationPublicExportIntegrity(registry, artifactBytes, predecessorRead),
  });
  return { ...integrity, atomicCoreInventory: verifyPremarketAtomicCoreInventory(registry, integrity, readSource) };
}

function resolveReportPublicationCandidateIntegrity(registry, artifactBytes, readSource) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/report-publication-contract-baseline-transition-20260917.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_PREMARKET_ATOMIC_READINESS_20260917',
    verifyPredecessor: predecessorRead => resolvePremarketAtomicReadinessBaseline(registry, artifactBytes, predecessorRead),
  });
  // Preserve the historical public result shape for every predecessor test;
  // the new candidate is an additional, exact-hash successor, not a rewrite.
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    reportPublicationCandidateIntegrity: candidate,
  };
}

function resolveCrossDaySectorRecoveryIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/cross-day-sector-recovery-baseline-transition-20260918.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_REPORT_PUBLICATION_CONTRACT_20260917',
    verifyPredecessor: predecessorRead => resolveReportPublicationCandidateIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    crossDayCandidateIntegrity: candidate,
  };
}

function resolveFullDayCounterfactualIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/full-day-counterfactual-baseline-transition-20260918.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_CROSS_DAY_SECTOR_RECOVERY_20260918',
    verifyPredecessor: predecessorRead => resolveCrossDaySectorRecoveryIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    fullDayCandidateIntegrity: candidate,
  };
}

function resolveTxfSessionParityIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/txf-session-date-parity-baseline-transition-20260921.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_FULL_DAY_COUNTERFACTUAL_20260918',
    verifyPredecessor: predecessorRead => resolveFullDayCounterfactualIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    txfSessionParityCandidateIntegrity: candidate,
  };
}

function resolveTaiwanCashPhaseIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/premarket-tw-cash-phase-baseline-transition-20260922.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_TXF_SESSION_DATE_PARITY_20260921',
    verifyPredecessor: predecessorRead => resolveTxfSessionParityIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    taiwanCashPhaseCandidateIntegrity: candidate,
  };
}

function resolveAcceptanceReadinessIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/acceptance-readiness-window-parity-baseline-transition-20260922.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_PREMARKET_TW_CASH_PHASE_20260922',
    verifyPredecessor: predecessorRead => resolveTaiwanCashPhaseIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    acceptanceReadinessCandidateIntegrity: candidate,
  };
}

export function resolvePremarketAtomicReadinessIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/premarket-production-parity-baseline-transition-20260923.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_ACCEPTANCE_READINESS_WINDOW_PARITY_20260922',
    verifyPredecessor: predecessorRead => resolveAcceptanceReadinessIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    premarketProductionParityCandidateIntegrity: candidate,
  };
}

export function resolveProductionEvidenceRecorderIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/production-evidence-recorder-baseline-transition-20260923.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_PREMARKET_PRODUCTION_PARITY_20260923',
    verifyPredecessor: predecessorRead => resolvePremarketAtomicReadinessIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    productionEvidenceRecorderCandidateIntegrity: candidate,
  };
}

export function resolveAtomicRowContractIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/atomic-row-contract-baseline-transition-20260924.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest,
    readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_PRODUCTION_EVIDENCE_RECORDER_20260923',
    verifyPredecessor: predecessorRead => resolveProductionEvidenceRecorderIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    atomicRowContractCandidateIntegrity: candidate,
  };
}

function resolveRuntimeSparseRecoveryPredecessorIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/runtime-sparse-recovery-baseline-transition-20260929.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest, readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_ATOMIC_ROW_CONTRACT_20260924',
    verifyPredecessor: predecessorRead => resolveAtomicRowContractIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    runtimeSparseRecoveryCandidateIntegrity: candidate,
  };
}

function resolveResearchEvidenceRecoveryIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/research-evidence-recovery-baseline-transition-20260930.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest, readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_RUNTIME_SPARSE_RECOVERY_20260929',
    verifyPredecessor: predecessorRead => resolveRuntimeSparseRecoveryPredecessorIntegrity(registry, artifactBytes, predecessorRead),
  });
  return {
    ...candidate.reviewedBaselinePredecessor,
    fileHash: candidate.fileHash,
    newCandidatePaths: candidate.newCandidatePaths,
    researchEvidenceRecoveryCandidateIntegrity: candidate,
  };
}

function resolveSixBugPredecessorIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/six-bug-baseline-transition-20260930.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest, readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_RESEARCH_EVIDENCE_RECOVERY_20260930',
    verifyPredecessor: predecessorRead => resolveResearchEvidenceRecoveryIntegrity(registry, artifactBytes, predecessorRead),
  });
  const declarations = manifest.reviewed_calendar_declarations;
  assert.deepEqual(declarations.map(row => [row.path, row.name]), [
    ['supabase/functions/_shared/market-status.ts', 'TAIWAN_HOLIDAYS_2026'],
    ['supabase/functions/_shared/market-status.ts', 'resolveMarketStatus'],
  ], 'only the two reviewed authoritative-calendar declarations may transition');
  const original = JSON.parse(readSource('docs/operations/core-stability-source-manifest-20260907.json'));
  const declarationOverrides = new Map();
  for (const row of declarations) {
    const record = original.protected_declarations.find(value => value.path === row.path && value.name === row.name);
    assert.ok(record, 'protected predecessor declaration must exist');
    assert.equal(candidate.reviewedBaselinePredecessor.declarationHash(record), row.predecessor_sha256,
      'protected calendar predecessor hash must survive');
    assert.match(row.candidate_sha256, /^[a-f0-9]{64}$/);
    declarationOverrides.set(row.path + ':' + row.name, row.candidate_sha256);
  }
  return { ...candidate.reviewedBaselinePredecessor, fileHash:candidate.fileHash,
    declarationHash: row => declarationOverrides.get(row.path + ':' + row.name)
      ?? candidate.reviewedBaselinePredecessor.declarationHash(row),
    newCandidatePaths:candidate.newCandidatePaths, sixBugCandidateIntegrity:candidate };
}

function resolveRecorderRetryPredecessorIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/recorder-retry-projection-baseline-20260930.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest, readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_SIX_BUG_PREVENTIVE_CLOSURE_20260930',
    verifyPredecessor: predecessorRead => resolveSixBugPredecessorIntegrity(registry, artifactBytes, predecessorRead),
  });
  return { ...candidate.reviewedBaselinePredecessor, fileHash:candidate.fileHash,
    newCandidatePaths:candidate.newCandidatePaths, recorderRetryCandidateIntegrity:candidate };
}

function resolveOperationalMarketIntegrity(registry, artifactBytes, readSource = read) {
  const manifest = JSON.parse(readSource('docs/operations/evidence/operational-market-baseline-20261001.json'));
  const candidate = resolveReviewedBaselineTransition({
    manifest, readSource,
    readPredecessor: row => readReviewedGitPredecessor(row, root),
    expectedPredecessorIntegrityId: 'MORNING_ALPHA_RECORDER_RETRY_PROJECTION_20260930',
    verifyPredecessor: predecessorRead => resolveRecorderRetryPredecessorIntegrity(registry, artifactBytes, predecessorRead),
  });
  const declarations=manifest.reviewed_operational_declarations;
  assert.deepEqual(declarations.map(row=>[row.path,row.name]),[
    ['supabase/functions/generate-daily-report-v7/index.ts','attachResearchMasterV2Shadow'],
  ],'only the named operational capsule attachment may transition; strategy/prompt declarations stay sealed');
  const original=JSON.parse(readSource('docs/operations/core-stability-source-manifest-20260907.json'));
  const overrides=new Map();
  for(const row of declarations){
    const record=original.protected_declarations.find(value=>value.path===row.path&&value.name===row.name);
    assert.ok(record,'protected predecessor declaration must exist');
    assert.equal(candidate.reviewedBaselinePredecessor.declarationHash(record),row.predecessor_sha256);
    assert.match(row.candidate_sha256,/^[a-f0-9]{64}$/);
    overrides.set(row.path+':'+row.name,row.candidate_sha256);
  }
  return { ...candidate.reviewedBaselinePredecessor, fileHash:candidate.fileHash,
    declarationHash:row=>overrides.get(row.path+':'+row.name)??candidate.reviewedBaselinePredecessor.declarationHash(row),
    newCandidatePaths:candidate.newCandidatePaths, operationalMarketCandidateIntegrity:candidate };
}

export const readPremarketAtomicReadinessIntegrity = registry =>
  resolveRuntimeSparseRecoveryIntegrity(registry, read(PUBLIC_EXPORT_ARTIFACT_PATH));

export const readConsolidationPublicExportIntegrity = readPremarketAtomicReadinessIntegrity;
export { PUBLIC_EXPORT_ARTIFACT_PATH };

function resolvePublicProjectionPredecessorIntegrity(registry, artifactBytes, readSource = read) {
  const manifest=JSON.parse(readSource('docs/operations/evidence/public-market-projection-baseline-20261002.json'));
  const candidate=resolveReviewedBaselineTransition({manifest,readSource,
    readPredecessor:row=>readReviewedGitPredecessor(row,root),
    expectedPredecessorIntegrityId:'MORNING_ALPHA_OPERATIONAL_MARKET_20261001',
    verifyPredecessor:predecessorRead=>resolveOperationalMarketIntegrity(registry,artifactBytes,predecessorRead)});
  return {...candidate.reviewedBaselinePredecessor,fileHash:candidate.fileHash,
    newCandidatePaths:candidate.newCandidatePaths,publicProjectionCandidateIntegrity:candidate};
}

function resolveResearchFoundationPredecessorIntegrity(registry, artifactBytes, readSource = read) {
  const manifest=JSON.parse(readSource('docs/10k-program/phase1-baseline-transition.json'));
  const candidate=resolveReviewedBaselineTransition({manifest,readSource,
    readPredecessor:row=>readReviewedGitPredecessor(row,root),
    expectedPredecessorIntegrityId:'MORNING_ALPHA_PUBLIC_MARKET_PROJECTION_20261002',
    verifyPredecessor:predecessorRead=>resolvePublicProjectionPredecessorIntegrity(registry,artifactBytes,predecessorRead)});
  // Keep each historical result shape and seal intact; only the named successor is new.
  return {...candidate.reviewedBaselinePredecessor,fileHash:candidate.fileHash,
    newCandidatePaths:candidate.newCandidatePaths,researchFoundationCandidateIntegrity:candidate};
}

function resolveAnalysisIntelligencePredecessorIntegrity(registry, artifactBytes, readSource = read) {
  const manifest=JSON.parse(readSource('docs/10k-program/phase2-baseline-transition.json'));
  const candidate=resolveReviewedBaselineTransition({manifest,readSource,
    readPredecessor:row=>readReviewedGitPredecessor(row,root),
    expectedPredecessorIntegrityId:'MORNING_ALPHA_RESEARCH_FOUNDATION_20261004',
    verifyPredecessor:predecessorRead=>resolveResearchFoundationPredecessorIntegrity(registry,artifactBytes,predecessorRead)});
  return {...candidate.reviewedBaselinePredecessor,fileHash:candidate.fileHash,
    newCandidatePaths:candidate.newCandidatePaths,analysisIntelligenceCandidateIntegrity:candidate};
}

// An exact successor, never a rewrite of the already-released Phase 2 seals.
export function readAnalysisIntelligencePredecessor(path, readSource = read) {
  const manifest=JSON.parse(readSource('docs/10k-program/phase2-comparison-transition.json'));
  const row=manifest.files.find(row=>row.path===path);
  if(!row) return readAnalysisComparisonPredecessor(path,readSource);
  if(row.operation==='ADD') throw Object.assign(new Error('absent from Phase 2 predecessor'),{code:'ENOENT'});
  return readReviewedGitPredecessor(row,root);
}
function resolveAnalysisComparisonIntegrity(registry, artifactBytes, readSource = read) {
  const manifest=JSON.parse(readSource('docs/10k-program/phase2-comparison-transition.json'));
  const candidate=resolveReviewedBaselineTransition({manifest,readSource,
    readPredecessor:row=>readReviewedGitPredecessor(row,root),
    expectedPredecessorIntegrityId:'MORNING_ALPHA_ANALYSIS_INTELLIGENCE_20261005',
    verifyPredecessor:predecessorRead=>resolveAnalysisIntelligencePredecessorIntegrity(registry,artifactBytes,predecessorRead)});
  return {...candidate.reviewedBaselinePredecessor,fileHash:candidate.fileHash,
    newCandidatePaths:candidate.newCandidatePaths,analysisComparisonCandidateIntegrity:candidate};
}

export function readAnalysisComparisonPredecessor(path,readSource=read) {
  const manifest=JSON.parse(readSource('docs/10k-program/phase2-persistence-transition.json'));
  const row=manifest.files.find(row=>row.path===path);
  if(!row)return readShadowAuthPredecessor(path,readSource);
  if(row.operation==='ADD')throw Object.assign(new Error('absent from comparison predecessor'),{code:'ENOENT'});
  return readReviewedGitPredecessor(row,root);
}
function resolveAnalysisPersistenceIntegrity(registry,artifactBytes,readSource=read) {
  const manifest=JSON.parse(readSource('docs/10k-program/phase2-persistence-transition.json'));
  const candidate=resolveReviewedBaselineTransition({manifest,readSource,
    readPredecessor:row=>readReviewedGitPredecessor(row,root),
    expectedPredecessorIntegrityId:'MORNING_ALPHA_PREVIOUS_COMPARISON_20261005',
    verifyPredecessor:predecessorRead=>resolveAnalysisComparisonIntegrity(registry,artifactBytes,predecessorRead)});
  return {...candidate.reviewedBaselinePredecessor,fileHash:candidate.fileHash,
    newCandidatePaths:candidate.newCandidatePaths,analysisPersistenceCandidateIntegrity:candidate};
}

export function readShadowAuthPredecessor(path,readSource=read) {
  const manifest=JSON.parse(readSource('docs/10k-program/phase2-shadow-auth-transition.json'));
  const row=manifest.files.find(r=>r.path===path);
  if(!row)return readTradingLabPredecessor(path,readSource);
  if(row.operation==='ADD')throw Object.assign(new Error('absent from Shadow Auth predecessor'),{code:'ENOENT'});
  return readReviewedGitPredecessor(row,root);
}

// Separate explicitly-authorized worker Auth successor. Never pretend this is a
// no-auth-change generic baseline or alter any predecessor seal/Core Auth behavior.
function resolveShadowWorkerAuthIntegrity(registry,artifactBytes,readSource=read) {
  const m=JSON.parse(readSource('docs/10k-program/phase2-shadow-auth-transition.json'));
  assert.equal(m.schema_version,'SHADOW_WORKER_AUTH_TRANSITION_V1');
  assert.equal(m.candidate_base_git_sha,'8561f4cb78ccc7b5e49885dd18585a0cfe63f41c');
  assert.equal(m.worker_auth_change,true);
  assert.deepEqual(m.files.map(r=>r.path).sort(),[
    '.github/workflows/analysis-intelligence.yml','docs/10k-program/phase2-shadow-auth-candidate.md',
    'scripts/research-shadow-caller.mjs','supabase/functions/_shared/shadow-worker-auth.mjs',
    'supabase/functions/research-analysis-shadow-v1/index.ts','tests/analysisIntelligencePersistence.integration.mjs',
    'tests/analysisIntelligenceShadowAuth.test.mjs','tests/analysisIntelligenceShadowAuthIntegrity.test.mjs',
    'tests/helpers/analysisShadowHttp.mjs','tests/helpers/premarketAtomicReadinessIntegrity.mjs',
    'tests/helpers/shadow-http-import-map.json','tests/helpers/shadowDenoServer.ts','tests/helpers/shadowIsolatedSdk.ts',
  ].sort(),'only the named research-worker Auth candidate files may transition');
  for(const key of ['core_auth_change','production_secret_change','production_deploy','rls_change','cron_change','forward_enabled'])assert.equal(m[key],false);
  assert.equal(new Set(m.files.map(r=>r.path)).size,m.files.length);
  const restored=new Map(),hashes=new Map();
  for(const row of m.files){
    assert.match(row.path,/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);assert(!row.path.split('/').includes('..'));
    assert.match(row.candidate_sha256,/^[a-f0-9]{64}$/);
    assert.equal(sha256(readSource(row.path)),row.candidate_sha256,`unreviewed candidate drift: ${row.path}`);
    assert(['ADD','MODIFY'].includes(row.operation));
    const before=readReviewedGitPredecessor(row,root);
    if(row.operation==='ADD')assert.equal(row.predecessor_sha256,null);
    else {assert.equal(row.predecessor_git_sha,m.candidate_base_git_sha);assert.equal(sha256(before),row.predecessor_sha256);}
    restored.set(row.path,before);hashes.set(row.path,row.candidate_sha256);
  }
  const predecessorRead=path=>{
    if(!restored.has(path))return readSource(path);
    const value=restored.get(path);
    if(value===null)throw Object.assign(new Error('absent from worker Auth predecessor'),{code:'ENOENT'});
    return value;
  };
  const before=resolveAnalysisPersistenceIntegrity(registry,artifactBytes,predecessorRead);
  return {...before,fileHash:row=>hashes.get(row.path)??before.fileHash(row),
    newCandidatePaths:[...new Set([...before.newCandidatePaths,...m.files.filter(r=>r.operation==='ADD').map(r=>r.path)])],
    shadowWorkerAuthCandidateIntegrity:{reviewedBaselineTransition:m}};
}
const tradingLabManifest='docs/10k-program/owner-trading-lab-transition.json';
export function readTradingLabPredecessor(path,readSource=read) {
 const m=JSON.parse(readSource(tradingLabManifest)),row=m.files.find(r=>r.path===path);
 if(!row)return readRecommendationPredecessor(path,readSource);
 if(row.operation==='ADD')throw Object.assign(new Error('absent from Owner Lab predecessor'),{code:'ENOENT'});
 return readReviewedGitPredecessor(row,root);
}
function resolveOwnerTradingLabIntegrity(registry,artifactBytes,readSource=read) {
 const m=JSON.parse(readSource(tradingLabManifest));
 assert.equal(m.schema_version,'OWNER_TRADING_LAB_TRANSITION_V1');
 assert.equal(m.candidate_base_git_sha,'c7a13e2ef1d3d4232617dcf4b9bc541b5a975a9d');
 assert.deepEqual(m.files.map(r=>r.path).sort(),[
  ".github/workflows/owner-trading-lab.yml",
  "docs/10k-program/owner-trading-lab-v1-release.md",
  "docs/10k-program/owner-trading-lab-validation.json",
  "src/features/research/tradingLab.ts",
  "src/pages/admin/Admin.tsx",
  "src/pages/admin/analysis/IntelligenceView.tsx",
  "src/pages/admin/analysis/TradingLab.tsx",
  "src/pages/admin/analysis/analysis.css",
  "src/pages/admin/analysis/page.tsx",
  "supabase/functions/_shared/owner-trading-lab.ts",
  "supabase/functions/owner-trading-lab-v1/index.ts",
  "supabase/migrations/20261006082157_owner_trading_lab_v1.sql",
  "tests/analysisIntelligenceUI.test.mjs",
  "tests/browser/analysisIntelligenceHarness.tsx",
  "tests/browser/ownerTradingLab.vite.ts",
  "tests/browser/ownerTradingLabHarness.tsx",
  "tests/browser/ownerTradingLabSupabaseMock.ts",
  "tests/helpers/owner-lab-import-map.json",
  "tests/helpers/ownerLabDenoServer.ts",
  "tests/helpers/ownerLabIsolatedSdk.ts",
  "tests/helpers/premarketAtomicReadinessIntegrity.mjs",
  "tests/ownerAccountAnalysisNavigation.test.mjs",
  "tests/ownerTradingLab.test.mjs",
  "tests/ownerTradingLabDatabase.integration.mjs",
  "tests/ownerTradingLabHandler.integration.mjs",
  "tests/ownerTradingLabIntegrity.test.mjs",
  "tests/ownerTradingLabUI.test.mjs"
],'only the named Owner Trading Lab candidate files may transition');
 for(const k of ['core_change','existing_auth_change','existing_rls_change','secret_change','cron_change','forward_enabled','production_deploy'])assert.equal(m[k],false);
 assert.equal(new Set(m.files.map(r=>r.path)).size,m.files.length);
 const restored=new Map(),hashes=new Map();
 for(const row of m.files){
  assert.match(row.candidate_sha256,/^[a-f0-9]{64}$/);
  assert.equal(sha256(readSource(row.path)),row.candidate_sha256,`unreviewed candidate drift: ${row.path}`);
  assert(['ADD','MODIFY'].includes(row.operation));
  const before=readReviewedGitPredecessor(row,root);
  if(row.operation==='ADD')assert.equal(row.predecessor_sha256,null);
  else {assert.equal(row.predecessor_git_sha,m.candidate_base_git_sha);assert.equal(sha256(before),row.predecessor_sha256);}
  restored.set(row.path,before);hashes.set(row.path,row.candidate_sha256);
 }
 const predecessorRead=path=>{
  if(!restored.has(path))return readSource(path);
  const bytes=restored.get(path);
  if(bytes===null)throw Object.assign(new Error('absent from Owner Lab predecessor'),{code:'ENOENT'});
  return bytes;
 };
 const before=resolveShadowWorkerAuthIntegrity(registry,artifactBytes,predecessorRead);
 return {...before,fileHash:row=>hashes.get(row.path)??before.fileHash(row),
  newCandidatePaths:[...new Set([...before.newCandidatePaths,...m.files.filter(r=>r.operation==='ADD').map(r=>r.path)])],
  ownerTradingLabCandidateIntegrity:{reviewedBaselineTransition:m}};
}

export function resolveRuntimeSparseRecoveryIntegrity(registry,artifactBytes,readSource=read) {
 const candidate=recommendationTransition(readSource);
 const before=resolveOwnerTradingLabIntegrity(registry,artifactBytes,candidate.predecessorRead);
 return {...before,fileHash:row=>candidate.hashes.get(row.path)??before.fileHash(row),
  newCandidatePaths:[...new Set([...before.newCandidatePaths,...candidate.manifest.files.filter(r=>r.operation==='ADD').map(r=>r.path)])],
  recommendationPhaseCandidateIntegrity:{reviewedBaselineTransition:candidate.manifest}};
}
