// Offline CI preparation controls. No Registry, Docker daemon or Production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyIntegrationCandidate} from './helpers/integrationAdmission.mjs';
const path='.github/workflows/core-evidence-candidate.yml';
const text=readFileSync(new URL('../'+path,import.meta.url),'utf8');
const image='postgres@sha256:3518071376d0b6156b02e1db2747a78511b5b9dc3763cc79c506ebe2dc2ee71c';
const block=text.split('      - name: Prepare fixed PostgreSQL 17.11 image for this isolated runner\n')[1]?.split('      - name:')[0];
const shell=block?.split('        run: |\n')[1]?.split('\n').filter(Boolean).map(s=>s.slice(10)).join('\n');
const unchangedDbStep=t=>t.split('      - name: Disposable SQL and RLS, no Production connectivity\n')[1]?.split('      - uses:')[0];

test('fresh runner prepares the exact same-major official image before all unchanged SQL/RLS assertions',()=>{
 verifyIntegrationCandidate();assert(block&&shell);assert.match(block,/timeout-minutes: 3/);
 assert(block.includes('TEST_POSTGRES_IMAGE: '+image));
 assert(text.indexOf('Prepare fixed PostgreSQL')<text.indexOf('Disposable SQL and RLS'));
 assert(!/continue-on-error:|\bif:|secrets\./.test(block));
 const prior=execFileSync('git',['show','c50b09ba7c122dc0d2e32082e85764cf3250b806:'+path],{encoding:'utf8'});
 assert.equal(unchangedDbStep(text),unchangedDbStep(prior),'keep the actual database, JSONB and RLS test unchanged');
 assert(text.includes('tests/ciEvidenceDatabaseImage.test.mjs'));
 execFileSync('bash',['-n'],{input:shell,encoding:'utf8'});
});

for(const scenario of ['PASS','PULL_FAILED','WRONG_ARCH','WRONG_VERSION'])test('bounded image preparation '+scenario+' never silently skips database validation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-ci-image-')),log=join(dir,'calls'),envFile=join(dir,'environment');
 try{
  // These shell functions are the ONLY command implementations executed.
  // The process has no credentials, provider URL, Docker socket or network call.
  writeFileSync(envFile,`timeout(){ test "$1" = 120s; shift; "$@"; }
docker(){
 printf '%s\\n' "$*" >> "$CALL_LOG"
 case "$1 $2" in
  'pull '*) test "$2" = "$TEST_POSTGRES_IMAGE"; test "$SCENARIO" != PULL_FAILED ;;
  'image inspect') test "$3" = "$TEST_POSTGRES_IMAGE"; if test "$SCENARIO" = WRONG_ARCH; then printf linux/arm64; else printf linux/amd64; fi ;;
  'run --rm') if test "$SCENARIO" = WRONG_VERSION; then printf 'postgres (PostgreSQL) 18.0\\n'; else printf 'postgres (PostgreSQL) 17.11 (synthetic command control)\\n'; fi ;;
  'tag '*) test "$2" = "$TEST_POSTGRES_IMAGE"; test "$3" = postgres:17 ;;
  *) return 99 ;;
 esac
}
`);
  execFileSync('bash',['-n',envFile],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
  writeFileSync(log,'');let failed=false,diagnostic='';
  try{execFileSync('bash',['-eu','-o','pipefail','-c','. "$MOCK_ENV"\n'+shell],{encoding:'utf8',timeout:3000,
   env:{PATH:process.env.PATH,MOCK_ENV:envFile,CALL_LOG:log,TEST_POSTGRES_IMAGE:image,SCENARIO:scenario},stdio:['pipe','pipe','pipe']});}
  catch(error){failed=true;diagnostic=String(error.stderr??'');assert(Number.isInteger(error.status)&&error.status!==0);}
  assert.equal(failed,scenario!=='PASS',diagnostic);
  const calls=readFileSync(log,'utf8').trim().split('\n');assert(calls[0]==='pull '+image);
  assert.equal(calls.filter(s=>s.startsWith('pull ')).length,1,'no blind retry or Registry fanout');
  assert.equal(calls.some(s=>s.startsWith('tag ')),scenario==='PASS','only a validated exact image may get the existing local test tag');
  if(scenario==='PULL_FAILED')assert.equal(calls.length,1);
  if(scenario==='WRONG_ARCH')assert.equal(calls.length,2);
  if(scenario==='PASS'){assert.equal(calls.length,4);assert.match(calls[2],/--pull never --network none/);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
