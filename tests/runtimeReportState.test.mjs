import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCanonicalIntradaySyncStatus,
  preserveRuntimeReportOverlay,
} from '../supabase/functions/_shared/runtime-report-state.ts';
import { buildDecisionPresentation } from '../src/lib/decisionPresentation.ts';

const generatorSource = readFileSync(new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url), 'utf8');
const payloadSource = readFileSync(new URL('../supabase/functions/get-report-payload/index.ts', import.meta.url), 'utf8');

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
      canonical_decision: {
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
});

test('completed runtime evidence may confirm a canonical selective recommendation', () => {
  const presentation = buildDecisionPresentation({
    displayState: displayStateWithCanonicalDecision('SELECTIVE', 'recommendations'),
    narrative: confirmedNarrative(),
  });
  assert.equal(presentation.primaryDecision.state, 'ACT');
});
