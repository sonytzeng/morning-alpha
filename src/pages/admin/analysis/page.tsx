import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { readFoundation, QUALITY_WINDOWS, type ResearchFoundation } from '@/features/research/foundation';

export function ResearchFoundationView({ data }: { data: ResearchFoundation }) {
  return <section className="space-y-6" aria-labelledby="analysis-title">
    <header><p className="text-xs font-semibold text-amber-700">僅限 Owner · Shadow · Phase 1 候選</p>
      <h1 id="analysis-title" className="mt-2 text-2xl font-bold">分析研究中心</h1>
      <p className="mt-2 text-sm text-slate-600">研究與正式策略隔離。尚未啟用訊號計算、回測、Forward 評估或 Promotion。</p></header>
    <div className="grid gap-3 sm:grid-cols-3">
      {[['資料品質', '沿用正式 Contract；本頁不重新評分'], ['分析品質', 'Phase 2 待實作，不把 Schema 當分析'], ['決策品質', '樣本尚未驗收，不顯示假勝率']].map(([title, detail]) =>
        <article key={title} className="rounded-xl border bg-white p-4"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-600">{detail}</p></article>)}
    </div>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">研究基礎</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[['Feature 定義', data.features.length], ['方法版本', data.method_versions], ['Analysis Graph', data.graphs], ['Quality 觀測', data.observations]].map(([label, count]) =>
          <div key={label}><dt className="text-slate-600">{label}</dt><dd className="mt-1 text-xl font-semibold">{count}</dd></div>)}
      </dl><p className="mt-3 text-xs text-slate-500">觀測筆數不是有效交易日數；FULL／DEGRADED 分組及績效計算於 Phase 4 驗收。</p>
    </section>
    <section><h2 className="font-semibold">滾動品質規格</h2><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {QUALITY_WINDOWS.map(days => <article key={days} className="rounded-xl border bg-white p-4"><h3>{days} 個交易日</h3>
        <p className="mt-2 font-medium">尚未量測</p><p className="text-xs text-slate-500">INSUFFICIENT_SAMPLE</p></article>)}
    </div></section>
    <section><h2 className="font-semibold">Feature Registry</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">
      {data.features.map(feature => <article key={`${feature.feature_key}:${feature.version}`} className="rounded-xl border bg-white p-4">
        <h3 className="font-semibold">{feature.feature_key} <span className="text-xs text-slate-500">v{feature.version}</span></h3>
        <p className="mt-1 text-sm">{feature.business_meaning}</p><p className="mt-2 break-words text-xs text-slate-500">{feature.signal_role} · {feature.session_contract}</p>
        <p className="mt-1 text-xs text-amber-700">未校準；缺值不補造；不影響正式 Confidence</p>
      </article>)}
    </div></section>
    <p className="text-sm text-slate-600">Teacher Method、Rule、Backtest 與 Forward 工作流尚未啟用。此候選沒有批准策略或變更權重的操作。</p>
  </section>;
}

export default function OwnerAnalysisPage() {
  const [state, setState] = useState<{ kind: 'loading' | 'denied' | 'unavailable' | 'ready'; data?: ResearchFoundation }>({ kind: 'loading' });
  useEffect(() => {
    let active = true;
    let identityGeneration = 0;
    const clear = () => { identityGeneration += 1; if (active) setState({ kind: 'denied' }); };
    const { data: subscription } = supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') clear(); });
    void (async () => {
      const generation = identityGeneration;
      try {
        const { data, error } = await supabase.rpc('get_research_foundation_v1');
        if (!active || generation !== identityGeneration) return;
        if (error) { setState({ kind: error.code === '42501' ? 'denied' : 'unavailable' }); return; }
        setState({ kind: 'ready', data: readFoundation(data) });
      } catch { if (active && generation === identityGeneration) setState({ kind: 'unavailable' }); }
    })();
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, []);
  if (state.kind === 'ready' && state.data) return <ResearchFoundationView data={state.data} />;
  return <section className="rounded-xl border bg-white p-6" role="status" aria-live="polite">
    <h1 className="text-xl font-bold">分析研究中心</h1><p className="mt-3 text-sm text-slate-600">{state.kind === 'loading' ? '確認 Owner 存取權限中…'
      : state.kind === 'denied' ? '僅供具名授權 Owner 存取；一般管理員與會員沒有研究資料權限。'
        : '研究基礎候選尚未啟用或目前無法讀取；正式市場服務不受影響。'}</p>
  </section>;
}
