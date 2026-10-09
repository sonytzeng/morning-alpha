import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMemberCatalog, parseMemberProgress, parseMemberLesson,
  parseMemberPdf, memberChapterPassed,
} from '../src/features/academy/member.ts';

// Pure, synthetic unit fixtures only. No curriculum import, private file access,
// real account, network, database, PDF artifact, or source-material text.
const userId = 'synthetic-user-a';
const question = (id = 'fixture-question-a') => ({
  id, prompt: 'Synthetic prompt', choices: ['Option A', 'Option B'],
  correctIndex: 0, explanation: 'Synthetic explanation', kind: 'choice',
});
const lesson = () => ({
  id: 'fixture-free', title: 'Synthetic lesson', goal: 'Synthetic goal',
  paragraphs: ['Synthetic paragraph'], example: 'Synthetic example',
  mistakes: ['Synthetic note'], sourceNote: 'Unit fixture; no source material',
  diagram: { kind: 'trend', caption: 'Synthetic diagram', values: [1, 2, 1] },
  questions: [question(), question('fixture-question-b')],
});
const answer = (question_id = 'fixture-question-a', correct = true, choice_index = 0) => ({ question_id, correct, choice_index });
const progress = () => ({
  chapter_id: 'fixture-free', completed: false, last_position: 0,
  answers: [], updated_at: '2026-01-01T00:00:00.000Z',
});
const catalog = () => ({
  version: 'ACADEMY_MEMBER_V11', user_id: userId, tier: 'free',
  chapters: [
    { id: 'fixture-free', title: 'Synthetic free', tier: 'free', allowed: true },
    { id: 'fixture-locked', title: 'Synthetic premium', tier: 'premium', allowed: false },
  ],
  progress: [progress()],
});
// A header fragment, not a real PDF. This tests envelope/signature validation,
// not document rendering or the safety of arbitrary PDF contents.
const pdf = () => ({ filename: 'synthetic-test.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF-1.4\nUNIT-TEST-ONLY\n').toString('base64') });

test('member catalog accepts a verified identity and leaves the input unchanged', () => {
  const input = catalog(), before = structuredClone(input);
  const parsed = parseMemberCatalog(input, userId);
  assert.deepEqual(parsed, before);
  assert.deepEqual(input, before);
  parsed.chapters[0].title = 'Changed parsed value';
  assert.deepEqual(input, before);
});

test('member catalog rejects identity mismatch, absent identity and wrong contract version', () => {
  for (const verifiedId of ['synthetic-user-b', '', null, undefined]) {
    assert.throws(() => parseMemberCatalog(catalog(), verifiedId), /ACADEMY_IDENTITY_MISMATCH/);
  }
  for (const user_id of [null, undefined, 'synthetic-user-b']) {
    assert.throws(() => parseMemberCatalog({ ...catalog(), user_id }, userId));
  }
  assert.throws(() => parseMemberCatalog({ ...catalog(), version: 'UNREVIEWED_VERSION' }, userId));
});

test('free catalog cannot grant access to a premium chapter', () => {
  const value = catalog(); value.chapters[1].allowed = true;
  assert.throws(() => parseMemberCatalog(value, userId), /ACADEMY_INVALID_ACCESS/);
});

test('verified premium and owner catalogs accept server-granted premium access', () => {
  for (const tier of ['premium', 'owner']) {
    const value = catalog(); value.tier = tier; value.chapters[1].allowed = true;
    assert.equal(parseMemberCatalog(value, userId).chapters[1].allowed, true);
  }
});

test('catalog does not invent access from tier when the server marks a chapter locked', () => {
  const value = catalog(); value.tier = 'owner';
  assert.equal(parseMemberCatalog(value, userId).chapters[1].allowed, false);
});

test('catalog rejects unknown tiers and non-boolean allowed fields', () => {
  for (const tier of ['admin', 'paid', '', null, 1]) assert.throws(() => parseMemberCatalog({ ...catalog(), tier }, userId));
  for (const tier of ['owner', '', null]) {
    const value = catalog(); value.chapters[0].tier = tier;
    assert.throws(() => parseMemberCatalog(value, userId));
  }
  for (const allowed of ['true', 1, null, undefined]) {
    const value = catalog(); value.chapters[0].allowed = allowed;
    assert.throws(() => parseMemberCatalog(value, userId));
  }
});

