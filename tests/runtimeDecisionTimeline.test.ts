import {
  buildRuntimeDecisionTimeline,
  reconcileRuntimeTimeline,
  selectNextRuntimeTimelineNode,
} from '../src/lib/runtimeDecisionTimeline.ts';
import { resolveMarketStatus } from '../src/lib/market-status.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// An explicit published revision, not `hasReport: true` alone, establishes the
// premarket node. All data below is synthetic and isolated from Production.
const publishedReport = {
  report_date: '2026-07-15', revision_id: 'revision-1', generated_at: '2026-07-14T23:30:00Z',
  canonical_decision: { id: 'revision-1', status: 'READY', action: 'WAIT' },
  content_publish_gate: { overall_status: 'eligible' },
};

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

Deno.test('trading day without a published report is insufficient, never completed or non-trading', () => {
  const market = resolveMarketStatus('2026-07-15');
  assert(market.market_status === 'OPEN', 'regular trading day must resolve OPEN');
  const timeline = buildRuntimeDecisionTimeline({
    ai: {},
    hasReport: false,
    isTradingDay: market.is_trading_day,
    taipeiMinutes: 8 * 60,
  });
  assert(timeline[0]?.status === 'insufficient', 'a missing published report is incomplete, not a successful premarket checkpoint');
  assert(
    timeline.every((node) => node.status !== 'completed'),
    'time passing without report or checkpoint evidence cannot manufacture completion',
  );
  assert(
    timeline.every((node) => node.status !== 'not_applicable'),
    'trading checkpoints must not be marked not_applicable',
  );
});

Deno.test('checkpoint marked complete without execution evidence is not completed', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      ...publishedReport,
      intraday_sync_status: {
        windows: { '0930': { status: 'completed' } },
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
    taipeiMinutes: 10 * 60,
  });
  assert(timeline[2]?.status === 'insufficient', 'a claimed completion without its receipt is insufficient, never completed');
});

Deno.test('a future checkpoint is waiting, not current', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: publishedReport,
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
    taipeiMinutes: 8 * 60 + 40,
  });

  assert(timeline[0]?.status === 'completed', 'premarket report must remain completed');
  assert(timeline[1]?.status === 'pending', '09:00 must still be waiting at 08:40');
  assert(timeline[2]?.status === 'pending', '09:30 must still be waiting at 08:40');
  assert(timeline.every((node) => node.status !== 'current'), 'future checkpoints must not be marked current');
  const noPublication = buildRuntimeDecisionTimeline({
    ai: {}, hasReport: true, reportRevisionId: 'revision-1', isTradingDay: true, taipeiMinutes: 8 * 60 + 40,
  });
  assert(noPublication[0]?.status === 'insufficient', 'hasReport and a revision string cannot self-certify publication');
});

Deno.test('checkpoint completed with evidence is completed', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      ...publishedReport,
      intraday_sync_status: {
        windows: {
          '0930': {
            status: 'completed',
            report_date: publishedReport.report_date, revision_id: publishedReport.revision_id,
            completed_at: '2026-07-15T01:31:00.000Z',
            evidence: { source: 'synthetic-runtime' },
          },
        },
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
  });
  assert(timeline[2]?.status === 'completed', 'checkpoint with completed_at must be completed');
});

Deno.test('failed checkpoint with evidence is insufficient, never completed', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      ...publishedReport,
      intraday_sync_status: {
        windows: {
          '0930': {
            status: 'failed',
            report_date: publishedReport.report_date, revision_id: publishedReport.revision_id,
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
  assert(timeline[2]?.status === 'insufficient', 'failed checkpoint must be insufficient');
});

Deno.test('next checkpoint skips an insufficient past node for the next pending node', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      ...publishedReport,
      intraday_sync_status: {
        windows: {
          '0930': {
            status: 'failed',
            report_date: publishedReport.report_date, revision_id: publishedReport.revision_id,
            failed_at: '2026-07-15T01:31:00.000Z',
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
  assert(timeline[2]?.status === 'insufficient', '09:30 must remain an insufficient historical node');
  assert(next?.time === '10:30', '10:30 must be selected as the next pending checkpoint');
});

Deno.test('a completed later checkpoint closes earlier pending gaps', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: {
      ...publishedReport,
      closing_verification_v2: {
        status: 'completed',
        data_status: 'complete', report_date: publishedReport.report_date,
        opening_decision_snapshot_id: publishedReport.revision_id,
        verified_at: '2026-07-15T06:30:00Z',
        hit_or_miss: 'hit',
        actual_taiex_change: 0.8,
        actual_2330_close: { change_percent: 1.2 }, actual_txf_close: { change_percent: 0.7 }, missing_data: [],
      },
    },
    hasReport: true,
    reportRevisionId: 'revision-1',
    isTradingDay: true,
  });

  assert(
    timeline.slice(1, 6).every((node) => node.status === 'insufficient'),
    'earlier missing checkpoints must be insufficient after closing completes',
  );
  assert(
    timeline.every((node) => node.status !== 'current' && node.status !== 'pending'),
    'no earlier checkpoint may remain current or pending after closing completes',
  );
  assert(timeline[6]?.status === 'completed', 'closing checkpoint must remain completed');
});

Deno.test('a closing hit label without actual market evidence is not completion', () => {
  const timeline = buildRuntimeDecisionTimeline({
    ai: { ...publishedReport, closing_verification_v2: { status: 'completed', hit_or_miss: 'hit' } },
    hasReport: true, reportRevisionId: 'revision-1', isTradingDay: true,
  });
  assert(timeline[6]?.status !== 'completed', 'an evaluation label must not manufacture closing evidence');
});

Deno.test('an insufficient later checkpoint closes earlier pending gaps', () => {
  const timeline = reconcileRuntimeTimeline([
    { time: '09:00', status: 'pending' as const },
    { time: '09:30', status: 'insufficient' as const },
    { time: '10:30', status: 'pending' as const },
    { time: '13:30', status: 'pending' as const },
  ], 11 * 60 + 12);

  assert(timeline[0]?.status === 'insufficient', '09:00 must not remain current behind a resolved 09:30 checkpoint');
  assert(timeline[1]?.status === 'insufficient', '09:30 must retain its insufficient result');
  assert(timeline[2]?.status === 'current', '10:30 must become the active checkpoint');
  assert(timeline[3]?.status === 'pending', 'future checkpoints must remain pending');
});
