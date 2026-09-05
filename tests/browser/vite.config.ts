import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

// Separate, opt-in localhost server. This is NOT an application route or build entry.
export default defineConfig(({ command }) => {
  if (command !== 'serve' || process.env.MA_BEGINNER_E2E !== '1') {
    throw new Error('Beginner E2E is a local serve-only harness; builds are forbidden.');
  }
  return mergeConfig(base, {
    server: { host: '127.0.0.1', port: 3000, strictPort: true, allowedHosts: ['localhost'] },
    plugins: [{
      name: 'local-owner-beginner-e2e',
      apply: 'serve',
      transformIndexHtml: {
        order: 'pre',
        handler() {
          return [{ tag: 'script', attrs: { type: 'module', src: '/tests/browser/networkObserverBootstrap.ts' }, injectTo: 'head-prepend' }];
        },
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!['localhost:3000', '127.0.0.1:3000'].includes(req.headers.host || '')) {
            res.statusCode = 403;
            res.end('Local preview only');
            return;
          }
          if (req.url === '/__e2e/network') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Referrer-Policy', 'no-referrer');
            const html = '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PR 100 Local Network Metadata</title></head><body><h1>PR #100 Local Metadata-only Network Trace</h1><p>Only method, sanitized path, status, duration and timestamp. Status 0 means unavailable, not success.</p><button id="reset-network-metadata" type="button">Start a fresh local acceptance trace</button><pre id="network-metadata-report"></pre></body></html>';
            void server.transformIndexHtml('/__e2e/network', html).then(result => res.end(result)).catch(next);
            return;
          }
          if (req.url !== '/__e2e/beginner') return next();
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Referrer-Policy', 'no-referrer');
          // Match the real application's icon assets, without its analytics scripts.
          const html = '<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>PR 100 — LOCAL TEST FIXTURE</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/remixicon/4.5.0/remixicon.min.css"></head><body><div id="root"></div><script type="module" src="/tests/browser/beginnerHarness.tsx"></script></body></html>';
          void server.transformIndexHtml('/__e2e/beginner', html).then(result => res.end(result)).catch(next);
        });
      },
    }],
  });
});
