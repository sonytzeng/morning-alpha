// Ninth source admission verifies every reviewed live byte before reconstructing
// the exact Eighth predecessor. No runtime, release or Production authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';

export const REQUIRED_MARKET_ARTIFACT_PATH = 'docs/operations/evidence/core-required-market-input-20260910.json';
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const EIGHTH_ARTIFACT_PATH = 'docs/operations/evidence/core-consolidation-public-export-20260909.json';
const EIGHTH_GUARD_PATH = 'tests/helpers/consolidationPublicExportIntegrity.mjs';
const MANIFEST_PATH = 'docs/operations/core-stability-source-manifest-20260907.json';
const PREVIOUS_REGISTRY = 'adab1af6cc1099536c16b3704cbdaaae8f41f27c1243a6c485b40e0be2cc9411';
const PREVIOUS_ARTIFACT = 'f0f4a1a7d5b72d45841f1910ef5ccd8c3b390c4488f78b82ccf3e687ee17b2f1';
const PREVIOUS_GUARD = 'a9a11fbfeb230ac98ef92c84a6dfa688b10e309b7230fad7ef96aa0a51ea2369';
const MANIFEST = 'bf1b697f3a20f5e1b1f558a730ed18805af5e0144cc80651f66c334d1725054c';
const SECTION_KEY = 'core_required_market_input_registration';
const APPROVAL_ID = 'CORE_REQUIRED_MARKET_INPUT_APPEND_20260910';
const BASE = '6469630795fb1215595306c026437d850b668801';
const FINAL_SEAL = Object.freeze({
  "artifact": "59425c6ad3d7a5e1e7ba4d37a3fcd7580f1b7b12f256a8aa22c42d25ed8eb25b",
  "section": "cd15130c79ddab5733234927c82bf3ff02ef9199671ee9fe035d806b8c50c028",
  "paths": [
    "supabase/functions/generate-daily-report-v7/index.ts",
    "tests/consolidationGeneratorEditorial.test.mjs",
    "tests/consolidationPublicExportIntegrity.test.mjs",
    "tests/dataTruthBoundaries.test.mjs",
    "tests/helpers/consolidationPublicExportIntegrity.mjs"
  ],
  "declarations": [
    "supabase/functions/generate-daily-report-v7/index.ts:checkMVPStatus"
  ],
  "preserved_test_bodies": [
    {
      "path": "tests/consolidationPublicExportIntegrity.test.mjs",
      "marker": "// Independently reviewed immutable pins.",
      "sha256": "19b5b68f5881c3edf4f2bd1c80e4c122618ff825784c1c6d1629faa00188c3d9"
    }
  ],
  "additive_test_statements": [
    {
      "path": "tests/dataTruthBoundaries.test.mjs",
      "original_statement_hashes": [
        "ec045cf35aa871c9983950b6818fa747f2c63444d76c1a693e8c41a961d51c9f",
        "5a7c8530fd11d2f718e188a5326d474b8a0241b26b7185762cb81537752cdd34",
        "3b2bda0cddaf5960093593ed9cacf5b52ba9fe2595542e0357d1305b08d93646",
        "4ed6ac8ecb1c90a6ff6cdb2edb233a1371ad89d3e7bcefa5191b9c02d4032351",
        "eeac639d93ac692157adf68fd8e425b07e70e930f7d2467902b5636d3ed19470",
        "f5dfcb61697b6cb52d87e0a5a502b5641ef82e8199c32a8463a5deb426a2cf09",
        "213bd183d6e1292310f97ab01eb85dbba083ad59d4164a464d8606f2a3e7a757",
        "c42e5a41e33fbfe190a162d42ff1b0ba72bdc0f85780ede65a42cb38b9ffac24",
        "d1ce28f77e9fdecf50caaa5ecd5b83ae883caaba263c9b244cd39d4872938688",
        "c6078457a50cccbac2881b6d69a3cddd0a882c175096abedd56700e39352473a",
        "6f0538ca45fe0782d7f31e1ca331f30400b2ee7235bc2e8073c1e39e87b43d5b"
      ],
      "added_statement_count": 13
    },
    {
      "path": "tests/consolidationGeneratorEditorial.test.mjs",
      "original_statement_hashes": [
        "6a6d66131948f260defff2f2a526cfa2611cb7744d8ff71658af257ab0a465e3",
        "10f5ddda9e6dad507883dde17733c09b20b2315b7d828ae95e5b6c923f26fac0",
        "524805d8456794a1b3865b6a844d3f661b54530c7de7b909c1c83c5c11b1c1bf",
        "7f508258ae5bb0fa9ed10a2c278947d045867c7041d3b3ffa3c61650df3ef28e",
        "97a40a4ed5ed2646cab87101f625cacfb507d9f7ad8635d984f3c7f8ff293535",
        "c715057b787bc17b4486d106f0de12f1aa7bed1111b4a7b5640e0f218f4d0aee",
        "f5b10ec3f1ea512c86ae60c7b82d6049dcdc4994ed7c8e47e6fe46d9d6eb0735",
        "180d414d096e854d9a83657a007ca5b0788eea4fabcc62f191cefc8b5460dfb2",
        "fd3c32906975d427744b98dc2525834372950d86a70c3211402ceeb30814dcb4",
        "6059cd5a9bc8595f3ff3867b6701bbbb37914cbf2e3ee8fea0c2e64c88805aef",
        "8e306d9bb61fa392cf0f0ad267ec02dfd31799bafead8e9cc008af8845b83a82",
        "2849930c420cc416afb19cc2cb3f935a92273afaf1209f84a612a1ab0552b7e7",
        "87066c1f35886e8717a231484117aa6381b8e82d7248c6450076f1f0a4a43530",
        "e72516190277fa85bb307cc5dacce555b07b43b0a94dffd8df9720d401e03e20",
        "03ec4313caeb17f25ab56ea31487135dbf8d5006b8f1692d07b9f03f677c3427",
        "5308fa237245916f1e8d9777ed26107f6ead00a55f14acd3c53c63e1def5f2aa",
        "bcf05cbd9ea9eb0a76f18291eecaebe4c437264291da22a560b3862901d9b406",
        "08469f67f37b4c4e843084db4b707d7ac1ff3d195dba24fb57ed390854c2f5b1",
        "2ca976efd73d266e99182a15f248294239ff1dd66a840c40113cac2611ca142a",
        "fdf998b668cf368f1a0475ea74e9663a3b43cff402674c3907e270022dcc118e",
        "cb24f56b27cfc476e0243c32827a7cc126c35b14a27c4f9b54f1809ddf405e92",
        "52ed8526ef7f1773f05ce07b39b2394c54f7fa69d80e7e9052d4fe2d08b76aee",
        "57b7336536b9bc873001d1a624d632eadfb62169ee4017a65b509ac85741f832",
        "fc3cff1daaf79000dbe3890a6cfec9030878bfaa2719fb4b44068defa8696a5c",
        "887c5fd9ca06188ef49bd0f8e18c7427bf061b09835ee165ea0763e2d5e592c2",
        "37b2ae346e7c4edc63c9763c1f244aa72593b247f61e6750cec595d490c2a6fe",
        "d87c01cb55e0a96e0e39b12d62784debd04cc3c147fecd57106a7b51aee7c255",
        "ebab876e5daab3689c1c901f46187f003ccb5f2a43f50d260b59e5a1355c9991",
        "68993f8487189e6c4f7954b45e2d0622214ac6fefb7076c8b1abdc0bcc189846",
        "f28bc4271648e5d5e943094edf4eb9e8254f67b51c1e570352bf9f614df8f8a9",
        "5a5feab52a8dc883d4dfe797b98bfb5a95cdc56c299cb10a5f394b3cce4f0d73",
        "a0e5568cbdd4e51beb7858e634e25104954928651dd3a42639fd9bd0d4eda79f"
      ],
      "added_statement_count": 25
    }
  ],
  "eighth_verifier": "a41c7fc33df538798ddc5b21b2cc2b9d59794329249a64d5b52a96053cdb612d"
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');

// The builder inserts byte-identical exactSet, declarations, cases and
// verifyExactSourceDiff utility declarations from the frozen Eighth helper here.
function exactSet(actual, expected, message) {
  assert.ok(Array.isArray(actual) && Array.isArray(expected), message);
  assert.equal(new Set(actual).size, actual.length, message + ' duplicates');
  assert.deepEqual([...actual].sort(), [...expected].sort(), message);
}
function declarations(path, bytes) {
  const parsed = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const result = new Map();
  for (const node of parsed.statements) {
    const name = node.name?.getText(parsed)
      || node.declarationList?.declarations.map(item => item.name.getText(parsed)).join(',');
    if (!name) continue;
    assert.equal(result.has(name), false, 'duplicate protected declaration');
    result.set(name, node.getText(parsed));
  }
  return result;
}
function cases(path, bytes) {
  const parsed = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const found = parsed.statements.filter(node => ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === 'test');
  const result = new Map();
  for (const node of found) {
    const name = node.expression.arguments[0]?.text;
    assert.equal(typeof name, 'string', 'only explicit named reviewed test cases');
    assert.ok(!result.has(name), 'duplicate test case: ' + name);
    result.set(name, node.getText(parsed));
  }
  return result;
}

function verifyExactSourceDiff(row, before, after, diff) {
  assert.equal(before.toString().endsWith('\n'), row.original_ends_with_newline);
  assert.equal(after.toString().endsWith('\n'), row.candidate_ends_with_newline);
  const lines = diff.split('\n');
  assert.equal(lines.shift(), '--- a/' + row.path);
  assert.equal(lines.shift(), '+++ b/' + row.path);
  const previous = before.length ? before.toString().replace(/\n$/, '').split('\n') : [];
  const result = []; let cursor = 0, index = 0, count = 0;
  while (index < lines.length) {
    if (lines[index] === '' && index === lines.length - 1) break;
    const hunk = lines[index++].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    assert.ok(hunk, 'exact bounded unified source diff'); count++;
    const oldCount = Number(hunk[2] ?? 1), newCount = Number(hunk[4] ?? 1);
    const oldStart = Number(hunk[1]) - (oldCount ? 1 : 0);
    const newStart = Number(hunk[3]) - (newCount ? 1 : 0);
    assert.ok(oldStart >= cursor && oldStart <= previous.length);
    result.push(...previous.slice(cursor, oldStart));
    assert.equal(result.length, newStart, 'new hunk offset');
    const oldLines = [], newLines = [];
    while (index < lines.length && !lines[index].startsWith('@@ ')) {
      const line = lines[index++];
      if (line === '' && index === lines.length) break;
      if (line === '\\ No newline at end of file') continue;
      assert.ok([' ', '+', '-'].includes(line[0]), 'supported unified diff line');
      if (line[0] !== '+') oldLines.push(line.slice(1));
      if (line[0] !== '-') newLines.push(line.slice(1));
    }
    assert.equal(oldLines.length, oldCount); assert.equal(newLines.length, newCount);
    assert.deepEqual(previous.slice(oldStart, oldStart + oldCount), oldLines, 'exact predecessor diff context');
    result.push(...newLines); cursor = oldStart + oldCount;
  }
  assert.ok(count > 0, 'nonempty reviewed source diff');
  result.push(...previous.slice(cursor));
  assert.deepEqual(Buffer.from(result.join('\n') + (row.candidate_ends_with_newline ? '\n' : '')), after,
    'reviewed diff must reproduce the complete live candidate');
}


export function resolveConsolidationRequiredMarketIntegrity(registry, eighthArtifactBytes, readSource, verifyEighth) {
  if (FINAL_SEAL === null) throw Object.assign(new Error('NINTH_REVIEWED_SOURCE_FREEZE_REQUIRED'),
    { code: 'NINTH_REVIEWED_SOURCE_FREEZE_REQUIRED' });
  assert.ok(Object.isFrozen(FINAL_SEAL), 'independent reviewed Ninth seal required');
  assert.ok(registry && Object.hasOwn(registry, SECTION_KEY), 'complete Ninth registration is required');
  const section = registry[SECTION_KEY];
  assert.ok(section && typeof section === 'object' && !Array.isArray(section), 'complete Ninth registration is required');
  const cached = new Map();
  const source = path => {
    if (!cached.has(path)) cached.set(path, Buffer.from(readSource(path)));
    return cached.get(path);
  };
  const artifactBytes = source(REQUIRED_MARKET_ARTIFACT_PATH);
  assert.equal(hash(artifactBytes), FINAL_SEAL.artifact, 'Ninth immutable independently pinned artifact');
  const artifact = JSON.parse(artifactBytes);
  assert.equal(jsonHash(section), FINAL_SEAL.section, 'Ninth independently fixed registration');
  assert.deepEqual(section, artifact.registration, 'Ninth artifact/registration equality');
  assert.equal(section.approval_id, APPROVAL_ID);
  assert.equal(section.candidate_base_git_sha, BASE);
  assert.equal(section.previous_complete_registry_sha256, PREVIOUS_REGISTRY);
  assert.ok(section.approval_provenance?.length > 100);
  for (const flag of ['production_operations', 'production_sql_execution', 'external_delivery_verified',
    'natural_stability_claim', 'auth_change', 'acl_change', 'readdy_host_verified', 'release_ready']) {
    assert.equal(section[flag], false, 'Ninth does not grant ' + flag);
  }
  const raw = source(REGISTRY_PATH).toString();
  assert.deepEqual(JSON.parse(raw), registry, 'supplied and actual Ninth registry differ');
  const suffix = ',\n  "' + SECTION_KEY + '": '
    + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(raw.endsWith(suffix), 'Ninth append-only registry suffix');
  const oldRegistryBytes = Buffer.from(raw.slice(0, -suffix.length) + '}\n');
  assert.equal(hash(oldRegistryBytes), PREVIOUS_REGISTRY, 'all eight previous registry layers unchanged');
  const oldRegistry = JSON.parse(oldRegistryBytes);
  assert.equal(hash(source(EIGHTH_ARTIFACT_PATH)), PREVIOUS_ARTIFACT, 'Eighth artifact unchanged');
  assert.deepEqual(Buffer.from(eighthArtifactBytes), source(EIGHTH_ARTIFACT_PATH), 'exact supplied Eighth artifact');
  assert.equal(hash(source(MANIFEST_PATH)), MANIFEST, 'Production 698-declaration inventory unchanged');
  const rows = section.files;
  exactSet(rows.map(row => row.path), FINAL_SEAL.paths, 'Ninth exact reviewed live source set');
  exactSet(Object.keys(artifact.source_diffs), FINAL_SEAL.paths, 'Ninth complete source diffs');
  exactSet(Object.keys(artifact.preimages), rows.filter(row => row.original_hash !== null).map(row => row.path),
    'Ninth complete exact predecessor preimages');
  const restored = new Map();
  // Every live row is authenticated before any predecessor verifier is invoked.
  for (const row of rows) {
    assert.match(row.path, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/);
    assert.ok(!row.path.split('/').includes('..') && !row.path.includes(' 2.'));
    assert.ok(row.reason?.length > 20 && row.rollback_target?.length > 15);
    assert.equal(row.approval_provenance, section.approval_provenance);
    assert.equal(hash(source(row.path)), row.candidate_hash, 'unreviewed Ninth live source drift: ' + row.path);
    assert.equal(hash(artifact.source_diffs[row.path]), row.diff_hash, 'Ninth exact reviewed diff: ' + row.path);
    const before = row.original_hash === null ? Buffer.alloc(0)
      : gunzipSync(Buffer.from(artifact.preimages[row.path], 'base64'));
    if (row.original_hash !== null) {
      assert.equal(hash(before), row.original_hash, 'Ninth exact old source: ' + row.path);
      assert.notEqual(row.original_hash, row.candidate_hash, 'no unnecessary source waiver');
    }
    verifyExactSourceDiff(row, before, source(row.path), artifact.source_diffs[row.path]);
    restored.set(row.path, row.original_hash === null ? null : before);
    assert.equal(row.production_hash, oldRegistry.files.find(item => item.path === row.path)?.baseline_sha256 ?? null,
      'original Production file hash retained');
  }
  const eighthReadSource = path => {
    if (path === REGISTRY_PATH) return oldRegistryBytes;
    if (!restored.has(path)) return source(path);
    const bytes = restored.get(path);
    if (bytes !== null) return bytes;
    throw Object.assign(new Error('Ninth-new file absent from Eighth: ' + path), { code: 'ENOENT' });
  };
  assert.equal(hash(eighthReadSource(EIGHTH_GUARD_PATH)), PREVIOUS_GUARD, 'entire original Eighth helper is recoverable');
  assert.deepEqual(section.preserved_test_bodies, FINAL_SEAL.preserved_test_bodies, 'exact historical test body inventory');
  for (const row of section.preserved_test_bodies) {
    for (const bytes of [source(row.path), eighthReadSource(row.path)]) {
      const text = bytes.toString(), offset = text.indexOf(row.marker);
      assert.ok(offset >= 0); assert.equal(hash(text.slice(offset)), row.sha256, 'all original Eighth tests and pins unchanged');
    }
  }
  assert.deepEqual(section.additive_test_statements, FINAL_SEAL.additive_test_statements,
    'independently fixed additive-only focused test inventory');
  for (const row of section.additive_test_statements) {
    const statements = bytes => ts.createSourceFile(row.path, bytes.toString(), ts.ScriptTarget.Latest, true)
      .statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText());
    const before = statements(eighthReadSource(row.path)), after = statements(source(row.path));
    assert.deepEqual(before.map(hash), row.original_statement_hashes, 'all historical focused statements pinned');
    let cursor = 0;
    for (const statement of before) {
      const index = after.indexOf(statement, cursor);
      assert.ok(index >= cursor, 'historical test/helper statement removed or changed: ' + row.path);
      cursor = index + 1;
    }
    assert.equal(after.length - before.length, row.added_statement_count, 'exact focused statement additions');
  }
  const oldVerifier = declarations(EIGHTH_GUARD_PATH, eighthReadSource(EIGHTH_GUARD_PATH)).get('verifyPublicExport');
  const liveVerifier = declarations(EIGHTH_GUARD_PATH, source(EIGHTH_GUARD_PATH)).get('verifyPublicExport');
  assert.equal(oldVerifier, liveVerifier, 'original verifyPublicExport declaration byte-identical');
  assert.equal(hash(oldVerifier), FINAL_SEAL.eighth_verifier, 'independent original Eighth verifier pin');
  const manifest = JSON.parse(source(MANIFEST_PATH));
  assert.equal(manifest.protected_declarations.length, 698);
  const oldDeclarations = new Map(), currentDeclarations = new Map(), changed = [], overrides = new Map();
  for (const item of manifest.protected_declarations) {
    if (!oldDeclarations.has(item.path)) oldDeclarations.set(item.path, declarations(item.path, eighthReadSource(item.path)));
    if (!currentDeclarations.has(item.path)) currentDeclarations.set(item.path, declarations(item.path, source(item.path)));
    const before = oldDeclarations.get(item.path).get(item.name), after = currentDeclarations.get(item.path).get(item.name);
    assert.equal(typeof before, 'string'); assert.equal(typeof after, 'string');
    const approved = section.declarations.find(row => row.path === item.path && row.name === item.name);
    if (before === after) { assert.equal(approved, undefined, 'unnecessary Ninth protected declaration waiver'); continue; }
    assert.ok(approved, 'unreviewed Ninth protected declaration: ' + item.path + ':' + item.name);
    assert.equal(approved.production_hash, item.production_sha256);
    assert.equal(approved.original_hash, hash(before)); assert.equal(approved.candidate_hash, hash(after));
    assert.ok(approved.reason?.length > 20 && approved.rollback_target?.length > 15);
    changed.push(item.path + ':' + item.name); overrides.set(item.path + ':' + item.name, approved.candidate_hash);
  }
  exactSet(changed, FINAL_SEAL.declarations, 'Ninth exact changed protected declaration set');
  exactSet(section.declarations.map(row => row.path + ':' + row.name), FINAL_SEAL.declarations, 'Ninth exact declared protected set');
  assert.deepEqual(section.test_case_successors, [], 'Ninth does not change historical test expectations');
  // This callback is fixed in the hashed Eighth entry route, never a registry
  // or runtime data field. The original Eighth verifier recursively checks all
  // original eight layers against the fully authenticated predecessor bytes.
  assert.equal(typeof verifyEighth, 'function');
  const eighth = verifyEighth(oldRegistry, source(EIGHTH_ARTIFACT_PATH), eighthReadSource);
  const fileOverrides = new Map(rows.map(row => [row.path, row.candidate_hash]));
  return { ...eighth, eighthRegistry: oldRegistry, eighthReadSource,
    verifyEighth: (r, a, read = eighthReadSource) => verifyEighth(r, a, read),
    fileHash: row => fileOverrides.get(row.path) ?? eighth.fileHash(row),
    declarationHash: row => overrides.get(row.path + ':' + row.name) ?? eighth.declarationHash(row),
    newCandidatePaths: [...new Set([...eighth.newCandidatePaths, ...rows.filter(row => row.original_hash === null).map(row => row.path)])],
  };
}
