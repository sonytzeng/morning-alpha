// Synthetic offline component harness; no browser, auth or network service.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../src/features/vnext/contracts.ts';
import * as member from '../src/features/vnext/dailyAiMember.ts';
import * as copy from '../src/features/vnext/dailyAiCopy.ts';
import * as pricePlans from '../src/features/vnext/dailyAiPricePlan.ts';
import * as priceDisplay from '../src/features/vnext/dailyAiPriceDisplay.ts';
import * as ownerPrices from '../src/features/vnext/dailyAiOwnerPricePlans.ts';
const file='src/pages/vnext/DailyAiMemberResearch.tsx';
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const find=(node,type)=>Array.isArray(node)?node.flatMap(n=>find(n,type)):!node||typeof node!=='object'?[]:[...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
export function renderPriceDelivery({data,plans,subject,horizon,now=Date.now()+2}){
 const props={data,pricePlans:plans,priceSubjectUserId:subject,selectedHorizon:horizon};
 let cursor=0,dirty=false,tree;const states=[],effects=[],pending=[];
 const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;
  return [states[i],next=>{next=typeof next==='function'?next(states[i]):next;if(!Object.is(next,states[i])){states[i]=next;dirty=true;}}];},
 useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const effect={deps};effects[i]=effect;pending.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}}};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props});const exports={};
 vm.runInNewContext(compiled,{exports,Date:Clock,Intl,URL,setInterval:()=>0,clearInterval:()=>{},setTimeout:()=>0,clearTimeout:()=>{},
  document:{addEventListener:()=>{},removeEventListener:()=>{}},require(name){
   if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
   const modules={'@/features/vnext/contracts':contracts,'@/features/vnext/dailyAiMember':member,'@/features/vnext/dailyAiCopy':copy,'@/features/vnext/dailyAiPricePlan':pricePlans,'@/features/vnext/dailyAiPriceDisplay':priceDisplay};
   if(name in modules)return modules[name];if(name.endsWith('.css'))return {};throw Error(name);
  }});
 const render=()=>{let n=0;do{assert(++n<20);dirty=false;cursor=0;tree=exports.default(props);while(pending.length)pending.shift()();}while(dirty);};render();
 return {get text(){return text(tree);},get firstTwoCards(){return find(tree,'article').slice(0,2).map(text);},
  get firstTwoPriceFields(){return find(tree,'article').slice(0,2).flatMap(n=>find(n,'dd').map(text));},
  get comparison(){return find(tree,'table').map(text).join('');},
  selectTwo(){for(let i=0;i<2;i++){find(tree,'input').filter(n=>n.props.type==='checkbox')[i].props.onChange();render();}assert.equal(find(tree,'table').length,1);},
  close(){for(const e of effects.filter(Boolean))e.cleanup?.();}};
}

export function renderOwnerPriceDelivery(data){
 const filename='src/pages/vnext/DailyAiOwnerPricePlans.tsx';
 const script=ts.transpileModule(readFileSync(new URL('../'+filename,import.meta.url),'utf8'),{fileName:filename,
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props}),exports={};
 const react={useState:init=>[typeof init==='function'?init():init,()=>{}],useEffect:()=>{},useCallback:fn=>fn,useRef:value=>({current:value})};
 vm.runInNewContext(script,{exports,Date,Intl,URL,AbortController,JSON,require(name){
  if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
  if(name==='@/lib/supabase')return {supabase:{rpc(){throw Error('REAL_RPC_FORBIDDEN');}}};
  if(name==='@/features/vnext/contracts')return contracts;if(name==='@/features/vnext/dailyAiOwnerPricePlans')return ownerPrices;
  if(name==='@/features/vnext/dailyAiPriceDisplay')return priceDisplay;if(name.endsWith('.css'))return {};throw Error(name);
 }});
 const tree=exports.DailyAiOwnerPricePreview({data,onReview(){throw Error('SYNTHETIC_PREVIEW_MUST_NOT_PUBLISH');}});
 return {text:text(tree),raw:find(tree,'pre').map(text),articles:find(tree,'article').map(text),
  approveButtons:find(tree,'button').filter(b=>b.props.children==='核准此價格計畫')};
}
