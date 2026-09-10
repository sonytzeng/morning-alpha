import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCanonicalIntradaySyncStatus,
  preserveRuntimeReportOverlay,
} from '../supabase/functions/_shared/runtime-report-state.ts';
import { buildDecisionPresentation } from '../src/lib/decisionPresentation.ts';
import { dedupePresentedOpportunities } from '../src/lib/decisionPresentation.ts';
import { buildCanonicalNarrative } from '../src/lib/canonicalNarrative.ts';

const generatorSource = readFileSync(new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url), 'utf8');
const payloadSource = readFileSync(new URL('../supabase/functions/get-report-payload/index.ts', import.meta.url), 'utf8');
const deliverySource = readFileSync(new URL('../supabase/functions/daily-delivery-orchestrator/index.ts', import.meta.url), 'utf8');

test('delivery receipt preserves the durable run and decision identities for exact reconciliation', () => {
  assert.match(deliverySource, /pipeline_run_id: activeRunId/);
  assert.match(deliverySource, /decision_snapshot_id: typeof state.snapshot\?\.id/);
  assert.match(deliverySource, /pipeline_run_id: claim.id/);
  assert.match(deliverySource, /decision_snapshot_id: claim.existingDecisionSnapshotId/);
});

test('production consumers cannot bypass the canonical runtime overlay contract', () => {
  assert.match(generatorSource, /preserveRuntimeReportOverlay\(aiStrategyJson/);
  assert.match(generatorSource, /runtime_overlay_preserved_for_regeneration/);
  assert.match(generatorSource, /trading_day_state_overlay_applied/);
  assert.match(payloadSource, /from\("trading_day_state"\)/);
  assert.match(payloadSource, /buildCanonicalIntradaySyncStatus\(/);
  assert.match(payloadSource, /buildAdminPayload\(report, ctx\)/);
});

test('report regeneration preserves completed runtime overlays without restoring editorial fields', () => {
  const generated = {
    today_quote: '新版今日一句話',
    content_score: 100,
    intraday_sync_status: { windows: { '0930': 'missing' } },
  };
  const existing = {
    today_quote: '舊版今日一句話',
    content_score: 70,
    opening_radar: { report_date: '2026-08-25', radar_status: '盤中轉弱' },
    intraday_sync_status: {
      source: 'opening_market_radar_refresh',
      checkpoint: '0930',
      last_checked_at: '2026-08-25T01:35:00.000Z',
      captured_at: '2026-08-25T01:34:00.000Z',
      windows: { '0930': 'ready', '1030': 'pending', '1300': 'pending' },
    },
  };

  const merged = preserveRuntimeReportOverlay(generated, existing);
  assert.equal(merged.today_quote, '新版今日一句話');
  assert.equal(merged.content_score, 100);
  assert.deepEqual(merged.opening_radar, existing.opening_radar);
  assert.deepEqual(merged.intraday_sync_status, existing.intraday_sync_status);
});

test('generator missing placeholders do not replace canonical ledger success', () => {
  const sync = buildCanonicalIntradaySyncStatus(
    {
      windows: { '0930': 'missing', '1030': 'pending', '1300': 'pending' },
      warning: '09:30 盤中資料尚未同步',
    },
    {
      trading_date: '2026-08-25',
      current_state: 'CHECKPOINT_0930_CAPTURED',
      state_rank: 30,
      updated_at: '2026-08-25T01:35:12.422Z',
      checkpoint_status: {
        '0930': {
          state: 'CHECKPOINT_0930_CAPTURED',
          status: 'SUCCEEDED',
          updated_at: '2026-08-25T01:35:12.422Z',
          metadata: {
            required_core_complete: true,
            canonical_complete: true,
            snapshot_upserted_count: 11,
          },
        },
      },
    },
  );

  assert.equal(sync.source, 'trading_day_state');
  assert.equal(sync.ledger_guarantee, true);
  assert.equal(sync.checkpoint, '0930');
  assert.equal(sync.checkpoint_status, 'completed');
  assert.equal(sync.windows['0930'].status, 'completed');
  assert.equal(sync.windows['0930'].real_checkpoint_observation, true);
  assert.equal(sync.windows['1030'], 'pending');
});

test('unresolved future ledger checkpoints remain pending', () => {
  const sync = buildCanonicalIntradaySyncStatus(
    { windows: { '0930': 'pending', '1030': 'pending', '1300': 'pending' } },
    {
      trading_date: '2026-08-25',
      checkpoint_status: {
        '0900': { status: 'SUCCEEDED', updated_at: '2026-08-25T01:05:00.000Z' },
      },
    },
  );
  assert.equal(sync.windows['0930'], 'pending');
  assert.equal(sync.windows['1030'], 'pending');
  assert.equal(sync.windows['1300'], 'pending');
});

test('canonical runtime state reconciles all six checkpoints and close learning lifecycle', () => {
  const checkpoint_status = Object.fromEntries(
    ['0900', '0930', '1030', '1300', '1410', '1430'].map((checkpoint) => [checkpoint, {
      status: 'SUCCEEDED',
      updated_at: `2026-08-25T06:${checkpoint.slice(2)}:00.000Z`,
      metadata: { required_core_complete: true, canonical_complete: true, snapshot_upserted_count: 3 },
    }]),
  );
  const sync = buildCanonicalIntradaySyncStatus({}, {
    trading_date: '2026-08-25',
    current_state: 'LEARNING_COMPLETED',
    checkpoint_status,
  }, {
    closeMarketReview: {
      report_date: '2026-08-25',
      verification_result: '未命中',
      actual_market_result: '小漲',
      taiex_change: 0.91,
      tsmc_change: 1.05,
      txf_change: 0.64,
      data_quality: '高可信',
      missing_data: [],
      updated_at: '2026-08-25T06:35:00.000Z',
    },
    closingDecisionSnapshot: { status: 'FINAL' },
    learningRun: { status: 'succeeded' },
  });

  assert.deepEqual(Object.keys(sync.windows).sort(), ['0900', '0930', '1030', '1300', '1410', '1430']);
  assert.equal(sync.windows['1430'].evidence.source, 'close_market_review');
  assert.equal(sync.closing_verification_status, 'completed');
  assert.equal(sync.continuous_learning_status, 'completed');
  assert.equal(sync.lifecycle_complete, true);
});

test('false core completeness cannot masquerade as a successful close checkpoint', () => {
  const sync = buildCanonicalIntradaySyncStatus({ windows: { '1410': 'pending' } }, {
    trading_date: '2026-08-25',
    checkpoint_status: {
      '1410': {
        status: 'SUCCEEDED',
        metadata: { required_core_complete: false, canonical_complete: false, snapshot_upserted_count: 0 },
      },
    },
  });
  assert.equal(sync.windows['1410'].status, 'insufficient');
  assert.equal(sync.windows['1410'].evidence.reason, 'required_core_incomplete');
  assert.equal(sync.lifecycle_complete, false);
});

function confirmedNarrative() {
  return {
    decision_evidence: {
      status: 'Confirmed',
      reason: '盤中驗證節點、驗證清單與市場快照均已到位。',
      completedCheckpoints: 1,
      totalCheckpoints: 3,
      checklistAvailable: true,
      marketSnapshotAvailable: true,
      runtimeFailure: false,
      closingVerified: false,
    },
    decision_lifecycle: {
      question: { question: '今日劇本是否成立？' },
      current_thesis: { title: '今日劇本', summary: '等待驗證' },
      decision_status: { status: 'Confirmed', reason: '盤中證據已到位', next_step: '10:30 主線確認' },
      validation_plan: { next_step: '10:30 主線確認', steps: [] },
      failure_condition: { trigger: '', meaning: '', action: '' },
    },
    today_focus: { headline: '今日劇本', summary: '等待驗證', why: '', action: '' },
    intraday_progress: { current_step: '', next_step: '' },
    today_script: { current_step: '' },
    failure_triggers: [],
  };
}

function displayStateWithCanonicalDecision(action, decisionMode) {
  return {
    is_trading_day: true,
    market_status: 'OPEN',
    dataStatus: 'partial',
    reportDate: '2026-08-25',
    currentDate: '2026-08-25',
    market_message: '今天正常交易。',
    rawAI: {
      report_date: '2026-08-25',
      revision_id: 'synthetic-runtime-revision',
      generated_at: '2026-08-24T23:30:00Z',
      content_publish_gate: { overall_status: 'eligible' },
      canonical_decision: {
        id: 'synthetic-runtime-revision',
        status: 'READY',
        action,
        decision_mode: decisionMode,
      },
    },
  };
}

test('completed runtime evidence cannot promote canonical no-trade WAIT into ACT', () => {
  const presentation = buildDecisionPresentation({
    displayState: displayStateWithCanonicalDecision('WAIT', 'no_trade'),
    narrative: confirmedNarrative(),
  });
  assert.equal(presentation.primaryDecision.state, 'WAIT');
  assert.equal(presentation.primaryDecision.instruction, '現在不要追價');
  const unpublished = displayStateWithCanonicalDecision('WAIT', 'no_trade');
  unpublished.rawAI.content_publish_gate.overall_status = 'blocked';
  assert.equal(buildDecisionPresentation({ displayState: unpublished, narrative: confirmedNarrative() }).primaryDecision.state, 'INSUFFICIENT_DATA');
});

test('completed runtime evidence may confirm published ACT; legacy SELECTIVE cannot impersonate ACT', () => {
  const presentation = buildDecisionPresentation({
    displayState: displayStateWithCanonicalDecision('ACT', 'recommendations'),
    narrative: confirmedNarrative(),
  });
  assert.equal(presentation.primaryDecision.state, 'ACT');
  assert.equal(buildDecisionPresentation({ displayState: displayStateWithCanonicalDecision('SELECTIVE', 'recommendations'), narrative: confirmedNarrative() }).primaryDecision.state, 'INSUFFICIENT_DATA');
});

test('a verified closing outcome is COMPLETED, neither missing data nor a new entry signal', () => {
  const displayState = displayStateWithCanonicalDecision('ACT', 'recommendations');
  const close = {
    status: 'completed', data_status: 'complete', report_date: '2026-08-25',
    opening_decision_snapshot_id: 'synthetic-runtime-revision', verified_at: '2026-08-25T06:30:00Z',
    prediction_result: 'hit', actual_taiex_change: 0.8,
    actual_2330_close: { change_percent: 1.2 }, actual_txf_close: { change_percent: 0.7 }, missing_data: [],
  };
  const narrative = confirmedNarrative();
  narrative.decision_evidence.status = 'Completed';
  narrative.decision_evidence.closingVerified = true;
  narrative.decision_evidence.checklistAvailable = false;
  narrative.decision_lifecycle.decision_status.status = 'Completed';
  assert.notEqual(buildDecisionPresentation({ displayState, narrative }).primaryDecision.state, 'COMPLETED', 'a narrative completion flag cannot substitute for the canonical closing receipt');
  displayState.rawAI.closing_verification_v2 = close;
  const presentation = buildDecisionPresentation({ displayState, narrative });
  assert.equal(presentation.primaryDecision.state, 'COMPLETED');
  assert.match(presentation.primaryDecision.instruction, /收盤驗證/);
  for (const page of ['home/page.tsx', 'report/TodayReport.tsx']) {
    const source = readFileSync(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /今日(?:進場)?條件未成立.*收盤驗證已完成/);
  }
  // A completed no-trade day is a historical result, never a new ACT entry signal.
  const noTrade = displayStateWithCanonicalDecision('WAIT', 'no_trade');
  noTrade.rawAI.closing_verification_v2 = close;
  assert.equal(buildDecisionPresentation({ displayState: noTrade, narrative }).primaryDecision.state, 'COMPLETED');
  narrative.decision_evidence.status = 'Rejected';
  narrative.decision_evidence.runtimeFailure = true;
  narrative.decision_lifecycle.decision_status.status = 'Rejected';
  const noFailureReceipt = displayStateWithCanonicalDecision('ACT', 'recommendations');
  assert.notEqual(buildDecisionPresentation({ displayState: noFailureReceipt, narrative }).primaryDecision.state, 'STOP', 'a narrative rejection flag cannot substitute for runtime failure evidence');
  displayState.rawAI.closing_verification_v2 = { ...close, prediction_result: 'miss' };
  assert.equal(buildDecisionPresentation({ displayState, narrative }).primaryDecision.state, 'STOP');
});

test('canonical member string conditions and stock fields survive presentation without fabricated evidence', () => {
  const confirmation = '09:30 台積電與台指期需同步，電子權值需有量價承接。';
  const invalidation = '台積電相對大盤轉弱時取消觀察。';
  const reason = '公司公開來源支持先進封裝需求，但仍需盤中確認。';
  const narrative = buildCanonicalNarrative({ ai: {
    ...displayStateWithCanonicalDecision('WAIT', 'no_trade').rawAI,
    member_research_note_v2: {
      canonical_contract: { validation_checkpoint: '09:30' },
      intraday_validation: [confirmation], invalidation_conditions: [invalidation],
    },
  } });
  assert.equal(narrative.today_script.steps[0].detail, confirmation);
  assert.equal(narrative.today_script.steps[0].time, '09:30');
  assert.equal(narrative.today_script.steps[0].status, 'pending');
  assert.equal(narrative.decision_evidence.status, 'Waiting');
  assert.equal(narrative.failure_triggers[0].trigger, invalidation);
  const today = readFileSync(new URL('../src/pages/report/TodayReport.tsx', import.meta.url), 'utf8');
  assert.match(today, /const activeFailure = projection\.marketDecision\.action === 'STOP'\s*&& canonicalNarrative\.decision_evidence\.runtimeFailure/);
  assert.match(today, /getSubscriberReportProjection\(/);
  assert.match(today, /trigger: canonicalNarrative\.decision_evidence\.reason/);
  const [stock] = dedupePresentedOpportunities([{ symbol: '2330', name: '台積電', transmission_logic: reason,
    confirmation_condition: confirmation, invalidation_condition: invalidation }]);
  assert.equal(stock.oneLineReason, reason);
  assert.equal(stock.confirmation, confirmation);
  assert.equal(stock.invalidation, invalidation);
  const unpublished = buildCanonicalNarrative({ displayState: null, ai: {
    member_research_note_v2: { intraday_validation: [confirmation], invalidation_conditions: [invalidation] },
  } });
  assert.deepEqual(unpublished.today_script.steps, []);
  assert.deepEqual(unpublished.failure_triggers, []);
  assert.equal(unpublished.decision_evidence.status, 'Waiting');
});

test('complete runtime evidence never exposes a generic data-insufficient change trigger', () => {
  const narrative = buildCanonicalNarrative({
    displayState: null,
    ai: {
      ...displayStateWithCanonicalDecision('WAIT', 'no_trade').rawAI,
      primary_driver: '金融止跌確認',
      market_story: '盤中維持原本不追價判斷。',
      taiwan_transmission: '金融未形成相對強勢。',
      action_guidance: '維持觀察，不新增部位。',
      member_research_note_v2: {
        opening_thesis: { risk: '資料不足' },
        intraday_time_windows: [
          { time: '09:30', title: '開盤驗證', what_to_watch: '金融能否相對大盤止跌' },
        ],
      },
      intraday_sync_status: {
        windows: {
          '0930': {
            status: 'completed',
            report_date: '2026-08-25',
            revision_id: 'synthetic-runtime-revision',
            completed_at: '2026-08-25T01:35:12.422Z',
            evidence: { source: 'trading_day_state' },
          },
        },
      },
      market_data_snapshots: [
        { symbol: 'TAIEX', value: 24000, change_percent: -0.9 },
        { symbol: 'TXF', value: 23950, change_percent: -0.8 },
        { symbol: '2330', value: 1190, change_percent: -0.6 },
      ],
    },
  });

  assert.equal(narrative.decision_evidence.status, 'Confirmed');
  assert.doesNotMatch(narrative.decision_evidence.reason, /Runtime checkpoint/i);
  assert.match(narrative.decision_evidence.reason, /盤中驗證節點/);
  assert.equal(
    narrative.decision_lifecycle.failure_condition.trigger,
    '盤中出現足以推翻早上判斷的新訊號',
  );
});
