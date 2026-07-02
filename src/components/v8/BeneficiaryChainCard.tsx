import type { V8BeneficiaryChain } from '@/utils/aiStrategyParser';

type Tone = 'light' | 'dark';

function text(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result.length > 0 ? result : fallback;
}


function scoreTone(score: unknown): { stars: string; label: string; raw: string } {
  const numeric = Number(score);
  const raw = Number.isFinite(numeric) ? `${Math.round(numeric)}/100` : '';
  if (!Number.isFinite(numeric)) return { stars: '☆☆☆☆☆', label: '待驗證', raw };
  if (numeric >= 80) return { stars: '★★★★★', label: '高把握', raw };
  if (numeric >= 65) return { stars: '★★★★☆', label: '中高把握', raw };
  if (numeric >= 50) return { stars: '★★★☆☆', label: '觀察', raw };
  if (numeric >= 35) return { stars: '★★☆☆☆', label: '低把握', raw };
  return { stars: '★☆☆☆☆', label: '僅供觀察', raw };
}

function signalText(value: unknown): string {
  if (!value || typeof value !== 'object') return text(value);
  const row = value as Record<string, unknown>;
  return [
    row.source,
    row.symbol || row.sector,
    row.change_percent !== undefined ? `${row.change_percent}%` : row.rotation_score,
    row.signal_label,
  ].map((item) => text(item, '')).filter(Boolean).join(' | ') || JSON.stringify(row);
}

export default function BeneficiaryChainCard({ chain, tone = 'light' }: { chain?: V8BeneficiaryChain | null; tone?: Tone }) {
  const beneficiaries = Array.isArray(chain?.beneficiaries) ? chain.beneficiaries : [];
  const sourceSignals = Array.isArray(chain?.source_signals) ? chain.source_signals : [];
  const ready = chain?.status === 'ready' && beneficiaries.length > 0;
  const dark = tone === 'dark';

  const cardClass = dark
    ? 'bg-navy-900/70 border border-emerald-500/20 text-slate-100'
    : 'bg-white border border-emerald-200 text-foreground-900';
  const mutedClass = dark ? 'text-slate-400' : 'text-foreground-500';
  const panelClass = dark ? 'bg-slate-800/70 border border-slate-700/70' : 'bg-background-50 border border-background-200';

  return (
    <section className={`rounded-2xl p-5 md:p-6 ${cardClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={`text-[10px] uppercase tracking-[0.3em] font-semibold ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}>受惠股推理鏈</p>
          <h2 className="mt-2 text-base font-bold">第一受惠股推理鏈</h2>
        </div>
        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? 'bg-emerald-500/12 text-emerald-500 border border-emerald-400/30' : 'bg-amber-500/12 text-amber-500 border border-amber-400/30'}`}>
          {ready ? '資料已完成' : '資料尚未完成'}
        </span>
      </div>

      {!ready ? (
        <div className={`mt-4 rounded-xl p-4 text-sm leading-relaxed ${panelClass} ${mutedClass}`}>
          目前受惠股鏈資料不足，等待下一次交易日報告補齊。
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {sourceSignals.length > 0 && (
            <div>
              <p className={`mb-2 text-xs font-semibold ${mutedClass}`}>來源訊號</p>
              <div className="flex flex-wrap gap-2">
                {sourceSignals.slice(0, 8).map((signal, idx) => (
                  <span key={idx} className={`rounded-full px-2.5 py-1 text-[10px] ${dark ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                    {signalText(signal)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {beneficiaries.map((item, idx) => {
              const tone = scoreTone(item.confidence_score);
              return (
              <article key={`${item.symbol}-${idx}`} className={`rounded-xl p-4 ${panelClass}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{text(item.symbol)}</span>
                  <span className="font-bold">{text(item.name)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${dark ? 'bg-slate-700 text-slate-300' : 'bg-background-100 text-foreground-500'}`}>{text(item.sector)}</span>
                  <span className="ml-auto rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
                    {tone.stars} {tone.label}{tone.raw ? ` · ${tone.raw}` : ''}
                  </span>
                </div>

                <div className="mt-3">
                  <p className={`mb-1 text-[10px] uppercase tracking-wider ${mutedClass}`}>推理鏈</p>
                  <ol className="space-y-1.5">
                    {(item.reason_chain || []).map((step, stepIdx) => (
                      <li key={stepIdx} className={`text-xs leading-relaxed ${dark ? 'text-slate-300' : 'text-foreground-700'}`}>
                        {stepIdx + 1}. {text(step)}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className={`text-[10px] uppercase tracking-wider ${mutedClass}`}>風險等級</p>
                    <p className="text-xs font-semibold">{text(item.risk_level)}</p>
                  </div>
                  <div>
                    <p className={`text-[10px] uppercase tracking-wider ${mutedClass}`}>失效條件</p>
                    <p className={`text-xs leading-relaxed ${dark ? 'text-red-300/80' : 'text-red-600/80'}`}>{text(item.invalidation_condition)}</p>
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
