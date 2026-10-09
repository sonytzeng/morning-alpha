import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, BookOpen, Check, FileUp, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { useOwnerAccess } from './useOwnerAccess';
import { MAX_COURSE_BYTES, parseCourse, type AcademyChapter, type AcademyCourse } from './content';
import { createScope, localProgressStorage } from './progress';
import { DEFAULT_AI_COACH, loadProgress, saveProgress as persistProgress, type ProgressScope } from '@/features/academy/model';
import Diagram from './Diagram';
import Quiz from './Quiz';
import './academy.css';

const MemberAcademy = lazy(() => import('./MemberAcademy'));

// Only the isolated serve config defines this. URL/storage flags cannot enable it.
declare const __ACADEMY_LOCAL_ISOLATED__: boolean;
const localPreview = () => typeof __ACADEMY_LOCAL_ISOLATED__ !== 'undefined' && __ACADEMY_LOCAL_ISOLATED__ === true
  && import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);

function Lesson({ chapter, complete, onComplete }: { chapter: AcademyChapter; complete: boolean; onComplete: () => void }) {
  const [passed, setPassed] = useState<string[]>([]);
  return <>
    <header className="academy-lesson-header"><p className="academy-eyebrow">YOUR NEXT CHAPTER</p><h2 tabIndex={-1} id="academy-chapter-title">{chapter.title}</h2><p>{chapter.goal}</p></header>
    <Diagram key={chapter.id} diagram={chapter.diagram} />
    <section className="academy-reading" aria-label="章節內容">{chapter.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}</section>
    <div className="academy-notes"><section><p className="academy-eyebrow">PUT IT IN CONTEXT</p><h3>用一個例子理解</h3><p>{chapter.example}</p></section>
      <section><p className="academy-eyebrow">PAUSE & CHECK</p><h3>常見誤解</h3><ul>{chapter.mistakes.map((mistake, i) => <li key={i}>{mistake}</li>)}</ul></section></div>
    <p className="academy-source"><BookOpen size={16} aria-hidden="true" /><span>來源註記：{chapter.sourceNote}</span></p>
    {chapter.examples && chapter.examples.length > 0 && <section className="academy-examples" aria-label="章節案例圖解">{chapter.examples.map((example, i) => <article key={i}><p className="academy-eyebrow">CASE {String(i + 1).padStart(2, '0')}</p><h3>{example.title}</h3><Diagram diagram={example.diagram} /><p>{example.explanation}</p></article>)}</section>}
    <section aria-label="章節練習" className="academy-questions">{chapter.questions.map(question => <Quiz key={question.id} question={question} diagram={chapter.diagram} onPass={() => setPassed(ids => ids.includes(question.id) ? ids : [...ids, question.id])} />)}</section>
    <footer className="academy-completion"><div><strong>{complete ? '本章已完成，可隨時複習' : '把理解變成自己的判斷'}</strong><p>{chapter.questions.length ? `本次已答對 ${passed.length}／${chapter.questions.length} 題` : '閱讀完成後，自行標記進度。'} · 不是投資能力認證</p></div>
      <button type="button" className="academy-primary" disabled={complete || passed.length < chapter.questions.length} onClick={onComplete}><Check size={18} aria-hidden="true" />{complete ? '已完成' : '標記本章完成'}</button></footer>
  </>;
}

