// Actual member component with synthetic approved projections. No transport,
// production identities, provider requests or database mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../src/features/vnext/contracts.ts';
import * as member from '../src/features/vnext/dailyAiMember.ts';
import * as copy from '../src/features/vnext/dailyAiCopy.ts';
import * as pricePlans from '../src/features/vnext/dailyAiPricePlan.ts';
const start=Date.parse('2026-11-04T08:00:00Z'),subject='00000000-0000-0000-0000-000000000001';
const filename='src/pages/vnext/DailyAiMemberResearch.tsx';
const compiled=ts.transpileModule(readFileSync(new URL('../'+filename,import.meta.url),'utf8'),{fileName:filename,
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture(){return {schema:'VNEXT_AI_MEMBER_EDITION_V1',tier:'premium',business_date:'2026-11-04',research_only:true,
 edition:{id:'a'.repeat(64),edition_date:'2026-11-04',data_through:'2026-11-03',evidence_cutoff:'2026-11-04T07:00:00Z',prepared_at:'2026-11-04T07:30:00Z',expires_at:'2026-11-04T08:00:10Z',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
 cards:Array.from({length:4},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),company:'合成公司'+i,horizon,status:'WAIT',
 reason:{text:horizon+'合成理由',evidence_ids:['P1']},confirmation:'等待核對',invalidation:'新公告否定時重評',gaps:['COMPANY_NEWS_NOT_CAPTURED'],sources:[],counter_evidence:[],classification:'INFERENCE'}))).flat()};}
const jsx=(type,props)=>typeof type==='function'?type(props):({type,props});
const find=(node,type)=>Array.isArray(node)?node.flatMap(n=>find(n,type)):!node||typeof node!=='object'?[]:[...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const content=node=>Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children):node??'';
function harness(data=fixture()){
 let props={data,priceSubjectUserId:subject,selectedHorizon:'SHORT'},clock=start,cursor=0,dirty=false,tree;
 const states=[],effects=[],pending=[],listeners=new Set(),timeouts=new Set();
 const hooks={useState(initial){const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;
  return [states[index],next=>{next=typeof next==='function'?next(states[index]):next;if(!Object.is(next,states[index])){states[index]=next;dirty=true;}}];},
 useEffect(fn,deps){const index=cursor++,old=effects[index];if(!old||deps.some((v,i)=>!Object.is(v,old.deps[i]))){const effect={deps,cleanup:old?.cleanup};effects[index]=effect;pending.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}}};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const exports={};vm.runInNewContext(compiled,{exports,Date:Clock,Intl,URL,setInterval:()=>0,clearInterval:()=>{},
 setTimeout(fn,ms){const timer={fn,due:clock+ms};timeouts.add(timer);return timer;},clearTimeout:timer=>timeouts.delete(timer),
 document:{addEventListener:(name,fn)=>listeners.add(fn),removeEventListener:(name,fn)=>listeners.delete(fn)},
 require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
 if(name==='@/features/vnext/contracts')return contracts;if(name==='@/features/vnext/dailyAiMember')return member;
 if(name==='@/features/vnext/dailyAiCopy')return copy;if(name==='@/features/vnext/dailyAiPricePlan')return pricePlans;
 if(name.endsWith('.css'))return {};throw Error(name);}});
 const render=()=>{let iterations=0;do{assert(++iterations<20);dirty=false;cursor=0;tree=exports.default(props);while(pending.length)pending.shift()();}while(dirty);return tree;};
 render();return {get data(){return props.data;},get text(){return content(tree);},get tables(){return find(tree,'table');},get choices(){return find(tree,'input').filter(n=>n.props.type==='checkbox');},
 choose(index){const event=this.choices[index].props.onChange;event();render();return ()=>{event();render();};},
 replace(change){props={...props,...change};render();},
 selectTwo(){this.choose(0);this.choose(1);assert.equal(this.tables.length,1);},
 at(next){clock=next;for(const timer of [...timeouts])if(timer.due<=clock){timeouts.delete(timer);timer.fn();}for(const fn of listeners)fn();render();},
 unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();}};
}

test('comparison accepts only2–3 current-period cards and never treats missing prices as a price',()=>{
 const h=harness();h.selectTwo();assert(h.text.includes('本版未提供已驗證價格區間'));
 h.choose(2);assert.equal(h.choices[3].props.disabled,true);assert.equal(find(h.tables[0],'th').filter(n=>n.props.scope==='col').length,4);
 assert(!content(h.tables[0]).includes('MEDIUM合成理由'));assert(!content(h.tables[0]).includes('LONG合成理由'));h.unmount();
});
test('account, tier, edition, horizon and changed same-edition content clear comparison before old callbacks can revive it',()=>{
 for(const change of [h=>({priceSubjectUserId:'00000000-0000-0000-0000-000000000002'}),
  h=>({data:{...h.data,tier:'free',cards:h.data.cards.map(c=>({...c,sources:null,counter_evidence:null}))}}),
  h=>({data:{...h.data,edition:{...h.data.edition,id:'b'.repeat(64)}}}),h=>({selectedHorizon:'MEDIUM'}),
  h=>({data:{...h.data,cards:h.data.cards.map((c,i)=>i?c:{...c,reason:{...c.reason,text:'同版內容已更新'}})}})]){
  const h=harness();const stale=h.choose(0);h.choose(1);assert.equal(h.tables.length,1);h.replace(change(h));
  assert.equal(h.tables.length,0);assert(h.choices.every(c=>!c.props.checked));stale();assert.equal(h.tables.length,0);h.unmount();
 }
});
test('equivalent fresh reads preserve selection while unknown subject and research expiry hide it',()=>{
 const h=harness();h.selectTwo();h.replace({data:structuredClone(h.data)});assert.equal(h.tables.length,1);
 h.replace({priceSubjectUserId:undefined});assert.equal(h.tables.length,0);assert.equal(h.choices.length,0);
 h.replace({priceSubjectUserId:subject});assert.equal(h.tables.length,0);h.selectTwo();h.at(start+10000);assert.equal(h.tables.length,0);
 assert(h.text.includes('這個研究版本已到期'));h.at(start+1000);assert.equal(h.tables.length,0);h.unmount();
});
test('verified price expiry clears comparison and cannot display the prior numeric plan after reselecting',()=>{
 const h=harness(),plan={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:h.data.edition.id,symbol:'1000',horizon:'SHORT',status:'VERIFIED',currency:'TWD',method:'SYNTHETIC_TEST',basis:'合成價格依據',entry_range:[100,105],wait_above:105,stop_kind:'PRICE',stop:95,stop_evidence_ids:['P1'],invalidation:'合成重評條件',evidence_ids:['P1'],as_of:'2026-11-04T07:30:00Z',expires_at:'2026-11-04T08:00:04Z',buy_ready:false,plan_hash:'d'.repeat(64),review:{status:'PASS',plan_hash:'d'.repeat(64),reviewed_at:'2026-11-04T07:40:00Z',document_hash:'e'.repeat(64)}};
 h.replace({pricePlans:{schema:'VNEXT_AI_MEMBER_PRICE_PLANS_V1',edition_id:h.data.edition.id,tier:'premium',subject_user_id:subject,research_only:true,plans:[plan],source_sets:[]}});
 h.selectTwo();assert(content(h.tables[0]).includes('NT$100～105'));h.at(start+4000);assert.equal(h.tables.length,0);h.selectTwo();assert(!content(h.tables[0]).includes('NT$100～105'));h.unmount();
});
