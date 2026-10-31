// Isolated lifecycle controls; not real Production identities or Auth E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
const source=readFileSync(new URL('../src/hooks/useAccountDashboard.ts',import.meta.url),'utf8');
const initial=isolatedFunction(source,'initialAccountDashboard',{exports:{}});
function runtime(){
 let state,callback,cleanup,visibleCallback,date='2026-10-16';const pending=[],microtasks=[],timers=new Map();let unsubscribed=false,timerId=0;
 const use=isolatedFunction(source,'useAccountDashboard',{
  exports:{},initialAccountDashboard:initial,
  invalidateReportRequestCache:()=>{},
  useState:init=>{state=init();return [state,value=>{state=value;}];},
  useRef:value=>({current:value}),useCallback:fn=>fn,
  useEffect:fn=>{cleanup=fn();},
  queueMicrotask:fn=>microtasks.push(fn),
  isTaipeiToday:()=>date,
  document:{visibilityState:'visible',addEventListener:(name,fn)=>{assert.equal(name,'visibilitychange');visibleCallback=fn;},removeEventListener:(name,fn)=>{assert.equal(name,'visibilitychange');assert.equal(fn,visibleCallback);visibleCallback=null;}},
  setTimeout:(fn,ms)=>{assert(ms>=1000&&ms<=86400000);timers.set(++timerId,fn);return timerId;},
  clearTimeout:id=>timers.delete(id),
  supabase:{auth:{onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};}}},
  loadAccountDashboard:()=>new Promise(resolve=>pending.push(resolve)),
 });
 const api=use();
 return {api,pending,get state(){return state;},event:event=>callback(event),flush:()=>{while(microtasks.length)microtasks.shift()();},
  changeDate:value=>{date=value;},midnight:()=>{const [id,fn]=[...timers][0];timers.delete(id);fn();},visible:()=>visibleCallback(),
  cleanup:()=>cleanup(),get timerCount(){return timers.size;},get unsubscribed(){return unsubscribed;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('logout clears the whole dashboard immediately and a late private response cannot restore it',async()=>{
 const r=runtime();r.event('SIGNED_OUT');
 assert.equal(r.state.todayReport,null);assert.equal(r.state.recent30.length,0);
 assert.equal(r.pending.length,1); // no SDK read inside Auth callback
 r.flush();assert.equal(r.pending.length,2);
 r.pending[0]({todayReport:{private:'A'},recent30:[{private:'A'}]});await settle();
 assert.equal(r.state.todayReport,null);
 r.pending[1]({todayReport:{public:true},recent30:[]});await settle();
 assert.equal(r.state.todayReport.public,true);r.cleanup();assert.equal(r.unsubscribed,true);
});
test('account switch and token refresh each fence prior responses without reading client tier or tokens',async()=>{
 const r=runtime();r.pending[0]({todayReport:{private:'A'},recent30:[]});await settle();
 assert.equal(r.state.todayReport.private,'A');
 r.event('SIGNED_IN');assert.equal(r.state.todayReport,null);r.flush();
 r.event('TOKEN_REFRESHED');r.flush();
 r.pending[1]({todayReport:{private:'old identity'},recent30:[]});await settle();
 assert.equal(r.state.todayReport,null);
 r.pending[2]({todayReport:{private:'new server response'},recent30:[]});await settle();
 assert.equal(r.state.todayReport.private,'new server response');r.cleanup();
});
test('unmount invalidates in-flight work and scheduled auth reload; no state survives',async()=>{
 const r=runtime();r.event('USER_UPDATED');r.cleanup();r.flush();
 assert.equal(r.pending.length,1);
 r.pending[0]({todayReport:{private:'late'}});await settle();
 assert.equal(r.state.todayReport,null);assert.equal(r.unsubscribed,true);
});
test('initial session event does not multiply requests and refresh remains fenced',async()=>{
 const r=runtime();r.event('INITIAL_SESSION');r.flush();assert.equal(r.pending.length,1);
 const refreshed=r.api.refresh();assert.equal(r.pending.length,2);
 r.pending[1]({todayReport:{id:'new'}});await refreshed;
 r.pending[0]({todayReport:{id:'old'}});await settle();assert.equal(r.state.todayReport.id,'new');r.cleanup();
});
test('Taipei midnight clears yesterday flags, refreshes once and rejects a cross-midnight pending response',async()=>{
 const r=runtime();r.pending[0]({todayReport:{id:'yesterday'},isMarketDataToday:true});await settle();
 const pending=r.api.refresh();r.changeDate('2026-10-17');
 r.pending[1]({todayReport:{id:'late yesterday'},isMarketDataToday:true});await pending;
 assert.notEqual(r.state.todayReport?.id,'late yesterday');
 r.midnight();assert.equal(r.state.todayReport,null);assert.equal(r.state.isMarketDataToday,false);
 assert.equal(r.pending.length,3);assert.equal(r.timerCount,1);
 r.pending[2]({todayReport:{id:'historical reference'},isMarketDataToday:false});await settle();
 assert.equal(r.state.isMarketDataToday,false);r.cleanup();assert.equal(r.timerCount,0);
});
test('returning from background checks date without polling/reloading the same day',async()=>{
 const r=runtime();r.visible();assert.equal(r.pending.length,1);
 r.changeDate('2026-10-17');r.visible();assert.equal(r.pending.length,2);
 assert.equal(r.state.todayReport,null);r.visible();assert.equal(r.pending.length,2);
 r.cleanup();assert.equal(r.timerCount,0);
});
