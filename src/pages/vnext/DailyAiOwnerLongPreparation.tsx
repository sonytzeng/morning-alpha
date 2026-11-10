import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {AcademyAccess} from '@/pages/academy/useAcademyAccess';
import {parseDailyAiOwnerLongPreparation,type DailyAiOwnerLongPreparation as Preparation,type OwnerLongPreparation,type OwnerLongPreparationScope} from '@/features/vnext/dailyAiOwnerLongPreparation';
import {OwnerPriceCalculationContent} from './DailyAiOwnerPriceCalculation';
import './daily-ai-owner-calculation.css';

const date=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
const reviewNames={DEMAND:'需求持續性',MOAT:'競爭優勢',VALUATION:'估值與情境選擇'};

export function OwnerLongPreparationContent({preparation}:{preparation:OwnerLongPreparation}){
 const p=preparation,c=p.calculation;
 return <>
  <div className="dac-content">
   <section><h4>本次長期研究的準備進度</h4><p>{p.status==='READY_FOR_REVIEW'?'所需觀察資料已備妥，等待獨立判斷。':'計算已備妥，仍有來源或資料缺口需要補齊。'}目前沒有由這份準備物建立的選股通過、方法核准或會員發布紀錄。</p>
    <dl className="dac-facts"><div><dt>明示情境的研究區間</dt><dd>NT${String(c.entry_range[0])}～{String(c.entry_range[1])}</dd></div>
     <div><dt>高於此價等待</dt><dd>NT${String(c.wait_above)}</dd></div><div><dt>準備物有效至</dt><dd>{date(p.expires_at)}</dd></div></dl>
    <p>來源收盤價 NT${String(c.quote)}，資料日期 {c.data_through}。區間與股價的比較仍待估值審查，不能直接轉成買進資格。</p>
    <p>重評條件：{c.invalidation}</p><p className="dac-caption">準備物與研究版本的有效期取較早者；到期後只供核對歷史計算，不能沿用為新判斷。</p>
   </section>
   <section><h4>三項判斷仍待完成</h4>{p.review_items.map(item=><details key={item.kind}><summary>{reviewNames[item.kind]} · 待審查 · {item.observation_status==='SOURCE_REQUIRED'?'仍缺來源':'已有觀察或計算'}</summary>
    <p>{item.rationale}</p><p><strong>需要完成的判斷：</strong>{item.judgment_required}</p>
    {item.evidence_ids.length>0&&<p>對應來源：{item.evidence_ids.map(id=><code key={id}>{id}{' '}</code>)}</p>}
    <details><summary>查看本次觀察內容</summary><pre>{JSON.stringify(item.observations,null,2)}</pre></details>
   </details>)}</section>
   {p.missing.length>0&&<section><h4>尚缺資料（{p.missing.length}）</h4><ul>{p.missing.map((item,index)=><li key={index}><strong>{item.field}</strong>：{item.detail}<br/><code>{item.code}</code></li>)}</ul></section>}
   {p.pending_source_intake.length>0&&<p>另有 {p.pending_source_intake.length} 筆來源補充尚未完成收件；本版未將它們視為已納入的證據。</p>}
  </div>
  <OwnerPriceCalculationContent audit={c} context="LONG_PREPARATION"/>
  <div className="dac-content"><details><summary>本次準備物識別與保存內容</summary>
   <p>以下識別對應單一股票、同一研究版本的已登錄輸入與私人準備物；這裡沒有價格計畫編號或審查核准收據。</p>
   <dl className="dac-facts"><div><dt>輸入 SHA-256</dt><dd><code>{p.input_hash}</code></dd></div><div><dt>計算 SHA-256</dt><dd><code>{p.calculation_hash}</code></dd></div>
    <div><dt>長期準備物 SHA-256</dt><dd><code>{p.preparation_hash}</code></dd></div><div><dt>保存時間</dt><dd>{date(p.recorded_at)}</dd></div></dl>
   <details><summary>原始計算 JSON</summary><pre>{JSON.stringify(JSON.parse(c.raw.calculation_text),null,2)}</pre></details>
   <details><summary>原始長期準備物 JSON</summary><pre>{JSON.stringify(JSON.parse(p.raw_preparation_text),null,2)}</pre></details>
  </details></div>
 </>;
}

