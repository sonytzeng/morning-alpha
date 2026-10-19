// The immutable B24 assertions use only the exact pre-copy Owner view after
// full current successor admission; all other source reads stay current.
import {ownerStatusCopyHistoricalFsRead as readFileSync} from './helpers/ownerStatusCopyAdmission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {FRONTEND_TYPE_CLOSURE_BASE,FRONTEND_TYPE_CLOSURE_MANIFEST,FRONTEND_TYPE_CLOSURE_SOURCES,
 FRONTEND_TYPE_CLOSURE_CONSUMERS,FRONTEND_TYPE_CLOSURE_DTO,FRONTEND_TYPE_CLOSURE_REMOVED,FRONTEND_TYPE_CLOSURE_LIVE_BEFORE,
 verifyHistoricalFrontendTypeClosureForOwnerCopy as verifyFrontendTypeClosure,historicalFrontendTypeClosureWebsiteOperationsForOwnerCopy as frontendTypeClosureWebsiteOperations,frontendTypeClosureHistoricalRead,frontendTypeClosureHistoricalReader} from './helpers/frontendTypeClosureAdmission.mjs';
import {memberContinuityWebsiteOperations} from './helpers/memberContinuityAdmission.mjs';
import {integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHistoricalRead,integrationParentRead} from './helpers/integrationAdmission.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{maxBuffer:2e6});
const prior=path=>git(['show',FRONTEND_TYPE_CLOSURE_BASE+':'+path]);
const originalReceipt=()=>JSON.parse(readFileSync(FRONTEND_TYPE_CLOSURE_MANIFEST));

test('frontend closure is separately admitted with six exact sources and immutable old release receipts',()=>{
 const manifest=verifyFrontendTypeClosure();assert.equal(manifest.base,FRONTEND_TYPE_CLOSURE_BASE);
 assert.equal(manifest.production_authorized,false);assert.deepEqual(manifest.files.map(row=>row.path),FRONTEND_TYPE_CLOSURE_SOURCES);
 for(const path of ['docs/operations/evidence/member-continuity-20261018.json','docs/operations/evidence/core-member-integration-20261018-continuity.json',
  'docs/operations/evidence/r9-functional-source-closure-20261017.json','docs/operations/evidence/r10-functional-source-closure-20261017.json',
  'docs/operations/evidence/owner-release-review-r8-20261017.json'])assert.deepEqual(readFileSync(path),prior(path));
 for(const row of manifest.files){assert.equal(hash(readFileSync(row.path)),row.after_sha256);
  if(row.path===FRONTEND_TYPE_CLOSURE_DTO)assert.equal(row.before_sha256,null);
  else assert.equal(hash(prior(row.path)),row.before_sha256);
 }
 manifest.files[0].after_sha256='0'.repeat(64);assert.notEqual(verifyFrontendTypeClosure().files[0].after_sha256,manifest.files[0].after_sha256);
});

test('new catalogue is exactly old eighteen src operations plus five import-only modifications and one DTO addition',()=>{
 const old=memberContinuityWebsiteOperations(),current=frontendTypeClosureWebsiteOperations();
 assert.equal(current.length,24);assert.equal(new Set(current.map(row=>row.path)).size,24);
 assert.deepEqual(current.map(row=>row.path),current.map(row=>row.path).sort());
 assert.equal(current.filter(row=>row.operation==='MODIFY').length,13);assert.equal(current.filter(row=>row.operation==='ADD').length,11);
 for(const row of old.filter(row=>row.path.startsWith('src/')))assert.deepEqual(current.find(other=>other.path===row.path),row);
 assert.deepEqual(old.filter(row=>!row.path.startsWith('src/')).map(row=>row.path).sort(),FRONTEND_TYPE_CLOSURE_REMOVED);
 for(const row of current){assert(row.path.startsWith('src/'));assert.equal(hash(readFileSync(row.path)),row.target_sha256);assert.equal(readFileSync(row.path).length,row.source_bytes);}
 for(const path of FRONTEND_TYPE_CLOSURE_CONSUMERS){const row=current.find(row=>row.path===path);assert.equal(row.operation,'MODIFY');assert.equal(row.classification,'CLIENT_UI_TYPE_IMPORT_ONLY_SOURCE');assert.equal(row.live_before_sha256,FRONTEND_TYPE_CLOSURE_LIVE_BEFORE[path]);}
 const dto=current.find(row=>row.path===FRONTEND_TYPE_CLOSURE_DTO);assert.equal(dto.operation,'ADD');assert.equal(dto.live_before_sha256,null);assert.equal(dto.classification,'CLIENT_UI_TYPE_CONTRACT_SOURCE');
 for(const path of FRONTEND_TYPE_CLOSURE_REMOVED){assert(!current.some(row=>row.path===path));assert.deepEqual(readFileSync(path),prior(path));}
});

