import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyIntegrationCandidate,INTEGRATION_MANIFEST,integrationInventory,integrationPhysicalRead,integrationPhysicalMode} from './helpers/integrationAdmission.mjs';
import {assemble} from '../scripts/operations/cpu-budget-recovery-20261020/materialize.mjs';
const base='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3',read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('complete CPU candidate rejects unknown sources, modified bytes, modes and frozen Worker4 receipt changes',()=>{
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261020-cpu-budget.json');
 const m=verifyIntegrationCandidate();for(const f of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[f],false);
 const p='src/features/vnext/dailyRuntime.ts',inventory=integrationInventory();
 assert.throws(()=>verifyIntegrationCandidate(x=>x===p?Buffer.concat([read(x),Buffer.from('DRIFT')]):integrationPhysicalRead(x),inventory),/DRIFT/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,[...inventory,'UNREVIEWED_CPU_SOURCE']),/UNKNOWN_PATH/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,inventory,x=>x===p?'100755':integrationPhysicalMode(x)),/MODE/);
 const frozen='docs/operations/evidence/core-member-integration-20261019-cold-source-priority.json';assert.deepEqual(read(frozen),execFileSync('git',['show',base+':'+frozen]));
 assert.throws(()=>verifyIntegrationCandidate(x=>x===frozen?Buffer.from('{}'):integrationPhysicalRead(x),inventory),/COLD_SOURCE_RECEIPT_DRIFT/);
});
test('CPU candidate and exact Worker4 recovery retain78 sources and reject injected delta drift',()=>{
 const c=assemble(),r=assemble('recovery'),changed=['src/features/vnext/contracts.ts','src/features/vnext/dailyIntelligence.ts','src/features/vnext/dailyRuntime.ts'];
 assert.equal(c.payload.files.length,78);assert.equal(r.sha256,'34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762');
 assert.deepEqual(c.payload.files.filter((f,i)=>f.content!==r.payload.files[i].content).map(f=>f.name).sort(),changed);
 for(const variant of ['candidate','recovery'])assert.throws(()=>assemble(variant,p=>Buffer.concat([read(p),Buffer.from('DRIFT')])),/CPU_CURRENT_DRIFT/);
 assert.throws(()=>assemble('../recovery'),/CPU_FIXED_VARIANT/);
});
test('CPU repair does not change protected evaluators, identity, business RPC or original release assertions',()=>{
 for(const p of ['src/features/vnext/researchFunnel.ts','src/features/vnext/dailyAdapter.ts','src/features/vnext/engine.ts','research/entry-opportunity.ts',
  'supabase/functions/vnext-daily-research-v1/index.ts','supabase/functions/vnext-daily-research-v1/handler.ts','supabase/functions/_shared/vnext-daily-hook.ts',
  'supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql','supabase/functions/recommendation-v2-forward-worker-v1/index.ts',
  'supabase/functions/recommendation-stock-evidence-v1/index.ts','supabase/functions/get-report-payload/index.ts','supabase/functions/member-access/index.ts',
  'supabase/functions/line-daily-push/index.ts','supabase/config.toml','package.json','package-lock.json','tests/coldSourcePriorityAdmission.test.mjs','tests/r10FunctionalSourceClosure.test.mjs'])assert.deepEqual(read(p),execFileSync('git',['show',base+':'+p],{maxBuffer:8e6}),p);
 const workflow=read('.github/workflows/core-member-integration.yml').toString();assert(workflow.includes('ref: '+base));
 assert(workflow.includes('working-directory: build/cpu-budget-historical-base'));assert(workflow.includes('tests/vnextDailyCpuBudget.test.mjs'));
 assert(workflow.includes('deno-version: v2.9.7'));
 assert(workflow.includes('deno check --no-lock --node-modules-dir=none supabase/functions/vnext-daily-research-v1/index.ts'));
 for(const line of workflow.split('\n').filter(line=>line.includes('deno check --no-lock')||line.includes('deno test --no-lock')))assert(line.includes('--node-modules-dir=none'));
 assert(workflow.includes('node --test tests/atomicRowForwardFixture.test.mjs'));
 assert(workflow.includes('name: Current event alignment and issuer review refusal regressions\n        run: node --experimental-strip-types --test tests/eventAlignmentRefresh.test.mjs tests/recommendationIssuerEventReview.test.mjs\n'));
 assert(workflow.includes('name: Historical R10 immutable A and B24 source closure assertions unchanged\n        working-directory: build/cpu-budget-historical-base\n        run: node --experimental-strip-types --test tests/r10FunctionalSourceClosure.test.mjs\n'));
 const quarter=read('.github/workflows/owner-quarter-live-candidate.yml').toString();
 assert(quarter.includes('node --experimental-strip-types --test tests/cpuBudgetAdmission.test.mjs'));
 assert(quarter.includes('ref: '+base));assert(quarter.includes('working-directory: build/cpu-budget-historical-base'));
 assert(quarter.includes('node --experimental-strip-types --test tests/coldSourcePriorityAdmission.test.mjs'));
});
