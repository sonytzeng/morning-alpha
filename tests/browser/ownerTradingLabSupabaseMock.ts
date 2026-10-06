// Synthetic identity transported only to the loopback test Handler, never Production.
const mode=new URLSearchParams(location.search).get('mode')||'owner';
let identity=mode==='member'?'fixture-member':mode==='paid'?'fixture-paid':mode==='anonymous'?'':'fixture-owner';
export const supabase={
 auth:{onAuthStateChange(listener:(event:string)=>void){const clear=()=>{identity='';listener('SIGNED_OUT');};window.addEventListener('synthetic-logout',clear);
  const t=mode==='logout-race'?setTimeout(clear,10):undefined;
  return {data:{subscription:{unsubscribe(){clearTimeout(t);window.removeEventListener('synthetic-logout',clear);}}}};}},
 functions:{async invoke(name:string,{body}:{body:unknown}){
  if(name!=='owner-trading-lab-v1')throw Error('UNEXPECTED_FUNCTION');
  if(mode==='unavailable')return {data:null,error:{message:'ISOLATED_UNAVAILABLE'}};
  const r=await fetch('/__owner_lab',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload:body,identity})});
  const x=await r.json();if(mode==='logout-race')await new Promise(r=>setTimeout(r,100));
  return {data:x.data,error:x.status===200?null:{message:'ISOLATED_DENIED'}};
 }},
};