test('catalog scopes progress to its verified identity and allowed chapter inventory', () => {
  // Progress RPC rows omit user_id; ownership is established by the verified
  // catalog identity plus backend RLS, not by a client-supplied progress claim.
  for (const chapter_id of ['fixture-locked', 'fixture-absent']) {
    const value = catalog(); value.progress[0].chapter_id = chapter_id;
    assert.throws(() => parseMemberCatalog(value, userId), /ACADEMY_PROGRESS_SCOPE/);
  }
  const foreign = catalog(); foreign.user_id = 'synthetic-user-b';
  assert.throws(() => parseMemberCatalog(foreign, userId), /ACADEMY_IDENTITY_MISMATCH/);
});

test('revoked premium progress is rejected while a filtered free catalog is accepted', () => {
  const value = catalog(); value.tier = 'premium'; value.chapters[1].allowed = true;
  value.progress.push({ ...progress(), chapter_id: 'fixture-locked' });
  assert.equal(parseMemberCatalog(value, userId).progress.length, 2);
  value.tier = 'free'; value.chapters[1].allowed = false;
  assert.throws(() => parseMemberCatalog(value, userId), /ACADEMY_PROGRESS_SCOPE/);
  value.progress.pop();
  assert.equal(parseMemberCatalog(value, userId).progress.length, 1);
});

test('catalog rejects duplicate chapters, duplicate progress and oversized arrays', () => {
  const duplicateChapter = catalog(); duplicateChapter.chapters.push({ ...duplicateChapter.chapters[0] });
  const duplicateProgress = catalog(); duplicateProgress.progress.push(progress());
  assert.throws(() => parseMemberCatalog(duplicateChapter, userId), /ACADEMY_DUPLICATE_ID/);
  assert.throws(() => parseMemberCatalog(duplicateProgress, userId), /ACADEMY_DUPLICATE_ID/);
  for (const field of ['chapters', 'progress']) {
    const value = catalog(); value[field] = Array.from({ length: 61 }, (_, i) => field === 'chapters'
      ? { id: `fixture-${i}`, title: 'Synthetic', tier: 'free', allowed: true }
      : { ...progress(), chapter_id: `fixture-${i}` });
    assert.throws(() => parseMemberCatalog(value, userId));
  }
});

test('catalog rejects malformed roots and nested server data', () => {
  for (const value of [null, undefined, [], {}, 'catalog', 7]) assert.throws(() => parseMemberCatalog(value, userId));
  for (const field of ['chapters', 'progress']) {
    for (const bad of [null, undefined, {}, '[]', [null]]) assert.throws(() => parseMemberCatalog({ ...catalog(), [field]: bad }, userId));
  }
  for (const patch of [{ id: '../invalid' }, { title: '' }, { title: 'x'.repeat(301) }]) {
    const value = catalog(); Object.assign(value.chapters[0], patch);
    assert.throws(() => parseMemberCatalog(value, userId));
  }
});

test('catalog whitelists fields and does not retain extra payload or client role hints', () => {
  const value = catalog(); value.clientTier = 'owner'; value.privatePayload = 'SYNTHETIC_UNUSED';
  value.chapters[0].content = 'SYNTHETIC_UNUSED'; value.progress[0].unused = 'SYNTHETIC_UNUSED';
  const parsed = parseMemberCatalog(value, userId);
  assert.equal('clientTier' in parsed, false);
  assert.equal('privatePayload' in parsed, false);
  assert.equal('content' in parsed.chapters[0], false);
  assert.equal('unused' in parsed.progress[0], false);
  assert.equal(parsed.tier, 'free');
});

test('progress validates the requested chapter and preserves server wrong answers', () => {
  const value = { ...progress(), answers: [answer('fixture-question-a', false, 1)] };
  assert.deepEqual(parseMemberProgress(value, 'fixture-free'), value);
  assert.throws(() => parseMemberProgress(value, 'fixture-other'), /ACADEMY_CHAPTER_MISMATCH/);
});

