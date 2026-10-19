// Current source admission and one explicit historical Owner UI view only.
// No runtime request, member policy, source admission or deployment permission.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyIntegrationCandidate,integrationInventory,integrationPhysicalRead,integrationPhysicalMode} from './integrationAdmission.mjs';

export const OWNER_STATUS_COPY_BASE='27875d458eb9321ea45c5175b815c878532e81b6';
export const OWNER_STATUS_COPY_MANIFEST='docs/operations/evidence/owner-status-copy-20261019.json';
export const OWNER_STATUS_COPY_SOURCE='src/pages/admin/analysis/OwnerCockpit.tsx';
const TEST='tests/ownerCockpit.test.mjs';
const BEFORE='d795ce150a851b6e8985858f052cc47b9b896dd7a7cbcb7c0781fef34521baed';
const AFTER='45ce7e4e776b9ffb7250b7603255928f839d8e8bb27c30b11afdc19f383e29fd';
const PREDECESSOR='docs/operations/evidence/frontend-type-closure-20261018.json';
const PREDECESSOR_HASH='56ba246dec7e6bffb840f712483e882a36c3d0bf5266a84d4bc09cae720c0c50';
const FLAGS=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const prior=path=>execFileSync('git',['--no-replace-objects','show',OWNER_STATUS_COPY_BASE+':'+path],{cwd:root,env:gitEnv,maxBuffer:1024*1024});
function physical(path){
 const target=resolve(root,path);assert.equal(relative(root,target),path,'OWNER_COPY_PATH');
 for(let p=dirname(target);p!==root;p=dirname(p)){const stat=lstatSync(p);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'OWNER_COPY_PARENT');}
 const stat=lstatSync(target);assert(stat.isFile()&&!stat.isSymbolicLink(),'OWNER_COPY_REGULAR_FILE');
 return {bytes:readFileSync(target),mode:stat.mode&0o111?'100755':'100644'};
}
export function verifyOwnerStatusCopy(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyIntegrationCandidate(read,paths,mode);
 const bytes=Buffer.from(read(OWNER_STATUS_COPY_MANIFEST)),m=JSON.parse(bytes);
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','predecessor_website','website',...FLAGS].sort());
 assert.equal(m.schema,'MORNING_ALPHA_OWNER_STATUS_COPY_V1');assert.equal(m.base,OWNER_STATUS_COPY_BASE);
 for(const flag of FLAGS)assert.equal(m[flag],false,'OWNER_COPY_FORBIDDEN:'+flag);
 assert.deepEqual(m.files,[
  {path:OWNER_STATUS_COPY_SOURCE,mode:'100644',before_sha256:BEFORE,after_sha256:AFTER},
  {path:TEST,mode:'100644',before_sha256:'b1367752d55f9a88af86a637b0272ec0cae9c5cc53252df8467d6482b470438f',after_sha256:'709d8104a9612def7f4ae1602646bacaaa2a773b4b88fe6598b1c15236702529'},
 ]);
 assert.deepEqual(m.predecessor_website,{path:PREDECESSOR,sha256:PREDECESSOR_HASH,operation_count:24});
 assert.equal(hash(read(PREDECESSOR)),PREDECESSOR_HASH,'OWNER_COPY_PREDECESSOR_RECEIPT');
 assert.deepEqual(readFileSync(resolve(root,PREDECESSOR)),prior(PREDECESSOR),'OWNER_COPY_IMMUTABLE_PREDECESSOR');
 for(const row of m.files){
  assert.equal(hash(prior(row.path)),row.before_sha256,'OWNER_COPY_BEFORE');
  assert.equal(hash(read(row.path)),row.after_sha256,'OWNER_COPY_SOURCE');assert.equal(mode(row.path),row.mode,'OWNER_COPY_MODE');
  const actual=physical(row.path);assert.equal(actual.mode,row.mode,'OWNER_COPY_PHYSICAL_MODE');assert.equal(hash(actual.bytes),row.after_sha256,'OWNER_COPY_PHYSICAL_SOURCE');
 }
 const old=JSON.parse(read(PREDECESSOR)).website.operations;
 assert.equal(old.length,24);assert.equal(new Set(old.map(row=>row.path)).size,24);
 for(const row of old){const actual=physical(row.path);assert.equal(actual.mode,row.mode,'OWNER_COPY_WEBSITE_MODE');
  assert.equal(hash(actual.bytes),row.path===OWNER_STATUS_COPY_SOURCE?AFTER:row.target_sha256,'OWNER_COPY_WEBSITE_SOURCE:'+row.path);
  if(row.path!==OWNER_STATUS_COPY_SOURCE)assert.equal(actual.bytes.length,row.source_bytes,'OWNER_COPY_WEBSITE_SIZE');
 }
 assert.deepEqual(m.website,{operation_count:1,operations:[{path:OWNER_STATUS_COPY_SOURCE,mode:'100644',operation:'MODIFY',classification:'CLIENT_UI_STATUS_COPY_ONLY',expected_live_before_sha256:BEFORE,target_sha256:AFTER,source_bytes:physical(OWNER_STATUS_COPY_SOURCE).bytes.length}]});
 assert.deepEqual(integrationPhysicalRead(OWNER_STATUS_COPY_MANIFEST),bytes,'OWNER_COPY_RECEIPT_CHANGED');
 verifyIntegrationCandidate();return structuredClone(m);
}
export function ownerStatusCopyWebsiteOperations(){return verifyOwnerStatusCopy().website.operations;}

const proto=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(proto,'buffer').get;
const offsetOf=Object.getOwnPropertyDescriptor(proto,'byteOffset').get;
const sizeOf=Object.getOwnPropertyDescriptor(proto,'byteLength').get;
function sourceBytes(value){
 if(typeof value==='string')return Buffer.from(value);assert(Buffer.isBuffer(value),'OWNER_COPY_REPRESENTATION');
 const bytes=Buffer.alloc(sizeOf.call(value));Uint8Array.prototype.set.call(bytes,new Uint8Array(bufferOf.call(value),offsetOf.call(value),sizeOf.call(value)));return bytes;
}
/** A historical package can see only the exact pre-copy Owner source. Every
 * translated invocation proves the complete current tree before and after;
 * unknown paths, injected text/bytes and source exceptions are never erased.
 */
export function ownerStatusCopyHistoricalRead(path,value){
 if(path!==OWNER_STATUS_COPY_SOURCE)return value;
 const bytes=sourceBytes(value);
 if(typeof value==='string'&&bytes.toString('utf8')!==value)return value;
 if(hash(bytes)!==AFTER)return value;
 verifyOwnerStatusCopy();const actual=physical(path);assert.equal(hash(actual.bytes),AFTER);assert.equal(actual.mode,'100644');
 const before=prior(path);assert.equal(hash(before),BEFORE,'OWNER_COPY_HISTORICAL_PREIMAGE');
 verifyOwnerStatusCopy();return typeof value==='string'?before.toString('utf8'):before;
}
export function ownerStatusCopyHistoricalReader(read=integrationPhysicalRead){return (path,...options)=>ownerStatusCopyHistoricalRead(path,read(path,...options));}
export function ownerStatusCopyHistoricalFsRead(path,...options){
 const value=readFileSync(path,...options),absolute=path instanceof URL?fileURLToPath(path):typeof path==='string'?resolve(path):null;
 return absolute===resolve(root,OWNER_STATUS_COPY_SOURCE)?ownerStatusCopyHistoricalRead(OWNER_STATUS_COPY_SOURCE,value):value;
}
