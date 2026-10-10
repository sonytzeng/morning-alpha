import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const jsx = (type, props) => ({ type, props });
function load(path, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-router-dom') return { Link: 'Link', useLocation: () => ({ pathname: '/account' }) };
    if (Object.hasOwn(deps, name)) return deps[name];
    throw Error('UNEXPECTED_DEPENDENCY:' + name);
  } });
  return exports;
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(row => nodes(row, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const navigation = load('src/features/academy/navigation.ts');
const catalog = (progress = [], allowed = true) => ({ chapters: [{ id: 'candles', allowed }], progress });

test('one canonical Academy destination; login returns there through existing sanitizer', () => {
  assert.equal(navigation.ACADEMY_NAVIGATION.to, '/academy');
  assert.equal(navigation.ACADEMY_NAVIGATION.label, '股票學院');
  const next = new URL(navigation.ACADEMY_LOGIN_PATH, 'https://example.test').searchParams.get('next');
  const auth = load('src/services/membershipService.ts', { '@/lib/supabase': { supabase: {} } });
  assert.equal(auth.sanitizeMembershipNextPath(next), '/academy');
  assert.match(read('src/router/config.tsx'), /path: "\/academy"/);
  assert.match(read('src/pages/academy/MemberAcademy.tsx'), /access.kind === 'denied' \? ACADEMY_LOGIN_PATH/);
});
test('continue label requires current authorized server progress, not a client tier', () => {
  assert.equal(navigation.academyEntryLabel(null), '開始學習');
  assert.equal(navigation.academyEntryLabel(catalog()), '開始學習');
  assert.equal(navigation.academyEntryLabel(catalog([{ chapter_id: 'candles' }])), '繼續學習');
  assert.equal(navigation.academyEntryLabel(catalog([{ chapter_id: 'other-user-chapter' }])), '開始學習');
  assert.equal(navigation.academyEntryLabel(catalog([{ chapter_id: 'candles' }], false)), '開始學習');
});
for (const loggedIn of [false, true]) test(`desktop/mobile share Academy entry, loggedIn=${loggedIn}`, () => {
  let cursor = 0, mobile = true;
  const nav = load('src/components/feature/Navbar.tsx', {
    react: { useEffect() {}, useState() { return cursor++ === 0 ? [mobile, value => { mobile = value; }] : [loggedIn, () => {}]; } },
    '@/components/base/MarketStatusLight': { default: 'StatusLight' },
    '@/config/brand': { BRAND_ICON_URL: '/logo', BRAND_NAME: 'Morning Alpha' },
    '@/lib/supabase': { supabase: {} },
    '@/config/productFeatures': { PRODUCT_FEATURE_FLAGS: { beginner_learning: { enabled: true } } },
    '@/utils/analytics': { trackEvent() {} },
    '@/features/academy/navigation': navigation,
    '@/features/decision-v1/subscriber.css': {},
  });
  const links = nodes(nav.default({}), row => row.type === 'Link' && row.props.to === '/academy');
  assert.equal(links.length, 2);
  assert.ok(links.every(row => row.props.children === '股票學院'));
  links.find(row => row.props.onClick).props.onClick();
  assert.equal(mobile, false, 'mobile navigation closes after choosing Academy');
});
for (const [kind, aborted, progress, expected] of [
  ['denied', false, [], '開始學習'], ['loading', false, [], '查看課程'],
  ['unavailable', false, [], '查看課程'], ['member', false, [], '開始學習'],
  ['member', false, [{ chapter_id: 'candles' }], '繼續學習'],
  ['member', true, [{ chapter_id: 'candles' }], '開始學習'],
]) test(`account link ${kind}, aborted=${aborted}, ${expected}`, () => {
  const card = load('src/pages/account/components/AcademyEntry.tsx', {
    '@/features/academy/navigation': navigation,
    '@/pages/academy/useAcademyAccess': { useAcademyAccess: () => ({ access: { kind, signal: { aborted }, catalog: catalog(progress) } }) },
  });
  const link = nodes(card.default(), row => row.type === 'Link')[0];
  assert.equal(link.props.to, '/academy'); assert.equal(link.props.children, expected);
  assert.match(link.props.className, /min-h-12/);
});
test('navigation does not add writes, tier selectors, auth rules or duplicate progress storage', () => {
  const entry = read('src/pages/account/components/AcademyEntry.tsx');
  assert.match(read('src/pages/account/Account.tsx'), /<AcademyEntry\s*\/>/);
  assert.match(entry, /useAcademyAccess/);
  assert.doesNotMatch(entry, /localStorage|sessionStorage|user_metadata|\.rpc\(|\.from\(|record_academy/);
  assert.match(read('src/pages/academy/useAcademyAccess.ts'), /supabase.auth.getUser/);
  assert.match(read('src/pages/academy/useAcademyAccess.ts'), /get_academy_catalog_v11/);
  assert.match(read('src/pages/academy/MemberAcademy.tsx'), /recent\?\.chapter_id/);
});
