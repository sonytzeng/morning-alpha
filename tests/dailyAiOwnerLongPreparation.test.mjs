// Synthetic retained inputs run the actual calculator, rationale preparation,
// parsers and TSX. SQL integration separately proves that no price plan or
// review is needed. These fixtures attest no real method or recommendation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../src/features/vnext/contracts.ts';
import * as calculationParser from '../src/features/vnext/dailyAiOwnerPriceCalculation.ts';
import * as preparationParser from '../src/features/vnext/dailyAiOwnerLongPreparation.ts';
import * as ownerModule from '../src/features/vnext/dailyAiOwner.ts';
import * as memberModule from '../src/features/vnext/dailyAiMember.ts';
import * as copyModule from '../src/features/vnext/dailyAiCopy.ts';
import {canonical} from '../research/entry-opportunity.ts';
import {prepareDailyAiLongRationale} from '../research/daily-ai-long-rationale.ts';
import {createOwnerCalculationFixture,SYNTHETIC_CALCULATION_OWNER as OWNER} from './helpers/dailyAiOwnerPriceCalculationFixture.mjs';

const NOW=Date.parse('2026-11-10T08:10:00Z');
const realFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};});
test.after(()=>{globalThis.fetch=realFetch;});
async function fixture({symbol='1000',dividendMethod=true}={}){
 const f=await createOwnerCalculationFixture({horizon:'LONG',symbol,dividendMethod,now:NOW}),i=f.input;
 const packet={symbol,company:'合成流程驗證公司（非真實推薦）',cutoff:i.cutoff,data_through:i.data_through,evidence:i.evidence};
 const expiry=new Date(NOW+3600000).toISOString();
 const result=await prepareDailyAiLongRationale({packet,calculation_input:i,as_of:i.as_of,expires_at:expiry,now:NOW});
 const {preparation_hash,...body}=result;
 const edition={id:f.row.body.edition_id,edition_date:'2026-11-10',evidence_cutoff:i.cutoff,prepared_at:new Date(NOW-20*60000).toISOString(),
  data_through:i.data_through,expires_at:expiry,mode:'AS_OF_RESEARCH',forecast:false,performance_available:false};
 const card={symbol,company:packet.company,horizon:'LONG',status:'INSUFFICIENT',reason:{text:'合成測試：長期需求、競爭優勢與估值尚待獨立審查。',evidence_ids:['P3']},
  counter_evidence:[],confirmation:'仍需判斷',invalidation:i.invalidation,gaps:['MISSING_VALUATION_1'],classification:'INFERENCE',sources:i.evidence.map(({content,...source})=>({...source,first_seen_at:null,as_of:null,evidence_hash:null}))};
 const a=f.response.audit,response={schema:'DAILY_AI_OWNER_LONG_PREPARATION_V1',edition_id:edition.id,symbol,horizon:'LONG',subject_user_id:OWNER,research_only:true,preview_only:true,
  preparation:{input_hash:a.input_hash,input_text:a.input_text,calculation_hash:a.calculation_hash,calculation_text:a.calculation_text,preparation_hash,preparation_text:canonical(body),recorded_at:a.recorded_at}};
 return {response,scope:{edition,card},result};
}
const parse=f=>preparationParser.parseDailyAiOwnerLongPreparation(f.response,f.scope,OWNER,NOW);
async function rebind(f,change){const a=f.response.preparation,p=JSON.parse(a.preparation_text);await change(p);a.preparation_text=canonical(p);a.preparation_hash=await contracts.snapshotHash(p);}

test('unqualified LONG cards expose actual dividend and FCFE preparation without an audit or price-plan identity',async()=>{
 for(const dividendMethod of [true,false]){const f=await fixture({dividendMethod}),p=(await parse(f)).preparation;
  assert.equal(f.scope.card.status,'INSUFFICIENT');assert.equal(p.status,'DATA_REQUIRED_REVIEW_PREPARATION');assert.equal(p.review_items.length,3);
  assert.equal(p.calculation.calculation_hash,f.result.valuation_calculation.calculation_hash);assert.equal(p.calculation.method_id,f.result.valuation_calculation.method_id);
  assert.deepEqual(p.calculation.entry_range,dividendMethod?[73.05,86.28]:[64,80]);assert(p.missing.length>0);
  assert.equal(p.calculation.scenarios[0].dividend!==null,dividendMethod);assert.equal(p.calculation.scenarios[0].terminal!==null,!dividendMethod);
  assert(Object.isFrozen(p));assert(Object.isFrozen(p.calculation.sources));assert.equal(p.plan_hash,undefined);assert.equal(p.audit,undefined);
 }
});

