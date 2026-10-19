import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {posix} from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {assembleRelease,readReleaseCatalog,VARIANTS} from '../scripts/operations/owner-quarter-live-release-20261019/materialize.mjs';
const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root));
const hash=value=>createHash('sha256').update(value).digest('hex');
const entry=name=>'supabase/functions/'+name+'/index.ts';
const actualProducer=()=>execFileSync('git',['--no-replace-objects','show','5f33777836778e3600e4e377fcb3cf4de690fe80:'+entry('recommendation-stock-evidence-v1')],{cwd:root,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'}}).toString();

test('four fixed artifacts reproduce independent byte catalogs and preserve JWT, SDK and actual business baselines',()=>{
 const c=readReleaseCatalog(),counts={producer:251,'producer-recovery':247,reader:246,'reader-recovery':242};
 for(const variant of VARIANTS){
  const a=assembleRelease(variant),b=assembleRelease(variant);assert(a.bytes.equals(b.bytes));assert.equal(a.payload.files.length,counts[variant]);
  assert.equal(a.sha256,c.variants[variant].payload_sha256);
  const roles=c.variants[variant].file_roles;assert.equal(roles.runtime+roles.type_only+roles.static,a.payload.files.length);
  assert.equal(c.variants[variant].runtime_files,roles.runtime,'RUNTIME_COUNT_METADATA_DISAGREES_WITH_ROLES');
  assert.equal(c.variants[variant].runtime_emission.files.length,roles.runtime,'RUNTIME_COUNT_METADATA_DISAGREES_WITH_EMISSION');
  for(const row of c.variants[variant].runtime_emission.files){const file=a.payload.files.find(f=>f.name===row.name);const emitted=file.name.endsWith('.ts')?ts.transpileModule(file.content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:true}}).outputText:file.content;assert.equal(hash(emitted),row.emitted_sha256,'RUNTIME_TYPE_ERASURE_CHANGED:'+row.name);}assert.equal(a.payload.verify_jwt,variant.startsWith('producer'));assert(!('import_map_path'in a.payload));
  assert.equal(a.payload.files.some(f=>f.name.endsWith('/recommendation-foundation-candidate.ts')||f.name.endsWith('/recommendation-market-institutional-candidate.ts')),false);
  for(const original of variant.startsWith('producer')?c.producer_baseline:c.reader_baseline){
   if(original.name===a.payload.entrypoint_path)continue;
   const file=a.payload.files.find(file=>file.name===original.name);assert(file);assert.equal(hash(file.content),original.sha256,original.name);
  }
 }
 const producerRecovery=assembleRelease('producer-recovery').payload.files.find(f=>f.name===entry('recommendation-stock-evidence-v1')).content;
 const sdk="../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs";
 assert.equal(producerRecovery.split('\n').slice(1).join('\n'),actualProducer().replace('https://esm.sh/@supabase/supabase-js@2.57.4',sdk));
 assert.match(producerRecovery,/^\/\/ @deno-types=/);
});
test('actual emitted local import graphs close exactly with fixed native ports and no remote runtime dependencies',()=>{
 const allowed=new Set(['node:buffer','node:process','node:http','node:https','node:zlib','node:stream','node:punycode','node:url','node:events']);
 for(const variant of VARIANTS){
  const {payload}=assembleRelease(variant),sources=new Map(payload.files.map(f=>[f.name,f.content])),seen=new Set(),native=new Set();
  const visit=name=>{
   if(seen.has(name))return;seen.add(name);if(name.endsWith('.json'))return;
   const raw=sources.get(name),source=name.endsWith('.ts')?ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:raw;
   const ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),imports=[];
   function node(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)imports.push(n.moduleSpecifier.text);
    if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword){assert.equal(n.arguments.length,1);assert(ts.isStringLiteral(n.arguments[0]),'NONLITERAL_DYNAMIC_IMPORT');imports.push(n.arguments[0].text);}ts.forEachChild(n,node);}
   node(ast);for(const spec of imports){if(spec.startsWith('node:')){assert(allowed.has(spec),'UNSEALED_NATIVE_PORT');native.add(spec);continue;}
    assert(spec.startsWith('.'),'NONLOCAL_RUNTIME_IMPORT:'+spec);const next=posix.normalize(posix.join(posix.dirname(name),spec));assert(sources.has(next),'MISSING_IMPORT:'+next);visit(next);}
  };
  visit(payload.entrypoint_path);const typeNames=new Set(readReleaseCatalog().variants[variant].type_files.map(f=>f.name));const runtime=payload.files.filter(f=>!f.name.includes('/licenses/')&&!typeNames.has(f.name)).map(f=>f.name).sort();assert.deepEqual([...seen].sort(),runtime,variant);
  const plan=readReleaseCatalog().variants[variant];assert.equal(seen.size,plan.runtime_files,'RUNTIME_COUNT_METADATA_DISAGREES_WITH_GRAPH');
  assert.deepEqual(plan.runtime_emission.files.map(f=>f.name).sort(),runtime,'RUNTIME_EMISSION_DISAGREES_WITH_GRAPH');
  assert(native.size>0);
 }
});
test('current source, baseline archive, provenance and SDK drift or missing bytes cannot fall back or fetch',()=>{
 const c=readReleaseCatalog(),targets=[c.producer_archive.name,c.type_archive.name,c.reader_archive.name,c.entry_edits.name,c.baseline_catalogs[0].name,
  c.variants.producer.additional_sources.find(row=>row.name.endsWith('.mjs')).name,
  'supabase/functions/_shared/recommendation-owner-quarter-capsule.ts'];
 for(const path of targets){const variant=path===c.reader_archive.name?'reader':'producer';
  assert.throws(()=>assembleRelease(variant,{readCurrent:name=>name===path?Buffer.concat([read(name),Buffer.from('DRIFT')]):read(name)}),/QUARTER_.*(?:DRIFT|SIZE)/);
  assert.throws(()=>assembleRelease(variant,{readCurrent:name=>{if(name===path)throw Error('FIXED_SOURCE_ABSENT');return read(name);}}),/FIXED_SOURCE_ABSENT/);
 }
});
test('historical production logic cannot be substituted with newer global code or an alternate Git ref',()=>{
 assert.throws(()=>assembleRelease('producer',{readHistorical:read}),/QUARTER_IMMUTABLE_SOURCE_(?:SIZE|DRIFT)/);
 assert.throws(()=>assembleRelease('producer',{readHistorical:()=>{throw Error('NO_LOCAL_IMMUTABLE_OBJECT');}}),/NO_LOCAL_IMMUTABLE_OBJECT/);
 for(const row of readReleaseCatalog().preserved_global_sources)assert.throws(()=>assembleRelease('reader',{readCurrent:name=>name===row.name?Buffer.concat([read(name),Buffer.from('DRIFT')]):read(name)}),/QUARTER_CURRENT_GLOBAL/);
 for(const variant of ['main','../reader','reader@HEAD',{},'rollback'])assert.throws(()=>assembleRelease(variant),/QUARTER_FIXED_VARIANT/);
});
test('privacy recovery contains the required strip-only logic and no Quarter output or Owner authorization call site',()=>{
 const repair=assembleRelease('reader').payload,recovery=assembleRelease('reader-recovery').payload;
 const source=recovery.files.find(f=>f.name===recovery.entrypoint_path).content;
 assert.match(source,/buildPayload\(withoutResearchOwnerReceipt\(report\), tier, context\)/);
 assert.match(source,/buildHistorySummary\(withoutResearchOwnerReceipt\(row\)/);
 assert.doesNotMatch(source,/owner_market_foundation_candidate|canReadResearchOwnerFields|persistedOwnerQuarterInput/);
 assert(!recovery.files.some(f=>f.name.endsWith('/recommendation-owner-quarter-capsule.ts')));
 const changed=repair.files.filter(f=>recovery.files.some(old=>old.name===f.name&&old.content!==f.content)).map(f=>f.name);assert.deepEqual(changed,[repair.entrypoint_path]);
});
test('CLI has fixed variants/destination and cannot overwrite an already materialized artifact',()=>{
 const script=new URL('../scripts/operations/owner-quarter-live-release-20261019/materialize.mjs',import.meta.url).pathname;
 const outside=spawnSync(process.execPath,[script,'--output','/tmp/owner-quarter-unapproved.json'],{cwd:root,encoding:'utf8'});assert.notEqual(outside.status,0);assert.match(outside.stderr,/QUARTER_NO_ARGUMENTS/);
 const output='build/owner-quarter-live-release-20261019/producer-deploy-args.json';
 try{read(output);}catch(error){if(error.code!=='ENOENT')throw error;const first=spawnSync(process.execPath,[script,'producer'],{cwd:root,encoding:'utf8'});assert.equal(first.status,0,first.stderr);}
 const before=read(output),again=spawnSync(process.execPath,[script,'producer'],{cwd:root,encoding:'utf8'});assert.notEqual(again.status,0);assert.match(again.stderr,/EEXIST/);assert(read(output).equals(before));
});
