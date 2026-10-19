// Executes the actual fixed SDK and Worker entrypoint. All Request data and
// RPC/continuation ports are synthetic. Run with the network-denied preload.
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {posix} from 'node:path';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import {assembleRelease} from '../scripts/operations/c-worker-local-sdk-release-20261019/materialize.mjs';

async function harness(variant,{finishError=false}={}){
 const {payload}=assembleRelease(variant);
 assert.equal(payload.verify_jwt,true);assert(!('import_map_path' in payload));
 const locals=new Map(payload.files.map(f=>[f.name,f.content]));
 const started=Date.parse('2026-10-18T23:05:00.000Z');let now=started,handler,universe=[];
 const calls=[],handoffs=[],sleeps=[],background=[],warnings=[];
 const runId='11111111-1111-4111-8111-111111111111';
 class FixtureDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const env={SUPABASE_URL:'https://isolated.invalid',SUPABASE_SERVICE_ROLE_KEY:'SYNTHETIC_SERVICE_ROLE_NO_PRODUCTION',CRON_SECRET:'SYNTHETIC_INTERNAL_CREDENTIAL_32_CHARS',RECOMMENDATION_GATEWAY_ANON_JWT:'SYNTHETIC_GATEWAY_NO_PRODUCTION'};
 const receipt=task=>({task,first_seen_at:new Date(started).toISOString(),available_at:new Date(started).toISOString(),published_at:null,as_of:new Date(started).toISOString(),version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:'0'.repeat(64),payload_hash:'0'.repeat(64),status:'OK',reason:null,payload:{rows:task.exchange==='TWSE'?universe.map(symbol=>({symbol,company:'SYNTHETIC',exchange:'TWSE',industry:'24'})):[]}});
 const fetcher=async(url,init={})=>{
  const u=String(url),body=JSON.parse(init.body||'{}');
  if(u===env.SUPABASE_URL+'/functions/v1/vnext-daily-research-v1'){
   assert.deepEqual(Object.keys(body),['run_id']);assert.equal(body.run_id,runId);assert.equal(init.redirect,'error');assert(init.signal instanceof AbortSignal);
   assert.equal(init.headers.Authorization,'Bearer '+env.RECOMMENDATION_GATEWAY_ANON_JWT);assert.equal(init.headers['x-vnext-internal'],env.CRON_SECRET);
   handoffs.push({elapsed_ms:now-started});return Response.json({status:'DURABLY_QUEUED'},{status:202});
  }
  assert(u.startsWith(env.SUPABASE_URL+'/rest/v1/rpc/'),'NETWORK_DENIED');
  const name=u.split('/').at(-1);calls.push({name,op:body.p_op??null});
  if(name==='claim_vnext_daily_research_v1')return Response.json({status:'ACQUIRED',run:{id:runId,business_date:'2026-10-19',actionable_at:'2026-10-19T01:00:00Z',lease:'22222222-2222-4222-8222-222222222222',lease_until:new Date(started+100000).toISOString(),fence:1,plan:[{key:'synthetic-plan-already-acquired',kind:'PRICE'}],cursor:1,checkpoint:{}}});
  assert.equal(name,'vnext_daily_runtime_v1');
  if(body.p_op==='SOURCE_BEGIN')return Response.json({status:'CACHE',receipt:receipt(body.p_data)});
  if(body.p_op==='DUE_OUTCOMES')return Response.json([]);
  if(body.p_op==='SOURCES')return Response.json([]);
  if(body.p_op==='ENTRY_SOURCE')return Response.json({});
  if(body.p_op==='FINISH'){
   assert.deepEqual(body.p_data,{status:'QUEUED',reason:'CANONICAL_PUBLICATION_PENDING'});
   if(finishError){now+=37000;return Response.json({code:'P0001',message:'SYNTHETIC_RPC_REJECTION',details:'',hint:''},{status:400});}
   return Response.json({status:'STORED'});
  }
  throw Error('UNEXPECTED_RPC_OPERATION');
 };
 const timers=new Map();let timerId=0;
 const setTimer=(fn,ms,...args)=>{const id=++timerId;timers.set(id,true);queueMicrotask(()=>{if(!timers.delete(id))return;sleeps.push(Number(ms));now+=Number(ms);fn(...args);});return id;};
 const safeProcess={env:{},version:'v22.14.0',versions:{node:'22.14.0'},platform:'linux',browser:false,nextTick:queueMicrotask,cwd:()=>'/isolated'};
 const context=vm.createContext({Request,Response,Headers,AbortSignal,AbortController,URL,URLSearchParams,TextEncoder,TextDecoder,ReadableStream,TransformStream,WritableStream,crypto:webcrypto,structuredClone,Date:FixtureDate,
  fetch:fetcher,setTimeout:setTimer,clearTimeout:id=>timers.delete(id),setInterval:()=>{throw Error('UNEXPECTED_INTERVAL');},clearInterval(){},queueMicrotask,process:safeProcess,
  console:{log(){throw Error('UNEXPECTED_LOG');},warn:(event,code)=>{assert.equal(event,'VNEXT_BACKGROUND_NOT_COMPLETED');assert.equal(code,'DATABASE_RPC_REJECTED');warnings.push({event,code});},error(){throw Error('UNEXPECTED_LOG');}},
  Deno:{env:{get:k=>env[k]},serve:fn=>{assert.equal(handler,undefined);handler=fn;}},EdgeRuntime:{waitUntil:p=>background.push(p)}});
 const modules=new Map(),native=new Set();
 const resolveId=(specifier,parent)=>{
  if(specifier.startsWith('node:'))return specifier;
  assert(!specifier.startsWith('https:')&&!specifier.startsWith('http:'),'REMOTE_IMPORT_DENIED');
  assert(specifier.startsWith('.'),'UNSEALED_IMPORT');const p=posix.normalize(posix.join(posix.dirname(parent.slice(6)),specifier));assert(locals.has(p),'MISSING_LOCAL:'+p);return 'local:'+p;
 };
 async function load(id){
  if(modules.has(id))return modules.get(id);
  let module;
  if(id.startsWith('node:')){
   native.add(id);const exports=id==='node:process'?{default:safeProcess,...safeProcess}:await import(id);
   module=new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context,identifier:id});
  }else if(id.startsWith('local:')&&id.endsWith('.json')){
   const data=JSON.parse(locals.get(id.slice(6)));module=new vm.SyntheticModule(['default'],function(){this.setExport('default',data);},{context,identifier:id});
  }else{
   const source=id.endsWith('.ts')?ts.transpileModule(locals.get(id.slice(6)),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:locals.get(id.slice(6));
   module=new vm.SourceTextModule(source,{context,identifier:id,importModuleDynamically:()=>{throw Error('DYNAMIC_NETWORK_IMPORT_DENIED');}});
  }
  modules.set(id,module);return module;
 }
 const entry=await load('local:'+payload.entrypoint_path);
 await entry.link((s,m)=>load(resolveId(s,m.identifier)));await entry.evaluate();
 assert.equal(locals.size,74);assert.equal([...modules.keys()].filter(k=>k.startsWith('https://')).length,0);assert.equal([...modules.keys()].filter(k=>k.startsWith('local:')).length,44);
 universe=[...modules.get('local:supabase/functions/_shared/recommendation-stock-evidence.ts').namespace.RECOMMENDATION_UNIVERSE];assert.equal(universe.length,72);
 return {handler,calls,handoffs,sleeps,background,warnings,runId,env,started,get now(){return now;},graph:{local:[...modules.keys()].filter(k=>k.startsWith('local:')).map(k=>k.slice(6)).sort(),remote:[...modules.keys()].filter(k=>k.startsWith('https://')).sort(),native:[...native].sort()}};
}

