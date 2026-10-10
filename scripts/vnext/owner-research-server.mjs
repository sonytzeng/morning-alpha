/** Loopback acceptance transport; not a Production Function or auth policy. */
export async function readOwnerResearch(request,reports,requester=fetch,foundation=null,publication=null,funnel=null){
 if(request.method!=='GET')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
 if(!/^Bearer [A-Za-z0-9._-]+$/.test(request.authorization??''))return {status:401,body:{error:'AUTH_REQUIRED'}};
 try{
  // Existing local Supabase JWT validation + existing server Owner truth/RLS.
  const r=await requester('http://127.0.0.1:55633/rpc/get_vnext_observations_v1',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:request.authorization},body:'{}',signal:AbortSignal.timeout(5000)});
  if(!r.ok)return {status:r.status===401?401:403,body:{error:'ACCESS_DENIED'}};
  const data=await r.json();
  if(data.schema!=='VNEXT_PROJECTION_V1'||data.tier!=='owner'||data.research_only!==true)return {status:403,body:{error:'OWNER_ONLY'}};
  return {status:200,body:{schema:'VNEXT_REAL_RESEARCH_RESPONSE_V1',reports,member_publication:false,...(foundation?{foundation}:{}),...(publication?{publication}:{}),...(funnel?{funnel}:{})}};
 }catch{return {status:503,body:{error:'OWNER_VALIDATION_UNAVAILABLE'}};}
}
