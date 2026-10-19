// Synthetic error protocol only. Actual fixed SDK + actual candidate entrypoint;
// no Provider, Production session, database, retry or deployment is exercised.
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {posix} from 'node:path';
import {createHash,webcrypto} from 'node:crypto';
import ts from 'typescript';
import {readReleaseCatalog,APPROVED_LOGIC_COMMIT} from '../scripts/operations/c-worker-local-sdk-release-20261019/materialize.mjs';

const root=new URL('../',import.meta.url),entryName='supabase/functions/vnext-daily-research-v1/index.ts';
const base='6b7017fcbb9fa2fd085f9658eca4d6ce382c32a3';
const read=name=>readFileSync(new URL(name,root));
const historical=(ref,name)=>execFileSync('git',['--no-replace-objects','show',ref+':'+name],{cwd:root,
 env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'},maxBuffer:8*1024*1024});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseline=new Map(readReleaseCatalog().files.map(row=>{
 const bytes=row.source==='APPROVED_HISTORICAL_LOGIC'?historical(APPROVED_LOGIC_COMMIT,row.name):row.name===entryName?historical(base,row.name):read(row.name);
 assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);
 return [row.name,bytes.toString()];
}));
const secrets='SYNTHETIC_PRIVATE_PAYLOAD_NEVER_LOGGED';
async function harness(){
 const locals=new Map(baseline);locals.set(entryName,read(entryName).toString());
 const warnings=[],calls=[],background=[];let handler,rpc,reply=()=>Response.json({ok:true}),sinkThrows=false;
 const safeProcess={env:{},version:'v22.14.0',versions:{node:'22.14.0'},platform:'linux',browser:false,nextTick:queueMicrotask,cwd:()=>'/isolated'};
 const fetcher=async(url,init)=>{
  assert(String(url).startsWith('https://isolated.invalid/rest/v1/rpc/'),'NETWORK_DENIED');
  assert.equal(init.method,'POST');assert(init.signal instanceof AbortSignal);
  calls.push({count:calls.length+1});return reply();
 };
 const env={SUPABASE_URL:'https://isolated.invalid',SUPABASE_SERVICE_ROLE_KEY:secrets,CRON_SECRET:secrets,RECOMMENDATION_GATEWAY_ANON_JWT:secrets};
 const context=vm.createContext({Request,Response,Headers,AbortSignal,AbortController,URL,URLSearchParams,TextEncoder,TextDecoder,ReadableStream,TransformStream,WritableStream,
  crypto:webcrypto,structuredClone,fetch:fetcher,setTimeout,clearTimeout,setInterval:()=>{throw Error('UNEXPECTED_INTERVAL');},clearInterval(){},queueMicrotask,process:safeProcess,
  console:{warn:(...args)=>{if(sinkThrows)throw Error(secrets);warnings.push(args);},log(){throw Error('UNEXPECTED_LOG');},error(){throw Error('UNEXPECTED_LOG');}},
  Deno:{env:{get:k=>env[k]},serve:fn=>{assert.equal(handler,undefined);handler=fn;}},EdgeRuntime:{waitUntil:p=>background.push(p)}});
 const modules=new Map();
 const resolveId=(specifier,parent)=>{
  if(specifier.startsWith('node:'))return specifier;
  assert(specifier.startsWith('.'),'NONLOCAL_IMPORT');
  const path=posix.normalize(posix.join(posix.dirname(parent.slice(6)),specifier));assert(locals.has(path),'UNSEALED_IMPORT');return 'local:'+path;
 };
 async function load(id){
  if(modules.has(id))return modules.get(id);
  let module;
  if(id.startsWith('node:')){
   const exports=id==='node:process'?{default:safeProcess,...safeProcess}:await import(id);
   module=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context,identifier:id});
  }else if(id.endsWith('.json')){
   module=new vm.SyntheticModule(['default'],function(){this.setExport('default',JSON.parse(locals.get(id.slice(6))));},{context,identifier:id});
  }else{
   const source=id.endsWith('.ts')?ts.transpileModule(locals.get(id.slice(6)),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:locals.get(id.slice(6));
   module=new vm.SourceTextModule(source,{context,identifier:id,importModuleDynamically:()=>{throw Error('DYNAMIC_NETWORK_IMPORT_DENIED');}});
  }
  modules.set(id,module);return module;
 }
 const real=await load('local:supabase/functions/vnext-daily-research-v1/handler.ts');
 await real.link((s,m)=>load(resolveId(s,m.identifier)));await real.evaluate();
 const observer=new vm.SyntheticModule(['handleVnextDaily'],function(){this.setExport('handleVnextDaily',(req,ports)=>{rpc=ports.rpc;return real.namespace.handleVnextDaily(req,ports);});},{context,identifier:'test-only:ports-observer'});
 const entry=await load('local:'+entryName);
 await entry.link((s,m)=>m.identifier==='local:'+entryName&&s==='./handler.ts'?observer:load(resolveId(s,m.identifier)));await entry.evaluate();
 // A read-only method refusal obtains the test port; no worker work is started.
 assert.equal((await handler(new Request('https://isolated.invalid',{method:'GET'}))).status,405);
 assert.equal(calls.length,0);assert.equal(background.length,0);
 assert.equal([...modules.keys()].filter(k=>k.startsWith('local:')).length,44);
 return {rpc,warnings,calls,setReply:value=>{reply=value;},throwSink:()=>{sinkThrows=true;}};
}
const expectFailure=async(h,name='vnext_daily_runtime_v1',op='SOURCE_SAVE',expected='DATABASE_RPC_REJECTED')=>{
 await assert.rejects(()=>h.rpc(name,{p_op:op,p_run:secrets,p_data:{source:secrets,body:secrets}}),e=>e.message===expected);
 assert(!JSON.stringify(h.warnings).includes(secrets));
};

