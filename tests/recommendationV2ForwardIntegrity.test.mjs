import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {LINE_CARD_BASE} from './helpers/lineDecisionIntegrity.mjs';
import {V2_FORWARD_PATHS,V2_FORWARD_MANIFEST,v2ForwardTransition,forwardChangedPaths,forwardPrior} from './helpers/recommendationV2ForwardIntegrity.mjs';
import {V2_PATHS} from './helpers/recommendationV2Integrity.mjs';
import {withV2HistoricalBatch,checkV2InjectedRowDrift} from './helpers/v2HistoricalBatch.mjs';
import {withCheckedHistoricalSource,isHistoricalSourceMismatch} from './helpers/recommendationHistoricalBatch.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const changedManifest=change=>{const m=JSON.parse(read(V2_FORWARD_MANIFEST));change(m);return p=>p===V2_FORWARD_MANIFEST?Buffer.from(JSON.stringify(m)):read(p);};
test('Forward candidate enforces exact file set, predecessor hashes and frozen methodology',()=>{
 withV2HistoricalBatch(read,view=>{
 const transition=view.v2ForwardTransition();
 view.lineCardTransition(); // Validate every exact successor byte before restoring history.
 const forwardPaths=execFileSync('git',['diff','--name-only','-z','10208c0817718d29f9f86284c32cff5c3ffb39e6',LINE_CARD_BASE],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
 assert.deepEqual(forwardPaths,[...V2_FORWARD_PATHS,V2_FORWARD_MANIFEST].sort());
 assert(forwardChangedPaths().length>=forwardPaths.length);
 for(const row of transition.manifest.files){
  if(row.operation==='ADD')assert.throws(()=>transition.predecessorRead(row.path),{code:'ENOENT'});
  else assert.deepEqual(transition.predecessorRead(row.path),forwardPrior(row.path));
 }
 });
});
test('every Forward byte is sealed; missing, duplicated and unknown files fail closed',()=>{
 withV2HistoricalBatch(read,view=>{
 for(const row of view.v2ForwardTransition().manifest.files){
  const original=read(row.path),mutated=Buffer.concat([original,Buffer.from('drift')]);
  assert.throws(()=>checkV2InjectedRowDrift('forward',row,p=>p===row.path?Buffer.concat([read(p),Buffer.from('drift')]):read(p),original,mutated),/unreviewed candidate drift/);
 }
 });
 for(const change of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.push({...m.files[0],path:'unknown'}),m=>{m.base='unreviewed';},m=>{m.predecessor_sha256='0'.repeat(64);}])
  assert.throws(()=>v2ForwardTransition(changedManifest(change)));
 assert.throws(()=>v2ForwardTransition(p=>{if(p===V2_FORWARD_MANIFEST)throw Object.assign(Error('missing'),{code:'ENOENT'});return read(p);}),{code:'ENOENT'});
});
test('Forward authorization does not silently permit production methodology or security changes',()=>{
 for(const key of ['new_secrets','cron_changes','core_auth_changes','rls_policy_changes','v1_threshold_changes','promotion','member_access','business_backfill'])
  assert.throws(()=>v2ForwardTransition(changedManifest(m=>{m[key]=true;})));
 withV2HistoricalBatch(read,view=>{
 const line=view.lineCardTransition();
 for(const path of ['supabase/config.toml','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/_shared/recommendation-shadow-v2-engine.ts','supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/line-daily-push/index.ts'])
  assert.deepEqual(line.predecessorRead(path),forwardPrior(path),path);
 });
 for(const change of [m=>m.functions.push('unreviewed-function'),m=>m.migrations.push('unreviewed.sql')])assert.throws(()=>v2ForwardTransition(changedManifest(change)));
});

test('synthetic V2 adapter controls: wrong-path and wrong-byte source mismatches retain their guard error',()=>{
 const row={path:V2_FORWARD_PATHS[0]},other=V2_FORWARD_PATHS[1];
 const original=read(row.path),mutated=Buffer.concat([original,Buffer.from('drift')]);
 assert.throws(()=>checkV2InjectedRowDrift('forward',row,p=>p===other?Buffer.concat([read(p),Buffer.from('drift')]):read(p),original,mutated),
  error=>error.code==='HISTORICAL_SOURCE_MISMATCH'&&error.path===other);
 assert.throws(()=>checkV2InjectedRowDrift('forward',row,p=>p===row.path?Buffer.concat([read(p),Buffer.from('WRONG_BYTES')]):read(p),original,mutated),
  error=>error.code==='HISTORICAL_SOURCE_MISMATCH'&&error.path===row.path&&!/unreviewed candidate drift/.test(error.message));
 const stale=Buffer.concat([original,Buffer.from('STALE_DESCRIPTION')]);
 assert.throws(()=>checkV2InjectedRowDrift('forward',row,p=>p===row.path?Buffer.concat([read(p),Buffer.from('drift')]):read(p),stale,Buffer.concat([stale,Buffer.from('drift')])),
  error=>error.code==='HISTORICAL_SOURCE_MISMATCH'&&error.path===row.path&&!/unreviewed candidate drift/.test(error.message));
 // A mutation description alone is never a fabricated negative result: the
 // original injected source must actually disagree with admitted current bytes.
 assert.doesNotThrow(()=>checkV2InjectedRowDrift('forward',row,read,original,mutated));
});

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function callbackFailure(path){
 return error=>{
  assert.equal(error.code,'HISTORICAL_SOURCE_CALLBACK_FAILURE');
  assert.equal(error.message,'HISTORICAL_SOURCE_CALLBACK_FAILURE');
  assert.equal(error.path,path);
  assert.equal(isHistoricalSourceMismatch(error),false);
  for(const key of ['cause','representation','expected_sha256','actual_sha256'])
   assert.equal(Object.hasOwn(error,key),false,'callback failure must not copy source error '+key);
  assert.doesNotMatch(error.message,/unreviewed candidate drift|SYNTHETIC_FORGED_ERROR/);
  return true;
 };
}

