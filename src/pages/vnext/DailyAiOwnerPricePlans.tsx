import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {AcademyAccess} from '@/pages/academy/useAcademyAccess';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {dailyAiOwnerPriceCanApprove,dailyAiOwnerPriceCanRevoke,dailyAiOwnerPriceDeadlineMs,dailyAiOwnerPriceReviewRequest,
 parseDailyAiOwnerPricePlans,parseDailyAiOwnerPriceReviewResult,type DailyAiOwnerPriceAction,type DailyAiOwnerPricePlans as Preview,type DailyAiOwnerPriceRow} from '@/features/vnext/dailyAiOwnerPricePlans';
import './daily-ai-member.css';

type Scope={identity:string;generation:number;accessSignal:AbortSignal;editionId:string;controller:AbortController};
type Command={scope:Scope;args:ReturnType<typeof dailyAiOwnerPriceReviewRequest>};
class PriceRequestFailure extends Error{
 readonly kind:'SCOPE'|'REJECTED'|'UNKNOWN';
 constructor(kind:PriceRequestFailure['kind']){super('OWNER_PRICE_REQUEST_'+kind);this.kind=kind;}
}
const date=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
const money=(value:number)=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(value);
const label=(value:string|undefined)=>value==='PASS'?'通過':value==='FAIL'?'未通過':'待完成';
async function bounded<T>(signal:AbortSignal,perform:(inner:AbortSignal)=>PromiseLike<T>):Promise<T>{
 if(signal.aborted)throw new PriceRequestFailure('UNKNOWN');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 try{
  const canceled=new Promise<never>((_,reject)=>{abort=()=>{clearTimeout(timer);controller.abort();reject(new PriceRequestFailure('UNKNOWN'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new PriceRequestFailure('UNKNOWN'));},8000);});
  return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw new PriceRequestFailure('UNKNOWN');return perform(controller.signal);}),canceled,deadline]);
 }finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);controller.abort();}
}
function checkResponse(error:unknown){
 if(!error)return;
 const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
 if(code==='42501')throw new PriceRequestFailure('SCOPE');
 // Explicit database/absent-function errors are confirmed rejections. A
 // missing transport or malformed success remains an unknown commit outcome.
 throw new PriceRequestFailure(code==='P0001'||code==='PGRST202'||code==='42883'||/^(?:22|23)[A-Z0-9]{3}$/.test(code)?'REJECTED':'UNKNOWN');
}

