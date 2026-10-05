import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/components/membership/MembershipStatusCard.tsx');
const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const jsx = (type, props) => ({ type, props });
function elements(tree, predicate) {
  const found = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (predicate(node)) found.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  return found;
}
function card(state, loading = false) {
  const status = state === null ? null : {
    membership: { state, active: true, trialEndsAt: null, accessEndsAt: null },
    offer: { billing_mode: 'disabled' }, user: { email: 'synthetic@example.invalid' },
  };
  const states = [loading, status];
  let cursor = 0, signouts = 0;
  const exports = {};
  vm.runInNewContext(compile(source), { exports, require(name) {
    if (name === 'react') return { useEffect() {}, useState() {
      const i = cursor++; return [states[i], value => { states[i] = value; }];
    } };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-router-dom') return { Link: 'Link' };
    if (name === '@/lib/supabase') return { supabase: {} };
    if (name === '@/services/membershipService') return {
      fetchMemberAccess() { throw new Error('NETWORK_FORBIDDEN'); },
      async signOutMembership() { signouts++; },
    };
    throw new Error(name);
  } });
  const render = () => { cursor = 0; return exports.default(); };
  return { render, signouts: () => signouts,
    links: () => elements(render(), n => n.type === 'Link' && n.props.to === '/admin/analysis') };
}

test('/account uses MembershipStatusCard, not the separate Admin layout', () => {
  assert.match(read('src/router/config.tsx'), /path: "\/account",\s*element: <DeferredRoute><Account/);
  assert.match(read('src/pages/account/Account.tsx'), /<MembershipStatusCard\s*\/>/);
  assert.match(source, /status\.membership\.state === 'owner'/);
  assert.doesNotMatch(source, /is_research_owner|localStorage|user_metadata|\.rpc\(/);
});
for (const state of [null, 'free', 'paid_active', 'trialing', 'beta_full', 'past_due', 'canceled', 'expired']) {
  test(`account analysis entry hidden for ${state ?? 'anonymous'}`, () => {
    assert.equal(card(state).links().length, 0);
  });
}
test('Owner entry is rendered once using the existing permanent Owner truth', () => {
  const h = card('owner');
  assert.equal(h.links().length, 1);
  assert.match(JSON.stringify(h.links()[0]), /分析中心/);
  assert.match(JSON.stringify(h.render()), /永久 Owner/);
  assert.match(h.links()[0].props.className, /min-h-14/);
});
test('loading cannot expose an Owner link', () => assert.equal(card('owner', true).links().length, 0));
test('existing sign-out action removes the account analysis entry', async () => {
  const h = card('owner');
  const logout = elements(h.render(), n => n.type === 'button' && n.props.children === '登出')[0];
  await logout.props.onClick();
  assert.equal(h.signouts(), 1);
  assert.equal(h.links().length, 0);
});
test('foundation graph count never substitutes for the mode-separated Forward sample count', () => {
  const exports = {};
  vm.runInNewContext(compile(read('src/pages/admin/analysis/page.tsx')), { exports, require(name) {
    if (name === 'react') return {};
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@/lib/supabase') return { supabase: {} };
    if (name === '@/features/research/foundation') return { QUALITY_WINDOWS: [5, 20, 60, 90] };
    if (name === '@/features/research/intelligence') return {};
    if (name === './IntelligenceView') return { default: () => null };
    throw new Error(name);
  } });
  for (const graphs of [0, 1, 100]) {
    const tree = exports.ResearchFoundationView({ data: { features: [], method_versions: 0, observations: 0, graphs } });
    const line = elements(tree, n => n.type === 'p' && JSON.stringify(n.props.children).includes('Forward Sample'))[0];
    assert.match(JSON.stringify(line), /Analysis Graph 包含歷史研究，不等於 Forward Sample/);
    assert.doesNotMatch(JSON.stringify(line), /Forward Sample[：:]\s*[0-9]/);
    assert.match(JSON.stringify(tree), /INSUFFICIENT_SAMPLE/);
  }
});
