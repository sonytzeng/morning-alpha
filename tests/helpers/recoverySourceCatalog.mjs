// Append-only engineering identity; no financial, rights or release approval.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {currentSourceHash} from './currentSourceCatalog.mjs';
import {reviewedSuccessorSourceHash} from './reviewedSourceSuccessor.mjs';
export const RECOVERY_SOURCE_BASE='835168c834948961a61d18633e9e29cf69dba1f0';
export const RECOVERY_SOURCE_HEAD='302e6cd89ba386e27eaab287fe759c3b0922b02f';
export const RECOVERY_SOURCE_CATALOG='docs/operations/evidence/recovery-source-successor-20261105-catalog.json';
export const RECOVERY_SOURCE_CATALOG_SHA256='13d985166cc03f5cf303494850c420ecc30d89b6833a37440a8d90939e737495';
export const RECOVERY_SOURCE_MANIFEST='docs/operations/evidence/core-member-integration-20261105-recovery-source.json';
export const RECOVERY_SOURCE_FIXTURE_DIR='tests/fixtures/recovery-source-validators-20261105';
export const RECOVERY_SOURCE_SUPPORT=Object.freeze(['tests/helpers/recoverySourceCatalog.mjs','tests/helpers/recoverySourceSuccessor.mjs','tests/recoverySourceSuccessor.test.mjs']);
const root=new URL('../../',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,maxBuffer:32e6});
const flags=['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'];
const supportPatches=Object.freeze(['.github/workflows/vnext-candidate.yml','tests/currentSourceSuccessor.test.mjs','tests/reviewedSourceSuccessor.test.mjs','tests/officialPublicAdmission.test.mjs','tests/originalIngressAdmission.test.mjs']);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
let immutable;
function original(revision,path){
 const rows=git(['ls-tree','-z',revision,'--',path]).toString().split('\0').filter(Boolean);
 if(!rows.length)return null;assert.equal(rows.length,1);
 const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');
 assert.equal(name,path);assert.equal(mode,'100644');assert.equal(type,'blob');
 return {oid,mode,sha256:hash(git(['cat-file','blob',oid]))};
}
export function recoverySourceDefinition(bytes){
 if(bytes===undefined){if(immutable)return immutable;const p=new URL(RECOVERY_SOURCE_CATALOG,root),st=lstatSync(p);assert(st.isFile()&&!st.isSymbolicLink());bytes=readFileSync(p);}
 assert.equal(hash(Buffer.from(bytes)),RECOVERY_SOURCE_CATALOG_SHA256,'RECOVERY_SOURCE_CATALOG_DRIFT');
 if(!immutable){
  const c=JSON.parse(bytes);
  assert.equal(c.schema,'RECOVERY_GIT_SOURCE_SUCCESSOR_V1');assert.equal(c.base,RECOVERY_SOURCE_BASE);assert.equal(c.head,RECOVERY_SOURCE_HEAD);
  assert.deepEqual(git(['rev-list','--parents','-n','1',c.head]).toString().trim().split(' '),[c.head,c.base],'RECOVERY_SOURCE_DIRECT_PARENT');
  for(const [ref,key]of [[c.base,'base_tree'],[c.head,'head_tree']])assert.equal(git(['rev-parse',ref+'^{tree}']).toString().trim(),c[key],'RECOVERY_SOURCE_TREE');
  const paths=git(['diff','--no-renames','--name-only','-z',c.base,c.head,'--']).toString().split('\0').filter(Boolean).sort();
  assert.equal(paths.length,16);assert.deepEqual(c.files.map(r=>r.path),paths,'RECOVERY_SOURCE_EXACT_GIT_DELTA');
  assert.equal(c.scope_review.kind,'EXACT_ENGINEERING_DELTA_NOT_FINANCIAL_OR_OPERATIONAL_APPROVAL');
  assert.equal(c.scope_review.independent_review,false,'RECOVERY_SOURCE_NO_AUTHORITY_CLAIM');
  assert.deepEqual(Object.values(c.scope_review.groups).flat().sort(),paths,'RECOVERY_SOURCE_REVIEW_SCOPE');
  assert.deepEqual(Object.keys(c.authority).sort(),flags.slice().sort());for(const f of flags)assert.equal(c.authority[f],false,'RECOVERY_SOURCE_AUTHORITY');
  for(const row of c.files){
   assert.deepEqual(row.before,original(c.base,row.path),'RECOVERY_SOURCE_BEFORE:'+row.path);
   assert.deepEqual(row.after,original(c.head,row.path),'RECOVERY_SOURCE_AFTER:'+row.path);assert(row.after,'RECOVERY_SOURCE_DELETE_FORBIDDEN');
  }
  const fixtureSource='tests/dailyAiFullNestedLocal.integration.mjs';
  assert.deepEqual(c.fixture_source,{path:fixtureSource,revision:c.head,...original(c.head,fixtureSource)},'RECOVERY_SOURCE_FIXTURE_IDENTITY');
  const fixtureTest=git(['cat-file','blob',c.fixture_source.oid]).toString('utf8'),fixtureMatch=fixtureTest.match(/const validatorHashes=(\{[^\n]+\});/);assert(fixtureMatch,'RECOVERY_SOURCE_FIXTURE_HASH_TABLE');
  const fixtureHashes=JSON.parse(fixtureMatch[1]),fixtureNames=Object.keys(fixtureHashes).sort();assert.equal(fixtureNames.length,27);
  assert.deepEqual(c.local_fixture,fixtureNames.map(name=>({path:RECOVERY_SOURCE_FIXTURE_DIR+'/'+name,mode:'100644',sha256:fixtureHashes[name],origin:'READ_ONLY_POSTGRES_FUNCTION_DEFINITION_NO_DATA'})),'RECOVERY_SOURCE_EXACT_FIXTURES');
  assert.deepEqual(c.local_support_patch.map(r=>r.path),supportPatches,'RECOVERY_SOURCE_EXACT_SUPPORT_PATCH');
  for(const row of c.local_support_patch){
   assert(!paths.includes(row.path),'RECOVERY_SOURCE_SUPPORT_NOT_IN_GIT_DELTA');
   assert.deepEqual(row.before,original(c.base,row.path),'RECOVERY_SOURCE_SUPPORT_BEFORE:'+row.path);
   let text=git(['cat-file','blob',row.before.oid]).toString('utf8');
   assert(row.exact_edits.length>0);for(const edit of row.exact_edits){assert(edit.before.length>0);assert.equal(text.split(edit.before).length,2,'RECOVERY_SOURCE_EXACT_EDIT:'+row.path);text=text.replace(edit.before,edit.after);}
   assert.deepEqual(row.after,{mode:'100644',sha256:hash(Buffer.from(text))},'RECOVERY_SOURCE_EXACT_PATCH:'+row.path);
  }
  const workflow=c.local_support_patch[0];assert.equal(workflow.purpose,'APPEND_RECOVERY_CONTROLS_AND_RUN_BOUNDED_FUNCTIONAL_REGRESSIONS');
  assert.equal(c.prior_manifest.path,'docs/operations/evidence/core-member-integration-20261103-current-source.json');
  const {path,...pin}=c.prior_manifest;assert.deepEqual(pin,original(c.base,path),'RECOVERY_SOURCE_PRIOR_MANIFEST');
  assert.deepEqual(c.trusted_verifier_boundary,{path:'tests/helpers/integrationAdmission.mjs',before:original(c.base,'tests/helpers/integrationAdmission.mjs'),purpose:'SWITCH_DEFAULT_SUCCESSOR_PRESERVE_PRIOR_PINS_APPEND_RECOVERY_SUPPORT_PINS'});
  immutable=freeze(c);
 }
 // Immutable metadata only; callers still reread live bytes and modes.
 return immutable;
}
export function recoverySourceHash(path,fallback){const c=recoverySourceDefinition();return [...c.files,...c.local_support_patch].find(r=>r.path===path)?.after.sha256??c.local_fixture.find(r=>r.path===path)?.sha256??currentSourceHash(path)??reviewedSuccessorSourceHash(path,fallback);}
const priorPatchBytes=new Map();
export function recoverySourcePriorPatch(path){
 const c=recoverySourceDefinition(),row=[...c.files,...c.local_support_patch].find(r=>r.path===path);assert(row?.before,'RECOVERY_SOURCE_EXACT_PRIOR_PATCH');
 if(!priorPatchBytes.has(path)){const bytes=git(['cat-file','blob',row.before.oid]);assert.equal(hash(bytes),row.before.sha256);priorPatchBytes.set(path,bytes);}
 return Buffer.from(priorPatchBytes.get(path));
}
