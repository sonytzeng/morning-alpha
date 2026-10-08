// Synthetic presentation contracts only. No network, DB, credentials or business writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import * as status from '../src/features/owner/status.ts';
import {ownerBackendFixture,syntheticOwnerStatus,fixture as visualFixture,OWNER_BACKEND_SCENARIOS,OWNER_BACKEND_TODAY as TODAY,OWNER_BACKEND_PRIOR as PRIOR} from './fixtures/owner-backend-ui.mjs';

const schedule=ownerBackendFixture().schedule;
function fixture(time='00:27:00'){
 return ownerBackendFixture('MIDNIGHT_WAITING',{as_of:`${TODAY}T${time}+08:00`});
}
const item=(r,key)=>status.ownerSummary(r).flow.concat(status.ownerSummary(r).items).find(x=>x.key===key);
const currentReport=(recommendation_status='BLOCKED')=>({business_date:TODAY,publication_status:'PUBLISHED',publication_date:TODAY,recommendation_status});

test('Owner footer and white navigation keep AA text contrast without touching member styles',()=>{
 const css=readFileSync(new URL('../src/pages/admin/simple/owner-simple.css',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../src/pages/admin/Admin.tsx',import.meta.url),'utf8');
 assert.match(css,/\.owner-simple footer \{ color:#cbd5e1; background:var\(--owner-navy\)/);
 assert.match(css,/\.owner-backend-layout nav a\.bg-primary-500 \{ background:#0f766e; color:#fff;/);
 assert.match(admin,/item\.path !== '\/admin\/publish' && item\.path === location\.pathname/);
 const luminance=hex=>{const c=hex.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 for(const [foreground,background] of [['cbd5e1','0b182b'],['172033','ffffff'],['334155','ffffff'],['ffffff','0f766e']]){
  const a=luminance(foreground),b=luminance(background);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);
 }
});

test('00:27 Taipei: prior report remains visibly prior; today is WAITING, not late or failed',()=>{
 const r=fixture(),s=status.ownerSummary(status.readOwnerStatus(r));
 assert.equal(status.taipeiDate(r.as_of),TODAY);
 assert.equal(item(r,'report').status,'WAITING');assert.equal(item(r,'report').date,PRIOR);
 assert.match(item(r,'report').detail,/上一交易日|前一交易日|昨日/);
 assert.notEqual(s.status,'PASS');assert.notEqual(s.status,'CORE_FAIL');
 assert(!s.flow.some(x=>['CORE_FAIL','ACTION_REQUIRED'].includes(x.status)));
 assert.equal(s.next?.name,'morning-alpha-daily-refresh-primary');
 assert.equal(s.next?.at,'2026-10-07T23:00:00.000Z');
});

test('missing daily report uses the returned active SLA, not a hardcoded 07:30 cutoff',()=>{
 const r=fixture('07:45:00');r.sla[0].deadline='08:10';
 assert(!['PASS','ACTION_REQUIRED','CORE_FAIL'].includes(item(r,'report').status));
 r.as_of=`${TODAY}T08:10:00+08:00`;
 assert.equal(item(r,'report').status,'ACTION_REQUIRED');assert.equal(item(r,'line').status,'ACTION_REQUIRED');
 r.sla[0].active=false;assert.equal(item(r,'report').status,'NOT_OBSERVED');
 r.sla=[];assert.equal(item(r,'report').status,'NOT_OBSERVED');
});

test('closing has its own real SLA; 14:59 is not a missed 15:00 deadline',()=>{
 const r=fixture('14:59:00');assert(!['PASS','ACTION_REQUIRED','CORE_FAIL'].includes(item(r,'closing').status));
 r.as_of=`${TODAY}T15:00:00+08:00`;assert.equal(item(r,'closing').status,'ACTION_REQUIRED');
 r.sla[1].deadline='15:30';assert.notEqual(item(r,'closing').status,'ACTION_REQUIRED');
});

test('official holiday waits for next trading session even after normal weekday SLA',()=>{
 const r=fixture('16:00:00');r.today_date='2026-10-09';r.as_of='2026-10-09T16:00:00+08:00';
 const s=status.ownerSummary(r);
 assert(s.flow.every(x=>x.status==='WAITING'));
 assert.equal(status.taipeiDate(s.next.at),'2026-10-12');
 assert.equal(s.next.at,'2026-10-11T23:00:00.000Z');
});

for(const calendar of [[],[{date:TODAY,is_trading_day:null}],[{date:TODAY,is_trading_day:'true'}]]){
 test(`unknown calendar never fabricates a trading day, PASS or overdue failure: ${JSON.stringify(calendar)}`,()=>{
  const r=fixture('18:00:00');r.calendar=calendar;
  assert(status.ownerSummary(r).flow.every(x=>x.status==='NOT_OBSERVED'));
  assert.equal(status.ownerSummary(r).next,undefined);
 });
}

test('official verdict mapping is fail-closed for unknown, missing and legacy status tokens',()=>{
 for(const value of [null,undefined,'','UNKNOWN','OK','HEALTHY','SUCCEEDED','READY',true,100,{},'pass'])assert.equal(status.officialStatus(value),'NOT_OBSERVED',String(value));
 for(const value of ['PASS','DEGRADED','CORE_FAIL'])assert.equal(status.officialStatus(value),value);
 assert.equal(status.officialStatus('FAIL'),'ACTION_REQUIRED');
 assert.equal(status.officialStatus('NOT_DUE'),'WAITING');
});

test('today official PASS wins over legacy health; V1 BLOCKED remains data missing, never Core failure',()=>{
 const r=fixture('08:00:00');r.acceptance={business_date:TODAY,overall_status:'PASS',verdict:'PASS',dimensions:{RECOMMENDATION:'BLOCKED'}};
 r.report=currentReport('BLOCKED');
 r.legacy_health=[{check_date:TODAY,health_score:0,issues:['CORE_FAIL']}];
 assert.equal(status.ownerSummary(r).status,'PASS');
 assert.equal(item(r,'recommendation').status,'DATA_MISSING');
 assert.match(item(r,'recommendation').detail,/不代表.*沒有機會/);
 assert.notEqual(item(r,'report').status,'CORE_FAIL');
 r.acceptance.overall_status='DEGRADED';r.legacy_health[0].health_score=100;
 assert.equal(status.ownerSummary(r).status,'DEGRADED');
 r.acceptance.overall_status='UNKNOWN';assert.equal(status.ownerSummary(r).status,'NOT_OBSERVED');
});

test('formal NONE is a completed assessment, not the same thing as BLOCKED or unknown',()=>{
 const r=fixture('08:00:00');r.report=currentReport('NONE');
 assert.equal(item(r,'recommendation').status,'PASS');assert.match(item(r,'recommendation').detail,/沒有符合/);
 r.report.recommendation_status='NOT_A_VERDICT';assert.equal(item(r,'recommendation').status,'NOT_OBSERVED');
});

test('report PASS requires the formal PUBLISHED contract with both dates current',()=>{
 const r=fixture('08:00:00');r.report=currentReport();assert.equal(item(r,'report').status,'PASS');
 for(const patch of [
  {publication_status:undefined},{publication_status:'UNKNOWN'},{publication_status:'READY'},
  {publication_status:'DRAFT'},{publication_date:undefined},{publication_date:PRIOR},
  {business_date:PRIOR},{business_date:'2026-10-09'},
 ]){r.report={...currentReport(),...patch};assert.notEqual(item(r,'report').status,'PASS',JSON.stringify(patch));}
});

test('unknown current runtime, learning and market counters never acquire a PASS',()=>{
 const r=fixture();r.runtime={business_date:TODAY,decision_status:'UNKNOWN',closing_status:'UNKNOWN'};r.learning={business_date:TODAY,status:'unknown'};
 r.batches=[{checkpoint:'PREMARKET',status:'COMMITTED',committed_provider_count:null,expected_provider_count:11,committed_at:`${TODAY}T00:20:00+08:00`}];
 for(const key of ['decision','closing','learning','market'])assert.notEqual(item(r,key).status,'PASS',key);
 r.batches[0].committed_provider_count=11;r.batches[0].expected_provider_count=null;assert.notEqual(item(r,'market').status,'PASS');
 r.batches[0].expected_provider_count=11;r.batches[0].status='UNKNOWN';assert.notEqual(item(r,'market').status,'PASS');
});

test('prior acceptance and prior recommendation success are never presented as today completed',()=>{
 const r=fixture();r.report.recommendation_status='READY';
 const s=status.ownerSummary(r);
 assert.notEqual(s.status,'PASS');assert.equal(s.acceptanceDate,PRIOR);
 assert.equal(item(r,'recommendation').status,'WAITING');
 assert.doesNotMatch(item(r,'recommendation').detail,/正式推薦評估已完成|今天沒有符合/);
});

for(const [name,field,key,value] of [
 ['decision','runtime','decision',{decision_status:'READY'}],
 ['closing','closing','closing',{data_quality:'高可信',missing_count:0,has_result:true,updated_at:`${PRIOR}T14:50:00+08:00`}],
 ['learning','learning','learning',{status:'succeeded'}],
])test(`prior ${name} success must not become a current-day PASS`,()=>{
 const r=fixture();r[field]={business_date:PRIOR,...value};
 assert.notEqual(item(r,key).status,'PASS');
 assert.doesNotMatch(item(r,key).detail,/今日.*已(建立|完成)/);
});

test('prior failed closing must not become a current-day incident',()=>{
 const r=fixture();r.runtime={business_date:PRIOR,closing_status:'FAILED'};
 r.closing={business_date:PRIOR,data_quality:'資料不足',missing_count:1,has_result:false,updated_at:`${PRIOR}T14:50:00+08:00`};
 assert.equal(item(r,'closing').status,'WAITING');
 assert.doesNotMatch(status.ownerSummary(r).action,/需要確認：.*收盤驗證/);
});

test('current dated decision, close and learning results remain observable',()=>{
 const r=fixture('16:00:00');r.runtime={business_date:TODAY,decision_status:'READY',closing_status:'SUCCEEDED'};r.learning={business_date:TODAY,status:'succeeded'};
 r.closing=ownerBackendFixture('CURRENT_PASS').closing;
 for(const key of ['decision','closing','learning'])assert.equal(item(r,key).status,'PASS',key);
});

test('14:30 checkpoint SUCCEEDED without an actual close review never establishes closing PASS',()=>{
 for(const time of ['14:59:00','16:00:00']){
  const r=ownerBackendFixture('CURRENT_PASS',{as_of:`${TODAY}T${time}+08:00`,closing:null});
  assert.equal(r.runtime.closing_status,'SUCCEEDED');
  assert.notEqual(item(r,'closing').status,'PASS');
  assert.doesNotMatch(item(r,'closing').detail,/今日收盤驗證已完成/);
 }
});

test('close review PASS requires current complete high-quality proof, never stale, missing or unknown metadata',()=>{
 const patches=[
  {business_date:PRIOR},{business_date:null},{business_date:'2026-10-09'},
  {data_quality:'UNKNOWN'},{data_quality:'低可信'},{data_quality:null},{data_quality:undefined},
  {missing_count:1},{missing_count:null},{missing_count:undefined},{missing_count:'0'},
  {has_result:false},{has_result:null},{has_result:undefined},{has_result:'true'},
  {updated_at:`${PRIOR}T14:50:00+08:00`},{updated_at:`${TODAY}T16:01:00+08:00`},
  {updated_at:null},{updated_at:undefined},{updated_at:'invalid'},
 ];
 for(const patch of patches){
  const r=ownerBackendFixture('CURRENT_PASS');r.closing={...r.closing,...patch};
  assert.notEqual(item(r,'closing').status,'PASS',JSON.stringify(patch));
 }
 for(const closing of [null,undefined,{}]){
  assert.notEqual(item(ownerBackendFixture('CURRENT_PASS',{closing}),'closing').status,'PASS');
 }
});

test('a complete close review stands on its own saved proof, not the 14:30 checkpoint',()=>{
 const r=ownerBackendFixture('CURRENT_PASS',{runtime:null});
 assert.equal(item(r,'closing').status,'PASS');
});

test('a review miss is still completed verification, never a claim of prediction accuracy',()=>{
 for(const verificationResult of ['命中','未命中']){
  const r=ownerBackendFixture('CURRENT_PASS');
  // The read model projects result presence, not a hit/miss accuracy verdict.
  r.closing.has_result=verificationResult.trim().length>0;
  const closing=item(r,'closing');assert.equal(closing.status,'PASS');
  assert.match(closing.detail,/完成驗證不代表市場方向預測命中/);
  assert(r.quality.market_direction.every(metric=>metric.accuracy===null));
 }
});

test('LINE delivery with unknown failure count cannot claim PASS',()=>{
 const r=fixture('08:00:00');r.line={total:3,sent:3,failed:null,pending:0,last_sent_at:`${TODAY}T07:29:00+08:00`};
 assert.notEqual(item(r,'line').status,'PASS');
 r.line.failed=0;assert.equal(item(r,'line').status,'PASS');
 r.line.failed=1;assert.equal(item(r,'line').status,'ACTION_REQUIRED');
});

test('old LINE delivery timestamp does not establish current success',()=>{
 const r=fixture();r.line={total:3,sent:3,failed:0,pending:0,last_sent_at:`${PRIOR}T07:29:00+08:00`};
 assert.notEqual(item(r,'line').status,'PASS');
});

test('old premarket batch completion timestamp does not establish current success',()=>{
 const r=fixture();
 r.batches=[{checkpoint:'PREMARKET',status:'COMMITTED',committed_provider_count:11,expected_provider_count:11,committed_at:`${PRIOR}T07:00:00+08:00`}];
 assert.notEqual(item(r,'market').status,'PASS');
});

test('old intraday batch completion timestamp does not establish current success',()=>{
 const r=fixture();
 r.batches=[{checkpoint:'0900',status:'COMMITTED',committed_provider_count:11,expected_provider_count:11,committed_at:`${PRIOR}T09:01:00+08:00`}];
 assert.notEqual(item(r,'intraday').status,'PASS');
});

test('intraday counts only the six named current checkpoints and deduplicates repeated checkpoints',()=>{
 const r=fixture('16:00:00');
 const batch=checkpoint=>({checkpoint,status:'COMMITTED',committed_provider_count:11,expected_provider_count:11,committed_at:`${TODAY}T14:31:00+08:00`});
 r.batches=[batch('PREMARKET'),batch('UNKNOWN'),batch('SYNTHETIC_OTHER')];assert.notEqual(item(r,'intraday').status,'PASS');
 r.batches.push(batch('0900'),batch('0900'));assert.equal(item(r,'intraday').status,'PASS');assert.match(item(r,'intraday').detail,/1\s*[／/]\s*6/);
 r.batches=['0900','0930','1030','1300','1410','1430'].map(batch);assert.match(item(r,'intraday').detail,/6\s*[／/]\s*6/);
});

test('server as_of and today_date must describe the same Taipei date',()=>{
 const r=fixture();assert.doesNotThrow(()=>status.readOwnerStatus(r));
 r.today_date=PRIOR;assert.throws(()=>status.readOwnerStatus(r),/OWNER_READ_CONTRACT_INVALID/);
});

test('malformed read contract and business-write payloads cannot be accepted',()=>{
 for(const patch of [{schema_version:'OTHER'},{business_writes:1},{today_date:'unknown'},{as_of:'invalid'},{calendar:null},{schedule:{}}])
  assert.throws(()=>status.readOwnerStatus({...fixture(),...patch}),/OWNER_READ_CONTRACT_INVALID/);
});

test('cron fields are UTC, including previous UTC day and Sunday-to-Monday conversion',()=>{
 const r=fixture();r.calendar=[{date:'2026-10-12',is_trading_day:true}];
 const events=status.scheduledEvents(r);
 assert.equal(events.find(e=>e.name==='morning-alpha-daily-generate-primary').at,'2026-10-11T23:05:00.000Z');
 assert.equal(events.find(e=>e.name==='morning-alpha-runtime-0900-primary').at,'2026-10-12T01:00:00.000Z');
 r.schedule=[{name:'utc-date-check',expression:'5 23 11 10 0',active:true}];
 assert.deepEqual(status.scheduledEvents(r),[{name:'utc-date-check',at:'2026-10-11T23:05:00.000Z'}]);
 r.schedule[0].expression='5 23 12 10 1';assert.deepEqual(status.scheduledEvents(r),[]);
});

test('unsupported cron timezone/expression and inactive jobs are unknown, never guessed',()=>{
 const r=fixture();r.cron_timezone='Asia/Taipei';assert.deepEqual(status.scheduledEvents(r),[]);
 r.cron_timezone='UTC';r.schedule=[{name:'unknown',expression:'*/5 * * * *',active:true}];assert.deepEqual(status.scheduledEvents(r),[]);
 r.schedule=[{...schedule[0],active:false}];assert.deepEqual(status.scheduledEvents(r),[]);
 r.schedule=[{...schedule[0],expression:'99 25 * * *'}];assert.deepEqual(status.scheduledEvents(r),[]);
});

const pageSource=readFileSync(new URL('../src/pages/admin/simple/OwnerSimplePage.tsx',import.meta.url),'utf8');
const pageCode=ts.transpileModule(pageSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const jsx=(type,props)=>({type,props});
const materialize=node=>node==null?null:Array.isArray(node)?node.map(materialize):typeof node!=='object'?node:typeof node.type==='function'?materialize(node.type(node.props)):{...node,props:{...node.props,children:materialize(node.props?.children)}};
const visible=node=>node==null?'':Array.isArray(node)?node.map(visible).join(' '):typeof node==='object'?visible(node.props?.children):String(node);
const find=(node,predicate)=>node==null?undefined:Array.isArray(node)?node.map(x=>find(x,predicate)).find(Boolean):typeof node==='object'?(predicate(node)?node:find(node.props?.children,predicate)):undefined;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(page='today'){
 let cursor=0,effect,listener,updates=0,unsubscribed=0;const slots=[],requests=[],calls=[],timers=[],effects=[];
 const hooks={
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{updates++;slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useEffect(fn,deps){if(!effect||deps.some((v,i)=>v!==effect.deps[i])){effect?.cleanup?.();effect={deps:[...deps]};effects.push(()=>{effect.cleanup=fn();});}},
 };
 const forbidden=name=>(...args)=>{calls.push({name,args});throw Error('Unexpected write or alternate data access: '+name);};
 const supabase={
  rpc(name,...args){calls.push({name,args});return new Promise((resolve,reject)=>requests.push({resolve,reject}));},
  from:forbidden('from'),functions:{invoke:forbidden('invoke')},channel:forbidden('channel'),
  auth:{onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){unsubscribed++;}}}};}},
 };
 const exports={};vm.runInNewContext(pageCode,{exports,setTimeout:fn=>{timers.push(fn);return timers.length;},require(name){
  if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
  if(name==='react-router-dom')return {Link:props=>jsx('a',props)};
  if(name==='@/lib/supabase')return {supabase};if(name==='@/features/owner/status')return status;
  if(name==='./owner-simple.css')return {};throw Error('Unexpected import: '+name);
 }});
 const render=()=>{cursor=0;const tree=materialize(exports.default({page}));while(effects.length)effects.shift()();return tree;};
 render();
 return {render,text:()=>visible(render()),calls,requests,auth:event=>listener(event),
  async resolve(index,data=fixture(),error=null){requests[index].resolve({data,error});await tick();},
  async reject(index){requests[index].reject(Error('SYNTHETIC_READ_FAILURE'));await tick();},
  async timers(){while(timers.length)timers.shift()();await tick();},
  refresh(){find(render(),node=>node.type==='button').props.onClick();render();},
  unmount(){effect.cleanup();},get updates(){return updates;},get unsubscribed(){return unsubscribed;},
 };
}

for(const page of ['today','system','health','data','learning'])test(`shared ${page} page reads only get_owner_backend_status_v1; refresh never invokes repair`,async()=>{
 const h=harness(page);assert.match(h.text(),/尚未判定正常或異常/);await h.resolve(0);
 assert.match(h.text(),/查看技術詳細資料/);assert.match(h.text(),/不會執行重送/);
 h.refresh();await h.resolve(1);
 assert.deepEqual(h.calls.map(c=>c.name),['get_owner_backend_status_v1','get_owner_backend_status_v1']);
 assert(h.calls.every(c=>c.args.length===0));h.unmount();assert.equal(h.unsubscribed,2);
});

test('unknown overall status is not a green badge in the rendered Owner overview',async()=>{
 const r=fixture();r.acceptance={business_date:TODAY,overall_status:'UNRECOGNIZED',verdict:'PASS'};
 const h=harness();await h.resolve(0,r);
 const overview=find(h.render(),node=>node.props?.className?.includes('owner-overview'));
 assert(!find(overview,node=>node.props?.className==='owner-status owner-status-PASS'));
 assert.match(visible(overview),/尚未取得驗證結果/);h.unmount();
});

test('logout generation wins a late initial response and removes already displayed private data',async()=>{
 const r={...fixture(),test_private_marker:'SYNTHETIC_OWNER_PRIVATE'};
 const late=harness();late.auth('SIGNED_OUT');await late.resolve(0,r);
 assert.doesNotMatch(late.text(),/SYNTHETIC_OWNER_PRIVATE/);assert.match(late.text(),/僅限 Sony Owner/);late.unmount();
 const loaded=harness();await loaded.resolve(0,r);assert.match(loaded.text(),/SYNTHETIC_OWNER_PRIVATE/);
 loaded.auth('SIGNED_OUT');assert.doesNotMatch(loaded.text(),/SYNTHETIC_OWNER_PRIVATE/);loaded.unmount();
});

test('new sign-in generation rejects stale success and stale failure from the previous identity',async()=>{
 for(const rejectOld of [false,true]){
  const h=harness();h.auth('SIGNED_OUT');h.auth('SIGNED_IN');await h.timers();
  await h.resolve(1,{...fixture(),test_private_marker:'SYNTHETIC_NEW_OWNER'});
  if(rejectOld)await h.reject(0);else await h.resolve(0,{...fixture(),test_private_marker:'SYNTHETIC_OLD_OWNER'});
  assert.match(h.text(),/SYNTHETIC_NEW_OWNER/);assert.doesNotMatch(h.text(),/SYNTHETIC_OLD_OWNER|SYNTHETIC_READ_FAILURE/);h.unmount();
 }
});

test('token refresh and effect cleanup cannot resurrect an older read',async()=>{
 const h=harness();h.auth('TOKEN_REFRESHED');await h.timers();
 await h.resolve(1,{...fixture(),test_private_marker:'SYNTHETIC_REFRESHED'});
 await h.resolve(0,{...fixture(),test_private_marker:'SYNTHETIC_STALE'});
 assert.match(h.text(),/SYNTHETIC_REFRESHED/);assert.doesNotMatch(h.text(),/SYNTHETIC_STALE/);
 h.refresh();h.unmount();const updates=h.updates;
 await h.resolve(2,{...fixture(),test_private_marker:'SYNTHETIC_UNMOUNTED'});
 assert.equal(h.updates,updates);assert.equal(h.unsubscribed,2);
});

test('RPC denial and invalid contract never display returned Owner data or claim PASS',async()=>{
 for(const error of [{code:'42501',message:'SYNTHETIC_PRIVATE_ERROR'},{code:'network',message:'SYNTHETIC_PRIVATE_ERROR'}]){
  const h=harness();await h.resolve(0,{...fixture(),test_private_marker:'SYNTHETIC_LEAK'},error);
  assert.doesNotMatch(h.text(),/SYNTHETIC_LEAK|SYNTHETIC_PRIVATE_ERROR/);
  assert(find(h.render(),node=>node.props?.role==='alert'));h.unmount();
 }
 const h=harness();await h.resolve(0,{...fixture(),business_writes:1,test_private_marker:'SYNTHETIC_INVALID'});
 assert.doesNotMatch(h.text(),/SYNTHETIC_INVALID/);assert(find(h.render(),node=>node.props?.role==='alert'));h.unmount();
});

test('simple page has no function invoke, table write, scheduled task or automatic repair path',()=>{
 assert.deepEqual([...pageSource.matchAll(/supabase\.rpc\(['"]([^'"]+)['"]/g)].map(m=>m[1]),['get_owner_backend_status_v1']);
 assert.doesNotMatch(pageSource,/supabase\.functions|\.invoke\(|\.insert\(|\.upsert\(|\.update\(|\.delete\(|setInterval\(|service_role|SERVICE_ROLE/);
});

// Real React SSR for the exported view. Hooks remain covered by the separate
// generation-aware wrapper harness above; SSR is not a browser-layout claim.
const require=createRequire(import.meta.url);
function loadView(){
 const module={exports:{}};
 vm.runInNewContext(pageCode,{module,exports:module.exports,require(name){
  if(['react','react/jsx-runtime','react-router-dom'].includes(name))return require(name);
  if(name==='@/features/owner/status')return status;
  if(name==='./owner-simple.css')return {};
  if(name==='@/lib/supabase')return {supabase:new Proxy({}, {get(){throw Error('SSR_VIEW_MUST_NOT_READ_OR_WRITE');}})};
  throw Error('UNAPPROVED_OWNER_SSR_IMPORT:'+name);
 }});
 assert.equal(typeof module.exports.OwnerSimpleView,'function');
 return module.exports.OwnerSimpleView;
}
const View=loadView();
const ssr=(page,data=ownerBackendFixture(),extra={})=>renderToStaticMarkup(React.createElement(MemoryRouter,null,
 React.createElement(View,{page,data,loading:false,error:'',onRefresh:()=>{throw Error('SSR_MUST_NOT_REFRESH');},...extra})));
const detailsBlocks=html=>[...html.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(m=>m[0]);
const withoutDetails=html=>html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
for(const [page,heading] of Object.entries({today:'今天 Morning Alpha 正常嗎？',system:'目前系統狀況',health:'最近系統穩定嗎？',data:'今天的資料可以相信嗎？',learning:'Morning Alpha 最近判斷準不準？'})){
 test(`SSR ${page}: human summary visible, technical diagnostics present but details closed`,()=>{
  const html=ssr(page),blocks=detailsBlocks(html),outside=withoutDetails(html);
  assert.match(html,new RegExp(`data-owner-page="${page}"`));assert(html.includes(heading));
  if(page==='learning')assert.doesNotMatch(outside,/今天需要我處理什麼|owner-overview/);
  else {assert.match(outside,/今天需要我處理什麼/);assert.match(outside,/owner-overview/);}
  assert.match(outside,/重新整理/);
  assert.equal(blocks.length,1);assert.match(blocks[0],/查看技術詳細資料/);
  assert.doesNotMatch(blocks[0].split('>')[0],/\sopen(?:\s|=|$)/);
  assert.match(blocks[0],/SYNTHETIC_OWNER_DIAGNOSTIC|OWNER_BACKEND_STATUS_V1/);
  assert.doesNotMatch(outside,/SYNTHETIC_OWNER_DIAGNOSTIC|OWNER_BACKEND_STATUS_V1|health_score/);
  assert.doesNotMatch(outside,/<pre\b/);
 });
}

test('SSR midnight fallback shows today and actual previous report date without claiming a missed deadline',()=>{
 const html=withoutDetails(ssr('today'));
 assert.match(html,/2026-10-08/);assert.match(html,/2026-10-07/);assert.match(html,/等待中/);
 assert.match(html,/上一交易日/);assert.doesNotMatch(html,/已超過正式交付目標|owner-status-CORE_FAIL|owner-status-ACTION_REQUIRED/);
});

test('SSR official PASS and recommendation BLOCKED remain distinct despite low legacy health',()=>{
 const html=withoutDetails(ssr('today',ownerBackendFixture('RECOMMENDATION_BLOCKED')));
 const overview=html.match(/<section class="owner-simple-card owner-overview">[\s\S]*?<\/section>/)?.[0];
 assert.match(overview,/owner-status-PASS/);assert.match(html,/股票推薦評估/);assert.match(html,/owner-status-DATA_MISSING/);
 assert.match(html,/不代表市場沒有機會/);assert.doesNotMatch(overview,/owner-status-CORE_FAIL/);
});

test('SSR learning starts with actual 30/90-day metrics and retains acceptance only in technical details',()=>{
 const html=ssr('learning',ownerBackendFixture('CURRENT_PASS')),outside=withoutDetails(html);
 assert.match(outside,/<\/header><section class="owner-simple-card"><h2>市場方向<\/h2>/);
 assert.match(outside,/最近 30 天/);assert.match(outside,/最近 90 天/);assert.match(outside,/資料不足/);
 assert.doesNotMatch(outside,/owner-overview|正式營運驗收|owner-status-PASS|今天需要我處理什麼/);
 const details=detailsBlocks(html)[0];
 assert.match(details,/&quot;acceptance&quot;/);assert.match(details,/&quot;overall_status&quot;:\s*&quot;PASS&quot;/);
});

test('LINE summary says sent rather than claiming recipient delivery, without changing status or counts',()=>{
 const r=ownerBackendFixture('CURRENT_PASS'),line=item(r,'line');
 assert.equal(line.status,'PASS');assert.equal(line.detail,'已發送 3／3；失敗 0。');
 for(const page of ['today','system','health']){
  const html=withoutDetails(ssr(page,r));assert.match(html,/已發送 3／3；失敗 0。/);assert.doesNotMatch(html,/已送達/);
 }
});

test('SSR learning keeps zero/insufficient samples honest and separates research from live performance',()=>{
 const html=withoutDetails(ssr('learning'));
 assert.match(html,/市場方向/);assert.match(html,/股票推薦研究/);assert.match(html,/資料不足/);
 assert.match(html,/尚未累積前瞻驗證樣本/);assert.match(html,/尚未對會員發布/);
 assert.match(html,/不是股票推薦勝率/);assert.match(html,/不顯示估算數字/);
 assert.doesNotMatch(html,/>\s*(?:0|100)%\s*</);
});

test('SSR stock-data card never reports PASS for stale, incomplete or unknown acquisition proof',()=>{
 for(const patch of [{business_date:PRIOR},{universe:null},{historical_20d:null},{failed_captures:null},{failed_captures:1}]){
  const r=ownerBackendFixture('CURRENT_PASS');r.stock_data={...r.stock_data,...patch};
  const html=withoutDetails(ssr('data',r));
  const card=[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(m=>m[0]).find(part=>part.includes('股票量價資料'));
  assert(card);assert.doesNotMatch(card,/owner-status-PASS/,JSON.stringify(patch));
 }
});

test('SSR missing or truncated quality metrics never turn into a displayed accuracy percentage',()=>{
 for(const patch of [{accuracy:null},{independent_days:0},{truncated:true},{truncated:undefined}]){
  const r=ownerBackendFixture();r.quality.market_direction=[{days:30,samples:30,independent_days:20,accuracy:88.5,truncated:false,...patch}];
  const html=withoutDetails(ssr('learning',r));assert.match(html,/資料不足/);assert.doesNotMatch(html,/88\.5%/);
 }
});

test('SSR loading and owner denial omit data-bearing sections and keep error details collapsed',()=>{
 const r=ownerBackendFixture('CURRENT_PASS');
 const loading=ssr('today',r,{loading:true});assert.match(loading,/role="status"/);assert.match(loading,/disabled=""/);
 assert.doesNotMatch(loading,/SYNTHETIC_CURRENT_REPORT|owner-overview/);
 const denied=ssr('today',null,{error:'OWNER_REQUIRED'});assert.match(denied,/僅限 Sony Owner/);
 assert.doesNotMatch(denied,/owner-overview|SYNTHETIC_CURRENT_REPORT/);
 const blocks=detailsBlocks(denied);assert.equal(blocks.length,1);assert.doesNotMatch(blocks[0].split('>')[0],/\sopen(?:\s|=|$)/);
});

test('reusable synthetic fixture exports fresh isolated scenarios without test registration',()=>{
 assert.equal(syntheticOwnerStatus,ownerBackendFixture);
 assert.equal(visualFixture('07:45:00').as_of,`${TODAY}T07:45:00+08:00`);
 for(const scenario of OWNER_BACKEND_SCENARIOS)assert.doesNotThrow(()=>status.readOwnerStatus(ownerBackendFixture(scenario)),scenario);
 const first=ownerBackendFixture(),second=ownerBackendFixture();first.schedule[0].active=false;
 assert.equal(second.schedule[0].active,true);assert.throws(()=>ownerBackendFixture('REAL_PRODUCTION'),/UNKNOWN_SYNTHETIC/);
 const source=readFileSync(new URL('./fixtures/owner-backend-ui.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from ['"]node:test|\bfetch\(|process\.env|createClient|supabase\.rpc/);
});
