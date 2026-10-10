import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {loadRetainedResearch} from '../../scripts/vnext/real-evidence.mjs';
import {readOwnerResearch} from '../../scripts/vnext/owner-research-server.mjs';
import {foundationSummary} from '../../scripts/vnext/foundation-validation.mjs';
import {auditPublication} from '../../scripts/vnext/publication-readiness.mjs';
const root=resolve(import.meta.dirname,'../..'),port=Number(process.env.MA_VNEXT_PORT||3220),origin=`http://127.0.0.1:${port}`;
export default defineConfig(async({command})=>{
 if(command!=='serve'||process.env.MA_VNEXT_LOCAL!=='ISOLATED_ONLY'||!process.env.MA_VNEXT_ANON||![3220,3221,3222,3223,3224].includes(port))throw Error('LOCAL_ONLY');
 const reports=process.env.MA_VNEXT_REAL_PREVIEW==='ISOLATED_OWNER_ONLY'?await loadRetainedResearch(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,process.env.MA_VNEXT_DISPLAY_NAMES):null;
 const foundation=reports&&process.env.MA_VNEXT_FOUNDATION_DIR?foundationSummary(process.env.MA_VNEXT_FOUNDATION_DIR):null;
 const publication=foundation&&process.env.MA_VNEXT_PUBLICATION_PREVIEW==='REAL_EMPTY'?auditPublication(process.env.MA_VNEXT_FOUNDATION_DIR,process.env.MA_VNEXT_DISPLAY_NAMES):null;
 return {root,envDir:false,envPrefix:'VNEXT_UNUSED_',publicDir:false,cacheDir:'/private/tmp/ma-vnext-vite',define:{'import.meta.env.VNEXT_REAL_PREVIEW':JSON.stringify(reports?'true':'false'),'import.meta.env.VNEXT_PUBLICATION_PREVIEW':JSON.stringify(publication?'true':'false')},
 optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','@supabase/supabase-js','lucide-react']},
 css:{postcss:{plugins:[]}},
 plugins:[react(),{name:'vnext-isolated-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==origin){res.statusCode=403;res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  const path=req.url?.split('?')[0];
  if(path==='/__vnext_owner_research'){
   if(!reports){res.statusCode=404;res.end();return;}
   const result=await readOwnerResearch({method:req.method,authorization:req.headers.authorization},reports,fetch,foundation,publication);
   res.statusCode=result.status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result.body));return;
  }
  if(path==='/__vnext_public_config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({anon:process.env.MA_VNEXT_ANON}));return;}
  // Isolated preview has no live Core/report producer. Explicit unknown, not a
  // fabricated canonical direction and never a proxy to Production.
  if(path==='/functions/v1/get-report-payload'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({payload:null,report_date:null,source:'ISOLATED_CORE_NOT_CONNECTED'}));return;}
  if(['/stocks','/account','/report/today','/pricing','/vnext','/vnext/research','/login','/academy'].includes(path||'')){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await server.transformIndexHtml('/vnext','<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Morning Alpha VNext 研究預覽</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/tests/browser/vnext.harness.tsx"></script></body></html>'));return;}next();
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(root,'tests/browser/vnext.client.ts')},{find:'@',replacement:resolve(root,'src')}]},server:{host:'127.0.0.1',port,strictPort:true,cors:false,fs:{strict:true,allow:[root],deny:['**/.env*','**/.git/**','**/*.pem','**/*.key']},proxy:{'/auth/v1':{target:'http://127.0.0.1:55632',rewrite:p=>p.replace(/^\/auth\/v1/,'')},'/rest/v1':{target:'http://127.0.0.1:55633',rewrite:p=>p.replace(/^\/rest\/v1/,'')}}}};
});
