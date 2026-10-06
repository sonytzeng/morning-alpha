// Only the database transport is replaced. Real Deno Handler/Auth/engine execute.
export function createClient(url: string) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw Error('ISOLATION_REQUIRED');
  const send = async (body: unknown) => {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    return response.json();
  };
  return {
    from(table: string) {
      const filters: [string,unknown][]=[];
      const q={select(columns: string){if(columns!=='id,prediction_hash,observation_kind,analysis_cutoff_at')throw Error('ISOLATED_SELECT_DENIED');return q;},
        eq(key:string,value:unknown){filters.push([key,value]);return q;},
        maybeSingle(){return send({kind:'read',table,filters});}};
      return q;
    },
    rpc(name: string,args: unknown){return send({kind:'rpc',name,args});},
  };
}