type ReadState={access:AcademyAccess;scope:OwnerLongPreparationScope;data:Preparation|null;error:boolean;missingReader:boolean};
export default function DailyAiOwnerLongPreparation({access,scope,onClose}:{access:AcademyAccess;scope:OwnerLongPreparationScope;onClose:()=>void}){
 const [read,setRead]=useState<ReadState|null>(null),[revision,setRevision]=useState(0),heading=useRef<HTMLElement|null>(null);
 const latest=useRef({access,scope});latest.current={access,scope};
 useEffect(()=>{
  setRead(null);if(access.kind!=='member'||access.catalog.tier!=='owner'||access.signal.aborted||scope.card.horizon!=='LONG')return;
  const controller=new AbortController();let live=true,timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  const current=()=>live&&latest.current.access===access&&latest.current.scope===scope&&!access.signal.aborted;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('READ_TIMEOUT'));},8000);});
  const canceled=new Promise<never>((_,reject)=>{abort=()=>{controller.abort();if(live&&latest.current.access===access&&latest.current.scope===scope)setRead(null);reject(Error('READ_SCOPE_ENDED'));};access.signal.addEventListener('abort',abort,{once:true});if(access.signal.aborted)abort();});
  const request=Promise.resolve().then(async()=>{
   if(!current())throw Error('READ_SCOPE_ENDED');
   const response=await supabase.rpc('get_daily_ai_owner_long_preparation_v1',{p_edition_id:scope.edition.id,p_symbol:scope.card.symbol}).abortSignal(controller.signal);
   if(response.error)throw Error(response.error.code==='PGRST202'||response.error.code==='42883'?'READER_UNAVAILABLE':'READ_FAILED');
   return parseDailyAiOwnerLongPreparation(response.data,scope,access.id);
  });
  void Promise.race([request,deadline,canceled]).then(data=>{if(current())setRead({access,scope,data,error:false,missingReader:false});})
   .catch(error=>{if(current())setRead({access,scope,data:null,error:true,missingReader:error instanceof Error&&error.message==='READER_UNAVAILABLE'});})
   .finally(()=>{clearTimeout(timer);controller.abort();});
  heading.current?.focus();
  return()=>{live=false;clearTimeout(timer);controller.abort();if(abort)access.signal.removeEventListener('abort',abort);};
 },[access,scope,revision]);
 if(access.kind!=='member'||access.catalog.tier!=='owner'||access.signal.aborted||scope.card.horizon!=='LONG')return null;
 const current=read?.access===access&&read.scope===scope?read:null;
 return <section className="dac-panel" id="owner-long-preparation-detail" ref={heading} tabIndex={-1} aria-labelledby="owner-long-preparation-heading">
  <div className="dac-heading"><div><p>Owner 私人研究準備</p><h3 id="owner-long-preparation-heading">{scope.card.company} {scope.card.symbol} · 長期估值準備</h3></div><button type="button" onClick={onClose}>關閉長期估值準備</button></div>
  {!current?<p role="status">正在讀取這一版股票的長期計算與待審資料，並核對內容識別。</p>:current.error?<div role="status"><p>{current.missingReader?'這個版本尚未提供長期估值準備讀取功能。':'長期估值準備暫時無法核對，已隱藏未確認的內容。'}選股狀態與會員閱讀資格未變更。</p><button type="button" onClick={()=>setRevision(value=>value+1)}>重新讀取長期估值準備</button></div>:current.data?.preparation?<OwnerLongPreparationContent preparation={current.data.preparation}/>:<p role="status">本版這檔股票的最新長期輸入尚無已保存的準備物。必須先登錄當次資料與明示方法假設、完成計算；空白紀錄不能視為選股或估值審查通過。</p>}
 </section>;
}