export function DailyAiOwnerPricePreview({data,busy=false,blocked=false,onReview}:{data:Preview;busy?:boolean;blocked?:boolean;onReview:(row:DailyAiOwnerPriceRow,action:DailyAiOwnerPriceAction)=>void}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[limit,setLimit]=useState(9),[now,setNow]=useState(Date.now);
 const deadlines=data.plans.flatMap(row=>[row.body.expires_at,...(row.review?[row.review.expires_at]:[])])
  .map(dailyAiOwnerPriceDeadlineMs).filter(expiry=>Number.isFinite(expiry)&&expiry>now);
 const expiry=deadlines.length?Math.min(...deadlines):Infinity;
 useEffect(()=>{const update=()=>setNow(previous=>Math.max(previous,Date.now())),timer=setInterval(update,15000);
  const deadline=Number.isFinite(expiry)?setTimeout(()=>setNow(previous=>Math.max(previous,Date.now(),expiry)),Math.min(2147483647,Math.max(0,expiry-Date.now()))):undefined;
  document.addEventListener('visibilitychange',update);update();
  return()=>{clearInterval(timer);clearTimeout(deadline);document.removeEventListener('visibilitychange',update);};
 },[expiry]);
 const rows=data.plans.filter(row=>row.body.horizon===horizon);
 if(!data.plans.length)return <p role="status">本版尚無已送入審查的價格候選。這裡不會自行產生數字或代填審查。</p>;
 return <div className="dam"><p>價格計畫須逐筆獨立核准；研究版核准不會自動核准新的價格。</p>
  <div className="vnext-horizons dam-periods" aria-label="Owner 價格預覽期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>{setHorizon(h);setLimit(9);}}><strong>{HORIZONS[h].label}</strong><small>{data.plans.filter(row=>row.body.horizon===h).length} 個價格候選</small></button>)}</div>
  <div className="vnext-grid">{rows.slice(0,limit).map(row=>{const p=row.body,r=row.review,pub=row.publication,approved=pub?.action==='APPROVE'&&pub.review_id===r?.id;
   return <article className="vnext-card dam-card" key={row.plan_hash}><h4>{p.symbol} · {HORIZONS[p.horizon].label}</h4>
    <p>研究區間 NT${money(p.entry_range[0])}～{money(p.entry_range[1])}；超過 NT${money(p.wait_above)} 先等待。</p>
    {p.stop_kind==='PRICE'&&p.stop!==null?<p>停止參考價：NT${money(p.stop)}</p>:null}<p>停止／重評條件：{p.invalidation}</p><p>{p.basis}</p>
    <p>資料核對 {date(p.as_of)}；有效至 {date(p.expires_at)}（台北）。{dailyAiOwnerPriceDeadlineMs(p.expires_at)<=now?'已到期，只供私人核對。':''}</p>
    <p>獨立審查：品質 {label(r?.quality)} · 時效 {label(r?.time_status)} · 來源用途 {label(r?.source_use)} · 方法 {label(r?.methodology)}</p>
    <p>{pub?`最近紀錄：${pub.action==='APPROVE'?'已核准':'已撤回'}（${date(pub.occurred_at)}）。`:'尚無價格發布紀錄。'}{approved?'會員是否可讀仍依研究版、來源及有效期決定。':''}</p>
    <details><summary>價格方法與審查識別</summary><p>研究方法：{p.method}</p><p>計畫：<code>{row.plan_hash}</code></p><p>版本：<code>{p.edition_id}</code></p>
     <p>引用：{p.evidence_ids.join('、')}</p>{r?<><p>審查：<code>{r.id}</code>；文件：<code>{r.document_hash}</code></p><p>審查時間 {date(r.reviewed_at)}；有效至 {date(r.expires_at)}。</p></>:<p>尚未收到獨立價格審查，無法核准。</p>}</details>
    <button disabled={busy||blocked||approved||!dailyAiOwnerPriceCanApprove(row,now)} onClick={()=>onReview(row,'APPROVE')}>核准此價格計畫</button>{' '}
    <button disabled={busy||blocked||!dailyAiOwnerPriceCanRevoke(row)} onClick={()=>onReview(row,'REVOKE')}>撤回此價格計畫</button>
   </article>;})}</div>
  {rows.length>limit?<button onClick={()=>setLimit(value=>value+9)}>再看 9 個價格候選</button>:null}
 </div>;
}

