import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {MEMBER_CONTINUITY_BASE,MEMBER_CONTINUITY_MANIFEST,MEMBER_CONTINUITY_RUNTIME,
 verifyMemberContinuity,memberContinuityHistoricalRead,memberContinuityHistoricalReader,memberContinuityWebsiteOperations} from './helpers/memberContinuityAdmission.mjs';
import {integrationInventory,integrationPhysicalRead,integrationPhysicalMode} from './helpers/integrationAdmission.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{maxBuffer:2e6});
const prior=path=>git(['show',MEMBER_CONTINUITY_BASE+':'+path]);
const helper='tests/helpers/memberContinuityAdmission.mjs',integration='tests/helpers/integrationAdmission.mjs';
const predecessor='docs/operations/evidence/r9-functional-source-closure-20261017.json';

test('continuity is a separately admitted exact two-source candidate with original receipts unchanged',()=>{
 const m=verifyMemberContinuity();assert.equal(m.base,MEMBER_CONTINUITY_BASE);assert.equal(m.production_authorized,false);
 assert.deepEqual(m.files,MEMBER_CONTINUITY_RUNTIME);
 for(const path of [predecessor,'docs/operations/evidence/r10-functional-source-closure-20261017.json','docs/operations/evidence/core-member-integration-20261017-r10.json'])assert.deepEqual(readFileSync(path),prior(path));
 for(const row of m.files){assert.equal(hash(readFileSync(row.path)),row.after_sha256);assert.equal(hash(prior(row.path)),row.before_sha256);}
 m.files[0].after_sha256='0'.repeat(64);assert.notEqual(verifyMemberContinuity().files[0].after_sha256,m.files[0].after_sha256);
});
test('historical translation is limited to exact current bytes of only two paths and returns copies',()=>{
 for(const row of MEMBER_CONTINUITY_RUNTIME){
  const live=readFileSync(row.path),expected=prior(row.path);
  assert.deepEqual(memberContinuityHistoricalRead(row.path,live),expected);
  const copy=memberContinuityHistoricalRead(row.path,live);copy.fill(0);assert.deepEqual(memberContinuityHistoricalRead(row.path,live),expected);
  assert.equal(memberContinuityHistoricalRead(row.path,live.toString()),expected.toString());
 }
 const sentinel=Buffer.from('UNCHANGED_INPUT');
 for(const path of ['src/lib/supabase.ts','../outside.ts','HEAD:src/features/vnext/member.ts','unreviewed.ts'])assert.equal(memberContinuityHistoricalRead(path,sentinel),sentinel);
});
test('injected bytes, text, surrogate drift and source errors are never replaced by good historical bytes',()=>{
 for(const row of MEMBER_CONTINUITY_RUNTIME){
  const live=readFileSync(row.path),buffer=Buffer.concat([live,Buffer.from('INJECTED')]),text=live.toString()+'INJECTED',surrogate=live.toString()+'\uD800';
  for(const value of [buffer,text,surrogate])assert.equal(memberContinuityHistoricalRead(row.path,value),value);
  const reader=memberContinuityHistoricalReader(path=>path===row.path?buffer:readFileSync(path));assert.equal(reader(row.path),buffer);
  const failure=Error('ORIGINAL_SOURCE_THROW');assert.throws(()=>memberContinuityHistoricalReader(()=>{throw failure;})(row.path),error=>error===failure);
  const poison=Buffer.from(live);poison.valueOf=()=>buffer;assert.deepEqual(memberContinuityHistoricalRead(row.path,poison),prior(row.path));
 }
});
test('complete live admission still rejects missing, unknown, altered-source, mode and authority input',()=>{
 const paths=integrationInventory(),row=MEMBER_CONTINUITY_RUNTIME[0],live=readFileSync(row.path);
 assert.throws(()=>verifyMemberContinuity(integrationPhysicalRead,[...paths,'src/unreviewed.ts']),/UNKNOWN_PATH/);
 assert.throws(()=>verifyMemberContinuity(integrationPhysicalRead,paths.filter(path=>path!==row.path)),/UNKNOWN_PATH/);
 assert.throws(()=>verifyMemberContinuity(path=>path===row.path?Buffer.concat([live,Buffer.from('DRIFT')]):integrationPhysicalRead(path),paths),/SOURCE_DRIFT|CONTINUITY_SOURCE/);
 assert.throws(()=>verifyMemberContinuity(integrationPhysicalRead,paths,path=>path===row.path?'100755':integrationPhysicalMode(path)),/MODE/);
 const forged=JSON.parse(readFileSync(MEMBER_CONTINUITY_MANIFEST));forged.production_authorized=true;
 assert.throws(()=>verifyMemberContinuity(path=>path===MEMBER_CONTINUITY_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path),paths));
});
test('new website candidate overlays exactly two targets and byte counts while preserving all other R9 facts',()=>{
 const old=JSON.parse(readFileSync(predecessor)).release.B.operations,current=memberContinuityWebsiteOperations();
 assert.equal(current.length,24);assert.deepEqual(current.map(row=>row.path),old.map(row=>row.path));
 let changed=0;for(let i=0;i<old.length;i++){
  const runtime=MEMBER_CONTINUITY_RUNTIME.find(row=>row.path===old[i].path);
  if(!runtime){assert.deepEqual(current[i],old[i]);continue;}
  changed++;assert.deepEqual(Object.keys(current[i]).filter(key=>JSON.stringify(current[i][key])!==JSON.stringify(old[i][key])).sort(),['source_bytes','target_sha256']);
  assert.equal(current[i].target_sha256,runtime.after_sha256);assert.equal(current[i].source_bytes,readFileSync(runtime.path).length);
 }
 assert.equal(changed,2);assert.deepEqual(readFileSync(predecessor),prior(predecessor));
});