function Workspace({ identity, signal }: { identity: string; signal: AbortSignal }) {
  const [course, setCourse] = useState<AcademyCourse | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [scope, setScope] = useState<ProgressScope | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), pdfInput = useRef<HTMLInputElement>(null);
  const objectUrl = useRef<string | null>(null);
  const revision = useRef(0), pdfRevision = useRef(0), live = useRef(true);
  const releasePdf = () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; };
  useEffect(() => {
    live.current = true;
    const clear = () => { revision.current++; pdfRevision.current++; live.current = false; releasePdf(); };
    signal.addEventListener('abort', clear, { once: true });
    return () => { clear(); signal.removeEventListener('abort', clear); };
  }, [signal]);
  const reset = () => {
    revision.current++; pdfRevision.current++; releasePdf(); setPdf(null); setCourse(null); setCompleted([]); setScope(null); setError(''); setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
    if (pdfInput.current) pdfInput.current.value = '';
  };
  const importCourse = async (file: File | undefined) => {
    if (!file || signal.aborted || !localPreview()) return;
    reset(); const operation = revision.current; setBusy(true);
    try {
      if (file.size > MAX_COURSE_BYTES || !file.name.toLowerCase().endsWith('.json')) throw Error('INVALID_FILE');
      const next = parseCourse(JSON.parse(await file.text()));
      let nextScope: ProgressScope | null = null, progress: string[] = [], saved = true;
      try {
        nextScope = await createScope(identity, next.version, next.chapters.map(c => c.id));
        const loaded = loadProgress(localProgressStorage(), nextScope);
        progress = [...loaded.progress.completedChapterIds]; saved = loaded.status !== 'unavailable' && loaded.status !== 'recovered';
      }
      catch { saved = false; }
      if (!live.current || signal.aborted || operation !== revision.current) return;
      setCourse(next); setChapterIndex(0); setCompleted(progress); setScope(nextScope); setStorageOk(saved);
    } catch {
      if (live.current && !signal.aborted && operation === revision.current) setError('無法載入課程。請選擇 2 MB 以內、符合課程格式且 ID 不重複的 JSON；未保存檔案內容。');
    } finally { if (live.current && !signal.aborted && operation === revision.current) setBusy(false); }
  };
  const importPdf = async (file: File | undefined) => {
    if (!file || signal.aborted || !localPreview()) return;
    const operation = ++pdfRevision.current; releasePdf(); setPdf(null); setError('');
    try {
      if (file.size > 50 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.pdf') || await file.slice(0, 5).text() !== '%PDF-') throw Error('INVALID_PDF');
      if (!live.current || signal.aborted || operation !== pdfRevision.current) return;
      objectUrl.current = URL.createObjectURL(new Blob([file], { type: 'application/pdf' })); setPdf(objectUrl.current);
    } catch { if (live.current && !signal.aborted && operation === pdfRevision.current) setError('請選擇有效且小於 50 MB 的 PDF。此介面不分析或上傳 PDF。'); }
  };
  const saveProgress = (next: string[]) => {
    if (signal.aborted || !live.current) return;
    setCompleted(next);
    try { if (!scope) throw Error('STORAGE_UNAVAILABLE'); setStorageOk(persistProgress(localProgressStorage(), scope, next).status === 'saved'); }
    catch { setStorageOk(false); }
  };
  const goTo = (index: number) => {
    setChapterIndex(index);
    requestAnimationFrame(() => document.getElementById('academy-chapter-title')?.focus({ preventScroll: true }));
  };
  const chapter = course?.chapters[chapterIndex];
  return <>
    <header className="academy-hero"><div><p className="academy-eyebrow">MORNING ALPHA / PRIVATE STUDY</p><h1>{course?.title || '把市場看懂，\n從一個觀念開始。'}</h1><p>{course?.notice || '一個安靜的學習空間。匯入你的私人課程，透過圖解、練習與複習，一步一步建立理解。'}</p></div><div className="academy-hero-seal"><BookOpen size={30} aria-hidden="true" /><span>學習・觀察・驗證</span><small>OWNER LOCAL PREVIEW</small></div></header>
    <aside className="academy-privacy"><ShieldCheck size={20} aria-hidden="true" /><p><strong>私有教材候選 · 不部署至正式環境</strong><span>檔案只在此瀏覽器記憶體中讀取，不上傳、不加入公開 bundle；AI 關閉。UI 權限不等於教材加密。</span></p></aside>
    <section className="academy-import" aria-labelledby="academy-import-title"><div><h2 id="academy-import-title">{course ? '私人教材已載入' : '帶入你的私人教材'}</h2><p>課程 JSON ≤ 2 MB · 選用 PDF ≤ 50 MB · 離頁後需重新選取</p></div><div className="academy-import-actions">
      <label className="academy-file-button"><FileUp size={18} aria-hidden="true" /><span>{busy ? '檢查格式中…' : course ? '更換課程 JSON' : '選擇課程 JSON'}</span><input ref={fileInput} type="file" accept=".json,application/json" aria-label="選擇課程 JSON" onChange={e => void importCourse(e.target.files?.[0])} /></label>
      <label className="academy-file-button is-secondary"><FileUp size={18} aria-hidden="true" /><span>選擇 PDF（選用）</span><input ref={pdfInput} type="file" accept=".pdf,application/pdf" aria-label="選擇 PDF（選用）" onChange={e => void importPdf(e.target.files?.[0])} /></label>
      {(course || pdf || busy) && <button type="button" onClick={reset}>卸載教材</button>}
    </div>{pdf && <a className="academy-download" href={pdf} download="academy-private-manual.pdf" onClick={event => { if (signal.aborted) event.preventDefault(); }}><ArrowDownToLine size={17} aria-hidden="true" />下載已選取的私人 PDF</a>}</section>
    {error && <p role="alert" className="academy-error">{error}</p>}
    {course && chapter ? <div className="academy-layout">
      <aside className="academy-sidebar"><p className="academy-eyebrow">YOUR LEARNING PATH</p><h2>課程章節</h2><p className="academy-progress-label" role="status">已完成 {completed.length}／{course.chapters.length} 章</p><progress aria-label="課程完成進度" max={course.chapters.length} value={completed.length} />
        <nav aria-label="課程章節" className="academy-chapter-nav">{course.chapters.map((c, i) => <button type="button" key={c.id} aria-current={i === chapterIndex ? 'step' : undefined} onClick={() => goTo(i)}><span>{String(i + 1).padStart(2, '0')}</span><span>{c.title}</span>{completed.includes(c.id) && <Check size={17} aria-label="已完成" />}</button>)}</nav>
        <label className="academy-mobile-select">選擇章節<select aria-label="選擇章節" value={chapterIndex} onChange={e => goTo(Number(e.target.value))}>{course.chapters.map((c, i) => <option key={c.id} value={i}>{i + 1}. {c.title}{completed.includes(c.id) ? ' ✓' : ''}</option>)}</select></label>
        <p className="academy-storage" role="status">{storageOk ? '只在本機保存完成進度，依身份及課程版本分隔。' : '瀏覽器儲存不可用或格式無效；本次進度僅保留於記憶體。'} 不保存教材或作答內容；共用裝置不具加密保密性。</p>
        <button type="button" className="academy-text-button" onClick={() => saveProgress([])}>清除本課程進度</button>
      </aside>
      <article className="academy-lesson"><Lesson key={`${course.version}:${chapter.id}`} chapter={chapter} complete={completed.includes(chapter.id)} onComplete={() => saveProgress(completed.includes(chapter.id) ? completed : [...completed, chapter.id])} />
        <nav className="academy-chapter-controls" aria-label="切換章節"><button type="button" disabled={chapterIndex === 0} onClick={() => goTo(chapterIndex - 1)}>← 上一章</button><span>{chapterIndex + 1} / {course.chapters.length}</span><button type="button" disabled={chapterIndex === course.chapters.length - 1} onClick={() => goTo(chapterIndex + 1)}>下一章 →</button></nav>
      </article>
    </div> : <section className="academy-empty"><div><p className="academy-eyebrow">A SMALL STEP, A CLEARER VIEW</p><h2>你的教材，<br />你的學習節奏。</h2><p>目前尚未載入課程。右側是原創操作示意，不含講師教材，也不會計入課程進度。</p><ol><li><span>01</span>選擇本機課程 JSON</li><li><span>02</span>閱讀章節與操作圖解</li><li><span>03</span>完成練習，保留自己的節奏</li></ol></div><Diagram diagram={{ kind: 'candle', caption: '試著選擇不同 K 線，核對開、高、低、收四個位置。' }} /></section>}
    <aside className="academy-ai"><Sparkles size={23} aria-hidden="true" /><div><h2>AI 助教尚未啟用</h2><p>{DEFAULT_AI_COACH.statusMessage} 解說與答案只來自你選取的課程檔案。</p></div><span>DISABLED</span></aside>
  </>;
}

