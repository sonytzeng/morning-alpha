/** Server-owned, exact-input financial model-use review. This is independent
 * of raw-source ingestion flags, paid-model permission and member publication.
 * No request field or old edition review can create this receipt. */
import {canonical} from '../../../research/daily-ai-seed.ts';
import {hashValid,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import type {StoredStockAnalysisBatch} from './handler.ts';

const denied=():never=>{throw Error('AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE');};
const record=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return denied();
 return value as Record<string,unknown>;
};
const sha=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('AI_INTAKE_ABORTED');};
// Existing handler: <=8s load and <=45s run. Leave a full minute after this
// check so a review cannot expire between admission and a bounded model run.
const minimumValidityMs=60000;
const batchIdentity=(batch:StoredStockAnalysisBatch)=>{
 if(!hashValid(batch.id)||!validObservationTime(batch.cutoff)||!Array.isArray(batch.packets)||batch.packets.length!==72
  ||batch.packets.some(p=>!p||typeof p!=='object'||!/^\d{4,6}$/.test(p.symbol)||p.cutoff!==batch.cutoff)
  ||new Set(batch.packets.map(p=>p.symbol)).size!==72)return denied();
};

/** Same preimage as the SQL helper: sorted symbol:canonical-packet-hash lines.
 * Snapshot ownership is the caller's responsibility before the first await. */
export async function modelSourcePacketsCommitment(batch:StoredStockAnalysisBatch,signal:AbortSignal){
 batchIdentity(batch);
 const lines:string[]=[];
 for(const p of batch.packets.slice().sort((a,b)=>a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0)){
  stopped(signal);lines.push(p.symbol+':'+await sha(canonical(p)));stopped(signal);
 }
 return sha(lines.join('\n'));
}

export async function readFinancialModelUseReviewedBatch(value:unknown,
 lookup:(batchId:string,signal:AbortSignal)=>Promise<unknown>,signal:AbortSignal):Promise<StoredStockAnalysisBatch>{
 // Do not let a later async RPC/hash race mutate the reviewed input or receipt.
 const captured=structuredClone(record(value)) as unknown as StoredStockAnalysisBatch;
 batchIdentity(captured);stopped(signal);
 const raw=await lookup(captured.id,signal);stopped(signal);
 const p=structuredClone(record(raw));
 const expected=['schema','review_id','batch_id','cutoff','packets_commitment','quality','basis','use_scope','documents_ready',
  'review_document_hash','source_mapping_document_hash','terms_document_hash','reviewed_at','recorded_at','checked_at','expires_at','member_publication_approved'];
 if(Object.keys(p).sort().join('|')!==expected.sort().join('|')
  ||p.schema!=='DAILY_AI_MODEL_SOURCE_USE_RECEIPT_V1'||p.batch_id!==captured.id||p.cutoff!==captured.cutoff
  ||typeof p.packets_commitment!=='string'||!hashValid(p.packets_commitment)
  ||p.quality!=='PASS'||p.basis!=='FACT_ONLY_OWN_ANALYSIS'
  ||p.use_scope!=='FINANCIAL_FACT_MODEL_INPUT_ONLY'||p.documents_ready!==true||p.member_publication_approved!==false
  ||['review_id','review_document_hash','source_mapping_document_hash','terms_document_hash'].some(k=>typeof p[k]!=='string'||!hashValid(p[k] as string))
  ||['reviewed_at','recorded_at','checked_at','expires_at'].some(k=>typeof p[k]!=='string'||!validObservationTime(p[k] as string)))return denied();
 const [cutoff,reviewed,recorded,checked,expires]=[captured.cutoff,p.reviewed_at,p.recorded_at,p.checked_at,p.expires_at].map(t=>Date.parse(t as string));
 const now=Date.now();
 if(cutoff>reviewed||reviewed>recorded||recorded>checked||checked>=expires||expires<=now+minimumValidityMs
  ||checked>now+1000||now-checked>10000||expires-reviewed>72*3600000)return denied();
 // Hash only a structurally valid receipt; missing/revoked reviews stay cheap.
 const commitment=await modelSourcePacketsCommitment(captured,signal);stopped(signal);
 if(p.packets_commitment!==commitment||expires<=Date.now()+minimumValidityMs||Date.now()-checked>10000)return denied();
 return captured;
}
