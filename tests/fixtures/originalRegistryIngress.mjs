// SYNTHETIC ISOLATED CONTROLS ONLY. No real source receipt, right or approval.
import {createHash,randomUUID} from 'node:crypto';
import {HORIZONS,snapshotHash} from '../../src/features/vnext/contracts.ts';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const fixedNow='2026-10-19T00:00:00.123456Z';
/** Cleanup-only result: no raw Docker output or container metadata is returned.
 * Delete only the exact ID captured by THIS test's run, after checking its
 * exclusive generated name. A failed rm/inspect is FAIL, never absence proof.
 * Post-rm inspect must explicitly report both ID and name do not exist.
 */
export function cleanupOriginalRegistryContainer({name,id,docker}){
 if(!/^ma-registry-ingress-\d+-[a-f0-9]{8}$/.test(name)||!/^[a-f0-9]{64}$/.test(id))return 'FAIL';
 try{
  if(docker(['container','inspect','--format','{{.Id}} {{.Name}}',id])!==`${id} /${name}`)return 'FAIL';
 }catch{return 'FAIL';}
 let removed=true;
 try{docker(['container','rm','--force',id]);}catch{removed=false;}
 const absent=target=>{
  try{docker(['container','inspect','--format','{{.Id}}',target]);return false;}
  catch(error){
   const messages=[`Error: No such container: ${target}`,`Error: No such object: ${target}`,
    `Error response from daemon: No such container: ${target}`,`Error response from daemon: No such object: ${target}`];
   return error?.status===1&&!error.signal&&messages.includes(String(error.stderr??'').trim());
  }
 };
 const idAbsent=absent(id),nameAbsent=absent(name);
 return removed&&idAbsent&&nameAbsent?'PASS':'FAIL';
}
export async function registryFixture({epoch=Date.parse(fixedNow),horizon='SHORT',symbol='7999'}={}){
 const at=ms=>new Date(epoch+ms).toISOString(),artifacts=new Map(),records=new Map();
 const store=text=>{const bytes=new TextEncoder().encode(text),hash=sha(bytes);artifacts.set(hash,bytes);return hash;};
 const license={id:sha('synthetic-license:'+symbol),source:'SYNTHETIC_ISOLATED',document_url:'https://example.com/isolated-license',
  reviewed_at:at(-120000),expires_at:null,storage:true,derived:true,commercial:false,redistribution:false,attribution:'SYNTHETIC PRIVATE CONTROL'};
 for(const kind of HORIZONS[horizon].required){
  const evidence={id:sha(symbol+':'+kind),symbol,kind,source:license.source,source_ref:'https://example.com/isolated/'+kind,
   license_id:license.id,published_at:at(-110000),first_seen_at:at(-100000),available_at:at(-90000),as_of:at(-120000),
   last_verified_at:at(-70000),valid_until:at(3600000),snapshot_hash:sha('synthetic-normalized:'+kind),
   classification:'CONFIRMED_FACT',quality:'PASS',relevant:true,summary:'隔離合成證據，非真實股票研究。'};
  const body={schema:'ORIGINAL_RETAINED_SOURCE_RECEIPT_1',source:evidence.source,source_ref:evidence.source_ref,
   raw_sha256:store('SYNTHETIC RAW ONLY:'+symbol+':'+kind),captured_by:'isolated-capture',published_at:evidence.published_at,
   first_seen_at:evidence.first_seen_at,available_at:evidence.available_at,as_of:evidence.as_of};
  const receipt={...body,id:await snapshotHash(body)};
  const review=async(purpose,reviewer_ref)=>({purpose,result:'PASS',reviewer_ref,reviewed_at:at(-80000),expires_at:at(1800000),
   document_hash:store('SYNTHETIC '+purpose+' REVIEW ONLY:'+symbol+':'+kind),evidence_hash:await snapshotHash(evidence),
   receipt_hash:receipt.id,license_hash:await snapshotHash(license)});
  records.set(evidence.id,{schema:'ORIGINAL_APPROVED_REGISTRY_RECORD_1',evidence,license:structuredClone(license),receipt,
   quality_review:await review('SOURCE_QUALITY','isolated-quality'),rights_review:await review('PRIVATE_STORAGE_DERIVATION','isolated-rights')});
 }
 const ids=[...records.keys()],input={schema:'ORIGINAL_OBSERVATION_INGRESS_1',c_prediction_id:'synthetic:'+symbol+':'+horizon,
  c_lock_hash:sha('synthetic-c:'+symbol),symbol,company:'合成隔離公司',horizon,reason:'隔離接線測試，不是正式推薦。',evidence_ids:ids,
  confirmation_conditions:[{text:'等待原始確認',state:'UNKNOWN',evidence_ids:[ids[0]]}],
  invalidation_conditions:[{text:'獨立檢查失效',state:'UNKNOWN',evidence_ids:[ids.at(-1)]}],next_review_at:at(3600000),expires_at:at(7200000)};
 const pins=await Promise.all([...records].map(async([evidence_id,r])=>({evidence_id,record_hash:await snapshotHash(r),approval_id:randomUUID()})));
 async function response(request=input){
  const evidence=request.evidence_ids.map(id=>structuredClone(records.get(id).evidence)).sort((a,b)=>a.id.localeCompare(b.id));
  const body={id:'original-'+sha(request.c_prediction_id),symbol,company:request.company,horizon,created_at:at(0),
   as_of:at(-120000),available_at:at(-90000),last_verified_at:at(-70000),next_review_at:request.next_review_at,expires_at:request.expires_at,
   reason:request.reason,evidence_ids:evidence.map(e=>e.id),confirmation_conditions:request.confirmation_conditions,
   invalidation_conditions:request.invalidation_conditions,strategy_version:'VNEXT_RESEARCH_1.0.0',mode:'FORWARD_SHADOW',publication_status:'RESEARCH_ONLY'};
  return {schema:'ORIGINAL_OBSERVATION_RECEIPT_1',replayed:false,snapshot:{observation:{...body,snapshot_hash:await snapshotHash({observation:body,evidence})},evidence,state:'WATCHING',
   lineage:{c_prediction_id:request.c_prediction_id,c_lock_hash:request.c_lock_hash,c_source_revision:sha('synthetic-c-revision'),c_generated_at:at(-30000),c_cutoff:at(-60000)}}};
 }
 const calls=[],ports={pins,producer_ref:'isolated-producer',capture_issuers:['isolated-capture'],quality_reviewers:['isolated-quality'],rights_reviewers:['isolated-rights'],
  readApproved:async id=>records.has(id)?structuredClone(records.get(id)):null,
  readArtifact:async hash=>artifacts.get(hash),now:()=>at(0),rpc:async(name,args)=>{calls.push({name,args});return response(args.p_request);}};
 return {ports,pins,records,artifacts,input,calls,response,at};
}
