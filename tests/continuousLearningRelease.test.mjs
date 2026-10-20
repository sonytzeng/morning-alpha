// Offline packaging and exact current-source admission; NOT Production deploy/rollback.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,webcrypto} from 'node:crypto';
import {resolve,dirname,join,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import * as actual from '../scripts/operations/continuous-learning-20261020/materialize.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const script='scripts/operations/continuous-learning-20261020/materialize.mjs';
const scriptUrl=new URL('../'+script,import.meta.url).href;
const sha=b=>createHash('sha256').update(b).digest('hex'),encode=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const physical=name=>readFileSync(resolve(root,name));
const env={PATH:'/opt/homebrew/bin:/usr/bin:/bin',TMPDIR:'/private/tmp',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'};
const baseline=name=>execFileSync('git',['--no-replace-objects','show',actual.BASE+':'+name],{cwd:root,env,stdio:['ignore','pipe','pipe'],maxBuffer:8e6});
// Only this test VM supplies a synthetic admission success and a synthetic
// catalog seal. Real assemble always calls the real admission helper first.
function packager({seal=actual.CATALOG_SHA256,guard=()=>{}}={}){
 const module={exports:{}},source=physical(script).toString().replaceAll('import.meta.url',JSON.stringify(scriptUrl))
  .replace("CATALOG_SHA256='"+actual.CATALOG_SHA256+"'","CATALOG_SHA256='"+seal+"'");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,Buffer,process:{argv:[]},console,
  require:spec=>spec.endsWith('/integrationAdmission.mjs')?{verifyIntegrationCandidate:guard,integrationPhysicalMode:()=> '100644'}:require(spec)},{filename:script});
 return module.exports;
}
const draft=packager(),confirmed=Object.fromEntries([actual.INDEX,actual.CORE,actual.SDK_TYPES].map(name=>[name,sha(physical(name))]));
const catalog=draft.proposeReleaseCatalog(confirmed,physical),catalogBytes=encode(catalog),calls=[];
const api=packager({seal:sha(catalogBytes),guard:()=>calls.push('ADMISSION')});
const read=name=>name===actual.CATALOG?catalogBytes:physical(name);
const candidate=api.assemble('candidate',read),recovery=api.assemble('recovery',read);
const temporary=mkdtempSync('/private/tmp/ma-cle-release-offline-');
after(()=>rmSync(temporary,{recursive:true,force:true}));

