import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {acquisitionPlan,directoryPlan,sessionsBefore,assembleDaily,normalizeSource,fetchSource} from '../src/features/vnext/dailyAdapter.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {handleVnextDaily} from '../supabase/functions/vnext-daily-research-v1/handler.ts';
import {enqueueVnextAfterCheckpoint} from '../supabase/functions/_shared/vnext-daily-hook.ts';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'隔離合成控制',exchange:'TWSE',industry:'24'}));
test('dynamic official date plan rolls month, year and current revisions, not 10/8 snapshot',async()=>{
 const a=await acquisitionPlan('2026-10-12',companies),b=await acquisitionPlan('2026-11-02',companies);
 assert(a.length<=1600);assert(b.some(t=>t.period==='2026-10'));assert(!a.some(t=>t.period==='2026-10'));
 assert.equal(sessionsBefore('2026-10-12').at(-1),'2026-10-08');assert.equal(sessionsBefore('2026-11-02').at(-1),'2026-10-30');
 assert.equal(new Set(a.map(t=>t.key)).size,a.length);assert.equal(a.filter(t=>t.kind==='REVENUE').length,72);
 assert.equal(a.filter(t=>t.kind==='FINANCIAL_YTD').length,20);assert.equal(a.filter(t=>t.kind==='EVENT').length,144);
 const c=await acquisitionPlan('2026-10-13',companies);assert.notEqual(a.find(t=>t.kind==='PRICE'&&t.month==='2026-10').key,c.find(t=>t.kind==='PRICE'&&t.month==='2026-10').key);
 assert.equal(a.find(t=>t.kind==='PRICE'&&t.month==='2026-09').key,c.find(t=>t.kind==='PRICE'&&t.month==='2026-09').key);
});
test('holiday, unknown calendar and universe drift refuse planning',async()=>{
 for(const d of ['2026-10-09','2040-01-01'])assert.throws(()=>sessionsBefore(d));
 await assert.rejects(()=>acquisitionPlan('2026-10-12',companies.slice(1)),/UNIVERSE/);
});
test('source receipt preserves publication unknown and actual receipt; directory strips personal fields',async()=>{
 const t=(await directoryPlan('2026-10-12'))[0];const r=await normalizeSource(t,[{'公司代號':'2330','公司名稱':'台積電','產業別':'24','上市日期':'0830905','董事長':'PRIVATE','email':'PRIVATE'}],'2026-10-12T00:00:00Z');
 assert.equal(r.rows[0].company,'台積電');assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('HTTP 429 is classified, redirects disallowed, host cannot be supplied by browser',async()=>{
 const t=(await directoryPlan('2026-10-12'))[0];let init;
 await assert.rejects(()=>fetchSource(t,async(u,i)=>{init=i;return new Response('',{status:429,headers:{'retry-after':'20'}});},()=>new Date().toISOString(),new AbortController().signal),e=>e.message==='RATE_LIMITED'&&e.retryAfter===20);
 assert.equal(init.redirect,'error');await assert.rejects(()=>fetchSource({...t,url:'http://127.0.0.1/secret'},fetch,()=>'',new AbortController().signal),/SOURCE_NOT_ALLOWED/);
});
test('missing evidence evaluates all 72 but never invents zero prices, Entry conditions or published research',async()=>{
 const r=await assembleDaily('2026-10-12',companies,[],'2026-10-12T00:00:00Z');
 assert.equal(r.inputs.length,72);assert(r.inputs.every(i=>!i.bars.length&&!i.facts.length));assert.equal(r.entry.stocks.length,72);
 assert(r.entry.stocks.every(s=>s.events_reviewed===null&&s.relative_strength===null&&s.fundamental===null));
 const {snapshot_hash,...body}=r;assert.equal(snapshot_hash,await snapshotHash(body));
 await assert.rejects(()=>assembleDaily('2026-10-13',companies,[],'2026-10-12T00:00:00Z'),/CUTOFF/);
});
test('future source and payload drift are rejected before research',async()=>{
 const payload={rows:[]},r={task:(await directoryPlan('2026-10-12'))[0],status:'OK',payload,payload_hash:await snapshotHash(payload),available_at:'2026-10-13T00:00:00Z'};
 await assert.rejects(()=>assembleDaily('2026-10-12',companies,[r],'2026-10-12T00:00:00Z'),/SOURCE_REVISION/);
 r.available_at='2026-10-11T00:00:00Z';r.payload_hash='f'.repeat(64);await assert.rejects(()=>assembleDaily('2026-10-12',companies,[r],'2026-10-12T00:00:00Z'),/SOURCE_REVISION/);
});
test('Worker missing/wrong/Owner/member/anonymous/browser credentials deny; no service-role fallback',async()=>{
 let calls=0;const env={cronSecret:'synthetic-server-only-test-credential',rpc:async()=>calls++};
 for(const headers of [{},{Authorization:'Bearer Owner'},{Authorization:'Bearer Member'},{Authorization:'Bearer service_role'},{'x-vnext-internal':'wrong'}]){
  const r=await handleVnextDaily(new Request('https://local.test',{method:'POST',headers,body:'{}'}),env);assert.equal(r.status,401);
 }
 assert.equal((await handleVnextDaily(new Request('https://local.test',{method:'POST',headers:{Origin:'https://local.test','x-vnext-internal':env.cronSecret},body:'{}'}),env)).status,403);assert.equal(calls,0);
});
test('valid dedicated request enqueues transaction before background; invalid scope rejected',async()=>{
 const calls=[];const env={cronSecret:'synthetic-server-only-test-credential',rpc:async name=>{calls.push(name);return name.startsWith('enqueue')?{run_id:'11111111-1111-4111-8111-111111111111'}:{status:'BUSY'};},background:p=>calls.push(p),continueRun:async()=>{throw Error('unexpected');}};
 const request=body=>new Request('https://local.test',{method:'POST',headers:{'x-vnext-internal':env.cronSecret},body:JSON.stringify(body)});
 assert.equal((await handleVnextDaily(request({business_date:'2026-10-12',phase:'PREMARKET',source_batch_id:'22222222-2222-4222-8222-222222222222'}),env)).status,202);
 await calls.find(c=>c instanceof Promise);assert.equal(calls[0],'enqueue_vnext_daily_research_v1');
 assert.equal((await handleVnextDaily(request({run_id:'11111111-1111-4111-8111-111111111111',mode:'HISTORICAL_REPLAY'}),env)).status,422);
});
test('lifecycle hook never awaits research, failure cannot escape and no core request is retried',async()=>{
 let task,n=0;const opts={url:'https://local.test',gatewayJwt:'synthetic',cronSecret:'synthetic',fetcher:async()=>{n++;throw Error('offline');},background:p=>task=p};
 enqueueVnextAfterCheckpoint({business_date:'2026-10-12',evaluation_phase:'PREMARKET',source_batch_id:'synthetic'},opts);await task;assert.equal(n,1);
 assert.doesNotThrow(()=>enqueueVnextAfterCheckpoint({}, {...opts,background:()=>{throw Error('runtime');}}));
});
test('portable parser copies stay byte-equivalent to reviewed sources; no filesystem dependency',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),target=read('src/features/vnext/dailyParsers.mjs');
 for(const [path,from,to] of [['scripts/vnext/stock-evidence.mjs','const n=','export async function acquireStockEvidence'],['scripts/vnext/stock-context.mjs','export function parseEventIndex','export async function acquireContext'],['research/entry-corporate-actions.mjs','export const ACTION_SOURCES','export function parseTwseDividendDetail']]){const s=read(path);assert(target.includes(s.slice(s.indexOf(from),s.indexOf(to))));}
 assert.doesNotMatch(target,/node:fs|writeFile|readFile/);
});
