// Actual hook execution with synthetic Auth/catalog promises and a fake clock.
// No Production account, browser, network, subscription or database operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseMemberCatalog} from '../src/features/academy/member.ts';

const file='src/pages/academy/useAcademyAccess.ts';
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{
 fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const catalog=(id='A',tier='premium')=>({version:'ACADEMY_MEMBER_V11',user_id:id,tier,
 chapters:[{id:'synthetic-free',title:'Synthetic chapter',tier:'free',allowed:true}],progress:[]});

function harness(options={}){
 let cursor=0,dirty=false,tree,unmounted=false,clock=0,nextTimer=0;
 const slots=[],effects=[],queued=[],timers=new Map(),users=[],catalogs=[],listeners=new Set();
 const hooks={
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;
   return [slots[i],value=>{assert(!unmounted,'No state update after hook unmount');const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((x,j)=>!Object.is(x,old.deps[j]))){
   effects[i]={fn,deps,cleanup:old?.cleanup};queued.push(()=>{old?.cleanup?.();effects[i].cleanup=fn();});}},
 };
 const supabase={auth:{
  getUser(){const call=deferred();users.push(call);return call.promise;},
  onAuthStateChange(callback){listeners.add(callback);return {data:{subscription:{unsubscribe(){listeners.delete(callback);}}}};},
 },rpc(name){assert.equal(name,'get_academy_catalog_v11');const call=deferred();catalogs.push(call);return {abortSignal(signal){call.signal=signal;return call.promise;}};}};
 const exports={};
 vm.runInNewContext(compiled,{exports,AbortController,
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,due:clock+ms});return id;},clearTimeout:id=>timers.delete(id),
  require(name){if(name==='react')return hooks;if(name==='@/lib/supabase')return {supabase};if(name==='@/features/academy/member')return {parseMemberCatalog};throw Error('Unexpected hook import:'+name);},
 },{filename:file});
 function render(){let count=0;do{assert(++count<30,'Bounded hook lifecycle');dirty=false;cursor=0;tree=exports.useAcademyAccess(options);while(queued.length)queued.shift()();}while(dirty);return tree;}
 function advance(ms){const target=clock+ms;for(;;){const next=[...timers].filter(([,x])=>x.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;
  clock=next[1].due;timers.delete(next[0]);next[1].fn();render();}clock=target;render();}
 render();advance(0);
 return {users,catalogs,get access(){return render().access;},
  event(event,id='A'){for(const callback of [...listeners])callback(event,id===null?null:{user:{id}});render();},
  advance,retry(){render().retry();render();advance(0);},
  async user(index=users.length-1,id='A',error=null){users[index].resolve({data:{user:id===null?null:{id}},error});await settle();render();},
  async catalog(index=catalogs.length-1,id='A',tier='premium',error=null){catalogs[index].resolve({data:catalog(id,tier),error});await settle();render();},
  unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();unmounted=true;},
  get timers(){return timers.size;},get listenerCount(){return listeners.size;},
 };
}
async function verified(options={}){const h=harness(options);await h.user();await h.catalog();assert.equal(h.access.kind,'member');return h;}

test('only the stocks opt-in coalesces an already verified same-user SIGNED_IN',async()=>{
 const h=await verified({ignoreRepeatedSignIn:true}),before=h.access;
 h.event('SIGNED_IN');h.event('SIGNED_IN');h.advance(0);
 assert.equal(h.access,before);assert.equal(before.signal.aborted,false);assert.equal(h.users.length,1);assert.equal(h.catalogs.length,1);
 h.unmount();assert.equal(h.timers,0);assert.equal(h.listenerCount,0);
});
test('default Academy behavior keeps same-user SIGNED_IN as a hard revalidation',async()=>{
 const h=await verified(),before=h.access;h.event('SIGNED_IN');
 assert(before.signal.aborted);assert.equal(h.access.kind,'loading');assert.equal(h.users.length,1,'Auth callback must not call SDK synchronously');
 h.advance(0);assert.equal(h.users.length,2);await h.user();await h.catalog();assert.equal(h.access.kind,'member');assert(h.access.generation>before.generation);h.unmount();
});
test('opt-in cannot coalesce a different identity or any real Auth state event',async()=>{
 for(const event of ['TOKEN_REFRESHED','USER_UPDATED','PASSWORD_RECOVERY','SIGNED_OUT','SIGNED_IN']){
  const h=await verified({ignoreRepeatedSignIn:true}),before=h.access;h.event(event,event==='SIGNED_IN'?'B':'A');
  assert(before.signal.aborted,event);assert.equal(h.access.kind,event==='SIGNED_OUT'?'denied':'loading',event);
  assert.equal(h.users.length,1,'SDK work stays outside Auth callback');h.advance(0);
  assert.equal(h.users.length,event==='SIGNED_OUT'?1:2,event);h.unmount();assert.equal(h.listenerCount,0);
 }
});
test('same-user SIGNED_IN before catalog verification never receives the opt-in exemption',async()=>{
 const h=harness({ignoreRepeatedSignIn:true});await h.user();const old=h.catalogs[0];assert.equal(h.access.kind,'loading');
 h.event('SIGNED_IN');assert(old.signal.aborted);h.advance(0);assert.equal(h.users.length,2);
 await h.catalog(0);assert.equal(h.access.kind,'loading');await h.user();await h.catalog();assert.equal(h.access.kind,'member');h.unmount();
});
test('retry clears the verified identity and old catalog cannot restore an obsolete user',async()=>{
 const h=await verified({ignoreRepeatedSignIn:true}),before=h.access;h.retry();assert(before.signal.aborted);assert.equal(h.access.kind,'loading');
 await h.user(1);const old=h.catalogs[1];h.event('SIGNED_IN','B');h.advance(0);assert(old.signal.aborted);
 await h.catalog(1);assert.equal(h.access.kind,'loading');await h.user(2,'B');await h.catalog(2,'B');assert.equal(h.access.id,'B');
 h.event('SIGNED_OUT');assert.equal(h.access.kind,'denied');h.unmount();assert.equal(h.timers,0);
});
test('a denied or timed-out access check cannot leave a verified-user exemption behind',async()=>{
 for(const failure of ['denied','timeout']){
  const h=await verified({ignoreRepeatedSignIn:true});h.retry();
  if(failure==='denied'){await h.user();await h.catalog(h.catalogs.length-1,'A','premium',{code:'42501'});assert.equal(h.access.kind,'denied');}
  else{h.advance(20000);assert.equal(h.access.kind,'unavailable');}
  const calls=h.users.length;h.event('SIGNED_IN');assert.equal(h.access.kind,'loading');h.advance(0);assert.equal(h.users.length,calls+1);h.unmount();
 }
});
test('unmount fences pending user/catalog responses and removes Auth listener',async()=>{
 const h=harness({ignoreRepeatedSignIn:true}),pending=h.users[0];h.unmount();pending.resolve({data:{user:{id:'A'}},error:null});await settle();
 assert.equal(h.catalogs.length,0);assert.equal(h.listenerCount,0);assert.equal(h.timers,0);
 const afterUser=harness({ignoreRepeatedSignIn:true});await afterUser.user();const late=afterUser.catalogs[0];afterUser.unmount();
 late.resolve({data:catalog(),error:null});await settle();assert(late.signal.aborted);assert.equal(afterUser.listenerCount,0);assert.equal(afterUser.timers,0);
});
