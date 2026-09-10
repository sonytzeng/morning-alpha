// Eleventh admission is test-only: preserve the exact ten-layer predecessor.
// It grants no runtime, Production, SQL execution, Auth or release authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';

export const ACCEPTANCE_DEFAULT_ARTIFACT_PATH = 'docs/operations/evidence/core-acceptance-default-v1-20260910.json';
const REGISTRY = 'docs/operations/core-stability-incident-amendment-20260908.json';
const ENTRY = 'tests/helpers/consolidationPublicExportIntegrity.mjs';
const TENTH_GUARD = 'tests/helpers/consolidationFixtureRepresentation.mjs';
const TENTH_ARTIFACT = 'docs/operations/evidence/core-fixture-representation-20260910.json';
const EIGHTH_ARTIFACT = 'docs/operations/evidence/core-consolidation-public-export-20260909.json';
const SQL = 'supabase/migrations/20260909015650_core_market_publication_contract.sql';
const DATABASE_TEST = 'tests/coreConsolidationDatabase.integration.mjs';
const FIXTURE = 'tests/fixtures/core-production-acceptance-v1.json';
const HISTORICAL_TEST = 'tests/consolidationFixtureRepresentation.test.mjs';
const SECTION = 'core_acceptance_default_v1_registration';
const PREVIOUS_REGISTRY = '188a0b57dc9c3363dce9f73a20737c927bbaca068909edbdfdb98cd253d88e35';
const FINAL_SEAL = Object.freeze({
  "artifact": "17c43a104b1276b26322c50f1e6d61bd61fa1edb3071a36c07da3cd775c162b2",
  "section": "32d77012dbebd1ce0bf6aa9d7ab811c3a29361bc6e1b929e64f126a99d573404",
  "paths": [
    "supabase/migrations/20260909015650_core_market_publication_contract.sql",
    "tests/consolidationFixtureRepresentation.test.mjs",
    "tests/coreConsolidationDatabase.integration.mjs",
    "tests/fixtures/core-production-acceptance-v1.json",
    "tests/helpers/consolidationPublicExportIntegrity.mjs"
  ],
  "database_callbacks": [
    {
      "name": "CI adapter accepts only the exact local job service and leaves ordinary loopback authority unchanged",
      "sha256": "79ba0211c4b8857dcd46ecfad5966160a13a2661ea74e76c0ddf39231465e00f"
    },
    {
      "name": "named migration twice preserves five RPC signatures/defaults/owner/private ACL/security/search_path and original trigger/RLS",
      "sha256": "4490aa38ce745121dfe9904d1c512ff920cd69c7bf5fc816e8e9843e952b484d"
    },
    {
      "name": "market READY with private recommendation 76 percent and five unsupported claims publishes atomically without stocks",
      "sha256": "eee4e6bbf0729a111fca7257b844ae63e8a03115a135ded13bce46a28322e907"
    },
    {
      "name": "stale/missing/wrong identity and unsupported market evidence reject validator and roll back publication",
      "sha256": "2d9baeca545fe0c905dbade3fa8cd0cbd38252dae817d682e72b9b4eb79b5adb"
    },
    {
      "name": "TS and SQL require the same exact evidence ID union and real producer freshness context",
      "sha256": "5b2c2b8fff3e30da31e3ad868433c117e73db3c7481ca8d410b34e9f53137b0b"
    },
    {
      "name": "actual member-insert failure rolls back all publication rows and keeps the original successful receipt",
      "sha256": "ac9deddc1f2a61bbe35a6b9e8e8f636b8c5251db17b7609922da32ca2e583468"
    },
    {
      "name": "direct v3/member RPCs cannot bypass canonical market, semantic or identity gates",
      "sha256": "f3ea9834ab75e5d51451355ba57f6bfb552a02fc8e8694ba86f02d5f7b483dc1"
    },
    {
      "name": "historical timing fixtures bind real opening receipt, durable close rows and market learning; raw completed JSON alone never passes",
      "sha256": "010c77a825c9ba9c5ab9de68d495ea5e6cb51d97c9c2afe3ffd9533cb7b0bbea"
    },
    {
      "name": "a later real atomic publication preserves the original opening and its Closing/Learning/LINE evidence",
      "sha256": "412f22c27d45d8d755310ee4bc1cb97c4d352ffa4803678c83b1710bec55f912"
    },
    {
      "name": "closing/learning wrong revision, missing raw price/source, malformed time and JSON-only completion remain fail-closed",
      "sha256": "3d16f3f27a9b530ccb10d728897418a6591aba6e8da91505ecd903e3cf294a16"
    },
    {
      "name": "private current QA cannot override frozen market, while exact raw checkpoint/correlation/version remains mandatory",
      "sha256": "bcddfae206676be0f6b897135406696bbb88c26f286dff7cf56813565d29b54a"
    },
    {
      "name": "scheduled label alone is not natural execution; exact scheduler receipt still cannot turn historical replay or Recovery into a stable day",
      "sha256": "ad8cf50fe0a74b7ab89844bcbc16dfdddb63b9bae19bd6fe7a963a9ab00140c3"
    },
    {
      "name": "original historical FAIL rows and private business-table permissions survive all isolated observations",
      "sha256": "240642b4ddd1907aa68f2a12b67d5cc91e7f8a0f96f2290c634558f2ac716779"
    },
    {
      "name": "actual company admission and audited research preserve a qualified stock through the same atomic SQL path",
      "sha256": "71a51a5c36ac17fcabd61202fcd912c2d7e5e28f0273c6fe32ec8cfc94a76340"
    },
    {
      "name": "concurrent calls to the final atomic publication RPC return one committed decision and member revision",
      "sha256": "041327cb605bfec73fde8ad42a9cea974b741f828b0069769b2e1a02b118c9b4"
    },
    {
      "name": "sixth terminal RPC preserves its exact original private catalog contract across both candidate applications",
      "sha256": "0956392c4832bfa383d29e7e34083318979a2af7955767dcd8d836f820178a2d"
    },
    {
      "name": "a real committed market-only publication returns terminal zero without inventing delivery, lifecycle or Acceptance",
      "sha256": "7eee07bfde749520c313892fbff57055be22fec698863467fbb2f154b3ba7dee"
    },
    {
      "name": "terminal publication proof rejects missing or wrong durable identities, semantic rows and frozen evidence atomically",
      "sha256": "f15bad2d3737da2c627192465007b15edb916926f6948f3905ffd13cfd82a306"
    },
    {
      "name": "receipt-bound member diagnostic scores and status do not become a second market publication gate",
      "sha256": "51262faff339cb0fea3ba2ea985e768c97e85f7e98be1ca5ef3ecae0c6c9fabb"
    },
    {
      "name": "new current private QA cannot replace a committed market-only terminal authority",
      "sha256": "9febd83c27e8fc4396c38961b5d1b1c30dd85f476bd652124b666a21c58a773f"
    },
    {
      "name": "Acceptance independently rejects frozen quality and co-mutated opening canonical identities",
      "sha256": "7eef9c61c768e53d3aedaaae60213f105c3f81cb9006927cbf5dbb2232dada09"
    },
    {
      "name": "terminal replacement retains exact same-job/checkpoint/endpoint/later-success rules and original failed attempts",
      "sha256": "336bb31c66f92c8d9685e1ed14d3c1f280beb2cb38dbd8f8af3fd53221d36a89"
    },
    {
      "name": "terminal repair rolls back if durable dead-letter persistence fails after dispatch reconciliation",
      "sha256": "f2c5206fd1a655134a30d0a2ffafe61028bb5bac4dd4198c08402a571d141929"
    },
    {
      "name": "concurrent terminal calls repair once without duplicate dispatch or artificial natural stability",
      "sha256": "e9f5cf542021c879a0c4fb73d503e6f825fe8c9356fd1c5fa3d5051c3db5e96f"
    }
  ],
  "added_database_tests": [
    "captured Production Acceptance V1 baseline is exact and survives candidate apply and reapply without authority changes",
    "the pinned c088 V3 candidate fails authority audit on Production V1 and rolls back the entire migration",
    "the preserved Production V1 default executes the actual Acceptance closure and keeps missing frozen evidence fail-closed"
  ],
  "tenth_test_tail": "4ec486730453bfeaf0bbfda05059893a82490904b36667c0e86176c93992c748"
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value, null, 2) + '\n');
const exactSet = (actual, expected, label) => {
  assert.ok(Array.isArray(actual) && Array.isArray(expected), label);
  assert.equal(new Set(actual).size, actual.length, label + ' duplicates');
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
};

