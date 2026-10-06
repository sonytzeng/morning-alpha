// Only SDK transport is replaced. The candidate Handler's Auth/RPC sequencing runs unchanged.
export function createClient(url:string,key:string,options?:{global?:{headers?:{Authorization?:string}}}) {
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw Error('LOCAL_TRANSPORT_ONLY');
 const send=async(body:unknown)=>(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,key,authorization:options?.global?.headers?.Authorization})})).json();
 return {
  auth:{getUser:(token:string)=>send({kind:'auth',token})},
  rpc:(name:string,args:unknown)=>send({kind:'rpc',name,args}),
  from(table:string){
   const filters:unknown[]=[],orders:unknown[]=[];let columns='*',limit=10000;
   const q={select(c:string){columns=c;return q;},eq(k:string,v:unknown){filters.push(['eq',k,v]);return q;},
    lte(k:string,v:unknown){filters.push(['lte',k,v]);return q;},gte(k:string,v:unknown){filters.push(['gte',k,v]);return q;},
    in(k:string,v:unknown){filters.push(['in',k,v]);return q;},order(k:string,v:unknown){orders.push([k,v]);return q;},limit(n:number){limit=n;return q;},
    then(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown){return send({kind:'query',table,columns,filters,orders,limit}).then(resolve,reject);}};
   return q;
  },
 };
}
