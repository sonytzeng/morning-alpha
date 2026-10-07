// Synthetic local identity only. The isolated DB enforces the real Owner RLS.
let loggedOut=false;
export const supabase={auth:{onAuthStateChange(fn:(event:string)=>void){const listener=()=>{loggedOut=true;fn('SIGNED_OUT');};window.addEventListener('synthetic-logout',listener);return {data:{subscription:{unsubscribe(){window.removeEventListener('synthetic-logout',listener);}}}};}},async rpc(name:string){
 if(name!=='get_owner_recommendation_shadow_v2')throw Error('READ_ONLY');
 const role=loggedOut?'anonymous':new URL(location.href).searchParams.get('role')||'owner';
 const r=await fetch('/__v2_read?role='+encodeURIComponent(role));return r.ok?{data:await r.json(),error:null}:{data:null,error:{code:'42501'}};
}};
