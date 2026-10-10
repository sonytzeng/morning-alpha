import { HORIZONS, sourceSafe, validTime } from './contracts.ts';
import type { ClaimClass, Horizon, Projection, SupplyRelation } from './contracts.ts';
export type IndustryEvent = { event_id:string; revision:number; title:string; classification:ClaimClass; source:string;
  available_at:string; last_verified_at:string; affected_companies:string[]; expected_horizons:Horizon[]; invalidation:string;source_refs:string[] };
export type IndustryRelation = { id:string; from_entity:string; to_entity:string; relation_type:SupplyRelation['type']; source:string;
  available_at:string; valid_from:string; valid_to:string|null; revenue_exposure:number|null; evidence_status:'SUPPORTED'|'UNKNOWN';source_refs:string[] };
export type VNextProjection = { tier: 'owner' | 'free' | 'premium'; observations: Projection[];
  industry:{events:IndustryEvent[];relations:IndustryRelation[];member_publication:false} };
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const text = (x:unknown): x is string => typeof x==='string' && x.trim().length>0;
const texts = (x:unknown): x is string[] => Array.isArray(x) && x.length>0 && x.every(text);
const claim = (x:unknown): x is ClaimClass => ['CONFIRMED_FACT','REPORTED_CLAIM','INFERENCE','UNVERIFIED'].includes(String(x));
/** PostgreSQL timestamptz preserves microseconds. This validates presentation
 * only and retains the original value; never use the truncated check value as
 * an evidence cutoff or comparison in the research engine. */
export function validProjectionTime(value: unknown): value is string {
  return typeof value === 'string' && validTime(value.replace(/(\.\d{3})\d{1,3}(?=Z$|[+-]\d\d:\d\d$)/, '$1'));
}
export function parseProjection(value: unknown): VNextProjection {
  if (!object(value) || value.schema !== 'VNEXT_PROJECTION_V1' || value.research_only !== true
      || !['owner', 'free', 'premium'].includes(String(value.tier)) || !Array.isArray(value.observations) || value.observations.length > 100) throw Error('PROJECTION_INVALID');
  const rows: Projection[] = [];
  for (const o of value.observations) {
    if (!object(o) || !['id', 'symbol', 'company', 'reason'].every(k => typeof o[k] === 'string' && (o[k] as string).length > 0)
      || !Object.hasOwn(HORIZONS, String(o.horizon)) || !['WATCHING', 'CONDITION_MET', 'INVALIDATED', 'EXPIRED'].includes(String(o.status))
      || !['HISTORICAL_REPLAY','FORWARD_SHADOW'].includes(String(o.mode)) || !validProjectionTime(o.created_at) || !validProjectionTime(o.as_of)
      || (value.tier!=='owner'&&o.mode!=='FORWARD_SHADOW')
      || !validProjectionTime(o.next_review_at) || ![o.confirmation, o.invalidation].every(a => Array.isArray(a) && a.length > 0 && a.every(s => typeof s === 'string' && s.length > 0))
      || !Array.isArray(o.evidence) || !o.evidence.every(e => object(e) && typeof e.summary === 'string' && typeof e.source === 'string'
        && sourceSafe(String(e.source_ref)) && validProjectionTime(e.available_at) && ['CONFIRMED_FACT','REPORTED_CLAIM','INFERENCE','UNVERIFIED'].includes(String(e.classification)))) throw Error('PROJECTION_ROW_INVALID');
    // Construct a whitelist. No unknown/raw payload can leak through a cast.
    rows.push({ id: String(o.id), symbol: String(o.symbol), company: String(o.company), horizon: o.horizon as Projection['horizon'], status: o.status as Projection['status'],
      mode:o.mode as Projection['mode'],created_at:o.created_at as string,as_of:o.as_of as string,
      reason: String(o.reason), next_review_at: String(o.next_review_at), confirmation: o.confirmation as string[], invalidation: o.invalidation as string[],
      evidence: o.evidence.map(e => ({summary:e.summary,source:e.source,source_ref:e.source_ref,available_at:e.available_at,classification:e.classification})) });
  }
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('DUPLICATE_PROJECTION');
  const industry = value.industry;
  if(!object(industry)||industry.member_publication!==false||!Array.isArray(industry.events)||!Array.isArray(industry.relations)
    ||industry.events.length>50||industry.relations.length>50)throw Error('INDUSTRY_PROJECTION_INVALID');
  if(value.tier!=='owner'&&(industry.events.length||industry.relations.length))throw Error('UNAPPROVED_INDUSTRY_PUBLICATION');
  const events:IndustryEvent[]=industry.events.map(e=>{
    if(!object(e)||![e.event_id,e.title,e.source,e.invalidation].every(text)||!Number.isSafeInteger(e.revision)||Number(e.revision)<1
      ||!claim(e.classification)||!validProjectionTime(e.available_at)||!validProjectionTime(e.last_verified_at)
      ||!texts(e.source_refs)||!e.source_refs.every(sourceSafe)||!texts(e.affected_companies)||!texts(e.expected_horizons)||!e.expected_horizons.every(h=>Object.hasOwn(HORIZONS,h)))throw Error('EVENT_PROJECTION_INVALID');
    return {event_id:String(e.event_id),revision:Number(e.revision),title:String(e.title),source:String(e.source),invalidation:String(e.invalidation),
      classification:e.classification,available_at:e.available_at,last_verified_at:e.last_verified_at,
      affected_companies:e.affected_companies,expected_horizons:e.expected_horizons as Horizon[],source_refs:e.source_refs};
  });
  const relations:IndustryRelation[]=industry.relations.map(r=>{
    if(!object(r)||![r.id,r.from_entity,r.to_entity,r.source].every(text)||r.from_entity===r.to_entity
      ||!['CUSTOMER','SUPPLIER','COMPETITOR','PRODUCT','INDUSTRY'].includes(String(r.relation_type))
      ||!validProjectionTime(r.available_at)||!validProjectionTime(r.valid_from)||(r.valid_to!==null&&!validProjectionTime(r.valid_to))
      ||!['SUPPORTED','UNKNOWN'].includes(String(r.evidence_status))||!Array.isArray(r.source_refs)||!r.source_refs.every(s=>typeof s==='string'&&sourceSafe(s))
      ||(r.revenue_exposure!==null&&(typeof r.revenue_exposure!=='number'||!Number.isFinite(r.revenue_exposure)||r.revenue_exposure<0||r.revenue_exposure>1)))throw Error('RELATION_PROJECTION_INVALID');
    return {id:String(r.id),from_entity:String(r.from_entity),to_entity:String(r.to_entity),source:String(r.source),
      relation_type:r.relation_type as IndustryRelation['relation_type'],available_at:r.available_at,valid_from:r.valid_from,
      valid_to:r.valid_to as string|null,revenue_exposure:r.revenue_exposure as number|null,evidence_status:r.evidence_status as IndustryRelation['evidence_status'],source_refs:r.source_refs as string[]};
  });
  if(new Set(events.map(e=>`${e.event_id}:${e.revision}`)).size!==events.length||new Set(relations.map(r=>r.id)).size!==relations.length)throw Error('DUPLICATE_INDUSTRY_PROJECTION');
  return {tier: value.tier as VNextProjection['tier'], observations: rows,industry:{events,relations,member_publication:false}};
}
