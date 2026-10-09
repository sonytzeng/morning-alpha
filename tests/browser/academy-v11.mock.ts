// ISOLATED auth adapter only; real candidate RPCs execute under PostgreSQL RLS.
// Never bundled by production config; no token, production key, or user metadata.
type Callback=(event:string)=>void;
const callbacks=new Set<Callback>();
export async function switchTestIdentity(role:string){
 await fetch('/__academy_test_session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})});
 callbacks.forEach(fn=>fn(role==='anonymous'?'SIGNED_OUT':'SIGNED_IN'));
}
export const supabase={auth:{async getUser(){const r=await(await fetch('/__academy_test_identity')).json();return {data:{user:r.id?{id:r.id}:null},error:null};},onAuthStateChange(fn:Callback){callbacks.add(fn);return {data:{subscription:{unsubscribe(){callbacks.delete(fn);}}}};}},
 rpc(name:string,params:Record<string,unknown>={}){return {async abortSignal(signal:AbortSignal){return (await fetch('/__academy_test_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,params}),signal})).json();}};}};
