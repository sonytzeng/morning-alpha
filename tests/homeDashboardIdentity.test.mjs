// Actual hook with synthetic deferred reads; no Production Auth or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
const source=readFileSync(new URL('../src/hooks/useHomeDashboard.ts',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function runtime(){
 const state=[],dashboard=[],morning=[],queued=[],timers=new Map(),listeners=new Set();
 let cursor=0,effect,cleanup,authCallback,invalidations=0,unsubscribed=0,nextTimer=0,removeHold=null;
 const channels=[],removed=[];
 const supabase={
  auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:callback=>{authCallback=callback;return {data:{subscription:{unsubscribe(){unsubscribed++;}}}};}},
  realtime:{setAuth:async()=>{}},
  channel(){const channel={on(){return this;},subscribe(){return this;}};channels.push(channel);return channel;},
  removeChannel:async channel=>{removed.push(channel);if(removeHold)await removeHold.promise;return 'ok';},
 };
 const use=isolatedFunction(source,'useHomeDashboard',{
  exports:{},supabase,
  invalidateReportRequestCache:()=>{invalidations++;},
  loadHomeDashboardData:()=>{const request=deferred();dashboard.push(request);return request.promise;},
  resolveMorningAlphaState:()=>{const request=deferred();morning.push(request);return request.promise;},
  useState:init=>{const index=cursor++;state[index]=typeof init==='function'?init():init;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},
  useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>{effect=fn;cleanup=fn();},
  getAdaptiveDashboardPollMs:()=>300000,queueMicrotask:fn=>queued.push(fn),
  setTimeout:(fn,ms)=>{assert.equal(ms,300000);timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),
  document:{visibilityState:'visible',addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)},
  window:{addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)},console:{warn(){}},
 });
 const api=use();
 return {api,state,dashboard,morning,channels,removed,timers,listeners,
  event:event=>authCallback(event),flush:()=>{while(queued.length)queued.shift()();},
  cleanup:()=>cleanup(),remount:()=>{cleanup=effect();},
  holdRemoval:()=>{removeHold=deferred();return removeHold;},
  get invalidations(){return invalidations;},get unsubscribed(){return unsubscribed;},
 };
}

test('Home logout synchronously clears both report models and defers new reads outside Auth',async()=>{
 const r=runtime();r.dashboard[0].resolve({report:{private:'A'},error:null});r.morning[0].resolve({private:'A'});await settle();
 assert.equal(r.state[0].report.private,'A');assert.equal(r.state[5].private,'A');
 r.event('SIGNED_OUT');
 assert.equal(r.state[0],null);assert.equal(r.state[5],null);assert.equal(r.state[3],null);
 assert.equal(r.state[1],true);assert.equal(r.state[6],true);assert.equal(r.invalidations,1);
 assert.equal(r.dashboard.length,1);assert.equal(r.morning.length,1);
 r.flush();assert.equal(r.dashboard.length,2);assert.equal(r.morning.length,2);
 r.dashboard[1].resolve({report:{public:true},error:null});r.morning[1].resolve({public:true});await settle();
 assert.equal(r.state[0].report.public,true);assert.equal(r.state[5].public,true);
 r.cleanup();assert.equal(r.timers.size,0);assert.equal(r.listeners.size,0);assert.equal(r.unsubscribed,1);
});

test('Home late account response or rejection cannot restore either report after an identity change',async()=>{
 const r=runtime();r.event('SIGNED_IN');r.flush();
 r.dashboard[1].resolve({report:{private:'B'},error:null});r.morning[1].resolve({private:'B'});await settle();
 r.dashboard[0].resolve({report:{private:'A'},error:'OLD_ERROR'});r.morning[0].reject(Error('OLD_ERROR'));await settle();
 assert.equal(r.state[0].report.private,'B');assert.equal(r.state[5].private,'B');assert.equal(r.state[2],null);
 assert.equal(r.state[1],false);assert.equal(r.state[6],false);r.cleanup();
});

test('same-user token refresh fences old work and does not let its finally unlock a new fetch',async()=>{
 const r=runtime();r.event('TOKEN_REFRESHED');r.flush();
 r.dashboard[0].resolve({report:{old:true},error:null});r.morning[0].resolve({old:true});await settle();
 assert.equal(r.state[0],null);assert.equal(r.state[5],null);assert.equal(r.state[1],true);assert.equal(r.state[4],true);
 await r.api.refresh();assert.equal(r.dashboard.length,2,'New-generation in-flight request remains deduplicated');
 assert.equal(r.morning.length,3);
 r.dashboard[1].resolve({report:{fresh:true},error:null});r.morning[1].resolve({superseded:true});r.morning[2].resolve({fresh:true});await settle();
 assert.equal(r.state[0].report.fresh,true);assert.equal(r.state[5].fresh,true);r.cleanup();
});

test('unmount and StrictMode cannot accept late reads or a queued Auth reload',async()=>{
 const r=runtime();r.event('USER_UPDATED');r.cleanup();r.flush();
 assert.equal(r.dashboard.length,1);assert.equal(r.morning.length,1);
 r.dashboard[0].resolve({report:{old:true},error:null});r.morning[0].resolve({old:true});await settle();
 assert.equal(r.state[0],null);assert.equal(r.state[5],null);
 r.remount();assert.equal(r.dashboard.length,2);assert.equal(r.morning.length,2);
 r.dashboard[1].resolve({report:{current:true},error:null});r.morning[1].resolve({current:true});await settle();
 assert.equal(r.state[0].report.current,true);assert.equal(r.state[5].current,true);r.cleanup();
});

test('initial session events do not multiply Home reads; superseded primary reads cannot overwrite newer ones',async()=>{
 const r=runtime();r.event('INITIAL_SESSION');r.flush();assert.equal(r.dashboard.length,1);assert.equal(r.morning.length,1);
 r.api.refresh();assert.equal(r.dashboard.length,1);assert.equal(r.morning.length,2);
 r.morning[1].resolve({latest:true});await settle();r.morning[0].resolve({old:true});await settle();
 assert.equal(r.state[5].latest,true);r.dashboard[0].resolve({report:null,error:null});await settle();r.cleanup();
});

test('rapid Auth events wait for the prior realtime removal before joining one replacement',async()=>{
 const r=runtime();await settle();assert.equal(r.channels.length,1);
 const removal=r.holdRemoval();r.event('SIGNED_OUT');r.event('SIGNED_IN');r.flush();await settle();
 assert.equal(r.removed.length,1);assert.equal(r.channels.length,1,'Old removal is shared across consecutive Auth events');
 removal.resolve();await settle();assert.equal(r.channels.length,2);
 assert.equal(r.dashboard.length,2);assert.equal(r.morning.length,2,'Superseded queued reads do not dispatch');
 r.cleanup();
});
