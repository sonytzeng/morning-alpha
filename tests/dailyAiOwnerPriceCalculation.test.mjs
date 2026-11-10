// Synthetic fixtures exercise actual calculator bytes and actual TSX. This
// does not attest market assumptions, source rights or production readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../src/features/vnext/contracts.ts';
import * as calculationParser from '../src/features/vnext/dailyAiOwnerPriceCalculation.ts';
import {canonical} from '../research/entry-opportunity.ts';
import {createOwnerCalculationFixture,SYNTHETIC_CALCULATION_OWNER as OWNER} from './helpers/dailyAiOwnerPriceCalculationFixture.mjs';

const NOW=Date.parse('2026-11-10T08:10:00Z');
const fixture=horizon=>createOwnerCalculationFixture({horizon,now:NOW});
const parse=f=>calculationParser.parseDailyAiOwnerPriceCalculation(f.response,f.row,OWNER,NOW);
const realFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};});
test.after(()=>{globalThis.fetch=realFetch;});

// Re-hash outer envelopes to test semantic binding, not only stale-digest
// rejection. All documents remain synthetic and no review is inserted.
async function rebind(f,alter){
 const a=f.response.audit,i=JSON.parse(a.input_text),c=JSON.parse(a.calculation_text),n=JSON.parse(a.method_note_text),r=JSON.parse(a.review_request_text);
 await alter(i,c,n,r);
 a.input_text=canonical(i);a.input_hash=await contracts.snapshotHash(i);c.input_hash=a.input_hash;
 c.assumption_hash=await contracts.snapshotHash({method_id:i.method_id,assumption_basis:i.assumption_basis,parameters:i.parameters});
 a.calculation_text=canonical(c);a.calculation_hash=await contracts.snapshotHash(c);
 f.row.body.basis=c.basis+'\n計算紀錄 SHA-256：'+a.calculation_hash;f.row.plan_hash=await contracts.snapshotHash(f.row.body);f.response.plan_hash=f.row.plan_hash;
 n.derivation=c.method_note.derivation+'\n計算紀錄 SHA-256：'+a.calculation_hash+'\n輸入 SHA-256：'+a.input_hash+'\n假設 SHA-256：'+c.assumption_hash;
 a.method_note_text=canonical(n);a.method_note_hash=await contracts.snapshotHash(n);
 Object.assign(r,{plan_hash:f.row.plan_hash,input_hash:a.input_hash,calculation_hash:a.calculation_hash,assumption_hash:c.assumption_hash,method_document_hash:a.method_note_hash});
 a.review_request_text=canonical(r);a.review_request_hash=await contracts.snapshotHash(r);
}

test('real SHORT/MEDIUM/LONG calculations disclose their saved formula inputs without approval',async()=>{
 for(const horizon of ['SHORT','MEDIUM','LONG']){
  const f=await fixture(horizon),result=await parse(f),a=result.audit;
  assert.equal(a.horizon,horizon);assert.equal(a.assumptions_after_cutoff,true);assert.equal(a.method_id,f.input.method_id);
  assert.equal(a.sources.length,f.row.body.evidence_ids.length);assert.equal(f.row.can_approve,false);assert.equal(f.row.review,null);
  assert.equal(a.input_hash,f.result.calculation.input_hash);assert.equal(a.calculation_hash,f.result.calculation.calculation_hash);
  assert(Object.isFrozen(result));assert(Object.isFrozen(a.sources[0]));assert(Object.isFrozen(a.raw));
  if(horizon==='SHORT'){assert.equal(a.short.atr,4.5);assert.deepEqual(a.short.true_ranges,[5,4]);assert.equal(a.short.corporate_actions_evidence_id,'A1');}
  else if(horizon==='MEDIUM'){assert.deepEqual(a.scenarios.map(s=>s.value),[80,120,168]);assert.equal(a.scenarios[1].eps,10);assert.equal(a.scenarios[1].pe,12);}
  else{assert.equal(a.scenarios[1].value,100);assert.equal(a.scenarios[1].cashflows.length,5);assert.equal(a.scenarios[1].terminal.next_fcfe,10);}
 }
});

test('legacy missing audit remains a distinct null state while edition/plan/subject stay bound',async()=>{
 const f=await fixture('MEDIUM');f.response.audit=null;assert.equal((await parse(f)).audit,null);
 for(const change of [r=>r.subject_user_id='00000000-0000-4000-8000-000000000202',r=>r.edition_id='c'.repeat(64),r=>r.plan_hash='d'.repeat(64),r=>r.preview_only=false]){
  const bad=structuredClone(f);change(bad.response);await assert.rejects(()=>parse(bad),/OWNER_PRICE_CALCULATION_SCOPE/);
 }
});