async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'ma-member-continuity-')),put=(path,bytes)=>{mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);};
 put('.git',Buffer.from('gitdir: '+git(['rev-parse','--absolute-git-dir']).toString().trim()+'\n'));
 for(const path of [helper,MEMBER_CONTINUITY_MANIFEST,...MEMBER_CONTINUITY_RUNTIME.map(row=>row.path)])put(path,readFileSync(path));
 // Only this disposable physical-file fixture substitutes the full-tree gate.
 // The ordinary tests above execute the real complete composition verifier.
 // The substitute records every boundary and can reject a newly invalid live
 // tree, independently of this fixture's actual source/mode/receipt checks.
 put(integration,Buffer.from("export let checks=0;let blocked=false;export const integrationInventory=()=>[];export const integrationPhysicalMode=()=> '100644';export function verifyIntegrationCandidate(){checks++;if(blocked)throw Error('FIXTURE_LIVE_ADMISSION_REJECTED');}export const blockFixtureAdmission=value=>{blocked=value;};\n"));
 return {dir,put,live:await import(pathToFileURL(join(dir,helper)).href),gate:await import(pathToFileURL(join(dir,integration)).href),close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('warm historical readers recheck physical bytes, modes, deletions, symlinks and current receipt on each invocation',async()=>{
 const f=await fixture();try{
  for(const row of MEMBER_CONTINUITY_RUNTIME){
   const path=row.path,target=join(f.dir,path),good=readFileSync(path),reader=f.live.memberContinuityHistoricalReader(()=>good);
   const checks=f.gate.checks;assert.deepEqual(reader(path),prior(path));assert.equal(f.gate.checks,checks+2);
   f.gate.blockFixtureAdmission(true);assert.throws(()=>reader(path),/LIVE_ADMISSION_REJECTED/);f.gate.blockFixtureAdmission(false);
   f.put(path,Buffer.concat([good,Buffer.from('LATE_DRIFT')]));assert.throws(()=>reader(path),/CONTINUITY_SOURCE/);
   f.put(path,good);chmodSync(target,0o755);assert.throws(()=>reader(path),/CONTINUITY_MODE/);
   chmodSync(target,0o644);rmSync(target);assert.throws(()=>reader(path),{code:'ENOENT'});
   f.put('link-target.ts',good);symlinkSync(join(f.dir,'link-target.ts'),target);assert.throws(()=>reader(path),/REGULAR_FILE/);
   rmSync(target);mkdirSync(target);assert.throws(()=>reader(path),/REGULAR_FILE/);
   rmSync(target,{recursive:true});f.put(path,good);assert.deepEqual(reader(path),prior(path));
  }
  const good=readFileSync(MEMBER_CONTINUITY_MANIFEST),row=MEMBER_CONTINUITY_RUNTIME[0],bytes=readFileSync(row.path);
  f.put(MEMBER_CONTINUITY_MANIFEST,Buffer.from('{invalid'));assert.throws(()=>f.live.memberContinuityHistoricalRead(row.path,bytes));
  f.put(MEMBER_CONTINUITY_MANIFEST,good);assert.deepEqual(f.live.memberContinuityHistoricalRead(row.path,bytes),prior(row.path));
 }finally{f.close();}
});
test('historical primitive never trusts a forged scope, parent, authority flag, test or website descriptor',async()=>{
 const f=await fixture();try{
  const original=JSON.parse(readFileSync(MEMBER_CONTINUITY_MANIFEST)),row=MEMBER_CONTINUITY_RUNTIME[0],bytes=readFileSync(row.path);
  const changes=[m=>m.base='HEAD',m=>m.files.pop(),m=>m.files.push({...m.files[0],path:'src/unreviewed.ts'}),m=>m.files[0].before_sha256='0'.repeat(64),m=>m.files[0].after_sha256='0'.repeat(64),m=>m.files[0].mode='100755',m=>m.test.sha256='0'.repeat(64),m=>m.website.predecessor_path='unreviewed.json',m=>m.website.operation_count=25,
   ...['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].map(flag=>m=>m[flag]=true)];
  for(const change of changes){const m=structuredClone(original);change(m);f.put(MEMBER_CONTINUITY_MANIFEST,Buffer.from(JSON.stringify(m)));assert.throws(()=>f.live.memberContinuityHistoricalRead(row.path,bytes));}
 }finally{f.close();}
});
