// Append-only source integrity successor. Git objects and independent exact-scope
// reviews define the delta; neither the live tree nor a rehashed receipt does.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';

export const REVIEWED_SUCCESSOR_MANIFEST='docs/operations/evidence/core-member-integration-20261102-reviewed-successor.json';
export const REVIEWED_SUCCESSOR_CATALOG='docs/operations/evidence/reviewed-source-successor-20261102-catalog.json';
export const REVIEWED_SUCCESSOR_BASE='56b2d638819b8ef6e17385d3a7cfc19f0591c14e';
export const REVIEWED_SUCCESSOR_HEAD='dee20b5ade6bd22070b7142b9b09b2102a87e80f';
export const REVIEWED_SUCCESSOR_PRIOR='docs/operations/evidence/core-member-integration-20261022-runtime-integrity.json';
export const REVIEWED_SUCCESSOR_SUPPORT=Object.freeze([
 'tests/helpers/reviewedSourceSuccessor.mjs',
 'tests/reviewedSourceSuccessor.test.mjs',
]);
// This digest is filled only after all four independent source reviews arrive.
// A pending catalog cannot admit a candidate.
export const REVIEWED_SUCCESSOR_CATALOG_SHA256='3dddd1c7dc5813027c5d86d71b54853e5907ac65c4ffc2f489942d229354bf1c';
const REVIEW_PINS=Object.freeze({
 frontend:Object.freeze({count:44,paths_sha256:'e5eda28fdb2556f878f6ea69befb30c9c2b26442f58726d80011b73cdacbae75',review_sha256:'da882c27d5f5cec7b1b97c83ee4b60bb780fc8644a11ff014bc438b2852e1589'}),
 sql:Object.freeze({count:51,paths_sha256:'e1148dda62532d1d449d1ad771c0c31b5352982d3222a1b42b4d6602a985f6c8',review_sha256:'a638fdbc8ad83c97e610dd76fd5d0b04c7d189f7f37f37ba9c71991778f0ce66'}),
 runtime:Object.freeze({count:46,paths_sha256:'497b15547ffeb09e2af094a3072f7c29db2644237813a5d96ebd2fe2c3fe1462',review_sha256:'00f87ab341b2a86661645c52d1d59b044adca731b4c88b6a470b4d80b165a748'}),
 support:Object.freeze({count:145,paths_sha256:'cbb96289be3795f4f88e4c826779be20d712ba6e84c2221d6c43ca2caba3c630',review_sha256:'98c5b20df95b3db1ade9f06960e6bce103fc8d0660a89fab936b811c8ef9c804'}),
});
// Explicit follow-up changes to the admission consumers are reviewed separately
// from the immutable HEAD catalog. Their before-images remain pinned Git blobs.
// Literal after-image pins are added only after the independent local review.
const LOCAL_REVIEWED_PATCH=Object.freeze({
 "schema": "LOCAL_REVIEWED_SOURCE_PATCH_V1",
 "base": "dee20b5ade6bd22070b7142b9b09b2102a87e80f",
 "review_sha256": "e000561a967bddfe944d066ad3e2f827bad19bfd0d30d5f4c1c4c1c233bd22a4",
 "files": [
  {
   "path": ".github/workflows/core-member-integration.yml",
   "before_sha256": "425d603335d644a34b8cef28ada0a175422cbf876cffbeca8bf29b131eebae36",
   "before_blob_oid": "8049aa3bb285261c24dc40b5dbbec8ad44ed7361",
   "before_mode": "100644",
   "after_sha256": "5f7f0336ee03c1ac094ea69f663c958f6b196dcfd9f7c84b32a46b20a7766815",
   "mode": "100644"
  },
  {
   "path": "research/reviewed-analysis-snapshot.candidate.sql",
   "before_sha256": "c5fcd3fcd2ccb426358f16ac10533ddefd0dcde1bf71dea9262cded0e77f9bdb",
   "before_blob_oid": "c81d998f8bce82cc9596622c4f182ade9b4f3f4e",
   "before_mode": "100644",
   "after_sha256": "22f80f573281251efe51b262b07e0dddc3c3a141d1760046a8c4453857f41a18",
   "mode": "100644"
  },
  {
   "path": "scripts/operations/continuous-learning-20261020/materialize.mjs",
   "before_sha256": "78ba456439da4740339e316092638910137c737bf5b78e0028cc4a9ac3aadbe2",
   "before_blob_oid": "a48ae07b9e8fc9c6ff39aed153bcb6d498a80b5e",
   "before_mode": "100644",
   "after_sha256": "722f80c4de19a0b5c77ba2e7c05f4ec2cc5a9c5252abd39e3b2a177999e29821",
   "mode": "100644"
  },
  {
   "path": "tests/continuousLearningRelease.test.mjs",
   "before_sha256": "b2cfc1789eb3a5c3a6d3ca295fc571f215f30ff31965699843e04cae83058604",
   "before_blob_oid": "479f4c2635ca457aac42c540a829ef2e3524e2de",
   "before_mode": "100644",
   "after_sha256": "1a393d9e73e8c595497106566999bfc39c7b3bdec543c6fadf7b206abbd9087e",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiCitationRepair.integration.test.mjs",
   "before_sha256": "0e0d70b3cda95afe5ce860d1fd5ee104a8fdfb95df90f3fdd07871c4b38c8cd6",
   "before_blob_oid": "4c8668d58702c75b7bff012968af74cef1b64a5a",
   "before_mode": "100644",
   "after_sha256": "5037335fef9793b24b59ea1af6db65d5918f060ba86fde850bf3179d7a2411d6",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiCurrentPolicyBoundary.test.mjs",
   "before_sha256": null,
   "before_blob_oid": null,
   "before_mode": null,
   "after_sha256": "cef75932e1c283f1ea2bd11503c82faa5e8b141c8e2937737cc9b55024646320",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiIntake.integration.test.mjs",
   "before_sha256": "87b6132e692608310717fd356afcc5b09f2372cfa8c096680138f455cb56b9e6",
   "before_blob_oid": "d065fb6d932ed4699ecdd94e7862ddcdb89dffbb",
   "before_mode": "100644",
   "after_sha256": "73c4340afec445dfe2f38bfdcaad7d204bfa9a71a88d1e222e3fcfb0235e9502",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiPilot.integration.test.mjs",
   "before_sha256": "8c233f6feccfc86bc5042d2e1b54d14b3a163ce96a16807571df9445ddc5d82e",
   "before_blob_oid": "25bcb406cb0e36beff1fe94c328e3cc571d4d95c",
   "before_mode": "100644",
   "after_sha256": "c77136722ec0058d97fb8fb669f904bbf87a77fdb65c6408d675f66f0887141d",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiProvider.test.mjs",
   "before_sha256": "18ad9890b65f916028a153a318e2cf355894c59c1be3e2c9c05c332ff50345e7",
   "before_blob_oid": "b4473dac8e3d45940225f54c9e16f6ca6b704d4b",
   "before_mode": "100644",
   "after_sha256": "cefad2de689e382b3bfa0bc01242dade6334c1e02ac3065ef9b711620430c07a",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiProviderFailure.test.mjs",
   "before_sha256": "ff9651d3370ed68e4bad18dcb3ca4e34f83f861f49ff9a05f1493c02aff2b2e2",
   "before_blob_oid": "d72173cb8fe32effd994ce5d786d2fe1a617b26a",
   "before_mode": "100644",
   "after_sha256": "d8301b34047a54442039748da9d878eabb0a68096746e1bbbdf081b7a4091d5c",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiRateLimitRecovery.test.mjs",
   "before_sha256": "4d4e190169824591ae3c33d2de38e5b788847d9f997fc9eefa136cf569180291",
   "before_blob_oid": "981e58253aee3ff950604bcfb9558d53c88969e6",
   "before_mode": "100644",
   "after_sha256": "cbf2cd560465bc7fe4c71b5cb65766f7185457e1f0b38dfbbaaa1e02acde939d",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiSource.test.mjs",
   "before_sha256": "3f449c2c56cde03e0b256ba3fc874742c8593a052166795e0d2991b5e3fd3cb1",
   "before_blob_oid": "6b6c6a8c37b913b8228b006ab8e946bbd4c84947",
   "before_mode": "100644",
   "after_sha256": "87145b07bdc671e08fdaeeab3ef8c0682a29a55d74cc0b44a1b4b0aae8dd1122",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiSourceWorker.integration.test.mjs",
   "before_sha256": "ce326144ce560e5f3b401fb35c2e17cff6317ae1433a97f21c2815c1d884ae21",
   "before_blob_oid": "c9df92db055e0df03ce94d56290904a62dbd3e22",
   "before_mode": "100644",
   "after_sha256": "e81935cfca48ccf5a7f1e4590001a1b7f7d6ff29ad00fdc9bdfdf8970d6e1b77",
   "mode": "100644"
  },
  {
   "path": "tests/dailyStockAiWorker.integration.test.mjs",
   "before_sha256": "b641ccdfcc7d3f2961ab72d29b8a1e9aa524511492abc8e8b551583b59157d25",
   "before_blob_oid": "ecba9f2cd61293e09e0024733db8a227a14bc670",
   "before_mode": "100644",
   "after_sha256": "f8d0a9cccceb0d016ff575c1bb18d9cfadf19dea583bcf54e0e15e00494cc5ca",
   "mode": "100644"
  },
  {
   "path": "tests/fixtures/daily-stock-ai-pre-hardstop-source-manifest.json",
   "before_sha256": null,
   "before_blob_oid": null,
   "before_mode": null,
   "after_sha256": "fb70ccdc6453c24d620e090b38c54bcfb5d326e0e6542451daaf0c111daa8e62",
   "mode": "100644"
  },
  {
   "path": "tests/fixtures/daily-stock-ai-source-worker-83-source-manifest.json",
   "before_sha256": null,
   "before_blob_oid": null,
   "before_mode": null,
   "after_sha256": "e7f92861c103b54aa750e174135c0e9bec4730378482ce478bac7bb5fbd3d68b",
   "mode": "100644"
  },
  {
   "path": "tests/helpers/continuousLearningSourceView.mjs",
   "before_sha256": null,
   "before_blob_oid": null,
   "before_mode": null,
   "after_sha256": "16a2fb57fb094c431b32157254dc1a4f8ffba10bd4685f07b7612f2e92e3ab5a",
   "mode": "100644"
  },
  {
   "path": "tests/helpers/memberContinuityAdmission.mjs",
   "before_sha256": "df9100b4de222c84ab78f59d7877e24576f3865ad6158dedad9cdc9546d17ec5",
   "before_blob_oid": "06d3065999112c58b88f3878310edc15e2146bb8",
   "before_mode": "100644",
   "after_sha256": "f0541abc57a127447f64af993054119a5a38d58b7343c6ceb8e9625f5620121d",
   "mode": "100644"
  },
  {
   "path": "tests/helpers/stockAiHistoricalLoaderHook.mjs",
   "before_sha256": null,
   "before_blob_oid": null,
   "before_mode": null,
   "after_sha256": "5148d5a15edb4296667f370f3b935bdd25a0cd8751bbb0de80d166b5106ea56f",
   "mode": "100644"
  },
  {
   "path": "tests/helpers/stockAiHistoricalProtocol.mjs",
   "before_sha256": null,
   "before_blob_oid": null,
   "before_mode": null,
   "after_sha256": "f587a3d58c2860a16d8adaf2e5c322f5d07691e53c52502de7204e56a031d40c",
   "mode": "100644"
  },
  {
   "path": "tests/memberContinuityAdmission.test.mjs",
   "before_sha256": "198a5978ee73b8db353d8c8a56a86dddbd37fb9be29349381fd43d679589b90b",
   "before_blob_oid": "b54092212bc3c268d00055cdd60cdae9704731c8",
   "before_mode": "100644",
   "after_sha256": "30c3e64a1e37bb86832ee9a3542ffcf8100184d442a75aa8e5e81be0b6b69e3b",
   "mode": "100644"
  },
  {
   "path": "tests/officialPublicAdmission.test.mjs",
   "before_sha256": "c70d1ae15d1c88547f61454fdbb3069775e43d3cebadf1aceb01d4d7e9e1815e",
   "before_blob_oid": "1d09e37740052ebf1f0ba2152cdf7bb4f5e424c4",
   "before_mode": "100644",
   "after_sha256": "cb914f90433d7d70e1aa72efee89688a4841714177a01c2bf5cc6d22d1ad7dd3",
   "mode": "100644"
  },
  {
   "path": "tests/originalIngressAdmission.test.mjs",
   "before_sha256": "1d85f9c599b4482cafb86934a7f67e9b22079c1968a65450c260e1f72108bc65",
   "before_blob_oid": "fcb1800c16ea8a2fa03eed06404d93c0da5d42b7",
   "before_mode": "100644",
   "after_sha256": "a81472a9a2f266a5bf3986606e590dd9e146b619b12517f346de782bc651a55c",
   "mode": "100644"
  },
  {
   "path": "tests/recommendationIssuerEventReview.test.mjs",
   "before_sha256": "ba531707c69cad01edcf5706af28e15a04accc523ee674543e94e3e3fc78d225",
   "before_blob_oid": "44a2ab563b51a3e562475289eb179a10e042d2b4",
   "before_mode": "100644",
   "after_sha256": "ed5b86fe73975792d22ae7900080f339d4408df9f7cbe6e82e19b49b5f5d3c08",
   "mode": "100644"
  },
  {
   "path": "tests/reviewedSnapshotDatabase.integration.mjs",
   "before_sha256": "d21eba910188b22d2f3e662f9b36e500bb6c1cac7d8b34a66bbaaa0f7a124fbd",
   "before_blob_oid": "95e6879724c576b126a35f812960a6cf6aebd564",
   "before_mode": "100644",
   "after_sha256": "dc34ec619dee30da9a96baa7df0af5fb29d5a6042a968acb020dc05fa32ee837",
   "mode": "100644"
  }
 ]
});
const PRIOR_SHA256='554e96d7d84995d8bc19091bbfa7e2dfb152fec6980d32502e963f4b860c199e';
const BASE_TREE='713fc226505f5209d7bb6a06fcbf17490e6db941';
const HEAD_TREE='e28d805767bdba3285af33c25eb08349ec0cc79a';
const INTEGRATION_BASE='754850ba1c66329d12eac8e98ab799e0a0c9123e';
const AUTHORITY_FLAGS=Object.freeze(['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed']);
const LEGACY_HARNESS_SUPPORT=Object.freeze([
 '.github/workflows/core-member-integration.yml','.github/workflows/v1-source-integration.yml',
 'tests/helpers/integrationAdmission.mjs','tests/officialPublicAdmission.test.mjs','tests/originalIngressAdmission.test.mjs',
]);
const root=new URL('../../',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,encoding:'utf8',maxBuffer:32e6});
const blobs=new Map();
function blob(revision,path){
 const key=revision+':'+path;
 if(!blobs.has(key)){
  const rows=git(['ls-tree','-z',revision,'--',path]).split('\0').filter(Boolean);
  if(!rows.length){blobs.set(key,null);return null;}
  assert.equal(rows.length,1,'SUCCESSOR_EXACT_GIT_PATH');
  const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');
  assert.equal(name,path);assert.equal(type,'blob','SUCCESSOR_REGULAR_GIT_BLOB');
  assert.equal(mode,'100644','SUCCESSOR_GIT_MODE:'+path);assert.match(oid,/^[a-f0-9]{40}$/);
  const bytes=execFileSync('git',['--no-replace-objects','cat-file','blob',oid],{cwd:root,maxBuffer:16e6});
  blobs.set(key,{mode,oid,sha256:hash(bytes),bytes:Buffer.from(bytes)});
 }
 return blobs.get(key);
}
function physicalCatalog(){
 const url=new URL(REVIEWED_SUCCESSOR_CATALOG,root),st=lstatSync(url);
 assert(st.isFile()&&!st.isSymbolicLink(),'SUCCESSOR_CATALOG_REGULAR_FILE');
 assert.equal(st.mode&0o111,0,'SUCCESSOR_CATALOG_MODE');
 return readFileSync(url);
}
function exactKeys(value,keys,label){assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),label);}
function noAuthority(value){
 exactKeys(value,AUTHORITY_FLAGS,'SUCCESSOR_AUTHORITY_KEYS');
 for(const flag of AUTHORITY_FLAGS)assert.equal(value[flag],false,'SUCCESSOR_FORBIDDEN:'+flag);
}
function verifyNarrowReceiptBridge(){
 const revision='0a9329c1b965e13e42ec293fe5e419e95f580f3f',path='docs/operations/evidence/frontend-request-recovery-20261031.json';
 const receipt=blob(revision,path);assert.equal(receipt?.sha256,'95a7c67578909d5b29f12d33ed87264033e53360a0ffe30f4848186b13ed6194','SUCCESSOR_NARROW_RECEIPT');
 const old=JSON.parse(receipt.bytes),commit='62096d3473ddab3deb0f1a58f20b9a17a7292d11',parent='216029350a84b2ae88abaf5c35712c48091a9f70';
 assert.equal(git(['rev-parse',commit+'^']).trim(),parent,'SUCCESSOR_NARROW_PARENT');
 assert.equal(git(['rev-parse',parent+'^{tree}']).trim(),old.parent_tree,'SUCCESSOR_NARROW_BEFORE_TREE');
 assert.equal(git(['rev-parse',commit+'^{tree}']).trim(),old.reviewed_tree,'SUCCESSOR_NARROW_AFTER_TREE');
 assert.deepEqual(git(['diff','--no-renames','--name-only','-z',parent,commit,'--']).split('\0').filter(Boolean).sort(),old.files.map(r=>r.path).sort(),'SUCCESSOR_NARROW_EXACT_18');
 assert.equal(old.files.length,18);assert.equal(old.historical_integration_status.full_integration_admission,false);
 for(const row of old.files){
  const before=blob(parent,row.path),after=blob(commit,row.path);
  assert.equal(before?.sha256??null,row.before_sha256,'SUCCESSOR_NARROW_BEFORE:'+row.path);
  assert.equal(before?.oid??null,row.before_git_blob_oid,'SUCCESSOR_NARROW_BEFORE_BLOB:'+row.path);
  assert.equal(after?.sha256,row.after_sha256,'SUCCESSOR_NARROW_AFTER:'+row.path);
  assert.equal(after?.oid,row.after_git_blob_oid,'SUCCESSOR_NARROW_BLOB:'+row.path);
 }
 return {revision,path,sha256:receipt.sha256,actual_commit:commit,actual_parent:parent,parent_tree:old.parent_tree,reviewed_tree:old.reviewed_tree,
  recorded_parent_commit:old.parent_commit,recorded_reviewed_commit:old.reviewed_commit,
  bridge_basis:'MATCHED_TREE_IDENTITIES_AND_ALL_18_GIT_DELTAS_NOT_COMMIT_HISTORY_EQUIVALENCE',exact_files:18,full_integration_admission:false};
}
let immutableDefinition;
function definition(bytes){
 if(bytes===undefined){if(immutableDefinition)return immutableDefinition;bytes=physicalCatalog();}
 assert.match(REVIEWED_SUCCESSOR_CATALOG_SHA256,/^[a-f0-9]{64}$/,'SUCCESSOR_INDEPENDENT_REVIEWS_REQUIRED');
 assert.equal(hash(bytes),REVIEWED_SUCCESSOR_CATALOG_SHA256,'SUCCESSOR_CATALOG_DRIFT');
 // Only the exact pinned catalog and immutable Git metadata are memoized.
 // No current read, mode, inventory, manifest digest or PASS is cached.
 if(!immutableDefinition){
  const c=JSON.parse(bytes);
  exactKeys(c,['schema','base','head','base_tree','head_tree','prior_root','reviews','files','local_patch','authority'],'SUCCESSOR_CATALOG_KEYS');
  assert.equal(c.schema,'REVIEWED_SOURCE_SUCCESSOR_GIT_CATALOG_V1');
  assert.equal(c.base,REVIEWED_SUCCESSOR_BASE);assert.equal(c.head,REVIEWED_SUCCESSOR_HEAD);
  assert.equal(c.base_tree,BASE_TREE);assert.equal(c.head_tree,HEAD_TREE);
  assert.equal(git(['rev-parse',c.base+'^{tree}']).trim(),BASE_TREE,'SUCCESSOR_BASE_TREE');
  assert.equal(git(['rev-parse',c.head+'^{tree}']).trim(),HEAD_TREE,'SUCCESSOR_HEAD_TREE');
  assert.equal(git(['merge-base',c.base,c.head]).trim(),c.base,'SUCCESSOR_ANCESTRY');
  assert.deepEqual(c.prior_root,{revision:c.base,path:REVIEWED_SUCCESSOR_PRIOR,sha256:PRIOR_SHA256});
  const prior=blob(c.base,REVIEWED_SUCCESSOR_PRIOR);assert.equal(prior?.sha256,PRIOR_SHA256,'SUCCESSOR_PRIOR_ROOT');
  const previous=JSON.parse(prior.bytes);assert.equal(previous.files.length,586,'SUCCESSOR_PRIOR_FULL_SCOPE');
  const composition=new Map(previous.files.map(r=>[r.path,{sha256:r.after_sha256,mode:r.mode}]));
  const paths=git(['diff','--no-renames','--name-only','-z',c.base,c.head,'--']).split('\0').filter(Boolean).sort();
  assert.equal(paths.length,286,'SUCCESSOR_EXACT_286');
  assert.deepEqual(c.files.map(r=>r.path),paths,'SUCCESSOR_COMPLETE_GIT_DELTA');
  assert.equal(new Set(paths).size,286);
  assert.deepEqual(Object.keys(c.reviews).sort(),Object.keys(REVIEW_PINS).sort(),'SUCCESSOR_REVIEW_GROUPS');
  for(const [id,pin]of Object.entries(REVIEW_PINS)){
   const review=c.reviews[id];exactKeys(review,['paths','review_sha256','status'],'SUCCESSOR_REVIEW_KEYS');
   assert.equal(review.status,'SOURCE_INTEGRITY_REVIEWED_NOT_OPERATIONAL_AUTHORITY','SUCCESSOR_REVIEW_REQUIRED:'+id);
   assert.equal(review.paths.length,pin.count);assert.deepEqual(review.paths,[...review.paths].sort());
   assert.equal(hash(Buffer.from(JSON.stringify(review.paths))),pin.paths_sha256,'SUCCESSOR_REVIEW_PATHS:'+id);
   assert.match(pin.review_sha256,/^[a-f0-9]{64}$/,'SUCCESSOR_REVIEW_RECEIPT_REQUIRED:'+id);
   assert.equal(review.review_sha256,pin.review_sha256,'SUCCESSOR_REVIEW_RECEIPT:'+id);
   assert.deepEqual(c.files.filter(r=>r.review_group===id).map(r=>r.path),review.paths,'SUCCESSOR_REVIEW_EXACT_SCOPE:'+id);
  }
  const covered=Object.values(c.reviews).flatMap(r=>r.paths).sort();assert.deepEqual(covered,paths,'SUCCESSOR_REVIEW_COMPLETE_PARTITION');
  let sealed=0,baseline=0,added=0;
  for(const row of c.files){
   exactKeys(row,['path','operation','before_sha256','before_blob_oid','before_mode','after_sha256','after_blob_oid','mode','review_group'],'SUCCESSOR_ROW_KEYS');
   const before=blob(c.base,row.path),after=blob(c.head,row.path);
   assert(after,'SUCCESSOR_DELETE_NOT_REVIEWED:'+row.path);
   assert.equal(row.operation,before?'MODIFY':'ADD');assert.equal(row.mode,after.mode);
   assert.equal(row.before_sha256,before?.sha256??null,'SUCCESSOR_GIT_BEFORE:'+row.path);
   assert.equal(row.before_blob_oid,before?.oid??null,'SUCCESSOR_GIT_BEFORE_BLOB:'+row.path);
   assert.equal(row.before_mode,before?.mode??null,'SUCCESSOR_GIT_BEFORE_MODE:'+row.path);
   assert.equal(row.after_sha256,after.sha256,'SUCCESSOR_GIT_AFTER:'+row.path);
   assert.equal(row.after_blob_oid,after.oid,'SUCCESSOR_GIT_AFTER_BLOB:'+row.path);
   const priorRow=composition.get(row.path)??blob(INTEGRATION_BASE,row.path);
   assert.equal(priorRow?.sha256??null,row.before_sha256,'SUCCESSOR_BEFORE_COMPOSITION:'+row.path);
   assert.equal(priorRow?.mode??null,row.before_mode,'SUCCESSOR_BEFORE_COMPOSITION_MODE:'+row.path);
   if(composition.has(row.path))sealed++;else if(before)baseline++;else added++;
  }
  assert.deepEqual({sealed,baseline,added},{sealed:17,baseline:22,added:247},'SUCCESSOR_COMPLETE_BEFORE_COMPOSITION');
  assert.match(LOCAL_REVIEWED_PATCH.review_sha256,/^[a-f0-9]{64}$/,'SUCCESSOR_LOCAL_REVIEW_REQUIRED');
  assert.deepEqual(c.local_patch,LOCAL_REVIEWED_PATCH,'SUCCESSOR_LOCAL_PATCH_PINS');
  assert.equal(new Set(c.local_patch.files.map(row=>row.path)).size,c.local_patch.files.length,'SUCCESSOR_LOCAL_PATCH_UNIQUE');
  for(const row of c.local_patch.files){
   exactKeys(row,['path','before_sha256','before_blob_oid','before_mode','after_sha256','mode'],'SUCCESSOR_LOCAL_ROW_KEYS');
   const before=blob(REVIEWED_SUCCESSOR_HEAD,row.path);
   assert.equal(row.before_sha256,before?.sha256??null,'SUCCESSOR_LOCAL_GIT_BEFORE:'+row.path);
   assert.equal(row.before_blob_oid,before?.oid??null,'SUCCESSOR_LOCAL_GIT_BLOB:'+row.path);
   assert.equal(row.before_mode,before?.mode??null,'SUCCESSOR_LOCAL_GIT_MODE:'+row.path);
   assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.equal(row.mode,'100644');assert.notEqual(row.before_sha256,row.after_sha256,'SUCCESSOR_LOCAL_NOT_A_DELTA');
  }
  noAuthority(c.authority);
  immutableDefinition={catalog:c,prior:{mode:'100644',sha256:prior.sha256},bridge:verifyNarrowReceiptBridge()};
 }
 return immutableDefinition;
}
export function verifyReviewedSuccessorCatalogIdentity(read,mode){
 assert.equal(mode(REVIEWED_SUCCESSOR_CATALOG),'100644','SUCCESSOR_CATALOG_MODE');
 definition(Buffer.from(read(REVIEWED_SUCCESSOR_CATALOG)));
}
export function verifyReviewedSuccessorCatalog(read,mode){
 assert.equal(mode(REVIEWED_SUCCESSOR_CATALOG),'100644','SUCCESSOR_CATALOG_MODE');
 const d=definition(Buffer.from(read(REVIEWED_SUCCESSOR_CATALOG)));
 // Independently check every literal local after-image even if a later reviewed
 // patch ever names one of the historical verifier support paths.
 for(const row of d.catalog.local_patch.files){
  assert.equal(hash(Buffer.from(read(row.path))),row.after_sha256,'SUCCESSOR_LOCAL_SOURCE_DRIFT:'+row.path);
  assert.equal(mode(row.path),row.mode,'SUCCESSOR_LOCAL_MODE_DRIFT:'+row.path);
 }
 for(const path of REVIEWED_SUCCESSOR_SUPPORT)assert.equal(mode(path),'100644','SUCCESSOR_SUPPORT_MODE:'+path);
}
export function reviewedSuccessorPaths(){
 const d=definition();
 return [...new Set([...d.catalog.files.map(r=>r.path),...d.catalog.local_patch.files.map(r=>r.path),REVIEWED_SUCCESSOR_PRIOR,REVIEWED_SUCCESSOR_CATALOG,...REVIEWED_SUCCESSOR_SUPPORT])].sort();
}
// Current consumers keep historical assertions at their pinned revisions and
// resolve only an explicitly reviewed later replacement for live bytes.
// Historical consumers and disposable fixtures can resolve the fixed committed
// successor without importing a mutable helper or requiring its local catalog.
// The complete live gate separately checks all 48 paths and the catalog seal.
let currentGitPaths;
const currentGitHashes=new Map();
function currentSourceHash(path){
 const base='da0e07dd23aee62f31cd669d0d090d948e6d1171',head='8c405008cdcc9f70b070da42743bcfe837a08dfa';
 if(!currentGitPaths)currentGitPaths=new Set(git(['diff','--no-renames','--name-only','-z',base,head,'--']).toString().split('\0').filter(Boolean));
 if(!currentGitPaths.has(path))return undefined;
 if(!currentGitHashes.has(path))currentGitHashes.set(path,hash(git(['show',head+':'+path])));
 return currentGitHashes.get(path);
}
export function reviewedSuccessorSourceHash(path,fallback){
 const c=definition().catalog;
 return currentSourceHash(path)??c.local_patch.files.find(row=>row.path===path)?.after_sha256??c.files.find(row=>row.path===path)?.after_sha256??fallback;
}
export function reviewedSuccessorLineage(){
 const d=definition();
 return {schema:'REVIEWED_SOURCE_SUCCESSOR_V1',base:REVIEWED_SUCCESSOR_BASE,head:REVIEWED_SUCCESSOR_HEAD,base_tree:BASE_TREE,head_tree:HEAD_TREE,
  prior_root:{...d.catalog.prior_root},catalog:{path:REVIEWED_SUCCESSOR_CATALOG,sha256:REVIEWED_SUCCESSOR_CATALOG_SHA256},
  reviews:structuredClone(d.catalog.reviews),local_patch:structuredClone(d.catalog.local_patch),narrow_receipt_bridge:structuredClone(d.bridge),
  complete_git_delta:286,before_composition:{sealed:17,baseline:22,added:247},support_paths:[...REVIEWED_SUCCESSOR_SUPPORT],
  legacy_harness_support_paths:[...LEGACY_HARNESS_SUPPORT],harness_trust_root:'EXISTING_TRUSTED_VERIFIER_NOT_SELF_SEALED_GIT_OBJECT',
  ...d.catalog.authority};
}
export function applyReviewedSuccessor(expected,historicalSupport=[]){
 const d=definition();
 assert.deepEqual(historicalSupport,[...LEGACY_HARNESS_SUPPORT],'SUCCESSOR_LEGACY_HARNESS_EXACT_SCOPE');
 assert(!expected.has(REVIEWED_SUCCESSOR_PRIOR),'SUCCESSOR_PRIOR_OVERLAP');
 expected.set(REVIEWED_SUCCESSOR_PRIOR,{...d.prior});
 for(const row of d.catalog.files){
  const before=expected.get(row.path);
  assert.equal(before?.sha256??null,row.before_sha256,'SUCCESSOR_COMPOSED_BEFORE:'+row.path);
  assert.equal(before?.mode??null,row.before_mode,'SUCCESSOR_COMPOSED_MODE:'+row.path);
  expected.set(row.path,{mode:row.mode,sha256:row.after_sha256});
 }
 for(const row of d.catalog.local_patch.files){
  // Historical support was deliberately excluded from the old independent
  // source map. Its local before-image is the fixed HEAD Git object, never an
  // invented prior-composition pin. Every live local after-image is also checked
  // independently by verifyReviewedSuccessorCatalog, before support deletion.
  const before=historicalSupport.includes(row.path)?blob(REVIEWED_SUCCESSOR_HEAD,row.path):expected.get(row.path);
  assert.equal(before?.sha256??null,row.before_sha256,'SUCCESSOR_LOCAL_COMPOSED_BEFORE:'+row.path);
  assert.equal(before?.mode??null,row.before_mode,'SUCCESSOR_LOCAL_COMPOSED_MODE:'+row.path);
  expected.set(row.path,{mode:row.mode,sha256:row.after_sha256});
 }
 assert(!expected.has(REVIEWED_SUCCESSOR_CATALOG),'SUCCESSOR_CATALOG_OVERLAP');
 expected.set(REVIEWED_SUCCESSOR_CATALOG,{mode:'100644',sha256:REVIEWED_SUCCESSOR_CATALOG_SHA256});
 for(const path of REVIEWED_SUCCESSOR_SUPPORT)expected.delete(path);
}
