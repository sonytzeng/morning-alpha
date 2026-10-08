import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { EntryEvaluation, EntryResult, Strategy } from '../../../../research/entry-opportunity';

const names: Record<Strategy, string> = { OVERSOLD_REVERSAL: '超跌反轉', PULLBACK_ENTRY: '趨勢回檔', BREAKOUT_CONTINUATION: '突破延續' };
const states = { ENTRY_READY: '可以研究進場', WAIT_CONFIRMATION: '等待確認', AVOID_ENTRY: '不建議進場', INSUFFICIENT_EVIDENCE: '資料不足，暫不判斷' };
const stateColors = { ENTRY_READY:'text-forest-200', WAIT_CONFIRMATION:'text-amber-300', AVOID_ENTRY:'text-rose-300', INSUFFICIENT_EVIDENCE:'text-surface-300' };
type OwnerEntryData = { owner_only: true; shadow_only: true; production_eligible: false; latest: EntryEvaluation | null;
  today_date: string; forward_sample: number; outcome_sample: number; historical_replay_count: number };
function read(v: unknown): OwnerEntryData {
  const r = v as OwnerEntryData;
  if (!r || r.owner_only !== true || r.shadow_only !== true || r.production_eligible !== false ||
    ![r.forward_sample,r.outcome_sample,r.historical_replay_count].every(n=>Number.isInteger(n)&&n>=0) ||
    (r.latest && (r.latest.version !== 'ENTRY_OPPORTUNITY_1.0.0' || !Array.isArray(r.latest.candidates) ||
      r.latest.candidates.some(c=>!(c.status in states)||!(c.strategy in names))))) throw Error('ENTRY_READ_INVALID');
  return r;
}
const box='rounded-xl border border-surface-700 bg-navy-900 p-4 text-surface-100';
const price=(n:number)=>n.toLocaleString('zh-TW',{maximumFractionDigits:2});
export function EntryOpportunityView({ data }: { data: OwnerEntryData }) {
  const [strategy,setStrategy]=useState<Strategy>('OVERSOLD_REVERSAL'),[symbol,setSymbol]=useState('');
  const latest=data.latest;
  const candidates=(latest?.candidates||[]).filter(c=>c.strategy===strategy);
  const c=candidates.find(x=>x.symbol===symbol)||candidates[0];
  return <section aria-labelledby="entry-title" className="space-y-4 min-w-0">
    <header className={box}><p className="text-sm font-semibold text-amber-800">Owner 研究候選 · 不影響正式推薦 · 不會自動下單</p>
      <h2 id="entry-title" className="mt-2 text-2xl font-semibold">今天有沒有值得研究的買點？</h2>
      <p className="mt-2">上漲不代表值得追價，下跌也不直接排除反轉。三種策略分開判斷，不能混成一個勝率。</p>
      {!latest?<p className="mt-3" role="status">尚無已保存的進場研究，不能說今天沒有機會。此頁不會補跑、建立預測或交易。</p>:
        <p className="mt-3 text-amber-800">{latest.business_date} · {latest.mode==='HISTORICAL_REPLAY'?'歷史重播，不是事前預測':'事前鎖定研究'} · {latest.business_date!==data.today_date?'較早研究，不代表今天的新判斷':'今日資料截點'} · 掃描 {latest.scanned}/{latest.universe} 檔，非全市場</p>}
    </header>
    <div className="flex flex-wrap gap-2" aria-label="進場研究策略">{Object.entries(names).map(([k,v])=><button key={k} type="button" aria-pressed={strategy===k}
      className={`min-h-11 rounded-lg border px-4 py-2 font-semibold ${strategy===k?'bg-teal-800 text-white':'bg-navy-900 text-surface-100'}`}
      onClick={()=>setStrategy(k as Strategy)}>{v}</button>)}</div>
    {c?<article className={box}>
      <label className="block font-medium">查看股票<select className="mt-2 block w-full min-h-11 rounded border border-surface-400 bg-navy-800 p-2 text-surface-100" aria-label="進場研究股票" value={c.symbol} onChange={e=>setSymbol(e.target.value)}>
        {candidates.map(x=><option key={x.symbol} value={x.symbol}>{x.name?`${x.name} `:''}{x.symbol} · {states[x.status]}</option>)}</select></label>
      <h3 className="mt-4 text-xl font-semibold">{c.name||'名稱未保存'} {c.symbol}｜{names[c.strategy]}</h3>
      <p className={`mt-2 text-lg font-semibold ${stateColors[c.status]}`}>{states[c.status]}</p>
      <p className="mt-2 text-sm">正式市場方向：{c.market_direction||'資料不足'} · 市場型態：{({range:'震盪／盤整',trending:'趨勢行情'} as Record<string,string>)[c.market_regime||'']||c.market_regime||'資料不足'}</p>
      <h4 className="mt-4 font-semibold">為什麼？</h4><ul className="mt-2 list-disc space-y-2 pl-5">{c.reasons.slice(0,3).map(reason=><li key={reason}>{reason}</li>)}</ul>
      <h4 className="mt-4 font-semibold">進場條件</h4><p className="mt-2">{c.entry_trigger||'必要證據不足，不能合理提供進場價格。'}</p>
      <h4 className="mt-4 font-semibold">什麼情況看錯？</h4><p className="mt-2">{c.invalidation||'尚無可驗證的失效價位，不編造停損。'}</p>
      <h4 className="mt-4 font-semibold">風險報酬</h4>{c.plan?<><p className="mt-2">參考區間 {price(c.plan.reference_range[0])}～{price(c.plan.reference_range[1])}；失效 {price(c.plan.stop)}；目標情境 {price(c.plan.target)}。</p>
        <p className="mt-2">含示意費用與滑價後，每股風險 {price(c.plan.risk_distance)}、情境報酬 {price(c.plan.reward_space)}，風險報酬比 1：{price(c.plan.reward_risk)}。</p>
        <p className="mt-2 text-sm text-amber-800">目標是由歷史壓力或區間推導的情境，不是價格預測。未計最低手續費、股息與逐筆成交限制，不能當成實際成交保證。</p></>:<p className="mt-2">資料不足或無合理價格區間，不顯示虛構價格。</p>}
      <p className="mt-4 text-sm">證據信心尚未完成 Forward 校準，不代表上漲機率。可以研究進場也不等於保證獲利。</p>
      <a href="#my-owner-trades" className="mt-4 inline-block min-h-11 rounded-lg bg-teal-800 px-4 py-3 font-semibold text-white">前往 Paper Trade 記錄區（自行確認，不自動建立）</a>
      <details className="mt-4"><summary className="cursor-pointer py-2">研究細節、版本與資料來源</summary><Details c={c}/><p className="break-all text-xs">截點 {latest?.evaluation_time} · 證據 {latest?.evidence_hash}</p></details>
    </article>:null}
    <section className={box}><h3 className="font-semibold">後來有沒有驗證？</h3><p className="mt-2">歷史研究 {data.historical_replay_count} · Forward 日期 {data.forward_sample} · Outcome {data.outcome_sample}</p>
      <p className="mt-2">目前樣本不足，尚不能判定投資策略有效。三種方法按 1／3／5／10／20 交易日分開驗證，未到期不補造績效。</p>
      <p className="mt-2 text-sm">Analysis Value：INSUFFICIENT_SAMPLE。研究、模擬交易與 Sony 實際交易績效各自獨立。</p></section>
  </section>;
}
function Details({c}:{c:EntryResult}){return <div className="space-y-2 break-words text-sm"><p>{c.strategy_version} · 同時點 V2：{c.v2_status||'未保存'}</p><p>進場環境：{c.entry_environment} · 機會品質：{c.opportunity_quality}</p><p>證據完整度 {(c.evidence_confidence.completeness*100).toFixed(0)}%（不是勝率）</p><ul>{c.reasons.map(r=><li key={r}>{r}</li>)}</ul><details><summary>來源識別</summary><ul className="break-all text-xs">{c.evidence_refs.map(r=><li key={r}>{r}</li>)}</ul></details></div>;}
export default function EntryOpportunity(){
  const [state,setState]=useState<{kind:'loading'|'ready'|'denied'|'unavailable';data?:OwnerEntryData}>({kind:'loading'});
  useEffect(()=>{let active=true,generation=0;const {data:sub}=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN'){generation++;if(active)setState({kind:'denied'});}});const g=generation;
    void supabase.rpc('get_owner_entry_opportunity_v1').then(({data,error})=>{if(!active||g!==generation)return;if(error){setState({kind:error.code==='42501'?'denied':'unavailable'});return;}try{setState({kind:'ready',data:read(data)});}catch{setState({kind:'unavailable'});}},()=>{if(active&&g===generation)setState({kind:'unavailable'});});
    return()=>{active=false;sub.subscription.unsubscribe();};},[]);
  if(state.kind==='ready'&&state.data)return <EntryOpportunityView data={state.data}/>;
  return <section className={box} role="status"><h2 className="text-xl font-semibold">進場機會研究</h2><p className="mt-2">{state.kind==='loading'?'確認 Owner 權限中…':state.kind==='denied'?'只有具名 Owner 可讀取，未提供研究資料。':'研究候選尚未發布或暫時無法讀取；正式市場服務不受影響。'}</p></section>;
}
