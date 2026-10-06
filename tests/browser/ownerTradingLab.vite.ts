import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig(({command})=>{
 if(command!=='serve'||process.env.MA_OWNER_UI_SERVER!=='LOCAL_ONLY')throw Error('ISOLATION_ONLY');
 return {envDir:false,plugins:[react(),{name:'owner-lab-isolation',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(!['127.0.0.1:3196','localhost:3196'].includes(req.headers.host||'')){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3196; img-src 'self' data:; frame-src 'none'; object-src 'none'");
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/__owner_lab'){
   void(async()=>{let body='';for await(const c of req){body+=c;if(body.length>16384)throw Error('BOUND');}
    const r=await fetch('http://127.0.0.1:3197',{method:'POST',body});res.setHeader('Content-Type','application/json');res.end(await r.text());
   })().catch(()=>{res.statusCode=503;res.end('{}');});return;
  }
  if(!req.url?.startsWith('/__trading_lab'))return next();
  res.setHeader('Content-Type','text/html; charset=utf-8');void server.transformIndexHtml('/__trading_lab','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL Owner Trading Lab</title></head><body><div id="root"></div><script type="module" src="/tests/browser/ownerTradingLabHarness.tsx"></script></body></html>').then(s=>res.end(s)).catch(next);
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'ownerTradingLabSupabaseMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},server:{host:'127.0.0.1',port:3196,strictPort:true}};
});
