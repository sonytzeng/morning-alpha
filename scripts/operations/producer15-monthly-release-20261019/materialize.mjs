// Fixed offline delivery artifact only. Never replaces the main Producer source.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {resolve,dirname,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const RELEASE_CATALOG='scripts/operations/producer15-monthly-release-20261019/release-catalog.json';
export const RELEASE_CATALOG_SHA256='8f2d0a6c7ed0f9f203d2a446f0e617fd77439808602a9fd1f561407e43ee0227';
export const VARIANTS=Object.freeze(['candidate','recovery']);
const hash=b=>createHash('sha256').update(b).digest('hex');
const gitEnv={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
function canonical(name){assert.equal(posix.normalize(name),name,'PRODUCER_DELIVERY_PATH');assert(!name.startsWith('/')&&!name.split('/').includes('..'),'PRODUCER_DELIVERY_PATH');}
function physical(name){
 canonical(name);let target=root;const parts=name.split('/');
 for(let i=0;i<parts.length;i++){target=resolve(target,parts[i]);const s=lstatSync(target);assert(!s.isSymbolicLink(),'PRODUCER_DELIVERY_SYMLINK');assert(i===parts.length-1?s.isFile():s.isDirectory(),'PRODUCER_DELIVERY_FILE_TYPE');}
 return readFileSync(target);
}
function text(bytes){const value=Buffer.from(bytes).toString('utf8');assert(Buffer.from(value).equals(Buffer.from(bytes)),'PRODUCER_DELIVERY_UTF8');return value;}
function match(bytes,row,label){assert.equal(bytes.length,row.bytes,label+'_SIZE:'+row.name);assert.equal(hash(bytes),row.sha256,label+'_DRIFT:'+row.name);return bytes;}
function exactKeys(value,keys,label){assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),label);}
function originalType(name){return execFileSync('git',['--no-replace-objects','show','5f33777836778e3600e4e377fcb3cf4de690fe80:'+name],{cwd:root,env:gitEnv,maxBuffer:1024*1024});}
function edit(source,edits){
 for(const e of edits){exactKeys(e,['old','new'],'PRODUCER_DELIVERY_EDIT');assert(e.old.length&&e.new.length);assert.equal(source.split(e.old).length,2,'PRODUCER_DELIVERY_EDIT_CONTEXT');source=source.replace(e.old,e.new);}
 return source;
}
export function readReleaseCatalog(read=physical){
 const bytes=Buffer.from(read(RELEASE_CATALOG));assert.equal(hash(bytes),RELEASE_CATALOG_SHA256,'PRODUCER_DELIVERY_CATALOG_DRIFT');
 const c=JSON.parse(text(bytes));assert.equal(c.schema,'PRODUCER15_MONTHLY_EXACT_DELIVERY_V1');
 assert.equal(c.base_head,'a1f4abb2d73ee6495fc1c212f774c2f2dd627771');assert.equal(c.production_authorized,false);
 exactKeys(c.scope,['sdk_change','current_main_producer_replacement','quarter_capsule','private_capture','source_admission','business_backfill','core_writes','member_rights','auth_rls_cron','line','payment'],'PRODUCER_DELIVERY_SCOPE_KEYS');
 assert(Object.values(c.scope).every(v=>v===false),'PRODUCER_DELIVERY_SCOPE');
 exactKeys(c.metadata,['project_id','name','entrypoint_path','verify_jwt'],'PRODUCER_DELIVERY_METADATA_KEYS');
 assert.equal(c.metadata.project_id,'cttfzgvhiewfckydcrci');assert.equal(c.metadata.name,'recommendation-stock-evidence-v1');
 assert.equal(c.metadata.entrypoint_path,'supabase/functions/recommendation-stock-evidence-v1/index.ts');assert.equal(c.metadata.verify_jwt,true);assert.equal(c.import_map,false);
 assert.deepEqual(Object.keys(c.variants),VARIANTS);return c;
}
/** Optional read ports are negative-test seams, never CLI-selected sources. */
export function assembleRelease(variant='candidate',{readCurrent=physical,readHistorical=originalType}={}){
 assert(VARIANTS.includes(variant),'PRODUCER_DELIVERY_VARIANT');const c=readReleaseCatalog(readCurrent),plan=c.variants[variant];
 const compressed=match(Buffer.from(readCurrent(c.baseline_archive.name)),c.baseline_archive,'PRODUCER_DELIVERY_BASELINE_ARCHIVE');
 const raw=gunzipSync(compressed,{maxOutputLength:c.baseline_archive.uncompressed_bytes});assert.equal(raw.length,c.baseline_archive.uncompressed_bytes);assert.equal(hash(raw),c.baseline_archive.uncompressed_sha256);
 const original=JSON.parse(text(raw));assert.equal(original.length,20);assert.equal(new Set(original.map(f=>f.name)).size,20);
 assert.equal(c.baseline_files.length,20);const expected=new Map(c.baseline_files.map(f=>[f.name,f]));
 for(const f of original){exactKeys(f,['name','content'],'PRODUCER_DELIVERY_BASELINE_ROW');canonical(f.name);assert(expected.has(f.name),'PRODUCER_DELIVERY_BASELINE_EXTRA');match(Buffer.from(f.content),expected.get(f.name),'PRODUCER_DELIVERY_BASELINE_SOURCE');}
 const type=text(match(Buffer.from(readHistorical(c.type_contract.name)),c.type_contract,'PRODUCER_DELIVERY_ORIGINAL_TYPE'));
 const fixedType=edit(type,[c.type_contract.edit]);assert.equal(fixedType.length-type.length,3);assert.equal(hash(Buffer.from(fixedType)),c.type_contract.fixed_sha256);
 const helper=text(match(Buffer.from(readCurrent(c.monthly_helper.name)),c.monthly_helper,'PRODUCER_DELIVERY_MONTHLY_HELPER'));
 const files=original.map(f=>variant==='candidate'&&f.name===c.metadata.entrypoint_path?{...f,content:edit(f.content,c.entry_edits)}:{...f});
 files.push({name:c.type_contract.name,content:fixedType});if(variant==='candidate')files.push({name:c.monthly_helper.name,content:helper});
 assert.equal(files.length,plan.files.length);assert.equal(new Set(files.map(f=>f.name)).size,files.length,'PRODUCER_DELIVERY_DUPLICATE_FILE');
 for(let i=0;i<files.length;i++){assert.equal(files[i].name,plan.files[i].name);match(Buffer.from(files[i].content),plan.files[i],'PRODUCER_DELIVERY_OUTPUT_SOURCE');}
 const originalRollback={...c.metadata,files:[...original,{name:c.type_contract.name,content:type}]};
 assert.equal(hash(Buffer.from(JSON.stringify(originalRollback,null,2)+'\n')),c.original_rollback_payload_sha256,'PRODUCER_DELIVERY_ORIGINAL_ROLLBACK');
 const entry=files.find(f=>f.name===c.metadata.entrypoint_path).content;
 assert(entry.startsWith("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';"),'PRODUCER_DELIVERY_FIXED_SDK');
 const payload={...c.metadata,files},bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n');
 assert.equal(bytes.length,plan.payload_bytes);assert.equal(hash(bytes),plan.payload_sha256,'PRODUCER_DELIVERY_PAYLOAD');
 return {payload,bytes,sha256:hash(bytes),originalRollback};
}
function directory(name){
 canonical(name);let at=root;for(const part of name.split('/')){at=resolve(at,part);try{const s=lstatSync(at);assert(s.isDirectory()&&!s.isSymbolicLink(),'PRODUCER_DELIVERY_OUTPUT_DIRECTORY');}catch(e){if(e.code!=='ENOENT')throw e;mkdirSync(at,{mode:0o700});}}
}
export function writeRelease(variant='candidate'){
 const result=assembleRelease(variant),base='build/producer15-monthly-release-20261019',output=base+'/'+variant+'-deploy-args.json';
 assert.equal(execFileSync('git',['check-ignore','--',output],{cwd:root,env:gitEnv,encoding:'utf8'}).trim(),output,'PRODUCER_DELIVERY_IGNORED_OUTPUT');
 directory(base+'/'+variant);
 for(const f of result.payload.files){directory(base+'/'+variant+'/'+posix.dirname(f.name));writeFileSync(resolve(root,base,variant,f.name),f.content,{flag:'wx',mode:0o600});}
 writeFileSync(resolve(root,output),result.bytes,{flag:'wx',mode:0o600});
 // Preserve the exact original type bytes/payload separately from the single
 // type-extension repair used by both deployable, runtime-equivalent variants.
 const original=base+'/'+variant+'-original15-rollback.json';writeFileSync(resolve(root,original),JSON.stringify(result.originalRollback,null,2)+'\n',{flag:'wx',mode:0o600});
 return {status:'SOURCE_ONLY_NOT_DEPLOYED',variant,file:output,entrypoint:base+'/'+variant+'/'+result.payload.entrypoint_path,files:result.payload.files.length,sha256:result.sha256};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert(process.argv.length<=3,'PRODUCER_DELIVERY_NO_EXTRA_ARGS');console.info(JSON.stringify(writeRelease(process.argv[2]??'candidate')));}
