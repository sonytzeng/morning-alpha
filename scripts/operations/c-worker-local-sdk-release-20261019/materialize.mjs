// Offline source packaging only. This module has no deploy or network port.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
export const RELEASE_CATALOG='scripts/operations/c-worker-local-sdk-release-20261019/release-catalog-r2.json';
export const RELEASE_CATALOG_SHA256='8ce62c1b492dd6aaf0dd797e5bbe384b241a9e206e930e7f1eccc2e0cdaefb81';
export const APPROVED_LOGIC_COMMIT='5f33777836778e3600e4e377fcb3cf4de690fe80';
export const RELEASE_OUTPUT='build/c-worker-local-sdk-release-20261019-r2/repair-deploy-args.json';
export const RECOVERY_OUTPUT='build/c-worker-local-sdk-release-20261019-r2/fixed-sdk-recovery-deploy-args.json';
export const HISTORICAL_LOGIC=Object.freeze([
 'supabase/functions/_shared/decision-v1-evidence.ts',
 'supabase/functions/_shared/recommendation-official-actuals.ts',
]);
export const RECOVERY_LOGIC=Object.freeze([
 'src/features/vnext/dailyRuntime.ts',
 'supabase/functions/vnext-daily-research-v1/handler.ts',
]);
const variantName=variant=>{assert(['repair','recovery'].includes(variant),'RELEASE_FIXED_VARIANT');return variant;};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exactKeys=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort());

function regularSource(name){
 assert.equal(posix.normalize(name),name,'RELEASE_CANONICAL_PATH');
 assert(!name.startsWith('/')&&!name.split('/').includes('..'),'RELEASE_RELATIVE_PATH');
 const parts=name.split('/');let path=repository;
 for(let i=0;i<parts.length;i++){
  path=resolve(path,parts[i]);const stat=lstatSync(path);
  assert(!stat.isSymbolicLink(),'RELEASE_SYMLINK:'+name);
  assert(i===parts.length-1?stat.isFile():stat.isDirectory(),'RELEASE_REGULAR_SOURCE:'+name);
 }
 return readFileSync(path);
}

export function readReleaseCatalog(){
 const bytes=regularSource(RELEASE_CATALOG);
 assert.equal(digest(bytes),RELEASE_CATALOG_SHA256,'RELEASE_CATALOG_DRIFT');
 const c=JSON.parse(bytes);
 exactKeys(c,['schema','repository_base','approved_logic_commit','metadata','payload_sha256','payload_bytes','runtime_files','static_files','files','production_authorized','recovery']);
 assert.equal(c.schema,'C_WORKER_LOCAL_SDK_GIT_RELEASE_V1');
 assert.equal(c.repository_base,'5109221ae1c70405d735e7f3cffa3430a6c888fc');
 assert.equal(c.approved_logic_commit,APPROVED_LOGIC_COMMIT);
 assert.equal(c.production_authorized,false);
 assert.equal(c.runtime_files,44);assert.equal(c.static_files,30);assert.equal(c.files.length,74);
 assert.equal(new Set(c.files.map(r=>r.name)).size,74,'RELEASE_DUPLICATE_SOURCE');
 assert.deepEqual(c.metadata,{project_id:'cttfzgvhiewfckydcrci',name:'vnext-daily-research-v1',entrypoint_path:'supabase/functions/vnext-daily-research-v1/index.ts',verify_jwt:true});
 assert.deepEqual(c.files.filter(r=>r.source==='APPROVED_HISTORICAL_LOGIC').map(r=>r.name).sort(),[...HISTORICAL_LOGIC].sort());
 exactKeys(c.recovery,['payload_sha256','payload_bytes','overrides','meaning']);
 assert.equal(c.recovery.meaning,'FUNCTIONAL_FIXED_SDK_RECOVERY_NOT_ORIGINAL29_OR_ESZIP_BIT_IDENTICAL');
 assert.deepEqual(c.recovery.overrides.map(r=>r.name),RECOVERY_LOGIC);
 for(const r of c.recovery.overrides){exactKeys(r,['name','sha256','bytes']);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert(Number.isInteger(r.bytes)&&r.bytes>0);}
 for(const r of c.files){
  exactKeys(r,r.source==='APPROVED_HISTORICAL_LOGIC'?['name','sha256','bytes','source','preserved_current_sha256','preserved_current_bytes']:['name','sha256','bytes','source']);
  assert(['APPROVED_HISTORICAL_LOGIC','CURRENT_REPOSITORY'].includes(r.source));
  assert.match(r.sha256,/^[a-f0-9]{64}$/);assert(Number.isInteger(r.bytes)&&r.bytes>0);
 }
 return c;
}

