import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as ownerPrices from '../src/features/vnext/dailyAiOwnerPricePlans.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {hashDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';
import * as contracts from '../src/features/vnext/contracts.ts';
import * as priceDisplay from '../src/features/vnext/dailyAiPriceDisplay.ts';

const NOW=Date.parse('2026-11-01T10:00:00Z'),OWNER='00000000-0000-0000-0000-000000000001',OTHER='00000000-0000-0000-0000-000000000002';
const REVIEW='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OLD_REVIEW='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',KEY='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EDITION='a'.repeat(64),READ='get_daily_ai_owner_price_plans_v1',WRITE='review_daily_ai_price_plan_v1';
async function fixture({reviewed=true,expiry=NOW+60000,editionId=EDITION}={}){
 const body={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:editionId,symbol:'2330',horizon:'SHORT',status:'VERIFIED',currency:'TWD',
  method:'SYNTHETIC_OWNER_PRICE_TEST',basis:'隔離測試價格，不是真實買進建議',entry_range:[100,105],wait_above:105,stop_kind:'PRICE',stop:95,
  stop_evidence_ids:['P1'],invalidation:'合成研究條件不成立時停止沿用',evidence_ids:['P1'],as_of:new Date(NOW-60000).toISOString(),expires_at:new Date(expiry).toISOString(),buy_ready:false};
 const planHash=await snapshotHash(body),row={plan_hash:planHash,body,review:reviewed?{id:REVIEW,quality:'PASS',time_status:'PASS',source_use:'PASS',methodology:'PASS',
  document_hash:'b'.repeat(64),reviewed_at:new Date(NOW-30000).toISOString(),expires_at:body.expires_at}:null,publication:null,can_approve:reviewed};
 return {schema:'VNEXT_AI_OWNER_PRICE_PLANS_V1',edition_id:editionId,subject_user_id:OWNER,research_only:true,preview_only:true,plans:[row]};
}
async function parse(value){return ownerPrices.parseDailyAiOwnerPricePlans(value,value.edition_id,OWNER,NOW);}
async function rehash(row){row.plan_hash=await hashDailyAiPricePlanBody(row.body);}

