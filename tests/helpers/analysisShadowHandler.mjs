// Real Deno entrypoint + relative modules + real Auth validator. Only transport is local SQL.
import ts from 'typescript';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {webcrypto} from 'node:crypto';
export function shadowHandler(sdk){
  let handler; const cache=new Map();
  const env={SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:'ISOLATED_ONLY',CRON_SECRET:'ISOLATED_SHADOW_TEST'};
  function load(path){
    if(cache.has(path))return cache.get(path);
    if(path.endsWith('.json'))return {default:JSON.parse(readFileSync(path,'utf8'))};
    const exports={};cache.set(path,exports);
    const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(js,{exports,Response,Request,Headers,URL,Date,TextEncoder,crypto:webcrypto,performance,
      Deno:{env:{get:k=>env[k]},serve:f=>handler=f},
      require:p=>{if(p.startsWith('.'))return load(resolve(dirname(path),p));
        if(p==='https://esm.sh/@supabase/supabase-js@2.57.4')return{createClient:()=>sdk};
        throw Error('UNAPPROVED_IMPORT');},
      fetch:()=>{throw Error('EXTERNAL_NETWORK_BLOCKED');}});
    return exports;
  }
  load(resolve('supabase/functions/research-analysis-shadow-v1/index.ts'));
  if(!handler)throw Error('HANDLER_MISSING');
  return async (body,authorized=true)=>handler(new Request('http://127.0.0.1/research-analysis-shadow-v1',{
    method:'POST',headers:authorized?{'x-cron-secret':env.CRON_SECRET}:{},body:JSON.stringify(body)}));
}
