import type { V8DailySentence } from '@/utils/aiStrategyParser';

type Tone = 'light' | 'dark';

export default function DailySentenceCard({ dailySentence, tone = 'dark' }: { dailySentence?: V8DailySentence | null; tone?: Tone }) {
  const sentence = String(dailySentence?.sentence || '').trim();
  const sources = Array.isArray(dailySentence?.logic_source) ? dailySentence.logic_source : [];
  const ready = dailySentence?.status === 'ready' && sentence.length > 0;
  const dark = tone === 'dark';

  const cardClass = dark
    ? 'bg-navy-900/70 border border-violet-500/20 text-slate-100'
    : 'bg-white border border-violet-200 text-foreground-900';
  const panelClass = dark ? 'bg-slate-800/70 border border-slate-700/70' : 'bg-background-50 border border-background-200';
  const mutedClass = dark ? 'text-slate-400' : 'text-foreground-500';

  return (
    <section className={`rounded-2xl p-5 md:p-6 ${cardClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={`text-[10px] uppercase tracking-[0.3em] font-semibold ${dark ? 'text-violet-300' : 'text-violet-700'}`}>V8 Daily Sentence</p>
          <h2 className="mt-2 text-base font-bold">V8 盤前一句</h2>
        </div>
        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? 'bg-violet-500/12 text-violet-500 border border-violet-400/30' : 'bg-amber-500/12 text-amber-500 border border-amber-400/30'}`}>
          status: {dailySentence?.status || 'insufficient'}
        </span>
      </div>

      {!ready ? (
        <div className={`mt-4 rounded-xl p-4 text-sm leading-relaxed ${panelClass} ${mutedClass}`}>
          今日 V8 盤前一句尚未產生。
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className={`rounded-xl p-4 text-base font-semibold leading-relaxed ${panelClass}`}>
            {sentence}
          </p>
          <div>
            <p className={`mb-2 text-[10px] uppercase tracking-wider ${mutedClass}`}>logic_source</p>
            {sources.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <span key={source} className={`rounded-full px-2.5 py-1 text-[10px] ${dark ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-violet-50 text-violet-700 border border-violet-100'}`}>
                    {source}
                  </span>
                ))}
              </div>
            ) : (
              <p className={`text-xs ${mutedClass}`}>尚無 V8 資料</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