test('private previews retain exact candidates and independent pending reviews without granting readiness',async()=>{
 const f=await fixture({reviewed:false}),value=await parse(f),row=value.plans[0];
 assert.equal(row.review,null);assert.equal(ownerPrices.dailyAiOwnerPriceCanApprove(row,NOW),false);assert.equal(row.body.buy_ready,false);
 assert(Object.isFrozen(value));assert(Object.isFrozen(value.plans));assert(Object.isFrozen(row.body.entry_range));
 assert.throws(()=>ownerPrices.dailyAiOwnerPriceReviewRequest(row,EDITION,'APPROVE',KEY,NOW),/OWNER_PRICE_/);
});
test('exact edition, subject, body hash, references and field allowlists reject corrupted preview data',async()=>{
 for(const change of [f=>f.edition_id='c'.repeat(64),f=>f.subject_user_id=OTHER,f=>f.preview_only=false,f=>f.research_only=false,
  f=>f.plans[0].body.entry_range[0]=99,f=>f.plans[0].plan_hash='d'.repeat(64),f=>f.plans[0].body.raw_provider='secret',
  f=>f.plans[0].body.stop_evidence_ids=['invented'],f=>f.plans.push(structuredClone(f.plans[0])),f=>f.raw_secret='secret']){
  const f=await fixture();change(f);await assert.rejects(()=>ownerPrices.parseDailyAiOwnerPricePlans(f,EDITION,OWNER,NOW),/OWNER_PRICE_/);
 }
 for(const bodyChange of [{entry_range:[105,100]},{stop:100},{wait_above:104},{buy_ready:true},{method:' '},{horizon:'BUY'}]){
  const f=await fixture();Object.assign(f.plans[0].body,bodyChange);await rehash(f.plans[0]);await assert.rejects(()=>parse(f),/OWNER_PRICE_/);
 }
});
test('four review gates and exact current expiry are required even after a valid server snapshot',async()=>{
 const data=await parse(await fixture()),row=data.plans[0];assert.equal(ownerPrices.dailyAiOwnerPriceCanApprove(row,NOW),true);
 assert.equal(ownerPrices.dailyAiOwnerPriceCanApprove(row,Date.parse(row.body.expires_at)),false);
 for(const gate of ['quality','time_status','source_use','methodology']){
  const f=await fixture();f.plans[0].review[gate]='FAIL';f.plans[0].can_approve=false;const changed=await parse(f);assert.equal(ownerPrices.dailyAiOwnerPriceCanApprove(changed.plans[0],NOW),false);
  f.plans[0].can_approve=true;await assert.rejects(()=>parse(f),/OWNER_PRICE_GATES/);
 }
 for(const change of [f=>f.plans[0].review.reviewed_at=new Date(NOW+1).toISOString(),f=>f.plans[0].review.expires_at=new Date(NOW+60001).toISOString(),
  f=>f.plans[0].body.as_of=new Date(NOW+1).toISOString(),f=>f.plans[0].review.document_hash='PASS']){
  const f=await fixture();change(f);await rehash(f.plans[0]);await assert.rejects(()=>parse(f),/OWNER_PRICE_/);
 }
});
test('expired private plans remain previewable and revocation binds the latest review instead of old publication review',async()=>{
 const f=await fixture({expiry:NOW-1});f.plans[0].can_approve=false;f.plans[0].publication={id:3,review_id:OLD_REVIEW,action:'APPROVE',occurred_at:new Date(NOW-10000).toISOString()};
 const data=await parse(f),row=data.plans[0];assert.equal(ownerPrices.dailyAiOwnerPriceCanApprove(row,NOW),false);assert.equal(ownerPrices.dailyAiOwnerPriceCanRevoke(row),true);
 assert.deepEqual(ownerPrices.dailyAiOwnerPriceReviewRequest(row,EDITION,'REVOKE',KEY,NOW),{p_plan_hash:row.plan_hash,p_review_id:REVIEW,p_action:'REVOKE',p_request_key:KEY});
});
test('approval and receipts bind fixed IDs and never copy provider fields into action results',async()=>{
 const row=(await parse(await fixture())).plans[0],args=ownerPrices.dailyAiOwnerPriceReviewRequest(row,EDITION,'APPROVE',KEY,NOW);
 assert.deepEqual(Object.keys(args).sort(),['p_action','p_plan_hash','p_request_key','p_review_id']);assert.equal(args.p_request_key,KEY);
 assert.throws(()=>ownerPrices.dailyAiOwnerPriceReviewRequest(row,'c'.repeat(64),'APPROVE',KEY,NOW),/OWNER_PRICE_/);
 assert.throws(()=>ownerPrices.dailyAiOwnerPriceReviewRequest(row,EDITION,'APPROVE','wrong',NOW),/OWNER_PRICE_UUID/);
 assert.throws(()=>ownerPrices.dailyAiOwnerPriceReviewRequest(row,EDITION,'REVOKE',KEY,NOW),/OWNER_PRICE_NOT_READY/);
 assert.deepEqual(ownerPrices.parseDailyAiOwnerPriceReviewResult({event_id:7,action:'APPROVE',replayed:true,raw_provider:'secret'},'APPROVE'),{event_id:7,action:'APPROVE',replayed:true});
 for(const r of [{event_id:1,action:'REVOKE',replayed:false},{event_id:'1',action:'APPROVE',replayed:false},{event_id:1,action:'APPROVE',replayed:'true'}])assert.throws(()=>ownerPrices.parseDailyAiOwnerPriceReviewResult(r,'APPROVE'),/OWNER_PRICE_/);
});
test('preview parser owns the candidate before asynchronous hashing and microsecond deadlines ceil correctly',async()=>{
 const f=await fixture(),original=structuredClone(f),operation=parse(f);f.plans[0].body.entry_range[0]=999;f.plans[0].review.quality='FAIL';
 assert.deepEqual(await operation,original);assert.equal(ownerPrices.dailyAiOwnerPriceDeadlineMs('2026-11-01T10:00:00.000001Z'),NOW+1);
 assert.equal(ownerPrices.dailyAiOwnerPriceDeadlineMs('2026-11-01T10:00:00.001000Z'),NOW+1);
});

const file='src/pages/vnext/DailyAiOwnerPricePlans.tsx';
const compiled=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
const find=(node,type)=>Array.isArray(node)?node.flatMap(n=>find(n,type)):!node||typeof node!=='object'?[]:
 [...(node.type===type||typeof node.type==='function'&&node.type.name===type?[node]:[]),...find(node.props?.children,type)];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const access=(id=OWNER,generation=1,tier='owner')=>({kind:'member',id,generation,signal:new AbortController().signal,catalog:{tier}});
