// Offline Worker4 source/dependency packaging, never an invocation or deployer.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {assemble as coldAssemble} from '../cold-source-priority-20261019/materialize.mjs';
import {verifyIntegrationCandidate} from '../../../tests/helpers/integrationAdmission.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
export const CHANGED='src/features/vnext/dailyRuntime.ts';
export const TIMING_TEST='tests/vnextForwardCutoffRuntime.test.mjs';
export const TIMING_TEST_SHA256='cb0ef310499dd03d237afb9c3f49679d8050098b367d2de877d3d0d3ea638581';
export const CATALOG='scripts/operations/forward-cutoff-20261020/release-catalog.json';
// Exact final-freeze catalogue bytes; never a moving HEAD hash.
export const CATALOG_SHA256='393c22f2b6a042b80b03552651a6dae2cebebbaaa263e9f31f3f43fcad88f748';
export const WORKER4_ESZIP_SHA256='91bf73939e5dfde0740f7ba1ebf43830789d08b46cc1f8885583e451764501db';
export const WORKER4_READBACK=Object.freeze({schema:'WORKER4_EXACT_READBACK_SAFE_V1',scope:'AUTHORIZED_READONLY_PRODUCTION_READBACK',
 physical_sha256:'7d01ded5896cfaecd3f7b41b1f54f2c9b5284f14a9ef3150f6b4112a1edec1e8',
 status:'ACTIVE',updated_at:1792412666697,verify_jwt:true,import_map:false,runtime_files:44,matched:44,exact_inventory:true});
export const PRIOR_MORNING_RESULT=Object.freeze({scope:'AUTHORIZED_READONLY_PRODUCTION_SUMMARY',
 status:'EXPIRED',invocations:152,cursor:1358,plan_tasks:1358,predictions:0,source_revision_present:false,
 historical_forward_backfilled:false,new_natural_forward_success_claimed:false});
const COLD_MATERIALIZER='scripts/operations/cold-source-priority-20261019/materialize.mjs';
const COLD_CATALOG='scripts/operations/cold-source-priority-20261019/release-catalog.json';
const BASE_PAYLOAD_SHA256='34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const env=Object.freeze({PATH:'/usr/bin:/bin',TMPDIR:'/private/tmp',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
function safeName(name){assert.equal(typeof name,'string');assert.equal(posix.normalize(name),name,'FORWARD_PATH');assert(!name.startsWith('/')&&!name.split('/').includes('..'),'FORWARD_PATH');}
const physical=name=>{
 safeName(name);let path=root;const parts=name.split('/');
 for(const [i,part]of parts.entries()){path=resolve(path,part);const s=lstatSync(path);assert(!s.isSymbolicLink(),'FORWARD_SYMLINK');assert(i===parts.length-1?s.isFile():s.isDirectory(),'FORWARD_REGULAR_SOURCE');}
 return readFileSync(path);
};
export const readSource=name=>{safeName(name);return execFileSync('git',['--no-replace-objects','show',BASE+':'+name],{cwd:root,env,stdio:['ignore','pipe','pipe'],maxBuffer:8e6});};

/** The original cold-order CANDIDATE is Worker4, not its Worker3 recovery.
 * All 78 entries (44 runtime + 34 license/type files) keep their fixed order. */
export function worker4Baseline(){
 for(const path of [COLD_MATERIALIZER,COLD_CATALOG])assert.deepEqual(physical(path),readSource(path),'FORWARD_BASE_PACKAGER_DRIFT:'+path);
 const c=JSON.parse(readSource(COLD_CATALOG)),result=coldAssemble('candidate',readSource);
 assert.equal(result.sha256,BASE_PAYLOAD_SHA256,'FORWARD_WORKER4_BASE_PAYLOAD');
 assert.equal(result.payload.files.length,78);assert.equal(c.files.filter(r=>!r.static).length,44);
 assert.equal(c.baseline.sdk,'2.57.4');assert.equal(result.payload.verify_jwt,true);
 return {...result,source_rows:c.files};
}
function replacement(bytes,baseline){
 const text=Buffer.from(bytes).toString('utf8');assert(Buffer.from(text).equals(Buffer.from(bytes)),'FORWARD_UTF8');
 return {...baseline.payload,files:baseline.payload.files.map(f=>f.name===CHANGED?{name:f.name,content:text}:{...f})};
}
const encode=payload=>Buffer.from(JSON.stringify(payload,null,2)+'\n');
/** Pure sealing proposal. The caller must independently confirm the exact
 * runtime SHA; this does not write a catalogue or authorize any release. */
