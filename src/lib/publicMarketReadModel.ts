/** Shared read/export contract only. Kept in src for the frontend packager. */
export const PUBLIC_MARKET_MODEL_VERSION = 'CANONICAL_PUBLIC_MARKET_V1' as const;
export const PUBLIC_CHECKPOINTS = ['0900', '0930', '1030', '1300', '1410', '1430'] as const;
export const PUBLIC_REGIMES = { range: '震盪／盤整', trend_up: '多頭趨勢', trend_down: '空頭趨勢', risk_off: '風險退避', high_volatility: '高波動' } as const;
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown) => typeof v === 'string' ? v : '';
export type PublicMarketInput = {
  business_date: string; canonical_revision: string; decision_version: number;
  member_revision: string; member_version: number; member_snapshot_id: string; member_snapshot_version: number;
  market_regime: string; market_direction: string; action: string;
  generated_at: string; observed_at: string; publication_verified: boolean;
  report_level: 'FULL' | 'DEGRADED'; recommendation_status: 'READY' | 'NONE' | 'BLOCKED';
  batches: Row[]; proofs: Row[]; closing_status: 'PASS' | 'PENDING'; learning_status: 'PASS' | 'DEGRADED' | 'PENDING';
  closing_at: string | null; learning_at: string | null;
};
export type PublicMarketReadModel = {
  schema_version: typeof PUBLIC_MARKET_MODEL_VERSION;
  business_date: string; canonical_revision: string; decision_version: number;
  member_revision: string; member_version: number; projection_revision: string;
  market_regime: keyof typeof PUBLIC_REGIMES; market_direction: string; action: 'ACT' | 'WAIT' | 'STOP';
  report_status: 'PUBLISHED'; report_level: 'FULL' | 'DEGRADED'; recommendation_status: 'READY' | 'NONE' | 'BLOCKED';
  checkpoints: Record<string, { status: 'completed' | 'pending'; batch_id: string | null; observed_at: string | null; evidence_count: number }>;
  latest_completed_checkpoint: string; next_checkpoint: string; closing_status: PublicMarketInput['closing_status'];
  learning_status: PublicMarketInput['learning_status']; service_availability: 'AVAILABLE';
  evidence_completeness: { core: 11; intraday: number; completed_checkpoints: number };
  updated_at: string; generated_at: string;
};
export function buildPublicMarketReadModel(input: PublicMarketInput): PublicMarketReadModel | null {
  const i = input, observed = Date.parse(i.observed_at), generated = Date.parse(i.generated_at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.business_date) || !i.publication_verified || !i.canonical_revision
    || !Number.isInteger(i.decision_version) || i.decision_version < 1 || !i.member_revision || !Number.isInteger(i.member_version) || i.member_version < 1
    || i.member_snapshot_id !== i.canonical_revision || i.member_snapshot_version !== i.decision_version
    || !Object.hasOwn(PUBLIC_REGIMES, i.market_regime) || !i.market_direction || !['ACT','WAIT','STOP'].includes(i.action)
    || !Number.isFinite(observed) || !Number.isFinite(generated) || generated > observed
    || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(generated)) !== i.business_date) return null;
  const checkpoints: PublicMarketReadModel['checkpoints'] = {};
  const times = [i.generated_at]; let latest = 'PREMARKET'; let completed = 0;
  for (const key of ['PREMARKET', ...PUBLIC_CHECKPOINTS]) {
    const rows = i.batches.filter(b => b.checkpoint === key);
    if (rows.length > 1 || (key === 'PREMARKET' && rows.length !== 1)) return null;
    if (!rows.length) { checkpoints[key] = {status:'pending',batch_id:null,observed_at:null,evidence_count:0}; continue; }
    const b = rows[0], proofs = i.proofs.filter(p => p.checkpoint === key), p = proofs[0];
    if (proofs.length !== 1 || !p || p.status !== 'PASS' || p.contract !== 'MARKET_CHECKPOINT_ATOMICITY_V1'
      || b.status !== 'COMMITTED' || b.business_date !== i.business_date || p.business_date !== i.business_date
      || !str(b.batch_id) || p.batch_id !== b.batch_id || p.correlation_id !== b.correlation_id || p.payload_hash !== b.payload_hash
      || b.expected_provider_count !== 11 || b.committed_provider_count !== 11 || p.canonical_row_count !== 11
      || p.distinct_provider_count !== 11 || p.committed_batch_count !== 1 || p.distinct_batch_id_count !== 1
      || p.mixed_batch_revision_count !== 0 || p.duplicate_authoritative_provider_count !== 0
      || p.unbatched_row_count !== 0 || p.compatibility_mismatch_count !== 0
      || !Number.isFinite(Date.parse(str(b.committed_at))) || Date.parse(str(b.committed_at)) > observed
      || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(str(b.committed_at))) !== i.business_date) return null;
    checkpoints[key] = {status:'completed',batch_id:str(b.batch_id),observed_at:str(b.committed_at),evidence_count:11};
    times.push(str(b.committed_at)); if (key !== 'PREMARKET') { latest = key; completed++; }
  }
  for (const time of [i.closing_at,i.learning_at]) if (time) {
    if (!Number.isFinite(Date.parse(time)) || Date.parse(time)>observed || Date.parse(time)<generated) return null;
    times.push(time);
  }
  const next = PUBLIC_CHECKPOINTS.find(k => checkpoints[k].status !== 'completed')
    ?? (i.closing_status === 'PASS' ? 'DAY_COMPLETED' : 'CLOSING');
  const revision = [PUBLIC_MARKET_MODEL_VERSION,i.business_date,i.canonical_revision,i.decision_version,i.member_revision,i.member_version,
    ...['PREMARKET',...PUBLIC_CHECKPOINTS].map(k=>checkpoints[k].batch_id ?? '-'),i.closing_status,i.learning_status].join(':');
  return {schema_version:PUBLIC_MARKET_MODEL_VERSION,business_date:i.business_date,canonical_revision:i.canonical_revision,
    decision_version:i.decision_version,member_revision:i.member_revision,member_version:i.member_version,projection_revision:revision,
    market_regime:i.market_regime as keyof typeof PUBLIC_REGIMES,market_direction:i.market_direction,action:i.action as PublicMarketReadModel['action'],
    report_status:'PUBLISHED',report_level:i.report_level,recommendation_status:i.recommendation_status,checkpoints,
    latest_completed_checkpoint:latest,next_checkpoint:next,closing_status:i.closing_status,learning_status:i.learning_status,
    service_availability:'AVAILABLE',evidence_completeness:{core:11,intraday:completed*11,completed_checkpoints:completed},
    generated_at:i.generated_at,updated_at:times.sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)!};
}

