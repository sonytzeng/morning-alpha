import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizeInternalRequest, internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { runEntryResearch, type EntrySource } from '../../../research/entry-worker.ts';
import type { V2Input } from '../_shared/recommendation-shadow-v2-engine.ts';

// Candidate only. Existing internal CRON identity + Gateway JWT; no browser
// write access. No acquisition, Core caller, schedule, or automatic promotion.
export async function handleEntryOpportunity(request:Request){
  const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(request.headers.has('origin'))return reply(403,{error:'SERVER_ONLY'});
  const auth=await authorizeInternalRequest(request.headers,{...internalCredentialsFromEnv(),serviceRoleKey:''});
  if(!auth.ok)return reply(401,{error:auth.error_code});
  try{
    const text=await request.text();if(text.length>512)return reply(413,{error:'INPUT_LIMIT'});
    const body=JSON.parse(text);
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['source_run_id','mode'].includes(k))||
      !/^[a-f0-9-]{36}$/.test(body.source_run_id)||!['FORWARD','HISTORICAL_REPLAY'].includes(body.mode))return reply(422,{error:'ENTRY_SCOPE_INVALID'});
    const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{
      auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,init)=>fetch(u,{...init,signal:AbortSignal.timeout(5000)})}});
    const source=await db.from('recommendation_shadow_v2_runs').select('id,input_sha256,evidence,cutoff,business_date').eq('id',body.source_run_id).single();
    if(source.error||!source.data)return reply(409,{error:'ENTRY_SOURCE_UNAVAILABLE'});
    const s=source.data;
    const snapshot=await db.from('decision_snapshots').select('id,market_regime,generated_text,created_at,status').eq('report_date',s.business_date)
      .eq('session_type','PREMARKET').eq('status','READY').lte('created_at',s.cutoff).order('version',{ascending:false}).limit(1);
    const c=snapshot.error?null:snapshot.data?.[0],e=s.evidence as V2Input;
    const market:EntrySource['market']=c&&typeof c.generated_text?.market_bias==='string'&&typeof c.market_regime==='string'?
      {value:{direction:c.generated_text.market_bias,regime:c.market_regime},source_ref:c.id,
        observed_at:c.created_at,available_at:c.created_at}:null;
    const result=await runEntryResearch({id:s.id,input_sha256:s.input_sha256,evidence:e,market},body.mode,
      async(id,evidence,result)=>await db.rpc('store_entry_opportunity_v1',{p_source:id,p_evidence_text:evidence,p_result:result}),new Date().toISOString());
    return reply(200,result);
  }catch{return reply(422,{error:'ENTRY_RESEARCH_REJECTED',business_writes:[]});}
}
Deno.serve(handleEntryOpportunity);
