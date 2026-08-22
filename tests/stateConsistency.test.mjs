import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveClosingVerificationState } from '../src/lib/closingVerificationState.ts';
import {
  buildRuntimeDecisionTimeline,
  selectNextRuntimeTimelineNode,
} from '../src/lib/runtimeDecisionTimeline.ts';
import { humanizePublicRuntimeText } from '../src/utils/publicRuntimeCopy.ts';

test('degraded closing verification is complete across the shared timeline', () => {
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
  assert.equal(timeline.at(-1)?.status, 'completed');
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