export function assertAcceptanceDefaultSuccessor(before, after) {
  const original = Buffer.from(before).toString(), candidate = Buffer.from(after).toString();
  const oldDefault = "p_evaluator_version text default 'PRODUCTION_ACCEPTANCE_V3'";
  const newDefault = "p_evaluator_version text default 'PRODUCTION_ACCEPTANCE_V1'";
  assert.equal(hash(original), '353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0', 'exact rejected c088 SQL predecessor');
  assert.equal(original.split(oldDefault).length, 2, 'exactly one original default');
  assert.equal(candidate.split(newDefault).length, 2, 'exactly one Production-compatible V1 default');
  assert.equal(candidate, original.replace(oldDefault, newDefault), 'only the single captured default may change');
  assert.equal(hash(candidate), '32e940f48ed7590638992c1503e0a9b472a628149710d7aadb92489476f68433', 'exact reviewed V1 SQL');
}

function callbacks(bytes) {
  const parsed = ts.createSourceFile(DATABASE_TEST, bytes.toString(), ts.ScriptTarget.Latest, true);
  const result = new Map();
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'test') {
      const name = node.arguments[0]?.text;
      assert.equal(typeof name, 'string', 'exact named database test');
      assert.ok(!result.has(name), 'duplicate database test');
      result.set(name, node.arguments.at(-1).getText(parsed));
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return result;
}

