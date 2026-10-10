import { HORIZONS, sourceSafe, validTime } from './contracts';
import type { Projection } from './contracts';
export type VNextProjection = { tier: 'owner' | 'free' | 'premium'; observations: Projection[] };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export function parseProjection(value: unknown): VNextProjection {
  if (!object(value) || value.schema !== 'VNEXT_PROJECTION_V1' || value.research_only !== true
      || !['owner', 'free', 'premium'].includes(String(value.tier)) || !Array.isArray(value.observations) || value.observations.length > 100) throw Error('PROJECTION_INVALID');
  const rows: Projection[] = [];
  for (const o of value.observations) {
    if (!object(o) || !['id', 'symbol', 'company', 'reason'].every(k => typeof o[k] === 'string' && (o[k] as string).length > 0)
      || !Object.hasOwn(HORIZONS, String(o.horizon)) || !['WATCHING', 'CONDITION_MET', 'INVALIDATED', 'EXPIRED'].includes(String(o.status))
      || !validTime(String(o.next_review_at)) || ![o.confirmation, o.invalidation].every(a => Array.isArray(a) && a.length > 0 && a.every(s => typeof s === 'string' && s.length > 0))
      || !Array.isArray(o.evidence) || !o.evidence.every(e => object(e) && typeof e.summary === 'string' && typeof e.source === 'string'
        && sourceSafe(String(e.source_ref)) && validTime(String(e.available_at)) && ['CONFIRMED_FACT','REPORTED_CLAIM','INFERENCE','UNVERIFIED'].includes(String(e.classification)))) throw Error('PROJECTION_ROW_INVALID');
    // Construct a whitelist. No unknown/raw payload can leak through a cast.
    rows.push({ id: String(o.id), symbol: String(o.symbol), company: String(o.company), horizon: o.horizon as Projection['horizon'], status: o.status as Projection['status'],
      reason: String(o.reason), next_review_at: String(o.next_review_at), confirmation: o.confirmation as string[], invalidation: o.invalidation as string[],
      evidence: o.evidence.map(e => ({summary:e.summary,source:e.source,source_ref:e.source_ref,available_at:e.available_at,classification:e.classification})) });
  }
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('DUPLICATE_PROJECTION');
  return {tier: value.tier as VNextProjection['tier'], observations: rows};
}
