import {
  buildDecisionRuntimeEvidence,
  canPresentConfirmedDecision,
  canPresentRejectedDecision,
} from '../src/lib/decisionEvidence.ts';
import { buildDecisionPresentation } from '../src/lib/decisionPresentation.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const completeSnapshots = [
  { symbol: 'TAIEX', value: 23456, change_percent: 0.4 },
  { symbol: '2330', value: 1080, change_percent: 0.7 },
  { symbol: 'TXF', value: 23420, change_percent: 0.3 },
];

function completedCheckpoint() {
  return {
    intraday_sync_status: {
      windows: {
        '0930': {
          status: 'completed',
          completed_at: '2026-07-15T01:31:00.000Z',
          evidence: { source: 'runtime' },
        },
      },
    },
    market_data_snapshots: completeSnapshots,
  };
}

Deno.test('structured runtime evidence can confirm a decision', () => {
  const evidence = buildDecisionRuntimeEvidence({
    ai: completedCheckpoint(),
    checklistItemCount: 2,
  });
  assert(evidence.status === 'Confirmed', 'expected Confirmed');
  assert(canPresentConfirmedDecision(evidence), 'confirmed decision must pass presentation guard');
});

Deno.test('missing checkpoint stays Waiting', () => {
  const evidence = buildDecisionRuntimeEvidence({
    ai: { market_data_snapshots: completeSnapshots },
    checklistItemCount: 2,
  });
  assert(evidence.status === 'Waiting', 'expected Waiting');
  assert(!canPresentConfirmedDecision(evidence), 'waiting decision must not present ACT');
});

Deno.test('runtime failure evidence can reject a decision', () => {
  const evidence = buildDecisionRuntimeEvidence({
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
      market_data_snapshots: completeSnapshots,
    },
    checklistItemCount: 2,
  });
  assert(evidence.status === 'Rejected', 'expected Rejected');
  assert(canPresentRejectedDecision(evidence), 'rejected decision must pass STOP guard');
});

Deno.test('missing market snapshot presents INSUFFICIENT_DATA', () => {
  const evidence = buildDecisionRuntimeEvidence({
    ai: {},
    checklistItemCount: 2,
  });
  const presentation = buildDecisionPresentation({
    displayState: {
      is_trading_day: true,
      market_status: 'OPEN',
      dataStatus: 'sufficient',
      reportDate: '2026-07-15',
      currentDate: '2026-07-15',
      market_message: '今天正常交易。',
    },
    narrative: {
      decision_evidence: evidence,
      decision_lifecycle: {
        question: { question: '今日劇本是否成立？' },
        current_thesis: { title: '今日劇本', summary: '等待驗證' },
        decision_status: { status: evidence.status, reason: evidence.reason, next_step: '' },
        validation_plan: { next_step: '', steps: [] },
        failure_condition: { trigger: '', meaning: '', action: '' },
      },
      today_focus: { headline: '今日劇本', summary: '等待驗證', why: '', action: '' },
      intraday_progress: { current_step: '', next_step: '' },
      today_script: { current_step: '' },
      failure_triggers: [],
    },
  } as unknown as Parameters<typeof buildDecisionPresentation>[0]);
  assert(presentation.primaryDecision.state === 'INSUFFICIENT_DATA', 'missing snapshot must fail closed');
});

Deno.test('unrecognized natural language cannot upgrade decision state', () => {
  const evidence = buildDecisionRuntimeEvidence({
    ai: {
      summary: 'ready 偏強 成立 確認 失效 跌破 停止',
      market_data_snapshots: completeSnapshots,
    },
    checklistItemCount: 2,
  });
  assert(evidence.status === 'Waiting', 'natural language must not change runtime state');
  assert(!canPresentConfirmedDecision(evidence), 'natural language must not present ACT');
  assert(!canPresentRejectedDecision(evidence), 'natural language must not present STOP');
});
