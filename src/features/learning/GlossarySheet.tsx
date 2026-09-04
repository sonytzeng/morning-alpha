import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { findLearningTerm, type LearningTerm } from './learningGlossary';
import { trackEvent } from '@/utils/analytics';

type GlossarySheetProps = {
  term: string | null;
  source?: string;
  onClose: () => void;
};

export default function GlossarySheet({ term, source = 'unknown', onClose }: GlossarySheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const entry: LearningTerm | undefined = term ? findLearningTerm(term) : undefined;

  useEffect(() => {
    if (!entry) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    trackEvent('learn_term_opened', { term: entry.slug, source });

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [entry, onClose, source]);

  if (!entry) return null;

  return (
    <div className="ma-glossary-sheet" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="ma-glossary-title">
        <header>
          <div>
            <span>{entry.category}</span>
            <h2 id="ma-glossary-title">{entry.term}</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="關閉名詞解釋">
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </header>
        <p className="ma-glossary-sheet__summary">{entry.plainExplanation}</p>
        <dl>
          <div><dt>簡單例子</dt><dd>{entry.example}</dd></div>
          <div><dt>為什麼重要</dt><dd>{entry.whyItMatters}</dd></div>
          <div><dt>常見誤解</dt><dd>{entry.misconception}</dd></div>
          <div><dt>風險提醒</dt><dd>{entry.riskReminder}</dd></div>
        </dl>
        <footer>
          <Link to={`/learn/${entry.slug}`} onClick={onClose}>查看完整解釋</Link>
          <a href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.label}<i className="ri-external-link-line" aria-hidden="true" /></a>
        </footer>
      </section>
    </div>
  );
}
