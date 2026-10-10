import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAcademyAccess} from '@/pages/academy/useAcademyAccess';
import {parseMemberResearch,memberMarketSummary,type MemberResearch} from '@/features/vnext/member';
import MemberNavigation,{MemberObservationEntry} from './MemberNavigation';
import MemberExperience from './MemberExperience';
import './vnext.css';
import './member.css';
export default function MemberPage({account=false}:{account?:boolean}){
 const {access,retry}=useAcademyAccess(),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [state,setState]=useState<{identity:string;generation:number;data?:MemberResearch;error?:boolean;market?:ReturnType<typeof memberMarketSummary>}|null>(null);
 const current=useRef(access);current.current=access;
 useEffect(()=>{
  setState(null);setNotice('');setBusy(false);
  if(access.kind!=='member')return;
  const controller=new AbortController(),abort=()=>controller.abort();let live=true;
  access.signal.addEventListener('abort',abort);
  const valid=()=>live&&!controller.signal.aborted&&!access.signal.aborted;
  const timer=setTimeout(()=>{if(valid()){controller.abort();setState({identity:access.id,generation:access.generation,error:true});}},20000);
  void(async()=>{try{
   // Research access is checked independently by its RPC. No browser tier is sent.
   const response=await supabase.rpc('get_vnext_member_v1').abortSignal(controller.signal);
   if(!valid())return;if(response.error)throw Error('MEMBER_READ');
   const data=parseMemberResearch(response.data);
   if(data.tier!==access.catalog.tier)throw Error('ENTITLEMENT_CHANGED');
   setState({identity:access.id,generation:access.generation,data});clearTimeout(timer);
   // Read-only existing payload producer. A missing public summary must not
   // invent a market direction or block the independently authorized cards.
   const market=await Promise.race([supabase.functions.invoke('get-report-payload',{body:{report_date:null}}),
    new Promise<{data:null;error:true}>(resolve=>setTimeout(()=>resolve({data:null,error:true}),8000))]).catch(()=>({data:null,error:true}));
   if(valid())setState({identity:access.id,generation:access.generation,data,market:market.error?null:memberMarketSummary(market.data)});
  }catch{if(valid())setState({identity:access.id,generation:access.generation,error:true});}finally{clearTimeout(timer);}})();
  return()=>{live=false;clearTimeout(timer);controller.abort();access.signal.removeEventListener('abort',abort);};
 },[access,revision]);
 const data=access.kind==='member'&&!access.signal.aborted&&state?.identity===access.id&&state.generation===access.generation?state.data:null;
 const watch=async(id:string,watching:boolean)=>{
  if(!data||busy||access.kind!=='member'||access.signal.aborted)return;
  const identity=access.id,generation=access.generation;setBusy(true);setNotice('');
  try{const response=await supabase.rpc('set_vnext_watch_v1',{p_observation_id:id,p_watching:watching}).abortSignal(access.signal);
   const now=current.current;if(now.kind!=='member'||now.id!==identity||now.generation!==generation||now.signal.aborted)return;
   if(response.error)throw Error('WATCH_UNAVAILABLE');
   setState(s=>s?.data&&s.identity===identity&&s.generation===generation?{...s,data:{...s.data,watchlist:watching?[...new Set([...s.data.watchlist,id])]:s.data.watchlist.filter(x=>x!==id)}}:s);
   setNotice(watching?'已加入觀察清單':'已移出觀察清單');
  }catch{const now=current.current;if(now.kind==='member'&&now.id===identity&&!now.signal.aborted)setNotice('目前無法儲存，請重新讀取後再試。');}
  finally{const now=current.current;if(now.kind==='member'&&now.id===identity&&now.generation===generation)setBusy(false);}
 };
 const denied=access.kind==='denied',failed=access.kind==='unavailable'||state?.error;
 return <div className="vnext vm"><a className="vnext-skip" href="#stock-observations">跳到股票觀察</a><MemberNavigation/>
 {data?account?<main className="vnext-content"><h1>會員中心</h1><MemberObservationEntry/><p>既有會員權益與股票學院不變。</p><a href="/academy">前往股票學院</a></main>:<MemberExperience key={access.kind==='member'?access.id:''} data={data} market={state?.market||null} onWatch={watch} busy={busy} notice={notice}/>
 :<main className="vnext-content vnext-empty" role="status"><h1>{denied?'登入後，閱讀股票觀察':failed?'目前無法讀取股票觀察':'正在確認可閱讀的內容'}</h1><p>{denied?'免費會員可閱讀每日精選摘要；Premium 可查看完整已核准研究。研究不是正式推薦。':failed?'尚未取得資料，不代表今天沒有候選。請稍後再試。':'請稍候。'}</p>{denied?<a href="/login?next=%2Fstocks" className="vnext-primary">登入帳號</a>:failed?<button className="vnext-primary" onClick={()=>{retry();setRevision(r=>r+1);}}>重新讀取</button>:null}</main>}
 </div>;
}
