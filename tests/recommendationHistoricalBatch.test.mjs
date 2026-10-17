// SYNTHETIC batch-envelope tests, not historical-lineage/release evidence.
// The real legacy adapters retain every original expected-hash assertion and
// exercise the real transition chain. Here only the expensive imported chain
// is replaced in an isolated filesystem; the batch helper itself is unchanged.
// These tests do not establish equivalence to 142 full-tree checks across all
// interleavings, and do not replace any public gate or legacy negative cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import childProcess,{execFileSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitEnv={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',
 GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
const exactMismatch=(path,expected,actual,representation='BYTES')=>error=>{
 assert.equal(error.message,'HISTORICAL_SOURCE_MISMATCH');
 assert.deepEqual({...error},{code:'HISTORICAL_SOURCE_MISMATCH',path,representation,
  expected_sha256:digest(expected),actual_sha256:digest(actual)});
 assert.notEqual(error.expected_sha256,error.actual_sha256);
 return true;
};
const SEAL='docs/synthetic-integration.json',FREEZE='docs/10k-program/phase1-core-freeze.json';
const source=fs.readFileSync(new URL('./helpers/recommendationHistoricalBatch.mjs',import.meta.url));
const descendants=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 if(entry.name==='.git')return [];
 const path=join(dir,entry.name);
 return entry.isDirectory()?descendants(path):[path];
});
async function fixture(t){
 const dir=fs.mkdtempSync(join(tmpdir(),'ma-synthetic-historical-batch-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const put=(path,bytes)=>{fs.mkdirSync(dirname(join(dir,path)),{recursive:true});fs.writeFileSync(join(dir,path),bytes);};
 const read=path=>fs.readFileSync(join(dir,path));
 const protectedFiles={};
 for(let i=0;i<142;i++){
  const path='core/file-'+String(i).padStart(3,'0')+'.txt',bytes=Buffer.from('SYNTHETIC_CURRENT:'+i);
  put(path,bytes);protectedFiles[path]=digest(bytes);
 }
 put(FREEZE,JSON.stringify({base_sha:'3b33db3688ba350da0372b50f3391da922b639ea',protected_files:protectedFiles}));
 put('docs/10k-program/phase1-baseline-transition.json','SYNTHETIC_PREDECESSOR');
 put('.DS_Store',Buffer.from([0xff,0xfe,0,0x80]));
 const analysisFiles={};
 for(let i=0;i<25;i++){const path='analysis/file-'+i+'.txt';put(path,'SYNTHETIC_ANALYSIS:'+i);analysisFiles[path]=digest(read(path));}
 put('docs/10k-program/phase2-candidate-integrity.json',JSON.stringify({
  base_sha:'1fcf24a7a2d7d7a602e555639a200f3b002a31ce',files:analysisFiles,
  predecessors:{[FREEZE]:digest(read(FREEZE)),
   'docs/10k-program/phase1-baseline-transition.json':digest(read('docs/10k-program/phase1-baseline-transition.json'))},
 }));
 put('tests/helpers/recommendationV2ForwardIntegrity.mjs',`
 export let constructions=0;
 export function forwardAwareReader(source){
  constructions++;
  // Deliberately retain bytes: the outer batch must still reject late source
  // drift instead of allowing these synthetic historical bytes to hide it.
  const freeze=JSON.parse(source(${JSON.stringify(FREEZE)})),saved=new Map();
  for(const path of Object.keys(freeze.protected_files))saved.set(path,Buffer.from(source(path)));
  return path=>saved.has(path)?Buffer.from(saved.get(path)):source(path);
 }
 `);
 put('tests/helpers/recommendationPhaseIntegrity.mjs',`
 export let reads=0;
 export function readRecommendationPredecessor(path,source){reads++;return source(path);}
 `);
 put('tests/helpers/premarketAtomicReadinessIntegrity.mjs',`
 export let reads=0;
 export function readAnalysisIntelligencePredecessor(path,source){reads++;return source(path);}
 `);
 const baseline=Object.fromEntries(descendants(dir).map(file=>{
  const path=file.slice(dir.length+1);return [path,{sha256:digest(fs.readFileSync(file)),mode:'100644'}];
 }));
 // A real immutable Git TREE, not a commit or a production repository change.
 // No network, credentials, external Git configuration or hooks are used.
 const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',env:gitEnv,stdio:['ignore','pipe','pipe']});
 git(['init','-q']);git(['add','--all']);const tree=git(['write-tree']).trim();
 put('tests/helpers/recommendationHistoricalBatch.mjs',source);
 put('tests/helpers/integrationAdmission.mjs',`
 import assert from 'node:assert/strict';
 import {readFileSync,lstatSync,readdirSync} from 'node:fs';
 import {createHash} from 'node:crypto';
 import {fileURLToPath} from 'node:url';
 import {join} from 'node:path';
 export const INTEGRATION_BASE=${JSON.stringify(tree)},INTEGRATION_MANIFEST=${JSON.stringify(SEAL)};
 const root=fileURLToPath(new URL('../../',import.meta.url)),baseline=${JSON.stringify(baseline)};
 export const integrationHash=b=>createHash('sha256').update(b).digest('hex');
 export let admissions=0;
 let nextAdmission;
 export function onNextAdmission(callback){nextAdmission=callback;}
 function paths(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  if(e.name==='.git')return [];const path=join(dir,e.name);return e.isDirectory()?paths(path):[path.slice(root.length)];
 });}
 export function verifyIntegrationCandidate(){
  admissions++;
  const receipt=new URL(INTEGRATION_MANIFEST,new URL('../../',import.meta.url));
  assert(lstatSync(receipt).isFile()&&!lstatSync(receipt).isSymbolicLink(),'SYNTHETIC_RECEIPT_REGULAR');
  const m=JSON.parse(readFileSync(receipt));assert.equal(m.production_authorized,false,'SYNTHETIC_FORBIDDEN_FLAG');
  const all=new Map(Object.entries(baseline));
  for(const row of m.files)all.set(row.path,{sha256:row.after_sha256,mode:row.mode});
  assert.deepEqual(paths(root).sort(),[...all.keys(),INTEGRATION_MANIFEST].sort(),'SYNTHETIC_UNKNOWN_INVENTORY');
  for(const [path,row]of all){const file=new URL(path,new URL('../../',import.meta.url)),s=lstatSync(file);
   assert(s.isFile()&&!s.isSymbolicLink(),'SYNTHETIC_REGULAR');
   assert.equal(s.mode&0o111?'100755':'100644',row.mode,'SYNTHETIC_MODE');
   assert.equal(integrationHash(readFileSync(file)),row.sha256,'SYNTHETIC_PHYSICAL_DRIFT');
  }
  const callback=nextAdmission;nextAdmission=undefined;return callback?callback(m):m;
 }
 `);
 const additions=['tests/helpers/recommendationHistoricalBatch.mjs','tests/helpers/integrationAdmission.mjs'];
 put(SEAL,JSON.stringify({production_authorized:false,files:additions.map(path=>({path,mode:'100644',after_sha256:digest(read(path))}))}));
 const load=path=>import(pathToFileURL(join(dir,'tests/helpers',path)).href);
 const batch=await load('recommendationHistoricalBatch.mjs');
 return {dir,put,read,paths:Object.keys(protectedFiles),protectedFiles,batch,
  admission:await load('integrationAdmission.mjs'),forward:await load('recommendationV2ForwardIntegrity.mjs'),
  original:await load('recommendationPhaseIntegrity.mjs'),analysis:await load('premarketAtomicReadinessIntegrity.mjs')};
}
const complete=(f,read)=>{for(const [path,hash]of Object.entries(f.protectedFiles))assert.equal(digest(read(path)),hash,path);};

test('synthetic: one invocation-local chain, 142 original reads, copies and expired capability',async t=>{
 const f=await fixture(t);let escaped;
 f.batch.withRecommendationHistoricalBatch(f.read,read=>{escaped=read;complete(f,read);});
 assert.equal(f.forward.constructions,1);assert.equal(f.original.reads,142);
 assert(f.admission.admissions>=3);assert.throws(()=>escaped(f.paths[0]),/CLOSED/);
 f.batch.withRecommendationHistoricalBatch(f.read,read=>complete(f,read));
 assert.equal(f.forward.constructions,2);assert.equal(f.original.reads,284);
});
test('synthetic: unknown, traversal, absolute, .env and alias reads touch neither source nor FS',async t=>{
 const f=await fixture(t);let sourceReads=0;
 f.batch.withRecommendationHistoricalBatch(path=>{sourceReads++;return f.read(path);},read=>{
  const before=sourceReads,originals=new Map(),calls=[];
  for(const key of ['openSync','readFileSync','lstatSync','fstatSync']){
   originals.set(key,fs[key]);fs[key]=(...args)=>{calls.push(key);return originals.get(key)(...args);};
  }
  syncBuiltinESMExports();
  try{for(const path of ['.env','../.env','/etc/passwd','core/../.env','./'+f.paths[0],f.paths[0]+'\0'])
   assert.throws(()=>read(path),/UNKNOWN_PATH/);
  }finally{for(const [key,value]of originals)fs[key]=value;syncBuiltinESMExports();}
  assert.equal(sourceReads,before);assert.deepEqual(calls,[]);complete(f,read);
 });
});
test('synthetic: late per-path injected bytes cannot be erased by the restored reader',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path),bad=Buffer.concat([good,Buffer.from('INJECTED')]);let drift=false;
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(path=>path===f.paths[0]&&drift?
  bad:f.read(path),read=>{drift=true;read(path);}),exactMismatch(path,good,bad));
});
test('synthetic: source-only receipt flag drift is denied both at entry and in finally',async t=>{
 const f=await fixture(t);let drift=false;
 const good=f.read(SEAL),bad=Buffer.from(JSON.stringify({...JSON.parse(good),production_authorized:true}));
 const reader=path=>path===SEAL&&drift?bad:f.read(path);
 drift=true;assert.throws(()=>f.batch.withRecommendationHistoricalBatch(reader,()=>{}),exactMismatch(SEAL,good,bad));
 drift=false;
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(reader,read=>{complete(f,read);drift=true;throw Error('CONSUMER_FAILURE');}),exactMismatch(SEAL,good,bad));
});
test('synthetic: lossy binary UTF-8 views are accepted exactly, never surrogate-normalized',async t=>{
 const f=await fixture(t),text=f.read('.DS_Store').toString('utf8');assert(text.includes('\uFFFD'));
 f.batch.withRecommendationHistoricalBatch(path=>f.read(path).toString('utf8'),read=>complete(f,read));
 const surrogate=text.replace('\uFFFD','\uD800');assert.equal(Buffer.from(surrogate).toString('utf8'),text);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(path=>path==='.DS_Store'?surrogate:f.read(path).toString('utf8'),()=>{}),
  exactMismatch('.DS_Store',Buffer.from(text,'utf16le'),Buffer.from(surrogate,'utf16le'),'UTF16LE_CODE_UNITS'));
});
test('synthetic: each read rechecks physical bytes, mode, deletion, symlink and directory',async t=>{
 const f=await fixture(t),path=f.paths[0],file=join(f.dir,path),good=f.read(path);
 const mutations=[
  ()=>f.put(path,Buffer.concat([good,Buffer.from('PHYSICAL_DRIFT')])),
  ()=>fs.chmodSync(file,0o755),
  ()=>fs.rmSync(file),
  ()=>{fs.rmSync(file);fs.symlinkSync(join(f.dir,f.paths[1]),file);},
  ()=>{fs.rmSync(file);fs.mkdirSync(file);},
 ];
 for(const mutate of mutations){
  try{assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,read=>{mutate();read(path);}));}
  finally{fs.rmSync(file,{recursive:true,force:true});f.put(path,good);fs.chmodSync(file,0o644);}
 }
});
test('synthetic: source callback changing the file during a read is denied',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path);let mutate=false;
 try{assert.throws(()=>f.batch.withRecommendationHistoricalBatch(p=>{
  const bytes=f.read(p);if(p===path&&mutate){mutate=false;f.put(path,Buffer.concat([bytes,Buffer.from('LATE')]));}return bytes;
 },read=>{mutate=true;read(path);}));}finally{f.put(path,good);}
});
test('synthetic: finally re-admits real inventory even when the consumer throws',async t=>{
 const f=await fixture(t);
 try{assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,()=>{
  f.put('unknown.txt','NOT_ADMITTED');throw Error('CONSUMER_FAILURE');
 }),/UNKNOWN_INVENTORY/);}finally{fs.rmSync(join(f.dir,'unknown.txt'));}
});
test('synthetic: receipt changed after construction is denied without reusing earlier admission',async t=>{
 const f=await fixture(t),receipt=f.read(SEAL);
 try{assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,read=>{
  f.put(SEAL,Buffer.concat([receipt,Buffer.from('\n')]));read(f.paths[0]);
 }),/SOURCE_DRIFT|FINAL_RECEIPT_CHANGED/);}finally{f.put(SEAL,receipt);}
});
test('synthetic: finally binds its fresh admission result to the entry admission',async t=>{
 const f=await fixture(t);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,read=>{
  complete(f,read);
  f.admission.onNextAdmission(m=>({...m,production_authorized:true}));
 }),/FINAL_ADMISSION_CHANGED/);
});
test('synthetic: finally binds exact entry receipt bytes even after a same-JSON final gate',async t=>{
 const f=await fixture(t),receipt=f.read(SEAL);
 try{assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,read=>{
  complete(f,read);
  f.admission.onNextAdmission(m=>{f.put(SEAL,Buffer.concat([receipt,Buffer.from('\n')]));return m;});
 }),/FINAL_RECEIPT_CHANGED/);}finally{f.put(SEAL,receipt);}
});
test('synthetic: native async sources are rejected before their bodies, including spoofed tags',async t=>{
 const f=await fixture(t);let ran=false,thenRan=false;
 const asyncSource=async path=>{ran=true;return f.read(path);};
 for(const reader of [asyncSource,asyncSource.bind(null)]){
  assert.throws(()=>f.batch.withRecommendationHistoricalBatch(reader,()=>{}),/SYNC_SOURCE_ONLY/);
  assert.equal(ran,false);
 }
 Object.defineProperty(asyncSource,Symbol.toStringTag,{value:'Function'});
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(asyncSource,()=>{}),/SYNC_SOURCE_ONLY/);
 assert.equal(ran,false);assert.equal(f.admission.admissions,0);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(()=>({then(){thenRan=true;}}),()=>{}),/SOURCE_TYPE/);
 assert.equal(thenRan,false);
});
test('synthetic: async, thenable, escaped return, empty, partial and duplicate consumers fail',async t=>{
 const f=await fixture(t);let asyncRan=false,thenRan=false;
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,async()=>{asyncRan=true;}),/SYNC_ONLY/);
 assert.equal(asyncRan,false);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,()=>({then(){thenRan=true;}})),/SYNC_VOID_ONLY/);
 assert.equal(thenRan,false);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,read=>read),/SYNC_VOID_ONLY/);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,()=>{}),/INCOMPLETE/);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,read=>{read(f.paths[0]);}),/INCOMPLETE/);
 assert.throws(()=>f.batch.withRecommendationHistoricalBatch(f.read,read=>{read(f.paths[0]);read(f.paths[0]);}),/DUPLICATE_PATH/);
});
test('synthetic: Phase 2 keeps its own original reader and all 169 unique path checks',async t=>{
 const f=await fixture(t),m=JSON.parse(f.read('docs/10k-program/phase2-candidate-integrity.json'));
 f.batch.withAnalysisHistoricalBatch(f.read,read=>{
  for(const [path,hash]of [...Object.entries(m.files),...Object.entries(m.predecessors),...Object.entries(f.protectedFiles)])
   assert.equal(digest(read(path)),hash,path);
 });
 assert.equal(f.analysis.reads,169);assert.equal(f.original.reads,0);assert.equal(f.forward.constructions,1);
});
test('synthetic: common API checks current source, preserves copies and never builds a factory',async t=>{
 const f=await fixture(t);let escaped;
 f.batch.withCheckedHistoricalSource(f.read,checked=>{
  escaped=checked;
  assert.deepEqual(checked(SEAL),f.read(SEAL));
  const bytes=checked(f.paths[0]);bytes.fill(0);
  assert.deepEqual(checked(f.paths[0]),f.read(f.paths[0]));
 });
 assert.equal(f.forward.constructions,0);assert.equal(f.original.reads,0);assert.equal(f.analysis.reads,0);
 assert.throws(()=>escaped(f.paths[0]),/CLOSED/);
 f.batch.withCheckedHistoricalSource(path=>f.read(path).toString('utf8'),checked=>{
  assert.equal(checked('.DS_Store'),f.read('.DS_Store').toString('utf8'));
 });
 assert.equal(f.forward.constructions,0);
});
test('synthetic: common API rejects unknown reads before IO and rejects async/escape returns',async t=>{
 const f=await fixture(t);let reads=0,ran=false,thenRan=false;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(async()=>{ran=true;},()=>{}),/SYNC_SOURCE_ONLY/);
 assert.throws(()=>f.batch.withCheckedHistoricalSource(f.read,async()=>{ran=true;}),/SYNC_ONLY/);
 assert.equal(ran,false);assert.equal(f.admission.admissions,0);
 f.batch.withCheckedHistoricalSource(path=>{reads++;return f.read(path);},checked=>{
  const before=reads,originals=new Map(),calls=[];
  for(const key of ['openSync','readFileSync','lstatSync','fstatSync']){
   originals.set(key,fs[key]);fs[key]=(...args)=>{calls.push(key);return originals.get(key)(...args);};
  }
  syncBuiltinESMExports();
  try{for(const path of ['.env','../.env','/etc/passwd','./'+f.paths[0]])assert.throws(()=>checked(path),/UNKNOWN_PATH/);}
  finally{for(const [key,value]of originals)fs[key]=value;syncBuiltinESMExports();}
  assert.equal(reads,before);assert.deepEqual(calls,[]);
 });
 assert.throws(()=>f.batch.withCheckedHistoricalSource(f.read,()=>({then(){thenRan=true;}})),/SYNC_VOID_ONLY/);
 assert.equal(thenRan,false);
 assert.throws(()=>f.batch.withCheckedHistoricalSource(f.read,checked=>checked),/SYNC_VOID_ONLY/);
});
test('synthetic: common mismatch identifies only exact path/representation/hashes, never source text',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path),bad=Buffer.from('PRIVATE_SOURCE_SENTINEL_NOT_FOR_ERRORS');let drift=false;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>p===path&&drift?bad:f.read(p),checked=>{
  drift=true;checked(path);
 }),error=>{
  exactMismatch(path,good,bad)(error);
  assert(f.batch.isHistoricalSourceMismatch(error));assert(Object.isFrozen(error));
  assert.throws(()=>{error.path='forged';},TypeError);
  assert.throws(()=>{error.actual_sha256='0'.repeat(64);},TypeError);
  assert(!JSON.stringify(error).includes(bad.toString()));
  assert(!String(error.stack).includes(bad.toString()));
  return true;
 });
});
test('synthetic: source-thrown fake mismatch fields return no mutated bytes and cannot forge origin',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path),bad=Buffer.from('PRIVATE_FAKE_ERROR_SENTINEL');
 const fake=Object.assign(Error(bad.toString()),{code:'HISTORICAL_SOURCE_MISMATCH',path,
  representation:'BYTES',expected_sha256:digest(good),actual_sha256:digest(bad),cause:bad.toString()});
 assert.equal(f.batch.isHistoricalSourceMismatch(fake),false);
 for(const value of [null,undefined,0,'HISTORICAL_SOURCE_MISMATCH',{},new Error('other')])
  assert.equal(f.batch.isHistoricalSourceMismatch(value),false);
 let returnedMutatedBytes=0;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>{
  if(p===path)throw fake;return f.read(p);
 },()=>{returnedMutatedBytes++;}),error=>{
  assert.deepEqual({...error},{code:'HISTORICAL_SOURCE_CALLBACK_FAILURE',path});
  assert.equal(error.message,'HISTORICAL_SOURCE_CALLBACK_FAILURE');
  assert.equal(f.batch.isHistoricalSourceMismatch(error),false);
  assert.equal(Object.hasOwn(error,'cause'),false);assert(Object.isFrozen(error));
  assert(!String(error.stack).includes(bad.toString()));assert(!JSON.stringify(error).includes(bad.toString()));
  return true;
 });
 assert.equal(returnedMutatedBytes,0);
});
test('synthetic: replaying an older genuine mismatch from a source is sanitized in a fresh context',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path),bad=Buffer.from('SYNTHETIC_REAL_MUTATED_BYTES');let genuine;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>p===path?bad:f.read(p),()=>{}),error=>{
  exactMismatch(path,good,bad)(error);assert(f.batch.isHistoricalSourceMismatch(error));genuine=error;return true;
 });
 // The predicate attests origin, not successful admission or current context.
 assert(f.batch.isHistoricalSourceMismatch(genuine));assert(Object.isFrozen(genuine));
 assert.equal(f.batch.isHistoricalSourceMismatch({...genuine}),false);
 const clone=Object.assign(Object.create(Object.getPrototypeOf(genuine)),genuine);
 assert.equal(f.batch.isHistoricalSourceMismatch(clone),false);
 let returnedMutatedBytes=0;
 const rethrow=p=>{if(p===path)throw genuine;return f.read(p);};
 const rejected=error=>{
  assert.deepEqual({...error},{code:'HISTORICAL_SOURCE_CALLBACK_FAILURE',path});
  assert.notEqual(error,genuine);assert.equal(f.batch.isHistoricalSourceMismatch(error),false);
  assert.equal(Object.hasOwn(error,'cause'),false);return true;
 };
 assert.throws(()=>f.batch.withCheckedHistoricalSource(rethrow,()=>{returnedMutatedBytes++;}),rejected);
 let replay=false;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>p===path&&replay?rethrow(p):f.read(p),checked=>{
  replay=true;checked(path);returnedMutatedBytes++;
 }),rejected);
 assert.equal(returnedMutatedBytes,0);
});
test('synthetic: first fake or replayed throw stays callback failure when finally returns mutated bytes',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path),bad=Buffer.from('SYNTHETIC_FINALLY_MUTATED_BYTES');let genuine;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>p===path?bad:f.read(p),()=>{}),error=>{
  assert(f.batch.isHistoricalSourceMismatch(error));genuine=error;return true;
 });
 const fake=Object.assign(Error('SYNTHETIC_FAKE_THROW'),{code:'HISTORICAL_SOURCE_MISMATCH',path,
  representation:'BYTES',expected_sha256:digest(good),actual_sha256:digest(bad)});
 for(const thrown of [fake,genuine]){
  let reads=0,mutatedReturns=0,consumed=false;const admissions=f.admission.admissions;
  assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>{
   if(p!==path)return f.read(p);
   if(++reads===1)throw thrown;
   mutatedReturns++;return bad;
  },()=>{consumed=true;}),error=>{
   assert.deepEqual({...error},{code:'HISTORICAL_SOURCE_CALLBACK_FAILURE',path});
   assert.equal(f.batch.isHistoricalSourceMismatch(error),false);return true;
  });
  assert.equal(consumed,false);assert.equal(reads,2);assert.equal(mutatedReturns,1);
  assert(f.admission.admissions>=admissions+2,'final physical admission still executes');
 }
});
test('synthetic: a caught callback throw remains sticky while all final physical checks run',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path),bad=Buffer.from('SYNTHETIC_CAUGHT_THEN_FINALLY_DRIFT');
 const open=fs.openSync,receiptPath=fs.realpathSync(join(f.dir,SEAL));
 let enabled=false,reads=0,firstFailure,finalGate=false,finalReceiptReads=0;
 try{assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>{
  if(p!==path||!enabled)return f.read(p);
  if(++reads===1)throw Error('SYNTHETIC_SOURCE_THROW');
  return bad;
 },checked=>{
  enabled=true;
  assert.throws(()=>checked(path),error=>{firstFailure=error;return true;});
  fs.openSync=(file,...args)=>{
   if(finalGate&&file===receiptPath)finalReceiptReads++;
   return open(file,...args);
  };syncBuiltinESMExports();
  // Final verification and exact receipt checking must both still execute,
  // even though source finally will also encounter a branded byte mismatch.
  f.admission.onNextAdmission(()=>{finalGate=true;throw Error('SYNTHETIC_FINAL_GATE_FAILURE');});
 }),error=>{
  assert.equal(error,firstFailure);
  assert.deepEqual({...error},{code:'HISTORICAL_SOURCE_CALLBACK_FAILURE',path});
  assert.equal(f.batch.isHistoricalSourceMismatch(error),false);return true;
 });}finally{fs.openSync=open;syncBuiltinESMExports();}
 assert.equal(reads,2);assert(firstFailure);assert.deepEqual(f.read(path),good);
 assert.equal(finalGate,true);assert.equal(finalReceiptReads,1);
});
test('synthetic: catching callback failure and restoring the source cannot turn the invocation into success',async t=>{
 const f=await fixture(t),path=f.paths[0];let failOnce=false,firstFailure,restoredReads=0,consumerFinished=false;
 const admissions=f.admission.admissions;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>{
  if(p===path&&failOnce){failOnce=false;throw Error('SYNTHETIC_SWALLOWED_SOURCE_FAILURE');}
  if(p===path&&firstFailure)restoredReads++;
  return f.read(p);
 },checked=>{
  failOnce=true;
  assert.throws(()=>checked(path),error=>{
   assert.deepEqual({...error},{code:'HISTORICAL_SOURCE_CALLBACK_FAILURE',path});
   firstFailure=error;return true;
  });
  assert.deepEqual(checked(path),f.read(path));
  consumerFinished=true;
  // Implicit undefined; the following complete-source and physical gates pass.
 }),error=>{
  assert.equal(error,firstFailure);assert.equal(f.batch.isHistoricalSourceMismatch(error),false);return true;
 });
 assert.equal(consumerFinished,true);assert(restoredReads>=2);
 assert(f.admission.admissions>=admissions+3,'entry, pre-consumer and final physical admissions execute');
});
test('synthetic: Buffer hooks cannot replace actual source bytes or replay a genuine error',async t=>{
 const f=await fixture(t),path=f.paths[0],good=f.read(path),bad=Buffer.from('SYNTHETIC_BUFFER_HOOK_DRIFT');let genuine,hooks=0;
 assert.throws(()=>f.batch.withCheckedHistoricalSource(p=>p===path?bad:f.read(p),()=>{}),error=>{
  assert(f.batch.isHistoricalSourceMismatch(error));genuine=error;return true;
 });
 for(const hook of [()=>{hooks++;throw genuine;},()=>{hooks++;return bad;}]){
  const hooked=Buffer.from(good);hooked.valueOf=hook;
  Object.defineProperty(hooked,'buffer',{get(){hooks++;throw genuine;}});
  Object.defineProperty(hooked,'byteOffset',{get(){hooks++;throw genuine;}});
  Object.defineProperty(hooked,'byteLength',{get(){hooks++;throw genuine;}});
  f.batch.withCheckedHistoricalSource(p=>p===path?hooked:f.read(p),checked=>{
   assert.deepEqual(checked(path),good);
  });
 }
 assert.equal(hooks,0);
});
test('synthetic: immutable Git lookups receive only fixed minimal env, never inherited input',async t=>{
 const f=await fixture(t),original=childProcess.execFileSync,seen=[];
 childProcess.execFileSync=(file,args,options)=>{seen.push({...options.env});return original(file,args,options);};
 syncBuiltinESMExports();
 try{f.batch.withCheckedHistoricalSource(f.read,()=>{});}
 finally{childProcess.execFileSync=original;syncBuiltinESMExports();}
 assert.equal(seen.length,2);for(const env of seen)assert.deepEqual(env,gitEnv);
});
