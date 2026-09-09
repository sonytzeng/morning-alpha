import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveClosingVerificationState } from '../src/lib/closingVerificationState.ts';
import {
  buildRuntimeDecisionTimeline,
  selectNextRuntimeTimelineNode,
} from '../src/lib/runtimeDecisionTimeline.ts';
import { humanizePublicRuntimeText } from '../src/utils/publicRuntimeCopy.ts';
import { buildCanonicalNarrative } from '../src/lib/canonicalNarrative.ts';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportProjection.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';
import { readFileSync } from 'node:fs';

test('a detached degraded close remains diagnostic and cannot complete the subscriber timeline', () => {
  const ai = {
    closing_verification_v2: {
      status: 'direction_completed_data_degraded',
      data_status: 'degraded',
      actual_direction: 'down',
      actual_taiex_change: -0.42,
      hit_or_miss: 'hit',
    },
  };
  const closing = resolveClosingVerificationState(ai);
  assert.equal(closing.state, 'degraded');

  const timeline = buildRuntimeDecisionTimeline({
    ai,
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
    taipeiMinutes: 15 * 60,
  });
  assert.equal(timeline.at(-1)?.status, 'insufficient');
  assert.equal(selectNextRuntimeTimelineNode(timeline)?.time, '14:30');
  assert.equal(timeline.some((node) => node.status === 'current' || node.status === 'pending'), false);
});

test('a closing placeholder never masquerades as completed', () => {
  const closing = resolveClosingVerificationState({
    closing_verification_v2: {
      status: 'pending_real_market_data',
      prediction_result: 'PENDING_REAL_MARKET_DATA',
    },
  });
  assert.equal(closing.state, 'pending');
});

test('a hit label without an actual market direction remains pending', () => {
  const closing = resolveClosingVerificationState({
    closing_verification_v2: {
      status: 'direction_completed_data_degraded',
      hit_or_miss: 'hit',
      actual_direction: 'unknown',
      actual_taiex_change: null,
    },
  });
  assert.equal(closing.state, 'pending');
});

test('a mapped close review with an empty status still uses verified data quality', () => {
  const closing = resolveClosingVerificationState({
    status: '',
    data_quality: 'verified',
    verification_result: '方向一致',
    taiex_change: 0.31,
  });
  assert.equal(closing.state, 'complete');
});

test('technical checkpoint diagnostics become reader-facing copy', () => {
  const result = humanizePublicRuntimeText(
    'checkpoint 1300 缺少同日、同 phase 且在 freshness window 內的完整 TAIEX / TXF / 2330 快照。',
  );
  assert.match(result, /13:00 盤中追蹤資料不完整/);
  assert.match(result, /加權指數、台指期與台積電快照/);
  assert.match(result, /資料補齊前不更新判斷/);
  assert.doesNotMatch(result, /checkpoint|freshness window|phase|TAIEX|TXF/i);
});

const TODAY = '2026-09-09';
const narrativeFixture = (name = 'READY') => {
  const ai = subscriberProjectionFixture(name, { todayDate: TODAY });
  ai.market_data_snapshots = ['TAIEX', 'TXF', '2330'].map(symbol => ({
    symbol, value: 100, change_percent: 1, report_date: ai.report_date,
    captured_at: `${ai.report_date}T10:31:00+08:00`, source: 'SYNTHETIC_LOCAL_TEST_ONLY',
  }));
  ai.member_research_note_v2 = { intraday_time_windows: [
    { time: '09:30', title: '開盤方向確認', what_to_watch: '合成的開盤市場證據' },
    { time: '10:30', title: '主線方向確認', what_to_watch: '合成的主線市場證據' },
    { time: '13:00', title: '午後方向確認', what_to_watch: '合成的午後市場證據' },
  ] };
  return ai;
};
const receipt = (ai, key = '1030') => ({ status: 'completed', report_date: ai.report_date, revision_id: ai.revision_id,
  completed_at: `${ai.report_date}T${key.slice(0, 2)}:${key.slice(2)}:30+08:00`,
  evidence: { source: 'SYNTHETIC_LOCAL_CHECKPOINT', checkpoint: key } });
