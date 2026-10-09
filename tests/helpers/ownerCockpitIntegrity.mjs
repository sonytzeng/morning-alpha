import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {ACADEMY_BASE,academyAwareReader,academyTransition} from './academyCandidateIntegrity.mjs';
export const COCKPIT_BASE='8ec42145fb196df448af0242ff125d64d8a83163';
export const COCKPIT_MANIFEST='docs/operations/evidence/owner-cockpit-transition.json';
export const COCKPIT_MIGRATION='supabase/migrations/20261008213105_owner_trading_cockpit_ledger_v1.sql';
export const COCKPIT_PATHS=[COCKPIT_MIGRATION,
 '.github/workflows/owner-cockpit.yml','supabase/functions/owner-trading-lab-v1/index.ts',
 'src/features/research/cockpit.ts','src/pages/admin/analysis/OwnerCockpit.tsx','src/pages/admin/analysis/CockpitJournal.tsx',
 'src/pages/admin/analysis/cockpit.css','src/pages/admin/analysis/page.tsx',
 'tests/ownerCockpit.test.mjs','tests/ownerCockpitDatabase.integration.mjs','tests/ownerCockpitIntegrity.test.mjs',
 'tests/helpers/ownerCockpitIntegrity.mjs','tests/helpers/entryWorkerAuthIntegrity.mjs',
 'tests/entryOpportunityAuthIntegrity.test.mjs','tests/productContract.test.mjs',
 'tests/analysisIntelligenceUI.test.mjs','tests/ownerAccountAnalysisNavigation.test.mjs',
 'tests/browser/ownerCockpit.vite.ts','tests/browser/ownerCockpitHarness.tsx','tests/browser/ownerCockpitSupabaseMock.ts',
 'docs/10k-program/owner-cockpit-release.md',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function cockpitPrior(p){if(!cache.has(p)){const exists=execFileSync('git',['ls-tree','--name-only',COCKPIT_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();cache.set(p,exists?execFileSync('git',['show',COCKPIT_BASE+':'+p],{cwd:root,maxBuffer:16e6}):null);}return cache.get(p);}
export function cockpitChangedPaths(){academyTransition();return execFileSync('git',['diff','--name-only','-z',COCKPIT_BASE,ACADEMY_BASE,'--'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();}
export function cockpitTransition(source=read){source=academyAwareReader(source);const m=JSON.parse(source(COCKPIT_MANIFEST));assert.equal(m.schema_version,'OWNER_COCKPIT_TRANSITION_V1');assert.equal(m.base,COCKPIT_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),COCKPIT_PATHS);assert.deepEqual(m.functions,['owner-trading-lab-v1']);assert.deepEqual(m.migrations,[COCKPIT_MIGRATION]);
 for(const k of ['secret_change','cron_change','existing_auth_change','existing_rls_change','core_change','strategy_change','line_change','report_change','forward_enabled','outcome_enabled','legacy_backfill','member_access'])assert.equal(m[k],false,k);
 const seal='docs/operations/evidence/entry-worker-auth-transition.json';assert.equal(m.predecessor_sha256,hash(cockpitPrior(seal)));assert.equal(hash(source(seal)),m.predecessor_sha256);
 const before=new Map();for(const r of m.files){const b=cockpitPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (Cockpit): '+r.path);before.set(r.path,b);}
 const predecessorRead=p=>{if(p===COCKPIT_MANIFEST)throw Object.assign(Error('absent'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent'),{code:'ENOENT'});return b;};restored.add(predecessorRead);return {manifest:m,predecessorRead};}
export function cockpitAwareReader(source=read){if(restored.has(source))return source;source=academyAwareReader(source);try{source(COCKPIT_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}return cockpitTransition(source).predecessorRead;}
