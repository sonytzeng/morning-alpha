/** Research-only contracts. Not imported by a Production decision or sender. */
export const VNEXT_VERSION = 'VNEXT_RESEARCH_1.0.0';
export const FROZEN_V1_REF = '568694f92072d049e35cd2d8fd148db6d3547154';
export const HORIZONS = {
  SHORT: { label: '短期觀察', duration: '1～10 個交易日', outcomes: [1, 5, 10], required: ['PRICE_VOLUME', 'INSTITUTIONAL', 'NEWS', 'TECHNICAL_STRUCTURE'] },
  MEDIUM: { label: '中期觀察', duration: '2～12 週', outcomes: [20, 40, 60], required: ['REVENUE', 'ORDERS', 'GUIDANCE', 'INSTITUTIONAL', 'INDUSTRY_EVENT'] },
  LONG: { label: '長期觀察', duration: '3～18 個月', outcomes: [120, 180, 250], required: ['DEMAND', 'MOAT', 'SUPPLY_CHAIN', 'EPS', 'MARGIN', 'CAPEX', 'VALUATION'] },
} as const;
export type Horizon = keyof typeof HORIZONS;
export type EvidenceKind = typeof HORIZONS[Horizon]['required'][number];
export type ClaimClass = 'CONFIRMED_FACT' | 'REPORTED_CLAIM' | 'INFERENCE' | 'UNVERIFIED';
export type ObservationState = 'WATCHING' | 'CONDITION_MET' | 'INVALIDATED' | 'EXPIRED';
export type License = {
  id: string; source: string; document_url: string; reviewed_at: string;
  storage: boolean; derived: boolean; commercial: boolean; redistribution: boolean;
  attribution: string; expires_at: string | null;
};
export type Evidence = {
  id: string; source: string; source_ref: string; symbol: string; kind: EvidenceKind;
  published_at: string; first_seen_at: string; available_at: string; as_of: string;
  last_verified_at: string; valid_until: string; snapshot_hash: string; license_id: string;
  quality: 'PASS' | 'INSUFFICIENT' | 'REJECTED'; relevant: boolean;
  classification: ClaimClass; summary: string;
};
export type EventRevision = {
  event_id: string; revision: number; source: string; source_event_id: string;
  published_at: string; first_seen_at: string; available_at: string; last_verified_at: string;
  title: string; evidence_ids: string[]; affected_companies: string[];
  expected_horizons: Horizon[]; invalidation: string; classification: ClaimClass;
  snapshot_hash: string;
};
export type SupplyRelation = {
  id: string; from: string; to: string; type: 'CUSTOMER' | 'SUPPLIER' | 'COMPETITOR' | 'PRODUCT' | 'INDUSTRY';
  source: string; evidence_ids: string[]; valid_from: string; valid_to: string | null;
  observed_at: string; available_at: string; confidence: 'DOCUMENTED' | 'CLAIMED' | 'UNKNOWN';
  revenue_exposure: number | null; verification_status: 'VERIFIED' | 'UNVERIFIED';
};
export type Condition = { text: string; state: 'CONFIRMED' | 'NOT_MET' | 'UNKNOWN'; evidence_ids: string[] };
export type Observation = {
  id: string; symbol: string; company: string; horizon: Horizon;
  created_at: string; as_of: string; available_at: string; last_verified_at: string; next_review_at: string;
  expires_at: string; reason: string; evidence_ids: string[]; confirmation_conditions: Condition[];
  invalidation_conditions: Condition[]; strategy_version: string;
  mode: 'HISTORICAL_REPLAY' | 'FORWARD_SHADOW'; snapshot_hash: string;
  publication_status: 'RESEARCH_ONLY' | 'REVIEW_REQUIRED' | 'APPROVED';
};
export type Projection = {
  id: string; symbol: string; company: string; horizon: Horizon; status: ObservationState;
  mode: Observation['mode']; created_at: string; as_of: string;
  reason: string; confirmation: string[]; invalidation: string[]; next_review_at: string;
  evidence: { summary: string; source: string; source_ref: string; available_at: string; classification: ClaimClass }[];
};
export function validTime(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|[+-](\d\d):(\d\d))$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60
    && Number(match[7] ?? 0) < 24 && Number(match[8] ?? 0) < 60 && Number.isFinite(Date.parse(value));
}
export const hashValid = (value: string) => /^[a-f0-9]{64}$/.test(value);
export function sourceSafe(value: string): boolean {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash
    && ![...u.searchParams.keys()].some(k => /token|secret|key|auth|email/i.test(k)); } catch { return false; }
}
function stable(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as Record<string, unknown>)[k])).join(',') + '}';
  throw Error('NON_CANONICAL_VALUE');
}
export async function snapshotHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stable(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
