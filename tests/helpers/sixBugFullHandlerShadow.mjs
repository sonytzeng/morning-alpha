// Real handlers + private PostgREST/PostgreSQL. All external dispatch is denied.
// Retained 09/30 provider payloads are unchanged. Counterfactual 06:50 delivery
// and missing discovery responses are explicitly AUDITED_FIXTURE, not raw history.
if(!Deno.args.includes('--scope=ma-six-bug-preventive-20260930'))throw Error('ISOLATION_SCOPE_REQUIRED');
const root=new URL('../../',import.meta.url);
const arg=name=>Deno.args.find(x=>x.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
const port=arg('port')||'55446';if(!['55446','55447'].includes(port))throw Error('LOCAL_PORT_SCOPE');
const origin='http://127.0.0.1:'+port;
const stage=arg('stage')||'preflight',time=arg('time')||'2026-09-30T06:50:00+08:00';
if(!/^2026-(09-30|10-01)T\d{2}:\d{2}:\d{2}\+08:00$/.test(time))throw Error('CLOCK_SCOPE');
const NativeDate=Date,fixed=NativeDate.parse(time),fake='LOCAL_TEST_ONLY_NOT_PRODUCTION';
await Deno.writeTextFile(new URL('node_modules/.ma-six-clock',root),new NativeDate(fixed).toISOString().replace('T',' ').slice(0,19)+'\n');
globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
const env={SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:fake,CRON_SECRET:fake,LINE_CHANNEL_ACCESS_TOKEN:'LOCAL_FAKE_LINE_TOKEN',FINNHUB_API_KEY:'LOCAL_FAKE_FINNHUB',FUGLE_API_KEY:'LOCAL_FAKE_FUGLE'};
Deno.env.get=key=>env[key];
const corpus=JSON.parse(await Deno.readTextFile(new URL('tests/fixtures/six-bug-production-provider-20260930.json',root)));
const intraday=JSON.parse(await Deno.readTextFile(new URL('tests/fixtures/six-bug-production-intraday-20260930.json',root)));
const checkpoint=stage==='preflight'?'readiness_0650':arg('checkpoint')||'PREMARKET';
const fixtureClose=['1410','1430'].includes(checkpoint);
const selected=intraday.rows.filter(r=>r.checkpoint===(fixtureClose?'1300':checkpoint));
const rows=selected.length?selected:corpus.rows,trace=[],sink=[],tasks=[],handlers=new Map(),logs=[];
const nextDay=time.startsWith('2026-10-01');
// Counterfactual next-day shapes, explicitly not retained production responses.
// The immutable fixture is cloned and its session clock is advanced exactly one
// trading day. This tests contracts, not a claim about tomorrow's market values.
function nextDayPayload(value,key=''){
 if(Array.isArray(value))return value.map(v=>nextDayPayload(v,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,nextDayPayload(v,k)]));
 if(typeof value==='string')return value.replace(/2026-09-(29|30)/g,(_,d)=>d==='29'?'2026-09-30':'2026-10-01');
 if(typeof value==='number'&&['lastUpdated','closeTime','time','t'].includes(key)){
  if(value>1e15)return value+86400e6;if(value>1e12)return value+86400e3;if(value>1e9)return value+86400;
 }
 return value;
}
globalThis.EdgeRuntime={waitUntil:task=>tasks.push(task)};
const stdout=value=>Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(value)+'\n'));
console.log=(...args)=>logs.push(args.map(String).join(' '));console.warn=console.log;console.error=console.log;
const nativeFetch=globalThis.fetch.bind(globalThis);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
async function load(name){if(handlers.has(name))return handlers.get(name);Deno.serve=fn=>{handlers.set(name,fn);return {};};await import(new URL('supabase/functions/'+name+'/index.ts',root).href);if(!handlers.has(name))throw Error('HANDLER_MISSING:'+name);return handlers.get(name);}
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.hostname==='api.line.me'){
  if(url.pathname!=='/v2/bot/message/multicast')throw Error('LINE_ENDPOINT_NOT_ALLOWED');
  const p=JSON.parse(init.body);if(new Headers(init.headers).get('authorization')!=='Bearer LOCAL_FAKE_LINE_TOKEN'||p.to.some(x=>x!=='U_LOCAL_ONLY_SIX_BUG_FAKE_RECIPIENT'))throw Error('NONLOCAL_LINE_IDENTITY');
  sink.push({recipients:p.to.length,messages:p.messages.length});return json({});
 }
 if(url.hostname==='finnhub.io'){
  const row=rows.find(r=>r.replay_payload.source_symbol===url.searchParams.get('symbol'));
  if(!row)throw Error('UNAUDITED_FINNHUB_SYMBOL');
  trace.push({kind:nextDay?'AUDITED_FIXTURE':'REAL_EVIDENCE',provider:row.provider_key});
  const fault=arg('fault');if(row.provider_key==='SPX'&&fault){
   if(fault==='timeout')throw new DOMException('LOCAL_TIMEOUT','AbortError');
   if(['429','500','403','401'].includes(fault))return json({},Number(fault));
   if(fault==='malformed')return new Response('{',{status:200});
   if(fault==='stale')return json({...row.replay_payload.provider_payload,t:row.replay_payload.provider_payload.t-86400});
  }
  return json(nextDay?nextDayPayload(row.replay_payload.provider_payload):row.replay_payload.provider_payload);
 }
 if(url.hostname==='api.fugle.tw'){
  const endpoint=url.pathname.replace(/^.*\/v1\.0\//,'')+url.search;
  if(endpoint.includes('/tickers?')&&endpoint.includes('INDEX')){trace.push({kind:'AUDITED_FIXTURE',provider:'TAIEX_DISCOVERY'});return json({data:[{symbol:'IX0001',type:'INDEX',exchange:'TWSE',market:'TSE'}]});}
  const row=rows.find(r=>r.replay_payload.endpoint===endpoint);
  if(row){trace.push({kind:fixtureClose||nextDay?'AUDITED_FIXTURE':'REAL_EVIDENCE',provider:row.provider_key});if(row.provider_key==='TXF'&&arg('fault')==='txf403')return json({},403);
   const payload=nextDay?nextDayPayload(row.replay_payload.provider_payload):structuredClone(row.replay_payload.provider_payload);
   if(fixtureClose){
    // Explicit counterfactual close-only fixture. Never change retained raw
    // evidence: clone the real 13:00 shape and freeze the legal session close.
    const stamp=NativeDate.parse('2026-09-30T'+(row.provider_key==='TXF'?'13:45':'13:30')+':00+08:00')*1000;
    payload.lastUpdated=stamp;payload.closeTime=stamp;
    if(payload.lastTrade)payload.lastTrade.time=stamp;if(payload.total)payload.total.time=stamp;
   }
   return json(payload);}
  // The old V1 recorder did not retain rejected quote/discovery calls. This
  // controlled unavailable response is never labeled as a real saved response.
  trace.push({kind:'AUDITED_FIXTURE',provider:'UNRETAINED_DISCOVERY',endpoint});return json({},503);
 }
 if(url.origin!==origin)throw Error('EXTERNAL_NETWORK_DISPATCH_BLOCKED');
 if(url.pathname.startsWith('/functions/v1/'))return (await load(url.pathname.split('/').at(-1)))(new Request(url,init));
 url.pathname=url.pathname.replace(/^\/rest\/v1(?=\/)/,'');
 if((url.pathname==='/rpc/commit_market_checkpoint_batch_v1'&&arg('fault')==='cardinality')||
    (url.pathname==='/rpc/advance_trading_day_state_v1'&&arg('fault')==='wrong-correlation')){
  const payload=JSON.parse(init.body);
  if(arg('fault')==='cardinality')payload.p_rows=payload.p_rows.slice(0,10);
  else payload.p_correlation_id='10000000-0000-4000-8000-000000000001';
  init={...init,body:JSON.stringify(payload)};
 }
 if((arg('fault')==='missing-news'&&url.pathname==='/news_events')||(arg('fault')==='missing-close'&&url.pathname==='/market_checkpoint_snapshots'))return json([]);
 const headers=new Headers(init.headers||(input instanceof Request?input.headers:{}));headers.delete('authorization');headers.delete('apikey');
 trace.push({kind:'LOCAL_DB',path:url.pathname,method:init.method||'GET'});
 return nativeFetch(url,{...init,headers,redirect:'error'});
};
const dbClock=await(await fetch(origin+'/rpc/ma_chaos_clock',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
if(NativeDate.parse(dbClock)!==fixed)throw Error('EDGE_DATABASE_CLOCK_DRIFT');
if(stage==='replay'){
 const {replayRecordedProviderEvidence,recordedEvidenceContainsSensitiveData}=await import(new URL('supabase/functions/_shared/production-evidence-recorder.mjs',root));
 const {replayCriticalContract}=await import(new URL('supabase/functions/_shared/critical-contract-recorder.ts',root));
 const providers=await(await fetch(origin+'/production_provider_evidence?select=*')).json();
 const critical=await(await fetch(origin+'/production_critical_contract_evidence?select=*')).json();
 const providerResults=[];for(const row of providers){const replay=await replayRecordedProviderEvidence(row);providerResults.push({id:row.id,key:row.provider_key,deterministic:replay.deterministic,status:replay.replay_status,reason:replay.contract_reason,recorded_reason:row.contract_reason,sensitive:recordedEvidenceContainsSensitiveData(row)});}
 const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
 const criticalResults=critical.filter(r=>!r.capsule.sql_signature).map(r=>({id:r.id,stage:r.stage,deterministic:JSON.stringify(sort(replayCriticalContract(r.stage,r.capsule.input)))===JSON.stringify(sort(r.capsule.expected))}));
 const result={provider_count:providers.length,provider_diff:providerResults.filter(r=>!r.deterministic||r.sensitive),critical_edge_count:criticalResults.length,critical_edge_diff:criticalResults.filter(r=>!r.deterministic),critical_sql_pending:critical.filter(r=>r.capsule.sql_signature).length};
 await Deno.writeTextFile('/tmp/ma-six-shadow-replay.json',JSON.stringify({result,providerResults,criticalResults},null,2));stdout(result);Deno.exit(result.provider_diff.length||result.critical_edge_diff.length?1:0);
}
if(stage==='health'||stage==='retry'){
 if(stage==='retry'){
  const subs=await(await fetch(origin+'/line_subscribers?select=id')).json();
  if(!subs.length)await fetch(origin+'/line_subscribers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line_user_id:'U_LOCAL_ONLY_SIX_BUG_FAKE_RECIPIENT',display_name:'LOCAL_SYNTHETIC',is_active:true})});
 }
 const rpc=async(name,args={})=>{const r=await fetch(origin+'/rpc/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const text=await r.text(),b=text?JSON.parse(text):null;if(!r.ok)throw Error(name+':'+JSON.stringify(b));return b;};
 const dispatch=stage==='health'?await rpc('invoke_ma_ops_health_check_v2',{p_check_type:arg('check')||'report'}):await rpc('invoke_premarket_readiness_retry_v1');
 const queue=await rpc('ma_local_take_dispatch'),results=[];
 for(const request of queue){
  const r=await(await load('daily-delivery-orchestrator'))(new Request(origin+'/functions/v1/daily-delivery-orchestrator',{method:'POST',headers:request.headers,body:JSON.stringify(request.body)}));
  const b=await r.json();await rpc('ma_local_record_response',{p_id:request.id,p_status:r.status,p_body:b});results.push({http:r.status,success:b.success,error:b.error,status:b.status,failures:b.failures,health:b.health});
 }
 const reconciled=await rpc('reconcile_runtime_http_dispatches_v1');await Promise.allSettled(tasks);
 await Deno.writeTextFile('/tmp/ma-six-shadow-'+stage+'-'+(arg('check')||arg('fault')||'positive')+'.json',JSON.stringify({dispatch,results,reconciled,logs,trace},null,2));
 stdout({stage,dispatch,results:results.map(({health,...result})=>({...result,health_status:health?.status,health_checks:health?.checks?.map(x=>({name:x.name,status:x.status,error_code:x.error_code}))})),reconciled,real_line_network_calls:0});Deno.exit(0);
}
if(stage==='acceptance'){
 const r=await fetch(origin+'/rpc/capture_morning_alpha_acceptance_v1',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_business_date:'2026-09-30',p_evaluator_version:'MA_ACCEPTANCE_V1'})});
 const value=await r.json();await Deno.writeTextFile('/tmp/ma-six-shadow-acceptance.json',JSON.stringify(value,null,2));stdout({stage,http:r.status,result:value});Deno.exit(r.ok?0:1);
}
const names={preflight:'market-readiness-preflight',fetch:'fetch-market-data-v10',report:'generate-daily-report-v7',line:'line-daily-push',orchestrator:'daily-delivery-orchestrator',closing:'closing-verification-engine',learning:'continuous-learning-engine',review:'close-market-review'};
const name=names[stage];if(!name)throw Error('UNKNOWN_STAGE');
if(stage==='line'){
 const existing=await(await fetch(origin+'/line_subscribers?select=id')).json();
 if(existing.length===0){const r=await fetch(origin+'/line_subscribers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({line_user_id:'U_LOCAL_ONLY_SIX_BUG_FAKE_RECIPIENT',display_name:'LOCAL_SYNTHETIC',is_active:true})});if(!r.ok)throw Error('LOCAL_FAKE_RECIPIENT_SETUP_FAILED');}
}
const requestBody=stage==='report'?{skip_openai:true}:stage==='fetch'?{phase:arg('phase')||'premarket',checkpoint:arg('checkpoint')||'premarket'}:{};
const response=await(await load(name))(new Request(origin+'/functions/v1/'+name,{method:'POST',headers:{'content-type':'application/json','x-cron-secret':fake},body:JSON.stringify(requestBody)}));
const body=await response.json();await Promise.allSettled(tasks);
const output={stage,time,http:response.status,body,local_line_sink:sink,real_line_network_calls:0,production_token_used:0,production_recipient_used:0,production_writes:0,input_types:['REAL_EVIDENCE','AUDITED_FIXTURE'],trace,logs};
await Deno.writeTextFile('/tmp/ma-six-shadow-'+stage+'-'+(arg('fault')||arg('checkpoint')||'positive')+'.json',JSON.stringify(output,null,2));
stdout({stage,time,http:response.status,success:body.success,status:body.status,error:body.error||body.error_code,reason:body.reason,readiness:body.readiness_status,providers:body.summary,checkpoint_complete:body.checkpoint_complete,provider_health:body.provider_health,local_line_send:sink.length,recorded_tasks:tasks.length,real_line_network_calls:0});
