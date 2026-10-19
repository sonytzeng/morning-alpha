import {Buffer} from 'node:buffer';
const {URL,queueMicrotask,Request,Response,setTimeout,clearTimeout,setInterval,clearInterval,Headers,URLSearchParams,TextEncoder,TextDecoder,AbortSignal,AbortController,ReadableStream,TransformStream,WritableStream,Blob,structuredClone,performance}=globalThis;
// Materialized release graph + retained actual SDK; synthetic in-memory ports.
// This is not a Supabase gateway, SQL persistence, Provider or Production E2E.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {posix} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {assembleRelease} from '../../scripts/operations/owner-quarter-live-release-20261019/materialize.mjs';

export const SYNTHETIC_ORIGIN='https://owner-quarter-runtime.invalid';
export const SYNTHETIC_SERVICE='SYNTHETIC_SERVICE_NO_PRODUCTION_CREDENTIAL';
export const SYNTHETIC_ANON='SYNTHETIC_ANON_NO_PRODUCTION_CREDENTIAL';
export const SYNTHETIC_TOKEN='SYNTHETIC_REQUEST_NO_PRODUCTION_SESSION';
export const SYNTHETIC_INTERNAL='SYNTHETIC_INTERNAL_NO_PRODUCTION_SECRET';
export const SYNTHETIC_UID='00000000-0000-4000-8000-000000000001';
export const PRODUCER_NOW='2026-10-19T23:05:00.000Z';
export const READER_NOW='2026-10-19T23:10:00.000Z';
export const BUSINESS_DATE='2026-10-20';
export const CORRELATION='synthetic-owner-quarter-20261020';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const nativeNames=new Set(['node:buffer','node:events','node:http','node:https','node:process','node:punycode','node:stream','node:url','node:util','node:zlib']);
const evidenceTables=['market_quotes','news_events','institutional_flows','earnings_events','sector_stock_map','catalyst_tw_mappings','research_catalysts','model_evaluations'];

// Shift only an already saved public fixture's dates into an explicitly
// synthetic next-day report. No mutated fixture is written or called real.
function shifted(value){
 if(typeof value==='string')return value.replace(/2026-\d\d-\d\d/g,date=>new Date(Date.parse(date+'T00:00:00Z')+18*86400000).toISOString().slice(0,10));
 if(Array.isArray(value))return value.map(shifted);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,shifted(item)]));
 return value;
}
export function syntheticSavedReport(proof,{mutate}={}){
 const bytes=readFileSync(new URL('../fixtures/public-projection/production-20261002.json',import.meta.url));
 assert.equal(hash(bytes),'62172386114bfcc5edd9b27dda8623afdafc961792cec55eb4db99aa56522a48','UNCHANGED_PUBLIC_FIXTURE');
 const capture=shifted(JSON.parse(bytes)),tables=capture.tables,report=tables.reports[0],ai=report.ai_strategy_json;
 assert.equal(report.report_date,BUSINESS_DATE);
 ai.correlation_id=CORRELATION;ai.generated_at=proof.decision.generated_at;
 ai.decision_v1=plain(proof.decision);ai.recommendation_stock_evidence=plain(proof.acquisition);
 ai.legacy_diagnostic={keep:'SYNTHETIC_UNRELATED_DIAGNOSTIC'};
 if(mutate)mutate(report);
 for(const table of evidenceTables)tables[table]=[];
 // Universe fixtures are taken from the actual materialized Producer below;
 // a reader with no rows still refuses formal recommendation completeness.
 tables.profiles=[{id:SYNTHETIC_UID,role:'admin',subscription_status:'active'}];
 tables.member_entitlements=[];
 return {tables,report,checkpointInput:{batches:tables.market_checkpoint_batches,proofs:capture.atomic_proofs.map(value=>value.proof)},
  kind:'SYNTHETIC_DATE_SHIFTED_PUBLIC_SHAPE_NOT_A_PRODUCTION_REPLAY'};
}
function field(row,key){return key.split(/->>?/).reduce((value,part)=>value?.[part],row);}
function rowsFor(tables,table,query){
 assert(Object.hasOwn(tables,table),'UNDECLARED_SYNTHETIC_TABLE:'+table);
 let rows=plain(tables[table]);
 for(const[key,raw]of query){
  if(['select','order','limit','offset'].includes(key)||key.startsWith('semantic_coherence_reviews.'))continue;
  rows=rows.filter(row=>{
   const value=field(row,key);
   if(raw.startsWith('eq.'))return String(value)===raw.slice(3);
   if(raw.startsWith('in.(')&&raw.endsWith(')'))return raw.slice(4,-1).split(',').map(item=>item.replace(/^"|"$/g,'')).includes(String(value));
   if(raw.startsWith('like.'))return String(value).startsWith(raw.slice(5).replace(/%$/,''));
   for(const op of ['gte','lte'])if(raw.startsWith(op+'.'))return op==='gte'?value>=raw.slice(op.length+1):value<=raw.slice(op.length+1);
   throw Error('UNSUPPORTED_SYNTHETIC_FILTER:'+key);
  });
 }
 const order=query.get('order');
 if(order)rows.sort((left,right)=>{for(const term of order.split(',')){const[key,direction]=term.split('.'),a=field(left,key),b=field(right,key);if(a!==b)return(a<b?-1:1)*(direction==='desc'?-1:1);}return 0;});
 const offset=Number(query.get('offset')||0),limit=query.has('limit')?Number(query.get('limit')):rows.length;
 assert(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=0);
 return rows.slice(offset,offset+limit);
}

