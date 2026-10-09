import { parseCourse, type AcademyChapter } from '../../pages/academy/content.ts';

export type AcademyMemberTier = 'free' | 'premium' | 'owner';
export type AcademyCatalogChapter = { id: string; title: string; tier: 'free' | 'premium'; allowed: boolean };
export type AcademyMemberAnswer = { question_id: string; choice_index: number; correct: boolean };
export type AcademyMemberProgress = {
  chapter_id: string; completed: boolean; last_position: number;
  answers: AcademyMemberAnswer[]; updated_at: string;
};
export type AcademyMemberCatalog = {
  version: 'ACADEMY_MEMBER_V11'; user_id: string; tier: AcademyMemberTier;
  chapters: AcademyCatalogChapter[]; progress: AcademyMemberProgress[];
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('ACADEMY_INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('ACADEMY_INVALID_RESPONSE');
  return value;
}
function id(value: unknown): string {
  const result = text(value, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw Error('ACADEMY_INVALID_ID');
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw Error('ACADEMY_INVALID_RESPONSE');
  return value;
}
function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw Error('ACADEMY_INVALID_RESPONSE');
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw Error('ACADEMY_INVALID_RESPONSE');
  return value;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw Error('ACADEMY_DUPLICATE_ID');
}

export function parseMemberProgress(value: unknown, chapterId?: string): AcademyMemberProgress {
  const row = object(value), chapter_id = id(row.chapter_id);
  if (chapterId !== undefined && chapter_id !== chapterId) throw Error('ACADEMY_CHAPTER_MISMATCH');
  const answers = list(row.answers, 30).map(value => {
    const answer = object(value);
    return { question_id: id(answer.question_id), choice_index: integer(answer.choice_index, 7), correct: bool(answer.correct) };
  });
  unique(answers.map(answer => answer.question_id));
  const updated_at = text(row.updated_at, 100);
  if (!Number.isFinite(Date.parse(updated_at))) throw Error('ACADEMY_INVALID_RESPONSE');
  return { chapter_id, completed: bool(row.completed), last_position: integer(row.last_position, 100000), answers, updated_at };
}

export function parseMemberCatalog(value: unknown, verifiedUserId: string): AcademyMemberCatalog {
  const data = object(value);
  if (data.version !== 'ACADEMY_MEMBER_V11' || !verifiedUserId || data.user_id !== verifiedUserId) throw Error('ACADEMY_IDENTITY_MISMATCH');
  if (data.tier !== 'free' && data.tier !== 'premium' && data.tier !== 'owner') throw Error('ACADEMY_INVALID_TIER');
  const tier = data.tier;
  const chapters = list(data.chapters, 60).map(value => {
    const chapter = object(value);
    if (chapter.tier !== 'free' && chapter.tier !== 'premium') throw Error('ACADEMY_INVALID_TIER');
    const allowed = bool(chapter.allowed);
    if (allowed && tier === 'free' && chapter.tier === 'premium') throw Error('ACADEMY_INVALID_ACCESS');
    return { id: id(chapter.id), title: text(chapter.title), tier: chapter.tier, allowed } as AcademyCatalogChapter;
  });
  unique(chapters.map(chapter => chapter.id));
  const progress = list(data.progress, 60).map(value => parseMemberProgress(value));
  unique(progress.map(row => row.chapter_id));
  if (progress.some(row => !chapters.some(chapter => chapter.id === row.chapter_id && chapter.allowed))) throw Error('ACADEMY_PROGRESS_SCOPE');
  return { version: 'ACADEMY_MEMBER_V11', user_id: verifiedUserId, tier, chapters, progress };
}

export function parseMemberLesson(value: unknown, chapterId: string): AcademyChapter {
  // Reuse the existing bounded chapter/diagram parser; no lesson text is bundled here.
  const chapter = parseCourse({ version: 'ACADEMY_MEMBER_V11', title: '會員課程', notice: '教育用途', chapters: [value] }).chapters[0];
  if (chapter.id !== chapterId) throw Error('ACADEMY_CHAPTER_MISMATCH');
  return chapter;
}

export function memberChapterPassed(chapter: AcademyChapter, progress?: AcademyMemberProgress): boolean {
  return !!progress && progress.chapter_id === chapter.id && chapter.questions.every(question =>
    question.kind !== 'order' && progress.answers.some(answer => answer.question_id === question.id && answer.correct));
}

export function parseMemberPdf(value: unknown): { filename: string; blob: Blob } {
  const data = object(value);
  if (data.mime !== 'application/pdf') throw Error('ACADEMY_INVALID_PDF');
  const encoded = text(data.base64, 70 * 1024 * 1024).replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw Error('ACADEMY_INVALID_PDF');
  const decoded = atob(encoded);
  if (!decoded.startsWith('%PDF-') || decoded.length > 50 * 1024 * 1024) throw Error('ACADEMY_INVALID_PDF');
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  const filename = [...text(data.filename, 200)].map(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '/' || char === '\\' ? '_' : char).join('');
  return { filename: filename.toLowerCase().endsWith('.pdf') ? filename : filename + '.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) };
}
