import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {acquisitionPlan,directoryPlan,sessionsBefore,assembleDaily,normalizeSource,fetchSource} from '../src/features/vnext/dailyAdapter.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {handleVnextDaily} from '../supabase/functions/vnext-daily-research-v1/handler.ts';
import {enqueueVnextAfterCheckpoint,continueVnextRun} from '../supabase/functions/_shared/vnext-daily-hook.ts';
import {csvRows,parseRevenue,parseFinancial,financialRows} from '../src/features/vnext/dailyParsers.mjs';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'隔離合成控制',exchange:'TWSE',industry:'24'}));
test('C admission preserves the deployed Producer V15 and the complete sealed runtime; stale helpers fail closed',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url));
 const manifest=JSON.parse(read('docs/operations/evidence/staged-c-transition-20261014.json'));
 const guard=manifest.production_dependency_guard;
 assert.equal(guard.main,'5c616bfeeebf9fc45890130948e21293de7a5d72');
 assert.equal(guard.producer.version,15);
 assert.equal(guard.producer.ezbr_sha256,'95bfde704134302f46b48520d56ec31cf0d74b1c90b1d974d6660c28968152b7');
 assert.equal(guard.producer.verify_jwt,true);assert.equal(guard.producer.import_map,false);
 assert.equal(guard.producer.files.length,20);assert.equal(guard.runtime.length,38);
 const verify=source=>{
  for(const row of [...guard.producer.files,...guard.runtime,guard.migration]){
   assert.match(row.sha256,/^[a-f0-9]{64}$/);
   assert.equal(createHash('sha256').update(source(row.path)).digest('hex'),row.sha256,'C_PROTECTED_DEPENDENCY:'+row.path);
  }
 };
 verify(read);
 for(const changed of ['supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/_shared/recommendation-stock-evidence.ts','supabase/functions/vnext-daily-research-v1/handler.ts',guard.migration.path]){
  assert.throws(()=>verify(p=>p===changed?Buffer.concat([read(p),Buffer.from('\nSTALE_DEPENDENCY')]):read(p)),/C_PROTECTED_DEPENDENCY/);
 }
 assert.deepEqual(guard.deploy_functions,['vnext-daily-research-v1','recommendation-v2-forward-worker-v1']);
 assert(!guard.deploy_functions.includes('recommendation-stock-evidence-v1'));
 for(const flag of ['production_authorized','secret_change','cron_change','member_publication','threshold_change'])assert.equal(guard[flag],false);
});
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
test('provider parser structure is bounded before allocation; malformed HTML cannot amplify suffix scanning',()=>{
 assert.deepEqual(csvRows('a,b\n"comma,value","quote""value"'),[['a','b'],['comma,value','quote"value']]);
 assert.throws(()=>csvRows(Array.from({length:129},(_,i)=>'h'+i).join(',')),/CSV_COLUMN_LIMIT/);
 assert.throws(()=>csvRows('x'.repeat(32769)),/CSV_CELL_LIMIT/);
 assert.throws(()=>csvRows('x\n'.repeat(25001)),/CSV_ROW_LIMIT/);
 assert.throws(()=>parseRevenue(['公司代號,資料年月,'+Array.from({length:10000},(_,i)=>'h'+i).join(','),...Array.from({length:10000},()=> '9999')].join('\n'),{period:'2026-09',symbols:['2330'],url:'https://mopsov.twse.com.tw'},'2026-10-14T01:00:00Z'),/CSV_COLUMN_LIMIT/);
 assert.throws(()=>parseFinancial('公開資訊觀測站上市公司'+'<tr>'.repeat(20000),{kind:'FINANCIAL_YTD',year:2026,quarter:2,symbols:['2330'],url:'https://mopsov.twse.com.tw',exchange:'TWSE'},'2026-10-14T01:00:00Z'),/FINANCIAL_NESTED_ROW/);
 assert.throws(()=>[...financialRows('<tr><td>'+'x'.repeat(32769)+'</td></tr>')],/FINANCIAL_CELL_LIMIT/);
 assert.throws(()=>[...financialRows('<tr><td>x</tr>')],/FINANCIAL_UNCLOSED_CELL/);
 assert.deepEqual([...financialRows('<table><tr><th>公司代號</th><th>營業收入</th></tr><tr><td>2330</td><td><b>123</b></td></tr></table>')],[['公司代號','營業收入'],['2330','123']]);
 const data=parseFinancial('公開資訊觀測站上市公司<table><tr><th>公司代號</th><th>營業收入</th><th>基本每股盈餘（元）</th></tr><tr><td>2330</td><td>123</td><td>2.5</td></tr></table>',{kind:'FINANCIAL_YTD',year:2026,quarter:2,symbols:['2330'],url:'https://mopsov.twse.com.tw',exchange:'TWSE'},'2026-10-14T01:00:00Z');
 assert.equal(data.rows[0].values.revenue,123);assert.equal(data.rows[0].values.eps,2.5);assert.equal(data.rows[0].published_at,null);
});
test('portable parser copies stay byte-equivalent to reviewed sources; no filesystem dependency',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),target=read('src/features/vnext/dailyParsers.mjs');
 for(const [path,from,to] of [['scripts/vnext/stock-evidence.mjs','const n=','export async function acquireStockEvidence'],['scripts/vnext/stock-context.mjs','export function parseEventIndex','export async function acquireContext'],['research/entry-corporate-actions.mjs','export const ACTION_SOURCES','export function parseTwseDividendDetail']]){const s=read(path);assert(target.includes(s.slice(s.indexOf(from),s.indexOf(to))));}
 assert.doesNotMatch(target,/node:fs|writeFile|readFile/);
});
test('continuation validates gateway status and preserves explicit server identity without fallback',async()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 for(const path of ['supabase/functions/vnext-daily-research-v1/index.ts','supabase/functions/recommendation-v2-forward-worker-v1/index.ts']){
  assert(read(path).includes("gatewayJwt:Deno.env.get('RECOMMENDATION_GATEWAY_ANON_JWT')"));
  assert(!read(path).includes("gatewayJwt:Deno.env.get('SUPABASE_ANON_KEY')"));
 }
 assert.match(read('supabase/config.toml'),/\[functions\.vnext-daily-research-v1\]\s+verify_jwt = true/);
 const calls=[],options={url:'https://local.test',gatewayJwt:'SYNTHETIC_GATEWAY',cronSecret:'SYNTHETIC_INTERNAL',fetcher:async(u,i)=>{calls.push({u,i});return new Response('{}',{status:401});}};
 await assert.rejects(()=>continueVnextRun('11111111-1111-4111-8111-111111111111',options),/VNEXT_CONTINUATION_HTTP_401/);
 assert.equal(calls.length,1);assert.equal(calls[0].i.headers.Authorization,'Bearer SYNTHETIC_GATEWAY');assert.equal(calls[0].i.headers['x-vnext-internal'],'SYNTHETIC_INTERNAL');
 await assert.rejects(()=>continueVnextRun('wrong',options),/SCOPE/);assert.equal(calls.length,1);
 await continueVnextRun('11111111-1111-4111-8111-111111111111',{...options,fetcher:async()=>new Response('{}',{status:202})});
});
