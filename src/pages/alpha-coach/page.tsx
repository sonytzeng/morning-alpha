import { FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { canUseProductFeature, PRODUCT_FEATURE_FLAGS } from '@/config/productFeatures';
import { getCurrentEntitlement } from '@/services/entitlementService';
import {
  ALPHA_COACH_SAFE_REFUSAL,
  askAlphaCoach,
  type AlphaCoachAnswer,
  type AlphaCoachSource,
} from '@/services/alphaCoachService';
import type { UserEntitlement } from '@/types/subscription';
import { trackEvent, trackPageView } from '@/utils/analytics';

const SUGGESTED_QUESTIONS = [
  '為什麼今天推薦這些股票？',
  '這個名詞是什麼意思？',
  '今天最大的風險是什麼？',
  '什麼情況下這個判斷會失效？',
  '上班族今天只需要注意什麼？',
];

function isStructuredAnswer(value: AlphaCoachAnswer | string | null): value is AlphaCoachAnswer {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export default function AlphaCoachPage() {
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);
  const [entitlementLoading, setEntitlementLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AlphaCoachAnswer | string | null>(null);
  const [sources, setSources] = useState<AlphaCoachSource[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    trackPageView('/alpha-coach');
    void getCurrentEntitlement()
      .then(setEntitlement)
      .catch(() => setEntitlement(null))
      .finally(() => setEntitlementLoading(false));
  }, []);

  const submitQuestion = async (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = question.trim();
    if (!normalized || submitting) return;
    setSubmitting(true);
    setAnswer(null);
    setSources([]);
    trackEvent('coach_question_submitted', { question_length: normalized.length });
    const response = await askAlphaCoach(normalized);
    setAnswer(response.answer || ALPHA_COACH_SAFE_REFUSAL);
    setSources(response.sources || []);
    if (!response.success || response.refused) trackEvent('coach_answer_refused', { reason: 'grounding_unavailable' });
    setSubmitting(false);
  };

  if (!PRODUCT_FEATURE_FLAGS.alpha_coach.enabled) return <Navigate to="/" replace />;
  if (entitlementLoading) return <div className="ma-page ma-alpha-coach-page flex min-h-screen flex-col"><Navbar /><main className="ma-alpha-coach-loading">確認 Owner Preview 權限中…</main><Footer /></div>;
  if (!canUseProductFeature('alpha_coach', entitlement)) return <Navigate to="/" replace />;

  return (
    <div className="ma-page ma-alpha-coach-page flex min-h-screen flex-col">
      <Navbar />
      <main>
        <section className="ma-alpha-coach-hero">
          <div><p><i className="ri-shield-star-line" aria-hidden="true" />Owner Preview</p><h1>Alpha 教練測試版</h1><span>目前以規則式方法整理已通過安全閘門的正式報告，不使用生成式模型；資料不足就明確拒答。</span></div>
          <strong>規則式整理<small>零外部模型資料傳輸、不保存對話、不讀取個人持股</small></strong>
        </section>

        <section className="ma-alpha-coach-workspace">
          <div className="ma-alpha-coach-suggestions">
            <p>常用問題</p>
            {SUGGESTED_QUESTIONS.map((item) => <button key={item} type="button" onClick={() => setQuestion(item)}>{item}</button>)}
          </div>
          <form onSubmit={submitQuestion}>
            <label htmlFor="alpha-coach-question">想看懂今天報告的哪一段？</label>
            <textarea id="alpha-coach-question" value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 280))} maxLength={280} rows={4} placeholder="例如：什麼情況下這個判斷會失效？" />
            <div><small>{question.length}/280</small><button type="submit" disabled={!question.trim() || submitting}>{submitting ? '核對正式證據中…' : '請測試版教練整理'}</button></div>
          </form>
        </section>

        {answer && (
          <section className="ma-alpha-coach-answer" aria-live="polite">
            {isStructuredAnswer(answer) ? (
              <>
                <article><span>01</span><div><h2>白話解釋</h2><p>{answer.plain_explanation}</p></div></article>
                <article><span>02</span><div><h2>和今天報告的關係</h2><p>{answer.relation_to_today}</p></div></article>
                <article><span>03</span><div><h2>支持證據</h2><ul>{answer.supporting_evidence.map((item) => <li key={item}>{item}</li>)}</ul></div></article>
                <article><span>04</span><div><h2>成立條件</h2><ul>{answer.confirmation_conditions.map((item) => <li key={item}>{item}</li>)}</ul></div></article>
                <article><span>05</span><div><h2>失效條件</h2><ul>{answer.invalidation_conditions.map((item) => <li key={item}>{item}</li>)}</ul></div></article>
                <article><span>06</span><div><h2>資料來源與時間</h2><p>{answer.data_source_and_time}</p></div></article>
              </>
            ) : <p className="ma-alpha-coach-refusal">{answer}</p>}
            {sources.length > 0 && <footer><strong>引用來源</strong>{sources.map((source) => source.url ? <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">[{source.id}] {source.label}</a> : <span key={source.id}>[{source.id}] {source.label}</span>)}</footer>}
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
