import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const CTO_BASE='4348efaff4514a43473d111950083799a23c79c2';
export const CTO_MANIFEST='docs/operations/evidence/cto-commercial-transition-20261013.json';
export const CTO_PATHS=Object.freeze([
 '.github/workflows/cto-commercial.yml',
 'docs/operations/cto-commercial-readiness-20261013.md',
 'docs/operations/cto-commercial-release-manifest-20261013.md',
 'scripts/cto/capacity-isolation.mjs',
 'scripts/cto/capacity-workload.sql',
 'src/components/feature/Navbar.tsx',
 'src/features/decision-v1/DecisionBrief.tsx',
 'src/features/decision-v1/subscriber.css',
 'src/features/operations/commercialStability.mjs',
 'src/lib/performanceDirectionPresentation.ts',
 'src/pages/account/components/MorningHeroCard.tsx',
 'src/pages/performance/page.tsx',
 'src/pages/pricing/Pricing.tsx',
 'src/pages/report/TodayReport.tsx',
 'tests/commercialStability.test.mjs',
 'tests/ctoConfidencePresentation.test.mjs',
 'tests/ctoCommercialIntegrity.test.mjs',
 'tests/ctoPricingPresentation.test.mjs',
 'tests/ctoPerformancePresentation.test.mjs',
 'tests/helpers/acceptanceCalendarIntegrity.mjs',
 'tests/helpers/ctoCommercialIntegrity.mjs',
 'tests/productContract.test.mjs',
 'tests/publicRelease.test.mjs',
].sort());
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64e6});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=path=>{const url=new URL('../../'+path,import.meta.url);assert.ok(lstatSync(url).isFile(),'regular CTO file: '+path);return readFileSync(url);};
let immutable;
function baseline(){
 if(immutable)return immutable;
 const rows=git(['ls-tree','-r','-z',CTO_BASE]).split('\0').filter(Boolean).map(row=>{const [meta,path]=row.split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(type,'blob');assert.match(mode,/^100[0-7]{3}$/);return {path,oid};});
 const bytes=execFileSync('git',['cat-file','--batch'],{cwd:root,input:rows.map(r=>r.oid).join('\n')+'\n',maxBuffer:64e6});
 const map=new Map();let offset=0;
 for(const row of rows){const end=bytes.indexOf(10,offset);assert.notEqual(end,-1);const [oid,type,sizeText]=bytes.subarray(offset,end).toString().split(' '),size=Number(sizeText);assert.equal(oid,row.oid);assert.equal(type,'blob');assert.ok(Number.isSafeInteger(size)&&size>=0);offset=end+1;assert.equal(bytes[offset+size],10);map.set(row.path,Buffer.from(bytes.subarray(offset,offset+size)));offset+=size+1;}
 assert.equal(offset,bytes.length);immutable=map;return map;
}
export const ctoPrior=path=>{const bytes=baseline().get(path);return bytes===undefined?null:Buffer.from(bytes);};
export const ctoChangedPaths=()=>[...new Set([...git(['diff','--no-renames','--name-only','-z',CTO_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();
export function ctoTransition(source=raw,paths=ctoChangedPaths()){
 const m=JSON.parse(source(CTO_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','migrations','functions','production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'].sort());
 assert.equal(m.schema,'CTO_COMMERCIAL_CANDIDATE_V1');assert.equal(m.base,CTO_BASE);
 for(const key of ['production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'])assert.equal(m[key],false,key);
 assert.deepEqual(m.migrations,[]);assert.deepEqual(m.functions,[]);
 assert.deepEqual(m.files.map(row=>row.path).sort(),CTO_PATHS,'exact CTO candidate scope');
 assert.deepEqual([...paths].sort(),[...CTO_PATHS,CTO_MANIFEST].sort(),'unknown CTO working-tree path');
 const files=new Map();
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256'].sort());
  const before=ctoPrior(row.path);assert.equal(row.before_sha256,before===null?null:hash(before));
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.notEqual(row.before_sha256,row.after_sha256);
  assert.equal(hash(raw(row.path)),row.after_sha256,'live CTO candidate: '+row.path);
  assert.equal(hash(source(row.path)),row.after_sha256,'unreviewed CTO candidate: '+row.path);files.set(row.path,row);
 }
 for(const [path,bytes] of baseline())if(!files.has(path)){
  assert.deepEqual(raw(path),bytes,'protected CTO baseline: '+path);
  if(source!==raw)assert.deepEqual(Buffer.from(source(path)),bytes,'historical CTO baseline: '+path);
 }
 const predecessorRead=path=>{
  if(path===CTO_MANIFEST||files.has(path)&&ctoPrior(path)===null)throw Object.assign(Error('absent from CTO predecessor: '+path),{code:'ENOENT'});
  if(files.has(path)){assert.equal(hash(raw(path)),files.get(path).after_sha256);return ctoPrior(path);}
  return raw(path);
 };
 return {manifest:m,predecessorRead};
}
export function ctoPredecessorViews(source){
 const current=ctoTransition(),files=new Map(current.manifest.files.map(row=>[row.path,row]));
 const historical=source?path=>{const row=files.get(path);if(row){const bytes=source(path);if(hash(bytes)===row.after_sha256)return current.predecessorRead(path);return bytes;}return source(path);}:current.predecessorRead;
 return {predecessorRead:historical,actualPredecessorRead:current.predecessorRead,verify:()=>ctoTransition(),changedPaths:prior=>git(['diff','--no-renames','--name-only','-z',prior,CTO_BASE,'--']).split('\0').filter(Boolean).sort()};
}
