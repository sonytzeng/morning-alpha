import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export default defineConfig(({ command }) => {
  if (command !== 'serve' || process.env.MA_PHASE2_PREVIEW !== 'LOCAL_ONLY') throw new Error('LOCAL_ONLY');
  const db=process.env.MA_ISOLATED_TEST_DB || '';
  if(!/^ma_phase2_analysis_test\d+$/.test(db))throw Error('ISOLATED_PERSISTED_DB_REQUIRED');
  return { envDir: false, plugins: [react(), {
    name: 'isolated-analysis-preview', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!['127.0.0.1:3198','localhost:3198'].includes(req.headers.host || '')) { res.statusCode = 403; res.end(); return; }
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3198; img-src 'self' data:; object-src 'none'; frame-src 'none'");
        res.setHeader('Cache-Control','no-store');
        if(req.url?.startsWith('/__phase2_fixture?')) {
          const query=new URL(req.url,'http://127.0.0.1:3198').searchParams;
          const mode=query.get('mode'), date=query.get('date');
          if(!['HISTORICAL_REPLAY','FORWARD_SHADOW'].includes(mode || '') || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))){res.statusCode=400;res.end();return;}
          const input="begin;set local role authenticated;set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';select get_owner_analysis_v2('"+mode+"',"+(date?"'"+date+"'":"null")+");rollback;";
          const value=execFileSync('docker',['exec','-i','ma-phase2-analysis-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
          res.setHeader('Content-Type','application/json');res.end(value);return;
        }
        if(!req.url?.startsWith('/__analysis'))return next();
        res.setHeader('Content-Type','text/html; charset=utf-8');
        void server.transformIndexHtml('/__analysis','<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL Phase 2 Historical Replay</title></head><body><div id="root"></div><script type="module" src="/tests/browser/analysisIntelligenceHarness.tsx"></script></body></html>').then(s=>res.end(s)).catch(next);
      });
    },
  }], resolve:{alias:[{find:'@/lib/supabase',replacement:resolve(__dirname,'analysisIntelligenceSupabaseMock.ts')},{find:'@',replacement:resolve(__dirname,'../../src')}]},
  server:{host:'127.0.0.1',port:3198,strictPort:true}};
});