export default function DailyAiOwnerPricePlans({access,editionId}:{access:AcademyAccess;editionId:string|null}){
 const [revision,setRevision]=useState(0),[result,setResult]=useState<{scope:Scope;epoch:number;data:Preview}|null>(null),[error,setError]=useState(false),[denied,setDenied]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
 const props=useRef({access,editionId});props.current={access,editionId};
 const boundary=useRef<Scope|null>(null),epoch=useRef(0),pending=useRef(false),command=useRef<Command|null>(null),rendered=useRef(result);rendered.current=result;
 const current=useCallback((scope:Scope)=>{const p=props.current,a=p.access;return boundary.current===scope&&!scope.controller.signal.aborted&&a.kind==='member'&&a.catalog.tier==='owner'
  &&!a.signal.aborted&&a.signal===scope.accessSignal&&a.id===scope.identity&&a.generation===scope.generation&&p.editionId===scope.editionId;},[]);
 useEffect(()=>{
  setResult(null);setError(false);setDenied(false);setNotice('');setBusy(false);setUncertain(false);pending.current=false;command.current=null;
  if(access.kind!=='member'||access.catalog.tier!=='owner'||access.signal.aborted||!editionId)return;
  const scope:Scope={identity:access.id,generation:access.generation,accessSignal:access.signal,editionId,controller:new AbortController()};boundary.current=scope;
  const abort=()=>{scope.controller.abort();if(boundary.current===scope){epoch.current++;command.current=null;pending.current=false;setResult(null);setBusy(false);setUncertain(false);setNotice('');}};
  access.signal.addEventListener('abort',abort,{once:true});
  // Clearing this exact scope invalidates its reads and callbacks immediately;
  // the next read owns a new epoch. No mutable epoch is borrowed by cleanup.
  return()=>{access.signal.removeEventListener('abort',abort);scope.controller.abort();if(boundary.current===scope)boundary.current=null;};
 },[access,editionId]);
 useEffect(()=>{
  const scope=boundary.current;if(!scope||!current(scope))return;
  const controller=new AbortController(),token=++epoch.current;let live=true;setResult(null);setError(false);setDenied(false);
  const abort=()=>controller.abort();scope.controller.signal.addEventListener('abort',abort,{once:true});
  void bounded(controller.signal,async signal=>{const response=await supabase.rpc('get_daily_ai_owner_price_plans_v1',{p_edition_id:scope.editionId}).abortSignal(signal);
   checkResponse(response.error);return parseDailyAiOwnerPricePlans(response.data,scope.editionId,scope.identity);
  }).then(data=>{if(live&&current(scope)&&token===epoch.current)setResult({scope,epoch:token,data});})
   .catch(failure=>{if(live&&current(scope)&&token===epoch.current){setResult(null);setError(true);if(failure instanceof PriceRequestFailure&&failure.kind==='SCOPE'){setDenied(true);command.current=null;setUncertain(false);}}});
  return()=>{live=false;controller.abort();scope.controller.signal.removeEventListener('abort',abort);};
 },[access,editionId,revision,current]);
 const owner=access.kind==='member'&&access.catalog.tier==='owner'&&!access.signal.aborted;
 const data=owner&&result&&current(result.scope)&&result.epoch===epoch.current&&!denied?result.data:null;
 const refresh=()=>{if(pending.current)return;epoch.current++;setResult(null);setRevision(value=>value+1);};
 const perform=async(selected:Command)=>{
  if(!current(selected.scope)||pending.current||denied)return;
  pending.current=true;setBusy(true);setNotice('');setUncertain(false);let permissionLost=false;
  try{
   const response=await bounded(selected.scope.controller.signal,signal=>supabase.rpc('review_daily_ai_price_plan_v1',selected.args).abortSignal(signal));
   if(!current(selected.scope)||command.current!==selected)return;checkResponse(response.error);parseDailyAiOwnerPriceReviewResult(response.data,selected.args.p_action);
   command.current=null;setNotice(selected.args.p_action==='APPROVE'?'價格核准紀錄已確認，正在重新核對。':'價格撤回紀錄已確認，正在重新核對。');
  }catch(failure){if(current(selected.scope)&&command.current===selected){
   if(failure instanceof PriceRequestFailure&&failure.kind==='SCOPE'){permissionLost=true;epoch.current++;command.current=null;setResult(null);setDenied(true);setUncertain(false);setNotice('價格操作權限已失效，請重新確認登入權限。');}
   else if(failure instanceof PriceRequestFailure&&failure.kind==='REJECTED'){command.current=null;setNotice('本次未通過伺服器檢查，正在重新讀取最新價格與審查。');}
   else{setUncertain(true);setNotice('這次結果尚未確認。重試會使用同一請求編號，其他價格操作暫停。');}
  }}finally{if(current(selected.scope)){
   pending.current=false;setBusy(false);if(command.current===null&&!permissionLost){epoch.current++;setResult(null);setRevision(value=>value+1);}
  }}
 };
 const submit=(row:DailyAiOwnerPriceRow,action:DailyAiOwnerPriceAction)=>{
  const snapshot=rendered.current,scope=boundary.current;
  if(!snapshot||!scope||!current(scope)||snapshot.scope!==scope||snapshot.epoch!==epoch.current||!snapshot.data.plans.includes(row)||pending.current||command.current||denied)return;
  try{const selected:Command={scope,args:dailyAiOwnerPriceReviewRequest(row,scope.editionId,action,crypto.randomUUID())};command.current=selected;void perform(selected);}catch{/* A stale candidate cannot send a write. */}
 };
 if(!owner||!editionId)return null;
 return <section className="vnext-section" aria-labelledby="owner-price-plans-heading"><h3 id="owner-price-plans-heading">本版價格計畫 · 私人預覽與核准</h3>
  <button disabled={busy} onClick={refresh}>重新讀取價格候選</button><p role="status">{notice}</p>
  {uncertain&&command.current&&current(command.current.scope)?<button disabled={busy||denied} onClick={()=>{const selected=command.current;if(selected)void perform(selected);}}>以原請求重試確認</button>:null}
  {denied?<p role="status">目前無法確認 Owner 價格權限，私人候選已隱藏。</p>:error?<p role="status">目前無法讀取完整價格候選，無法核准。</p>:!data?<p role="status">正在讀取本版價格及四項獨立審查。</p>:<DailyAiOwnerPricePreview key={data.edition_id} data={data} busy={busy} blocked={uncertain} onReview={submit}/>}
 </section>;
}
