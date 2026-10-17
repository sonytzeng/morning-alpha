import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,symlinkSync,mkdtempSync,rmSync,mkdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {vnextPredecessorViews,vnextPrior}from'./helpers/vnextIntegrity.mjs';
import {INTEGRATION_BASE,INTEGRATION_PARENTS,INTEGRATION_MANIFEST,integrationHash,integrationScope,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHistoricalRead,integrationParentRead,verifyIntegrationCandidate,readRegularIntegrationFile,integrationSealRow} from './helpers/integrationAdmission.mjs';
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64e6});
test('complete composition is independently admitted against fixed parents and original receipts',()=>{
 const m=verifyIntegrationCandidate();assert.equal(m.production_authorized,false);
 assert.deepEqual(m.parents,INTEGRATION_PARENTS);assert.equal(m.base,INTEGRATION_BASE);
 for(const [view,path]of [['core','docs/operations/evidence/core-evidence-candidate-20261017.json'],['member','docs/vnext/transition.json']])assert.deepEqual(integrationPhysicalRead(path),integrationParentRead(view,path));
 for(const p of ['docs/operations/evidence/staged-a-transition-20261014.json','docs/operations/evidence/staged-b2-transition-20261014.json','docs/operations/evidence/staged-c-transition-20261014.json'])assert.equal(integrationPhysicalRead(p).toString(),git(['show',INTEGRATION_BASE+':'+p]));
 assert.equal(integrationPhysicalRead('package-lock.json').toString(),git(['show',INTEGRATION_BASE+':package-lock.json']));
 assert.equal(integrationPhysicalRead('.nvmrc').toString().trim(),'22.14.0');
 assert.equal(integrationPhysicalRead('docs/operations/evidence/core-member-integration-20261017.json').toString(),git(['show','8146eb4be02acd1a8ccf55e9b47c48cae762dc5e:docs/operations/evidence/core-member-integration-20261017.json']));
 assert.equal(integrationPhysicalRead('docs/operations/evidence/core-member-integration-20261017-r2.json').toString(),git(['show','cc167304814b2223977a36802b2666ea8203ff36:docs/operations/evidence/core-member-integration-20261017-r2.json']));
});
test('new tree preserves dynamic loopback, bounded opt-in tmpfs and exact official Auth digest',()=>{
 const p='scripts/academy-v11/auth-environment.mjs',bytes=integrationPhysicalRead(p);
 assert.deepEqual(bytes,integrationParentRead('member',p));
 assert.match(bytes.toString(),/127\.0\.0\.1:\$\{localAuthPort\}:9999/);
 assert.match(bytes.toString(),/MA_ISOLATED_DB_TMPFS==='1'/);assert.match(bytes.toString(),/size=268435456/);
 assert.match(bytes.toString(),/ghcr\.io\/supabase\/gotrue@sha256:2b352c02adf11a2025cd5993c246ef85db73743553c39194d2b1862d1cc4d1fd/);
});
test('every admitted byte, exact mode, deleted path and unknown inventory remain fail closed',()=>{
 const m=verifyIntegrationCandidate(),paths=integrationInventory();
 for(const row of m.files){
  assert.throws(()=>verifyIntegrationCandidate(p=>p===row.path?Buffer.concat([integrationPhysicalRead(p),Buffer.from('DRIFT')]):integrationPhysicalRead(p),paths));
 }
 const p=m.files[0].path;
 assert.throws(()=>verifyIntegrationCandidate(q=>{if(q===p)throw Object.assign(Error('deleted'),{code:'ENOENT'});return integrationPhysicalRead(q);},paths));
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,[...paths,'src/unreviewed.ts']),/UNKNOWN/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths.filter(q=>q!==p)),/UNKNOWN/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths,q=>q===p?'120000':integrationPhysicalMode(q)),/MODE/);
});
test('receipt cannot grant deployment, replace parents, remove rows or widen reviewed scope',()=>{
 const original=JSON.parse(integrationPhysicalRead(INTEGRATION_MANIFEST)),paths=integrationInventory();
 for(const mutate of [m=>m.parents.core='HEAD',m=>m.parents.member=INTEGRATION_BASE,m=>m.files.pop(),m=>m.files.push({...m.files[0],path:'rogue.ts'}),...['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].map(k=>m=>m[k]=true)]){
  const m=structuredClone(original);mutate(m);assert.throws(()=>verifyIntegrationCandidate(p=>p===INTEGRATION_MANIFEST?Buffer.from(JSON.stringify(m)):integrationPhysicalRead(p),paths));
 }
 assert.equal(new Set(integrationScope()).size,integrationScope().length);
});
test('late source change is rechecked, never hidden by prior successful admission or injected reader',()=>{
 verifyIntegrationCandidate();const p='supabase/functions/get-report-payload/index.ts',good=integrationPhysicalRead(p),bad=Buffer.concat([good,Buffer.from('NEGATIVE_READER')]);
 for(const v of ['core','member']){
  assert.deepEqual(integrationHistoricalRead(v,p,good),integrationParentRead(v,p));
  assert.deepEqual(integrationHistoricalRead(v,p,bad),bad);
 }
 assert.throws(()=>verifyIntegrationCandidate(q=>q===p?bad:integrationPhysicalRead(q)),/SOURCE_DRIFT/);
 verifyIntegrationCandidate();
});
test('real filesystem symlink, directory and removed file are rejected, not followed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-admission-'));try{
  const target=join(dir,'regular'),link=join(dir,'link');writeFileSync(target,'fixture');symlinkSync(target,link);
  assert.equal(readRegularIntegrationFile(target).toString(),'fixture');assert.throws(()=>readRegularIntegrationFile(link),/REGULAR/);assert.throws(()=>readRegularIntegrationFile(dir),/REGULAR/);
  rmSync(target);assert.throws(()=>readRegularIntegrationFile(target),{code:'ENOENT'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('actual custom-reader chain restores Core-only Producer bytes without erasing injected drift',()=>{
 const path='supabase/functions/recommendation-stock-evidence-v1/index.ts';
 const views=vnextPredecessorViews(integrationPhysicalRead);
 assert.deepEqual(views.predecessorRead(path),vnextPrior(path));views.verify();
 const bad=Buffer.concat([integrationPhysicalRead(path),Buffer.from('NEGATIVE_OUTER_READER')]);
 const injected=vnextPredecessorViews(p=>p===path?bad:integrationPhysicalRead(p));
 assert.deepEqual(injected.predecessorRead(path),bad);
});
test('Node22.14 plain-node steps get strip support without passing unsupported flags to action runtimes',()=>{
 for(const name of ['analysis-intelligence','academy-v11','checkpoint-atomicity-validation','entry-opportunity','owner-cockpit','owner-trading-lab','recommendation-v2-shadow','research-foundation','staged-release-240','validate-release','vnext-candidate','core-evidence-candidate','core-member-integration']){
  const text=integrationPhysicalRead('.github/workflows/'+name+'.yml').toString();
  assert.doesNotMatch(text,/^env:/m,'no global NODE_OPTIONS for bundled action runtimes');
  for(const block of text.split(/(?=^      - )/m)){
   if(/^\s*(?:-\s*)?run:/m.test(block)&&/\b(?:node|npm)\b/.test(block))assert.match(block,/NODE_OPTIONS: --experimental-strip-types/);
   if(/uses:/.test(block))assert.doesNotMatch(block,/NODE_OPTIONS/);
  }
 }
});
test('decode-only cache follows text revisions and never masks invalid or changed input',()=>{
 const bytes=integrationPhysicalRead(INTEGRATION_MANIFEST),m=JSON.parse(bytes),row=m.files[0];
 assert.deepEqual(integrationSealRow(row.path,bytes),row);
 assert(Object.isFrozen(integrationSealRow(row.path,bytes)));
 const changed=structuredClone(m);changed.files[0].after_sha256='0'.repeat(64);
 assert.equal(integrationSealRow(row.path,Buffer.from(JSON.stringify(changed))).after_sha256,'0'.repeat(64));
 assert.throws(()=>integrationSealRow(row.path,Buffer.from('{invalid')));
 assert.deepEqual(integrationSealRow(row.path,bytes),row);
 assert.equal(integrationSealRow('unknown.ts',bytes),undefined);
 const bad=Buffer.concat([integrationPhysicalRead(row.path),Buffer.from('LATE_DRIFT')]);
 assert.deepEqual(integrationHistoricalRead('core',row.path,bad),bad);
 assert.throws(()=>verifyIntegrationCandidate(p=>p===row.path?bad:integrationPhysicalRead(p)),/SOURCE_DRIFT|PRIOR_RECEIPT|R2_RECEIPT/);
});
test('warm decode cache still detects fresh physical bytes, mode, deletion and symlink changes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-live-seal-')),path='supabase/functions/get-report-payload/index.ts';
 const root=new URL('../',import.meta.url),seal=integrationPhysicalRead(INTEGRATION_MANIFEST),good=integrationPhysicalRead(path);
 const put=(p,bytes)=>{mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),bytes);};
 try{
  // Minimal isolated filesystem fixture; Git is used only for immutable parent
  // objects. No product worktree or receipt is modified by this test.
  put('.git',readFileSync(new URL('.git',root)));
  put('tests/helpers/integrationAdmission.mjs',readFileSync(new URL('tests/helpers/integrationAdmission.mjs',root)));
  put(INTEGRATION_MANIFEST,seal);put(path,good);
  const live=await import('file://'+join(dir,'tests/helpers/integrationAdmission.mjs'));
  assert.deepEqual(live.integrationHistoricalRead('core',path,good),integrationParentRead('core',path));
  put(path,Buffer.concat([good,Buffer.from('LATE_PHYSICAL_DRIFT')]));
  assert.throws(()=>live.integrationHistoricalRead('core',path,good),/CHANGED_AFTER_ADMISSION/);
  put(path,good);chmodSync(join(dir,path),0o755);
  assert.throws(()=>live.integrationHistoricalRead('member',path,good),/CHANGED_MODE/);
  chmodSync(join(dir,path),0o644);rmSync(join(dir,path));
  assert.throws(()=>live.integrationHistoricalRead('core',path,good),{code:'ENOENT'});
  put('link-target.ts',good);symlinkSync(join(dir,'link-target.ts'),join(dir,path));
  assert.throws(()=>live.integrationHistoricalRead('core',path,good),/REGULAR/);
  rmSync(join(dir,path));mkdirSync(join(dir,path));
  assert.throws(()=>live.integrationHistoricalRead('core',path,good),/REGULAR/);
  rmSync(join(dir,path),{recursive:true});put(path,good);
  put(INTEGRATION_MANIFEST,Buffer.from('{invalid'));
  assert.throws(()=>live.integrationHistoricalRead('member',path,good));
  put(INTEGRATION_MANIFEST,seal);
  assert.deepEqual(live.integrationHistoricalRead('member',path,good),integrationParentRead('member',path));
  const bad=Buffer.concat([good,Buffer.from('INJECTED')]);
  for(const view of ['core','member'])assert.deepEqual(live.integrationHistoricalRead(view,path,bad),bad);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