test('reported-quarter EPS is displayed as disclosed ratio sum and the second LONG model stays separate from FCFE',async()=>{
 const medium=await createOwnerCalculationFixture({horizon:'MEDIUM',reportedEps:true,now:NOW});
 const disclosed=await parse(medium);assert.equal(disclosed.audit.reported_eps.reported_sum_decimal,'10.00');assert.equal(disclosed.audit.reported_eps.quarters.length,4);
 assert.equal(disclosed.audit.earnings_basis,'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM');assert.deepEqual(medium.row.body.entry_range,[80,96]);
 const long=await createOwnerCalculationFixture({horizon:'LONG',dividendMethod:true,now:NOW}),result=await parse(long);
 assert.equal(result.audit.method_id,'LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1');assert.deepEqual(long.row.body.entry_range,[73.05,86.28]);
 assert.equal(result.audit.scenarios[0].value,91.32231404958678);assert.equal(result.audit.scenarios[0].dividend.base_eps,10);
 assert.equal(result.audit.scenarios[0].dividend.years[0].dividend,5);assert.equal(result.audit.scenarios[0].terminal,null);assert.equal(result.audit.scenarios[0].cashflows.length,0);
 for(const f of [medium,long]){const ui=harness(f.row);try{await ui.flush();await ui.respond(0,{data:f.response,error:null});
  assert.match(ui.text,/四季揭露稀釋 EPS 合計/);assert.match(ui.text,/沒有重新加權年度股數分母/);
  if(f===long){assert.match(ui.text,/股利與末期本益比折現情境/);assert.match(ui.text,/逐年 EPS、股利與末期股價/);assert(!ui.text.includes('逐年 FCFE 與終值'));}
 }finally{ui.close();}}
});

test('every retained document is checked against its exact bytes and canonical object',async()=>{
 for(const key of ['input_text','calculation_text','method_note_text','review_request_text']){
  const f=await fixture('MEDIUM');f.response.audit[key]+=' ';await assert.rejects(()=>parse(f),/HASH_MISMATCH/);
 }
 const f=await fixture('MEDIUM');f.response.audit.calculation_text+=' ';
 f.response.audit.calculation_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.response.audit.calculation_text))),b=>b.toString(16).padStart(2,'0')).join('');
 await assert.rejects(()=>parse(f),/CANONICAL_HASH/);
});

test('a rehashed same-ID source mutation still fails its saved complete evidence binding',async()=>{
 const f=await fixture('MEDIUM');await rebind(f,i=>{i.evidence[0].content='Replaced test content';});
 await assert.rejects(()=>parse(f),/EVIDENCE_BINDING/);
});

test('unsafe source links and wrong stock identities fail even with consistent replacement hashes',async()=>{
 for(const mutation of [s=>s.source='https://user:password@example.invalid/source',s=>s.symbol='2000']){
  const f=await fixture('MEDIUM');await rebind(f,async(i,c)=>{mutation(i.evidence[0]);c.evidence_bindings.find(b=>b.id===i.evidence[0].id).evidence_hash=await contracts.snapshotHash(i.evidence[0]);});
  await assert.rejects(()=>parse(f),/EVIDENCE_(SOURCE|BINDING)/);
 }
});

test('a fabricated review decision, a changed result or a changed temporal meaning cannot be displayed',async()=>{
 for(const mutate of [(_i,c)=>c.production_eligible=true,(_i,c)=>c.entry_range=[1,2],(_i,c)=>c.trace.temporal_scope.assumption_timing='ASSUMPTIONS_AVAILABLE_BY_SOURCE_CUTOFF',(_i,_c,_n,r)=>r.source_use_approved=true]){
  const f=await fixture('MEDIUM');await rebind(f,mutate);await assert.rejects(()=>parse(f),/OWNER_PRICE_CALCULATION_/);
 }
});

test('parser owns its input before asynchronous hashing and keeps expired Owner history readable',async()=>{
 const f=await fixture('LONG'),pending=parse(f);f.response.audit.calculation_text='changed';f.row.body.entry_range=[1,2];
 assert.equal((await pending).audit.scenarios[1].value,100);
 const historical=await fixture('MEDIUM'),parsed=await calculationParser.parseDailyAiOwnerPriceCalculation(historical.response,historical.row,OWNER,NOW+3*3600000);
 assert.equal(parsed.audit.expires_at,historical.row.body.expires_at);assert.equal(historical.row.can_approve,false);
});

