import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { resolveConsolidationTestWiringIntegrity } from './consolidationTestWiringIntegrity.mjs';

// Seventh admits only the exact reviewed local SQL/history/replay source set.
// It reconstructs the immutable Sixth candidate and never grants Production,
// external Content OS contract, natural stability or complete release authority.
export const CONSOLIDATION_SQL_HISTORY_ARTIFACT_PATH =
  'docs/operations/evidence/core-consolidation-sql-history-20260909.json';
export const CONSOLIDATION_SQL_HISTORY_SEAL_STATUS = 'SEALED_REVIEWED_LOCAL_SOURCE_ONLY';
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const SIXTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-test-wiring-20260909.json';
const SIXTH_RAW_REGISTRY = '8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737';
const SIXTH_REGISTRY_JSON = '024b6c8e600be358ede2f9d443fdd558718450364d084cecedefff7ac89539b6';
const SIXTH_ARTIFACT = '69cf698d21fb306a002025d1edd04e4b1a825baf905698724e40f0cae8d52d96';
const PREDECESSOR_ANCHORS = [
  {
    "path": "tests/helpers/subscriberProjectionIntegrity.mjs",
    "sha256": "2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0"
  },
  {
    "path": "docs/operations/evidence/subscriber-projection-candidate-20260909.json",
    "sha256": "4dbb461f7350ee3f6c8b8923174e9b4ff97d54e3220b99f9dfa7b06cdc0ea63d"
  },
  {
    "path": "tests/helpers/consolidationIntegrity.mjs",
    "sha256": "0994de2d3326de77b1f9c3aa2bdae601758c3dc30fbcbef9197a69b6a7bdbe1a"
  },
  {
    "path": "docs/operations/evidence/core-consolidation-candidate-20260909.json",
    "sha256": "e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315"
  },
  {
    "path": "tests/helpers/consolidationDeliveryIntegrity.mjs",
    "sha256": "3770a8e3305933f5f42add561ac5b8cbd98273c036c15a49c6c44338c0a2e23c"
  },
  {
    "path": "docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json",
    "sha256": "861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056"
  },
  {
    "path": "tests/helpers/consolidationTestWiringIntegrity.mjs",
    "sha256": "f4d367c84bb6ad4267d4f07a41341c9421d6c36eec2c659cbc4f82825e049630"
  },
  {
    "path": "docs/operations/evidence/core-consolidation-test-wiring-20260909.json",
    "sha256": "69cf698d21fb306a002025d1edd04e4b1a825baf905698724e40f0cae8d52d96"
  },
  {
    "path": "docs/operations/core-stability-source-manifest-20260907.json",
    "sha256": "bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c"
  }
];
const PREDECESSOR_BODIES = [
  {
    "path": "tests/coreProductionPreservation.test.mjs",
    "marker": "test('",
    "sha256": "720575afcd4a4f329be5ea9e09387fab9b877f2579facad8c3867f23defb7722"
  },
  {
    "path": "tests/productContract.test.mjs",
    "marker": "test('",
    "sha256": "65bce943b50c380b546d99afb628edb0693b704fd9a2b50235018e35defb7ca7"
  },
  {
    "path": "tests/subscriberProjectionIntegrity.test.mjs",
    "marker": "const hash =",
    "sha256": "a0e57cb4abcbacf66cf71b3785d426a6ea51f541e69b98021f814b8e9fcca2d2"
  },
  {
    "path": "tests/consolidationIntegrity.test.mjs",
    "marker": "const hash =",
    "sha256": "a336572755e95da10e00add17ac4d62c0588cb9e615fc56f32c44813fb8f3f9a"
  },
  {
    "path": "tests/consolidationDeliveryIntegrity.test.mjs",
    "marker": "const hash =",
    "sha256": "7ae34c94c8069a49ac5f335dfb65aac772794f8581cfe0bf9a12a8338e797f4b"
  },
  {
    "path": "tests/consolidationTestWiringIntegrity.test.mjs",
    "marker": "const hash =",
    "sha256": "31e4d372af8c3ac9289623559bb18d76c048057d36ae78ed54dca9f171094e98"
  }
];
const root = new URL('../../', import.meta.url);
// Exact reviewed source-assertion successors, not a waiver for a whole test file.
// The six original Integrity/preservation bodies above are a separate immutable
// set. PublicRelease retains 48 of its 51 case bodies and only these three change.
const REVIEWED_TEST_SUCCESSORS = [
  { path: 'tests/publicRelease.test.mjs', name: 'paid report fails closed when evidence does not meet the member threshold',
    original_hash: '9847b0f8242bd8d6acb0329a9a54a2a151864c92b0bb75ea859ee938fd94deb0',
    candidate_hash: '06a9d5af39de8fc4742766cec41951a1453302c29c92df33514622dca965141d',
    original_assertions: 47, candidate_assertions: 48,
    diff_sha256: '5d297d25166678395cdfe7d33df35e19bb768b73f961010bc32f778f362bbb39' },
  { path: 'tests/publicRelease.test.mjs', name: 'home public decision copy is user-facing and internally consistent',
    original_hash: '1a8750f57f3c3fe95ef2020c65e6807e0f7c47fffa9513cda875087d76cbbf07',
    candidate_hash: 'a903a6a881240f7ec0882e2b3bb8491eb67bc31a8022580dde64e1bc18964ab8',
    original_assertions: 39, candidate_assertions: 41,
    diff_sha256: '85202f82422e4c5cd58031bd8d00828f77496a306e6d8aca505725b831946684' },
  { path: 'tests/publicRelease.test.mjs', name: 'performance excludes outcomes that have no verifiable closing direction',
    original_hash: 'da214e541d4e3d4ad7e4255f24f199bb43e1dd91e63df40fe9e2e05344f29b0d',
    candidate_hash: '4c44ed8f7bf78c9dbcfbf9c297bb6cf4bb83f819be7af25f5cea559b6372a031',
    original_assertions: 19, candidate_assertions: 20,
    diff_sha256: '381f4c2659025958e87d1d167d0f4d5cb5ed68b17d41a2363034770af19c24a0' },
];
const defaultRead = path => readFileSync(new URL(path, root));
const hash = value => createHash('sha256').update(value).digest('hex');

