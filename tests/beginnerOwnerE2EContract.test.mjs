import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { canShowBeginnerRecommendations, parseReportDisplayMode } from '../src/features/learning/beginnerReportContract.ts';
import { canUseProductFeature } from '../src/config/productFeatures.ts';
import { BEGINNER_FIXTURE } from './browser/beginnerFixture.ts';
// Keep test-only instrumentation regression checks in the existing CI suite.
import './browser/networkObserver.test.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('Dialog restores only connected visible focus targets without scrolling, including backdrop close', () => {
  const source = read('src/features/learning/GlossarySheet.tsx');
  assert.match(source, /event\.target === event\.currentTarget\)\s*\{[\s\S]*?event\.preventDefault\(\);\s*onClose\(\);/);
  assert.match(source, /element\?\.isConnected && element !== document\.body/);
  assert.match(source, /\[hidden\], \[inert\], \[aria-hidden="true"\]/);
  assert.match(source, /getClientRects\(\)\.length/);
  assert.match(source, /\[previousFocusRef\.current, fallbackRegion, document\.querySelector/);
  assert.match(source, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /target\.removeAttribute\('tabindex'\)/);
});
test('actual Dialog cleanup falls back for removed, hidden or disabled triggers, never body', () => {
  const source = ts.createSourceFile('GlossarySheet.tsx', read('src/features/learning/GlossarySheet.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let cleanup;
  const visit = node => {
    if (ts.isReturnStatement(node) && node.expression && ts.isArrowFunction(node.expression)
      && node.expression.getText(source).includes('previousFocusRef.current = null')) cleanup = node.expression.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(cleanup, 'execute the real effect cleanup, not a duplicate implementation');
  const script = ts.transpileModule(`(${cleanup})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const condition of ['visible', 'removed', 'hidden', 'disabled', 'no_rect', 'invisible']) {
    const calls = [];
    const element = (name, state) => ({
      isConnected: state !== 'removed', tabIndex: name === 'trigger' ? 0 : -1,
      getClientRects: () => state === 'no_rect' ? [] : [{}],
      closest: () => state === 'hidden' ? {} : null,
      hasAttribute: key => key === 'disabled' && state === 'disabled',
      getAttribute: () => null,
      setAttribute: () => {}, removeAttribute: () => {},
      focus: options => calls.push({ name, preventScroll: options.preventScroll }),
      visibility: state === 'invisible' ? 'hidden' : 'visible',
    });
    const trigger = element('trigger', condition);
    const main = element('main', 'visible');
    const previousFocusRef = { current: trigger };
    const body = { style: { overflow: 'hidden' } };
    runInNewContext(script, { previousFocusRef, fallbackRegion: main, previousOverflow: 'auto', handleDialogKeys: () => {},
      document: { body, removeEventListener: () => {}, querySelector: () => main },
      getComputedStyle: el => ({ visibility: el.visibility }),
    });
    assert.deepEqual(calls, [{ name: condition === 'visible' ? 'trigger' : 'main', preventScroll: true }], condition);
    assert.equal(body.style.overflow, 'auto');
    assert.equal(previousFocusRef.current, null);
  }
});
test('harness unmounts the fixture before reloading the normal destination entry', () => {
  const source = read('tests/browser/beginnerHarness.tsx');
  assert.match(source, /const location = useLocation\(\)/);
  assert.match(source, /location\.pathname === '\/__e2e\/beginner' && !location\.search && !location\.hash/);
  assert.match(source, /window\.location\.replace\(location\.pathname \+ location\.search \+ location\.hash\)/);
  assert.match(source, /return isFixture \? <OwnerBeginnerHarness \/> : null/);
});
test('ACT + Premium + recommendations + matching Taipei report date permits stocks', () => {
  assert.equal(canShowBeginnerRecommendations(BEGINNER_FIXTURE), true);
});
for (const [name, patch] of [
  ['WAIT', { action: 'WAIT' }], ['STOP', { action: 'STOP' }],
  ['no_trade', { decisionMode: 'no_trade' }], ['blocked', { decisionMode: 'blocked' }],
  ['Premium not eligible', { premiumEligible: false }],
  ['historical fallback', { isHistoricalFallback: true }],
  ['wrong Taipei date', { reportDate: '2026-09-03' }], ['missing date', { reportDate: null }],
]) test(`${name}: recommendations remain hidden`, () => {
  assert.equal(canShowBeginnerRecommendations({ ...BEGINNER_FIXTURE, ...patch }), false);
});
test('stored display mode cannot forge admin/Owner or bypass disabled Alpha Coach', () => {
  for (const forged of ['admin', 'vip', '{"role":"admin"}', null, undefined]) assert.equal(parseReportDisplayMode(forged), 'professional');
  assert.equal(parseReportDisplayMode('beginner'), 'beginner');
  for (const identity of [null, { tier: 'free', isLoggedIn: false, isAdmin: false },
    { tier: 'member', isLoggedIn: true, isAdmin: false },
    { tier: 'free', isLoggedIn: true, isAdmin: false, user_metadata: { role: 'admin' } }]) {
    assert.equal(canUseProductFeature('beginner_report_mode', identity), false);
  }
  assert.equal(canUseProductFeature('alpha_coach', { tier: 'admin', isLoggedIn: true, isAdmin: true }), false);
});
test('production and fixture reuse the actual recommendation gate and preference, not duplicate policy', () => {
  for (const path of ['src/pages/report/TodayReport.tsx', 'tests/browser/beginnerHarness.tsx']) {
    const text = read(path);
    assert.match(text, /canShowBeginnerRecommendations/);
    assert.match(text, /useReportDisplayMode/);
    assert.match(text, /getCurrentEntitlement\(\)/);
    assert.match(text, /canUseProductFeature\('beginner_report_mode',/);
    assert.doesNotMatch(text, /localStorage|setSession|user_metadata|access_token\s*:/);
  }
  assert.match(read('src/pages/report/TodayReport.tsx'), /if \(marketClosed\.closed\)/);
});
test('fixture is opt-in loopback serve-only with real server entitlement, no production route', () => {
  const config = read('tests/browser/vite.config.ts');
  const harness = read('tests/browser/beginnerHarness.tsx');
  assert.match(config, /command !== 'serve'/);
  assert.match(config, /process\.env\.MA_BEGINNER_E2E !== '1'/);
  assert.match(config, /host: '127\.0\.0\.1'/);
  assert.match(config, /req\.headers\.host/);
  assert.match(harness, /!import\.meta\.env\.DEV/);
  assert.match(harness, /window\.location\.search/);
  assert.match(harness, /getCurrentEntitlement\(\)/);
  assert.doesNotMatch(harness, /\.insert\(|\.update\(|\.upsert\(|setSession|localStorage|Date\.now\s*=/);
  assert.doesNotMatch(read('src/router/config.tsx') + read('src/main.tsx') + read('vite.config.ts'), /__e2e|beginnerHarness|BEGINNER_FIXTURE/);
});
test('no fixture HTML, data or test endpoint is emitted in the production build (when present)', () => {
  const output = new URL('../out/', import.meta.url);
  if (!existsSync(output)) return;
  for (const path of readdirSync(output, { recursive: true }).filter(p => /\.(js|html)$/.test(p))) {
    const built = readFileSync(new URL(path, output), 'utf8');
    assert.doesNotMatch(built, /LOCAL TEST FIXTURE|__e2e\/beginner|MA_BEGINNER_E2E|模擬台北交易日/);
  }
});
