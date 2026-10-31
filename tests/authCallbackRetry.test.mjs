// Actual component/effect with synthetic hooks; no real login link, Auth or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/pages/auth/AuthCallbackPage.tsx');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const jsx = (type, props) => ({ type, props });
function elements(tree, predicate) {
  const found = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (predicate(node)) found.push(node);
    visit(node.props?.children);
  }
  visit(tree); return found;
}

function harness() {
  const slots = [], callbacks = [], navigations = [], writes = [];
  let cursor = 0, effect;
  const exports = {};
  const navigate = (to, options) => navigations.push({ to, options });
  vm.runInNewContext(compiled, {
    exports, Promise, Error,
    window: { location: { href: 'https://synthetic.test/auth/callback?next=%2Fstocks&code=synthetic-only' } },
    require(name) {
      if (name === 'react') return {
        useRef(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = { current: initial };
          return slots[index];
        },
        useState(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], value => {
            slots[index] = typeof value === 'function' ? value(slots[index]) : value;
            writes.push(index);
          }];
        },
        useEffect(callback) { effect = callback; },
      };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-router-dom') return { Link: 'Link', useNavigate: () => navigate };
      if (name === '@/services/membershipService') return {
        completeMembershipCallback(url) {
          let resolve, reject;
          const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
          callbacks.push({ url, promise, resolve, reject });
          return promise;
        },
      };
      throw Error('UNAPPROVED_TEST_IMPORT: ' + name);
    },
  });
  const render = () => { cursor = 0; return exports.default(); };
  return { render, setup: () => effect(), callbacks, navigations, writes };
}

test('Auth callback lazy route has the same loading boundary as other member pages', () => {
  assert.match(read('src/router/config.tsx'), /path:\s*"\/auth\/callback",\s*element:\s*<DeferredRoute><AuthCallbackPage\s*\/><\/DeferredRoute>/);
});

test('StrictMode repeats one attempt without completing the same login code twice', async () => {
  const h = harness(); h.render();
  h.setup()();
  const dispose = h.setup();
  assert.equal(h.callbacks.length, 1);
  assert.equal(h.callbacks[0].url, 'https://synthetic.test/auth/callback?next=%2Fstocks&code=synthetic-only');
  h.callbacks[0].resolve('/stocks'); await flush();
  assert.equal(h.navigations.length, 1, 'only the live effect attachment may navigate');
  assert.equal(h.navigations[0].to, '/stocks');
  assert.equal(h.navigations[0].options.replace, true);
  dispose();
});

test('a successful callback arriving after cleanup cannot navigate', async () => {
  const h = harness(); h.render();
  const dispose = h.setup(); dispose();
  const writesBefore = h.writes.length;
  h.callbacks[0].resolve('/account'); await flush();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.writes.length, writesBefore);
});

test('a failure arriving after cleanup cannot restore an obsolete login error', async () => {
  const h = harness(); h.render();
  const dispose = h.setup(); dispose();
  const writesBefore = h.writes.length;
  h.callbacks[0].reject(Error('SYNTHETIC_LATE_LOGIN_ERROR')); await flush();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.writes.length, writesBefore);
  assert.equal(elements(h.render(), node => node.type === 'button').length, 0);
});

test('failure offers a real retry attempt and successful retry navigates to the requested page', async () => {
  const h = harness(); h.render();
  const disposeFirst = h.setup();
  h.callbacks[0].reject(Error('會員服務回應逾時，請稍後再試。')); await flush();
  const failed = h.render();
  assert.equal(elements(failed, node => node.type === 'h1' && node.props.children === '登入暫時無法完成').length, 1);
  const retry = elements(failed, node => node.type === 'button' && node.props.children === '重新確認登入');
  assert.equal(retry.length, 1);
  assert.equal(elements(failed, node => node.type === 'Link' && node.props.to === '/login').length, 1);
  assert.equal(h.navigations.length, 0);
  retry[0].props.onClick();
  disposeFirst(); h.render();
  const disposeRetry = h.setup();
  assert.equal(h.callbacks.length, 2, 'retry must call the real completion service again');
  assert.equal(elements(h.render(), node => node.type === 'h1' && node.props.children === '正在完成登入').length, 1);
  h.callbacks[1].resolve('/stocks'); await flush();
  assert.equal(h.navigations.length, 1);
  assert.equal(h.navigations[0].to, '/stocks');
  assert.equal(h.navigations[0].options.replace, true);
  disposeRetry();
});