const FINAL_SEAL = Object.freeze({
  "artifact": "c14666fd23bd334da8a97e4c8f00ef686fe176d2733c9a1d80c76f39d0dcf2a5",
  "section": "b8976efda542fa7d4fd483d99091d2809b3d6761287d82c1768213f06ee3818b",
  "patch": "3592c9f18cbf132e264416879849a03df734f7b929d12acef83dc5907efc9283",
  "paths": {
    "files": [
      ".github/workflows/validate-release.yml",
      "src/pages/home/page.tsx",
      "src/pages/performance/page.tsx",
      "src/types/subscription.ts",
      "supabase/functions/get-report-payload/index.ts",
      "supabase/functions/_shared/market-publication-contract.ts",
      "supabase/functions/_shared/canonical-market-state.ts",
      "supabase/functions/_shared/closing-learning-contract.ts",
      "tests/closingLearningContract.test.mjs",
      "tests/marketPublicationPayload.test.mjs",
      "tests/publicRelease.test.mjs",
      "tests/coreRuntimeIntegration.test.mjs",
      "tests/consolidationSubscriberGraph.test.mjs",
      "tests/browser/consolidationSubscriberMatrix.e2e.mjs",
      "tests/marketPublicationDelivery.test.mjs",
      "tests/coreProductionPreservation.test.mjs",
      "tests/productContract.test.mjs",
      "tests/subscriberProjectionIntegrity.test.mjs",
      "tests/consolidationIntegrity.test.mjs",
      "tests/consolidationDeliveryIntegrity.test.mjs",
      "tests/consolidationTestWiringIntegrity.test.mjs",
      "supabase/functions/_shared/content-intelligence.ts",
      "supabase/functions/generate-daily-report-v7/index.ts",
      "supabase/functions/generate-daily-report-v7/research-master-v2.ts",
      "tests/consolidationPublicationConsumers.test.mjs",
      "tests/consolidationLineProjection.test.mjs"
    ],
    "new_candidates": [
      "supabase/migrations/20260909015650_core_market_publication_contract.sql",
      "tests/coreConsolidationDatabase.integration.mjs",
      "tests/consolidationCanonicalEvidence.test.mjs",
      "tests/consolidationPerformanceHistory.test.mjs",
      "tests/helpers/consolidationHistoryBrowserReplay.mjs",
      "tests/coreConsolidationReplayPreparation.test.mjs",
      "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260915.json",
      "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260916.json",
      "tests/helpers/coreConsolidationBoundaryPrelude.mjs",
      "tests/helpers/coreConsolidationBoundaryProxy.mjs",
      "tests/helpers/coreConsolidationBoundaryServer.mjs",
      "tests/helpers/coreConsolidationReplayRuntime.mjs",
      "tests/helpers/coreConsolidationVendorShapes.mjs",
      "tests/helpers/coreConsolidationContinuation.mjs",
      "tests/coreConsolidationContinuation.test.mjs",
      "tests/integration/coreConsolidationFullChain.e2e.mjs",
      "tests/integration/coreConsolidationPrepareLocal.mjs",
      "tests/integration/coreConsolidationFullChain.README.md",
      "tests/consolidationCurrentPayloadAuthority.test.mjs",
      "tests/consolidationCanonicalEditorial.test.mjs",
      "tests/consolidationFrozenEditorial.test.mjs",
      "tests/consolidationGeneratorEditorial.test.mjs",
      "tests/coreConsolidationPremarketContinuation.test.mjs",
      "tests/helpers/coreConsolidationPremarketContinuation.mjs",
      "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260916-news-v3.json",
      "tests/fixtures/consolidation-v1/providers/premarket-news-failure-continuation002.json",
      "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260917.json",
      "tests/helpers/coreConsolidationFreshManualContinuation.mjs",
      "tests/coreConsolidationFreshManualContinuation.test.mjs",
      "tests/fixtures/consolidation-v1/providers/fresh-manual-correlation-failure.json",
      "tests/fixtures/consolidation-v1/local-failures/index.json",
      "tests/fixtures/consolidation-v1/local-failures/terminal-market-only-20260917.json",
      "tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260921.json",
      "tests/fixtures/consolidation-v1/local-runs/full-chain-market-only-20260921.json"
    ]
  },
  "declarations": [
    {
      "path": "supabase/functions/get-report-payload/index.ts",
      "name": "PayloadContext",
      "production_hash": "dc054f79a4d764f5d6287b549f6577229773d196f4e02bb47944bae5e4ffb458",
      "original_hash": "e90edcf50eb2533149c97488d4451a3815d9bb244034eebcce4c3fd45d089eea",
      "candidate_hash": "68d4b8033da4b9bcd0ccf01000276cdd01205690415bcb228154037d207dcd81"
    },
    {
      "path": "supabase/functions/get-report-payload/index.ts",
      "name": "buildAuthoritativeClosingVerification",
      "production_hash": "79840de58d9f411c4d971a7d77916b36c3da2317f51c02189017d4ba166e4fe2",
      "original_hash": "fe80561aa10ae5a4f0d968031e1700aa84eb09e4827c11762e9e8e9a043e991a",
      "candidate_hash": "4a8643fd73cef4081b00c6aa7ae7b310f8b18bb9d785089a3093a5675bb221d2"
    },
    {
      "path": "supabase/functions/get-report-payload/index.ts",
      "name": "getEffectiveAi",
      "production_hash": "943f14845145fb29179e2ed116dbdf2744ce00c6dfb01bbfc55e204d8c29fbdb",
      "original_hash": "b8a16d1972c292da3155232b61450429a27161f2394adc04d3811e8dcdea9cbd",
      "candidate_hash": "953ab55812eef06c9f7eb29fc5b260783ce7037a69b74e5aec2d130b5da4d3de"
    },
    {
      "path": "supabase/functions/get-report-payload/index.ts",
      "name": "buildHistorySummary",
      "production_hash": "0a08c59517a74a16b5c746d9b41f6a2c7e826a60e2e85b5f78c4771e72205c4a",
      "original_hash": "b80bd0d09b6d1693a404387a796009bf1a12647985f4b68507d89a709e2eff08",
      "candidate_hash": "0cec805eb4287e8819d47e9f4bfad436ce1aea8e54a84a5b6caa14de0f88d07d"
    },
    {
      "path": "supabase/functions/get-report-payload/index.ts",
      "name": "fetchPayloadContext",
      "production_hash": "eb6db68bc2f68c30c19714e6f60cd859a44c12a4d75f094c7bf7240c66413932",
      "original_hash": "d3af6d57690c501526cb5c3a6b6947fdbf48325eb3d991ab13f4cc7487eb1eaf",
      "candidate_hash": "e0d38780d181e69830238f304c0b3cbb859e417074c2682d96621962e8a3acdb"
    }
  ]
});
const SECTION_KEY = 'core_sql_history_replay_registration';
const APPROVAL_ID = 'CORE_SQL_HISTORY_REPLAY_APPEND_20260909';
const BASE = '6469630795fb1215595306c026437d850b668801';
const MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';
const FALSE_AUTHORITIES = [
  'production_operations_authorized', 'production_sql_execution_authorized',
  'deploy_authorized', 'merge_authorized', 'cron_changes_authorized',
  'automatic_stability_day', 'historical_success_claim',
];
const exactSet = (actual, expected, label) => {
  assert.ok(Array.isArray(actual), label);
  assert.equal(new Set(actual).size, actual.length, label + ' rejects duplicates');
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
};
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');