test('missing preparation is an honest null only within the exact Owner, edition, symbol and LONG scope',async()=>{
 const f=await fixture();f.response.preparation=null;assert.equal((await parse(f)).preparation,null);
 for(const change of [v=>v.subject_user_id='00000000-0000-4000-8000-000000000202',v=>v.edition_id='d'.repeat(64),v=>v.symbol='1001',v=>v.horizon='MEDIUM',v=>v.preview_only=false]){
  const bad=structuredClone(f);change(bad.response);await assert.rejects(()=>parse(bad),/OWNER_LONG_PREPARATION_SCOPE/);
 }
 const bad=structuredClone(f);bad.response.audit={};await assert.rejects(()=>parse(bad),/FIELDS/);
});

test('three retained documents require exact SHA bytes and canonical JSON',async()=>{
 for(const key of ['input_text','calculation_text','preparation_text']){const f=await fixture();f.response.preparation[key]+=' ';await assert.rejects(()=>parse(f),/HASH_MISMATCH/);}
 const f=await fixture();f.response.preparation.preparation_text+=' ';
 f.response.preparation.preparation_hash=createHash('sha256').update(f.response.preparation.preparation_text).digest('hex');
 await assert.rejects(()=>parse(f),/CANONICAL_HASH/);
});

test('a rehashed rationale cannot manufacture approval, swap calculations or change the price comparison',async()=>{
 for(const change of [p=>p.status=['READY_FOR_REVIEW'],p=>p.selection_qualified=true,p=>p.methodology_approved=true,p=>p.member_published=true,p=>p.review={verdict:'PASS'},
  p=>p.review_items[0].verdict='SUPPORTED',p=>p.review_items[2].calculation_hash='c'.repeat(64),p=>p.valuation_calculation.input_hash='c'.repeat(64),
  p=>p.valuation_calculation.trace.scenarios[0].value=1,p=>p.review_items[2].observations.relation='WITHIN_SELECTED_RANGE',p=>p.review_items[0].evidence_ids=['foreign-source']]){
  const f=await fixture();await rebind(f,change);await assert.rejects(()=>parse(f),/OWNER_LONG_PREPARATION_/);
 }
});

test('rehashing every calculation and rationale link cannot replace the retained quote observation',async()=>{
 const f=await fixture(),a=f.response.preparation,c=JSON.parse(a.calculation_text);c.trace.quote=1;
 a.calculation_text=canonical(c);a.calculation_hash=await contracts.snapshotHash(c);
 await rebind(f,p=>{p.valuation_calculation.calculation_hash=a.calculation_hash;p.valuation_calculation.trace=c.trace;
  p.review_items[2].calculation_hash=a.calculation_hash;p.review_items[2].observations.quote=1;
  p.review_items[2].observations.relation='BELOW_SELECTED_RANGE';p.price_observation.close=1;});
 await assert.rejects(()=>parse(f),/OWNER_PRICE_CALCULATION_QUOTE_BINDING/);
});

test('DB microsecond/offset time spellings preserve equality while changed cutoff, expiry or future records fail',async()=>{
 const f=await fixture();f.scope.edition.evidence_cutoff=f.scope.edition.evidence_cutoff.replace('.000Z','.000000+00:00');
 f.scope.edition.expires_at=f.scope.edition.expires_at.replace('.000Z','.000000+00:00');assert((await parse(f)).preparation);
 for(const change of [p=>p.cutoff='2026-11-10T00:00:00Z',p=>p.expires_at='2026-11-10T10:00:00Z',p=>p.as_of='2026-11-10T07:59:59Z']){
  const bad=await fixture();await rebind(bad,change);await assert.rejects(()=>parse(bad),/CHRONOLOGY/);
 }
 const future=await fixture();future.response.preparation.recorded_at='2026-11-10T08:10:00.000001Z';await assert.rejects(()=>parse(future),/CHRONOLOGY/);
 const history=await preparationParser.parseDailyAiOwnerLongPreparation(f.response,f.scope,OWNER,NOW+2*3600000);assert.equal(history.preparation.expires_at,f.result.expires_at);
});

test('the parser owns response and scope before hashing begins',async()=>{
 const f=await fixture(),pending=parse(f);f.response.preparation.preparation_text='changed';f.scope.card.symbol='9999';
 assert.equal((await pending).symbol,'1000');
});

