/** UI import boundary only. No private course content belongs in this module. */
import { validateCandle, type Candle } from '../../features/academy/model.ts';
export type DiagramKind = 'candle' | 'volume' | 'trend' | 'zones' | 'bullSteps' | 'bearSteps' | 'cycle' | 'steps' | 'risk';
export type AcademyDiagram = {
  kind: DiagramKind; caption: string; labels?: string[]; values?: number[]; visibleCounts?: number[];
  candles?: Candle[]; volumes?: number[]; levels?: { label: string; low: number; high: number }[];
  risk?: { entry: number; stop: number; target: number };
};
export type AcademyQuestion = {
  id: string; prompt: string; choices: string[]; correctIndex: number; explanation: string;
  kind?: 'choice' | 'order' | 'diagram' | 'zone'; order?: string[];
};
export type AcademyChapter = {
  id: string; title: string; goal: string; paragraphs: string[]; example: string;
  mistakes: string[]; sourceNote: string; diagram: AcademyDiagram;
  questions: AcademyQuestion[]; examples?: { title: string; explanation: string; diagram: AcademyDiagram }[];
};
export type AcademyCourse = { version: string; title: string; notice: string; chapters: AcademyChapter[] };
export const MAX_COURSE_BYTES = 2 * 1024 * 1024;
const diagramKinds = new Set(['candle', 'volume', 'trend', 'zones', 'bullSteps', 'bearSteps', 'cycle', 'steps', 'risk']);
const questionKinds = new Set(['choice', 'order', 'diagram', 'zone']);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_COURSE');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 12000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('INVALID_COURSE');
  return value;
}
function id(value: unknown): string {
  const result = text(value, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw Error('INVALID_ID');
  return result;
}
function list<T>(value: unknown, parse: (v: unknown) => T, max: number, min = 0): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw Error('INVALID_COURSE');
  return value.map(parse);
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw Error('DUPLICATE_ID');
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw Error('INVALID_NUMBER');
  return value;
}
function parseDiagram(value: unknown): AcademyDiagram {
  const d = record(value);
  if (!diagramKinds.has(String(d.kind))) throw Error('INVALID_DIAGRAM');
  const result: AcademyDiagram = { kind: d.kind as DiagramKind, caption: text(d.caption) };
  if (d.labels !== undefined) result.labels = list(d.labels, v => text(v, 300), 24, 1);
  if (d.values !== undefined) result.values = list(d.values, finite, 256, 2);
  if (d.candles !== undefined) result.candles = list(d.candles, v => {
    const parsed = validateCandle(v); if (parsed.valid === false) throw Error('INVALID_CANDLE');
    Object.values(parsed.value).forEach(finite); return parsed.value;
  }, 128, 1);
  if (d.volumes !== undefined) {
    result.volumes = list(d.volumes, v => { const n = finite(v); if (n < 0) throw Error('INVALID_VOLUME'); return n; }, 256, 1);
    if (result.volumes.length !== (result.candles?.length || result.values?.length)) throw Error('VOLUME_LENGTH_MISMATCH');
  }
  if (d.visibleCounts !== undefined) {
    result.visibleCounts = list(d.visibleCounts, v => { const n = finite(v); if (!Number.isInteger(n) || n < 1) throw Error('INVALID_REVEAL'); return n; }, 24, 1);
    const size = result.candles?.length || result.values?.length;
    if (!size || result.visibleCounts.length !== result.labels?.length || result.visibleCounts.some((n, i, a) => n > size || (i > 0 && n <= a[i - 1])) || result.visibleCounts.at(-1) !== size) throw Error('INVALID_REVEAL');
  }
  if (d.levels !== undefined) result.levels = list(d.levels, v => {
    const level = record(v); const low = finite(level.low), high = finite(level.high);
    if (low > high) throw Error('INVALID_ZONE'); return { label: text(level.label, 100), low, high };
  }, 12, 1);
  if (d.risk !== undefined) {
    const r = record(d.risk); const entry = finite(r.entry), stop = finite(r.stop), target = finite(r.target);
    if (!((stop < entry && entry < target) || (target < entry && entry < stop))) throw Error('INVALID_RISK');
    result.risk = { entry, stop, target };
  }
  return result;
}
export function parseCourse(value: unknown): AcademyCourse {
  const root = record(value);
  const chapters = list(root.chapters, v => {
    const c = record(v);
    const questions = list(c.questions, v => {
      const q = record(v);
      const choices = list(q.choices, v => text(v, 1000), 8, 2);
      unique(choices);
      if (!Number.isInteger(q.correctIndex) || Number(q.correctIndex) < 0 || Number(q.correctIndex) >= choices.length) throw Error('INVALID_ANSWER');
      const kind = q.kind === undefined ? 'choice' : q.kind;
      if (!questionKinds.has(String(kind))) throw Error('INVALID_QUESTION_KIND');
      let order: string[] | undefined;
      if (kind === 'order') {
        order = list(q.order, v => text(v, 1000), 8, 2);
        unique(order);
        if (order.length !== choices.length || order.some(x => !choices.includes(x))) throw Error('INVALID_ORDER');
      }
      return { id: id(q.id), prompt: text(q.prompt), choices, correctIndex: Number(q.correctIndex),
        explanation: text(q.explanation), kind: kind as AcademyQuestion['kind'], ...(order ? { order } : {}) };
    }, 30);
    unique(questions.map(q => q.id));
    return { id: id(c.id), title: text(c.title, 300), goal: text(c.goal),
      paragraphs: list(c.paragraphs, v => text(v), 80), example: text(c.example),
      mistakes: list(c.mistakes, v => text(v), 30), sourceNote: text(c.sourceNote),
      diagram: parseDiagram(c.diagram), questions,
      ...(c.examples === undefined ? {} : { examples: list(c.examples, v => {
        const e = record(v); return { title: text(e.title, 300), explanation: text(e.explanation), diagram: parseDiagram(e.diagram) };
      }, 24) }) };
  }, 60, 1);
  unique(chapters.map(c => c.id));
  return { version: text(root.version, 100), title: text(root.title, 300), notice: text(root.notice), chapters };
}
