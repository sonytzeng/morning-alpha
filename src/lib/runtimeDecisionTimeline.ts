import { getTaipeiNow } from '../utils/tradingDay.ts';
import { getSubscriberReportProjection, type SubscriberCheckpoint, type SubscriberReportProjection } from './subscriberReportContract.ts';

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
): Array<Omit<T, 'status'> & { status: RuntimeTimelineStatus }> {
  let lastResolvedIndex = -1;
  nodes.forEach((node, index) => {
    if (node.status === 'completed' || node.status === 'insufficient') lastResolvedIndex = index;
  });

  const reconciled: Array<Omit<T, 'status'> & { status: RuntimeTimelineStatus }> = nodes.map((node, index) => ({
    ...node,
    status: node.status === 'pending' && index < lastResolvedIndex
      ? 'insufficient' as const
      : node.status,
  }));
  const elapsedPendingIndexes = reconciled.reduce<number[]>((indexes, node, index) => {
    const scheduledMinutes = checkpointMinutes(node.time);
    if (node.status === 'pending' && scheduledMinutes !== null && scheduledMinutes <= taipeiMinutes) indexes.push(index);
    return indexes;
  }, []);
  const activeIndex = elapsedPendingIndexes[elapsedPendingIndexes.length - 1] ?? -1;
  elapsedPendingIndexes.slice(0, -1).forEach((index) => { reconciled[index].status = 'insufficient'; });
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
    || [...nodes].reverse().find((node) => node.status === 'completed')
    || [...nodes].reverse().find((node) => node.status === 'insufficient')
    || nodes[nodes.length - 1];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function timelineStatus(value: SubscriberCheckpoint['status']): 'completed' | 'pending' | 'insufficient' | 'not_applicable' {
  if (value === 'completed') return 'completed';
  if (value === 'failed' || value === 'insufficient') return 'insufficient';
  if (value === 'not_applicable') return 'not_applicable';
  return 'pending';
}

export function buildRuntimeDecisionTimeline(params: {
  /** Active subscribers pass their already-resolved projection. Full envelopes
   * are also accepted; nested AI is retained only for legacy call compatibility. */
  projection?: SubscriberReportProjection;
  report?: unknown;
  ai?: UnknownRecord | null;
  hasReport: boolean;
  reportRevisionId?: string | null;
  reportGeneratedAt?: string | null;
  isTradingDay: boolean;
  taipeiMinutes?: number;
}): RuntimeTimelineNode[] {
  const ai = record(params.ai);
  const projection = params.projection ?? (params.report !== undefined
    ? getSubscriberReportProjection(params.report) : getSubscriberReportProjection(ai));
  const checkpoints = projection.runtime.checkpoints;
  const rawNodes: RuntimeTimelineNode[] = [
    {
      time: '07:30',
      label: '今日劇本',
      detail: '盤前決策報告',
      status: projection.analysisAvailable ? 'completed' : 'insufficient',
    },
    {
      time: '09:00',
      label: '開盤資料',
      detail: '第一筆台股核心資料',
      status: timelineStatus(checkpoints['0900'].status),
    },
    {
      time: '09:30',
      label: '開盤驗證',
      detail: '確認開盤方向與盤前劇本',
      status: timelineStatus(checkpoints['0930'].status),
    },
    {
      time: '10:30',
      label: '主線確認',
      detail: '確認主線與資金是否同步',
      status: timelineStatus(checkpoints['1030'].status),
    },
    {
      time: '13:00',
      label: '盤中追蹤',
      detail: '讀取午後盤中資料',
      status: timelineStatus(checkpoints['1300'].status),
    },
    {
      time: '14:10',
      label: '收盤資料',
      detail: '確認現貨與期貨正式終值',
      status: timelineStatus(checkpoints['1410'].status),
    },
    {
      time: '14:30',
      label: '收盤驗證',
      detail: '讀取結構化收盤驗證',
      status: timelineStatus(checkpoints['1430'].status),
    },
  ];

  if (!params.isTradingDay || projection.closing.state === 'NOT_APPLICABLE') return rawNodes.map((node) => ({ ...node, status: 'not_applicable' }));

  const reconciled = reconcileRuntimeTimeline(rawNodes, params.taipeiMinutes);
  // A declared NOT_DUE close is not advanced by browser clock or a fetched raw
  // 14:30 snapshot. Data capture and verification completion are distinct.
  if (projection.closing.state === 'NOT_DUE') reconciled[reconciled.length - 1].status = 'pending';
  return reconciled;
}