test('all runtime imports including five literal fallback edges stay within the sealed payload or fixed Node builtins',()=>{
 const {payload}=assembleRelease(),files=new Map(payload.files.map(f=>[f.name,f.content]));
 const runtime=payload.files.filter(f=>!f.name.includes('/licenses/'));assert.equal(runtime.length,44);
 let fallbacks=0;
 for(const file of runtime){
  if(file.name.endsWith('.json'))continue;
  // The sealed runtime excludes erased import-type declarations. Inspect the
  // same emitted JavaScript used by the actual-entry VM, not type-only edges.
  const source=file.name.endsWith('.ts')?ts.transpileModule(file.content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:file.content;
  const ast=ts.createSourceFile(file.name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length,0);
  const check=specifier=>{
   if(specifier.startsWith('node:')){assert(['node:buffer','node:crypto','node:http','node:https','node:process','node:punycode','node:stream','node:url','node:zlib'].includes(specifier));return;}
   assert(specifier.startsWith('.'),'NONLOCAL_RUNTIME_IMPORT:'+specifier);
   assert(files.has(posix.normalize(posix.join(posix.dirname(file.name),specifier))),'MISSING_RUNTIME_IMPORT:'+specifier);
  };
  const visit=node=>{
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){assert(ts.isStringLiteral(node.moduleSpecifier));check(node.moduleSpecifier.text);}
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){assert.equal(node.arguments.length,1);assert(ts.isStringLiteralLike(node.arguments[0]),'NONLITERAL_DYNAMIC_IMPORT');check(node.arguments[0].text);fallbacks++;}
   ts.forEachChild(node,visit);
  };visit(ast);
 }
 assert.equal(fallbacks,5);
});

