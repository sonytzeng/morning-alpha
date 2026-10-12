import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vnextTransition,vnextChangedPaths,vnextPrior,VNEXT_MANIFEST,VNEXT_PATHS} from './helpers/vnextIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('member release changes only named route/navigation mounts, not existing product logic',()=>{
 const navbar='src/components/feature/Navbar.tsx',account='src/pages/account/Account.tsx',router='src/router/config.tsx';
 assert.equal(read(navbar).toString(),vnextPrior(navbar).toString()
  .replace("import { ACADEMY_NAVIGATION } from '@/features/academy/navigation';","import { ACADEMY_NAVIGATION } from '@/features/academy/navigation';\nimport { STOCK_OBSERVATION_NAV } from '@/features/vnext/member';")
  .replace('    ACADEMY_NAVIGATION,','    ACADEMY_NAVIGATION,\n    STOCK_OBSERVATION_NAV,'));
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
test('V2 worker adds only a detached VNext enqueue after successful natural checkpoint admission',()=>{
 const path='supabase/functions/recommendation-v2-forward-worker-v1/index.ts',prior=vnextPrior(path).toString();
 const expected=prior.replace("import type { Capture } from '../_shared/recommendation-stock-evidence.ts';","import type { Capture } from '../_shared/recommendation-stock-evidence.ts';\nimport { enqueueVnextAfterCheckpoint } from '../_shared/vnext-daily-hook.ts';")
  .replace('  const receipt=object(claim.data);',"  const receipt=object(claim.data);\n  if(['ACQUIRED','COMPLETE','SKIPPED_NO_WATCH'].includes(String(receipt.status)))enqueueVnextAfterCheckpoint(input,{url,gatewayJwt:Deno.env.get('SUPABASE_ANON_KEY')||'',cronSecret:Deno.env.get('CRON_SECRET')||'',background:p=>runtime.waitUntil(p),fetcher:fetch});");
 assert.equal(read(path).toString(),expected);assert.equal((expected.match(/enqueueVnextAfterCheckpoint\(input/g)||[]).length,1);
});
test('Validate preserves main news replay and budget, only changes prebuild order and TCP readiness',()=>{
 const path='.github/workflows/validate-release.yml',prior=vnextPrior(path).toString();
 const expected=prior.replace('      - run: npm run build\n','')
  .replace('      - run: npm run test:public','      # Prebuild before parallel tests: preserve generated-file integrity.\n      - run: npm run build\n      - run: npm run test:public')
  .replaceAll('pg_isready -U postgres','pg_isready -h 127.0.0.1 -U postgres');
 assert.notEqual(expected,prior);assert.equal(read(path).toString(),expected);
 const commands=s=>[...s.matchAll(/^      - run: (.+)$/gm)].map(m=>m[1]).sort();
 assert.deepEqual(commands(expected),commands(prior));
 assert.ok(expected.indexOf('- run: npm run build')<expected.indexOf('- run: npm run test:public'));
 assert.equal((expected.match(/pg_isready -h 127\.0\.0\.1 -U postgres/g)||[]).length,8);
 assert.match(expected,/timeout-minutes: 45/);assert.match(expected,/MA_TEST_PSQL/);
});
test('Cockpit CI only checks final TCP server, not the socket-only bootstrap; product and security unchanged',()=>{
 const path='.github/workflows/owner-cockpit.yml',prior=vnextPrior(path).toString(),current=read(path).toString();
 assert.equal(current,prior.replaceAll('pg_isready -U postgres','pg_isready -h 127.0.0.1 -U postgres'));
 assert.equal((current.match(/pg_isready -h 127\.0\.0\.1 -U postgres/g)||[]).length,2);
 assert.match(current,/--network none/);assert.doesNotMatch(current,/pg_isready -U postgres/);
});
test('Shadow analysis CI only extends the proven runtime budget, preserving every test and isolation control',()=>{
 const path='.github/workflows/analysis-intelligence.yml',prior=vnextPrior(path).toString(),current=read(path).toString();
 assert.equal(current,prior.replace('timeout-minutes: 10','timeout-minutes: 20'));
 assert.equal((prior.match(/timeout-minutes: 10/g)||[]).length,1);
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
