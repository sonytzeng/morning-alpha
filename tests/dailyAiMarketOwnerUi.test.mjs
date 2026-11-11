// Actual React Owner component with deterministic hooks and synthetic RPC data.
// No browser/network/provider calls. Real candidate SQL is tested separately.
import test from'node:test';
import assert from'node:assert/strict';
import {readFileSync}from'node:fs';
import vm from'node:vm';
import {URL}from'node:url';
import {setImmediate}from'node:timers';
import ts from'typescript';
import * as contracts from'../src/features/vnext/contracts.ts';
import * as market from'../src/features/vnext/dailyAiMarketPageV2.ts';
import * as owner from'../src/features/vnext/dailyAiMarketOwner.ts';
import {ownerMarketWire,WIRE_OWNER}from'./helpers/dailyAiMarketOwnerWire.mjs';
import {marketSnapshotHash}from'../research/taiwan-market-universe.mjs';
const {AbortController,structuredClone}=globalThis;
const NOW=Date.parse('2026-11-11T10:00:00Z'),grant=(generation=1,tier='owner',id=WIRE_OWNER)=>({kind:'member',id,generation,signal:new AbortController().signal,catalog:{tier}});
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const find=(node,type)=>Array.isArray(node)?node.flatMap(v=>find(v,type)):!node||typeof node!=='object'?[]:[...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const compiled=ts.transpileModule(readFileSync(new URL('../src/pages/vnext/OwnerMarketReview.tsx',import.meta.url),'utf8'),{fileName:'OwnerMarketReview.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(initial=grant(),stored=new Map(),failStorage=false){
 let access=initial,clock=NOW,cursor=0,tree,dirty=false,unmounted=false,timerId=0,retries=0;
 const slots=[],effects=[],queue=[],asyncWork=[],timers=new Map(),rpc=[];
 const hooks={useRef(v){const i=cursor++;return slots[i]??={current:v};},useState(v){const i=cursor++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return[slots[i],next=>{assert(!unmounted,'state after unmount');const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const effect={deps,cleanup:old?.cleanup};effects[i]=effect;queue.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}}};
 const sessionStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>{if(failStorage)throw Error('STORAGE_UNAVAILABLE');stored.set(k,v);},removeItem:k=>stored.delete(k)};
 const transport={rpc(name,args){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});const call={name,args,resolve:(data,error=null)=>resolve({data,error}),reject};rpc.push(call);return{abortSignal(signal){call.signal=signal;return promise;}};}};
 const tracked={...owner,parseOwnerMarketCatalog:(v,s)=>owner.parseOwnerMarketCatalog(v,s,clock),ownerMarketReady:(p,n)=>owner.ownerMarketReady(p,n??clock),ownerMarketPublished:(p,n)=>owner.ownerMarketPublished(p,n??clock)};
 for(const method of ['parseOwnerMarketPage','parseOwnerMarketInput','parseOwnerMarketReferences','createOwnerMarketCommand','parseOwnerMarketMutationReceipt','parseOwnerMarketCommandReceipt'])tracked[method]=(...args)=>{
  if(method==='parseOwnerMarketPage')args[3]=clock;if(method==='createOwnerMarketCommand')args[4]=clock;const p=owner[method](...args);asyncWork.push(p);return p;};
 const schedule=(fn,ms,interval=false)=>{const id=++timerId;timers.set(id,{fn,due:clock+ms,ms,interval});return id;};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props}),exports={};
 vm.runInNewContext(compiled,{exports,Date:Clock,Intl,URL,JSON,AbortController,structuredClone,crypto:globalThis.crypto,
  setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>timers.delete(id),window:{sessionStorage},
  require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/lib/supabase')return{supabase:transport};
   if(name==='@/features/vnext/dailyAiMarketOwner')return tracked;if(name==='@/features/vnext/dailyAiMarketPageV2')return market;if(name==='@/features/vnext/contracts')return contracts;
   if(name==='../academy/useAcademyAccess')return{};if(name==='./MemberNavigation')return{default:'Navigation'};if(name.endsWith('.css'))return{};throw Error('UNAPPROVED_IMPORT:'+name);}});
 function render(){let loops=0;do{assert(++loops<25);dirty=false;cursor=0;tree=exports.OwnerMarketReviewContent({access,retry:()=>{retries++;}});while(queue.length)queue.shift()();}while(dirty);return tree;}
 async function flush(){for(let i=0;i<6;i++){await Promise.allSettled(asyncWork.splice(0));await settle();render();}}
 render();return{rpc,stored,sessionStorage,flush,render,get tree(){return tree;},get text(){return text(tree);},get retries(){return retries;},get clock(){return clock;},get timers(){return timers.size;},get articles(){return find(tree,'article');},get selects(){return find(tree,'select');},get buttons(){return find(tree,'button');},
  async resolve(call,data,error=null){call.resolve(data,error);await flush();},async replace(value){access=value;render();await flush();},
  async click(label){const button=find(tree,'button').find(b=>text(b)===label);assert(button,label);assert(!button.props.disabled,'disabled '+label);button.props.onClick?.();render();await flush();},
  async change(name,value){const node=[...find(tree,'input'),...find(tree,'textarea'),...find(tree,'select')].find(n=>n.props.name===name);assert(node,name);node.props.onChange({target:{value}});render();await flush();},
  async audience(value){const field=find(tree,'select').find(s=>find(s,'option').some(o=>o.props.value==='premium'));assert(field);field.props.onChange({target:{value}});render();await flush();},
  async submit(){const form=find(tree,'form').find(f=>find(f,'textarea').some(t=>t.props.name==='review-reason'));assert(form);form.props.onSubmit({preventDefault(){}});render();await flush();},
  async search(){const form=find(tree,'form').find(f=>f.props['aria-label']==='搜尋本版全市場公司');assert(form);form.props.onSubmit({preventDefault(){}});render();await flush();},
  async advance(ms){const target=clock+ms;for(;;){const next=[...timers].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;clock=next[1].due;if(next[1].interval)next[1].due+=next[1].ms;else timers.delete(next[0]);next[1].fn();render();}clock=target;await flush();},
  async unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();unmounted=true;await Promise.allSettled(asyncWork.splice(0));await settle();}};
}
async function loaded(options={},stored,failStorage=false){const h=harness(grant(),stored,failStorage);await h.flush();const wire=ownerMarketWire(NOW,options);assert.equal(h.rpc[0].name,'get_daily_ai_owner_market_catalog_v2');await h.resolve(h.rpc[0],wire.catalog);assert.equal(h.rpc[1].name,'get_daily_ai_owner_market_page_v2');await h.resolve(h.rpc[1],wire.page());return{h,wire};}
async function fill(h){for(const kind of owner.MARKET_REVIEW_KINDS){await h.change(kind+'-status','PENDING');await h.change(kind+'-url','https://example.com/SYNTHETIC/'+kind);await h.change(kind+'-notes','這是合成測試判斷說明，並非實際審查。');}await h.change('review-reason','這是合成測試整體說明，並非投資結論。');}
const storedCommand=h=>JSON.parse(h.stored.get(owner.ownerMarketJournalKey(WIRE_OWNER)));
function savedReview(command){return{schema:'DAILY_AI_OWNER_MARKET_REVIEW_RECEIPT_V2',edition_id:command.edition_id,review_id:'11111111-1111-4111-8111-111111111111',replayed:false,member_published:false,subject_user_id:WIRE_OWNER,request_key:command.request_key,submission_hash:command.request_hash,review_hash:'f'.repeat(64)};}

