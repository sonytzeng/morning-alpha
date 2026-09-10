import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync as readActualFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import { resolveConsolidationTestWiringIntegrity } from './helpers/consolidationTestWiringIntegrity.mjs';
import {
  CONSOLIDATION_SQL_HISTORY_SEAL_STATUS as ACTUAL_SEAL_STATUS,
  resolveConsolidationSqlHistoryIntegrity as resolveOriginalSealedIntegrity,
} from './helpers/consolidationSqlHistoryIntegrity.mjs';
import { readConsolidationPublicExportIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';

// The complete live Eighth guard must pass before replaying the unmodified
// historical Seventh assertions against its exact reconstructed source state.
// Current-candidate tamper cases live in consolidationPublicExportIntegrity.
// No test assertion, fixed historical pin, or original guard is rewritten.
const currentRoot = fileURLToPath(new URL('../', import.meta.url));
const currentIntegrity = readConsolidationPublicExportIntegrity(JSON.parse(readActualFileSync(
  new URL('../docs/operations/core-stability-incident-amendment-20260908.json', import.meta.url))));
const readFileSync = (path, encoding) => {
  const name = path instanceof URL ? fileURLToPath(path) : path;
  const relative = name.startsWith(currentRoot) ? name.slice(currentRoot.length) : name;
  const bytes = currentIntegrity.seventhReadSource(relative);
  return encoding ? bytes.toString(encoding) : bytes;
};
const resolveSealedIntegrity = (registry, artifact, readSource = currentIntegrity.seventhReadSource,
  sixthArtifact = readSource('docs/operations/evidence/core-consolidation-test-wiring-20260909.json')) =>
  resolveOriginalSealedIntegrity(registry, artifact, readSource, sixthArtifact);
const readSealedIntegrity = registry => resolveSealedIntegrity(registry,
  currentIntegrity.seventhReadSource('docs/operations/evidence/core-consolidation-sql-history-20260909.json'));

// The original 100 preparation controls execute the exact pinned unsealed
// implementation and reconstructed Sixth registry. The appended tests exercise
// the actual sealed reader; neither lane invents a current-candidate approval.
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const SIXTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-test-wiring-20260909.json';
const SEVENTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-sql-history-20260909.json';
const actualReadSource = path => readFileSync(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const actualRegistry = JSON.parse(actualReadSource(REGISTRY_PATH));
const actualArtifactBytes = actualReadSource(SEVENTH_ARTIFACT_PATH);
const actualArtifact = JSON.parse(actualArtifactBytes);
const sealedBaseline = readSealedIntegrity(actualRegistry);
const readSource = path => path === REGISTRY_PATH
  ? sealedBaseline.sixthReadSource(path) : actualReadSource(path);
const registry = sealedBaseline.sixthRegistry;
const sixthArtifact = readSource(SIXTH_ARTIFACT_PATH);
const unsealedHelperSource = actualArtifact.verification_preparation.source_lines.join('\n') + '\n';
assert.equal(hash(unsealedHelperSource), '670637d554809f2a4baa19c2d60eb361af8637c8c6f5657cb58966fcc06b0297');
const unsealedFactory = runInThisContext('(function(assert,createHash,readFileSync,ts,resolveConsolidationTestWiringIntegrity,readSixthState){'
  + unsealedHelperSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('./helpers/consolidationSqlHistoryIntegrity.mjs', import.meta.url).href))
    .replace('const defaultRead = path => readFileSync(new URL(path, root));',
      'const defaultRead = path => readSixthState(path);')
  + '\nreturn {CONSOLIDATION_SQL_HISTORY_SEAL_STATUS,assertConsolidationSqlHistoryPredecessor,readConsolidationSqlHistoryIntegrity,resolveConsolidationSqlHistoryIntegrity};})');
