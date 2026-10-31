// Exercise the actual component with a deterministic clock and hook lifecycle.
// No browser, production transport, database writes or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../src/features/vnext/contracts.ts';
import * as member from '../src/features/vnext/dailyAiMember.ts';
import * as copy from '../src/features/vnext/dailyAiCopy.ts';

const file='src/pages/vnext/DailyAiMemberResearch.tsx';
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const START=Date.parse('2026-10-31T10:00:00Z');
const research=(expiresAt=START+4379,id='a')=>({business_date:'2026-10-31',tier:'premium',research_only:true,
 edition:{id:id.repeat(64),edition_date:'2026-10-31',data_through:'2026-10-30',evidence_cutoff:'2026-10-31T09:00:00Z',
  prepared_at:'2026-10-31T09:30:00Z',expires_at:new Date(expiresAt).toISOString(),mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
 cards:['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:'2330',company:'測試公司',horizon,status:'WAIT',reason:{text:'等待已列條件確認。',evidence_ids:['E1']},
  confirmation:'等待正式公告確認',invalidation:'新的證據否定判斷',gaps:[],counter_evidence:[],sources:[]}))});
const jsx=(type,props)=>({type,props});
const find=(node,type)=>Array.isArray(node)?node.flatMap(n=>find(n,type)):!node||typeof node!=='object'?[]:
 [...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';

function harness(initial=research()){
 let clock=START,data=initial,cursor=0,tree,dirty=false,unmounted=false,sequence=0,updates=0;
 const state=[],effects=[],pending=[],timers=new Map(),listeners=new Set();
 const hooks={
  useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;
   return [state[index],value=>{assert(!unmounted,'no state updates after unmount');updates++;const next=typeof value==='function'?value(state[index]):value;
    if(!Object.is(state[index],next)){state[index]=next;dirty=true;}}];},
  useEffect(fn,deps){const index=cursor++,old=effects[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){
   const effect={fn,deps,cleanup:old?.cleanup};effects[index]=effect;pending.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}},
 };
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const schedule=(fn,ms,interval)=>{const id=++sequence;timers.set(id,{fn,ms,due:clock+ms,interval});return id;};
 const exports={};
 vm.runInNewContext(compiled,{exports,Date:ClockDate,Intl,URL,
  setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>timers.delete(id),
  setTimeout:(fn,ms)=>schedule(fn,ms,false),clearTimeout:id=>timers.delete(id),
  document:{addEventListener(name,fn){assert.equal(name,'visibilitychange');listeners.add(fn);},removeEventListener(name,fn){assert.equal(name,'visibilitychange');listeners.delete(fn);}},
  require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
   if(name==='@/features/vnext/contracts')return contracts;if(name==='@/features/vnext/dailyAiMember')return member;
   if(name==='@/features/vnext/dailyAiCopy')return copy;if(name.endsWith('.css'))return {};
   throw Error('UNAPPROVED_EXPIRY_IMPORT:'+name);}
 },{filename:file});
 function render(){assert(!unmounted);let attempts=0;do{assert(++attempts<20);dirty=false;cursor=0;tree=exports.default({data});
  while(pending.length)pending.shift()();}while(dirty);return tree;}
 function advance(ms){const target=clock+ms;for(;;){const entry=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];
  if(!entry)break;const [id,timer]=entry;clock=timer.due;if(timer.interval)timer.due+=timer.ms;else timers.delete(id);timer.fn();if(!unmounted)render();}
  clock=target;if(!unmounted)render();}
 render();
 return {advance,render,get articles(){return find(tree,'article');},get text(){return text(tree);},get updates(){return updates;},
  get timers(){return [...timers.values()].map(t=>({due:t.due,interval:t.interval}));},get listeners(){return listeners.size;},
  replace(next){data=next;render();},
  visibilityAt(next){clock=next;for(const fn of [...listeners])fn();render();},
  unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();unmounted=true;},
 };
}

test('actual member research remains visible 1ms before expiry and disappears exactly at expiry without waiting15s',()=>{
 const h=harness();assert.equal(h.articles.length,1);assert.equal(h.timers.length,2);assert(h.timers.some(t=>t.interval&&t.due===START+15000));
 h.advance(4378);assert.equal(h.articles.length,1);assert(!h.text.includes('這個研究版本已到期'));
 h.advance(1);assert.equal(h.articles.length,0);assert(h.text.includes('這個研究版本已到期'));h.unmount();
});
test('replacing edition cleans the old exact deadline and retains the new expiry deadline',()=>{
 const h=harness(research(START+2000));h.advance(1000);h.replace(research(START+7001,'b'));
 assert.equal(h.timers.length,2);assert(!h.timers.some(t=>!t.interval&&t.due===START+2000));
 h.advance(1000);assert.equal(h.articles.length,1);h.advance(5000);assert.equal(h.articles.length,1);
 h.advance(1);assert.equal(h.articles.length,0);assert(h.text.includes('這個研究版本已到期'));h.unmount();
});
test('replacing with an earlier expiry schedules that deadline immediately',()=>{
 const h=harness(research(START+60000));h.advance(100);h.replace(research(START+101,'c'));h.advance(1);
 assert.equal(h.articles.length,0);assert(h.text.includes('這個研究版本已到期'));h.unmount();
});
test('unmount removes interval, expiry timeout and visibility listener without subsequent state updates',()=>{
 const h=harness();const before=h.updates;assert.equal(h.listeners,1);h.unmount();assert.equal(h.timers.length,0);assert.equal(h.listeners,0);
 h.advance(60000);assert.equal(h.updates,before);
});
test('visibility catchup expires suspended research and backward wall-clock changes cannot revive it',()=>{
 const h=harness();h.visibilityAt(START+5000);assert.equal(h.articles.length,0);
 h.visibilityAt(START+1000);assert.equal(h.articles.length,0);assert(h.text.includes('這個研究版本已到期'));h.unmount();
});
