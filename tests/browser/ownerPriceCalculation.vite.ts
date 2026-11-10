import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {createOwnerCalculationFixture,SYNTHETIC_CALCULATION_OWNER} from '../helpers/dailyAiOwnerPriceCalculationFixture.mjs';

// Local synthetic UI acceptance only. This file is not an application route,
// production build entry, source acquisition tool or publication workflow.
export default defineConfig(({command})=>{
 if(command!=='serve'||process.env.MA_OWNER_PRICE_PREVIEW!=='SYNTHETIC_LOCAL_ONLY')throw Error('SYNTHETIC_LOCAL_PREVIEW_ONLY');
 const fixtures=Promise.all([
  createOwnerCalculationFixture({horizon:'SHORT'}),createOwnerCalculationFixture({horizon:'MEDIUM',reportedEps:true}),
  createOwnerCalculationFixture({horizon:'LONG'}),createOwnerCalculationFixture({horizon:'LONG',dividendMethod:true,symbol:'1001'}),
 ]);
 return {envDir:false,plugins:[react(),{name:'synthetic-owner-price-calculation-preview',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(!['127.0.0.1:3218','localhost:3218'].includes(req.headers.host??'')){res.statusCode=403;res.end('Local synthetic preview only');return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3218 ws://localhost:3218; img-src 'self' data:; frame-src 'none'; object-src 'none'");
  if(req.url?.startsWith('/__owner-price-fixture')){
   if(req.method!=='GET'){res.statusCode=405;res.end('Read only');return;}
   const url=new URL(req.url,'http://127.0.0.1:3218');res.setHeader('Content-Type','application/json; charset=utf-8');
   void fixtures.then(rows=>{
    if(url.searchParams.get('kind')==='prices'){res.end(JSON.stringify({schema:'VNEXT_AI_OWNER_PRICE_PLANS_V1',edition_id:'a'.repeat(64),subject_user_id:SYNTHETIC_CALCULATION_OWNER,
     research_only:true,preview_only:true,plans:rows.map(f=>f.row)}));return;}
    const row=url.searchParams.get('kind')==='calculation'?rows.find(f=>f.row.plan_hash===url.searchParams.get('plan')):null;
    if(!row){res.statusCode=404;res.end('{}');return;}res.end(JSON.stringify(row.response));
   }).catch(()=>{res.statusCode=500;res.end('{"error":"SYNTHETIC_FIXTURE_UNAVAILABLE"}');});return;
  }
  if(req.url!=='/__owner-price-review')return next();
  res.setHeader('Content-Type','text/html; charset=utf-8');
  void server.transformIndexHtml('/__owner-price-review','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Morning Alpha — 合成流程驗證</title></head><body><div id="root"></div><script type="module" src="/tests/browser/ownerPriceCalculationHarness.tsx"></script></body></html>').then(html=>res.end(html)).catch(next);
 });}}],resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'ownerPriceCalculationSupabaseMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},
 server:{host:'127.0.0.1',port:3218,strictPort:true}};
});
