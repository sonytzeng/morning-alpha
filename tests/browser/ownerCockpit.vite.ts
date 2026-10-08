import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {readPrivateEntryReplay} from '../entryOpportunityRealReplay.integration.mjs';
export default defineConfig(({command})=>{
 const db=process.env.MA_ISOLATED_TEST_DB||'',container=process.env.MA_TEST_DOCKER_CONTAINER||'',dir=process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR;
 if(command!=='serve'||process.env.MA_COCKPIT_UI_SCOPE!=='LOCAL_ONLY'||process.env.CI||!dir||!/^ma_cockpit_test\d+$/.test(db)||!/^ma-entry-ci-\d+$/.test(container))throw Error('LOCAL_ISOLATION_REQUIRED');
 const exec=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 if(JSON.parse(exec(['inspect',container]))[0].HostConfig.NetworkMode!=='none')throw Error('NETWORK_ISOLATION_REQUIRED');
 const sql=(s:string)=>exec(['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],s);
 const retained=Promise.all(['2026-10-07','2026-10-08'].map(date=>readPrivateEntryReplay(dir,date).then(r=>r.result)));
 return {envDir:false,plugins:[react(),{name:'cockpit-isolated-read-only',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.headers.host!=='127.0.0.1:3205'){res.statusCode=403;res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3205; img-src 'self' data:; frame-src 'none'; object-src 'none'");
  if(req.url?.startsWith('/__cockpit_read')){
   if(req.method!=='GET'){res.statusCode=405;res.end();return;}
   const url=new URL(req.url,'http://127.0.0.1:3205'),role=url.searchParams.get('role');
   const ids:Record<string,string>={owner:'10000000-0000-4000-8000-000000000001',member:'10000000-0000-4000-8000-000000000002',paid:'10000000-0000-4000-8000-000000000003'};
   const id=role&&ids[role];
   try{
    if(!id||sql(`begin read only;set local role authenticated;set local request.jwt.claim.sub='${id}';select is_research_owner_v1();rollback;`)!=='t')throw Error('DENY');
    res.setHeader('Content-Type','application/json');
    if(url.searchParams.get('kind')==='journal'){
     const j=JSON.parse(sql(`begin read only;set local role service_role;select owner_cockpit_read_v1('${id}');rollback;`));
     j.positions=j.positions.map((p:Record<string,unknown>)=>({...p,mark:null,unrealized:p.quantity===0?0:null}));res.end(JSON.stringify(j));return;
    }
    void retained.then(rows=>res.end(JSON.stringify({owner_only:true,shadow_only:true,production_eligible:false,today_date:'2026-10-09',latest:rows[1],history:rows,forward_sample:0,outcome_sample:0}))).catch(()=>{res.statusCode=409;res.end('{}');});
   }catch{res.statusCode=403;res.end('{}');}return;
  }
  if(!req.url?.startsWith('/__cockpit_owner'))return next();
  res.setHeader('Content-Type','text/html; charset=utf-8');void server.transformIndexHtml('/__cockpit_owner','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cockpit LOCAL ISOLATION</title></head><body><div id="root"></div><script type="module" src="/tests/browser/ownerCockpitHarness.tsx"></script></body></html>').then(s=>res.end(s)).catch(next);
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'ownerCockpitSupabaseMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},server:{host:'127.0.0.1',port:3205,strictPort:true}};
});
