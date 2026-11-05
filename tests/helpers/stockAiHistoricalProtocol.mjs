// HISTORICAL PAID PROTOCOL ONLY. This never changes the current zero-paid gate.
// Every application module comes from one fixed pre-hardstop Git closure.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
import {fileURLToPath} from 'node:url';

export const STOCK_AI_PRE_HARDSTOP_REVISION='7c9914dfc704788f2e2c75fe3b492b2b3b222d6b';
export const STOCK_AI_ORIGINAL_SOURCE_WORKER_REVISION='83a7b9c4ae32157c31167daf679a855e307eb1af';
export const STOCK_AI_HARDSTOP_COMMIT='f0d484fbfb09e397454b8d586f04da6a65d5f213';
export const STOCK_AI_HISTORICAL_SCHEME='stock-ai-pre-hardstop:';
export const STOCK_AI_HISTORICAL_MANIFEST_SHA256='fb70ccdc6453c24d620e090b38c54bcfb5d326e0e6542451daaf0c111daa8e62';
export const STOCK_AI_ORIGINAL_SOURCE_MANIFEST_SHA256='e7f92861c103b54aa750e174135c0e9bec4730378482ce478bac7bb5fbd3d68b';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
 GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,env:gitEnv,maxBuffer:4*1024*1024});

/** Pure negative-control seam; no replacement manifest or source can be admitted. */
function checkedManifest(bytes,sourceWorker=false){
 assert.equal(hash(bytes),sourceWorker?STOCK_AI_ORIGINAL_SOURCE_MANIFEST_SHA256:STOCK_AI_HISTORICAL_MANIFEST_SHA256,'STOCK_AI_HISTORY_MANIFEST_HASH');
 const m=JSON.parse(Buffer.from(bytes).toString('utf8'));
 assert.equal(m.schema,sourceWorker?'MORNING_ALPHA_DAILY_STOCK_AI_SOURCE_WORKER_ORIGINAL_PROTOCOL_MANIFEST_V1':'MORNING_ALPHA_DAILY_STOCK_AI_PRE_HARDSTOP_SOURCE_MANIFEST_V1');
 assert.equal(m.revision,sourceWorker?STOCK_AI_ORIGINAL_SOURCE_WORKER_REVISION:STOCK_AI_PRE_HARDSTOP_REVISION);assert.equal(m.hardstop_commit,STOCK_AI_HARDSTOP_COMMIT);
 assert.equal(m.hardstop_parent,STOCK_AI_PRE_HARDSTOP_REVISION);assert.equal(m.historical_only,true);assert.equal(m.current_policy_admission,false);
 const count=sourceWorker?40:52;assert.equal(m.files_count,count);assert.equal(m.files.length,count);assert.equal(new Set(m.files.map(r=>r.path)).size,count);
 for(const row of m.files){assert.equal(row.mode,'100644');assert.match(row.git_blob,/^[a-f0-9]{40}$/);assert.match(row.sha256,/^[a-f0-9]{64}$/);assert(Number.isSafeInteger(row.bytes)&&row.bytes>0);Object.freeze(row);}
 assert(m.allowed_entrypoints.every(p=>m.files.some(row=>row.path===p)));
 Object.freeze(m.files);Object.freeze(m.allowed_entrypoints);Object.freeze(m.allowed_node_builtins);return Object.freeze(m);
}
export const verifyStockAiHistoricalManifestBytes=bytes=>checkedManifest(bytes);
export const verifyStockAiOriginalSourceManifestBytes=bytes=>checkedManifest(bytes,true);
export const stockAiHistoricalManifest=verifyStockAiHistoricalManifestBytes(readFileSync(new URL('../fixtures/daily-stock-ai-pre-hardstop-source-manifest.json',import.meta.url)));
export const stockAiOriginalSourceManifest=verifyStockAiOriginalSourceManifestBytes(readFileSync(new URL('../fixtures/daily-stock-ai-source-worker-83-source-manifest.json',import.meta.url)));
const edition=m=>({manifest:m,rows:new Map(m.files.map(row=>[row.path,row])),gitChecked:false,sources:new Map()});
const preHardstop=edition(stockAiHistoricalManifest),originalSource=edition(stockAiOriginalSourceManifest);
const editions=new Map([[STOCK_AI_PRE_HARDSTOP_REVISION,preHardstop],[STOCK_AI_ORIGINAL_SOURCE_WORKER_REVISION,originalSource]]);
let registered=false;

