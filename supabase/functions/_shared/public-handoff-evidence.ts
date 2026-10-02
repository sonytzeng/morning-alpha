type Row=Record<string,unknown>;
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null;
export type ReferenceMeasurement={index:number;evidence_id:unknown;source:unknown;source_date:unknown;freshness:unknown;
  identity_complete:boolean;frozen_match:boolean;https_metadata_match:boolean};
export type HandoffEvidenceInput={business_date:string;canonical_revision:string;decision_version:number;member_revision:string;
  source_revision:string;operational_ready:boolean;references:ReferenceMeasurement[]};
/** Preserve exact field-presence/equality decisions, never URLs/headers/private
 * prose. These measurements are the actual selector's inputs, not guessed PASS. */
export function measureHandoffReferences(value:unknown,frozen:Row[]):ReferenceMeasurement[]{
 return (Array.isArray(value)?value:[]).map((v,index)=>{
  const r=obj(v),keys=['evidence_id','source','source_date','freshness'];
  const identity_complete=keys.every(k=>text(r[k])!==null),match=frozen.find(f=>keys.every(k=>f[k]===r[k]));
  let https=false;try{https=new URL(String(r.url)).protocol==='https:';}catch{/* false */}
  return {index,evidence_id:r.evidence_id??null,source:r.source??null,source_date:r.source_date??null,freshness:r.freshness??null,
   identity_complete,frozen_match:!!match,https_metadata_match:identity_complete&&!!match&&https
    && ['title','url','published_at'].every(k=>text(match[k])!==null&&match[k]===r[k])
    && r.published_at===r.source_date&&Number.isFinite(Date.parse(String(r.published_at)))};
 });
}
export function replayHandoffReferences(input:HandoffEvidenceInput){
 const https=input.references.filter(r=>r.identity_complete&&r.frozen_match&&r.https_metadata_match);
 const ledger=input.operational_ready?input.references.filter(r=>r.identity_complete&&r.frozen_match):[];
 const selected=https.length?https:ledger;
 return {status:selected.length?'PASS':'CONFLICT',reason_codes:selected.length?[]:['PUBLIC_MARKET_EVIDENCE_INCOMPLETE'],
  reference_type:https.length?'HTTPS_PUBLIC_SOURCE':'IMMUTABLE_MARKET_LEDGER',selected_indexes:selected.slice(0,5).map(r=>r.index)};
}
