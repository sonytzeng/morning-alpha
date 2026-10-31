// Real Auth transport adapter + installed SDK; all HTTP responses and clocks
// are synthetic and in memory. This is not Production Auth or capacity evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const serviceUrl='https://synthetic.supabase.test';
const authUrl=serviceUrl+'/auth/v1/user';
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const user={id:'00000000-0000-0000-0000-000000000099',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{},identities:[],created_at:'2026-10-31T00:00:00Z'};

function harness(fetcher=()=>{throw Error('NETWORK_FORBIDDEN');}){
 const timers=new Map(),cache=new Map();let timerId=0,capturedClient;
 const globals={Promise,Error,DOMException,AbortController,AbortSignal,URL,Request,Response,Headers,ReadableStream,Uint8Array,ArrayBuffer,
  fetch:fetcher,console,
  setTimeout:(fn,ms)=>{assert.equal(ms,15000,'Auth transport deadline remains bounded to 15 seconds');timers.set(++timerId,fn);return timerId;},
  clearTimeout:id=>timers.delete(id)};
 function load(path){
  const absolute=resolve(root,path);if(cache.has(absolute))return cache.get(absolute).exports;
  const module={exports:{}};cache.set(absolute,module);
  const source=ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{...globals,module,exports:module.exports,require(name){
   if(name==='@supabase/supabase-js')return {createClient:(url,key,options)=>{capturedClient={url,key,options};return {};}};
   if(name.startsWith('@/'))return load('src/'+name.slice(2)+'.ts');
   if(name.startsWith('.'))return load(resolve(dirname(absolute),name+(name.endsWith('.ts')?'':'.ts')));
   throw Error('UNAPPROVED_TEST_IMPORT:'+name);
  }},{filename:absolute});
  return module.exports;
 }
 return {load,get timerCount(){return timers.size;},get capturedClient(){return capturedClient;},
  expire(){assert.equal(timers.size,1,'One active Auth request has one transport deadline');const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
}

test('Supabase keeps its installed SDK, service URL, key, auth and lock settings while configuring global Auth transport',()=>{
 const h=harness();h.load('src/lib/supabase.ts');const configured=h.capturedClient;
 const sdk=JSON.parse(readFileSync(resolve(root,'node_modules/@supabase/supabase-js/package.json'),'utf8'));
 assert.equal(sdk.version,'2.57.4');
 assert.equal(configured.url,'https://cttfzgvhiewfckydcrci.supabase.co');
 assert.equal(createHash('sha256').update(configured.key).digest('hex'),'6a66a09890db8fb538377e3eb290d2740ace41c22478cf2ed6d5a8c1ebe86e36');
 assert.deepEqual(JSON.parse(JSON.stringify(configured.options.auth)),{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true});
 assert.equal(Object.hasOwn(configured.options.auth,'lock'),false);
 assert.equal(typeof configured.options.global.fetch,'function');
});

test('successful Auth response preserves body, headers and fetch response metadata and clears its timer',async()=>{
 const response=new Response(JSON.stringify({user}),{status:201,statusText:'Synthetic Created',headers:{'content-type':'application/json','x-synthetic':'retained'}});
 Object.defineProperties(response,{url:{value:authUrl},redirected:{value:true},type:{value:'cors'}});
 let receivedInput,receivedInit;
 const h=harness(async(input,init)=>{receivedInput=input;receivedInit=init;return response;});
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 const init={method:'POST',headers:{Authorization:'Bearer synthetic-local-only'},body:'{}',credentials:'omit'};
 const result=await bounded(authUrl,init);
 assert.equal(receivedInput,authUrl);assert.equal(receivedInit.method,init.method);assert.equal(receivedInit.headers,init.headers);
 assert.equal(receivedInit.body,init.body);assert.equal(receivedInit.credentials,init.credentials);
 assert(receivedInit.signal instanceof AbortSignal);assert.equal(receivedInit.signal.aborted,false);
 assert.equal(result.status,201);assert.equal(result.statusText,'Synthetic Created');assert.equal(result.headers.get('x-synthetic'),'retained');
 assert.equal(result.url,authUrl);assert.equal(result.redirected,true);assert.equal(result.type,'cors');
 assert.deepEqual(await result.json(),{user});assert.equal(h.timerCount,0);
});

for(const stage of ['fetch','body'])test(`Auth ${stage} stall aborts the underlying request at 15s and allows a fresh retry`,async()=>{
 const stalled=deferred();let calls=0,signal;
 const h=harness(async(_input,init)=>{
  calls++;signal=init.signal;
  if(calls===1&&stage==='fetch')return stalled.promise;
  const response=new Response('{}',{status:200});
  if(calls===1)response.arrayBuffer=()=>stalled.promise;
  return response;
 });
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 const request=bounded(authUrl);const rejected=assert.rejects(request,/REQUEST_TIMEOUT/);
 await flush();h.expire();await rejected;
 assert.equal(signal.aborted,true);assert.equal(h.timerCount,0);
 assert.deepEqual(await (await bounded(authUrl)).json(),{});assert.equal(calls,2);assert.equal(h.timerCount,0);
 stalled.resolve(stage==='fetch'?new Response('{}'):new ArrayBuffer(0));await flush();
 await assert.rejects(request,/REQUEST_TIMEOUT/);assert.equal(h.timerCount,0);
});

test('a deadline removes caller listeners even if an uncooperative body has not settled yet',async()=>{
 const caller=new AbortController(),listeners=new Set(),stalled=deferred();
 const add=caller.signal.addEventListener.bind(caller.signal),remove=caller.signal.removeEventListener.bind(caller.signal);
 caller.signal.addEventListener=(type,fn,options)=>{if(type==='abort')listeners.add(fn);return add(type,fn,options);};
 caller.signal.removeEventListener=(type,fn,options)=>{if(type==='abort')listeners.delete(fn);return remove(type,fn,options);};
 const h=harness(async()=>{const response=new Response('{}');response.arrayBuffer=()=>stalled.promise;return response;});
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 const request=bounded(authUrl,{signal:caller.signal}),rejected=assert.rejects(request,/REQUEST_TIMEOUT/);
 await flush();h.expire();await rejected;
 assert.equal(listeners.size,0,'Completed outer request must release its caller listener before late body completion');
 assert.equal(h.timerCount,0);stalled.resolve(new ArrayBuffer(0));await flush();assert.equal(listeners.size,0);
});

test('ordinary Auth fetch failures preserve the original error and clear the transport timer',async()=>{
 const failure=Error('SYNTHETIC_FETCH_FAILURE');
 const h=harness(async()=>{throw failure;});
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 await assert.rejects(bounded(authUrl),error=>error===failure);assert.equal(h.timerCount,0);
});

for(const fromRequest of [false,true])test(`caller cancellation through ${fromRequest?'Request.signal':'RequestInit.signal'} aborts transport and removes its deadline`,async()=>{
 const caller=new AbortController();let signal;
 const h=harness((_input,init)=>new Promise((_resolve,reject)=>{
  signal=init.signal;
  if(signal.aborted)reject(new DOMException('caller aborted','AbortError'));
  else signal.addEventListener('abort',()=>reject(new DOMException('caller aborted','AbortError')),{once:true});
 }));
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 const request=fromRequest?bounded(new Request(authUrl,{signal:caller.signal})):bounded(authUrl,{signal:caller.signal});
 const rejected=assert.rejects(request,error=>error.name==='AbortError');
 await flush();caller.abort();await rejected;
 assert.equal(signal.aborted,true);assert.equal(h.timerCount,0);
});

test('already-cancelled callers cannot dispatch a live Auth request',async()=>{
 const caller=new AbortController();caller.abort();let activeDispatches=0;
 const h=harness(async(_input,init)=>{
  if(init.signal.aborted)throw new DOMException('already aborted','AbortError');
  activeDispatches++;return new Response('{}');
 });
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 await assert.rejects(bounded(authUrl,{signal:caller.signal}),error=>error.name==='AbortError');
 assert.equal(activeDispatches,0);assert.equal(h.timerCount,0);
});

test('bodyless Auth responses remain legal responses',async()=>{
 for(const status of [204,205,304]){
  const h=harness(async()=>new Response(null,{status}));
  const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
  const response=await bounded(serviceUrl+'/auth/v1/logout',{method:'POST'});
  assert.equal(response.status,status);assert.equal(await response.text(),'');assert.equal(h.timerCount,0);
 }
});

test('non-Auth and lookalike-origin requests keep their original Response and streaming behavior',async()=>{
 for(const url of [serviceUrl+'/rest/v1/reports',serviceUrl+'/functions/v1/get-report-payload',serviceUrl+'/storage/v1/object/example',
  'https://synthetic.supabase.test.evil.test/auth/v1/user','https://evil.test/auth/v1/user',serviceUrl+'/auth/v10/user']){
  const response=new Response(new ReadableStream({start(){}}));let receivedInput,receivedInit;
  const h=harness(async(input,init)=>{receivedInput=input;receivedInit=init;return response;});
  const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
  const init={headers:{'x-synthetic':'keep'}};const result=await bounded(url,init);
  assert.equal(result,response);assert.equal(receivedInput,url);assert.equal(receivedInit,init);
  assert.equal(result.bodyUsed,false);assert.equal(h.timerCount,0);await response.body.cancel();
 }
});

test('actual installed Supabase Auth client calls configured global fetch and gets a usable user response',async()=>{
 let calls=0,seen;
 const h=harness(async(input,init)=>{calls++;seen={input,init};return new Response(JSON.stringify(user),{headers:{'content-type':'application/json'}});});
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 const client=createClient(serviceUrl,'sb_publishable_SYNTHETIC_NOT_A_SECRET',{
  global:{fetch:bounded},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 });
 const result=await client.auth.getUser('synthetic-token');
 assert.equal(calls,1);assert.equal(seen.input,authUrl);assert.equal(new Headers(seen.init.headers).get('authorization'),'Bearer synthetic-token');
 assert.equal(result.error,null);assert.equal(result.data.user.id,user.id);assert.equal(h.timerCount,0);
 await client.auth.stopAutoRefresh();
});

test('actual installed Auth SDK surfaces a transport timeout and can successfully retry',async t=>{
 t.mock.method(console,'error',()=>{});
 let calls=0,signal;
 const h=harness(async(_input,init)=>{calls++;signal=init.signal;
  if(calls===1)return new Promise(()=>{});
  return new Response(JSON.stringify(user),{headers:{'content-type':'application/json'}});
 });
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 const client=createClient(serviceUrl,'sb_publishable_SYNTHETIC_NOT_A_SECRET',{
  global:{fetch:bounded},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 });
 const pending=client.auth.getUser('synthetic-token');await flush();h.expire();const result=await pending;
 assert.equal(signal.aborted,true);assert.equal(result.data.user,null);assert.match(result.error.message,/REQUEST_TIMEOUT/);
 assert.equal(h.timerCount,0);const retry=await client.auth.getUser('synthetic-token');
 assert.equal(retry.error,null);assert.equal(retry.data.user.id,user.id);assert.equal(calls,2);assert.equal(h.timerCount,0);
 await client.auth.stopAutoRefresh();
});

test('a real SDK getUser holding the session lock releases a queued getSession after its transport deadline',async t=>{
 t.mock.method(console,'error',()=>{});
 const storageKey='synthetic-auth-transport-lock';
 const session={access_token:'synthetic-session-token',refresh_token:'synthetic-refresh-token',expires_in:3600,
  expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
 const values=new Map([[storageKey,JSON.stringify(session)]]);let calls=0,signal;
 const h=harness(async(_input,init)=>{calls++;signal=init.signal;
  if(calls===1)return new Promise(()=>{});
  return new Response(JSON.stringify(user),{headers:{'content-type':'application/json'}});
 });
 const bounded=h.load('src/lib/supabaseAuthFetch.ts').createSupabaseAuthFetch(serviceUrl);
 const client=createClient(serviceUrl,'sb_publishable_SYNTHETIC_NOT_A_SECRET',{
  global:{fetch:bounded},auth:{persistSession:true,storageKey,autoRefreshToken:false,detectSessionInUrl:false,
   storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}},
 });
 await client.auth.initialize();assert.equal(calls,0,'Recovering an unexpired synthetic session performs no HTTP');
 const userRead=client.auth.getUser();let sessionSettled=false;
 const queued=client.auth.getSession().then(result=>{sessionSettled=true;return result;});
 await flush();assert.equal(calls,1);assert.equal(sessionSettled,false,'getSession waits behind the SDK lock held by getUser');
 h.expire();const result=await userRead;assert.match(result.error.message,/REQUEST_TIMEOUT/);assert.equal(signal.aborted,true);
 const cached=await queued;assert.equal(cached.error,null);assert.equal(cached.data.session.access_token,session.access_token);
 assert.equal(sessionSettled,true);assert.equal(h.timerCount,0);
 const retry=await client.auth.getUser();assert.equal(retry.error,null);assert.equal(retry.data.user.id,user.id);assert.equal(calls,2);
 await client.auth.stopAutoRefresh();
});
