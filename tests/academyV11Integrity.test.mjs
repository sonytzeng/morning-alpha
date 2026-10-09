import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { academyTransition, academyAwareReader, academyPrior } from './helpers/academyCandidateIntegrity.mjs';
import {
  ACADEMY_V11_BASE, ACADEMY_V11_MANIFEST, ACADEMY_V11_PREDECESSOR,
  ACADEMY_V11_PREDECESSOR_SHA256, ACADEMY_V11_MIGRATION, ACADEMY_V11_PATHS,
  ACADEMY_V11_TRUE_FLAGS, ACADEMY_V11_FALSE_FLAGS, academyV11Prior,
  academyV11Transition, academyV11AwareReader, academyV11ActualPredecessorReader,
} from './helpers/academyV11Integrity.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const missing = path => Object.assign(new Error('absent V1.1 fixture: ' + path), { code: 'ENOENT' });
const priorRead = path => { const bytes = academyV11Prior(path); if (bytes === null) throw missing(path); return bytes; };

// Synthetic evidence only. No live candidate is blessed and no manifest is
// written while Main finalizes the exact filenames and UI/migration contents.
function fixture() {
  const bytes = new Map(ACADEMY_V11_PATHS.map(path => [path, Buffer.from('SYNTHETIC_V11_TEST_ONLY:' + path)]));
  const manifest = {
    schema_version: 'ACADEMY_V11_CANDIDATE_TRANSITION_V1', base: ACADEMY_V11_BASE,
    predecessor_manifest: ACADEMY_V11_PREDECESSOR, predecessor_sha256: ACADEMY_V11_PREDECESSOR_SHA256,
    functions: [], migrations: [ACADEMY_V11_MIGRATION], new_secret_names: [],
    ...Object.fromEntries(ACADEMY_V11_TRUE_FLAGS.map(flag => [flag, true])),
    ...Object.fromEntries(ACADEMY_V11_FALSE_FLAGS.map(flag => [flag, false])),
    files: ACADEMY_V11_PATHS.map(path => {
      const b = academyV11Prior(path);
      return { path, operation: b === null ? 'ADD' : 'MODIFY',
        predecessor_git_sha: b === null ? null : ACADEMY_V11_BASE,
        predecessor_sha256: b === null ? null : hash(b), candidate_sha256: hash(bytes.get(path)) };
    }),
  };
  const inventory = [...ACADEMY_V11_PATHS, ACADEMY_V11_MANIFEST].sort();
  const source = path => path === ACADEMY_V11_MANIFEST ? Buffer.from(JSON.stringify(manifest))
    : bytes.has(path) ? bytes.get(path) : priorRead(path);
  return { bytes, manifest, inventory, source };
}

test('V1.1 pins 6ad78d and restores V1 bytes, ADD absence and unchanged V1 seal', () => {
  const f = fixture(), t = academyV11Transition(f.source, f.inventory);
  assert.equal(ACADEMY_V11_BASE, '6ad78d0fdd23c0bcc4470351b3c74612b60f4404');
  assert.ok(Object.isFrozen(ACADEMY_V11_PATHS));
  assert.equal(hash(t.predecessorRead(ACADEMY_V11_PREDECESSOR)), ACADEMY_V11_PREDECESSOR_SHA256);
  assert.deepEqual(t.predecessorRead('src/pages/academy/page.tsx'), academyV11Prior('src/pages/academy/page.tsx'));
  for (const row of f.manifest.files) {
    if (row.operation === 'ADD') assert.throws(() => t.predecessorRead(row.path), { code: 'ENOENT' });
    else assert.deepEqual(t.predecessorRead(row.path), academyV11Prior(row.path));
  }
  assert.throws(() => t.predecessorRead(ACADEMY_V11_MANIFEST), { code: 'ENOENT' });
  assert.equal(academyV11AwareReader(t.predecessorRead, f.inventory), t.predecessorRead);
  const v1 = JSON.parse(t.predecessorRead(ACADEMY_V11_PREDECESSOR));
  assert.equal(v1.owner_only, true); assert.equal(v1.member_access, false);
  assert.deepEqual(v1.migrations, []);
  for (const row of v1.files) assert.equal(hash(t.predecessorRead(row.path)), row.candidate_sha256, 'V1 candidate pin: ' + row.path);
});

test('V1.1 rejects drift or absence in each named candidate on strict and historical paths', () => {
  const f = fixture();
  for (const path of ACADEMY_V11_PATHS) {
    const drift = p => p === path ? Buffer.concat([f.source(p), Buffer.from('DRIFT')]) : f.source(p);
    assert.throws(() => academyV11Transition(drift, f.inventory), /unreviewed candidate drift/);
    assert.throws(() => academyV11AwareReader(drift, f.inventory), /unreviewed candidate drift/);
    assert.throws(() => academyV11Transition(p => { if (p === path) throw missing(p); return f.source(p); }, f.inventory), { code: 'ENOENT' });
  }
  academyV11Transition(f.source, f.inventory);
  f.bytes.set('src/pages/academy/page.tsx', Buffer.from('later mutation'));
  assert.throws(() => academyV11Transition(f.source, f.inventory), /unreviewed candidate drift/);
});

