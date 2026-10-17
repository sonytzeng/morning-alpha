import assert from 'node:assert/strict';
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {vnextPredecessorViews,vnextBaselineChangedPaths} from './vnextIntegrity.mjs';
export const STAGED_BASE='f41e117ea109e09ae083ef2c692946a18aca2dcc';
export const STAGED_SCOPES=Object.freeze({
  "P0": [
    "docs/operations/core-p0-final-20261015.md",
    "docs/operations/evidence/recommendation-v1-gap-matrix-20261015.json",
    "docs/operations/evidence/recommendation-v1-producer-release-20261015.json",
    "scripts/releases/recommendation-v1-preflight.mjs",
    "scripts/releases/staged-regression.mjs",
    "tests/helpers/stagedReleaseIntegrity.mjs",
    "tests/recommendationProducerAdmission.test.mjs"
  ],
  "A": [
    ".github/workflows/analysis-intelligence.yml",
    ".github/workflows/staged-release-240.yml",
    ".github/workflows/validate-release.yml",
    "docs/operations/release-a-20261014.md",
    "scripts/releases/staged-regression.mjs",
    "src/components/feature/Footer.tsx",
    "src/components/feature/Navbar.tsx",
    "src/features/decision-v1/DecisionBrief.tsx",
    "src/features/decision-v1/subscriber.css",
    "src/features/research/cockpit.ts",
    "src/lib/historicalReportCardPresentation.ts",
    "src/lib/historicalReportEvidencePresentation.ts",
    "src/lib/performanceDirectionPresentation.ts",
    "src/lib/reportNewsPresentation.ts",
    "src/pages/account/components/MorningHeroCard.tsx",
    "src/pages/account/components/TodayInfoCards.tsx",
    "src/pages/admin/analysis/OwnerCockpit.tsx",
    "src/pages/admin/scripts/page.tsx",
    "src/pages/home/page.tsx",
    "src/pages/performance/page.tsx",
    "src/pages/pricing/Pricing.tsx",
    "src/pages/report/TodayReport.tsx",
    "src/pages/reports/ReportDetail.tsx",
    "src/pages/reports/ReportsCenter.tsx",
    "supabase/migrations/20261013073004_operational_acceptance_calendar_guard_v1.sql",
    "tests/acceptanceCalendarDatabase.integration.mjs",
    "tests/accountSubscriberProjection.test.mjs",
    "tests/ctoConfidencePresentation.test.mjs",
    "tests/ctoHistoricalEvidencePresentation.test.mjs",
    "tests/ctoPerformancePresentation.test.mjs",
    "tests/ctoPricingPresentation.test.mjs",
    "tests/helpers/marketNewsReportIntegrity.mjs",
    "tests/helpers/stagedReleaseIntegrity.mjs",
    "tests/marketNewsReportIntegration.test.mjs",
    "tests/ownerCockpit.test.mjs",
    "tests/stagedReleaseIntegrity.test.mjs"
  ],
  "B1": [
    ".github/workflows/analysis-intelligence.yml",
    ".github/workflows/staged-release-240.yml",
    ".github/workflows/validate-release.yml",
    "docs/operations/release-b1-20261014.md",
    "scripts/releases/staged-regression.mjs",
    "supabase/functions/_shared/decision-v1-evidence.ts",
    "supabase/functions/_shared/recommendation-stock-evidence.ts",
    "supabase/functions/get-report-payload/index.ts",
    "tests/helpers/marketNewsReportIntegrity.mjs",
    "tests/helpers/stagedReleaseIntegrity.mjs",
    "tests/recommendationReaderBinding.test.mjs",
    "tests/recommendationReaderFreshDatabase.integration.mjs",
    "tests/stagedReleaseIntegrity.test.mjs"
  ],
  "B2": [
    ".github/workflows/analysis-intelligence.yml",
    ".github/workflows/staged-release-240.yml",
    ".github/workflows/validate-release.yml",
    "docs/operations/release-b2-20261014.md",
    "scripts/releases/staged-regression.mjs",
    "supabase/functions/line-daily-push/index.ts",
    "supabase/migrations/20261014002215_line_transport_immutable_request_candidate_v1.sql",
    "tests/helpers/marketNewsReportIntegrity.mjs",
    "tests/helpers/stagedReleaseIntegrity.mjs",
    "tests/lineProductionPromotion.test.mjs",
    "tests/lineTransportRecoveryDatabase.integration.mjs",
    "tests/marketNewsReportIntegration.test.mjs",
    "tests/stagedReleaseIntegrity.test.mjs"
  ],
  "C": [
    ".github/workflows/analysis-intelligence.yml",
    ".github/workflows/research-foundation.yml",
    ".github/workflows/staged-release-240.yml",
    ".github/workflows/validate-release.yml",
    "docs/operations/release-c-20261014.md",
    "scripts/releases/staged-regression.mjs",
    "scripts/vnext/stock-context.mjs",
    "scripts/vnext/stock-evidence.mjs",
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
    "supabase/config.toml",
    "supabase/functions/_shared/vnext-daily-hook.ts",
    "supabase/functions/recommendation-v2-forward-worker-v1/index.ts",
    "supabase/functions/vnext-daily-research-v1/handler.ts",
    "supabase/functions/vnext-daily-research-v1/index.ts",
    "supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql",
    "tests/fixtures/vnext.mjs",
    "tests/helpers/marketNewsReportIntegrity.mjs",
    "tests/helpers/stagedReleaseIntegrity.mjs",
    "tests/recommendationV2ForwardHandler.test.mjs",
    "tests/stagedReleaseIntegrity.test.mjs",
    "tests/vnextDailyDatabase.integration.mjs",
    "tests/vnextDailyRuntimeRecovery.test.mjs",
    "tests/vnextDailyWiring.test.mjs",
    "tests/vnextRuntimeOfficialRead.mjs"
  ]
});
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64e6});
const hash=b=>createHash('sha256').update(b).digest('hex');
const raw=p=>{const url=new URL('../../'+p,import.meta.url);assert(lstatSync(url).isFile(),'STAGED_REGULAR_FILE:'+p);return readFileSync(url);};
export const stagedManifestPath=id=>'docs/operations/evidence/staged-'+id.toLowerCase()+'-transition-20261014.json';
let baseline;
const inheritedBlobs=new Map();
const immutableRanges=new Map();
const rangePaths=(from,to)=>{
 assert.match(from,/^[a-f0-9]{40}$/,'IMMUTABLE_GIT_REVISION_REQUIRED');assert.match(to,/^[a-f0-9]{40}$/,'IMMUTABLE_GIT_REVISION_REQUIRED');
 const key=from+':'+to;
 if(!immutableRanges.has(key))immutableRanges.set(key,git(['diff','--no-renames','--name-only','-z',from,to,'--']).split('\0').filter(Boolean).sort());
 return [...immutableRanges.get(key)];
};
function inheritedBefore(base,path){const key=base+':'+path;if(!inheritedBlobs.has(key))inheritedBlobs.set(key,execFileSync('git',['show',key],{cwd:root,maxBuffer:64e6}));return Buffer.from(inheritedBlobs.get(key));}
export function stagedPrior(path){
 if(!baseline){
  const entries=git(['ls-tree','-r','-z',STAGED_BASE]).split('\0').filter(Boolean).map(r=>{const [meta,path]=r.split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(type,'blob');assert.match(mode,/^100[0-7]{3}$/);return {path,oid};});
  const data=execFileSync('git',['cat-file','--batch'],{cwd:root,input:entries.map(r=>r.oid).join('\n')+'\n',maxBuffer:64e6});let offset=0;baseline=new Map();
  for(const e of entries){const end=data.indexOf(10,offset);assert(end>=0);const [oid,type,size]=data.subarray(offset,end).toString().split(' ');assert.equal(oid,e.oid);assert.equal(type,'blob');const length=Number(size);assert(Number.isSafeInteger(length)&&length>=0);offset=end+1;assert.equal(data[offset+length],10);baseline.set(e.path,Buffer.from(data.subarray(offset,offset+length)));offset+=length+1;}assert.equal(offset,data.length);
 }
 const bytes=baseline.get(path);return bytes===undefined?null:Buffer.from(bytes);
}
export function stagedChangedPaths(){
 return vnextBaselineChangedPaths(STAGED_BASE);
}
export function stagedTransition(source=raw,paths){
 const outer=vnextPredecessorViews(source===raw?undefined:source),actual=outer.actualPredecessorRead;
 const result=restoreStaged(outer.predecessorRead,paths??outer.changedPaths(STAGED_BASE),actual);
 outer.verify();return result;
}
// Construct the actual historical view from this invocation's already-admitted
// outer reader, not by recursively opening a second identical live admission.
// Public gates still perform a fresh live revalidation before returning.
function restoreStaged(source,paths,actual){
 const present=Object.keys(STAGED_SCOPES).filter(id=>existsSync(new URL('../../'+stagedManifestPath(id),import.meta.url)));
 const ids=present.filter(id=>{
  const path=stagedManifestPath(id),m=JSON.parse(source(path));
  if(m.base===STAGED_BASE)return true;
  // Preserve merged receipts byte-for-byte; they are dependencies, not work to
  // redevelop/retest. An unmerged or modified obsolete receipt is never skipped.
  const prior=stagedPrior(path);
  assert(prior&&actual(path).equals(prior)&&Buffer.from(source(path)).equals(prior),'STAGED_UNMERGED_OR_CHANGED_OLD_RECEIPT:'+id);
  return false;
 });
 if(!ids.length)return null;
 const files=new Map(),manifests=[];
 for(const id of ids){
  const m=JSON.parse(source(stagedManifestPath(id)));assert.equal(m.schema,'STAGED_RELEASE_240_V1');assert.equal(m.batch,id);assert.equal(m.base,STAGED_BASE);
  for(const flag of ['production_authorized','member_publication_authorized','secret_change','cron_change','auth_model_change','recommendation_threshold_change','historical_data_change'])assert.equal(m[flag],false,flag);
  const changed=STAGED_SCOPES[id].filter(path=>{const prior=stagedPrior(path);return !prior||!actual(path).equals(prior);});
  assert.deepEqual(m.files.map(r=>r.path).sort(),changed,'STAGED_EXACT_NAMED_SCOPE:'+id);
  for(const row of m.files){
   assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256'].sort());
   const prior=stagedPrior(row.path);assert.equal(row.before_sha256,prior===null?null:hash(prior));assert.notEqual(row.before_sha256,row.after_sha256);
   assert.match(row.after_sha256,/^[a-f0-9]{64}$/);
   assert.equal(hash(actual(row.path)),row.after_sha256,'STAGED_LIVE_DRIFT:'+row.path);
   assert.equal(hash(source(row.path)),row.after_sha256,'STAGED_SOURCE_DRIFT:'+row.path);
   if(files.has(row.path))assert.deepEqual(files.get(row.path),row,'STAGED_SHARED_SOURCE_CONFLICT');files.set(row.path,row);
  }
  manifests.push(m);
 }
 assert.deepEqual([...paths].sort(),[...files.keys(),...ids.map(stagedManifestPath)].sort(),'STAGED_UNKNOWN_WORKTREE_PATH');
 stagedPrior('package.json');
 for(const [path,bytes]of baseline)if(!files.has(path))assert.deepEqual(actual(path),bytes,'STAGED_PROTECTED_BASELINE:'+path);
 return {files,manifests};
}
export function stagedViews(source){
 const outer=vnextPredecessorViews(source);
 const current=restoreStaged(outer.actualPredecessorRead,outer.changedPaths(STAGED_BASE),outer.actualPredecessorRead);
 outer.verify();
 if(!current)return {predecessorRead:source??raw,actualPredecessorRead:raw,verify:()=>{},changedPaths:prior=>git(['diff','--no-renames','--name-only','-z',prior,'--']).split('\0').filter(Boolean).sort()};
 const restore=path=>{if(current.files.has(path)){const before=stagedPrior(path);if(before===null)throw Object.assign(Error('STAGED_PREDECESSOR_ABSENT:'+path),{code:'ENOENT'});return before;}return outer.actualPredecessorRead(path);};
 const historical=source?path=>{if(current.files.has(path)){const bytes=outer.predecessorRead(path);if(hash(bytes)===current.files.get(path).after_sha256)return restore(path);return bytes;}return outer.predecessorRead(path);}:restore;
 return {predecessorRead:historical,actualPredecessorRead:restore,verify:()=>stagedTransition(),changedPaths:prior=>rangePaths(prior,STAGED_BASE)};
}

