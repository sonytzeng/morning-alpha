// Explicit local acceptance only. No private fixture, title, answer or PDF is stored in this file.
import assert from 'node:assert/strict';
import { mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
assert.equal(process.env.MA_ACADEMY_PREVIEW, 'SYNTHETIC_ONLY');
assert.equal(process.env.MA_ACADEMY_PRIVATE_QA, 'FILE_PICKER_AUTHORIZED');
const privateRoot = '/private/tmp/morning-alpha-academy-private';
const input = resolve(process.argv[2] || privateRoot + '/course.json');
assert(input.startsWith(privateRoot + '/'), 'Only the authorized private local directory is allowed');
const output = privateRoot + '/ui-qa-' + new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(output, { recursive: true, mode: 0o700 }); chmodSync(output, 0o700);
const { chromium } = await import(process.env.MA_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const origin = 'http://127.0.0.1:3217';
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
const external = [], pageErrors = [], results = [], issues = [];
let screenshots = 0, questionsChecked = 0;
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || url.protocol === 'blob:') return route.continue();
  external.push('blocked-external-request'); return route.abort();
});
await context.addInitScript(() => {
  // Capture the user's selected File in browser memory, before React resets the input.
  // It is never fetched from Vite, copied to a fixture, logged or persisted.
  document.addEventListener('change', event => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.getAttribute('aria-label') === '選擇課程 JSON' && input.files?.[0]) {
      window.__academyPrivateExpected = input.files[0].text().then(JSON.parse);
    }
  }, true);
});
const page = await context.newPage();
page.on('pageerror', () => pageErrors.push('browser-page-error')); // never emit private error bodies
const shot = async (locator, name) => {
  const path = output + '/' + name + '.png';
  if (locator) await locator.screenshot({ path }); else await page.screenshot({ path, fullPage: true });
  chmodSync(path, 0o600); screenshots++;
};
try {
  await page.goto(origin + '/academy?role=owner');
  await page.getByText('LOCAL SYNTHETIC IDENTITY · 非正式 Owner 授權', { exact: true }).waitFor();
  const pickerPromise = page.waitForEvent('filechooser');
  await page.getByLabel('選擇課程 JSON', { exact: true }).click();
  const picker = await pickerPromise;
  await picker.setFiles(input);
  await page.locator('.academy-lesson').waitFor();
  const meta = await page.evaluate(async () => {
    const c = await window.__academyPrivateExpected;
    return c.chapters.map(ch => ({ questions: ch.questions.length, examples: ch.examples?.length || 0, kind: ch.diagram.kind }));
  });
  assert.equal(meta.length, 15, 'expected 15 private chapters');
  assert.equal(meta.reduce((n, c) => n + c.examples, 0), 14, 'expected 14 private examples');
  for (const width of [1440, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let chapter = 0; chapter < meta.length; chapter++) {
      if (width > 640) await page.locator('.academy-chapter-nav > button').nth(chapter).click();
      else await page.getByLabel('選擇章節', { exact: true }).selectOption(String(chapter));
      const matched = await page.evaluate(async index => {
        const c = await window.__academyPrivateExpected, ch = c.chapters[index];
        const same = (selector, value) => document.querySelector(selector)?.textContent === value;
        const examples = Array.from(document.querySelectorAll('.academy-examples > article'));
        const questions = Array.from(document.querySelectorAll('.academy-questions > section'));
        const paragraphs = Array.from(document.querySelectorAll('.academy-reading > p'));
        return {
          title: same('#academy-chapter-title', ch.title),
          courseTitle: same('.academy-hero h1', c.title),
          paragraphs: paragraphs.length === ch.paragraphs.length && paragraphs.every((el, i) => el.textContent === ch.paragraphs[i]),
          example: document.querySelector('.academy-notes section')?.textContent.includes(ch.example),
          mistakes: ch.mistakes.every(x => document.querySelector('.academy-notes section:nth-child(2)')?.textContent.includes(x)),
          source: document.querySelector('.academy-source')?.textContent.includes(ch.sourceNote),
          examples: examples.length === (ch.examples?.length || 0) && examples.every((el, i) => el.querySelector('h3')?.textContent === ch.examples[i].title && el.lastElementChild?.textContent === ch.examples[i].explanation),
          questions: questions.length === ch.questions.length && questions.every((el, i) => el.querySelector('h3')?.textContent === ch.questions[i].prompt),
          missingDiagrams: document.querySelectorAll('.academy-diagram-missing').length === 0,
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
        };
      }, chapter);
      for (const [check, passed] of Object.entries(matched)) if (!passed && check !== 'missingDiagrams') issues.push({ width, chapter: chapter + 1, check });
      const figures = page.locator('.academy-lesson > figure, .academy-examples > article > figure');
      assert.equal(await figures.count(), 1 + meta[chapter].examples);
      for (let figure = 0; figure < await figures.count(); figure++) {
        const chart = figures.nth(figure);
        const d = await page.evaluate(async ({ chapter, figure }) => {
          const c = await window.__academyPrivateExpected;
          const d = figure ? c.chapters[chapter].examples[figure - 1].diagram : c.chapters[chapter].diagram;
          return { kind: d.kind, labels: d.labels?.length, candles: d.candles?.length, values: d.values?.length, volumes: d.volumes?.length, visibleCounts: d.visibleCounts, levels: d.levels?.length };
        }, { chapter, figure });
        const controls = chart.locator('.academy-segments > button');
        if (await chart.locator('.academy-diagram-missing').count()) {
          issues.push({ width, chapter: chapter + 1, figure, check: 'missing-diagram-data', kind: d.kind });
          if (figure) await shot(chart, `chapter-${String(chapter + 1).padStart(2, '0')}-example-${String(figure).padStart(2, '0')}-${width}`);
          continue;
        }
        if (['bullSteps', 'bearSteps', 'cycle', 'steps'].includes(d.kind)) {
          const stages = d.labels || (d.kind === 'cycle' ? 6 : 4);
          assert.equal(await controls.count(), stages);
          for (let stage = 0; stage < stages; stage++) {
            await controls.nth(stage).click();
            if (['cycle', 'steps'].includes(d.kind)) assert.equal(await chart.locator('.academy-stage-flow > div').count(), stage + 1);
            else {
              const count = Number(await chart.getByTestId('academy-visible-line').getAttribute('data-visible-points'));
              if (d.visibleCounts) assert.equal(count, d.visibleCounts[stage]);
              assert.equal((await chart.getByTestId('academy-visible-line').getAttribute('d')).split('L').length, count);
            }
          }
        }
        if (d.kind === 'candle' || d.kind === 'volume' && d.candles) {
          for (let candle = 0; candle < (d.candles || 2); candle++) {
            await controls.nth(candle).click();
            const ohlcMatches = await chart.evaluate(async (el, { chapter, figure, candle }) => {
              const c = await window.__academyPrivateExpected;
              const d = figure ? c.chapters[chapter].examples[figure - 1].diagram : c.chapters[chapter].diagram;
              const value = (d.candles || [{ open: 100, high: 106, low: 98, close: 104 }, { open: 104, high: 106, low: 99, close: 100 }])[candle];
              const actual = Array.from(el.querySelectorAll('.academy-ohlc dd')).map(x => Number(x.textContent));
              const expected = [value.open, value.high, value.low, value.close].map(x => Number(x.toFixed(2)));
              return actual.every((x, i) => x === expected[i]);
            }, { chapter, figure, candle });
            assert(ohlcMatches, `OHLC width=${width} chapter=${chapter + 1} figure=${figure}`);
          }
        }
        if (d.volumes || d.candles) assert.equal(await chart.getByTestId('academy-volume-bar').count(), d.volumes || d.candles);
        if (d.kind === 'zones') { assert.equal(await controls.count(), d.levels || 2); for (let z = 0; z < await controls.count(); z++) await controls.nth(z).click(); }
        const numerical = await chart.evaluate(async (el, { chapter, figure }) => {
          const c = await window.__academyPrivateExpected;
          const d = figure ? c.chapters[chapter].examples[figure - 1].diagram : c.chapters[chapter].diagram;
          const line = el.querySelector('[data-testid="academy-visible-line"]');
          const values = d.values || d.candles?.map(x => x.close);
          if (line && values) {
            const points = line.getAttribute('d').split(/[ML]/).filter(Boolean).map(x => x.split(',').map(Number));
            if (points.some(p => p.some(n => !Number.isFinite(n)))) return false;
            for (let i = 1; i < points.length; i++) if (Math.sign(points[i][1] - points[i - 1][1]) !== -Math.sign(values[i] - values[i - 1])) return false;
          }
          if (d.kind === 'risk') {
            const r = d.risk || { entry: 102, stop: 98, target: 110 };
            const actual = Array.from(el.querySelectorAll('.academy-risk-math dd')).map(x => parseFloat(x.textContent));
            const expected = [Math.abs(r.entry - r.stop), Math.abs(r.target - r.entry), Math.abs((r.target - r.entry) / (r.entry - r.stop))].map(x => Number(x.toFixed(2)));
            if (actual.some((x, i) => x !== expected[i])) return false;
          }
          return true;
        }, { chapter, figure });
        assert(numerical, `numeric diagram width=${width} chapter=${chapter + 1} figure=${figure}`);
        if (figure) await shot(chart, `chapter-${String(chapter + 1).padStart(2, '0')}-example-${String(figure).padStart(2, '0')}-${width}`);
      }
      if (width === 1440) {
        const quizzes = page.locator('.academy-questions > section');
        for (let q = 0; q < meta[chapter].questions; q++) {
          const quiz = quizzes.nth(q);
          const answer = await page.evaluate(async ({ chapter, q }) => {
            const question = (await window.__academyPrivateExpected).chapters[chapter].questions[q];
            return { kind: question.kind || 'choice', correctIndex: question.correctIndex, order: question.order?.map(x => question.choices.indexOf(x)) };
          }, { chapter, q });
          if (answer.kind === 'order') {
            const current = Array.from({ length: answer.order.length }, (_, i) => i);
            for (let target = 0; target < answer.order.length; target++) {
              let at = current.indexOf(answer.order[target]);
              while (at > target) {
                await quiz.locator('.academy-order li').nth(at).getByRole('button', { name: `上移第 ${at + 1} 項`, exact: true }).click();
                [current[at - 1], current[at]] = [current[at], current[at - 1]]; at--;
              }
            }
          } else await quiz.getByRole('radio').nth(answer.correctIndex).check();
          await quiz.getByRole('button', { name: '確認答案', exact: true }).click();
          assert.equal(await quiz.locator('.academy-answer.is-correct').count(), 1);
          const explanation = await quiz.evaluate(async (el, { chapter, q }) => el.querySelector('.academy-answer p')?.textContent === (await window.__academyPrivateExpected).chapters[chapter].questions[q].explanation, { chapter, q });
          assert(explanation, `answer explanation chapter=${chapter + 1} question=${q + 1}`); questionsChecked++;
        }
      }
      if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) issues.push({ width, chapter: chapter + 1, check: 'final-overflow' });
      await shot(null, `chapter-${String(chapter + 1).padStart(2, '0')}-${width}`);
    }
    results.push({ width, chapters: 15, examples: 14, status: issues.some(x => x.width === width) ? 'NEEDS_REVIEW' : 'PASS' });
    console.log(JSON.stringify(results.at(-1)));
  }
  await page.getByRole('button', { name: '模擬登出' }).click();
  await page.getByRole('heading', { name: '這是一個私人學習空間' }).waitFor();
  assert.equal(await page.locator('.academy-lesson').count(), 0);
  await page.evaluate(() => { delete window.__academyPrivateExpected; });
  assert.deepEqual(external, []); assert.deepEqual(pageErrors, []);
  const report = { results, issues, screenshots, questionsChecked, externalRequests: 0, pageErrors: 0, identity: 'SYNTHETIC_NOT_PRODUCTION_OWNER', privateFileIngress: 'browser-filechooser', contentWrittenToRepo: false, productionUsed: false, output };
  writeFileSync(output + '/qa-summary.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exitCode = 1;
} catch (error) {
  await shot(null, 'failure').catch(() => {});
  // Report a sanitized assertion only; do not persist Playwright's DOM/source excerpts.
  const message = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Browser action failed; inspect private failure screenshot.';
  writeFileSync(output + '/qa-summary.json', JSON.stringify({ status: 'FAIL', message, results, screenshots, questionsChecked, output }), { mode: 0o600 });
  console.error(JSON.stringify({ status: 'FAIL', message, output })); process.exitCode = 1;
} finally { await context.close(); await browser.close(); }
