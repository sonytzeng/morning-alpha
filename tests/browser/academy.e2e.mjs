import assert from 'node:assert/strict';
import { course } from './academyFixture.mjs';
const { chromium } = await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
assert.equal(process.env.MA_ACADEMY_PREVIEW, 'SYNTHETIC_ONLY');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const origin = 'http://127.0.0.1:3217';
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
const errors = [], external = [], checks = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || url.protocol === 'blob:') return route.continue();
  external.push(url.origin); return route.abort();
});
await context.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  window.academyBlobAudit = { created: [], revoked: [] };
  URL.createObjectURL = value => { const url = create(value); window.academyBlobAudit.created.push(url); return url; };
  URL.revokeObjectURL = url => { window.academyBlobAudit.revoked.push(url); revoke(url); };
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const upload = async (value = course) => {
  await page.getByLabel('選擇課程 JSON', { exact: true }).setInputFiles({ name: 'synthetic-course.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.getByRole('heading', { name: value.title, exact: true }).waitFor();
};
const owner = async () => { await page.goto(origin + '/academy?role=owner'); await page.getByLabel('選擇課程 JSON', { exact: true }).waitFor(); };
const pdf = async () => {
  await page.getByLabel('選擇 PDF（選用）', { exact: true }).setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%synthetic-test-only\n%%EOF') });
  await page.getByRole('link', { name: '下載已選取的私人 PDF' }).waitFor();
};
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');
try {
  for (const role of ['anonymous', 'member', 'paid', 'admin', 'logout-race']) {
    await page.goto(origin + '/academy?role=' + role);
    await page.getByRole('heading', { name: '這是一個私人學習空間' }).waitFor();
    assert.equal(await page.locator('input[type=file]').count(), 0);
  }
  await page.goto(origin + '/academy?role=unavailable');
  await page.getByRole('heading', { name: '私人課程目前不可用' }).waitFor(); checks.push('denied roles, RPC error, late auth reply');
  await owner(); assert.equal(await page.getByRole('heading', { name: course.title }).count(), 0);
  assert.equal(await page.locator('.academy-candle-legend').innerText(), '深色圖例：暖色＝紅 K（收高於開），青色＝黑 K（收低於開）；開收相同＝十字。');
  assert(await page.locator('.academy-candle-legend').isVisible());
  await page.getByRole('button', { name: 'K 線 2', exact: true }).focus(); await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('button', { name: 'K 線 2', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('.academy-ohlc').innerText(), /104/); assert.match(await page.locator('.academy-candle-classification').innerText(), /黑 K/); checks.push('empty shell + keyboard OHLC');
  if (process.env.MA_ACADEMY_SCREENSHOTS === 'YES') await page.screenshot({ path: '/private/tmp/ma-academy-empty.png', fullPage: true });
  await upload();
  const quizzes = page.locator('.academy-quiz');
  for (const i of [0, 2, 3]) { await quizzes.nth(i).getByRole('radio').first().check(); await quizzes.nth(i).getByRole('button', { name: '確認答案' }).click(); }
  await quizzes.nth(1).getByRole('button', { name: '第 2 位：步驟 A，使用上下方向鍵移動' }).focus(); await page.keyboard.press('ArrowUp');
  await quizzes.nth(1).getByRole('button', { name: '確認答案' }).click();
  await page.getByRole('button', { name: '標記本章完成' }).click();
  assert.match(await page.locator('.academy-progress-label').innerText(), /1／7/); checks.push('four question kinds + keyboard ordering + completion');
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('morning-alpha:academy:progress:')));
  assert.equal(stored.length, 1); assert(!JSON.stringify(stored).includes(course.title)); assert(!JSON.stringify(stored).includes('synthetic-owner-1'));
  await page.reload(); await page.getByLabel('選擇課程 JSON', { exact: true }).waitFor(); assert.equal(await page.getByRole('heading', { name: course.title }).count(), 0);
  await upload(); assert.match(await page.locator('.academy-progress-label').innerText(), /1／7/);
  await pdf();
  await page.getByRole('button', { name: '切換合成身份' }).click(); await page.getByLabel('選擇課程 JSON', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: course.title }).count(), 0);
  assert(await page.evaluate(() => window.academyBlobAudit.created.every(url => window.academyBlobAudit.revoked.includes(url))));
  await upload(); assert.match(await page.locator('.academy-progress-label').innerText(), /0／7/); checks.push('identity-scoped persistence + no content persistence + Blob revoked on identity switch');
  for (const width of [375, 390, 430, 480, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 }); await noOverflow();
    if (width <= 640) await page.getByLabel('選擇章節', { exact: true }).selectOption('2');
    else await page.locator('.academy-chapter-nav').getByRole('button', { name: /示範章節 3/ }).click();
    await page.getByRole('button', { name: '觀察壓力區' }).click(); await noOverflow();
    if (width <= 640) await page.getByLabel('選擇章節', { exact: true }).selectOption('3');
    else await page.locator('.academy-chapter-nav').getByRole('button', { name: /示範章節 4/ }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '2. 步驟 2' }).getAttribute('aria-pressed'), 'true'); await noOverflow();
    if ([375, 1440].includes(width) && process.env.MA_ACADEMY_SCREENSHOTS === 'YES') await page.screenshot({ path: `/private/tmp/ma-academy-${width}.png`, fullPage: true });
  }
  checks.push('zones + four-step controls + responsive 375/390/430/480/768/1024/1440');
  const charts = structuredClone(course);
  charts.version = 'synthetic-charts';
  charts.chapters[0].questions = [];
  charts.chapters[0].diagram = { kind: 'bullSteps', caption: 'data-driven synthetic stages', labels: ['A', 'B', 'C', 'D'], values: [110, 103, 98, 108, 104, 115], visibleCounts: [3, 4, 5, 6] };
  charts.chapters[0].examples = [
    ...Array.from({ length: 12 }, (_, i) => ({ title: `合成外部案例 ${i + 1}`, explanation: '只驗證外部資料圖解，不含講師內容。', diagram: { kind: 'trend', caption: 'synthetic chart', values: [3, 1 + i, 4, 2, 5] } })),
    { title: '合成量價', explanation: 'synthetic', diagram: { kind: 'volume', caption: 'synthetic', values: [100, 104, 102], volumes: [1000, 2000, 1200] } },
    { title: '合成風險', explanation: 'synthetic', diagram: { kind: 'risk', caption: 'synthetic', risk: { entry: 102, stop: 98, target: 110 } } },
    { title: '合成六階段', explanation: 'synthetic', diagram: { kind: 'cycle', caption: 'synthetic', labels: ['A', 'B', 'C', 'D', 'E', 'F'] } },
    { title: '合成 SOP', explanation: 'synthetic', diagram: { kind: 'steps', caption: 'synthetic', labels: ['S1', 'S2', 'S3', 'S4', 'S5'] } },
  ];
  await upload(charts);
  const primary = page.locator('.academy-lesson > .academy-diagram');
  assert.equal(await primary.getByTestId('academy-visible-line').getAttribute('data-visible-points'), '3');
  assert.equal((await primary.getByTestId('academy-visible-line').getAttribute('d')).split('L').length, 3);
  await primary.getByRole('button', { name: '下一步', exact: true }).click();
  assert.equal(await primary.getByTestId('academy-visible-line').getAttribute('data-visible-points'), '4');
  assert.equal(await page.locator('.academy-examples article').count(), 16);
  assert.equal(await page.getByTestId('academy-volume-bar').count(), 3);
  assert.match(await page.locator('.academy-risk-math').innerText(), /4[\s\S]*8[\s\S]*2 : 1/);
  const cycle = page.locator('.academy-examples article').filter({ has: page.getByRole('heading', { name: '合成六階段' }) });
  assert.equal(await cycle.locator('.academy-stage-flow > div').count(), 1);
  await cycle.getByRole('button', { name: '6. F', exact: true }).click(); assert.equal(await cycle.locator('.academy-stage-flow > div').count(), 6);
  const sop = page.locator('.academy-examples article').filter({ has: page.getByRole('heading', { name: '合成 SOP' }) });
  await sop.getByRole('button', { name: '5. S5' }).click(); assert.equal(await sop.locator('.academy-stage-flow > div').count(), 5);
  await page.setViewportSize({ width: 430, height: 950 }); await noOverflow();
  checks.push('external 12 case charts, exact staged reveal, volume bars, risk 102/98/110, six-stage cycle, data-driven SOP');
  const big = structuredClone(course); big.version = 'synthetic-big'; big.chapters = Array.from({ length: 15 }, (_, i) => ({ ...structuredClone(course.chapters[i % 7]), id: 'big-' + i, title: `合成規模章節 ${i + 1}`, questions: Array.from({ length: i < 2 ? 4 : 3 }, (_, n) => ({ ...course.chapters[0].questions[0], id: 'q-' + n })) }));
  assert.equal(big.chapters.flatMap(c => c.questions).length, 47); await upload(big); assert.match(await page.locator('.academy-progress-label').innerText(), /0／15/); checks.push('15 chapters / 47 questions synthetic import');
  await pdf(); await page.getByRole('button', { name: '卸載教材' }).click();
  assert(await page.evaluate(() => window.academyBlobAudit.created.every(url => window.academyBlobAudit.revoked.includes(url))));
  await upload(); await pdf(); await page.getByRole('button', { name: '模擬登出' }).click();
  await page.getByRole('heading', { name: '這是一個私人學習空間' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '下載已選取的私人 PDF' }).count(), 0);
  assert(await page.evaluate(() => window.academyBlobAudit.created.every(url => window.academyBlobAudit.revoked.includes(url)))); checks.push('reset/logout revokes every PDF Blob URL');
  await owner(); await page.evaluate(() => { const original = File.prototype.text; File.prototype.text = async function() { await new Promise(r => setTimeout(r, 350)); return original.call(this); }; });
  await page.getByLabel('選擇課程 JSON', { exact: true }).setInputFiles({ name: 'race.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(course)) });
  await page.getByRole('button', { name: '模擬登出' }).click();
  await page.waitForTimeout(500); assert.equal(await page.getByRole('heading', { name: course.title }).count(), 0); checks.push('file-read logout race');
  await owner(); await upload(); await page.getByRole('button', { name: '模擬權限撤銷' }).click();
  await page.getByRole('heading', { name: '這是一個私人學習空間' }).waitFor(); checks.push('token refresh revocation');
  await owner(); await page.evaluate(() => { Storage.prototype.getItem = () => { throw Error('DISABLED'); }; Storage.prototype.setItem = () => { throw Error('DISABLED'); }; });
  await upload(); assert.match(await page.locator('.academy-storage').innerText(), /儲存不可用/); checks.push('storage failure leaves UI usable');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(JSON.stringify({ checks, externalRequests: 0, pageErrors: 0, privateFilesRead: false, productionUsed: false }, null, 2));
} finally { await browser.close(); }
