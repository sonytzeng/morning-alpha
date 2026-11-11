import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {supabase} from '@/lib/supabase';
import type {AcademyAccess} from '@/pages/academy/useAcademyAccess';
import {memberTaipeiDate} from '@/features/vnext/member';
import {DailyAiMarketPageError,createDailyAiMarketPageRequestV2,parseDailyAiMarketPageV2,cacheDailyAiMarketPageV2,eligibleDailyAiMarketPageCacheV2,
 type DailyAiMarketPageCacheV2,type DailyAiMarketPageQuery,type DailyAiMarketCursorV2,type DailyAiMarketReadScopeV2} from '@/features/vnext/dailyAiMarketPageV2';
import MemberNavigation from './MemberNavigation';
import DailyAiMarketResearch from './DailyAiMarketResearch';
import './vnext.css';
import './member.css';

export type MarketFallbackNotice={kind:'MISSING'|'NOT_PUBLISHED'|'UNAVAILABLE'|'DISABLED';roster_count:number|null;checked_at:string|null;refreshing:boolean;onRefresh:()=>void};
type Result={scope:DailyAiMarketReadScopeV2;epoch:number;kind:'LOADING'|'READY'|'FALLBACK'|'DENIED';cache:DailyAiMarketPageCacheV2|null;fallback?:MarketFallbackNotice['kind']};
type Preference={key:string;query:DailyAiMarketPageQuery;cursor:DailyAiMarketCursorV2|null};
const RPC='get_daily_ai_member_market_page_v2';
const INITIAL:DailyAiMarketPageQuery=Object.freeze({horizon:'SHORT',market:'ALL',status:'ALL',search:'',sort:'STATUS_MARKET_SYMBOL_ASC',page_size:27});
const sameScope=(a:DailyAiMarketReadScopeV2,b:DailyAiMarketReadScopeV2)=>a.identity===b.identity&&a.generation===b.generation&&a.signal===b.signal&&a.tier===b.tier&&a.requestDate===b.requestDate;
class MarketReadFailure extends Error{
 readonly kind:'MISSING'|'SCOPE'|'STALE'|'UNAVAILABLE'|'DISABLED';
 constructor(kind:MarketReadFailure['kind']){super('MARKET_MEMBER_READ_'+kind);this.kind=kind;}
}
function responseError(value:unknown){
 if(!value)return;
 const r=value&&typeof value==='object'?value as Record<string,unknown>:{},code=typeof r.code==='string'?r.code:'',message=typeof r.message==='string'?r.message:'';
 if(code==='42501')throw new MarketReadFailure('SCOPE');
 if(code==='P0001'&&message==='AI_MARKET_PAGE_V2_DISABLED')throw new MarketReadFailure('DISABLED');
 if(['42883','PGRST202'].includes(code)&&message.includes(RPC))throw new MarketReadFailure('MISSING');
 if(code==='P0001'&&message==='AI_MARKET_PAGE_V2_CURSOR_STALE')throw new MarketReadFailure('STALE');
 throw new MarketReadFailure('UNAVAILABLE');
}
async function bounded<T>(signal:AbortSignal,work:(inner:AbortSignal)=>Promise<T>):Promise<T>{
 const inner=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 try{
  const canceled=new Promise<never>((_,reject)=>{abort=()=>{inner.abort();reject(new MarketReadFailure('UNAVAILABLE'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{inner.abort();reject(new MarketReadFailure('UNAVAILABLE'));},8000);});
  return await Promise.race([Promise.resolve().then(()=>{if(signal.aborted)throw new MarketReadFailure('UNAVAILABLE');return work(inner.signal);}),canceled,deadline]);
 }finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort);inner.abort();}
}

/** Same Auth grant as the existing member page. Only a missing/unpublished V2
 * mounts the V1 path; a readable V2 page never downloads a V1 whole edition. */
