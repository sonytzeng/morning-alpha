import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createOriginalRegistryIngress,createOriginalRegistryApprovedReader,ORIGINAL_REGISTRY_READ_RPC,ORIGINAL_REGISTRY_INGRESS_RPC,originalRegistryRowHashes} from '../src/features/vnext/originalRegistryIngress.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {registryFixture,sha,cleanupOriginalRegistryContainer,originalRegistryFailure,finishOriginalRegistryRun} from './fixtures/originalRegistryIngress.mjs';
const run=f=>createOriginalRegistryIngress(f.ports)(randomUUID(),f.input);
test('DB reader is fixed ID-only and does not turn a successful read into writer authority',async()=>{
 const f=await registryFixture(),calls=[],read=createOriginalRegistryApprovedReader(f.pins,async(name,args)=>{calls.push({name,args});return f.records.get(args.p_evidence_id);});
 await read(f.input.evidence_ids[0]);assert.equal(calls[0].name,ORIGINAL_REGISTRY_READ_RPC);
 assert.deepEqual(calls[0].args,{p_evidence_id:f.pins[0].evidence_id,p_version_id:f.pins[0].approval_id});
 assert.throws(()=>read('f'.repeat(64)),/NOT_APPROVED/);
 f.ports.pins[0].approval_id=null;assert.throws(()=>createOriginalRegistryIngress(f.ports),/CONFIG_INVALID/);
});
async function repin(f){for(const pin of f.pins)pin.record_hash=await snapshotHash(f.records.get(pin.evidence_id));}
async function rebind(r){
 const {id,...body}=r.receipt;r.receipt.id=await snapshotHash(body);
 for(const review of [r.quality_review,r.rights_review])Object.assign(review,{evidence_hash:await snapshotHash(r.evidence),receipt_hash:r.receipt.id,license_hash:await snapshotHash(r.license)});
}
test('approved private registry -> ONE existing fixed atomic RPC; no new source, right, quality or C truth',async()=>{
 for(const horizon of ['SHORT','MEDIUM','LONG']){
  const f=await registryFixture({horizon}),result=await run(f);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,ORIGINAL_REGISTRY_INGRESS_RPC);
  assert.deepEqual(f.calls[0].args.p_request,f.input);assert.equal(result.state,'WATCHING');
  assert.equal(result.observation.publication_status,'RESEARCH_ONLY');
  assert.deepEqual(result.source_receipts.map(r=>r.evidence_id),f.input.evidence_ids);
  for(const metadata of result.source_receipts){
   const source=f.records.get(metadata.evidence_id);assert.equal(metadata.schema,'ORIGINAL_VERIFIED_SOURCE_RECEIPT_1');
   assert.equal(metadata.registry_record_hash,await snapshotHash(source));assert.equal(metadata.receipt_hash,source.receipt.id);
   assert.equal(metadata.raw_sha256,source.receipt.raw_sha256);assert.equal(metadata.member_publication,false);
   assert.equal(metadata.use,'PRIVATE_STORAGE_DERIVATION');assert.equal(metadata.license_hash,await snapshotHash(source.license));
  }
  assert([...f.records.values()].every(r=>!r.license.commercial&&!r.license.redistribution));
 }
});
test('caller PASS / forged registry / publication / C QUALIFIED cannot enter the closed request',async()=>{
 for(const key of ['quality','registry','receipt','review','license','pins','status','score','publication_status','created_at']){
  const f=await registryFixture();f.input[key]='PASS';await assert.rejects(()=>run(f),/ORIGINAL_REQUEST_INVALID/);assert.equal(f.calls.length,0);
 }
 const f=await registryFixture();f.input.confirmation_conditions[0].state='CONFIRMED';
 await assert.rejects(()=>run(f),/ORIGINAL_REQUEST_INVALID/);assert.equal(f.calls.length,0);
});
test('unapproved, revoked, colliding and non-exact registry records fail before any write',async()=>{
 const f=await registryFixture();f.ports.pins=f.pins.slice(1);await assert.rejects(()=>run(f),/NOT_APPROVED/);assert.equal(f.calls.length,0);
 const g=await registryFixture();g.records.delete(g.input.evidence_ids[0]);await assert.rejects(()=>run(g),/RECORD_INVALID/);assert.equal(g.calls.length,0);
 const h=await registryFixture();h.ports.pins.push(h.pins[0]);assert.throws(()=>createOriginalRegistryIngress(h.ports),/PIN_COLLISION/);
 const j=await registryFixture();j.records.values().next().value.publication='APPROVED';await assert.rejects(()=>run(j),/RECORD_INVALID/);
});
test('plausible fake receipt, replaced bytes or rewritten registry digest are not source proof',async()=>{
 for(const mutate of [r=>r.receipt.id=sha('fake-receipt'),r=>r.evidence.summary='rewritten',r=>r.receipt.source_ref+='?new=1']){
  const f=await registryFixture();mutate(f.records.values().next().value);await assert.rejects(()=>run(f),/PIN_MISMATCH/);assert.equal(f.calls.length,0);
 }
 for(const key of ['raw_sha256','quality_review','rights_review']){
  const f=await registryFixture(),r=f.records.values().next().value,hash=key==='raw_sha256'?r.receipt.raw_sha256:r[key].document_hash;
  f.artifacts.set(hash,new TextEncoder().encode('SYNTHETIC WRONG BYTES'));
  await assert.rejects(()=>run(f),/ARTIFACT_HASH_MISMATCH/);assert.equal(f.calls.length,0);
 }
 const f=await registryFixture();f.artifacts.clear();await assert.rejects(()=>run(f),/ARTIFACT_INVALID/);assert.equal(f.calls.length,0);
});
test('even pinned PASS needs distinct authorized reviewers and exact evidence/receipt/license bindings',async()=>{
 const mutations=[r=>r.quality_review.result='PENDING',r=>r.rights_review.result='FAIL',r=>r.quality_review.reviewer_ref='isolated-producer',
  r=>r.quality_review.reviewer_ref='isolated-capture',r=>r.rights_review.reviewer_ref='isolated-quality',r=>r.quality_review.reviewer_ref='stranger',
  r=>r.quality_review.evidence_hash=sha('other-evidence'),r=>r.rights_review.receipt_hash=sha('other-receipt'),
  r=>r.rights_review.license_hash=sha('other-license'),r=>r.rights_review.purpose='MEMBER_PUBLICATION',r=>r.quality_review.expires_at='2026-10-19T00:00:00Z',
  r=>r.quality_review.reviewed_at='2026-10-19T00:00:00Z'];
 for(const mutate of mutations){const f=await registryFixture();mutate(f.records.values().next().value);await repin(f);
  await assert.rejects(()=>run(f),/INDEPENDENT_REVIEW_INVALID/);assert.equal(f.calls.length,0);}
});
test('source scope, exact receipt times, rights, stale and insufficient Evidence are not repaired',async()=>{
 const mutations=[r=>r.evidence.symbol='7888',r=>r.receipt.source='other',r=>r.receipt.first_seen_at=r.receipt.published_at,
  r=>r.evidence.source='',r=>r.evidence.source_ref='',r=>r.receipt.raw_sha256='',r=>r.evidence.quality='INSUFFICIENT',r=>r.evidence.relevant=false,r=>r.evidence.published_at=null,
  r=>r.evidence.available_at='2026-10-20T00:00:00Z',r=>r.evidence.valid_until='2026-10-19T00:00:00Z',
  r=>r.license.storage=false,r=>r.license.derived=false,r=>r.license.source='other',r=>r.license.expires_at='2026-10-19T00:00:00Z',
  r=>r.license.document_url='https://example.com/license?token=forbidden'];
 for(const mutate of mutations){const f=await registryFixture(),r=f.records.values().next().value;mutate(r);await rebind(r);await repin(f);
  await assert.rejects(()=>run(f),/REGISTRY_(SOURCE|RIGHTS|RECORD)_INVALID/);assert.equal(f.calls.length,0);}
});
test('empty registry/source enrollment cannot produce a source receipt or invoke RPC',async()=>{
 const f=await registryFixture();f.ports.pins=[];assert.throws(()=>createOriginalRegistryIngress(f.ports),/CONFIG_INVALID/);
 const g=await registryFixture();g.input.evidence_ids=[];await assert.rejects(()=>run(g),/REQUEST_INVALID/);assert.equal(g.calls.length,0);
});
test('an independent review expiring while bytes are read prevents starting the transaction',async()=>{
 const f=await registryFixture();let clock=0;f.ports.now=()=>f.at(clock++===0?0:1800000);
 await assert.rejects(()=>run(f),/REVIEW_EXPIRED_DURING_READ/);assert.equal(f.calls.length,0);
});
test('different horizon requirements remain complete original kinds; no invented thresholds',async()=>{
 const f=await registryFixture(),r=f.records.values().next().value;r.evidence.classification='INFERENCE';await rebind(r);await repin(f);
 await assert.rejects(()=>run(f),/HORIZON_INCOMPLETE/);assert.equal(f.calls.length,0);
});
test('exact microseconds retained; a one-microsecond receipt mismatch is rejected',async()=>{
 const f=await registryFixture(),r=f.records.values().next().value;
 r.receipt.available_at=r.evidence.available_at.replace('.123Z','.123001Z');await rebind(r);await repin(f);
 await assert.rejects(()=>run(f),/SOURCE_INVALID/);assert.equal(f.calls.length,0);
});
test('configuration and request are captured before asynchronous reads; no mutable pin escalation',async()=>{
 const f=await registryFixture(),saved=structuredClone(f.input),ingress=createOriginalRegistryIngress(f.ports);
 f.ports.pins[0].record_hash=sha('changed-config');f.ports.quality_reviewers.splice(0,1,'stranger');
 const pending=ingress(randomUUID(),f.input);f.input.reason='changed-while-reading';const result=await pending;
 assert.equal(result.observation.reason,saved.reason);assert.deepEqual(f.calls[0].args.p_request,saved);
});
test('approval is read afresh on replay; no cached PASS after revocation',async()=>{
 const f=await registryFixture(),ingress=createOriginalRegistryIngress(f.ports),key=randomUUID();await ingress(key,f.input);
 f.records.clear();await assert.rejects(()=>ingress(key,f.input),/RECORD_INVALID/);assert.equal(f.calls.length,1);
});
test('transport failure / unknown commit status is never automatically retried or assigned a new key',async()=>{
 const f=await registryFixture(),key=randomUUID();let calls=0;
 f.ports.rpc=async(name,args)=>{calls++;assert.equal(name,ORIGINAL_REGISTRY_INGRESS_RPC);assert.equal(args.p_request_key,key);throw Error('REPLY_LOST');};
 await assert.rejects(()=>createOriginalRegistryIngress(f.ports)(key,f.input),/REPLY_LOST/);assert.equal(calls,1);
});
test('SQL row expectation hashes normalize offsets/fraction widths but retain one microsecond',async()=>{
 const f=await registryFixture(),r=f.records.values().next().value,a=await originalRegistryRowHashes(r.evidence,r.license);
 const e=structuredClone(r.evidence);e.available_at=e.available_at.replace('.123Z','.123000Z');
 assert.deepEqual(await originalRegistryRowHashes(e,r.license),a);
 e.available_at=new Date(Date.parse(e.available_at)+8*3600000).toISOString().replace('Z','+08:00');
 assert.deepEqual(await originalRegistryRowHashes(e,r.license),a);
 e.available_at=e.available_at.replace('.123+08:00','.123001+08:00');assert.notDeepEqual(await originalRegistryRowHashes(e,r.license),a);
});
test('self-consistent but different committed Evidence does not pass registry reconciliation',async()=>{
 const f=await registryFixture();f.ports.rpc=async()=>{
  const out=await f.response();out.snapshot.evidence[0].summary='different database row';
  const {snapshot_hash,...body}=out.snapshot.observation;
  out.snapshot.observation.snapshot_hash=await snapshotHash({observation:body,evidence:out.snapshot.evidence});return out;
 };
 await assert.rejects(()=>run(f),/COMMITTED_EVIDENCE_MISMATCH/);
});
test('cleanup deletes only the captured dedicated ID and proves post-rm absence by exact inspect',()=>{
 const name='ma-registry-ingress-123-deadbeef',id='a'.repeat(64),calls=[];
 const docker=args=>{calls.push(args);
  if(args.includes('{{.Id}} {{.Name}}'))return `${id} /${name}`;
  if(args[1]==='rm')return id;
  throw Object.assign(Error('SYNTHETIC_MISSING'),{status:1,stderr:`Error: No such container: ${args.at(-1)}\n`});
 };
 assert.equal(cleanupOriginalRegistryContainer({name,id,docker}),'PASS');
 assert.deepEqual(calls,[['container','inspect','--format','{{.Id}} {{.Name}}',id],['container','rm','--force',id],
  ['container','inspect','--format','{{.Id}}',id],['container','inspect','--format','{{.Id}}',name]]);
});
test('cleanup cannot turn failed rm, surviving container or failed inspect into PASS',()=>{
 const name='ma-registry-ingress-123-deadbeef',id='a'.repeat(64);
 for(const mode of ['rm-failed','id-survives','name-survives','daemon-offline','wrong-exit','wrong-missing-target']){
  const calls=[],docker=args=>{calls.push(args);
   if(args.includes('{{.Id}} {{.Name}}'))return `${id} /${name}`;
   if(args[1]==='rm'){if(mode==='rm-failed')throw Error('SYNTHETIC_RM_FAILED');return id;}
   const target=args.at(-1);
   if(mode==='id-survives'&&target===id||mode==='name-survives'&&target===name)return id;
   throw Object.assign(Error('SYNTHETIC_INSPECT_FAILED'),{status:mode==='wrong-exit'?125:1,
    stderr:mode==='daemon-offline'?'Cannot connect to the Docker daemon':`Error: No such container: ${mode==='wrong-missing-target'?'other-container':target}`});
  };
  assert.equal(cleanupOriginalRegistryContainer({name,id,docker}),'FAIL',mode);
  assert.deepEqual(calls.filter(a=>a[1]==='rm'),[['container','rm','--force',id]]);
  assert.equal(calls.filter(a=>a.includes('{{.Id}}')).length,2,'inspect both targets even if rm failed');
 }
});
test('cleanup refuses unknown ID/name/ownership without deleting any container',()=>{
 const name='ma-registry-ingress-123-deadbeef',id='a'.repeat(64);
 for(const bad of [{name:'unrelated-container',id},{name,id:''},{name,id:'not-a-container-id'},{name,id}]){
  const calls=[],docker=args=>{calls.push(args);return `${'b'.repeat(64)} /unrelated-container`;};
  assert.equal(cleanupOriginalRegistryContainer({...bad,docker}),'FAIL');assert.equal(calls.filter(a=>a[1]==='rm').length,0);
 }
});
test('CI prepares the exact existing clock image before Registry controls without new permissions',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/original-observation-ingress.yml',import.meta.url),'utf8');
 const build='docker build --quiet -t ma-runtime-sparse-ci:latest - < tests/fixtures/runtime-sparse-postgres.Dockerfile >/dev/null 2>&1';
 assert(workflow.indexOf(build)>0);assert(workflow.indexOf(build)<workflow.indexOf('run: node --experimental-strip-types tests/vnextOriginalRegistryIngressDatabase.integration.mjs'));
 assert.match(workflow,/permissions:\n  contents: read\njobs:/);assert.match(workflow,/Prepare the existing isolated PostgreSQL clock image\n        timeout-minutes: 5/);
 assert(!workflow.includes('secrets.'));assert(!workflow.includes('clockedPsql.mjs'));
 const script=workflow.slice(workflow.indexOf('          if docker build --quiet'),workflow.indexOf('      - name: Approved Registry')).replace(/^          /gm,'');
 for(const code of [0,125]){
  // Execute the actual workflow shell with a harmless function, not Docker.
  const result=spawnSync('bash',['--noprofile','--norc','-c',`docker(){ printf 'PRIVATE_DOCKER_LOG\\n'; printf 'PRIVATE_ENV_VALUE\\n' >&2; return ${code}; }\n${script}`],{encoding:'utf8',timeout:1000});
  assert.equal(result.status,code);assert.equal(result.stderr,'');
  assert.deepEqual(JSON.parse(result.stdout),code===0?{phase:'IMAGE_PREPARE',class:'READY'}:{phase:'IMAGE_PREPARE',class:'IMAGE_BUILD_FAILED',exit_code:125});
 }
});
test('missing image and startup failure retain bounded primary classification; absent is NOT_CREATED, never PASS',()=>{
 const name='ma-registry-ingress-123-deadbeef';
 for(const [phase,stderr,classification] of [
  ['IMAGE_CHECK','Error response from daemon: No such image: ma-runtime-sparse-ci:latest','LOCAL_IMAGE_MISSING'],
  ['CONTAINER_START','SYNTHETIC start failure with PRIVATE_ENV_VALUE','CONTAINER_START_FAILED'],
  ['CONTAINER_START','permission denied at PRIVATE_ENV_VALUE','DOCKER_PERMISSION_DENIED']]){
  const calls=[],failure={phase,error:Object.assign(Error('PRIVATE_ENV_VALUE'),{status:125,stderr,stdout:'PRIVATE_DOCKER_LOG'})};
  const docker=args=>{calls.push(args);throw Object.assign(Error('PRIVATE_DOCKER_LOG'),{status:1,stderr:`Error: No such container: ${name}\n`});};
  const result=finishOriginalRegistryRun({name,id:'',docker,failure});
  assert.deepEqual(result,{cleanup:'NOT_CREATED',primary:{phase,class:classification,exit_code:125},failed:true});
  assert.deepEqual(calls,[['container','inspect','--format','{{.Id}}',name]]);
  assert(!JSON.stringify(result).includes('PRIVATE_'));assert(JSON.stringify(result).length<256);
 }
});
test('startup with an existing object or unknown absence never deletes blindly or claims NOT_CREATED',()=>{
 const name='ma-registry-ingress-123-deadbeef',failure={phase:'CONTAINER_START',error:Error('SYNTHETIC_START_FAILED')};
 for(const mode of ['exists','offline','wrong-target','wrong-exit','signaled']){
  const calls=[],docker=args=>{calls.push(args);if(mode==='exists')return 'a'.repeat(64);
   throw Object.assign(Error('PRIVATE_DOCKER_LOG'),{status:mode==='wrong-exit'?125:1,signal:mode==='signaled'?'SIGTERM':null,
    stderr:mode==='offline'?'Cannot connect to the Docker daemon':`Error: No such container: ${mode==='wrong-target'?'other-container':name}`});};
  const result=finishOriginalRegistryRun({name,id:'',docker,failure});
  assert.equal(result.cleanup,'FAIL',mode);assert(result.failed);assert.equal(calls.length,1);assert.equal(calls[0][1],'inspect');
 }
});
test('actual cleanup failure remains failure with or without a primary error; primary is not masked',()=>{
 const name='ma-registry-ingress-123-deadbeef',id='a'.repeat(64);
 for(const failure of [null,{phase:'SQL_CONTROLS',error:Object.assign(Error('PRIVATE_SQL_PAYLOAD'),{status:3,stderr:'PRIVATE_DOCKER_LOG'})}]){
  const calls=[],docker=args=>{calls.push(args);if(args.includes('{{.Id}} {{.Name}}'))return `${id} /${name}`;
   if(args[1]==='rm')throw Error('SYNTHETIC_RM_FAILED');
   throw Object.assign(Error('SYNTHETIC_MISSING'),{status:1,stderr:`Error: No such container: ${args.at(-1)}`});};
  const result=finishOriginalRegistryRun({name,id,docker,failure});
  assert.equal(result.cleanup,'FAIL');assert(result.failed);
  assert.deepEqual(result.primary,failure?{phase:'SQL_CONTROLS',class:'SQL_CONTROL_FAILED',exit_code:3}:null);
  assert(!JSON.stringify(result).includes('PRIVATE_'));assert.equal(calls.filter(a=>a[1]==='rm').length,1);
 }
});
test('successful cleanup cannot erase primary failure; invalid ownership cannot authorize deletion',()=>{
 const name='ma-registry-ingress-123-deadbeef',id='a'.repeat(64),failure={phase:'SQL_CONTROLS',error:Object.assign(Error('PRIVATE_ASSERTION'),{code:'ERR_ASSERTION'})};
 const docker=args=>{if(args.includes('{{.Id}} {{.Name}}'))return `${id} /${name}`;if(args[1]==='rm')return id;
  throw Object.assign(Error('SYNTHETIC_MISSING'),{status:1,stderr:`Error: No such container: ${args.at(-1)}`});};
 const result=finishOriginalRegistryRun({name,id,docker,failure});assert.equal(result.cleanup,'PASS');assert(result.failed);
 assert.equal(result.primary.class,'CONTROL_ASSERTION_FAILED');
 for(const bad of [{name:'other-container',id:''},{name,id:'invalid-id'},{name,id}]){
  const calls=[],unowned=args=>{calls.push(args);return `${'b'.repeat(64)} /other-container`;};
  assert(finishOriginalRegistryRun({...bad,docker:unowned,failure}).failed);assert(!calls.some(a=>a[1]==='rm'));
 }
 assert.deepEqual(originalRegistryFailure({status:999,stderr:'PRIVATE_LOG'},'PRIVATE_PHASE'),{phase:'UNKNOWN',class:'SQL_CONTROL_FAILED',exit_code:null});
});