const searchWire=(wire,query)=>({schema:'VNEXT_AI_OWNER_MARKET_SEARCH_V2',subject_user_id:WIRE_OWNER,preview_only:true,research_only:true,
 edition_id:wire.edition.id,universe_hash:'e'.repeat(64),query,limit:20,checked_at:new Date(NOW).toISOString(),has_more:false,
 companies:[{security_id:'TWSE:2330',market:'TWSE',symbol:'2330',company:'台灣積體電路製造股份有限公司',short_name:'台積電'}]});
test('Owner page preserves SQL tuple order for a four-digit stock and six-digit TDR sharing its prefix',async()=>{
 // Synthetic values; the 9103/910322 prefix is the retained real-page failure.
 const h=harness(),wire=ownerMarketWire(NOW,{total:2,firstSymbol:9103}),page=wire.page();
 page.cards.splice(3,3,...ownerMarketWire(NOW,{total:1,firstSymbol:910322}).page().cards);
 const scope={identity:WIRE_OWNER,tier:'owner',generation:1,signal:new AbortController().signal},expected={edition_id:wire.edition.id,start:0,limit:30};
 const parsed=await owner.parseOwnerMarketPage(page,scope,expected,NOW);
 assert.deepEqual(parsed.cards.map(c=>c.symbol+':'+c.horizon),['9103:LONG','9103:MEDIUM','9103:SHORT','910322:LONG','910322:MEDIUM','910322:SHORT']);
 const wrongStockOrder=structuredClone(page);wrongStockOrder.cards=[...page.cards.slice(3),...page.cards.slice(0,3)];
 await assert.rejects(owner.parseOwnerMarketPage(wrongStockOrder,scope,expected,NOW),/AI_MARKET_OWNER_ORDER/);
 const wrongHorizonOrder=structuredClone(page);[wrongHorizonOrder.cards[0],wrongHorizonOrder.cards[1]]=[wrongHorizonOrder.cards[1],wrongHorizonOrder.cards[0]];
 await assert.rejects(owner.parseOwnerMarketPage(wrongHorizonOrder,scope,expected,NOW),/AI_MARKET_OWNER_ORDER/);
 await h.flush();await h.resolve(h.rpc[0],wire.catalog);await h.resolve(h.rpc[1],page);
 assert.equal(h.articles.length,6);assert(h.text.includes('9103'));assert(h.text.includes('910322'));
 assert.equal(h.rpc.length,2);await h.unmount();
});
test('Chinese company search in the actual Owner component opens the matching existing source/calculation detail',async()=>{
 const {h,wire}=await loaded({firstSymbol:2330,companyNames:{'2330':'台灣積體電路製造股份有限公司'}});
 await h.change('owner-stock-query','台積電');assert.equal(h.rpc.length,2);await h.search();const call=h.rpc.at(-1);
 assert.equal(call.name,'get_daily_ai_owner_market_search_v2');assert.deepEqual({...call.args},{p_edition_id:wire.edition.id,p_query:'台積電',p_limit:20});
 await h.resolve(call,searchWire(wire,'台積電'));await h.click('2330 台積電 · 上市');
 const packet=h.rpc.at(-2),refs=h.rpc.at(-1);assert.equal(packet.args.p_security_id,'TWSE:2330');assert.equal(refs.args.p_security_id,'TWSE:2330');
 await h.resolve(packet,wire.input);await h.resolve(refs,wire.refs);assert(h.text.includes('TWSE:2330 台灣積體電路製造股份有限公司'));
 assert(h.text.includes('已核對同股票'));assert(h.rpc.every(r=>!r.name.startsWith('submit_')&&!r.name.startsWith('review_')));await h.unmount();
});
test('search input changes cancel stale responses and malformed edition binding never displays results',async()=>{
 const {h,wire}=await loaded();await h.change('owner-stock-query','台積電');await h.search();const old=h.rpc.at(-1);
 await h.change('owner-stock-query','2330');assert.equal(old.signal.aborted,true);await h.search();const current=h.rpc.at(-1);
 await h.resolve(old,searchWire(wire,'台積電'));assert(!h.buttons.some(b=>text(b)==='2330 台積電 · 上市'));
 await h.resolve(current,{...searchWire(wire,'2330'),edition_id:'f'.repeat(64)});assert(h.text.includes('公司搜尋暫不可用'));assert(!h.buttons.some(b=>text(b)==='2330 台積電 · 上市'));
 await h.change('owner-stock-query','%');const before=h.rpc.length;await h.search();assert.equal(h.rpc.length,before);assert(h.text.includes('不支援萬用字元'));
 await h.unmount();
});
test('changing edition or losing Owner access prevents late search results from reappearing',async()=>{
 const first=await loaded();await first.h.change('owner-stock-query','台積電');await first.h.search();const old=first.h.rpc.at(-1);
 await first.h.click('下一頁');await first.h.resolve(old,searchWire(first.wire,'台積電'));assert(!first.h.buttons.some(b=>text(b)==='2330 台積電 · 上市'));await first.h.unmount();
 const second=await loaded();await second.h.change('owner-stock-query','台積電');await second.h.search();const late=second.h.rpc.at(-1);
 await second.h.replace(grant(2,'premium'));await second.h.resolve(late,searchWire(second.wire,'台積電'));assert(!second.h.buttons.some(b=>text(b)==='2330 台積電 · 上市'));
 assert(second.h.text.includes('此入口限 Owner'));await second.h.unmount();
});

