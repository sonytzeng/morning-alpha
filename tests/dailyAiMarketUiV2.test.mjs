// Actual V2 React components, deterministic hooks, synthetic RPC projections.
// No browser/network/database calls and no claim of subscriber load capacity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../src/features/vnext/contracts.ts';
import * as member from '../src/features/vnext/member.ts';
import * as daily from '../src/features/vnext/dailyAiMember.ts';
import * as copy from '../src/features/vnext/dailyAiCopy.ts';
import * as prices from '../src/features/vnext/dailyAiPriceDisplay.ts';
import * as market from '../src/features/vnext/dailyAiMarketPageV2.ts';
import {hashDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';

const NOW=Date.parse('2026-11-11T08:00:00Z'),ID='00000000-0000-0000-0000-000000000001',RPC='get_daily_ai_member_market_page_v2';
const grant=(generation=1,tier='premium',id=ID)=>({kind:'member',id,generation,signal:new AbortController().signal,catalog:{tier}});
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const find=(node,type)=>Array.isArray(node)?node.flatMap(value=>find(value,type)):!node||typeof node!=='object'?[]:[...(node.type===type?[node]:[]),...find(node.props?.children,type)];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const compiled=Object.fromEntries(['DailyAiMarketMemberEntry','DailyAiMarketResearch'].map(name=>[name,ts.transpileModule(readFileSync(new URL('../src/pages/vnext/'+name+'.tsx',import.meta.url),'utf8'),{
 fileName:name+'.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText]));
function harness(name,initialProps={}){
 let clock=NOW,props=initialProps,cursor=0,tree,dirty=false,unmounted=false,id=0,retries=0;
 const slots=[],effects=[],queue=[],pending=[],timers=new Map(),listeners=new Map(),rpc=[];
 const listen=(type,event,fn)=>{const key=type+':'+event;if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(fn);};
 const remove=(type,event,fn)=>listeners.get(type+':'+event)?.delete(fn);
 const hooks={useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{assert(!unmounted);const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const effect={fn,deps,cleanup:old?.cleanup};effects[i]=effect;queue.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}}};
 const document={visibilityState:'visible',addEventListener:(name,fn)=>listen('document',name,fn),removeEventListener:(name,fn)=>remove('document',name,fn)};
 const schedule=(fn,ms,interval=false)=>{const key=++id;timers.set(key,{fn,due:clock+ms,ms,interval});return key;};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const transport={rpc(name,args){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});
  const call={name,args,identity:props.access?.id,tier:props.access?.catalog?.tier,promise,resolve:(data,error=null)=>resolve({data,error}),reject};rpc.push(call);
  return {abortSignal(signal){call.signal=signal;return promise;}};}};
 const tracked={...market};for(const method of ['createDailyAiMarketPageRequestV2','parseDailyAiMarketPageV2'])tracked[method]=(...args)=>{const promise=market[method](...args);pending.push(promise);return promise;};
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props}),exports={};
 vm.runInNewContext(compiled[name],{exports,Date:Clock,Intl,URL,JSON,AbortController,structuredClone,
  setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:key=>timers.delete(key),setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:key=>timers.delete(key),document,
  window:{addEventListener:(name,fn)=>listen('window',name,fn),removeEventListener:(name,fn)=>remove('window',name,fn)},
  require(module){
   if(module==='react')return hooks;if(module==='react/jsx-runtime')return {jsx,jsxs:jsx};if(module==='@/lib/supabase')return {supabase:transport};
   if(module==='@/features/vnext/member')return {...member,memberTaipeiDate:now=>member.memberTaipeiDate(now??clock)};
   if(module==='@/features/vnext/dailyAiMarketPageV2')return tracked;if(module==='@/features/vnext/contracts')return contracts;
   if(module==='@/features/vnext/dailyAiMember')return daily;if(module==='@/features/vnext/dailyAiCopy')return copy;if(module==='@/features/vnext/dailyAiPriceDisplay')return prices;
   if(module==='./MemberNavigation')return {default:'Navigation'};if(module==='./DailyAiMarketResearch')return {default:'MarketResearch'};
   if(module.endsWith('.css'))return {};throw Error('UNAPPROVED_MARKET_UI_IMPORT:'+module);
  }});
 function render(){let attempts=0;do{assert(++attempts<25);dirty=false;cursor=0;tree=exports.default({...props,retry:()=>{retries++;},fallback:notice=>({type:'LegacyFallback',props:{notice}})});while(queue.length)queue.shift()();}while(dirty);return tree;}
 async function flush(){for(let i=0;i<5;i++){const work=pending.splice(0);await Promise.allSettled(work);await settle();render();}}
 render();return {rpc,render,flush,get clock(){return clock;},get retries(){return retries;},get market(){return find(tree,'MarketResearch')[0]?.props;},get fallback(){return find(tree,'LegacyFallback')[0]?.props;},
  get text(){return text(tree);},get articles(){return find(tree,'article');},get inputs(){return find(tree,'input');},get forms(){return find(tree,'form');},get buttons(){return find(tree,'button');},
  async resolve(call,data,error=null){call.resolve(data,error);await flush();},
  async replace(next){props={...props,...next};render();await flush();},
  async click(label){const button=find(tree,'button').find(b=>text(b)===label);assert(button,label);button.props.onClick();render();await flush();},
  async advance(ms){const target=clock+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;
    clock=next[1].due;if(next[1].interval)next[1].due+=next[1].ms;else timers.delete(next[0]);next[1].fn();render();}clock=target;render();await flush();},
  async visibility(value){document.visibilityState=value;for(const fn of [...listeners.get('document:visibilitychange')??[]])fn();render();await flush();},
  unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();unmounted=true;},get timers(){return timers.size;}};
}

