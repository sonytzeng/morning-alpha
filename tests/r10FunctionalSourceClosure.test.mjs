// Current ingress source admission and the unchanged historical R10 proof are separate.
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
const PROOF_SHA256='e11c59ee77a16e28b55c2b0c0ab2aadf84599d72e8cdcb848f0d76f2b8004f69';
const root=fileURLToPath(new URL('../',import.meta.url));
const gitEnv={PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
test('current exact source is admitted before any R10 historical evidence is reused',()=>{verifyIntegrationCandidate();});
test('all original R10 evidence, immutable Caller and B24 assertions run unchanged at the sealed revision',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'ma-r10-source-proof-')),checkout=join(temporary,'source');
 try{
  execFileSync('git',['-c','core.hooksPath=/dev/null','clone','--shared','--no-checkout','--',root,checkout],{env:gitEnv,stdio:['ignore','pipe','pipe']});
  execFileSync('git',['-c','core.hooksPath=/dev/null','--no-replace-objects','checkout','--detach',BASE],{cwd:checkout,env:gitEnv,stdio:['ignore','pipe','pipe']});
  const proof=readFileSync(join(checkout,'tests/r10FunctionalSourceClosure.test.mjs'));
  assert.equal(createHash('sha256').update(proof).digest('hex'),PROOF_SHA256,'R10_HISTORICAL_PROOF_DRIFT');
  execFileSync(process.execPath,['--experimental-strip-types','--test','tests/r10FunctionalSourceClosure.test.mjs'],{
   cwd:checkout,env:{...gitEnv,NODE_OPTIONS:'--experimental-strip-types'},encoding:'utf8',maxBuffer:8e6,timeout:120000,
  });
 }finally{rmSync(temporary,{recursive:true,force:true});}
});
