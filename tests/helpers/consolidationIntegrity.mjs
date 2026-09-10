import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolveSubscriberProjectionIntegrity } from './subscriberProjectionIntegrity.mjs';

// Fourth layer only: exact reviewed bytes, not a generic newest-hash exemption.
// The original three-layer implementation remains byte-for-byte unchanged.
export const CONSOLIDATION_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';
const ARTIFACT = 'e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315';
const SECTION = '01804c4ed0b2f55071bac23bd575a26964c683714fea2262aa4eeeccb0bdafab';
const PATCH = '36abc6f3e6a33a1dd142ae68319e33c852098a34939836dc8aa1668123d8bd7d';
const PREVIOUS = '7597edbd731636882e442faecd3bc4f8dd6f0701e07dd1ed7ddfe32e43b7505b';
const BASE = '6469630795fb1215595306c026437d850b668801';
const ID = 'CORE_PIPELINE_CONSOLIDATION_APPEND_20260909';
const MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';
const MANIFEST = 'bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c';
const OLD_GUARD_PATH = 'tests/helpers/subscriberProjectionIntegrity.mjs';
const OLD_GUARD = '2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0';
const FIRST_ARTIFACT_PATH = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';
const PATHS = {
  "files": [
    "src/lib/decisionPresentation.ts",
    "src/lib/runtimeDecisionTimeline.ts",
    "src/lib/subscriberReportContract.ts",
    "src/pages/home/page.tsx",
    "src/pages/member-note/page.tsx",
    "src/pages/opportunities/page.tsx",
    "src/pages/performance/page.tsx",
    "src/pages/report/TodayReport.tsx",
    "src/pages/reports/ReportDetail.tsx",
    "src/pages/verification/page.tsx",
    "src/pages/war-room/WarRoom.tsx",
    "supabase/functions/_shared/content-intelligence.ts",
    "supabase/functions/_shared/market-report-gate.ts",
    "supabase/functions/_shared/research-pipeline-contract.ts",
    "supabase/functions/daily-delivery-orchestrator/index.ts",
    "supabase/functions/generate-daily-report-v7/index.ts",
    "supabase/functions/generate-daily-report-v7/research-master-v2.ts",
    "supabase/functions/get-report-payload/index.ts",
    "supabase/functions/line-daily-push/index.ts",
    "supabase/functions/ma-ops-health-check/index.ts",
    "tests/accountSubscriberProjection.test.mjs",
    "tests/marketPublicationPayload.test.mjs",
    "tests/publicRelease.test.mjs"
  ],
  "related_candidates": [
    "src/hooks/useLatestReport.ts",
    "src/lib/morningAlpha/resolveMorningAlphaState.ts",
    "src/lib/morningAlphaDisplayState.ts",
    "src/lib/premiumContentAvailability.ts",
    "src/services/closeMarketReviewService.ts",
    "src/services/homeDashboardService.ts",
    "src/services/marketStateEngine.ts",
    "supabase/functions/_shared/research-pipeline-contract.test.ts",
    "supabase/functions/close-market-review/index.ts",
    "supabase/functions/closing-verification-engine/index.ts",
    "supabase/functions/continuous-learning-engine/index.ts",
    "tests/coreRuntimeIntegration.test.mjs",
    "tests/incidentHealthContract.test.mjs",
    "tests/marketPublicationDelivery.test.mjs",
    "tests/productionReliability.test.mjs"
  ],
  "new_candidates": [
    "src/lib/performanceJournalProjection.ts",
    "src/lib/subscriberOpportunities.ts",
    "supabase/functions/_shared/canonical-market-state.ts",
    "supabase/functions/_shared/closing-learning-contract.ts",
    "supabase/functions/_shared/market-publication-contract.ts",
    "tests/closingLearningContract.test.mjs",
    "tests/consolidationMarketEvidence.test.mjs",
    "tests/consolidationMarketStateAdapter.test.mjs",
    "tests/consolidationSubscriberBoundary.test.mjs",
    "tests/consolidationSubscriberEligibility.test.mjs",
    "tests/consolidationSubscriberGraph.test.mjs",
    "tests/consolidationSubscriberLoaders.test.mjs",
    "tests/fixtures/consolidation-v1/captures/2026-09-07-fetch-persistence.json",
    "tests/fixtures/consolidation-v1/captures/2026-09-08-quality-projection.json",
    "tests/fixtures/consolidation-v1/captures/2026-09-09-premarket-quality.json",
    "tests/fixtures/consolidation-v1/clock.test.mjs",
    "tests/fixtures/consolidation-v1/index.mjs",
    "tests/fixtures/consolidation-v1/manifest.json",
    "tests/fixtures/consolidation-v1/offline.test.mjs",
    "tests/fixtures/consolidation-v1/provider-chain.test.mjs",
    "tests/fixtures/consolidation-v1/providers/synthetic-20260714.json",
    "tests/fixtures/consolidation-v1/scenarios/market-only-counterfactual.json",
    "tests/helpers/consolidationLocalScope.mjs",
    "tests/helpers/consolidationProviderReplay.mjs",
    "tests/helpers/consolidationVmClock.mjs",
    "tests/subscriberFrozenOpening.test.mjs"
  ]
};
const DECLARATIONS = [
  {
    "path": "supabase/functions/generate-daily-report-v7/index.ts",
    "name": "attachResearchMasterV2Shadow",
    "production_hash": "0cbfaf3f58ad40399b1082b0ff925e956a0afb7451478293e441c87a8d934123",
    "original_hash": "3d982bf3b493e8d05f4697093784a85eeca30dd2ba1d7d93f1a97820fcfcc904",
    "candidate_hash": "08247832599a3ac50a9529f81375e33f7f841c91386215245f75ec9c6a300b81"
  },
  {
    "path": "supabase/functions/daily-delivery-orchestrator/index.ts",
    "name": "checkpointResultOk",
    "production_hash": "d5aa72c5d0a6785b1bce8886e3bfff495b576099d8fe258e2fe5b244977d1465",
    "original_hash": "d5aa72c5d0a6785b1bce8886e3bfff495b576099d8fe258e2fe5b244977d1465",
    "candidate_hash": "9dd6e260883fcc8b9b72136dfa89db9c4670a4dd6ac7b3b28626cc7535464bcc"
  },
  {
    "path": "supabase/functions/get-report-payload/index.ts",
    "name": "buildClosingVerdict",
    "production_hash": "77c393f6db9ea14bbbfc5d2a4d5b712cd3af4912fd095accc874b883c27f108c",
    "original_hash": "103825987247c69b0c1a1eb645da27394f9d80c49ee830ce9685b881d600f927",
    "candidate_hash": "e69fcb80f9800ecb9fb77f3a636dcee9060d897f6db057dfad2deebd9a0e593e"
  },
  {
    "path": "supabase/functions/get-report-payload/index.ts",
    "name": "buildHistorySummary",
    "production_hash": "0a08c59517a74a16b5c746d9b41f6a2c7e826a60e2e85b5f78c4771e72205c4a",
    "original_hash": "d403ea7baa3574ed6c9493296eb55df02eff1d0b957502ced7e12d5fd49d5f70",
    "candidate_hash": "b80bd0d09b6d1693a404387a796009bf1a12647985f4b68507d89a709e2eff08"
  }
];
const POLICY_NAMES = [
  "OPENAI_EVIDENCE_GUARDRAILS",
  "OPENAI_OUTPUT_ABSTENTION_RULES",
  "V10_CANDIDATE_METADATA",
  "calculateRepeatPenalty",
  "calculateV10BeneficiaryPhase1Record",
  "buildV10MarketThesisAgentSystemPrompt",
  "buildV10MarketThesisAgentUserPrompt",
  "buildV10CandidateEvaluationAgentSystemPrompt",
  "buildV10CandidateEvaluationAgentUserPrompt",
  "buildOpenAISystemPrompt",
  "buildOpenAIUserPrompt"
];
const root = new URL('../../', import.meta.url);
const defaultRead = path => readFileSync(new URL(path, root));
const hash = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');
const declarationKey = row => row.path + ':' + row.name;