const file='src/pages/vnext/DailyAiOwnerLongPreparation.tsx';
const commonFile='src/pages/vnext/DailyAiOwnerPriceCalculation.tsx';
const commonCompiled=ts.transpileModule(readFileSync(new URL('../'+commonFile,import.meta.url),'utf8'),{fileName:commonFile,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const find=(node,type)=>Array.isArray(node)?node.flatMap(n=>find(n,type)):!node||typeof node!=='object'?[]:[...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const settle=()=>new Promise(resolve=>setTimeout(resolve,2));
const access=()=>({kind:'member',id:OWNER,generation:1,signal:new AbortController().signal,catalog:{tier:'owner'}});
function harness(scope,initialAccess=access()){
 let props={scope,access:initialAccess,onClose(){}},cursor=0,dirty=false,tree,unmounted=false;const states=[],effects=[],queued=[],calls=[],timers=new Map();let nextTimer=0;
 const hooks={useRef(initial){const i=cursor++;return states[i]??={current:initial};},
  useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{assert(!unmounted);const value=typeof next==='function'?next(states[i]):next;if(!Object.is(value,states[i])){states[i]=value;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const effect={deps};effects[i]=effect;queued.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}}};
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props}),exports={};
 vm.runInNewContext(compiled,{exports,Date,Intl,URL,AbortController,Error,Promise,setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='@/features/vnext/contracts')return contracts;
  if(name==='@/features/vnext/dailyAiOwnerLongPreparation')return preparationParser;
  if(name==='@/features/vnext/dailyAiOwnerPriceCalculation')return calculationParser;
  if(name==='./DailyAiOwnerPriceCalculation'){const commonExports={};vm.runInNewContext(commonCompiled,{exports:commonExports,Date,Intl,URL,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='@/features/vnext/contracts')return contracts;if(name==='@/features/vnext/dailyAiOwnerPriceCalculation')return calculationParser;if(name==='@/lib/supabase')return {};if(name.endsWith('.css'))return {};throw Error(name);}});return commonExports;}
  if(name==='@/lib/supabase')return {supabase:{rpc(name,args){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;}),call={name,args,resolve,reject,signal:null};calls.push(call);return {abortSignal(signal){call.signal=signal;return promise;}};}}};
  if(name.endsWith('.css'))return {};throw Error(name);
 }});
 const render=()=>{let count=0;do{assert(++count<25);dirty=false;cursor=0;tree=exports.default(props);while(queued.length)queued.shift()();}while(dirty);};
 const flush=async()=>{for(let i=0;i<15;i++){await settle();if(dirty)render();}};render();
 return {calls,get text(){return text(tree);},get tree(){return tree;},flush,update(change){props={...props,...change};render();},
  async respond(index,response){calls[index].resolve(response);await flush();},timeout(){for(const fn of [...timers.values()])fn();},
  close(){for(const e of effects.filter(Boolean))e.cleanup?.();unmounted=true;}};
}

test('the actual LONG reader uses one fixed private RPC and renders formulas with unqualified semantics',async()=>{
 const f=await fixture(),ui=harness(f.scope);try{await ui.flush();assert.equal(ui.calls.length,1);
  assert.equal(ui.calls[0].name,'get_daily_ai_owner_long_preparation_v1');assert.deepEqual(structuredClone(ui.calls[0].args),{p_edition_id:f.scope.edition.id,p_symbol:'1000'});
  await ui.respond(0,{data:f.response,error:null});assert.match(ui.text,/未完成長期選股審查/);assert.match(ui.text,/股利與末期本益比折現情境/);
  assert.match(ui.text,/NT\$73.05～86.28/);assert.match(ui.text,/三項判斷仍待完成/);assert.match(ui.text,/沒有價格計畫編號或審查核准收據/);
  assert(!ui.text.includes('價格產出時保存'));assert(!ui.text.includes('版本識別與原始審查文件'));assert(!find(ui.tree,'button').some(b=>text(b).includes('核准')));
 }finally{ui.close();}
});

