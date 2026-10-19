// Frontend source/package admission plus one exact legacy contract view only.
// No deployment permission, runtime write or backend source change is granted.
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyIntegrationCandidate,integrationInventory,integrationPhysicalMode} from './integrationAdmission.mjs';
import {memberContinuityWebsiteOperations} from './memberContinuityAdmission.mjs';
import {verifyOwnerStatusCopy,ownerStatusCopyHistoricalRead,ownerStatusCopyHistoricalReader} from './ownerStatusCopyAdmission.mjs';

export const FRONTEND_TYPE_CLOSURE_BASE='588e83f3012a31469d5c58b6874ec49c98a2e4b9';
export const FRONTEND_TYPE_CLOSURE_MANIFEST='docs/operations/evidence/frontend-type-closure-20261018.json';
export const FRONTEND_TYPE_CLOSURE_CONSUMERS=Object.freeze([
 'src/features/decision-v1/contract.ts',
 'src/features/research/cockpit.ts',
 'src/features/research/tradingLab.ts',
 'src/pages/admin/analysis/EntryOpportunity.tsx',
 'src/pages/admin/analysis/OwnerCockpit.tsx',
]);
export const FRONTEND_TYPE_CLOSURE_DTO='src/types/research-source-contracts.ts';
export const FRONTEND_TYPE_CLOSURE_SOURCES=Object.freeze([...FRONTEND_TYPE_CLOSURE_CONSUMERS,FRONTEND_TYPE_CLOSURE_DTO].sort());
const HISTORICAL_CONTRACT='src/features/decision-v1/contract.ts';
const HISTORICAL_CONTRACT_BEFORE='26f4b8efed797c86616614bdc63136619b5f3112cc0dad9b66bf6c650cfc3715';
// These are the exact captured Readdy preimages, including their actual EOF.
// TradingLab has one fewer final LF than Git; source lineage and UI recovery
// therefore have separate explicitly pinned facts. Never normalize either.
export const FRONTEND_TYPE_CLOSURE_LIVE_BEFORE=Object.freeze({
 'src/features/decision-v1/contract.ts':'26f4b8efed797c86616614bdc63136619b5f3112cc0dad9b66bf6c650cfc3715',
 'src/features/research/cockpit.ts':'1e18dab897e2b56ee434dc31c1d2e6cf4e93a0988cdf82f68e07e4ec2804e961',
 'src/features/research/tradingLab.ts':'5da4512226097294ca891fb55621a5656679ec5439d93610fae287a421f8fec3',
 'src/pages/admin/analysis/EntryOpportunity.tsx':'fa778b147cfeb578f400e0a28075a771f8b88f9f80c7dab0f5fd75e3206d99d0',
 'src/pages/admin/analysis/OwnerCockpit.tsx':'68637a4827c5d13b0216d46191ac516c5bdf6e4eebd6b7141718b857c2cc7020',
});
export const FRONTEND_TYPE_CLOSURE_REMOVED=Object.freeze([
 'research/entry-opportunity.ts',
 'supabase/functions/_shared/market-calendar-data.json',
 'supabase/functions/_shared/market-session-contract.mjs',
 'supabase/functions/_shared/owner-trading-lab.ts',
 'supabase/functions/_shared/recommendation-phase.ts',
 'supabase/functions/_shared/txf-session-contract.mjs',
]);
const PREDECESSOR='docs/operations/evidence/member-continuity-20261018.json';
const PREDECESSOR_HASH='065eee16dff4fcb7562dd2250ac58d71220b6faec2b1585c695490991cd90952';
const TYPE_EQUIVALENCE=Object.freeze({fixture_path:'tests/researchSourceContracts.types.ts',runner_path:'tests/researchSourceContracts.test.mjs'});
const FLAGS=Object.freeze(['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled']);
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,env:gitEnv,maxBuffer:1024*1024});
function sameStat(before,after){
 for(const key of ['dev','ino','mode','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key],'FRONTEND_TYPE_CHANGED_DURING_READ');
}
function physical(path){
 const target=resolve(root,path);assert.equal(relative(root,target),path,'FRONTEND_TYPE_PATH');
 for(let parent=dirname(target);parent!==resolve(root);parent=dirname(parent)){
  const stat=lstatSync(parent);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'FRONTEND_TYPE_REGULAR_PARENT');
 }
 const before=lstatSync(target,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink(),'FRONTEND_TYPE_REGULAR_FILE');
 const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  sameStat(before,fstatSync(fd,{bigint:true}));const bytes=readFileSync(fd);
  sameStat(before,fstatSync(fd,{bigint:true}));sameStat(before,lstatSync(target,{bigint:true}));
  return {bytes,mode:before.mode&0o111n?'100755':'100644'};
 }finally{closeSync(fd);}
}
const physicalRead=path=>physical(path).bytes;
// Only immutable predecessor facts are cached. Current bytes, modes, receipts
// and full-tree admission are checked anew for every public invocation.
const predecessorFacts=new Map();
function before(path){
 if(!predecessorFacts.has(path)){
  const rows=git(['ls-tree','-z',FRONTEND_TYPE_CLOSURE_BASE,'--',path]).toString().split('\0').filter(Boolean);
  if(path===FRONTEND_TYPE_CLOSURE_DTO){assert.equal(rows.length,0,'FRONTEND_TYPE_DTO_PREEXISTS');predecessorFacts.set(path,null);}
  else{
   assert.equal(rows.length,1);const [metadata,name]=rows[0].split('\t'),[mode,type,oid]=metadata.split(' ');
   assert.equal(name,path);assert.equal(mode,'100644');assert.equal(type,'blob');assert.match(oid,/^[a-f0-9]{40}$/);
   predecessorFacts.set(path,hash(git(['cat-file','blob',oid])));
  }
 }
 return predecessorFacts.get(path);
}
function receipt(read=physicalRead){
 const bytes=Buffer.from(read(FRONTEND_TYPE_CLOSURE_MANIFEST)),manifest=JSON.parse(bytes);
 assert.deepEqual(Object.keys(manifest).sort(),['schema','base','files','website','type_equivalence',...FLAGS].sort(),'FRONTEND_TYPE_KEYS');
 assert.equal(manifest.schema,'MORNING_ALPHA_FRONTEND_TYPE_CLOSURE_V1');assert.equal(manifest.base,FRONTEND_TYPE_CLOSURE_BASE);
 for(const flag of FLAGS)assert.equal(manifest[flag],false,'FRONTEND_TYPE_FORBIDDEN:'+flag);
 assert.deepEqual(manifest.files.map(row=>row.path),FRONTEND_TYPE_CLOSURE_SOURCES,'FRONTEND_TYPE_EXACT_SOURCES');
 for(const row of manifest.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256','mode'].sort(),'FRONTEND_TYPE_SOURCE_KEYS');
  assert.equal(row.mode,'100644');assert.equal(row.before_sha256,before(row.path),'FRONTEND_TYPE_PREDECESSOR:'+row.path);
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);
 }
 assert.deepEqual(manifest.type_equivalence,TYPE_EQUIVALENCE,'FRONTEND_TYPE_EXACT_EQUIVALENCE');
 return {bytes,manifest};
}
function expectedWebsite(manifest,read,mode,physicalView=physical){
 const old=memberContinuityWebsiteOperations();
 assert.equal(old.length,24);assert.equal(new Set(old.map(row=>row.path)).size,24);
 assert.deepEqual(old.filter(row=>!row.path.startsWith('src/')).map(row=>row.path).sort(),FRONTEND_TYPE_CLOSURE_REMOVED);
 const operations=old.filter(row=>row.path.startsWith('src/'));
 assert.equal(operations.length,18);
 for(const row of manifest.files){
  const bytes=read(row.path);
  assert.equal(hash(bytes),row.after_sha256,'FRONTEND_TYPE_SOURCE:'+row.path);
  assert.equal(mode(row.path),row.mode,'FRONTEND_TYPE_MODE:'+row.path);
  // Check the actual physical file independently of an injected consumer view.
  const actual=physicalView(row.path);assert.equal(actual.mode,row.mode,'FRONTEND_TYPE_PHYSICAL_MODE:'+row.path);
  assert.equal(hash(actual.bytes),row.after_sha256,'FRONTEND_TYPE_PHYSICAL_SOURCE:'+row.path);
  operations.push({path:row.path,mode:row.mode,live_before_sha256:row.path===FRONTEND_TYPE_CLOSURE_DTO?null:FRONTEND_TYPE_CLOSURE_LIVE_BEFORE[row.path],target_sha256:row.after_sha256,
   operation:row.path===FRONTEND_TYPE_CLOSURE_DTO?'ADD':'MODIFY',
   classification:row.path===FRONTEND_TYPE_CLOSURE_DTO?'CLIENT_UI_TYPE_CONTRACT_SOURCE':'CLIENT_UI_TYPE_IMPORT_ONLY_SOURCE',
   source_bytes:actual.bytes.length});
 }
 operations.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 assert.equal(operations.length,24);assert.equal(new Set(operations.map(row=>row.path)).size,24);
 assert(operations.every(row=>/^src\/[A-Za-z0-9_./-]+$/.test(row.path)&&!row.path.split('/').includes('..')&&!row.path.includes('.env')),'FRONTEND_TYPE_SRC_ONLY');
 assert.equal(operations.filter(row=>row.operation==='MODIFY').length,13);
 assert.equal(operations.filter(row=>row.operation==='ADD').length,11);
 for(const row of operations){
  const actual=physicalView(row.path);
  assert.equal(actual.mode,row.mode,'FRONTEND_TYPE_WEBSITE_MODE:'+row.path);
  assert.equal(hash(actual.bytes),row.target_sha256,'FRONTEND_TYPE_WEBSITE_SOURCE:'+row.path);
  assert.equal(actual.bytes.length,row.source_bytes,'FRONTEND_TYPE_WEBSITE_SIZE:'+row.path);
 }
 return {predecessor_path:PREDECESSOR,predecessor_sha256:PREDECESSOR_HASH,operation_count:24,
  removed_build_only_paths:[...FRONTEND_TYPE_CLOSURE_REMOVED],operations};
}
/** The current cumulative seal admits every source at entry and exit. The old
 * B24/continuity receipts remain unchanged; this creates a distinct src-only
 * delivery catalogue rather than deleting sources from historical inventories.
 */