function restoreSeventhPreimages(artifact, rows, source) {
  const patches = new Map(); let active;
  for (const line of artifact.source_diff.patch_lines) {
    const header = line.match(/^diff --git a\/(\S+) b\/(\S+)$/);
    if (header) {
      assert.equal(header[1], header[2], 'seventh patch cannot rename files');
      assert.equal(patches.has(header[1]), false, 'seventh patch cannot duplicate files');
      active = []; patches.set(header[1], active);
    } else if (active) active.push(line);
    else assert.equal(line, '', 'seventh patch cannot contain unscoped bytes');
  }
  exactSet([...patches.keys()], rows.map(row => row.path), 'seventh exact patch file set');
  const restoredSources = new Map();
  for (const row of rows) {
    const patch = patches.get(row.path), isNew = row.original_hash === null;
    assert.equal(patch[0], isNew ? '--- /dev/null' : '--- a/' + row.path, 'seventh exact old patch path');
    assert.equal(patch[1], '+++ b/' + row.path, 'seventh exact new patch path');
    const bytes = source(row.path).toString('utf8');
    assert.equal(bytes.endsWith('\n'), row.candidate_ends_with_newline, 'seventh current newline');
    assert.equal(typeof row.original_ends_with_newline, 'boolean', 'seventh original newline declared');
    const current = bytes.endsWith('\n') ? bytes.slice(0, -1).split('\n') : bytes ? bytes.split('\n') : [];
    const restored = []; let cursor = 0, index = 2, hunks = 0;
    while (index < patch.length) {
      const line = patch[index++]; if (line === '') continue;
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/);
      assert.ok(match, 'seventh strict unified hunk: ' + row.path); hunks++;
      const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
      const oldStart = Number(match[1]) - (oldCount ? 1 : 0);
      const newStart = Number(match[3]) - (newCount ? 1 : 0);
      const oldLines = [], newLines = [];
      while (index < patch.length && !patch[index].startsWith('@@ ') && patch[index] !== '') {
        const part = patch[index++];
        if (part === '\\ No newline at end of file') {
          assert.ok(oldLines.length || newLines.length, 'seventh newline control follows content'); continue;
        }
        assert.ok([' ', '+', '-'].includes(part[0]), 'seventh unsupported patch control');
        if (part[0] !== '+') oldLines.push(part.slice(1));
        if (part[0] !== '-') newLines.push(part.slice(1));
      }
      assert.equal(oldLines.length, oldCount, 'seventh old hunk length');
      assert.equal(newLines.length, newCount, 'seventh new hunk length');
      assert.ok(newStart >= cursor && newStart <= current.length, 'seventh bounded non-overlapping hunks');
      restored.push(...current.slice(cursor, newStart));
      assert.equal(restored.length, oldStart, 'seventh exact old hunk position');
      assert.deepEqual(current.slice(newStart, newStart + newCount), newLines, 'seventh exact current patch bytes');
      restored.push(...oldLines); cursor = newStart + newCount;
    }
    assert.ok(hunks > 0, 'seventh reviewed patch cannot be empty');
    restored.push(...current.slice(cursor));
    const old = Buffer.from(restored.join('\n') + (row.original_ends_with_newline ? '\n' : ''));
    if (isNew) assert.equal(old.length, 0, 'seventh new file must reconstruct absence');
    else assert.equal(hash(old), row.original_hash, 'seventh exact Sixth source preimage: ' + row.path);
    restoredSources.set(row.path, isNew ? null : old);
  }
  return restoredSources;
}

