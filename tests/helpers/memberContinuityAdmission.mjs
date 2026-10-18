// Test/review admission only. Historical translation is limited to two exact
// source revisions; it grants no deployment, Auth, schema or business authority.
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyIntegrationCandidate,integrationInventory,integrationPhysicalMode} from './integrationAdmission.mjs';

export const MEMBER_CONTINUITY_BASE='cb678aeee5601c71f9b943cddff861763effc753';
export const MEMBER_CONTINUITY_MANIFEST='docs/operations/evidence/member-continuity-20261018.json';
const TEST_PATH='tests/vnextMemberContinuity.test.mjs';
const TEST_HASH='b1308678a760b10a64a60db7b5347d3857fbd5810b164b2b5301e40837117de6';
const PREDECESSOR='docs/operations/evidence/r9-functional-source-closure-20261017.json';
const PREDECESSOR_HASH='cc99eba18cd0853fbf4291eda4dfd27d21b7a47179763a3b42b08275907ba375';
export const MEMBER_CONTINUITY_RUNTIME=Object.freeze([
 Object.freeze({path:'src/features/vnext/member.ts',before_sha256:'5fcf87bef6287f8effd15db4431d966751d57bd4be1d6f3dc5bcf2ef86bce28e',after_sha256:'1a147e2aa972a91f50a7afe542986092aa8665fe8ac5589cc5ed5a7ee0ac6690',mode:'100644'}),
 Object.freeze({path:'src/pages/vnext/MemberPage.tsx',before_sha256:'cf1f8a8f94101440628f7ba8b1151887da13045e380cd401514b94c7122f2058',after_sha256:'217f7cde888206908f8f0dca6a7266e3c48f725dd2ba8a4ecd7d703828f5b28b',mode:'100644'}),
]);
const FLAGS=Object.freeze(['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled']);
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,env:gitEnv,maxBuffer:1024*1024});
function sameStat(before,after){
 for(const key of ['dev','ino','mode','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key],'MEMBER_CONTINUITY_CHANGED_DURING_READ');
}
function physical(path){
 const target=resolve(root,path);assert.equal(relative(root,target),path,'MEMBER_CONTINUITY_PATH');
 for(let parent=dirname(target);parent!==resolve(root);parent=dirname(parent)){
  const stat=lstatSync(parent);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'MEMBER_CONTINUITY_REGULAR_PARENT');
 }
 const before=lstatSync(target,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink(),'MEMBER_CONTINUITY_REGULAR_FILE');
 const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  sameStat(before,fstatSync(fd,{bigint:true}));const bytes=readFileSync(fd);
  sameStat(before,fstatSync(fd,{bigint:true}));sameStat(before,lstatSync(target,{bigint:true}));
  return {bytes,mode:before.mode&0o111n?'100755':'100644'};
 }finally{closeSync(fd);}
}
const physicalRead=path=>physical(path).bytes;
function receipt(read=physicalRead){
 const bytes=read(MEMBER_CONTINUITY_MANIFEST),m=JSON.parse(bytes);
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','test','website',...FLAGS].sort(),'MEMBER_CONTINUITY_KEYS');
 assert.equal(m.schema,'MORNING_ALPHA_MEMBER_CONTINUITY_V1');assert.equal(m.base,MEMBER_CONTINUITY_BASE);
 for(const flag of FLAGS)assert.equal(m[flag],false,'MEMBER_CONTINUITY_FORBIDDEN:'+flag);
 assert.deepEqual(m.files,MEMBER_CONTINUITY_RUNTIME,'MEMBER_CONTINUITY_EXACT_RUNTIME');
 assert.deepEqual(m.test,{path:TEST_PATH,sha256:TEST_HASH},'MEMBER_CONTINUITY_EXACT_TEST');
 assert.deepEqual(m.website,{predecessor_path:PREDECESSOR,predecessor_sha256:PREDECESSOR_HASH,operation_count:24},'MEMBER_CONTINUITY_EXACT_WEBSITE');
 return {bytes:Buffer.from(bytes),manifest:m};
}
const predecessorBytes=new Map();
function before(row){
 if(!predecessorBytes.has(row.path)){
  const lines=git(['ls-tree','-z',MEMBER_CONTINUITY_BASE,'--',row.path]).toString().split('\0').filter(Boolean);
  assert.equal(lines.length,1);const [metadata,path]=lines[0].split('\t'),[mode,type,oid]=metadata.split(' ');
  assert.equal(path,row.path);assert.equal(mode,row.mode);assert.equal(type,'blob');assert.match(oid,/^[a-f0-9]{40}$/);
  const bytes=git(['cat-file','blob',oid]);assert.equal(hash(bytes),row.before_sha256,'MEMBER_CONTINUITY_PREDECESSOR_HASH');
  predecessorBytes.set(row.path,Buffer.from(bytes));
 }
 return Buffer.from(predecessorBytes.get(row.path));
}
function actual(row){
 const file=physical(row.path);assert.equal(file.mode,row.mode,'MEMBER_CONTINUITY_MODE:'+row.path);
 assert.equal(hash(file.bytes),row.after_sha256,'MEMBER_CONTINUITY_SOURCE:'+row.path);return file.bytes;
}
/** Public review/package gate: current full-tree physical admission is mandatory
 * at both ends. This function is never called by the historical primitive. */
