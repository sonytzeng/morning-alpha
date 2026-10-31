import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAcademyAccess} from '@/pages/academy/useAcademyAccess';
import MemberNavigation from './MemberNavigation';
import OwnerAiPublication from './OwnerAiPublication';
import './vnext.css';
import './member.css';
type ReviewRow={id:string;symbol:string;company:string;reason:string;review_id:string|null;review_reason:string|null;primary_risk:string|null;prerequisites_ready:boolean;published:boolean;current:boolean;requires_new_version:boolean;free_allowed:boolean;quality:string|null;licensing:string|null;time_status:string|null};
export default function OwnerPublication(){
 const {access,retry}=useAcademyAccess(),[revision,setRevision]=useState(0),[rows,setRows]=useState<{identity:string;generation:number;data:ReviewRow[]}|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const owner=access.kind==='member'&&access.catalog.tier==='owner';
 useEffect(()=>{
  setRows(null);setError(false);setNotice('');if(access.kind!=='member'||access.catalog.tier!=='owner')return;
  let live=true;void(async()=>{try{
   const r=await supabase.rpc('get_owner_vnext_publication_review_v1').abortSignal(access.signal);
   if(r.error||!Array.isArray(r.data?.rows)||r.data.rows.length>216)throw Error('OWNER_READ');
   if(live&&!access.signal.aborted)setRows({identity:access.id,generation:access.generation,data:r.data.rows});
  }catch{if(live&&!access.signal.aborted)setError(true);}})();return()=>{live=false;};
 },[access,revision]);
 const data=access.kind==='member'&&!access.signal.aborted&&rows?.identity===access.id&&rows.generation===access.generation?rows.data:null;
 const submit=async(row:ReviewRow,action:'APPROVE'|'REVOKE')=>{
  if(!owner||busy||access.kind!=='member'||!row.review_id||access.signal.aborted)return;
  setBusy(true);setNotice('');try{
   const r=await supabase.rpc('review_vnext_publication_candidate_v1',{p_observation_id:row.id,p_review_id:row.review_id,p_action:action,p_audience:row.free_allowed?'free':'premium',p_request_key:crypto.randomUUID()}).abortSignal(access.signal);
   if(access.signal.aborted)return;
   if(r.error)throw Error('NOT_APPROVED');
   setNotice(action==='REVOKE'?'已撤回會員閱讀權限，歷史稽核紀錄保留。':'已通過完整檢查並保存你的核准。');setRevision(x=>x+1);
  }catch{if(!access.signal.aborted)setNotice('本次未完成發布。來源、時效或審查可能已改變；請重新讀取，不要略過檢查。');}finally{setBusy(false);}
 };
 const label=(s:string|null)=>s==='PASS'?'通過':s==='FAIL'?'未通過':'待確認';
 return <div className="vnext vm"><MemberNavigation/><main className="vnext-content"><h1>目前有幾項研究可以發布？</h1><OwnerAiPublication access={access}/><p>只有資料、品質、時效與使用權都通過，才能提交逐筆核准。研究不是正式推薦。</p>
  {!owner?<p role="status">{access.kind==='loading'?'正在確認管理權限。':'此頁僅供正式 Owner 使用。'}</p>:error?<><p role="status">目前無法取得審查結果，不代表沒有研究。</p><button onClick={retry}>重新讀取</button></>:!data?<p role="status">正在讀取審查。</p>:<>
   <p>前置審查完成 {data.filter(x=>x.prerequisites_ready&&!x.published).length} 項 · 已核准可閱讀 {data.filter(x=>x.published).length} 項 · 尚待完成 {data.filter(x=>!x.prerequisites_ready&&!x.published).length} 項</p>
   <p role="status">{notice}</p>{!data.length?<section className="vnext-empty"><h2>目前沒有送入發布審查的新研究</h2><p>每日研究與公開發布是兩個獨立步驟。私人研究不會自動出現在會員頁面。</p></section>:<div className="vnext-grid">{data.map(row=><article className="vnext-card" key={row.id}><h2>{row.company} {row.symbol}</h2><p>{row.reason}</p><p>主要風險：{row.primary_risk||'尚待完整審核'}</p><p>品質：{label(row.quality)} · 時間：{label(row.time_status)} · 使用權：{label(row.licensing)}</p>
    <details><summary>查看審核說明</summary><p>{row.review_reason||'尚未取得獨立審核結果。'}</p></details>
    {row.published&&!row.current&&<p>僅供歷史查閱，不是目前有效的股票觀察。你仍可以撤回會員閱讀權限。</p>}
    {row.requires_new_version&&<p>這份已發布紀錄目前已停止提供；如需再次發布，必須建立並審核新的研究版本，不能覆寫原紀錄。</p>}
    {row.published?<button disabled={busy} onClick={()=>submit(row,'REVOKE')}>撤回會員內容</button>:<button disabled={busy||!row.prerequisites_ready} onClick={()=>submit(row,'APPROVE')}>提交完整檢查並核准{row.free_allowed?'免費及Premium':'Premium'}閱讀</button>}
   </article>)}</div>}
  </>}
 </main></div>;
}