function namedDeclarations(path, bytes) {
  const file = ts.createSourceFile(path, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  const result = new Map();
  for (const node of file.statements) {
    const name = node.name?.getText(file)
      || node.declarationList?.declarations.map(declaration => declaration.name.getText(file)).join(',');
    if (!name) continue;
    assert.equal(result.has(name), false, 'seventh duplicate declaration: ' + path + ':' + name);
    result.set(name, node.getText(file));
  }
  return result;
}

function sourceTestCases(path, bytes) {
  const file = ts.createSourceFile(path, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  const cases = new Map();
  for (const node of file.statements) {
    const call = node.expression;
    if (!call || !ts.isCallExpression(call) || call.expression.getText(file) !== 'test') continue;
    assert.ok(ts.isStringLiteral(call.arguments[0]), 'seventh literal reviewed test name required');
    const name = call.arguments[0].text;
    assert.equal(cases.has(name), false, 'seventh duplicate reviewed test name');
    cases.set(name, node.getText(file));
  }
  return cases;
}

// Deterministic minimal line replacement, retaining exact removed/added bytes.
function sourceTestCaseDiff(before, after) {
  const oldLines = before.split('\n'), newLines = after.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix++;
  return { prefix_lines: prefix, suffix_lines: suffix,
    removed: oldLines.slice(prefix, oldLines.length - suffix), added: newLines.slice(prefix, newLines.length - suffix) };
}

function verifyReviewedTestSuccessors(declared, source, predecessorSource) {
  assert.deepEqual(declared, REVIEWED_TEST_SUCCESSORS, 'seventh exact reviewed test successor metadata');
  const path = 'tests/publicRelease.test.mjs';
  const before = sourceTestCases(path, predecessorSource(path)), after = sourceTestCases(path, source(path));
  assert.equal(before.size, 51, 'seventh exact predecessor public release case count');
  assert.deepEqual([...after.keys()], [...before.keys()], 'seventh original public release names/order unchanged');
  let changed = 0, unchanged = 0;
  for (const [name, previous] of before) {
    const current = after.get(name), approved = REVIEWED_TEST_SUCCESSORS.find(row => row.path === path && row.name === name);
    if (!approved) {
      assert.equal(current, previous, 'seventh unrelated public release case unchanged: ' + name);
      unchanged++; continue;
    }
    assert.equal(hash(previous), approved.original_hash, 'seventh exact original reviewed test body: ' + name);
    assert.equal(hash(current), approved.candidate_hash, 'seventh exact candidate reviewed test body: ' + name);
    assert.notEqual(current, previous, 'seventh reviewed test successor must be present');
    assert.equal((previous.match(/assert\./g) || []).length, approved.original_assertions, 'seventh exact original test assertions');
    assert.equal((current.match(/assert\./g) || []).length, approved.candidate_assertions, 'seventh exact successor test assertions');
    assert.ok(approved.candidate_assertions >= approved.original_assertions, 'seventh cannot reduce reviewed test assertions');
    assert.equal(hash(JSON.stringify(sourceTestCaseDiff(previous, current))), approved.diff_sha256,
      'seventh exact reviewed test diff');
    changed++;
  }
  assert.equal(changed, 3, 'seventh exactly three reviewed public release successors');
  assert.equal(unchanged, 48, 'seventh retains all other 48 public release case bodies');
  return { changed, unchanged };
}

// Private generic verifier. A seal is supplied only by the reviewed source
// constant above; no exported consumer accepts caller-provided approval pins.
// Independent tests exercise this function in an isolated VM with synthetic
// candidate bytes and the real, unchanged predecessor resolver.
function verifySealedConsolidationSqlHistory(seal, registry, artifactBytes, readSource, sixthArtifactBytes) {
  assert.ok(seal && Object.isFrozen(seal), 'seventh seal must be an immutable reviewed source constant');
  const { [SECTION_KEY]: section, ...sixthRegistry } = registry;
  assert.ok(section, 'explicit seventh registration is required');
  assert.equal(section.approval_id, APPROVAL_ID, 'seventh exact approval identity');
  assert.equal(section.previous_complete_registry_sha256, SIXTH_RAW_REGISTRY, 'seventh raw Sixth anchor');
  assert.equal(section.previous_registration_id, 'CORE_DELIVERY_TEST_WIRING_APPEND_20260909', 'seventh predecessor identity');
  assert.equal(section.candidate_base_git_sha, BASE, 'seventh exact Git base');
  assert.equal(jsonHash(sixthRegistry), SIXTH_REGISTRY_JSON, 'seventh complete Sixth object and Production pins unchanged');
  for (const field of FALSE_AUTHORITIES) assert.equal(section[field], false, 'seventh forbidden authority: ' + field);
  for (const field of ['local_sql_authoring_authorized', 'isolated_sql_execution_authorized', 'fresh_validation_required']) {
    assert.equal(section[field], true, 'seventh exact named local authority: ' + field);
  }
  assert.ok(typeof section.approval_provenance === 'string' && section.approval_provenance.length > 100,
    'seventh explicit approval provenance required');
  exactSet(section.files?.map(row => row.path), seal.paths.files, 'seventh exact existing source paths');
  exactSet(section.new_candidates?.map(row => row.path), seal.paths.new_candidates, 'seventh exact new source paths');
  const rows = [...section.files, ...section.new_candidates];
  exactSet(rows.map(row => row.path), [...seal.paths.files, ...seal.paths.new_candidates], 'seventh unique complete source scope');
  exactSet(section.declarations?.map(row => row.path + ':' + row.name),
    seal.declarations.map(row => row.path + ':' + row.name), 'seventh exact protected declaration set');
  assert.deepEqual(section.test_case_successors, REVIEWED_TEST_SUCCESSORS, 'seventh exact reviewed test successor metadata');
  assert.deepEqual(section.source_diff_reference, {
    path: CONSOLIDATION_SQL_HISTORY_ARTIFACT_PATH, sha256: seal.artifact, patch_sha256: seal.patch,
  }, 'seventh fixed artifact reference');
  assert.equal(jsonHash(section), seal.section, 'seventh independently fixed complete section');
  assert.equal(hash(artifactBytes), seal.artifact, 'seventh independently fixed artifact bytes');
  assert.equal(hash(sixthArtifactBytes), SIXTH_ARTIFACT, 'seventh immutable Sixth artifact input');
  const artifact = JSON.parse(artifactBytes);
  for (const field of ['approval_id', 'previous_complete_registry_sha256', 'previous_registration_id',
    'candidate_base_git_sha', 'approval_provenance', 'files', 'new_candidates', 'declarations', 'test_case_successors']) {
    assert.deepEqual(artifact[field], section[field], 'seventh artifact/section exact ' + field);
  }
  assert.equal(hash(artifact.source_diff.patch_lines.join('\n')), seal.patch, 'seventh fixed source patch');
  assert.equal(artifact.source_diff.sha256, seal.patch, 'seventh patch digest declaration');
  exactSet(artifact.source_diff.paths, rows.map(row => row.path), 'seventh patch scope');
  const cache = new Map();
  const source = path => {
    if (!cache.has(path)) cache.set(path, Buffer.from(readSource(path)));
    return cache.get(path);
  };
  const rawRegistry = source(REGISTRY_PATH).toString('utf8');
  assert.deepEqual(JSON.parse(rawRegistry), registry, 'seventh supplied and actual registry agree');
  const suffix = ',\n  "' + SECTION_KEY + '": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(rawRegistry.endsWith(suffix), 'seventh exact append-only registry bytes');
  const rawSixth = Buffer.from(rawRegistry.slice(0, -suffix.length) + '}\n');
  assert.equal(hash(rawSixth), SIXTH_RAW_REGISTRY, 'seventh exact raw Sixth registry preimage');
  assert.deepEqual(JSON.parse(rawSixth), sixthRegistry, 'seventh raw and parsed Sixth agree');
  for (const row of PREDECESSOR_ANCHORS) {
    assert.equal(hash(source(row.path)), row.sha256, 'seventh immutable prior guard/artifact: ' + row.path);
  }
  for (const row of rows) {
    assert.match(row.path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/, 'seventh safe exact source path');
    assert.ok(!row.path.split('/').includes('..') && !row.path.includes(' 2.'), 'seventh excluded path');
    assert.ok(row.reason?.length > 15 && row.rollback_target?.length > 15, 'seventh reason/rollback required');
    assert.equal(row.approval_provenance, section.approval_provenance, 'seventh row provenance');
    const original = sixthRegistry.files.find(item => item.path === row.path);
    assert.equal(row.production_hash, original?.baseline_sha256, 'seventh original Production hash unchanged');
    if (section.new_candidates.includes(row)) assert.equal(row.original_hash, null, 'seventh new candidate has no predecessor');
    else assert.match(row.original_hash, /^[a-f0-9]{64}$/, 'seventh existing candidate has exact predecessor');
    assert.equal(hash(source(row.path)), row.candidate_hash, 'seventh current source drift: ' + row.path);
  }
  const preimages = restoreSeventhPreimages(artifact, rows, source);
  const sixthReadSource = path => {
    if (path === REGISTRY_PATH) return rawSixth;
    if (!preimages.has(path)) return source(path);
    const bytes = preimages.get(path);
    if (bytes !== null) return bytes;
    throw Object.assign(new Error('Seventh-new source absent from Sixth: ' + path), { code: 'ENOENT' });
  };
  const sixth = resolveConsolidationTestWiringIntegrity(sixthRegistry, sixthArtifactBytes, sixthReadSource);
  for (const row of PREDECESSOR_BODIES) {
    for (const bytes of [source(row.path), sixthReadSource(row.path)]) {
      const text = bytes.toString('utf8'), offset = text.indexOf(row.marker);
      assert.ok(offset >= 0, 'seventh original assertion marker required: ' + row.path);
      assert.equal(hash(text.slice(offset)), row.sha256, 'seventh immutable original assertion body: ' + row.path);
    }
  }
  const testSuccessors = verifyReviewedTestSuccessors(section.test_case_successors, source, sixthReadSource);
  const manifest = JSON.parse(source(MANIFEST_PATH));
  assert.equal(manifest.protected_declarations.length, 698, 'seventh all 698 protected declarations remain in scope');
  const currentDeclarations = new Map(), priorDeclarations = new Map(), changed = [];
  const declarationOverrides = new Map();
  for (const record of manifest.protected_declarations) {
    if (!currentDeclarations.has(record.path)) currentDeclarations.set(record.path, namedDeclarations(record.path, source(record.path)));
    if (!priorDeclarations.has(record.path)) priorDeclarations.set(record.path, namedDeclarations(record.path, sixthReadSource(record.path)));
    const current = currentDeclarations.get(record.path).get(record.name);
    const previous = priorDeclarations.get(record.path).get(record.name);
    assert.equal(typeof current, 'string', 'seventh protected declaration missing: ' + record.name);
    assert.equal(typeof previous, 'string', 'seventh predecessor declaration missing: ' + record.name);
    const amendment = sixthRegistry.modified_declarations.find(row => row.path === record.path && row.name === record.name);
    assert.equal(hash(previous), sixth.declarationHash(amendment || record), 'seventh exact predecessor declaration');
    const approved = seal.declarations.find(row => row.path === record.path && row.name === record.name);
    const declared = section.declarations.find(row => row.path === record.path && row.name === record.name);
    if (!approved) {
      assert.equal(hash(current), hash(previous), 'seventh unreviewed protected declaration drift: ' + record.path + ':' + record.name);
      continue;
    }
    assert.ok(declared, 'seventh approved declaration metadata required');
    for (const key of ['path', 'name', 'production_hash', 'original_hash', 'candidate_hash']) {
      assert.equal(declared[key], approved[key], 'seventh exact declaration ' + key);
    }
    assert.equal(declared.production_hash, record.production_sha256, 'seventh immutable Production declaration');
    assert.equal(declared.original_hash, hash(previous), 'seventh actual declaration preimage');
    assert.equal(declared.candidate_hash, hash(current), 'seventh current declaration drift');
    assert.notEqual(hash(current), hash(previous), 'seventh no unnecessary declaration waiver');
    assert.ok(declared.reason?.length > 15 && declared.rollback_target?.length > 15, 'seventh declaration reason/rollback');
    assert.equal(declared.approval_provenance, section.approval_provenance, 'seventh declaration provenance');
    changed.push(record.path + ':' + record.name);
    declarationOverrides.set(record.path + ':' + record.name, declared.candidate_hash);
  }
  exactSet(changed, seal.declarations.map(row => row.path + ':' + row.name), 'seventh exact actual declaration changes');
  const fileOverrides = new Map(rows.map(row => [row.path, row.candidate_hash]));
  return {
    ...sixth,
    fileHash: row => fileOverrides.get(row.path) ?? sixth.fileHash(row),
    declarationHash: row => declarationOverrides.get(row.path + ':' + row.name) ?? sixth.declarationHash(row),
    newCandidatePaths: [...new Set([...sixth.newCandidatePaths, ...section.new_candidates.map(row => row.path)])],
    sixthRegistry, sixthReadSource,
    protectedDeclarationCount: 698, changedProtectedDeclarationCount: changed.length,
    reviewedTestSuccessorCount: testSuccessors.changed, unchangedPublicReleaseCaseCount: testSuccessors.unchanged,
  };
}

// This read-only check establishes only that the earlier evidence and assertions
// remain present. It is not a source-integrity approval for any Seventh candidate.
export function assertConsolidationSqlHistoryPredecessor(
  registry, readSource = defaultRead, sixthArtifactBytes = readSource(SIXTH_ARTIFACT_PATH),
) {
  assert.equal(hash(JSON.stringify(registry, null, 2) + '\n'), SIXTH_REGISTRY_JSON,
    'seventh unsealed predecessor registry and Production pins must remain unchanged');
  assert.equal(hash(readSource(REGISTRY_PATH)), SIXTH_RAW_REGISTRY,
    'seventh exact raw Sixth registry remains unchanged');
  assert.equal(hash(sixthArtifactBytes), SIXTH_ARTIFACT,
    'seventh immutable Sixth artifact input');
  for (const row of PREDECESSOR_ANCHORS) {
    assert.equal(hash(readSource(row.path)), row.sha256,
      'seventh immutable prior guard/artifact: ' + row.path);
  }
  for (const row of PREDECESSOR_BODIES) {
    const source = readSource(row.path).toString('utf8');
    const offset = source.indexOf(row.marker);
    assert.ok(offset >= 0, 'seventh original assertion marker required: ' + row.path);
    assert.equal(hash(source.slice(offset)), row.sha256,
      'seventh original assertion body remains byte-identical: ' + row.path);
  }
}

/**
 * Reconstruct exact Sixth bytes from the independently pinned reviewed patch,
 * invoke the unchanged Sixth resolver, and preserve every inherited alias.
 * The reviewed local-source seal is fixed in this module, not supplied by callers.
 * Source admission is not a Production, external-contract or global READY claim.
 * Missing evidence, source drift and caller-provided approval hashes fail closed.
 */
export function resolveConsolidationSqlHistoryIntegrity(
  registry, artifactBytes, readSource = defaultRead,
  sixthArtifactBytes = readSource(SIXTH_ARTIFACT_PATH),
) {
  if (FINAL_SEAL === null) {
    assertConsolidationSqlHistoryPredecessor(registry, readSource, sixthArtifactBytes);
    const error = new Error('SEVENTH_FINAL_SOURCE_FREEZE_REQUIRED');
    error.code = 'SEVENTH_FINAL_SOURCE_FREEZE_REQUIRED';
    throw error;
  }
  return verifySealedConsolidationSqlHistory(FINAL_SEAL, registry, artifactBytes, readSource, sixthArtifactBytes);
}

export const readConsolidationSqlHistoryIntegrity = registry =>
  resolveConsolidationSqlHistoryIntegrity(registry,
    FINAL_SEAL === null ? undefined : defaultRead(CONSOLIDATION_SQL_HISTORY_ARTIFACT_PATH));
