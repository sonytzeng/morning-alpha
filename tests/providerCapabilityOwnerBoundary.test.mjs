// SYNTHETIC ports + actual pure handler/probe. No Production, gateway, SDK,
// credential lookup, real Storage or provider request is exercised or claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createCapabilityReviewHandler, CAPABILITY_REVIEW_BUCKET as BUCKET,
 CAPABILITY_REVIEW_MARKER as MARKER, CAPABILITY_REVIEW_EXPIRES as EXPIRES,
 CAPABILITY_REVIEW_DEADLINE_MS as DEADLINE, CAPABILITY_REVIEW_CANDIDATE as CANDIDATE}
 from '../supabase/functions/v1-provider-capability-review-v1/handler.ts';
import {createFinnhubQuarterlyProbe} from '../scripts/capability/finnhub-quarterly-probe.mjs';

const ORIGIN='https://morningalphatw.com',TOKEN='synthetic.request.signature';
const URL='https://synthetic.invalid/functions/v1/v1-provider-capability-review-v1';
const NOW=Date.parse('2026-10-17T00:00:00Z'),PRIVATE='SYNTHETIC_PRIVATE_DEPENDENCY_DATA';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const ok=data=>({data,error:null});
const PLAN=[['2330','search'],['2330','eps'],['2330','revenue'],['6488','search'],['6488','eps'],['6488','revenue']];
const summary=()=>({status:'BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED',calls:6,
 observations:PLAN.map(([symbol,endpoint])=>({symbol,endpoint,http_status:200,status:'OBSERVED_ONLY',
  shape:endpoint==='search'?'SEARCH_ROWS':'QUARTERLY_ESTIMATE_ROWS',row_count:4,quarter_count:4,accepted_bytes:100,
  providerRaw:PRIVATE,url:PRIVATE,headers:{key:PRIVATE},error:PRIVATE})),
 providerRaw:PRIVATE,userId:PRIVATE,url:PRIVATE,headers:{key:PRIVATE},error:PRIVATE});
function request(options={}){
 const method=options.method??'POST',headers=new Headers({Origin:ORIGIN,
  Authorization:'Bearer '+TOKEN,'Content-Type':'application/json',...options.headers});
 if(options.noOrigin)headers.delete('Origin');
 if(options.noAuth)headers.delete('Authorization');
 if(options.noType)headers.delete('Content-Type');
 const init={method,headers,signal:options.signal};
 if(method!=='GET'&&method!=='HEAD'&&options.body!==null){init.body=options.body??'{}';if(init.body instanceof ReadableStream)init.duplex='half';}
 return new Request(options.url??URL,init);
}
function harness(options={},shared={objects:new Set()}){
 const trace=[],contexts=[];let mono=0,date=NOW;
 const record=(name,...args)=>{trace.push([name,...args]);};
 const phase=async(name,fallback,...args)=>{
  record(name,...args);
  if(options[name])return options[name](...args);
  if(options.advance===name)mono=DEADLINE;
  if(options.expire===name)date=Date.parse(EXPIRES);
  return fallback();
 };
 const deps={
  wallNow:()=>date,monotonicNow:()=>mono,
  createUserClient(authorization,context){
   record('userClient',authorization);contexts.push(context);
   return {auth:{getUser:jwt=>phase('getUser',()=>ok({user:{id:'synthetic-owner',
    app_metadata:{tier:'admin'},user_metadata:{owner:true}}}),jwt)},
    rpc:name=>{record('rpc',name);return {abortSignal:signal=>phase('owner',()=>ok(Object.hasOwn(options,'isOwner')?options.isOwner:true),signal)};}};
  },
  createClaimStore(context){
   record('serviceClient');contexts.push(context);
   return {
    getBucket:bucket=>phase('bucket',()=>ok({id:BUCKET,public:false}),bucket),
    list:(bucket,prefix,settings)=>phase('list',()=>ok([...shared.objects].map(name=>({name}))),bucket,prefix,settings),
    upload:(bucket,path,bytes,settings)=>phase('upload',()=>{
     if(shared.objects.has(path))return {data:null,error:Error(PRIVATE)};
     shared.objects.add(path);return ok({path});
    },bucket,path,bytes,settings),
   };
  },
  createProbe(context){
   record('probeFactory');contexts.push(context);
   if(options.createProbe)return options.createProbe(context);
   return {run:settings=>phase('probe',()=>summary(),settings)};
  },
 };
 return {deps,handle:createCapabilityReviewHandler(deps),trace,contexts,shared,
  setMono:value=>{mono=value;},setDate:value=>{date=value;},
  calls:name=>trace.filter(row=>row[0]===name)};
}
async function response(response,status){
 assert.equal(response.status,status);const body=await response.json();
 assert.equal(body.candidate_only,true);assert.equal(body.formal_admission,false);
 assert.equal(body.member_publication,false);assert.equal(body.business_writes,0);
 const text=JSON.stringify(body);assert(!text.includes(PRIVATE));assert(!text.includes(TOKEN));
 assert(!text.includes('synthetic-owner'));return body;
}
function noProvider(h){assert.equal(h.calls('probeFactory').length,0);assert.equal(h.calls('probe').length,0);}
function noPrivilege(h){assert.equal(h.calls('serviceClient').length,0);assert.equal(h.calls('upload').length,0);noProvider(h);}

