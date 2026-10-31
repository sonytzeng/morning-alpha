// Execute the actual component with deterministic hooks and transport promises.
// Isolated lifecycle controls only: no browser, credentials, network or DB writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as member from '../src/features/vnext/member.ts';
import {parseCompletedResearch} from '../src/features/vnext/completedResearch.ts';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {completedResponse} from './helpers/completedResearchFixture.mjs';
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
 const slots=[],effects=[],queued=[],parses=[],timers=new Map(),listeners=new Map(),rpc=[],publicCalls=[];
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
   if(name==='@/features/vnext/completedResearch')return {parseCompletedResearch:value=>{const pending=parseCompletedResearch(value,clock);parses.push(pending);return pending;}};
   if(name==='@/features/vnext/dailyAiMember')return {parseDailyAiMember:(value,date)=>parseDailyAiMember(value,date,clock)};
   if(name==='./MemberNavigation')return {default:'MemberNavigation',MemberObservationEntry:'MemberObservationEntry'};
   if(name==='./MemberExperience')return {default:'MemberExperience'};
   if(name==='./PublicExperience')return {default:'PublicExperience'};
   if(name==='./CompletedResearch')return {default:'CompletedResearch'};
   if(name==='./DailyAiMemberResearch')return {default:'DailyAiMemberResearch'};
   if(name.endsWith('.css'))return {};
   throw Error('UNAPPROVED_MEMBER_COMPONENT_IMPORT:'+name);
  }},{filename:file});
 function render(){let count=0;do{assert(++count<30,'bounded React lifecycle');dirty=false;cursor=0;tree=exports.default({});while(queued.length)queued.shift()();}while(dirty);return tree;}
 render();
 return {rpc,publicCalls,render,
  call(name){return rpc.findLast(r=>r.name===name);},
  get member(){return find(render(),'MemberExperience')[0]?.props;},
  get completed(){return find(render(),'CompletedResearch')[0]?.props;},
  get dailyAi(){return find(render(),'DailyAiMemberResearch')[0]?.props;},
  get public(){return find(render(),'PublicExperience')[0]?.props;},
  get retries(){return retries;},
  setAccess(value){currentAccess=value;render();},
  setClock(value){clock=value;},
  focus(){for(const f of [...listeners.get('window:focus')??[]])f();render();},
  visibility(value){document.visibilityState=value;for(const f of [...listeners.get('document:visibilitychange')??[]])f();render();},
  async resolve(call,data,error=null){call.resolve(data,error);await settle();await Promise.allSettled(parses);await settle();render();},
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
 h.setAccess(access('A',2));await h.resolve(h.call('get_vnext_member_v1'),research());assert.equal(h.member.notice,'');
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
 assert.equal(h.call('get_vnext_free_history_v1').name,'get_vnext_free_history_v1');h.setClock(AFTER);
 await h.resolve(h.call('get_vnext_free_history_v1'),{schema:'VNEXT_FREE_HISTORY_V1',history:[]});assert.equal(h.member,undefined);h.unmount();
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
 assert.equal(h.rpc.filter(r=>r.name==='get_vnext_member_v1').length,2);assert.equal(h.rpc.filter(r=>r.name==='get_daily_ai_member_research_v1').length,2);assert.equal(h.publicCalls.length,2);
 await h.resolve(oldPrivate,research());await h.resolve(oldPublic,publicPayload);assert.equal(h.member,undefined);
 await h.resolve(h.call('get_vnext_member_v1'),research());assert.equal(h.member.data.business_date,TODAY);assert.equal(h.member.market,null);
 await h.resolve(h.publicCalls[1],publicPayload);assert.equal(h.member.market.date,'2026-10-02');h.unmount();assert.equal(h.timers,0);
});
test('only Owner dispatches the completed-session RPC and renders its validated 72-stock result',async()=>{
 for(const tier of ['premium','free','owner']){
  const h=harness({now:Date.parse('2026-10-30T14:00:00Z'),initialAccess:access('A',1,tier)});
  await h.resolve(h.rpc[0],research('2026-10-30',tier));
  if(tier==='owner'){
   assert.equal(h.call('get_owner_completed_research_v1').name,'get_owner_completed_research_v1');assert.equal(h.call('get_owner_completed_research_v1').signal,h.rpc[0].signal);
   await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());assert.equal(h.completed.data.rows.length,216);assert.equal(h.member,undefined);
  }else assert(!h.rpc.some(r=>r.name==='get_owner_completed_research_v1'));
  h.unmount();
 }
});
test('Owner private result cannot return after hidden invalidation or entitlement loss',async()=>{
 for(const invalidate of [h=>h.visibility('hidden'),h=>h.setAccess(access('A',2,'free'))]){
  const h=harness({now:Date.parse('2026-10-30T14:00:00Z'),initialAccess:access('A',1,'owner')});
  await h.resolve(h.rpc[0],research('2026-10-30','owner'));const pending=h.call('get_owner_completed_research_v1');invalidate(h);
  await h.resolve(pending,await completedResponse());assert(pending.signal.aborted);assert.equal(h.completed,undefined);h.unmount();
 }
});
test('failed Owner document retains the approved member experience and does not invent an analysis',async()=>{
 const h=harness({now:Date.parse('2026-10-30T14:00:00Z'),initialAccess:access('A',1,'owner')});
 await h.resolve(h.rpc[0],research('2026-10-30','owner'));await h.resolve(h.call('get_owner_completed_research_v1'),{},Error('SYNTHETIC_UNAVAILABLE'));
 assert.equal(h.completed,undefined);assert.equal(h.member.data.tier,'owner');assert.equal(h.member.data.observations.length,0);h.unmount();
});
const aiEdition=(tier='premium')=>({schema:'VNEXT_AI_MEMBER_EDITION_V1',tier,business_date:'2026-10-30',research_only:true,
 edition:{id:'a'.repeat(64),edition_date:'2026-10-30',data_through:'2026-10-30',evidence_cutoff:'2026-10-30T06:00:00Z',prepared_at:'2026-10-30T06:05:00Z',expires_at:'2026-10-31T00:00:00Z',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
 cards:Array.from({length:tier==='free'?3:72},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),company:'測試公司',horizon,status:'WAIT',reason:{text:'測試判斷',evidence_ids:['E1']},confirmation:'測試確認',invalidation:'測試失效',gaps:[],classification:'INFERENCE',...(tier==='free'?{}:{counter_evidence:[],sources:[{id:'E1',source:'https://www.twse.com.tw/test',kind:'NEWS',published_at:'2026-10-30T05:00:00Z',available_at:'2026-10-30T05:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}]})}))).flat()});
test('all member tiers receive only their approved AI projection without delaying existing research',async()=>{
 for(const tier of ['free','premium','owner']){
  const h=harness({now:Date.parse('2026-10-30T14:00:00Z'),initialAccess:access('A',1,tier)});
  await h.resolve(h.rpc[0],research('2026-10-30',tier));
  if(tier==='free')await h.resolve(h.call('get_vnext_free_history_v1'),{schema:'VNEXT_FREE_HISTORY_V1',history:[]});
  if(tier==='owner')await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());
  assert(h.member||h.completed);const pending=h.call('get_daily_ai_member_research_v1');assert.equal(pending.name,'get_daily_ai_member_research_v1');assert.equal(pending.args,undefined);
  await h.resolve(pending,aiEdition(tier));assert.equal(h.dailyAi.data.tier,tier);assert.equal(h.dailyAi.data.cards.length,tier==='free'?9:216);assert.equal(h.member,undefined);h.unmount();
 }
});
test('AI result cannot revive after entitlement change, focus, expiry timeout or wrong-tier payload',async()=>{
 for(const invalidate of [h=>h.setAccess(access('B',2)),h=>h.focus(),h=>h.advance(8000)]){
  const h=harness({now:Date.parse('2026-10-30T14:00:00Z')});await h.resolve(h.rpc[0],research('2026-10-30'));const pending=h.rpc.at(-1);invalidate(h);
  await h.resolve(pending,aiEdition());assert.equal(h.dailyAi,undefined);h.unmount();assert.equal(h.timers,0);
 }
 const h=harness({now:Date.parse('2026-10-30T14:00:00Z')});await h.resolve(h.rpc[0],research('2026-10-30'));await h.resolve(h.rpc.at(-1),aiEdition('owner'));assert.equal(h.dailyAi,undefined);assert.equal(h.member.data.tier,'premium');h.unmount();
});
test('approved AI edition remains independently readable when legacy research fails or its history stalls',async()=>{
 for(const tier of ['premium','free','owner']){
  const h=harness({now:Date.parse('2026-10-30T14:00:00Z'),initialAccess:access('A',1,tier)});
  await h.resolve(h.call('get_daily_ai_member_research_v1'),aiEdition(tier));assert.equal(h.dailyAi.data.tier,tier);
  if(tier==='free'){
   await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30','free'));
   assert.equal(h.dailyAi.data.cards.length,9);h.advance(20000);assert.equal(h.dailyAi.data.tier,'free');
  }else{
   await h.resolve(h.call('get_vnext_member_v1'),null,Error('LEGACY_UNAVAILABLE'));assert.equal(h.dailyAi.data.cards.length,216);
  }
  h.setAccess({kind:'denied'});assert.equal(h.dailyAi,undefined);h.unmount();assert.equal(h.timers,0);
 }
});
test('period selection survives a membership refresh while all private research is cleared and reread',async()=>{
 for(const tier of ['premium','owner']){
  const h=harness({now:Date.parse('2026-10-30T14:00:00Z'),initialAccess:access('A',1,tier)});
  if(tier==='owner'){await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30',tier));await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());}
  else await h.resolve(h.call('get_daily_ai_member_research_v1'),aiEdition(tier));
  const view=tier==='owner'?h.completed:h.dailyAi;assert.equal(view.selectedHorizon,'SHORT');view.onHorizonChange('LONG');
  assert.equal((tier==='owner'?h.completed:h.dailyAi).selectedHorizon,'LONG');
  h.focus();assert.equal(h.completed,undefined);assert.equal(h.dailyAi,undefined);h.setAccess(access('A',2,tier));
  if(tier==='owner'){await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30',tier));await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());}
  else await h.resolve(h.call('get_daily_ai_member_research_v1'),aiEdition(tier));
  assert.equal((tier==='owner'?h.completed:h.dailyAi).selectedHorizon,'LONG');h.unmount();
 }
});
