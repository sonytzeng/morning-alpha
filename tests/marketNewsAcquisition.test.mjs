import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {shouldAcquirePremarketNews,collectOptionalPremarketNews,newsAcquisitionObservation,NEWS_ACQUISITION_BUDGET} from '../supabase/functions/_shared/market-news-acquisition.ts';
import {filterPremiumNewsEvidence} from '../supabase/functions/_shared/premium-evidence.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const capture=JSON.parse(readFileSync(new URL('fixtures/market-news-20261008.json',import.meta.url)));
const base={phase:'refresh',taipeiMinutes:420,hasReport:false,forceRegenerate:false,actions:['refresh_market']};

test('retained 20-day runs prove missing caller, not an invented empty provider response',()=>{
 assert.equal(new Set(capture.rows.map(r=>r.date)).size,20);
 const news=capture.rows.filter(r=>r.news);
 assert.equal(news.length,105);
 assert.equal(news.reduce((s,r)=>s+r.news.total_raw,0),18283);
 assert.equal(news.reduce((s,r)=>s+r.news.after_dedup,0),18245);
 assert.equal(news.reduce((s,r)=>s+r.news.canonical_upserted_count,0),510);
 for(const day of ['2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08']){
  const rows=capture.rows.filter(r=>r.date===day);
  assert(rows.length>0);assert(rows.every(r=>!r.news&&!r.actions.includes('refresh_news')));
  assert(shouldAcquirePremarketNews({...base,phase:rows[0].phase,actions:rows[0].actions}));
 }
});

test('sidecar only uses the existing premarket refresh slot, never delivery/deadline/history',()=>{
 assert(shouldAcquirePremarketNews(base));
 for(const change of [{hasReport:true},{forceRegenerate:true},{actions:['refresh_news']},{actions:['deliver_incident']},
  ...[419,425,525,900].map(taipeiMinutes=>({taipeiMinutes})),
  ...['generate','repair','deliver','watchdog','runtime_checkpoint'].map(phase=>({phase}))])
  assert.equal(shouldAcquirePremarketNews({...base,...change}),false);
 assert.equal(NEWS_ACQUISITION_BUDGET.timeoutMs*NEWS_ACQUISITION_BUDGET.maxAttempts+5000,125000);
 assert(125000<5*60000);
});

test('optional news failure is classified and cannot throw into business execution',async()=>{
 const p={total_raw:177,after_dedup:177,canonical_upserted_count:1,canonical_complete:true};
 const ready=await collectOptionalPremarketNews(async()=>({ok:true,status:200,payload:p}));
 assert.equal(ready.classification,'CAPTURED_PENDING_REPORT_QUALITY');assert.equal(ready.report_accepted,null);
 for(const status of [401,429,500,599])assert.equal((await collectOptionalPremarketNews(async()=>({ok:false,status,payload:{}}))).classification,'FETCH_FAILED');
 assert.equal((await collectOptionalPremarketNews(async()=>{throw Error('synthetic sensitive detail');})).classification,'FETCH_FAILED');
 assert.equal(newsAcquisitionObservation({ok:false,status:200,payload:{canonical_complete:false}}).classification,'INTEGRATION_FAILED');
 assert.equal(newsAcquisitionObservation({ok:true,status:200,payload:{total_raw:0}}).classification,'SOURCE_EMPTY');
 const out=newsAcquisitionObservation({ok:true,status:200,payload:{...p,logs:['DO_NOT_PERSIST'],token:'DO_NOT_PERSIST',source_url:'DO_NOT_PERSIST'}});
 assert(!JSON.stringify(out).includes('DO_NOT_PERSIST'));assert.equal(out.business_dependency,false);
});

test('retained news keeps the unchanged Report quality and publication-time gate',()=>{
 const byDate=day=>{
  const now=Date.parse(day+'T07:30:00+08:00');
  return filterPremiumNewsEvidence(capture.retained_news.filter(r=>r.has_tag&&Date.parse(r.created_at)<=now&&Date.parse(r.published_at)<=now),now);
 };
 assert(byDate('2026-09-30').verified.length>0,'actual retained pre-SLA news can pass the existing gate');
 assert.equal(byDate('2026-10-05').verified.length,0,'expired retained news must not repair the future');
 assert.equal(byDate('2026-10-08').verified.length,0);
 const oct2=byDate('2026-10-02');
 assert.equal(oct2.verified.length,0);
 assert(oct2.rejected.some(r=>r.reason_codes.includes('taiwan_market_relevance_unproven')));
});

