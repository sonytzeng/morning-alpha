// Exact source/rollback proof only, never real source completeness or Production.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {assemble,propose,CHANGED,CATALOG,CATALOG_SHA256} from '../scripts/operations/financial-response-period-20261020/materialize.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
test('fixed four-file Worker payload retains SDK, JWT, exact rollback and all unchanged dependencies',()=>{
 const a=assemble('candidate'),b=assemble('recovery'),c=JSON.parse(read(CATALOG));
 assert.equal(sha(read(CATALOG)),CATALOG_SHA256);assert.deepEqual(c,propose(c.confirmed_sources));
 assert.equal(a.payload.files.length,78);assert.equal(a.payload.verify_jwt,true);
 assert.equal(b.sha256,'34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762');
 const changed=[];for(const [i,f]of a.payload.files.entries()){
  assert.equal(f.name,b.payload.files[i].name);if(f.content!==b.payload.files[i].content)changed.push(f.name);
 }
 assert.deepEqual(changed.sort(),[...CHANGED].sort());assert.equal(c.sdk,'2.57.4');assert.equal(c.production_authorized,false);
 assert.equal(c.sql,false);assert.equal(c.source_admission,false);assert.equal(c.formal_v1_threshold_change,false);
 assert.match(c.recovery,/NOT_IDENTICAL_PHYSICAL_ESZIP/);
 for(const variant of ['latest','../recovery','deploy'])assert.throws(()=>assemble(variant),/FIXED_VARIANT/);
 assert.throws(()=>assemble('candidate',p=>p===CHANGED[1]?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/SOURCE_DRIFT/);
});
test('fixed runtime and recovery closures pass actual offline Edge type checking, not root/browser substitution',()=>{
 const folder=mkdtempSync(join(tmpdir(),'ma-financial-edge-'));
 try{
  for(const variant of ['candidate','recovery']){
   const out=assemble(variant);for(const file of out.payload.files){const path=join(folder,variant,file.name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,file.content);}
   const result=execFileSync('deno',['check','--no-config','--no-lock','--no-remote','--deny-import','--no-npm','--node-modules-dir=none',
    join(folder,variant,out.payload.entrypoint_path)],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe'],
     env:{PATH:process.env.PATH,TMPDIR:tmpdir(),DENO_NO_UPDATE_CHECK:'1'}});
   assert.doesNotMatch(result,/error:/);
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
