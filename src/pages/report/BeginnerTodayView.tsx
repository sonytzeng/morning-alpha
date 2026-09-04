import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import GlossarySheet from '@/features/learning/GlossarySheet';
import { trackEvent } from '@/utils/analytics';

export type BeginnerStock = {
  symbol: string;
  name: string;
  reason?: string;
};

type BeginnerTodayViewProps = {
  reportDate: string;
  marketStatusLabel: string;
  scenario: string;
  explanation: string;
  action: string;
  nextCheckpoint: string;
  stocks: BeginnerStock[];
  confirmationItems: string[];
  invalidationItems: string[];
  avoidAction?: string;
  onShowProfessional: () => void;
};

const GLOSSARY_TERMS = ['相對大盤', '量價', '失效條件', '本益比'];

export default function BeginnerTodayView({
  reportDate,
  marketStatusLabel,
  scenario,
  explanation,
  action,
  nextCheckpoint,
  stocks,
  confirmationItems,
  invalidationItems,
  avoidAction,
  onShowProfessional,
}: BeginnerTodayViewProps) {
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const closeGlossary = useCallback(() => setSelectedTerm(null), []);

  const openTerm = (term: string) => {
    setSelectedTerm(term);
    trackEvent('beginner_report_term_opened', { term, report_date: reportDate });
  };

  return (
    <div className="ma-page ma-beginner-today flex min-h-screen flex-col overflow-x-hidden">
      <Navbar marketStatusLabel={marketStatusLabel} />
      <main>
        <section className="ma-beginner-today__hero">
          <div>
            <p><i className="ri-sparkling-2-line" aria-hidden="true" />今日判斷 · 小白模式 · {reportDate}</p>
            <h1>先看懂，再決定要不要動。</h1>
            <span>同一份正式報告，只把投資術語翻成容易理解的說法。</span>
          </div>
          <button type="button" onClick={onShowProfessional}>切換專業模式</button>
        </section>

        <section className="ma-beginner-today__action" aria-labelledby="beginner-action-title">
          <p>AI 現在建議</p>
          <h2 id="beginner-action-title">{action}</h2>
          <div><span>下一次回來</span><strong>{nextCheckpoint}</strong></div>
        </section>

        <section className="ma-beginner-today__answers" aria-label="今日報告白話解釋">
          <article>
            <span>01</span><div><p>今天市場在看什麼</p><h2>{scenario}</h2></div>
          </article>
          <article>
            <span>02</span><div><p>為什麼值得注意</p><h2>{explanation}</h2></div>
          </article>
          <article>
            <span>03</span><div><p>哪些股票可能受影響</p>{stocks.length > 0 ? <ul>{stocks.map((stock) => <li key={`${stock.symbol}-${stock.name}`}><strong>{stock.symbol} {stock.name}</strong>{stock.reason && <span>{stock.reason}</span>}</li>)}</ul> : <h2>目前沒有足夠資料列出股票</h2>}</div>
          </article>
          <article>
            <span>04</span><div><p>什麼條件成立才可繼續觀察</p>{confirmationItems.length > 0 ? <ul>{confirmationItems.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul> : <h2>先等待市場證據補齊</h2>}</div>
          </article>
          <article className="is-warning">
            <span>05</span><div><p>什麼情況代表失效</p>{invalidationItems.length > 0 ? <ul>{invalidationItems.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul> : <h2>資料尚未完整，先不判定失效條件</h2>}</div>
          </article>
          <article className="is-danger">
            <span>06</span><div><p>今天最不應做什麼</p><h2>{avoidAction || '資料不足時，不要急著替市場下結論'}</h2></div>
          </article>
        </section>

        <section className="ma-beginner-today__terms" aria-labelledby="beginner-terms-title">
          <div><p>看到不懂的字？</p><h2 id="beginner-terms-title">點一下，立即看白話解釋</h2></div>
          <div>{GLOSSARY_TERMS.map((term) => <button key={term} type="button" onClick={() => openTerm(term)}>{term}<i className="ri-question-line" aria-hidden="true" /></button>)}</div>
          <Link to="/learn">前往股票小白學堂<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
        </section>
      </main>
      <Footer />
      <GlossarySheet term={selectedTerm} source="beginner_report" onClose={closeGlossary} />
    </div>
  );
}