export async function materializedRuntime(variant,{fixture,owner=true,ownerFailure=false,authId=SYNTHETIC_UID,profileRole='admin',cachedBundle,now=variant.startsWith('producer')?PRODUCER_NOW:READER_NOW,env:environmentOverride={}}={}){
 const assembled=assembleRelease(variant),payload=assembled.payload;
 assert.equal(hash(assembled.bytes),assembled.sha256);
 const local=new Map(payload.files.map(row=>[row.name,row.content])),modules=new Map(),native=new Set(),timers=new Set(),intervals=new Set();
 const trace=[],unexpected=[],diagnostics=[],sidecars=[];let handler;
 // Deno has a WebSocket constructor. Supply only that platform surface;
 // constructing one fails and is independently recorded as an unexpected call.
 class DeniedWebSocket{constructor(){unexpected.push('WEBSOCKET_NETWORK_DENIED');throw Error('WEBSOCKET_NETWORK_DENIED');}static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;}
 const environment={SUPABASE_URL:SYNTHETIC_ORIGIN,SUPABASE_SERVICE_ROLE_KEY:SYNTHETIC_SERVICE,SUPABASE_ANON_KEY:SYNTHETIC_ANON,CRON_SECRET:SYNTHETIC_INTERNAL,INTERNAL_AUTH_VERSION:'v1',...environmentOverride};
 class FixtureDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
 const safeProcess={env:{},version:'v22.14.0',versions:{node:'22.14.0'},platform:'linux',browser:false,nextTick:queueMicrotask,cwd:()=>'/synthetic'};
 const tables=fixture?.tables??Object.fromEntries(evidenceTables.map(name=>[name,[]]));
 if(fixture)tables.profiles=[{id:SYNTHETIC_UID,role:profileRole,subscription_status:'active'}];
 const fetcher=async(value,init)=>{
  try{
   const request=new Request(value,init),url=new URL(request.url);
   assert.equal(url.origin,SYNTHETIC_ORIGIN,'PROVIDER_OR_EXTERNAL_NETWORK_DENIED');
   const key=request.headers.get('apikey'),authorization=request.headers.get('authorization');
   assert([SYNTHETIC_SERVICE,SYNTHETIC_ANON].includes(key),'UNKNOWN_SYNTHETIC_KEY');
   assert(['Bearer '+SYNTHETIC_TOKEN,'Bearer '+SYNTHETIC_SERVICE].includes(authorization),'UNKNOWN_SYNTHETIC_IDENTITY');
   const body=request.method==='POST'?JSON.parse(await request.text()||'{}'):null;
   trace.push({path:url.pathname,method:request.method,key:key===SYNTHETIC_ANON?'ANON':'SERVICE',
    authorization:authorization==='Bearer '+SYNTHETIC_TOKEN?'REQUEST':'SERVICE',body});
   if(url.pathname==='/auth/v1/user')return Response.json({id:key===SYNTHETIC_ANON?authId:SYNTHETIC_UID,aud:'authenticated',app_metadata:{},user_metadata:{owner:true,tier:'admin'},created_at:'2026-01-01T00:00:00Z'});
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    assert.equal(request.method,'POST');const name=url.pathname.split('/').at(-1);
    if(name==='claim_recommendation_v2_acquisition'){
     assert(variant.startsWith('producer'));assert.deepEqual(body,{p_date:BUSINESS_DATE});
     return Response.json({status:'CACHED',payload:cachedBundle??{business_date:BUSINESS_DATE,acquisition_cutoff:PRODUCER_NOW,captures:[],officialActuals:[],companyEvents:[],acquired:{fugle:[],publicSources:[],benchmark_history:[]}}});
    }
    if(name==='ensure_member_entitlement_v1'){
     assert(!variant.startsWith('producer'));assert.equal(key,SYNTHETIC_SERVICE);assert.deepEqual(body,{p_user_id:SYNTHETIC_UID});
     return Response.json({state:'paid_active',tier:'member',source:'SYNTHETIC_EXISTING_ENTITLEMENT',access_ends_at:'2099-01-01T00:00:00Z'});
    }
    if(name==='is_research_owner_v1'){
     assert.equal(variant,'reader');assert.equal(key,SYNTHETIC_ANON);assert.equal(authorization,'Bearer '+SYNTHETIC_TOKEN);assert.deepEqual(body,{});
     if(ownerFailure)throw Error('EXPECTED_SYNTHETIC_OWNER_PREDICATE_FAILURE');
     return Response.json(owner);
    }
    if(name==='public_market_checkpoint_inputs_v1'){
     assert(fixture);assert.deepEqual(body,{p_business_date:BUSINESS_DATE});return Response.json(fixture.checkpointInput);
    }
    if(name==='record_critical_contract_evidence_v1'){
     assert(fixture);assert.equal(body.p_business_date,BUSINESS_DATE);assert.equal(body.p_stage,'PUBLICATION');
     // Existing observation RPC: no SQL or persistence is simulated here.
     return Response.json(null);
    }
    throw Error('UNDECLARED_SYNTHETIC_RPC:'+name);
   }
   assert.equal(request.method,'GET','TABLE_MUTATION_FORBIDDEN');
   assert(url.pathname.startsWith('/rest/v1/'),'UNDECLARED_SYNTHETIC_PATH');
   const table=url.pathname.split('/').at(-1),rows=rowsFor(tables,table,url.searchParams);
   const object=request.headers.get('accept')?.includes('application/vnd.pgrst.object+json');
   return Response.json(object?(rows[0]??null):rows);
  }catch(error){if(!(ownerFailure&&error.message==='EXPECTED_SYNTHETIC_OWNER_PREDICATE_FAILURE'))unexpected.push(error.message);throw error;}
 };
 const setTimer=(fn,ms,...args)=>{const id=setTimeout(()=>{timers.delete(id);fn(...args);},ms);timers.add(id);return id;};
 const clearTimer=id=>{timers.delete(id);clearTimeout(id);};
 const setRepeat=(fn,ms,...args)=>{const id=setInterval(fn,ms,...args);intervals.add(id);return id;};
 const clearRepeat=id=>{intervals.delete(id);clearInterval(id);};
 const context=vm.createContext({Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,AbortSignal,AbortController,ReadableStream,TransformStream,WritableStream,Blob,Buffer,WebSocket:DeniedWebSocket,
  crypto:webcrypto,structuredClone,Date:FixtureDate,performance,fetch:fetcher,process:safeProcess,queueMicrotask,
  setTimeout:setTimer,clearTimeout:clearTimer,setInterval:setRepeat,clearInterval:clearRepeat,
  console:{log:(...args)=>diagnostics.push(['log',...args]),warn:(...args)=>diagnostics.push(['warn',...args]),error:(...args)=>diagnostics.push(['error',...args])},
  Deno:{env:{get:name=>environment[name]},serve:fn=>{assert.equal(handler,undefined);handler=fn;}},EdgeRuntime:{waitUntil:work=>sidecars.push(work)}});
 const resolveId=(specifier,parent)=>{
  if(specifier.startsWith('node:')){assert(nativeNames.has(specifier),'UNSEALED_NATIVE_IMPORT');return specifier;}
  assert(specifier.startsWith('.'),'REMOTE_OR_BARE_IMPORT_DENIED:'+specifier);
  const name=posix.normalize(posix.join(posix.dirname(parent.slice(6)),specifier));assert(local.has(name),'UNSEALED_LOCAL_IMPORT:'+name);return 'local:'+name;
 };
 async function load(id){
  if(modules.has(id))return modules.get(id);let module;
  if(id.startsWith('node:')){
   native.add(id);const exports=id==='node:process'?{default:safeProcess,...safeProcess}:await import(id);
   module=new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context,identifier:id});
  }else if(id.endsWith('.json')){
   const value=JSON.parse(local.get(id.slice(6)));module=new vm.SyntheticModule(['default'],function(){this.setExport('default',value);},{context,identifier:id});
  }else{
   const original=local.get(id.slice(6));assert.equal(typeof original,'string');
   const source=id.endsWith('.mjs')?original:ts.transpileModule(original,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
   module=new vm.SourceTextModule(source,{context,identifier:id,importModuleDynamically:async(specifier,parent)=>{
    const child=await load(resolveId(specifier,parent.identifier));if(child.status==='unlinked')await child.link((s,m)=>load(resolveId(s,m.identifier)));if(child.status==='linked')await child.evaluate();return child;
   }});
  }
  modules.set(id,module);return module;
 }
 const entry=await load('local:'+payload.entrypoint_path);await entry.link((s,m)=>load(resolveId(s,m.identifier)));await entry.evaluate();
 assert.equal(typeof handler,'function');
 if(variant.startsWith('producer')){
  const universe=modules.get('local:supabase/functions/_shared/recommendation-stock-evidence.ts').namespace.RECOMMENDATION_UNIVERSE;
  assert.equal(universe.length,72);tables.sector_stock_map=[...universe].map(symbol=>({id:'SYNTHETIC:'+symbol,symbol,stock_name:'SYNTHETIC',sector:'SYNTHETIC',is_active:true,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}));
 }
 return {variant,payload,sha256:assembled.sha256,handler,trace,unexpected,diagnostics,sidecars,
  namespace:path=>{const module=modules.get('local:'+path);assert(module&&module.status==='evaluated','MATERIALIZED_MODULE_NOT_EVALUATED:'+path);return module.namespace;},
  graph:()=>({local:[...modules.keys()].filter(id=>id.startsWith('local:')).map(id=>id.slice(6)).sort(),native:[...native].sort(),remote:[]}),
  assertClean:()=>assert.deepEqual(unexpected,[],'UNEXPECTED_TRANSPORT_MUST_NOT_BE_SWALLOWED'),
  close:async()=>{await Promise.all(sidecars);for(const id of timers)clearTimeout(id);for(const id of intervals)clearInterval(id);}};
}
export async function invokeMaterialized(h,{method='POST',body,headers={}}={}){
 const response=await h.handler(new Request(SYNTHETIC_ORIGIN+'/functions/v1/'+h.payload.name,{method,headers:{'content-type':'application/json',...headers},...(['GET','HEAD'].includes(method)?{}:{body:typeof body==='string'?body:JSON.stringify(body??{})})}));
 const text=await response.text(),value=text?JSON.parse(text):null;await Promise.all(h.sidecars);h.assertClean();return {status:response.status,body:value};
}
