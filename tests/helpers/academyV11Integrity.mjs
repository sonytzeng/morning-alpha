import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ACADEMY_V11_BASE = '6ad78d0fdd23c0bcc4470351b3c74612b60f4404';
export const ACADEMY_V11_MANIFEST = 'docs/academy/v11/transition.json';
export const ACADEMY_V11_PREDECESSOR = 'docs/academy/transition.json';
export const ACADEMY_V11_PREDECESSOR_SHA256 = '76faf15dca7df157e42609c9abca428185dd55c630b7497c64de358f32774394';
export const ACADEMY_V11_MIGRATION = 'supabase/migrations/20261009053655_academy_member_learning_v11.sql';

// Named inventory confirmed individually by Main; final freeze precedes sealing.
// Pending patterns are NOT permissions. Unknown files fail, even inside Academy.
// No old manifest is authorized. The new manifest is required separately to
// avoid a self-referential hash. Binary PDF artifacts remain outside Git.
export const ACADEMY_V11_PATHS = Object.freeze([
  '.github/workflows/academy-v11.yml',
  'docs/academy/v11/ACCEPTANCE.md',
  'docs/academy/v11/RIGHTS.md',
  'docs/academy/v11/content-manifest.json',
  'scripts/academy-v11/build-pdf.py',
  'scripts/academy-v11/fresh-db.mjs',
  'scripts/academy-v11/load-content.mjs',
  'src/features/academy/member.ts',
  'src/pages/academy/MemberAcademy.tsx',
  'src/pages/academy/member.css',
  'src/pages/academy/page.tsx',
  'src/pages/academy/useAcademyAccess.ts',
  'src/pages/report/components/TodayStrategySection.tsx',
  ACADEMY_V11_MIGRATION,
  'tests/academyV11Database.test.mjs',
  'tests/academyV11Integrity.test.mjs',
  'tests/academyV11Member.test.mjs',
  'tests/browser/academy-v11.e2e.mjs',
  'tests/browser/academy-v11.harness.tsx',
  'tests/browser/academy-v11.html',
  'tests/browser/academy-v11.mock.ts',
  'tests/browser/academy-v11.vite.ts',
  'tests/fixtures/academy-v11-lessons.mjs',
  'tests/helpers/academyCandidateIntegrity.mjs',
  'tests/helpers/academyV11Integrity.mjs',
].sort());

// Candidate authorization is distinct from applying a migration, publishing to
// members, deploying, changing existing auth/RLS or modifying report engines.
export const ACADEMY_V11_TRUE_FLAGS = Object.freeze([
  'member_access_candidate', 'additive_migration_candidate', 'report_learning_links_candidate',
]);
export const ACADEMY_V11_FALSE_FLAGS = Object.freeze([
  'production_deploy_authorized', 'production_release_authorized', 'production_migration_authorized',
  'production_data_write', 'existing_auth_change', 'existing_rls_change', 'secret_change',
  'cron_change', 'core_change', 'strategy_change', 'line_change', 'report_engine_change',
  'forward_enabled', 'outcome_enabled', 'legacy_backfill', 'private_material_in_repo',
  'ai_enabled', 'paid_api_enabled',
]);

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const absent = path => Object.assign(new Error('absent from Academy V1.1 predecessor: ' + path), { code: 'ENOENT' });
const read = path => {
  const url = new URL('../../' + path, import.meta.url);
  assert.ok(lstatSync(url).isFile(), 'V1.1 candidate must be a regular file: ' + path);
  return readFileSync(url);
};
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const restored = new WeakSet();
let baseline;

function baselineBytes() {
  if (baseline) return baseline;
  const rows = git(['ls-tree', '-r', '-z', ACADEMY_V11_BASE]).split('\0').filter(Boolean).map(row => {
    const [metadata, path] = row.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    assert.equal(type, 'blob', 'unsupported V1.1 baseline object: ' + path);
    assert.match(mode, /^100[0-7]{3}$/, 'V1.1 baseline must contain regular files: ' + path);
    return { path, oid };
  });
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root, input: rows.map(row => row.oid).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024,
  });
  const result = new Map();
  let offset = 0;
  for (const row of rows) {
    const end = output.indexOf(10, offset);
    assert.notEqual(end, -1, 'missing V1.1 baseline object header');
    const [oid, type, sizeText] = output.subarray(offset, end).toString().split(' ');
    assert.equal(oid, row.oid); assert.equal(type, 'blob');
    const size = Number(sizeText);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    offset = end + 1;
    assert.equal(output[offset + size], 10, 'truncated V1.1 baseline object');
    result.set(row.path, Buffer.from(output.subarray(offset, offset + size)));
    offset += size + 1;
  }
  assert.equal(offset, output.length);
  baseline = result; // Only immutable Git bytes are cached, never live validation.
  return baseline;
}

export function academyV11Prior(path) {
  const bytes = baselineBytes().get(path);
  return bytes === undefined ? null : Buffer.from(bytes);
}

export function academyV11ChangedPaths() {
  return [...new Set([
    ...git(['diff', '--no-renames', '--name-only', '-z', ACADEMY_V11_BASE, '--']).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean))].sort();
}

/** Mandatory release gate. Explicit arguments support adversarial fixtures,
 * not release approval. Live approval must call this with no overrides.
 */