test('captured UI preimages preserve the exact known TradingLab EOF difference without altering Git lineage',()=>{
 const manifest=verifyFrontendTypeClosure(),operations=manifest.website.operations;
 for(const path of FRONTEND_TYPE_CLOSURE_CONSUMERS){
  const source=manifest.files.find(row=>row.path===path),operation=operations.find(row=>row.path===path),gitBytes=prior(path);
  assert.equal(source.before_sha256,hash(gitBytes));assert.equal(operation.live_before_sha256,FRONTEND_TYPE_CLOSURE_LIVE_BEFORE[path]);
  if(path==='src/features/research/tradingLab.ts'){
   assert.equal(gitBytes.length,4869);assert.equal(gitBytes.at(-1),10);
   assert.notEqual(operation.live_before_sha256,source.before_sha256);
   assert.equal(hash(gitBytes.subarray(0,-1)),operation.live_before_sha256);
  }else assert.equal(operation.live_before_sha256,source.before_sha256);
 }
});

test('complete current admission rejects source, mode, missing and unknown inventory drift',()=>{
 const paths=integrationInventory(),row=originalReceipt().files[0],good=readFileSync(row.path);
 assert.throws(()=>verifyFrontendTypeClosure(path=>path===row.path?Buffer.concat([good,Buffer.from('DRIFT')]):integrationPhysicalRead(path),paths));
 assert.throws(()=>verifyFrontendTypeClosure(integrationPhysicalRead,paths,path=>path===row.path?'100755':integrationPhysicalMode(path)),/MODE/);
 assert.throws(()=>verifyFrontendTypeClosure(integrationPhysicalRead,paths.filter(path=>path!==row.path)),/UNKNOWN_PATH/);
 assert.throws(()=>verifyFrontendTypeClosure(integrationPhysicalRead,[...paths,'src/unreviewed-contract.ts']),/UNKNOWN_PATH/);
 const failure=Error('SOURCE_CALLBACK_THROW');assert.throws(()=>verifyFrontendTypeClosure(path=>{if(path===row.path)throw failure;return integrationPhysicalRead(path);}),error=>error===failure);
});

test('forged scope, lineage, authority, operation facts and equality fixture references fail closed',()=>{
 const manifest=originalReceipt();
 const changes=[m=>m.base='HEAD',m=>m.files.pop(),m=>m.files.push({...m.files[0],path:'src/unreviewed.ts'}),
  m=>m.files[0].before_sha256='0'.repeat(64),m=>m.files[0].after_sha256='0'.repeat(64),m=>m.files[0].mode='100755',
  m=>m.website.operations[0].source_bytes++,m=>m.website.operations[0].operation=m.website.operations[0].operation==='ADD'?'MODIFY':'ADD',m=>m.website.operations[0].path='supabase/unreviewed.ts',
  m=>m.website.operations.pop(),m=>m.website.removed_build_only_paths.pop(),m=>m.website.predecessor_sha256='0'.repeat(64),
  m=>m.type_equivalence.fixture_path='tests/unreviewed.types.ts',m=>m.type_equivalence.runner_path='tests/unreviewed.test.mjs',
  ...['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].map(flag=>m=>m[flag]=true)];
 for(const change of changes){const forged=structuredClone(manifest);change(forged);
  assert.throws(()=>verifyFrontendTypeClosure(path=>path===FRONTEND_TYPE_CLOSURE_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path)));
 }
});

test('existing historical readers restore only exact admitted consumer bytes and preserve injected drift',()=>{
 for(const path of FRONTEND_TYPE_CLOSURE_CONSUMERS){const good=integrationPhysicalRead(path),bad=Buffer.concat([good,Buffer.from('NEGATIVE_CONSUMER')]);
  for(const view of ['core','member']){
   assert.deepEqual(integrationHistoricalRead(view,path,good),integrationParentRead(view,path));
   assert.equal(integrationHistoricalRead(view,path,bad),bad);
  }
 }
});

const contract='src/features/decision-v1/contract.ts';
test('A22 predecessor adapter translates only the exact admitted contract and returns independent bytes',()=>{
 const live=readFileSync(contract),expected=prior(contract);
 assert.deepEqual(frontendTypeClosureHistoricalRead(contract,live),expected);
 assert.equal(frontendTypeClosureHistoricalRead(contract,live.toString()),expected.toString());
 const copy=frontendTypeClosureHistoricalRead(contract,live);copy.fill(0);
 assert.deepEqual(frontendTypeClosureHistoricalRead(contract,live),expected);
 const sentinel=Buffer.from('UNCHANGED_INPUT');
 for(const path of [...FRONTEND_TYPE_CLOSURE_CONSUMERS.filter(path=>path!==contract),FRONTEND_TYPE_CLOSURE_DTO,'unreviewed.ts','../outside.ts','HEAD:'+contract]){
  assert.equal(frontendTypeClosureHistoricalRead(path,sentinel),sentinel);
 }
});

test('A22 adapter never replaces injected buffers, text, unpaired surrogates or source exceptions',()=>{
 const live=readFileSync(contract),buffer=Buffer.concat([live,Buffer.from('INJECTED')]),text=live.toString()+'INJECTED',surrogate=live.toString()+'\uD800';
 for(const value of [buffer,text,surrogate])assert.equal(frontendTypeClosureHistoricalRead(contract,value),value);
 const reader=frontendTypeClosureHistoricalReader(path=>path===contract?buffer:readFileSync(path));assert.equal(reader(contract),buffer);
 const failure=Error('ORIGINAL_SOURCE_THROW');assert.throws(()=>frontendTypeClosureHistoricalReader(()=>{throw failure;})(contract),error=>error===failure);
 const poison=Buffer.from(live);poison.valueOf=()=>buffer;
 assert.deepEqual(frontendTypeClosureHistoricalRead(contract,poison),prior(contract));
});

async function historicalFixture(){
 const dir=mkdtempSync(join(tmpdir(),'ma-frontend-contract-'));
 const put=(path,bytes)=>{mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);};
 const helper='tests/helpers/frontendTypeClosureAdmission.mjs',integration='tests/helpers/integrationAdmission.mjs';
 put('.git',Buffer.from('gitdir: '+git(['rev-parse','--absolute-git-dir']).toString().trim()+'\n'));
 for(const path of [helper,'tests/helpers/ownerStatusCopyAdmission.mjs',FRONTEND_TYPE_CLOSURE_MANIFEST,contract])put(path,readFileSync(path));
 // Disposable physical-file fixture only: count every public boundary and
 // independently reject a changed complete live admission. Ordinary tests
 // above use the real full-tree gate, never this substitute.
 put(integration,Buffer.from("export let checks=0;let blocked=false;export const integrationInventory=()=>[];export const integrationPhysicalMode=()=> '100644';export const integrationPhysicalRead=()=>{throw Error('FIXTURE_UNEXPECTED_OWNER_READ');};export function verifyIntegrationCandidate(){checks++;if(blocked)throw Error('FIXTURE_LIVE_ADMISSION_REJECTED');}export const blockFixtureAdmission=value=>{blocked=value;};\n"));
 put('tests/helpers/memberContinuityAdmission.mjs',Buffer.from("export function memberContinuityWebsiteOperations(){throw Error('FIXTURE_UNEXPECTED_WEBSITE_REBUILD');}\n"));
 return {dir,put,live:await import(pathToFileURL(join(dir,helper)).href),gate:await import(pathToFileURL(join(dir,integration)).href),close:()=>rmSync(dir,{recursive:true,force:true})};
}

