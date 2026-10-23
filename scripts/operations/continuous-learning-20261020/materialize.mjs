// Offline CLE source packaging. No network, SQL, environment or deployment port.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {verifyIntegrationCandidate,integrationPhysicalMode} from '../../../tests/helpers/integrationAdmission.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
export const INDEX='supabase/functions/continuous-learning-engine/index.ts';
export const CORE='supabase/functions/_shared/continuous-learning-core.mjs';
export const TYPE_CONTRACT='supabase/functions/_shared/runtime-database-contract.ts';
export const SDK_TYPES='supabase/functions/_shared/continuous-learning-fixed-sdk.d.ts';
export const TYPE_HINT='// @deno-types="../_shared/continuous-learning-fixed-sdk.d.ts"\n';
export const RUN_ASSIGNMENT='      runId = String(insertedRun.id);';
export const NULL_RUN_GUARD="      if (insertedRun === null) throw new TypeError(\"Cannot read properties of null (reading 'id')\");\n";
export const CATALOG='scripts/operations/continuous-learning-20261020/release-catalog.json';
export const CATALOG_SHA256='f4deb3e733e63a55c711520791d4305c7431c921a799dffe654be5ac7f1642f8';
export const READBACK='docs/operations/evidence/learning-v17-exact-readback-20261020.json';
export const READBACK_SHA256='ccb5cbe0b155f881c0470619bcedae18e78fbcef6fa939ff4b015d3d861a41d3';
export const ESZIP_SHA256='9c36d75abed3d80a83dad644cb9bdab2d5fbb18c7d292c23ee5c8461c9f65884';
export const SDK_ROOT='supabase/functions/_shared/_fixed_c_worker_sdk/';
export const SDK_ENTRY=SDK_ROOT+'f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs';
export const REMOTE_SDK='https://esm.sh/@supabase/supabase-js@2.57.4';
export const LOCAL_SDK='../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs';
const SDK_CATALOG='scripts/operations/cold-source-priority-20261019/release-catalog.json';
const SDK_CATALOG_SHA256='52ecf6eb1643d55edef712117b28ffa42d4bc38385dfe4ce36d3290e4a379a11';
const builtins=new Set(['node:process','node:buffer','node:stream','node:http','node:url','node:https','node:zlib','node:punycode']);
const env=Object.freeze({PATH:'/usr/bin:/bin',TMPDIR:'/private/tmp',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),'CLE_EXACT_KEYS');
function safeName(name){
 assert.equal(typeof name,'string','CLE_PATH');assert(/^[a-zA-Z0-9_./-]+$/.test(name),'CLE_PATH');
 assert.equal(posix.normalize(name),name,'CLE_PATH');assert(!name.startsWith('/')&&!name.split('/').some(p=>p==='..'||p==='.'),'CLE_PATH');
 assert(!/(^|\/)\.env(?:\.|$)/.test(name)||name==='.env.example','CLE_NO_ENV_FILE');
}
const physical=name=>{
 safeName(name);let path=root;const parts=name.split('/');
 for(const [i,part]of parts.entries()){path=resolve(path,part);const s=lstatSync(path);assert(!s.isSymbolicLink(),'CLE_SYMLINK');assert(i===parts.length-1?s.isFile():s.isDirectory(),'CLE_REGULAR_SOURCE');}
 return readFileSync(path);
};
const git=name=>{safeName(name);return execFileSync('git',['--no-replace-objects','show',BASE+':'+name],{cwd:root,env,stdio:['ignore','pipe','pipe'],maxBuffer:8e6});};
const text=bytes=>{const b=Buffer.from(bytes),s=b.toString('utf8');assert(b.equals(Buffer.from(s)),'CLE_UTF8');return s;};
export function fixedSdkImport(bytes){
 const source=text(bytes);assert.equal(source.split(REMOTE_SDK).length,2,'CLE_EXACT_SDK_IMPORT');
 assert(source.startsWith("import { createClient as createRawClient } from '"+REMOTE_SDK+"';"),'CLE_SDK_IMPORT_CONTRACT');
 assert.equal(source.split(RUN_ASSIGNMENT).length,2,'CLE_RUN_ASSIGNMENT_CONTRACT');
 // Honest nullable SDK results require an explicit guard. Match V17's existing
 // null-receipt failure before ID assignment; valid receipts and all writes
 // remain byte-for-byte the same. Never assert away unknown/null responses.
 return TYPE_HINT+source.replace(REMOTE_SDK,LOCAL_SDK).replace(RUN_ASSIGNMENT,NULL_RUN_GUARD+RUN_ASSIGNMENT);
}
function baseline(read){
 const proofBytes=Buffer.from(read(READBACK));assert.equal(sha(proofBytes),READBACK_SHA256,'CLE_READBACK_DRIFT');
 const proof=JSON.parse(proofBytes);
 assert.equal(proof.schema,'CLE_V17_EXACT_SOURCE_READBACK_SAFE_V1');assert.equal(proof.base,BASE);
 assert.equal(proof.version,17);assert.equal(proof.status,'ACTIVE');assert.equal(proof.verify_jwt,false);assert.equal(proof.import_map,false);
 assert.equal(proof.ezbr_sha256,ESZIP_SHA256);assert.equal(proof.files.length,20);assert.equal(new Set(proof.files.map(r=>r.path)).size,20);
 const sdkBytes=git(SDK_CATALOG);assert.equal(sha(sdkBytes),SDK_CATALOG_SHA256,'CLE_SDK_CATALOG_DRIFT');
 const sdk=JSON.parse(sdkBytes),sdkRows=sdk.files.filter(r=>r.name.startsWith(SDK_ROOT));
 assert.equal(sdk.baseline.sdk,'2.57.4');assert.equal(sdkRows.length,45);assert.equal(sdkRows.filter(r=>r.static).length,30);
 const original=new Map();
 for(const row of proof.files){
  const bytes=git(row.path);assert.equal(row.matched,true);assert.equal(row.production_sha256,row.base_sha256);
  assert.equal(bytes.length,row.bytes,'CLE_V17_SOURCE_SIZE');assert.equal(sha(bytes),row.base_sha256,'CLE_V17_SOURCE_DRIFT');original.set(row.path,bytes);
 }
 const rows=proof.files.map(r=>({name:r.path,static:false,type_only:false}));
 for(const row of sdkRows){
  const bytes=git(row.name);assert.equal(bytes.length,row.after_bytes,'CLE_SDK_SIZE');assert.equal(sha(bytes),row.after_sha256,'CLE_SDK_DRIFT');
  original.set(row.name,bytes);rows.push({name:row.name,static:row.static,type_only:false});
 }
 original.set(TYPE_CONTRACT,git(TYPE_CONTRACT));rows.push({name:TYPE_CONTRACT,static:true,type_only:true});
 original.set(SDK_TYPES,Buffer.alloc(0));rows.push({name:SDK_TYPES,static:true,type_only:true});
 assert.equal(new Set(rows.map(r=>r.name)).size,67);
 const metadata={project_id:sdk.metadata.project_id,name:'continuous-learning-engine',entrypoint_path:INDEX,verify_jwt:false};
 return {proof,rows,original,metadata};
}
function closure(payload){
 const files=new Map(payload.files.map(f=>[f.name,f.content]));assert.equal(files.size,67,'CLE_EXACT_CLOSURE');
 for(const [name,source]of files){
  safeName(name);if(name.includes('/licenses/')||name.endsWith('.json'))continue;
  const file=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true);
  assert.equal(file.parseDiagnostics.length,0,'CLE_SOURCE_SYNTAX:'+name);
  const visit=node=>{
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
    assert(name.startsWith(SDK_ROOT)&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]),'CLE_DYNAMIC_IMPORT_FORBIDDEN');
    const spec=node.arguments[0].text,target=posix.normalize(posix.join(posix.dirname(name),spec));
    assert(builtins.has(spec)||(spec.startsWith('.')&&target.startsWith(SDK_ROOT)&&files.has(target)),'CLE_DYNAMIC_IMPORT_FORBIDDEN');
   }
   ts.forEachChild(node,visit);
  };visit(file);
  for(const imported of ts.preProcessFile(source,true,true).importedFiles){
   const spec=imported.fileName;
   if(builtins.has(spec)){assert(name.startsWith(SDK_ROOT),'CLE_BUSINESS_NODE_IMPORT');continue;}
   assert(spec.startsWith('.'),'CLE_REMOTE_OR_CUSTOM_IMPORT:'+spec);
   const target=posix.normalize(posix.join(posix.dirname(name),spec));safeName(target);
   assert(files.has(target),'CLE_IMPORT_CLOSURE_MISSING:'+target);
  }
 }
 assert(files.has(TYPE_CONTRACT),'CLE_RUNTIME_DATABASE_CLOSURE');
}
function payloads(base,current){
 const make=variant=>({...base.metadata,files:base.rows.map(row=>{
  const bytes=(variant==='candidate'||row.name===SDK_TYPES)&&current.has(row.name)?current.get(row.name):base.original.get(row.name);
  return {name:row.name,content:row.name===INDEX?fixedSdkImport(bytes):text(bytes)};
 })});
 const result={candidate:make('candidate'),recovery:make('recovery')};
 for(const payload of Object.values(result))closure(payload);
 return result;
}
/** Pure proposal only: independently confirmed CURRENT SHA values are required.
 * Does not write, seal, deploy, invoke, or bypass the later admission checks. */
