import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {callHistoricalShadow} from '../../scripts/research-shadow-caller.mjs';
import {shadowWorkerHeaders} from '../../supabase/functions/_shared/shadow-worker-auth.mjs';

export async function shadowHttp(sdk) {
  // Ephemeral isolation identity only; never a stored fixture or Production secret.
  let token=randomBytes(32).toString('base64url');
  const logs=[];let dbCalls=0;
  const bridge=createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1048576)throw Error('BOUND');}
      const b=JSON.parse(raw);dbCalls++;
      let result;
      if(b.kind==='rpc'){
        assert(['research_analysis_input_v1','store_research_analysis_v1'].includes(b.name));
        result=await sdk.rpc(b.name,b.args);
      } else {
        assert.equal(b.kind,'read');assert.equal(b.table,'research_daily_analysis');
        let q=sdk.from(b.table).select('id,prediction_hash,observation_kind,analysis_cutoff_at');
        for(const [k,v] of b.filters){assert(['business_date','analysis_cutoff_at','observation_kind','methodology_id','methodology_version'].includes(k));q=q.eq(k,v);}
        result=await q.maybeSingle();
      }
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
    } catch {res.writeHead(500);res.end('{}');}
  });
  bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
  const child=spawn('deno',['run','--cached-only','--no-lock','--allow-net=127.0.0.1',
    '--allow-env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SHADOW_ANALYSIS_WORKER_TOKEN',
    '--import-map=tests/helpers/shadow-http-import-map.json','tests/helpers/shadowDenoServer.ts'],
    {env:{...process.env,SUPABASE_URL:'http://127.0.0.1:'+bridge.address().port,
      SUPABASE_SERVICE_ROLE_KEY:'ISOLATED_DB_ONLY',SHADOW_ANALYSIS_WORKER_TOKEN:token},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',b=>logs.push(b.toString()));
  let address;
  try {
    address=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('DENO_ISOLATION_START_TIMEOUT')),15000);
      child.once('exit',()=>{clearTimeout(timer);reject(Error('DENO_ISOLATION_START_FAILED'));});
      child.stdout.on('data',b=>{try{const x=JSON.parse(b.toString().trim());if(x.port){clearTimeout(timer);resolve(x.port);}}catch{}});
    });
  }catch(e){child.kill();bridge.close();throw e;}
  const endpoint='http://127.0.0.1:'+address+'/functions/v1/research-analysis-shadow-v1';
  const readWorkerToken=async()=>token;
  return {
    async call(date){return callHistoricalShadow({date,readWorkerToken,endpoint,isolation:true});},
    async request(body,headers={}){return fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body),redirect:'error'});},
    headers:()=>shadowWorkerHeaders(token),
    calls:()=>dbCalls,
    async close(){
      const leaked=logs.some(s=>s.includes(token));
      token=undefined;child.kill();await once(child,'exit');await new Promise(r=>bridge.close(r));
      assert.equal(leaked,false,'auth logs must never contain the ephemeral identity');
      return logs.filter(s=>s.includes('SHADOW_AUTH_REJECTED')).length;
    },
  };
}
