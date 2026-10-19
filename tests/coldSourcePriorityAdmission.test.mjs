// Exact source/rollback controls; not Production authentication or natural success.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyIntegrationCandidate,INTEGRATION_MANIFEST,integrationInventory,integrationPhysicalRead,integrationPhysicalMode} from './helpers/integrationAdmission.mjs';
import {assemble,catalog,BASE,CHANGED} from '../scripts/operations/cold-source-priority-20261019/materialize.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const prior=path=>execFileSync('git',['show',BASE+':'+path],{maxBuffer:8e6});
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
test('current full composition is admitted before any fixed historical source proof',()=>{
 const m=verifyIntegrationCandidate();assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261019-cold-source-priority.json');
 const frozen='docs/operations/evidence/core-member-integration-20261019-producer15-monthly-release.json';assert.deepEqual(read(frozen),prior(frozen));
 for(const flag of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[flag],false);
 const inventory=integrationInventory();
 assert.throws(()=>verifyIntegrationCandidate(path=>path===CHANGED?Buffer.concat([read(path),Buffer.from('DRIFT')]):integrationPhysicalRead(path),inventory),/DRIFT/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,[...inventory,'UNREVIEWED_FILE']),/UNKNOWN_PATH/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,inventory,path=>path===CHANGED?'100755':integrationPhysicalMode(path)),/MODE/);
});
test('candidate and recovery preserve all44 actual Worker3 runtime sources except the one reviewed ordering change',()=>{
 const c=catalog(),next=assemble(),back=assemble('recovery');
 assert.equal(c.production_authorized,false);assert.equal(c.baseline.version,3);assert.equal(c.baseline.sdk,'2.57.4');
 assert.equal(c.files.length,78);assert.equal(c.files.filter(f=>!f.static).length,44);assert.equal(c.files.filter(f=>f.type_only).length,4);
 assert.equal(c.metadata.verify_jwt,true);assert.equal(c.metadata.name,'vnext-daily-research-v1');
 const old=new Map(back.payload.files.map(f=>[f.name,f.content]));
 for(const f of next.payload.files){const r=c.files.find(r=>r.name===f.name);assert.equal(sha(f.content),r.after_sha256);
  if(f.name!==CHANGED)assert.equal(f.content,old.get(f.name));else{assert.notEqual(f.content,old.get(f.name));assert.equal(sha(old.get(f.name)),r.before_sha256);}}
 for(const row of c.files.filter(r=>r.type_only)){
  const original=prior(row.name).toString();for(const [before,after] of row.edits){assert(before.startsWith('from '));assert.equal(after,before.slice(0,-1)+'.ts\'');assert(original.split(before).length===2);assert(original.split('\n').find(line=>line.includes(before)).startsWith('import type '));}
 }
 assert.equal(next.sha256,c.payloads.candidate.sha256);assert.equal(back.sha256,c.payloads.recovery.sha256);
 for(const variant of ['latest','../recovery','main','recovery@HEAD'])assert.throws(()=>assemble(variant),/FIXED_VARIANT/);
 for(const variant of ['candidate','recovery'])assert.throws(()=>assemble(variant,p=>p===CHANGED?Buffer.concat([read(p),Buffer.from(' ') ]):read(p)),/CURRENT_/);
});
test('immutable plans, limits, Auth, SQL, evaluator and protected products remain unchanged',()=>{
 for(const path of ['src/features/vnext/dailyRuntime.ts','supabase/functions/vnext-daily-research-v1/handler.ts','supabase/functions/vnext-daily-research-v1/index.ts',
  'src/features/vnext/researchFunnel.ts','src/features/vnext/contracts.ts','src/features/vnext/engine.ts','src/features/vnext/dailyIntelligence.ts',
  'supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql','supabase/functions/recommendation-v2-forward-worker-v1/index.ts',
  'supabase/functions/recommendation-stock-evidence-v1/index.ts','supabase/functions/get-report-payload/index.ts','supabase/functions/line-daily-push/index.ts',
  'supabase/functions/member-access/index.ts','supabase/config.toml','package.json','package-lock.json'])assert.deepEqual(read(path),prior(path),path);
 const runtime=read('src/features/vnext/dailyRuntime.ts').toString();assert(runtime.includes('r.plan.length?r.plan:await acquisitionPlan'));
 const adapter=read(CHANGED).toString(),before=prior(CHANGED).toString();
 for(const anchor of ['export async function normalizeSource','export async function fetchSource','export async function assembleDaily']){
  const end=s=>{const start=s.indexOf(anchor),next=s.indexOf('\nexport ',start+anchor.length);return s.slice(start,next<0?undefined:next);};assert.equal(end(adapter),end(before));
 }
 const db=read('tests/vnextDailyDatabase.integration.mjs').toString();assert(db.includes('PGPASSWORD:password'));assert(db.includes("'exec','-i','-e','PGPASSWORD',db"));
});
test('old source-specific assertions run unchanged at fda; current behavior checks are not moved to that checkout',()=>{
 const workflow=read('.github/workflows/core-member-integration.yml').toString();
 assert(workflow.includes('ref: '+BASE));assert(workflow.includes('path: build/cold-source-priority-historical-base'));
 assert(workflow.includes('tests/vnextColdSourcePriority.test.mjs tests/vnextDailyRuntimeRecovery.test.mjs'));
 assert(workflow.includes('build/cold-source-priority-20261019-r2/candidate'));
 const blocks=workflow.split(/(?=^      - )/m);const current=blocks.find(b=>b.includes('tests/vnextColdSourcePriority.test.mjs'));assert(current&&!current.includes('working-directory:'));
 const historical=blocks.find(b=>b.includes('Historical fda Producer16'));assert(historical.includes('working-directory: build/cold-source-priority-historical-base'));
 assert.equal(read('tests/producer15MonthlyAdmission.test.mjs').toString(),prior('tests/producer15MonthlyAdmission.test.mjs').toString());
 assert.equal(read('tests/cWorkerRpcFailureDiagnostics.integration.mjs').toString(),prior('tests/cWorkerRpcFailureDiagnostics.integration.mjs').toString());
});