// Actual entrypoint/auth/planner/Atomic guard/finish path. DB and provider are
// explicit isolated test doubles; this is NOT a new Production provider call.
function handlerHarness({day='2026-10-08',prior=false,newsStatus=200,duplicate=false}={}){
 const modules=new Map(),calls=[],writes=[],pauses=[];let handler;
 const origin='http://127.0.0.1:55499',fake='LOCAL_NEWS_TEST_ONLY';
 const clock=class extends Date{constructor(...args){super(...(args.length?args:[day+'T07:00:02+08:00']));}static now(){return new Date(day+'T07:00:02+08:00').getTime();}};
 const sdk={from(table){let operation='select',payload;
  const q=new Proxy({}, {get(_,key){if(key==='then')return(resolve)=>{
   assert(['reports','data_provider_health','pipeline_runs'].includes(table),'unexpected table '+table);
   if(operation==='update'){writes.push({table,payload});return Promise.resolve(resolve({data:null,error:null}));}
   if(operation==='insert')return Promise.resolve(resolve(duplicate?{data:null,error:{code:'23505'}}:{data:{id:'local-run'},error:null}));
   return Promise.resolve(resolve({data:table==='pipeline_runs'?[{id:'local-run',status:'SUCCEEDED',attempt:1}]:null,error:null}));
  };return value=>{if(['insert','update'].includes(key)){operation=key;payload=value;}return q;};}});return q;
 }};
 function load(path){if(modules.has(path))return modules.get(path).exports;
  const module={exports:{}};modules.set(path,module);
  const rel=path.slice(root.length);
  const code=prior&&rel==='supabase/functions/daily-delivery-orchestrator/index.ts'
   ?execFileSync('git',['show',capture.base+':'+rel],{cwd:root,encoding:'utf8'}):readFileSync(path,'utf8');
  if(path.endsWith('.json')){module.exports={default:JSON.parse(code)};return module.exports;}
  const require=n=>n.startsWith('.')?load(resolve(dirname(path),n)):
   n==='https://esm.sh/@supabase/supabase-js@2'?{createClient:()=>sdk}:(()=>{throw Error('unexpected import '+n);})();
  vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports:module.exports,module,require,Date:clock,Request,Response,Headers,URL,TextEncoder,crypto:webcrypto,AbortController,
   console:{log(){},warn(){},error(){}},setTimeout(fn,ms){if(ms===5000){pauses.push(ms);queueMicrotask(fn);}return 1;},clearTimeout(){},
   Deno:{env:{get:k=>({SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:fake,CRON_SECRET:fake})[k]},serve:fn=>{handler=fn;}},
   fetch:async(input)=>{const url=new URL(input);assert.equal(url.origin,origin,'external network forbidden');const slug=url.pathname.split('/').at(-1);calls.push(slug);
    assert(['fetch-global-market-news','fetch-market-data-v10'].includes(slug),'Report/LINE must not be called');
    const news=slug==='fetch-global-market-news';const payload=news?{...capture.rows.find(r=>r.date==='2026-10-01'&&r.news).news,success:newsStatus===200}:{success:true};
    return new Response(JSON.stringify(payload),{status:news?newsStatus:200,headers:{'content-type':'application/json'}});
   },
  },{filename:path});return module.exports;
 }
 load(resolve(root,'supabase/functions/daily-delivery-orchestrator/index.ts'));
 return {calls,writes,pauses,run:()=>handler(new Request(origin+'/functions/v1/daily-delivery-orchestrator',{method:'POST',headers:{'x-cron-secret':fake,'content-type':'application/json'},body:'{}'}))};
}

test('actual natural refresh entrypoint restores news for five saved affected trading days, core actions unchanged',async()=>{
 for(const day of ['2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08']){
  const old=handlerHarness({day,prior:true}),next=handlerHarness({day});
  const before=await(await old.run()).json(),after=await(await next.run()).json();
  assert.deepEqual(old.calls,['fetch-market-data-v10']);
  assert.deepEqual(next.calls.sort(),['fetch-global-market-news','fetch-market-data-v10']);
  assert.deepEqual(after,before,'no change to business result, Atomic gating or delivery status');
  assert.equal(next.writes[0].payload.provider_status.news_acquisition.classification,'CAPTURED_PENDING_REPORT_QUALITY');
 }
});

test('actual handler failures retry only twice, retain core success and never duplicate a claimed refresh',async()=>{
 for(const newsStatus of [401,429,500]){
  const h=handlerHarness({newsStatus});const body=await(await h.run()).json();
  assert.equal(body.success,true);assert.equal(body.delivery_blocked_by_evidence_failure,false);
  assert.equal(h.calls.filter(x=>x==='fetch-global-market-news').length,2);
  assert.deepEqual(h.pauses,[5000]);assert.equal(h.writes[0].payload.provider_status.news_acquisition.classification,'FETCH_FAILED');
 }
 const duplicate=handlerHarness({duplicate:true});const body=await(await duplicate.run()).json();
 assert.equal(body.reason,'PIPELINE_SLOT_ALREADY_CLAIMED');assert.deepEqual(duplicate.calls,[]);
});
