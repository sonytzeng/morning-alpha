import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
test('dedicated Auth exact successor preserves PR193, Core Auth and all 142 sealed Core files',()=>{
 const path='docs/10k-program/phase2-shadow-auth-transition.json',m=JSON.parse(read(path));
 const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
 const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
 assert.equal(verify().shadowWorkerAuthCandidateIntegrity.reviewedBaselineTransition.worker_auth_change,true);
 assert.equal(m.files.filter(r=>r.path.startsWith('supabase/migrations/')).length,0);
 assert.deepEqual(m.files.filter(r=>/^supabase\/functions\/[^_][^/]+\/index/.test(r.path)).map(r=>r.path),['supabase/functions/research-analysis-shadow-v1/index.ts']);
 for(const row of m.files)assert.throws(()=>verify(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 const changed=structuredClone(m);changed.files.push({...m.files[0],path:'supabase/functions/unknown/index.ts'});
 assert.throws(()=>verify(p=>p===path?Buffer.from(JSON.stringify(changed)):read(p)),/only the named/);
 const core=JSON.parse(read('docs/10k-program/phase1-core-freeze.json'));
 for(const [p,h]of Object.entries(core.protected_files))assert.equal(hash(read(p)),h,p);
 for(const p of ['supabase/functions/_shared/internal-function-auth.mjs','docs/10k-program/phase2-persistence-transition.json'])
  assert.equal(hash(read(p)),hash(execFileSync('git',['show',m.candidate_base_git_sha+':'+p])));
});
test('dedicated worker is not reachable from Core/browser and exposes only fixed research operations',()=>{
 const caller=read('scripts/research-shadow-caller.mjs').toString(),worker=read('supabase/functions/research-analysis-shadow-v1/index.ts').toString();
 assert.doesNotMatch(worker,/internal-function-auth|authorizeInternalRequest|CRON_SECRET|OBSERVE_INVALIDATION|LINK_OUTCOME/);
 assert(worker.indexOf('permittedShadowReplay(input)')<worker.indexOf('const client = createClient'));
 assert.deepEqual([...worker.matchAll(/client\.rpc\('([^']+)'/g)].map(x=>x[1]),['research_analysis_input_v1','store_research_analysis_v1']);
 assert.deepEqual([...worker.matchAll(/client\.from\('([^']+)'/g)].map(x=>x[1]),['research_daily_analysis']);
 assert.doesNotMatch(caller,/service.role|CRON_SECRET|localStorage|console\.|writeFile|createServer|\.listen\(/i);
 const imported=execFileSync('git',['grep','-l','-E','research-shadow-caller|shadow-worker-auth','--','src','supabase/functions'],{encoding:'utf8'}).trim().split('\n');
 assert.deepEqual(imported,['supabase/functions/research-analysis-shadow-v1/index.ts']);
});