test('closed Worker2 payload preserves73 sources and candidate changes only the RPC diagnostic entrypoint',()=>{
 assert.equal(baseline.size,74);assert.equal([...baseline.keys()].filter(k=>!k.includes('/licenses/')).length,44);
 const old=baseline.get(entryName),current=read(entryName).toString();
 const original="rpc:async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error(name==='vnext_daily_runtime_v1'&&args.p_op==='PREDICTIONS'&&r.error.message==='FORWARD_TIME_INVALID'?'FORWARD_TIME_INVALID':'DATABASE_RPC_REJECTED');return r.data;},";
 const restored=current.replace(/\/\/ Fixed vocabulary only\.[\s\S]*?(?=Deno\.serve)/,'').replace(/rpc:async\(name,args\)=>\{[\s\S]*?\}return r\.data;\},/,original);
 assert.equal(restored,old,'Auth/SDK/environment/timeout/background/continuation and original refusal bytes are preserved');
 assert.equal((current.match(/r\.error\.message/g)||[]).length,1,'only the original exact refusal comparison may read error prose');
 assert(!/r\.error\.(?:details|hint)|signal\.reason/.test(current));
});
test('actual SDK success returns its original data with no diagnostic',async()=>{
 const h=await harness();h.setReply(()=>Response.json({status:'STORED'}));
 assert.deepEqual(JSON.parse(JSON.stringify(await h.rpc('vnext_daily_runtime_v1',{p_op:'FINISH'}))),{status:'STORED'});assert.equal(h.warnings.length,0);assert.equal(h.calls.length,1);
});
test('actual SDK SQLSTATE and PGRST errors log fixed codes and exclude all error prose and arguments',async()=>{
 const h=await harness();
 for(const [code,category] of [['P0001','SQLSTATE_P0001'],['23514','SQLSTATE_23514'],['57014','SQLSTATE_57014'],['PGRST202','PGRST202']]){
  h.setReply(()=>Response.json({code,message:secrets,details:secrets,hint:secrets},{status:400}));await expectFailure(h);
  assert.deepEqual(h.warnings.at(-1),['VNEXT_DATABASE_RPC_REJECTED','vnext_daily_runtime_v1','SOURCE_SAVE',category]);
 }
});
test('every known RPC and runtime operation logs only a fixed vocabulary',async()=>{
 const h=await harness();h.setReply(()=>Response.json({code:'P0001',message:secrets},{status:400}));
 const ops=['PLAN','SOURCE_BEGIN','SOURCE_SAVE','SOURCE_FAIL','CURSOR','ENTRY_SOURCE','SOURCES','CHECKPOINT','PREDICTIONS','DUE_OUTCOMES','OUTCOME','OUTCOME_CHECKED','FINISH'];
 for(const op of ops){await expectFailure(h,'vnext_daily_runtime_v1',op);assert.equal(h.warnings.at(-1)[2],op);}
 for(const name of ['enqueue_vnext_daily_research_v1','claim_vnext_daily_research_v1']){
  await expectFailure(h,name,secrets);assert.deepEqual(h.warnings.at(-1).slice(1,3),[name,'NOT_APPLICABLE']);
 }
});
test('unknown names, operations and code strings fail closed without echoing a supplied code',async()=>{
 const h=await harness();
 for(const code of [secrets,'ABCDE','99999','PGRST999','23514 '+secrets,'__proto__','constructor']){
  h.setReply(()=>Response.json({code,message:secrets,details:secrets,hint:secrets},{status:400}));await expectFailure(h,'unregistered_rpc',secrets);
  assert.deepEqual(h.warnings.at(-1),['VNEXT_DATABASE_RPC_REJECTED','UNKNOWN_RPC','UNKNOWN_OPERATION','UNKNOWN_ERROR']);
 }
 await expectFailure(h,'vnext_daily_runtime_v1',secrets);assert.equal(h.warnings.at(-1)[2],'UNKNOWN_OPERATION');
});
test('actual fixed SDK preserves timeout codes without exposing a thrown message, URL or stack',async()=>{
 const h=await harness();
 for(const error of [new DOMException(secrets,'TimeoutError'),Object.assign(Error(secrets),{code:'ETIMEDOUT'}),Object.assign(Error(secrets),{code:'UND_ERR_CONNECT_TIMEOUT'})]){
  h.setReply(()=>{throw error;});await expectFailure(h);assert.equal(h.warnings.at(-1)[3],'REQUEST_TIMEOUT');
 }
 for(const error of [new TypeError(secrets),Object.assign(Error(secrets),{code:secrets}),Object.assign(Error(secrets),{code:'P0001'})]){
  h.setReply(()=>{throw error;});await expectFailure(h);assert.equal(h.warnings.at(-1)[3],'TRANSPORT_FAILURE');
 }
});
test('only the original PREDICTIONS exact FORWARD_TIME_INVALID exception retains that refusal',async()=>{
 const h=await harness();h.setReply(()=>Response.json({code:'P0001',message:'FORWARD_TIME_INVALID',details:secrets,hint:secrets},{status:400}));
 await expectFailure(h,'vnext_daily_runtime_v1','PREDICTIONS','FORWARD_TIME_INVALID');
 await expectFailure(h,'vnext_daily_runtime_v1','SOURCE_SAVE');await expectFailure(h,'claim_vnext_daily_research_v1','PREDICTIONS');
 assert(!JSON.stringify(h.warnings).includes('FORWARD_TIME_INVALID'));
});
test('a failed diagnostic sink cannot replace or bypass the original refusal',async()=>{
 const h=await harness();h.throwSink();h.setReply(()=>Response.json({code:'P0001',message:secrets},{status:400}));await expectFailure(h);assert.equal(h.calls.length,1);
 h.setReply(()=>Response.json({code:'P0001',message:'FORWARD_TIME_INVALID'},{status:400}));await expectFailure(h,'vnext_daily_runtime_v1','PREDICTIONS','FORWARD_TIME_INVALID');assert.equal(h.calls.length,2);
});
