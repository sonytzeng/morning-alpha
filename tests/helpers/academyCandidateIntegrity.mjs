import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ACADEMY_BASE = 'e2a99f6677a5a31f3c7f403dfa5180fb46498c97';
export const ACADEMY_MANIFEST = 'docs/academy/transition.json';
export const ACADEMY_PREDECESSOR = 'docs/operations/evidence/owner-cockpit-transition.json';
export const ACADEMY_PREDECESSOR_SHA256 = '3297a2702103dd1bc5e06f5b482331272660b6f6bbada59f785019b37128265a';

// Reviewed names, never a directory/prefix allowance or generated authorization.
// The manifest itself is separately required, avoiding a self-referential hash.
export const ACADEMY_PATHS = Object.freeze([
  'docs/academy/README.md',
  'src/features/academy/model.ts',
  'src/pages/academy/Diagram.tsx',
  'src/pages/academy/Quiz.tsx',
  'src/pages/academy/academy.css',
  'src/pages/academy/content.ts',
  'src/pages/academy/page.tsx',
  'src/pages/academy/progress.ts',
  'src/pages/academy/useOwnerAccess.ts',
  'src/router/config.tsx',
  'tests/academyCandidateTransition.test.mjs',
  'tests/academyIntegrity.test.mjs',
  'tests/academyModel.test.mjs',
  'tests/browser/academy.e2e.mjs',
  'tests/browser/academy.html',
  'tests/browser/academy.private.e2e.mjs',
  'tests/browser/academy.production.e2e.mjs',
  'tests/browser/academy.test.mjs',
  'tests/browser/academy.vite.ts',
  'tests/browser/academyFixture.mjs',
  'tests/browser/academyHarness.tsx',
  'tests/browser/academySupabaseMock.ts',
  'tests/helpers/academyCandidateIntegrity.mjs',
  'tests/helpers/ownerCockpitIntegrity.mjs',
  'tests/ownerCockpitIntegrity.test.mjs',
].sort());

export const ACADEMY_FALSE_FLAGS = Object.freeze([
  'production_deploy_authorized', 'production_release_authorized', 'production_data_write',
  'existing_auth_change', 'existing_rls_change', 'secret_change', 'cron_change',
  'core_change', 'strategy_change', 'line_change', 'report_change', 'member_access',
  'forward_enabled', 'outcome_enabled', 'legacy_backfill', 'private_material_in_repo',
  'ai_enabled', 'paid_api_enabled',
]);

const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const absent = path => Object.assign(new Error('absent from Academy predecessor: ' + path), { code: 'ENOENT' });
const read = path => {
  const url = new URL('../../' + path, import.meta.url);
  assert.ok(lstatSync(url).isFile(), 'candidate must be a regular file: ' + path);
  return readFileSync(url);
};
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let baseline;
const restored = new WeakSet();

// Cache only immutable Git objects, not working-tree bytes or validation results.
// Read the full baseline in one batch so protection of every existing byte does
// not require a subprocess for each file on every historical-chain traversal.
function baselineBytes() {
  if (baseline) return baseline;
  const rows = git(['ls-tree', '-r', '-z', ACADEMY_BASE]).split('\0').filter(Boolean).map(row => {
    const [metadata, path] = row.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    assert.equal(type, 'blob', 'unsupported baseline object: ' + path);
    assert.match(mode, /^100[0-7]{3}$/, 'baseline must contain regular files: ' + path);
    return { path, oid };
  });
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root, input: rows.map(row => row.oid).join('\n') + '\n', maxBuffer: 64 * 1024 * 1024,
  });
  const result = new Map();
  let offset = 0;
  for (const row of rows) {
    const end = output.indexOf(10, offset);
    assert.notEqual(end, -1, 'missing baseline object header');
    const [oid, type, sizeText] = output.subarray(offset, end).toString().split(' ');
    assert.equal(oid, row.oid); assert.equal(type, 'blob');
    const size = Number(sizeText);
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    offset = end + 1;
    assert.equal(output[offset + size], 10, 'truncated baseline object');
    result.set(row.path, Buffer.from(output.subarray(offset, offset + size)));
    offset += size + 1;
  }
  assert.equal(offset, output.length);
  baseline = result;
  return baseline;
}

export function academyPrior(path) {
  const bytes = baselineBytes().get(path);
  return bytes === undefined ? null : Buffer.from(bytes);
}

export function academyChangedPaths() {
  return [...new Set([
    ...git(['diff', '--no-renames', '--name-only', '-z', ACADEMY_BASE, '--']).split('\0'),
    ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean))].sort();
}

/** Mandatory candidate gate: missing manifest, extra paths or bytes always fail.
 * Explicit source/inventory arguments are for in-memory adversarial fixtures;
 * production entrypoints use the real, freshly enumerated working tree.
 */