/** Browser consumers cannot fall back to a conflicting/older revision. */
export function parsePublicMarketReadModel(value: unknown, identity: { report_date: unknown; revision_id: unknown; decision_version?: unknown; member_revision?: unknown }): PublicMarketReadModel | null {
  const m = obj(value), checkpoints = obj(m.checkpoints);
  if (m.schema_version !== PUBLIC_MARKET_MODEL_VERSION || m.business_date !== identity.report_date || m.canonical_revision !== identity.revision_id
    || identity.decision_version !== undefined && m.decision_version !== identity.decision_version
    || identity.member_revision !== undefined && m.member_revision !== identity.member_revision
    || !Object.hasOwn(PUBLIC_REGIMES,str(m.market_regime)) || !['ACT','WAIT','STOP'].includes(str(m.action))
    || !str(m.market_direction) || !str(m.member_revision) || !str(m.projection_revision)
    || !Number.isInteger(m.decision_version) || Number(m.decision_version)<1
    || !Number.isInteger(m.member_version) || Number(m.member_version)<1
    || !['READY','NONE','BLOCKED'].includes(str(m.recommendation_status))
    || !['PASS','PENDING'].includes(str(m.closing_status)) || !['PASS','DEGRADED','PENDING'].includes(str(m.learning_status))
    || m.service_availability !== 'AVAILABLE' || obj(m.evidence_completeness).core !== 11
    || !Number.isFinite(Date.parse(str(m.generated_at)))
    || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(str(m.generated_at))) !== m.business_date
    || !Number.isFinite(Date.parse(str(m.updated_at))) || Date.parse(str(m.updated_at))<Date.parse(str(m.generated_at))
    || m.report_status !== 'PUBLISHED' || !['FULL','DEGRADED'].includes(str(m.report_level))) return null;
  let count = 0, latest = 'PREMARKET';
  for (const key of ['PREMARKET',...PUBLIC_CHECKPOINTS]) {
    const c = obj(checkpoints[key]);
    if (c.status === 'completed') {
      if (c.evidence_count !== 11 || !str(c.batch_id) || !Number.isFinite(Date.parse(str(c.observed_at)))
        || Date.parse(str(c.observed_at))>Date.parse(str(m.updated_at))
        || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(str(c.observed_at))) !== m.business_date) return null;
      if(key !== 'PREMARKET') { count++; latest=key; }
    } else if (key === 'PREMARKET' || c.status !== 'pending' || c.evidence_count !== 0 || c.batch_id !== null || c.observed_at !== null) return null;
  }
  const expectedNext = PUBLIC_CHECKPOINTS.find(k=>obj(checkpoints[k]).status !== 'completed') ?? (m.closing_status === 'PASS' ? 'DAY_COMPLETED':'CLOSING');
  if (m.latest_completed_checkpoint !== latest || m.next_checkpoint !== expectedNext
    || obj(m.evidence_completeness).completed_checkpoints !== count || obj(m.evidence_completeness).intraday !== count*11) return null;
  const revision=[PUBLIC_MARKET_MODEL_VERSION,m.business_date,m.canonical_revision,m.decision_version,m.member_revision,m.member_version,
    ...['PREMARKET',...PUBLIC_CHECKPOINTS].map(k=>obj(checkpoints[k]).batch_id??'-'),m.closing_status,m.learning_status].join(':');
  if(m.projection_revision!==revision) return null;
  return m as PublicMarketReadModel;
}
