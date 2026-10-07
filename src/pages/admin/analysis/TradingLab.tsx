import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { analysisLabel } from '@/features/research/intelligence';
import { currentMarket, labObject, labText, readTradingLab, type TradingLabData, type LabRow } from '@/features/research/tradingLab';

const box='rounded-xl border bg-white p-4';
const metric=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'樣本／證據不足';
const kindLabel=(v:unknown)=>v==='SYSTEM_SIMULATION'?'系統模擬':'Sony 實際交易（自行記錄）';
const taipeiTime=(v:unknown)=>Number.isFinite(Date.parse(String(v)))?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(String(v)))+'（台北）':'時間不可用';
function EvidenceList({items,empty}:{items:string[];empty:string}) {
 return items.length?<ul className="mt-2 space-y-2 text-sm">{items.slice(0,5).map((x,i)=><li key={i}>{x}</li>)}</ul>:<p className="mt-2 text-sm text-slate-500">{empty}</p>;
}
export function TradingLabView({data,onCreate,onExit,onRefresh,busy}:{data:TradingLabData;onCreate:(symbol?:string)=>void;onExit:(trade:LabRow)=>void;onRefresh:()=>void;busy:boolean}) {
 const m=currentMarket(data),d=data.discovery;
 return <div className="space-y-5" aria-label="Sony 交易研究室">
  <header><p className="text-xs text-amber-700">Owner 專用 · 不影響正式決策 · 不是自動下單</p><h1 className="mt-2 text-2xl font-bold">今天怎麼看，接下來怎麼做</h1></header>
  <section className={box}><p className="text-sm">{m.date} · 今日正式市場判斷</p>
   <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['市場型態',analysisLabel(m.regime)],['市場方向',m.direction],['操作',`${m.action}／${analysisLabel(m.action)}`],['研究風險',m.risk?analysisLabel(m.risk):'待當日研究證據']].map(([k,v])=><div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-1 text-lg font-semibold">{v}</dd></div>)}</dl>
   <p className="mt-4 font-medium">今天最重要的結論是：{m.conclusion}</p>
   <p className="mt-2 text-sm">證據信心：{m.confidence===null?'尚未產生當日研究':`${m.confidence.toFixed(4)} / 100`}。證據信心，不代表上漲機率。</p>
  </section>
  <section className={box}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">今天值得看哪些股票</h2><a href="#my-owner-trades" className="underline">我的交易</a></div>
   <p className="mt-2 text-sm">研究名單 {d.watchlist.length} 檔 · 實際檢查 {d.scanned} 檔已登錄股票（不是全台股）</p>
   {d.phase_evaluation?<div className="mt-3 rounded border p-3 text-sm"><h3 className="font-semibold">{d.phase_evaluation.evaluation_phase==='PREMARKET'?'盤前評估：等待可觀測的開盤證據':'盤中評估：使用當時已存在的量價'}</h3>
    <p className="mt-2">完整評估 {d.phase_evaluation.evaluated_count}／{d.phase_evaluation.universe_count} · 觀察 {d.phase_evaluation.watch_count} · 達標 {d.phase_evaluation.ready_count} · 評估後不採用 {d.phase_evaluation.none_count} · 真正資料缺口 {d.phase_evaluation.blocked_count}</p>
    <p className="mt-2">事件後量價尚不可觀測：{d.phase_evaluation.not_yet_observable_count} 檔。尚未開盤不是資料故障；觀察不等於正式推薦。</p>
    {(d.premarket_watch||[]).map(c=><p className="mt-2" key={c.symbol}>{c.symbol} {c.name}：盤前可知條件齊全，等待開盤量價確認，不提供模擬進場。</p>)}</div>:null}
   {!d.watchlist.length&&!d.premarket_watch?.length?<p className="mt-2 text-sm text-amber-700">目前沒有證據完整的觀察股。{d.first_blocked_gate?`最先卡在「${d.first_blocked_gate}」。`:'尚未完成有效篩選。'}不硬湊股票，也不代表市場沒有機會。</p>:null}
   {d.watchlist.map(c=><article className="mt-3 rounded border p-3" key={c.symbol}><h3 className="font-semibold">{c.symbol} {c.name} · 研究觀察，不是正式推薦</h3><p className="mt-2 text-sm">{c.why}</p><p className="mt-2 text-sm">還差的確認：{c.entry_condition}</p>
    <EvidenceList items={c.invalidation} empty="缺少失效條件，不能建立模擬。"/><details><summary>評分與來源</summary><p>證據分數 {c.score.value}／100，不是勝率</p><dl>{Object.entries(c.score.inputs).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p>{c.score.calculation}</p></details>
    <button type="button" className="mt-3 rounded border px-4 py-2" disabled={busy} onClick={()=>onCreate(c.symbol)}>建立模擬交易</button></article>)}
   <p className="mt-3 text-sm">正式推薦：{({PREMARKET_WATCH:'盤前觀察，等待開盤確認（非正式推薦）',READY:'已達正式契約',NONE:'沒有合格推薦',BLOCKED:'證據不足，未發布',UNAVAILABLE:'尚無可讀狀態'} as Record<string,string>)[d.formal_status]||'尚無可讀狀態'}。{d.formal_reason}</p>
   <details className="mt-3"><summary>在哪一層被淘汰？</summary><ol className="mt-2 space-y-2 text-sm">{d.funnel.map(s=><li key={s.key}>{s.label}：{s.before} → {s.passed}，淘汰 {s.excluded}<details><summary>查看缺失</summary>{s.reasons.map(r=><p key={r}>{r}</p>)}</details></li>)}</ol>
    {d.phase_funnel?<div className="mt-3"><h3>階段完整漏斗</h3><dl className="grid grid-cols-2 gap-2">{Object.entries(d.phase_evaluation?.evaluation_phase==='PREMARKET'?d.phase_funnel.premarket:d.phase_funnel.intraday).map(([key,value])=><div key={key}><dt>{({universe:'已登錄股票',scanned:'已掃描',liquidity:'量價資料完整',market_fit:'市場配合',sector_fit:'產業配合',evidence:'證據完整',watch:'盤前觀察',ready:'達標',none:'評估後不採用',blocked:'資料／系統缺口',not_yet_observable:'尚不可觀測',watch_input:'原盤前觀察名單',price_confirmed:'價格確認',volume_confirmed:'成交量確認',relative_strength:'相對強弱',risk:'風險通過',entry:'進場通過',drop:'盤中移除'} as Record<string,string>)[key]||key}</dt><dd>{value===null?'缺少原盤前名單，不推定':value}</dd></div>)}</dl></div>:null}
    <p className="mt-3 text-sm">未取得資料不當成零分；後續層的 0 表示沒有股票到達該層，不表示該層已完成驗證。</p></details>
  </section>
  <section className="grid gap-3 sm:grid-cols-2"><article className={box}><h2 className="font-semibold">支持判斷</h2><EvidenceList items={m.supporting} empty="當日尚無可投影的支持訊號；不沿用歷史分析。"/></article>
   <article className={box}><h2 className="font-semibold">反對／風險訊號</h2><EvidenceList items={m.contradicting} empty="當日反對訊號尚未可用，不代表沒有風險。"/></article></section>
  <section className={box}><h2 className="font-semibold">今天怎麼做</h2><p className="mt-2">{m.waitReason}</p>
   <h3 className="mt-3 font-medium">可以更積極的條件</h3><p className="mt-2 text-sm">僅當研究觀察股的原始確認條件成立，才重新檢視；本頁不將研究名單提升為正式推薦。</p>
   <EvidenceList items={d.watchlist.map(c=>`${c.symbol}：${c.entry_condition}`)} empty="目前沒有完成證據驗證的進場條件；維持觀望。"/>
   <h3 className="mt-3 font-medium">什麼情況代表看錯</h3><EvidenceList items={m.invalidation} empty="尚無當日 Shadow 失效條件；不由畫面自行編造。"/>
   <h3 className="mt-3 font-medium">今天跟昨天差在哪</h3><EvidenceList items={m.changes} empty="沒有可比較的當日研究資料。歷史日期請到進階研究查看。"/></section>
  <section id="my-owner-trades" className={box}><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">我的交易</h2><button type="button" className="rounded border px-4 py-2" disabled={busy} onClick={()=>onCreate()}>我有買，記一筆</button></div>
   <p className="mt-2 text-sm">原始進場、停損與系統快照不可修改。實盤為自填紀錄，並非券商成交驗證；不混入系統模擬績效。</p>
   <button type="button" className="mt-3 rounded border px-4 py-2" disabled={busy} onClick={onRefresh}>核對 Close／1D／3D／5D 結果</button>
   {!data.trades.length?<p className="mt-3 text-sm">尚無交易。沒有觀察股時不能硬造模擬訊號；你仍可如實記錄自己已完成的買入。</p>:null}
   {data.trades.map(t=><article className="mt-3 rounded border p-3" key={String(t.id)}><h3>{String(t.symbol)} · {kindLabel(t.kind)}</h3><p className="mt-2 text-sm">買入 {String(t.entry_price)} 元 × {String(t.quantity)} 股 · {taipeiTime(t.entered_at)}</p>
    <p className="mt-2 text-sm">{t.recording_kind==='RETROSPECTIVE_JOURNAL'?'這是事後補記；系統快照是記錄時的狀態，不是買入當時的預測。':'原始條件與快照已鎖定。'}</p>
    {data.events.filter(e=>e.trade_id===t.id).map(e=><p className="mt-2 text-sm" key={String(e.id)}>{String(e.event_key)}：{metric(labObject(e.payload).return_percent)}%（未扣費用）</p>)}
    {t.kind==='SONY_LIVE_TRADE'&&!data.events.some(e=>e.trade_id===t.id&&e.event_key==='EXIT')?<button type="button" className="mt-2 rounded border px-4 py-2" disabled={busy} onClick={()=>onExit(t)}>記錄整筆賣出</button>:null}
    <details><summary>原始條件與快照</summary><p>{String(t.entry_condition)}</p><p>停損 {t.stop_price==null?'未提供':String(t.stop_price)} · 觀察期間 {String(t.horizon)}</p><p>快照時間 {labText(labObject(t.system_snapshot).as_of)}</p></details></article>)}
  </section>
  <section className={box}><h2 className="font-semibold">最近驗證結果</h2><p className="mt-2 text-sm">本候選未啟用前瞻 Trigger。已保存前瞻樣本：{data.performance.market.forward_shadow_sample}。模擬與實盤分開計算；樣本不足不宣稱有效。</p>
   <div className="mt-3 grid gap-3 md:grid-cols-3"><article><h3>市場判斷品質</h3><p className="text-sm">既有 CLE 收盤樣本 {data.performance.market.sample}</p><p className="text-sm">方向命中 {metric(data.performance.market.direction_accuracy)}{data.performance.market.direction_accuracy===null?'':'%'}</p><p className="text-xs">不是交易報酬；不是 Shadow Forward 驗證。</p></article>
    {(['system','sony'] as const).map(k=><article key={k}><h3>{k==='system'?'系統模擬結果':'Sony 自填交易結果'}</h3><p>{data.performance[k].sample} 筆 · {data.performance[k].sample_label}</p><dl className="mt-2 text-sm">{[['勝率','win_rate'],['平均獲利','average_win'],['平均虧損','average_loss'],['期望值','expectancy'],['獲利因子','profit_factor'],['等權報酬最大回撤','max_drawdown'],['最大有利變動','mfe'],['最大不利變動','mae']].map(([l,key])=><div className="flex flex-wrap justify-between gap-2" key={key}><dt>{l}</dt><dd>{metric(labObject(data.performance[k])[key])}</dd></div>)}</dl></article>)}</div>
   <p className="mt-3 text-xs">未計手續費、稅與滑價。等權報酬序列不是帳戶淨值；沒有期內高低點，不填 MFE／MAE。樣本至少五筆才顯示比率，不代表策略已有效。</p>
  </section>
  <details className={box}><summary>資料缺口、研究界線與驗收</summary><dl>{Object.entries(d.availability).map(([k,v])=><div key={k}>{({price:'價格',volume:'成交量',industry:'產業',institutional:'法人',chips:'籌碼',fundamentals:'基本面',revenue:'營收',news:'新聞',catalyst:'公司催化'} as Record<string,string>)[k]}：{({AVAILABLE:'已有',PARTIAL:'部分可用',MISSING:'缺失'} as Record<string,string>)[v]}</div>)}</dl><p>分析價值：樣本不足（INSUFFICIENT_SAMPLE）。Sony 操作驗收：待本人測試。會員公開：未批准。Forward Trigger：未啟用。</p></details>
 </div>;
}

export default function TradingLab() {
 const [data,setData]=useState<TradingLabData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState<{symbol?:string;exit?:LabRow}|null>(null);
 const alive=useRef(true),generation=useRef(0),requestId=useRef(''),formNode=useRef<HTMLFormElement|null>(null);
 const invoke=async(payload:LabRow)=>{const r=await supabase.functions.invoke('owner-trading-lab-v1',{body:payload});if(r.error||r.data?.error)throw Error('LAB_UNAVAILABLE');return r.data;};
 const refresh=async()=>{const g=generation.current;const next=readTradingLab(await invoke({operation:'READ'}));if(alive.current&&g===generation.current)setData(next);};
 useEffect(()=>{alive.current=true;const g=++generation.current;const {data:auth}=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN'){generation.current++;setData(null);setForm(null);setError('身分已變更，請重新進入分析中心。');}});
  void invoke({operation:'READ'}).then(async r=>{if(!alive.current||g!==generation.current)return;const initial=readTradingLab(r);setData(initial);
   // Bounded Owner-side outcome catch-up, not a background Cron or Core dependency.
   if(initial.trades.length){try{await invoke({operation:'REFRESH_OUTCOMES'});if(alive.current&&g===generation.current){const next=readTradingLab(await invoke({operation:'READ'}));if(alive.current&&g===generation.current)setData(next);}}catch{if(alive.current&&g===generation.current)setError('後續結果尚未完成核對；保留已保存資料，沒有補造結果。');}}
  }).catch(()=>{if(alive.current&&g===generation.current)setError('交易研究室候選尚未啟用或目前無法讀取；既有研究仍可在下方查看。');});
  return()=>{alive.current=false;auth.subscription.unsubscribe();};},[]);
 useEffect(()=>{if(form){formNode.current?.scrollIntoView({block:'start'});formNode.current?.focus();}},[form]);
 const act=async(payload:LabRow)=>{const g=generation.current;setBusy(true);setError('');try{await invoke(payload);if(!alive.current||g!==generation.current)return;setForm(null);await refresh();}catch{if(alive.current&&g===generation.current)setError('未能完成：請確認資料、時間、停損與權限；沒有以假資料補齊。請勿更換請求重複送出。');}finally{if(alive.current&&g===generation.current)setBusy(false);}};
 const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const f=new FormData(event.currentTarget),at=String(f.get('at'));
  if(form?.exit){void act({operation:'RECORD_EXIT',trade_id:form.exit.id,event:{price:Number(f.get('price')),occurred_at:new Date(at+'+08:00').toISOString()}});return;}
  void act({operation:'RECORD_TRADE',request_id:requestId.current,trade:{kind:form?.symbol?'SYSTEM_SIMULATION':'SONY_LIVE_TRADE',symbol:form?.symbol||String(f.get('symbol')),
   entered_at:form?.symbol?null:new Date(at+'+08:00').toISOString(),entry_price:form?.symbol?null:Number(f.get('price')),quantity:Number(f.get('quantity')),
   stop_price:f.get('stop')?Number(f.get('stop')):null,horizon:String(f.get('horizon')),notes:String(f.get('notes')||'')}});};
 return <section>{error?<p role="alert" className="mb-4 rounded border p-4 text-amber-700">{error}</p>:null}
  {!data&&!error?<p role="status">讀取今天市場與 Owner 交易資料…</p>:null}
  {data?<TradingLabView data={data} busy={busy} onCreate={symbol=>{requestId.current=crypto.randomUUID();setForm({symbol});}} onExit={exit=>setForm({exit})} onRefresh={()=>void act({operation:'REFRESH_OUTCOMES'})}/>:null}
  {form?<form ref={formNode} tabIndex={-1} key={String(form.exit?.id||form.symbol||'live')} onSubmit={submit} aria-label="Owner 交易記錄" className={`${box} mt-5 space-y-3`}><h2 className="font-semibold">{form.exit?'記錄整筆賣出':form.symbol?`${form.symbol} 建立模擬交易`:'記錄我已完成的買入'}</h2>
   <p className="text-sm">確認後不可改寫；這不是下單。時間以台北為準。</p>
   {!form.symbol?<><label className="block">{form.exit?'賣出':'買入'}時間<input required type="datetime-local" name="at" className="mt-1 block w-full rounded border p-2"/></label><label className="block">{form.exit?'賣出':'買入'}價格<input required type="number" min="0.0001" step="any" name="price" className="mt-1 block w-full rounded border p-2"/></label></>:<p>模擬價格使用伺服器鎖定的已驗證報價，不允許回填過去進場價。</p>}
   {!form.exit?<><label className="block">股票代號<input name="symbol" required pattern="[0-9]{4,6}" value={form.symbol} readOnly={Boolean(form.symbol)} className="mt-1 block w-full rounded border p-2"/></label><label className="block">股數<input required type="number" min="1" step="1" name="quantity" className="mt-1 block w-full rounded border p-2"/></label><label className="block">原始停損價{form.symbol?'（必填）':'（可選）'}<input type="number" min="0.0001" step="any" name="stop" required={Boolean(form.symbol)} className="mt-1 block w-full rounded border p-2"/></label><label className="block">觀察期間<select name="horizon" className="mt-1 block w-full rounded border p-2"><option>CLOSE</option><option>1D</option><option>3D</option><option>5D</option></select></label><label className="block">備註<textarea maxLength={2000} name="notes" className="mt-1 block w-full rounded border p-2"/></label></>:null}
   <div className="flex flex-wrap gap-3"><button disabled={busy} className="rounded border px-4 py-2" type="submit">確認並鎖定記錄</button><button disabled={busy} type="button" className="rounded border px-4 py-2" onClick={()=>setForm(null)}>取消</button></div></form>:null}
 </section>;
}