test('pending responses cannot cross selected symbol, edition or Owner access changes',async()=>{
 const first=await fixture(),next=await fixture({symbol:'1001',dividendMethod:false}),ui=harness(first.scope);try{
  await ui.flush();ui.update({scope:next.scope});await ui.flush();assert(ui.calls[0].signal.aborted);assert.equal(ui.calls.length,2);
  await ui.respond(0,{data:first.response,error:null});assert(!ui.text.includes('NT$73.05'));assert.match(ui.text,/正在讀取/);
  await ui.respond(1,{data:next.response,error:null});assert.match(ui.text,/FCFE 折現情境/);
  const changed=structuredClone(next.scope);changed.edition.id='e'.repeat(64);ui.update({scope:changed});await ui.flush();assert(!ui.text.includes('FCFE 折現情境'));
  await ui.respond(2,{data:next.response,error:null});assert.match(ui.text,/暫時無法核對/);
  ui.update({access:{kind:'member',id:OWNER,generation:2,signal:new AbortController().signal,catalog:{tier:'premium'}}});assert.equal(ui.text,'');assert.equal(ui.calls.length,3);
 }finally{ui.close();}
});

test('logout hides loaded private preparation immediately and non-Owners never issue a request',async()=>{
 const f=await fixture(),controller=new AbortController(),ui=harness(f.scope,{...access(),signal:controller.signal});try{
  await ui.flush();await ui.respond(0,{data:f.response,error:null});assert.match(ui.text,/股利與末期本益比/);
  controller.abort();await ui.flush();assert.equal(ui.text,'');assert.equal(ui.calls.length,1);
 }finally{ui.close();}
 const denied=harness(f.scope,{...access(),catalog:{tier:'premium'}});try{await denied.flush();assert.equal(denied.calls.length,0);assert.equal(denied.text,'');}finally{denied.close();}
});

test('missing record, unavailable reader, invalid content and timeout remain distinct without inferred approval',async()=>{
 for(const kind of ['NONE','MISSING_READER','INVALID','TIMEOUT']){const f=await fixture(),ui=harness(f.scope);try{
  await ui.flush();if(kind==='TIMEOUT'){ui.timeout();await ui.flush();}
  else if(kind==='MISSING_READER')await ui.respond(0,{data:null,error:{code:'PGRST202',message:'PRIVATE_BACKEND_DETAIL'}});
  else{if(kind==='NONE')f.response.preparation=null;else f.response.preparation.calculation_text+=' ';await ui.respond(0,{data:f.response,error:null});}
  assert.match(ui.text,kind==='NONE'?/尚無已保存的準備物/:kind==='MISSING_READER'?/尚未提供長期估值準備讀取功能/:/暫時無法核對/);
  assert(!ui.text.includes('PRIVATE_BACKEND_DETAIL'));assert(!ui.text.includes('三項判斷仍待完成'));
 }finally{ui.close();}}
});


function ownerEnvelope(f){
 return {schema:'VNEXT_AI_OWNER_EDITION_V1',preview_only:true,
  edition:{...f.scope.edition,batch_id:'b'.repeat(64),jobs:72,periods:216},
  cards:Array.from({length:72},(_,index)=>['SHORT','MEDIUM','LONG'].map(horizon=>({...structuredClone(f.scope.card),symbol:String(1000+index),horizon,status:horizon==='LONG'?'INSUFFICIENT':'WAIT'}))).flat(),
  source_urls:[...new Set(f.scope.card.sources.map(source=>source.source))],rights_ready:false,integrity_ready:false,review_ready:false,publish_ready:false,review:null,publication:null};
}
const ownerFile='src/pages/vnext/OwnerAiPublication.tsx';
const ownerCompiled=ts.transpileModule(readFileSync(new URL('../'+ownerFile,import.meta.url),'utf8'),{fileName:ownerFile,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function ownerHarness(props,entry='default'){
 let cursor=0,dirty=false,tree,unmounted=false;const states=[],effects=[],queued=[],calls=[];
 const hooks={useRef(initial){const i=cursor++;return states[i]??={current:initial};},
  useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{assert(!unmounted);const value=typeof next==='function'?next(states[i]):next;if(!Object.is(value,states[i])){states[i]=value;dirty=true;}}];},
  useCallback(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))states[i]={fn,deps};return states[i].fn;},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const effect={deps};effects[i]=effect;queued.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}}};
 const jsx=(type,props)=>typeof type==='function'?(type.name==='OwnerAiEditionReview'?{type:'preview',props}:type(props)):({type,props}),exports={};
 vm.runInNewContext(ownerCompiled,{exports,Date,Intl,URL,crypto,AbortController,Promise,setInterval(){return 1;},clearInterval(){},document:{addEventListener(){},removeEventListener(){}},require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='@/features/vnext/contracts')return contracts;
  if(name==='@/features/vnext/dailyAiOwner')return ownerModule;if(name==='@/features/vnext/dailyAiMember')return memberModule;if(name==='@/features/vnext/dailyAiCopy')return copyModule;
  if(name==='./DailyAiOwnerPricePlans')return {default:props=>({type:'prices',props})};
  if(name==='./DailyAiOwnerLongPreparation')return {default:props=>({type:'preparation',props})};
  if(name==='@/lib/supabase')return {supabase:{rpc(name,args){let resolve;const promise=new Promise(done=>resolve=done),call={name,args,resolve,signal:null};calls.push(call);return {abortSignal(signal){call.signal=signal;return promise;}};}}};
  if(name.endsWith('.css'))return {};throw Error(name);
 }});
 const render=()=>{let count=0;do{assert(++count<25);dirty=false;cursor=0;tree=exports[entry](props);while(queued.length)queued.shift()();}while(dirty);};
 const flush=async()=>{for(let i=0;i<12;i++){await settle();if(dirty)render();}};render();
 return {calls,get text(){return text(tree);},get tree(){return tree;},flush,
  async respond(index,response){calls[index].resolve(response);await flush();},
  close(){for(const e of effects.filter(Boolean))e.cleanup?.();unmounted=true;}};
}

