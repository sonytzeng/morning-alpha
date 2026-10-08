import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readPrivateEntryReplay} from '../entryOpportunityRealReplay.integration.mjs';
export default defineConfig(({command})=>{
 const db=process.env.MA_ISOLATED_TEST_DB||'',container=process.env.MA_TEST_DOCKER_CONTAINER||'';
 const privateFixtures=process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR;
 if(privateFixtures&&process.env.CI)throw Error('PRIVATE_FIXTURE_NOT_FOR_PUBLIC_CI');
 if(command!=='serve'||process.env.MA_ENTRY_UI_SCOPE!=='LOCAL_ONLY'||!/^ma_entry_test\d+$/.test(db)||!/^ma-entry-ci-\d+$/.test(container))throw Error('LOCAL_ISOLATION_REQUIRED');
 return {envDir:false,plugins:[react(),{name:'entry-isolated-owner',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.headers.host!=='127.0.0.1:3204'){res.statusCode=403;res.end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3204; img-src 'self' data:; frame-src 'none'; object-src 'none'");
  if(req.url?.startsWith('/__entry_read')){
   const role=new URL(req.url,'http://127.0.0.1:3204').searchParams.get('role');
   const ids:Record<string,string>={owner:'10000000-0000-4000-8000-000000000001',member:'10000000-0000-4000-8000-000000000002',paid:'10000000-0000-4000-8000-000000000003'};
   const identity=role&&ids[role]?`set local role authenticated;set local request.jwt.claim.sub='${ids[role]}';`:'set local role anon;';
   try{const data=execFileSync('docker',['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input:`begin read only;${identity}select get_owner_entry_opportunity_v1();rollback;`,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();res.setHeader('Content-Type','application/json');
    // Real retained output is LOCAL ONLY and released only after the unchanged
    // isolated Owner RPC has authorized the read. No Production session or DB.
    if(privateFixtures){const date=new URL(req.url,'http://127.0.0.1:3204').searchParams.get('date')||'2026-10-08';
     void readPrivateEntryReplay(privateFixtures,date).then(({result})=>res.end(JSON.stringify({...JSON.parse(data),latest:result,historical_replay_count:2,forward_sample:0,outcome_sample:0})))
      .catch(()=>{res.statusCode=409;res.end('{}');});
    }else res.end(data);
   }catch{res.statusCode=403;res.end('{}');}return;
  }
  if(!req.url?.startsWith('/__entry_owner'))return next();
  res.setHeader('Content-Type','text/html; charset=utf-8');void server.transformIndexHtml('/__entry_owner',`<!doctype html><html lang="zh-Hant" data-evidence-kind="${privateFixtures?'real-retained':'synthetic'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Entry LOCAL ISOLATION</title></head><body><div id="root"></div><script type="module" src="/tests/browser/entryOpportunityHarness.tsx"></script></body></html>`).then(s=>res.end(s)).catch(next);
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'entryOpportunitySupabaseMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},server:{host:'127.0.0.1',port:3204,strictPort:true}};
});
