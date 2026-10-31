// Execute the actual component with deterministic hooks and transport promises.
// Isolated lifecycle controls only: no browser, credentials, network or DB writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as member from '../src/features/vnext/member.ts';
import {parseCompletedResearch} from '../src/features/vnext/completedResearch.ts';
import * as dailyMember from '../src/features/vnext/dailyAiMember.ts';
import {completedResponse} from './helpers/completedResearchFixture.mjs';
import {buildPublicMarketReadModel} from '../src/lib/publicMarketReadModel.ts';
import {publicMarketInput} from '../supabase/functions/_shared/public-market-projection.ts';

const file='src/pages/vnext/MemberPage.tsx';
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const deltaFile='src/features/vnext/dailyAiMemberDelta.ts';
const compiledDelta=ts.transpileModule(readFileSync(new URL('../'+deltaFile,import.meta.url),'utf8'),{fileName:deltaFile,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
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

function harness({now=BEFORE,initialAccess=access(),account=false}={}){
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
  rpc(name,args){const call=deferred(name,args);call.identity=currentAccess.kind==='member'?currentAccess.id:null;rpc.push(call);return {abortSignal(signal){call.signal=signal;return call.promise;}};}};
 const document={visibilityState:'visible',addEventListener:(n,f)=>listen('document',n,f),removeEventListener:(n,f)=>remove('document',n,f)};
 const retry=()=>{retries++;};
 const exports={};
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const deltaExports={};
 vm.runInNewContext(compiledDelta,{exports:deltaExports,Date:ClockDate,
  require(name){if(name==='./dailyAiMember.ts')return dailyMember;throw Error('UNAPPROVED_MEMBER_DELTA_IMPORT:'+name);}}, {filename:deltaFile});
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
   if(name==='@/features/vnext/dailyAiMember')return {...dailyMember,parseDailyAiMember:(value,date)=>dailyMember.parseDailyAiMember(value,date,clock)};
   if(name==='@/features/vnext/dailyAiMemberDelta')return deltaExports;
   if(name==='./MemberNavigation')return {default:'MemberNavigation',MemberObservationEntry:'MemberObservationEntry'};
   if(name==='./MemberExperience')return {default:'MemberExperience'};
   if(name==='./PublicExperience')return {default:'PublicExperience'};
   if(name==='./CompletedResearch')return {default:'CompletedResearch'};
   if(name==='./DailyAiMemberResearch')return {default:'DailyAiMemberResearch'};
   if(name.endsWith('.css'))return {};
   throw Error('UNAPPROVED_MEMBER_COMPONENT_IMPORT:'+name);
  }},{filename:file});
 function render(){let count=0;do{assert(++count<30,'bounded React lifecycle');dirty=false;cursor=0;tree=exports.default({account});while(queued.length)queued.shift()();}while(dirty);return tree;}
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
  async resolve(call,data,error=null){if(call.name===AI&&data?.schema==='VNEXT_AI_MEMBER_EDITION_V1')data=fullDelta(data,call.identity);call.resolve(data,error);await settle();await Promise.allSettled(parses);await settle();render();},
  async reject(call){call.reject(Error('SYNTHETIC_TRANSPORT_FAILURE'));await settle();render();},
  strictEffectReplay(){for(const effect of effects.filter(Boolean))effect.cleanup?.();for(const effect of effects.filter(Boolean))effect.cleanup=effect.fn();render();},
  advance(ms){const target=clock+ms;for(;;){const next=[...timers].filter(([,x])=>x.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;
    clock=next[1].due;if(next[1].interval)next[1].due+=next[1].ms;else timers.delete(next[0]);next[1].fn();render();}clock=target;render();},
  unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();unmounted=true;},
  get timers(){return timers.size;},
 };
}

