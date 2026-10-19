// Offline exact-source packaging only. No HTTP, deployment or database port.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const BASE='fda6d637ebf35ce545a31ddba3ad2e2b4724e7a8';
export const CHANGED='src/features/vnext/dailyAdapter.ts';
export const CATALOG='scripts/operations/cold-source-priority-20261019/release-catalog.json';
export const CATALOG_SHA256='c3d403fae93ce37f1394d4bcd63af0f59e662a03ef79c53f562da8cf183b354b';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const env=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const physical=name=>{
 assert.equal(posix.normalize(name),name);assert(!name.startsWith('/')&&!name.split('/').includes('..'));
 let path=root;for(const [i,part] of name.split('/').entries()){path=resolve(path,part);const stat=lstatSync(path);assert(!stat.isSymbolicLink());assert(i===name.split('/').length-1?stat.isFile():stat.isDirectory());}
 return readFileSync(path);
};
export function catalog(){
 const bytes=physical(CATALOG);assert.equal(sha(bytes),CATALOG_SHA256,'COLD_CATALOG_DRIFT');
 const c=JSON.parse(bytes);assert.equal(c.schema,'C_COLD_SOURCE_ORDER_RELEASE_V1');assert.equal(c.base,BASE);
 assert.equal(c.production_authorized,false);assert.equal(c.files.length,78);assert.equal(new Set(c.files.map(r=>r.name)).size,78);
 assert.equal(c.baseline.version,3);assert.equal(c.baseline.sdk,'2.57.4');assert.equal(c.baseline.source_files_verified,44);
 assert.deepEqual(c.files.filter(r=>!r.static&&r.before_sha256!==r.after_sha256).map(r=>r.name),[CHANGED]);
 assert.equal(c.files.filter(r=>!r.static).length,44);
 return c;
}
const historical=row=>execFileSync('git',['--no-replace-objects','show',row.base_ref+':'+row.name],{cwd:root,env,stdio:['ignore','pipe','pipe'],maxBuffer:8e6});
export function assemble(variant='candidate',read=physical){
 assert(['candidate','recovery'].includes(variant),'COLD_FIXED_VARIANT');const c=catalog();
 const files=c.files.map(row=>{
  assert.equal(posix.normalize(row.name),row.name);assert(!row.name.startsWith('/')&&!row.name.split('/').includes('..'));
  assert([BASE,'5f33777836778e3600e4e377fcb3cf4de690fe80'].includes(row.base_ref));
  const original=historical(row);assert.equal(original.length,row.before_bytes,'COLD_BASE_SIZE');assert.equal(sha(original),row.before_sha256,'COLD_BASE_DRIFT');
  // Always validate the current changed source, even for the rollback variant.
  // Never silently replace mutated consumer bytes with a good historical blob.
  let checked=original;
  for(const [before,after] of row.edits??[]){assert.equal(checked.toString().split(before).length,2,'COLD_TYPE_EDIT');checked=Buffer.from(checked.toString().replace(before,after));}
  const current=row.name===CHANGED?Buffer.from(read(row.name)):checked;
  assert.equal(current.length,row.after_bytes,'COLD_CURRENT_SIZE');assert.equal(sha(current),row.after_sha256,'COLD_CURRENT_DRIFT');
  const bytes=variant==='recovery'&&row.name===CHANGED?original:current,content=bytes.toString('utf8');assert(bytes.equals(Buffer.from(content)),'COLD_UTF8');
  return {name:row.name,content};
 });
 const payload={...c.metadata,files},bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n');
 assert.equal(bytes.length,c.payloads[variant].bytes,'COLD_PAYLOAD_SIZE');assert.equal(sha(bytes),c.payloads[variant].sha256,'COLD_PAYLOAD_DRIFT');
 return {payload,bytes,sha256:sha(bytes)};
}
export function materialize(variant='candidate'){
 const result=assemble(variant),relative='build/cold-source-priority-20261019-r2/'+variant;
 assert.equal(execFileSync('git',['check-ignore','--',relative+'/deploy-args.json'],{cwd:root,env,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim(),relative+'/deploy-args.json');
 const output=resolve(root,relative);mkdirSync(output,{recursive:true,mode:0o700});assert(!lstatSync(output).isSymbolicLink());
 for(const file of result.payload.files){const target=resolve(output,file.name);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,file.content,{flag:'wx',mode:0o600});}
 writeFileSync(resolve(output,'deploy-args.json'),result.bytes,{flag:'wx',mode:0o600});
 return {status:'MATERIALIZED_NOT_DEPLOYED',variant,sha256:result.sha256,files:78,runtime_files:44,production_changed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert(process.argv.length<=3);console.log(JSON.stringify(materialize(process.argv[2]??'candidate')));}
