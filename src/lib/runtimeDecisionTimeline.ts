import { getRuntimeCheckpointState } from './decisionEvidence.ts';
import { getTaipeiNow } from '../utils/tradingDay.ts';

export type RuntimeTimelineStatus = 'completed' | 'current' | 'pending' | 'insufficient' | 'not_applicable';

export interface RuntimeTimelineNode {
  time: string;
  label: string;
  detail: string;
  status: RuntimeTimelineStatus;
}

function checkpointMinutes(value: string | undefined): number | null {
  const match = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null;
}

function currentTaipeiMinutes(): number {
  const now = getTaipeiNow();
  return now.getHours() * 60 + now.getMinutes();
}

export function reconcileRuntimeTimeline<T extends { status: RuntimeTimelineStatus; time?: string }>(
  nodes: T[],
  taipeiMinutes = currentTaipeiMinutes(),
): T[] {
  let lastCompletedIndex = -1;
  nodes.forEach((node, index) => {
    if (node.status === 'completed') lastCompletedIndex = index;
  });

  const reconciled = nodes.map((node, index) => ({
    ...node,
    status: node.status === 'pending' && index < lastCompletedIndex
      ? 'insufficient' as const
      : node.status,
  }));
  const activeIndex = reconciled.findIndex((node) => {
    const scheduledMinutes = checkpointMinutes(node.time);
    return node.status === 'pending' && scheduledMinutes !== null && scheduledMinutes <= taipeiMinutes;
  });
  if (activeIndex >= 0) reconciled[activeIndex].status = 'current';
  return reconciled;
}

export function runtimeTimelineStatusLabel(status: RuntimeTimelineStatus): string {
  if (status === 'completed') return '已完成';
  if (status === 'current') return '目前節點';
  if (status === 'insufficient') return '資料不足';
  if (status === 'not_applicable') return '本節點不適用';
  return '等待驗證';
}

export function selectNextRuntimeTimelineNode<T extends { status: RuntimeTimelineStatus }>(nodes: T[]): T | undefined {
  return nodes.find((node) => node.status === 'current')
    || nodes.find((node) => node.status === 'pending')
    || [...nodes].reverse().find((node) => node.status === 'insufficient')
    || nodes[nodes.length - 1];
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
  taipeiMinutes?: number;
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
      detail: '第一個盤中驗證節點',
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
      detail: '讀取午後盤中資料',
      status: timelineStatus(getRuntimeCheckpointState(sync, '1300')),
    },
    {
      time: '14:10',
      label: '收盤驗證',
      detail: '讀取結構化收盤驗證',
      status: closingCompleted(ai) ? 'completed' : 'pending',
    },
  ];

  if (!params.isTradingDay) return rawNodes.map((node) => ({ ...node, status: 'not_applicable' }));

  return reconcileRuntimeTimeline(rawNodes, params.taipeiMinutes);
}