function harness({initialAccess=access(),editionId=EDITION,previewData=null}={}){
 let currentAccess=initialAccess,currentEdition=editionId,currentPreview=previewData,clock=NOW,cursor=0,tree,dirty=false,unmounted=false,sequence=0,keys=0;
 const states=[],effects=[],queued=[],calls=[],parses=[],timers=new Map(),visibility=new Set();
 const hooks={
  useRef(initial){const i=cursor++;return states[i]??={current:initial};},
  useCallback(fn,deps){const i=cursor++,old=states[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j])))states[i]={fn,deps};return states[i].fn;},
  useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{assert(!unmounted);const next=typeof value==='function'?value(states[i]):value;if(!Object.is(next,states[i])){states[i]=next;dirty=true;}}];},
  useEffect(fn,deps){const i=cursor++,old=effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){const effect={deps,fn,cleanup:old?.cleanup};effects[i]=effect;queued.push(()=>{old?.cleanup?.();effect.cleanup=fn();});}},
 };
 const transport={rpc(name,args){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});const call={name,args,promise,resolve:(data,error=null)=>resolve({data,error}),reject};calls.push(call);return {abortSignal(signal){call.signal=signal;return promise;}};}};
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const schedule=(fn,delay,interval=false)=>{const id=++sequence;timers.set(id,{fn,due:clock+delay,delay,interval});return id;};
 const exports={};vm.runInNewContext(compiled,{exports,Date:ClockDate,Intl,AbortController,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${(++keys).toString(16).padStart(12,'0')}`},
  setTimeout:schedule,clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>schedule(fn,delay,true),clearInterval:id=>timers.delete(id),
  document:{addEventListener:(name,fn)=>{assert.equal(name,'visibilitychange');visibility.add(fn);},removeEventListener:(name,fn)=>{assert.equal(name,'visibilitychange');visibility.delete(fn);}},
  require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='@/lib/supabase')return {supabase:transport};if(name==='@/features/vnext/contracts')return contracts;
   if(name==='@/features/vnext/dailyAiOwnerPricePlans')return {...ownerPrices,parseDailyAiOwnerPricePlans:(value,edition,user)=>{const operation=ownerPrices.parseDailyAiOwnerPricePlans(value,edition,user,clock);parses.push(operation);return operation;},dailyAiOwnerPriceReviewRequest:(row,edition,action,key)=>ownerPrices.dailyAiOwnerPriceReviewRequest(row,edition,action,key,clock)};
   if(name==='@/features/vnext/dailyAiPriceDisplay')return priceDisplay;
   if(name.endsWith('.css'))return {};throw Error('UNAPPROVED_OWNER_PRICE_IMPORT:'+name);}
 },{filename:file});
 function render(){let loops=0;do{assert(++loops<30);dirty=false;cursor=0;tree=currentPreview?exports.DailyAiOwnerPricePreview({data:currentPreview,onReview:()=>{}}):exports.default({access:currentAccess,editionId:currentEdition});while(queued.length)queued.shift()();}while(dirty);return tree;}
 render();
 return {calls,render,get preview(){return find(render(),'DailyAiOwnerPricePreview')[0]?.props;},get keys(){return keys;},get timers(){return timers.size;},get buttons(){return find(render(),'button');},
  call:name=>calls.findLast(call=>call.name===name),
  async resolve(call,data,error=null){call.resolve(data,error);await settle();await Promise.allSettled(parses);await settle();render();},
  async reject(call){call.reject(Error('PRIVATE_PROVIDER_ERROR_MUST_NOT_RENDER'));await settle();render();},
  setAccess(value){currentAccess=value;render();},setEdition(value){currentEdition=value;render();},
  click(label){const button=find(render(),'button').find(node=>node.props.children===label);assert(button,label);button.props.onClick();render();},
  advance(ms){const target=clock+ms;for(;;){const entry=[...timers].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;clock=entry[1].due;if(entry[1].interval)entry[1].due+=entry[1].delay;else timers.delete(entry[0]);entry[1].fn();render();}clock=target;render();},
  unmount(){for(const effect of effects.filter(Boolean))effect.cleanup?.();unmounted=true;},
 };
}

test('only current Owner session reads candidate edition and a precise action, then refreshes actual records',async()=>{
 for(const a of [{kind:'denied'},{kind:'loading'},access(OWNER,1,'premium')]){const h=harness({initialAccess:a});assert.equal(h.calls.length,0);assert.equal(h.preview,undefined);h.unmount();}
 const f=await fixture(),h=harness();await settle();const read=h.call(READ);assert.deepEqual(JSON.parse(JSON.stringify(read.args)),{p_edition_id:EDITION});await h.resolve(read,f);
 const row=h.preview.data.plans[0];h.preview.onReview(row,'APPROVE');await settle();const post=h.call(WRITE);assert(post);assert.equal(post.args.p_plan_hash,row.plan_hash);assert.equal(post.args.p_review_id,REVIEW);assert.equal(h.keys,1);
 h.preview.onReview(row,'APPROVE');assert.equal(h.calls.filter(call=>call.name===WRITE).length,1,'double click sends one mutation');
 await h.resolve(post,{event_id:1,action:'APPROVE',replayed:false});assert.equal(h.preview,undefined);assert.equal(h.calls.filter(call=>call.name===READ).length,2);h.unmount();assert.equal(h.timers,0);
});
test('unknown action outcome retries the same request key and blocks every other price action',async()=>{
 const f=await fixture(),h=harness();await settle();await h.resolve(h.call(READ),f);const row=h.preview.data.plans[0];h.preview.onReview(row,'APPROVE');await settle();const first=h.call(WRITE);
 await h.reject(first);assert.equal(h.preview.blocked,true);h.preview.onReview(row,'APPROVE');assert.equal(h.calls.filter(call=>call.name===WRITE).length,1);
 h.click('以原請求重試確認');await settle();const retry=h.call(WRITE);assert.notEqual(retry,first);assert.deepEqual(retry.args,first.args);assert.equal(h.keys,1);
 await h.resolve(retry,{event_id:1,action:'APPROVE',replayed:true});assert.equal(h.calls.filter(call=>call.name===READ).length,2);h.unmount();
});
test('action deadline aborts transport, retains its idempotency key and rejects late success',async()=>{
 const f=await fixture(),h=harness();await settle();await h.resolve(h.call(READ),f);h.preview.onReview(h.preview.data.plans[0],'APPROVE');await settle();const post=h.call(WRITE);
 h.advance(8000);await settle();h.render();assert(post.signal.aborted);assert.equal(h.preview.blocked,true);
 await h.resolve(post,{event_id:1,action:'APPROVE',replayed:false});assert.equal(h.calls.filter(call=>call.name===READ).length,1);
 h.click('以原請求重試確認');await settle();assert.equal(h.call(WRITE).args.p_request_key,post.args.p_request_key);h.unmount();assert.equal(h.timers,0);
});
test('old read and mutation callbacks cannot cross identity, generation, edition or logout boundaries',async()=>{
 for(const change of [h=>h.setAccess(access(OTHER,2)),h=>h.setAccess(access(OWNER,2)),h=>h.setEdition('c'.repeat(64)),h=>h.setAccess({kind:'denied'})]){
  const f=await fixture(),h=harness();await settle();const oldRead=h.call(READ);change(h);await h.resolve(oldRead,f);assert.equal(h.preview,undefined);assert(oldRead.signal.aborted);h.unmount();
  const ready=harness();await settle();await ready.resolve(ready.call(READ),f);const old=ready.preview;old.onReview(old.data.plans[0],'APPROVE');await settle();const post=ready.call(WRITE);change(ready);
  old.onReview(old.data.plans[0],'APPROVE');await ready.resolve(post,{event_id:1,action:'APPROVE',replayed:false});assert.equal(ready.preview,undefined);assert.equal(ready.calls.filter(call=>call.name===WRITE).length,1);assert(post.signal.aborted);ready.unmount();
 }
});
test('permission denial clears private preview, while confirmed rejection refreshes latest review without retry loops',async()=>{
 for(const code of ['42501','P0001']){
  const f=await fixture(),h=harness();await settle();await h.resolve(h.call(READ),f);h.preview.onReview(h.preview.data.plans[0],'APPROVE');await settle();await h.resolve(h.call(WRITE),null,{code,message:'PRIVATE_DATABASE_DETAIL'});
  assert.equal(h.preview,undefined);assert.equal(h.calls.filter(call=>call.name===READ).length,code==='42501'?1:2);assert.equal(h.calls.filter(call=>call.name===WRITE).length,1);h.unmount();
 }
 const h=harness();await settle();await h.resolve(h.call(READ),null,{code:'42501'});assert.equal(h.preview,undefined);assert.equal(h.calls.length,1);h.unmount();
});
test('a permission rejection invalidates captured row handlers before React renders the denied state',async()=>{
 const f=await fixture(),h=harness();await settle();await h.resolve(h.call(READ),f);const previous=h.preview;
 previous.onReview(previous.data.plans[0],'APPROVE');await settle();h.call(WRITE).resolve(null,{code:'42501'});await settle();
 // Deliberately do not render the queued state changes before the old callback.
 previous.onReview(previous.data.plans[0],'APPROVE');await settle();assert.equal(h.calls.filter(call=>call.name===WRITE).length,1);
 h.render();assert.equal(h.preview,undefined);h.unmount();
});
test('stale row handler after a fresh read cannot approve a replaced candidate',async()=>{
 const f=await fixture(),h=harness();await settle();await h.resolve(h.call(READ),f);const old=h.preview;
 h.click('重新讀取價格候選');await settle();const updated=await fixture();updated.plans[0].review.id=OLD_REVIEW;await h.resolve(h.call(READ),updated);
 old.onReview(old.data.plans[0],'APPROVE');assert.equal(h.calls.filter(call=>call.name===WRITE).length,0);h.unmount();
});
test('unmount and read timeout settle without exposing late private candidates or leaking timers',async()=>{
 const f=await fixture(),h=harness();await settle();const read=h.call(READ);h.advance(8000);await settle();h.render();await h.resolve(read,f);assert.equal(h.preview,undefined);h.unmount();assert.equal(h.timers,0);
 const ready=harness();await settle();await ready.resolve(ready.call(READ),f);ready.preview.onReview(ready.preview.data.plans[0],'APPROVE');await settle();const post=ready.call(WRITE);ready.unmount();post.resolve({event_id:1,action:'APPROVE',replayed:false});await settle();assert.equal(ready.timers,0);
});
test('actual Owner preview withdraws approval at the first browser millisecond after a microsecond expiry',async()=>{
 const f=await fixture();f.plans[0].body.expires_at='2026-11-01T10:00:00.000001Z';f.plans[0].review.expires_at=f.plans[0].body.expires_at;await rehash(f.plans[0]);
 const h=harness({previewData:await parse(f)}),approve=()=>h.buttons.find(button=>button.props.children==='核准此價格計畫');assert.equal(approve().props.disabled,false);
 h.advance(1);assert.equal(approve().props.disabled,true);assert.equal(h.calls.length,0);h.unmount();assert.equal(h.timers,0);
});
test('actual private preview displays four reviews and conditional prices while pending records remain unapproved',async()=>{
 const {createServer}=await import('../node_modules/vite/dist/node/index.js'),React=await import('../node_modules/react/index.js'),{renderToStaticMarkup}=await import('../node_modules/react-dom/server.node.js');
 const root=new URL('../',import.meta.url).pathname,server=await createServer({configFile:false,root,resolve:{alias:{'@':root+'src'}},server:{middlewareMode:true,hmr:false},appType:'custom'}),originalNow=Date.now;
 try{Date.now=()=>NOW;const {default:Page,DailyAiOwnerPricePreview:Preview}=await server.ssrLoadModule('/src/pages/vnext/DailyAiOwnerPricePlans.tsx');
  for(const a of [{kind:'denied'},{kind:'loading'},access(OWNER,1,'premium')])assert.equal(renderToStaticMarkup(React.createElement(Page,{access:a,editionId:EDITION})), '');
  const value=await parse(await fixture({reviewed:false})),html=renderToStaticMarkup(React.createElement(Preview,{data:value,onReview:()=>assert.fail('SSR cannot publish')}));
  assert(html.includes('NT$100～105'));assert(html.includes('來源用途'));assert(html.includes('方法 待完成'));assert(html.includes('尚未收到獨立價格審查'));
  assert.match(html,/<button disabled="">核准此價格計畫<\/button>/);assert(!html.includes('PRIVATE_PROVIDER'));
 }finally{Date.now=originalNow;await server.close();}
});