test('synthetic V2 adapter controls: forged matching error fields are callback failure, never byte drift',()=>{
 for(const stage of ['shadow','forward']){
  const row={path:(stage==='shadow'?V2_PATHS:V2_FORWARD_PATHS)[0]},original=read(row.path);
  const mutated=Buffer.concat([original,Buffer.from(stage==='shadow'?'DRIFT':'drift')]);
  const forged=Object.assign(Error('SYNTHETIC_FORGED_ERROR'),{
   code:'HISTORICAL_SOURCE_MISMATCH',path:row.path,representation:'BYTES',
   expected_sha256:digest(original),actual_sha256:digest(mutated),
  });
  assert.equal(isHistoricalSourceMismatch(forged),false);
  let throws=0;
  // This source never returns mutated bytes, despite perfectly matching fields.
  const source=path=>{if(path===row.path){throws++;throw forged;}return read(path);};
  assert.throws(()=>checkV2InjectedRowDrift(stage,row,source,original,mutated),callbackFailure(row.path));
  assert(throws>0,'the source exception must actually be exercised');
 }
});

test('synthetic V2 adapter controls: replayed genuine mismatch is callback failure, actual returned bytes still map',()=>{
 for(const stage of ['shadow','forward']){
  const row={path:(stage==='shadow'?V2_PATHS:V2_FORWARD_PATHS)[0]},original=read(row.path);
  const mutated=Buffer.concat([original,Buffer.from(stage==='shadow'?'DRIFT':'drift')]);
  const source=path=>path===row.path?Buffer.from(mutated):read(path);
  let genuine;
  assert.throws(()=>withCheckedHistoricalSource(source,()=>assert.fail('dirty source cannot enter consumer')),error=>{
   assert.equal(isHistoricalSourceMismatch(error),true);
   assert.equal(error.path,row.path);assert.equal(error.representation,'BYTES');
   assert.equal(error.expected_sha256,digest(original));assert.equal(error.actual_sha256,digest(mutated));
   for(const key of ['code','path','representation','expected_sha256','actual_sha256']){
    const field=Object.getOwnPropertyDescriptor(error,key);
    assert.equal(field?.writable,false,'guard mismatch field must be immutable: '+key);
    assert.equal(field?.configurable,false,'guard mismatch field must not be replaceable: '+key);
   }
   genuine=error;return true;
  });
  let replays=0;
  // A genuine private identity is not authority for a NEW source invocation.
  const replay=path=>{if(path===row.path){replays++;throw genuine;}return read(path);};
  assert.throws(()=>checkV2InjectedRowDrift(stage,row,replay,original,mutated),callbackFailure(row.path));
  assert(replays>0,'the genuine error must actually be replayed by the source');
  let copyAttempts=0,coercionCalls=0;
  const replayDuringCopy=path=>{
   if(path!==row.path)return read(path);
   copyAttempts++;
   return new Proxy(Buffer.from(original),{get(target,key){
    if(key==='valueOf')return ()=>{coercionCalls++;throw genuine;};
    return Reflect.get(target,key,target);
   }});
  };
  // A Buffer-shaped proxy is another possible replay site. Intrinsic copying
  // must reject it without invoking a user-controlled valueOf hook.
  assert.throws(()=>checkV2InjectedRowDrift(stage,row,replayDuringCopy,original,mutated),callbackFailure(row.path));
  assert(copyAttempts>0,'the returned Buffer-shaped replay value must actually be exercised');
  assert.equal(coercionCalls,0,'source-value copying must not invoke user-controlled valueOf');
  assert.equal(isHistoricalSourceMismatch(genuine),true);
  assert.throws(()=>checkV2InjectedRowDrift(stage,row,source,original,mutated),error=>{
   assert(error instanceof assert.AssertionError);
   assert.equal(error.message.split('\n',1)[0],'unreviewed candidate drift ('+(stage==='shadow'?'V2':'Forward')+'): '+row.path);
   assert.equal(error.expected,digest(original));assert.equal(error.actual,digest(mutated));
   return true;
  });
 }
});
