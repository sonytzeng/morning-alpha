// Current engineering delta wraps, rather than rewrites, every prior receipt.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import * as prior from './currentSourceSuccessor.mjs';
import {verifyReviewedSuccessorCatalogIdentity} from './reviewedSourceSuccessor.mjs';
import {CURRENT_SOURCE_CATALOG,currentSourceDefinition} from './currentSourceCatalog.mjs';
import {RECOVERY_SOURCE_BASE,RECOVERY_SOURCE_HEAD,RECOVERY_SOURCE_CATALOG,RECOVERY_SOURCE_CATALOG_SHA256,RECOVERY_SOURCE_MANIFEST,RECOVERY_SOURCE_SUPPORT,recoverySourceDefinition,recoverySourcePriorPatch} from './recoverySourceCatalog.mjs';
export const REVIEWED_SUCCESSOR_MANIFEST=RECOVERY_SOURCE_MANIFEST;
export const REVIEWED_SUCCESSOR_SUPPORT=Object.freeze([...prior.REVIEWED_SUCCESSOR_SUPPORT,...RECOVERY_SOURCE_SUPPORT]);
const root=new URL('../../',import.meta.url),hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
export function readRecoveryRegularFile(path,base=root){
 const parts=path.split('/');assert(parts.length&&parts.every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\\')&&!p.includes('\0')),'RECOVERY_SOURCE_PATH');
 let target=fileURLToPath(base),st=lstatSync(target);assert(st.isDirectory()&&!st.isSymbolicLink(),'RECOVERY_SOURCE_REGULAR_ROOT');
 for(const [index,part]of parts.entries()){
  target=join(target,part);st=lstatSync(target);
  assert(!st.isSymbolicLink()&&(index===parts.length-1?st.isFile():st.isDirectory()),'RECOVERY_SOURCE_REGULAR_FILE:'+path);
 }
 return readFileSync(target);
}
/** Exact after-images only. Injected, missing and non-round-tripping values
 * remain untouched; callers must run the complete live admission first. */
export function recoveryPriorRead(path,bytes){
 const c=recoverySourceDefinition(),row=[...c.files,...c.local_support_patch].find(r=>r.path===path);
 if(!row?.before||bytes===undefined||bytes===null)return bytes;
 if(typeof bytes==='string'&&Buffer.from(bytes).toString('utf8')!==bytes)return bytes;
 if(hash(bytes)!==row.after.sha256)return bytes;
 const url=new URL(path,root),st=lstatSync(url);assert(st.isFile()&&!st.isSymbolicLink(),'RECOVERY_SOURCE_REGULAR_FILE:'+path);
 assert.equal(st.mode&0o111?'100755':'100644',row.after.mode,'RECOVERY_SOURCE_CHANGED_MODE:'+path);
 assert.equal(hash(readRecoveryRegularFile(path)),row.after.sha256,'RECOVERY_SOURCE_CHANGED_AFTER_ADMISSION:'+path);
 const before=recoverySourcePriorPatch(path);return typeof bytes==='string'?before.toString('utf8'):before;
}
export function verifyReviewedSuccessorCatalog(read,mode){
 readRecoveryRegularFile(RECOVERY_SOURCE_CATALOG);
 assert.equal(mode(RECOVERY_SOURCE_CATALOG),'100644','RECOVERY_SOURCE_CATALOG_MODE');
 const c=recoverySourceDefinition(read(RECOVERY_SOURCE_CATALOG));
 // Preserve the predecessor identity refusal before comparing newer source
 // bodies, including catalog/source co-mutation controls at both old layers.
 verifyReviewedSuccessorCatalogIdentity(read,mode);currentSourceDefinition(read(CURRENT_SOURCE_CATALOG));
 for(const row of [...c.files,...c.local_support_patch]){const prefix=prior.REVIEWED_SUCCESSOR_SUPPORT.includes(row.path)?'SUCCESSOR_SUPPORT_SOURCE_DRIFT:':'INTEGRATION_SOURCE_DRIFT:';assert.equal(hash(read(row.path)),row.after.sha256,prefix+row.path);readRecoveryRegularFile(row.path);assert.equal(mode(row.path),row.after.mode,'INTEGRATION_MODE_DRIFT:'+row.path);}
 for(const row of c.local_fixture){assert.equal(hash(read(row.path)),row.sha256,'INTEGRATION_SOURCE_DRIFT:'+row.path);readRecoveryRegularFile(row.path);assert.equal(mode(row.path),row.mode,'INTEGRATION_MODE_DRIFT:'+row.path);}
 // The prior layer receives fixed Git before-images solely after this layer's
 // live source, identity and mode checks. It retains all of its old assertions.
 prior.verifyReviewedSuccessorCatalog(path=>recoveryPriorRead(path,read(path)),mode);
 assert.equal(hash(read(c.prior_manifest.path)),c.prior_manifest.sha256,'RECOVERY_SOURCE_PRIOR_MANIFEST_DRIFT');
 assert.equal(mode(c.prior_manifest.path),'100644','RECOVERY_SOURCE_PRIOR_MODE');
 for(const path of RECOVERY_SOURCE_SUPPORT){readRecoveryRegularFile(path);assert.equal(mode(path),'100644','RECOVERY_SOURCE_SUPPORT_MODE');}
}
let immutablePaths;
export function reviewedSuccessorPaths(){
 if(!immutablePaths){const c=recoverySourceDefinition();immutablePaths=Object.freeze([...new Set([...prior.reviewedSuccessorPaths(),...c.files.map(r=>r.path),...c.local_support_patch.map(r=>r.path),...c.local_fixture.map(r=>r.path),c.prior_manifest.path,RECOVERY_SOURCE_CATALOG,...RECOVERY_SOURCE_SUPPORT])].sort());}
 return [...immutablePaths];
}
export function reviewedSuccessorLineage(){
 const c=recoverySourceDefinition();return {...prior.reviewedSuccessorLineage(),recovery_git_successor:{base:RECOVERY_SOURCE_BASE,head:RECOVERY_SOURCE_HEAD,
  base_tree:c.base_tree,head_tree:c.head_tree,exact_git_delta:c.files.length,prior_manifest:{...c.prior_manifest},
  catalog:{path:RECOVERY_SOURCE_CATALOG,sha256:RECOVERY_SOURCE_CATALOG_SHA256},scope_review:structuredClone(c.scope_review),local_support_patch:structuredClone(c.local_support_patch),fixture_source:structuredClone(c.fixture_source),local_fixture:structuredClone(c.local_fixture),trusted_verifier_boundary:structuredClone(c.trusted_verifier_boundary),support_paths:[...RECOVERY_SOURCE_SUPPORT],...c.authority}};
}
export function applyReviewedSuccessor(expected,historicalSupport=[]){
 prior.applyReviewedSuccessor(expected,historicalSupport);const c=recoverySourceDefinition(),oldSupport=new Set(prior.REVIEWED_SUCCESSOR_SUPPORT);
 for(const row of [...c.files,...c.local_support_patch]){
  // Old verifier support stays separately pinned outside generated receipts.
  if(oldSupport.has(row.path))continue;
  assert.equal(expected.get(row.path)?.sha256??null,row.before?.sha256??null,'RECOVERY_SOURCE_BEFORE_COMPOSITION:'+row.path);
  assert.equal(expected.get(row.path)?.mode??null,row.before?.mode??null,'RECOVERY_SOURCE_BEFORE_MODE:'+row.path);
  expected.set(row.path,{sha256:row.after.sha256,mode:row.after.mode});
 }
 for(const row of c.local_fixture){assert(!expected.has(row.path),'RECOVERY_SOURCE_FIXTURE_OVERLAP');expected.set(row.path,{sha256:row.sha256,mode:row.mode});}
 assert(!expected.has(c.prior_manifest.path));expected.set(c.prior_manifest.path,{sha256:c.prior_manifest.sha256,mode:'100644'});
 assert(!expected.has(RECOVERY_SOURCE_CATALOG));expected.set(RECOVERY_SOURCE_CATALOG,{sha256:RECOVERY_SOURCE_CATALOG_SHA256,mode:'100644'});
 for(const p of REVIEWED_SUCCESSOR_SUPPORT)expected.delete(p);
}