// Supports only the reviewed UTF-8 unified patch grammar, with no rename,
// executable commands, binary patches, filesystem writes or fuzzy application.
function reconstructPreimages(artifact, rows, source) {
  const patches = new Map();
  let active;
  for (const line of artifact.source_diff.patch_lines) {
    const header = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
    if (header) {
      assert.equal(header[1], header[2], 'fourth patch cannot rename files');
      assert.equal(patches.has(header[1]), false, 'fourth patch cannot duplicate files');
      active = []; patches.set(header[1], active);
    } else if (active) active.push(line);
    else assert.equal(line, '', 'fourth patch cannot contain unscoped bytes');
  }
  assert.deepEqual([...patches.keys()].sort(), rows.map(row => row.path).sort(), 'fourth patch exact file set');
  const restoredSources = new Map();
  for (const row of rows) {
    const patch = patches.get(row.path), isNew = row.original_hash === null;
    assert.equal(patch[0], isNew ? '--- /dev/null' : '--- a/' + row.path, 'fourth exact old patch path');
    assert.equal(patch[1], '+++ b/' + row.path, 'fourth exact new patch path');
    const bytes = source(row.path).toString('utf8');
    assert.equal(bytes.endsWith('\n'), row.candidate_ends_with_newline, 'fourth exact current newline');
    const current = bytes.endsWith('\n') ? bytes.slice(0, -1).split('\n') : bytes.split('\n');
    const restored = []; let cursor = 0, index = 2, hunkCount = 0;
    while (index < patch.length) {
      const line = patch[index++];
      if (line === '') continue;
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      assert.ok(match, 'fourth patch requires strict unified hunk: ' + row.path);
      hunkCount++;
      const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
      const oldStart = Number(match[1]) - (oldCount ? 1 : 0), newStart = Number(match[3]) - (newCount ? 1 : 0);
      const oldLines = [], newLines = [];
      while (index < patch.length && !patch[index].startsWith('@@ ') && patch[index] !== '') {
        const part = patch[index++];
        if (part === '\\ No newline at end of file') {
          assert.ok(oldLines.length || newLines.length, 'fourth newline control must follow content');
          continue;
        }
        assert.ok([' ', '+', '-'].includes(part[0]), 'fourth patch unsupported control line');
        if (part[0] !== '+') oldLines.push(part.slice(1));
        if (part[0] !== '-') newLines.push(part.slice(1));
      }
      assert.equal(oldLines.length, oldCount, 'fourth old hunk length');
      assert.equal(newLines.length, newCount, 'fourth new hunk length');
      assert.ok(newStart >= cursor && newStart <= current.length, 'fourth nonoverlapping bounded hunks');
      restored.push(...current.slice(cursor, newStart));
      assert.equal(restored.length, oldStart, 'fourth exact old hunk position');
      assert.deepEqual(current.slice(newStart, newStart + newCount), newLines, 'fourth exact new patch bytes: ' + row.path);
      restored.push(...oldLines); cursor = newStart + newCount;
    }
    assert.ok(hunkCount > 0, 'fourth reviewed patch cannot be empty');
    restored.push(...current.slice(cursor));
    const restoredBytes = Buffer.from(restored.join('\n') + (row.original_ends_with_newline ? '\n' : ''));
    if (isNew) assert.equal(restoredBytes.length, 0, 'fourth new file must reconstruct absence');
    else assert.equal(hash(restoredBytes), row.original_hash, 'fourth exact HEAD preimage: ' + row.path);
    restoredSources.set(row.path, isNew ? null : restoredBytes);
  }
  return restoredSources;
}

