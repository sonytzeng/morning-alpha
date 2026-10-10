import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3220';
export default defineConfig(({command})=>{
 if(command!=='serve'||process.env.MA_VNEXT_LOCAL!=='ISOLATED_ONLY'||!process.env.MA_VNEXT_ANON)throw Error('LOCAL_ONLY');
 return {root,envDir:false,envPrefix:'VNEXT_UNUSED_',publicDir:false,cacheDir:'/private/tmp/ma-vnext-vite',
 optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react/jsx-runtime','@supabase/supabase-js','lucide-react']},
 css:{postcss:{plugins:[]}},
 plugins:[react(),{name:'vnext-isolated-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.headers.host!=='127.0.0.1:3220'||req.headers.origin&&req.headers.origin!==origin){res.statusCode=403;res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  const path=req.url?.split('?')[0];
  if(path==='/__vnext_public_config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({anon:process.env.MA_VNEXT_ANON}));return;}
  if(['/vnext','/login','/academy'].includes(path||'')){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await server.transformIndexHtml('/vnext','<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Morning Alpha VNext 研究預覽</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/tests/browser/vnext.harness.tsx"></script></body></html>'));return;}next();
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(root,'tests/browser/vnext.client.ts')},{find:'@',replacement:resolve(root,'src')}]},server:{host:'127.0.0.1',port:3220,strictPort:true,cors:false,fs:{strict:true,allow:[root],deny:['**/.env*','**/.git/**','**/*.pem','**/*.key']},proxy:{'/auth/v1':{target:'http://127.0.0.1:55632',rewrite:p=>p.replace(/^\/auth\/v1/,'')},'/rest/v1':{target:'http://127.0.0.1:55633',rewrite:p=>p.replace(/^\/rest\/v1/,'')}}}};
});
