/**
 * Generic, illustrative Academy domain. No market predictions, private course
 * material, authentication, database, browser globals, or network dependencies.
 * Deterministic quiz/candle helpers are NOT AI. All indices are zero-based.
 */
export const ACADEMY_DISCLAIMER = '僅供教學示例，不構成投資建議；K 線形態不保證未來走勢。';

export interface Candle {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export type Validation<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false; readonly errors: readonly string[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** No coercion: numeric strings, missing values, NaN and infinities fail. */
export function validateCandle(input: unknown): Validation<Candle> {
  if (!record(input)) return { valid: false, errors: ['Candle must be an object.'] };
  const fields = ['open', 'high', 'low', 'close', 'volume'] as const;
  const errors: string[] = [];
  for (const field of fields) {
    if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) {
      errors.push(`${field} must be finite.`);
    }
  }
  if (errors.length) return { valid: false, errors };
  const candle: Candle = {
    open: input.open as number, high: input.high as number,
    low: input.low as number, close: input.close as number, volume: input.volume as number,
  };
  if (candle.low > candle.high || candle.open < candle.low || candle.open > candle.high
    || candle.close < candle.low || candle.close > candle.high) {
    errors.push('Require low <= open/close <= high.');
  }
  if (candle.volume < 0) errors.push('volume must be non-negative.');
  // Negative prices are permitted by this generic OHLC model; volume is not.
  return errors.length ? { valid: false, errors } : { valid: true, value: candle };
}

export interface CandleClassification {
  readonly kind: 'doji' | 'red' | 'black';
  readonly explanation: string;
}

/** Taiwan color convention; doji means EXACT open === close, no hidden tolerance. */
export function classifyCandle(input: unknown): CandleClassification {
  const validation = validateCandle(input);
  if (validation.valid === false) throw new TypeError(validation.errors.join(' '));
  const { open, close } = validation.value;
  if (open === close) return { kind: 'doji', explanation: `十字：開盤價等於收盤價。${ACADEMY_DISCLAIMER}` };
  return close > open
    ? { kind: 'red', explanation: `紅 K：收盤價高於開盤價，不代表一定高於前一日收盤。${ACADEMY_DISCLAIMER}` }
    : { kind: 'black', explanation: `黑 K：收盤價低於開盤價，不代表一定低於前一日收盤。${ACADEMY_DISCLAIMER}` };
}

/** Single-choice question. Multi-select is intentionally not implied by correctIndex. */
export interface Question {
  readonly id: string;
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly correctIndex: number;
  readonly explanation: string;
}

export function validateQuestion(input: unknown): Validation<Question> {
  if (!record(input)) return { valid: false, errors: ['Question must be an object.'] };
  const errors: string[] = [];
  for (const field of ['id', 'prompt', 'explanation']) {
    if (!text(input[field])) errors.push(`${field} must be non-empty text.`);
  }
  if (!Array.isArray(input.choices) || input.choices.length < 2
    || Array.from(input.choices).some(choice => !text(choice))) {
    errors.push('choices must contain at least two non-empty strings.');
  }
  if (!Number.isInteger(input.correctIndex) || (input.correctIndex as number) < 0
    || !Array.isArray(input.choices) || (input.correctIndex as number) >= input.choices.length) {
    errors.push('correctIndex must be a valid zero-based choice index.');
  }
  if (errors.length) return { valid: false, errors };
  return { valid: true, value: {
    id: input.id as string, prompt: input.prompt as string,
    choices: [...input.choices as string[]], correctIndex: input.correctIndex as number,
    explanation: input.explanation as string,
  } };
}

export interface QuestionResult {
  readonly questionId: string;
  readonly selectedIndex: number | null;
  readonly correctIndex: number;
  readonly answered: boolean;
  readonly isCorrect: boolean;
  readonly explanation: string;
}

/** Invalid authoring throws; missing/malformed learner answers are unanswered, never correct. */
export function evaluateQuestion(question: Question, answer: unknown): QuestionResult {
  const validation = validateQuestion(question);
  if (validation.valid === false) throw new TypeError(validation.errors.join(' '));
  const q = validation.value;
  const answered = typeof answer === 'number' && Number.isInteger(answer)
    && answer >= 0 && answer < q.choices.length;
  return {
    questionId: q.id, selectedIndex: answered ? answer as number : null,
    correctIndex: q.correctIndex, answered, isCorrect: answered && answer === q.correctIndex,
    explanation: q.explanation,
  };
}

export interface QuizScore {
  readonly correct: number;
  readonly total: number;
  readonly answered: number;
  /** 0–100, unrounded; an empty quiz returns zero, not a fabricated pass. */
  readonly percentage: number;
  readonly results: readonly QuestionResult[];
}

/** Equal weight; unanswered/invalid answers earn zero. Unknown answer IDs are ignored. */
export function scoreQuiz(questions: readonly Question[], answers: Readonly<Record<string, unknown>>): QuizScore {
  if (!Array.isArray(questions) || !record(answers)) throw new TypeError('Invalid quiz contract.');
  const seen = new Set<string>();
  const results = Array.from(questions, question => {
    const result = evaluateQuestion(question, record(question) && typeof question.id === 'string'
      && Object.prototype.hasOwnProperty.call(answers, question.id) ? answers[question.id] : undefined);
    if (seen.has(result.questionId)) throw new TypeError('Duplicate question ID.');
    seen.add(result.questionId);
    return result;
  });
  const correct = results.filter(result => result.isCorrect).length;
  return {
    correct, total: results.length, answered: results.filter(result => result.answered).length,
    percentage: results.length ? correct / results.length * 100 : 0, results,
  };
}

export interface SequenceResult {
  readonly isCorrect: boolean;
  readonly validAnswer: boolean;
  readonly matchedPositions: number;
  readonly total: number;
}

function uniqueIds(input: unknown): input is string[] {
  return Array.isArray(input) && Array.from(input).every(text) && new Set(input).size === input.length;
}

/** Stable, unique item IDs, not labels. Correct only for a complete EXACT permutation. */
export function evaluateSequence(expected: readonly string[], answer: unknown): SequenceResult {
  if (!uniqueIds(expected) || expected.length === 0) throw new TypeError('Expected sequence must have unique non-empty IDs.');
  const allowed = new Set(expected);
  const validAnswer = uniqueIds(answer) && answer.length === expected.length && answer.every(id => allowed.has(id));
  const matchedPositions = validAnswer ? expected.filter((id, index) => id === answer[index]).length : 0;
  return { isCorrect: validAnswer && matchedPositions === expected.length, validAnswer, matchedPositions, total: expected.length };
}

/** Caller supplies a non-secret opaque ID (never email, credentials, or tokens).
 * No guest/global fallback. UI must reload this scope on identity/course changes.
 * This is local convenience storage, NOT an authorization boundary or trusted grade.
 */
export interface ProgressScope {
  readonly userId: string;
  readonly courseId: string;
  readonly courseVersion: string;
  readonly chapterIds: readonly string[];
}

export interface AcademyProgress {
  readonly schemaVersion: 1;
  readonly userId: string;
  readonly courseId: string;
  readonly courseVersion: string;
  readonly completedChapterIds: readonly string[];
}

/** Inject localStorage (or a test double); accessing browser storage is the caller's responsibility. */
export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function assertScope(scope: ProgressScope): void {
  if (!record(scope) || typeof scope.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(scope.userId)
    || !text(scope.courseId) || !text(scope.courseVersion) || !uniqueIds(scope.chapterIds)) {
    throw new TypeError('Invalid progress scope: opaque user ID, course, version and unique chapter IDs required.');
  }
}

/** Tuple encoding prevents delimiter collisions and isolates users/courses/versions. */
export function progressStorageKey(scope: ProgressScope): string {
  assertScope(scope);
  return `morning-alpha:academy:progress:v1:${JSON.stringify([scope.userId, scope.courseId, scope.courseVersion])}`;
}

/** Whitelist chapter IDs; deduplicate in first-completion order. Never persist extra payload. */
export function createProgress(scope: ProgressScope, completedChapterIds: readonly string[] = []): AcademyProgress {
  assertScope(scope);
  if (!Array.isArray(completedChapterIds) || Array.from(completedChapterIds).some(id => !text(id))) {
    throw new TypeError('Completed chapter IDs must be non-empty strings.');
  }
  const allowed = new Set(scope.chapterIds);
  return {
    schemaVersion: 1, userId: scope.userId, courseId: scope.courseId, courseVersion: scope.courseVersion,
    completedChapterIds: [...new Set(completedChapterIds)].filter(id => allowed.has(id)),
  };
}

export interface ProgressLoadResult {
  readonly status: 'empty' | 'loaded' | 'recovered' | 'unavailable';
  readonly progress: AcademyProgress;
}

/** Read-only recovery: corrupt/mismatched data returns clean progress, never throws JSON errors.
 * Unknown/duplicate chapters are sanitized with status recovered. No implicit writes/removals.
 */
export function loadProgress(storage: ProgressStorage | null | undefined, scope: ProgressScope): ProgressLoadResult {
  const key = progressStorageKey(scope);
  const empty = createProgress(scope);
  let raw: string | null;
  try {
    if (!storage) return { status: 'unavailable', progress: empty };
    raw = storage.getItem(key);
  } catch { return { status: 'unavailable', progress: empty }; }
  if (raw === null) return { status: 'empty', progress: empty };
  try {
    const data: unknown = JSON.parse(raw);
    if (!record(data) || data.schemaVersion !== 1 || data.userId !== scope.userId
      || data.courseId !== scope.courseId || data.courseVersion !== scope.courseVersion
      || !Array.isArray(data.completedChapterIds) || Array.from(data.completedChapterIds).some(id => !text(id))) {
      return { status: 'recovered', progress: empty };
    }
    const progress = createProgress(scope, data.completedChapterIds);
    const canonicalFields = ['schemaVersion', 'userId', 'courseId', 'courseVersion', 'completedChapterIds'];
    const sanitized = progress.completedChapterIds.length !== data.completedChapterIds.length
      || Object.keys(data).some(field => !canonicalFields.includes(field));
    return { status: sanitized ? 'recovered' : 'loaded', progress };
  } catch { return { status: 'recovered', progress: empty }; }
}

export interface ProgressSaveResult {
  readonly status: 'saved' | 'unavailable';
  readonly progress: AcademyProgress;
}

/** Explicit save only. Storage failures preserve an in-memory result but never claim persistence.
 * Accept chapter IDs, not a foreign progress object; callers must use the current identity's scope.
 */
export function saveProgress(storage: ProgressStorage | null | undefined, scope: ProgressScope,
  completedChapterIds: readonly string[]): ProgressSaveResult {
  const key = progressStorageKey(scope);
  const progress = createProgress(scope, completedChapterIds);
  try {
    if (!storage) return { status: 'unavailable', progress };
    storage.setItem(key, JSON.stringify(progress));
    return { status: 'saved', progress };
  } catch { return { status: 'unavailable', progress }; }
}

export interface AICoachRequest {
  readonly question: string;
  readonly chapterId: string;
}

export type AICoachResponse =
  | { readonly status: 'disabled' | 'unavailable'; readonly message: string }
  | { readonly status: 'answered'; readonly message: string };

/** Future adapters must honestly expose availability; deterministic helpers are never AI replies. */
export interface AICoachAdapter {
  readonly status: 'disabled' | 'available' | 'unavailable';
  readonly statusMessage: string;
  ask(request: AICoachRequest): Promise<AICoachResponse>;
}

const COACH_DISABLED_MESSAGE = 'AI 教練尚未啟用；目前沒有 AI 回答，也未連線至任何 AI 服務。';

/** No request processing, storage, logs, credentials, API call, or network fallback. */
export const DEFAULT_AI_COACH: AICoachAdapter = Object.freeze({
  status: 'disabled' as const,
  statusMessage: COACH_DISABLED_MESSAGE,
  async ask(_request: AICoachRequest): Promise<AICoachResponse> {
    return { status: 'disabled', message: COACH_DISABLED_MESSAGE };
  },
});