function verifyGit(history){
 if(history.gitChecked)return;const m=history.manifest;
 for(const commit of [m.revision,STOCK_AI_PRE_HARDSTOP_REVISION,STOCK_AI_HARDSTOP_COMMIT])assert.equal(git(['cat-file','-t',commit]).toString().trim(),'commit','STOCK_AI_HISTORY_COMMIT_TYPE');
 assert.equal(git(['show','--no-patch','--format=%P',STOCK_AI_HARDSTOP_COMMIT]).toString().trim(),STOCK_AI_PRE_HARDSTOP_REVISION,'STOCK_AI_HISTORY_SOLE_PARENT');
 if(history===originalSource){
  assert.equal(git(['show','--no-patch','--format=%P',m.revision]).toString().trim(),m.revision_parent,'STOCK_AI_HISTORY_SOURCE_SOLE_PARENT');
  git(['merge-base','--is-ancestor',m.revision,STOCK_AI_PRE_HARDSTOP_REVISION]);
  for(const revision of [m.revision,STOCK_AI_PRE_HARDSTOP_REVISION]){const fixture=git(['show',revision+':'+m.source_worker_fixture_path]);
   assert.equal(fixture.length,m.source_worker_fixture_bytes,'STOCK_AI_HISTORY_ORIGINAL_FIXTURE_SIZE');assert.equal(hash(fixture),m.source_worker_fixture_sha256,'STOCK_AI_HISTORY_ORIGINAL_FIXTURE_HASH');}
 }
 const tree=new Map(git(['ls-tree','-r',m.revision]).toString().trim().split('\n').map(line=>{
  const [entry,path]=line.split('\t'),[mode,type,blob]=entry.split(' ');return [path,{mode,type,blob}];
 }));
 for(const row of m.files){const entry=tree.get(row.path);assert(entry,'STOCK_AI_HISTORY_TREE_PATH');
  assert.equal(entry.mode,row.mode,'STOCK_AI_HISTORY_GIT_MODE');assert.equal(entry.type,'blob','STOCK_AI_HISTORY_BLOB_TYPE');assert.equal(entry.blob,row.git_blob,'STOCK_AI_HISTORY_GIT_BLOB');}
 history.gitChecked=true;
}
export const verifyStockAiHistoricalGit=()=>verifyGit(preHardstop);
export const verifyStockAiOriginalSourceGit=()=>verifyGit(originalSource);
/** Exact path/bytes/mode/blob checks also serve mutation tests without disk edits. */
function verifySource(history,path,bytes,mode,blob){
 const row=history.rows.get(path);assert(row,'STOCK_AI_HISTORY_UNKNOWN_PATH');
 assert.equal(mode,row.mode,'STOCK_AI_HISTORY_SOURCE_MODE');assert.equal(blob,row.git_blob,'STOCK_AI_HISTORY_SOURCE_BLOB');
 const captured=Buffer.from(bytes);assert.equal(captured.length,row.bytes,'STOCK_AI_HISTORY_SOURCE_SIZE');assert.equal(hash(captured),row.sha256,'STOCK_AI_HISTORY_SOURCE_HASH');
 const actualBlob=createHash('sha1').update(Buffer.from('blob '+captured.length+'\0')).update(captured).digest('hex');
 assert.equal(actualBlob,row.git_blob,'STOCK_AI_HISTORY_SOURCE_GIT_HASH');return captured;
}
export const verifyStockAiHistoricalSource=(...args)=>verifySource(preHardstop,...args);
export const verifyStockAiOriginalSource=(...args)=>verifySource(originalSource,...args);
function readSource(history,path){
 assert(history.rows.has(path),'STOCK_AI_HISTORY_UNKNOWN_PATH');verifyGit(history);
 if(!history.sources.has(path)){const row=history.rows.get(path);assert.equal(git(['cat-file','-t',row.git_blob]).toString().trim(),'blob','STOCK_AI_HISTORY_BLOB_TYPE');
  history.sources.set(path,verifySource(history,path,git(['cat-file','blob',row.git_blob]),row.mode,row.git_blob));}
 return Buffer.from(history.sources.get(path));
}
export const readStockAiHistoricalSource=path=>readSource(preHardstop,path);
export const readStockAiOriginalSource=path=>readSource(originalSource,path);
function sourceUrl(history,path){
 assert(history.rows.has(path),'STOCK_AI_HISTORY_UNKNOWN_PATH');return STOCK_AI_HISTORICAL_SCHEME+'//'+history.manifest.revision+'/'+path;
}
export const stockAiHistoricalUrl=path=>sourceUrl(preHardstop,path);
function scopedUrl(url){
 const value=new URL(url);assert.equal(value.protocol,STOCK_AI_HISTORICAL_SCHEME,'STOCK_AI_HISTORY_SCHEME');
 const history=editions.get(value.hostname);assert(history,'STOCK_AI_HISTORY_REVISION');
 assert(!value.username&&!value.password&&!value.port&&!value.search&&!value.hash,'STOCK_AI_HISTORY_URL_SCOPE');
 const path=value.pathname.slice(1);assert.equal(decodeURIComponent(path),path,'STOCK_AI_HISTORY_PATH_ENCODING');assert(history.rows.has(path),'STOCK_AI_HISTORY_UNKNOWN_PATH');return {history,path};
}
export const stockAiHistoricalPath=url=>scopedUrl(url).path;
export const normalizeStockAiHistoricalUrl=url=>{const {history,path}=scopedUrl(url);return sourceUrl(history,path);};
export const readStockAiHistoricalUrl=url=>{const {history,path}=scopedUrl(url);return readSource(history,path);};
export const stockAiHistoricalBuiltinAllowed=(url,specifier)=>scopedUrl(url).history.manifest.allowed_node_builtins.includes(specifier);
export const stockAiHistoricalEntryAllowed=url=>{const {history,path}=scopedUrl(url);return history.manifest.allowed_entrypoints.includes(path);};
async function importModule(history,path){
 assert(history.manifest.allowed_entrypoints.includes(path),'STOCK_AI_HISTORY_ENTRYPOINT');verifyGit(history);
 if(!registered){register(new URL('./stockAiHistoricalLoaderHook.mjs',import.meta.url));registered=true;}
 return import(sourceUrl(history,path));
}
export async function importStockAiHistoricalModule(path){
 assert.equal(arguments.length,1,'STOCK_AI_HISTORY_NO_CUSTOM_REVISION_OR_READER');return importModule(preHardstop,path);
}
/** Older SOURCE fixture only; no generic caller-selected historical revision. */
export async function importStockAiOriginalSourceWorkerModule(path){
 assert.equal(arguments.length,1,'STOCK_AI_HISTORY_NO_CUSTOM_REVISION_OR_READER');return importModule(originalSource,path);
}
export function historicalStockAiProtocolTest(name,...args){
 return test('[HISTORICAL PAID PROTOCOL '+STOCK_AI_PRE_HARDSTOP_REVISION+'] '+name,...args);
}
export function historicalStockAiOriginalSourceWorkerTest(name,...args){
 return test('[HISTORICAL SOURCE PROTOCOL '+STOCK_AI_ORIGINAL_SOURCE_WORKER_REVISION+'] '+name,...args);
}