export function verifyFrontendTypeClosure(read=physicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyIntegrationCandidate(read,paths,mode);
 const {bytes:seal,manifest}=receipt(read);
 assert.equal(hash(read(PREDECESSOR)),PREDECESSOR_HASH,'FRONTEND_TYPE_CONTINUITY_RECEIPT');
 assert.deepEqual(manifest.website,expectedWebsite(manifest,read,mode),'FRONTEND_TYPE_EXACT_WEBSITE');
 assert.deepEqual(physicalRead(FRONTEND_TYPE_CLOSURE_MANIFEST),seal,'FRONTEND_TYPE_RECEIPT_CHANGED');
 verifyIntegrationCandidate();return structuredClone(manifest);
}
export function frontendTypeClosureWebsiteOperations(){
 const manifest=verifyFrontendTypeClosure();
 return structuredClone(manifest.website.operations);
}

/** Explicit historical B24 view after the separately sealed current copy fix.
 * The original physical verifier above deliberately still rejects the changed
 * Owner source. These exports are for immutable package regressions, never a
 * current website deployment catalogue or permission to publish old sources.
 */
export function verifyHistoricalFrontendTypeClosureForOwnerCopy(read=physicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyOwnerStatusCopy(read,paths,mode);
 const historical=ownerStatusCopyHistoricalReader(read),{bytes:seal,manifest}=receipt(historical);
 assert.equal(hash(historical(PREDECESSOR)),PREDECESSOR_HASH,'FRONTEND_TYPE_CONTINUITY_RECEIPT');
 const view=path=>{const actual=physical(path);return {...actual,bytes:ownerStatusCopyHistoricalRead(path,actual.bytes)};};
 assert.deepEqual(manifest.website,expectedWebsite(manifest,historical,mode,view),'FRONTEND_TYPE_EXACT_WEBSITE');
 assert.deepEqual(physicalRead(FRONTEND_TYPE_CLOSURE_MANIFEST),seal,'FRONTEND_TYPE_RECEIPT_CHANGED');
 verifyOwnerStatusCopy();return structuredClone(manifest);
}
export function historicalFrontendTypeClosureWebsiteOperationsForOwnerCopy(){
 return verifyHistoricalFrontendTypeClosureForOwnerCopy().website.operations;
}

