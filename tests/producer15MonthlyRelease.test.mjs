// Delivery-only original15 compatibility. No production or provider invocation.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {assembleRelease,readReleaseCatalog,RELEASE_CATALOG,RELEASE_CATALOG_SHA256} from '../scripts/operations/producer15-monthly-release-20261019/materialize.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),read=name=>readFileSync(new URL('../'+name,import.meta.url));
const candidate=assembleRelease(),recovery=assembleRelease('recovery'),catalog=readReleaseCatalog();
const temporary=mkdtempSync(join(tmpdir(),'ma-producer15-monthly-'));
after(()=>rmSync(temporary,{recursive:true,force:true}));
for(const [name,payload] of [['candidate',candidate.payload],['original',candidate.originalRollback]]){
 const root=join(temporary,name);mkdirSync(root,{recursive:true});writeFileSync(join(root,'package.json'),'{"type":"module"}\n');
 for(const f of payload.files){const path=join(root,f.name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,f.content);}
}
const load=(side,path)=>import(pathToFileURL(join(temporary,side,path)).href);
const [currentOfficial,oldOfficial,currentGrowth,oldGrowth,helper]=await Promise.all([
 load('candidate','supabase/functions/_shared/recommendation-official-actuals.ts'),load('original','supabase/functions/_shared/recommendation-official-actuals.ts'),
 load('candidate','supabase/functions/_shared/recommendation-shadow-v2-sources.ts'),load('original','supabase/functions/_shared/recommendation-shadow-v2-sources.ts'),
 load('candidate','supabase/functions/_shared/recommendation-monthly-response-sharing.ts'),
]);
test('original15 is a separate fixed artifact: nineteen runtime files, SDK, rollback and main entry stay unchanged',()=>{
 assert.equal(sha(read(RELEASE_CATALOG)),RELEASE_CATALOG_SHA256);assert.equal(candidate.payload.files.length,22);assert.equal(recovery.payload.files.length,21);
 const original=new Map(candidate.originalRollback.files.map(f=>[f.name,f.content]));
 const runtime=candidate.payload.files.filter(f=>f.name!==catalog.type_contract.name);
 assert.equal(runtime.length,21);assert.equal(runtime.filter(f=>original.has(f.name)&&original.get(f.name)===f.content).length,19);
 assert.deepEqual(runtime.filter(f=>!original.has(f.name)||original.get(f.name)!==f.content).map(f=>f.name),[catalog.metadata.entrypoint_path,catalog.monthly_helper.name]);
 for(const f of recovery.payload.files)if(f.name!==catalog.type_contract.name)assert.equal(f.content,original.get(f.name));
 const entry=candidate.payload.files.find(f=>f.name===catalog.metadata.entrypoint_path).content;
 assert(entry.startsWith("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';"));
 assert(!candidate.payload.files.some(f=>/quarter-capsule|retained-2330|_fixed_c_worker_sdk/.test(f.name)));
 // Current source already contains other unshipped work. Never overwrite it
 // with this older runtime to make the delivery artifact match a main SHA.
 assert.notEqual(entry,read(catalog.metadata.entrypoint_path).toString());
 assert.equal(catalog.preserved_inapplicable_main_parser_run.passed,2);assert.equal(catalog.preserved_inapplicable_main_parser_run.failed,3);
 assert.equal(catalog.preserved_inapplicable_main_parser_run.failure_details.length,3);
});
test('single type-only extension fix erases to exactly the original JS; original rollback bytes are retained',()=>{
 const old=candidate.originalRollback.files.find(f=>f.name===catalog.type_contract.name).content;
 const fixed=candidate.payload.files.find(f=>f.name===catalog.type_contract.name).content;
 assert.equal(fixed,old.replace(catalog.type_contract.edit.old,catalog.type_contract.edit.new));assert.equal(Buffer.byteLength(fixed)-Buffer.byteLength(old),3);
 const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 assert.equal(transpile(fixed),transpile(old));assert.equal(recovery.payload.files.find(f=>f.name===catalog.type_contract.name).content,fixed);
 assert.equal(sha(Buffer.from(JSON.stringify(candidate.originalRollback,null,2)+'\n')),catalog.original_rollback_payload_sha256);
});
test('changed archive, helper, historical type, catalog and unknown variant fail closed without alternate sources',()=>{
 for(const name of [catalog.baseline_archive.name,catalog.monthly_helper.name])assert.throws(()=>assembleRelease('candidate',{readCurrent:n=>n===name?Buffer.concat([read(n),Buffer.from('DRIFT')]):read(n)}),/DRIFT|SIZE/);
 assert.throws(()=>assembleRelease('candidate',{readHistorical:()=>Buffer.from('wrong type')}),/ORIGINAL_TYPE_SIZE/);
 assert.throws(()=>assembleRelease('candidate',{readCurrent:n=>n===RELEASE_CATALOG?Buffer.concat([read(n),Buffer.from('DRIFT')]):read(n)}),/CATALOG_DRIFT/);
 assert.throws(()=>assembleRelease('not-reviewed'),/VARIANT/);
});
const urls=[currentGrowth.V2_SOURCE_URLS.twseGrowth,currentGrowth.V2_SOURCE_URLS.tpexGrowth],at='2026-10-19T06:30:00.000Z';
const row=symbol=>({'公司代號':symbol,'公司名稱':'合成資料','出表日期':'1151019','資料年月':'11509','營業收入-當月營收':'1100','營業收入-去年當月營收':'1000','營業收入-上月營收':'1000','營業收入-去年同月增減(%)':'10','營業收入-上月比較增減(%)':'10','Email':'SYNTHETIC_PRIVATE_FIELD'});
const body=url=>JSON.stringify([row(url===urls[0]?'2330':'6488')]);
async function views(shared,mode='valid'){
 const calls=[];const transport=async(url,init)=>{
  calls.push(String(url));assert.equal(init.redirect,'error');if(!urls.includes(String(url)))return new Response(null,{status:403});
  if(url===urls[0]){if(mode==='http')return new Response(null,{status:403});if(mode==='json')return new Response('{');if(mode==='body')return new Response(new ReadableStream({pull(c){c.error(Error('SYNTHETIC_PRIVATE_ERROR'));}}));}
  const bytes=new TextEncoder().encode(body(url)),cut=bytes.findIndex(x=>x>=224)+1;let n=0;const chunks=[bytes.slice(0,cut),bytes.slice(cut,cut+1),bytes.slice(cut+1)];
  return new Response(new ReadableStream({pull(c){if(n<chunks.length)c.enqueue(chunks[n++]);else c.close();}}));
 };
 const signal=AbortSignal.timeout(5000),factory=shared?helper.createMonthlyResponseSharing({fetcher:transport,signal}):null;
 const options={symbols:['2330','6488'],fetcher:factory?.fetcher??transport,signal,now:()=>at};
 try{return {calls,outputs:await Promise.all([(shared?currentOfficial:oldOfficial).acquireOfficialActuals(options),(shared?currentGrowth:oldGrowth).acquireV2PublicSources(options)])};}finally{factory?.dispose();}
}
test('exact original15 parsers retain normalized outputs and receipts while duplicated monthly GET10 becomes8',async()=>{
 const old=await views(false),next=await views(true);assert.deepEqual(next.outputs,old.outputs);assert.equal(old.calls.length,10);assert.equal(next.calls.length,8);
 for(const url of urls){assert.equal(old.calls.filter(x=>x===url).length,2);assert.equal(next.calls.filter(x=>x===url).length,1);}
 for(const captures of next.outputs){const monthly=captures.filter(c=>c.kind==='monthly_revenue'||c.kind==='growth');assert.equal(monthly.length,2);assert(monthly.every(c=>c.status==='PASS'));}
 assert(!JSON.stringify(next.outputs).includes('SYNTHETIC_PRIVATE_FIELD'));
});
test('bad upstream JSON, HTTP and body failures preserve original15 refusal and independent exchange success',async()=>{
 for(const mode of ['json','http','body']){
  const old=await views(false,mode),next=await views(true,mode);assert.deepEqual(next.outputs,old.outputs,mode);
  for(const url of urls)assert.equal(next.calls.filter(x=>x===url).length,1,mode);
  for(const captures of next.outputs)assert.equal(captures.find(c=>c.source===urls[1]).status,'PASS',mode);
  assert(!JSON.stringify(next.outputs).includes('SYNTHETIC_PRIVATE_ERROR'));
 }
});
function bundle(side,{fail=false}={}){
 const entry=(side==='candidate'?candidate.payload:candidate.originalRollback).files.find(f=>f.name===catalog.metadata.entrypoint_path).content;
 const start=entry.indexOf('  const acquireBundle=async()=>{'),end=entry.indexOf('\n  const bundle=',start);assert(start>=0&&end>start);
 const calls=[],events=[];let release;const gate=new Promise(resolve=>{release=resolve;});
 const nativeFetch=async url=>{calls.push(String(url));assert(urls.includes(String(url)));return new Response(body(url));};
 const ports={scope:'UNIVERSE_72',date:'2026-10-19',started:at,now:()=>at,signal:AbortSignal.timeout(5000),data:{universe:[]},RECOMMENDATION_UNIVERSE:['2330','6488'],fetch:nativeFetch,Deno:{env:{get:name=>{assert.equal(name,'FUGLE_API_KEY');return 'SYNTHETIC_ONLY';}}},
  createMonthlyResponseSharing:options=>{const sharing=helper.createMonthlyResponseSharing(options);return {...sharing,dispose(){events.push('DISPOSE');sharing.dispose();}};},
  startV2SourceAcquisition:options=>({complete:Promise.all(urls.map(async url=>await(await options.fetcher(url,{redirect:'error'})).text())).then(async value=>{if(fail)await gate;events.push('SHADOW_COMPLETE');return value;}),stop(){events.push('SHADOW_STOP');}}),
  acquireStockEvidence:async options=>{assert.equal(options.fetcher,nativeFetch);if(fail)throw Error('SYNTHETIC_STOCK_REFUSAL');return [];},
  acquireOfficialActuals:async options=>Promise.all(urls.map(async url=>await(await options.fetcher(url,{redirect:'error'})).text())),
  acquireCompanyEvents:async options=>{assert.equal(options.fetcher,nativeFetch);return [];},
 };
 const names=Object.keys(ports),invoke=new Function(...names,entry.slice(start,end)+'\nreturn acquireBundle();');
 return {pending:invoke(...names.map(name=>ports[name])),calls,events,release};
}
test('actual original15 and candidate acquisition bodies retain successful outputs and nonmonthly transports',async()=>{
 const old=bundle('original'),next=bundle('candidate');assert.deepEqual(await next.pending,await old.pending);
 assert.equal(old.calls.length,4);assert.equal(next.calls.length,2);for(const url of urls)assert.equal(next.calls.filter(x=>x===url).length,1);
 assert.deepEqual(next.events,['SHADOW_COMPLETE','SHADOW_STOP','DISPOSE']);
});
test('actual bundle failure retains refusal, awaits Shadow completion, and only then disposes shared buffers',async()=>{
 const next=bundle('candidate',{fail:true}),refusal=next.pending.catch(e=>e);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(next.events,['SHADOW_STOP']);
 next.release();assert.equal((await refusal).message,'SYNTHETIC_STOCK_REFUSAL');assert.deepEqual(next.events,['SHADOW_STOP','SHADOW_COMPLETE','DISPOSE']);
});
