import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// No production config, env files, private directory, endpoints or credentials.
export default defineConfig(({ command, mode }) => {
  if (process.env.MA_ACADEMY_PREVIEW !== 'SYNTHETIC_ONLY' || (command !== 'serve' && mode !== 'academy-build-check')) throw Error('ACADEMY_LOCAL_ONLY');
  const root = resolve(import.meta.dirname, '../..');
  return {
    root, envDir: false, envPrefix: 'ACADEMY_UNUSED_PUBLIC_', publicDir: false,
    define: { __ACADEMY_LOCAL_ISOLATED__: JSON.stringify(command === 'serve') },
    cacheDir: '/private/tmp/ma-academy-vite-cache',
    plugins: [react(), {
      name: 'academy-synthetic-preview', configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.headers.host !== '127.0.0.1:3217') { res.statusCode = 403; res.end(); return; }
          if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:3217') { res.statusCode = 403; res.end(); return; }
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Referrer-Policy', 'no-referrer');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:3217; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
          if (req.url?.startsWith('/__academy_private')) { res.statusCode = 404; res.end(); return; }
          if (req.url?.split('?')[0] !== '/academy') return next();
          const html = readFileSync(resolve(root, 'tests/browser/academy.html'), 'utf8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          void server.transformIndexHtml('/academy', html).then(value => res.end(value)).catch(next);
        });
      },
    }],
    resolve: { alias: [
      { find: '@/lib/supabase', replacement: resolve(root, 'tests/browser/academySupabaseMock.ts') },
      { find: '@', replacement: resolve(root, 'src') },
    ] },
    server: { host: '127.0.0.1', port: 3217, strictPort: true, cors: false,
      fs: { strict: true, allow: [root], deny: ['**/.env*', '**/*.pem', '**/*.key', '**/.git/**', '**/private/**'] } },
    build: { outDir: '/private/tmp/ma-academy-ui-build', emptyOutDir: false, sourcemap: false,
      rollupOptions: { input: resolve(root, 'tests/browser/academy.html') } },
  };
});