test('proposal confirms fresh source hashes, preserves V17 metadata, and never seals or writes itself',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(catalog.confirmed_sources)),confirmed);assert.equal(catalog.production_authorized,false);
 assert.equal(catalog.baseline.version,17);assert.equal(catalog.baseline.verify_jwt,false);
 assert.equal(catalog.baseline.physical_eszip_sha256,actual.ESZIP_SHA256);
 assert.equal(catalog.baseline.readback_sha256,actual.READBACK_SHA256);
 assert.match(actual.CATALOG_SHA256,/^[a-f0-9]{64}$/);
 assert.equal(sha(physical(actual.CATALOG)),actual.CATALOG_SHA256);
 assert.deepEqual(JSON.parse(physical(actual.CATALOG)),JSON.parse(JSON.stringify(catalog)));
 assert.throws(()=>draft.proposeReleaseCatalog({...confirmed,[actual.CORE]:'d'.repeat(64)},physical),/NOT_CONFIRMED/);
 assert.throws(()=>draft.proposeReleaseCatalog({...confirmed,extra:'f'.repeat(64)},physical),/EXACT_KEYS/);
});
test('real candidate/recovery assembly requires the complete live composition, not the test admission double',()=>{
 for(const variant of ['candidate','recovery']){
  const result=actual.assemble(variant);
  assert.equal(result.sha256,catalog.payloads[variant].sha256);assert.deepEqual(result.bytes,variant==='candidate'?candidate.bytes:recovery.bytes);
  assert.throws(()=>actual.assemble(variant,p=>p===actual.SDK_TYPES?Buffer.concat([physical(p),Buffer.from('\nDRIFT')]):physical(p)),/SOURCE_DRIFT/);
 }
});
test('candidate and recovery first/last pass admission, then exact catalog, source, mode and drift guards',()=>{
 assert.deepEqual(calls,['ADMISSION','ADMISSION','ADMISSION','ADMISSION']);
 for(const variant of ['candidate','recovery']){
  let reads=0;const denied=packager({guard:()=>{throw Error('SYNTHETIC_ADMISSION_DENIED');}});
  assert.throws(()=>denied.assemble(variant,()=>{reads++;throw Error('MUST_NOT_READ');}),/SYNTHETIC_ADMISSION_DENIED/);assert.equal(reads,0);
  for(const name of [actual.INDEX,actual.CORE,actual.TYPE_CONTRACT,actual.SDK_TYPES,actual.SDK_ENTRY,
   catalog.files.find(r=>r.name.endsWith('/licenses/NOTICE.md')).name]){
   assert.throws(()=>api.assemble(variant,p=>p===name?Buffer.concat([read(p),Buffer.from('\nDRIFT')]):read(p)),/NOT_CONFIRMED|SOURCE_DRIFT/);
  }
  assert.throws(()=>api.assemble(variant,p=>p===actual.CATALOG?Buffer.concat([catalogBytes,Buffer.from('\n')]):read(p)),/CATALOG_DRIFT/);
  assert.throws(()=>api.assemble(variant,read,p=>p===actual.CORE?'100755':'100644'),/MODE_DRIFT/);
  assert.throws(()=>api.assemble(variant,p=>p===actual.READBACK?Buffer.from('{}'):read(p)),/READBACK_DRIFT/);
 }
});
test('67-file closures keep the sealed V17 logic plus explicit SDK/null-guard transforms; the type directive erases',()=>{
 assert.equal(candidate.payload.files.length,67);assert.equal(recovery.payload.files.length,67);
 const a=new Map(candidate.payload.files.map(f=>[f.name,f.content])),b=new Map(recovery.payload.files.map(f=>[f.name,f.content]));
 assert.deepEqual([...a.keys()].filter(name=>a.get(name)!==b.get(name)).sort(),[actual.INDEX,actual.CORE].sort());
 const proof=JSON.parse(physical(actual.READBACK));
 for(const row of proof.files){
  const original=baseline(row.path).toString();assert.equal(b.get(row.path),row.path===actual.INDEX?actual.fixedSdkImport(Buffer.from(original)):original);
 }
 const originalImport=s=>s.replace(actual.TYPE_HINT,'').replace(actual.LOCAL_SDK,actual.REMOTE_SDK).replace(actual.NULL_RUN_GUARD,'');
 assert.equal(originalImport(b.get(actual.INDEX)),baseline(actual.INDEX).toString());
 assert.equal(originalImport(a.get(actual.INDEX)),physical(actual.INDEX).toString());
 const emit=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,removeComments:true}}).outputText;
 for(const result of [candidate,recovery]){
  const entry=result.payload.files.find(f=>f.name===actual.INDEX).content;
  assert.equal(emit(entry),emit(entry.replace(actual.TYPE_HINT,'')),'type hint must erase to exactly the same runtime');
 }
 assert.equal(a.get(actual.SDK_TYPES),b.get(actual.SDK_TYPES));assert.equal(a.get(actual.SDK_TYPES),physical(actual.SDK_TYPES).toString());
 assert(!/\bany\b|@ts-(?:ignore|nocheck)/.test(a.get(actual.SDK_TYPES)));
 for(const result of [candidate,recovery]){
  assert.equal(result.payload.verify_jwt,false);assert(!('import_map_path'in result.payload));
  assert.equal(result.payload.files.filter(f=>f.name.startsWith(actual.SDK_ROOT)&&!f.name.includes('/licenses/')).length,15);
  assert.equal(result.payload.files.filter(f=>f.name.includes('/licenses/')).length,30);
  assert.equal(result.sha256,sha(result.bytes));
 }
 for(const row of catalog.files.filter(r=>r.name.startsWith(actual.SDK_ROOT)||r.name===actual.TYPE_CONTRACT))assert.equal(a.get(row.name),baseline(row.name).toString());
});
test('explicit nullable SDK guard preserves V17 valid receipt and original null failure before any following work',()=>{
 const execute=(guard,input)=>{
  const fn=vm.runInNewContext('(input)=>{let runId;const insertedRun=input;\n'+(guard?actual.NULL_RUN_GUARD:'')+actual.RUN_ASSIGNMENT+'\nreturn {runId,following_work:true};}');
  try{return JSON.parse(JSON.stringify(fn(input)));}catch(error){return {error:error.name,message:error.message};}
 };
 for(const input of [null,{id:'11111111-1111-4111-8111-111111111111'}])assert.deepEqual(execute(false,input),execute(true,input));
 assert.equal(execute(true,null).error,'TypeError');assert.equal(execute(true,null).following_work,undefined);
});
test('custom variant/path/URL and new remote or dynamic imports cannot enter either payload',()=>{
 for(const value of ['../recovery','https://example.invalid','file:///tmp/out','recovery@HEAD',{}])assert.throws(()=>api.assemble(value,read),/FIXED_VARIANT/);
 assert.throws(()=>actual.materialize('candidate','/tmp/custom'),/NO_CUSTOM_PATH_OR_URL/);
 for(const spec of ['https://example.invalid/x.ts','/tmp/custom.ts','npm:unapproved']){
  const changed=Buffer.concat([physical(actual.CORE),Buffer.from('\nvoid import('+JSON.stringify(spec)+');\n')]);
  assert.throws(()=>draft.proposeReleaseCatalog({...confirmed,[actual.CORE]:sha(changed)},p=>p===actual.CORE?changed:physical(p)),/REMOTE_OR_CUSTOM_IMPORT|DYNAMIC_IMPORT_FORBIDDEN/);
 }
 const dynamic=Buffer.concat([physical(actual.CORE),Buffer.from('\nconst target="./unknown.mjs"; void import(target);\n')]);
 assert.throws(()=>draft.proposeReleaseCatalog({...confirmed,[actual.CORE]:sha(dynamic)},p=>p===actual.CORE?dynamic:physical(p)),/DYNAMIC_IMPORT_FORBIDDEN/);
 assert.throws(()=>draft.fixedSdkImport(Buffer.from('import x from "https://unapproved.invalid";')),/SDK_IMPORT/);
});

