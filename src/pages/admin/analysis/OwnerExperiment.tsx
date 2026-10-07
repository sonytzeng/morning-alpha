import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

/** User-initiated paper journal only. Never called by a research evaluation. */
export default function OwnerExperiment({symbol,runId}:{symbol:string;runId:string}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const requestId=useRef(''),alive=useRef(true);
 useEffect(()=>{alive.current=true;const {data}=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){alive.current=false;setOpen(false);setMessage('');}});return()=>{alive.current=false;data.subscription.unsubscribe();};},[]);
 // The parent is removed on identity change; an in-flight result cannot reopen
 // the form or expose a different user's data. No trade is created on render.
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();const f=new FormData(event.currentTarget);setBusy(true);setMessage('');
  const result=await supabase.functions.invoke('owner-trading-lab-v1',{body:{operation:'RECORD_TRADE',request_id:requestId.current,
   trade:{kind:'OWNER_EXPERIMENT',research_run_id:runId,symbol,quantity:Number(f.get('quantity')),stop_price:Number(f.get('stop')),
    entry_condition:String(f.get('plan')),horizon:String(f.get('horizon')),notes:String(f.get('notes')||'')}}}).catch(()=>({error:true,data:null}));
  if(!alive.current)return;
  setBusy(false);setMessage(result.error||result.data?.error?'未建立：目前可能已收盤、報價過期或計畫不完整；不回填過去價格，不改寫研究條件。':'實驗已鎖定；僅列入 Owner 紙上實驗，不計入系統 READY 或 V2 Forward。');
  if(!result.error&&!result.data?.error)setOpen(false);
 };
 return <div className="mt-3">
  <button type="button" disabled={busy||!runId} className="min-h-11 rounded border px-4 py-2" onClick={()=>{requestId.current=crypto.randomUUID();setOpen(true);setMessage('');}}>我想研究：建立紙上實驗</button>
  {message?<p role="status" className="mt-2 text-sm">{message}</p>:null}
  {open?<form onSubmit={submit} aria-label={`${symbol} Owner 紙上實驗`} className="mt-3 space-y-3 rounded border p-3">
   <h5 className="font-semibold">{symbol} · 自選實驗，不是系統推薦</h5>
   <p className="text-sm">只在開盤期間以伺服器保存的五分鐘內可信報價建立；價格不可自填或倒填。原始計畫、停損及研究來源不可修改。實驗績效與 V2 WATCH／READY 分開。</p>
   <label className="block text-sm">為何要做這個實驗？<textarea name="plan" required maxLength={2000} className="mt-1 block w-full rounded border p-2"/></label>
   <label className="block text-sm">模擬股數<input name="quantity" type="number" min="1" max="99999999" step="1" required className="mt-1 block w-full rounded border p-2"/></label>
   <label className="block text-sm">原始停損價<input name="stop" type="number" min="0.0001" step="any" required className="mt-1 block w-full rounded border p-2"/></label>
   <label className="block text-sm">觀察期間<select name="horizon" className="mt-1 block w-full rounded border p-2">{['CLOSE','1D','3D','5D'].map(h=><option key={h}>{h}</option>)}</select></label>
   <label className="block text-sm">備註<textarea name="notes" maxLength={2000} className="mt-1 block w-full rounded border p-2"/></label>
   <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className="min-h-11 rounded border px-4 py-2">確認並鎖定紙上實驗</button><button type="button" disabled={busy} onClick={()=>setOpen(false)} className="min-h-11 rounded border px-4 py-2">取消</button></div>
  </form>:null}
 </div>;
}
