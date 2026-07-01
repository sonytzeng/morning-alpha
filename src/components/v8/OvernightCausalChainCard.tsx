import type { V8OvernightCausalChain } from '@/utils/aiStrategyParser';

type Tone = 'light' | 'dark';

function safe(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export default function OvernightCausalChainCard({ chain, tone = 'dark' }: { chain?: V8OvernightCausalChain | null; tone?: Tone }) {
  const chains = Array.isArray(chain?.chains) ? chain.chains : [];
  const ready = chain?.status === 'ready' && chains.length > 0;
  const dark = tone === 'dark';
  const cardClass = dark
    ? 'bg-navy-900/70 border border-cyan-500/20 text-slate-100'
    : 'bg-white border border-cyan-200 text-foreground-900';
  const panelClass = dark ? 'bg-slate-800/70 border border-slate-700/70' : 'bg-background-50 border border-background-200';
  const mutedClass = dark ? 'text-slate-400' : 'text-foreground-500';

  return (
    <section className={`rounded-2xl p-5 md:p-6 ${cardClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={`text-[10px] uppercase tracking-[0.3em] font-semibold ${dark ? 'text-cyan-300' : 'text-cyan-700'}`}>V8 Overnight Causal Chain</p>
          <h2 className="mt-2 text-base font-bold">前夜事件傳導鏈</h2>
        </div>
        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? 'bg-cyan-500/12 text-cyan-500 border border-cyan-400/30' : 'bg-amber-500/12 text-amber-500 border border-amber-400/30'}`}>
          status: {chain?.status || 'insufficient'}
        </span>
      </div>

      {!ready ? (
        <div className={`mt-4 rounded-xl p-4 text-sm leading-relaxed ${panelClass} ${mutedClass}`}>
          前夜傳導鏈資料不足，等待完整交易日資料。
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {chains.map((item, idx) => (
            <article key={`${item.theme}-${idx}`} className={`rounded-xl p-4 ${panelClass}`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">{safe(item.theme)}</h3>
                <span className="rounded-full bg-cyan-500/12 px-2 py-0.5 text-[10px] font-semibold text-cyan-500">{safe(item.taiwan_impact)}</span>
              </div>
              <p className={`mt-2 text-sm leading-relaxed ${dark ? 'text-slate-300' : 'text-foreground-700'}`}>{safe(item.event)}</p>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className={`mb-2 text-[10px] uppercase tracking-wider ${mutedClass}`}>causal_steps</p>
                  <ol className="space-y-1.5">
                    {(item.causal_steps || []).map((step, stepIdx) => (
                      <li key={stepIdx} className={`text-xs leading-relaxed ${dark ? 'text-slate-300' : 'text-foreground-700'}`}>
                        {stepIdx + 1}. {safe(step)}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className={`mb-1 text-[10px] uppercase tracking-wider ${mutedClass}`}>affected_sectors</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(item.affected_sectors || []).map((sector, idx) => (
                        <span key={`${sector}-${idx}`} className={`rounded-full px-2 py-0.5 text-[10px] ${dark ? 'bg-slate-700 text-slate-300' : 'bg-background-100 text-foreground-600'}`}>{safe(sector)}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className={`mb-1 text-[10px] uppercase tracking-wider ${mutedClass}`}>watch_points</p>
                    <ul className="space-y-1">
                      {(item.watch_points || []).map((point, pointIdx) => (
                        <li key={pointIdx} className={`text-xs leading-relaxed ${dark ? 'text-slate-300' : 'text-foreground-700'}`}>- {safe(point)}</li>
                      ))}
                    </ul>
                  </div>
                  <p className={`text-xs leading-relaxed ${dark ? 'text-red-300/80' : 'text-red-600/80'}`}>失效條件：{safe(item.invalidation_condition)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