function historicalSource(name){
 assert([...HISTORICAL_LOGIC,...RECOVERY_LOGIC].includes(name),'RELEASE_UNAPPROVED_HISTORY');
 return execFileSync('git',['--no-replace-objects','show',APPROVED_LOGIC_COMMIT+':'+name],{cwd:repository,env:gitEnv,maxBuffer:8*1024*1024});
}

// Optional readers are test seams only. The CLI always uses physical reads and
// this exact Git object. Each fresh call checks every source and the catalog.
export function assembleRelease(variant='repair',{readCurrent=regularSource,readHistorical=historicalSource}={}){
 variantName(variant);
 const c=readReleaseCatalog();
 const overrides=new Map(variant==='recovery'?c.recovery.overrides.map(r=>[r.name,r]):[]);
 const files=c.files.map(row=>{
  const current=Buffer.from(readCurrent(row.name));
  if(row.source==='APPROVED_HISTORICAL_LOGIC'){
   assert.equal(current.length,row.preserved_current_bytes,'RELEASE_CURRENT_GLOBAL_SIZE:'+row.name);
   assert.equal(digest(current),row.preserved_current_sha256,'RELEASE_CURRENT_GLOBAL_DRIFT:'+row.name);
  }else{
   assert.equal(current.length,row.bytes,'RELEASE_CURRENT_SOURCE_SIZE:'+row.name);
   assert.equal(digest(current),row.sha256,'RELEASE_CURRENT_SOURCE_DRIFT:'+row.name);
  }
  const selected=overrides.get(row.name)??row;
  const bytes=row.source==='APPROVED_HISTORICAL_LOGIC'||overrides.has(row.name)?Buffer.from(readHistorical(row.name)):current;
  assert.equal(bytes.length,selected.bytes,'RELEASE_SOURCE_SIZE:'+row.name);
  assert.equal(digest(bytes),selected.sha256,'RELEASE_SOURCE_DRIFT:'+row.name);
  const content=bytes.toString('utf8');assert(bytes.equals(Buffer.from(content,'utf8')),'RELEASE_INVALID_UTF8:'+row.name);
  return {name:row.name,content};
 });
 const payload={...c.metadata,files},bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n');
 const expected=variant==='recovery'?c.recovery:c;
 assert.equal(bytes.length,expected.payload_bytes,'RELEASE_PAYLOAD_SIZE');
 assert.equal(digest(bytes),expected.payload_sha256,'RELEASE_PAYLOAD_DRIFT');
 return {payload,bytes,sha256:digest(bytes)};
}

export function writeRelease(variant='repair'){
 variantName(variant);const result=assembleRelease(variant);
 const output=variant==='recovery'?RECOVERY_OUTPUT:RELEASE_OUTPUT;
 // This one fixed ignored destination cannot overwrite an earlier artifact.
 for(const name of ['build','build/c-worker-local-sdk-release-20261019-r2']){
  const path=resolve(repository,name);
  try{const stat=lstatSync(path);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'RELEASE_OUTPUT_DIRECTORY');}
  catch(error){if(error.code!=='ENOENT')throw error;mkdirSync(path,{mode:0o700});}
 }
 assert.equal(execFileSync('git',['check-ignore','--',output],{cwd:repository,env:gitEnv,encoding:'utf8'}).trim(),output,'RELEASE_OUTPUT_NOT_IGNORED');
 writeFileSync(resolve(repository,output),result.bytes,{flag:'wx',mode:0o600});
 return {status:'MATERIALIZED_NOT_DEPLOYED',variant,file:output,files:74,sha256:result.sha256,bytes:result.bytes.length,network_requests:0,production_changed:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 assert(process.argv.length<=3,'RELEASE_NO_ARGUMENTS');
 console.info(JSON.stringify(writeRelease(process.argv[2]??'repair')));
}
