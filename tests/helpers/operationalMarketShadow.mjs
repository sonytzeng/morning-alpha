// Local-only actual handlers. Retained market projections are never labeled as
// complete raw HTTP responses. No real provider or LINE request can dispatch.
if(!Deno.args.includes('--scope=operational-market-20261001'))throw Error('ISOLATION_SCOPE_REQUIRED');
const root=new URL('../../',import.meta.url),origin='http://127.0.0.1:55450';
const arg=name=>Deno.args.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const stage=arg('stage')||'report',at=arg('time')||'2026-10-01T07:05:20+08:00';
if(!/^2026-10-0[12]T\d{2}:\d{2}:\d{2}\+08:00$/.test(at))throw Error('CLOCK_SCOPE');
const NativeDate=Date,fixed=NativeDate.parse(at),fake='LOCAL_OPERATIONAL_TEST_ONLY';
await Deno.writeTextFile(new URL('node_modules/.ma-six-clock',root),new NativeDate(fixed).toISOString().replace('T',' ').slice(0,19)+'\n');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
const env={SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:fake,CRON_SECRET:fake,LINE_CHANNEL_ACCESS_TOKEN:'LOCAL_FAKE_OPERATIONAL_LINE'};
Deno.env.get=key=>env[key];
const nativeFetch=globalThis.fetch.bind(globalThis),trace=[],sink=[],logs=[],tasks=[],handlers=new Map();
globalThis.EdgeRuntime={waitUntil:task=>tasks.push(task)};
console.log=(...args)=>logs.push(args.map(String).join(' '));console.warn=console.log;console.error=console.log;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function load(name){if(handlers.has(name))return handlers.get(name);Deno.serve=fn=>{handlers.set(name,fn);return {};};await import(new URL('supabase/functions/'+name+'/index.ts',root));return handlers.get(name);}
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.hostname==='api.line.me'){
  // In-memory recorder, not nativeFetch. Deno separately denies all outside net.
  if(url.pathname!=='/v2/bot/message/multicast')throw Error('LINE_ENDPOINT_BLOCKED');
  const payload=JSON.parse(init.body);
  if(new Headers(init.headers).get('authorization')!=='Bearer LOCAL_FAKE_OPERATIONAL_LINE'
   ||payload.to.length!==1||payload.to[0]!=='U_OPERATIONAL_LOCAL_FAKE')throw Error('NONLOCAL_LINE_IDENTITY');
  sink.push({recipient_count:1,message_count:payload.messages.length});return json({});
 }
 if(url.origin!==origin)throw Error('EXTERNAL_NETWORK_DISPATCH_BLOCKED');
 if(url.pathname.startsWith('/functions/v1/'))return (await load(url.pathname.split('/').at(-1)))(new Request(url,init));
 url.pathname=url.pathname.replace(/^\/rest\/v1(?=\/)/,'');
 if(arg('fault')==='missing-sector' && url.pathname==='/market_checkpoint_snapshots'
  && url.searchParams.get('trading_date')==='eq.2026-09-30')return json([]);
 if(arg('fault')==='learning-unavailable' && ['/learning_rules','/model_evaluations'].includes(url.pathname))return json({message:'LOCAL_INJECTED_OPTIONAL_LEARNING_FAILURE'},503);
 if(arg('fault')==='learning-write' && url.pathname==='/learning_runs' && init.method==='POST')return json({message:'LOCAL_INJECTED_LEARNING_WRITE_FAILURE'},503);
 const headers=new Headers(init.headers||(input instanceof Request?input.headers:{}));headers.delete('authorization');headers.delete('apikey');
 trace.push({path:url.pathname,method:init.method||'GET'});
 return nativeFetch(url,{...init,headers,redirect:'error'});
};
const clock=await(await fetch(origin+'/rpc/ma_chaos_clock',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
if(NativeDate.parse(clock)!==fixed)throw Error('EDGE_DB_CLOCK_DRIFT');
if(stage==='replay'){
 const {replayCriticalContract}=await import(new URL('supabase/functions/_shared/critical-contract-recorder.ts',root));
 const rows=await(await fetch(origin+'/production_critical_contract_evidence?select=id,stage,capsule')).json();
 const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
 const results=rows.filter(r=>!r.capsule.sql_signature).map(r=>({id:r.id,stage:r.stage,
  operational:r.capsule.input.schema_version==='OPERATIONAL_MARKET_REPLAY_V1',
  deterministic:JSON.stringify(sort(replayCriticalContract(r.stage,r.capsule.input)))===JSON.stringify(sort(r.capsule.expected))}));
 const output={critical_edge_count:results.length,operational_count:results.filter(r=>r.operational).length,
  diff:results.filter(r=>!r.deterministic),sql_capsules:rows.filter(r=>r.capsule.sql_signature).length,production_writes:0};
 await Deno.writeTextFile('/tmp/ma-operational-replay.json',JSON.stringify({output,results},null,2));
 Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(output)+'\n'));
 Deno.exit(output.diff.length||!output.operational_count?1:0);
}
if(stage==='line'){
 const rows=await(await fetch(origin+'/line_subscribers?select=id')).json();
 if(!rows.length){const r=await fetch(origin+'/line_subscribers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line_user_id:'U_OPERATIONAL_LOCAL_FAKE',display_name:'SYNTHETIC_LOCAL',is_active:true})});if(!r.ok)throw Error('LOCAL_RECIPIENT_SETUP_FAILED');}
}
const names={report:'generate-daily-report-v7',line:'line-daily-push',closing:'closing-verification-engine',learning:'continuous-learning-engine',orchestrator:'daily-delivery-orchestrator'};
let response;
if(stage==='acceptance')response=await fetch(origin+'/rpc/capture_morning_alpha_acceptance_v1',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_business_date:at.slice(0,10)})});
else {
 if(!names[stage])throw Error('STAGE_SCOPE');
 response=await(await load(names[stage]))(new Request(origin+'/functions/v1/'+names[stage],{method:'POST',headers:{'content-type':'application/json','x-cron-secret':fake},body:JSON.stringify(stage==='report'?{skip_openai:true}:stage==='orchestrator'?{phase:arg('phase')||'generate'}:{})}));
}
const body=await response.json();await Promise.allSettled(tasks);
const result={stage,at,http:response.status,success:body.success,error_code:body.error_code||body.error,
 report_status:body.report_status,recommendation_status:body.recommendation_status,
 local_line_send:sink.length,real_line_calls:0,production_token_used:0,production_recipient_used:0,production_writes:0};
await Deno.writeTextFile('/tmp/ma-operational-'+stage+'.json',JSON.stringify({result,body,trace,logs},null,2));
Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(result)+'\n'));
