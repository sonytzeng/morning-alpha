// Exact committed source identity, never source-rights or operational approval.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
export const CURRENT_SOURCE_BASE='da0e07dd23aee62f31cd669d0d090d948e6d1171';
export const CURRENT_SOURCE_HEAD='8c405008cdcc9f70b070da42743bcfe837a08dfa';
export const CURRENT_SOURCE_CATALOG='docs/operations/evidence/current-source-successor-20261103-catalog.json';
export const CURRENT_SOURCE_CATALOG_SHA256='6a4acdaa59fa6bc7950bc2bb3d28e8302b1bd62e323a65c6cfe8e9867d3ec68c';
export const CURRENT_SOURCE_MANIFEST='docs/operations/evidence/core-member-integration-20261103-current-source.json';
const root=new URL('../../',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,maxBuffer:32e6});
export const CURRENT_SOURCE_SUPPORT=Object.freeze(['tests/helpers/currentSourceCatalog.mjs','tests/helpers/currentSourceSuccessor.mjs','tests/currentSourceSuccessor.test.mjs']);
const flags=['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'];
const workflow='.github/workflows/vnext-candidate.yml';
const originalControls='node scripts/releases/observe-ci-node.mjs --max-old-space-size=512 --experimental-strip-types --test --test-concurrency=1 tests/vnextIntegrity.test.mjs tests/stagedReleaseIntegrity.test.mjs tests/marketNewsReportIntegrity.test.mjs tests/academyV11Integrity.test.mjs';
const appendedControls=' tests/currentSourceSuccessor.test.mjs tests/reviewedSourceSuccessor.test.mjs';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
let immutable;
function original(revision,path){
 const rows=git(['ls-tree','-z',revision,'--',path]).toString().split('\0').filter(Boolean);
 if(!rows.length)return null;assert.equal(rows.length,1);
 const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');
 assert.equal(name,path);assert.equal(mode,'100644');assert.equal(type,'blob');
 return {oid,mode,sha256:hash(git(['cat-file','blob',oid]))};
}
export function currentSourceDefinition(bytes){
 if(bytes===undefined){if(immutable)return immutable;const p=new URL(CURRENT_SOURCE_CATALOG,root),st=lstatSync(p);assert(st.isFile()&&!st.isSymbolicLink());bytes=readFileSync(p);}
 assert.equal(hash(Buffer.from(bytes)),CURRENT_SOURCE_CATALOG_SHA256,'CURRENT_SOURCE_CATALOG_DRIFT');
 if(!immutable){
  const c=JSON.parse(bytes);
  assert.equal(c.schema,'CURRENT_GIT_SOURCE_SUCCESSOR_V1');assert.equal(c.base,CURRENT_SOURCE_BASE);assert.equal(c.head,CURRENT_SOURCE_HEAD);
  assert.equal(git(['merge-base',c.base,c.head]).toString().trim(),c.base,'CURRENT_SOURCE_ANCESTRY');
  for(const [ref,key]of [[c.base,'base_tree'],[c.head,'head_tree']])assert.equal(git(['rev-parse',ref+'^{tree}']).toString().trim(),c[key],'CURRENT_SOURCE_TREE');
  const paths=git(['diff','--no-renames','--name-only','-z',c.base,c.head,'--']).toString().split('\0').filter(Boolean).sort();
  assert.equal(paths.length,48);assert.deepEqual(c.files.map(r=>r.path),paths,'CURRENT_SOURCE_EXACT_GIT_DELTA');
  assert.equal(c.scope_review.kind,'EXACT_SOURCE_DELTA_NOT_FINANCIAL_OR_OPERATIONAL_APPROVAL');
  assert.equal(c.scope_review.independent_review,false,'CURRENT_SOURCE_NO_INDEPENDENT_REVIEW_CLAIM');
  assert.deepEqual(Object.values(c.scope_review.groups).flat().sort(),paths,'CURRENT_SOURCE_REVIEW_SCOPE');
  assert.deepEqual(Object.keys(c.authority).sort(),flags.slice().sort());for(const f of flags)assert.equal(c.authority[f],false,'CURRENT_SOURCE_AUTHORITY');
  for(const row of c.files){
   assert.deepEqual(row.before,original(c.base,row.path),'CURRENT_SOURCE_BEFORE:'+row.path);
   assert.deepEqual(row.after,original(c.head,row.path),'CURRENT_SOURCE_AFTER:'+row.path);assert(row.after,'CURRENT_SOURCE_DELETE_FORBIDDEN');
  }
  assert.deepEqual(c.local_support_patch.map(r=>r.path),[workflow,'tests/officialPublicAdmission.test.mjs','tests/originalIngressAdmission.test.mjs','tests/helpers/recommendationHistoricalBatch.mjs','tests/recommendationHistoricalBatch.test.mjs','tests/sixBugDatabase.integration.mjs','.github/workflows/core-member-integration.yml','tests/membershipPolicy.test.mjs'],'CURRENT_SOURCE_EXACT_SUPPORT_PATCH');
  for(const row of c.local_support_patch){
   assert(!paths.includes(row.path),'CURRENT_SOURCE_SUPPORT_NOT_IN_GIT_DELTA');
   assert.deepEqual(row.before,original(c.head,row.path),'CURRENT_SOURCE_SUPPORT_BEFORE:'+row.path);
   let text=git(['cat-file','blob',row.before.oid]).toString('utf8');
   assert(row.exact_edits.length>0);for(const edit of row.exact_edits){assert(edit.before.length>0);assert.equal(text.split(edit.before).length,2,'CURRENT_SOURCE_EXACT_EDIT:'+row.path);text=text.replace(edit.before,edit.after);}
   assert.deepEqual(row.after,{mode:'100644',sha256:hash(Buffer.from(text))},'CURRENT_SOURCE_EXACT_PATCH:'+row.path);
  }
  const patch=c.local_support_patch[0];assert.equal(patch.path,workflow);assert.equal(patch.purpose,'APPEND_CURRENT_AND_PRIOR_SUCCESSOR_NEGATIVE_CONTROLS_ONLY');
  assert(!paths.includes(workflow),'CURRENT_SOURCE_CI_NOT_IN_GIT_DELTA');
  assert.deepEqual(patch.before,original(c.head,workflow),'CURRENT_SOURCE_CI_BEFORE');
  const before=git(['cat-file','blob',patch.before.oid]).toString('utf8');
  assert.equal(before.split(originalControls).length,2,'CURRENT_SOURCE_CI_EXACT_ANCHOR');
  assert.deepEqual(patch.after,{mode:'100644',sha256:hash(Buffer.from(before.replace(originalControls,originalControls+appendedControls)))},'CURRENT_SOURCE_CI_APPEND_ONLY');
  assert.equal(c.prior_manifest.path,'docs/operations/evidence/core-member-integration-20261102-reviewed-successor.json');
  const {path,...pin}=c.prior_manifest;assert.deepEqual(pin,original(c.base,path),'CURRENT_SOURCE_PRIOR_MANIFEST');
  immutable=freeze(c);
 }
 // Only immutable Git metadata is cached; never a mutable read, mode or PASS.
 return immutable;
}
export function currentSourceHash(path){const c=currentSourceDefinition();return [...c.files,...c.local_support_patch].find(r=>r.path===path)?.after.sha256;}
const priorPatchBytes=new Map();
export function currentSourcePriorPatch(path){
 const row=currentSourceDefinition().local_support_patch.find(r=>r.path===path);assert(row,'CURRENT_SOURCE_EXACT_PRIOR_PATCH');
 // Immutable Git blobs only. Return an owned copy; the live reader and mode
 // are still checked on every call by the wrapping admission boundary.
 if(!priorPatchBytes.has(path)){const bytes=git(['cat-file','blob',row.before.oid]);assert.equal(hash(bytes),row.before.sha256);priorPatchBytes.set(path,bytes);}
 return Buffer.from(priorPatchBytes.get(path));
}
