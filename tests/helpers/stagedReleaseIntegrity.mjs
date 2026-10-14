import assert from 'node:assert/strict';
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const STAGED_BASE='2a5d461ec3d98bfc8bc3177a295c95e299b7bda2';
export const STAGED_SCOPES=Object.freeze({
  "A": [
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
    "tests/ownerCockpit.test.mjs",
    "tests/stagedReleaseIntegrity.test.mjs"
  ],
  "B1": [
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
    "tests/stagedReleaseIntegrity.test.mjs"
  ],
  "C": [
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
    "supabase/functions/_shared/vnext-daily-hook.ts",
    "supabase/functions/recommendation-v2-forward-worker-v1/index.ts",
    "supabase/functions/vnext-daily-research-v1/handler.ts",
    "supabase/functions/vnext-daily-research-v1/index.ts",
    "supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql",
    "tests/fixtures/vnext.mjs",
    "tests/helpers/marketNewsReportIntegrity.mjs",
    "tests/helpers/stagedReleaseIntegrity.mjs",
    "tests/stagedReleaseIntegrity.test.mjs",
    "tests/vnextDailyDatabase.integration.mjs",
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
export function stagedPrior(path){
 if(!baseline){
  const entries=git(['ls-tree','-r','-z',STAGED_BASE]).split('\0').filter(Boolean).map(r=>{const [meta,path]=r.split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(type,'blob');assert.match(mode,/^100[0-7]{3}$/);return {path,oid};});
  const data=execFileSync('git',['cat-file','--batch'],{cwd:root,input:entries.map(r=>r.oid).join('\n')+'\n',maxBuffer:64e6});let offset=0;baseline=new Map();
  for(const e of entries){const end=data.indexOf(10,offset);assert(end>=0);const [oid,type,size]=data.subarray(offset,end).toString().split(' ');assert.equal(oid,e.oid);assert.equal(type,'blob');const length=Number(size);assert(Number.isSafeInteger(length)&&length>=0);offset=end+1;assert.equal(data[offset+length],10);baseline.set(e.path,Buffer.from(data.subarray(offset,offset+length)));offset+=length+1;}assert.equal(offset,data.length);
 }
 const bytes=baseline.get(path);return bytes===undefined?null:Buffer.from(bytes);
}
export function stagedChangedPaths(){
 return [...new Set([...git(['diff','--no-renames','--name-only','-z',STAGED_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();
}
export function stagedTransition(source=raw,paths=stagedChangedPaths()){
 const ids=Object.keys(STAGED_SCOPES).filter(id=>existsSync(new URL('../../'+stagedManifestPath(id),import.meta.url)));
 if(!ids.length)return null;
 const files=new Map(),manifests=[];
 for(const id of ids){
  const m=JSON.parse(source(stagedManifestPath(id)));assert.equal(m.schema,'STAGED_RELEASE_240_V1');assert.equal(m.batch,id);assert.equal(m.base,STAGED_BASE);
  for(const flag of ['production_authorized','member_publication_authorized','secret_change','cron_change','auth_model_change','recommendation_threshold_change','historical_data_change'])assert.equal(m[flag],false,flag);
  assert.deepEqual(m.files.map(r=>r.path).sort(),STAGED_SCOPES[id],'STAGED_EXACT_NAMED_SCOPE:'+id);
  for(const row of m.files){
   assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256'].sort());
   const prior=stagedPrior(row.path);assert.equal(row.before_sha256,prior===null?null:hash(prior));assert.notEqual(row.before_sha256,row.after_sha256);
   assert.match(row.after_sha256,/^[a-f0-9]{64}$/);
   assert.equal(hash(raw(row.path)),row.after_sha256,'STAGED_LIVE_DRIFT:'+row.path);
   assert.equal(hash(source(row.path)),row.after_sha256,'STAGED_SOURCE_DRIFT:'+row.path);
   if(files.has(row.path))assert.deepEqual(files.get(row.path),row,'STAGED_SHARED_SOURCE_CONFLICT');files.set(row.path,row);
  }
  manifests.push(m);
 }
 assert.deepEqual([...paths].sort(),[...files.keys(),...ids.map(stagedManifestPath)].sort(),'STAGED_UNKNOWN_WORKTREE_PATH');
 stagedPrior('package.json');
 for(const [path,bytes]of baseline)if(!files.has(path))assert.deepEqual(raw(path),bytes,'STAGED_PROTECTED_BASELINE:'+path);
 return {files,manifests};
}
export function stagedViews(source){
 const current=stagedTransition();
 if(!current)return {predecessorRead:source??raw,actualPredecessorRead:raw,verify:()=>{},changedPaths:prior=>git(['diff','--no-renames','--name-only','-z',prior,'--']).split('\0').filter(Boolean).sort()};
 const restore=path=>{if(current.files.has(path)){const before=stagedPrior(path);if(before===null)throw Object.assign(Error('STAGED_PREDECESSOR_ABSENT:'+path),{code:'ENOENT'});return before;}return raw(path);};
 const historical=source?path=>{if(current.files.has(path)){const bytes=source(path);if(hash(bytes)===current.files.get(path).after_sha256)return restore(path);return bytes;}return source(path);}:restore;
 return {predecessorRead:historical,actualPredecessorRead:restore,verify:()=>stagedTransition(),changedPaths:prior=>git(['diff','--no-renames','--name-only','-z',prior,STAGED_BASE,'--']).split('\0').filter(Boolean).sort()};
}
