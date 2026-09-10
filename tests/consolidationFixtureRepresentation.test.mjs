// Pure source/representation contracts. No DB, runtime, network, Auth or Git writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import vm from 'node:vm';
import ts from 'typescript';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { PUBLIC_EXPORT_ARTIFACT_PATH, resolveConsolidationPublicExportIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';
import { FIXTURE_REPRESENTATION_ARTIFACT_PATH, EXACT_FIXTURE_REPRESENTATIONS,
  readExactFixturePreimage, resolveConsolidationFixtureRepresentation } from './helpers/consolidationFixtureRepresentation.mjs';

const REGISTRY='docs/operations/core-stability-incident-amendment-20260908.json';
const GUARD='tests/helpers/consolidationFixtureRepresentation.mjs';
const SECTION='core_fixture_representation_registration';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const raw=read(REGISTRY),registry=JSON.parse(raw),artifactBytes=read(FIXTURE_REPRESENTATION_ARTIFACT_PATH),artifact=JSON.parse(artifactBytes);
const eighth=read(PUBLIC_EXPORT_ARTIFACT_PATH);
const verify=(r=registry,source=read)=>resolveConsolidationPublicExportIntegrity(r,eighth,source);

test('four-fixture admission: independent entry/helper/artifact pins and complete original nine-layer reconstruction',()=>{
  assert.equal(hash(read(GUARD)),'095275513e40d172b8214408ac62cc219840cda8c012f6dbb73fbf3e34ed08ac');
  assert.equal(hash(artifactBytes),'6595d0e89d2ef0843420fce4e810cb76bd9ac0a78e6a42b9092062a0c956dae1');
  assert.equal(hash(raw),'188a0b57dc9c3363dce9f73a20737c927bbaca068909edbdfdb98cd253d88e35');
  assert.equal(artifact.registration.files.length,10); assert.equal(artifact.representations.length,4);
  const result=verify();
  assert.equal(hash(result.ninthReadSource(REGISTRY)),'48668fbb895cb926fbec2c696358161bb701b1534805a078caa268998086087c');
  assert.equal(hash(gunzipSync(Buffer.from(artifact.previous_complete_registry_gzip_base64,'base64'))),hash(result.ninthReadSource(REGISTRY)));
  assert.equal(result.ninthRegistry[SECTION],undefined);
  assert.equal(hash(result.ninthReadSource('tests/helpers/consolidationPublicExportIntegrity.mjs')),'316468bccd0495f4116c91e4da598b87a79f87c1fde68ffff165b7a8b06217a3');
  assert.equal(hash(result.eighthReadSource(REGISTRY)),'adab1af6cc1099536c16b3704cbdaaae8f41f27c1243a6c485b40e0be2cc9411');
  assert.equal(hash(read('tests/helpers/consolidationRequiredMarketIntegrity.mjs')),'8ce476ae47872563b01a77830c26336400effebac08c4fd365760b499f454b0c');
});

for(const row of EXACT_FIXTURE_REPRESENTATIONS)test('exact original fixture and strict candidate bytes: '+row.path,()=>{
  const live=read(row.path),original=readExactFixturePreimage(row.path,live);
  assert.equal(hash(original),row.original_sha256);assert.equal(hash(live),row.candidate_sha256);
  assert.deepEqual(original,Buffer.concat([live,Buffer.from([10])]));
  assert.deepEqual(JSON.parse(original),JSON.parse(live));
  assert.deepEqual(original,gunzipSync(Buffer.from(artifact.preimages[row.path],'base64')));
  for(const invalid of [original,live.subarray(0,-1),Buffer.concat([live,Buffer.from('\n\n')]),Buffer.from(live.toString().replace(/\n/g,'\r\n')),Buffer.from(JSON.stringify(JSON.parse(live))+'\n')]){
    assert.throws(()=>readExactFixturePreimage(row.path,invalid),/exact candidate fixture (length|hash)/);
  }
  const changed=Buffer.from(live);changed[1]=32;assert.throws(()=>readExactFixturePreimage(row.path,changed),/exact candidate fixture hash/);
});

test('representation rejects unknown/traversal/alias paths and sealed artifact tampering',()=>{
  const row=EXACT_FIXTURE_REPRESENTATIONS[0];
  for(const path of ['unknown.json','../'+row.path,row.path.replace('20260921','20260922')])assert.throws(()=>readExactFixturePreimage(path,read(row.path)),/unapproved fixture representation path/);
  for(const mutate of [a=>delete a.preimages[row.path],a=>a.preimages[row.path]='broken',a=>a.representations.pop(),a=>a.representations.push(a.representations[0]),a=>a.representations[0].original_sha256='0'.repeat(64)]){
    const changed=structuredClone(artifact);mutate(changed);
    assert.throws(()=>readExactFixturePreimage(row.path,read(row.path),json(changed)),/Tenth independently pinned artifact/);
  }
});

test('actual representation declaration rejects corrupt or swapped original preimages beneath its independently tested artifact seal',()=>{
  const source=read(GUARD).toString(),row=EXACT_FIXTURE_REPRESENTATIONS[0];
  for(const replacement of ['broken',artifact.preimages[EXACT_FIXTURE_REPRESENTATIONS[1].path],gzipSync(Buffer.concat([read(row.path),Buffer.from('\n\n')])).toString('base64')]){
    const changed=structuredClone(artifact);changed.preimages[row.path]=replacement;
    const actual=isolatedFunction(source,'readExactFixturePreimage',{assert,Buffer,gunzipSync,hash,exports:{},EXACT_FIXTURE_REPRESENTATIONS,readSealedArtifact:()=>changed,defaultArtifact:()=>Buffer.alloc(0)});
    assert.throws(()=>actual(row.path,read(row.path)));
  }
});

for(const row of artifact.registration.files)test('Tenth rejects each live source drift before original Ninth callback: '+row.path,()=>{
  let calls=0;
  const source=path=>path===row.path?Buffer.concat([read(path),Buffer.from('\nUNREVIEWED\n')]):read(path);
  assert.throws(()=>resolveConsolidationFixtureRepresentation(registry,eighth,source,()=>{calls++;}),/unreviewed Tenth source drift/);
  assert.equal(calls,0);assert.throws(()=>verify(registry,source),/unreviewed Tenth source drift/);
});

for(const mode of ['missing','empty','null','array'])test('live entry never bypasses Tenth for '+mode+' registration',()=>{
  const changed=structuredClone(registry);
  if(mode==='missing')delete changed[SECTION];else changed[SECTION]=mode==='empty'?{}:mode==='null'?null:[];
  assert.throws(()=>verify(changed),/Tenth registration required|Tenth independently fixed registration/);
});

test('co-mutated metadata, live hashes or earlier registry cannot self-authorize',()=>{
  for(const mutate of [r=>r[SECTION].files.pop(),r=>r[SECTION].files.push(r[SECTION].files[0]),r=>r[SECTION].files[0].candidate_hash='0'.repeat(64),r=>r[SECTION].runtime_raw_hash_waiver=true,r=>r[SECTION].release_ready=true]){
    const changed=structuredClone(registry);mutate(changed);
    assert.throws(()=>verify(changed,path=>path===REGISTRY?json(changed):read(path)),/Tenth independently fixed registration/);
  }
  const changed=structuredClone(registry);changed.files[0].baseline_sha256='0'.repeat(64);
  assert.throws(()=>verify(changed,path=>path===REGISTRY?json(changed):read(path)),/all nine registry layers unchanged/);
});

test('all original verifier and historical attack/test tails remain byte-identical',()=>{
  const result=verify();
  for(const row of artifact.registration.preserved_test_bodies){
    const before=result.ninthReadSource(row.path).toString(),after=read(row.path).toString();
    assert.equal(before.slice(before.indexOf(row.marker)),after.slice(after.indexOf(row.marker)));
    assert.equal(hash(after.slice(after.indexOf(row.marker))),row.sha256);
  }
  const path='tests/helpers/consolidationPublicExportIntegrity.mjs';
  const body=bytes=>{const parsed=ts.createSourceFile(path,bytes.toString(),ts.ScriptTarget.Latest,true);return parsed.statements.find(node=>node.name?.getText(parsed)==='verifyPublicExport').getText(parsed);};
  assert.equal(body(read(path)),body(result.ninthReadSource(path)));
});

test('runtime adapters change only exact historical predecessor reads, not actual manifest or fixture raw checks',()=>{
  const result=verify();
  for(const [path,name,validator]of [['tests/helpers/coreConsolidationFactualExportRuntime.mjs','FACTUAL_INPUT_PREDECESSOR','validateDateOnlyProviderFixture'],['tests/helpers/coreConsolidationMissingQuoteRuntime.mjs','MISSING_QUOTE_CONTROL','validateMissingQuoteFixture']]){
    const before=result.ninthReadSource(path).toString(),after=read(path).toString();
    const reverted=after.replace("\nimport { readExactFixturePreimage } from './consolidationFixtureRepresentation.mjs';",'')
      .replace(`  const predecessorBytes = readExactFixturePreimage(${name}.path, readFileSync(resolve(repo, ${name}.path)));\n  ${validator}(fixture, JSON.parse(predecessorBytes));\n  assert.equal(sha256(predecessorBytes), ${name}.sha256);`,
        `  ${validator}(fixture, JSON.parse(readFileSync(resolve(repo, ${name}.path), 'utf8')));\n  assert.equal(sha256(readFileSync(resolve(repo, ${name}.path))), ${name}.sha256);`);
    assert.equal(reverted,before);
    assert.match(after,/sha256\(readFileSync\(resolve\(repo, row.path\)\)\), row.sha256, 'Source drift:/);
    assert.match(after,/sha256\(fixtureBytes\), config.boundary.fixture_sha256, 'Provider fixture drift'/);
  }
});

test('actual preparation read adapters select only their one exact fixture and preserve other raw reads',()=>{
  for(const path of ['tests/coreConsolidationReplayPreparation.test.mjs','tests/coreConsolidationFactualExportPreparation.test.mjs']){
    const parsed=ts.createSourceFile(path,read(path).toString(),ts.ScriptTarget.Latest,true);
    const names=['representedFixturePath','representedFixtureUrl','readFileSync'];
    const statements=parsed.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>names.includes(d.name.getText(parsed))));
    assert.equal(statements.length,3);
    const reads=[],root=new URL('../',import.meta.url),context={URL,readExactFixturePreimage,readActualFileSync:(target,options)=>{
      const relative=new URL(target).pathname.slice(root.pathname.length);reads.push(relative);const bytes=read(relative);return options==='utf8'?bytes.toString():bytes;
    }};
    const body=statements.map(node=>node.getText(parsed)).join('\n').replaceAll('import.meta.url',JSON.stringify(new URL('../'+path,import.meta.url).href));
    const wrapper=vm.runInNewContext(body+'\n({readFileSync,representedFixturePath})',context);
    const target=new URL(wrapper.representedFixturePath,root);
    assert.equal(hash(wrapper.readFileSync(target)),EXACT_FIXTURE_REPRESENTATIONS.find(row=>row.path===wrapper.representedFixturePath).original_sha256);
    assert.equal(typeof wrapper.readFileSync(target,'utf8'),'string');
    const other=new URL(REGISTRY,root);assert.deepEqual(wrapper.readFileSync(other),read(REGISTRY));
    assert.ok(reads.includes(REGISTRY));
  }
});

test('existing date-only and missing-quote provenance keep their original hashes and results remain historical',()=>{
  const template='f1eda85b78645eb0c7264890cc73334e4624d5d4c0535300546f1316ad49a81a';
  for(const day of ['20260925','20260930'])assert.equal(JSON.parse(read('tests/fixtures/consolidation-v1/providers/full-chain-synthetic-'+day+'.json')).provenance.synthetic_template.sha256,template);
  for(const day of ['20261002','20261006'])assert.equal(JSON.parse(read('tests/fixtures/consolidation-v1/providers/missing-required-nvda-'+day+'.json')).provenance.source_control.sha256,'8b22d81d9e74ac7cdaf1d7224c4076b72c1354bcb26407881150bd064c2e7c48');
  assert.ok(artifact.retained_runtime_evidence.every(row=>row.rerun===false));
  assert.ok(Object.values(artifact.claims).every(value=>value===false));
  assert.equal(artifact.retained_whitespace_failure.historical_result_rewritten,false);
});