const AI='get_daily_ai_member_research_delta_v1',OLD_AI='get_daily_ai_member_research_v1';
const fullDelta=(payload,user='A')=>({schema:'VNEXT_AI_MEMBER_DELTA_V1',mode:'FULL',user_id:user,tier:payload.tier,business_date:payload.business_date,research_only:true,edition:payload.edition,payload});
const unchangedDelta=(payload=aiEdition(),user='A')=>({schema:'VNEXT_AI_MEMBER_DELTA_V1',mode:'UNCHANGED',user_id:user,tier:payload.tier,business_date:payload.business_date,research_only:true,edition:payload.edition});
const noKnown={p_known_edition_id:null,p_known_tier:null};
const STABLE_NOW=Date.parse('2026-10-30T14:00:00Z');
const noEdition=(tier='premium',date=TODAY)=>({schema:'VNEXT_AI_MEMBER_EDITION_V1',tier,business_date:date,research_only:true,edition:null,cards:[]});
const aiEdition=(tier='premium')=>({schema:'VNEXT_AI_MEMBER_EDITION_V1',tier,business_date:'2026-10-30',research_only:true,
 edition:{id:'a'.repeat(64),edition_date:'2026-10-30',data_through:'2026-10-30',evidence_cutoff:'2026-10-30T06:00:00Z',prepared_at:'2026-10-30T06:05:00Z',expires_at:'2026-10-31T00:00:00Z',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
 cards:Array.from({length:tier==='free'?3:72},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),company:'測試公司',horizon,status:'WAIT',reason:{text:'測試判斷',evidence_ids:['E1']},confirmation:'測試確認',invalidation:'測試失效',gaps:[],classification:'INFERENCE',...(tier==='free'?{}:{counter_evidence:[],sources:[{id:'E1',source:'https://www.twse.com.tw/test',kind:'NEWS',published_at:'2026-10-30T05:00:00Z',available_at:'2026-10-30T05:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}]})}))).flat()});
async function absentAi(h,tier='premium',date=TODAY){await h.resolve(h.call(AI),noEdition(tier,date));}
async function legacyHarness(options={}){
 const h=harness(options),tier=options.initialAccess?.catalog?.tier??'premium',date=member.memberTaipeiDate(options.now??BEFORE);
 await absentAi(h,tier,date);assert.equal(h.call('get_vnext_member_v1')?.name,'get_vnext_member_v1');return h;
}

// These lifecycle tests deliberately resolve the AI empty-version response before
// exercising legacy fallback. The complete RPC log remains visible in every test.
test('member Taipei date and optional payload binding reject impossible or different business dates',()=>{
 assert.equal(member.memberTaipeiDate(BEFORE),TODAY);assert.equal(member.memberTaipeiDate(AFTER),TOMORROW);
 assert.equal(member.parseMemberResearch(research(),TODAY).business_date,TODAY);
 assert.throws(()=>member.parseMemberResearch(research(),TOMORROW),/MEMBER.*DATE|MEMBER.*DAY/);
 assert.throws(()=>member.parseMemberResearch(research('2026-02-30'),TODAY));
});
test('AI empty edition starts one approved legacy read and public transport remains anonymous',async()=>{
 const h=await legacyHarness(),legacy=h.call('get_vnext_member_v1');await h.resolve(legacy,research());
 assert.equal(h.member.data.business_date,TODAY);assert.equal(legacy.args,undefined);
 assert.deepEqual(h.rpc.map(r=>r.name),[AI,'get_vnext_member_v1']);
 assert.deepEqual(JSON.parse(JSON.stringify(h.publicCalls[0].args)),{headers:{Authorization:''},body:{report_date:null}});h.unmount();
});
test('access signal abort fences a pending private response before the Auth hook rerenders',async()=>{
 const controller=new AbortController(),initialAccess={...access(),signal:controller.signal};
 const h=await legacyHarness({initialAccess}),old=h.call('get_vnext_member_v1');controller.abort();h.render();
 assert.equal(h.member,undefined);assert(old.signal.aborted);
 await h.resolve(old,research());assert.equal(h.member,undefined);h.unmount();
});
test('hidden clear rejects a stale watch handler without dispatching another RPC',async()=>{
 const h=await legacyHarness();await h.resolve(h.call('get_vnext_member_v1'),research());const watch=h.member.onWatch,count=h.rpc.length;
 h.visibility('hidden');const pending=watch('SYNTHETIC',true),dispatched=h.rpc.length;
 if(dispatched>count)await h.resolve(h.rpc.at(-1),{});await pending;
 assert.equal(dispatched,count);assert.equal(h.member,undefined);h.unmount();
});
test('same identity new generation cannot receive a late watch error from the old generation',async()=>{
 const h=await legacyHarness();await h.resolve(h.call('get_vnext_member_v1'),research());const pending=h.member.onWatch('SYNTHETIC',true),old=h.rpc.at(-1);
 h.setAccess(access('A',2));await absentAi(h);await h.resolve(h.call('get_vnext_member_v1'),research());assert.equal(h.member.notice,'');
 old.reject(Error('SYNTHETIC_OLD_GENERATION'));await pending;await settle();assert.equal(h.member.notice,'');assert.equal(h.member.busy,false);h.unmount();
});
test('a private response crossing Taipei midnight cannot restore yesterday before its timer runs',async()=>{
 const h=await legacyHarness(),old=h.call('get_vnext_member_v1');h.setClock(AFTER);await h.resolve(old,research());assert.equal(h.member,undefined);h.unmount();
});
test('wrong-day legacy payload is unavailable instead of successful empty research',async()=>{
 const h=await legacyHarness();await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-17'));assert.equal(h.member,undefined);h.unmount();
});
test('free history completion crossing midnight cannot combine two business days',async()=>{
 const h=await legacyHarness({initialAccess:access('F',1,'free')});await h.resolve(h.call('get_vnext_member_v1'),research(TODAY,'free'));
 const history=h.call('get_vnext_free_history_v1');assert(history);h.setClock(AFTER);
 await h.resolve(history,{schema:'VNEXT_FREE_HISTORY_V1',history:[]});assert.equal(h.member,undefined);h.unmount();
});
test('Taipei midnight clears public summary and starts only one new-day public read',async()=>{
 const h=harness({initialAccess:{kind:'denied'}});await settle();await h.resolve(h.publicCalls[0],publicPayload);assert.equal(h.public.market.date,'2026-10-02');
 h.advance(20);await settle();assert.equal(h.public.market,null);assert.equal(h.publicCalls.length,2);
 h.visibility('visible');h.visibility('visible');h.advance(100);assert.equal(h.publicCalls.length,2);h.unmount();
});
test('late public result across midnight is ignored and foreground refreshes the new date once',async()=>{
 const h=harness({initialAccess:{kind:'denied'}});await settle();const old=h.publicCalls[0];h.setClock(AFTER);await h.resolve(old,publicPayload);
 assert.equal(h.public.market,null);h.visibility('visible');h.advance(100);await settle();assert.equal(h.publicCalls.length,2);h.unmount();
});
test('same-day focus and membership polling never multiply the public payload read',async()=>{
 const h=harness({now:Date.parse('2026-10-18T01:00:00Z'),initialAccess:{kind:'denied'}});
 await settle();await h.resolve(h.publicCalls[0],publicPayload);h.focus();h.visibility('visible');h.advance(30000);
 assert.equal(h.publicCalls.length,1);assert.equal(h.public.market.date,'2026-10-02');h.unmount();
});
test('current watch success remains optimistic and a second current watch remains usable',async()=>{
 const h=await legacyHarness();await h.resolve(h.call('get_vnext_member_v1'),research());const first=h.member.onWatch('SYNTHETIC',true);
 await h.resolve(h.rpc.at(-1),{});await first;assert.deepEqual(Array.from(h.member.data.watchlist),['SYNTHETIC']);assert.equal(h.member.busy,false);
 const second=h.member.onWatch('SYNTHETIC',false);await h.resolve(h.rpc.at(-1),{});await second;
 assert.deepEqual(Array.from(h.member.data.watchlist),[]);assert.equal(h.member.notice,'已移出觀察清單');h.unmount();
});
test('legacy deadline and unmount reject late private responses and clear timers',async()=>{
 const h=await legacyHarness(),pending=h.call('get_vnext_member_v1');h.advance(20000);await h.resolve(pending,research());
 assert.equal(h.member,undefined);h.unmount();assert.equal(h.timers,0);
 const unmounted=await legacyHarness(),late=unmounted.call('get_vnext_member_v1');unmounted.unmount();late.resolve(research());await settle();assert.equal(unmounted.timers,0);
});
test('StrictMode setup-cleanup-setup accepts only second AI/public continuations and their fallback',async()=>{
 const h=harness();await settle();const oldAi=h.call(AI),oldPublic=h.publicCalls[0];h.strictEffectReplay();await settle();
 assert.equal(h.rpc.filter(r=>r.name===AI).length,2);assert.equal(h.rpc.filter(r=>r.name==='get_vnext_member_v1').length,0);assert.equal(h.publicCalls.length,2);
 await h.resolve(oldAi,noEdition());await h.resolve(oldPublic,publicPayload);assert.equal(h.member,undefined);assert(!h.call('get_vnext_member_v1'));
 await absentAi(h);await h.resolve(h.call('get_vnext_member_v1'),research());assert.equal(h.member.data.business_date,TODAY);assert.equal(h.member.market,null);
 await h.resolve(h.publicCalls[1],publicPayload);assert.equal(h.member.market.date,'2026-10-02');h.unmount();assert.equal(h.timers,0);
});
test('only Owner fallback dispatches completed-session RPC and renders its validated 72-stock result',async()=>{
 for(const tier of ['premium','free','owner']){
  const h=await legacyHarness({now:STABLE_NOW,initialAccess:access('A',1,tier)}),legacy=h.call('get_vnext_member_v1');
  await h.resolve(legacy,research('2026-10-30',tier));
  if(tier==='owner'){
   const completed=h.call('get_owner_completed_research_v1');assert(completed);assert.equal(completed.signal,legacy.signal);
   await h.resolve(completed,await completedResponse());assert.equal(h.completed.data.rows.length,216);assert.equal(h.member,undefined);
  }else assert(!h.call('get_owner_completed_research_v1'));h.unmount();
 }
});
test('Owner fallback cannot return after hidden invalidation or entitlement loss',async()=>{
 for(const invalidate of [h=>h.visibility('hidden'),h=>h.setAccess(access('A',2,'free'))]){
  const h=await legacyHarness({now:STABLE_NOW,initialAccess:access('A',1,'owner')});
  await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30','owner'));const pending=h.call('get_owner_completed_research_v1');invalidate(h);
  await h.resolve(pending,await completedResponse());assert(pending.signal.aborted);assert.equal(h.completed,undefined);h.unmount();
 }
});
test('failed Owner document retains the approved fallback and does not invent an analysis',async()=>{
 const h=await legacyHarness({now:STABLE_NOW,initialAccess:access('A',1,'owner')});
 await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30','owner'));await h.resolve(h.call('get_owner_completed_research_v1'),{},Error('SYNTHETIC_UNAVAILABLE'));
 assert.equal(h.completed,undefined);assert.equal(h.member.data.tier,'owner');assert.equal(h.member.data.observations.length,0);h.unmount();
});
test('all member tiers with an approved AI edition never request invisible legacy, history or Owner data',async()=>{
 for(const tier of ['free','premium','owner']){
  const h=harness({now:STABLE_NOW,initialAccess:access('A',1,tier)});assert.deepEqual(h.rpc.map(r=>r.name),[AI]);
  const pending=h.call(AI);assert.deepEqual(JSON.parse(JSON.stringify(pending.args)),noKnown);await h.resolve(pending,aiEdition(tier));
  assert.equal(h.dailyAi.data.tier,tier);assert.equal(h.dailyAi.data.cards.length,tier==='free'?9:216);assert.equal(h.member,undefined);
  assert.deepEqual(h.rpc.map(r=>r.name),[AI]);h.unmount();assert.equal(h.timers,0);
 }
});
test('AI timeout starts fallback without waiting for a transport to honor abort and late AI stays rejected',async()=>{
 const h=harness({now:STABLE_NOW}),pending=h.call(AI);assert(!h.call('get_vnext_member_v1'));h.advance(8000);await settle();h.render();
 const legacy=h.call('get_vnext_member_v1');assert(legacy);assert(pending.signal.aborted);
 await h.resolve(legacy,research('2026-10-30'));assert.equal(h.member.data.tier,'premium');
 await h.resolve(pending,aiEdition());assert.equal(h.dailyAi,undefined);assert(h.member);h.unmount();assert.equal(h.timers,0);
});
test('late UNCHANGED after the AI deadline cannot clear a fresh legacy grant or dispatch a cache-miss retry',async()=>{
 for(const priorEdition of [false,true]){
  const h=harness({now:STABLE_NOW});
  if(priorEdition){await h.resolve(h.call(AI),aiEdition());h.advance(30000);}
  const late=h.call(AI);h.advance(8000);await settle();h.render();assert(late.signal.aborted);
  const legacy=h.call('get_vnext_member_v1');assert(legacy);await h.resolve(legacy,research('2026-10-30'));assert(h.member);
  const count=h.rpc.length,unchanged=unchangedDelta();unchanged.edition={...unchanged.edition,prepared_at:'2026-10-30T06:06:00Z'};
  await h.resolve(late,unchanged);assert(h.member,'A timed-out AI result cannot withdraw the newer legacy grant');
  assert.equal(h.member.data.tier,'premium');assert.equal(h.dailyAi,undefined);assert.equal(h.rpc.length,count,'No cache-miss retry may dispatch after the AI deadline');
  h.unmount();assert.equal(h.timers,0);
 }
});
test('AI generic error starts one legacy fallback and its independent deadline remains bounded',async()=>{
 const h=harness({now:STABLE_NOW});await h.reject(h.call(AI));assert.equal(h.rpc.filter(r=>r.name==='get_vnext_member_v1').length,1);
 const pending=h.call('get_vnext_member_v1');h.advance(20000);await h.resolve(pending,research('2026-10-30'));
 assert.equal(h.member,undefined);h.unmount();assert.equal(h.timers,0);
});
test('AI responses cannot revive after identity loss, hidden state or deadline',async()=>{
 for(const invalidate of [h=>h.setAccess(access('B',2)),h=>h.visibility('hidden'),h=>h.advance(8000)]){
  const h=harness({now:STABLE_NOW}),pending=h.call(AI);invalidate(h);
  await h.resolve(pending,aiEdition());assert.equal(h.dailyAi,undefined);h.unmount();assert.equal(h.timers,0);
 }
});
test('legacy failure or history stall from an obsolete read cannot block a fresh valid AI edition',async()=>{
 for(const tier of ['premium','free','owner']){
  const h=await legacyHarness({now:STABLE_NOW,initialAccess:access('A',1,tier)}),legacy=h.call('get_vnext_member_v1');
  let obsolete=legacy;
  if(tier==='free'){await h.resolve(legacy,research('2026-10-30',tier));obsolete=h.call('get_vnext_free_history_v1');}
  h.setAccess(access('A',2,tier));assert(obsolete.signal.aborted);await h.resolve(h.call(AI),aiEdition(tier));assert.equal(h.dailyAi.data.tier,tier);
  if(tier==='free')await h.resolve(obsolete,{schema:'VNEXT_FREE_HISTORY_V1',history:[]});else await h.reject(obsolete);
  assert.equal(h.dailyAi.data.cards.length,tier==='free'?9:216);h.setAccess({kind:'denied'});assert.equal(h.dailyAi,undefined);h.unmount();
 }
});
test('period selection survives same-user hard revalidation while old private research remains fenced',async()=>{
 for(const tier of ['premium','owner']){
  const h=harness({now:STABLE_NOW,initialAccess:access('A',1,tier)});
  if(tier==='owner'){await absentAi(h,tier,'2026-10-30');await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30',tier));await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());}
  else await h.resolve(h.call(AI),aiEdition(tier));
  const view=tier==='owner'?h.completed:h.dailyAi;view.onHorizonChange('LONG');assert.equal((tier==='owner'?h.completed:h.dailyAi).selectedHorizon,'LONG');
  h.setAccess(access('A',2,tier));assert.equal(h.completed,undefined);assert.equal(h.dailyAi,undefined);
  if(tier==='owner'){await absentAi(h,tier,'2026-10-30');await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30',tier));await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());}
  else await h.resolve(h.call(AI),aiEdition(tier));
  assert.equal((tier==='owner'?h.completed:h.dailyAi).selectedHorizon,'LONG');h.unmount();
 }
});
test('AI controlled preferences compose without storing private payloads',async()=>{
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());
 const controls=h.dailyAi;assert.deepEqual(JSON.parse(JSON.stringify(controls.viewState)),{filter:'ALL',query:'',limit:9});assert.equal(typeof controls.onViewChange,'function');
 controls.onViewChange(previous=>({...previous,filter:'WAIT',limit:18}));controls.onViewChange(previous=>({...previous,query:'測試公司',limit:previous.limit+9}));
 assert.deepEqual(JSON.parse(JSON.stringify(h.dailyAi.viewState)),{filter:'WAIT',query:'測試公司',limit:27});assert.deepEqual(Object.keys(h.dailyAi.viewState).sort(),['filter','limit','query']);
 controls.onHorizonChange('LONG');h.dailyAi.onViewChange(previous=>({...previous,query:'1000',limit:72}));h.setAccess(access('A',2));assert.equal(h.dailyAi,undefined);
 await h.resolve(h.call(AI),aiEdition());assert.equal(h.dailyAi.selectedHorizon,'LONG');assert.deepEqual(JSON.parse(JSON.stringify(h.dailyAi.viewState)),{filter:'WAIT',query:'1000',limit:72});h.unmount();
});
test('thirty-second same-scope recheck retains valid AI cards and controls while rejecting old callbacks',async()=>{
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());h.dailyAi.onHorizonChange('LONG');h.dailyAi.onViewChange(p=>({...p,query:'1000',filter:'WAIT',limit:72}));
 const old=h.dailyAi,first=h.call(AI);h.advance(30000);const next=h.call(AI);
 assert.notEqual(next,first);assert.equal(h.rpc.filter(r=>r.name===AI).length,2);assert.equal(h.retries,0);assert.equal(h.dailyAi.data.edition.id,'a'.repeat(64));
 assert.equal(h.dailyAi.selectedHorizon,'LONG');assert.equal(h.dailyAi.viewState.query,'1000');
 old.onViewChange(p=>({...p,query:'STALE_RECHECK'}));old.onHorizonChange('SHORT');assert.equal(h.dailyAi.viewState.query,'1000');assert.equal(h.dailyAi.selectedHorizon,'LONG');
 await h.resolve(next,aiEdition());assert.equal(h.dailyAi.viewState.query,'1000');assert.equal(h.dailyAi.selectedHorizon,'LONG');assert(!h.call('get_vnext_member_v1'));h.unmount();
});
test('focus and visible events coalesce one refresh and never restart an in-flight same-scope read',async()=>{
 const h=harness({now:STABLE_NOW}),first=h.call(AI);h.focus();h.visibility('visible');h.focus();h.advance(100);
 assert.equal(h.rpc.length,1);assert.equal(first.signal.aborted,false);assert.equal(h.retries,0);
 await h.resolve(first,aiEdition());h.focus();h.visibility('visible');h.focus();h.advance(99);assert.equal(h.rpc.length,1);
 h.advance(1);assert.equal(h.rpc.length,2);assert.equal(h.dailyAi.data.edition.id,'a'.repeat(64));
 h.focus();h.visibility('visible');h.advance(100);assert.equal(h.rpc.length,2);assert.equal(h.call(AI).signal.aborted,false);h.unmount();
});
test('hidden tabs clear private cards, stop polling, and return through one coalesced current read',async()=>{
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());h.dailyAi.onHorizonChange('LONG');h.dailyAi.onViewChange(p=>({...p,query:'1000',limit:72}));const old=h.dailyAi;
 h.visibility('hidden');assert.equal(h.dailyAi,undefined);const count=h.rpc.length;h.advance(120000);assert.equal(h.rpc.length,count);assert.equal(h.retries,0);
 old.onViewChange(p=>({...p,query:'HIDDEN_OLD_CALLBACK'}));old.onHorizonChange('SHORT');h.visibility('visible');h.focus();h.advance(100);
 assert.equal(h.rpc.length,count+1);assert.equal(h.dailyAi,undefined);await h.resolve(h.call(AI),aiEdition());
 assert.equal(h.dailyAi.selectedHorizon,'LONG');assert.equal(h.dailyAi.viewState.query,'1000');h.unmount();assert.equal(h.timers,0);
});
test('identity A to unresolved B to A never restores first-A controls or accepts obsolete callbacks',async()=>{
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());h.dailyAi.onHorizonChange('LONG');h.dailyAi.onViewChange(p=>({...p,filter:'AVOID',query:'OLD_A',limit:72}));const oldA=h.dailyAi;
 h.setAccess(access('B',2));const pendingB=h.call(AI);assert.equal(h.dailyAi,undefined);oldA.onViewChange(p=>({...p,query:'FORGED_A_RESTORE'}));oldA.onHorizonChange('LONG');
 h.setAccess(access('A',3));await h.resolve(h.call(AI),aiEdition());assert.equal(h.dailyAi.selectedHorizon,'SHORT');assert.deepEqual(JSON.parse(JSON.stringify(h.dailyAi.viewState)),{filter:'ALL',query:'',limit:9});
 h.dailyAi.onViewChange(p=>({...p,query:'CURRENT_A'}));oldA.onViewChange(p=>({...p,query:'STALE_FIRST_A'}));oldA.onHorizonChange('LONG');
 await h.resolve(pendingB,aiEdition());assert.equal(h.dailyAi.viewState.query,'CURRENT_A');assert.equal(h.dailyAi.selectedHorizon,'SHORT');h.unmount();
});
test('new identity, tier or edition starts fresh and old edition callbacks cannot alter the new scope',async()=>{
 for(const boundary of ['identity','tier','edition']){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());h.dailyAi.onHorizonChange('LONG');h.dailyAi.onViewChange(p=>({...p,filter:'WAIT',query:'OLD_SCOPE',limit:72}));const old=h.dailyAi;
  const tier=boundary==='tier'?'free':'premium';
  if(boundary==='edition')h.advance(30000);else h.setAccess(access(boundary==='identity'?'B':'A',2,tier));
  if(boundary!=='edition')assert.equal(h.dailyAi,undefined);
  const next=aiEdition(tier);if(boundary==='edition')next.edition.id='b'.repeat(64);await h.resolve(h.call(AI),next);
  assert.equal(h.dailyAi.selectedHorizon,'SHORT');assert.deepEqual(JSON.parse(JSON.stringify(h.dailyAi.viewState)),{filter:'ALL',query:'',limit:9});
  old.onViewChange(p=>({...p,filter:'AVOID',query:'STALE_SCOPE',limit:72}));old.onHorizonChange('LONG');assert.equal(h.dailyAi.selectedHorizon,'SHORT');assert.equal(h.dailyAi.viewState.query,'');h.unmount();
 }
});
test('denied, access-denied, absent edition and wrong tier clear controls before a later same-user edition',async()=>{
 for(const boundary of ['denied','rpc-denied','null-edition','wrong-tier']){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());h.dailyAi.onHorizonChange('LONG');h.dailyAi.onViewChange(p=>({...p,filter:'WAIT',query:'OLD_PRIVATE_CONTEXT',limit:72}));const old=h.dailyAi;
  if(boundary==='denied')h.setAccess({kind:'denied'});else{
   h.setAccess(access('A',2));const pending=h.call(AI);
   if(boundary==='rpc-denied')await h.resolve(pending,null,{code:'42501',message:'SYNTHETIC_PERMISSION_DENIED'});
   if(boundary==='null-edition')await h.resolve(pending,noEdition('premium','2026-10-30'));
   if(boundary==='wrong-tier')await h.resolve(pending,aiEdition('owner'));
  }
  assert.equal(h.dailyAi,undefined);old.onViewChange(p=>({...p,query:'OLD_CALLBACK_AFTER_DENIAL'}));old.onHorizonChange('LONG');
  if(['rpc-denied','wrong-tier'].includes(boundary)){assert.equal(h.retries,1);assert(!h.call('get_vnext_member_v1'));}
  h.setAccess(access('A',3));await h.resolve(h.call(AI),aiEdition());assert.equal(h.dailyAi.selectedHorizon,'SHORT');assert.deepEqual(JSON.parse(JSON.stringify(h.dailyAi.viewState)),{filter:'ALL',query:'',limit:9});h.unmount();
 }
});
test('failed same-scope AI recheck clears raw data and obsolete controls while preserving scalar preferences',async()=>{
 for(const failure of ['network','access-unavailable']){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());h.dailyAi.onHorizonChange('LONG');h.dailyAi.onViewChange(p=>({...p,filter:'WAIT',query:'RETAIN_UI_ONLY',limit:72}));const old=h.dailyAi;
  if(failure==='access-unavailable')h.setAccess({kind:'unavailable'});else{h.advance(30000);assert(h.dailyAi);await h.reject(h.call(AI));}
  assert.equal(h.dailyAi,undefined);old.onViewChange(p=>({...p,query:'FAILURE_CALLBACK'}));old.onHorizonChange('SHORT');assert.equal(h.dailyAi,undefined);
  h.setAccess(access('A',3));assert.equal(h.dailyAi,undefined);await h.resolve(h.call(AI),aiEdition());
  assert.equal(h.dailyAi.selectedHorizon,'LONG');assert.deepEqual(JSON.parse(JSON.stringify(h.dailyAi.viewState)),{filter:'WAIT',query:'RETAIN_UI_ONLY',limit:72});h.unmount();
 }
});
test('Taipei request date resets controls even if the returned edition ID remains the same',async()=>{
 const h=harness({now:Date.parse('2026-10-30T15:59:50Z')});await h.resolve(h.call(AI),aiEdition());h.dailyAi.onHorizonChange('LONG');h.dailyAi.onViewChange(p=>({...p,filter:'WAIT',query:'PREVIOUS_DAY',limit:72}));const old=h.dailyAi;
 h.advance(10020);assert.equal(h.dailyAi,undefined);old.onViewChange(p=>({...p,query:'STALE_DAY'}));old.onHorizonChange('LONG');
 const tomorrow={...aiEdition(),business_date:'2026-10-31',edition:{...aiEdition().edition,expires_at:'2026-11-01T00:00:00Z'}};await h.resolve(h.call(AI),tomorrow);
 assert.equal(h.dailyAi.data.business_date,'2026-10-31');assert.equal(h.dailyAi.selectedHorizon,'SHORT');assert.deepEqual(JSON.parse(JSON.stringify(h.dailyAi.viewState)),{filter:'ALL',query:'',limit:9});h.unmount();
 const source=['MemberPage','DailyAiMemberResearch'].map(name=>ts.transpileModule(readFileSync(new URL('../src/pages/vnext/'+name+'.tsx',import.meta.url),'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,removeComments:true}}).outputText).join('\n');
 assert(!/\b(?:localStorage|sessionStorage)\b/.test(source),'private continuity preferences must remain in memory');
});
test('account compatibility path remains legacy-only and never downloads the AI edition',async()=>{
 const h=harness({account:true});assert.deepEqual(h.rpc.map(r=>r.name),['get_vnext_member_v1']);
 await h.resolve(h.call('get_vnext_member_v1'),research());assert(!h.call(AI));h.unmount();assert.equal(h.timers,0);
});

test('AI publication and later failure cannot expose a legacy result from an earlier polling cycle',async()=>{
 const h=await legacyHarness({now:STABLE_NOW});await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30'));assert(h.member);
 h.advance(30000);await h.resolve(h.call(AI),aiEdition());assert(h.dailyAi);assert.equal(h.member,undefined);
 h.advance(30000);await h.reject(h.call(AI));assert.equal(h.dailyAi,undefined);assert.equal(h.member,undefined,'An older hidden fallback is not a fresh server grant');
 const fresh=h.call('get_vnext_member_v1');assert(fresh);await h.resolve(fresh,research('2026-10-30'));assert.equal(h.member.data.tier,'premium');h.unmount();
});

test('Owner fallback horizon controls reset on identity change and obsolete Owner callbacks stay fenced',async()=>{
 const h=await legacyHarness({now:STABLE_NOW,initialAccess:access('A',1,'owner')});await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30','owner'));
 await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());const old=h.completed;old.onHorizonChange('LONG');assert.equal(h.completed.selectedHorizon,'LONG');
 h.setAccess(access('B',2,'owner'));assert.equal(h.completed,undefined);old.onHorizonChange('MEDIUM');
 await absentAi(h,'owner','2026-10-30');await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30','owner'));await h.resolve(h.call('get_owner_completed_research_v1'),await completedResponse());
 assert.equal(h.completed.selectedHorizon,'SHORT');old.onHorizonChange('LONG');assert.equal(h.completed.selectedHorizon,'SHORT');h.unmount();
});

test('delta UNCHANGED uses only exact same-scope RAM and keeps the current verified edition',async()=>{
 for(const tier of ['premium','free','owner']){
  const h=harness({now:STABLE_NOW,initialAccess:access('A',1,tier)});assert.deepEqual(JSON.parse(JSON.stringify(h.call(AI).args)),noKnown);
  await h.resolve(h.call(AI),aiEdition(tier));const previous=h.dailyAi.data;h.dailyAi.onViewChange(p=>({...p,query:'1000',limit:72}));h.dailyAi.onHorizonChange('LONG');
  h.advance(30000);const read=h.call(AI);assert.deepEqual(JSON.parse(JSON.stringify(read.args)),{p_known_edition_id:'a'.repeat(64),p_known_tier:tier});
  await h.resolve(read,unchangedDelta(aiEdition(tier)));assert.equal(h.dailyAi.data,previous);assert.equal(h.dailyAi.selectedHorizon,'LONG');assert.equal(h.dailyAi.viewState.query,'1000');
  assert.deepEqual(h.rpc.map(r=>r.name),[AI,AI]);h.unmount();
 }
});
test('delta first-load UNCHANGED without RAM clears and requests one FULL read with known=null',async()=>{
 const h=harness({now:STABLE_NOW}),first=h.call(AI);await h.resolve(first,unchangedDelta());
 assert.equal(h.dailyAi,undefined);assert.equal(h.rpc.filter(r=>r.name===AI).length,2);const second=h.call(AI);assert.notEqual(second,first);assert.deepEqual(JSON.parse(JSON.stringify(second.args)),noKnown);
 await h.resolve(second,aiEdition());assert.equal(h.dailyAi.data.cards.length,216);assert(!h.call('get_vnext_member_v1'));h.unmount();
});
test('malformed UNCHANGED discards RAM before a single known=null replacement',async()=>{
 for(const mutate of [r=>r.payload=aiEdition(),r=>r.cards=[],r=>r.edition.prepared_at='2026-10-30T06:06:00Z',r=>r.edition.expires_at='2026-11-01T00:00:00Z',r=>r.edition.id='b'.repeat(64)]){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());const prior=h.dailyAi;h.advance(30000);
  const malformed=structuredClone(unchangedDelta());mutate(malformed);await h.resolve(h.call(AI),malformed);
  assert.equal(h.dailyAi,undefined);const retry=h.call(AI);assert.deepEqual(JSON.parse(JSON.stringify(retry.args)),noKnown);assert.equal(h.rpc.filter(r=>r.name===AI).length,3);
  prior.onViewChange(p=>({...p,query:'STALE_DELTA_CACHE'}));await h.resolve(retry,aiEdition());assert.equal(h.dailyAi.viewState.query,'');assert(!h.call('get_vnext_member_v1'));h.unmount();
 }
});
test('callbacks captured during a pending recheck cannot revive after its cache miss or generic failure',async()=>{
 for(const failure of ['cache-miss','network']){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());
  h.dailyAi.onViewChange(p=>({...p,query:'CURRENT_SCALAR',filter:'WAIT',limit:72}));h.dailyAi.onHorizonChange('LONG');
  h.advance(30000);const pendingView=h.dailyAi,pendingRead=h.call(AI);assert(pendingView);
  if(failure==='cache-miss'){
   const malformed=unchangedDelta();malformed.edition={...malformed.edition,prepared_at:'2026-10-30T06:06:00Z'};await h.resolve(pendingRead,malformed);
  }else await h.reject(pendingRead);
  assert.equal(h.dailyAi,undefined);pendingView.onViewChange(p=>({...p,query:'STALE_PENDING'}));pendingView.onHorizonChange('SHORT');
  if(failure==='network'){await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30'));h.advance(30000);}
  await h.resolve(h.call(AI),aiEdition());assert.equal(h.dailyAi.viewState.query,'CURRENT_SCALAR');assert.equal(h.dailyAi.selectedHorizon,'LONG');
  pendingView.onViewChange(p=>({...p,query:'STALE_AFTER_FULL'}));pendingView.onHorizonChange('MEDIUM');
  assert.equal(h.dailyAi.viewState.query,'CURRENT_SCALAR');assert.equal(h.dailyAi.selectedHorizon,'LONG');h.unmount();assert.equal(h.timers,0);
 }
});
test('a second unusable UNCHANGED falls back once and cannot form a cache-miss loop',async()=>{
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),unchangedDelta());const second=h.call(AI);await h.resolve(second,unchangedDelta());
 assert.equal(h.rpc.filter(r=>r.name===AI).length,2);assert.equal(h.rpc.filter(r=>r.name==='get_vnext_member_v1').length,1);assert.equal(h.dailyAi,undefined);
 await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30'));assert(h.member);assert.equal(h.rpc.length,3);h.unmount();
});
test('hard identity, Auth generation, signal, tier and hidden boundaries never send an earlier RAM edition hint',async()=>{
 for(const boundary of ['identity','generation','signal','tier','hidden']){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());
  if(boundary==='hidden'){h.visibility('hidden');h.visibility('visible');h.focus();h.advance(100);}
  else h.setAccess(access(boundary==='identity'?'B':'A',boundary==='signal'?1:2,boundary==='tier'?'free':'premium'));
  assert.equal(h.dailyAi,undefined);assert.deepEqual(JSON.parse(JSON.stringify(h.call(AI).args)),noKnown,boundary);
  const payload=aiEdition(boundary==='tier'?'free':'premium');await h.resolve(h.call(AI),payload);assert(h.dailyAi);h.unmount();
 }
});
test('wrong user, current tier or denial cannot enter cache-miss or legacy fallback paths',async()=>{
 for(const boundary of ['wrong-full-user','wrong-unchanged-user','wrong-unchanged-tier','42501']){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition());h.advance(30000);const call=h.call(AI);
  if(boundary==='42501')await h.resolve(call,null,{code:'42501',message:'DENIED'});
  else if(boundary==='wrong-full-user')await h.resolve(call,fullDelta(aiEdition(),'B'));
  else if(boundary==='wrong-unchanged-user')await h.resolve(call,unchangedDelta(aiEdition(),'B'));
  else await h.resolve(call,unchangedDelta(aiEdition('free')));
  assert.equal(h.dailyAi,undefined);assert.equal(h.retries,1);assert.equal(h.rpc.filter(r=>r.name===AI).length,2);assert(!h.call('get_vnext_member_v1'));h.unmount();
 }
});
test('missing delta RPC uses the unchanged original reader once and retains server payload validation',async()=>{
 for(const code of ['42883','PGRST202']){
  const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),null,{code,message:'Could not find function public.get_daily_ai_member_research_delta_v1(p_known_edition_id, p_known_tier)'});
  const old=h.call(OLD_AI);assert(old);assert.equal(old.args,undefined);assert.deepEqual(h.rpc.map(r=>r.name),[AI,OLD_AI]);
  await h.resolve(old,aiEdition());assert.equal(h.dailyAi.data.cards.length,216);assert(!h.call('get_vnext_member_v1'));h.unmount();
 }
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),null,{code:'PGRST202',message:'Could not find public.get_daily_ai_member_research_delta_v1'});await h.resolve(h.call(OLD_AI),null,{code:'42883'});
 assert.deepEqual(h.rpc.map(r=>r.name),[AI,OLD_AI,'get_vnext_member_v1']);assert.equal(h.dailyAi,undefined);h.unmount();
});
test('Free history and Owner completed authorization denial clears raw data and requires fresh access',async()=>{
 for(const tier of ['free','owner']){
  const h=await legacyHarness({now:STABLE_NOW,initialAccess:access('A',1,tier)});await h.resolve(h.call('get_vnext_member_v1'),research('2026-10-30',tier));
  const subread=h.call(tier==='free'?'get_vnext_free_history_v1':'get_owner_completed_research_v1');assert(subread);
  await h.resolve(subread,null,{code:'42501',message:'REVOKED_DURING_READ'});
  assert.equal(h.member,undefined);assert.equal(h.completed,undefined);assert.equal(h.dailyAi,undefined);assert.equal(h.retries,1);assert(subread.signal.aborted);h.unmount();
 }
});

