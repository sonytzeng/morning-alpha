// Current admission and the complete, unchanged historical proof are separate.
// The frozen test executes every original assertion; none are translated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyIntegrationCandidate} from './helpers/integrationAdmission.mjs';
const BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
const PROOF_SHA256='2f20ae753c8bab656d3d40e47b42d2879a0baa70ce8dd7cce5db96a55b706bbd';
const root=fileURLToPath(new URL('../',import.meta.url));
const gitEnv={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
test('actual current composition is admitted independently of the old cold-source proof',()=>{
 verifyIntegrationCandidate();
});
test('all unchanged 7bfc cold-source assertions execute in a pinned local-only checkout',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'ma-cold-source-proof-')),checkout=join(temporary,'source');
 try{
  execFileSync('git',['-c','core.hooksPath=/dev/null','clone','--shared','--no-checkout','--',root,checkout],{env:gitEnv,stdio:['ignore','pipe','pipe']});
  execFileSync('git',['-c','core.hooksPath=/dev/null','--no-replace-objects','checkout','--detach',BASE],{cwd:checkout,env:gitEnv,stdio:['ignore','pipe','pipe']});
  const proof=readFileSync(join(checkout,'tests/coldSourcePriorityAdmission.test.mjs'));
  assert.equal(createHash('sha256').update(proof).digest('hex'),PROOF_SHA256,'COLD_HISTORICAL_PROOF_DRIFT');
  execFileSync(process.execPath,['--experimental-strip-types','--test','tests/coldSourcePriorityAdmission.test.mjs'],{
   cwd:checkout,env:{...gitEnv,NODE_OPTIONS:'--experimental-strip-types'},encoding:'utf8',maxBuffer:8e6,timeout:120000,
  });
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
