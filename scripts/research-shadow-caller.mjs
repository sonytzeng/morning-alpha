import {shadowWorkerHeaders,permittedShadowReplay} from '../supabase/functions/_shared/shadow-worker-auth.mjs';

export const SHADOW_ENDPOINT='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/research-analysis-shadow-v1';

// Server module only; not a web endpoint, CLI credential argument or browser import.
// readWorkerToken must resolve the dedicated credential from an approved Secret Store
// into memory. This candidate deliberately does not provision/read Production secrets.
export async function callHistoricalShadow({date,readWorkerToken,endpoint=SHADOW_ENDPOINT,isolation=false,transport=fetch}) {
  if (typeof window !== 'undefined') throw Error('SHADOW_SERVER_ONLY');
  const url=new URL(endpoint);
  const loopback=isolation && url.protocol==='http:' && url.hostname==='127.0.0.1'
    && url.pathname==='/functions/v1/research-analysis-shadow-v1' && !url.search && !url.hash && !url.username && !url.password;
  if (endpoint!==SHADOW_ENDPOINT && !loopback) throw Error('SHADOW_DESTINATION_DENIED');
  if (isolation && !loopback) throw Error('SHADOW_ISOLATION_REQUIRED');
  const body={operation:'ANALYZE',business_date:date,analysis_cutoff_at:date+'T07:30:00+08:00',observation_kind:'HISTORICAL_REPLAY'};
  if (!permittedShadowReplay(body)) throw Error('SHADOW_OPERATION_DENIED');
  let token,headers;
  try {
    token=await readWorkerToken();
    headers=shadowWorkerHeaders(token);
    const response=await transport(endpoint,{method:'POST',headers,body:JSON.stringify(body),
      redirect:'error',signal:AbortSignal.timeout(60000)});
    const payload=await response.json();
    // Never echo headers, upstream response text, arbitrary error detail or credentials.
    const reasons=['AUTH_MISSING','AUTH_INVALID','AUTH_VERSION_MISMATCH','AUTH_EXPIRED'];
    const reason=reasons.includes(payload.error)?payload.error:null;
    if (!response.ok) return {ok:false,http:response.status,reason};
    if (!['RECORDED','ALREADY_RECORDED'].includes(payload.status) || payload.production_writes!==0
      || payload.mode!=='SHADOW_ONLY' || !/^[a-f0-9]{64}$/.test(payload.prediction_hash)
      || !/^[a-f0-9-]{36}$/.test(payload.analysis_id)) throw Error('SHADOW_RECEIPT_INVALID');
    return {ok:true,http:response.status,status:payload.status,analysis_id:payload.analysis_id,
      prediction_hash:payload.prediction_hash,mode:'SHADOW_ONLY',production_writes:0};
  } catch { throw Error('SHADOW_CALL_FAILED'); }
  finally { token=undefined; if(headers) headers['x-shadow-worker-token']=''; headers=undefined; }
}

export async function runHistoricalShadowBatch(options) {
  const receipts=[];
  // Exactly one first pass and one idempotency pass. No retries after any failure.
  for(let pass=1;pass<=2;pass++) for(const date of ['2026-09-30','2026-10-01','2026-10-02']) {
    const receipt=await callHistoricalShadow({...options,date});
    receipts.push({pass,date,...receipt});
    if(!receipt.ok) return {ok:false,receipts};
  }
  return {ok:true,receipts};
}