export function proposeReleaseCatalog(confirmed,read=physical){
 exactKeys(confirmed,[INDEX,CORE,SDK_TYPES]);const base=baseline(read),current=new Map();
 for(const name of [INDEX,CORE,SDK_TYPES]){assert.match(confirmed[name],/^[a-f0-9]{64}$/,'CLE_SOURCE_CONFIRMATION_REQUIRED');const b=Buffer.from(read(name));assert.equal(sha(b),confirmed[name],'CLE_CURRENT_SOURCE_NOT_CONFIRMED:'+name);current.set(name,b);}
 const authBoundary=source=>{const start=source.indexOf('Deno.serve(async (req: Request) => {'),end=source.indexOf('  const body = await readRequestBody(req);',start);assert(start>=0&&end>start,'CLE_AUTH_BOUNDARY_MISSING');return source.slice(start,end);};
 assert.equal(authBoundary(text(current.get(INDEX))),authBoundary(text(base.original.get(INDEX))),'CLE_AUTH_BOUNDARY_DRIFT');
 const variants=payloads(base,current);
 return {schema:'CLE_FIXED_SDK_RELEASE_V1',status:'SEALED_SOURCE_CANDIDATE_NOT_DEPLOYED',base:BASE,metadata:base.metadata,confirmed_sources:{...confirmed},
  baseline:{version:17,physical_eszip_sha256:ESZIP_SHA256,readback_sha256:READBACK_SHA256,source_files:20,verify_jwt:false,custom_auth_unchanged:true},
  sdk:{version:'2.57.4',runtime_files:15,license_files:30,entry:SDK_ENTRY,source:BASE},
  recovery_meaning:'V17_VALID_RECEIPT_BEHAVIOR_FIXED_SDK_IDENTICAL_NULL_FAILURE_NOT_ESZIP_BIT_IDENTICAL',
  production_authorized:false,scope:{changed_business_files:[INDEX,CORE],fixed_sdk_in_both_variants:true,explicit_null_receipt_guard_in_both_variants:true,type_only:[TYPE_CONTRACT,SDK_TYPES],type_directive_erases_at_runtime:true,
   sql:false,auth_rls_change:false,caller_activation:false,cron_change:false,secrets_change:false,payment_enabled:false,publication:false},
  payloads:Object.fromEntries(Object.entries(variants).map(([variant,payload])=>{const b=encode(payload);return [variant,{sha256:sha(b),bytes:b.length}];})),
  files:base.rows.map((row,i)=>({...row,mode:'100644',before_sha256:row.name===SDK_TYPES?null:sha(base.original.get(row.name)),before_bytes:base.original.get(row.name).length,
   recovery_sha256:sha(Buffer.from(variants.recovery.files[i].content)),recovery_bytes:Buffer.byteLength(variants.recovery.files[i].content),
   after_sha256:sha(Buffer.from(variants.candidate.files[i].content)),after_bytes:Buffer.byteLength(variants.candidate.files[i].content)}))};
}
export function assemble(variant='candidate',read=physical,mode=integrationPhysicalMode){
 assert(['candidate','recovery'].includes(variant),'CLE_FIXED_VARIANT');
 // Both variants fail closed on the complete current integration tree FIRST.
 verifyIntegrationCandidate(read,undefined,mode);
 assert.match(CATALOG_SHA256,/^[a-f0-9]{64}$/,'CLE_CATALOG_UNSEALED');
 const catalogBytes=Buffer.from(read(CATALOG));assert.equal(sha(catalogBytes),CATALOG_SHA256,'CLE_CATALOG_DRIFT');
 const c=JSON.parse(catalogBytes),confirmed=c.confirmed_sources;assert(confirmed,'CLE_SOURCE_SEAL_MISSING');
 const proposed=proposeReleaseCatalog(confirmed,read);assert.deepEqual(c,proposed,'CLE_CATALOG_CONTRACT');
 const base=baseline(read),current=new Map([INDEX,CORE,SDK_TYPES].map(name=>[name,Buffer.from(read(name))]));
 for(const row of base.rows){
  assert.equal(mode(row.name),'100644','CLE_MODE_DRIFT:'+row.name);
  if(!current.has(row.name))assert.deepEqual(Buffer.from(read(row.name)),base.original.get(row.name),'CLE_FIXED_SOURCE_DRIFT:'+row.name);
 }
 const payload=payloads(base,current)[variant],bytes=encode(payload);
 assert.equal(bytes.length,c.payloads[variant].bytes,'CLE_PAYLOAD_SIZE');assert.equal(sha(bytes),c.payloads[variant].sha256,'CLE_PAYLOAD_DRIFT');
 verifyIntegrationCandidate(read,undefined,mode);
 return {payload,bytes,sha256:sha(bytes)};
}
export function materialize(variant='candidate'){
 assert.equal(arguments.length<=1,true,'CLE_NO_CUSTOM_PATH_OR_URL');const result=assemble(variant);
 const relative='build/continuous-learning-20261020/'+variant,artifact=relative+'/deploy-args.json';
 assert.equal(execFileSync('git',['check-ignore','--',artifact],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(),artifact,'CLE_OUTPUT_NOT_IGNORED');
 let path=root;for(const part of ['build','continuous-learning-20261020']){path=resolve(path,part);try{mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}assert(lstatSync(path).isDirectory()&&!lstatSync(path).isSymbolicLink(),'CLE_OUTPUT_SYMLINK');}
 const output=resolve(root,relative);mkdirSync(output,{mode:0o700});
 writeFileSync(resolve(output,'deploy-args.json'),result.bytes,{flag:'wx',mode:0o600});
 return {status:'MATERIALIZED_NOT_DEPLOYED',variant,sha256:result.sha256,files:67,production_changed:false,network_requests:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert(process.argv.length<=3,'CLE_NO_CUSTOM_PATH_OR_URL');console.log(JSON.stringify(materialize(process.argv[2]??'candidate')));}
