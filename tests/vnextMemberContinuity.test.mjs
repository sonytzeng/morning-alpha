// Execute the actual component with deterministic hooks and transport promises.
// Isolated lifecycle controls only: no browser, credentials, network or DB writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as member from '../src/features/vnext/member.ts';
import {buildPublicMarketReadModel} from '../src/lib/publicMarketReadModel.ts';
import {publicMarketInput} from '../supabase/functions/_shared/public-market-projection.ts';

const file='src/pages/vnext/MemberPage.tsx';
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const BEFORE=Date.parse('2026-10-18T15:59:59.990Z'),AFTER=BEFORE+20;
const TODAY='2026-10-18',TOMORROW='2026-10-19';
const research=(date=TODAY,tier='premium')=>({schema:'VNEXT_MEMBER_V1',research_only:true,tier,business_date:date,observations:[],history:[],watchlist:[]});
const access=(id='A',generation=1,tier='premium')=>({kind:'member',id,generation,signal:new AbortController().signal,catalog:{tier}});
const jsx=(type,props)=>({type,props});
const find=(node,type)=>Array.isArray(node)?node.flatMap(n=>find(n,type)):!node||typeof node!=='object'?[]:
 [...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const retained=JSON.parse(readFileSync(new URL('./fixtures/public-projection/production-20261002.json',import.meta.url)));
const model=buildPublicMarketReadModel(publicMarketInput(retained.public_response.payload,
 retained.tables.decision_snapshots.find(x=>x.session_type==='PREMARKET'),retained.tables.member_content_revisions[0],retained.tables.learning_runs[0],
 {batches:retained.tables.market_checkpoint_batches,proofs:retained.atomic_proofs.map(x=>x.proof)},'2026-10-02T12:30:00Z'));
const publicPayload={...retained.public_response,payload:{...retained.public_response.payload,public_market_read_model:model}};

function harness({now=BEFORE,initialAccess=access()}={}){
 let clock=now,currentAccess=initialAccess,cursor=0,tree,dirty=false,unmounted=false,timerId=0,retries=0;
 const slots=[],effects=[],queued=[],timers=new Map(),listeners=new Map(),rpc=[],publicCalls=[];
 const listen=(type,name,fn)=>{const key=type+':'+name;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);};
 const remove=(type,name,fn)=>listeners.get(type+':'+name)?.delete(fn);
 const hooks={
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((x,j)=>!Object.is(x,old.deps[j])))slots[i]={fn,deps};return slots[i].fn;},
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;
   return [slots[i],value=>{assert(!unmounted,'no state update after unmount');const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||!deps||deps.some((x,j)=>!Object.is(x,old.deps?.[j]))){
   effects[i]={fn,deps,cleanup:old?.cleanup};queued.push(()=>{old?.cleanup?.();effects[i].cleanup=fn();});}},
 };
 const deferred=(name,args)=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});
  return {name,args,promise,resolve:(data,error=null)=>resolve({data,error}),reject};};
 const transport={functions:{invoke(...args){const call=deferred(args[0],args[1]);publicCalls.push(call);return call.promise;}},
  rpc(name,args){const call=deferred(name,args);rpc.push(call);return {abortSignal(signal){call.signal=signal;return call.promise;}};}};
 const document={visibilityState:'visible',addEventListener:(n,f)=>listen('document',n,f),removeEventListener:(n,f)=>remove('document',n,f)};
 const retry=()=>{retries++;};
 const exports={};
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const schedule=(fn,ms,interval=false)=>{const id=++timerId;timers.set(id,{fn,due:clock+ms,ms,interval});return id;};
 vm.runInNewContext(compiled,{exports,Date:ClockDate,Intl,AbortController,
  setTimeout:(f,ms)=>schedule(f,ms),clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>schedule(f,ms,true),clearInterval:id=>timers.delete(id),
  window:{addEventListener:(n,f)=>listen('window',n,f),removeEventListener:(n,f)=>remove('window',n,f)},document,
  require(name){
   if(name==='react')return hooks;
   if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
   if(name==='@/lib/supabase')return {supabase:transport};
   if(name==='@/pages/academy/useAcademyAccess')return {useAcademyAccess:()=>({access:currentAccess,retry})};
   if(name==='@/features/vnext/member')return {...member,memberTaipeiDate:now=>member.memberTaipeiDate(now??clock)};
   if(name==='./MemberNavigation')return {default:'MemberNavigation',MemberObservationEntry:'MemberObservationEntry'};
   if(name==='./MemberExperience')return {default:'MemberExperience'};
   if(name==='./PublicExperience')return {default:'PublicExperience'};
   if(name.endsWith('.css'))return {};
   throw Error('UNAPPROVED_MEMBER_COMPONENT_IMPORT:'+name);
  }},{filename:file});
 function render(){let count=0;do{assert(++count<30,'bounded React lifecycle');dirty=false;cursor=0;tree=exports.default({});while(queued.length)queued.shift()();}while(dirty);return tree;}
 render();
 return {rpc,publicCalls,render,
  get member(){return find(render(),'MemberExperience')[0]?.props;},
  get public(){return find(render(),'PublicExperience')[0]?.props;},
  get retries(){return retries;},
  setAccess(value){currentAccess=value;render();},
  setClock(value){clock=value;},
  focus(){for(const f of [...listeners.get('window:focus')??[]])f();render();},
  visibility(value){document.visibilityState=value;for(const f of [...listeners.get('document:visibilitychange')??[]])f();render();},
  async resolve(call,data,error=null){call.resolve(data,error);await settle();render();},
  async reject(call){call.reject(Error('SYNTHETIC_TRANSPORT_FAILURE'));await settle();render();},
  strictEffectReplay(){for(const effect of effects.filter(Boolean))effect.cleanup?.();for(const effect of effects.filter(Boolean))effect.cleanup=effect.fn();render();},
  advance(ms){const target=clock+ms;for(;;){const next=[...timers].filter(([,x])=>x.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;
    clock=next[1].due;if(next[1].interval)next[1].due+=next[1].ms;else timers.delete(next[0]);next[1].fn();render();}clock=target;render();},
  unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();unmounted=true;},
  get timers(){return timers.size;},
 };
}