export default function DailyAiMarketMemberEntry({access,retry,fallback}:{access:AcademyAccess;retry:()=>void;fallback:(notice?:MarketFallbackNotice)=>ReactNode}){
 const [revision,setRevision]=useState(0),[day,setDay]=useState(memberTaipeiDate),[result,setResult]=useState<Result|null>(null),[loading,setLoading]=useState(false);
 const current=useRef(access);current.current=access;
 const rendered=useRef(result);rendered.current=result;
 const epoch=useRef(0),mounted=useRef(false),controller=useRef<AbortController|null>(null),cache=useRef<DailyAiMarketPageCacheV2|null>(null);
 const dayRef=useRef(day),retryRef=useRef(retry),retryAt=useRef<{identity:string;at:number}|null>(null);retryRef.current=retry;
 const preference=useRef<Preference>({key:'',query:INITIAL,cursor:null});
 const stopRead=useCallback(()=>{epoch.current++;controller.current?.abort();controller.current=null;cache.current=null;},[]);
 const clear=useCallback(()=>{stopRead();setResult(null);setLoading(false);},[stopRead]);
 const refresh=useCallback(()=>{
  if(!mounted.current||document.visibilityState==='hidden'||controller.current)return;
  const auth=current.current;if(auth.kind==='member'&&!auth.signal.aborted)setRevision(value=>value+1);
 },[]);
 useEffect(()=>{
  mounted.current=true;let midnight:ReturnType<typeof setTimeout>,poll:ReturnType<typeof setTimeout>|undefined,foreground:ReturnType<typeof setTimeout>|undefined;
  const checkDate=()=>{const next=memberTaipeiDate();if(next!==dayRef.current){dayRef.current=next;clear();setDay(next);}};
  const scheduleMidnight=()=>{clearTimeout(midnight);const date=memberTaipeiDate();if(date)midnight=setTimeout(()=>{checkDate();scheduleMidnight();},Math.max(1,Date.parse(date+'T00:00:00+08:00')+86400000-Date.now()));};
  const schedulePoll=()=>{clearTimeout(poll);poll=undefined;if(document.visibilityState!=='hidden')poll=setTimeout(()=>{checkDate();refresh();schedulePoll();},30000);};
  const foregroundRead=()=>{checkDate();scheduleMidnight();if(document.visibilityState==='hidden'||foreground!==undefined)return;foreground=setTimeout(()=>{foreground=undefined;refresh();},100);};
  const visibility=()=>{checkDate();scheduleMidnight();schedulePoll();if(document.visibilityState==='hidden'){clearTimeout(foreground);foreground=undefined;clear();}else foregroundRead();};
  scheduleMidnight();schedulePoll();window.addEventListener('focus',foregroundRead);document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;stopRead();clearTimeout(midnight);clearTimeout(poll);clearTimeout(foreground);window.removeEventListener('focus',foregroundRead);document.removeEventListener('visibilitychange',visibility);};
 },[clear,refresh,stopRead]);
 useEffect(()=>{
  if(access.kind!=='member'||access.signal.aborted||document.visibilityState==='hidden'||day!==memberTaipeiDate()){
   clear();if(access.kind==='denied')preference.current={key:'',query:INITIAL,cursor:null};return;
  }
  const scope:DailyAiMarketReadScopeV2={identity:access.id,generation:access.generation,signal:access.signal,tier:access.catalog.tier,requestDate:day};
  const key=JSON.stringify([scope.identity,scope.tier,scope.requestDate]);
  if(preference.current.key!==key)preference.current={key,query:INITIAL,cursor:null};
  const settings=structuredClone(preference.current),token=++epoch.current,read=new AbortController();controller.current=read;let live=true;
  const old=eligibleDailyAiMarketPageCacheV2(cache.current,scope,Date.now())?cache.current:null;
  const samePage=!!old&&JSON.stringify(old.request.query)===JSON.stringify(settings.query)&&old.request.cursor?.binding_hash===settings.cursor?.binding_hash;
  cache.current=samePage?old:null;setLoading(true);
  setResult(previous=>previous&&sameScope(previous.scope,scope)&&(samePage||previous.kind==='FALLBACK')?{...previous,scope,epoch:token}:{scope,epoch:token,kind:'LOADING',cache:null});
  const valid=()=>{const auth=current.current;return live&&mounted.current&&epoch.current===token&&!read.signal.aborted&&!access.signal.aborted
   &&document.visibilityState!=='hidden'&&dayRef.current===day&&memberTaipeiDate()===day&&auth.kind==='member'
   &&auth.id===scope.identity&&auth.generation===scope.generation&&auth.signal===scope.signal&&auth.catalog.tier===scope.tier;};
  const abort=()=>{if(epoch.current===token)clear();else read.abort();};access.signal.addEventListener('abort',abort,{once:true});
  void bounded(read.signal,async signal=>{
   let cursor=settings.cursor,knownCache=samePage?old:null;
   for(let attempt=0;attempt<2;attempt++){
    if(!valid()||signal.aborted)throw new MarketReadFailure('UNAVAILABLE');
    try{
     const request=await createDailyAiMarketPageRequestV2(scope,settings.query,{cursor,cache:knownCache,now:Date.now()});
     if(!valid()||signal.aborted)throw new MarketReadFailure('UNAVAILABLE');
     const response=await supabase.rpc(RPC,{p_request:request}).abortSignal(signal);
     if(!valid()||signal.aborted)throw new MarketReadFailure('UNAVAILABLE');responseError(response.error);
     const data=await parseDailyAiMarketPageV2(response.data,scope,request,knownCache,Date.now());
     if(!valid()||signal.aborted)throw new MarketReadFailure('UNAVAILABLE');
     return {cache:cacheDailyAiMarketPageV2(data,scope,request),cursor};
    }catch(error){
     const stale=error instanceof MarketReadFailure&&error.kind==='STALE'||error instanceof DailyAiMarketPageError&&error.code==='CURSOR_STALE';
     const miss=error instanceof DailyAiMarketPageError&&error.code==='CACHE_MISS';
     if(attempt===0&&(stale||miss)&&valid()&&!signal.aborted){cursor=stale?null:cursor;knownCache=null;cache.current=null;setResult({scope,epoch:token,kind:'LOADING',cache:null});continue;}
     throw error;
    }
   }
   throw new MarketReadFailure('UNAVAILABLE');
  }).then(value=>{
   if(!valid())return;cache.current=value.cache;preference.current={key,query:settings.query,cursor:value.cursor};
   setResult({scope,epoch:token,kind:value.cache.data.edition?'READY':'FALLBACK',cache:value.cache,...(!value.cache.data.edition?{fallback:'NOT_PUBLISHED' as const}:{})});
  }).catch(error=>{
   if(!valid())return;cache.current=null;
   const denied=error instanceof MarketReadFailure&&error.kind==='SCOPE'||error instanceof DailyAiMarketPageError&&error.code==='SCOPE';
   if(denied){
    setResult({scope,epoch:token,kind:'DENIED',cache:null});preference.current={key:'',query:INITIAL,cursor:null};
    const previous=retryAt.current,now=Date.now();if(!previous||previous.identity!==scope.identity||now-previous.at>=30000){retryAt.current={identity:scope.identity,at:now};retryRef.current();}
   }else setResult({scope,epoch:token,kind:'FALLBACK',cache:null,fallback:error instanceof MarketReadFailure&&error.kind==='MISSING'?'MISSING':error instanceof MarketReadFailure&&error.kind==='DISABLED'?'DISABLED':'UNAVAILABLE'});
  }).finally(()=>{if(valid())setLoading(false);if(controller.current===read)controller.current=null;});
  return()=>{live=false;read.abort();access.signal.removeEventListener('abort',abort);if(controller.current===read)controller.current=null;};
 },[access,day,revision,clear]);
 const scope:DailyAiMarketReadScopeV2|null=access.kind==='member'&&!access.signal.aborted?{identity:access.id,generation:access.generation,signal:access.signal,tier:access.catalog.tier,requestDate:day}:null;
 const bound=!!scope&&result&&sameScope(result.scope,scope)&&result.epoch===epoch.current&&memberTaipeiDate()===day&&document.visibilityState!=='hidden';
 const canChange=()=>!!bound&&mounted.current&&rendered.current===result&&!controller.current&&current.current.kind==='member'
  &&current.current.id===scope!.identity&&current.current.generation===scope!.generation&&current.current.signal===scope!.signal&&!scope!.signal.aborted
  &&memberTaipeiDate()===scope!.requestDate&&document.visibilityState!=='hidden';
 const query=(next:DailyAiMarketPageQuery)=>{if(!canChange())return;preference.current={...preference.current,query:next,cursor:null};refresh();};
 const next=()=>{if(!canChange()||!result?.cache?.data.page.next_cursor)return;preference.current={...preference.current,cursor:result.cache.data.page.next_cursor};refresh();};
 const first=()=>{if(!canChange())return;preference.current={...preference.current,cursor:null};refresh();};
 if(access.kind!=='member'||access.signal.aborted)return <>{fallback()}</>;
 if(bound&&result.kind==='FALLBACK'){
  const markets=result.cache?.data.universe.markets,roster_count=markets&&markets.every(m=>m.universe_count!==null)?markets.reduce((sum,m)=>sum+m.universe_count!,0):null;
  return <>{fallback({kind:result.fallback!,roster_count,checked_at:result.cache?.data.checked_at??null,refreshing:loading,onRefresh:refresh})}</>;
 }
 return <div className="vnext vm"><a className="vnext-skip" href="#stock-observations">跳到股票研究</a><MemberNavigation/>
  {access.catalog.tier==='owner'&&<nav className="vnext-content" aria-label="Owner 研究工作區"><a href="/stocks/market-review">全市場研究審查</a> · <a href="/stocks/review">個人股票檢討</a></nav>}
  {bound&&result.kind==='READY'&&result.cache&&scope?<DailyAiMarketResearch cache={result.cache} scope={scope} loading={loading} onQuery={query} onNext={next} onFirst={first} onRefresh={refresh}/>
   :<main className="vnext-content vnext-empty" id="stock-observations" role="status"><h1>{bound&&result.kind==='DENIED'?'會員權益需要重新核對':'正在核對可讀股票研究'}</h1><p>{bound&&result.kind==='DENIED'?'尚未確認這次讀取權限，原研究與價格已清除。':'核對完成後顯示這個帳號可閱讀的已發布研究。'}</p>{bound&&result.kind==='DENIED'&&<button type="button" className="vnext-primary" onClick={()=>{clear();retry();}}>重新核對會員權益</button>}</main>}
 </div>;
}