test('progress accepts both position limits without coercion', () => {
  for (const last_position of [0, 1, 100000]) assert.equal(parseMemberProgress({ ...progress(), last_position }).last_position, last_position);
  for (const last_position of [-1, 100001, 0.5, NaN, Infinity, '1', null, undefined]) {
    assert.throws(() => parseMemberProgress({ ...progress(), last_position }));
  }
});

test('progress rejects malformed completion, date and answer records', () => {
  for (const completed of ['true', 1, null]) assert.throws(() => parseMemberProgress({ ...progress(), completed }));
  for (const updated_at of ['', 'not-a-date', null, 7]) assert.throws(() => parseMemberProgress({ ...progress(), updated_at }));
  for (const answers of [null, {}, '[]', [null]]) assert.throws(() => parseMemberProgress({ ...progress(), answers }));
  for (const value of [null, [], {}, 'progress']) assert.throws(() => parseMemberProgress(value));
});

test('progress rejects duplicate answer IDs, invalid IDs, invalid indices and coerced grades', () => {
  assert.throws(() => parseMemberProgress({ ...progress(), answers: [answer(), answer()] }), /ACADEMY_DUPLICATE_ID/);
  for (const question_id of ['', '../q', null]) assert.throws(() => parseMemberProgress({ ...progress(), answers: [answer(question_id)] }));
  for (const choice_index of [-1, 8, 0.5, NaN, Infinity, '0', null]) assert.throws(() => parseMemberProgress({ ...progress(), answers: [answer('fixture-question-a', true, choice_index)] }));
  for (const correct of ['true', 1, null]) assert.throws(() => parseMemberProgress({ ...progress(), answers: [answer('fixture-question-a', correct)] }));
  assert.throws(() => parseMemberProgress({ ...progress(), answers: Array.from({ length: 31 }, (_, i) => answer(`fixture-q-${i}`)) }));
});

test('lesson parser accepts synthetic chapter data, strips extras and preserves input', () => {
  const input = lesson(), before = structuredClone(input); input.unused = 'SYNTHETIC_UNUSED';
  const parsed = parseMemberLesson(input, input.id);
  assert.deepEqual(parsed, before);
  assert.equal('unused' in parsed, false);
  assert.deepEqual(input, { ...before, unused: 'SYNTHETIC_UNUSED' });
});

test('lesson parser rejects another chapter, malformed roots and missing required fields', () => {
  assert.throws(() => parseMemberLesson(lesson(), 'fixture-other'), /ACADEMY_CHAPTER_MISMATCH/);
  for (const value of [null, undefined, [], {}, 'lesson']) assert.throws(() => parseMemberLesson(value, 'fixture-free'));
  for (const field of ['title', 'goal', 'paragraphs', 'example', 'mistakes', 'sourceNote', 'diagram', 'questions']) {
    const value = lesson(); delete value[field];
    assert.throws(() => parseMemberLesson(value, value.id), field);
  }
});

test('lesson parser rejects invalid diagram numbers, OHLC and question contracts', () => {
  for (const diagram of [
    { kind: 'unknown', caption: 'Synthetic' },
    { kind: 'trend', caption: 'Synthetic', values: [1, '2'] },
    { kind: 'trend', caption: 'Synthetic', values: [1, Infinity] },
    { kind: 'candle', caption: 'Synthetic', candles: [{ open: 2, high: 1, low: 0, close: 2, volume: 1 }] },
  ]) assert.throws(() => parseMemberLesson({ ...lesson(), diagram }, 'fixture-free'));
  for (const patch of [{ choices: ['Only'] }, { correctIndex: 2 }, { correctIndex: '0' }, { kind: 'unknown' }, { explanation: null }]) {
    assert.throws(() => parseMemberLesson({ ...lesson(), questions: [{ ...question(), ...patch }] }, 'fixture-free'));
  }
  assert.throws(() => parseMemberLesson({ ...lesson(), questions: [question(), question()] }, 'fixture-free'));
});

