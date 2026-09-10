// Independent 13-handler successor. Exact sealed predecessor: tests/integration/coreConsolidationPrepareLocal.mjs
// SHA256 a754b1dde917ace6f413aee6378a5073bd9a048fcb53cbe2fed4faad32fd1e7e; old file is never edited or executed against a reused scope.
// Fresh, isolated consolidation schema replay. Never a Production deploy tool.
// Operational schedules, credentials and owner-specific data are not replayed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const permittedScopes = Object.freeze({
  'ma-consolidation-v1-20260909183000': '172.21.0.0/16',
});
const scope = process.env.MA_LOCAL_SCOPE;
assert.ok(Object.hasOwn(permittedScopes, scope), 'Only exact reviewed local scopes may bootstrap');
const root = '/private/tmp/' + scope;
const endpoint = 'unix:///private/tmp/ma-clock-20260909-183000/docker.sock';
const network = scope + '-isolated';
const candidate = 'supabase/migrations/20260909015650_core_market_publication_contract.sql';
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.equal(process.env.MA_CONSOLIDATION_REPLAY, 'LOCAL_ONLY');
assert.equal(process.env.DOCKER_HOST, endpoint);
assert.equal(existsSync(root + '/schema-rebuild-results.json'), false, 'Never replace a prior rebuild record');
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(readFileSync(repo + candidate)), '353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0',
  'Only the exact already-reviewed local candidate SQL may initialize this new database');
const docker = args => execFileSync('docker', ['--host', endpoint, ...args], {
  encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const net = JSON.parse(docker(['network', 'inspect', network]))[0];
assert.equal(net.Internal, true);
assert.equal(net.IPAM.Config[0].Subnet, permittedScopes[scope]);
const expected = ['db', 'auth', 'rest', 'kong', 'inbucket', 'edge_runtime'].map(name => 'supabase_' + name + '_' + scope);
assert.deepEqual(Object.values(net.Containers).map(row => row.Name).sort(), [...expected].sort());
for (const name of expected) {
  const row = JSON.parse(docker(['inspect', name]))[0];
  assert.deepEqual(Object.keys(row.NetworkSettings.Networks), [network]);
}
const sql = input => execFileSync('docker', ['--host', endpoint, 'exec', '-i', 'supabase_db_' + scope,
  'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
  input, encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
assert.equal(sql("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"), '0');
assert.equal(sql('select count(*) from auth.users'), '0');

// Exact top-level SQL lexer: never split function bodies or quoted statements.
function statements(source) {
  const out = []; let start = 0, state = '', tag = '', depth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (state === 'line') { if (c === '\n') state = ''; continue; }
    if (state === 'block') {
      if (c === '/' && next === '*') { depth++; i++; }
      else if (c === '*' && next === '/') { if (--depth === 0) state = ''; i++; }
      continue;
    }
    if (state === 'quote' || state === 'identifier') {
      const end = state === 'quote' ? "'" : '"';
      if (c === end) { if (next === end) i++; else state = ''; } continue;
    }
    if (state === 'dollar') { if (source.startsWith(tag, i)) { i += tag.length - 1; state = ''; } continue; }
    if (c === '-' && next === '-') { state = 'line'; i++; continue; }
    if (c === '/' && next === '*') { state = 'block'; depth = 1; i++; continue; }
    if (c === "'") { state = 'quote'; continue; }
    if (c === '"') { state = 'identifier'; continue; }
    if (c === '$') {
      const match = source.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/);
      if (match) { state = 'dollar'; tag = match[0]; i += tag.length - 1; continue; }
    }
    if (c === ';') { out.push(source.slice(start, i + 1)); start = i + 1; }
  }
  assert.ok(!state || state === 'line', 'Unterminated SQL');
  if (source.slice(start).trim()) out.push(source.slice(start));
  return out;
}
const clean = text => text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
const tracked = execFileSync('git', ['ls-files', '--', 'supabase/migrations'], { cwd: repo, encoding: 'utf8' })
  .trim().split('\n').filter(path => path.endsWith('.sql'));
const paths = [...new Set([...tracked, candidate])].sort();
assert.ok(paths.includes(candidate));
assert.ok(paths.every(path => !path.includes(' 2.')));
const foundationPath = 'tests/fixtures/core-canonical-foundation.sql';
const foundation = readFileSync(repo + foundationPath, 'utf8');
const guard = `create schema ma_isolated_guard;
create table ma_isolated_guard.identity(scope text primary key check(scope='${scope}'));
insert into ma_isolated_guard.identity values('${scope}');
revoke all on schema ma_isolated_guard from public,anon,authenticated;
set ma.local_rebuild='core-stability-20260907';`;
const records = [{ file: foundationPath, source_sha256: sha(foundation), included: 1, excluded: [] }];
const manifest = { scope, endpoint, network, production_operations: false, automatic_stability_day: false,
  foundation_sha256: sha(foundation), migrations: records, status: 'RUNNING' };
mkdirSync(root + '/prepared', { recursive: true });
function apply(file, body, row) {
  writeFileSync(root + '/prepared/' + file.split('/').at(-1), body);
  try { sql(body); row.status = 'PASS'; }
  catch (error) {
    row.status = 'FAIL'; row.error = String(error.stderr || error.message).replace(/eyJ[\w.-]+/g, '[REDACTED]');
    manifest.status = 'FAIL'; writeFileSync(root + '/schema-rebuild-results.json', JSON.stringify(manifest, null, 2));
    throw new Error(JSON.stringify({ file, status: row.status, error: row.error }));
  }
  console.log(JSON.stringify({ file, status: row.status, source_sha256: row.source_sha256 }));
}
apply('000-foundation.sql', guard + '\n' + foundation, records[0]);
for (const file of paths) {
  const source = readFileSync(repo + file, 'utf8'), chunks = statements(source), included = [], excluded = [];
  const excludedFile = /cron_backup|emma_health|alpha_coach/.test(file);
  for (const [index, statement] of chunks.entries()) {
    const text = clean(statement); let reason = null;
    if (excludedFile) reason = 'Existing explicit isolation exclusion: operational Cron backup, Emma or Alpha Coach';
    else if (/^do\b/i.test(text) && /vault\.|cron\./i.test(text)) reason = 'Do not initialize operational credentials or schedules';
    else if (/^(insert|update)\b/i.test(text) && /sonytzeng@gmail\.com/i.test(text)) reason = 'Never copy Production owner-specific business data';
    else if (/^create extension.*pg_cron/i.test(text)) reason = 'No live scheduler in local replay';
    if (reason) excluded.push({ statement: index, sha256: sha(statement), reason });
    else included.push(statement);
  }
  const row = { file, source_sha256: sha(source), included: included.length, excluded };
  records.push(row);
  if (included.length) apply(file, included.join('\n'), row);
  else row.status = 'EXCLUDED_OPERATIONAL_ONLY';
}
assert.equal(sql('select scope from ma_isolated_guard.identity'), scope);
assert.equal(sql('select count(*) from auth.users'), '0', 'No owner/user backfill allowed');
assert.equal(sql('select count(*) from public.reports'), '0');
assert.equal(sql('select count(*) from public.market_data_snapshots'), '0');
assert.equal(sql('select count(*) from public.market_checkpoint_snapshots'), '0');
manifest.status = 'PASS';
writeFileSync(root + '/schema-rebuild-results.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ schema_rebuild: 'PASS', scope, migration_count: paths.length, auth_users: 0,
  reports: 0, snapshots: 0, production_touched: false, full_chain_e2e: 'NOT_RUN' }));
