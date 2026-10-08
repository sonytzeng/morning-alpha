import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const ENTRY_AUTH_BASE='039250b0601eb731e4f4dac03c55b43ba3b4aba3';
export const ENTRY_AUTH_MANIFEST='docs/operations/evidence/entry-worker-auth-transition.json';
export const ENTRY_AUTH_PATHS=[
 'supabase/functions/entry-opportunity-shadow-v1/index.ts','supabase/functions/entry-opportunity-shadow-v1/worker-auth.mjs',
 'scripts/entry-worker-caller.mjs','src/pages/admin/analysis/EntryOpportunity.tsx',
 'tests/entryOpportunityWorker.test.mjs','tests/entryOpportunityAuth.test.mjs','tests/entryOpportunityAuthIntegrity.test.mjs',
 'tests/helpers/entryWorkerAuthIntegrity.mjs','tests/helpers/entryOpportunityIntegrity.mjs','tests/entryOpportunityIntegrity.test.mjs',
 'tests/browser/entryOpportunitySupabaseMock.ts','tests/browser/entryOpportunity.e2e.mjs',
 'docs/10k-program/entry-worker-auth-release.md',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function entryAuthPrior(p){if(!cache.has(p)){const exists=execFileSync('git',['ls-tree','--name-only',ENTRY_AUTH_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();cache.set(p,exists?execFileSync('git',['show',ENTRY_AUTH_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);}return cache.get(p);}
export function entryAuthChangedPaths(){return [...new Set([
 ...execFileSync('git',['diff','--name-only','-z',ENTRY_AUTH_BASE,'--'],{cwd:root,encoding:'utf8'}).split('\0'),
 ...execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0')].filter(Boolean))].sort();}
export function entryAuthTransition(source=read){
 const m=JSON.parse(source(ENTRY_AUTH_MANIFEST));assert.equal(m.schema_version,'ENTRY_WORKER_AUTH_TRANSITION_V1');assert.equal(m.base,ENTRY_AUTH_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),ENTRY_AUTH_PATHS);assert.deepEqual(m.functions,['entry-opportunity-shadow-v1']);
 assert.deepEqual(m.new_secret_names,['ENTRY_OPPORTUNITY_WORKER_TOKEN']);assert.deepEqual(m.migrations,[]);
 for(const k of ['gateway_change','core_auth_change','rls_change','cron_change','core_change','strategy_change','outcome_enabled','natural_forward_enabled'])assert.equal(m[k],false,k);
 const seal='docs/operations/evidence/entry-opportunity-transition.json';assert.equal(m.predecessor_sha256,hash(entryAuthPrior(seal)));assert.equal(hash(source(seal)),m.predecessor_sha256);
 const before=new Map();for(const r of m.files){const b=entryAuthPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (Entry Auth): '+r.path);before.set(r.path,b);}
 const predecessorRead=p=>{if(p===ENTRY_AUTH_MANIFEST)throw Object.assign(Error('absent'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent'),{code:'ENOENT'});return b;};restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function entryAuthAwareReader(source=read){if(restored.has(source))return source;try{source(ENTRY_AUTH_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}return entryAuthTransition(source).predecessorRead;}