function researchReference(card){
 const short=card.horizon==='SHORT',long=card.horizon==='LONG';
 return {schema:'DAILY_AI_MARKET_RESEARCH_REFERENCE_V1',status:'CALCULATED_RESEARCH_ONLY',symbol:card.symbol,horizon:card.horizon,
  method_id:short?'OBSERVED_UNADJUSTED_20_SESSION_RANGE':long?'CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB':'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE',
  method_version:short?'TAIWAN_OBSERVED_RANGE_V1':long?'TAIWAN_LONG_QUALITY_PEER_PB_V1':'TAIWAN_PEER_RERATING_V1',
  quote_date:'2026-11-10',current_price:120,lower:80.123456,median:short?null:100.987654,upper:150.123456,peer_count:short?null:7,
  reference_hash:'e'.repeat(64),input_pool_hash:'f'.repeat(64),forecast:false,buy_ready:false,methodology_approved:false};
}
async function response(call,now=NOW,{total=70,empty=false,price=false,reference=false,expiry=now+3600000}={}){
 const request=call.args.p_request,query=request.query,tier=call.tier??'premium',subject=call.identity??ID;
 const count=tier==='free'?Math.min(3,total):total,all=Array.from({length:count},(_,i)=>({market:'TWSE',symbol:String(1000+i),company:'合成公司'+i,horizon:query.horizon,status:'WAIT',
  reason:{text:'合成規則篩選理由',evidence_ids:['P1']},counter_evidence:tier==='free'?null:[],confirmation:'合成等待條件',invalidation:'合成重評條件',gaps:['SYNTHETIC_MISSING_DATA'],
  sources:tier==='free'?null:[{id:'P1',source:'https://www.twse.com.tw/synthetic-only',kind:'PRICE',published_at:new Date(now-7200000).toISOString(),available_at:new Date(now-7200000).toISOString(),time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}],classification:'INFERENCE',price:null}));
 const selected=empty?[]:all.filter(c=>(query.market==='ALL'||c.market===query.market)&&`${c.symbol} ${c.company}`.toLowerCase().includes(query.search.toLowerCase()));
 const matching=selected.filter(c=>query.status==='ALL'||c.status===query.status),start=request.cursor?.position.seen??0,cards=matching.slice(start,start+query.page_size);
 const cutoff=new Date(now-3600000).toISOString(),prepared=new Date(now-1800000).toISOString(),day=member.memberTaipeiDate(now);
 const data={schema:'VNEXT_AI_MARKET_PAGE_V2',mode:'FULL',subject_user_id:subject,tier,business_date:day,research_only:true,checked_at:new Date(now).toISOString(),query,query_hash:request.query_hash,
  edition:empty?null:{id:'a'.repeat(64),edition_date:member.memberTaipeiDate(Date.parse(cutoff)),evidence_cutoff:cutoff,prepared_at:prepared,expires_at:new Date(expiry).toISOString(),analysis_origin:'DETERMINISTIC_SCREENING',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
  research_revision:empty?null:'b'.repeat(64),price_revision:empty?null:'c'.repeat(64),
  universe:{snapshot_id:'d'.repeat(64),snapshot_date:day,markets:market.DAILY_AI_MARKETS.map((m,i)=>({market:m,universe_count:100,published_count:!empty&&m==='TWSE'?count:0,coverage:'PARTIAL',roster_as_of:i?null:day,
   data_as_of:{price_date:i?null:member.memberTaipeiDate(now-86400000),financial_available_at:null,news_available_at:null}}))},
  counts:{available_total:!empty&&(query.market==='ALL'||query.market==='TWSE')?count:0,matching_total:matching.length,by_status:{WATCH:0,WAIT:selected.length,AVOID:0,INSUFFICIENT:0}},
  page:{start,returned:cards.length,has_more:start+cards.length<matching.length,next_cursor:null},cards};
 if(data.page.has_more){const last=cards.at(-1),body={schema:'VNEXT_AI_MARKET_CURSOR_V2',edition_id:data.edition.id,research_revision:data.research_revision,price_revision:data.price_revision,subject_user_id:subject,tier,business_date:day,
  query_hash:request.query_hash,position:{seen:start+cards.length,after:{status:last.status,market:last.market,symbol:last.symbol}},expires_at:data.edition.expires_at};data.page.next_cursor={...body,binding_hash:await contracts.snapshotHash(body)};}
 if(price&&cards.length){const c=cards[0],body={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:data.edition.id,symbol:c.symbol,horizon:c.horizon,status:'VERIFIED',currency:'TWD',method:'SYNTHETIC_UI_ONLY',basis:'合成數字只用於畫面驗證',entry_range:[100,105],wait_above:105,stop_kind:'PRICE',stop:95,stop_evidence_ids:['P1'],invalidation:'合成取消條件',evidence_ids:['P1'],as_of:prepared,expires_at:new Date(now+1500).toISOString(),buy_ready:false};const plan_hash=await hashDailyAiPricePlanBody(body);
  c.price={plan:{...body,plan_hash,review:{status:'PASS',plan_hash,reviewed_at:new Date(now-900000).toISOString(),document_hash:'e'.repeat(64)}},sources:c.sources};}
 if(reference&&cards.length)cards[0].research_reference=researchReference(cards[0]);
 return data;
}
async function entry(access=grant()){const h=harness('DailyAiMarketMemberEntry',{access});await h.flush();return h;}

test('readable V2 performs one bounded page RPC and never mounts the whole-edition fallback',async()=>{
 const h=await entry(),call=h.rpc[0];assert.equal(h.rpc.length,1);assert.equal(call.name,RPC);assert.equal(call.args.p_request.query.page_size,27);
 const wire=await response(call);await h.resolve(call,wire);assert(h.market);assert.equal(h.fallback,undefined);assert.equal(h.market.cache.data.cards.length,27);
 await h.advance(30000);const next=h.rpc.at(-1);assert.equal(next.args.p_request.known.price_revision,wire.price_revision);assert.equal(h.market.loading,true);
 const {cards,...unchanged}=structuredClone(wire);unchanged.mode='UNCHANGED';unchanged.checked_at=new Date(h.clock).toISOString();
 await h.resolve(next,unchanged);assert.equal(h.market.loading,false);assert.equal(h.fallback,undefined);assert(h.rpc.every(c=>c.name===RPC));h.unmount();assert.equal(h.timers,0);
});

test('missing and unpublished V2 expose explicit legacy boundaries, while a permission failure never falls back',async()=>{
 for(const kind of ['MISSING','NOT_PUBLISHED','UNAVAILABLE']){
  const h=await entry(),call=h.rpc[0];
  if(kind==='NOT_PUBLISHED')await h.resolve(call,await response(call,NOW,{empty:true}));
  else await h.resolve(call,null,kind==='MISSING'?{code:'PGRST202',message:'Could not find '+RPC}:{code:'42883',message:'function private.required_dependency() does not exist'});
  assert.equal(h.fallback.notice.kind,kind);assert.equal(h.market,undefined);if(kind==='NOT_PUBLISHED')assert.equal(h.fallback.notice.roster_count,300);h.unmount();
 }
 const h=await entry();await h.resolve(h.rpc[0],null,{code:'42501',message:'denied'});assert.equal(h.fallback,undefined);assert.equal(h.market,undefined);assert.equal(h.retries,1);assert(h.text.includes('原研究與價格已清除'));h.unmount();
});

test('query and cursor changes replace the page; a stale cursor retries the first page exactly once',async()=>{
 const h=await entry();await h.resolve(h.rpc[0],await response(h.rpc[0]));const old=h.market;
 h.market.onNext();await h.flush();const second=h.rpc.at(-1);assert.equal(second.args.p_request.cursor.position.seen,27);assert.equal(h.market,undefined);
 await h.resolve(second,null,{code:'P0001',message:'AI_MARKET_PAGE_V2_CURSOR_STALE'});const restarted=h.rpc.at(-1);assert.notEqual(restarted,second);assert.equal(restarted.args.p_request.cursor,null);
 await h.resolve(restarted,await response(restarted));const count=h.rpc.length;old.onQuery({...old.cache.data.query,search:'OLD_CALLBACK'});await h.flush();assert.equal(h.rpc.length,count);
 h.market.onQuery({...h.market.cache.data.query,horizon:'LONG',market:'TPEX',search:'合成'});await h.flush();const query=h.rpc.at(-1).args.p_request;
 assert.equal(query.cursor,null);assert.equal(query.known,null);assert.equal(query.query.horizon,'LONG');assert.equal(query.query.market,'TPEX');assert.equal(query.query.search,'合成');h.unmount();
});

test('explicit V2 rollback clears a loaded page and returns the separately gated V1 fallback',async()=>{
 const h=await entry();await h.resolve(h.rpc[0],await response(h.rpc[0],NOW,{reference:true}));assert(h.market);
 await h.advance(30000);await h.resolve(h.rpc.at(-1),null,{code:'P0001',message:'AI_MARKET_PAGE_V2_DISABLED'});
 assert.equal(h.market,undefined);assert.equal(h.fallback.notice.kind,'DISABLED');assert.equal(h.retries,0);h.unmount();
});

test('hidden, logout and changed Auth generations reject late page responses and cached grants',async()=>{
 for(const invalidate of [h=>h.visibility('hidden'),h=>h.replace({access:{kind:'denied'}}),h=>h.replace({access:grant(2)})]){
  const h=await entry(),old=h.rpc[0],wire=await response(old);await invalidate(h);assert(old.signal.aborted);await h.resolve(old,wire);assert.equal(h.market,undefined);h.unmount();
 }
 const controller=new AbortController(),h=await entry({...grant(),signal:controller.signal});await h.resolve(h.rpc[0],await response(h.rpc[0]));controller.abort();h.render();assert.equal(h.market,undefined);h.unmount();
});

test('deadline and same-scope refresh remain bounded and do not revive a late successful response',async()=>{
 const h=await entry(),old=h.rpc[0],wire=await response(old);await h.advance(8000);assert(old.signal.aborted);assert.equal(h.fallback.notice.kind,'UNAVAILABLE');
 await h.resolve(old,wire);assert.equal(h.market,undefined);h.fallback.notice.onRefresh();h.fallback.notice.onRefresh();await h.flush();assert.equal(h.rpc.length,2);h.unmount();
});

test('Taipei midnight clears the page and changes both the request date and initial cursor',async()=>{
 const h=await entry();await h.resolve(h.rpc[0],await response(h.rpc[0]));
 await h.advance(Date.parse('2026-11-11T16:00:00Z')-h.clock);const call=h.rpc.at(-1);assert.equal(h.market,undefined);assert.equal(call.args.p_request.cursor,null);assert.equal(call.args.p_request.known,null);
 await h.resolve(call,await response(call,h.clock));assert.equal(h.market.cache.data.business_date,'2026-11-12');h.unmount();
});

test('actual V2 content separates roster and publication counts, reveals 9 cards, and submits search once',async()=>{
 const h=await entry();await h.resolve(h.rpc[0],await response(h.rpc[0],NOW,{price:true}));const changes=[],ui=harness('DailyAiMarketResearch',{...h.market,onQuery:q=>changes.push(q)});
 assert.equal(ui.articles.length,9);assert(ui.text.includes('規則式資料篩選'));assert(ui.text.includes('官方名單納入 300 檔'));assert(ui.text.includes('已核准可讀 70 檔'));
 assert(ui.text.includes('納入名單不代表已完成分析'));assert(ui.text.includes('研究限制與缺件'));assert(ui.text.includes('研究參考價'));assert(ui.text.includes('NT$100～105'));
 await ui.click('再展開 9 張');assert.equal(ui.articles.length,18);
 ui.inputs[0].props.onChange({target:{value:'1005'}});ui.render();assert.equal(changes.length,0);
 ui.forms[0].props.onSubmit({preventDefault(){}});ui.render();assert.equal(changes.length,1);assert.equal(changes[0].search,'1005');assert.equal(ui.rpc.length,0);ui.unmount();h.unmount();
});

test('actual V2 price expires independently and edition expiry removes cards without waiting for a network refresh',async()=>{
 const h=await entry();await h.resolve(h.rpc[0],await response(h.rpc[0],NOW,{price:true,expiry:NOW+3000}));let refreshed=0;
 const ui=harness('DailyAiMarketResearch',{...h.market,onRefresh:()=>refreshed++});
 await ui.advance(1499);assert(ui.text.includes('NT$100～105'));await ui.advance(1);assert(!ui.text.includes('NT$100～105'));assert(ui.text.includes('原價格計畫已到期'));assert.equal(ui.articles.length,9);
 await ui.advance(1500);assert.equal(ui.articles.length,0);assert(ui.text.includes('研究版本已到期'));await ui.click('重新核對版本');assert.equal(refreshed,1);ui.unmount();h.unmount();
});

test('actual research-reference cards show horizon meaning, source date, peer count and a selectable audit code with zero extra RPCs',async()=>{
 for(const horizon of ['SHORT','MEDIUM','LONG']){
  const h=await entry();
  if(horizon!=='SHORT'){await h.resolve(h.rpc[0],await response(h.rpc[0]));h.market.onQuery({...h.market.cache.data.query,horizon});await h.flush();}
  const call=h.rpc.at(-1);await h.resolve(call,await response(call,NOW,{reference:true}));const requests=h.rpc.length;
  const ui=harness('DailyAiMarketResearch',h.market);
  assert.equal(ui.articles.length,9);assert(ui.text.includes('NT$120'));assert(ui.text.includes('2026-11-10'));assert(ui.text.includes('NT$80.12～150.12'));
  assert(ui.text.includes('方法成效尚未驗證'));assert(ui.text.includes('買賣條件與方法審查仍需另行完成'));assert(!ui.text.includes('條件式研究區間'));
  assert(ui.text.includes('核對這張卡的資料依據'));assert(!ui.text.includes('DCF'));assert(!ui.text.includes('目標價'));
  if(horizon==='SHORT'){assert(ui.text.includes('歷史價格區間'));assert(ui.text.includes('近 20 個交易日'));assert(!ui.text.includes('同業估值中位'));}
  else{assert(ui.text.includes('同業估值中位'));assert(ui.text.includes('約 NT$100.99'));assert(ui.text.includes('7 家其他同業'));
   assert(ui.text.includes(horizon==='LONG'?'通過相同三年獲利':'同業本益比'));}
  const code=ui.inputs.find(input=>input.props.readOnly);assert.equal(code.props.value,'e'.repeat(64));let selected=false;
  code.props.onFocus({currentTarget:{select:()=>{selected=true;}}});assert.equal(selected,true);
  await ui.click('再展開 9 張');assert.equal(ui.articles.length,18);assert.equal(ui.rpc.length,0);assert.equal(h.rpc.length,requests);
  ui.unmount();h.unmount();
 }
});

test('a reference cannot grant free access and disappears on expiry or revoked Auth without a second endpoint',async()=>{
 const free=await entry(grant(1,'free'));await free.resolve(free.rpc[0],await response(free.rpc[0],NOW,{reference:true}));
 assert.equal(free.market,undefined);assert.equal(free.fallback,undefined);assert(!free.text.includes('NT$80.12'));free.unmount();
 const h=await entry();await h.resolve(h.rpc[0],await response(h.rpc[0],NOW,{reference:true,expiry:NOW+2000}));
 const ui=harness('DailyAiMarketResearch',h.market);assert(ui.text.includes('歷史價格區間'));
 await ui.advance(2000);assert(!ui.text.includes('NT$80.12'));assert.equal(ui.articles.length,0);assert.equal(ui.rpc.length,0);
 await h.replace({access:{kind:'denied'}});assert.equal(h.market,undefined);ui.unmount();h.unmount();
});

test('reported BVPS references show their calculated basis and retain horizon-specific quality meaning',async()=>{
 for(const horizon of ['MEDIUM','LONG']){
  const h=await entry();await h.resolve(h.rpc[0],await response(h.rpc[0]));
  h.market.onQuery({...h.market.cache.data.query,horizon});await h.flush();
  const call=h.rpc.at(-1),wire=await response(call,NOW,{reference:true});
  wire.cards[0].research_reference.method_version='TAIWAN_REPORTED_BVPS_PEER_V1';
  wire.cards[0].research_reference.method_id=horizon==='MEDIUM'?'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB':'CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB';
  await h.resolve(call,wire);const ui=harness('DailyAiMarketResearch',h.market);
  assert(ui.text.includes('原季報的每股參考淨值'));
  assert(ui.text.includes('當日價格除以原報表每股參考淨值'));
  assert(ui.text.includes('股本變動會擋下計算'));
  assert(ui.text.includes('原帳面淨值不是即時淨值'));
  if(horizon==='LONG')assert(ui.text.includes('通過相同三年獲利'));
  assert(!ui.text.includes('條件式研究區間'));assert.equal(ui.rpc.length,0);
  ui.unmount();h.unmount();
 }
});
