// Owner presentation only; no strategy execution or write client.
export interface AnalysisSignal {
  signal_id: string; provider: string; label: string; status: string; direction: string | null;
  strength: number | null; confidence: number | null; evidence_ids: string[]; feature_ids: string[];
}
export interface AnalysisFeature {
  feature_id: string; feature_version: number; source_evidence_id: string; source_instrument: string;
  observed_at: string; value: number | null; quality: string; normalization: string;
}
export interface IntelligenceAnalysis {
  schema_version: 'ANALYSIS_INTELLIGENCE_V1'; mode: 'SHADOW_ONLY'; production_eligible: false;
  business_date: string; analysis_cutoff_at: string; observation_kind: string; report_level: string;
  signals: AnalysisSignal[]; features: AnalysisFeature[];
  cross_signals: { signal_id: string; label: string; status: string; direction: string | null; constituent_signal_ids: string[] }[];
  supporting_signals: string[]; contradicting_signals: string[]; signal_conflict_score: number; missing_signals: string[];
  decision: { shadow_regime: string; shadow_direction: string; shadow_risk: string; shadow_action: string; shadow_confidence: number;
    confidence_kind: string; confidence_components: Record<string, number> };
  quality: { evidence_coverage: number; signal_coverage: number; traceability: number; contradiction_coverage: number; change_detection: string };
  what_changed: { key: string; type: string; meaning: string; previous_business_date: string | null }[];
  invalidation_conditions: { invalidation_id: string; description: string; status: string }[];
  production_comparison: { market_regime: string; direction: string; action: string; confidence: number } | null;
}
export interface OwnerAnalysis {
  schema_version: 'OWNER_ANALYSIS_V1'; mode: 'SHADOW_ONLY'; production_eligible: false;
  forward_sample: number; analysis_value: 'INSUFFICIENT_SAMPLE';
  latest: { id: string; analysis: IntelligenceAnalysis; created_at: string; compute_ms: number } | null;
  invalidations?: { invalidation_id: string; status: string; observed_at: string }[] | null;
}
const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
export function readOwnerAnalysis(value: unknown): OwnerAnalysis {
  const x = object(value), latest = object(x.latest), a = object(latest.analysis);
  if (x.schema_version !== 'OWNER_ANALYSIS_V1' || x.mode !== 'SHADOW_ONLY' || x.production_eligible !== false
    || x.analysis_value !== 'INSUFFICIENT_SAMPLE' || !Number.isInteger(x.forward_sample) || Number(x.forward_sample) < 0) throw Error('OWNER_ANALYSIS_CONTRACT');
  if (x.latest !== null) {
    if (a.schema_version !== 'ANALYSIS_INTELLIGENCE_V1' || a.mode !== 'SHADOW_ONLY' || a.production_eligible !== false
      || typeof a.business_date !== 'string' || typeof a.analysis_cutoff_at !== 'string'
      || !['HISTORICAL_REPLAY', 'FORWARD'].includes(String(a.observation_kind))) throw Error('ANALYSIS_ISOLATION_CONTRACT');
    for (const key of ['signals','features','cross_signals','supporting_signals','contradicting_signals','missing_signals','what_changed','invalidation_conditions']) {
      if (!Array.isArray(a[key])) throw Error('ANALYSIS_ARRAY_CONTRACT');
    }
    if (!Number.isFinite(a.signal_conflict_score) || !Number.isFinite(object(a.decision).shadow_confidence)
      || object(a.decision).confidence_kind !== 'EVIDENCE_CONFIDENCE_UNCALIBRATED') throw Error('ANALYSIS_CONFIDENCE_CONTRACT');
    for (const key of ['evidence_coverage', 'signal_coverage', 'traceability', 'contradiction_coverage']) {
      if (!Number.isFinite(object(a.quality)[key])) throw Error('ANALYSIS_QUALITY_CONTRACT');
    }
    for (const s of a.signals as unknown[]) {
      const row = object(s);
      if (typeof row.label !== 'string' || typeof row.signal_id !== 'string' || !Array.isArray(row.feature_ids)
        || !Array.isArray(row.evidence_ids) || !['AVAILABLE','UNAVAILABLE'].includes(String(row.status))) throw Error('ANALYSIS_SIGNAL_CONTRACT');
    }
    for (const f of a.features as unknown[]) {
      const row = object(f);
      if (typeof row.feature_id !== 'string' || typeof row.normalization !== 'string'
        || (row.value !== null && !Number.isFinite(row.value))) throw Error('ANALYSIS_FEATURE_CONTRACT');
    }
  }
  if (x.invalidations != null && (!Array.isArray(x.invalidations) || x.invalidations.some(item => {
    const row = object(item);
    return typeof row.invalidation_id !== 'string' || !['TRIGGERED', 'NOT_TRIGGERED', 'UNAVAILABLE'].includes(String(row.status));
  }))) throw Error('ANALYSIS_INVALIDATION_CONTRACT');
  return x as unknown as OwnerAnalysis;
}
export const analysisLabel = (value: string | null) => ({ BULLISH:'偏多', BEARISH:'偏空', NEUTRAL:'中性',
  risk_on:'風險偏好', risk_off:'風險趨避', range:'震盪／盤整', HIGH:'高', ELEVATED:'偏高', NORMAL:'一般',
  ENTER:'進場條件成立（僅研究）', WAIT:'等待確認', AVOID:'避開風險', AVAILABLE:'可用', UNAVAILABLE:'資料不足',
  NOT_EVALUATED:'尚未取得後續觀測', TRIGGERED:'已觸發', NOT_TRIGGERED:'未觸發',
} as Record<string, string>)[value ?? ''] || value || '不可用';
