import { getRuntimeCheckpointState } from '@/lib/decisionEvidence';
import {
  runtimeTimelineStatusLabel,
  type RuntimeTimelineStatus,
} from '@/lib/runtimeDecisionTimeline';

type UnknownRecord = Record<string, unknown>;

export type WarRoomClosingLabel = '今日已驗證' | '部分成立' | '已失效' | '資料不足';
export type WarRoomObservationTone = 'role' | 'completed' | 'partial' | 'failed' | 'insufficient';
export type WarRoomTimelineStatus = RuntimeTimelineStatus;

export interface WarRoomObservationCard {
  key: string;
  symbol: string;
  name: string;
  status: string;
  statusTone: WarRoomObservationTone;
  roles: string[];
  validations: string[];
  stopConditions: string[];
  evidence: string[];
  detailLabel: '下一確認' | '今日結果';
  next: string;
  stop: string;
}

export interface WarRoomTimelineItem {
  time: string;
  label: string;
  status: WarRoomTimelineStatus;
  statusLabel: string;
}

export interface WarRoomClosingState {
  isPostClose: boolean;
  label: WarRoomClosingLabel;
}

interface BuildWarRoomObservationCardsInput {
  sources: UnknownRecord[];
  closingVerificationV2?: UnknownRecord | null;
  publicClosingVerification?: UnknownRecord | null;
  todayCloseVerification?: unknown;
  fallbackNext?: string;
  fallbackStop?: string;
  limit?: number;
}

interface BuildWarRoomTimelineInput {
  intradaySyncStatus?: UnknownRecord | null;
  openingRadar?: UnknownRecord | null;
  closingVerificationV2?: UnknownRecord | null;
  publicClosingVerification?: UnknownRecord | null;
  todayCloseVerification?: unknown;
  isTradingDay: boolean;
}

const STATUS_KEYS = ['role_title', 'role_label', 'role', 'status', 'signal_label'] as const;
const VALIDATION_KEYS = [
  'validation_point',
  'confirmation_reason',
  'confirmation_pending_reason',
  'confirmation',
  'validation_signal',
  'watch_point',
] as const;
const STOP_KEYS = [
  'stop_condition',
  'stop_observing_condition',
  'invalidation',
  'invalidation_condition',
  'risk_note',
] as const;
const EVIDENCE_KEYS = [
  'observation_reason',
  'narrative',
  'reason',
  'benefit_chain',
  'observation_chain',
  'confirmation_checklist',
  'risk_checklist',
  'evidence',
  'evidence_refs',
] as const;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function firstText(record: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return '';
}

function valuesFrom(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(valuesFrom);
  if (value && typeof value === 'object') {
    const record = asRecord(value);
    const output = firstText(record, ['label', 'title', 'text', 'note', 'reason', 'summary']);
    return output ? [output] : [];
  }
  const output = text(value);
  return output ? [output] : [];
}

function firstValues(record: UnknownRecord, keys: readonly string[]): string[] {
  for (const key of keys) {
    const values = valuesFrom(record[key]);
    if (values.length > 0) return values;
  }
  return [];
}

