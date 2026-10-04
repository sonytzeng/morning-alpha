// Browser-only synthetic fixture, NOT an auth implementation or production identity.
const mode=new URLSearchParams(location.search).get('mode') || 'owner';
const keys=['TAIEX','2330','TXF','SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y'];
const fixture={schema_version:'RESEARCH_FOUNDATION_V1',mode:'SHADOW',production_eligible:false,
  method_versions:0,graphs:0,observations:0,features:keys.map(feature_key=>({
    feature_key,version:1,business_meaning:'合成 Fixture：僅驗證版面與狀態',signal_role:'SYNTHETIC_ROLE',
    normalization:'SYNTHETIC_ONLY',freshness_contract:'SYNTHETIC_CONTRACT',session_contract:'SYNTHETIC_SESSION',
    confidence_impact:'SHADOW_ONLY_UNCALIBRATED',missing_behavior:'UNAVAILABLE_NO_IMPUTATION',
  }))};
export const supabase={
  auth:{onAuthStateChange(listener:(event:string)=>void){
    const timer=mode==='logout-race' ? setTimeout(()=>listener('SIGNED_OUT'),10) : undefined;
    return {data:{subscription:{unsubscribe(){clearTimeout(timer);}}}};
  }},
  async rpc(name:string){
    if(name!=='get_research_foundation_v1')throw new Error('UNEXPECTED_RPC');
    await new Promise(resolve=>setTimeout(resolve,50));
    if(mode==='unavailable')return {data:null,error:{code:'PGRST202'}};
    if(!['owner','logout-race'].includes(mode))return {data:null,error:{code:'42501'}};
    return {data:fixture,error:null};
  },
};
