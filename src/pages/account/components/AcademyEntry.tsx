import { Link } from 'react-router-dom';
import { ACADEMY_NAVIGATION, academyEntryLabel } from '@/features/academy/navigation';
import { useAcademyAccess } from '@/pages/academy/useAcademyAccess';

export default function AcademyEntry() {
  const { access } = useAcademyAccess();
  const catalog = access.kind === 'member' && !access.signal.aborted ? access.catalog : null;
  const pending = access.kind === 'loading' || access.kind === 'unavailable';
  return <section aria-labelledby="account-academy-title" className="ma-card p-5 sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 id="account-academy-title" className="text-xl font-bold text-white">{ACADEMY_NAVIGATION.label}</h2>
        <p className="mt-2 text-sm leading-6 text-white/70">從基礎開始學股票，記錄自己的學習進度。</p>
        <p className="mt-1 text-sm leading-6 text-white/70">基礎課程免費，進階課程依 Premium 權限開放。</p>
      </div>
      <Link to={ACADEMY_NAVIGATION.to} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-primary-500 px-5 py-3 text-sm font-bold text-background-50 hover:bg-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
        {pending ? '查看課程' : academyEntryLabel(catalog)}
      </Link>
    </div>
  </section>;
}