function LocalAcademyPage() {
  const access = useOwnerAccess();
  return <div className="academy"><a href="#academy-main" className="academy-skip">跳至主要內容</a><div className="academy-topbar"><a href="/account"><ArrowLeft size={16} aria-hidden="true" />返回帳戶</a><span>MORNING ALPHA <b>ACADEMY</b></span><span><LockKeyhole size={14} aria-hidden="true" />私人學習預覽</span></div>
    <main id="academy-main" className="academy-main">{access.kind === 'owner' && localPreview() ? <Workspace key={`${access.id}:${access.generation}`} identity={access.id} signal={access.signal} /> : <section className="academy-access" role="status"><LockKeyhole size={36} aria-hidden="true" /><p className="academy-eyebrow">OWNER ACCESS / PRIVATE MATERIALS</p><h1>{access.kind === 'loading' ? '確認 Owner 權限中…' : access.kind === 'denied' ? '這是一個私人學習空間' : '私人課程目前不可用'}</h1><p>{access.kind === 'loading' ? '在權限確認前，不讀取或顯示任何教材。' : access.kind === 'denied' ? '僅限具名授權 Owner。一般管理員、會員及付費會員不會自動取得權限。' : access.kind === 'owner' ? '教材匯入只開放於本機隔離開發預覽。正式環境沒有私有教材、下載端點或 AI 服務。' : '目前無法確認 Owner 存取權限，請稍後再試。未讀取任何教材。'}</p><a href="/account">返回帳戶</a></section>}</main>
    <footer className="academy-footer"><span>MORNING ALPHA · 理解先於判斷</span><span>教育與介面預覽，不構成投資建議。</span></footer>
  </div>;
}

export default function AcademyPage() {
  return localPreview() ? <LocalAcademyPage /> : <Suspense fallback={<div className="academy"><main className="academy-main"><p role="status">正在載入學習空間…</p></main></div>}><MemberAcademy /></Suspense>;
}
