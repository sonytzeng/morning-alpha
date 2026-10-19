import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {assembleRelease,readReleaseCatalog,HISTORICAL_LOGIC,RELEASE_OUTPUT} from '../scripts/operations/c-worker-local-sdk-release-20261019/materialize.mjs';
const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const expected='0d88f57588d02cb63ba467a3803b44815110a67ad5712e40903c241806bd02d2';
const recoveryExpected='9be683f3b2a69f00084f68f72727de1dfa8db5d5dbdfe0de0c505aa797ecec32';

test('Git sources reproduce the independent sealed 74-file artifact exactly without reverting current global fixes',()=>{
 const first=assembleRelease(),second=assembleRelease();
 assert.equal(sha(first.bytes),expected);assert.equal(first.bytes.length,901426);assert(first.bytes.equals(second.bytes));
 assert.equal(first.payload.files.length,74);assert.equal(new Set(first.payload.files.map(f=>f.name)).size,74);
 assert.equal(first.payload.verify_jwt,true);assert(!('import_map_path'in first.payload));
 assert.equal(first.payload.files.filter(f=>f.name.includes('/licenses/')).length,30);
 const entry='supabase/functions/vnext-daily-research-v1/index.ts';
 const oldEntry=execFileSync('git',['--no-replace-objects','show','5109221ae1c70405d735e7f3cffa3430a6c888fc:'+entry],{cwd:root,env:{PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0'},encoding:'utf8'});
 const emit=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 assert.equal(emit(read(entry).toString()),emit(oldEntry),'fetch annotations must erase to the exact R1 entrypoint runtime');
 const old=new Map(first.payload.files.map(f=>[f.name,Buffer.from(f.content)]));
 assert.equal(sha(read(HISTORICAL_LOGIC[0])),'3346acbbac5437ae83db6b1aeb12b4a42600704d5490c3b154ed9ea26e3bec57');
 assert.equal(sha(read(HISTORICAL_LOGIC[1])),'3b166e74cee4515a6a7e3bf726faf418742c5c22112e9363b38b337257d76a0c');
 assert.equal(sha(old.get(HISTORICAL_LOGIC[0])),'2ef106edc162fb28b7579322dff9b89057b184a2166f51ce57ed31781190d848');
 assert.equal(sha(old.get(HISTORICAL_LOGIC[1])),'ac1457eb889466931f14f4e9c5a44c3a6000a54a6657cd1c977cb4916714eea5');
});

test('current runtime, SDK and static-notice corruption or absence are rejected before producing a payload',()=>{
 const c=readReleaseCatalog();
 for(const name of ['supabase/functions/vnext-daily-research-v1/handler.ts',
  c.files.find(r=>r.name.endsWith('.mjs')&&r.name.includes('_fixed_c_worker_sdk')).name,
  c.files.find(r=>r.name.endsWith('/licenses/NOTICE.md')).name]){
  assert.throws(()=>assembleRelease('repair',{readCurrent:p=>p===name?Buffer.concat([read(p),Buffer.from('\n')]):read(p)}),/RELEASE_(CURRENT_SOURCE|SOURCE)_(SIZE|DRIFT)/);
  assert.throws(()=>assembleRelease('repair',{readCurrent:p=>{if(p===name)throw Object.assign(Error('MISSING_FIXED_SOURCE'),{code:'ENOENT'});return read(p);}}),/MISSING_FIXED_SOURCE/);
 }
});

test('the only two historical logic reads cannot fall back to the changed current files or hide current global drift',()=>{
 for(const name of HISTORICAL_LOGIC){
  assert.throws(()=>assembleRelease('repair',{readHistorical:p=>read(p)}),/RELEASE_(CURRENT_SOURCE|SOURCE)_(SIZE|DRIFT)/);
  assert.throws(()=>assembleRelease('repair',{readHistorical:()=>{throw Error('MISSING_IMMUTABLE_GIT_OBJECT');}}),/MISSING_IMMUTABLE_GIT_OBJECT/);
  assert.throws(()=>assembleRelease('repair',{readCurrent:p=>p===name?Buffer.concat([read(p),Buffer.from('\n')]):read(p)}),/RELEASE_CURRENT_GLOBAL_(SIZE|DRIFT)/);
 }
 assert.deepEqual(HISTORICAL_LOGIC,[
  'supabase/functions/_shared/decision-v1-evidence.ts',
  'supabase/functions/_shared/recommendation-official-actuals.ts',
 ]);
});

test('a successful warm read never masks a later altered source',()=>{
 assembleRelease();
 const name='supabase/functions/vnext-daily-research-v1/index.ts';
 assert.throws(()=>assembleRelease('repair',{readCurrent:p=>p===name?Buffer.from('different entry'):read(p)}),/RELEASE_(CURRENT_SOURCE|SOURCE)_(SIZE|DRIFT)/);
 assert.equal(assembleRelease().sha256,expected);
});

test('the CLI refuses an arbitrary destination and never overwrites a previous fixed artifact',()=>{
 const script=new URL('../scripts/operations/c-worker-local-sdk-release-20261019/materialize.mjs',import.meta.url);
 const artifact=new URL(RELEASE_OUTPUT,root);
 if(!existsSync(artifact)){
  const first=spawnSync(process.execPath,[script.pathname],{cwd:root,encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);
 }
 const before=readFileSync(artifact);assert.equal(sha(before),expected);
 const arbitrary=spawnSync(process.execPath,[script.pathname,'--output','/tmp/unapproved-worker.json'],{cwd:root,encoding:'utf8'});
 assert.notEqual(arbitrary.status,0);assert.match(arbitrary.stderr,/RELEASE_NO_ARGUMENTS/);
 const repeat=spawnSync(process.execPath,[script.pathname],{cwd:root,encoding:'utf8'});
 assert.notEqual(repeat.status,0);assert.match(repeat.stderr,/EEXIST/);
 assert(readFileSync(artifact).equals(before));
});


test('fixed-SDK recovery differs only in the original lease runtime and handler, with no arbitrary variant or ref',()=>{
 const repair=assembleRelease('repair'),recovery=assembleRelease('recovery');
 assert.equal(recovery.sha256,recoveryExpected);assert.equal(recovery.bytes.length,899200);
 assert.equal(recovery.payload.files.length,74);assert.equal(recovery.payload.verify_jwt,true);
 const differences=recovery.payload.files.filter((f,i)=>f.name!==repair.payload.files[i].name||f.content!==repair.payload.files[i].content).map(f=>f.name).sort();
 assert.deepEqual(differences,['src/features/vnext/dailyRuntime.ts','supabase/functions/vnext-daily-research-v1/handler.ts']);
 for(const variant of ['rollback','main','../recovery','recovery@HEAD',{}])assert.throws(()=>assembleRelease(variant),/RELEASE_FIXED_VARIANT/);
});