test('V1.1 exact inventories reject unknown files, prefixes, omission, duplication and V1 seal edits', () => {
  for (const mutate of [
    f => f.inventory.push('src/pages/academy/unknown.tsx'),
    f => f.inventory.push('docs/academy/v11/private-course.json'),
    f => f.inventory.push('docs/academy/v11/curriculum.mjs'),
    f => f.inventory.push('scripts/academy-v11/unknown.mjs'),
    f => f.inventory.push('tests/browser/academy-v11-unknown.mjs'),
    f => f.inventory.push(ACADEMY_V11_PREDECESSOR),
    f => f.inventory.pop(), f => f.inventory.push(f.inventory[0]),
    f => f.manifest.files.pop(), f => f.manifest.files.push(f.manifest.files[0]),
    f => { f.manifest.files[0].path = 'docs/academy/v11/*'; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => academyV11Transition(f.source, f.inventory));
    assert.throws(() => academyV11AwareReader(f.source, f.inventory));
  }
});

test('member/migration candidates do not authorize Production flags, extra SQL, Functions or secrets', () => {
  for (const mutate of [
    m => { m.base = 'HEAD'; }, m => { m.base = 'e2a99f6677a5a31f3c7f403dfa5180fb46498c97'; },
    m => { m.predecessor_manifest = 'unreviewed'; }, m => { m.predecessor_sha256 = '0'.repeat(64); },
    m => { m.schema_version = 'unreviewed'; },
    m => m.functions.push('unapproved'), m => m.new_secret_names.push('UNAPPROVED'),
    m => { m.migrations = []; }, m => m.migrations.push('extra.sql'),
    m => { m.migrations = [ACADEMY_V11_MIGRATION.replace('053655', '053656')]; },
    m => { m.unknown_permission = true; },
    ...ACADEMY_V11_FALSE_FLAGS.map(flag => m => { m[flag] = true; }),
    ...ACADEMY_V11_FALSE_FLAGS.map(flag => m => { delete m[flag]; }),
    ...ACADEMY_V11_TRUE_FLAGS.map(flag => m => { m[flag] = false; }),
    m => { m.files[0].predecessor_sha256 = '0'.repeat(64); },
    m => { m.files[0].candidate_sha256 = 'invalid'; },
    m => { m.files.find(row => row.operation === 'MODIFY').predecessor_git_sha = 'HEAD'; },
    m => { m.files.find(row => row.operation === 'ADD').operation = 'MODIFY'; },
    m => { m.files[0].skip_validation = true; },
  ]) {
    const f = fixture(); mutate(f.manifest);
    assert.throws(() => academyV11Transition(f.source, f.inventory));
    assert.throws(() => academyV11AwareReader(f.source, f.inventory));
  }
});

test('historical injection reaches its original validator, strict API still rejects it', () => {
  const f = fixture(), path = 'docs/10k-program/phase2-shadow-auth-transition.json';
  const injected = Buffer.concat([priorRead(path), Buffer.from('DRIFT')]);
  const source = p => p === path ? injected : f.source(p);
  assert.throws(() => academyV11Transition(source, f.inventory), /protected V1.1 historical view/);
  const historical = academyV11AwareReader(source, f.inventory);
  assert.deepEqual(historical(path), injected);
  const originalValidator = reader => assert.deepEqual(reader(path), priorRead(path), 'ORIGINAL_DOWNSTREAM_VALIDATOR');
  assert.throws(() => originalValidator(historical), /ORIGINAL_DOWNSTREAM_VALIDATOR/);
  const alteredSeal = p => p === ACADEMY_V11_PREDECESSOR ? Buffer.from('{}') : f.source(p);
  assert.throws(() => academyV11AwareReader(alteredSeal, f.inventory), /immutable Academy V1 seal/);
});

test('UTF-8 fixture views preserve raw baseline protection and Buffer views remain exact', () => {
  const f = fixture();
  assert.doesNotThrow(() => academyV11Transition(p => f.source(p).toString('utf8'), f.inventory));
  assert.throws(() => academyV11Transition(p => f.source(p).toString('utf8') + (p === '.DS_Store' ? 'DRIFT' : ''), f.inventory), /protected V1.1 historical view/);
  const b = academyV11Prior('src/router/config.tsx');
  b.fill(0);
  assert.notDeepEqual(b, academyV11Prior('src/router/config.tsx'), 'callers cannot mutate cached predecessor bytes');
});

test('fake historical readers cannot hide actual unrelated raw-byte drift', t => {
  const f = fixture(), originalRead = fs.readFileSync;
  // Process-local mock only; no on-disk mutation in the shared workspace.
  t.mock.method(fs, 'readFileSync', function(path, ...args) {
    const value = originalRead.call(this, path, ...args);
    return String(path).endsWith('/src/router/config.tsx') ? Buffer.concat([value, Buffer.from('ACTUAL_DRIFT')]) : value;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => academyV11Transition(f.source, f.inventory), /protected V1.1 working-tree bytes: src\/router\/config/);
    assert.throws(() => academyV11AwareReader(f.source, f.inventory), /protected V1.1 working-tree bytes: src\/router\/config/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('missing successor seal fails the mandatory gate; historical absence is not approval', t => {
  const f = fixture();
  assert.throws(() => academyV11Transition(p => { if (p === ACADEMY_V11_MANIFEST) throw missing(p); return f.source(p); }, f.inventory), { code: 'ENOENT' });
  assert.throws(() => academyV11Transition(priorRead, []), { code: 'ENOENT' });
  assert.equal(academyV11AwareReader(priorRead, []), priorRead);
  const originalRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(path, ...args) {
    if (String(path).endsWith('/' + ACADEMY_V11_MANIFEST)) throw missing(ACADEMY_V11_MANIFEST);
    return originalRead.call(this, path, ...args);
  });
  syncBuiltinESMExports();
  try {
    // Works whether the real manifest is not yet written or already exists.
    assert.throws(() => academyV11ActualPredecessorReader(), { code: 'ENOENT' });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('V1 integration verifies the real successor before restoring historical bytes and diagnostics', t => {
  const f = fixture(), realRead = fs.readFileSync, realStat = fs.lstatSync, realExec = childProcess.execFileSync;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const relative = path => {
    const value = path instanceof URL ? fileURLToPath(path) : String(path);
    return value.startsWith(root) ? value.slice(root.length) : value;
  };
  const actualDrift = new Map();
  // A process-local virtual live candidate exercises the NO-OVERRIDE release
  // APIs without writing a seal, changing files, or blessing the unfinished UI.
  t.mock.method(fs, 'readFileSync', function(path, ...args) {
    const p = relative(path);
    const b = actualDrift.get(p) ?? (p === ACADEMY_V11_MANIFEST || f.bytes.has(p) ? f.source(p) : null);
    if (b === null) return realRead.call(this, path, ...args);
    const encoding = typeof args[0] === 'string' ? args[0] : args[0]?.encoding;
    return encoding ? b.toString(encoding) : Buffer.from(b);
  });
  t.mock.method(fs, 'lstatSync', function(path, ...args) {
    const p = relative(path);
    return p === ACADEMY_V11_MANIFEST || f.bytes.has(p) ? { isFile: () => true } : realStat.call(this, path, ...args);
  });
  t.mock.method(childProcess, 'execFileSync', function(command, args, ...options) {
    if (command === 'git' && args[0] === 'diff' && args.length === 6 && args[4] === ACADEMY_V11_BASE)
      return f.inventory.join('\0') + '\0';
    if (command === 'git' && args[0] === 'ls-files' && args.includes('--others')) return '';
    return realExec.call(this, command, args, ...options);
  });
  syncBuiltinESMExports();
  try {
    const v1 = academyTransition();
    assert.equal(v1.manifest.owner_only, true);
    assert.equal(v1.manifest.member_access, false);
    assert.deepEqual(v1.manifest.migrations, []);
    const report = 'src/pages/report/components/TodayStrategySection.tsx';
    assert.deepEqual(v1.predecessorRead(report), academyPrior(report));

    const path = 'docs/10k-program/phase2-shadow-auth-transition.json';
    const injected = Buffer.concat([priorRead(path), Buffer.from('LEGACY_FIXTURE_DRIFT')]);
    const historicalSource = p => p === path ? injected : priorRead(p);
    assert.throws(() => academyTransition(historicalSource), /protected Academy predecessor path/);
    assert.deepEqual(academyAwareReader(historicalSource)(path), injected);

    actualDrift.set('src/router/config.tsx', Buffer.from('REAL_ROUTER_DRIFT'));
    assert.throws(() => academyTransition(priorRead), /protected V1.1 working-tree bytes/);
    actualDrift.clear();
    const member = 'src/features/academy/member.ts';
    actualDrift.set(member, Buffer.from('REAL_CANDIDATE_DRIFT'));
    assert.throws(() => academyTransition(priorRead), /unreviewed candidate drift \(Academy V1.1\)/);
    actualDrift.clear();
    f.inventory.push('unknown-live-file');
    assert.throws(() => academyTransition(priorRead), /exact Academy V1.1 changed paths/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
