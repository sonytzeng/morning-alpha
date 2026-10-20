// Offline Worker4 + exact five-module CPU, forward-cutoff and response-period union; no network or deploy port.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,posix} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assemble as coldSource} from '../cold-source-priority-20261019/materialize.mjs';
import {verifyIntegrationCandidate} from '../../../tests/helpers/integrationAdmission.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const changed=Object.freeze(['src/features/vnext/contracts.ts','src/features/vnext/dailyAdapter.ts','src/features/vnext/dailyParsers.mjs','src/features/vnext/dailyIntelligence.ts','src/features/vnext/dailyRuntime.ts']);
const sha=b=>createHash('sha256').update(b).digest('hex');
const worker4=name=>execFileSync('git',['--no-replace-objects','show','7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3:'+name],{cwd:root,stdio:['ignore','pipe','pipe'],maxBuffer:8e6});
const physical=name=>{assert.equal(posix.normalize(name),name);assert(!name.startsWith('/')&&!name.split('/').includes('..'));
 let p=root;for(const [i,part]of name.split('/').entries()){p=resolve(p,part);const s=lstatSync(p);assert(!s.isSymbolicLink());assert(i===name.split('/').length-1?s.isFile():s.isDirectory());}return readFileSync(p);};
const directory=name=>{assert.equal(posix.normalize(name),name);assert(!name.startsWith('/')&&!name.split('/').includes('..'));let p=root;
 for(const part of name.split('/')){p=resolve(p,part);try{mkdirSync(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=lstatSync(p);assert(s.isDirectory()&&!s.isSymbolicLink(),'UNION_OUTPUT_DIRECTORY');}return p;};
export function assemble(variant='candidate',read=physical){
 assert(['candidate','recovery'].includes(variant),'UNION_FIXED_VARIANT');verifyIntegrationCandidate();
 const bytes=physical('scripts/operations/worker-cpu-period-union-20261021/release-catalog.json');assert.equal(sha(bytes),'b7848813fed5197c7ea7a407455206d7844a14e5ae4e93b2de5713c990a98b38','UNION_CATALOG_DRIFT');
 const c=JSON.parse(bytes),baseline=coldSource('candidate',worker4);assert.equal(c.schema,'C_WORKER_CPU_PERIOD_UNION_RELEASE_V1');assert.deepEqual(c.changed_runtime,changed);assert.equal(c.files.length,78);assert.equal(c.production_authorized,false);
 assert.equal(c.baseline.version,4);assert.equal(c.baseline.runtime_files,44);assert.equal(c.baseline.sdk,'2.57.4');assert.equal(c.metadata.verify_jwt,true);
 const files=baseline.payload.files.map((f,i)=>{const row=c.files[i];assert.equal(row.name,f.name);assert.equal(sha(f.content),row.before_sha256,'UNION_BASE_DRIFT');assert.equal(Buffer.byteLength(f.content),row.before_bytes);
  const candidate=changed.includes(f.name)?Buffer.from(read(f.name)):Buffer.from(f.content);assert.equal(sha(candidate),row.after_sha256,'UNION_CURRENT_DRIFT');assert.equal(candidate.length,row.after_bytes);
  const content=(variant==='recovery'?Buffer.from(f.content):candidate).toString('utf8');return {name:f.name,content};});
 const payload={...baseline.payload,files},output=Buffer.from(JSON.stringify(payload,null,2)+'\n');assert.equal(sha(output),c.payloads[variant].sha256,'UNION_PAYLOAD_DRIFT');assert.equal(output.length,c.payloads[variant].bytes);
 return {payload,bytes:output,sha256:sha(output)};
}
export function materialize(variant='candidate'){
 const r=assemble(variant),relative='build/worker-cpu-period-union-20261021/'+variant,output=directory(relative);
 for(const f of r.payload.files){assert.equal(posix.normalize(f.name),f.name);assert(!f.name.startsWith('/')&&!f.name.split('/').includes('..'));const target=resolve(output,f.name);directory(relative+'/'+posix.dirname(f.name));writeFileSync(target,f.content,{flag:'wx',mode:0o600});}
 writeFileSync(resolve(output,'deploy-args.json'),r.bytes,{flag:'wx',mode:0o600});return {status:'MATERIALIZED_NOT_DEPLOYED',variant,sha256:r.sha256,files:r.payload.files.length,runtime_files:44};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert(process.argv.length<=3);console.log(JSON.stringify(materialize(process.argv[2]??'candidate')));}
