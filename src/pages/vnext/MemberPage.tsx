import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAcademyAccess} from '@/pages/academy/useAcademyAccess';
import {parseMemberResearch,memberMarketSummary,memberTaipeiDate,type MemberResearch} from '@/features/vnext/member';
import MemberNavigation,{MemberObservationEntry} from './MemberNavigation';
import MemberExperience from './MemberExperience';
import PublicExperience from './PublicExperience';
import CompletedResearch from './CompletedResearch';
import {parseCompletedResearch,type CompletedResearch as CompletedData} from '@/features/vnext/completedResearch';
import {parseDailyAiMember,type DailyAiMemberResearch as DailyAiData} from '@/features/vnext/dailyAiMember';
import DailyAiMemberResearch,{type DailyAiMemberViewState} from './DailyAiMemberResearch';
import type {Horizon} from '@/features/vnext/contracts';
import './vnext.css';
import './member.css';
type DailyViewScope={identity:string;tier:DailyAiData['tier'];editionId:string;requestDate:string};
type DailyViewMemory=DailyViewScope&{view:DailyAiMemberViewState};
const emptyDailyView=():DailyAiMemberViewState=>({filter:'ALL',query:'',limit:9});
const sameDailyScope=(a:DailyViewScope|null,b:DailyViewScope|null)=>!!a&&!!b&&a.identity===b.identity&&a.tier===b.tier&&a.editionId===b.editionId&&a.requestDate===b.requestDate;
export default function MemberPage({account=false}:{account?:boolean}){
 const {access,retry}=useAcademyAccess(),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [selectedHorizon,setSelectedHorizon]=useState<Horizon>('SHORT');
 // UI preferences only: never keep cards, source data or an entitlement here.
 const [dailyView,setDailyView]=useState<DailyViewMemory|null>(null),dailyScope=useRef<DailyViewScope|null>(null);
 const [state,setState]=useState<{identity:string;generation:number;readEpoch:number;requestDate:string;data?:MemberResearch;completed?:CompletedData|null;completedError?:boolean;dailyAi?:DailyAiData;dailyAiError?:boolean;error?:boolean}|null>(null);
 const current=useRef(access);current.current=access;
 const retryRef=useRef(retry);retryRef.current=retry;
 const mounted=useRef(false),readEpoch=useRef(0),publicEpoch=useRef(0);
 const readController=useRef<AbortController|null>(null),watchController=useRef<AbortController|null>(null);
 const aiReadController=useRef<AbortController|null>(null);
 const [businessDate,setBusinessDate]=useState(memberTaipeiDate),dateRef=useRef(businessDate);
 const [publicState,setPublicState]=useState<{requestDate:string;market:ReturnType<typeof memberMarketSummary>;loading:boolean}|null>(null);
 const clearDailyView=useCallback(()=>{dailyScope.current=null;setDailyView(null);setSelectedHorizon('SHORT');},[]);
 // Invalidation is synchronous: an older closure cannot revive data while the
 // entitlement hook is still waiting to render its next generation.
 const invalidate=useCallback(()=>{
  readEpoch.current++;readController.current?.abort();aiReadController.current?.abort();watchController.current?.abort();watchController.current=null;
  setState(null);setNotice('');setBusy(false);
 },[]);
 useEffect(()=>{
  mounted.current=true;let midnight:ReturnType<typeof setTimeout>;
  const checkDate=()=>{
   const next=memberTaipeiDate();
   if(next!==dateRef.current){dateRef.current=next;publicEpoch.current++;invalidate();clearDailyView();setPublicState(null);setBusinessDate(next);}
  };
  const scheduleMidnight=()=>{
   clearTimeout(midnight);const now=Date.now(),date=memberTaipeiDate(now);
   if(!date)return;
   const delay=Date.parse(`${date}T00:00:00+08:00`)+86400000-now;
   midnight=setTimeout(()=>{checkDate();invalidate();retryRef.current();scheduleMidnight();},Math.max(1,delay));
  };
  // API always rechecks entitlement. Clear the rendered private state on focus,
  // visibility loss and bounded refresh, including expiry without a JWT change.
  const refresh=()=>{checkDate();invalidate();scheduleMidnight();retryRef.current();};
  const visibility=()=>{checkDate();invalidate();scheduleMidnight();if(document.visibilityState==='visible')retryRef.current();};
  checkDate();scheduleMidnight();
  const timer=setInterval(refresh,30000);
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;invalidate();clearTimeout(midnight);clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visibility);};
 },[invalidate,clearDailyView]);
 useEffect(()=>{
  const scope=dailyScope.current;
  if(account||access.kind==='denied'||scope&&(scope.requestDate!==businessDate
   ||access.kind==='member'&&(scope.identity!==access.id||scope.tier!==access.catalog.tier)))clearDailyView();
  // A loading/unavailable recheck may retain these scalars, but renders no old
  // private data. A different user/tier clears them before any fresh read.
 },[access,businessDate,account,clearDailyView]);
 useEffect(()=>{
  const requestDate=businessDate,epoch=++publicEpoch.current;let live=true,timer:ReturnType<typeof setTimeout>;
  const valid=()=>live&&mounted.current&&epoch===publicEpoch.current&&!!requestDate&&dateRef.current===requestDate&&memberTaipeiDate()===requestDate;
  if(!valid())return;
  setPublicState({requestDate,market:null,loading:true});
  // Explicitly anonymous transport, reread only when the Taipei date changes.
  // The fixed SDK cannot abort this invoke, so both result paths are date-bound.
  void Promise.race([supabase.functions.invoke('get-report-payload',{headers:{Authorization:''},body:{report_date:null}}),
   new Promise<{data:null;error:true}>(resolve=>{timer=setTimeout(()=>resolve({data:null,error:true}),8000);})])
   .catch(()=>({data:null,error:true})).then(result=>{clearTimeout(timer);if(valid())setPublicState({requestDate,market:result.error?null:memberMarketSummary(result.data),loading:false});});
  return()=>{live=false;clearTimeout(timer);};
 },[businessDate]);
 useEffect(()=>{
  invalidate();const epoch=readEpoch.current,requestDate=memberTaipeiDate();
  if(access.kind!=='member'||access.signal.aborted||!requestDate||requestDate!==dateRef.current||document.visibilityState==='hidden')return;
  const controller=new AbortController();readController.current=controller;let live=true;
  const abort=()=>{if(epoch===readEpoch.current)invalidate();else controller.abort();};
  access.signal.addEventListener('abort',abort);
  const valid=()=>{const now=current.current;return live&&mounted.current&&epoch===readEpoch.current&&!controller.signal.aborted&&!access.signal.aborted
   &&now.kind==='member'&&now.id===access.id&&now.generation===access.generation&&now.signal===access.signal&&now.catalog.tier===access.catalog.tier
   &&dateRef.current===requestDate&&memberTaipeiDate()===requestDate;};
  const bind={identity:access.id,generation:access.generation,readEpoch:epoch,requestDate};
  const timer=setTimeout(()=>{if(valid()){setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,error:true}));controller.abort();}},20000);
  void(async()=>{try{
   // Research access is checked independently by its RPC. No browser tier is sent.
   if(!valid())return;
   const response=await supabase.rpc('get_vnext_member_v1').abortSignal(controller.signal);
   if(!valid())return;if(response.error)throw Error('MEMBER_READ');
   let data=parseMemberResearch(response.data,requestDate);
   if(data.tier!==access.catalog.tier)throw Error('ENTITLEMENT_CHANGED');
   if(data.tier==='free'){
    const history=await supabase.rpc('get_vnext_free_history_v1').abortSignal(controller.signal);
    if(!valid())return;
    if(history.error||history.data?.schema!=='VNEXT_FREE_HISTORY_V1')throw Error('HISTORY_UNAVAILABLE');
    data=parseMemberResearch({...response.data,history:history.data.history},requestDate);
   }
   let completed:CompletedData|null=null,completedError=false;
   if(data.tier==='owner'&&!account){
    try{const r=await supabase.rpc('get_owner_completed_research_v1').abortSignal(controller.signal);
     if(!valid())return;if(r.error)throw Error('COMPLETED_READ');completed=await parseCompletedResearch(r.data);
    }catch{completedError=true;}
   }
   if(valid())setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,data,completed,completedError,error:false}));clearTimeout(timer);
  }catch{if(valid())setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,error:true}));}finally{clearTimeout(timer);}})();
  return()=>{live=false;clearTimeout(timer);controller.abort();if(readController.current===controller)readController.current=null;access.signal.removeEventListener('abort',abort);};
 },[access,revision,businessDate,invalidate,account]);
 useEffect(()=>{
  // The AI edition has its own entitlement check and read deadline. Legacy
  // history or an Owner preview failure cannot hide a valid member edition.
  if(account||access.kind!=='member'||access.signal.aborted||document.visibilityState==='hidden')return;
  const epoch=readEpoch.current,requestDate=memberTaipeiDate(),controller=new AbortController();aiReadController.current=controller;let live=true;
  const valid=()=>{const now=current.current;return live&&mounted.current&&epoch===readEpoch.current&&!controller.signal.aborted&&!access.signal.aborted
   &&now.kind==='member'&&now.id===access.id&&now.generation===access.generation&&now.signal===access.signal&&now.catalog.tier===access.catalog.tier
   &&!!requestDate&&dateRef.current===requestDate&&memberTaipeiDate()===requestDate;};
  if(!valid())return;
  const bind={identity:access.id,generation:access.generation,readEpoch:epoch,requestDate};
  const abort=()=>controller.abort();access.signal.addEventListener('abort',abort);
  const failed=()=>{if(valid())setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,dailyAiError:true}));};
  const timer=setTimeout(()=>{failed();controller.abort();},8000);
  void(async()=>{try{
   const r=await supabase.rpc('get_daily_ai_member_research_v1').abortSignal(controller.signal);
   if(!valid())return;if(r.error){if(r.error.code==='42501')clearDailyView();throw Error('DAILY_AI_READ');}
   const dailyAi=parseDailyAiMember(r.data,requestDate);
   if(dailyAi.tier!==access.catalog.tier){clearDailyView();throw Error('ENTITLEMENT_CHANGED');}
   if(valid()){
    if(!dailyAi.edition)clearDailyView();
    else{
     const scope:DailyViewScope={identity:access.id,tier:dailyAi.tier,editionId:dailyAi.edition.id,requestDate};
     if(!sameDailyScope(dailyScope.current,scope)){dailyScope.current=scope;setDailyView({...scope,view:emptyDailyView()});setSelectedHorizon('SHORT');}
    }
    setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,dailyAi,dailyAiError:false}));
   }
  }catch{failed();}finally{clearTimeout(timer);}})();
  return()=>{live=false;clearTimeout(timer);controller.abort();if(aiReadController.current===controller)aiReadController.current=null;access.signal.removeEventListener('abort',abort);};
 },[access,revision,businessDate,account,clearDailyView]);
 const today=memberTaipeiDate();
 const matchingState=access.kind==='member'&&!access.signal.aborted&&state?.identity===access.id&&state.generation===access.generation
  &&state.readEpoch===readEpoch.current&&state.requestDate===today&&today===dateRef.current;
 const data=matchingState?state.data:null;
 const dailyAi=matchingState?state?.dailyAi:undefined;
 const visibleDailyScope:DailyViewScope|null=access.kind==='member'&&dailyAi?.edition?
  {identity:access.id,tier:dailyAi.tier,editionId:dailyAi.edition.id,requestDate:state!.requestDate}:null;
 const canChangeDailyView=()=>!!visibleDailyScope&&access.kind==='member'&&current.current.kind==='member'&&mounted.current
  &&current.current.id===visibleDailyScope.identity&&current.current.catalog.tier===visibleDailyScope.tier
  &&current.current.generation===state?.generation&&current.current.signal===access.signal&&!access.signal.aborted
  &&readEpoch.current===state?.readEpoch&&dateRef.current===visibleDailyScope.requestDate&&memberTaipeiDate()===visibleDailyScope.requestDate
  &&sameDailyScope(dailyScope.current,visibleDailyScope)&&document.visibilityState!=='hidden'&&!!dailyAi?.edition&&Date.parse(dailyAi.edition.expires_at)>Date.now();
 const changeDailyView=(change:(previous:DailyAiMemberViewState)=>DailyAiMemberViewState)=>{
  const scope=visibleDailyScope;if(!scope||!canChangeDailyView())return;
  setDailyView(previous=>{if(!canChangeDailyView())return previous;const next=change(sameDailyScope(previous,scope)?previous!.view:emptyDailyView());
   return {...scope,view:{filter:next.filter,query:next.query,limit:next.limit}};});
 };
 const changeDailyHorizon=(next:Horizon)=>{if(canChangeDailyView())setSelectedHorizon(next);};
 const publicMarket=publicState?.requestDate===today?publicState.market:null,marketLoading=!!today&&(!publicState||publicState.requestDate!==today||publicState.loading);
 const watch=async(id:string,watching:boolean)=>{
  if(!data||busy||watchController.current||access.kind!=='member'||access.signal.aborted)return;
  const identity=access.id,generation=access.generation,epoch=state.readEpoch,requestDate=state.requestDate,controller=new AbortController();
  const stillCurrent=()=>{const now=current.current;return mounted.current&&epoch===readEpoch.current&&now.kind==='member'&&now.id===identity&&now.generation===generation
   &&now.signal===access.signal&&!now.signal.aborted&&dateRef.current===requestDate&&memberTaipeiDate()===requestDate&&document.visibilityState!=='hidden';};
  if(!stillCurrent())return;
  watchController.current=controller;const valid=()=>stillCurrent()&&watchController.current===controller&&!controller.signal.aborted;
  const abort=()=>controller.abort();access.signal.addEventListener('abort',abort);setBusy(true);setNotice('');
  try{if(!valid())return;const response=await supabase.rpc('set_vnext_watch_v1',{p_observation_id:id,p_watching:watching}).abortSignal(controller.signal);
   if(!valid())return;
   if(response.error)throw Error('WATCH_UNAVAILABLE');
   setState(s=>stillCurrent()&&s?.data&&s.identity===identity&&s.generation===generation&&s.readEpoch===epoch&&s.requestDate===requestDate?{...s,data:{...s.data,watchlist:watching?[...new Set([...s.data.watchlist,id])]:s.data.watchlist.filter(x=>x!==id)}}:s);
   setNotice(watching?'已加入觀察清單':'已移出觀察清單');
  }catch{if(valid())setNotice('目前無法儲存，請重新讀取後再試。');}
  finally{access.signal.removeEventListener('abort',abort);if(valid()){watchController.current=null;setBusy(false);}}
 };
 const denied=access.kind==='denied',failed=access.kind==='unavailable'||(matchingState&&state.error);
 return <div className="vnext vm"><a className="vnext-skip" href="#stock-observations">跳到股票觀察</a><MemberNavigation/>
 {denied?<PublicExperience market={publicMarket} loading={marketLoading}/>:!account&&matchingState&&dailyAi?.edition?<DailyAiMemberResearch key={access.kind==='member'?access.id:''} data={dailyAi} selectedHorizon={selectedHorizon} onHorizonChange={changeDailyHorizon}
  viewState={sameDailyScope(dailyView,visibleDailyScope)?dailyView!.view:emptyDailyView()} onViewChange={changeDailyView}/>:data?account?<main className="vnext-content"><h1>會員中心</h1><MemberObservationEntry/><p>既有會員權益與股票學院不變。</p><a href="/academy">前往股票學院</a></main>:data.tier==='owner'&&state?.completed?<CompletedResearch key={access.kind==='member'?access.id:''} data={state.completed} selectedHorizon={selectedHorizon} onHorizonChange={setSelectedHorizon}/>:<>{state?.dailyAiError&&<p className="vnext-content" role="alert">每日 AI 研究暫時無法讀取；下方顯示既有已核准內容。</p>}{data.tier==='owner'&&state?.completedError&&<p className="vnext-content" role="alert">本人收盤研究暫時無法讀取；下方是會員已核准內容，不代表本次分析沒有結果。</p>}<MemberExperience key={access.kind==='member'?access.id:''} data={data} market={publicMarket} onWatch={watch} busy={busy} notice={notice}/></>
 :<main className="vnext-content vnext-empty" role="status"><h1>{denied?'登入後，閱讀股票觀察':failed?'目前無法讀取股票觀察':'正在確認可閱讀的內容'}</h1><p>{denied?'免費會員可閱讀每日精選摘要；Premium 可查看完整已核准研究。研究不是正式推薦。':failed?'尚未取得資料，不代表今天沒有候選。請稍後再試。':'請稍候。'}</p>{denied?<a href="/login?next=%2Fstocks" className="vnext-primary">登入帳號</a>:failed?<button className="vnext-primary" onClick={()=>{invalidate();retry();setRevision(r=>r+1);}}>重新讀取</button>:null}</main>}
 </div>;
}
