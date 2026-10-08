import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {v2Hash} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {entryInputFromV2} from '../research/entry-v2-adapter.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
async function harness({persistenceError=false}={}){
 const evidence=v2Fixture(),hash=await v2Hash(evidence),cutoff=evidence.identity.generated_at;
 const calls=[],writes=[],modules=new Map();let handler;
 const sdk={from(table){calls.push(table);assert(['recommendation_shadow_v2_runs','decision_snapshots'].includes(table));
  const q=new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({error:null,data:table==='recommendation_shadow_v2_runs'?
   {id:'30000000-0000-4000-8000-000000000001',input_sha256:hash,evidence,cutoff,business_date:evidence.identity.report_date}:
   [{id:'SYNTHETIC_CANONICAL',market_regime:'range',generated_text:{market_bias:'偏空'},created_at:cutoff,status:'READY'}]});return()=>q;}});return q;},
  async rpc(name,args){assert.equal(name,'store_entry_opportunity_v1');writes.push({name,args});return {data:{status:'STORED'},error:persistenceError?{message:'SYNTHETIC_PRIVATE_ERROR'}:null};}};
 function load(path){if(modules.has(path))return modules.get(path).exports;const module={exports:{}};modules.set(path,module);
  if(path.endsWith('.json')){module.exports={default:JSON.parse(readFileSync(path,'utf8'))};return module.exports;}
  const require=n=>n.startsWith('.')?load(resolve(dirname(path),n)):n==='https://esm.sh/@supabase/supabase-js@2.57.4'?{createClient:()=>sdk}:(()=>{throw Error('unexpected import');})();
  vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {module,exports:module.exports,require,Request,Response,Headers,URL,TextEncoder,crypto:webcrypto,AbortSignal,
    Date:class extends Date{constructor(...a){super(...(a.length?a:[cutoff]));}static now(){return Date.parse(cutoff);}},
    fetch(){throw Error('EXTERNAL_NETWORK_FORBIDDEN');},
    Deno:{env:{get:k=>({CRON_SECRET:'SYNTHETIC_INTERNAL',SUPABASE_SERVICE_ROLE_KEY:'SYNTHETIC_SERVICE',SUPABASE_URL:'http://127.0.0.1:59999'})[k]},serve:fn=>{handler=fn;}}},{filename:path});return module.exports;
 }load(resolve(root,'supabase/functions/entry-opportunity-shadow-v1/index.ts'));
 return {calls,writes,request:(headers={},body={source_run_id:'30000000-0000-4000-8000-000000000001',mode:'HISTORICAL_REPLAY'},method='POST')=>handler(new Request('http://127.0.0.1/entry',{method,headers,body:method==='POST'?JSON.stringify(body):undefined}))};
}
test('actual handler and unchanged internal validator deny missing, member, owner, service-only and browser identities before reads',async()=>{
 const h=await harness();
 for(const headers of [{},{authorization:'Bearer SYNTHETIC_OWNER'},{authorization:'Bearer SYNTHETIC_MEMBER'},{apikey:'SYNTHETIC_SERVICE'},
  {'x-cron-secret':'WRONG'},{'x-cron-secret':'SYNTHETIC_INTERNAL','x-internal-auth-version':'WRONG'}])assert.equal((await h.request(headers)).status,401);
 assert.equal((await h.request({'x-cron-secret':'SYNTHETIC_INTERNAL',origin:'https://browser.invalid'})).status,403);
 assert.equal((await h.request({},null,'GET')).status,405);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});
test('actual handler uses only retained source plus Canonical as-of lookup and new research persistence',async()=>{
 const h=await harness(),r=await h.request({'x-cron-secret':'SYNTHETIC_INTERNAL'});assert.equal(r.status,200);
 const result=await r.json();assert.equal(result.shadow_only,true);assert.deepEqual(result.business_writes,[]);assert.equal(h.writes.length,1);
 assert.deepEqual(h.calls,['recommendation_shadow_v2_runs','decision_snapshots']);
 const saved=h.writes[0].args.p_result;assert.equal(saved.production_eligible,false);assert.equal(saved.forward_sample,0);assert.equal(saved.mode,'HISTORICAL_REPLAY');
 const no=await harness({persistenceError:true});const rejected=await no.request({'x-cron-secret':'SYNTHETIC_INTERNAL'});assert.equal(rejected.status,422);
 assert(!(await rejected.text()).includes('PRIVATE_ERROR'));
});
test('unknown fields, invalid mode, oversized body and changed saved source hash fail closed',async()=>{
 const h=await harness();for(const body of [{mode:'LIVE',source_run_id:'30000000-0000-4000-8000-000000000001'},
  {mode:'FORWARD',source_run_id:'bad'},{mode:'HISTORICAL_REPLAY',source_run_id:'30000000-0000-4000-8000-000000000001',production:true}])
  assert.equal((await h.request({'x-cron-secret':'SYNTHETIC_INTERNAL'},body)).status,422);
 assert.equal((await h.request({'x-cron-secret':'SYNTHETIC_INTERNAL'},{padding:'x'.repeat(513)})).status,413);assert.equal(h.writes.length,0);
 await assert.rejects(entryInputFromV2(v2Fixture(),'f'.repeat(64),null,'HISTORICAL_REPLAY','SYNTHETIC_TEST'),/HASH_MISMATCH/);
});
test('adapter never substitutes future, wrong-session or conflicting market quotes for V2 validated evidence',async()=>{
 for(const mutate of [v=>v.data.quotes.forEach(q=>{if(q.symbol==='TAIEX')q.captured_at='2999-01-01T00:00:00Z';}),
  v=>v.data.quotes.forEach(q=>{if(q.symbol==='TAIEX')q.trading_date='2020-01-02';}),
  v=>{const q=v.data.quotes.filter(q=>q.symbol==='TAIEX').sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at))[0];v.data.quotes.push({...q,id:'SYNTHETIC_CONFLICT',value:Number(q.value)+1});}]){
  const v=v2Fixture();mutate(v);const at=v.identity.generated_at;
  const i=await entryInputFromV2(v,await v2Hash(v),{source_ref:'SYNTHETIC_CANONICAL',observed_at:at,available_at:at,value:{direction:'偏多',regime:'range'}},'HISTORICAL_REPLAY','SYNTHETIC_TEST');
  assert.equal(i.market,null);
 }
});