export function verifyMemberContinuity(read=physicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyIntegrationCandidate(read,paths,mode);
 const {manifest}=receipt(read);
 for(const row of MEMBER_CONTINUITY_RUNTIME){assert.equal(hash(read(row.path)),row.after_sha256,'MEMBER_CONTINUITY_SOURCE:'+row.path);assert.equal(mode(row.path),row.mode);before(row);}
 assert.equal(hash(read(TEST_PATH)),TEST_HASH,'MEMBER_CONTINUITY_TEST_DRIFT');
 assert.equal(hash(read(PREDECESSOR)),PREDECESSOR_HASH,'MEMBER_CONTINUITY_R9_DRIFT');
 verifyIntegrationCandidate();return structuredClone(manifest);
}
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const offsetOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const sizeOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength').get;
const setBytes=Uint8Array.prototype.set;
function sourceBytes(value){
 if(typeof value==='string')return Buffer.from(value);
 assert(Buffer.isBuffer(value),'MEMBER_CONTINUITY_READER_REPRESENTATION');
 const size=sizeOf.call(value),copy=Buffer.alloc(size);
 setBytes.call(copy,new Uint8Array(bufferOf.call(value),offsetOf.call(value),size));return copy;
}
/** Deliberately narrow primitive: only an actual translation runs complete
 * physical admission again, before and after its source/receipt checks. The
 * integration verifier does not import this adapter, so this cannot recurse.
 * An earlier successful admission is never reused as proof. */
export function memberContinuityHistoricalRead(path,value){
 const row=MEMBER_CONTINUITY_RUNTIME.find(row=>row.path===path);if(!row)return value;
 const {bytes:seal}=receipt(),bytes=sourceBytes(value);
 if(typeof value==='string'&&bytes.toString('utf8')!==value)return value;
 if(hash(bytes)!==row.after_sha256)return value;
 verifyIntegrationCandidate();
 actual(row);const prior=before(row);actual(row);
 assert.deepEqual(physicalRead(MEMBER_CONTINUITY_MANIFEST),seal,'MEMBER_CONTINUITY_RECEIPT_CHANGED');
 verifyIntegrationCandidate();
 return typeof value==='string'?prior.toString('utf8'):prior;
}
export function memberContinuityHistoricalReader(source=physicalRead){
 return (path,...options)=>memberContinuityHistoricalRead(path,source(path,...options));
}
/** New candidate inventory, never a rewrite of the immutable old R9 receipt. */
export function memberContinuityWebsiteOperations(){
 verifyMemberContinuity();const {manifest}=receipt();
 const predecessor=physicalRead(PREDECESSOR);assert.equal(hash(predecessor),manifest.website.predecessor_sha256);
 const operations=structuredClone(JSON.parse(predecessor).release.B.operations);
 assert.equal(operations.length,24);assert.equal(new Set(operations.map(row=>row.path)).size,24);
 for(const row of MEMBER_CONTINUITY_RUNTIME){
  const operation=operations.find(operation=>operation.path===row.path);assert(operation);
  assert.equal(operation.target_sha256,row.before_sha256);assert.equal(operation.mode,row.mode);
  const bytes=actual(row);operation.target_sha256=row.after_sha256;operation.source_bytes=bytes.length;
 }
 verifyIntegrationCandidate();return operations;
}
