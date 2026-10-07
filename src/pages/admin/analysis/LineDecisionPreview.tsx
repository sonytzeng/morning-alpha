import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { callGetReportHistory, callGetReportPayload } from '@/services/entitlementService';
import { composeDecisionCard, decisionCardFlex, ownerV2Copy, type DecisionCard, type FlexBox, type FlexText } from '@/features/line/decisionCard';

type Loaded = { card: DecisionCard; shadow: ReturnType<typeof ownerV2Copy> };
const fontSize = { xs: 12, sm: 14, lg: 20 };
/** Browser view of the SAME Flex tree, not a separately authored mock card. */
function FlexView({ node }: { node: FlexBox | FlexText }) {
  if (node.type === 'text') return <p style={{ margin: 0, color: node.color, fontSize: fontSize[node.size],
    fontWeight: node.weight === 'bold' ? 700 : 400, lineHeight: 1.65, overflowWrap: 'anywhere' }}>{node.text}</p>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: node.spacing === 'md' ? 16 : 8,
    padding: node.paddingAll, background: node.backgroundColor }}>{node.contents.map((child, i) => <FlexView key={i} node={child}/>)}</div>;
}

export default function LineDecisionPreview() {
  const [open, setOpen] = useState(false), [date, setDate] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null), [status, setStatus] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    const { data: auth } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        active = false; setLoaded(null); setDates([]); setStatus('登入身份已變更，請重新開啟預覽。');
      }
    });
    setLoaded(null); setStatus('讀取已發布報告；不發送 LINE…');
    void (async () => {
      try {
        // Parent is already Owner-gated. Recheck the same server authority here;
        // never use an admin flag or Owner=true to authorize research reads.
        const permission = await supabase.rpc('get_research_foundation_v1');
        if (!active) return;
        if (permission.error) throw Error('OWNER_DENIED');
        const [report, history, shadow] = await Promise.all([
          callGetReportPayload({ reportDate: date || null }),
          callGetReportHistory(30), supabase.rpc('get_owner_recommendation_v2_forward'),
        ]);
        if (!active) return;
        const card = composeDecisionCard(report);
        let v2: ReturnType<typeof ownerV2Copy> = null;
        try { if (!shadow.error) v2 = ownerV2Copy(shadow.data, card.date); } catch { /* Invalid Shadow never alters V1. */ }
        setDates([...new Set(history.reports.map(r => r.report_date).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().reverse());
        setLoaded({ card, shadow: v2 }); setStatus('');
      } catch { if (active) { setLoaded(null); setStatus('此日期的正式來源尚無法驗證，或沒有 Owner 權限；不以舊資料、研究結果或假文案代替。'); } }
    })();
    return () => { active = false; auth.subscription.unsubscribe(); };
  }, [open, date]);
  const flex = loaded ? decisionCardFlex(loaded.card) : null;
  return <details className="rounded-xl border p-4" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">LINE 決策卡新版預覽｜只看，不發送</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-amber-700">僅限 Owner。這是待 Sony 確認的新版候選，正式會員仍使用原版 LINE；沒有發送或啟用新版的按鈕。</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">預覽報告日期
        <select aria-label="LINE 預覽日期" className="min-h-11 max-w-full rounded border p-2" value={date} onChange={e => setDate(e.target.value)}>
          <option value="">最近已發布報告</option>{dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      {status ? <p role="status" className="text-sm">{status}</p> : null}
      {loaded && flex ? <>
        <p className="text-sm">以下是 {loaded.card.date} 當時正式判斷的新版排版，不是現在的交易指示。卡片固定為手機閱讀寬度，桌機也不展成報表。</p>
        <article aria-label={`${loaded.card.date} LINE 決策卡預覽`} style={{ width: '100%', maxWidth: 340, margin: '0 auto',
          borderRadius: 16, overflow: 'hidden', background: '#FFFFFF', boxShadow: '0 8px 30px #00000026' }}>
          <FlexView node={flex.contents.header}/><FlexView node={flex.contents.body}/>
          <div style={{ padding: '0 20px 20px', background: '#FFFFFF' }}><a href={loaded.card.cta.url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', textAlign: 'center', background: '#087A68', color: '#FFFFFF', padding: '12px 10px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>{loaded.card.cta.label}</a></div>
        </article>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">來源與技術詳情（不放入會員卡片）</summary>
          <p className="mt-3 break-all text-xs">正式 V1 推薦：{loaded.card.recommendation} · Action：{loaded.card.action} · Revision：{loaded.card.revision}</p>
          <p className="mt-2 break-words text-xs">原始評估原因：{loaded.card.recommendationReasons.join(' / ') || '未提供'}。{loaded.card.notice}</p>
          <p className="mt-2 text-xs">同一純函式產生 Flex Payload 與此預覽；尚未進行真實 LINE App 發送驗收。</p>
          <ul className="mt-3 space-y-2 text-xs">{loaded.card.sections.flatMap(s => s.lines).map((l, i) => <li key={i} className="break-words">{l.text}<br/>{l.path}{l.evidence.length ? ` · ${l.evidence.join(' / ')}` : ''}</li>)}</ul>
        </details>
        <section aria-label="Owner V2 研究預覽" className="rounded-lg border border-amber-500/50 p-4">
          <h3 className="font-semibold text-amber-700">Owner研究預覽｜尚未對會員發布</h3>
          <p className="mt-2 text-sm">這一區獨立於上方會員卡片，不是正式推薦，也不會進入 LINE Payload。</p>
          {loaded.shadow ? <>
            <p className="mt-3 text-sm">研究達標 {loaded.shadow.counts.READY} · 待確認 {loaded.shadow.counts.WATCH} · 評估後不採用 {loaded.shadow.counts.NONE} · 資料缺口 {loaded.shadow.counts.BLOCKED}</p>
            <p className="mt-2 text-sm">Forward Sample（研究日期）：{loaded.shadow.forwardSample ?? '尚無可驗證數量'}。不是勝率或成功率。</p>
            {loaded.shadow.candidates.map(c => <p key={c.symbol} className="mt-2 text-sm">{c.symbol}：{c.state}</p>)}
            {loaded.shadow.nearMiss.length ? <div className="mt-3"><h4 className="font-semibold">最接近條件（不是推薦）</h4>
              {loaded.shadow.nearMiss.map(c => <div key={c.symbol} className="mt-3 text-sm"><p className="font-semibold">{c.symbol}</p><p>已通過：{c.passed.join('、') || '沒有已確認條件'}</p><p>還差：{c.missing.join('、')}</p></div>)}</div> : null}
          </> : <p className="mt-3 text-sm">此日期沒有可驗證的已保存 V2 研究；不沿用其他日期，也不補跑。</p>}
        </section>
      </> : null}
      <p className="text-sm">Sony 閱讀驗收：待本人確認。新版會員 LINE 模板尚未啟用。</p>
    </div>
  </details>;
}