function declaration(bytes, name) {
  const parsed = ts.createSourceFile(ENTRY, bytes.toString(), ts.ScriptTarget.Latest, true);
  const matches = parsed.statements.filter(node => node.name?.getText(parsed) === name);
  assert.equal(matches.length, 1, 'one exact protected declaration');
  return matches[0].getText(parsed);
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

export function resolveConsolidationAcceptanceDefaultIntegrity(registry, eighthArtifactBytes, readSource, verifyTenth) {
  assert.ok(registry && Object.hasOwn(registry, SECTION), 'complete Eleventh registration required');
  const section = registry[SECTION];
  assert.ok(section && typeof section === 'object' && !Array.isArray(section), 'complete Eleventh registration required');
  const cached = new Map();
  const source = path => { if (!cached.has(path)) cached.set(path, Buffer.from(readSource(path))); return cached.get(path); };
  const artifactBytes = source(ACCEPTANCE_DEFAULT_ARTIFACT_PATH);
  assert.equal(hash(artifactBytes), FINAL_SEAL.artifact, 'Eleventh independently pinned artifact');
  const artifact = JSON.parse(artifactBytes);
  assert.equal(artifact.schema_version, 'CORE_ACCEPTANCE_DEFAULT_V1_ADMISSION');
  assert.equal(jsonHash(section), FINAL_SEAL.section, 'Eleventh independently fixed registration');
  assert.deepEqual(section, artifact.registration, 'Eleventh artifact/registry equality');
  assert.equal(section.candidate_base_git_sha, 'c0885967b160120f9e65666c1406fafd21cf61aa');
  assert.equal(section.approval_id, 'CORE_ACCEPTANCE_PRODUCTION_DEFAULT_V1_APPEND');
  assert.ok(section.approval_provenance.length > 100);
  for (const key of ['production_operations', 'production_sql_execution', 'auth_change', 'acl_change',
    'runtime_raw_hash_waiver', 'external_delivery_verified', 'natural_stability_claim', 'release_ready']) {
    assert.equal(section[key], false, 'Eleventh grants no ' + key);
  }
  const raw = source(REGISTRY).toString();
  assert.deepEqual(JSON.parse(raw), registry, 'supplied and physical registry equality');
  const suffix = ',\n  "' + SECTION + '": ' + JSON.stringify(section, null, 2).split('\n').join('\n  ') + '\n}\n';
  assert.ok(raw.endsWith(suffix), 'exact Eleventh append-only suffix');
  const previousBytes = Buffer.from(raw.slice(0, -suffix.length) + '}\n');
  assert.equal(hash(previousBytes), PREVIOUS_REGISTRY, 'all ten registry layers unchanged');
  assert.equal(section.previous_complete_registry_sha256, PREVIOUS_REGISTRY);
  assert.deepEqual(gunzipSync(Buffer.from(artifact.previous_complete_registry_gzip_base64, 'base64')), previousBytes);
  assert.equal(hash(source(TENTH_GUARD)), '095275513e40d172b8214408ac62cc219840cda8c012f6dbb73fbf3e34ed08ac', 'entire Tenth verifier unchanged');
  assert.equal(hash(source(TENTH_ARTIFACT)), '6595d0e89d2ef0843420fce4e810cb76bd9ac0a78e6a42b9092062a0c956dae1', 'entire Tenth artifact unchanged');
  assert.equal(hash(source(EIGHTH_ARTIFACT)), 'f0f4a1a7d5b72d45841f1910ef5ccd8c3b390c4488f78b82ccf3e687ee17b2f1');
  assert.deepEqual(Buffer.from(eighthArtifactBytes), source(EIGHTH_ARTIFACT));
  exactSet(section.files.map(row => row.path), FINAL_SEAL.paths, 'exact five admitted source rows');
  exactSet(Object.keys(artifact.source_diffs), FINAL_SEAL.paths, 'complete exact source diffs');
  exactSet(Object.keys(artifact.preimages), section.files.filter(row => row.original_hash !== null).map(row => row.path), 'complete original source preimages');
  const previousRegistry = JSON.parse(previousBytes), restored = new Map();
  for (const row of section.files) {
    assert.equal(hash(source(row.path)), row.candidate_hash, 'unreviewed Eleventh live source drift: ' + row.path);
    assert.equal(source(row.path).length, row.candidate_bytes);
    assert.equal(hash(artifact.source_diffs[row.path]), row.diff_hash, 'exact reviewed source diff');
    assert.equal(row.approval_provenance, section.approval_provenance);
    assert.ok(row.reason.length > 20 && row.rollback_target.length > 15);
    const before = row.original_hash === null ? Buffer.alloc(0) : gunzipSync(Buffer.from(artifact.preimages[row.path], 'base64'));
    assert.equal(before.length, row.original_bytes);
    if (row.original_hash !== null) {
      assert.equal(hash(before), row.original_hash, 'exact source predecessor');
      assert.notEqual(row.original_hash, row.candidate_hash, 'no unchanged-source waiver');
    }
    assert.equal(row.production_hash, previousRegistry.files.find(item => item.path === row.path)?.baseline_sha256 ?? null, 'original Production hash unchanged');
    verifyExactSourceDiff(row, before, source(row.path), artifact.source_diffs[row.path]);
    restored.set(row.path, row.original_hash === null ? null : before);
  }
  const tenthReadSource = path => {
    if (path === REGISTRY) return previousBytes;
    if (!restored.has(path)) return source(path);
    const bytes = restored.get(path);
    if (bytes !== null) return bytes;
    throw Object.assign(new Error('Eleventh-new file absent from Tenth'), { code: 'ENOENT' });
  };
  assertAcceptanceDefaultSuccessor(tenthReadSource(SQL), source(SQL));
  const fixture = JSON.parse(source(FIXTURE));
  assert.equal(fixture.schema_version, 'PRODUCTION_ACCEPTANCE_BASELINE_V1');
  assert.equal(fixture.source.contains_business_rows, false);
  assert.equal(hash(fixture.function.definition), '7ce49074d08cfcd79cea707615ff16ca0818f2bcc28df487e6bf88251dce8063');
  assert.equal(fixture.source.definition_sha256, hash(fixture.function.definition));
  assert.deepEqual({ ...fixture.function, definition: undefined }, {
    regprocedure: 'capture_morning_alpha_acceptance_v1(date,text)', definition: undefined,
    owner: 'postgres', acl: '{postgres=X/postgres,service_role=X/postgres}', security_definer: true,
    settings: ['search_path=""'], arguments: "p_business_date date, p_evaluator_version text DEFAULT 'PRODUCTION_ACCEPTANCE_V1'::text", result: 'uuid',
  });
  const oldCallbacks = callbacks(tenthReadSource(DATABASE_TEST)), newCallbacks = callbacks(source(DATABASE_TEST));
  assert.equal(oldCallbacks.size, 24); assert.equal(newCallbacks.size, 27);
  assert.deepEqual([...oldCallbacks].map(([name, body]) => ({ name, sha256: hash(body) })), FINAL_SEAL.database_callbacks);
  for (const [name, body] of oldCallbacks) assert.equal(newCallbacks.get(name), body, 'all original 24 database callbacks unchanged');
  exactSet([...newCallbacks.keys()].filter(name => !oldCallbacks.has(name)), FINAL_SEAL.added_database_tests, 'exact three Production default regressions');
  for (const bytes of [source(HISTORICAL_TEST), tenthReadSource(HISTORICAL_TEST)]) {
    const text = bytes.toString(), marker = 'const REGISTRY=';
    assert.equal(text.split(marker).length, 2, 'one exact Tenth test-tail marker');
    assert.equal(hash(text.slice(text.indexOf(marker))), FINAL_SEAL.tenth_test_tail, 'all original Tenth attacks unchanged');
  }
  const oldVerifier = declaration(tenthReadSource(ENTRY), 'verifyPublicExport');
  assert.equal(declaration(source(ENTRY), 'verifyPublicExport'), oldVerifier);
  assert.equal(hash(oldVerifier), 'a41c7fc33df538798ddc5b21b2cc2b9d59794329249a64d5b52a96053cdb612d');
  assert.equal(typeof verifyTenth, 'function', 'fixed live entry Tenth callback');
  const tenth = verifyTenth(previousRegistry, source(EIGHTH_ARTIFACT), tenthReadSource);
  const overrides = new Map(section.files.map(row => [row.path, row.candidate_hash]));
  return { ...tenth, tenthRegistry: previousRegistry, tenthReadSource,
    verifyTenth: (r, a, read = tenthReadSource) => verifyTenth(r, a, read),
    fileHash: row => overrides.get(row.path) ?? tenth.fileHash(row),
    newCandidatePaths: [...new Set([...tenth.newCandidatePaths, FIXTURE])],
  };
}
