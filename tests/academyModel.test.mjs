import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Match ownerCockpit.test.mjs: execute the real TS model in an isolated VM.
const source = readFileSync(new URL('../src/features/academy/model.ts', import.meta.url), 'utf8');
const m = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: m,
  require: name => { throw Error(`Unexpected dependency: ${name}`); },
  fetch: () => { throw Error('Network forbidden'); },
});
const plain = value => JSON.parse(JSON.stringify(value));
const candle = { open: 10, high: 12, low: 9, close: 11, volume: 100 };
const question = { id: 'q1', prompt: '示例題', choices: ['甲', '乙'], correctIndex: 0, explanation: '這是教學示例。' };
const scope = { userId: 'opaque-user-a', courseId: 'basics', courseVersion: 'v1', chapterIds: ['one', 'two'] };
function memory() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test('candle accepts finite OHLC boundaries and zero volume without mutating input', () => {
  assert.equal(m.validateCandle(Object.freeze(candle)).valid, true);
  assert.equal(m.validateCandle({ open: 0, close: 0, high: 0, low: 0, volume: 0 }).valid, true);
  assert.equal(m.validateCandle({ open: -2, close: -1, low: -3, high: 0, volume: 0 }).valid, true);
  assert.deepEqual(plain(m.validateCandle({ ...candle, ignored: 'not copied' }).value), candle);
});

test('candle rejects every malformed or non-finite field, negative volume and broken ranges', () => {
  for (const value of [null, undefined, [], '10', {}]) assert.equal(m.validateCandle(value).valid, false);
  for (const field of Object.keys(candle)) {
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '10', true]) {
      assert.equal(m.validateCandle({ ...candle, [field]: value }).valid, false, `${field}: ${value}`);
    }
  }
  for (const invalid of [{ volume: -1 }, { low: 13 }, { high: 8 }, { open: 8 }, { open: 13 }, { close: 8 }, { close: 13 }]) {
    assert.equal(m.validateCandle({ ...candle, ...invalid }).valid, false);
    assert.throws(() => m.classifyCandle({ ...candle, ...invalid }));
  }
});

test('classification explains exact doji and Taiwan red/black without predictive advice', () => {
  for (const [close, kind] of [[10, 'doji'], [11, 'red'], [9, 'black'], [10.000001, 'red']]) {
    const result = m.classifyCandle({ ...candle, close });
    assert.equal(result.kind, kind);
    assert.ok(result.explanation.includes(m.ACADEMY_DISCLAIMER));
  }
});

test('single-choice authoring validates indices, texts, sparse arrays and choice count', () => {
  assert.equal(m.validateQuestion(question).valid, true);
  for (const invalid of [null, {}, { ...question, id: '' }, { ...question, prompt: ' ' },
    { ...question, explanation: null }, { ...question, choices: ['only'] },
    { ...question, choices: ['甲', ''] }, { ...question, choices: new Array(2) },
    ...[-1, 2, 0.5, NaN, Infinity, '0', null].map(correctIndex => ({ ...question, correctIndex }))]) {
    assert.equal(m.validateQuestion(invalid).valid, false);
    assert.throws(() => m.evaluateQuestion(invalid, 0));
  }
});

test('single choice never coerces malformed, multi-select or absent answers into correct', () => {
  assert.equal(m.evaluateQuestion(question, 0).isCorrect, true);
  assert.equal(m.evaluateQuestion(question, 1).answered, true);
  assert.equal(m.evaluateQuestion(question, 1).isCorrect, false);
  for (const answer of [null, undefined, NaN, Infinity, -1, 2, 0.5, '0', false, [0], {}]) {
    const result = m.evaluateQuestion(question, answer);
    assert.equal(result.isCorrect, false);
    assert.equal(result.answered, false);
    assert.equal(result.selectedIndex, null);
    assert.equal(result.explanation, question.explanation);
  }
});

test('scoring weights all questions, includes unanswered and avoids inherited answers', () => {
  const questions = [question, { ...question, id: 'q2' }, { ...question, id: 'q3' }];
  const score = m.scoreQuiz(questions, { q1: 0, q2: 1, unknown: 0 });
  assert.deepEqual([score.correct, score.total, score.answered], [1, 3, 2]);
  assert.ok(Math.abs(score.percentage - 100 / 3) < 1e-12);
  assert.equal(m.scoreQuiz([question], Object.create({ q1: 0 })).answered, 0);
  assert.equal(m.scoreQuiz([], {}).percentage, 0);
  assert.throws(() => m.scoreQuiz([question, question], {}), /Duplicate/);
  assert.throws(() => m.scoreQuiz(new Array(1), {}));
  assert.throws(() => m.scoreQuiz([question], null));
});

test('sequence evaluator requires exact complete order, not set equality or partial credit', () => {
  const expected = Object.freeze(['observe', 'check', 'review']);
  assert.equal(m.evaluateSequence(expected, [...expected]).isCorrect, true);
  const swapped = m.evaluateSequence(expected, ['check', 'observe', 'review']);
  assert.equal(swapped.validAnswer, true);
  assert.equal(swapped.isCorrect, false);
  assert.equal(swapped.matchedPositions, 1);
  for (const answer of [[], null, 'observe', ['observe'], [...expected, 'extra'],
    ['observe', 'observe', 'review'], ['observe', 'unknown', 'review'], [1, 2, 3], new Array(3)]) {
    const result = m.evaluateSequence(expected, answer);
    assert.equal(result.validAnswer, false);
    assert.equal(result.isCorrect, false);
    assert.equal(result.matchedPositions, 0);
  }
  for (const invalid of [[], null, ['x', 'x'], [''], [NaN], new Array(1)]) {
    assert.throws(() => m.evaluateSequence(invalid, []));
  }
});

