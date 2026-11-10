/** Offline binding of retained source_revisions, preserving actual receipt
 * times and the distinction between complete receipts and SQL projections. */
import {createHash} from 'node:crypto';
import {compareTime,hashValid,snapshotHash,sourceSafe,validObservationTime} from '../src/features/vnext/contracts.ts';
import {validateAnalysisPacket,type AnalysisPacket,type AnalysisEvidence} from './daily-ai-analysis.ts';

type ObjectValue=Record<string,any>;
const object=(v:unknown):v is ObjectValue=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function invalid(field:string):never{throw Error('RETAINED_SHORT_HISTORY_INVALID: '+field);}

/** Complete normalized source receipts can be verified without claiming that
 * the original HTTP bytes, commercial-use decision or event coverage exist. */
export async function bindRetainedShortHistory({snapshot_text,symbol,as_of}:{snapshot_text:string;symbol:string;as_of:string}){
 if(typeof snapshot_text!=='string'||Buffer.byteLength(snapshot_text)>32_000_000||!/^\d{4,6}$/.test(symbol)||!validObservationTime(as_of))invalid('scope');
 let s:unknown;try{s=JSON.parse(snapshot_text);}catch{invalid('snapshot_text');}
 if(!object(s)||s.schema!=='MORNING_ALPHA_RETAINED_2330_MARKET_SNAPSHOT_V1'||s.symbol!==symbol
  ||s.source_relation!=='vnext_runtime.source_revisions'||!validObservationTime(s.read_at)||compareTime(s.read_at,as_of)>0
  ||!Array.isArray(s.price_receipts)||!Array.isArray(s.action_receipts))invalid('snapshot');
 const packets:AnalysisPacket[]=[],receipts:ObjectValue[]=[],excluded:ObjectValue[]=[],actions:ObjectValue[]=[],seen=new Set<string>();
 for(const [kind,records] of [['PRICE',s.price_receipts],['ACTION',s.action_receipts]] as const){
  for(const r of records){
   if(!object(r)||!hashValid(r.revision_id)||seen.has(r.revision_id)||typeof r.is_projection!=='boolean'
    ||!sourceSafe(r.source)||!validObservationTime(r.received_at)||!validObservationTime(r.created_at)
    ||compareTime(r.received_at,r.created_at)>0||compareTime(r.created_at,s.read_at)>0||!object(r.receipt_document))invalid('receipt');
   seen.add(r.revision_id);const d=r.receipt_document,t=d.task;
   if(!object(t)||!object(d.payload)||d.status!=='OK'||t.key!==r.task_key||t.url!==r.source
    ||!Array.isArray(t.symbols)||!t.symbols.includes(symbol)||t.exchange!==undefined&&t.exchange!=='TWSE'
    ||kind==='PRICE'&&!['PRICE','TWSE_PRICE_DAY'].includes(t.kind)||kind==='ACTION'&&t.kind!=='ACTION'
    ||!hashValid(d.payload_hash)||!hashValid(d.raw_hash)||!validObservationTime(d.available_at)
    ||!validObservationTime(d.first_seen_at)||!validObservationTime(d.as_of)||d.published_at!==null
    ||compareTime(d.available_at,r.received_at)!==0||compareTime(d.first_seen_at,d.available_at)>0
    ||compareTime(d.as_of,d.available_at)>0||!Array.isArray(d.payload.rows))invalid('receipt.identity');
   const projectedHash=await snapshotHash(d);
   if(r.is_projection){
    if(r.original_payload_text!==null)invalid('projection.original_text');
    excluded.push({revision_id:r.revision_id,kind,reason:'PROJECTION_NOT_COMPLETE_ORIGINAL_RECEIPT',original_payload_hash:d.payload_hash,
     projection_hash:projectedHash,available_at:d.available_at,selected_row_count:d.payload.rows.length});
   }else{
    if(typeof r.original_payload_text!=='string'||sha(r.original_payload_text)!==r.revision_id||projectedHash!==r.revision_id
     ||await snapshotHash(JSON.parse(r.original_payload_text))!==r.revision_id||await snapshotHash(d.payload)!==d.payload_hash
     ||r.original_row_count!==d.payload.rows.length||r.selected_row_count!==d.payload.rows.length)invalid('receipt.hash');
    receipts.push({revision_id:r.revision_id,source:r.source,received_at:r.received_at,payload_hash:d.payload_hash,
     raw_http_hash:d.raw_hash,raw_http_bytes_retained:false,kind,rows:d.payload.rows.length});
   }
   if(kind==='ACTION'){
    actions.push({revision_id:r.revision_id,source:r.source,available_at:d.available_at,from:t.from,through:t.through,
     complete:d.payload.complete,is_projection:r.is_projection,original_payload_hash:d.payload_hash,
     retained_document_hash:projectedHash,events:structuredClone(d.payload.rows),
     interpretation:'NORMALIZED_INVENTORY_COMPLETE_FALSE_IS_NOT_PROOF_OF_OFFICIAL_SOURCE_INCOMPLETENESS'});
    // Keep the source assertion, including false, visible to the gate. An
    // inventory is never promoted into a complete no-action certificate.
    {
     const e:AnalysisEvidence={id:'retained-action:'+r.revision_id,symbol,kind:'FINANCIAL',source:r.source,
      published_at:null,available_at:d.available_at,first_seen_at:d.first_seen_at,as_of:d.as_of,
      time_basis:'OBSERVED_AFTER_RECEIPT',evidence_hash:projectedHash,
      content:JSON.stringify({kind:'CORPORATE_ACTION_INVENTORY',symbol,from:t.from,through:t.through,
       complete:d.payload.complete,events:d.payload.rows,source_revision_id:r.revision_id,
       is_projection:r.is_projection,original_payload_hash:d.payload_hash,retained_document_hash:projectedHash})};
     const packet={symbol,company:symbol,cutoff:d.available_at,data_through:t.through,evidence:[e]};
     validateAnalysisPacket(packet);packets.push(packet);
    }
    continue;
   }
   if(r.is_projection)continue;
   const evidence:AnalysisEvidence[]=d.payload.rows.map((b:any,i:number)=>{
    if(!object(b)||b.symbol!==symbol||b.source!==r.source||b.source_ref!==r.source||!hashValid(b.evidence_hash)
     ||b.published_at!==null||compareTime(b.available_at,d.available_at)!==0||compareTime(b.first_seen_at,d.first_seen_at)!==0
     ||!validObservationTime(b.as_of)||compareTime(b.as_of,b.available_at)>0)invalid('bar.identity');
    return {id:'retained:'+r.revision_id+':'+i,symbol,kind:'PRICE',source:r.source,published_at:null,
     available_at:b.available_at,first_seen_at:b.first_seen_at,as_of:b.as_of,time_basis:'OBSERVED_AFTER_RECEIPT',
     evidence_hash:b.evidence_hash,content:JSON.stringify({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,
      volume:b.volume,amount:b.amount,session_scope:b.session_scope,original_id:b.id,source_revision_id:r.revision_id})};
   });
   for(let offset=0;offset<evidence.length;offset+=100){
    const part=evidence.slice(offset,offset+100),through=part.map(e=>JSON.parse(e.content).date).sort().at(-1);
    const packet={symbol,company:symbol,cutoff:d.available_at,data_through:through,evidence:part};
    validateAnalysisPacket(packet);packets.push(packet);
   }
  }
 }
 if(!packets.some(p=>p.evidence.some(e=>e.kind==='PRICE')))invalid('no_complete_price_receipt');
 const body={schema:'DAILY_AI_RETAINED_SHORT_HISTORY_BOUND_V1',symbol,as_of,snapshot_hash:sha(snapshot_text),
  packets,verified_normalized_receipts:receipts,excluded_projections:excluded,action_inventories:actions,
  availability:'ORIGINAL_RECEIPT_TIMES_NEVER_BACKDATED',raw_http_bytes_verified:false,source_use_approval:null,
  independent_method_review:null,methodology_approved:false,member_published:false};
 return {...body,binding_hash:await snapshotHash(body)};
}