test('an internal wrapper dependency error cannot masquerade as an absent delta RPC',async()=>{
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),null,{code:'42883',message:'function vnext_private.some_required_reader(text) does not exist'});
 assert(!h.call(OLD_AI));assert.equal(h.rpc.filter(r=>r.name===AI).length,1);assert.equal(h.rpc.filter(r=>r.name==='get_vnext_member_v1').length,1);h.unmount();
});
test('expired RAM sends no edition hint and cannot be revived by UNCHANGED',async()=>{
 const h=harness({now:STABLE_NOW}),payload=aiEdition();payload.edition.expires_at='2026-10-30T14:00:20Z';await h.resolve(h.call(AI),payload);
 h.advance(30000);assert.deepEqual(JSON.parse(JSON.stringify(h.call(AI).args)),noKnown);
 await h.resolve(h.call(AI),unchangedDelta(payload));assert.equal(h.dailyAi,undefined);assert.deepEqual(JSON.parse(JSON.stringify(h.call(AI).args)),noKnown);
 await h.resolve(h.call(AI),aiEdition());assert.equal(h.dailyAi.data.edition.expires_at,'2026-10-31T00:00:00Z');h.unmount();
});
test('repeated same-scope entitlement mismatch clears every response but throttles only automatic retries',async()=>{
 const h=harness({now:STABLE_NOW});await h.resolve(h.call(AI),aiEdition('owner'));assert.equal(h.dailyAi,undefined);assert.equal(h.retries,1);
 h.setAccess(access('A',2));await h.resolve(h.call(AI),aiEdition('owner'));assert.equal(h.dailyAi,undefined);assert.equal(h.member,undefined);assert.equal(h.retries,1);
 const retry=find(h.render(),'button').find(n=>n.props.children==='重新讀取');assert(retry,'A throttled mismatch must offer explicit recovery');retry.props.onClick();h.render();assert.equal(h.retries,2,'Manual recovery must not be throttled');
 h.setAccess(access('B',3));await h.resolve(h.call(AI),aiEdition('owner'));assert.equal(h.retries,3,'A different verified identity has a separate retry scope');h.unmount();
});
