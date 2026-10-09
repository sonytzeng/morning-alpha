import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseCourse } from '../../src/pages/academy/content.ts';
import { course } from './academyFixture.mjs';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('course boundary accepts all diagrams and backward-compatible choice questions', () => {
  const parsed = parseCourse(course); assert.equal(parsed.chapters.length, 7); assert.equal(parsed.chapters[0].questions[0].kind, 'choice');
  assert.equal(parsed.chapters[0].questions[1].kind, 'order');
});
test('data-driven diagrams retain labels, exact reveal boundaries, volume, risk and examples', () => {
  const input = structuredClone(course);
  input.chapters[0].diagram = { kind: 'bullSteps', caption: 'synthetic', labels: ['A', 'B', 'C', 'D'], values: [110, 103, 98, 108, 104, 115], visibleCounts: [3, 4, 5, 6] };
  input.chapters[0].examples = [
    { title: 'synthetic volume', explanation: 'synthetic', diagram: { kind: 'volume', caption: 'synthetic', values: [1, 2, 1], volumes: [10, 20, 15] } },
    { title: 'synthetic risk', explanation: 'synthetic', diagram: { kind: 'risk', caption: 'synthetic', risk: { entry: 102, stop: 98, target: 110 } } },
    { title: 'synthetic candle', explanation: 'synthetic', diagram: { kind: 'candle', caption: 'synthetic', candles: [{ open: 100, high: 106, low: 98, close: 104, volume: 1000 }] } },
    { title: 'synthetic SOP', explanation: 'synthetic', diagram: { kind: 'steps', caption: 'synthetic', labels: ['A', 'B', 'C', 'D', 'E'] } },
  ];
  const result = parseCourse(input); assert.deepEqual(result.chapters[0].diagram, input.chapters[0].diagram); assert.deepEqual(result.chapters[0].examples, input.chapters[0].examples);
});
for (const diagram of [
  { kind: 'trend', values: [1, '2'] }, { kind: 'volume', values: [1, 2], volumes: [3] },
  { kind: 'risk', risk: { entry: 102, stop: 103, target: 110 } },
  { kind: 'bullSteps', values: [1, 2, 3], labels: ['A', 'B'], visibleCounts: [3, 2] },
  { kind: 'candle', candles: [{ open: 100, high: 99, low: 98, close: 104, volume: 1 }] },
]) test('invalid diagram data fails closed: ' + diagram.kind, () => { const c = structuredClone(course); c.chapters[0].diagram = { ...diagram, caption: 'synthetic' }; assert.throws(() => parseCourse(c)); });
for (const [name, mutate] of [
  ['empty course', c => { c.chapters = []; }],
  ['duplicate chapter', c => { c.chapters.push(c.chapters[0]); }],
  ['unknown diagram', c => { c.chapters[0].diagram.kind = 'remote'; }],
  ['invalid answer', c => { c.chapters[0].questions[0].correctIndex = 9; }],
  ['wrong order', c => { c.chapters[0].questions[1].order = ['A', 'A']; }],
  ['duplicate question', c => { c.chapters[0].questions.push(c.chapters[0].questions[0]); }],
  ['oversized text', c => { c.title = 'x'.repeat(301); }],
]) test(name + ' fails closed', () => { const c = structuredClone(course); mutate(c); assert.throws(() => parseCourse(c)); });
test('unknown payload fields are not retained; markup remains plain text', () => {
  const parsed = parseCourse({ ...course, secret: 'not retained', chapters: course.chapters.map(c => ({ ...c, remote: 'not retained' })) });
  assert.equal('secret' in parsed, false); assert.equal('remote' in parsed.chapters[0], false);
  assert.equal(parseCourse({ ...course, title: '<img src=x onerror=alert(1)>' }).title, '<img src=x onerror=alert(1)>');
});
test('production UI has no synthetic identity, private endpoints, external AI, or raw HTML', () => {
  const page = read('src/pages/academy/page.tsx');
  assert.match(page, /import\.meta\.env\.DEV/); assert.match(page, /URL\.revokeObjectURL/);
  assert.match(page, /signal\.aborted/); assert.match(page, /operation !== revision\.current/);
  assert.doesNotMatch(page, /URLSearchParams|academyFixture|academySupabaseMock|__academy_private|dangerouslySetInnerHTML|fetch\(|functions\.invoke/);
  const guard = read('src/pages/academy/useOwnerAccess.ts');
  assert.match(guard, /is_research_owner_v1/); assert.match(guard, /auth\.getUser\(\)/);
  for (const event of ['SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED']) assert(guard.includes(event));
  assert.match(guard, /controller\.abort\(\)/);
});
test('isolated preview cannot load environment files or production config', () => {
  const config = read('tests/browser/academy.vite.ts');
  assert.match(config, /envDir: false/); assert.match(config, /publicDir: false/);
  assert.match(config, /host: '127\.0\.0\.1'/); assert.match(config, /cors: false/);
  assert.doesNotMatch(config, /mergeConfig|from ['"]\.\.\/\.\.\/vite\.config|morning-alpha-academy-private/);
  const routes = read('src/router/config.tsx');
  assert.match(routes, /path: "\/academy"/); assert.doesNotMatch(routes, /academyHarness|academyFixture/);
});