test('synthetic Owner request uses the same Bearer, strict existing RPC, private once claim and safe counts only',async()=>{
 const h=harness(),reply=await h.handle(request()),body=await response(reply,200);
 assert.equal(reply.headers.get('access-control-allow-origin'),ORIGIN);assert.equal(reply.headers.get('cache-control'),'no-store');
 assert.deepEqual(h.calls('userClient'),[['userClient','Bearer '+TOKEN]]);
 assert.deepEqual(h.calls('getUser'),[['getUser',TOKEN]]);
 assert.deepEqual(h.calls('rpc'),[['rpc','is_research_owner_v1']]);
 assert.deepEqual(h.calls('bucket'),[['bucket',BUCKET]]);
 assert.deepEqual(h.calls('list'),[['list',BUCKET,'',{limit:2,offset:0}]]);
 const [,bucket,path,bytes,settings]=h.calls('upload')[0];
 assert.equal(bucket,BUCKET);assert.equal(path,MARKER);assert.equal(new TextDecoder().decode(bytes),'{"used":true}');
 assert.deepEqual(settings,{upsert:false,contentType:'application/json',cacheControl:'0'});
 assert.equal(body.control_object_write,'CONSUMED');assert.equal(body.summary.calls,6);
 assert.equal(body.summary.row_count,24);assert.equal(body.summary.tw72_coverage,'UNKNOWN');
 assert.equal(body.summary.pure_broker_consensus,false);
 assert.deepEqual(body.summary.observations.map(row=>[row.local_symbol,row.endpoint]),PLAN);
 assert(body.summary.observations.every(row=>Object.keys(row).sort().join(',')===
  ['local_symbol','endpoint','http_status','status','shape','row_count','quarter_count','accepted_bytes'].sort().join(',')));
 assert(h.trace.findIndex(r=>r[0]==='owner')<h.trace.findIndex(r=>r[0]==='serviceClient'));
 assert(h.trace.findIndex(r=>r[0]==='upload')<h.trace.findIndex(r=>r[0]==='probeFactory'));
 assert(h.contexts.every(context=>context.signal.aborted),'all transports are aborted when the request closes');
 await response(await h.handle(request()),409);assert.equal(h.calls('upload').length,1);assert.equal(h.calls('probe').length,1);
});

