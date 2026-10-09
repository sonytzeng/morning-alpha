import { useId, useRef, useState } from 'react';
import type { AcademyQuestion, AcademyChapter } from './content';
import { evaluateQuestion, evaluateSequence } from '@/features/academy/model';
import Diagram from './Diagram';

export default function Quiz({ question, diagram, onPass }: { question: AcademyQuestion; diagram: AcademyChapter['diagram']; onPass: () => void }) {
  const name = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const [order, setOrder] = useState(question.choices);
  const [result, setResult] = useState<boolean | null>(null);
  const [moveNotice, setMoveNotice] = useState('');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const ordering = question.kind === 'order';
  const submit = () => {
    const itemId = (label: string) => `item-${question.choices.indexOf(label)}`;
    const correct = ordering ? evaluateSequence((question.order || []).map(itemId), order.map(itemId)).isCorrect : evaluateQuestion(question, selected).isCorrect;
    setResult(correct); if (correct) onPass();
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order]; [next[from], next[to]] = [next[to], next[from]];
    setOrder(next); setResult(null); setMoveNotice(`項目已移到第 ${to + 1} 位`);
    requestAnimationFrame(() => buttons.current[to]?.focus());
  };
  return <section className="academy-quiz" aria-labelledby={`${name}-title`}>
    <div className="academy-eyebrow">CHECK YOUR UNDERSTANDING · {ordering ? '排序練習' : question.kind === 'diagram' ? '圖解辨識' : question.kind === 'zone' ? '區域辨識' : '單選練習'}</div>
    <h3 id={`${name}-title`}>{question.prompt}</h3>
    {(question.kind === 'diagram' || question.kind === 'zone') && <div className="academy-quiz-figure"><Diagram diagram={{ ...diagram, kind: question.kind === 'zone' ? 'zones' : diagram.kind }} /></div>}
    {ordering ? <><p className="academy-muted">使用上移／下移按鈕排列順序；也可聚焦項目後按 ↑／↓。</p><ol className="academy-order">
      {order.map((choice, i) => <li key={choice}><span className="academy-order-number">{i + 1}</span><button type="button" className="academy-order-label" ref={el => { buttons.current[i] = el; }}
        aria-label={`第 ${i + 1} 位：${choice}，使用上下方向鍵移動`} onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(i, i + (event.key === 'ArrowUp' ? -1 : 1)); } }}>{choice}</button>
        <button type="button" disabled={i === 0} aria-label={`上移第 ${i + 1} 項`} onClick={() => move(i, i - 1)}>↑</button><button type="button" disabled={i === order.length - 1} aria-label={`下移第 ${i + 1} 項`} onClick={() => move(i, i + 1)}>↓</button></li>)}
    </ol><p className="academy-sr" role="status">{moveNotice}</p></> : <fieldset><legend className="academy-sr">{question.prompt}</legend>
      {question.choices.map((choice, i) => <label key={choice} className={selected === i ? 'is-selected' : ''}>
        <input type="radio" name={name} value={i} checked={selected === i} onChange={() => { setSelected(i); setResult(null); }} /><span>{choice}</span>
      </label>)}
    </fieldset>}
    <button type="button" className="academy-primary" disabled={!ordering && selected === null} onClick={submit}>確認答案</button>
    {result !== null && <div className={`academy-answer ${result ? 'is-correct' : ''}`} role="status"><strong>{result ? '回答正確' : '再觀察一次'}</strong><p>{question.explanation}</p>{!result && <small>調整答案後可以再次確認。</small>}</div>}
  </section>;
}