test('local progress whitelists/deduplicates chapter IDs and writes only its public contract', () => {
  const storage = memory();
  assert.equal(m.loadProgress(storage, scope).status, 'empty');
  assert.equal(storage.entries.size, 0);
  const ids = Object.freeze(['two', 'one', 'two', 'unknown']);
  const saved = m.saveProgress(storage, scope, ids);
  assert.equal(saved.status, 'saved');
  assert.deepEqual(plain(saved.progress.completedChapterIds), ['two', 'one']);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(m.progressStorageKey(scope)))),
    ['schemaVersion', 'userId', 'courseId', 'courseVersion', 'completedChapterIds']);
  assert.equal(m.loadProgress(storage, scope).status, 'loaded');
  assert.deepEqual(plain(m.loadProgress(storage, scope).progress), plain(saved.progress));
});

test('progress isolates identities, course IDs, versions and collision-prone tuples', () => {
  const storage = memory();
  m.saveProgress(storage, scope, ['one']);
  for (const other of [{ ...scope, userId: 'opaque-user-b' }, { ...scope, courseId: 'other' }, { ...scope, courseVersion: 'v2' }]) {
    assert.notEqual(m.progressStorageKey(scope), m.progressStorageKey(other));
    assert.equal(m.loadProgress(storage, other).status, 'empty');
    m.saveProgress(storage, other, ['two']);
    assert.deepEqual(plain(m.loadProgress(storage, scope).progress.completedChapterIds), ['one']);
  }
  assert.notEqual(m.progressStorageKey({ ...scope, courseId: 'a:b', courseVersion: 'c' }),
    m.progressStorageKey({ ...scope, courseId: 'a', courseVersion: 'b:c' }));
});

test('payload scope and schema are checked even when foreign data occupies the right key', () => {
  const storage = memory();
  const key = m.progressStorageKey(scope);
  for (const changes of [{ userId: 'opaque-user-b' }, { courseId: 'other' }, { courseVersion: 'v2' },
    { schemaVersion: 2 }, { schemaVersion: '1' }]) {
    storage.setItem(key, JSON.stringify({ ...m.createProgress(scope, ['one']), ...changes }));
    const result = m.loadProgress(storage, scope);
    assert.equal(result.status, 'recovered');
    assert.deepEqual(plain(result.progress.completedChapterIds), []);
  }
});

test('corrupt storage recovers without throwing, writing or trusting malformed completions', () => {
  const storage = memory();
  const key = m.progressStorageKey(scope);
  for (const raw of ['', '{bad', 'null', '[]', 'true', '{}',
    ...[null, 'one', [1], ['one', null], ['']].map(completedChapterIds =>
      JSON.stringify({ ...m.createProgress(scope), completedChapterIds }))]) {
    storage.setItem(key, raw);
    const result = m.loadProgress(storage, scope);
    assert.equal(result.status, 'recovered');
    assert.deepEqual(plain(result.progress.completedChapterIds), []);
    assert.equal(storage.getItem(key), raw);
  }
  storage.setItem(key, JSON.stringify({ ...m.createProgress(scope), completedChapterIds: ['one', 'one', 'removed'], extra: 'discard' }));
  const result = m.loadProgress(storage, scope);
  assert.equal(result.status, 'recovered');
  assert.deepEqual(plain(result.progress.completedChapterIds), ['one']);
  assert.equal('extra' in result.progress, false);
});

test('unavailable/denied/quota-limited storage never claims a successful save', () => {
  const blocked = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
  for (const storage of [null, undefined, blocked]) {
    assert.equal(m.loadProgress(storage, scope).status, 'unavailable');
    const result = m.saveProgress(storage, scope, ['one']);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(plain(result.progress.completedChapterIds), ['one']);
  }
});

test('invalid identity/scope never reads or writes a shared fallback', () => {
  let calls = 0;
  const storage = { getItem() { calls++; return null; }, setItem() { calls++; } };
  for (const invalid of [null, ...['', ' ', 'user@example.com', 'a.b.c', 'a/b', 'x'.repeat(129), 1].map(userId => ({ ...scope, userId })),
    { ...scope, courseId: '' }, { ...scope, courseVersion: ' ' }, { ...scope, chapterIds: ['one', 'one'] },
    { ...scope, chapterIds: [null] }, { ...scope, chapterIds: new Array(1) }]) {
    assert.throws(() => m.loadProgress(storage, invalid));
    assert.throws(() => m.saveProgress(storage, invalid, []));
  }
  for (const ids of [null, [''], [NaN], [-1], new Array(1)]) assert.throws(() => m.saveProgress(storage, scope, ids));
  assert.equal(calls, 0);
});

test('AI Coach defaults disabled, is immutable and neither examines requests nor calls network', async () => {
  assert.equal(m.DEFAULT_AI_COACH.status, 'disabled');
  assert.equal(Object.isFrozen(m.DEFAULT_AI_COACH), true);
  const request = new Proxy({}, { get() { throw Error('Request must not be examined'); } });
  const response = await m.DEFAULT_AI_COACH.ask(request);
  assert.equal(response.status, 'disabled');
  assert.equal(response.message, m.DEFAULT_AI_COACH.statusMessage);
  assert.match(response.message, /沒有 AI 回答/);
  assert.equal('answer' in response, false);
});