test('lesson text stays plain data; parser does not turn markup into executable HTML', () => {
  const value = lesson(); value.title = '<b>Synthetic markup</b>';
  assert.equal(parseMemberLesson(value, value.id).title, value.title);
});

test('wrong or unanswered quiz cannot pass even with a completed flag or matching local answer index', () => {
  const chapter = lesson();
  for (const answers of [[], [answer()], [answer(), answer('fixture-question-b', false)]]) {
    assert.equal(memberChapterPassed(chapter, { ...progress(), completed: true, answers }), false);
  }
  assert.equal(memberChapterPassed(chapter), false);
  assert.equal(memberChapterPassed(chapter, { ...progress(), chapter_id: 'fixture-other', answers: chapter.questions.map(q => answer(q.id)) }), false);
});

test('passing gate uses every server grade, never the embedded correctIndex', () => {
  const chapter = lesson();
  const row = { ...progress(), answers: chapter.questions.map(q => answer(q.id, true, 1)) };
  assert(chapter.questions.every(q => q.correctIndex === 0));
  assert.equal(memberChapterPassed(chapter, row), true);
  assert.equal(row.completed, false, 'client gate must not itself mark server completion');
  row.answers[0] = answer(chapter.questions[0].id, false, 0);
  assert.equal(memberChapterPassed(chapter, row), false);
});

test('wrong answer overwrite removes passing eligibility without mutating the grade payload', () => {
  const chapter = lesson();
  const prior = { ...progress(), answers: chapter.questions.map(q => answer(q.id)) };
  const replacement = parseMemberProgress({ ...prior, answers: [answer('fixture-question-a', false, 1), answer('fixture-question-b')] });
  const before = structuredClone(replacement);
  assert.equal(memberChapterPassed(chapter, prior), true);
  assert.equal(memberChapterPassed(chapter, replacement), false);
  assert.deepEqual(replacement, before);
});

test('unknown question IDs and unsupported ordering cannot satisfy the passing gate', () => {
  const chapter = lesson();
  assert.equal(memberChapterPassed(chapter, { ...progress(), answers: [answer('fixture-other')] }), false);
  chapter.questions[0] = { ...chapter.questions[0], kind: 'order', order: ['Option A', 'Option B'] };
  assert.equal(memberChapterPassed(chapter, { ...progress(), answers: chapter.questions.map(q => answer(q.id)) }), false);
});

test('PDF parser decodes only synthetic header bytes and permits wrapped base64', async () => {
  const input = pdf(), before = structuredClone(input);
  input.base64 = input.base64.match(/.{1,8}/g).join('\n');
  const parsed = parseMemberPdf(input);
  assert.equal(parsed.filename, before.filename);
  assert.equal(parsed.blob.type, 'application/pdf');
  assert.equal(await parsed.blob.text(), '%PDF-1.4\nUNIT-TEST-ONLY\n');
  assert.equal(input.base64.includes('\n'), true);
});

test('PDF filenames cannot carry path separators or control characters', () => {
  const parsed = parseMemberPdf({ ...pdf(), filename: '../folder\\unit\u0000\n' });
  assert.equal(parsed.filename, '.._folder_unit__.pdf');
  assert.equal(parseMemberPdf({ ...pdf(), filename: 'SYNTHETIC.PDF' }).filename, 'SYNTHETIC.PDF');
  for (const filename of ['', null, 1, 'x'.repeat(201)]) assert.throws(() => parseMemberPdf({ ...pdf(), filename }));
});

test('PDF parser rejects wrong MIME, malformed base64 and non-PDF payloads', () => {
  for (const mime of ['text/html', 'image/png', null, undefined]) assert.throws(() => parseMemberPdf({ ...pdf(), mime }));
  for (const base64 of ['', null, 1, 'invalid!', 'YQ=', '====', 'data:application/pdf;base64,AAAA', Buffer.from('NOT_A_PDF').toString('base64')]) {
    assert.throws(() => parseMemberPdf({ ...pdf(), base64 }));
  }
  for (const value of [null, undefined, [], {}, 'pdf']) assert.throws(() => parseMemberPdf(value));
});