test('warm A22 reader rechecks current admission, physical bytes, mode, deletion, symlink and receipt',async()=>{
 const fixture=await historicalFixture();try{
  const good=readFileSync(contract),target=join(fixture.dir,contract),reader=fixture.live.frontendTypeClosureHistoricalReader(()=>good);
  const checks=fixture.gate.checks;assert.deepEqual(reader(contract),prior(contract));assert.equal(fixture.gate.checks,checks+2);
  fixture.gate.blockFixtureAdmission(true);assert.throws(()=>reader(contract),/LIVE_ADMISSION_REJECTED/);fixture.gate.blockFixtureAdmission(false);
  fixture.put(contract,Buffer.concat([good,Buffer.from('LATE_DRIFT')]));assert.throws(()=>reader(contract),/HISTORICAL_SOURCE/);
  fixture.put(contract,good);chmodSync(target,0o755);assert.throws(()=>reader(contract),/HISTORICAL_MODE/);
  chmodSync(target,0o644);rmSync(target);assert.throws(()=>reader(contract),{code:'ENOENT'});
  fixture.put('link-target.ts',good);symlinkSync(join(fixture.dir,'link-target.ts'),target);assert.throws(()=>reader(contract),/REGULAR_FILE/);
  rmSync(target);mkdirSync(target);assert.throws(()=>reader(contract),/REGULAR_FILE/);
  rmSync(target,{recursive:true});fixture.put(contract,good);
  const seal=readFileSync(FRONTEND_TYPE_CLOSURE_MANIFEST);fixture.put(FRONTEND_TYPE_CLOSURE_MANIFEST,Buffer.from('{invalid'));
  assert.throws(()=>reader(contract));fixture.put(FRONTEND_TYPE_CLOSURE_MANIFEST,seal);assert.deepEqual(reader(contract),prior(contract));
 }finally{fixture.close();}
});

test('A22 adapter cannot accept a forged lineage, source catalogue, mode, predecessor or authority flag',async()=>{
 const fixture=await historicalFixture();try{
  const manifest=originalReceipt(),good=readFileSync(contract),changes=[m=>m.base='HEAD',m=>m.files.pop(),
   m=>m.files.push({...m.files[0],path:'src/unreviewed.ts'}),m=>m.files[0].before_sha256='0'.repeat(64),m=>m.files[0].mode='100755',
   m=>m.type_equivalence.fixture_path='tests/unreviewed.ts',
   ...['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].map(flag=>m=>m[flag]=true)];
  for(const change of changes){const forged=structuredClone(manifest);change(forged);fixture.put(FRONTEND_TYPE_CLOSURE_MANIFEST,Buffer.from(JSON.stringify(forged)));
   assert.throws(()=>fixture.live.frontendTypeClosureHistoricalRead(contract,good));
  }
 }finally{fixture.close();}
});
