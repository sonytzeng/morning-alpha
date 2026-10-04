// Research presentation contract only. Never imported by a Decision/LINE producer.
export const QUALITY_WINDOWS = [5, 20, 60, 90] as const;
export type SampleBand = 'INSUFFICIENT_SAMPLE' | 'EARLY_SIGNAL' | 'PRELIMINARY' | 'MEANINGFUL_SAMPLE';
export function sampleBand(independentTradingDays: number): SampleBand {
  if (!Number.isInteger(independentTradingDays) || independentTradingDays < 0) throw new Error('INVALID_SAMPLE_COUNT');
  return independentTradingDays < 5 ? 'INSUFFICIENT_SAMPLE' : independentTradingDays < 20 ? 'EARLY_SIGNAL'
    : independentTradingDays < 60 ? 'PRELIMINARY' : 'MEANINGFUL_SAMPLE';
}
export interface ResearchFeature {
  feature_key: string; version: number; business_meaning: string; signal_role: string;
  normalization: string; freshness_contract: string; session_contract: string;
  confidence_impact: 'SHADOW_ONLY_UNCALIBRATED'; missing_behavior: 'UNAVAILABLE_NO_IMPUTATION';
}
export interface ResearchFoundation {
  schema_version: 'RESEARCH_FOUNDATION_V1'; mode: 'SHADOW'; production_eligible: false;
  features: ResearchFeature[]; method_versions: number; graphs: number; observations: number;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function readFoundation(value: unknown): ResearchFoundation {
  const row = object(value);
  if (row.schema_version !== 'RESEARCH_FOUNDATION_V1' || row.mode !== 'SHADOW' || row.production_eligible !== false
    || !Array.isArray(row.features) || !['method_versions', 'graphs', 'observations'].every(key => Number.isInteger(row[key]) && Number(row[key]) >= 0)) {
    throw new Error('RESEARCH_FOUNDATION_CONTRACT_INVALID');
  }
  const features = row.features.map((value: unknown) => {
    const feature = object(value);
    for (const key of ['feature_key', 'business_meaning', 'signal_role', 'normalization', 'freshness_contract', 'session_contract']) {
      if (typeof feature[key] !== 'string' || !feature[key]) throw new Error('RESEARCH_FEATURE_INVALID');
    }
    if (!Number.isInteger(feature.version) || Number(feature.version) < 1 || feature.confidence_impact !== 'SHADOW_ONLY_UNCALIBRATED'
      || feature.missing_behavior !== 'UNAVAILABLE_NO_IMPUTATION') throw new Error('RESEARCH_FEATURE_INVALID');
    return feature as unknown as ResearchFeature;
  });
  return { schema_version: 'RESEARCH_FOUNDATION_V1', mode: 'SHADOW', production_eligible: false,
    features, method_versions: Number(row.method_versions), graphs: Number(row.graphs), observations: Number(row.observations) };
}