test('synthetic missing/wrong Bearer and invalid Auth never construct privileged clients',async()=>{
 for(const authorization of ['', 'Basic synthetic', 'Bearer anon-key', 'Bearer a.b.c extra','bearer a.b.c']){
  const h=harness();await response(await h.handle(request({headers:{Authorization:authorization}})),401);
  assert.equal(h.calls('userClient').length,0);noPrivilege(h);
 }
 for(const getUser of [async()=>({data:{user:null},error:null}),async()=>({data:{user:{id:'x'}},error:Error(PRIVATE)}),
  async()=>({data:{user:{id:''}},error:null}),async()=>{throw Error(PRIVATE);}]){
  const h=harness({getUser});await response(await h.handle(request()),401);
  assert.equal(h.calls('rpc').length,0);noPrivilege(h);
 }
});

test('synthetic non-Owner, role/metadata substitutes and nonboolean RPC values deny 403',async()=>{
 for(const isOwner of [false,null,0,1,'true',{},[true],{is_research_owner_v1:true}]){
  const h=harness({isOwner});await response(await h.handle(request()),403);noPrivilege(h);
 }
 for(const owner of [async()=>({data:true,error:Error(PRIVATE)}),async()=>{throw Error(PRIVATE);}]){
  const h=harness({owner});await response(await h.handle(request()),403);noPrivilege(h);
 }
});

test('synthetic method and exact Origin reject before Auth or side effects',async()=>{
 for(const method of ['GET','HEAD','PUT','DELETE']){
  const h=harness(),reply=await h.handle(request({method}));
  assert.equal(reply.status,405);assert.equal(reply.headers.get('allow'),'POST, OPTIONS');noPrivilege(h);assert.equal(h.calls('userClient').length,0);
 }
 for(const origin of ['', 'https://www.morningalphatw.com','http://morningalphatw.com','https://morningalphatw.com.attacker.invalid','null']){
  const h=harness(),reply=await h.handle(request({headers:{Origin:origin}}));await response(reply,403);
  assert.equal(reply.headers.get('access-control-allow-origin'),null);noPrivilege(h);assert.equal(h.calls('userClient').length,0);
 }
});