test('the actual Owner card exposes preparation before selection qualification and preserves the publication gate',async()=>{
 const f=await fixture(),data=ownerModule.parseDailyAiOwner(ownerEnvelope(f),NOW),selected=[];
 const ui=ownerHarness({data,onReview(){throw Error('NO_REVIEW_MUTATION');},onInspectLongPreparation:card=>selected.push(card)},'OwnerAiEditionReview');
 try{
  assert(!find(ui.tree,'button').some(b=>text(b)==='長期估值準備'));
  find(ui.tree,'button').find(b=>text(b).includes(contracts.HORIZONS.LONG.label)&&b.props['aria-pressed']!==undefined).props.onClick();await ui.flush();
  const buttons=find(ui.tree,'button').filter(b=>text(b)==='長期估值準備');assert.equal(buttons.length,9);buttons[0].props.onClick();
  assert.equal(selected[0],data.cards.find(c=>c.symbol==='1000'&&c.horizon==='LONG'));assert.equal(selected[0].status,'INSUFFICIENT');
  assert(find(ui.tree,'button').find(b=>text(b)==='核准本版會員閱讀').props.disabled);assert.equal(ui.calls.length,0);
 }finally{ui.close();}
});

test('the actual publication parent binds lazy preparation selection to the current edition snapshot and session',async()=>{
 const f=await fixture(),controller=new AbortController(),ui=ownerHarness({access:{...access(),signal:controller.signal}});
 try{
  await ui.flush();assert.equal(ui.calls[0].name,'get_daily_ai_owner_research_v1');const response=ownerEnvelope(f);await ui.respond(0,{data:response,error:null});
  const first=find(ui.tree,'preview')[0].props,card=first.data.cards.find(c=>c.horizon==='LONG');
  await first.onInspectLongPreparation(card);await ui.flush();assert.equal(find(ui.tree,'preparation').length,1);
  assert.equal(find(ui.tree,'preparation')[0].props.scope.card,card);assert.equal(find(ui.tree,'preparation')[0].props.scope.edition.id,f.scope.edition.id);
  find(ui.tree,'button').find(b=>text(b).includes('重新讀取每日 AI 審查')).props.onClick();await ui.flush();assert.equal(find(ui.tree,'preparation').length,0);
  const next=structuredClone(response);next.edition.id='e'.repeat(64);await ui.respond(1,{data:next,error:null});
  await first.onInspectLongPreparation(card);await ui.flush();assert.equal(find(ui.tree,'preparation').length,0,'old callbacks cannot reopen old private data');
  const second=find(ui.tree,'preview')[0].props;await second.onInspectLongPreparation(second.data.cards.find(c=>c.horizon==='LONG'));await ui.flush();
  assert.equal(find(ui.tree,'preparation')[0].props.scope.edition.id,next.edition.id);
  controller.abort();await ui.flush();assert.equal(ui.text,'');assert.equal(find(ui.tree,'preparation').length,0);
  assert.equal(ui.calls.length,2);assert(ui.calls.every(call=>call.name==='get_daily_ai_owner_research_v1'));
 }finally{ui.close();}
});
