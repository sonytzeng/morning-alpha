import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import NotFound from '@/pages/NotFound';
import { PRODUCT_FEATURE_FLAGS } from '@/config/productFeatures';
import {
  filterLearningTerms,
  findLearningTerm,
  LEARNING_CATEGORIES,
  LEARNING_TERMS,
  type LearningCategory,
} from '@/features/learning/learningGlossary';
import { trackEvent, trackPageView } from '@/utils/analytics';

type CategoryFilter = LearningCategory | '全部';

function LearningDetail({ slug }: { slug: string }) {
  const entry = findLearningTerm(slug);

  useEffect(() => {
    trackPageView(`/learn/${slug}`);
    if (entry) trackEvent('learn_term_opened', {
      term: entry.slug,
      category: entry.category,
      source: 'learning_detail',
    });
  }, [entry, slug]);

  if (!entry) return <NotFound />;

  return (
    <div className="ma-page ma-learn-page flex min-h-screen flex-col">
      <Navbar />
      <main className="ma-learn-detail">
        <article>
          <Link to="/learn" className="ma-learn-back"><i className="ri-arrow-left-line" aria-hidden="true" />返回股票小白學堂</Link>
          <header>
            <span>{entry.category}</span>
            <h1>{entry.term}</h1>
            {entry.aliases.length > 0 && <p>也常寫作：{entry.aliases.join('、')}</p>}
          </header>
          <section className="ma-learn-lead"><h2>一句話看懂</h2><p>{entry.plainExplanation}</p></section>
          <div className="ma-learn-detail-grid">
            <section><h2>簡單例子</h2><p>{entry.example}</p></section>
            <section><h2>為什麼重要</h2><p>{entry.whyItMatters}</p></section>
            <section><h2>常見誤解</h2><p>{entry.misconception}</p></section>
            <section className="is-risk"><h2>風險提醒</h2><p>{entry.riskReminder}</p></section>
          </div>
          <aside>
            <i className="ri-shield-check-line" aria-hidden="true" />
            <div><strong>查閱可靠來源</strong><p>名詞解釋僅供投資教育，不構成投資建議。</p></div>
            <a href={entry.source.url} target="_blank" rel="noopener noreferrer">{entry.source.label}<i className="ri-external-link-line" aria-hidden="true" /></a>
          </aside>
        </article>
      </main>
      <Footer />
    </div>
  );
}

function LearningIndex() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('全部');
  const results = useMemo(() => filterLearningTerms(query, category), [category, query]);

  useEffect(() => {
    trackPageView('/learn');
  }, []);

  useEffect(() => {
    if (!query.trim()) return;
    const timer = window.setTimeout(() => {
      trackEvent('learn_searched', { query_length: query.trim().length, result_count: results.length });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [query, results.length]);

  return (
    <div className="ma-page ma-learn-page flex min-h-screen flex-col">
      <Navbar />
      <main>
        <section className="ma-learn-hero">
          <div>
            <p><i className="ri-graduation-cap-line" aria-hidden="true" />股票小白學堂</p>
            <h1>看懂報告，先不用背術語。</h1>
            <span>用白話理解台股常見名詞，再回到每天的市場判斷。</span>
          </div>
          <strong>{LEARNING_TERMS.length}<small>個入門名詞</small></strong>
        </section>

        <section className="ma-learn-browser" aria-labelledby="learning-browser-title">
          <header>
            <div><p>從一個詞開始</p><h2 id="learning-browser-title">今天想看懂什麼？</h2></div>
            <label>
              <i className="ri-search-line" aria-hidden="true" />
              <span className="sr-only">搜尋投資名詞</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋本益比、量價、外資…" />
            </label>
          </header>
          <div className="ma-learn-filters" role="group" aria-label="名詞分類">
            {(['全部', ...LEARNING_CATEGORIES] as CategoryFilter[]).map((item) => (
              <button key={item} type="button" className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)}>{item}</button>
            ))}
          </div>
          <p className="ma-learn-result-count">找到 {results.length} 個名詞</p>
          {results.length > 0 ? (
            <div className="ma-learn-grid">
              {results.map((entry) => (
                <Link key={entry.slug} to={`/learn/${entry.slug}`} onClick={() => trackEvent('learn_term_selected', { term: entry.slug, source: 'learning_index' })}>
                  <div><span>{entry.category}</span><i className="ri-arrow-right-up-line" aria-hidden="true" /></div>
                  <h3>{entry.term}</h3>
                  <p>{entry.plainExplanation}</p>
                  <small>看例子、常見誤解與風險提醒</small>
                </Link>
              ))}
            </div>
          ) : (
            <div className="ma-learn-empty"><i className="ri-search-eye-line" aria-hidden="true" /><h3>暫時找不到這個名詞</h3><p>換一個關鍵字，或從其他分類開始。</p></div>
          )}
        </section>

        <aside className="ma-learn-disclaimer">
          <i className="ri-information-line" aria-hidden="true" />
          <p><strong>先理解，再判斷。</strong>本學堂提供投資教育與名詞解釋，不提供個股推薦，也不構成投資建議。</p>
        </aside>
      </main>
      <Footer />
    </div>
  );
}

export default function LearnPage() {
  const { slug } = useParams();
  if (!PRODUCT_FEATURE_FLAGS.beginner_learning.enabled) return <Navigate to="/" replace />;
  return slug ? <LearningDetail slug={slug} /> : <LearningIndex />;
}
