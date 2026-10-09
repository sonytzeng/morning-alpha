import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ACADEMY_BASE, ACADEMY_MANIFEST, ACADEMY_PATHS, ACADEMY_PREDECESSOR,
  ACADEMY_PREDECESSOR_SHA256, ACADEMY_FALSE_FLAGS, academyPrior,
  academyTransition, academyAwareReader,
} from './helpers/academyCandidateIntegrity.mjs';
import { COCKPIT_BASE, COCKPIT_PATHS, COCKPIT_MANIFEST, cockpitTransition, cockpitPrior } from './helpers/ownerCockpitIntegrity.mjs';
import { entryAuthTransition } from './helpers/entryWorkerAuthIntegrity.mjs';
import { entryTransition } from './helpers/entryOpportunityIntegrity.mjs';
import { marketNewsTransition } from './helpers/marketNewsIntegrity.mjs';
import { ownerBackendTransition } from './helpers/ownerBackendIntegrity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = path => Object.assign(new Error('missing fixture: ' + path), { code: 'ENOENT' });
const priorRead = path => { const b = academyPrior(path); if (b === null) throw missing(path); return b; };

// No live file is blessed here. This fixture can run while the UI is edited and
// does not create docs/academy/transition.json. Main freezes real hashes later.
function fixture() {
  const bytes = new Map(ACADEMY_PATHS.map(path => [path, Buffer.from('SYNTHETIC_ACADEMY_TEST_ONLY:' + path)]));
  const manifest = {
    schema_version: 'ACADEMY_CANDIDATE_TRANSITION_V1', base: ACADEMY_BASE,
    predecessor_manifest: ACADEMY_PREDECESSOR, predecessor_sha256: ACADEMY_PREDECESSOR_SHA256,
    functions: [], migrations: [], new_secret_names: [], owner_only: true,
    ...Object.fromEntries(ACADEMY_FALSE_FLAGS.map(flag => [flag, false])),
    files: ACADEMY_PATHS.map(path => {
      const b = academyPrior(path);
      return { path, operation: b === null ? 'ADD' : 'MODIFY',
        predecessor_git_sha: b === null ? null : ACADEMY_BASE,
        predecessor_sha256: b === null ? null : hash(b), candidate_sha256: hash(bytes.get(path)) };
    }),
  };
  const inventory = [...ACADEMY_PATHS, ACADEMY_MANIFEST].sort();
  const source = path => path === ACADEMY_MANIFEST ? Buffer.from(JSON.stringify(manifest))
    : bytes.has(path) ? bytes.get(path) : priorRead(path);
  return { bytes, manifest, inventory, source };
}

test('Academy exact successor restores every candidate predecessor byte or absence', () => {
  const f = fixture(), t = academyTransition(f.source, f.inventory);
  assert.equal(t.manifest.base, 'e2a99f6677a5a31f3c7f403dfa5180fb46498c97');
  assert.equal(t.manifest.files.length, 25);
  assert.ok(ACADEMY_PATHS.includes('tests/academyIntegrity.test.mjs'));
  assert.deepEqual(t.manifest.files.filter(row => row.operation === 'MODIFY').map(row => row.path), [
    'src/router/config.tsx', 'tests/helpers/ownerCockpitIntegrity.mjs', 'tests/ownerCockpitIntegrity.test.mjs',
  ]);
  for (const row of t.manifest.files) {
    if (row.operation === 'ADD') assert.throws(() => t.predecessorRead(row.path), { code: 'ENOENT' });
    else assert.deepEqual(t.predecessorRead(row.path), academyPrior(row.path));
  }
  assert.throws(() => t.predecessorRead(ACADEMY_MANIFEST), { code: 'ENOENT' });
  assert.equal(academyAwareReader(t.predecessorRead), t.predecessorRead);
  assert.equal(hash(t.predecessorRead(ACADEMY_PREDECESSOR)), ACADEMY_PREDECESSOR_SHA256);
});

test('Academy rejects changed router and every other candidate, missing bytes and later drift', () => {
  const f = fixture(); academyTransition(f.source, f.inventory);
  for (const path of ACADEMY_PATHS) {
    assert.throws(() => academyTransition(p => p === path ? Buffer.concat([f.source(p), Buffer.from('DRIFT')]) : f.source(p), f.inventory), /unreviewed candidate drift/);
    assert.throws(() => academyTransition(p => { if (p === path) throw missing(p); return f.source(p); }, f.inventory), { code: 'ENOENT' });
  }
  f.bytes.set('src/router/config.tsx', Buffer.from('changed after validation'));
  assert.throws(() => academyTransition(f.source, f.inventory), /unreviewed candidate drift.*src\/router\/config/);
});

