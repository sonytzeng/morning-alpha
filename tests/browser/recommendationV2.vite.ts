import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
export default defineConfig(({command})=>{
 const db=process.env.MA_ISOLATED_TEST_DB||'';
 if(command!=='serve'||process.env.MA_V2_UI_SCOPE!=='LOCAL_ONLY'||!/^ma_v2_shadow_test\d+$/.test(db))throw Error('LOCAL_ISOLATION_REQUIRED');
 return {envDir:false,plugins:[react(),{name:'v2-isolated-owner',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(!['127.0.0.1:3195','localhost:3195'].includes(req.headers.host||'')){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3195; img-src 'self' data:; frame-src 'none'; object-src 'none'");res.setHeader('Cache-Control','no-store');
  if(req.url?.startsWith('/__v2_read')){
   const role=new URL(req.url,'http://127.0.0.1:3195').searchParams.get('role');
   const ids:Record<string,string>={owner:'10000000-0000-4000-8000-000000000001',member:'10000000-0000-4000-8000-000000000002',paid:'10000000-0000-4000-8000-000000000003'};
   const identity=role&&ids[role]?`set local role authenticated;set local request.jwt.claim.sub='${ids[role]}';`:'set local role anon;';
   try{const data=execFileSync('docker',['exec','-i','ma-recommendation-owner-ci','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input:`begin;${identity}select get_owner_recommendation_shadow_v2();rollback;`,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();res.setHeader('Content-Type','application/json');res.end(data);}catch{res.statusCode=403;res.end('{}');}return;
  }
  if(!req.url?.startsWith('/__v2_owner'))return next();
  res.setHeader('Content-Type','text/html; charset=utf-8');void server.transformIndexHtml('/__v2_owner','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL SYNTHETIC V2</title></head><body><div id="root"></div><script type="module" src="/tests/browser/recommendationV2Harness.tsx"></script></body></html>').then(s=>res.end(s)).catch(next);
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'recommendationV2SupabaseMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},server:{host:'127.0.0.1',port:3195,strictPort:true}};
});