const parseDeclarations = (path, bytes) => {
  const file = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  return new Map(file.statements.flatMap(node => {
    const name = node.name?.getText(file) || node.declarationList?.declarations.map(item => item.name.getText(file)).join(',');
    return name ? [[name, node.getText(file)]] : [];
  }));
};

export function resolveConsolidationIntegrity(
  registry, artifactBytes, readSource = defaultRead,
  firstArtifactBytes = readSource(FIRST_ARTIFACT_PATH),
) {
  const { core_pipeline_consolidation_registration: section, ...previousRegistry } = registry;
  assert.ok(section, 'explicit fourth consolidation registration is required');
  assert.equal(section.approval_id, ID, 'fourth exact approval identity');
  assert.equal(section.previous_complete_registry_sha256, PREVIOUS, 'fourth immutable predecessor registry anchor');
  assert.equal(jsonHash(previousRegistry), PREVIOUS, 'complete third registry and original Production pins remain unchanged');
  assert.equal(section.previous_registration_id, 'SUBSCRIBER_PUBLIC_RELEASE_ASSERTION_APPEND_20260909', 'fourth exact predecessor identity');
  assert.equal(section.candidate_base_git_sha, BASE, 'fourth exact HEAD base');
  for (const field of ['production_operations_authorized', 'sql_authoring_authorized', 'sql_execution_authorized', 'merge_authorized', 'automatic_stability_day']) {
    assert.equal(section[field], false, 'fourth forbidden authority: ' + field);
  }
  assert.equal(section.fresh_validation_required, true, 'fourth cannot waive fresh validation');
  assert.ok(Number.isFinite(Date.parse(section.audit_recorded_at)), 'fourth audit recording time is required, not an invented owner message time');
  assert.ok(section.approval_provenance?.length > 100, 'fourth exact owner provenance required');
  for (const group of Object.keys(PATHS)) {
    assert.deepEqual(section[group].map(row => row.path).sort(), [...PATHS[group]].sort(), 'fourth exact allowlist: ' + group);
  }
  assert.deepEqual(section.declarations.map(declarationKey).sort(), DECLARATIONS.map(declarationKey).sort(), 'fourth exact declaration allowlist');
  for (const row of section.declarations) {
    const fixed = DECLARATIONS.find(item => declarationKey(item) === declarationKey(row));
    for (const field of ['production_hash', 'original_hash', 'candidate_hash']) assert.equal(row[field], fixed[field], 'fourth fixed declaration ' + field);
  }
  assert.deepEqual(section.source_diff_reference, { path: CONSOLIDATION_ARTIFACT_PATH, sha256: ARTIFACT, patch_sha256: PATCH }, 'fourth fixed artifact reference');
  assert.equal(jsonHash(section), SECTION, 'fourth independently fixed complete section');
  assert.equal(hash(artifactBytes), ARTIFACT, 'fourth independently fixed artifact bytes');
  const artifact = JSON.parse(artifactBytes);
  assert.equal(artifact.approval_id, ID);
  assert.equal(artifact.candidate_base_git_sha, BASE);
  assert.equal(artifact.previous_complete_registry_sha256, PREVIOUS);
  assert.equal(artifact.source_manifest_sha256, MANIFEST);
  assert.equal(artifact.original_guard_sha256, OLD_GUARD);
  assert.equal(artifact.approval_provenance, section.approval_provenance);
  for (const group of [...Object.keys(PATHS), 'declarations']) assert.deepEqual(artifact[group], section[group], 'fourth artifact/section exact rows: ' + group);
  assert.equal(hash(artifact.source_diff.patch_lines.join('\n')), PATCH, 'fourth independently fixed source patch');
  assert.equal(artifact.source_diff.sha256, PATCH);
  const rows = [...artifact.files, ...artifact.related_candidates, ...artifact.new_candidates];
  assert.equal(new Set(rows.map(row => row.path)).size, 64, 'fourth unique exact candidate count');
  assert.deepEqual([...artifact.source_diff.paths].sort(), rows.map(row => row.path).sort(), 'fourth exact source patch paths');
  const cache = new Map();
  const source = path => {
    if (!cache.has(path)) cache.set(path, Buffer.from(readSource(path)));
    return cache.get(path);
  };
  assert.equal(hash(source(OLD_GUARD_PATH)), OLD_GUARD, 'original three-layer guard bytes must remain unchanged');
  assert.equal(hash(source(MANIFEST_PATH)), MANIFEST, 'original Production source manifest remains unchanged');
  for (const row of rows) {
    assert.doesNotMatch(row.path, /(^|\/)(\.env|secrets?|credentials?)(\.|\/|$)|^supabase\/migrations\/| 2\.|^docs\/research\//i, 'fourth forbidden candidate scope');
    assert.ok(row.reason?.length > 15 && row.rollback_target?.length > 15, 'fourth reason and rollback required');
    assert.equal(row.approval_provenance, section.approval_provenance, 'fourth row provenance');
    const old = previousRegistry.files.find(item => item.path === row.path);
    if (old) assert.equal(row.production_hash, old.baseline_sha256, 'fourth original Production hash');
    else assert.equal(row.production_hash, undefined, 'fourth cannot invent a Production hash');
    assert.equal(hash(source(row.path)), row.candidate_hash, 'fourth current source drift: ' + row.path);
  }
  const preimages = reconstructPreimages(artifact, rows, source);
  const predecessorReadSource = path => {
    if (!preimages.has(path)) return source(path);
    assert.notEqual(preimages.get(path), null, 'new candidate did not exist in predecessor: ' + path);
    return preimages.get(path);
  };
  // Crucially execute every first/second/third check in its original implementation.
  const previous = resolveSubscriberProjectionIntegrity(previousRegistry, firstArtifactBytes, predecessorReadSource);
  const manifest = JSON.parse(source(MANIFEST_PATH));
  const currentParsed = new Map(), predecessorParsed = new Map();
  const declarationText = (path, name, predecessor = false) => {
    const parsed = predecessor ? predecessorParsed : currentParsed;
    if (!parsed.has(path)) parsed.set(path, parseDeclarations(path, predecessor ? predecessorReadSource(path) : source(path)));
    const value = parsed.get(path).get(name);
    assert.equal(typeof value, 'string', 'protected declaration missing: ' + path + ':' + name);
    return value;
  };
  for (const record of manifest.protected_declarations) {
    const amendment = previousRegistry.modified_declarations.find(row => declarationKey(row) === declarationKey(record));
    if (amendment) assert.equal(amendment.production_sha256, record.production_sha256, 'original Production declaration pin preserved');
    const original = amendment ? previous.declarationHash(amendment) : record.production_sha256;
    const changed = artifact.declarations.find(row => declarationKey(row) === declarationKey(record));
    assert.equal(hash(declarationText(record.path, record.name, true)), original, 'exact predecessor protected declaration: ' + declarationKey(record));
    if (changed) {
      assert.equal(changed.production_hash, record.production_sha256, 'fourth immutable declaration Production pin');
      assert.equal(changed.original_hash, original, 'fourth declaration exact predecessor');
      assert.equal(changed.predecessor_has_incident_amendment, Boolean(amendment), 'fourth no invented old amendment');
    }
    assert.equal(hash(declarationText(record.path, record.name)), changed?.candidate_hash ?? original, 'unapproved protected declaration drift: ' + declarationKey(record));
  }
  assert.deepEqual(artifact.unchanged_ai_policy_pins.map(row => row.name).sort(), [...POLICY_NAMES].sort(), 'fourth unchanged AI policy inventory');
  for (const row of artifact.unchanged_ai_policy_pins) {
    assert.equal(row.production_hash, row.predecessor_hash, 'AI policy predecessor unchanged');
    assert.equal(row.production_hash, row.candidate_hash, 'AI policy candidate unchanged');
    assert.equal(hash(declarationText(row.path, row.name)), row.production_hash, 'forbidden AI/evidence/strategy policy mutation: ' + row.name);
    assert.equal(artifact.declarations.some(changed => declarationKey(changed) === declarationKey(row)), false, 'AI policy cannot acquire fourth override');
  }
  const fileOverrides = new Map(artifact.files.map(row => [row.path, row.candidate_hash]));
  const declarationOverrides = new Map(artifact.declarations.map(row => [declarationKey(row), row.candidate_hash]));
  return {
    fileHash: row => fileOverrides.get(row.path) ?? previous.fileHash(row),
    declarationHash: row => declarationOverrides.get(declarationKey(row)) ?? (row.incident_sha256 ? previous.declarationHash(row) : row.production_sha256),
    predecessorRegistry: previousRegistry,
    predecessorReadSource,
    newCandidatePaths: Object.freeze([...PATHS.new_candidates]),
  };
}

export const readConsolidationIntegrity = registry => resolveConsolidationIntegrity(
  registry, defaultRead(CONSOLIDATION_ARTIFACT_PATH),
);