const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const offsetOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const sizeOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength').get;
const setBytes=Uint8Array.prototype.set;
function sourceBytes(value){
 if(typeof value==='string')return Buffer.from(value);
 assert(Buffer.isBuffer(value),'FRONTEND_TYPE_READER_REPRESENTATION');
 const copy=Buffer.alloc(sizeOf.call(value));
 setBytes.call(copy,new Uint8Array(bufferOf.call(value),offsetOf.call(value),sizeOf.call(value)));return copy;
}
let historicalContract;
function historicalContractBytes(){
 if(!historicalContract){
  const bytes=git(['show',FRONTEND_TYPE_CLOSURE_BASE+':'+HISTORICAL_CONTRACT]);
  assert.equal(hash(bytes),HISTORICAL_CONTRACT_BEFORE,'FRONTEND_TYPE_HISTORICAL_CONTRACT');
  historicalContract=Buffer.from(bytes);
 }
 return Buffer.from(historicalContract);
}
function currentContract(row){
 const actual=physical(HISTORICAL_CONTRACT);
 assert.equal(actual.mode,row.mode,'FRONTEND_TYPE_HISTORICAL_MODE');
 assert.equal(hash(actual.bytes),row.after_sha256,'FRONTEND_TYPE_HISTORICAL_SOURCE');
}
/** Only the existing A22 contract binding needs this exact predecessor. The
 * other four consumers are never translated here. Current input must match
 * its freshly admitted physical revision; injected bytes/text/errors survive.
 * No prior successful validation is retained as an admission proof.
 */
export function frontendTypeClosureHistoricalRead(path,value){
 if(path!==HISTORICAL_CONTRACT)return value;
 const {bytes:seal,manifest}=receipt(),row=manifest.files.find(row=>row.path===HISTORICAL_CONTRACT);
 assert.equal(row.before_sha256,HISTORICAL_CONTRACT_BEFORE);
 const bytes=sourceBytes(value);
 if(typeof value==='string'&&bytes.toString('utf8')!==value)return value;
 if(hash(bytes)!==row.after_sha256)return value;
 verifyIntegrationCandidate();
 currentContract(row);const prior=historicalContractBytes();currentContract(row);
 assert.deepEqual(physicalRead(FRONTEND_TYPE_CLOSURE_MANIFEST),seal,'FRONTEND_TYPE_HISTORICAL_RECEIPT_CHANGED');
 verifyIntegrationCandidate();
 return typeof value==='string'?prior.toString('utf8'):prior;
}
export function frontendTypeClosureHistoricalReader(source=physicalRead){
 return (path,...options)=>frontendTypeClosureHistoricalRead(path,source(path,...options));
}