export function proposeReleaseCatalog(expectedRuntimeSha256,read=physical){
 assert.match(expectedRuntimeSha256,/^[a-f0-9]{64}$/,'FORWARD_RUNTIME_SEAL_REQUIRED');
 const baseline=worker4Baseline(),current=Buffer.from(read(CHANGED));
 assert.equal(sha(current),expectedRuntimeSha256,'FORWARD_RUNTIME_NOT_CONFIRMED');
 assert.equal(sha(read(TIMING_TEST)),TIMING_TEST_SHA256,'FORWARD_CURRENT_TIMING_TEST_DRIFT');
 const next=replacement(current,baseline),nextBytes=encode(next),old=new Map(baseline.payload.files.map(f=>[f.name,Buffer.from(f.content)]));
 assert.notEqual(sha(old.get(CHANGED)),expectedRuntimeSha256,'FORWARD_RUNTIME_UNCHANGED');
 return {schema:'C_FORWARD_CUTOFF_RELEASE_V1',status:'SEALED_SOURCE_CANDIDATE_NOT_DEPLOYED',base:BASE,
  metadata:Object.fromEntries(Object.entries(baseline.payload).filter(([k])=>k!=='files')),
  baseline:{version:4,physical_eszip_sha256:WORKER4_ESZIP_SHA256,source_payload_sha256:baseline.sha256,sdk:'2.57.4',verify_jwt:true,runtime_files:44,payload_files:78,readback:WORKER4_READBACK},
  scope:{changed_runtime_files:1,changed_file:CHANGED,sql:false,auth_rls_change:false,caller_activation:false,source_admission:false,threshold_change:false,forward_backfill:false,manual_business_invocation:false,publication:false},
  prior_morning_observation:PRIOR_MORNING_RESULT,
  current_timing_controls:{path:TIMING_TEST,sha256:TIMING_TEST_SHA256,dynamic_controls:22,current_tree_not_historical:true,late_bootstrap_required:true,successful_pre_cutoff_commit_reply_after_cutoff_required:true,initial_attempt_snapshot_immutable:true},
  recovery_meaning:'FIXED_WORKER4_SOURCE_AND_DEPENDENCIES_FUNCTIONAL_EQUIVALENCE_NOT_PHYSICAL_ESZIP_REBUILD',production_authorized:false,
  payloads:{candidate:{sha256:sha(nextBytes),bytes:nextBytes.length},recovery:{sha256:baseline.sha256,bytes:baseline.bytes.length}},
  files:baseline.payload.files.map(f=>{const before=old.get(f.name),after=f.name===CHANGED?current:before,source=baseline.source_rows.find(r=>r.name===f.name);
   return {name:f.name,static:source.static,type_only:source.type_only===true,before_sha256:sha(before),before_bytes:before.length,after_sha256:sha(after),after_bytes:after.length};})};
}
export function catalog(read=physical){
 assert.match(CATALOG_SHA256,/^[a-f0-9]{64}$/,'FORWARD_CATALOG_UNSEALED');
 const bytes=Buffer.from(read(CATALOG));assert.equal(sha(bytes),CATALOG_SHA256,'FORWARD_CATALOG_DRIFT');
 const c=JSON.parse(bytes),changed=c.files?.find(r=>r.name===CHANGED);
 assert(changed,'FORWARD_RUNTIME_SEAL_MISSING');
 assert.deepEqual(c,proposeReleaseCatalog(changed.after_sha256,read),'FORWARD_CATALOG_CONTRACT');
 return c;
}
export function assemble(variant='candidate',read=physical){
 assert(['candidate','recovery'].includes(variant),'FORWARD_FIXED_VARIANT');
 // Current bytes, modes, immutable-base files and unknown paths are checked
 // even for rollback. Never launder a changed live source through git show.
 verifyIntegrationCandidate(read);
 const c=catalog(read),baseline=worker4Baseline(),candidate=replacement(read(CHANGED),baseline);
 const payload=variant==='candidate'?candidate:baseline.payload,bytes=encode(payload);
 assert.equal(bytes.length,c.payloads[variant].bytes,'FORWARD_PAYLOAD_SIZE');assert.equal(sha(bytes),c.payloads[variant].sha256,'FORWARD_PAYLOAD_DRIFT');
 verifyIntegrationCandidate(read);
 return {payload,bytes,sha256:sha(bytes)};
}
export function materialize(variant='candidate'){
 const result=assemble(variant),relative='build/forward-cutoff-20261020/'+variant;
 assert.equal(execFileSync('git',['check-ignore','--',relative+'/deploy-args.json'],{cwd:root,env,stdio:['ignore','pipe','pipe'],encoding:'utf8'}).trim(),relative+'/deploy-args.json','FORWARD_OUTPUT_NOT_IGNORED');
 let parent=root;for(const part of ['build','forward-cutoff-20261020']){parent=resolve(parent,part);mkdirSync(parent,{recursive:true,mode:0o700});assert(lstatSync(parent).isDirectory()&&!lstatSync(parent).isSymbolicLink(),'FORWARD_OUTPUT_SYMLINK');}
 const output=resolve(root,relative);mkdirSync(output,{mode:0o700});
 for(const file of result.payload.files){const target=resolve(output,file.name);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,file.content,{flag:'wx',mode:0o600});}
 writeFileSync(resolve(output,'deploy-args.json'),result.bytes,{flag:'wx',mode:0o600});
 return {status:'MATERIALIZED_NOT_DEPLOYED',variant,sha256:result.sha256,files:78,runtime_files:44,production_changed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert(process.argv.length<=3);console.log(JSON.stringify(materialize(process.argv[2]??'candidate')));}