for(const variant of ['repair','recovery']){
test(variant+' actual SDK entry rejects missing, wrong, Owner and browser identity before any RPC',async()=>{
 const h=await harness(variant);
 for(const headers of [{},{'x-vnext-internal':'wrong'},{authorization:'Bearer SYNTHETIC_OWNER'},{origin:'https://morningalphatw.com','x-vnext-internal':h.env.CRON_SECRET}]){
  const r=await h.handler(new Request('https://isolated.invalid',{method:'POST',headers,body:'{}'}));assert.equal(r.status,'origin'in headers?403:401);
 }
 assert.equal(h.calls.length,0);assert.equal(h.handoffs.length,0);
});
test(variant+' actual SDK valid synthetic internal identity still rejects invalid scope with no RPC',async()=>{
 const h=await harness(variant),r=await h.handler(new Request('https://isolated.invalid',{method:'POST',headers:{'x-vnext-internal':h.env.CRON_SECRET},body:'{}'}));
 assert.equal(r.status,422);assert.equal(h.calls.length,0);assert.equal(h.handoffs.length,0);
});
test(variant+' actual SDK canonical publication wait hands off once after 30 seconds',async()=>{
 const h=await harness(variant),r=await h.handler(new Request('https://isolated.invalid',{method:'POST',headers:{'x-vnext-internal':h.env.CRON_SECRET},body:JSON.stringify({run_id:h.runId})}));
 assert.equal(r.status,202);await Promise.all(h.background);assert.equal(h.calls.filter(c=>c.op==='FINISH').length,1);
 assert.deepEqual(h.handoffs,[{elapsed_ms:30000}]);assert.equal(h.warnings.length,0);
});
test(variant+' actual SDK FINISH rejection preserves the exact repaired or original stop behavior without business writes',async()=>{
 const h=await harness(variant,{finishError:true}),r=await h.handler(new Request('https://isolated.invalid',{method:'POST',headers:{'x-vnext-internal':h.env.CRON_SECRET},body:JSON.stringify({run_id:h.runId})}));
 assert.equal(r.status,202);await Promise.all(h.background);assert.equal(h.calls.filter(c=>c.op==='FINISH').length,1);
 assert(!h.calls.some(c=>['SOURCE_SAVE','PREDICTIONS','OUTCOME'].includes(c.op)));
 assert.deepEqual(h.handoffs,variant==='repair'?[{elapsed_ms:101000}]:[]);assert.equal(h.warnings.length,variant==='repair'?0:1);
 assert.equal(h.now-h.started,variant==='repair'?101000:37000);
});
}