test('member Taipei date and optional payload binding reject impossible or different business dates',()=>{
 assert.equal(typeof member.memberTaipeiDate,'function');
 assert.equal(member.memberTaipeiDate(BEFORE),TODAY);assert.equal(member.memberTaipeiDate(AFTER),TOMORROW);
 assert.equal(member.parseMemberResearch(research(),TODAY).business_date,TODAY);
 assert.throws(()=>member.parseMemberResearch(research(),TOMORROW),/MEMBER.*DATE|MEMBER.*DAY/);
 assert.throws(()=>member.parseMemberResearch(research('2026-02-30'),TODAY));
});
test('current member read retains approved empty state and public request stays anonymous',async()=>{
 const h=harness();await h.resolve(h.rpc[0],research());assert.equal(h.member.data.business_date,TODAY);
 assert.equal(h.rpc[0].name,'get_vnext_member_v1');assert.equal(h.rpc[0].args,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(h.publicCalls[0].args)),{headers:{Authorization:''},body:{report_date:null}});h.unmount();
});
test('focus clear fences a pending private response before the Auth hook rerenders',async()=>{
 const h=harness(),old=h.rpc[0];h.focus();assert.equal(h.member,undefined);assert.equal(h.retries,1);
 await h.resolve(old,research());assert.equal(h.member,undefined);h.unmount();
});
test('hidden clear rejects a stale watch handler without dispatching another RPC',async()=>{
 const h=harness();await h.resolve(h.rpc[0],research());const watch=h.member.onWatch,count=h.rpc.length;
 h.visibility('hidden');const pending=watch('SYNTHETIC',true),dispatched=h.rpc.length;
 if(dispatched>count)await h.resolve(h.rpc.at(-1),{});await pending;
 assert.equal(dispatched,count);assert.equal(h.member,undefined);h.unmount();
});
test('same identity new generation cannot receive a late watch error from the old generation',async()=>{
 const h=harness();await h.resolve(h.rpc[0],research());const pending=h.member.onWatch('SYNTHETIC',true),old=h.rpc.at(-1);
 h.setAccess(access('A',2));await h.resolve(h.rpc.at(-1),research());assert.equal(h.member.notice,'');
 old.reject(Error('SYNTHETIC_OLD_GENERATION'));await pending;await settle();assert.equal(h.member.notice,'');assert.equal(h.member.busy,false);h.unmount();
});
test('a private response crossing Taipei midnight cannot restore yesterday even before its timer runs',async()=>{
 const h=harness(),old=h.rpc[0];h.setClock(AFTER);await h.resolve(old,research());assert.equal(h.member,undefined);h.unmount();
});
test('wrong-day member payload is unavailable instead of successful empty research',async()=>{
 const h=harness();await h.resolve(h.rpc[0],research('2026-10-17'));assert.equal(h.member,undefined);h.unmount();
});
test('free history completion crossing midnight cannot combine two business days',async()=>{
 const h=harness({initialAccess:access('F',1,'free')});await h.resolve(h.rpc[0],research(TODAY,'free'));
 assert.equal(h.rpc[1].name,'get_vnext_free_history_v1');h.setClock(AFTER);
 await h.resolve(h.rpc[1],{schema:'VNEXT_FREE_HISTORY_V1',history:[]});assert.equal(h.member,undefined);h.unmount();
});
test('Taipei midnight clears public summary and starts only one new-day public read',async()=>{
 const h=harness({initialAccess:{kind:'denied'}});await settle();await h.resolve(h.publicCalls[0],publicPayload);assert.equal(h.public.market.date,'2026-10-02');
 h.advance(20);await settle();assert.equal(h.public.market,null);assert.equal(h.publicCalls.length,2);
 h.visibility('visible');h.visibility('visible');assert.equal(h.publicCalls.length,2);h.unmount();
});
test('late public result across midnight is ignored and foreground refreshes the new date once',async()=>{
 const h=harness({initialAccess:{kind:'denied'}});await settle();const old=h.publicCalls[0];h.setClock(AFTER);await h.resolve(old,publicPayload);
 assert.equal(h.public.market,null);h.visibility('visible');await settle();assert.equal(h.publicCalls.length,2);h.unmount();
});
test('same-day focus and existing membership refresh do not add public polling',async()=>{
 const h=harness({now:Date.parse('2026-10-18T01:00:00Z'),initialAccess:{kind:'denied'}});
 await settle();await h.resolve(h.publicCalls[0],publicPayload);h.focus();h.visibility('visible');h.advance(30000);
 assert.equal(h.publicCalls.length,1);assert.equal(h.public.market.date,'2026-10-02');h.unmount();
});
test('current watch success remains optimistic and a second current watch remains usable',async()=>{
 const h=harness();await h.resolve(h.rpc[0],research());const first=h.member.onWatch('SYNTHETIC',true);
 await h.resolve(h.rpc.at(-1),{});await first;assert.deepEqual(Array.from(h.member.data.watchlist),['SYNTHETIC']);assert.equal(h.member.busy,false);
 const second=h.member.onWatch('SYNTHETIC',false);await h.resolve(h.rpc.at(-1),{});await second;
 assert.deepEqual(Array.from(h.member.data.watchlist),[]);assert.equal(h.member.notice,'已移出觀察清單');h.unmount();
});
test('deadline and unmount keep late private responses from setting state; timers are cleared',async()=>{
 const h=harness(),pending=h.rpc[0];h.advance(20000);await h.resolve(pending,research());assert.equal(h.member,undefined);h.unmount();assert.equal(h.timers,0);
 const unmounted=harness(),late=unmounted.rpc[0];unmounted.unmount();late.resolve(research());await settle();assert.equal(unmounted.timers,0);
});
test('StrictMode setup-cleanup-setup accepts only the second public and private continuations',async()=>{
 const h=harness();await settle();const oldPrivate=h.rpc[0],oldPublic=h.publicCalls[0];h.strictEffectReplay();await settle();
 assert.equal(h.rpc.length,2);assert.equal(h.publicCalls.length,2);
 await h.resolve(oldPrivate,research());await h.resolve(oldPublic,publicPayload);assert.equal(h.member,undefined);
 await h.resolve(h.rpc[1],research());assert.equal(h.member.data.business_date,TODAY);assert.equal(h.member.market,null);
 await h.resolve(h.publicCalls[1],publicPayload);assert.equal(h.member.market.date,'2026-10-02');h.unmount();assert.equal(h.timers,0);
});
