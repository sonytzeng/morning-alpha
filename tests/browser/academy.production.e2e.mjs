import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
assert.equal(process.env.MA_ACADEMY_PREVIEW, 'SYNTHETIC_ONLY');
const { chromium } = await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
const root = '/private/tmp/ma-academy-ui-build', origin = 'http://127.0.0.1:3218';
const server = createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:3218') { res.writeHead(403).end(); return; }
  const url = new URL(req.url, origin);
  const path = resolve(root, '.' + (url.pathname === '/academy' ? '/tests/browser/academy.html' : url.pathname));
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream'); res.end(readFileSync(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(3218, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' }); let external = 0;
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external++; return route.abort(); });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/academy?role=owner&localPreview=true&__ACADEMY_LOCAL_ISOLATED__=true');
  await page.getByRole('heading', { name: '私人課程目前不可用' }).waitFor();
  assert.equal(await page.locator('input[type=file]').count(), 0); assert.equal(await page.locator('a[download]').count(), 0);
  assert.deepEqual(errors, []); assert.equal(external, 0);
  for (const file of readdirSync(root + '/assets').filter(x => x.endsWith('.js'))) {
    const built = readFileSync(root + '/assets/' + file, 'utf8');
    assert(!built.includes('介面驗收用課程')); assert(!built.includes('synthetic-v1')); assert(!built.includes('/__academy_private/'));
  }
  console.log(JSON.stringify({ productionModeImport: 'disabled', queryBypass: false, fixtureCourseInBuild: false, externalRequests: external, realProductionServicesUsed: false }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
