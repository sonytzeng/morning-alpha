import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const VNEXT_BASE='fff51d76a8e6c90768772023c37afbb112761a3a';
export const VNEXT_MANIFEST='docs/vnext/transition.json';
export const VNEXT_MIGRATION='supabase/migrations/20261010061630_vnext_research_projection_candidate.sql';
export const VNEXT_PATHS=Object.freeze([
 '.github/workflows/vnext-candidate.yml',
 '.github/workflows/validate-release.yml',
 ...['BASELINE_INVENTORY','PRODUCTION_BASELINE_AUDIT','ARCHITECTURE','DATA_LICENSE_AUDIT','EVENT_INTELLIGENCE_SPEC','SUPPLY_CHAIN_SPEC','MULTI_HORIZON_SPEC','SIGNAL_LAB_INTEGRATION_PLAN','PUBLICATION_GATE','RELEASE_PLAN','EXECUTION_CHECKPOINT','ACCEPTANCE_MATRIX'].map(n=>'docs/vnext/'+n+'.md'),
 'docs/vnext/RELEASE_B_REAL_EVIDENCE.md',
 'scripts/vnext/isolation.mjs','scripts/vnext/preview.mjs','scripts/vnext/real-evidence.mjs','scripts/vnext/owner-research-server.mjs',
 ...['contracts','engine','projection','validation','realResearch'].map(n=>'src/features/vnext/'+n+'.ts'),
 'src/pages/vnext/Workspace.tsx','src/pages/vnext/page.tsx','src/pages/vnext/RealResearch.tsx','src/pages/vnext/vnext.css',VNEXT_MIGRATION,
 'tests/browser/vnext.client.ts','tests/browser/vnext.harness.tsx','tests/browser/vnext.vite.ts','tests/fixtures/vnext.mjs',
 'tests/vnextContracts.test.mjs','tests/vnextValidation.test.mjs','tests/vnextIntegrity.test.mjs','tests/vnextRealEvidence.test.mjs','tests/vnextRealReplay.integration.mjs',
 'tests/helpers/vnextIntegrity.mjs','tests/helpers/academyV11Integrity.mjs','tests/academyV11Integrity.test.mjs','tests/productContract.test.mjs',
].sort());
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=path=>{const url=new URL('../../'+path,import.meta.url);assert.ok(lstatSync(url).isFile(),'regular file required: '+path);return readFileSync(url);};
const absent=path=>Object.assign(Error('absent from VNext predecessor: '+path),{code:'ENOENT'});
let immutable;
function baseline(){
 if(immutable)return immutable;
 const rows=git(['ls-tree','-r','-z',VNEXT_BASE]).split('\0').filter(Boolean).map(row=>{
  const [meta,path]=row.split('\t'),[mode,type,oid]=meta.split(' ');
  assert.equal(type,'blob');assert.match(mode,/^100[0-7]{3}$/);return {path,oid};
 });
 const bytes=execFileSync('git',['cat-file','--batch'],{cwd:root,input:rows.map(r=>r.oid).join('\n')+'\n',maxBuffer:64*1024*1024});
 const map=new Map();let offset=0;
 for(const row of rows){const end=bytes.indexOf(10,offset);assert.notEqual(end,-1);const [oid,type,sizeText]=bytes.subarray(offset,end).toString().split(' '),size=Number(sizeText);
  assert.equal(oid,row.oid);assert.equal(type,'blob');assert.ok(Number.isSafeInteger(size)&&size>=0);offset=end+1;
  assert.equal(bytes[offset+size],10);map.set(row.path,Buffer.from(bytes.subarray(offset,offset+size)));offset+=size+1;
 }assert.equal(offset,bytes.length);immutable=map;return map;
}
export function vnextPrior(path){const b=baseline().get(path);return b===undefined?null:Buffer.from(b);}
export function vnextChangedPaths(){return [...new Set([...git(['diff','--no-renames','--name-only','-z',VNEXT_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();}
export function vnextTransition(source=raw,paths=vnextChangedPaths()){
 const m=JSON.parse(source(VNEXT_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','migrations','functions','production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'].sort());
 assert.equal(m.schema,'VNEXT_RESEARCH_CANDIDATE_V1');assert.equal(m.base,VNEXT_BASE);
 for(const key of ['production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'])assert.equal(m[key],false,key);
 assert.deepEqual(m.functions,[]);assert.deepEqual(m.migrations,[VNEXT_MIGRATION]);
 assert.deepEqual(m.files.map(f=>f.path).sort(),VNEXT_PATHS,'exact named VNext scope');
 assert.deepEqual([...paths].sort(),[...VNEXT_PATHS,VNEXT_MANIFEST].sort(),'unknown VNext working-tree path');
 const candidates=new Map();
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256'].sort());
  const prior=vnextPrior(row.path);assert.equal(row.before_sha256,prior===null?null:hash(prior));
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.notEqual(row.before_sha256,row.after_sha256);
  assert.equal(hash(source(row.path)),row.after_sha256,'unreviewed VNext candidate: '+row.path);
  assert.equal(hash(raw(row.path)),row.after_sha256,'live VNext candidate: '+row.path);candidates.set(row.path,row);
 }
 // Candidate admission is never a bypass for an unrelated baseline change.
 for(const [path,bytes] of baseline())if(!candidates.has(path)){
  assert.deepEqual(raw(path),bytes,'protected VNext baseline: '+path);
  if(source!==raw)assert.deepEqual(Buffer.from(source(path)),bytes,'historical VNext baseline: '+path);
 }
 const before=path=>{
  if(path===VNEXT_MANIFEST)throw absent(path);
  const row=candidates.get(path);if(!row)return raw(path);
  assert.equal(hash(raw(path)),row.after_sha256,'live candidate changed during validation: '+path);
  const bytes=vnextPrior(path);if(bytes===null)throw absent(path);return bytes;
 };
 return {manifest:m,predecessorRead:before};
}

/** Every older release gate first checks the real VNext patch, then sees only
 * its immutable predecessor. Custom old test errors are never silently erased. */
export function vnextPredecessorViews(source){
 const current=vnextTransition(),files=new Map(current.manifest.files.map(f=>[f.path,f]));
 const historical=source?path=>{
  const row=files.get(path);
  if(row){const bytes=source(path);if(hash(bytes)===row.after_sha256)return current.predecessorRead(path);return bytes;}
  return source(path);
 }:current.predecessorRead;
 return {predecessorRead:historical,actualPredecessorRead:current.predecessorRead,verify:()=>vnextTransition(),changedPaths:immutableChangedPaths};
}
function immutableChangedPaths(prior){return git(['diff','--no-renames','--name-only','-z',prior,VNEXT_BASE,'--']).split('\0').filter(Boolean).sort();}
export function vnextBaselineChangedPaths(prior){
 vnextTransition();
 return immutableChangedPaths(prior);
}
