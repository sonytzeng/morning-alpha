import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { findLearningTerm, type LearningTerm } from './learningGlossary';
import { trackEvent } from '@/utils/analytics';

type GlossarySheetProps = {
  term: string | null;
  source?: string;
  onClose: () => void;
};

export default function GlossarySheet({ term, source = 'unknown', onClose }: GlossarySheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const entry: LearningTerm | undefined = term ? findLearningTerm(term) : undefined;

  useEffect(() => {
    if (!entry) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackRegion = previousFocusRef.current?.closest<HTMLElement>('main, [role="main"], nav');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus({ preventScroll: true });
    trackEvent('learn_term_opened', { term: entry.slug, source });

    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleDialogKeys);
      const usable = (element: HTMLElement | null | undefined): element is HTMLElement => Boolean(
        element?.isConnected && element !== document.body
        && !element.closest('[hidden], [inert], [aria-hidden="true"]')
        && !element.hasAttribute('disabled') && element.getClientRects().length
        && getComputedStyle(element).visibility === 'visible',
      );
      const candidates = [previousFocusRef.current, fallbackRegion, document.querySelector<HTMLElement>('main')];
      const target = candidates.find(usable);
      if (target) {
        const previousTabIndex = target.getAttribute('tabindex');
        if (target.tabIndex < 0) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        if (previousTabIndex === null) target.removeAttribute('tabindex');
        else target.setAttribute('tabindex', previousTabIndex);
      }
      previousFocusRef.current = null;
    };
  }, [entry, onClose, source]);

  if (!entry) return null;

  return (
    <div className="ma-glossary-sheet" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        // Keep the backdrop's default focus action from undoing focus restoration.
        event.preventDefault();
        onClose();
      }
    }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header>
          <div>
            <span>{entry.category}</span>
            <h2 id={titleId}>{entry.term}</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="關閉名詞解釋">
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </header>
        <p id={descriptionId} className="ma-glossary-sheet__summary"><strong>白話先懂</strong><br />{entry.plainExplanation}</p>
        <dl>
          <div><dt>生活化例子</dt><dd>{entry.example}</dd></div>
          <div><dt>Morning Alpha 為什麼看</dt><dd>{entry.whyItMatters}</dd></div>
          <div><dt>今天怎麼用</dt><dd>{entry.todayUsage}</dd></div>
          <div><dt>常見誤解</dt><dd>{entry.misconception}</dd></div>
          <div><dt>風險提醒</dt><dd>{entry.riskReminder}</dd></div>
        </dl>
        <footer>
          <Link to={`/learn/${entry.slug}`} onClick={onClose}>查看完整解釋</Link>
          <a href={entry.source.url} target="_blank" rel="noopener noreferrer">{entry.source.label}<i className="ri-external-link-line" aria-hidden="true" /></a>
        </footer>
      </section>
    </div>
  );
}
