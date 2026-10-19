// Offline packaging only. No deploy, Provider, network or mutable Git reference.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve,dirname,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const directory='scripts/operations/owner-quarter-live-release-20261019/';
export const RELEASE_CATALOG=directory+'release-catalog.json';
export const RELEASE_CATALOG_SHA256='7d24db0bf2ae516c5bb6d6559128d778383feae77f9ad71c98d15672c2e2034c';
export const VARIANTS=Object.freeze(['producer','producer-recovery','reader','reader-recovery']);
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const hash=value=>createHash('sha256').update(value).digest('hex');
function physical(name){
 assert.equal(posix.normalize(name),name,'QUARTER_CANONICAL_SOURCE');assert(!name.startsWith('/')&&!name.split('/').includes('..'),'QUARTER_SOURCE_PATH');
 const parts=name.split('/');let target=root;for(let i=0;i<parts.length;i++){target=resolve(target,parts[i]);const s=lstatSync(target);assert(!s.isSymbolicLink(),'QUARTER_SOURCE_SYMLINK');assert(i===parts.length-1?s.isFile():s.isDirectory(),'QUARTER_SOURCE_TYPE');}
 return readFileSync(target);
}
function match(bytes,row,label){assert.equal(bytes.length,row.bytes,label+'_SIZE:'+row.name);assert.equal(hash(bytes),row.sha256,label+'_DRIFT:'+row.name);return bytes;}
function text(bytes){const value=bytes.toString('utf8');assert(Buffer.from(value).equals(bytes),'QUARTER_UTF8_SOURCE');return value;}
export function readReleaseCatalog(){
 const bytes=physical(RELEASE_CATALOG);assert.equal(hash(bytes),RELEASE_CATALOG_SHA256,'QUARTER_CATALOG_DRIFT');
 const c=JSON.parse(bytes);assert.equal(c.schema,'OWNER_QUARTER_ACTUAL15_READER56_RELEASE_V1');
 assert.equal(c.repository_base,'bd941dc3ead8eb66eeaf2b21ca13acf1c90f98e4');assert.equal(c.production_authorized,false);
 assert.deepEqual(Object.keys(c.variants),VARIANTS);return c;
}
function baselineArchive(c,read,producer=false){
 const archive=producer?c.producer_archive:c.reader_archive,rows=producer?c.producer_baseline:c.reader_baseline,count=producer?20:50;
 const compressed=match(Buffer.from(read(archive.name)),archive,'QUARTER_BASELINE_ARCHIVE');
 const bytes=gunzipSync(compressed,{maxOutputLength:archive.uncompressed_bytes});
 assert.equal(bytes.length,archive.uncompressed_bytes);assert.equal(hash(bytes),archive.uncompressed_sha256);
 const files=JSON.parse(text(bytes));assert.equal(files.length,count);assert.equal(new Set(files.map(f=>f.name)).size,count);
 const expected=new Map(rows.map(row=>[row.name,row]));
 for(const f of files){assert.deepEqual(Object.keys(f).sort(),['content','name']);assert(expected.has(f.name),'QUARTER_BASELINE_EXTRA');match(Buffer.from(f.content),expected.get(f.name),'QUARTER_BASELINE_SOURCE');}
 return files;
}
function typeArchive(c,read,plan){
 const compressed=match(Buffer.from(read(c.type_archive.name)),c.type_archive,'QUARTER_TYPE_ARCHIVE');
 const bytes=gunzipSync(compressed,{maxOutputLength:c.type_archive.uncompressed_bytes});
 assert.equal(bytes.length,c.type_archive.uncompressed_bytes);assert.equal(hash(bytes),c.type_archive.uncompressed_sha256);
 const all=JSON.parse(text(bytes)),wanted=new Map(plan.type_files.map(row=>[row.name,row]));
 assert.equal(new Set(all.map(f=>f.name)).size,all.length,'QUARTER_TYPE_DUPLICATE');
 const files=all.filter(f=>wanted.has(f.name));assert.equal(files.length,wanted.size,'QUARTER_TYPE_MISSING');
 for(const f of files){assert(['type_only','static'].includes(f.role),'QUARTER_TYPE_ROLE');match(Buffer.from(f.content),wanted.get(f.name),'QUARTER_TYPE_SOURCE');}
 assert.deepEqual(files.map(f=>f.name),plan.type_files.map(f=>f.name),'QUARTER_TYPE_ORDER');
 return files.map(({name,content})=>({name,content}));
}
function immutable(name){
 return execFileSync('git',['--no-replace-objects','show','5f33777836778e3600e4e377fcb3cf4de690fe80:'+name],{cwd:root,env:gitEnv,maxBuffer:1024*1024});
}
function applyEdits(source,edits){
 for(const edit of edits){assert.deepEqual(Object.keys(edit).sort(),['new','old']);assert(edit.old.length>0&&edit.new.length>0);
  assert.equal(source.split(edit.old).length,2,'QUARTER_EXACT_EDIT_CONTEXT');source=source.replace(edit.old,edit.new);}
 return source;
}
/** Optional ports are negative-test seams. CLI has only fixed physical paths,
 * a fixed Git object and four named artifacts; missing bytes never fetch. */
