/** Four retained issuer originals, Owner research only. No fetch, formal source
 * admission, consensus/guidance merge, or replacement of a canonical row. */
import retained from './retained-2330-quarter-actuals-20261019.json' with {type:'json'};
import type {DecisionIdentity,EvidenceData,Row} from './decision-v1-data.ts';
import {snapshotHash} from '../../../src/features/vnext/contracts.ts';

export const RETAINED_QUARTER_SOURCE_HASH='cf8a3700217d9652d9d293b73c2addf19c151556fcfe21daf7299a70884b686d';
const CONTRACT='SOURCE_BOUND_RETAINED_QUARTER_ACTUALS_V1';
const MAX_BYTES=16000;
const missing=['EXACT_FIRST_PUBLIC_ANNOUNCEMENT_AND_VERSION','PREANNOUNCEMENT_CONSENSUS','LATEST_GUIDANCE','FORMAL_SOURCE_ADMISSION'];
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const stamp=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
type Binding={report_date:string;producer_revision_id:string;producer_cutoff:string;evidence_cutoff:string};
type Capsule=Binding&{contract:string;source_pack_sha256:string;source_pack:typeof retained;payload_hash:string};
export type OwnerQuarterActualsView={contract:'OWNER_RETAINED_QUARTER_ACTUALS_V1';status:'ACTUALS_4_OF_4_V1_BLOCKED';symbol:'2330';
 as_of_date:string;supported_report_dates:typeof retained.supported_report_dates;evidence_cutoff:string;pack_created_at:string;source_pack_sha256:string;
 rows:(typeof retained.rows[number]&{available_at:string})[];missing:string[]};

function validWindow(binding:Binding){
 const cutoff=stamp(binding.producer_cutoff),evidence=stamp(binding.evidence_cutoff),created=stamp(retained.created_at);
 if(!Number.isFinite(cutoff)||!Number.isFinite(evidence)||!Number.isFinite(created)||created>evidence||evidence>cutoff)return false;
 if(!/^\d{4}-\d\d-\d\d$/.test(binding.report_date)||binding.report_date<retained.supported_report_dates.from||binding.report_date>retained.supported_report_dates.through)return false;
 if(new Date(cutoff+8*3600000).toISOString().slice(0,10)!==binding.report_date||new Date(evidence+8*3600000).toISOString().slice(0,10)!==binding.report_date)return false;
 return typeof binding.producer_revision_id==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(binding.producer_revision_id);
}

/** Called only while constructing a new Producer candidate receipt. A retained
 * PDF's earlier first-seen time never permits this new pack on an old Report. */
export async function createRetainedQuarterActuals(identity:DecisionIdentity,evidenceCutoff:string):Promise<Capsule|null>{
 const binding={report_date:identity.report_date,producer_revision_id:identity.revision_id,producer_cutoff:identity.generated_at,evidence_cutoff:evidenceCutoff};
 if(!validWindow(binding))return null;
 if(await snapshotHash(retained)!==RETAINED_QUARTER_SOURCE_HASH)throw Error('RETAINED_QUARTER_SOURCE_DRIFT');
 const body={contract:CONTRACT,...binding,source_pack_sha256:RETAINED_QUARTER_SOURCE_HASH,source_pack:structuredClone(retained)};
 return {...body,payload_hash:await snapshotHash(body)};
}

/** Caller has already verified the exact saved Report/correlation/revision and
 * the existing server Owner predicate. This never runs on the Member path. */
export async function withRetainedQuarterActuals(data:EvidenceData,binding:Binding,value:unknown):Promise<{data:EvidenceData;quarterActuals?:OwnerQuarterActualsView}>{
 if(value===undefined)return {data};
 const fail=(reason:string)=>({data:{...data,failures:[...data.failures,'RETAINED_QUARTER_ACTUALS_'+reason]}});
 try{
  const encoded=JSON.stringify(value);if(!encoded||new TextEncoder().encode(encoded).length>MAX_BYTES)return fail('CAPSULE_LIMIT');
  const c=object(value);
  const keys=['contract','report_date','producer_revision_id','producer_cutoff','evidence_cutoff','source_pack_sha256','source_pack','payload_hash'];
  if(JSON.stringify(Object.keys(c).sort())!==JSON.stringify(keys.sort())||c.contract!==CONTRACT)return fail('CONTRACT_INVALID');
  if(!validWindow(binding)||c.report_date!==binding.report_date||c.producer_revision_id!==binding.producer_revision_id
   ||c.producer_cutoff!==binding.producer_cutoff||c.evidence_cutoff!==binding.evidence_cutoff)return fail('SAVED_BINDING_INVALID');
  if(c.source_pack_sha256!==RETAINED_QUARTER_SOURCE_HASH||await snapshotHash(c.source_pack)!==RETAINED_QUARTER_SOURCE_HASH
   ||await snapshotHash(retained)!==RETAINED_QUARTER_SOURCE_HASH)return fail('SOURCE_HASH_MISMATCH');
  const {payload_hash,...body}=c;if(await snapshotHash(body)!==payload_hash)return fail('PAYLOAD_HASH_MISMATCH');
  // Fixed source hash binds every number, quarter, EPS/share/currency basis,
  // rounded revenue resolution, raw PDF identity and original receipt time.
  const rows=retained.rows.map(row=>({id:`retained-quarter:${RETAINED_QUARTER_SOURCE_HASH}:${row.fiscal_period}`,
   provider:'TSMC_RETAINED_ISSUER_ACTUALS_CANDIDATE',symbol:row.symbol,fiscal_period:row.fiscal_period,
   announced_at:null,created_at:retained.created_at,available_at:retained.created_at,
   revenue_actual:row.revenue_actual,eps_actual:row.eps_actual,revenue_consensus:null,eps_consensus:null,guidance_direction:null,
   source_ref:row.source_ref,actual_only:true,source_admitted:false,
   actual_source:{...structuredClone(row),source_pack_sha256:RETAINED_QUARTER_SOURCE_HASH,pack_created_at:retained.created_at}}));
  const ids=new Set(rows.map(row=>row.id));
  for(const prior of data.earnings.filter(row=>ids.has(String(row.id)))){
   if(await snapshotHash(prior)!==await snapshotHash(rows.find(row=>row.id===prior.id)))return fail('EXISTING_ROW_CONFLICT');
  }
  // No same-quarter join or overwrite: the existing complete legacy rows keep
  // their original consensus/Guidance identity. These new rows have announced
  // and expectation fields null, so the unchanged V1 hard gate excludes them.
  const earnings=[...data.earnings.filter(row=>!ids.has(String(row.id))),...rows];
  const quarterActuals:OwnerQuarterActualsView={contract:'OWNER_RETAINED_QUARTER_ACTUALS_V1',status:'ACTUALS_4_OF_4_V1_BLOCKED',symbol:'2330',
   as_of_date:retained.as_of_date,supported_report_dates:{...retained.supported_report_dates},evidence_cutoff:binding.evidence_cutoff,
   pack_created_at:retained.created_at,source_pack_sha256:RETAINED_QUARTER_SOURCE_HASH,
   rows:retained.rows.map(row=>({...structuredClone(row),available_at:retained.created_at})),missing:[...missing]};
  return {data:{...data,earnings},quarterActuals};
 }catch{return fail('CAPSULE_INVALID');}
}
