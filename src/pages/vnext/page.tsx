import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAcademyAccess } from '@/pages/academy/useAcademyAccess';
import { parseProjection, type VNextProjection } from '@/features/vnext/projection';
import Workspace from './Workspace';
import './vnext.css';

/** Candidate route only. Intentionally not added to the Production router. */
export default function VNextPage() {
  const {access,retry}=useAcademyAccess();
  const [state,setState]=useState<{identity:string;generation:number;data?:VNextProjection;error?:boolean}|null>(null);
  useEffect(()=>{
    if(access.kind!=='member') { setState(null); return; }
    let live=true;
    const controller=new AbortController();
    const abort=()=>controller.abort();access.signal.addEventListener('abort',abort);
    setState(null);
    const timer=setTimeout(()=>{controller.abort();if(live)setState({identity:access.id,generation:access.generation,error:true});},20000);
    void (async()=>{
      try {
        const result=await supabase.rpc('get_vnext_observations_v1').abortSignal(controller.signal);
        if(!live||controller.signal.aborted||access.signal.aborted)return;
        if(result.error)throw Error('READ_UNAVAILABLE');
        setState({identity:access.id,generation:access.generation,data:parseProjection(result.data)});
      } catch {if(live&&!access.signal.aborted)setState({identity:access.id,generation:access.generation,error:true});}
      finally {clearTimeout(timer);}
    })();
    return()=>{live=false;clearTimeout(timer);controller.abort();access.signal.removeEventListener('abort',abort);};
  },[access]);
  if(access.kind==='member'&&state?.identity===access.id&&state.generation===access.generation&&state.data&&!access.signal.aborted)return <Workspace data={state.data}/>;
  const denied=access.kind==='denied',failed=access.kind==='unavailable'||state?.error;
  return <main className="vnext"><section className="vnext-content vnext-empty" role="status"><h1>{denied?'登入後，閱讀股票觀察':failed?'目前無法讀取研究資料':'正在確認可閱讀的內容'}</h1><p>{denied?'課程和觀察內容會依伺服器確認的會員權限提供。':failed?'請稍後再試。未取得資料不代表系統判斷正常，也不影響既有正式報告。':'請稍候，不會用範例資料代替正式內容。'}</p>{denied?<a className="vnext-primary" href="/login?next=%2Fvnext">登入帳號</a>:failed?<button type="button" className="vnext-primary" onClick={retry}>重新讀取</button>:null}</section></main>;
}
