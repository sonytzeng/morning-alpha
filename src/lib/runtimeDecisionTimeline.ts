import { getRuntimeCheckpointState } from './decisionEvidence.ts';

export type RuntimeTimelineStatus = 'completed' | 'current' | 'pending' | 'insufficient' | 'paused';

export interface RuntimeTimelineNode {
  time: string;
  label: string;
  detail: string;
  status: RuntimeTimelineStatus;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function timelineStatus(value: ReturnType<typeof getRuntimeCheckpointState>): 'completed' | 'pending' | 'insufficient' {
  if (value === 'completed') return 'completed';
  if (value === 'failed' || value === 'insufficient') return 'insufficient';
  return 'pending';
}

function closingCompleted(ai: UnknownRecord): boolean {
  const v2 = record(ai.closing_verification_v2);
  const closing = Object.keys(v2).length > 0 ? v2 : record(ai.closing_verification);
  const status = String(closing.status ?? closing.data_status ?? '').trim().toLowerCase();
  const hasResult = Boolean(closing.hit_or_miss || closing.prediction_result || closing.actual_direction || closing.verification_note);
  return ['completed', 'complete', 'ready', 'done'].includes(status) && hasResult;
}

function openingCompleted(ai: UnknownRecord): boolean {
  const radar = record(ai.opening_radar);
  return Boolean(radar.report_date || radar.captured_at || radar.updated_at)
    && [radar.taiex_change, radar.txf_change, radar.tsmc_change]
      .filter((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))).length === 3;
}

export function buildRuntimeDecisionTimeline(params: {
  ai?: UnknownRecord | null;
  hasReport: boolean;
  reportRevisionId?: string | null;
  reportGeneratedAt?: string | null;
  isTradingDay: boolean;
}): RuntimeTimelineNode[] {
  const ai = record(params.ai);
  const sync = record(ai.intraday_sync_status);
  const rawNodes: RuntimeTimelineNode[] = [
    {
      time: '07:30',
      label: '今日劇本',
      detail: '盤前決策報告',
      status: params.hasReport && Boolean(params.reportRevisionId || params.reportGeneratedAt) ? 'completed' : 'pending',
    },
    {
      time: '09:30',
      label: '開盤驗證',
      detail: '第一個 Runtime checkpoint',
      status: openingCompleted(ai)
        ? 'completed'
        : timelineStatus(getRuntimeCheckpointState(sync, '0930')),
    },
    {
      time: '10:30',
      label: '主線確認',
      detail: '確認主線與資金是否同步',
      status: timelineStatus(getRuntimeCheckpointState(sync, '1030')),
    },
    {
      time: '13:30',
      label: '盤中追蹤',
      detail: '讀取午後 Runtime checkpoint',
      status: timelineStatus(getRuntimeCheckpointState(sync, '1300')),
    },
    {
      time: '14:10',
      label: '收盤驗證',
      detail: '讀取結構化收盤驗證',
      status: closingCompleted(ai) ? 'completed' : 'pending',
    },
  ];

  if (!params.isTradingDay) return rawNodes.map((node) => ({ ...node, status: 'paused' }));

  const firstBlockingNode = rawNodes.findIndex((node) => node.status !== 'completed');
  return rawNodes.map((node, index) => ({
    ...node,
    status: index === firstBlockingNode && node.status === 'pending' ? 'current' : node.status,
  }));
}