/** Older release receipts are validated at their own exact historical base.
 * This does NOT alter current runtime admission or permit changed B1 bytes. */
export function historicalStagedViews(source){
 const outer=stagedViews(source),path=stagedManifestPath('B1'),bytes=stagedPrior(path);
 if(!bytes)return outer;
 const receipt=JSON.parse(bytes),priorBase='2a5d461ec3d98bfc8bc3177a295c95e299b7bda2';
 assert.equal(receipt.base,priorBase,'STAGED_UNKNOWN_INHERITED_BASE');
 assert(raw(path).equals(bytes),'STAGED_INHERITED_RECEIPT_DRIFT');
 const files=new Map(receipt.files.map(f=>[f.path,f]));
 assert.deepEqual([...files.keys()].sort(),STAGED_SCOPES.B1,'STAGED_INHERITED_EXACT_SCOPE');
 const priors=new Map();
 for(const f of files.values()){
  assert.equal(hash(outer.actualPredecessorRead(f.path)),f.after_sha256,'STAGED_MERGED_B1_DRIFT');
  const prior=f.before_sha256===null?null:inheritedBefore(priorBase,f.path);
  assert.equal(prior===null?null:hash(prior),f.before_sha256,'STAGED_INHERITED_BEFORE_DRIFT');priors.set(f.path,prior);
 }
 const restore=(reader,path)=>{
  const value=reader(path),f=files.get(path);
  if(path===stagedManifestPath('B1'))throw Object.assign(Error('STAGED_PREDECESSOR_ABSENT:'+path),{code:'ENOENT'});
  if(!f||hash(value)!==f.after_sha256)return value;
  const prior=priors.get(path);if(prior===null)throw Object.assign(Error('STAGED_PREDECESSOR_ABSENT:'+path),{code:'ENOENT'});return Buffer.from(prior);
 };
 return {predecessorRead:path=>restore(outer.predecessorRead,path),actualPredecessorRead:path=>restore(outer.actualPredecessorRead,path),
  verify:()=>outer.verify(),changedPaths:prior=>rangePaths(prior,priorBase)};
}
