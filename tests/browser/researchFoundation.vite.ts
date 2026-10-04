import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Synthetic localhost only. Never merges the production Vite config or loads .env.
export default defineConfig(({ command }) => {
  if (command !== 'serve' || process.env.MA_RESEARCH_PREVIEW !== 'SYNTHETIC_ONLY') throw new Error('LOCAL_RESEARCH_PREVIEW_ONLY');
  return {
    envDir: false,
    plugins: [react(), {
      name: 'synthetic-research-preview',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!['127.0.0.1:3197','localhost:3197'].includes(req.headers.host || '')) { res.statusCode=403; res.end(); return; }
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3197; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'");
          res.setHeader('Cache-Control','no-store');
          if (!req.url?.startsWith('/__research')) return next();
          res.setHeader('Content-Type','text/html; charset=utf-8');
          const html='<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOCAL SYNTHETIC RESEARCH PREVIEW</title></head><body><div id="root"></div><script type="module" src="/tests/browser/researchFoundationHarness.tsx"></script></body></html>';
          void server.transformIndexHtml('/__research',html).then(result=>res.end(result)).catch(next);
        });
      },
    }],
    resolve: { alias: [
      { find: '@/lib/supabase', replacement: resolve(__dirname,'researchFoundationSupabaseMock.ts') },
      { find: '@', replacement: resolve(__dirname,'../../src') },
    ] },
    server: { host:'127.0.0.1',port:3197,strictPort:true },
  };
});