test('synthetic fixed-Origin POST preflight returns empty 204 with zero Auth/Storage/probe calls',async()=>{
 for(const requested of ['authorization, apikey, content-type, x-client-info','Authorization,Content-Type','']){
  const h=harness(),reply=await h.handle(request({method:'OPTIONS',body:null,noAuth:true,headers:{
   'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':requested}}));
  assert.equal(reply.status,204);assert.equal(await reply.text(),'');
  assert.equal(reply.headers.get('access-control-allow-origin'),ORIGIN);
  assert.equal(reply.headers.get('access-control-allow-methods'),'POST, OPTIONS');
  assert.equal(h.trace.length,0);noPrivilege(h);
 }
 for(const headers of [
  {Origin:'https://attacker.invalid','Access-Control-Request-Method':'POST'},
  {'Access-Control-Request-Method':'GET'}, {'Access-Control-Request-Method':'post'}, {},
  {'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,x-target'},
  {'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'cookie'},
  {'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,authorization'},
  {'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,'},
 ]){
  const h=harness();await response(await h.handle(request({method:'OPTIONS',body:null,headers})),403);
  assert.equal(h.trace.length,0);noPrivilege(h);
 }
 const h=harness();await response(await h.handle(request({method:'OPTIONS',body:'{}',headers:{'Access-Control-Request-Method':'POST'}})),403);
 assert.equal(h.trace.length,0);noPrivilege(h);
});

test('synthetic exact two-byte {} body only; no body/whitespace/targets/query/header encoding accepted',async()=>{
 for(const options of [{body:null},{body:''},{body:'{ }'},{body:'{}\n'},{body:'[]'},
  {body:'{"symbol":"2330"}'},{body:'é'},{body:'{}',noType:true},
  {headers:{'Content-Length':'3'}},{headers:{'Content-Encoding':'gzip'}},
  {url:URL+'?symbol=2330.TW'},{url:URL+'/arbitrary-target'}]){
  const h=harness();await response(await h.handle(request(options)),400);
  assert.equal(h.calls('userClient').length,0);noPrivilege(h);
 }
});

test('synthetic fixed expiry rejects at boundary and after late Auth before Owner RPC',async()=>{
 assert.equal(EXPIRES,'2026-10-18T06:00:00Z');assert.equal(DEADLINE,15000);
 assert.equal(CANDIDATE.verify_jwt,true);assert.equal(CANDIDATE.deployment_authorized,false);
 for(const now of [Date.parse(EXPIRES),Date.parse(EXPIRES)+1,NaN]){
  const h=harness();h.setDate(now);await response(await h.handle(request()),410);
  assert.equal(h.calls('getUser').length,0);noPrivilege(h);
 }
 const h=harness({expire:'getUser'});await response(await h.handle(request()),410);
 assert.equal(h.calls('rpc').length,0);noPrivilege(h);
});

test('synthetic public/missing/uncertain bucket and any object/folder deny before upload',async()=>{
 for(const bucket of [async()=>ok({id:BUCKET,public:true}),async()=>ok({id:BUCKET}),
  async()=>ok({id:'different-bucket',public:false}),async()=>({data:null,error:Error(PRIVATE)})]){
  const h=harness({bucket});await response(await h.handle(request()),409);assert.equal(h.calls('list').length,0);noProvider(h);
 }
 for(const list of [async()=>ok([{name:'unexpected'}]),async()=>ok([{name:'folder',id:null}]),
  async()=>ok([{name:MARKER}]),async()=>ok(null),async()=>({data:[],error:Error(PRIVATE)})]){
  const h=harness({list});await response(await h.handle(request()),409);assert.equal(h.calls('upload').length,0);noProvider(h);
 }
});

test('synthetic independent concurrent isolates share an atomic no-upsert marker: only one probe',async()=>{
 const shared={objects:new Set()},barrier=deferred();let lists=0;
 const list=async()=>{if(++lists===2)barrier.resolve();await barrier.promise;return ok([]);};
 const a=harness({list},shared),b=harness({list},shared);
 const replies=await Promise.all([a.handle(request()),b.handle(request())]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
 assert.equal(a.calls('probe').length+b.calls('probe').length,1);
 assert.deepEqual([...shared.objects],[MARKER]);
 assert.equal(a.calls('upload').length+b.calls('upload').length,2);
});

test('synthetic uncertain/failed claim is never retried locally and never starts provider',async()=>{
 for(const upload of [async()=>({data:null,error:Error(PRIVATE)}),async()=>ok({path:'unexpected'}),async()=>{throw Error(PRIVATE);}]){
  const h=harness({upload}),first=await h.handle(request());assert([409,503].includes(first.status));
  const body=await first.json();assert.equal(body.control_object_write,'POSSIBLE');assert(!JSON.stringify(body).includes(PRIVATE));
  noProvider(h);await response(await h.handle(request()),409);assert.equal(h.calls('upload').length,1);
 }
});

test('synthetic absolute deadline at every phase prevents all subsequent calls',async()=>{
 const order=['getUser','owner','bucket','list','upload','probe'];
 for(const advance of order){
  const h=harness({advance});await response(await h.handle(request()),504);
  for(const later of order.slice(order.indexOf(advance)+1))assert.equal(h.calls(later).length,0,advance+' -> '+later);
  assert(h.contexts.every(context=>context.signal.aborted));
 }
});

test('synthetic remaining probe budget includes Auth and Storage time, not another 15 seconds',async()=>{
 const h=harness({getUser:async()=>{h.setMono(1000);return ok({user:{id:'owner'}});},
  owner:async()=>{h.setMono(2000);return ok(true);},bucket:async()=>{h.setMono(3000);return ok({id:BUCKET,public:false});},
  list:async()=>{h.setMono(4000);return ok([]);},upload:async()=>{h.setMono(5000);return ok({path:MARKER});}});
 await response(await h.handle(request()),200);
 const settings=h.calls('probe')[0][1];assert.equal(settings.remainingMs,10000);assert(settings.signal instanceof AbortSignal);
});

test('synthetic hanging Auth is aborted; late completion cannot start Owner RPC or Storage',async()=>{
 const waiting=deferred(),started=deferred(),abort=new AbortController();
 const h=harness({getUser:()=>{started.resolve();return waiting.promise;}});
 const running=h.handle(request({signal:abort.signal}));await started.promise;abort.abort();
 await response(await running,504);waiting.resolve(ok({user:{id:'owner'}}));await tick();
 assert.equal(h.calls('rpc').length,0);noPrivilege(h);assert(h.contexts[0].signal.aborted);
});

test('synthetic real 15000ms deadline aborts a hung dependency without needing caller cancellation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const waiting=deferred(),started=deferred();
 const h=harness({getUser:()=>{started.resolve();return waiting.promise;}});
 const running=h.handle(request());await started.promise;t.mock.timers.tick(15000);
 await response(await running,504);assert(h.contexts[0].signal.aborted);
 waiting.resolve(ok({user:{id:'owner'}}));await tick();assert.equal(h.calls('rpc').length,0);noPrivilege(h);
});

test('synthetic regressing/nonfinite clocks fail closed before any privileged continuation',async()=>{
 for(const value of [-1,NaN,Infinity]){
  const h=harness({getUser:async()=>{h.setMono(value);return ok({user:{id:'owner'}});}});
  await response(await h.handle(request()),504);assert.equal(h.calls('rpc').length,0);noPrivilege(h);
 }
});

test('synthetic hanging body/probe abort cancels active work and cannot continue later',async()=>{
 let cancelled=false;
 const abort=new AbortController(),body=new ReadableStream({start(c){c.enqueue(new Uint8Array([123]));},cancel(){cancelled=true;}});
 const h=harness(),running=h.handle(request({body,signal:abort.signal}));await tick();abort.abort();
 await response(await running,504);assert(cancelled);noPrivilege(h);assert.equal(h.calls('getUser').length,0);
 const waiting=deferred(),started=deferred(),abortProbe=new AbortController();let settings;
 const p=harness({probe:options=>{settings=options;started.resolve();return waiting.promise;}});
 const pending=p.handle(request({signal:abortProbe.signal}));await started.promise;abortProbe.abort();
 await response(await pending,504);assert(settings.signal.aborted);
 waiting.resolve(summary());await tick();assert.equal(p.calls('probe').length,1);
});

test('synthetic late Owner/Storage completion after abort cannot advance to claim or provider',async()=>{
 const order=['owner','bucket','list','upload'];
 const results={owner:()=>ok(true),bucket:()=>ok({id:BUCKET,public:false}),list:()=>ok([]),upload:()=>ok({path:MARKER})};
 for(const phase of order){
  const waiting=deferred(),started=deferred(),abort=new AbortController();
  const h=harness({[phase]:()=>{started.resolve();return waiting.promise;}});
  const running=h.handle(request({signal:abort.signal}));await started.promise;abort.abort();
  await response(await running,504);waiting.resolve(results[phase]());await tick();
  for(const later of order.slice(order.indexOf(phase)+1))assert.equal(h.calls(later).length,0,phase+' -> '+later);
  noProvider(h);assert(h.contexts.every(context=>context.signal.aborted));
 }
});

test('synthetic malformed/raw probe output is never reflected and marker remains consumed',async()=>{
 for(const value of [{status:PRIVATE,calls:0,observations:[]},{status:'OBSERVED_ONLY',calls:7,observations:[]},
  {status:'OBSERVED_ONLY',calls:1,observations:[{status:'OBSERVED_ONLY',row_count:1000}]},null]){
  const h=harness({probe:async()=>value});const body=await response(await h.handle(request()),502);
  assert.equal(body.control_object_write,'CONSUMED');assert.equal(body.summary,undefined);
 }
 const h=harness({probe:async()=>{throw Error(PRIVATE);}});
 const body=await response(await h.handle(request()),503);assert.equal(body.control_object_write,'CONSUMED');
});

test('synthetic per-target projection preserves fixed identity and safe HTTP/empty classification without raw data',async()=>{
 for(let index=0;index<PLAN.length;index++)for(const http of [401,403,404]){
  const probe=summary();probe.calls=index+1;probe.observations=probe.observations.slice(0,index+1);probe.status='HTTP_STOP';
  Object.assign(probe.observations[index],{status:'HTTP_STOP',http_status:http,shape:null,row_count:0,quarter_count:0});
  const h=harness({probe:async()=>probe}),body=await response(await h.handle(request()),200);
  const row=body.summary.observations[index];assert.equal(row.local_symbol,PLAN[index][0]);
  assert.equal(row.endpoint,PLAN[index][1]);assert.equal(row.http_status,http);assert.equal(row.shape,null);
  assert.equal(row.status,'HTTP_STOP');assert.equal(body.summary.observations.length,index+1);
 }
 const probe=summary();for(const row of probe.observations)Object.assign(row,{shape:'EMPTY',row_count:0,quarter_count:0});
 const h=harness({probe:async()=>probe}),body=await response(await h.handle(request()),200);
 assert(body.summary.observations.every(row=>row.shape==='EMPTY'&&row.row_count===0&&row.quarter_count===0));
 assert.equal(body.summary.tw72_coverage,'UNKNOWN');assert.equal(body.formal_admission,false);
});

test('synthetic unknown, duplicate, reordered or unbounded observations are rejected, not repaired or reflected',async()=>{
 const changes=[
  value=>{value.observations[0].symbol='OTHER';},value=>{value.observations[0].endpoint='OTHER';},
  value=>{value.observations[1]={...value.observations[0]};},
  value=>{[value.observations[0],value.observations[1]]=[value.observations[1],value.observations[0]];},
  value=>{value.observations.push(value.observations[0]);value.calls=7;},value=>{value.calls=1;},
  value=>{value.observations[0].http_status=99;},value=>{value.observations[0].http_status=600;},
  value=>{value.observations[0].http_status='401';},value=>{value.observations[0].http_status=200.5;},
  value=>{value.observations[0].status=PRIVATE;},value=>{value.observations[0].shape=PRIVATE;},
  value=>{value.observations[0].row_count=65;},value=>{value.observations[0].row_count=null;},
  value=>{value.observations[0].quarter_count=-1;},value=>{value.observations[0].accepted_bytes=65537;},
 ];
 for(const change of changes){
  const value=summary();change(value);const h=harness({probe:async()=>value});
  const body=await response(await h.handle(request()),502);assert.equal(body.summary,undefined);
 }
});

test('synthetic actual entry code: wrong project/root cannot read credentials, create SDK clients or send transport',async()=>{
 const source=readFileSync(new globalThis.URL('../supabase/functions/v1-provider-capability-review-v1/index.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.deepEqual(compiled.diagnostics,[]);
 for(const url of ['https://attacker.invalid','https://cttfzgvhiewfckydcrci.supabase.co.attacker.invalid',
  'http://cttfzgvhiewfckydcrci.supabase.co','https://cttfzgvhiewfckydcrci.supabase.co/other',
  'https://cttfzgvhiewfckydcrci.supabase.co?target=other','https://user:password@cttfzgvhiewfckydcrci.supabase.co',
  'not-a-url']){
  const reads=[];let handler,sdk=0,provider=0,transports=0;
  // Executes the actual entry code with a synthetic SDK shim, NOT a real SDK or
  // deployment check. Unknown imports and all transport are explicitly denied.
  const modules={
   'https://esm.sh/@supabase/supabase-js@2.115.0':{createClient(){sdk++;throw Error('SYNTHETIC_SDK_DENIED');}},
   '../../../scripts/capability/finnhub-quarterly-probe.mjs':{createFinnhubQuarterlyProbe(){provider++;throw Error('SYNTHETIC_PROBE_DENIED');}},
   './handler.ts':{CAPABILITY_REVIEW_BUCKET:BUCKET,CAPABILITY_REVIEW_MARKER:MARKER,
    createCapabilityReviewHandler:deps=>createCapabilityReviewHandler({...deps,wallNow:()=>NOW,monotonicNow:()=>0})},
  };
  new Function('require','exports','Deno','fetch',compiled.outputText)(name=>{assert(Object.hasOwn(modules,name));return modules[name];},{},
   {env:{get:name=>{reads.push(name);return name==='SUPABASE_URL'?url:'SYNTHETIC_NOT_A_CREDENTIAL';}},serve:fn=>{handler=fn;}},
   ()=>{transports++;throw Error('SYNTHETIC_NETWORK_DENIED');});
  assert.deepEqual(reads,[],'importing/binding the entry must not read environment credentials');
  await response(await handler(request()),503);
  assert.deepEqual(reads,['SUPABASE_URL']);assert.equal(sdk,0);assert.equal(provider,0);assert.equal(transports,0);
 }
});

test('synthetic actual fixed-six probe integrates only after Owner and durable claim; real network forbidden',async()=>{
 const network=globalThis.fetch;globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
 try{
  let calls=0,credentials=0;
  const h=harness({createProbe:context=>createFinnhubQuarterlyProbe({clock:()=>0,
   getCredential:()=>{credentials++;context.assertActive();return 'SYNTHETIC_KEY_NOT_REAL_123';},
   fetch:async(target,init)=>{
    context.assertActive();calls++;assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
    const url=new globalThis.URL(target),symbol=url.searchParams.get('symbol');
    return url.pathname.endsWith('/search')?Response.json({count:1,result:[{symbol:url.searchParams.get('q')==='2330'?'2330.TW':'6488.TWO'}]}):
     Response.json({symbol,freq:'quarterly',data:[{year:2026,quarter:1,period:'2026-03-31',[url.pathname.includes('eps-')?'epsAvg':'revenueAvg']:100}]});
   },
  })});
  const body=await response(await h.handle(request()),200);assert.equal(calls,6);assert.equal(credentials,1);
  assert.equal(body.summary.calls,6);assert.equal(body.summary.probe_status,'BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED');
  assert.equal(body.summary.symbol_mapping,'HYPOTHESIS_UNVERIFIED');
 }finally{globalThis.fetch=network;}
});

test('candidate binding pins SDK and limits runtime code to Auth predicate/Storage marker; no cleanup/business APIs',()=>{
 const source=readFileSync(new globalThis.URL('../supabase/functions/v1-provider-capability-review-v1/index.ts',import.meta.url),'utf8');
 assert.match(source,/supabase-js@2\.115\.0/);assert.match(source,/Deno\.env\.get\('FINNHUB_API_KEY'\)/);
 assert.doesNotMatch(source,/console\.|\.from\(['"](?:reports|profiles|subscriptions|research|predictions|outcomes)/);
 assert.doesNotMatch(source,/ensure_|createBucket|emptyBucket|deleteBucket|\.remove\(|\.upsert\(/);
 assert.match(source,/GET \/auth\/v1\/user/);assert.match(source,/POST \/rest\/v1\/rpc\/is_research_owner_v1/);
 assert.match(source,/context\.signal/);assert.equal(CANDIDATE.control_object_write,'PRIVATE_ONCE_MARKER_ONLY');
});