const {
  CONSOLIDATION_SQL_HISTORY_SEAL_STATUS,
  assertConsolidationSqlHistoryPredecessor,
  readConsolidationSqlHistoryIntegrity,
  resolveConsolidationSqlHistoryIntegrity,
} = unsealedFactory(assert, createHash, readFileSync, ts, resolveConsolidationTestWiringIntegrity, readSource);
const anchors = [
  [
    "tests/helpers/subscriberProjectionIntegrity.mjs",
    "2197b2078ca4884794616ec6e9a653100e5f87a96cddb5c1fb805ed11ce1a8b0"
  ],
  [
    "docs/operations/evidence/subscriber-projection-candidate-20260909.json",
    "4dbb461f7350ee3f6c8b8923174e9b4ff97d54e3220b99f9dfa7b06cdc0ea63d"
  ],
  [
    "tests/helpers/consolidationIntegrity.mjs",
    "0994de2d3326de77b1f9c3aa2bdae601758c3dc30fbcbef9197a69b6a7bdbe1a"
  ],
  [
    "docs/operations/evidence/core-consolidation-candidate-20260909.json",
    "e9a2e1e837ed28f511b19837ab5a0b652f6a920b06c5f7b748787d7c1e5e7315"
  ],
  [
    "tests/helpers/consolidationDeliveryIntegrity.mjs",
    "3770a8e3305933f5f42add561ac5b8cbd98273c036c15a49c6c44338c0a2e23c"
  ],
  [
    "docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json",
    "861744fb3dfc0110902d8997f0e3569624515eed5b5fdb21611f4077f377c056"
  ],
  [
    "tests/helpers/consolidationTestWiringIntegrity.mjs",
    "f4d367c84bb6ad4267d4f07a41341c9421d6c36eec2c659cbc4f82825e049630"
  ],
  [
    "docs/operations/evidence/core-consolidation-test-wiring-20260909.json",
    "69cf698d21fb306a002025d1edd04e4b1a825baf905698724e40f0cae8d52d96"
  ],
  [
    "docs/operations/core-stability-source-manifest-20260907.json",
    "bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c"
  ]
];
const bodies = [
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
const sourceWith = (path, bytes) => target => target === path ? bytes : readSource(target);

test('Seventh skeleton preserves exact raw and normalized Sixth registry', () => {
  assert.equal(hash(readSource(REGISTRY_PATH)), '8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737');
  assert.equal(hash(JSON.stringify(registry, null, 2) + '\n'), '024b6c8e600be358ede2f9d443fdd558718450364d084cecedefff7ac89539b6');
  assert.doesNotThrow(() => assertConsolidationSqlHistoryPredecessor(registry));
});

for (const [path, expected] of anchors) {
  test('Seventh does not waive predecessor anchor: ' + path, () => {
    assert.equal(hash(readSource(path)), expected);
    const changed = Buffer.concat([readSource(path), Buffer.from('\n// unreviewed predecessor change\n')]);
    assert.throws(() => assertConsolidationSqlHistoryPredecessor(registry, sourceWith(path, changed)),
      /immutable prior guard\/artifact|immutable Sixth artifact/);
  });
}

for (const row of bodies) {
  test('Seventh header wiring preserves complete original body: ' + row.path, () => {
    const source = readSource(row.path).toString();
    assert.ok(source.includes(row.marker));
    assert.equal(hash(source.slice(source.indexOf(row.marker))), row.sha256);
    assert.throws(() => assertConsolidationSqlHistoryPredecessor(registry,
      sourceWith(row.path, Buffer.from(source + '\n// changed original assertion body\n'))),
    /original assertion body remains byte-identical/);
  });
}

test('Seventh unsealed reader and resolver never authorize current candidates', () => {
  assert.equal(CONSOLIDATION_SQL_HISTORY_SEAL_STATUS, 'AWAITING_FINAL_SOURCE_FREEZE');
  assert.throws(() => readConsolidationSqlHistoryIntegrity(registry),
    { code: 'SEVENTH_FINAL_SOURCE_FREEZE_REQUIRED' });
  assert.throws(() => resolveConsolidationSqlHistoryIntegrity(registry, Buffer.from('{}'), readSource, sixthArtifact),
    { code: 'SEVENTH_FINAL_SOURCE_FREEZE_REQUIRED' });
});

test('Seventh caller-provided PASS and mutable new hash cannot seal an artifact', () => {
  for (const artifact of [
    { status: 'PASS', full_chain_pass: true },
    { candidate_hash: '0'.repeat(64), source_diff: { sha256: '0'.repeat(64), patch_lines: [] } },
    { production_operations_authorized: true, sql_execution_authorized: true, merge_authorized: true },
  ]) {
    assert.throws(() => resolveConsolidationSqlHistoryIntegrity(
      registry, Buffer.from(JSON.stringify(artifact)), readSource, sixthArtifact),
    { code: 'SEVENTH_FINAL_SOURCE_FREEZE_REQUIRED' });
  }
});

test('Seventh cannot append a self-authorized registration before final review', () => {
  const changed = structuredClone(registry);
  changed.core_sql_history_replay_registration = {
    status: 'PASS', files: [], new_candidates: [], production_operations_authorized: true,
  };
  assert.throws(() => resolveConsolidationSqlHistoryIntegrity(changed, Buffer.from('{}')),
    /predecessor registry and Production pins must remain unchanged/);
});

test('Seventh preserves old Production baseline even if caller supplies new artifact bytes', () => {
  const changed = structuredClone(registry);
  changed.files[0].baseline_sha256 = '0'.repeat(64);
  assert.throws(() => resolveConsolidationSqlHistoryIntegrity(changed, Buffer.from('{}')),
    /predecessor registry and Production pins must remain unchanged/);
});

test('Seventh raw-registry formatting cannot rewrite the immutable predecessor', () => {
  assert.throws(() => assertConsolidationSqlHistoryPredecessor(registry,
    sourceWith(REGISTRY_PATH, Buffer.from(JSON.stringify(registry)))),
  /exact raw Sixth registry remains unchanged/);
});


// The following controls execute the private generic verifier with synthetic
// in-memory candidate bytes. They do not install a seal or approve live sources.
function reconstructSixthFixture() {
const hash=x=>createHash('sha256').update(x).digest('hex');const preservedHeaders=[{"path":"tests/coreProductionPreservation.test.mjs","sha256":"3b6868dfbc66468e69310c92becd680ef229295572467da8dcbfd09dfcfa7dbb","marker":"test('","before":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport ts from 'typescript';\nimport { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';\nimport { readConsolidationTestWiringIntegrity as readSubscriberProjectionIntegrity } from './helpers/consolidationTestWiringIntegrity.mjs';\nconst root=new URL('../',import.meta.url);\nconst manifest=JSON.parse(readFileSync(new URL('docs/operations/core-stability-source-manifest-20260907.json',root),'utf8'));\nconst hash=value=>createHash('sha256').update(value).digest('hex');\nconst incident=JSON.parse(readFileSync(new URL('docs/operations/core-stability-incident-amendment-20260908.json',root),'utf8'));\n","after":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport ts from 'typescript';\nimport { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';\nimport { readConsolidationSqlHistoryIntegrity as readSubscriberProjectionIntegrity } from './helpers/consolidationSqlHistoryIntegrity.mjs';\nconst root=new URL('../',import.meta.url);\nconst manifest=JSON.parse(readFileSync(new URL('docs/operations/core-stability-source-manifest-20260907.json',root),'utf8'));\nconst hash=value=>createHash('sha256').update(value).digest('hex');\nconst incident=JSON.parse(readFileSync(new URL('docs/operations/core-stability-incident-amendment-20260908.json',root),'utf8'));\n"},{"path":"tests/productContract.test.mjs","sha256":"f043d7c4950ce65722f5096d837fcfc9b5bb5e2d58c727f639120031a64a5ac4","marker":"test('","before":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { execFileSync } from 'node:child_process';\nimport { readFileSync } from 'node:fs';\nimport postcss from 'postcss';\nimport { readConsolidationTestWiringIntegrity as readSubscriberProjectionIntegrity } from './helpers/consolidationTestWiringIntegrity.mjs';\n\n","after":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { execFileSync } from 'node:child_process';\nimport { readFileSync } from 'node:fs';\nimport postcss from 'postcss';\nimport { readConsolidationSqlHistoryIntegrity as readSubscriberProjectionIntegrity } from './helpers/consolidationSqlHistoryIntegrity.mjs';\n\n"},{"path":"tests/subscriberProjectionIntegrity.test.mjs","sha256":"7c46acda33afb4baf10cbc8075af4e3a80d01df77fd4887de3d42a302d250dfb","marker":"const hash =","before":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\nimport { readConsolidationTestWiringIntegrity as readConsolidationIntegrity } from './helpers/consolidationTestWiringIntegrity.mjs';\n// Run every original negative/assertion below against the verified exact predecessor.\nconst consolidation = readConsolidationIntegrity(JSON.parse(readFileSync('docs/operations/core-stability-incident-amendment-20260908.json')));\nconst registry = consolidation.predecessorRegistry;\nconst artifact = readFileSync('docs/operations/evidence/subscriber-projection-candidate-20260909.json');\nconst readSource = consolidation.predecessorReadSource;\n","after":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport { createHash } from 'node:crypto';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\nimport { readConsolidationSqlHistoryIntegrity as readConsolidationIntegrity } from './helpers/consolidationSqlHistoryIntegrity.mjs';\n// Run every original negative/assertion below against the verified exact predecessor.\nconst consolidation = readConsolidationIntegrity(JSON.parse(readFileSync('docs/operations/core-stability-incident-amendment-20260908.json')));\nconst registry = consolidation.predecessorRegistry;\nconst artifact = readFileSync('docs/operations/evidence/subscriber-projection-candidate-20260909.json');\nconst readSource = consolidation.predecessorReadSource;\n"},{"path":"tests/consolidationIntegrity.test.mjs","sha256":"25c68862cec342dc3701e7606bd11f1dd8e74daad60ab2b441589166c4b57f15","marker":"const hash =","before":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nimport { CONSOLIDATION_ARTIFACT_PATH, resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';\nimport { readConsolidationTestWiringIntegrity as readConsolidationDeliveryIntegrity } from './helpers/consolidationTestWiringIntegrity.mjs';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\n\n// Tamper simulations are in memory only. Never rewrite registered source,\n// historical evidence, Auth, secrets, SQL, or the previous guard to test a failure.\nconst fifth = readConsolidationDeliveryIntegrity(JSON.parse(readFileSync('docs/operations/core-stability-incident-amendment-20260908.json')));\nconst registry = fifth.fourthRegistry;\nconst artifact = readFileSync(CONSOLIDATION_ARTIFACT_PATH);\nconst firstArtifact = readFileSync('docs/operations/evidence/subscriber-projection-candidate-20260909.json');\nconst manifest = JSON.parse(readFileSync('docs/operations/core-stability-source-manifest-20260907.json'));\nconst readSource = fifth.fourthReadSource;\nconst readConsolidationIntegrity = value => resolveConsolidationIntegrity(value, artifact, readSource, firstArtifact);\n","after":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nimport { CONSOLIDATION_ARTIFACT_PATH, resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';\nimport { readConsolidationSqlHistoryIntegrity as readConsolidationDeliveryIntegrity } from './helpers/consolidationSqlHistoryIntegrity.mjs';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\n\n// Tamper simulations are in memory only. Never rewrite registered source,\n// historical evidence, Auth, secrets, SQL, or the previous guard to test a failure.\nconst fifth = readConsolidationDeliveryIntegrity(JSON.parse(readFileSync('docs/operations/core-stability-incident-amendment-20260908.json')));\nconst registry = fifth.fourthRegistry;\nconst artifact = readFileSync(CONSOLIDATION_ARTIFACT_PATH);\nconst firstArtifact = readFileSync('docs/operations/evidence/subscriber-projection-candidate-20260909.json');\nconst manifest = JSON.parse(readFileSync('docs/operations/core-stability-source-manifest-20260907.json'));\nconst readSource = fifth.fourthReadSource;\nconst readConsolidationIntegrity = value => resolveConsolidationIntegrity(value, artifact, readSource, firstArtifact);\n"},{"path":"tests/consolidationDeliveryIntegrity.test.mjs","sha256":"936a357b1c50083ed5c8882a70b96be8891f75fb97859eff8d688d40a1671e75","marker":"const hash =","before":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nimport {\n  CONSOLIDATION_DELIVERY_ARTIFACT_PATH, resolveConsolidationDeliveryIntegrity,\n} from './helpers/consolidationDeliveryIntegrity.mjs';\nimport { readConsolidationTestWiringIntegrity } from './helpers/consolidationTestWiringIntegrity.mjs';\nimport { resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\n\n// Independent pins captured after source review. Mutations below are in memory;\n// no registered source, original assertion, SQL, secrets or Production I/O changes.\nconst REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';\nconst FOURTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';\nconst FIRST_ARTIFACT_PATH = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';\nconst GUARD_PATH = 'tests/helpers/consolidationDeliveryIntegrity.mjs';\nconst PUBLICATION_PATH = 'supabase/functions/_shared/market-publication-contract.ts';\nconst ORCHESTRATOR_PATH = 'supabase/functions/daily-delivery-orchestrator/index.ts';\nconst sixth = readConsolidationTestWiringIntegrity(JSON.parse(readFileSync(REGISTRY_PATH)));\nconst readSource = sixth.fifthReadSource;\nconst rawRegistry = readSource(REGISTRY_PATH);\nconst registry = JSON.parse(rawRegistry);\nconst artifact = readSource(CONSOLIDATION_DELIVERY_ARTIFACT_PATH);\nconst fourthArtifact = readSource(FOURTH_ARTIFACT_PATH);\nconst manifest = JSON.parse(readSource('docs/operations/core-stability-source-manifest-20260907.json'));\nconst readConsolidationDeliveryIntegrity = value => resolveConsolidationDeliveryIntegrity(value, artifact, readSource, fourthArtifact);\n","after":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nimport {\n  CONSOLIDATION_DELIVERY_ARTIFACT_PATH, resolveConsolidationDeliveryIntegrity,\n} from './helpers/consolidationDeliveryIntegrity.mjs';\nimport { readConsolidationSqlHistoryIntegrity as readConsolidationTestWiringIntegrity } from './helpers/consolidationSqlHistoryIntegrity.mjs';\nimport { resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\n\n// Independent pins captured after source review. Mutations below are in memory;\n// no registered source, original assertion, SQL, secrets or Production I/O changes.\nconst REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';\nconst FOURTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';\nconst FIRST_ARTIFACT_PATH = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';\nconst GUARD_PATH = 'tests/helpers/consolidationDeliveryIntegrity.mjs';\nconst PUBLICATION_PATH = 'supabase/functions/_shared/market-publication-contract.ts';\nconst ORCHESTRATOR_PATH = 'supabase/functions/daily-delivery-orchestrator/index.ts';\nconst sixth = readConsolidationTestWiringIntegrity(JSON.parse(readFileSync(REGISTRY_PATH)));\nconst readSource = sixth.fifthReadSource;\nconst rawRegistry = readSource(REGISTRY_PATH);\nconst registry = JSON.parse(rawRegistry);\nconst artifact = readSource(CONSOLIDATION_DELIVERY_ARTIFACT_PATH);\nconst fourthArtifact = readSource(FOURTH_ARTIFACT_PATH);\nconst manifest = JSON.parse(readSource('docs/operations/core-stability-source-manifest-20260907.json'));\nconst readConsolidationDeliveryIntegrity = value => resolveConsolidationDeliveryIntegrity(value, artifact, readSource, fourthArtifact);\n"},{"path":"tests/consolidationTestWiringIntegrity.test.mjs","sha256":"5214c37d29af5a98dce1335b92ecb53beba1b364ef30253885f688492a512c93","marker":"const hash =","before":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nimport {\n  CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH, readConsolidationTestWiringIntegrity,\n  resolveConsolidationTestWiringIntegrity,\n} from './helpers/consolidationTestWiringIntegrity.mjs';\nimport { resolveConsolidationDeliveryIntegrity } from './helpers/consolidationDeliveryIntegrity.mjs';\nimport { resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\n\n// Independent review pins. Every negative first executes the complete clean\n// predecessor chain. All tampering is in memory: no runtime, SQL or baseline writes.\nconst REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';\nconst GUARD_PATH = 'tests/helpers/consolidationTestWiringIntegrity.mjs';\nconst FIFTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json';\nconst FOURTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';\nconst FIRST_ARTIFACT_PATH = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';\nconst MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';\nconst PUBLICATION_PATH = 'supabase/functions/_shared/market-publication-contract.ts';\nconst ORCHESTRATOR_PATH = 'supabase/functions/daily-delivery-orchestrator/index.ts';\nconst readSource = path => readFileSync(new URL('../' + path, import.meta.url));\nconst rawRegistry = readSource(REGISTRY_PATH);\nconst registry = JSON.parse(rawRegistry);\nconst artifact = readSource(CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH);\nconst fifthArtifact = readSource(FIFTH_ARTIFACT_PATH);\nconst manifest = JSON.parse(readSource(MANIFEST_PATH));\n","after":"import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nimport {\n  CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH,\n  resolveConsolidationTestWiringIntegrity,\n} from './helpers/consolidationTestWiringIntegrity.mjs';\nimport { resolveConsolidationDeliveryIntegrity } from './helpers/consolidationDeliveryIntegrity.mjs';\nimport { resolveConsolidationIntegrity } from './helpers/consolidationIntegrity.mjs';\nimport { resolveSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';\nimport { readConsolidationSqlHistoryIntegrity } from './helpers/consolidationSqlHistoryIntegrity.mjs';\n\n// Independent review pins. Every negative first executes the complete clean\n// predecessor chain. All tampering is in memory: no runtime, SQL or baseline writes.\nconst REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';\nconst GUARD_PATH = 'tests/helpers/consolidationTestWiringIntegrity.mjs';\nconst FIFTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json';\nconst FOURTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-candidate-20260909.json';\nconst FIRST_ARTIFACT_PATH = 'docs/operations/evidence/subscriber-projection-candidate-20260909.json';\nconst MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';\nconst PUBLICATION_PATH = 'supabase/functions/_shared/market-publication-contract.ts';\nconst ORCHESTRATOR_PATH = 'supabase/functions/daily-delivery-orchestrator/index.ts';\nconst seventh = readConsolidationSqlHistoryIntegrity(\n  JSON.parse(readFileSync(new URL('../' + REGISTRY_PATH, import.meta.url))),\n);\nconst readSource = seventh.sixthReadSource;\nconst rawRegistry = readSource(REGISTRY_PATH);\nconst registry = JSON.parse(rawRegistry);\nconst artifact = readSource(CONSOLIDATION_TEST_WIRING_ARTIFACT_PATH);\nconst fifthArtifact = readSource(FIFTH_ARTIFACT_PATH);\nconst manifest = JSON.parse(readSource(MANIFEST_PATH));\nconst readConsolidationTestWiringIntegrity = value =>\n  resolveConsolidationTestWiringIntegrity(value, artifact, readSource, fifthArtifact);\n"}];const headerSource=new Map();for(const row of preservedHeaders){const current=readFileSync(row.path,'utf8');assert.equal(current.slice(0,current.indexOf(row.marker)),row.after,'exact Seventh setup before fixture reconstruction');const old=Buffer.from(row.before+current.slice(current.indexOf(row.marker)));assert.equal(hash(old),row.sha256,'exact Sixth caller source');headerSource.set(row.path,old);}const read=p=>headerSource.get(p)||readSource(p),root='docs/operations/evidence/';const names=['core-consolidation-candidate-20260909.json','core-consolidation-delivery-candidate-20260909.json','core-consolidation-test-wiring-20260909.json'],artifacts=names.map(n=>JSON.parse(read(root+n)));
function patches(a){const m=new Map();let c;for(const l of a.source_diff.patch_lines){const h=l.match(/^diff --git a\/(\S+) b\/(\S+)$/);if(h){assert.equal(h[1],h[2]);c=[];m.set(h[1],c);}else if(c)c.push(l);}return m;}
function apply(bytes,lines,row,rev=false){const text=bytes.toString(),current=text.endsWith('\n')?text.slice(0,-1).split('\n'):text?text.split('\n'):[],out=[];let cursor=0,i=2;while(i<lines.length){const l=lines[i++];if(!l)continue;const h=l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);assert.ok(h,row.path);const oc=Number(h[2]??1),nc=Number(h[4]??1),b=[],a=[];while(i<lines.length&&!lines[i].startsWith('@@ ')&&lines[i]!==''){const p=lines[i++];if(p==='\\ No newline at end of file')continue;if(p[0]!=='+')b.push(p.slice(1));if(p[0]!=='-')a.push(p.slice(1));}assert.equal(b.length,oc);assert.equal(a.length,nc);const from=rev?a:b,to=rev?b:a,start=Number(rev?h[3]:h[1])-((rev?nc:oc)?1:0);out.push(...current.slice(cursor,start));assert.deepEqual(current.slice(start,start+from.length),from,row.path);out.push(...to);cursor=start+from.length;}out.push(...current.slice(cursor));return Buffer.from(out.join('\n')+((rev?row.original_ends_with_newline:row.candidate_ends_with_newline)?'\n':''));}
const six=artifacts[2],sp=patches(six),headers=new Map(),restored=new Map();for(const row of six.files){const now=read(row.path);if(hash(now)!==row.candidate_hash)continue;const old=apply(now,sp.get(row.path),row,true);assert.equal(hash(old),row.original_hash);headers.set(row.path,old);}
for(const[i,a]of artifacts.entries()){const ps=patches(a),rows=[...a.files,...(a.related_candidates||[]),...(a.new_candidates||[])];for(const row of rows){let previous=restored.get(row.path);if(previous===undefined&&row.original_hash===null)previous=Buffer.alloc(0);if(previous===undefined&&i>0&&headers.has(row.path)){const candidate=headers.get(row.path);if(hash(candidate)===row.candidate_hash){restored.set(row.path,candidate);continue;}previous=candidate;}if(previous===undefined)previous=execFileSync('git',['show','6469630795fb1215595306c026437d850b668801:'+row.path],{stdio:['ignore','pipe','pipe']});if(row.original_hash!==null)assert.equal(hash(previous),row.original_hash,'fixed preimage '+row.path);const current=apply(previous,ps.get(row.path),row);assert.equal(hash(current),row.candidate_hash,'fixed candidate '+row.path);restored.set(row.path,current);}}
const rp='docs/operations/core-stability-incident-amendment-20260908.json',raw=read(rp),registry=JSON.parse(raw);assert.equal(hash(raw),'8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737');const first=JSON.parse(read(root+'subscriber-projection-candidate-20260909.json'));const second=registry.subscriber_checkpoint_projection_registration,third=registry.subscriber_public_release_assertion_registration;const early=new Map([...first.related_candidates,...second.related_candidates,...second.protected_files,...second.base_candidates,...third.files].map(row=>[row.path,row]));for(const[path,row]of early){if(restored.has(path))continue;const bytes=execFileSync('git',['show','6469630795fb1215595306c026437d850b668801:'+path],{stdio:['ignore','pipe','pipe']});assert.equal(hash(bytes),row.candidate_hash,'fixed first/second/third HEAD candidate '+path);restored.set(path,bytes);}const source=p=>restored.get(p)||read(p),result=resolveConsolidationTestWiringIntegrity(registry,read(root+names[2]),source,read(root+names[1]));
  return { registry, rawRegistry: raw, readSource: source, artifact: read(root + names[2]), result };
}
const sixthFixture = reconstructSixthFixture();
const genericHelperSource = unsealedHelperSource;
assert.match(genericHelperSource, /const FINAL_SEAL = null;/, 'No current candidate seal may be installed during preparation');
const privateFactory = runInThisContext('(function(assert,createHash,readFileSync,ts,resolveConsolidationTestWiringIntegrity){'
  + genericHelperSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('./helpers/consolidationSqlHistoryIntegrity.mjs', import.meta.url).href))
  + '\nreturn { verify:verifySealedConsolidationSqlHistory, restore:restoreSeventhPreimages, successors:verifyReviewedTestSuccessors };})');
const generic = privateFactory(assert, createHash, readFileSync, ts, resolveConsolidationTestWiringIntegrity);
const GENERIC_SECTION = 'core_sql_history_replay_registration';
const GENERIC_ARTIFACT = 'docs/operations/evidence/core-consolidation-sql-history-20260909.json';
const GENERIC_NEW_PATH = 'tests/fixtures/consolidation-v1/generic-seventh-unit-control.json';
const GENERIC_EXISTING_PATH = 'supabase/functions/get-report-payload/index.ts';
const SUCCESSOR_PATH = 'tests/publicRelease.test.mjs';
// Independent review pins; no case is approved by reading mutable current hashes.
const successorPins = [
  { path: SUCCESSOR_PATH, name: 'paid report fails closed when evidence does not meet the member threshold',
    original_hash: '9847b0f8242bd8d6acb0329a9a54a2a151864c92b0bb75ea859ee938fd94deb0',
    candidate_hash: '06a9d5af39de8fc4742766cec41951a1453302c29c92df33514622dca965141d',
    original_assertions: 47, candidate_assertions: 48,
    diff_sha256: '5d297d25166678395cdfe7d33df35e19bb768b73f961010bc32f778f362bbb39' },
  { path: SUCCESSOR_PATH, name: 'home public decision copy is user-facing and internally consistent',
    original_hash: '1a8750f57f3c3fe95ef2020c65e6807e0f7c47fffa9513cda875087d76cbbf07',
    candidate_hash: 'a903a6a881240f7ec0882e2b3bb8491eb67bc31a8022580dde64e1bc18964ab8',
    original_assertions: 39, candidate_assertions: 41,
    diff_sha256: '85202f82422e4c5cd58031bd8d00828f77496a306e6d8aca505725b831946684' },
  { path: SUCCESSOR_PATH, name: 'performance excludes outcomes that have no verifiable closing direction',
    original_hash: 'da214e541d4e3d4ad7e4255f24f199bb43e1dd91e63df40fe9e2e05344f29b0d',
    candidate_hash: '4c44ed8f7bf78c9dbcfbf9c297bb6cf4bb83f819be7af25f5cea559b6372a031',
    original_assertions: 19, candidate_assertions: 20,
    diff_sha256: '381f4c2659025958e87d1d167d0f4d5cb5ed68b17d41a2363034770af19c24a0' },
];
const genericJson = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const genericProvenance = 'SYNTHETIC UNIT CONTROL ONLY. This private verifier invocation uses reconstructed immutable Sixth sources and test-only in-memory source differences; it does not authorize any repository candidate, Production operation or successful full-chain claim.';
function declarationText(path, source, name) {
  const parsed = ts.createSourceFile(path, source.toString(), ts.ScriptTarget.Latest, true);
  return parsed.statements.find(node => node.name?.getText(parsed) === name)?.getText(parsed);
}
function wholeFilePatch(path, before, after) {
  const oldLines = before.length ? before.toString().trimEnd().split('\n') : [];
  const newLines = after.toString().trimEnd().split('\n');
  return ['diff --git a/' + path + ' b/' + path, before.length ? '--- a/' + path : '--- /dev/null', '+++ b/' + path,
    '@@ -' + (oldLines.length ? '1,' + oldLines.length : '0,0') + ' +1,' + newLines.length + ' @@',
    ...oldLines.map(line => '-' + line), ...newLines.map(line => '+' + line)];
}
function genericFixture() {
  const before = sixthFixture.readSource(GENERIC_EXISTING_PATH);
  const file = ts.createSourceFile(GENERIC_EXISTING_PATH, before.toString(), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(node => node.name?.getText(file) === 'buildHistorySummary');
  assert.ok(declaration?.body);
  const index = declaration.body.getStart(file) + 1;
  const after = Buffer.from(before.toString().slice(0, index) + '\n  // Synthetic reviewed verifier control; never executed.\n' + before.toString().slice(index));
  const added = Buffer.from('{"synthetic_unit_only":true,"full_chain_pass":false}\n');
  const predecessor = sixthFixture.registry.files.find(row => row.path === GENERIC_EXISTING_PATH);
  const metadata = { reason: 'Exact in-memory verifier control only; no runtime admission.',
    rollback_target: 'Discard in-memory synthetic bytes; repository source is unchanged.',
    approval_provenance: genericProvenance };
  const files = [{ path: GENERIC_EXISTING_PATH, production_hash: predecessor.baseline_sha256,
    original_hash: hash(before), candidate_hash: hash(after), original_ends_with_newline: true,
    candidate_ends_with_newline: true, ...metadata }];
  const publicBefore = sixthFixture.readSource(SUCCESSOR_PATH), publicAfter = readSource(SUCCESSOR_PATH);
  const publicProductionHash = sixthFixture.registry.files.find(row => row.path === SUCCESSOR_PATH)?.baseline_sha256;
  files.push({ path: SUCCESSOR_PATH,
    ...(publicProductionHash ? { production_hash: publicProductionHash } : {}),
    original_hash: hash(publicBefore), candidate_hash: hash(publicAfter), original_ends_with_newline: true,
    candidate_ends_with_newline: true, ...metadata });
  const newCandidates = [{ path: GENERIC_NEW_PATH, original_hash: null, candidate_hash: hash(added),
    original_ends_with_newline: false, candidate_ends_with_newline: true, ...metadata }];
  const manifest = JSON.parse(sixthFixture.readSource('docs/operations/core-stability-source-manifest-20260907.json'));
  const originalDeclaration = manifest.protected_declarations.find(row => row.path === GENERIC_EXISTING_PATH && row.name === 'buildHistorySummary');
  const declarations = [{ path: GENERIC_EXISTING_PATH, name: 'buildHistorySummary', production_hash: originalDeclaration.production_sha256,
    original_hash: hash(declarationText(GENERIC_EXISTING_PATH, before, 'buildHistorySummary')),
    candidate_hash: hash(declarationText(GENERIC_EXISTING_PATH, after, 'buildHistorySummary')), ...metadata }];
  const patchLines = [...wholeFilePatch(GENERIC_EXISTING_PATH, before, after),
    ...wholeFilePatch(SUCCESSOR_PATH, publicBefore, publicAfter), ...wholeFilePatch(GENERIC_NEW_PATH, Buffer.alloc(0), added)];
  const patch = hash(patchLines.join('\n'));
  const common = { approval_id: 'CORE_SQL_HISTORY_REPLAY_APPEND_20260909',
    previous_complete_registry_sha256: '8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737',
    previous_registration_id: 'CORE_DELIVERY_TEST_WIRING_APPEND_20260909',
    candidate_base_git_sha: '6469630795fb1215595306c026437d850b668801', approval_provenance: genericProvenance,
    files, new_candidates: newCandidates, declarations, test_case_successors: structuredClone(successorPins) };
  const artifact = { ...common, source_diff: { paths: [GENERIC_EXISTING_PATH, SUCCESSOR_PATH, GENERIC_NEW_PATH], sha256: patch, patch_lines: patchLines } };
  const artifactBytes = genericJson(artifact);
  const section = { ...common, production_operations_authorized: false, production_sql_execution_authorized: false,
    deploy_authorized: false, merge_authorized: false, cron_changes_authorized: false,
    automatic_stability_day: false, historical_success_claim: false,
    local_sql_authoring_authorized: true, isolated_sql_execution_authorized: true, fresh_validation_required: true,
    source_diff_reference: { path: GENERIC_ARTIFACT, sha256: hash(artifactBytes), patch_sha256: patch } };
  const value = { ...structuredClone(sixthFixture.registry), [GENERIC_SECTION]: section };
  const raw = Buffer.from(sixthFixture.rawRegistry.toString().slice(0, -2) + ',\n  "' + GENERIC_SECTION + '": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n');
  const sourceMap = new Map([[GENERIC_EXISTING_PATH, after], [SUCCESSOR_PATH, publicAfter], [GENERIC_NEW_PATH, added], [REGISTRY_PATH, raw]]);
  const seal = Object.freeze({ artifact: hash(artifactBytes), section: hash(genericJson(section)), patch,
    paths: { files: [GENERIC_EXISTING_PATH, SUCCESSOR_PATH], new_candidates: [GENERIC_NEW_PATH] },
    declarations: declarations.map(({ path, name, production_hash, original_hash, candidate_hash }) =>
      ({ path, name, production_hash, original_hash, candidate_hash })) });
  return { seal, value, artifact, artifactBytes, sourceMap,
    source: path => sourceMap.has(path) ? sourceMap.get(path) : sixthFixture.readSource(path) };
}
function verifyGeneric(fixture) {
  return generic.verify(fixture.seal, fixture.value, fixture.artifactBytes, fixture.source, sixthFixture.artifact);
}
function rewriteGenericMetadata(fixture) {
  fixture.artifactBytes = genericJson(fixture.artifact);
  fixture.sourceMap.set(REGISTRY_PATH, genericJson(fixture.value));
}

test('private generic control executes exact Sixth chain and all 698 declarations, without sealing public readers', () => {
  const fixture = genericFixture(), verified = verifyGeneric(fixture);
  assert.equal(verified.protectedDeclarationCount, 698);
  assert.equal(verified.changedProtectedDeclarationCount, 1);
  assert.equal(verified.reviewedTestSuccessorCount, 3);
  assert.equal(verified.unchangedPublicReleaseCaseCount, 48);
  assert.equal(verified.fileHash({ path: GENERIC_EXISTING_PATH }), fixture.value[GENERIC_SECTION].files[0].candidate_hash);
  assert.equal(verified.declarationHash({ path: GENERIC_EXISTING_PATH, name: 'buildHistorySummary' }),
    fixture.value[GENERIC_SECTION].declarations[0].candidate_hash);
  assert.equal(hash(verified.sixthReadSource(REGISTRY_PATH)), '8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737');
  assert.equal(hash(verified.sixthReadSource(GENERIC_EXISTING_PATH)), fixture.value[GENERIC_SECTION].files[0].original_hash);
  assert.throws(() => verified.sixthReadSource(GENERIC_NEW_PATH), { code: 'ENOENT' });
  assert.ok(verified.newCandidatePaths.includes(GENERIC_NEW_PATH));
  assert.deepEqual(verified.fifthRegistry, sixthFixture.result.fifthRegistry);
  assert.throws(() => readConsolidationSqlHistoryIntegrity(registry), { code: 'SEVENTH_FINAL_SOURCE_FREEZE_REQUIRED' });
  assert.doesNotMatch(genericHelperSource, /export (?:function|const) (?:verifySealed|FINAL_SEAL|restoreSeventh)/);
});

const genericMutations = [
  ['missing section', f => { delete f.value[GENERIC_SECTION]; }],
  ['wrong approval', f => { f.value[GENERIC_SECTION].approval_id = 'unreviewed'; }],
  ['wrong base', f => { f.value[GENERIC_SECTION].candidate_base_git_sha = '0'.repeat(40); }],
  ['old Production baseline', f => { f.value.files[0].baseline_sha256 = '0'.repeat(64); }],
  ['old approval history', f => { f.value.integrity_approval_history = []; }],
  ['unknown existing path', f => { f.value[GENERIC_SECTION].files[0].path = 'supabase/functions/auth/index.ts'; }],
  ['unknown SQL path', f => { f.value[GENERIC_SECTION].new_candidates[0].path = 'supabase/migrations/unreviewed.sql'; }],
  ['path traversal', f => { f.value[GENERIC_SECTION].new_candidates[0].path = '../unreviewed'; }],
  ['duplicate source', f => { f.value[GENERIC_SECTION].files.push(f.value[GENERIC_SECTION].files[0]); }],
  ['duplicate new source', f => { f.value[GENERIC_SECTION].new_candidates.push(f.value[GENERIC_SECTION].new_candidates[0]); }],
  ['unknown Auth declaration', f => { f.value[GENERIC_SECTION].declarations[0].name = 'authorizeInternalRequest'; }],
  ['missing declaration', f => { f.value[GENERIC_SECTION].declarations = []; }],
  ['mutable artifact reference', f => { f.value[GENERIC_SECTION].source_diff_reference.sha256 = '0'.repeat(64); }],
  ['changed artifact bytes', f => { f.artifactBytes = Buffer.concat([f.artifactBytes, Buffer.from(' ') ]); }],
  ['changed current source', f => { f.sourceMap.set(GENERIC_EXISTING_PATH, Buffer.concat([f.sourceMap.get(GENERIC_EXISTING_PATH), Buffer.from('\n// drift\n')])); }],
  ['missing new source', f => { f.sourceMap.set(GENERIC_NEW_PATH, undefined); }],
  ['new source bytes drift', f => { f.sourceMap.set(GENERIC_NEW_PATH, Buffer.from('{}\n')); }],
  ['raw predecessor formatting', f => { f.sourceMap.set(REGISTRY_PATH, Buffer.from(JSON.stringify(f.value))); }],
  ['unbound actual registry', f => { f.sourceMap.set(REGISTRY_PATH, sixthFixture.rawRegistry); }],
  ['source and patch and mutable new hash forged together', f => {
    const bytes = Buffer.from(f.sourceMap.get(GENERIC_EXISTING_PATH).toString().replace('Synthetic reviewed verifier control', 'Unreviewed evidence policy control'));
    f.sourceMap.set(GENERIC_EXISTING_PATH, bytes);
    f.value[GENERIC_SECTION].files[0].candidate_hash = hash(bytes);
    f.artifact.files[0].candidate_hash = hash(bytes);
    f.artifact.source_diff.patch_lines = f.artifact.source_diff.patch_lines.map(line => line.replace('Synthetic reviewed verifier control', 'Unreviewed evidence policy control'));
    f.artifact.source_diff.sha256 = hash(f.artifact.source_diff.patch_lines.join('\n'));
    rewriteGenericMetadata(f);
    f.value[GENERIC_SECTION].source_diff_reference.sha256 = hash(f.artifactBytes);
    f.value[GENERIC_SECTION].source_diff_reference.patch_sha256 = f.artifact.source_diff.sha256;
  }],
];
for (const field of ['production_operations_authorized', 'production_sql_execution_authorized', 'deploy_authorized',
  'merge_authorized', 'cron_changes_authorized', 'automatic_stability_day', 'historical_success_claim']) {
  genericMutations.push(['forbidden authority ' + field, f => { f.value[GENERIC_SECTION][field] = true; }]);
}
for (const field of ['local_sql_authoring_authorized', 'isolated_sql_execution_authorized', 'fresh_validation_required']) {
  genericMutations.push(['missing named local constraint ' + field, f => { f.value[GENERIC_SECTION][field] = false; }]);
}
for (const [path] of anchors) genericMutations.push(['immutable predecessor drift ' + path,
  f => { f.sourceMap.set(path, Buffer.concat([sixthFixture.readSource(path), Buffer.from('\n// changed predecessor\n')])); }]);
for (const row of bodies) genericMutations.push(['original body drift ' + row.path,
  f => { f.sourceMap.set(row.path, Buffer.concat([sixthFixture.readSource(row.path), Buffer.from('\n// changed original body\n')])); }]);
for (const path of ['supabase/functions/generate-daily-report-v7/index.ts', 'supabase/functions/_shared/internal-function-auth.mjs']) {
  genericMutations.push(['unreviewed runtime/Auth outside scope ' + path,
    f => {
      const before = sixthFixture.readSource(path).toString();
      const after = path.endsWith('internal-function-auth.mjs')
        ? before.replace('export async function authorizeInternalRequest(headers, credentials = {}, now = new Date()) {',
          'export async function authorizeInternalRequest(headers, credentials = {}, now = new Date()) { /* unreviewed Auth declaration */')
        : before + '\n// unreviewed policy\n';
      assert.notEqual(after, before, 'Negative must actually alter the protected source');
      f.sourceMap.set(path, Buffer.from(after));
    }]);
}
for (const [name, mutate] of genericMutations) test('private generic verifier rejects ' + name, () => {
  assert.doesNotThrow(() => verifyGeneric(genericFixture()));
  const fixture = genericFixture(); mutate(fixture); assert.throws(() => verifyGeneric(fixture));
});

function tinyPatch() {
  const path = 'tests/generic-control.mjs', before = Buffer.from('const a = 1;\n'), after = Buffer.from('const a = 2;\n');
  const row = { path, original_hash: hash(before), candidate_hash: hash(after),
    original_ends_with_newline: true, candidate_ends_with_newline: true };
  return { path, before, after, row, artifact: { source_diff: { patch_lines: wholeFilePatch(path, before, after) } } };
}
test('strict reverse patch reconstructs actual old bytes and new-file absence', () => {
  const f = tinyPatch();
  assert.equal(hash(generic.restore(f.artifact, [f.row], () => f.after).get(f.path)), hash(f.before));
  const newRow = { ...f.row, original_hash: null, original_ends_with_newline: false };
  const artifact = { source_diff: { patch_lines: wholeFilePatch(f.path, Buffer.alloc(0), f.after) } };
  assert.equal(generic.restore(artifact, [newRow], () => f.after).get(f.path), null);
});
for (const [name, mutate] of [
  ['old path mismatch', f => { f.artifact.source_diff.patch_lines[1] = '--- a/wrong'; }],
  ['new path mismatch', f => { f.artifact.source_diff.patch_lines[2] = '+++ b/wrong'; }],
  ['rename', f => { f.artifact.source_diff.patch_lines[0] = 'diff --git a/one b/two'; }],
  ['duplicate patch', f => { f.artifact.source_diff.patch_lines.push(...f.artifact.source_diff.patch_lines); }],
  ['hunk length', f => { f.artifact.source_diff.patch_lines[3] = '@@ -1,2 +1,1 @@'; }],
  ['overlapping hunk', f => { f.artifact.source_diff.patch_lines.push(...f.artifact.source_diff.patch_lines.slice(3)); }],
  ['unbounded position', f => { f.artifact.source_diff.patch_lines[3] = '@@ -1,1 +99,1 @@'; }],
  ['unsupported control', f => { f.artifact.source_diff.patch_lines.push('!unreviewed'); }],
  ['wrong current patch bytes', f => { f.after = Buffer.from('const a = 9;\n'); }],
  ['wrong current newline', f => { f.after = Buffer.from('const a = 2;'); }],
  ['wrong original digest', f => { f.row.original_hash = '0'.repeat(64); }],
  ['false new-file preimage', f => { f.row.original_hash = null; f.artifact.source_diff.patch_lines[1] = '--- /dev/null'; }],
]) test('strict reverse patch rejects ' + name, () => {
  const baseline = tinyPatch(); assert.equal(hash(generic.restore(baseline.artifact, [baseline.row], () => baseline.after).get(baseline.path)), hash(baseline.before));
  const f = tinyPatch(); mutate(f); assert.throws(() => generic.restore(f.artifact, [f.row], () => f.after));
});

function successorControl() {
  return { declared: structuredClone(successorPins), before: sixthFixture.readSource(SUCCESSOR_PATH),
    after: readSource(SUCCESSOR_PATH) };
}
function verifySuccessorControl(f) {
  return generic.successors(f.declared, path => { assert.equal(path, SUCCESSOR_PATH); return f.after; },
    path => { assert.equal(path, SUCCESSOR_PATH); return f.before; });
}
function caseText(bytes, name) {
  const file = ts.createSourceFile(SUCCESSOR_PATH, bytes.toString(), ts.ScriptTarget.Latest, true);
  return file.statements.find(node => node.expression?.arguments?.[0]?.text === name)?.getText(file);
}
function mutateSuccessorCase(f, name, change) {
  const before = caseText(f.after, name); assert.equal(typeof before, 'string');
  const after = change(before); assert.notEqual(after, before, 'Negative must change actual case bytes');
  f.after = Buffer.from(f.after.toString().replace(before, after));
}

test('three exact reviewed successors preserve all other 48 cases and reconstruct original Sixth tests', () => {
  const f = successorControl();
  assert.deepEqual(verifySuccessorControl(f), { changed: 3, unchanged: 48 });
  assert.equal(hash(f.before), '50e3d73e61ce45b2dd788e5b1edb3c5659f6a882121b3b4d49894d340ecccecc');
  for (const pin of successorPins) {
    assert.equal(hash(caseText(f.before, pin.name)), pin.original_hash);
    assert.equal(hash(caseText(f.after, pin.name)), pin.candidate_hash);
    assert.ok(pin.candidate_assertions > pin.original_assertions);
  }
  assert.match(genericHelperSource, /const FINAL_SEAL = null;/);
});

for (const [name, mutate] of [
  ['missing successor metadata', f => { f.declared = undefined; }],
  ['unknown test path', f => { f.declared[0].path = 'tests/unreviewed.test.mjs'; }],
  ['unknown case name', f => { f.declared[0].name = 'unreviewed case'; }],
  ['duplicate successor metadata', f => { f.declared.push(f.declared[0]); }],
  ['old baseline body hash rewritten', f => { f.declared[0].original_hash = '0'.repeat(64); }],
  ['new candidate hash waiver', f => { f.declared[0].candidate_hash = '0'.repeat(64); }],
  ['reviewed diff hash waiver', f => { f.declared[0].diff_sha256 = '0'.repeat(64); }],
  ['reduced assertion count waiver', f => { f.declared[0].candidate_assertions = 46; }],
  ['original body bytes changed', f => { f.before = Buffer.from(f.before.toString().replace('paid report fails closed', 'paid report no longer fails closed')); }],
  ['reviewed assertion changed', f => { mutateSuccessorCase(f, successorPins[0].name, body => body.replace('assert.match(reportDetail', 'assert.doesNotMatch(reportDetail')); }],
  ['reviewed assertion removed', f => { mutateSuccessorCase(f, successorPins[0].name,
    body => body.split('\n').filter(line => !line.includes('assert.doesNotMatch(reportPayloadFunction, /recommendationsEligible')).join('\n')); }],
  ['reviewed successor absent', f => { mutateSuccessorCase(f, successorPins[0].name, () => caseText(f.before, successorPins[0].name)); }],
  ['unreviewed adjacent case', f => {
    const parsed = ts.createSourceFile(SUCCESSOR_PATH, f.after.toString(), ts.ScriptTarget.Latest, true);
    const adjacent = parsed.statements.find(node => node.expression?.arguments?.[0]?.text
      && !successorPins.some(pin => pin.name === node.expression.arguments[0].text));
    mutateSuccessorCase(f, adjacent.expression.arguments[0].text, body => body.replace('assert.', 'assert. /* unreviewed */ '));
  }],
  ['duplicate actual case', f => { f.after = Buffer.concat([f.after, Buffer.from('\n' + caseText(f.after, successorPins[0].name) + '\n')]); }],
  ['actual case removed', f => { mutateSuccessorCase(f, successorPins[0].name, () => ''); }],
  ['source and candidate metadata forged together', f => {
    mutateSuccessorCase(f, successorPins[0].name, body => body.replace('assert.match(reportDetail', 'assert.doesNotMatch(reportDetail'));
    f.declared[0].candidate_hash = hash(caseText(f.after, successorPins[0].name));
  }],
]) test('exact test-case successor guard rejects ' + name, () => {
  assert.deepEqual(verifySuccessorControl(successorControl()), { changed: 3, unchanged: 48 });
  const f = successorControl(); mutate(f); assert.throws(() => verifySuccessorControl(f));
});

test('full generic chain refuses caller metadata that tries to add another reviewed test case', () => {
  const f = genericFixture(); assert.doesNotThrow(() => verifyGeneric(f));
  f.value[GENERIC_SECTION].test_case_successors.push({ ...successorPins[0], name: 'unreviewed runtime exemption' });
  f.artifact.test_case_successors = f.value[GENERIC_SECTION].test_case_successors;
  rewriteGenericMetadata(f);
  assert.throws(() => verifyGeneric(f), /exact reviewed test successor metadata/);
});


// Independent fixed final pins; these are never derived from mutable candidates.
const FINAL_PINS = Object.freeze({
  artifact: 'c14666fd23bd334da8a97e4c8f00ef686fe176d2733c9a1d80c76f39d0dcf2a5',
  section: 'b8976efda542fa7d4fd483d99091d2809b3d6761287d82c1768213f06ee3818b',
  patch: '3592c9f18cbf132e264416879849a03df734f7b929d12acef83dc5907efc9283',
  helper: '85e6bce987095d13e86d2d6f003996a3654abdde4b9cd54729375ceac249d832',
  registry: '9ce4346495b9287e31a73c286abc45a5a7dac45db67ece8899988aafd7996d9a',
});
const FINAL_SECTION = 'core_sql_history_replay_registration';

test('actual Seventh sealed positive pins only the reviewed local source scope', () => {
  assert.equal(ACTUAL_SEAL_STATUS, 'SEALED_REVIEWED_LOCAL_SOURCE_ONLY');
  assert.equal(hash(actualArtifactBytes), FINAL_PINS.artifact);
  assert.equal(hash(actualReadSource('tests/helpers/consolidationSqlHistoryIntegrity.mjs')), FINAL_PINS.helper);
  assert.equal(hash(actualReadSource(REGISTRY_PATH)), FINAL_PINS.registry);
  assert.equal(hash(genericJson(actualRegistry[FINAL_SECTION])), FINAL_PINS.section);
  assert.equal(hash(actualArtifact.source_diff.patch_lines.join('\n')), FINAL_PINS.patch);
  assert.equal(actualRegistry[FINAL_SECTION].files.length, 26);
  assert.equal(actualRegistry[FINAL_SECTION].new_candidates.length, 34);
  assert.equal(sealedBaseline.protectedDeclarationCount, 698);
  assert.equal(sealedBaseline.changedProtectedDeclarationCount, 5);
  assert.equal(sealedBaseline.reviewedTestSuccessorCount, 3);
  assert.equal(sealedBaseline.unchangedPublicReleaseCaseCount, 48);
  assert.equal(hash(sealedBaseline.sixthReadSource(REGISTRY_PATH)), '8a8e42f8e6636aeac1e66ba6fc676ec9a266ab36fe4a505422bd047f76585737');
  for (const row of [...actualRegistry[FINAL_SECTION].files, ...actualRegistry[FINAL_SECTION].new_candidates]) {
    assert.equal(sealedBaseline.fileHash(row), row.candidate_hash);
    if (row.original_hash) assert.equal(hash(sealedBaseline.sixthReadSource(row.path)), row.original_hash);
    else assert.throws(() => sealedBaseline.sixthReadSource(row.path), { code: 'ENOENT' });
  }
  for (const row of actualRegistry[FINAL_SECTION].declarations) {
    assert.equal(sealedBaseline.declarationHash(row), row.candidate_hash);
  }
});

test('sealed verifier preserves preparation logic rather than substituting weaker checks', () => {
  function definitions(source) {
    const parsed = ts.createSourceFile('guard.mjs', source, ts.ScriptTarget.Latest, true);
    return new Map(parsed.statements.filter(node => ts.isFunctionDeclaration(node))
      .map(node => [node.name.text, node.getText(parsed)]));
  }
  const current = definitions(actualReadSource('tests/helpers/consolidationSqlHistoryIntegrity.mjs').toString());
  const previous = definitions(unsealedHelperSource);
  assert.deepEqual([...current.keys()], [...previous.keys()]);
  for (const [name, body] of previous) assert.equal(current.get(name), body, name);
  assert.equal(hash(unsealedHelperSource), actualArtifact.verification_preparation.sha256);
});

test('Seventh does not admit Content OS or equate manual local success with release readiness', () => {
  const rows = [...actualArtifact.files, ...actualArtifact.new_candidates];
  assert.equal(rows.some(row => row.path === 'supabase/functions/content-os-morning-alpha-source/index.ts'), false);
  assert.equal(actualArtifact.scope_limits.global_legacy_blocking_zero, false);
  assert.equal(actualArtifact.scope_limits.release_ready, false);
  assert.equal(actualArtifact.scope_limits.automatic_stable_day, false);
  assert.equal(actualArtifact.scope_limits.production_operations, false);
  assert.equal(actualArtifact.scope_limits.production_sql_execution, false);
  assert.equal(actualArtifact.scope_limits.historical_success_claim, false);
  assert.equal(actualArtifact.scope_limits.readdy_host_build, 'NOT_VERIFIED');
  assert.equal(actualArtifact.review_evidence.actual_local_result.records, 96);
  assert.equal(actualArtifact.review_evidence.actual_local_result.manually_driven, true);
  assert.equal(actualArtifact.review_evidence.actual_local_result.automatic_stable_day, false);
  assert.equal(actualArtifact.review_evidence.database.pass, 24);
  assert.equal(actualArtifact.review_evidence.database.original_15_callbacks_byte_identical, true);
  assert.match(actualArtifact.approval_provenance, /Content OS.*not admitted or waived/);
});

function actualFixture() {
  const sourceMap = new Map();
  return {
    value: structuredClone(actualRegistry),
    artifact: structuredClone(actualArtifact),
    artifactBytes: Buffer.from(actualArtifactBytes),
    sourceMap,
    source: path => sourceMap.has(path) ? sourceMap.get(path) : actualReadSource(path),
  };
}
function actualVerify(f) {
  return resolveSealedIntegrity(f.value, f.artifactBytes, f.source, sixthArtifact);
}
function rewriteActualMutableMetadata(f) {
  f.artifactBytes = genericJson(f.artifact);
  const section = f.value[FINAL_SECTION];
  section.source_diff_reference.sha256 = hash(f.artifactBytes);
  section.source_diff_reference.patch_sha256 = f.artifact.source_diff.sha256;
  f.sourceMap.set(REGISTRY_PATH, Buffer.from(readSource(REGISTRY_PATH).toString().slice(0, -2)
    + ',\n  "' + FINAL_SECTION + '": ' + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n'));
}
const actualMutations = [
  ['missing Seventh registration', f => { delete f.value[FINAL_SECTION]; }],
  ['old Production baseline changed', f => { f.value.files[0].baseline_sha256 = '0'.repeat(64); }],
  ['Sixth registration rewritten', f => { f.value.core_delivery_test_wiring_registration.approval_id = 'UNREVIEWED'; }],
  ['unknown Content OS path admitted', f => { f.value[FINAL_SECTION].files[0].path = 'supabase/functions/content-os-morning-alpha-source/index.ts'; }],
  ['unknown SQL path admitted', f => { f.value[FINAL_SECTION].new_candidates[0].path = 'supabase/migrations/unreviewed.sql'; }],
  ['unknown Auth declaration admitted', f => { f.value[FINAL_SECTION].declarations[0].name = 'authorizeInternalRequest'; }],
  ['duplicate reviewed source', f => { f.value[FINAL_SECTION].files.push(f.value[FINAL_SECTION].files[0]); }],
  ['missing approved source', f => { f.value[FINAL_SECTION].new_candidates.pop(); }],
  ['artifact bytes changed', f => { f.artifactBytes = Buffer.concat([f.artifactBytes, Buffer.from(' ')]); }],
  ['missing newly registered SQL', f => { f.sourceMap.set('supabase/migrations/20260909015650_core_market_publication_contract.sql', undefined); }],
  ['missing local failure evidence', f => { f.sourceMap.set('tests/fixtures/consolidation-v1/local-failures/terminal-market-only-20260917.json', undefined); }],
  ['reviewed test successor hash waiver', f => { f.value[FINAL_SECTION].test_case_successors[0].candidate_hash = '0'.repeat(64); }],
  ['source plus artifact plus mutable hash forged together', f => {
    const path = 'supabase/functions/_shared/market-publication-contract.ts';
    const before = actualReadSource(path).toString();
    const after = before + '\n// UNREVIEWED: bypass durable publication evidence\n';
    f.sourceMap.set(path, Buffer.from(after));
    const candidateHash = hash(after);
    f.value[FINAL_SECTION].files.find(row => row.path === path).candidate_hash = candidateHash;
    f.artifact.files.find(row => row.path === path).candidate_hash = candidateHash;
    f.artifact.source_diff.patch_lines.push('+// UNREVIEWED: bypass durable publication evidence');
    f.artifact.source_diff.sha256 = hash(f.artifact.source_diff.patch_lines.join('\n'));
    rewriteActualMutableMetadata(f);
  }],
];
for (const field of ['production_operations_authorized', 'production_sql_execution_authorized', 'deploy_authorized',
  'merge_authorized', 'cron_changes_authorized', 'automatic_stability_day', 'historical_success_claim']) {
  actualMutations.push(['forbidden authority ' + field, f => { f.value[FINAL_SECTION][field] = true; }]);
}
for (const path of [
  'supabase/functions/_shared/market-publication-contract.ts',
  'supabase/functions/_shared/canonical-market-state.ts',
  'supabase/functions/_shared/content-intelligence.ts',
  'supabase/functions/_shared/closing-learning-contract.ts',
  'supabase/functions/generate-daily-report-v7/index.ts',
  'supabase/functions/get-report-payload/index.ts',
  'supabase/functions/_shared/internal-function-auth.mjs',
  'supabase/migrations/20260909015650_core_market_publication_contract.sql',
]) {
  actualMutations.push(['current receipt/evidence/runtime/Auth source drift ' + path, f => {
    const before = actualReadSource(path).toString();
    const after = path.endsWith('internal-function-auth.mjs')
      ? before.replace('export async function authorizeInternalRequest(headers, credentials = {}, now = new Date()) {',
        'export async function authorizeInternalRequest(headers, credentials = {}, now = new Date()) { /* unreviewed Auth policy */')
      : before + '\n// unreviewed current source\n';
    assert.notEqual(after, before);
    f.sourceMap.set(path, Buffer.from(after));
  }]);
}
for (const [path] of anchors) actualMutations.push(['immutable predecessor guard/artifact drift ' + path,
  f => { f.sourceMap.set(path, Buffer.concat([actualReadSource(path), Buffer.from('\n// forbidden predecessor change\n')])); }]);
for (const row of bodies) actualMutations.push(['original complete assertion body drift ' + row.path,
  f => { f.sourceMap.set(row.path, Buffer.concat([actualReadSource(row.path), Buffer.from('\n// forbidden original body change\n')])); }]);
for (const [name, mutate] of actualMutations) {
  test('actual sealed reader rejects ' + name, () => {
    assert.equal(sealedBaseline.protectedDeclarationCount, 698, 'Actual clean baseline must already pass');
    const f = actualFixture();
    mutate(f);
    assert.throws(() => actualVerify(f));
  });
}