test('Academy rejects unknown, duplicate, missing, renamed and wildcard inventories', () => {
  for (const mutate of [
    f => f.inventory.push('src/pages/academy/unknown.tsx'),
    f => f.inventory.push('supabase/functions/unapproved/index.ts'),
    f => f.inventory.push('docs/academy/research/private.md'),
    f => f.inventory.pop(),
    f => f.inventory.push(f.inventory[0]),
    f => f.inventory[f.inventory.indexOf('src/router/config.tsx')] = 'src/router/renamed.tsx',
    f => f.manifest.files.push({ ...f.manifest.files[0], path: 'src/pages/academy/*' }),
    f => f.manifest.files.pop(),
    f => f.manifest.files.push(f.manifest.files[0]),
    f => { f.manifest.files[0].path = 'src/pages/academy/unknown.tsx'; f.inventory[0] = 'src/pages/academy/unknown.tsx'; },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => academyTransition(f.source, f.inventory));
  }
});

test('Academy rejects wrong base, Function/secret escalation and every unauthorized flag', () => {
  for (const mutate of [
    m => { m.base = 'HEAD'; }, m => { m.base = COCKPIT_BASE; },
    m => { m.schema_version = 'unreviewed'; },
    m => { m.predecessor_manifest = 'unreviewed'; }, m => { m.predecessor_sha256 = '0'.repeat(64); },
    m => m.functions.push('line-daily-push'), m => m.migrations.push('extra'),
    m => m.new_secret_names.push('UNAPPROVED_SECRET'), m => { m.owner_only = false; },
    m => { m.unreviewed_permission = true; },
    ...ACADEMY_FALSE_FLAGS.map(flag => m => { m[flag] = true; }),
    ...ACADEMY_FALSE_FLAGS.map(flag => m => { delete m[flag]; }),
    m => { m.files[0].predecessor_sha256 = '0'.repeat(64); },
    m => { m.files[0].candidate_sha256 = 'invalid'; },
    m => { m.files.find(row => row.operation === 'MODIFY').predecessor_git_sha = 'HEAD'; },
    m => { m.files.find(row => row.operation === 'ADD').operation = 'MODIFY'; },
    m => { m.files.find(row => row.operation === 'MODIFY').operation = 'ADD'; },
    m => { m.files[0].allow_anything = true; },
  ]) {
    const f = fixture(); mutate(f.manifest); assert.throws(() => academyTransition(f.source, f.inventory));
  }
});

test('Academy cannot rewrite any unrelated production bytes or historical seal', () => {
  const f = fixture();
  for (const path of [
    'src/pages/admin/analysis/page.tsx', 'src/features/research/cockpit.ts',
    'supabase/functions/owner-trading-lab-v1/index.ts', '.github/workflows/owner-cockpit.yml',
    'tests/entryOpportunityAuthIntegrity.test.mjs',
    'docs/operations/evidence/entry-worker-auth-transition.json',
    'docs/operations/evidence/entry-opportunity-transition.json',
    'docs/operations/evidence/market-news-transition-20261008.json',
  ]) {
    assert.throws(() => academyTransition(p => p === path ? Buffer.concat([f.source(p), Buffer.from('DRIFT')]) : f.source(p), f.inventory), /protected Academy predecessor path/);
  }
  assert.throws(() => academyTransition(p => p === ACADEMY_PREDECESSOR ? Buffer.from('{}') : f.source(p), f.inventory), /immutable Cockpit predecessor/);
});

test('mandatory Academy gate fails for missing manifest; historical fixtures are not release approval', () => {
  const f = fixture();
  assert.throws(() => academyTransition(p => { if (p === ACADEMY_MANIFEST) throw missing(p); return f.source(p); }, f.inventory), { code: 'ENOENT' });
  assert.throws(() => academyTransition(priorRead, []), { code: 'ENOENT' });
  assert.equal(academyAwareReader(priorRead), priorRead);
});

test('Academy restoration retains Cockpit and the Entry Auth/Entry/News/Owner predecessor chain', () => {
  const f = fixture(), t = academyTransition(f.source, f.inventory);
  const cockpit = cockpitTransition(t.predecessorRead);
  assert.deepEqual(cockpit.manifest.files.map(row => row.path).sort(), COCKPIT_PATHS);
  const historicalDiff = execFileSync('git', ['diff', '--name-only', '-z', COCKPIT_BASE, ACADEMY_BASE, '--'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  assert.deepEqual(historicalDiff, [...COCKPIT_PATHS, COCKPIT_MANIFEST].sort());
  for (const path of execFileSync('git', ['ls-tree', '-r', '--name-only', COCKPIT_BASE, '--', 'supabase', 'src', 'research', '.github'], { cwd: root, encoding: 'utf8' }).trim().split('\n')) {
    if (!COCKPIT_PATHS.includes(path)) assert.deepEqual(t.predecessorRead(path), cockpitPrior(path), 'protected existing production bytes: ' + path);
  }
  const auth = entryAuthTransition(cockpit.predecessorRead);
  const entry = entryTransition(auth.predecessorRead);
  const news = marketNewsTransition(entry.predecessorRead);
  assert.doesNotThrow(() => ownerBackendTransition(news.predecessorRead));
});
