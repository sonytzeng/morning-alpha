import {entryWorkerHeaders} from '../supabase/functions/entry-opportunity-shadow-v1/worker-auth.mjs';
export const ENTRY_ENDPOINT='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/entry-opportunity-shadow-v1';
export const ENTRY_REPLAY_SOURCES=Object.freeze({
  '2026-10-07':'210f6dcb-60b8-4d96-aee8-cdbbf57de95c',
  '2026-10-08':'fc1f8f35-3501-47ed-be37-155b8b907a4b',
});
// One bounded request. No alternate credential, retry, Forward, or direct SQL path.
// The runtime supplies credentials in memory; never CLI arguments or browser code.
export async function callEntryHistorical({date,readWorkerToken,readGatewayJwt,transport=fetch}) {
  if (typeof window!=='undefined' || !Object.hasOwn(ENTRY_REPLAY_SOURCES,date)) throw Error('ENTRY_CALL_SCOPE_DENIED');
  let secret, gateway, headers;
  try {
    secret=await readWorkerToken(); gateway=await readGatewayJwt();
    if(typeof gateway!=='string'||!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(gateway)) throw Error('ENTRY_GATEWAY_CONFIG_INVALID');
    const body=JSON.stringify({source_run_id:ENTRY_REPLAY_SOURCES[date],mode:'HISTORICAL_REPLAY'});
    headers={...await entryWorkerHeaders(secret,body),Authorization:'Bearer '+gateway};
    const response=await transport(ENTRY_ENDPOINT,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(60000)});
    const result=await response.json();
    if(!response.ok) return {http:response.status,ok:false,reason:['ENTRY_AUTH_MISSING','ENTRY_AUTH_INVALID','ENTRY_AUTH_EXPIRED','ENTRY_WORKER_UNCONFIGURED','ENTRY_RESEARCH_REJECTED','ENTRY_SOURCE_UNAVAILABLE'].includes(result.error)?result.error:'ENTRY_REQUEST_REJECTED'};
    if(result.shadow_only!==true||!Array.isArray(result.business_writes)||result.business_writes.length||result.universe!==72||
      !['STORED','ALREADY_STORED'].includes(result.receipt?.status)||!/^[a-f0-9-]{36}$/.test(result.receipt?.run_id)||
      !['ENTRY_READY','WAIT_CONFIRMATION','AVOID_ENTRY','INSUFFICIENT_EVIDENCE'].every(k=>Number.isInteger(result.counts?.[k])&&result.counts[k]>=0)||
      Object.values(result.counts).reduce((a,b)=>a+b,0)!==216) throw Error('ENTRY_RECEIPT_INVALID');
    return {http:response.status,ok:true,date,status:result.receipt.status,run_id:result.receipt.run_id,counts:result.counts,business_writes:0};
  } finally { secret=undefined;gateway=undefined;if(headers)for(const k of Object.keys(headers))headers[k]='';headers=undefined; }
}