// Actual fixed SDK modules are executed in this offline VM; no installed SDK
// or remote module substitutes. The V17 remote SDK specifier is redirected to
// the SAME fixed archived SDK solely in the test loader, never on the network.
function edge(payload){
 const sources=new Map(payload.files.map(f=>[f.name,f.content])),cache=new Map(),trace={fetches:0,clients:0,env:[]};let handler;
 const consoleStub={log(){},info(){},warn(){},error(){}};
 const globals={Response,Request,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,
  setTimeout,clearTimeout,setInterval,clearInterval,Buffer,Date,crypto:webcrypto,console:consoleStub,
  fetch:async()=>{trace.fetches++;throw Error('OFFLINE_NETWORK_FORBIDDEN');},
  Deno:{env:{get:key=>{trace.env.push(key);return {CRON_SECRET:'synthetic-offline-control',INTERNAL_AUTH_VERSION:'v1'}[key];}},serve:fn=>{handler=fn;}}};
 function load(name){
  if(cache.has(name))return cache.get(name).exports;assert(sources.has(name),'OFFLINE_CLOSURE_MISSING:'+name);
  const module={exports:{}};cache.set(name,module);
  if(name.endsWith('.json')){module.exports={__esModule:true,default:JSON.parse(sources.get(name))};return module.exports;}
  // The archived node-fetch ESM explicitly exports __esModule. Make the test
  // transpiler's CJS-only marker writable; never alter any payload SDK bytes.
  const js=ts.transpileModule(sources.get(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
   .replace('Object.defineProperty(exports, "__esModule", { value: true });','Object.defineProperty(exports, "__esModule", { value: true, writable: true, configurable: true });');
  const localRequire=spec=>{
   if(spec==='node:process')return {env:{},version:'v22.12.0',versions:{node:'22.12.0'}};
   if(spec.startsWith('node:')){assert(['node:buffer','node:stream','node:http','node:url','node:https','node:zlib','node:punycode'].includes(spec));return require(spec);}
   if(spec===actual.REMOTE_SDK)spec=actual.LOCAL_SDK;
   assert(spec.startsWith('.'),'OFFLINE_UNAPPROVED_IMPORT:'+spec);
   const target=posix.normalize(posix.join(posix.dirname(name),spec)),exports=load(target);
   return target===actual.SDK_ENTRY?{...exports,createClient:(...args)=>{trace.clients++;return exports.createClient(...args);}}:exports;
  };
  vm.runInNewContext(js,{...globals,module,exports:module.exports,require:localRequire},{filename:name});return module.exports;
 }
 const core=load(actual.CORE);load(actual.INDEX);assert(handler);return {handler,trace,core,sdk:load(actual.SDK_ENTRY)};
}
const originalPayload={...recovery.payload,files:recovery.payload.files.map(f=>f.name===actual.INDEX?{...f,content:baseline(actual.INDEX).toString()}:f)};
test('V17 and recovery retain identical scope/review behavior with the same fixed SDK',()=>{
 const old=edge(originalPayload),restored=edge(recovery.payload),plain=v=>JSON.parse(JSON.stringify(v));
 for(const scope of ['market','symbol','unknown']){
  const prediction={prediction_scope:scope,symbol:scope==='symbol'?'2330':'TAIEX',direction:'BULLISH',model_confidence:75};
  assert.deepEqual(plain(restored.core.buildPatternDimensions(prediction)),plain(old.core.buildPatternDimensions(prediction)));
  for(const directionCorrect of [true,false,null]){
   const input={scope,dataQuality:'complete',outcomeStatus:'completed',directionCorrect,timingCorrect:true,
    abnormalReturn:0.5,modelConfidence:75,catalystScore:80,surpriseScore:80,priceInScore:80,mappingScore:80};
   assert.deepEqual(plain(restored.core.buildReview(input)),plain(old.core.buildReview(input)));
  }
 }
 assert.equal(old.trace.fetches+restored.trace.fetches,0);assert.equal(old.trace.clients+restored.trace.clients,0);
});
test('actual V17, candidate and recovery HTTP handlers reject missing/wrong custom auth before SDK clients or business writes',async()=>{
 for(const payload of [originalPayload,candidate.payload,recovery.payload]){
  const e=edge(payload);
  for(const headers of [{},{'x-cron-secret':'synthetic-wrong'},{Authorization:'Bearer synthetic-wrong'}]){
   const response=await e.handler(new Request('https://offline.invalid/continuous-learning-engine',{method:'POST',headers,body:'{}'}));
   assert.equal(response.status,401);const body=await response.json();assert.match(body.error_code,/INTERNAL_AUTH_(MISSING|INVALID)/);
  }
  assert.equal(e.trace.clients,0);assert.equal(e.trace.fetches,0);assert(!e.trace.env.includes('SUPABASE_URL'));
 }
});
test('narrow type bridge matches locked 2.57.4 and actual archived SDK query/RPC behavior through an injected offline transport',async()=>{
 const lock=JSON.parse(physical('package-lock.json')).packages['node_modules/@supabase/supabase-js'];
 const installed=JSON.parse(physical('node_modules/@supabase/supabase-js/package.json'));
 const archived=JSON.parse(recovery.payload.files.find(f=>f.name===actual.SDK_ROOT+'licenses/supabase-supabase-js/package.json').content);
 assert.equal(lock.version,'2.57.4');assert.equal(installed.version,lock.version);assert.equal(archived.name,installed.name);
 // The archived MIT package metadata uses upstream's 0.0.0-automated build
 // version; the immutable release catalog and actual runtime banner pin 2.57.4.
 assert.equal(catalog.sdk.version,lock.version);assert(recovery.payload.files.find(f=>f.name===actual.SDK_ENTRY).content.startsWith('/* esm.sh - @supabase/supabase-js@2.57.4 */'));
 assert.equal(installed.dependencies['@supabase/postgrest-js'],lock.dependencies['@supabase/postgrest-js']);
 for(const payload of [candidate.payload,recovery.payload]){
  const e=edge(payload),requests=[];
  const client=e.sdk.createClient('https://offline.invalid','synthetic-sdk-control-not-a-secret',{
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,init)=>{
    const u=new URL(url),headers=new Headers(init.headers);requests.push({path:u.pathname,method:init.method,body:init.body,query:u.search});
    const body=u.pathname.includes('/rpc/')?{verified:'offline'}:headers.get('accept')?.includes('vnd.pgrst.object')?{id:'control'}:[{id:'control'}];
    return Response.json(body,{headers:{'content-range':'0-0/1'}});
   }},
  });
  const rows=await client.from('learning_rules').select('id',{count:'exact'}).eq('status','candidate').gte('score',0).lte('score',100)
   .in('id',['control']).is('deleted_at',null).like('id','%control%').order('id',{ascending:true}).limit(1);
  assert.equal(rows.error,null);assert.equal(rows.data[0].id,'control');assert.equal(rows.count,1);
  const one=await client.from('learning_rules').select('id').eq('id','control').maybeSingle();assert.equal(one.data.id,'control');
  const inserted=await client.from('learning_rules').insert({id:'control'}).select('id').single();assert.equal(inserted.data.id,'control');
  await client.from('learning_rules').upsert({id:'control'},{onConflict:'id',ignoreDuplicates:false}).select('id');
  await client.from('learning_rules').update({status:'candidate'}).eq('id','control').select('id');
  const rpc=await client.rpc('offline_control',{p_id:'control'});assert.equal(rpc.error,null);assert.equal(rpc.data.verified,'offline');
  assert.deepEqual(requests.map(r=>r.method),['GET','GET','POST','POST','PATCH','POST']);
  assert.equal(requests.at(-1).path,'/rest/v1/rpc/offline_control');assert.equal(JSON.parse(requests.at(-1).body).p_id,'control');
  assert.equal(e.trace.fetches,0,'only the explicitly injected in-memory transport may run');
 }
});
test('installed locked SDK inputs and every consumed query result satisfy the narrow nullable protocol',()=>{
 const virtual=join(root,'tests/.continuous-learning-sdk-assignability.ts');
 const source=`import {createClient as installed} from '@supabase/supabase-js';
import type {createClient as declared} from '../${actual.SDK_TYPES}';
import type {LearningClient,LearningSdkResult} from '../${actual.SDK_TYPES}';
import type {RuntimeDatabase,RuntimeJson} from '../${actual.TYPE_CONTRACT}';
const args: Parameters<typeof declared<RuntimeDatabase>> = ['https://offline.invalid','synthetic-only',{auth:{persistSession:false},global:{fetch}}];
const actualClient = installed<RuntimeDatabase>(...args);
// Match concrete consumed input/result contracts; comparing every possible
// recursive upstream generic query is not a finite proof (TS2589).
async function consumeInstalled() {
 const rows: LearningSdkResult<RuntimeJson[]> = await actualClient.from('learning_rules').select('*',{count:'exact'}).eq('status','candidate')
  .gte('score',0).lte('score',100).in('id',['control']).is('deleted_at',null).like('id','%control%').order('id',{ascending:true}).limit(1);
 const maybe: LearningSdkResult<RuntimeJson | null> = await actualClient.from('learning_rules').select('*').maybeSingle();
 const one: LearningSdkResult<RuntimeJson | null> = await actualClient.from('learning_rules').insert({id:'control'}).select('*').single();
 const upsert: LearningSdkResult<RuntimeJson[]> = await actualClient.from('learning_rules').upsert({id:'control'},{onConflict:'id'}).select('*');
 const update: LearningSdkResult<RuntimeJson[]> = await actualClient.from('learning_rules').update({status:'candidate'}).eq('id','control').select('*');
 const rpc: LearningSdkResult<unknown> = await actualClient.rpc('offline_control',{p_id:'control'});
 return [rows,maybe,one,upsert,update,rpc];
}
async function consume(db: LearningClient<RuntimeDatabase>) {
 const result = await db.from('learning_rules').select('*',{count:'exact'}).eq('status','candidate').gte('score',0).lte('score',100)
  .in('id',['control']).is('deleted_at',null).like('id','%control%').order('id',{ascending:true}).limit(1);
 const maybe = await db.from('learning_rules').select('*').maybeSingle();
 const one = await db.from('learning_rules').insert({id:'control'}).select('*').single();
 await db.from('learning_rules').upsert({id:'control'},{onConflict:'id'}).select('*');
 await db.from('learning_rules').update({status:'candidate'}).eq('id','control').select('*');
 const rpc = await db.rpc('offline_control',{p_id:'control'});
 const unknowns: unknown[] = [result.data,maybe.data,one.data,rpc.data];
 return unknowns;
}
void consumeInstalled; void consume;
`;
 const options={strict:true,noEmit:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions:true,types:['node'],typeRoots:[join(root,'node_modules/@types')],lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']};
 const host=ts.createCompilerHost(options),get=host.getSourceFile.bind(host),exists=host.fileExists.bind(host);
 host.getSourceFile=(name,language,...rest)=>name===virtual?ts.createSourceFile(name,source,language,true):get(name,language,...rest);
 host.fileExists=name=>name===virtual||exists(name);
 const program=ts.createProgram([virtual],options,host),diagnostics=ts.getPreEmitDiagnostics(program);
 assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:p=>p,getNewLine:()=> '\n'}));
});
test('actual transformed candidate/recovery entrypoints AND RuntimeDatabase compile with Deno offline', {timeout:30000},()=>{
 const failures=[];
 for(const [variant,result]of [['candidate',candidate],['recovery',recovery]]){
  const folder=join(temporary,variant);mkdirSync(folder);
  for(const f of result.payload.files){const target=join(folder,f.name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,f.content,{flag:'wx'});}
  const checked=spawnSync('deno',['check','--no-remote','--deny-import','--no-npm','--no-config','--no-lock','--node-modules-dir=none',actual.INDEX,actual.TYPE_CONTRACT,actual.SDK_TYPES],
   {cwd:folder,env:{PATH:env.PATH,TMPDIR:'/private/tmp',DENO_DIR:join(temporary,'deno-cache'),DENO_NO_UPDATE_CHECK:'1'},encoding:'utf8',timeout:20000,maxBuffer:2e6});
  if(checked.status!==0)failures.push(variant+' TRANSFORMED_OFFLINE_DENO_CHECK_FAILED\n'+checked.stdout+'\n'+checked.stderr);
  if(checked.status===0){
   const probe=join(folder,'unknown-boundary.ts');
   writeFileSync(probe,'// @deno-types="./'+actual.SDK_TYPES+'"\nimport {createClient} from "./'+actual.SDK_ENTRY+'";\nimport type {RuntimeDatabase} from "./'+actual.TYPE_CONTRACT+'";\n'
    +'const client=createClient<RuntimeDatabase>("https://offline.invalid","synthetic-only");\nconst row=await client.from("learning_rules").select("*");\n'
    +'const mustNotBecomeNumber: number = row.data?.[0]?.score;\nclient.auth.admin;\n');
   const denied=spawnSync('deno',['check','--no-remote','--deny-import','--no-npm','--no-config','--no-lock',probe],
    {cwd:folder,env:{PATH:env.PATH,DENO_DIR:join(temporary,'deno-cache'),DENO_NO_UPDATE_CHECK:'1'},encoding:'utf8',timeout:10000});
   assert.notEqual(denied.status,0,'unknown data and unreviewed auth API must remain rejected');assert.match(denied.stderr,/TS2322/);assert.match(denied.stderr,/TS2339/);
  }
 }
 assert.deepEqual(failures,[],'Both transformed variants must pass; no generic/type-check suppression is allowed.\n'+failures.join('\n'));
});
