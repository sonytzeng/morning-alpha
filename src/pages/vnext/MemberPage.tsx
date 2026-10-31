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
import {DailyAiMemberDeltaError,dailyAiMemberKnownArgs,eligibleDailyAiMemberCache,parseDailyAiMemberDelta,type DailyAiMemberCache,type DailyAiMemberReadScope} from '@/features/vnext/dailyAiMemberDelta';
import DailyAiMemberResearch,{type DailyAiMemberViewState} from './DailyAiMemberResearch';
import type {Horizon} from '@/features/vnext/contracts';
import './vnext.css';
import './member.css';
type DailyViewScope={identity:string;tier:DailyAiData['tier'];editionId:string;requestDate:string};
type DailyViewMemory=DailyViewScope&{view:DailyAiMemberViewState};
const emptyDailyView=():DailyAiMemberViewState=>({filter:'ALL',query:'',limit:9});
const sameDailyScope=(a:DailyViewScope|null,b:DailyViewScope|null)=>!!a&&!!b&&a.identity===b.identity&&a.tier===b.tier&&a.editionId===b.editionId&&a.requestDate===b.requestDate;
export default function MemberPage({account=false}:{account?:boolean}){
 const {access,retry}=useAcademyAccess({ignoreRepeatedSignIn:true}),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [selectedHorizon,setSelectedHorizon]=useState<Horizon>('SHORT');
 // UI preferences only: never keep cards, source data or an entitlement here.
 const [dailyView,setDailyView]=useState<DailyViewMemory|null>(null),dailyScope=useRef<DailyViewScope|null>(null);
 const memberViewScope=useRef<{identity:string;tier:DailyAiData['tier'];requestDate:string}|null>(null);
 const [state,setState]=useState<{identity:string;generation:number;readEpoch:number;requestDate:string;data?:MemberResearch;completed?:CompletedData|null;completedError?:boolean;dailyAi?:DailyAiData;dailyAiError?:boolean;error?:boolean}|null>(null);
 const renderedState=useRef(state);renderedState.current=state;
 const current=useRef(access);current.current=access;
 const retryRef=useRef(retry);retryRef.current=retry;
 const mounted=useRef(false),readEpoch=useRef(0),publicEpoch=useRef(0);
 const readController=useRef<AbortController|null>(null),watchController=useRef<AbortController|null>(null);
 const aiReadController=useRef<AbortController|null>(null);
 const activeRead=useRef<AbortController|null>(null);
 const aiCache=useRef<DailyAiMemberCache|null>(null);
 const accessRetry=useRef<{identity:string;requestDate:string;at:number}|null>(null);
 const [businessDate,setBusinessDate]=useState(memberTaipeiDate),dateRef=useRef(businessDate);
 const [publicState,setPublicState]=useState<{requestDate:string;market:ReturnType<typeof memberMarketSummary>;loading:boolean}|null>(null);
 const clearDailyView=useCallback(()=>{dailyScope.current=null;setDailyView(null);setSelectedHorizon('SHORT');},[]);
 // Invalidation is synchronous: an older closure cannot revive data while the
 // entitlement hook is still waiting to render its next generation.
 const invalidate=useCallback(()=>{
  readEpoch.current++;readController.current?.abort();aiReadController.current?.abort();watchController.current?.abort();watchController.current=null;activeRead.current=null;aiCache.current=null;
  setState(null);setNotice('');setBusy(false);
 },[]);
 const requestRead=useCallback(()=>{
  if(!mounted.current||document.visibilityState==='hidden'||activeRead.current)return;
  const now=current.current;
  if(now.kind==='member'&&!now.signal.aborted)setRevision(value=>value+1);
  else if(now.kind==='unavailable')retryRef.current();
 },[]);
 useEffect(()=>{
  mounted.current=true;let midnight:ReturnType<typeof setTimeout>,poll:ReturnType<typeof setTimeout>|undefined,foreground:ReturnType<typeof setTimeout>|undefined;
  const checkDate=()=>{
   const next=memberTaipeiDate();
   if(next!==dateRef.current){dateRef.current=next;publicEpoch.current++;invalidate();clearDailyView();setPublicState(null);setBusinessDate(next);}
  };
  const scheduleMidnight=()=>{
   clearTimeout(midnight);const now=Date.now(),date=memberTaipeiDate(now);
   if(!date)return;
   const delay=Date.parse(`${date}T00:00:00+08:00`)+86400000-now;
   midnight=setTimeout(()=>{checkDate();scheduleMidnight();},Math.max(1,delay));
  };
  // Every visible read rechecks server entitlement. Hide clears immediately;
  // an ordinary same-scope recheck keeps its already verified edition mounted.
  const schedulePoll=()=>{
   clearTimeout(poll);poll=undefined;
   if(document.visibilityState!=='hidden')poll=setTimeout(()=>{checkDate();requestRead();schedulePoll();},30000);
  };
  const refresh=()=>{
   checkDate();scheduleMidnight();
   if(document.visibilityState==='hidden'||foreground!==undefined)return;
   foreground=setTimeout(()=>{foreground=undefined;requestRead();},100);
  };
  const visibility=()=>{
   checkDate();scheduleMidnight();schedulePoll();
   if(document.visibilityState==='hidden'){clearTimeout(foreground);foreground=undefined;invalidate();}
   else refresh();
  };
  checkDate();scheduleMidnight();schedulePoll();
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;invalidate();clearTimeout(midnight);clearTimeout(poll);clearTimeout(foreground);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visibility);};
 },[invalidate,clearDailyView,requestRead]);
 useEffect(()=>{
  const scope=dailyScope.current;
  if(account||access.kind==='denied'){memberViewScope.current=null;clearDailyView();}
  else if(access.kind==='member'){
   const previous=memberViewScope.current,next={identity:access.id,tier:access.catalog.tier,requestDate:businessDate};
   if(previous&&(previous.identity!==next.identity||previous.tier!==next.tier||previous.requestDate!==next.requestDate))clearDailyView();
   memberViewScope.current=next;
  }
  if(scope&&(scope.requestDate!==businessDate
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
  const requestDate=memberTaipeiDate();
  if(access.kind!=='member'||access.signal.aborted||!requestDate||requestDate!==dateRef.current||document.visibilityState==='hidden'){invalidate();return;}
  const epoch=++readEpoch.current,controller=new AbortController();readController.current=controller;activeRead.current=controller;let live=true;
  watchController.current?.abort();watchController.current=null;setBusy(false);setNotice('');
  const bind={identity:access.id,generation:access.generation,readEpoch:epoch,requestDate};
  const aiScope:DailyAiMemberReadScope={identity:access.id,generation:access.generation,signal:access.signal,tier:access.catalog.tier,requestDate};
  const cachedForRead=eligibleDailyAiMemberCache(aiCache.current,aiScope)?aiCache.current:null;aiCache.current=cachedForRead;
  // Only the same still-verified Auth generation and Taipei day may retain RAM
  // data while the server rechecks. All old continuations keep their old epoch.
  setState(previous=>previous?.identity===access.id&&previous.generation===access.generation&&previous.requestDate===requestDate
   ?{...previous,...bind,...(!cachedForRead?{dailyAi:undefined}:{})}:null);
  const abort=()=>{if(epoch===readEpoch.current)invalidate();else controller.abort();};
  access.signal.addEventListener('abort',abort);
  const valid=()=>{const now=current.current;return live&&mounted.current&&epoch===readEpoch.current&&!controller.signal.aborted&&!access.signal.aborted
   &&now.kind==='member'&&now.id===access.id&&now.generation===access.generation&&now.signal===access.signal&&now.catalog.tier===access.catalog.tier
   &&dateRef.current===requestDate&&memberTaipeiDate()===requestDate;};
  const entitlementChanged=()=>{if(valid()){
   invalidate();clearDailyView();setState({...bind,readEpoch:readEpoch.current,error:true});
   // A persistent mismatch between two server projections must not create a
   // tight Auth retry loop. Data always clears immediately; visible checks and
   // manual retry remain available at their existing cadence.
   const previous=accessRetry.current,at=Date.now();
   if(!previous||previous.identity!==access.id||previous.requestDate!==requestDate||at-previous.at>=30000){
    accessRetry.current={identity:access.id,requestDate,at};retryRef.current();
   }
  }};
  let legacyTimer:ReturnType<typeof setTimeout>|undefined;
  const legacy=async()=>{
   const deadline=new Promise<void>(resolve=>{legacyTimer=setTimeout(()=>{
    if(valid())setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,data:undefined,completed:null,error:true}));
    controller.abort();resolve();
   },20000);});
   const read=async()=>{try{
   // Research access is checked independently by its RPC. No browser tier is sent.
   if(!valid())return;
   const response=await supabase.rpc('get_vnext_member_v1').abortSignal(controller.signal);
   if(!valid())return;if(response.error){if(response.error.code==='42501'){entitlementChanged();return;}throw Error('MEMBER_READ');}
   let data=parseMemberResearch(response.data,requestDate);
   if(data.tier!==access.catalog.tier){entitlementChanged();return;}
   if(data.tier==='free'){
    const history=await supabase.rpc('get_vnext_free_history_v1').abortSignal(controller.signal);
    if(!valid())return;
    if(history.error?.code==='42501'){entitlementChanged();return;}
    if(history.error||history.data?.schema!=='VNEXT_FREE_HISTORY_V1')throw Error('HISTORY_UNAVAILABLE');
    data=parseMemberResearch({...response.data,history:history.data.history},requestDate);
   }
   let completed:CompletedData|null=null,completedError=false;
   if(data.tier==='owner'&&!account){
    try{const r=await supabase.rpc('get_owner_completed_research_v1').abortSignal(controller.signal);
     if(!valid())return;if(r.error){if(r.error.code==='42501'){entitlementChanged();return;}throw Error('COMPLETED_READ');}completed=await parseCompletedResearch(r.data);
    }catch{completedError=true;}
   }
   if(valid())setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,data,completed,completedError,error:false}));
   }catch{if(valid())setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,data:undefined,completed:null,error:true}));}};
   try{await Promise.race([read(),deadline]);}finally{clearTimeout(legacyTimer);}
  };
  const aiController=new AbortController();aiReadController.current=aiController;
  const aiValid=()=>valid()&&!aiController.signal.aborted;
  const abortAi=()=>aiController.abort();controller.signal.addEventListener('abort',abortAi);
  let aiTimer:ReturnType<typeof setTimeout>|undefined;
  const projection=async()=>{
   const read=async(cache:DailyAiMemberCache|null)=>{
    const result=await supabase.rpc('get_daily_ai_member_research_delta_v1',dailyAiMemberKnownArgs(cache,aiScope)).abortSignal(aiController.signal);
    if(!aiValid())throw Error('DAILY_AI_OBSOLETE');
    if(result.error){
     const missing=['42883','PGRST202'].includes(result.error.code)&&result.error.message.includes('get_daily_ai_member_research_delta_v1');
     if(!missing)throw result.error;
     // During a staggered deployment or rollback only a missing new RPC may
     // use the original reader. It still enforces every current server gate.
     const original=await supabase.rpc('get_daily_ai_member_research_v1').abortSignal(aiController.signal);
     if(!aiValid())throw Error('DAILY_AI_OBSOLETE');if(original.error)throw original.error;
     const data=parseDailyAiMember(original.data,requestDate);
     if(data.tier!==access.catalog.tier)throw new DailyAiMemberDeltaError('SCOPE');
     return data;
    }
    return parseDailyAiMemberDelta(result.data,aiScope,cache);
   };
   try{return await read(cachedForRead);}catch(error){
    if(!(error instanceof DailyAiMemberDeltaError)||error.code!=='CACHE_MISS'||!aiValid())throw error;
    // A stale/malformed UNCHANGED response can never keep cards alive. Ask for
    // a full server projection once; another miss fails into bounded fallback.
    aiCache.current=null;
    setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,data:undefined,completed:null,dailyAi:undefined}));
    return read(null);
   }
  };
  void(async()=>{try{
   if(account){await legacy();return;}
   // AI is authoritative for its own publication. Fetch the heavier legacy
   // history/Owner snapshot only when this read has no usable AI edition.
   const deadline=new Promise<never>((_,reject)=>{aiTimer=setTimeout(()=>{aiController.abort();reject(Error('DAILY_AI_DEADLINE'));},8000);});
   const dailyAi=await Promise.race([projection(),deadline]);
   clearTimeout(aiTimer);
   if(!valid())return;
   aiCache.current=dailyAi.edition?{scope:aiScope,data:dailyAi}:null;
   if(valid()){
    if(!dailyAi.edition){if(dailyScope.current)clearDailyView();else setDailyView(null);}
    else{
     const scope:DailyViewScope={identity:access.id,tier:dailyAi.tier,editionId:dailyAi.edition.id,requestDate};
     if(!sameDailyScope(dailyScope.current,scope)){dailyScope.current=scope;setDailyView({...scope,view:emptyDailyView()});setSelectedHorizon('SHORT');}
    }
    setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,data:undefined,completed:null,completedError:false,dailyAi,dailyAiError:false,error:false}));
   }
   if(!dailyAi.edition&&valid())await legacy();
  }catch(error){
   if(valid()){
    if(error instanceof DailyAiMemberDeltaError&&error.code==='SCOPE'||error&&typeof error==='object'&&'code' in error&&error.code==='42501'){entitlementChanged();return;}
    aiCache.current=null;
    setState(s=>({...(s?.readEpoch===epoch?s:{}),...bind,data:undefined,completed:null,completedError:false,dailyAi:undefined,dailyAiError:true}));
    await legacy();
   }
  }finally{
   clearTimeout(aiTimer);clearTimeout(legacyTimer);aiController.abort();controller.signal.removeEventListener('abort',abortAi);
   if(activeRead.current===controller)activeRead.current=null;
   if(readController.current===controller)readController.current=null;
   if(aiReadController.current===aiController)aiReadController.current=null;
  }})();
  return()=>{live=false;clearTimeout(aiTimer);clearTimeout(legacyTimer);controller.abort();aiController.abort();if(activeRead.current===controller)activeRead.current=null;if(readController.current===controller)readController.current=null;access.signal.removeEventListener('abort',abort);};
 },[access,revision,businessDate,invalidate,account,clearDailyView]);
 const today=memberTaipeiDate();
 const matchingState=access.kind==='member'&&!access.signal.aborted&&state?.identity===access.id&&state.generation===access.generation
  &&state.readEpoch===readEpoch.current&&state.requestDate===today&&today===dateRef.current;
 const data=matchingState?state.data:null;
 const dailyAi=matchingState?state?.dailyAi:undefined;
 const visibleDailyScope:DailyViewScope|null=access.kind==='member'&&dailyAi?.edition?
  {identity:access.id,tier:dailyAi.tier,editionId:dailyAi.edition.id,requestDate:state!.requestDate}:null;
 const canChangeDailyView=()=>!!visibleDailyScope&&access.kind==='member'&&current.current.kind==='member'&&mounted.current
  &&state===renderedState.current
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
 const changeLegacyHorizon=(next:Horizon)=>{
  const now=current.current;
  if(data&&state===renderedState.current&&access.kind==='member'&&now.kind==='member'&&mounted.current&&!access.signal.aborted
   &&now.id===access.id&&now.generation===access.generation&&now.signal===access.signal
   &&state?.identity===access.id&&state.generation===access.generation&&state.readEpoch===readEpoch.current
   &&state.requestDate===dateRef.current&&memberTaipeiDate()===state.requestDate&&document.visibilityState!=='hidden')setSelectedHorizon(next);
 };
 const publicMarket=publicState?.requestDate===today?publicState.market:null,marketLoading=!!today&&(!publicState||publicState.requestDate!==today||publicState.loading);
 const watch=async(id:string,watching:boolean)=>{
  if(!data||state!==renderedState.current||busy||watchController.current||access.kind!=='member'||access.signal.aborted)return;
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
  viewState={sameDailyScope(dailyView,visibleDailyScope)?dailyView!.view:emptyDailyView()} onViewChange={changeDailyView}/>:data?account?<main className="vnext-content"><h1>會員中心</h1><MemberObservationEntry/><p>既有會員權益與股票學院不變。</p><a href="/academy">前往股票學院</a></main>:data.tier==='owner'&&state?.completed?<CompletedResearch key={access.kind==='member'?access.id:''} data={state.completed} selectedHorizon={selectedHorizon} onHorizonChange={changeLegacyHorizon}/>:<>{state?.dailyAiError&&<p className="vnext-content" role="alert">每日 AI 研究暫時無法讀取；下方顯示既有已核准內容。</p>}{data.tier==='owner'&&state?.completedError&&<p className="vnext-content" role="alert">本人收盤研究暫時無法讀取；下方是會員已核准內容，不代表本次分析沒有結果。</p>}<MemberExperience key={access.kind==='member'?access.id:''} data={data} market={publicMarket} onWatch={watch} busy={busy} notice={notice}/></>
 :<main className="vnext-content vnext-empty" role="status"><h1>{denied?'登入後，閱讀股票觀察':failed?'目前無法讀取股票觀察':'正在確認可閱讀的內容'}</h1><p>{denied?'免費會員可閱讀每日精選摘要；Premium 可查看完整已核准研究。研究不是正式推薦。':failed?'尚未取得資料，不代表今天沒有候選。請稍後再試。':'請稍候。'}</p>{denied?<a href="/login?next=%2Fstocks" className="vnext-primary">登入帳號</a>:failed?<button className="vnext-primary" onClick={()=>{invalidate();retry();setRevision(r=>r+1);}}>重新讀取</button>:null}</main>}
 </div>;
}