export function assembleRelease(variant='producer',{readCurrent=physical,readHistorical=immutable}={}){
 assert(VARIANTS.includes(variant),'QUARTER_FIXED_VARIANT');const c=readReleaseCatalog(),plan=c.variants[variant];
 for(const row of c.preserved_global_sources)match(Buffer.from(readCurrent(row.name)),row,'QUARTER_CURRENT_GLOBAL');
 for(const row of c.baseline_catalogs)match(Buffer.from(readCurrent(row.name)),row,'QUARTER_BASELINE_PROVENANCE');
 const edits=JSON.parse(text(match(Buffer.from(readCurrent(c.entry_edits.name)),c.entry_edits,'QUARTER_ENTRY_EDITS')));
 assert.equal(edits.schema,'OWNER_QUARTER_FIXED_ENTRY_EDITS_V1');
 const original=variant.startsWith('producer')?c.producer_baseline.map(row=>({name:row.name,content:text(match(Buffer.from(readHistorical(row.name)),row,'QUARTER_IMMUTABLE_SOURCE'))})):baselineArchive(c,readCurrent);
 if(variant.startsWith('producer'))assert.deepEqual(original,baselineArchive(c,readCurrent,true),'QUARTER_PRODUCER_ARCHIVE_GIT_IDENTITY');
 const files=original.map(f=>f.name===plan.metadata.entrypoint_path?{...f,content:applyEdits(f.content,edits[variant])}:f);
 for(const row of plan.additional_sources)files.push({name:row.name,content:text(match(Buffer.from(readCurrent(row.name)),row,'QUARTER_CURRENT_SOURCE'))});
 files.push(...typeArchive(c,readCurrent,plan));
 assert.equal(files.length,plan.files.length);assert.equal(new Set(files.map(f=>f.name)).size,files.length,'QUARTER_DUPLICATE_SOURCE');
 for(let i=0;i<files.length;i++){assert.equal(files[i].name,plan.files[i].name);match(Buffer.from(files[i].content),plan.files[i],'QUARTER_OUTPUT_SOURCE');}
 const payload={...plan.metadata,files};assert(!Object.hasOwn(payload,'import_map_path'));
 const bytes=Buffer.from(JSON.stringify(payload,null,2)+'\n');match(bytes,{name:variant,sha256:plan.payload_sha256,bytes:plan.payload_bytes},'QUARTER_PAYLOAD');
 // Catalog and all current inputs remain freshly checked on every invocation.
 assert.equal(hash(physical(RELEASE_CATALOG)),RELEASE_CATALOG_SHA256,'QUARTER_CATALOG_CHANGED');
 return {payload,bytes,sha256:hash(bytes)};
}
export function writeRelease(variant='producer'){
 assert(VARIANTS.includes(variant),'QUARTER_FIXED_VARIANT');const result=assembleRelease(variant);
 for(const name of ['build','build/owner-quarter-live-release-20261019']){
  const target=resolve(root,name);try{const s=lstatSync(target);assert(s.isDirectory()&&!s.isSymbolicLink(),'QUARTER_OUTPUT_DIRECTORY');}
  catch(error){if(error.code!=='ENOENT')throw error;mkdirSync(target,{mode:0o700});}}
 const output='build/owner-quarter-live-release-20261019/'+variant+'-deploy-args.json';
 assert.equal(execFileSync('git',['check-ignore','--',output],{cwd:root,env:gitEnv,encoding:'utf8'}).trim(),output);
 writeFileSync(resolve(root,output),result.bytes,{flag:'wx',mode:0o600});
 return {status:'MATERIALIZED_SOURCE_ONLY_NOT_DEPLOYED',variant,file:output,files:result.payload.files.length,sha256:result.sha256,bytes:result.bytes.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert(process.argv.length<=3,'QUARTER_NO_ARGUMENTS');console.info(JSON.stringify(writeRelease(process.argv[2]??'producer')));}
