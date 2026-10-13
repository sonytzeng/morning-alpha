import test from 'node:test';import assert from 'node:assert/strict';
import {globSync,readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {publicTestInventory,publicPartitions,verifyPublicPartitions,publicShardArgs,PUBLIC_SHARDS,PUBLIC_OLD_SPACE_MIB} from '../scripts/cto/public-regression-shard.mjs';
test('independent original public glob is exhausted once across all four CI partitions',()=>{
 const all=publicTestInventory(),parts=publicPartitions(all);verifyPublicPartitions(all,parts);
 const root=fileURLToPath(new URL('../',import.meta.url));
 assert.deepEqual(all,globSync('tests/*.test.mjs',{cwd:root}).sort(),'independent original glob equals the actual invocation universe');
 assert.equal(PUBLIC_SHARDS,4);assert.equal(parts.flat().length,all.length);
 assert.ok(all.includes('tests/ctoPublicShard.test.mjs'));assert.ok(all.includes('tests/productContract.test.mjs'));
 for(let i=0;i<4;i++){const args=publicShardArgs(all,i);assert.deepEqual(args.slice(0,4),['--max-old-space-size=2048','--test','--test-concurrency=1','--test-reporter=tap']);assert.deepEqual(args.slice(4),parts[i]);}
});
test('bounded V8 old-space is accepted by the real runtime without changing any test selection',()=>{
 assert.equal(PUBLIC_OLD_SPACE_MIB,2048);
 const result=spawnSync(process.execPath,[publicShardArgs(publicTestInventory(),0)[0],'--input-type=module','-e',"import{getHeapStatistics}from'node:v8';console.log(getHeapStatistics().heap_size_limit)"],{encoding:'utf8'});
 assert.equal(result.status,0);const limit=Number(result.stdout.trim());assert.ok(limit>2048*1024*1024&&limit<2200*1024*1024);
});
test('required aggregate refuses every nonsuccess upstream state instead of passing as skipped',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/validate-release.yml',import.meta.url),'utf8');
 const aggregate=workflow.slice(workflow.indexOf('  validate:'));
 assert.match(aggregate,/needs: public-regression/);assert.match(aggregate,/if: \$\{\{ always\(\) \}\}/);
 assert.match(aggregate,/run: test '\$\{\{ needs\.public-regression\.result \}\}' = success/);
 for(const result of ['success','failure','cancelled','skipped','unknown','']){
  const actual=spawnSync('/bin/sh',['-c','test "$MA_PARTITION_RESULT" = success'],{env:{MA_PARTITION_RESULT:result}});
  assert.equal(actual.status===0,result==='success',result||'missing result');
 }
});
test('omission, duplication, unsafe filenames and invalid partition indices fail closed',()=>{
 const all=publicTestInventory(),parts=publicPartitions(all);
 const missing=structuredClone(parts);missing[0].pop();assert.throws(()=>verifyPublicPartitions(all,missing));
 const duplicate=structuredClone(parts);duplicate[0].push(parts[1][0]);assert.throws(()=>verifyPublicPartitions(all,duplicate));
 for(const bad of ['tests/../other.test.mjs','--test-skip-pattern=everything','tests/other.mjs'])assert.throws(()=>publicPartitions([...all,bad]));
 for(const index of [-1,4,1.5,NaN,'0'])assert.throws(()=>publicShardArgs(all,index));
});
