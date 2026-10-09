import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { memberChapterPassed, parseMemberLesson, parseMemberPdf, parseMemberProgress, type AcademyMemberAnswer, type AcademyMemberCatalog, type AcademyMemberProgress } from '@/features/academy/member';
import { useAcademyAccess } from './useAcademyAccess';
import type { AcademyChapter, AcademyQuestion } from './content';
import Diagram from './Diagram';
import './academy.css';
import './member.css';

type MemberRpc = 'get_academy_lesson_v11' | 'record_academy_progress_v11' | 'get_academy_pdf_v11';
async function request(name: MemberRpc, params: Record<string, string | number | boolean | null>, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw Error('ACADEMY_CANCELLED');
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const result = await supabase.rpc(name, params).abortSignal(controller.signal);
    if (result.error || signal.aborted || controller.signal.aborted) throw Error('ACADEMY_REQUEST_FAILED');
    return result.data;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

// The local Quiz grades immediately and only exposes onPass. Member submissions
// use the same visual vocabulary, but ONLY the server response supplies a grade.
function MemberQuestion({ question, diagram, answer, busy, onSubmit }: {
  question: AcademyQuestion; diagram: AcademyChapter['diagram']; answer?: AcademyMemberAnswer;
  busy: boolean; onSubmit: (choice: number) => void;
}) {
  const name = useId();
  const [selected, setSelected] = useState<number | null>(answer?.choice_index ?? null);
  const grade = answer && answer.choice_index === selected ? answer.correct : null;
  const ordering = question.kind === 'order';
  return <section className="academy-quiz" aria-labelledby={`${name}-title`}>
    <p className="academy-eyebrow">CHECK YOUR UNDERSTANDING · 伺服器記錄</p>
    <h3 id={`${name}-title`}>{question.prompt}</h3>
    {(question.kind === 'diagram' || question.kind === 'zone') && <div className="academy-quiz-figure"><Diagram diagram={{ ...diagram, kind: question.kind === 'zone' ? 'zones' : diagram.kind }} /></div>}
    {ordering ? <p className="member-notice" role="status">此題需要排序作答，目前會員儲存介面僅支援單選。這題尚無法提交，不會代填答案或標記通過。</p> : <>
      <fieldset disabled={busy}><legend className="academy-sr">{question.prompt}</legend>
        {question.choices.map((choice, index) => <label key={index} className={selected === index ? 'is-selected' : ''}>
          <input type="radio" name={name} value={index} checked={selected === index} onChange={() => setSelected(index)} /><span>{choice}</span>
        </label>)}
      </fieldset>
      <button type="button" className="academy-primary" disabled={busy || selected === null} onClick={() => { if (selected !== null) onSubmit(selected); }}>提交答案並儲存</button>
      {grade !== null && <div className={`academy-answer ${grade ? 'is-correct' : ''}`} role="status"><strong>{grade ? '已答對 · 伺服器已記錄' : '再觀察一次 · 本次作答已記錄'}</strong><p>{question.explanation}</p>{!grade && <small>可以調整答案後重新提交。</small>}</div>}
    </>}
  </section>;
}

function initialChapter(catalog: AcademyMemberCatalog): string {
  // A lesson link selects a catalog entry only. It never grants access or a tier.
  const requested = new URLSearchParams(window.location.search).get('lesson');
  if (requested) return requested;
  const recent = [...catalog.progress].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  return recent?.chapter_id || catalog.chapters.find(chapter => chapter.allowed)?.id || catalog.chapters[0]?.id || '';
}

function MemberWorkspace({ catalog, signal }: { catalog: AcademyMemberCatalog; signal: AbortSignal }) {
  const [selectedId, setSelectedId] = useState(() => initialChapter(catalog));
  const [lesson, setLesson] = useState<AcademyChapter | null>(null);
  const [progress, setProgress] = useState(catalog.progress);
  const progressRef = useRef(catalog.progress);
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState(''), [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pdf, setPdf] = useState<{ url: string; filename: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false), [pdfError, setPdfError] = useState('');
  const pdfUrl = useRef<string | null>(null), pdfGeneration = useRef(0), pdfPending = useRef(false);
  const activeRequest = useRef<AbortController | null>(null), savePending = useRef(false);
  const lessonTitle = useRef<HTMLHeadingElement>(null);
  const releasePdf = () => { if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current); pdfUrl.current = null; };
  const updateProgress = (row: AcademyMemberProgress) => {
    const next = [...progressRef.current.filter(value => value.chapter_id !== row.chapter_id), row];
    progressRef.current = next; setProgress(next);
  };
  useEffect(() => {
    const dispose = () => { activeRequest.current?.abort(); pdfGeneration.current++; releasePdf(); progressRef.current = []; };
    const clear = () => {
      dispose(); setProgress([]); setLesson(null); setPdf(null);
      setSaveError(''); setLoadError(''); setPdfError('');
    };
    signal.addEventListener('abort', clear, { once: true });
    if (signal.aborted) clear();
    return () => { signal.removeEventListener('abort', clear); dispose(); };
  }, [signal]);

  useEffect(() => {
    const entry = catalog.chapters.find(chapter => chapter.id === selectedId);
    const controller = new AbortController(), abort = () => controller.abort();
    activeRequest.current = controller; signal.addEventListener('abort', abort, { once: true });
    setLesson(null); setLoadError(''); setSaveError(''); setSaving(false); savePending.current = false;
    const current = () => !signal.aborted && !controller.signal.aborted && activeRequest.current === controller;
    setLoading(!!entry?.allowed && !signal.aborted);
    if (entry?.allowed && !signal.aborted) void (async () => {
      const position = progressRef.current.find(row => row.chapter_id === entry.id)?.last_position ?? 0;
      const [content, recorded] = await Promise.allSettled([
        request('get_academy_lesson_v11', { p_chapter_id: entry.id }, controller.signal).then(value => parseMemberLesson(value, entry.id)),
        request('record_academy_progress_v11', { p_chapter_id: entry.id, p_question_id: null, p_choice_index: null, p_position: position, p_complete: false }, controller.signal).then(value => parseMemberProgress(value, entry.id)),
      ]);
      if (!current()) return;
      if (content.status === 'fulfilled') setLesson(content.value);
      else setLoadError('目前無法取得這一章，可能是連線、內容尚未提供或權限已變更。沒有以其他教材代替。');
      if (recorded.status === 'fulfilled') {
        const next = [...progressRef.current.filter(row => row.chapter_id !== entry.id), recorded.value];
        progressRef.current = next; setProgress(next);
      } else setSaveError('本次開啟位置尚未同步，現有進度未被當成本次儲存成功。請重試。');
      setLoading(false);
    })();
    return () => { controller.abort(); signal.removeEventListener('abort', abort); };
  }, [catalog, selectedId, signal, loadAttempt]);

  const entry = catalog.chapters.find(chapter => chapter.id === selectedId);
  const activeLesson = lesson?.id === selectedId ? lesson : null;
  const row = progress.find(value => value.chapter_id === selectedId);
  const answered = activeLesson?.questions.filter(question => row?.answers.some(answer => answer.question_id === question.id && answer.correct)).length ?? 0;
  const completed = catalog.chapters.filter(chapter => chapter.allowed && progress.some(value => value.chapter_id === chapter.id && value.completed)).length;
  const allowedCount = catalog.chapters.filter(chapter => chapter.allowed).length;
  const premium = catalog.tier === 'premium' || catalog.tier === 'owner';
  const save = async (question: AcademyQuestion | null, choice: number | null, complete = false) => {
    const controller = activeRequest.current;
    if (!activeLesson || !entry?.allowed || !controller || controller.signal.aborted || signal.aborted || savePending.current) return;
    if (question && (question.kind === 'order' || !Number.isInteger(choice) || choice === null || choice < 0 || choice >= question.choices.length)) return;
    if (complete && !memberChapterPassed(activeLesson, row)) return;
    savePending.current = true; setSaving(true); setSaveError('');
    const current = () => !signal.aborted && !controller.signal.aborted && activeRequest.current === controller;
    try {
      // Position is the last visited question (1-based); 0 means lesson reading.
      const position = question ? activeLesson.questions.findIndex(value => value.id === question.id) + 1 : row?.last_position ?? 0;
      const result = await request('record_academy_progress_v11', { p_chapter_id: activeLesson.id, p_question_id: question?.id ?? null, p_choice_index: choice, p_position: position, p_complete: complete }, controller.signal);
      if (!current()) return;
      const saved = parseMemberProgress(result, activeLesson.id);
      if (question && !saved.answers.some(answer => answer.question_id === question.id && answer.choice_index === choice)) throw Error('ACADEMY_ANSWER_NOT_CONFIRMED');
      if (complete && !saved.completed) throw Error('ACADEMY_COMPLETION_NOT_CONFIRMED');
      updateProgress(saved);
    } catch { if (current()) setSaveError('伺服器未確認這次儲存，答案／完成狀態尚未更新。請檢查連線後重試；不會顯示假的成功結果。'); }
    finally { if (current()) { savePending.current = false; setSaving(false); } }
  };
  const download = async (edition: 'free' | 'premium') => {
    if (signal.aborted || pdfPending.current || (edition === 'premium' && !premium)) return;
    const generation = ++pdfGeneration.current;
    pdfPending.current = true; setPdfBusy(true); setPdfError(''); releasePdf(); setPdf(null);
    try {
      const result = await request('get_academy_pdf_v11', { p_edition: edition }, signal);
      if (signal.aborted || generation !== pdfGeneration.current) return;
      const parsed = parseMemberPdf(result);
      pdfUrl.current = URL.createObjectURL(parsed.blob); setPdf({ url: pdfUrl.current, filename: parsed.filename });
    } catch { if (!signal.aborted && generation === pdfGeneration.current) setPdfError('目前無法取得 PDF，可能尚未提供、連線失敗或權限不足。沒有公開檔案替代連結。'); }
    finally { if (!signal.aborted && generation === pdfGeneration.current) { pdfPending.current = false; setPdfBusy(false); } }
  };
  const navigate = (id: string) => {
    if (id === selectedId || !catalog.chapters.some(chapter => chapter.id === id && chapter.allowed) || signal.aborted) return;
    activeRequest.current?.abort(); setLesson(null); setSelectedId(id);
    requestAnimationFrame(() => lessonTitle.current?.focus({ preventScroll: true }));
  };
  const currentIndex = catalog.chapters.findIndex(chapter => chapter.id === selectedId);
  const previous = catalog.chapters.slice(0, Math.max(0, currentIndex)).filter(chapter => chapter.allowed).at(-1);
  const next = catalog.chapters.slice(currentIndex + 1).find(chapter => chapter.allowed);
  return <>
    <header className="member-hero"><div><p className="academy-eyebrow">MORNING ALPHA / LEARNING ROOM</p><h1>看懂市場，<br />從理解開始。</h1><p>閱讀一個觀念，操作一張圖，再用練習確認理解。按照自己的節奏，把每一步留在帳戶中。</p></div><div className="member-summary"><BookOpen size={28} aria-hidden="true" /><span>{catalog.tier === 'owner' ? 'Owner' : premium ? 'Premium 會員' : '免費會員'}</span><strong>{completed}<small>／{allowedCount} 章</small></strong><p>已完成可學習章節</p><progress aria-label="會員課程完成進度" max={Math.max(1, allowedCount)} value={completed} /></div></header>
    <aside className="member-guidance"><ShieldCheck size={19} aria-hidden="true" /><p>教材供教育與觀察練習，不提供買賣指令。權限、作答判分與完成狀態由伺服器確認；AI 助教未啟用。</p></aside>
    <div className="member-layout"><aside className="member-sidebar"><p className="academy-eyebrow">YOUR LEARNING PATH</p><h2>學習目錄</h2>
      <nav aria-label="會員課程章節" className="member-chapters">{catalog.chapters.map((chapter, index) => <button type="button" key={chapter.id} disabled={!chapter.allowed} aria-current={chapter.id === selectedId ? 'step' : undefined} onClick={() => navigate(chapter.id)}><span className="member-chapter-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{chapter.title}</strong><small>{chapter.tier === 'premium' ? 'Premium · 進階' : 'Free · 基礎'}{!chapter.allowed ? ' · 未開放' : ''}</small></span>{!chapter.allowed ? <LockKeyhole size={16} aria-label="已鎖定" /> : progress.some(row => row.chapter_id === chapter.id && row.completed) ? <Check size={17} aria-label="已完成" /> : null}</button>)}</nav>
      <label className="member-mobile-select">選擇章節<select value={entry ? selectedId : ''} onChange={event => navigate(event.target.value)} aria-label="會員章節選擇"><option value="" disabled>請選擇章節</option>{catalog.chapters.map(chapter => <option key={chapter.id} value={chapter.id} disabled={!chapter.allowed}>{chapter.title}{chapter.tier === 'premium' ? ' · Premium' : ''}{!chapter.allowed ? ' 🔒' : ''}</option>)}</select></label>
      {!premium && <p className="member-lock-note"><LockKeyhole size={15} aria-hidden="true" />Premium 進階章節另有權限限制；本頁不會預載鎖定教材。</p>}
      <section className="member-downloads" aria-labelledby="member-pdf-title"><h3 id="member-pdf-title">離線複習手冊</h3><p>需驗證帳戶後取得；下載後的檔案由你自行保管。</p><button type="button" disabled={pdfBusy} onClick={() => void download('free')}><ArrowDownToLine size={16} aria-hidden="true" />取得基礎版 PDF</button><button type="button" disabled={pdfBusy || !premium} onClick={() => void download('premium')}>{premium ? <ArrowDownToLine size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}取得 Premium PDF</button>{pdfBusy && <p role="status">正在驗證並取得 PDF…</p>}{pdfError && <p role="alert" className="member-inline-error">{pdfError}</p>}{pdf && <a className="member-pdf-link" href={pdf.url} download={pdf.filename} onClick={event => { if (signal.aborted) event.preventDefault(); }}>PDF 已就緒，下載檔案 <ArrowDownToLine size={15} aria-hidden="true" /></a>}</section>
    </aside>
    <article className="member-lesson" aria-busy={loading || saving}>
      <header className="member-lesson-title"><p className="academy-eyebrow">{entry?.tier === 'premium' ? 'PREMIUM / ADVANCED' : 'FREE / FOUNDATIONS'}</p><h2 ref={lessonTitle} tabIndex={-1}>{entry?.title || '選擇你的下一個觀念'}</h2></header>
      {!entry ? <div className="member-empty"><BookOpen size={32} aria-hidden="true" /><h3>{catalog.chapters.length ? '找不到這個章節' : '課程尚未提供'}</h3><p>{catalog.chapters.length ? '連結沒有對應的課程。請從目錄選擇可學習章節。' : '目前伺服器未提供課程目錄，請稍後再試。'}</p></div> : !entry.allowed ? <div className="member-empty"><LockKeyhole size={32} aria-hidden="true" /><h3>這是 Premium 進階章節</h3><p>目前帳戶尚未取得本章權限，沒有讀取教材。可以先從目錄中的基礎章節開始。</p></div> : loading ? <div className="member-empty" role="status"><RefreshCw size={25} aria-hidden="true" /><h3>正在載入本章</h3><p>確認教材與帳戶進度中…</p></div> : loadError ? <div className="member-empty" role="alert"><h3>本章暫時無法載入</h3><p>{loadError}</p><button type="button" className="academy-primary" onClick={() => setLoadAttempt(value => value + 1)}>重試載入</button></div> : activeLesson ? <>
        <p className="member-goal">{activeLesson.goal}</p><Diagram key={activeLesson.id} diagram={activeLesson.diagram} />
        <section className="academy-reading" aria-label="章節內容">{activeLesson.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
        <div className="academy-notes"><section><p className="academy-eyebrow">PUT IT IN CONTEXT</p><h3>用一個例子理解</h3><p>{activeLesson.example}</p></section><section><p className="academy-eyebrow">PAUSE & CHECK</p><h3>常見誤解</h3><ul>{activeLesson.mistakes.map((mistake, index) => <li key={index}>{mistake}</li>)}</ul></section></div>
        <p className="academy-source"><BookOpen size={16} aria-hidden="true" /><span>來源註記：{activeLesson.sourceNote}</span></p>
        {!!activeLesson.examples?.length && <section className="academy-examples" aria-label="章節案例圖解">{activeLesson.examples.map((example, index) => <article key={index}><p className="academy-eyebrow">CASE {String(index + 1).padStart(2, '0')}</p><h3>{example.title}</h3><Diagram diagram={example.diagram} /><p>{example.explanation}</p></article>)}</section>}
        <div className="member-practice-heading"><div><p className="academy-eyebrow">MAKE IT YOURS</p><h3>練習與複習</h3></div><span>{answered}／{activeLesson.questions.length} 題已答對</span></div>
        {row && row.last_position > 0 && row.last_position <= activeLesson.questions.length && <a className="member-resume" href={`#member-question-${row.last_position}`}>繼續上次第 {row.last_position} 題 →</a>}
        <section className="academy-questions" aria-label="會員章節練習">{activeLesson.questions.map((question, index) => <div id={`member-question-${index + 1}`} key={`${activeLesson.id}:${question.id}`}><MemberQuestion question={question} diagram={activeLesson.diagram} answer={row?.answers.find(answer => answer.question_id === question.id)} busy={saving} onSubmit={choice => void save(question, choice)} /></div>)}</section>
        {saving && <p className="member-notice" role="status">正在等待伺服器確認，尚未更新完成狀態…</p>}
        {saveError && <div role="alert" className="member-save-error"><p>{saveError}</p><button type="button" disabled={saving} onClick={() => void save(null, null)}>重試同步進度</button></div>}
        <footer className="academy-completion"><div><strong>{row?.completed ? '本章已完成，歡迎再次複習' : '把理解變成自己的判斷'}</strong><p>{row?.completed ? '已由伺服器確認完成。' : '所有練習經伺服器判定答對後，才能標記完成。'}</p></div><button type="button" className="academy-primary" disabled={saving || !!row?.completed || !memberChapterPassed(activeLesson, row)} onClick={() => void save(null, null, true)}><Check size={17} aria-hidden="true" />{row?.completed ? '已完成' : '標記本章完成'}</button></footer>
      </> : null}
      <nav className="member-next" aria-label="切換會員章節"><button type="button" disabled={!previous} onClick={() => previous && navigate(previous.id)}><ArrowLeft size={16} aria-hidden="true" />上一章</button><button type="button" disabled={!next} onClick={() => next && navigate(next.id)}>下一章<ArrowRight size={16} aria-hidden="true" /></button></nav>
    </article></div>
  </>;
}

export default function MemberAcademy() {
  const { access, retry } = useAcademyAccess();
  return <div className="academy academy-member"><a href="#member-academy-main" className="academy-skip">跳至主要內容</a><header className="member-topbar"><a href="/account"><ArrowLeft size={16} aria-hidden="true" />返回帳戶</a><span>MORNING ALPHA <b>ACADEMY</b></span><span className="member-topbar-label">會員學習空間</span></header><main id="member-academy-main" className="member-main">
    {access.kind === 'member' && !access.signal.aborted ? <MemberWorkspace key={`${access.id}:${access.generation}`} catalog={access.catalog} signal={access.signal} /> : <section className="member-access" role="status"><BookOpen size={38} aria-hidden="true" /><p className="academy-eyebrow">LEARN AT YOUR OWN PACE</p><h1>{access.kind === 'loading' ? '正在確認會員身份' : access.kind === 'denied' ? '登入後，開始你的學習旅程' : '課程目前無法載入'}</h1><p>{access.kind === 'loading' ? '確認身份與課程權限前，不會讀取教材。' : access.kind === 'denied' ? '請登入可使用課程的帳戶。免費會員可學習基礎章節，進階章節依 Premium 權限開放。' : '無法確認身份或取得課程目錄；可能是服務尚未開放或連線異常。未使用本機資料代替。'}</p><div><a href="/account">前往帳戶</a>{access.kind !== 'loading' && <button type="button" onClick={retry}>重新確認</button>}</div></section>}
  </main><footer className="member-footer"><span>MORNING ALPHA · 理解先於判斷</span><span>教育用途 · 不構成投資建議 · AI 未啟用</span></footer></div>;
}
