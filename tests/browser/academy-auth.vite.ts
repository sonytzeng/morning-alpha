import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),origin='http://127.0.0.1:3219';
export default defineConfig(({command})=>{
 if(command!=='serve'||process.env.MA_ACADEMY_REAL_AUTH!=='LOCAL_ONLY'||!process.env.MA_ACADEMY_LOCAL_ANON)throw Error('LOCAL_AUTH_ONLY');
 return {root,envDir:false,envPrefix:'ACADEMY_UNUSED_',publicDir:false,cacheDir:'/private/tmp/ma-academy-auth-vite',
 plugins:[react(),{name:'academy-real-auth-local',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.headers.host!=='127.0.0.1:3219'||req.headers.origin&&req.headers.origin!==origin){res.statusCode=403;res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  const path=req.url?.split('?')[0];
  if(path==='/__academy_public_config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({anon:process.env.MA_ACADEMY_LOCAL_ANON}));return;}
  if(path==='/academy'||path==='/account'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(await server.transformIndexHtml('/academy','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Morning Alpha Academy — 本機真實登入驗收</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/tests/browser/academy-auth.harness.tsx"></script></body></html>'));return;}
  next();
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(root,'tests/browser/academy-auth.client.ts')},{find:'@',replacement:resolve(root,'src')}]},
 server:{host:'127.0.0.1',port:3219,strictPort:true,cors:false,fs:{strict:true,allow:[root],deny:['**/.env*','**/.git/**','**/*.pem','**/*.key']},proxy:{
 '/auth/v1':{target:'http://127.0.0.1:55632',rewrite:p=>p.replace(/^\/auth\/v1/,'')},
 '/rest/v1':{target:'http://127.0.0.1:55633',rewrite:p=>p.replace(/^\/rest\/v1/,'')},
 }},};
});