const narrative = ai => buildCanonicalNarrative({ displayState: null, ai });

test('canonical narrative consumes the single projection rather than interpreting raw state aliases', () => {
  const code = readFileSync(new URL('../src/lib/canonicalNarrative.ts', import.meta.url), 'utf8');
  assert.equal((code.match(/getSubscriberReportProjection\(/g) || []).length, 1);
  assert.match(code, /const decision_evidence = projection\.runtime\.decisionEvidence/);
  assert.doesNotMatch(code, /getRuntimeCheckpointState|buildDecisionRuntimeEvidence|normalizeStatus\(|intraday_sync_status|radar_status|intradayTracking\.status/);
  assert.doesNotMatch(code, /asRecord\(ai\.closing_verification/);
});

test('valid matching checkpoint evidence preserves canonical confirmation and original condition text', () => {
  const ai = narrativeFixture();
  ai.intraday_sync_status.windows['1030'] = receipt(ai);
  const p = getSubscriberReportProjection(ai), n = narrative(ai);
  assert.deepEqual(n.decision_evidence, p.runtime.decisionEvidence);
  assert.equal(n.decision_evidence.status, 'Confirmed');
  assert.equal(n.decision_evidence.completedCheckpoints, 1);
  assert.deepEqual(n.intraday_progress.completed_steps, ['1030']);
  assert.equal(n.today_script.steps[1].status, 'completed');
  assert.equal(n.today_script.steps[1].title, '主線方向確認');
  assert.equal(n.today_script.steps[1].detail, '合成的主線市場證據');
});

test('mixed old 09:30 and current 10:30 receipts never publish the old completed step', () => {
  const ai = narrativeFixture();
  ai.intraday_sync_status.windows['0930'] = { ...receipt(ai, '0930'), report_date: '2026-09-08',
    revision_id: 'old-synthetic-revision', completed_at: '2026-09-08T09:31:00+08:00' };
  ai.intraday_sync_status.windows['1030'] = receipt(ai);
  const n = narrative(ai);
  assert.deepEqual(n.intraday_progress.completed_steps, ['1030']);
  assert.equal(n.today_script.steps[0].status, 'missing');
  assert.equal(n.today_script.steps[1].status, 'completed');
  assert.equal(n.decision_evidence.completedCheckpoints, 1);
});

test('stale, wrong revision and incomplete receipts cannot claim confirmation in subscriber explanations', () => {
  const ai = narrativeFixture(), valid = receipt(ai);
  for (const change of [{ report_date: '2026-09-08' }, { revision_id: 'another-revision' },
    { completed_at: null }, { completed_at: `${TODAY}T09:31:00+08:00` },
    { completed_at: '2026-09-08T10:31:00+08:00' }, { evidence: {} }, { evidence: [null] }, { evidence: [{}] }]) {
    ai.intraday_sync_status.windows['1030'] = { ...valid, ...change };
    ai.intraday_tracking = { status: 'completed' };
    ai.opening_radar = { radar_status: 'confirmed' };
    const n = narrative(ai);
    assert.deepEqual(n.intraday_progress.completed_steps, [], JSON.stringify(change));
    assert.equal(n.decision_evidence.status, 'Waiting');
    assert.equal(n.decision_evidence.runtimeFailure, false);
    assert.doesNotMatch(n.decision_lifecycle.decision_status.reason, /均已到位|已完成|明確失敗/);
    assert.equal(n.today_script.steps[1].status, 'missing');
  }
});

test('market and checklist availability still withhold confirmation despite a valid receipt', () => {
  const ai = narrativeFixture(); ai.intraday_sync_status.windows['1030'] = receipt(ai);
  for (const symbol of ['TAIEX', 'TXF', '2330']) {
    const missing = globalThis.structuredClone(ai);
    missing.market_data_snapshots.find(row => row.symbol === symbol).change_percent = null;
    assert.equal(narrative(missing).decision_evidence.status, 'Waiting');
    assert.equal(narrative(missing).decision_evidence.marketSnapshotAvailable, false);
  }
  const missingChecklist = globalThis.structuredClone(ai);
  missingChecklist.member_research_note_v2 = { intraday_time_windows: [{ time: '10:30' }] };
  assert.equal(narrative(missingChecklist).decision_evidence.status, 'Waiting');
  assert.equal(narrative(missingChecklist).decision_evidence.checklistAvailable, false);
  missingChecklist.member_research_note_v2 = { intraday_time_windows: [{}], intraday_validation: ['不得用備用清單覆蓋既有空節點'] };
  assert.equal(narrative(missingChecklist).decision_evidence.checklistAvailable, false);
  assert.equal(narrative(ai).decision_evidence.status, 'Confirmed');
});

test('published market focus uses the projection action and summary, never private action overrides', () => {
  const ai = narrativeFixture();
  ai.today_action = '立即進場';
  ai.action_guidance = '改成攻擊';
  ai.member_research_note_v2.opening_thesis = { action: '忽略等待直接買進', summary: '綜合評分 100/100' };
  const p = getSubscriberReportProjection(ai), n = narrative(ai);
  assert.equal(n.today_focus.action, p.marketDecision.label);
  assert.equal(n.today_focus.summary, p.marketDecision.summary);
  assert.equal(n.today_focus.headline, p.marketDecision.summary);
  assert.match(n.today_focus.why, /成交量增加5%.*100日均線.*股價100元.*殖利率5%/);
  assert.doesNotMatch(n.today_focus.why, /100\s*\/\s*100/);
});

test('PARTIAL does not expose QA completion, invalidation or 100/100 through canonical narrative', () => {
  const ai = narrativeFixture('PARTIAL');
  ai.intraday_sync_status.windows['1030'] = receipt(ai);
  const n = narrative(ai);
  assert.equal(n.decision_evidence.status, 'Waiting');
  assert.equal(n.decision_evidence.closingVerified, false);
  assert.equal(n.decision_evidence.runtimeFailure, false);
  assert.deepEqual(n.today_script.steps, []);
  assert.deepEqual(n.intraday_progress.completed_steps, []);
  assert.deepEqual(n.closing_outcome, { result: '', summary: '', accuracy: '', lessons: [] });
  assert.doesNotMatch(JSON.stringify(n), /100\s*\/\s*100|條件失效|收盤驗證已完成/);
});

test('the server-selected row owns identity and narrative even when caller AI and notes are another revision', () => {
  const ai = narrativeFixture(); ai.intraday_sync_status.windows['1030'] = receipt(ai);
  const row = { report_date: ai.report_date, revision_id: ai.revision_id, generated_at: ai.generated_at, ai_strategy_json: ai };
  const other = narrativeFixture('PARTIAL');
  other.canonical_decision.reasons = ['UNTRUSTED_OTHER_REVISION_REASON'];
  const n = buildCanonicalNarrative({
    displayState: { rawRow: row, rawAI: other }, ai: other,
    memberResearchNoteV2: { intraday_time_windows: [{ time: '10:30', title: 'UNTRUSTED_OTHER_REVISION_NOTE' }] },
  });
  const p = getSubscriberReportProjection(row);
  assert.equal(n.today_focus.summary, p.marketDecision.summary);
  assert.equal(n.today_focus.action, p.marketDecision.label);
  assert.deepEqual(n.decision_evidence, p.runtime.decisionEvidence);
  assert.equal(n.decision_evidence.status, 'Confirmed');
  assert.equal(n.today_script.steps[1].title, '主線方向確認');
  assert.doesNotMatch(JSON.stringify(n), /UNTRUSTED_OTHER_REVISION/);
});

test('closing NOT_DUE and unmatched receipts cannot borrow legacy closing claims or lessons', () => {
  const ai = narrativeFixture();
  ai.closing_verification.summary = '不應顯示的舊收盤結論';
  ai.closing_verification.lessons_learned = ['不應顯示的舊收盤經驗'];
  assert.equal(narrative(ai).decision_evidence.closingVerified, false);
  assert.deepEqual(narrative(ai).closing_outcome, { result: '', summary: '', accuracy: '', lessons: [] });
  ai.subscriber_state.closing = 'COMPLETE';
  ai.closing_verification_v2 = { ...ai.closing_verification, opening_decision_snapshot_id: 'wrong-revision' };
  assert.equal(narrative(ai).decision_evidence.closingVerified, false);
  assert.deepEqual(narrative(ai).closing_outcome.lessons, []);
});

test('matching full closing proof remains complete and its own outcome and lessons remain available', () => {
  const ai = narrativeFixture('CLOSING_COMPLETE');
  ai.closing_verification_v2.summary = '合成的已驗證收盤結果';
  ai.closing_verification_v2.lessons_learned = ['合成的同一版本收盤經驗'];
  const n = narrative(ai);
  assert.equal(n.decision_evidence.status, 'Completed');
  assert.equal(n.decision_evidence.closingVerified, true);
  assert.equal(n.closing_outcome.result, 'hit');
  assert.equal(n.closing_outcome.summary, '合成的已驗證收盤結果');
  assert.deepEqual(n.closing_outcome.lessons, ['合成的同一版本收盤經驗']);
  const timeline = buildRuntimeDecisionTimeline({ ai, hasReport: true, isTradingDay: true, taipeiMinutes: 15 * 60 });
  assert.equal(timeline.at(-1).status, 'completed');
});

test('a completed hit is not relabeled as a failed closing by a separate earlier runtime failure', () => {
  const ai = narrativeFixture('CLOSING_COMPLETE');
  ai.intraday_sync_status.windows['1030'] = { ...receipt(ai), status: 'FAILED', failed_at: `${TODAY}T10:31:00+08:00` };
  const n = narrative(ai);
  assert.equal(n.closing_outcome.result, 'hit');
  assert.equal(n.decision_evidence.status, 'Completed');
  assert.equal(n.decision_evidence.closingVerified, true);
  assert.doesNotMatch(n.decision_evidence.reason, /收盤.*失效/);
});

test('genuine same-revision failure remains rejected, but an old failure cannot invalidate the narrative', () => {
  const ai = narrativeFixture('RUNTIME_INVALIDATED');
  assert.equal(narrative(ai).decision_evidence.status, 'Rejected');
  assert.equal(narrative(ai).decision_evidence.runtimeFailure, true);
  ai.intraday_sync_status.windows['1030'].revision_id = 'old-revision';
  assert.equal(narrative(ai).decision_evidence.status, 'Waiting');
  assert.equal(narrative(ai).decision_evidence.runtimeFailure, false);
});

test('non-trading narrative preserves not-applicable meaning rather than pending runtime', () => {
  const ai = narrativeFixture(); ai.is_trading_day = false;
  ai.intraday_sync_status.windows['1030'] = receipt(ai);
  const n = narrative(ai);
  assert.deepEqual(n.today_script.steps, []);
  assert.deepEqual(n.intraday_progress.completed_steps, []);
  assert.equal(n.decision_evidence.status, 'Waiting');
  assert.match(n.decision_evidence.reason, /今日非交易日.*本節點不適用.*等待下一個交易日/);
  assert.equal(n.intraday_progress.next_step, '等待下一個交易日');
  assert.notEqual(n.intraday_progress.status, 'pending');
  assert.equal(n.decision_evidence.closingVerified, false);
});