const file='src/pages/vnext/DailyAiOwnerPriceCalculation.tsx';
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const find=(node,type)=>Array.isArray(node)?node.flatMap(n=>find(n,type)):!node||typeof node!=='object'?[]:[...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const settle=()=>new Promise(resolve=>setTimeout(resolve,2));
const access=()=>({kind:'member',id:OWNER,generation:1,signal:new AbortController().signal,catalog:{tier:'owner'}});
function harness(row,initialAccess=access()){
 let props={row,access:initialAccess,onClose(){}},cursor=0,dirty=false,tree,unmounted=false;const states=[],effects=[],queued=[],calls=[],timers=new Map();let nextTimer=0;
 const hooks={useRef(initial){const i=cursor++;return states[i]??={current:initial};},
  useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{assert(!unmounted);const value=typeof next==='function'?next(states[i]):next;if(!Object.is(value,states[i])){states[i]=value;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const effect={deps};effects[i]=effect;queued.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}}};
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props}),exports={};
 vm.runInNewContext(compiled,{exports,Date,Intl,URL,AbortController,Error,Promise,setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='@/features/vnext/contracts')return contracts;
  if(name==='@/features/vnext/dailyAiOwnerPriceCalculation')return calculationParser;
  if(name==='@/lib/supabase')return {supabase:{rpc(name,args){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;}),call={name,args,resolve,reject,signal:null};calls.push(call);return {abortSignal(signal){call.signal=signal;return promise;}};}}};
  if(name.endsWith('.css'))return {};throw Error(name);
 }});
 const render=()=>{let count=0;do{assert(++count<25);dirty=false;cursor=0;tree=exports.default(props);while(queued.length)queued.shift()();}while(dirty);};
 const flush=async()=>{for(let i=0;i<15;i++){await settle();if(dirty)render();}};render();
 return {calls,get text(){return text(tree);},get tree(){return tree;},flush,update(change){props={...props,...change};render();},
  async respond(index,response){calls[index].resolve(response);await flush();},timeout(){for(const fn of [...timers.values()])fn();},
  close(){for(const e of effects.filter(Boolean))e.cleanup?.();unmounted=true;}};
}

test('actual Owner inspector uses only the fixed single-plan reader and shows substantive formula details',async()=>{
 const f=await fixture('MEDIUM'),ui=harness(f.row);try{
  await ui.flush();assert.equal(ui.calls.length,1);assert.deepEqual(structuredClone(ui.calls[0].args),{p_edition_id:f.row.body.edition_id,p_plan_hash:f.row.plan_hash});
  assert.equal(ui.calls[0].name,'get_daily_ai_owner_price_calculation_v1');await ui.respond(0,{data:f.response,error:null});
  assert.match(ui.text,/稀釋 EPS × 本益比情境/);assert.match(ui.text,/NT\$120/);assert.match(ui.text,/假設形成在來源截止之後/);assert.match(ui.text,/合成流程驗證/);
  assert(find(ui.tree,'table').length===1);assert(find(ui.tree,'a').every(a=>a.props.rel==='noopener noreferrer'));assert(!ui.text.includes('核准此價格計畫'));
 }finally{ui.close();}
});

test('pending responses cannot cross an Owner session change or a selected plan change',async()=>{
 const medium=await fixture('MEDIUM'),long=await fixture('LONG'),ui=harness(medium.row);try{
  await ui.flush();ui.update({row:long.row});await ui.flush();assert.equal(ui.calls[0].signal.aborted,true);assert.equal(ui.calls.length,2);
  await ui.respond(0,{data:medium.response,error:null});assert(!ui.text.includes('NT$120'));assert.match(ui.text,/正在讀取/);
  await ui.respond(1,{data:long.response,error:null});assert.match(ui.text,/FCFE 折現情境/);
  ui.update({access:{kind:'member',id:OWNER,generation:2,signal:new AbortController().signal,catalog:{tier:'premium'}}});
  assert.equal(ui.text,'');assert.equal(ui.calls.length,2);
 }finally{ui.close();}
});

test('aborting current access hides already loaded private contents immediately without another request',async()=>{
 const f=await fixture('SHORT'),controller=new AbortController(),identity={...access(),signal:controller.signal},ui=harness(f.row,identity);try{
  await ui.flush();await ui.respond(0,{data:f.response,error:null});assert.match(ui.text,/ATR 計算值/);
  controller.abort();await ui.flush();assert.equal(ui.text,'');assert.equal(ui.calls.length,1);
 }finally{ui.close();}
});

test('reader absence, hash failure and timeout show read failure instead of invented review success',async()=>{
 for(const result of ['MISSING_READER','INVALID_HASH','TIMEOUT']){
  const f=await fixture('MEDIUM'),ui=harness(f.row);try{
   await ui.flush();if(result==='TIMEOUT'){ui.timeout();await ui.flush();}
   else if(result==='MISSING_READER')await ui.respond(0,{data:null,error:{code:'PGRST202',message:'SHOULD_NOT_RENDER'}});
   else{f.response.audit.calculation_text+=' ';await ui.respond(0,{data:f.response,error:null});}
   assert.match(ui.text,result==='MISSING_READER'?/尚未提供計算明細讀取功能/:/計算明細暫時無法核對/);
   assert.match(ui.text,/價格與獨立審查狀態未變更/);assert(!ui.text.includes('SHOULD_NOT_RENDER'));assert(!ui.text.includes('NT$120'));
   assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].signal.aborted,true);
  }finally{ui.close();}
 }
});
