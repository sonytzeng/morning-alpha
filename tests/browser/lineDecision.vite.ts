import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(({command})=>{
 if(command!=='serve'||process.env.MA_LINE_PREVIEW_TEST!=='LOCAL_ONLY')throw Error('LOCAL_ONLY');
 return {envDir:false,plugins:[react(),{name:'line-preview-local',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(!['127.0.0.1:3197','localhost:3197'].includes(req.headers.host||'')){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3197; img-src 'self' data:; frame-src 'none'; object-src 'none'");
  if(!req.url?.startsWith('/__line_preview'))return next();
  res.setHeader('Content-Type','text/html; charset=utf-8');void server.transformIndexHtml('/__line_preview','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL SYNTHETIC LINE PREVIEW</title></head><body><div id="root"></div><script type="module" src="/tests/browser/lineDecisionHarness.tsx"></script></body></html>').then(s=>res.end(s)).catch(next);
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'lineDecisionMock.ts')},{find:'@/services/entitlementService',replacement:resolve(__dirname,'lineDecisionMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},server:{host:'127.0.0.1',port:3197,strictPort:true}};
});
