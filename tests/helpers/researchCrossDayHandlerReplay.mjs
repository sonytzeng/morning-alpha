// Explicit opt-in local full Handler replay. Input fixture loading is documented
// in docs/operations/research-evidence-recovery-20260930.md.
const root=new URL('../../',import.meta.url).href;
if(!Deno.args.includes('--scope=ma-research-clock-20260930'))throw Error('EXPLICIT_ISOLATION_SCOPE_REQUIRED');
const origin='http://127.0.0.1:55445', fake='LOCAL_TEST_ONLY_NOT_PRODUCTION';
const NativeDate=Date;
const env={SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:fake,CRON_SECRET:fake,LINE_CHANNEL_ACCESS_TOKEN:'LOCAL_FAKE_LINE_TOKEN'};
Deno.env.get=key=>env[key];
const originalFetch=globalThis.fetch.bind(globalThis), trace=[], sink=[];
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.href==='https://api.line.me/v2/bot/message/multicast'){
   // In-memory transport terminates BEFORE native fetch. Deno network ACL
   // additionally forbids api.line.me even if this interceptor regresses.
   const payload=JSON.parse(init.body);
   if(new Headers(init.headers).get('authorization')!=='Bearer LOCAL_FAKE_LINE_TOKEN'
     ||payload.to.length!==1||payload.to[0]!=='U_LOCAL_ONLY_RESEARCH_0930_FAKE_RECIPIENT')throw Error('NONLOCAL_LINE_IDENTITY');
   sink.push({recipients:payload.to.length,messages:payload.messages.length});
   return new Response('{}',{status:200});
 }
 if(url.origin!==origin)throw Error('EXTERNAL_DISPATCH_BLOCKED');
 url.pathname=url.pathname.replace(/^\/rest\/v1(?=\/)/,'');
 // Explicit negative controls, never labeled as original Production evidence.
 if((Deno.args.includes('--missing-news')&&url.pathname==='/news_events')
   ||(Deno.args.includes('--missing-close')&&url.pathname==='/market_checkpoint_snapshots')){
   return new Response('[]',{status:200,headers:{'content-type':'application/json'}});
 }
 const headers=new Headers(init.headers||(input instanceof Request?input.headers:{}));headers.delete('authorization');headers.delete('apikey');
 trace.push({path:url.pathname,method:init.method||'GET'});
 return originalFetch(url,{...init,headers,redirect:'error'});
};
const fixed=NativeDate.parse(await (await fetch(origin+'/rpc/ma_chaos_clock',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json());
const wall=NativeDate.now();
globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[fixed+NativeDate.now()-wall]));}static now(){return fixed+NativeDate.now()-wall;}};
let handler;Deno.serve=fn=>{handler=fn;return {};};
const logs=[];console.log=(...args)=>{logs.push(args.map(String).join(' '));};
await import(root+'supabase/functions/generate-daily-report-v7/index.ts');
const response=await handler(new Request(origin+'/functions/v1/generate-daily-report-v7',{method:'POST',headers:{'content-type':'application/json','x-cron-secret':fake},body:JSON.stringify({skip_openai:true})}));
const body=await response.json();
const summary={http:response.status,success:body.success,error_code:body.error_code,reason_codes:body.reason_codes,report_reason_codes:body.report_reason_codes,recommendation_status:body.recommendation_status,report_status:body.report_status,report_id:body.report_id,
 logs:(body.logs||logs).filter(l=>/SECTOR_RECONSTRUCTION|NEWS raw=|DATA_QUALITY|RESEARCH_MASTER|CANONICAL|PUBLICATION|WRITE_|error|ERROR|FAILED|failed|UNAVAILABLE/.test(l)),external_dispatch:0,trace};
await Deno.writeTextFile('/tmp/ma-0930-handler-'+(Deno.args[0]||'baseline')+'.json',JSON.stringify(summary,null,2));
Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(summary,null,2)+'\n'));
if(Deno.args.includes('--missing-news')||Deno.args.includes('--missing-close')){
 if(response.status!==409||body.error_code!=='RESEARCH_QUALITY_REJECTED')throw Error('MISSING_EVIDENCE_NOT_REJECTED');
 Deno.exit(0);
}
if(response.status!==200||body.success!==true)throw Error('REPORT_HANDLER_NOT_READY');
const retry=await handler(new Request(origin+'/functions/v1/generate-daily-report-v7',{method:'POST',headers:{'content-type':'application/json','x-cron-secret':fake},body:JSON.stringify({skip_openai:true})}));
const retried=await retry.json();
if(retry.status!==200||retried.report_id!==body.report_id)throw Error('REPORT_RETRY_NOT_IDEMPOTENT');
if(Deno.args.includes('--line')){
 await import(root+'supabase/functions/line-daily-push/index.ts');
 const results=[];
 for(let i=0;i<2;i++){
  const response=await handler(new Request(origin+'/functions/v1/line-daily-push',{method:'POST',headers:{'content-type':'application/json','x-cron-secret':fake},body:'{}'}));
  const body=await response.json();results.push({http:response.status,success:body.success,sent:body.sent,sent_count:body.sent_count,reason:body.reason,error:body.error,detail:body.detail});
 }
 if(results[0].sent_count!==1||results[1].sent_count!==0||sink.length!==1)throw Error('LINE_SINK_IDEMPOTENCY_FAILED');
 const line={results,local_sink:sink.length,real_line_network_calls:0,production_token_used:0,production_recipient_used:0};
 await Deno.writeTextFile('/tmp/ma-0930-line-result.json',JSON.stringify(line,null,2));
 Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(line,null,2)+'\n'));
}
