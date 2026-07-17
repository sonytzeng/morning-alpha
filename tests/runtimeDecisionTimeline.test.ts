import { buildRuntimeDecisionTimeline, selectNextRuntimeTimelineNode } from '../src/lib/runtimeDecisionTimeline.ts';
import { resolveMarketStatus } from '../src/lib/market-status.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEveryNotApplicable(label: string, date: string, expectedMarketStatus: string): void {
  const market = resolveMarketStatus(date);
  assert(market.market_status === expectedMarketStatus, `${label}: unexpected market status`);
  assert(!market.is_trading_day, `${label}: must be a non-trading day`);
  const timeline = buildRuntimeDecisionTimeline({
    ai: {},
    hasReport: false,
    isTradingDay: market.is_trading_day,
    taipeiMinutes: 8 * 60,
  });
  assert(
    timeline.every((node) => node.status === 'not_applicable'),
    `${label}: every checkpoint must be not_applicable`,
  );
}

Deno.test('weekend checkpoints are not applicable', () => {
  assertEveryNotApplicable('weekend', '2026-07-11', 'WEEKEND');
});

Deno.test('market holiday checkpoints are not applicable', () => {
  assertEveryNotApplicable('market holiday', '2026-06-19', 'HOLIDAY');
});

Deno.test('typhoon closure checkpoints are not applicable', () => {
  assertEveryNotApplicable('typhoon closure', '2026-07-10', 'TYPHOON');
});

Deno.test('trading day without checkpoint evidence remains pending/current', () => {
  const market = resolveMarketStatus('2026-07-15');
  assert(market.market_status === 'OPEN', 'regular trading day must resolve OPEN');
  const timeline = buildRuntimeDecisionTimeline({
    ai: {},
    hasReport: false,
    isTradingDay: market.is_trading_day,
    taipeiMinutes: 8 * 60,
  });
  assert(timeline[0]?.status === 'current', 'first missing trading checkpoint should be current');
  assert(
    timeline.slice(1).every((node) => node.status === 'pending'),
    'later missing trading checkpoints should remain pending',
  );
  assert(
    timeline.every((node) => node.status !== 'not_applicable'),
    'trading checkpoints must not be marked not_applicable',
  );
});

Deno.test('checkpoint marked complete without execution evidence is not completed', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      intraday_sync_status: {
        windows: { '0930': { status: 'completed' } },
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
    taipeiMinutes: 10 * 60,
  });
  assert(timeline[1]?.status === 'current', 'checkpoint without completed_at/evidence must remain current');
});

Deno.test('a future checkpoint is waiting, not current', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {},
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
    taipeiMinutes: 8 * 60 + 40,
  });

  assert(timeline[0]?.status === 'completed', 'premarket report must remain completed');
  assert(timeline[1]?.status === 'pending', '09:30 must still be waiting at 08:40');
  assert(timeline.every((node) => node.status !== 'current'), 'future checkpoints must not be marked current');
});

Deno.test('checkpoint completed with evidence is completed', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      intraday_sync_status: {
        windows: {
          '0930': {
            status: 'completed',
            completed_at: '2026-07-15T01:31:00.000Z',
          },
        },
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
  });
  assert(timeline[1]?.status === 'completed', 'checkpoint with completed_at must be completed');
});

Deno.test('failed checkpoint with evidence is insufficient, never completed', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      intraday_sync_status: {
        windows: {
          '0930': {
            status: 'failed',
            failed_at: '2026-07-15T01:31:00.000Z',
            evidence: { reason: 'runtime failure' },
          },
        },
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
  });
  assert(timeline[1]?.status === 'insufficient', 'failed checkpoint must be insufficient');
});

Deno.test('next checkpoint skips an insufficient past node for the next pending node', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      intraday_sync_status: {
        windows: {
          '0930': {
            status: 'failed',
            failed_at: '2026-07-17T01:31:00.000Z',
            evidence: { reason: 'missing source' },
          },
        },
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
    taipeiMinutes: 9 * 60 + 54,
  });
  const next = selectNextRuntimeTimelineNode(timeline);
  assert(timeline[1]?.status === 'insufficient', '09:30 must remain an insufficient historical node');
  assert(next?.time === '10:30', '10:30 must be selected as the next pending checkpoint');
});

Deno.test('a completed later checkpoint closes earlier pending gaps', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      closing_verification_v2: {
        status: 'completed',
        hit_or_miss: 'hit',
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
  });

  assert(
    timeline.slice(1, 4).every((node) => node.status === 'insufficient'),
    'earlier missing checkpoints must be insufficient after closing completes',
  );
  assert(
    timeline.every((node) => node.status !== 'current' && node.status !== 'pending'),
    'no earlier checkpoint may remain current or pending after closing completes',
  );
  assert(timeline[4]?.status === 'completed', 'closing checkpoint must remain completed');
});
