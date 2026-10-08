import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {supabase} from '@/lib/supabase';
import type {TradingLabData} from '@/features/research/tradingLab';
import {readJournal,money,totalKnown,type Journal,type JournalRow} from '@/features/research/cockpit';
const time=(s:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(s));
type Form={action:'BUY'|'SELL'|'VOID';key:string;at:string;row?:JournalRow;symbol?:string};
const invoke=async(body:unknown)=>{const r=await supabase.functions.invoke('owner-trading-lab-v1',{body});if(r.error||r.data?.error)throw Error(r.data?.error||'UNAVAILABLE');return r.data;};
export default function CockpitJournal({legacy}:{legacy:TradingLabData|null}){
 const [journal,setJournal]=useState<Journal|null>(null),[book,setBook]=useState<'LIVE'|'PAPER'>('LIVE'),[form,setForm]=useState<Form|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[denied,setDenied]=useState(false),[notice,setNotice]=useState('');
 const generation=useRef(0),alive=useRef(true);
 const refresh=useCallback(async()=>{const g=generation.current,j=readJournal(await invoke({operation:'COCKPIT_READ'}));if(alive.current&&g===generation.current)setJournal(j);},[]);
 useEffect(()=>{alive.current=true;const g=++generation.current;const {data:auth}=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN'){generation.current++;setJournal(null);setForm(null);setDenied(true);}});
  void refresh().catch(()=>{if(alive.current&&g===generation.current)setError('交易帳本目前無法讀取；不把缺失當成零損益。');});
  return()=>{alive.current=false;auth.subscription.unsubscribe();};},[refresh]);
 const begin=(f:Omit<Form,'key'|'at'>)=>{setError('');setNotice('');setForm({...f,key:crypto.randomUUID(),at:new Date().toISOString()});};
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!form||busy)return;const f=new FormData(e.currentTarget),g=generation.current;
  const optional=(k:string)=>String(f.get(k)||'').trim()?String(f.get(k)):null;
  const fill={book,symbol:form.row?.symbol||String(f.get('symbol')),action:form.action,
   quantity:form.action==='VOID'?null:String(f.get('quantity')),price:form.action==='VOID'?null:String(f.get('price')),
   fee:optional('fee'),tax:optional('tax'),other_cost:optional('other_cost'),
   occurred_at:form.action==='VOID'?form.at:new Date(String(f.get('at'))+'+08:00').toISOString(),
   reason:String(f.get('reason')||''),...(form.row?{replaces:form.row.id}:{})};
  setBusy(true);setError('');try{await invoke({operation:'COCKPIT_RECORD',request_id:form.key,fill});if(!alive.current||g!==generation.current)return;
   setForm(null);setNotice('紀錄已保存。這是個人帳本，不是股票下單。');await refresh();
  }catch(e){if(alive.current&&g===generation.current)setError(({OVERSELL:'賣出超過可用持股，或更正會造成歷史負庫存；未保存。',IDEMPOTENCY_CONFLICT:'同一請求內容不同。請先重新讀取核對，不要重複建立。',CORRECTION_INVALID:'原紀錄已更正或取消，請重新核對。',FUTURE_OR_MISSING_TIME:'請填寫已發生的台北交易時間。'} as Record<string,string>)[e instanceof Error?e.message:'']||'未確認保存成功。請先重新讀取核對；再次送出會沿用同一防重識別。');
  }finally{if(alive.current&&g===generation.current)setBusy(false);}};
 if(denied)return <p role="status">登入身分已變更，交易資料已清除。請重新登入。</p>;
 const positions=journal?.positions.filter(p=>p.book===book)||[],audit=journal?.audit.filter(r=>r.book===book)||[];
 return <div className="cockpit-stack"><header><h2>我的交易與成效</h2><p>只記錄你自己的決定，不會下單，也不當成系統選股成功案例。</p></header>
  <div className="cockpit-tabs" aria-label="分開的交易帳本">{(['LIVE','PAPER'] as const).map(b=><button key={b} disabled={busy} aria-pressed={book===b} onClick={()=>{setBook(b);setForm(null);}}>{b==='LIVE'?'我的實際交易':'我的模擬交易'}</button>)}</div>
  <p className="cockpit-warning">{book==='LIVE'?'實際交易是本人填寫的紀錄，未經券商成交驗證。':'模擬交易使用你記錄的假設成交，不是實際成交或系統事前研究績效。'}新版帳本與舊紀錄分開，舊紀錄仍完整保留。</p>
  {error&&<p role="alert" className="cockpit-warning">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!journal?<p role="status">正在取得帳本，尚不能計算損益。</p>:<>
   <div className="cockpit-two"><article className="cockpit-card"><span>目前持股損益</span><h3>{money(totalKnown(positions,'unrealized'))}</h3><p>依下方報價日期估值，未扣未來賣出費用；無可信報價或成本時不估算。</p></article><article className="cockpit-card"><span>已實現損益</span><h3>{money(totalKnown(positions,'realized'))}</h3><p>已扣已知交易費用。任何相關費用未知時，總損益保留為無法可靠計算。</p></article></div>
   <div className="cockpit-actions"><button className="cockpit-primary" disabled={busy} onClick={()=>begin({action:'BUY'})}>{book==='LIVE'?'我買了，記一筆':'記一筆模擬買入'}</button><button disabled={busy} onClick={()=>begin({action:'SELL'})}>{book==='LIVE'?'我賣了，記一筆':'記一筆模擬賣出'}</button><button disabled={busy} onClick={()=>void refresh().catch(()=>setError('暫時無法重新讀取，請稍後再試。'))}>重新讀取</button></div>
   {form&&<form key={form.key} onSubmit={e=>void submit(e)} className="cockpit-card cockpit-form" aria-label="交易記錄表單"><h3>{form.action==='VOID'?'取消誤記，保留原始紀錄':form.row?'更正紀錄，保留前後版本':form.action==='BUY'?'記錄買入':'記錄賣出'}</h3>
    <p>此操作只寫入{book==='LIVE'?'實際':'模擬'}帳本。費用空白表示未知；只有確定免收才填 0。</p>
    {form.action!=='VOID'&&<><label>股票代號<input name="symbol" required pattern="[0-9]{4,6}" defaultValue={form.row?.symbol||form.symbol||''} readOnly={!!form.row}/></label><label>交易日期與時間（台北）<input name="at" type="datetime-local" required defaultValue={form.row?new Date(Date.parse(form.row.occurred_at)+8*3600000).toISOString().slice(0,16):undefined}/></label><label>成交價格<input name="price" type="number" min="0.00000001" step="0.00000001" required defaultValue={form.row?.price??undefined}/></label><label>股數<input name="quantity" type="number" min="1" step="1" required defaultValue={form.row?.quantity??undefined}/></label>
     {[['fee','手續費'],['tax','交易稅'],['other_cost','其他實際費用']].map(([k,n])=><label key={k}>{n}（元；未知可留空）<input name={k} type="number" min="0" step="0.00000001" defaultValue={form.row?.[k as 'fee'|'tax'|'other_cost']??undefined}/></label>)}</>}
    <label>{form.row?'更正／取消原因（必填）':'備註（選填）'}<textarea name="reason" maxLength={2000} required={!!form.row}/></label>
    <div className="cockpit-actions"><button className="cockpit-primary" type="submit" disabled={busy}>確認保存，不是下單</button><button type="button" disabled={busy} onClick={()=>setForm(null)}>返回，不保存</button></div>
   </form>}
   <section className="cockpit-stack"><h3>目前持股</h3>{positions.filter(p=>p.quantity>0).length?positions.filter(p=>p.quantity>0).map(p=><article className="cockpit-card" key={p.symbol}><h4>{p.symbol} · {p.quantity} 股</h4><p>平均成本 {money(p.average_cost)}；剩餘成本 {money(p.cost)}</p><p>未實現損益 {money(p.unrealized)}</p><p>{p.mark?`參考報價 ${money(p.mark.price)} · ${time(p.mark.at)}（非保證成交價）`:'尚無可信的目前估值報價。'}</p><button disabled={busy} onClick={()=>begin({action:'SELL',symbol:p.symbol})}>記錄賣出</button></article>):<p>新版帳本尚無持股；舊紀錄請見下方，不推定你沒有其他持股。</p>}</section>
   <details className="cockpit-card"><summary>交易歷史與更正稽核（{audit.length} 筆）</summary>{audit.length?audit.map(r=><article key={r.id} className="cockpit-history"><h4>{r.symbol} · {r.action==='BUY'?'買入':r.action==='SELL'?'賣出':'取消紀錄'} {r.superseded?'（已由後續紀錄更正／取消）':''}</h4><p>{time(r.occurred_at)} · {r.quantity??'—'} 股 × {r.price??'—'} 元</p><p>手續費 {r.fee??'未知'}／稅 {r.tax??'未知'}／其他 {r.other_cost??'未知'}</p>{r.reason&&<p>{r.reason}</p>}{!r.superseded&&r.action!=='VOID'&&<div className="cockpit-actions"><button disabled={busy} onClick={()=>begin({action:r.action as 'BUY'|'SELL',row:r})}>更正</button><button disabled={busy} onClick={()=>begin({action:'VOID',row:r})}>取消誤記</button></div>}</article>):<p>尚無紀錄，不顯示虛構績效。</p>}</details>
  </>}
  <div className="cockpit-two"><article className="cockpit-card"><h3>系統研究成效</h3><p>目前資料不足，還不能判斷這套策略是否有效。</p><p>進場事前研究及結果追蹤尚未啟用；歷史研究不算事前績效。</p></article><article className="cockpit-card"><h3>市場方向判斷</h3><p>{legacy?`有效收盤樣本 ${legacy.performance.market.sample} 筆；方向命中率 ${legacy.performance.market.direction_accuracy===null?'資料不足':money(legacy.performance.market.direction_accuracy)+'%'}`:'樣本尚未讀取，不能判定準確率。'}</p><p>這不是股票選股勝率，也不是你的交易報酬。</p></article></div>
  <details className="cockpit-card"><summary>舊交易與完整計算規則</summary><p>成本方法：移動平均成本 V1。買入費用加計成本，賣出依當時平均成本分攤，扣除賣出費用後計算損益。金額只在顯示時四捨五入。</p><p>舊帳本未保存費用，維持「未知」，不轉成零、不搬移、不與新版績效混算。原有系統模擬也不算本人模擬績效。</p>
   {legacy?.trades.map(t=><p key={String(t.id)}>{String(t.symbol)} · 原紀錄 {String(t.quantity)} 股 × {String(t.entry_price)} · {t.kind==='SONY_LIVE_TRADE'?'本人實際紀錄':'舊模擬紀錄'} · 費用未知</p>)}
   <p>取消／更正只追加稽核，不刪除或改寫原紀錄。若更正導致任一時間點負庫存，整筆拒絕。沒有自動下單或券商串接。</p></details>
 </div>;
}