test('only effective Owner starts private reads; entry is independent from personal review',async()=>{
 for(const access of [{kind:'denied'},grant(1,'premium'),grant(1,'free')]){const h=harness(access);await h.flush();assert.equal(h.rpc.length,0);assert(!h.text.includes('本次四項判斷'));await h.unmount();}
 const {h}=await loaded();assert(h.text.includes('個人股票檢討'));assert.equal(h.rpc[0].args.p_limit,20);assert.equal(h.rpc[1].args.p_limit,30);assert.equal(h.articles.length,9);
 assert(h.selects.filter(s=>s.props.name?.endsWith('-status')).every(s=>s.props.value===''));assert(h.text.includes('尚未提交人工審查'));assert(h.text.includes('尚未供會員閱讀'));
 await h.click('再展開 9 張');assert.equal(h.articles.length,18);assert.equal(h.rpc.length,2);await h.unmount();assert.equal(h.timers,0);
});
test('refresh reloads latest edition and review rather than keeping an earlier private page',async()=>{
 const {h,wire}=await loaded();await h.click('重新讀取最新版本');assert.equal(h.articles.length,0);assert.equal(h.rpc.at(-1).name,'get_daily_ai_owner_market_catalog_v2');
 await h.resolve(h.rpc.at(-1),wire.catalog);assert.equal(h.rpc.at(-1).name,'get_daily_ai_owner_market_page_v2');await h.resolve(h.rpc.at(-1),wire.page());assert.equal(h.articles.length,9);await h.unmount();
});
test('single-stock details load on demand and hash corruption stays unavailable',async()=>{
 const {h,wire}=await loaded();await h.click('查看 1000 原件與計算');assert.deepEqual(h.rpc.slice(2).map(r=>r.name),['get_daily_ai_owner_market_input_v2','get_daily_ai_owner_market_references_v2']);
 const bad=structuredClone(wire.refs);bad.references[0].reference.price_scenarios[0]=99;await h.resolve(h.rpc[2],wire.input);await h.resolve(h.rpc[3],bad);
 assert(h.text.includes('明細暫不可用'));assert(!h.text.includes('已核對同股票'));assert(h.rpc.every(r=>!r.name.startsWith('submit_')));await h.unmount();
});
test('reported BVPS references render the actual medium/long formulas and unchanged quarter-end value in the Owner component',async()=>{
 // Synthetic rendering fixture only: real raw-source and BVPS arithmetic checks
 // belong to the independent SQL integration. No review or publication is set.
 const h=harness(),wire=ownerMarketWire(NOW),page=wire.page(),base=structuredClone(wire.refs.references[0]);
 page.cards.forEach(card=>{card.market='TPEX';});
 const oldCoverage=page.coverage[0];page.coverage[0]={...page.coverage[1],market:'TWSE'};page.coverage[1]={...oldCoverage,market:'TPEX'};
 wire.input.security_id='TPEX:1000';wire.refs.security_id='TPEX:1000';
 wire.refs.references=['MEDIUM','LONG'].map(horizon=>{
  const {reference_hash:ignored,current_multiple:ignoredMultiple,...original}=base.reference;void ignored;void ignoredMultiple;
  const method=horizon==='MEDIUM'?'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB':'CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB';
  const body={...original,schema:'TAIWAN_REPORTED_BVPS_PEER_REFERENCE_V1',security_id:'TPEX:1000',horizon,
   method,method_version:'TAIWAN_REPORTED_BVPS_PEER_V1',financial_period:'2026Q3',reported_bvps:20,multiple_scenarios:[4,5,6],
   peers:original.peers.map(peer=>({...peer,security_id:peer.security_id.replace('TWSE:','TPEX:')}))};
  const reference={...body,reference_hash:marketSnapshotHash(body)},summary={...base.summary,horizon,method_id:method,
   method_version:'TAIWAN_REPORTED_BVPS_PEER_V1',reference_hash:reference.reference_hash};
  page.cards.find(card=>card.symbol==='1000'&&card.horizon===horizon).research_reference=summary;
  return{horizon,summary,reference};
 });
 await h.flush();await h.resolve(h.rpc[0],wire.catalog);await h.resolve(h.rpc[1],page);await h.click('查看 1000 原件與計算');
 await h.resolve(h.rpc.at(-2),wire.input);await h.resolve(h.rpc.at(-1),wire.refs);
 assert(h.text.includes('已核對同股票'));assert(h.text.includes('原季報每股參考淨值 × 同市場、同產業、同報價日及同財報期'));
 assert(h.text.includes('同業 P/B＝同日收盤價 ÷ 各公司原季報每股參考淨值'));
 assert(h.text.includes('公司與同業另須通過相同三年獲利、現金流及資產負債品質條件'));
 assert(h.text.includes('未調整的股數變動會擋下計算'));assert(h.text.includes('現金股利另列，不自動扣減原季報淨值'));
 assert(!h.text.includes('本股官方估值倍數'));assert(h.rpc.every(call=>!call.name.startsWith('submit_')&&!call.name.startsWith('review_')));await h.unmount();
});
test('blank decisions cannot submit; persisted unknown command never automatically retries',async()=>{
 const {h}=await loaded();await h.submit();assert.equal(h.rpc.length,2);assert(h.text.includes('請為四項審查各自選擇判斷'));
 await fill(h);await h.submit();const write=h.rpc.at(-1);assert.equal(write.name,'submit_daily_ai_owner_market_review_v2');const c=storedCommand(h);assert.equal(c.request_key,write.args.p_request_key);assert(!JSON.stringify(c).includes('合成測試'));
 await h.submit();assert.equal(h.rpc.length,3);await h.advance(15001);assert(write.signal.aborted);assert(h.text.includes('操作結果待確認'));assert.equal(h.rpc.length,3);
 await h.resolve(write,savedReview(c));assert(h.text.includes('請求結果待確認'));assert.equal(h.rpc.length,3);await h.unmount();assert.equal(h.timers,0);
});
test('reload restores only command identity; readback keeps NOT_RECORDED pending and clears a matching receipt',async()=>{
 const first=await loaded();await fill(first.h);await first.h.submit();const c=storedCommand(first.h);await first.h.advance(15001);const stored=first.h.stored;await first.h.unmount();
 const {h}=await loaded({},stored);assert(h.text.includes('請求結果待確認'));assert.equal(h.rpc.filter(r=>r.name.startsWith('submit_')).length,0);
 await h.click('讀回原請求結果');const call=h.rpc.at(-1);assert.equal(call.name,'get_daily_ai_owner_market_command_v2');assert.equal(call.args.p_request_key,c.request_key);
 const base={schema:'DAILY_AI_OWNER_MARKET_COMMAND_V2',subject_user_id:WIRE_OWNER,request_key:c.request_key};await h.resolve(call,{...base,state:'NOT_RECORDED',kind:null,edition_id:null,request_hash:null,recorded_at:null,result:null});
 assert(h.text.includes('仍不能判定是否失敗'));assert.equal(storedCommand(h).request_key,c.request_key);await h.click('讀回原請求結果');
 await h.resolve(h.rpc.at(-1),{...base,state:'RECORDED',kind:'REVIEW',edition_id:c.edition_id,request_hash:c.request_hash,recorded_at:new Date(NOW).toISOString(),result:savedReview(c)});
 assert.equal(h.stored.size,0);assert(!h.text.includes('請求結果待確認'));assert.equal(h.rpc.at(-1).name,'get_daily_ai_owner_market_page_v2');assert(h.rpc.every(r=>r.name!=='review_daily_ai_market_edition_v2'));await h.unmount();
});
test('approval is a separate deliberate call using the loaded latest review and chosen audience',async()=>{
 const noRights=await loaded({ready:true});assert(noRights.h.buttons.find(b=>text(b)==='核准會員閱讀').props.disabled);assert(noRights.h.text.includes('即使四項審查全為通過'));await noRights.h.unmount();
 const {h,wire}=await loaded({ready:true,rights:true});assert(h.buttons.find(b=>text(b)==='核准會員閱讀').props.disabled);await h.audience('premium');await h.click('核准會員閱讀');
 const write=h.rpc.at(-1),c=storedCommand(h);assert.equal(write.name,'review_daily_ai_market_edition_v2');assert.equal(write.args.p_review_id,wire.review.id);assert.equal(write.args.p_audience,'premium');assert.equal(write.args.p_request_key,c.request_key);
 await h.resolve(write,{schema:'DAILY_AI_MARKET_PUBLICATION_V2',edition_id:wire.edition.id,event_id:1,action:'APPROVE',replayed:false});assert.equal(h.stored.size,0);assert.equal(h.rpc.at(-1).name,'get_daily_ai_owner_market_page_v2');assert(h.text.includes('已由資料庫記錄'));await h.unmount();
});
test('logout, changed Auth generation and edition change discard late private results',async()=>{
 const h=harness();await h.flush();const old=h.rpc[0],wire=ownerMarketWire(NOW);await h.replace({kind:'denied'});assert(old.signal.aborted);await h.resolve(old,wire.catalog);assert(!h.text.includes('合成測試公司'));assert.equal(h.rpc.length,1);await h.unmount();
 const second=await loaded();await second.h.click('查看 1000 原件與計算');const [packet,refs]=second.h.rpc.slice(-2);await second.h.click('下一頁');const pageCall=second.h.rpc.at(-1);assert.equal(pageCall.args.p_offset,30);
 await second.h.resolve(packet,second.wire.input);await second.h.resolve(refs,second.wire.refs);assert(!second.h.text.includes('已核對同股票'));await second.h.resolve(pageCall,second.wire.page(30));assert(!second.h.text.includes('已核對同股票'));
 await second.h.replace(grant(2));assert(!second.h.text.includes('合成測試公司'));await second.h.unmount();
});
test('expiry disables new review/approval while private evidence remains inspectable',async()=>{
 const {h}=await loaded({ready:true,rights:true,expiry:NOW+2000});await h.audience('premium');assert(!h.buttons.find(b=>text(b)==='核准會員閱讀').props.disabled);await h.advance(2001);
 assert(h.text.includes('版本已到期'));assert(h.buttons.find(b=>text(b)==='核准會員閱讀').props.disabled);assert(h.articles.length>0);assert.equal(h.rpc.length,2);await h.unmount();
});
test('storage failure prevents any mutation and does not pretend that a request was submitted',async()=>{
 const {h}=await loaded({},new Map(),true);await fill(h);await h.submit();assert.equal(h.rpc.length,2);assert(h.text.includes('尚未送出操作'));assert.equal(h.stored.size,0);await h.unmount();
});