export function academyV11Transition(source = read, changedPaths = academyV11ChangedPaths()) {
  return restoreV11(source, changedPaths, true);
}

function restoreV11(source, changedPaths, verifyHistoricalView) {
  const m = JSON.parse(source(ACADEMY_V11_MANIFEST));
  assert.deepEqual(Object.keys(m).sort(), [
    'schema_version', 'base', 'predecessor_manifest', 'predecessor_sha256',
    'files', 'functions', 'migrations', 'new_secret_names',
    ...ACADEMY_V11_TRUE_FLAGS, ...ACADEMY_V11_FALSE_FLAGS,
  ].sort(), 'exact V1.1 manifest fields');
  assert.equal(m.schema_version, 'ACADEMY_V11_CANDIDATE_TRANSITION_V1');
  assert.equal(m.base, ACADEMY_V11_BASE);
  assert.equal(m.predecessor_manifest, ACADEMY_V11_PREDECESSOR);
  assert.equal(m.predecessor_sha256, ACADEMY_V11_PREDECESSOR_SHA256);
  assert.equal(hash(academyV11Prior(ACADEMY_V11_PREDECESSOR)), ACADEMY_V11_PREDECESSOR_SHA256, 'pinned Academy V1 seal');
  assert.equal(hash(source(ACADEMY_V11_PREDECESSOR)), ACADEMY_V11_PREDECESSOR_SHA256, 'immutable Academy V1 seal');
  assert.deepEqual(m.functions, [], 'V1.1 permits no Edge Function changes');
  assert.deepEqual(m.new_secret_names, [], 'V1.1 permits no new secrets');
  assert.deepEqual(m.migrations, [ACADEMY_V11_MIGRATION], 'only the named additive migration candidate');
  for (const flag of ACADEMY_V11_TRUE_FLAGS) assert.equal(m[flag], true, flag);
  for (const flag of ACADEMY_V11_FALSE_FLAGS) assert.equal(m[flag], false, flag);
  assert.deepEqual(m.files.map(row => row.path).sort(), ACADEMY_V11_PATHS, 'exact named Academy V1.1 scope');
  assert.deepEqual([...changedPaths].sort(), [...ACADEMY_V11_PATHS, ACADEMY_V11_MANIFEST].sort(), 'exact Academy V1.1 changed paths');

  const before = new Map();
  for (const row of m.files) {
    assert.deepEqual(Object.keys(row).sort(), [
      'path', 'operation', 'predecessor_git_sha', 'predecessor_sha256', 'candidate_sha256',
    ].sort(), 'exact V1.1 file row');
    const bytes = academyV11Prior(row.path);
    assert.equal(row.operation, bytes === null ? 'ADD' : 'MODIFY', row.path);
    assert.equal(row.predecessor_git_sha, bytes === null ? null : ACADEMY_V11_BASE, row.path);
    assert.equal(row.predecessor_sha256, bytes === null ? null : hash(bytes), row.path);
    assert.match(row.candidate_sha256, /^[a-f0-9]{64}$/);
    assert.equal(hash(source(row.path)), row.candidate_sha256, 'unreviewed candidate drift (Academy V1.1): ' + row.path);
    assert.notEqual(row.candidate_sha256, row.predecessor_sha256, 'unchanged V1.1 candidate row: ' + row.path);
    before.set(row.path, bytes);
  }
  for (const [path, bytes] of baselineBytes()) {
    if (before.has(path)) continue;
    // Verify actual raw bytes regardless of whether source is a historical or
    // adversarial reader. UTF-8 view equivalence cannot replace binary protection.
    assert.deepEqual(read(path), bytes, 'protected V1.1 working-tree bytes: ' + path);
    if (verifyHistoricalView) {
      const actual = source(path);
      assert.deepEqual(actual, typeof actual === 'string' ? bytes.toString('utf8') : bytes,
        'protected V1.1 historical view: ' + path);
    }
  }
  const predecessorRead = path => {
    if (path === ACADEMY_V11_MANIFEST) throw absent(path);
    if (!before.has(path)) return source(path); // Preserve unrelated injected errors.
    const bytes = before.get(path);
    if (bytes === null) throw absent(path);
    return Buffer.from(bytes);
  };
  restored.add(predecessorRead);
  return { manifest: m, predecessorRead };
}

/** Only fixture content outside the V1.1 candidate is delegated. Candidate
 * hashes/scope/lineage/flags and real unrelated bytes are checked identically.
 * Historical absence is not release approval: the mandatory gate above fails.
 */
export function academyV11AwareReader(source = read, changedPaths = academyV11ChangedPaths()) {
  if (restored.has(source)) return source;
  try { source(ACADEMY_V11_MANIFEST); } catch (error) {
    if (error.code === 'ENOENT' && source !== read) return source;
    throw error;
  }
  return restoreV11(source, changedPaths, false).predecessorRead;
}

/** The only reader V1 should use in place of its direct real-filesystem check.
 * No injectable source/inventory: validate REAL V1.1 bytes and exact scope first,
 * then restore the immutable 6ad78d view. Construct afresh per V1 validation.
 * Never substitute academyV11Prior directly: that would hide live tampering.
 * The manifest is generated only after Main's final freeze. Missing seal fails
 * rather than treating dirty V1.1 as V1.
 */
export function academyV11ActualPredecessorReader() {
  return academyV11Transition().predecessorRead;
}