export function academyTransition(source = read, changedPaths = academyChangedPaths()) {
  return restoreAcademy(source, changedPaths, true);
}

function restoreAcademy(source, changedPaths, verifyHistoricalView) {
  const m = JSON.parse(source(ACADEMY_MANIFEST));
  assert.deepEqual(Object.keys(m).sort(), [
    'schema_version', 'base', 'predecessor_manifest', 'predecessor_sha256',
    'files', 'functions', 'migrations', 'new_secret_names', 'owner_only', ...ACADEMY_FALSE_FLAGS,
  ].sort(), 'exact Academy manifest fields');
  assert.equal(m.schema_version, 'ACADEMY_CANDIDATE_TRANSITION_V1');
  assert.equal(m.base, ACADEMY_BASE);
  assert.equal(m.predecessor_manifest, ACADEMY_PREDECESSOR);
  assert.equal(m.predecessor_sha256, ACADEMY_PREDECESSOR_SHA256);
  assert.equal(hash(academyPrior(ACADEMY_PREDECESSOR)), ACADEMY_PREDECESSOR_SHA256, 'pinned Cockpit predecessor');
  assert.equal(hash(source(ACADEMY_PREDECESSOR)), ACADEMY_PREDECESSOR_SHA256, 'immutable Cockpit predecessor');
  assert.deepEqual(m.functions, [], 'Academy permits no Functions');
  assert.deepEqual(m.migrations, [], 'Academy permits no migrations');
  assert.deepEqual(m.new_secret_names, [], 'Academy permits no secrets');
  assert.equal(m.owner_only, true);
  for (const flag of ACADEMY_FALSE_FLAGS) assert.equal(m[flag], false, flag);
  assert.deepEqual(m.files.map(row => row.path).sort(), ACADEMY_PATHS, 'exact named Academy scope');
  assert.deepEqual([...changedPaths].sort(), [...ACADEMY_PATHS, ACADEMY_MANIFEST].sort(), 'exact Academy changed paths');

  const before = new Map();
  for (const row of m.files) {
    assert.deepEqual(Object.keys(row).sort(), [
      'path', 'operation', 'predecessor_git_sha', 'predecessor_sha256', 'candidate_sha256',
    ].sort(), 'exact Academy file row');
    const bytes = academyPrior(row.path);
    assert.equal(row.operation, bytes === null ? 'ADD' : 'MODIFY', row.path);
    assert.equal(row.predecessor_git_sha, bytes === null ? null : ACADEMY_BASE, row.path);
    assert.equal(row.predecessor_sha256, bytes === null ? null : hash(bytes), row.path);
    assert.match(row.candidate_sha256, /^[a-f0-9]{64}$/);
    assert.equal(hash(source(row.path)), row.candidate_sha256, 'unreviewed candidate drift (Academy): ' + row.path);
    assert.notEqual(row.candidate_sha256, row.predecessor_sha256, 'unchanged candidate row: ' + row.path);
    before.set(row.path, bytes);
  }
  // Preserve all tracked predecessor bytes, not just a subset of production
  // directories. This also protects every historical manifest and old test pin.
  for (const [path, bytes] of baselineBytes()) {
    if (before.has(path)) continue;
    const message = 'unreviewed candidate drift; protected Academy predecessor path: ' + path;
    // Always verify actual working-tree bytes, including for historical text
    // readers and adversarial fixtures. No caller can opt out of this gate.
    assert.deepEqual(read(path), bytes, message);
    if (verifyHistoricalView) {
      const actual = source(path);
      assert.deepEqual(actual, typeof actual === 'string' ? bytes.toString('utf8') : bytes, message);
    }
  }
  const predecessorRead = path => {
    if (path === ACADEMY_MANIFEST) throw absent(path);
    if (!before.has(path)) return source(path);
    const bytes = before.get(path);
    if (bytes === null) throw absent(path);
    return Buffer.from(bytes);
  };
  restored.add(predecessorRead);
  return { manifest: m, predecessorRead };
}

/** Historical synthetic readers may predate Academy, as in prior successors.
 * This adapter is not the release gate: cockpitChangedPaths calls the mandatory
 * academyTransition unconditionally, so absent seals never skip live validation.
 */
export function academyAwareReader(source = read) {
  if (restored.has(source)) return source;
  try { source(ACADEMY_MANIFEST); } catch (error) {
    if (error.code === 'ENOENT' && source !== read) return source;
    throw error;
  }
  // Let the original verifier classify mutations injected into its historical
  // fixture. The real working tree, Academy scope and candidate hashes are still
  // checked above; only unrelated fixture bytes pass through to that verifier.
  return restoreAcademy(source, academyChangedPaths(), false).predecessorRead;
}