function valuesForKeys(record: UnknownRecord, keys: readonly string[]): string[] {
  return keys.flatMap((key) => valuesFrom(record[key]));
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function appendUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

export function normalizeWarRoomSymbol(value: unknown): string {
  const raw = text(value).toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  const withoutExchange = raw.replace(/^(?:TWSE|TPEX):/, '');
  return withoutExchange.replace(/\.(?:TW|TWO)$/, '');
}

function sourceSymbol(record: UnknownRecord): string {
  return normalizeWarRoomSymbol(
    record.symbol ?? record.stock_code ?? record.ticker ?? record.stock_id ?? record.code,
  );
}

function sourceName(record: UnknownRecord): string {
  return firstText(record, ['stock_name', 'name', 'company_name', 'symbol', 'stock_code']);
}

function humanRole(value: string): string {
  const normalized = value.trim();
  const upper = normalized.toUpperCase();
  if (upper === 'MAIN_THESIS') return '今日主線';
  if (upper === 'CONFIRMATION') return '確認條件';
  if (upper === 'RISK') return '風險觀察';
  if (upper === 'CAPITAL_NEXT') return '資金下一站';
  if (upper === 'EXTERNAL') return '外部變數';
  return normalized;
}

function closingRecord(input: {
  closingVerificationV2?: UnknownRecord | null;
  publicClosingVerification?: UnknownRecord | null;
  todayCloseVerification?: unknown;
}): UnknownRecord {
  const candidates = [
    input.closingVerificationV2,
    input.publicClosingVerification,
    input.todayCloseVerification,
  ];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

export function resolveWarRoomClosingLabel(recordValue: unknown): WarRoomClosingLabel {
  const record = asRecord(recordValue);
  const status = text(record.status ?? record.data_status).toLowerCase();
  const outcome = text(record.hit_or_miss ?? record.prediction_result ?? record.result).toLowerCase();
  if (['miss', 'wrong', 'failed', 'rejected', 'incorrect', 'invalidated'].includes(outcome)) return '已失效';
  if (['partial', 'mixed', 'partially_confirmed'].includes(outcome)) return '部分成立';
  if (['pending', 'pending_real_market_data', 'insufficient', 'missing', 'unknown', 'not_available'].includes(status)) return '資料不足';
  if (['degraded', 'direction_completed_data_degraded'].includes(status)) return '部分成立';
  const completed = ['completed', 'complete', 'ready', 'verified', 'done'].includes(status);
  if (completed && ['hit', 'correct', 'confirmed', 'success', 'accurate'].includes(outcome)) return '今日已驗證';
  if (completed && record.verification_result === true) return '今日已驗證';
  return '資料不足';
}

function individualClosingRows(close: UnknownRecord): UnknownRecord[] {
  const beneficiaryList = asRecord(close.beneficiary_list_validation);
  const rows = [
    ...asRecords(beneficiaryList.items),
    ...asRecords(close.stock_results),
    ...asRecords(close.beneficiary_results),
    ...asRecords(close.representative_stock_results),
  ];
  const firstBeneficiary = asRecord(close.first_beneficiary_validation);
  if (Object.keys(firstBeneficiary).length > 0) rows.push(firstBeneficiary);
  return rows;
}

function individualClosingIdentity(row: UnknownRecord): { symbol: string; name: string } {
  const nestedStock = asRecord(row.predicted_stock ?? row.stock);
  return {
    symbol: sourceSymbol(row) || sourceSymbol(nestedStock),
    name: (sourceName(row) || sourceName(nestedStock)).toLowerCase(),
  };
}

function resolveIndividualClosingLabel(
  close: UnknownRecord,
  item: { symbol: string; name: string },
): WarRoomClosingLabel {
  const itemSymbol = normalizeWarRoomSymbol(item.symbol);
  const itemName = item.name.trim().toLowerCase();
  const result = individualClosingRows(close).find((row) => {
    const identity = individualClosingIdentity(row);
    return (itemSymbol && identity.symbol === itemSymbol)
      || (itemName && identity.name === itemName);
  });
  if (!result) return '資料不足';

  const dataStatus = text(result.data_status).toLowerCase();
  if (/(?:missing|pending|insufficient|unknown|not_available)/.test(dataStatus)) return '資料不足';

  const explicitLabel = resolveWarRoomClosingLabel(result);
  if (explicitLabel !== '資料不足') return explicitLabel;
  if (result.matched_logic === true || result.outperformed_taiex === true) return '今日已驗證';
  if (result.matched_logic === false || result.outperformed_taiex === false) return '已失效';
  return '資料不足';
}

export function buildWarRoomClosingState(input: {
  closingVerificationV2?: UnknownRecord | null;
  publicClosingVerification?: UnknownRecord | null;
  todayCloseVerification?: unknown;
}): WarRoomClosingState {
  const close = closingRecord(input);
  return {
    isPostClose: Object.keys(close).length > 0,
    label: resolveWarRoomClosingLabel(close),
  };
}

function closingTone(label: WarRoomClosingLabel): WarRoomObservationTone {
  if (label === '今日已驗證') return 'completed';
  if (label === '部分成立') return 'partial';
  if (label === '已失效') return 'failed';
  return 'insufficient';
}

export function buildWarRoomObservationCards(
  input: BuildWarRoomObservationCardsInput,
): WarRoomObservationCard[] {
  const merged = new Map<string, {
    key: string;
    symbol: string;
    name: string;
    roles: string[];
    validations: string[];
    stopConditions: string[];
    evidence: string[];
  }>();

  for (const source of input.sources) {
    const record = asRecord(source);
    const symbol = sourceSymbol(record);
    const name = sourceName(record);
    if (!symbol && !name) continue;
    const key = symbol || `name:${name.toLowerCase()}`;
    const current = merged.get(key) || {
      key,
      symbol,
      name,
      roles: [],
      validations: [],
      stopConditions: [],
      evidence: [],
    };
    if (!current.symbol && symbol) current.symbol = symbol;
    if (!current.name && name) current.name = name;
    appendUnique(current.roles, unique(firstValues(record, STATUS_KEYS).map(humanRole)));
    appendUnique(current.validations, unique(firstValues(record, VALIDATION_KEYS)));
    appendUnique(current.stopConditions, unique(firstValues(record, STOP_KEYS)));
    appendUnique(current.evidence, unique(valuesForKeys(record, EVIDENCE_KEYS)));
    merged.set(key, current);
  }

  const close = closingRecord(input);
  const postClose = Object.keys(close).length > 0;

  return Array.from(merged.values()).slice(0, input.limit ?? 3).map((item) => {
    const roleStatus = item.roles[0] || '資料不足';
    const closeLabel = resolveIndividualClosingLabel(close, item);
    return {
      ...item,
      status: postClose ? closeLabel : roleStatus,
      statusTone: postClose ? closingTone(closeLabel) : 'role',
      detailLabel: postClose ? '今日結果' : '下一確認',
      next: postClose
        ? closeLabel
        : item.validations.join('；') || input.fallbackNext || '資料不足',
      stop: item.stopConditions.join('；') || input.fallbackStop || '資料不足',
    };
  });
}

export function buildWarRoomTimeline(input: BuildWarRoomTimelineInput): WarRoomTimelineItem[] {
  const sync = asRecord(input.intradaySyncStatus);
  const opening = asRecord(input.openingRadar);
  const openingReady = Boolean(opening.report_date || opening.captured_at || opening.updated_at)
    && [opening.taiex_change, opening.txf_change, opening.tsmc_change]
      .every((value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
  const close = closingRecord(input);
  const hasClose = Object.keys(close).length > 0;
  const closeLabel = resolveWarRoomClosingLabel(close);

  const nodes: WarRoomTimelineItem[] = [
    { time: '09:00', label: '盤前確認', status: openingReady ? 'completed' : 'pending', statusLabel: '' },
    { time: '09:30', label: '開盤驗證', status: getRuntimeCheckpointState(sync, '0930') === 'completed' ? 'completed' : getRuntimeCheckpointState(sync, '0930') === 'pending' ? 'pending' : 'insufficient', statusLabel: '' },
    { time: '10:30', label: '主線確認', status: getRuntimeCheckpointState(sync, '1030') === 'completed' ? 'completed' : getRuntimeCheckpointState(sync, '1030') === 'pending' ? 'pending' : 'insufficient', statusLabel: '' },
    { time: '13:30', label: '午後追蹤', status: getRuntimeCheckpointState(sync, '1300') === 'completed' ? 'completed' : getRuntimeCheckpointState(sync, '1300') === 'pending' ? 'pending' : 'insufficient', statusLabel: '' },
    {
      time: '14:10',
      label: '收盤驗證',
      status: hasClose ? (closeLabel === '資料不足' ? 'insufficient' : 'completed') : 'pending',
      statusLabel: '',
    },
  ];

  if (!input.isTradingDay) {
    return nodes.map((node) => ({
      ...node,
      status: 'not_applicable',
      statusLabel: runtimeTimelineStatusLabel('not_applicable'),
    }));
  }

  const activeIndex = nodes.findIndex((node) => node.status === 'pending');
  if (activeIndex >= 0) nodes[activeIndex].status = 'current';

  return nodes.map((node) => ({
    ...node,
    statusLabel: runtimeTimelineStatusLabel(node.status),
  }));
}
