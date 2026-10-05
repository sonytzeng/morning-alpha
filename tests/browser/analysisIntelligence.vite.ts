import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { realInput } from '../helpers/phase2AnalysisFixtures.mjs';
import { analyzeIntelligence } from '../../supabase/functions/_shared/analysis-intelligence-v1.mjs';

export default defineConfig(({ command }) => {
  if (command !== 'serve' || process.env.MA_PHASE2_PREVIEW !== 'LOCAL_ONLY') throw new Error('LOCAL_ONLY');
  const analysis = analyzeIntelligence(realInput('2026-10-02'), realInput('2026-10-01'));
  return { envDir: false, plugins: [react(), {
    name: 'isolated-analysis-preview', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!['127.0.0.1:3198','localhost:3198'].includes(req.headers.host || '')) { res.statusCode = 403; res.end(); return; }
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3198; img-src 'self' data:; object-src 'none'; frame-src 'none'");
        res.setHeader('Cache-Control','no-store');
        if(req.url === '/__phase2_fixture') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({
          schema_version:'OWNER_ANALYSIS_V1',mode:'SHADOW_ONLY',production_eligible:false,forward_sample:0,analysis_value:'INSUFFICIENT_SAMPLE',
          latest:{id:'LOCAL_HISTORICAL_REPLAY',created_at:'2026-10-05T00:00:00Z',compute_ms:1,analysis},invalidations:[],
        }));return; }
        if(!req.url?.startsWith('/__analysis'))return next();
        res.setHeader('Content-Type','text/html; charset=utf-8');
        void server.transformIndexHtml('/__analysis','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL Phase 2 Historical Replay</title></head><body><div id="root"></div><script type="module" src="/tests/browser/analysisIntelligenceHarness.tsx"></script></body></html>').then(s=>res.end(s)).catch(next);
      });
    },
  }], resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'analysisIntelligenceSupabaseMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},
  server:{host:'127.0.0.1',port:3198,strictPort:true}};
});
