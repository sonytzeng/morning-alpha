import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {integrationHistoricalReader} from './helpers/integrationAdmission.mjs';
import {vnextTransition,vnextChangedPaths,vnextPrior,vnextBaselineChangedPaths,vnextFileDiffers,VNEXT_MANIFEST,VNEXT_PATHS} from './helpers/vnextIntegrity.mjs';
const read=integrationHistoricalReader('member',p=>readFileSync(new URL('../'+p,import.meta.url)));
test('status projection preserves mode-only, delete, add and reverted-file distinctions',()=>{
 const b=Buffer.from('unchanged');
 assert.equal(vnextFileDiffers(b,b,'100644','100755'),true);
 assert.equal(vnextFileDiffers(b,b,'100755','100644'),true);
 assert.equal(vnextFileDiffers(b,b,'100644','100644'),false);
 assert.equal(vnextFileDiffers(b,undefined,'100644',undefined),true);
 assert.equal(vnextFileDiffers(null,b,undefined,'100644'),true);
 assert.equal(vnextFileDiffers(null,undefined,undefined,undefined),false);
 assert.equal(vnextFileDiffers(null,undefined,undefined,undefined,true),true,'unknown inventory claim cannot disappear between status and read');
});
test('fresh status admission equals the uncached Git worktree diff and untracked inventory',()=>{
 const git=args=>execFileSync('git',args,{encoding:'utf8'}).split('\0').filter(Boolean);
 const expected=[...new Set([...git(['diff','--no-renames','--name-only','-z','cf3b6b21c9e3d022a8132ed3b566b544d290a48f','--']),...git(['ls-files','--others','--exclude-standard','-z'])])].sort();
 assert.deepEqual(vnextChangedPaths(),expected);
});
test('immutable interval cache cannot hide a mutable ref or consumer array mutation',()=>{
 const prior='069e392eea326f6b02fa557e68103715a10b99ba',before=vnextBaselineChangedPaths(prior),copy=[...before];
 before.push('poisoned-consumer-path');assert.deepEqual(vnextBaselineChangedPaths(prior),copy);
 assert.throws(()=>vnextBaselineChangedPaths('main'),/IMMUTABLE_GIT_REVISION_REQUIRED/);
});
test('member release changes only named route/navigation mounts, not existing product logic',()=>{
 const navbar='src/components/feature/Navbar.tsx',account='src/pages/account/Account.tsx',router='src/router/config.tsx';
 assert.equal(read(navbar).toString(),vnextPrior(navbar).toString()
  .replace("import { ACADEMY_NAVIGATION } from '@/features/academy/navigation';","import { ACADEMY_NAVIGATION } from '@/features/academy/navigation';\nimport { STOCK_OBSERVATION_NAV } from '@/features/vnext/member';")
  .replace('    ACADEMY_NAVIGATION,','    ACADEMY_NAVIGATION,\n    STOCK_OBSERVATION_NAV,').replaceAll('14 天完整試用','會員方案'));
 assert.equal(read(account).toString(),vnextPrior(account).toString()
  .replace("import AcademyEntry from './components/AcademyEntry';","import AcademyEntry from './components/AcademyEntry';\nimport { STOCK_OBSERVATION_NAV } from '@/features/vnext/member';")
  .replace('            <AcademyEntry />','            <AcademyEntry />\n            <section className="ma-card-compact"><h2 className="text-lg font-bold text-white">{STOCK_OBSERVATION_NAV.label}</h2><p className="mt-2 text-sm text-white/70">依短、中、長期查看已核准的研究理由與風險；研究不等於正式推薦。</p><Link className="mt-3 inline-flex min-h-11 items-center text-primary-300" to={STOCK_OBSERVATION_NAV.to}>查看股票觀察</Link></section>'));
 assert.equal(read(router).toString(),vnextPrior(router).toString()
  .replace('const routes: RouteObject[] = [','const StockObservations = lazy(() => import("../pages/vnext/MemberPage"));\nconst OwnerPublication = lazy(() => import("../pages/vnext/OwnerPublication"));\n\nconst routes: RouteObject[] = [')
  .replace('const routes: RouteObject[] = [','const routes: RouteObject[] = [\n  {\n    path: "/vnext/publication",\n    element: <DeferredRoute><OwnerPublication /></DeferredRoute>,\n  },\n  {\n    path: "/stocks",\n    element: <DeferredRoute><StockObservations /></DeferredRoute>,\n  },')
  .replace('\n\nconst StockObservations','\nconst StockObservations'));
});
test('VNext exact candidate preserves every Production byte and previous release seal',()=>{
 const result=vnextTransition();assert.equal(result.manifest.production_authorized,false);
 assert.deepEqual(result.predecessorRead('tests/helpers/academyV11Integrity.mjs'),vnextPrior('tests/helpers/academyV11Integrity.mjs'));
 assert.throws(()=>result.predecessorRead('src/features/vnext/engine.ts'),{code:'ENOENT'});
});
test('sealed C runtime and SQL are inherited exactly, never restored from the older PR230 copy',()=>{
 const reference=JSON.parse(read('docs/vnext/core-runtime-reference-20261015.json'));
 assert.equal(reference.c_head,'cf3b6b21c9e3d022a8132ed3b566b544d290a48f');assert.equal(reference.local_files.length,38);
 for(const row of reference.local_files){assert.equal(createHash('sha256').update(read(row.path)).digest('hex'),row.sha256);assert(read(row.path).equals(vnextPrior(row.path)));}
 assert.equal(createHash('sha256').update(read(reference.migration.path)).digest('hex'),reference.migration.sha256);
 assert(read(reference.migration.path).equals(vnextPrior(reference.migration.path)));
 const caller=read('supabase/functions/recommendation-v2-forward-worker-v1/index.ts').toString();
 assert.equal((caller.match(/enqueueVnextAfterCheckpoint\(input/g)||[]).length,1);assert.match(caller,/RECOMMENDATION_GATEWAY_ANON_JWT/);
});
test('isolated Auth retains the exact official digest and configuration; only explicit disposable tmpfs differs',()=>{
 const path='scripts/academy-v11/auth-environment.mjs';
 const previous=execFileSync('git',['show','f96ef92b3e70d02ee6dcd5d52500483da65f3d18:'+path],{encoding:'utf8'});
 const old='public.ecr.aws/supabase/gotrue:v2.194.0',pinned='ghcr.io/supabase/gotrue@sha256:2b352c02adf11a2025cd5993c246ef85db73743553c39194d2b1862d1cc4d1fd';
 assert.equal(previous.split(old).length-1,1);
 const originalRun="  run(['run','-d','--name',db,'--network',name,'-e','POSTGRES_PASSWORD','postgres:17'],{env});";
 assert.equal(previous.split(originalRun).length-1,1);
 const expected=previous.replace(old,pinned)
 .replace('export async function startAuthEnvironment(){',"export async function startAuthEnvironment(){\n assert.ok(process.env.MA_ISOLATED_DB_TMPFS===undefined||['0','1'].includes(process.env.MA_ISOLATED_DB_TMPFS),'ISOLATED_DB_TMPFS_INVALID');")
 .replace(originalRun,"  const ephemeralStorage=process.env.MA_ISOLATED_DB_TMPFS==='1'?['--tmpfs','/var/lib/postgresql/data:rw,size=268435456']:[];\n  run(['run','-d','--name',db,'--network',name,...ephemeralStorage,'-e','POSTGRES_PASSWORD','postgres:17'],{env});");
 assert.equal(read(path).toString(),expected);
});
test('Validate preserves every accepted C check and waits only for three final isolated TCP servers',()=>{
 const path='.github/workflows/validate-release.yml',prior=vnextPrior(path).toString(),current=read(path);
 const socket='docker exec "$MA_TEST_DOCKER_CONTAINER" pg_isready -U postgres';
 assert.equal(current.toString(),prior.replaceAll(socket,'docker exec "$MA_TEST_DOCKER_CONTAINER" pg_isready -h 127.0.0.1 -U postgres'));
 assert.equal(prior.split(socket).length-1,6);
 assert.equal((current.toString().match(/docker exec "\$MA_TEST_DOCKER_CONTAINER" pg_isready -h 127\.0\.0\.1 -U postgres/g)||[]).length,6);
 assert.match(current.toString(),/for attempt in \$\(seq 1 30\)/);assert.match(current.toString(),/--network none/);
 assert.match(current.toString(),/staged-regression\.mjs/);assert.match(current.toString(),/MA_TEST_PSQL/);
 assert.match(read('.github/workflows/vnext-candidate.yml').toString(),/membershipPolicy\.integration\.mjs/);
 assert.match(read('.github/workflows/vnext-candidate.yml').toString(),/vnextDailyDatabase\.integration\.mjs/);
});
test('Cockpit CI only checks final TCP server, not the socket-only bootstrap; product and security unchanged',()=>{
 const path='.github/workflows/owner-cockpit.yml',prior=vnextPrior(path).toString(),current=read(path).toString();
 assert.equal(current,prior.replaceAll('pg_isready -U postgres','pg_isready -h 127.0.0.1 -U postgres'));
 assert.equal((current.match(/pg_isready -h 127\.0\.0\.1 -U postgres/g)||[]).length,2);
 assert.match(current,/--network none/);assert.doesNotMatch(current,/pg_isready -U postgres/);
});
test('Shadow analysis CI inherits the accepted main workflow without replacing its tests',()=>{
 const path='.github/workflows/analysis-intelligence.yml',prior=vnextPrior(path).toString(),current=read(path).toString();
 assert.equal(current,prior);
 assert.match(current,/timeout-minutes: 30/);
 assert.match(current,/PRODUCTION_EQUIVALENT_AUTH_TEST/);
 assert.match(current,/analysisIntelligenceDatabase\.integration\.mjs/);
});
test('unknown paths, changed evidence policy and deployment flags cannot enter through successor view',()=>{
 assert.throws(()=>vnextTransition(read,[...vnextChangedPaths(),'src/rogue.ts']));
 for(const path of ['src/features/vnext/engine.ts','src/router/config.tsx'])assert.throws(()=>vnextTransition(p=>p===path?Buffer.concat([read(p),Buffer.from('\n// drift')]):read(p)));
 for(const field of ['production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change']){
  const m=JSON.parse(read(VNEXT_MANIFEST));m[field]=true;
  assert.throws(()=>vnextTransition(p=>p===VNEXT_MANIFEST?JSON.stringify(m):read(p)));
 }
 const m=JSON.parse(read(VNEXT_MANIFEST));m.files=m.files.slice(1);
 assert.throws(()=>vnextTransition(p=>p===VNEXT_MANIFEST?JSON.stringify(m):read(p)));
 assert.equal(new Set(VNEXT_PATHS).size,VNEXT_PATHS.length);
});
