// Synthetic local SSR/loader controls; no provider requests or source admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composeDecisionCard, decisionCardFlex, ownerV2Copy } from '../src/features/line/decisionCard.ts';
import { lineDecisionFixture } from './helpers/lineDecisionFixture.mjs';
import { createRetainedQuarterActuals, withRetainedQuarterActuals } from '../supabase/functions/_shared/recommendation-quarter-actuals-candidate.ts';

const require = createRequire(import.meta.url);
const componentFile = 'src/pages/admin/analysis/OwnerQuarterActualsView.tsx';
const previewFile = 'src/pages/admin/analysis/LineDecisionPreview.tsx';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = file => ts.transpileModule(read(file), { fileName: file, compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const exports = {};
vm.runInNewContext(compile(componentFile), { exports, URL, require(name) {
  if (name === 'react/jsx-runtime') return require(name);
  throw Error('UNEXPECTED_COMPONENT_IMPORT:' + name);
} });
const View = exports.default;
const html = candidate => renderToStaticMarkup(React.createElement(View, { candidate }));
const periods = ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'];
function candidate() {
  return { candidate_only: true, member_publication_approved: false, quarter_actuals: {
    contract: 'OWNER_RETAINED_QUARTER_ACTUALS_V1', status: 'ACTUALS_4_OF_4_V1_BLOCKED', symbol: '2330',
    as_of_date: '2026-10-19', supported_report_dates: { from: '2026-10-19', through: '2026-12-31' },
    source_pack_sha256: 'a'.repeat(64), pack_created_at: '2026-10-19T03:00:00Z', evidence_cutoff: '2026-10-19T03:00:00Z',
    rows: periods.map((fiscal_period, index) => ({ fiscal_period, eps_actual: 10 + index / 10,
      eps_basis: 'DILUTED', share_class: 'COMMON_SHARE', revenue_actual: 1_000_000_000_000 + index * 10_000_000,
      reported_revenue_billion: '1000.0' + index, revenue_resolution_twd: 10_000_000,
      source_ref: `https://investor.tsmc.com/english/synthetic-test/${fiscal_period}/FS.pdf`,
      source_sha256: String(index + 1).repeat(64), source_date_label: '2026-10-15',
      source_received_at: '2026-10-19T01:00:00Z', available_at: '2026-10-19T03:00:00Z', announced_at: null,
    })),
    missing: ['EXACT_FIRST_PUBLIC_ANNOUNCEMENT_AND_VERSION', 'PREANNOUNCEMENT_CONSENSUS', 'LATEST_GUIDANCE', 'FORMAL_SOURCE_ADMISSION'],
  } };
}

test('SSR presents a four-column financial table with plain limitations and retains technical evidence in details', () => {
  const input = candidate(), before = structuredClone(input), rendered = html(input);
  const body = rendered.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  const main = rendered.slice(0, rendered.indexOf('<details'));
  const details = rendered.slice(rendered.indexOf('<details'));
  assert.equal((body.match(/<tr>/g) || []).length, 4);
  assert.equal((body.match(/<a /g) || []).length, 4);
  assert.equal((rendered.match(/scope="col"/g) || []).length, 4);
  assert(main.includes('台積電四季營收與每股盈餘'));
  assert(main.includes('公告前預估、財測及公告版本仍待核對，尚不能完成正式推薦'));
  assert(main.includes('一千萬元（10,000,000 TWD）'));
  assert(main.includes('首次公開公告時間仍未確認'));
  assert(!/BLOCKED|Contract|SHA-256|COMMON_SHARE|\d{4}-\d{2}-\d{2}T/.test(main));
  for (const row of input.quarter_actuals.rows) {
    assert(body.includes(row.fiscal_period)); assert(body.includes(`>${row.eps_actual}</td>`));
    assert(body.includes(`href="${row.source_ref}"`)); assert(body.includes(row.reported_revenue_billion));
    assert(details.includes(row.source_sha256)); assert(!main.includes(row.source_sha256));
    assert(details.includes(row.revenue_actual.toLocaleString('en-US') + ' TWD'));
    assert(details.includes(row.source_received_at)); assert(details.includes(row.available_at));
  }
  for (const text of ['ACTUALS_4_OF_4_V1_BLOCKED', 'DILUTED／COMMON_SHARE', 'Basic 未揭露',
    '2026-12-31', '未確認（announced_at = null）',
    '不代表預覽報告當時已可取得', '首次公開公告時間與版本尚未確認', '公告前共識尚未留存',
    '最新財測尚未完成核對', '正式來源准入尚未完成', input.quarter_actuals.source_pack_sha256]) assert(details.includes(text), text);
  assert(main.includes('並非永久最新'));
  assert.equal((details.match(/未確認（announced_at = null）/g) || []).length, 4);
  assert(!rendered.includes('<details open'));
  assert(!rendered.includes('<button')); assert(!rendered.includes('勝率'));
  assert.deepEqual(input, before);
});

test('missing, incomplete or malformed evidence renders no actuals, source link or fallback numbers', () => {
  for (const mutate of [
    c => c.candidate_only = false, c => c.member_publication_approved = true, c => delete c.quarter_actuals,
    c => c.quarter_actuals.contract = 'OTHER', c => c.quarter_actuals.status = 'READY', c => c.quarter_actuals.symbol = '6488',
    c => c.quarter_actuals.rows.pop(), c => c.quarter_actuals.rows[0].fiscal_period = '2025-Q3',
    c => c.quarter_actuals.rows[1].fiscal_period = c.quarter_actuals.rows[0].fiscal_period,
    c => c.quarter_actuals.source_pack_sha256 = 'short', c => c.quarter_actuals.pack_created_at = 'invalid',
    c => c.quarter_actuals.evidence_cutoff = null, c => c.quarter_actuals.as_of_date = '2026-02-30',
    c => c.quarter_actuals.supported_report_dates.through = '2026-10-01', c => c.quarter_actuals.missing = [],
    c => c.quarter_actuals.rows[0].eps_actual = null, c => c.quarter_actuals.rows[0].eps_actual = Infinity,
    c => c.quarter_actuals.rows[0].eps_basis = 'BASIC', c => c.quarter_actuals.rows[0].share_class = 'ADR',
    c => c.quarter_actuals.rows[0].revenue_actual = '1000000000000', c => c.quarter_actuals.rows[0].revenue_resolution_twd = 1,
    c => c.quarter_actuals.rows[0].reported_revenue_billion = '', c => c.quarter_actuals.rows[0].source_sha256 = 'bad',
    c => c.quarter_actuals.rows[0].source_date_label = 'invalid', c => delete c.quarter_actuals.rows[0].source_received_at,
    c => c.quarter_actuals.rows[0].available_at = '2026-10-19', c => c.quarter_actuals.rows[0].announced_at = '2026-10-15T00:00:00Z',
  ]) {
    const input = candidate(); mutate(input); const rendered = html(input);
    assert(!rendered.includes('<table'), mutate.toString());
    assert(!rendered.includes('4/4')); assert(!rendered.includes('href=')); assert(!rendered.includes('1,000,000,000,000'));
    assert(rendered.includes('資料尚未核對完成，暫不顯示四季數字'));
  }
  for (const input of [null, undefined, {}, { quarter_actuals: candidate().quarter_actuals }]) assert(!html(input).includes('<table'));
});

test('source anchors accept only unchanged HTTPS TSMC investor PDF URLs without credentials/query/fragment', () => {
  for (const source_ref of ['javascript:alert(1)', 'http://investor.tsmc.com/FS.pdf', 'https://investor.tsmc.com.evil.test/FS.pdf',
    'https://investor.tsmc.com@evil.test/FS.pdf', 'https://user:secret@investor.tsmc.com/FS.pdf',
    'https://investor.tsmc.com/FS.pdf?token=secret', 'https://investor.tsmc.com/FS.pdf#fragment',
    'https://investor.tsmc.com:443/FS.pdf', 'https://investor.tsmc.com/earnings.html', '//investor.tsmc.com/FS.pdf']) {
    const input = candidate(); input.quarter_actuals.rows[0].source_ref = source_ref;
    assert(!html(input).includes('<table'), source_ref); assert(!html(input).includes('href='));
  }
});

test('the actual retained source builder output renders all four official PDF rows without a network request', async () => {
  const identity = { report_date: '2026-10-19', revision_id: 'SYNTHETIC_UI_CONTRACT',
    generated_at: '2026-10-19T03:00:00Z', data_as_of: '2026-10-19T03:00:00Z' };
  const capsule = await createRetainedQuarterActuals(identity, identity.generated_at);
  assert(capsule);
  const result = await withRetainedQuarterActuals({ earnings: [], failures: [] }, {
    report_date: identity.report_date, producer_revision_id: identity.revision_id,
    producer_cutoff: identity.generated_at, evidence_cutoff: identity.generated_at,
  }, capsule);
  assert(result.quarterActuals);
  const rendered = html({ candidate_only: true, member_publication_approved: false, quarter_actuals: result.quarterActuals });
  assert.equal((rendered.match(/<tr>/g) || []).length, 5);
  for (const row of capsule.source_pack.rows) {
    assert(rendered.includes(`href="${row.source_ref}"`)); assert(rendered.includes(row.source_sha256));
    assert(rendered.includes(row.reported_revenue_billion)); assert(rendered.includes(row.source_received_at));
    assert(rendered.includes(`>${row.eps_actual}</td>`));
  }
  assert(rendered.includes(result.quarterActuals.source_pack_sha256));
  assert(rendered.includes('台積電四季營收與每股盈餘'));
  assert(rendered.includes('尚不能完成正式推薦'));
  assert(rendered.includes('ACTUALS_4_OF_4_V1_BLOCKED'));
});

const jsx = (type, props) => ({ type, props });
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function previewHarness({ report, denied = false, pendingReport } = {}) {
  let cursor = 0, tree;
  const slots = [], effects = [], queued = [], calls = [], listeners = new Set();
  const previewExports = {};
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
    useEffect(fn, deps) {
      const index = cursor++, previous = effects[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        queued.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  vm.runInNewContext(compile(previewFile), { exports: previewExports, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === '@/lib/supabase') return { supabase: {
      auth: { onAuthStateChange(listener) { listeners.add(listener); return { data: { subscription: { unsubscribe() { listeners.delete(listener); } } } }; } },
      async rpc(name) { calls.push(name); return name === 'get_research_foundation_v1'
        ? { error: denied ? { code: '42501' } : null } : { error: null, data: null }; },
    } };
    if (name === '@/services/entitlementService') return {
      async callGetReportPayload(params) { calls.push(['report', params]); return pendingReport || report; },
      async callGetReportHistory(limit) { calls.push(['history', limit]); return { reports: [{ report_date: report.report_date }] }; },
    };
    if (name === '@/features/line/decisionCard') return { composeDecisionCard, decisionCardFlex, ownerV2Copy };
    if (name === './OwnerQuarterActualsView') return { default: View };
    throw Error('UNEXPECTED_PREVIEW_IMPORT:' + name);
  } });
  function render() {
    cursor = 0; tree = previewExports.default();
    while (queued.length) queued.shift()();
    return tree;
  }
  render();
  return {
    calls, render,
    open() { tree.props.onToggle({ currentTarget: { open: true } }); render(); },
    event(name) { for (const listener of [...listeners]) listener(name); },
    sourceHtml() {
      const node = nodes(render(), node => node.type === View)[0];
      return node ? renderToStaticMarkup(React.createElement(View, node.props)) : '';
    },
    selectDate(date) { const select = nodes(render(), node => node.type === 'select')[0]; select.props.onChange({ target: { value: date } }); render(); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}
function reportFixture() {
  const report = lineDecisionFixture();
  report.payload.owner_market_foundation_candidate = candidate();
  return report;
}

test('existing Owner preview retains the exact same response field; no extra acquisition or member Flex content', async () => {
  const report = reportFixture(), baseline = structuredClone(report); delete baseline.payload.owner_market_foundation_candidate;
  const preview = previewHarness({ report });
  assert.equal(preview.calls.length, 0);
  preview.open(); await flush();
  assert.equal(preview.calls.length, 4);
  assert.equal(preview.calls[0], 'get_research_foundation_v1');
  assert.equal(preview.calls.filter(call => Array.isArray(call) && call[0] === 'report').length, 1);
  assert(preview.sourceHtml().includes('<table'));
  for (const row of report.payload.owner_market_foundation_candidate.quarter_actuals.rows) assert(preview.sourceHtml().includes(row.source_sha256));
  assert.deepEqual(decisionCardFlex(composeDecisionCard(report)), decisionCardFlex(composeDecisionCard(baseline)));
  const source = read(componentFile);
  assert(!/fetch\s*\(|\.rpc\s*\(|\.invoke\s*\(|\.insert\s*\(|\.update\s*\(/.test(source));
  preview.unmount();
});

test('permission denial, missing server Owner field, auth changes and late responses expose no actuals', async () => {
  const denied = previewHarness({ report: reportFixture(), denied: true }); denied.open(); await flush();
  assert.equal(denied.calls.length, 1); assert.equal(denied.sourceHtml(), ''); denied.unmount();
  for (const mutate of [r => delete r.payload.owner_market_foundation_candidate, r => r.tier = 'vip', r => r.authenticated = false]) {
    const report = reportFixture(); mutate(report);
    const preview = previewHarness({ report }); preview.open(); await flush();
    assert(!preview.sourceHtml().includes('<table')); preview.unmount();
  }
  for (const event of ['SIGNED_OUT', 'SIGNED_IN', 'TOKEN_REFRESHED']) {
    const preview = previewHarness({ report: reportFixture() }); preview.open(); await flush();
    assert(preview.sourceHtml().includes('<table'));
    preview.event(event); assert.equal(preview.sourceHtml(), ''); preview.unmount();
  }
  let resolveReport;
  const report = reportFixture(), pendingReport = new Promise(resolve => { resolveReport = resolve; });
  const late = previewHarness({ report, pendingReport }); late.open(); await flush();
  late.event('SIGNED_OUT'); resolveReport(report); await flush();
  assert.equal(late.sourceHtml(), ''); late.unmount();
});

test('changing the selected report clears old quarter evidence while the next existing response is pending', async () => {
  const report = reportFixture(), preview = previewHarness({ report }); preview.open(); await flush();
  assert(preview.sourceHtml().includes('<table'));
  delete report.payload.owner_market_foundation_candidate;
  preview.selectDate('2026-10-08');
  assert.equal(preview.sourceHtml(), '');
  await flush(); assert(!preview.sourceHtml().includes('<table'));
  assert.equal(preview.calls.filter(call => Array.isArray(call) && call[0] === 'report').length, 2);
  preview.unmount();
});
