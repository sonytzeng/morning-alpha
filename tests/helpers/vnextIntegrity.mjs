import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const VNEXT_BASE='49baeba1facf9b591c17d3356420db0d01881126';
export const VNEXT_MANIFEST='docs/vnext/transition.json';
export const VNEXT_MIGRATION='supabase/migrations/20261010061630_vnext_research_projection_candidate.sql';
export const VNEXT_RUNTIME_MIGRATION='supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql';
export const VNEXT_PUBLICATION_MIGRATION='supabase/migrations/20261012080628_vnext_member_publication_control_candidate.sql';
export const VNEXT_MEMBERSHIP_MIGRATION='supabase/migrations/20261013045054_membership_legacy_policy_candidate.sql';
const VNEXT_CATALOG=Object.freeze([
 'scripts/releases/observe-ci-node.mjs','tests/ciNodeObserver.test.mjs',
 'scripts/academy-v11/auth-environment.mjs','scripts/academy-v11/local-auth-endpoints.mjs',
 'docs/vnext/core-runtime-reference-20261015.json','tests/helpers/stagedReleaseIntegrity.mjs',
 VNEXT_MEMBERSHIP_MIGRATION,'supabase/functions/member-access/index.ts',
 'src/types/membership.ts','src/components/membership/MembershipStatusCard.tsx','src/pages/pricing/Pricing.tsx','src/pages/auth/LoginPage.tsx',
 'tests/membershipPolicy.test.mjs','tests/membershipPolicy.integration.mjs','tests/publicRelease.test.mjs',
 'tests/browser/membership.client.ts','tests/browser/membership.harness.tsx','tests/browser/membership.e2e.mjs','tests/browser/membership.market.tsx','scripts/vnext/membership-preview.mjs',
 'docs/vnext/MEMBERSHIP_PAYMENT_READINESS.md',
 'src/router/config.tsx','src/components/feature/Navbar.tsx','src/pages/account/Account.tsx',
 'src/pages/vnext/PublicExperience.tsx','src/pages/vnext/OwnerPublication.tsx',
 'tests/vnextMemberRelease.integration.mjs','tests/browser/vnextMemberRelease.e2e.mjs',
 'tests/academyNavigation.test.mjs',
 'docs/vnext/MEMBER_RELEASE_MANIFEST.md',VNEXT_PUBLICATION_MIGRATION,
 '.github/workflows/analysis-intelligence.yml',
 '.github/workflows/vnext-candidate.yml',
 '.github/workflows/validate-release.yml',
 '.github/workflows/owner-cockpit.yml',
 ...['BASELINE_INVENTORY','PRODUCTION_BASELINE_AUDIT','ARCHITECTURE','DATA_LICENSE_AUDIT','EVENT_INTELLIGENCE_SPEC','SUPPLY_CHAIN_SPEC','MULTI_HORIZON_SPEC','SIGNAL_LAB_INTEGRATION_PLAN','PUBLICATION_GATE','RELEASE_PLAN','EXECUTION_CHECKPOINT','ACCEPTANCE_MATRIX'].map(n=>'docs/vnext/'+n+'.md'),
 'docs/vnext/RELEASE_B_REAL_EVIDENCE.md',
 'docs/vnext/EVIDENCE_FOUNDATION.md',
 'docs/vnext/MEMBER_EXPERIENCE.md',
 'docs/vnext/MEMBER_PUBLICATION_READINESS.md',
 'docs/vnext/DAILY_STOCK_INTELLIGENCE.md',
 'docs/vnext/DAILY_PRODUCTION_WIRING.md',
 'src/features/vnext/dailyAdapter.ts','src/features/vnext/dailyParsers.mjs','src/features/vnext/dailyRuntime.ts',
 'supabase/functions/vnext-daily-research-v1/index.ts','supabase/functions/vnext-daily-research-v1/handler.ts',
 'supabase/functions/_shared/vnext-daily-hook.ts','supabase/functions/recommendation-v2-forward-worker-v1/index.ts',VNEXT_RUNTIME_MIGRATION,
 'tests/vnextDailyWiring.test.mjs','tests/vnextDailyDatabase.integration.mjs',
 'tests/recommendationV2ForwardHandler.test.mjs',
 'src/features/vnext/dailyIntelligence.ts','src/features/vnext/dailyOutcome.ts','src/features/vnext/dailyPreview.ts','src/pages/vnext/DailyIntelligence.tsx',
 'scripts/vnext/daily-store.mjs','scripts/vnext/daily-retained.mjs',
 'tests/vnextDailyIntelligence.test.mjs','tests/vnextDailyReal.integration.mjs','tests/vnextDailyAuth.integration.mjs','tests/browser/vnextDaily.e2e.mjs',
 'src/features/vnext/publicationReadiness.ts','src/pages/vnext/PublicationReadiness.tsx',
 'scripts/vnext/publication-readiness.mjs','scripts/vnext/publication-isolation.mjs','scripts/vnext/publication-preview.mjs',
 'tests/vnextPublication.test.mjs','tests/vnextPublicationReal.integration.mjs',
 'src/features/vnext/publicationReview.ts','src/pages/vnext/PublicationReview.tsx','scripts/vnext/first-publication-review.mjs',
 'tests/vnextPublicationReview.test.mjs','tests/vnextPublicationReviewReal.integration.mjs','docs/vnext/FIRST_PUBLICATION_REVIEW.md',
 'src/features/vnext/publicationAdmission.ts','scripts/vnext/member-admission.mjs','scripts/vnext/approval-server.mjs',
 'tests/vnextAdmission.test.mjs','tests/vnextAdmissionReal.integration.mjs','tests/vnextAdmissionAuth.integration.mjs','docs/vnext/FIRST_MEMBER_RESEARCH.md',
 'src/features/vnext/publicationBlockers.ts','scripts/vnext/publication-blockers.mjs','docs/vnext/publication-review-20261011.json','docs/vnext/PUBLICATION_BLOCKERS.md','tests/vnextBlockers.test.mjs','tests/vnextBlockersReal.integration.mjs',
 'src/features/vnext/publicationClearance.ts','tests/vnextClearance.test.mjs','tests/vnextClearanceReal.integration.mjs',
 'src/features/vnext/researchFunnel.ts','src/pages/vnext/ResearchFunnel.tsx','scripts/vnext/research-funnel.mjs',
 'tests/vnextResearchFunnel.test.mjs','tests/vnextResearchFunnelReal.integration.mjs','docs/vnext/RESEARCH_PUBLICATION_FUNNEL.md',
 'src/features/vnext/stockResearch.ts','scripts/vnext/stock-evidence.mjs','scripts/vnext/stock-context.mjs','scripts/vnext/stock-audit.mjs','tests/vnextStockResearch.test.mjs','tests/vnextStockResearchReal.integration.mjs','docs/vnext/REAL_STOCK_RESEARCH.md',
 'scripts/vnext/isolation.mjs','scripts/vnext/preview.mjs','scripts/vnext/real-evidence.mjs','scripts/vnext/owner-research-server.mjs',
 'scripts/vnext/foundation-history.mjs','scripts/vnext/foundation-sources.mjs','scripts/vnext/foundation-validation.mjs',
 'scripts/vnext/member-isolation.mjs','scripts/vnext/member-build.mjs',
 'src/features/vnext/member.ts','src/pages/vnext/MemberPage.tsx','src/pages/vnext/MemberExperience.tsx','src/pages/vnext/MemberNavigation.tsx','src/pages/vnext/member.css','tests/vnextMember.test.mjs',
 ...['contracts','engine','projection','validation','realResearch'].map(n=>'src/features/vnext/'+n+'.ts'),
 'src/pages/vnext/Workspace.tsx','src/pages/vnext/page.tsx','src/pages/vnext/RealResearch.tsx','src/pages/vnext/vnext.css',VNEXT_MIGRATION,
 'src/features/vnext/foundation.ts','src/pages/vnext/Foundation.tsx','tests/vnextFoundation.test.mjs','tests/vnextFoundationReal.integration.mjs',
 'tests/browser/vnext.client.ts','tests/browser/vnext.harness.tsx','tests/browser/vnext.vite.ts','tests/fixtures/vnext.mjs',
 'tests/vnextContracts.test.mjs','tests/vnextValidation.test.mjs','tests/vnextIntegrity.test.mjs','tests/vnextRealEvidence.test.mjs','tests/vnextRealReplay.integration.mjs',
 'tests/helpers/vnextIntegrity.mjs','tests/helpers/marketNewsReportIntegrity.mjs','tests/academyV11Integrity.test.mjs','tests/productContract.test.mjs',
].sort());
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=path=>{const url=new URL('../../'+path,import.meta.url);assert.ok(lstatSync(url).isFile(),'regular file required: '+path);return readFileSync(url);};
const absent=path=>Object.assign(Error('absent from VNext predecessor: '+path),{code:'ENOENT'});
const CORE_RUNTIME_PATHS=Object.freeze([
 "research/entry-official-history.ts",
 "research/entry-opportunity.ts",
 "research/entry-v2-adapter.ts",
 "src/features/decision-v1/contract.ts",
 "src/features/research/recommendation-shadow-v2-summary.ts",
 "src/features/research/recommendation-v2-forward.ts",
 "src/features/vnext/contracts.ts",
 "src/features/vnext/dailyAdapter.ts",
 "src/features/vnext/dailyIntelligence.ts",
 "src/features/vnext/dailyOutcome.ts",
 "src/features/vnext/dailyParsers.mjs",
 "src/features/vnext/dailyRuntime.ts",
 "src/features/vnext/projection.ts",
 "src/features/vnext/publicationReadiness.ts",
 "src/features/vnext/realResearch.ts",
 "src/features/vnext/researchFunnel.ts",
 "src/features/vnext/stockResearch.ts",
 "supabase/functions/_shared/decision-v1-data.ts",
 "supabase/functions/_shared/decision-v1-evidence.ts",
 "supabase/functions/_shared/internal-function-auth.mjs",
 "supabase/functions/_shared/market-calendar-data.json",
 "supabase/functions/_shared/market-session-contract.mjs",
 "supabase/functions/_shared/market-status.ts",
 "supabase/functions/_shared/recommendation-company-events.ts",
 "supabase/functions/_shared/recommendation-official-actuals.ts",
 "supabase/functions/_shared/recommendation-phase.ts",
 "supabase/functions/_shared/recommendation-producer.ts",
 "supabase/functions/_shared/recommendation-shadow-v2-engine.ts",
 "supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts",
 "supabase/functions/_shared/recommendation-shadow-v2-runtime.ts",
 "supabase/functions/_shared/recommendation-shadow-v2-sources.ts",
 "supabase/functions/_shared/recommendation-stock-evidence.ts",
 "supabase/functions/_shared/recommendation-v2-forward-outcomes.ts",
 "supabase/functions/_shared/txf-session-contract.mjs",
 "supabase/functions/_shared/vnext-daily-hook.ts",
 "supabase/functions/recommendation-v2-forward-worker-v1/index.ts",
 "supabase/functions/vnext-daily-research-v1/handler.ts",
 "supabase/functions/vnext-daily-research-v1/index.ts",
 "supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql"
]);
let immutable;
const baselineModes=new Map();
function baseline(){
 if(immutable)return immutable;
 const rows=git(['ls-tree','-r','-z',VNEXT_BASE]).split('\0').filter(Boolean).map(row=>{
  const [meta,path]=row.split('\t'),[mode,type,oid]=meta.split(' ');
  assert.equal(type,'blob');assert.match(mode,/^100[0-7]{3}$/);return {path,oid,mode};
 });
 const bytes=execFileSync('git',['cat-file','--batch'],{cwd:root,input:rows.map(r=>r.oid).join('\n')+'\n',maxBuffer:64*1024*1024});
 const map=new Map();let offset=0;
 for(const row of rows){const end=bytes.indexOf(10,offset);assert.notEqual(end,-1);const [oid,type,sizeText]=bytes.subarray(offset,end).toString().split(' '),size=Number(sizeText);
  assert.equal(oid,row.oid);assert.equal(type,'blob');assert.ok(Number.isSafeInteger(size)&&size>=0);offset=end+1;
  assert.equal(bytes[offset+size],10);map.set(row.path,Buffer.from(bytes.subarray(offset,offset+size)));baselineModes.set(row.path,row.mode);offset+=size+1;
 }assert.equal(offset,bytes.length);immutable=map;return map;
}
export function vnextPrior(path){const b=baseline().get(path);return b===undefined?null:Buffer.from(b);}
// Only the pre-existing named catalogue is eligible. Inherited C/main bytes
// remain protected baseline; no duplicate Runtime patch or migration replay.
export const VNEXT_PATHS=Object.freeze(VNEXT_CATALOG.filter(path=>{const prior=vnextPrior(path);return prior===null||!raw(path).equals(prior);}));
const committedRanges=new Map();
export function vnextFileDiffers(before,current,beforeMode,currentMode,claimedUntracked=false){
 if(claimedUntracked&&current===undefined)return true;
 return current===undefined?before!==null:before===null||!current.equals(before)||beforeMode!==currentMode;
}
export function vnextChangedPaths(){
 // One fresh status snapshot includes the actual HEAD and every dirty/untracked
 // path. Only immutable base..HEAD names are cached, never working-tree state.
 const rows=git(['status','--porcelain=v2','--branch','-z','--untracked-files=all','--no-renames']).split('\0').filter(Boolean);
 const oid=rows.find(r=>r.startsWith('# branch.oid '))?.slice('# branch.oid '.length);
 assert.match(oid??'',/^[a-f0-9]{40}$/,'IMMUTABLE_GIT_REVISION_REQUIRED');
 if(!committedRanges.has(oid))committedRanges.set(oid,git(['diff','--no-renames','--name-only','-z',VNEXT_BASE,oid,'--']).split('\0').filter(Boolean));
 const untracked=new Set();
 const dirty=rows.filter(r=>!r.startsWith('#')).map(r=>{
  if(r.startsWith('? ')){const path=r.slice(2);untracked.add(path);return path;}
  assert(r.startsWith('1 '),'VNEXT_UNMERGED_OR_UNSUPPORTED_STATUS');return r.split(' ').slice(8).join(' ');
 });
 return [...new Set([...committedRanges.get(oid),...dirty])].filter(path=>{
  const before=vnextPrior(path);let current;try{current=raw(path);}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
  const mode=current===undefined?undefined:(lstatSync(new URL('../../'+path,import.meta.url)).mode&0o111?'100755':'100644');
  return vnextFileDiffers(before,current,baselineModes.get(path),mode,untracked.has(path));
 }).sort();
}
export function vnextTransition(source=raw,paths=vnextChangedPaths()){
 const m=JSON.parse(source(VNEXT_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','migrations','functions','production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'].sort());
 assert.equal(m.schema,'VNEXT_RESEARCH_CANDIDATE_V1');assert.equal(m.base,VNEXT_BASE);
 for(const key of ['production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'])assert.equal(m[key],false,key);
 // Membership integration cannot roll back the independently sealed C runtime
 // or the already-merged B1 evaluator, even if its own receipt is rewritten.
 for(const path of CORE_RUNTIME_PATHS){const prior=vnextPrior(path);assert(prior);assert(raw(path).equals(prior),'INHERITED_CORE_DRIFT:'+path);}
 assert.deepEqual(m.functions,['vnext-daily-research-v1','recommendation-v2-forward-worker-v1','member-access']);assert.deepEqual(m.migrations,[VNEXT_MIGRATION,VNEXT_RUNTIME_MIGRATION,VNEXT_PUBLICATION_MIGRATION,VNEXT_MEMBERSHIP_MIGRATION]);
 assert.deepEqual(m.files.map(f=>f.path).sort(),VNEXT_PATHS,'exact named VNext scope');
 assert.deepEqual([...paths].sort(),[...VNEXT_PATHS,VNEXT_MANIFEST].sort(),'unknown VNext working-tree path');
 const candidates=new Map();
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256'].sort());
  const prior=vnextPrior(row.path);assert.equal(row.before_sha256,prior===null?null:hash(prior));
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.notEqual(row.before_sha256,row.after_sha256);
  assert.equal(hash(source(row.path)),row.after_sha256,'unreviewed VNext candidate: '+row.path);
  assert.equal(hash(raw(row.path)),row.after_sha256,'live VNext candidate: '+row.path);candidates.set(row.path,row);
 }
 // Candidate admission is never a bypass for an unrelated baseline change.
 for(const [path,bytes] of baseline())if(!candidates.has(path)){
  assert.deepEqual(raw(path),bytes,'protected VNext baseline: '+path);
  if(source!==raw)assert.deepEqual(Buffer.from(source(path)),bytes,'historical VNext baseline: '+path);
 }
 const before=path=>{
  if(path===VNEXT_MANIFEST)throw absent(path);
  const row=candidates.get(path);if(!row)return raw(path);
  assert.equal(hash(raw(path)),row.after_sha256,'live candidate changed during validation: '+path);
  const bytes=vnextPrior(path);if(bytes===null)throw absent(path);return bytes;
 };
 return {manifest:m,predecessorRead:before};
}

/** Every older release gate first checks the real VNext patch, then sees only
 * its immutable predecessor. Custom old test errors are never silently erased. */
export function vnextPredecessorViews(source){
 const current=vnextTransition(),files=new Map(current.manifest.files.map(f=>[f.path,f]));
 const historical=source?path=>{
  const row=files.get(path);
  if(row){const bytes=source(path);if(hash(bytes)===row.after_sha256)return current.predecessorRead(path);return bytes;}
  return source(path);
 }:current.predecessorRead;
 return {predecessorRead:historical,actualPredecessorRead:current.predecessorRead,verify:()=>vnextTransition(),changedPaths:immutableChangedPaths};
}
const immutableRanges=new Map();
function immutableChangedPaths(prior){
 assert.match(prior,/^[a-f0-9]{40}$/,'IMMUTABLE_GIT_REVISION_REQUIRED');
 if(!immutableRanges.has(prior))immutableRanges.set(prior,git(['diff','--no-renames','--name-only','-z',prior,VNEXT_BASE,'--']).split('\0').filter(Boolean).sort());
 return [...immutableRanges.get(prior)];
}
export function vnextBaselineChangedPaths(prior){
 vnextTransition();
 return immutableChangedPaths(prior);
}
