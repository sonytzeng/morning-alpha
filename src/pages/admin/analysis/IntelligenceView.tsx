import { analysisLabel as label, type OwnerAnalysis, type AnalysisSignal } from '@/features/research/intelligence';

export default function IntelligenceView({ data }: { data: OwnerAnalysis }) {
  const a = data.latest?.analysis;
  if (!a) return <section className="rounded-xl border bg-white p-5" role="status"><h2 className="font-semibold">今日分析</h2>
    <p className="mt-2 text-sm text-slate-600">尚無已鎖定的 Shadow 分析；不使用範例取代真實市場資料。</p>
    <p className="mt-2 text-sm">Forward Sample：{data.forward_sample} · Analysis Value：INSUFFICIENT_SAMPLE</p></section>;
  const d = a.decision;
  const signalList = (ids: string[]) => ids.map(id => a.signals.find(s => s.signal_id === id)).filter((s): s is AnalysisSignal => Boolean(s));
  return <section className="space-y-5" aria-labelledby="daily-analysis-title">
    <header><p className="text-xs font-semibold text-amber-700">Owner-only · SHADOW_ONLY · 不影響正式決策</p>
      <h2 id="daily-analysis-title" className="mt-1 text-2xl font-bold">今日分析</h2>
      <p className="mt-2 text-sm">資料日期 {a.business_date} · {a.observation_kind === 'HISTORICAL_REPLAY' ? '歷史重播，不計入 Forward Sample' : '事前鎖定觀測'}</p>
      <p className="text-xs text-slate-500">分析截止：{a.analysis_cutoff_at} · Report：{a.report_level}</p>
      <p className="mt-2 text-sm">Forward Sample：{data.forward_sample} · Analysis Value：INSUFFICIENT_SAMPLE</p>
    </header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['市場型態',d.shadow_regime],['市場方向',d.shadow_direction],['風險',d.shadow_risk],['研究操作',d.shadow_action]].map(([key,value]) =>
      <article key={key} className="rounded-xl border bg-white p-4"><h3 className="text-sm text-slate-500">{key}</h3><p className="mt-2 font-semibold">{label(value)}</p></article>)}</div>
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">證據信心 {d.shadow_confidence.toFixed(1)} / 100</h3>
      <p className="mt-2 text-sm text-amber-800">尚未完成結果校準。這不是上漲機率，也不是勝率。</p>
      <p className="mt-2 text-sm">分歧 {a.signal_conflict_score} / 100；缺失證據 {a.missing_signals.length} 項，已反映在信心扣分。</p>
      <details className="mt-3 text-sm"><summary className="cursor-pointer">信心如何計算</summary><dl className="mt-2 grid grid-cols-2 gap-2">
        {Object.entries(d.confidence_components).map(([key,value]) => <div key={key}><dt>{({evidence_score:'證據完整度',agreement_score:'訊號一致度',strength_score:'訊號強度',data_quality_score:'資料品質',conflict_penalty:'分歧扣分',missing_penalty:'缺失扣分'} as Record<string,string>)[key] || key}</dt><dd>{value}</dd></div>)}</dl></details>
    </section>
    <section><h3 className="font-semibold">市場分歧</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">
      {[['支持主要判斷',a.supporting_signals],['反對主要判斷',a.contradicting_signals]].map(([title,ids]) =>
        <article key={String(title)} className="rounded-xl border bg-white p-4"><h4 className="font-medium">{String(title)}</h4>
          <ul className="mt-2 space-y-2 text-sm">{signalList(ids as string[]).map(s => <li key={s.signal_id}>{s.label}：{label(s.direction)} · 強度 {s.strength}</li>)}</ul>
          {(ids as string[]).length === 0 ? <p className="mt-2 text-sm text-slate-500">本次可用訊號中沒有對應證據；缺失項目不當作支持。</p> : null}
        </article>)}</div></section>
    <section><h3 className="font-semibold">主要訊號與 Evidence Inspector</h3><div className="mt-3 grid gap-3 md:grid-cols-2">
      {a.signals.map(s => <details key={s.signal_id} className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-medium">{s.label}：{s.status === 'AVAILABLE' ? label(s.direction) : '方向資料不足'}</summary>
        <p className="mt-2 text-sm text-slate-600">依已完成 Session 的觀測漲跌與已登錄代理商品方向規則計算；不是 AI 推測。</p>
        {a.features.filter(f => s.feature_ids.includes(f.feature_id)).map(f => <dl key={f.feature_id} className="mt-3 break-words text-xs text-slate-600">
          <dt>來源商品</dt><dd>{f.source_instrument}</dd><dt>觀測時間</dt><dd>{f.observed_at}</dd><dt>觀測值</dt><dd>{f.value === null ? '不可用，沒有補零' : f.value}</dd>
          <dt>Feature／版本</dt><dd>{f.feature_id} / {f.feature_version}</dd><dt>Evidence lineage</dt><dd>{f.source_evidence_id}</dd><dt>計算規則</dt><dd>{f.normalization}</dd></dl>)}</details>)}</div></section>
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">跨訊號確認</h3><ul className="mt-3 space-y-2 text-sm">{a.cross_signals.map(s => <li key={s.signal_id}>{s.label}：{s.status === 'AVAILABLE' ? label(s.direction) : '組成訊號不足，不推論'}</li>)}</ul></section>
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">今天與上一有效交易日有何變化</h3>
      {a.quality.change_detection === 'UNAVAILABLE'
        ? <p className="mt-3 text-sm">缺少可比較的前一有效交易日證據，本日分析仍依當日完整市場證據成立。</p>
        : <ul className="mt-3 space-y-2 text-sm">{a.what_changed.map(c => <li key={c.key}>{c.meaning} <span className="text-xs text-slate-500">{c.previous_business_date || '無可比較日期'}</span></li>)}</ul>}</section>
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">什麼情況會推翻今天判斷</h3><ul className="mt-3 space-y-3 text-sm">{a.invalidation_conditions.map(c => {
      const observed = data.invalidations?.find(i => i.invalidation_id === c.invalidation_id);
      return <li key={c.invalidation_id}>{c.description}<p className="mt-1 text-slate-500">{label(observed?.status || c.status)} {observed?.observed_at || ''}</p></li>;
    })}</ul></section>
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">分析品質</h3>
      <p className="mt-2 text-sm">Evidence 覆蓋 {a.quality.evidence_coverage.toFixed(1)}% · 訊號覆蓋 {a.quality.signal_coverage.toFixed(1)}% · 可追溯 {a.quality.traceability.toFixed(1)}%</p>
      <p className="mt-2 text-sm text-slate-600">缺失：{a.missing_signals.length ? a.missing_signals.map(key => ({'2330:RETURN_UNAVAILABLE':'台積電尚無方向性報價','TAIEX:RETURN_UNAVAILABLE':'加權指數尚無方向性報價',NEWS_CONTEXT:'合格新聞脈絡',RESEARCH_CONTEXT:'研究脈絡','market_news:no_verified_relevant_items':'合格新聞脈絡'} as Record<string,string>)[key] || '研究補充證據不足').join('、') : '本次無缺失'}。不支援的 gap／momentum／實現波動不補造。</p>
    </section>
    <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">正式決策對照</h3>
      {a.production_comparison ? <p className="mt-2 text-sm">正式：{label(a.production_comparison.market_regime)} · {label(a.production_comparison.direction)} · {label(a.production_comparison.action)}。Shadow 獨立計算，不回寫正式結果。</p>
        : <p className="mt-2 text-sm">分析截止時沒有可用的正式 Decision，不補造對照。</p>}</section>
  </section>;
}
