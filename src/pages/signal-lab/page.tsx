import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, Database, FlaskConical, RefreshCw, ShieldCheck } from 'lucide-react';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { fetchSignalLab, type SignalLabPayload } from '@/services/signalLabService';

const SIGNAL_LABELS: Record<string, string> = {
  STRONG_POSITIVE: '強正向', POSITIVE: '正向', NEUTRAL: '中性', NEGATIVE: '負向', STRONG_NEGATIVE: '強負向',
};

const REGIME_LABELS: Record<string, string> = {
  BULLISH: '多頭', BEARISH: '空頭', SIDEWAYS: '盤整', HIGH_VOLATILITY: '高波動',
};

const VALIDITY_LABELS: Record<string, string> = { pending: '等待驗證', valid: '有效', insufficient: '資料不足', blocked: '已阻擋' };
const EDGE_LABELS: Record<string, string> = { pending: '等待驗證', proven: '已證實', not_proven: '未優於基準', unproven: '尚未證實' };

function percentage(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '尚無足夠資料';
}

function metric(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '尚無足夠資料';
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: typeof Activity; title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><Icon size={18} /></span>
      <div><h2 className="text-xl font-bold text-white md:text-2xl">{title}</h2><p className="mt-1 text-sm leading-6 text-white/45">{subtitle}</p></div>
    </div>
  );
}

export default function SignalLabPage() {
  const [payload, setPayload] = useState<SignalLabPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setPayload(await fetchSignalLab()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'SIGNAL_LAB_UNAVAILABLE'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const latestDate = payload?.signals[0]?.signal_date || null;
  const todaySignals = useMemo(() => payload?.signals.filter((signal) => signal.signal_date === latestDate) || [], [payload, latestDate]);
  const latestQuality = payload?.quality[0] || null;

  return (
    <div className="flex min-h-screen flex-col bg-[#020812] text-white">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:px-8 md:py-12">
        <header className="rounded-2xl border border-[#20364a] bg-[#071321] p-6 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">Morning Alpha 內部研究</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">Signal Lab</h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-white/55 md:text-base">台股法人資金、技術面、量價與市場環境的隔離研究環境。所有結果均為影子前瞻驗證，不會改變正式推薦。</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-white/80 hover:bg-white/5 disabled:opacity-50">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />重新整理
            </button>
          </div>
        </header>

        {loading && <div className="mt-8 rounded-2xl border border-[#20364a] bg-[#0b1a2a] p-8 text-sm text-white/50">正在讀取內部研究資料…</div>}
        {!loading && error && (
          <section className="mt-8 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-6">
            <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 text-amber-300" size={20} /><div>
              <h2 className="font-bold text-white">{error.includes('AUTH') ? '需要登入管理員帳號' : error.includes('ADMIN') ? '僅限管理員' : 'Signal Lab 尚未啟用'}</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">資料與權限採失敗關閉；未完成資料表、後端部署或資料品質門檻前，不顯示推測訊號。</p>
              {error.includes('AUTH') && <Link to="/login?next=/signal-lab" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-emerald-500 px-4 text-sm font-bold text-[#020812]">前往登入</Link>}
            </div></div>
          </section>
        )}

        {!loading && !error && payload && (
          <div className="mt-10 space-y-12">
            <section>
              <SectionTitle icon={Activity} title="今日影子訊號" subtitle="只顯示通過時間點與資料完整性檢查的研究訊號。" />
              {todaySignals.length === 0 ? (
                <div className="rounded-2xl border border-[#20364a] bg-[#0b1a2a] p-6"><p className="font-semibold">尚無足夠資料</p><p className="mt-2 text-sm leading-6 text-white/45">目前沒有通過資料品質門檻的完整台股日線與法人資料，因此不產生假分數。</p></div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {todaySignals.map((signal) => (
                    <article key={signal.prediction_id} className="rounded-2xl border border-[#20364a] bg-[#0b1a2a] p-5">
                      <div className="flex items-start justify-between gap-4"><div><p className="text-lg font-bold">{signal.symbol}</p><p className="mt-1 text-xs text-white/35">{signal.strategy_version}</p></div><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">{SIGNAL_LABELS[signal.signal_label] || signal.signal_label}</span></div>
                      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[['訊號強度', signal.signal_score], ['法人資金', signal.institutional_score], ['技術面', signal.technical_score], ['量價', signal.volume_score]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#102236] p-3"><p className="text-xs text-white/35">{label}</p><p className="mt-1 text-lg font-bold">{metric(value)}</p></div>)}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/55"><span>{REGIME_LABELS[signal.market_regime] || signal.market_regime}</span><span>信心程度 {percentage(signal.confidence)}</span><span>資料完整度 {percentage(signal.data_completeness)}</span></div>
                      {signal.reasons.length > 0 && <ul className="mt-4 space-y-2 text-sm leading-6 text-white/65">{signal.reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul>}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionTitle icon={FlaskConical} title="歷史驗證" subtitle="歷史回測只有在資料可用時間、公司行動與歷史股票母體可證明時才會標示有效。" />
              {payload.experiments.length === 0 ? <div className="rounded-2xl border border-[#20364a] bg-[#0b1a2a] p-6 text-sm text-white/50">歷史資料不足，尚未建立可宣稱有效的回測。</div> : (
                <div className="space-y-3">{payload.experiments.map((experiment) => <article key={experiment.id} className="rounded-2xl border border-[#20364a] bg-[#0b1a2a] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-bold">{experiment.experiment_name}</h3><p className="mt-1 text-xs text-white/35">{experiment.strategy_version}</p></div><div className="flex gap-2"><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/60">有效性：{VALIDITY_LABELS[experiment.validity_status] || '資料不足'}</span><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/60">統計優勢：{EDGE_LABELS[experiment.edge_status] || '尚未證實'}</span></div></div></article>)}</div>
              )}
            </section>

            <section>
              <SectionTitle icon={Database} title="資料品質" subtitle="覆蓋率不足時，只能說明資料完整標的，不宣稱全市場排名。" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[['可分析母體', latestQuality?.eligible_universe], ['完整標的', latestQuality?.complete_count], ['資料覆蓋率', latestQuality ? percentage(latestQuality.coverage_ratio) : null], ['阻擋原因', latestQuality?.blocked_reason_codes?.length]].map(([label, value]) => <div key={String(label)} className="min-h-28 rounded-2xl border border-[#20364a] bg-[#0b1a2a] p-5"><p className="text-xs text-white/35">{label}</p><p className="mt-3 text-xl font-bold">{value ?? '尚無足夠資料'}</p></div>)}
              </div>
            </section>

            <aside className="flex items-start gap-3 rounded-2xl border border-blue-400/20 bg-blue-400/5 p-5 text-sm leading-6 text-white/55"><ShieldCheck className="mt-0.5 shrink-0 text-blue-300" size={19} /><p>{payload.disclaimer || '僅供內部研究與前瞻驗證，不構成投資建議。'} 正式推薦影響：零。</p></aside>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
