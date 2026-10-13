import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const CALENDAR_BASE='2a5d461ec3d98bfc8bc3177a295c95e299b7bda2';
export const CALENDAR_MANIFEST='docs/operations/evidence/acceptance-calendar-transition-20261013.json';
export const CALENDAR_MIGRATION='supabase/migrations/20261013073004_operational_acceptance_calendar_guard_v1.sql';
export const CALENDAR_PATHS=Object.freeze([
 '.github/workflows/acceptance-calendar.yml',
 'docs/operations/core-product-acceptance-20261013.md',
 CALENDAR_MIGRATION,
 'src/lib/reportNewsPresentation.ts',
 'src/pages/account/components/TodayInfoCards.tsx',
 'tests/accountSubscriberProjection.test.mjs',
 'src/features/research/cockpit.ts',
 'src/pages/admin/analysis/OwnerCockpit.tsx',
 'tests/ownerCockpit.test.mjs',
 'tests/acceptanceCalendarDatabase.integration.mjs',
 'tests/acceptanceCalendarIntegrity.test.mjs',
 'tests/academyV11Integrity.test.mjs',
 'tests/helpers/acceptanceCalendarIntegrity.mjs',
 'tests/helpers/marketNewsReportIntegrity.mjs',
 'tests/productContract.test.mjs',
].sort());
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=path=>{const url=new URL('../../'+path,import.meta.url);assert.ok(lstatSync(url).isFile(),'regular file required: '+path);return readFileSync(url);};
const absent=path=>Object.assign(Error('absent from Calendar predecessor: '+path),{code:'ENOENT'});
let immutable;
function baseline(){
 if(immutable)return immutable;
 const rows=git(['ls-tree','-r','-z',CALENDAR_BASE]).split('\0').filter(Boolean).map(row=>{
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
export function calendarPrior(path){const b=baseline().get(path);return b===undefined?null:Buffer.from(b);}
export function calendarChangedPaths(){return [...new Set([...git(['diff','--no-renames','--name-only','-z',CALENDAR_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();}
export function calendarTransition(source=raw,paths=calendarChangedPaths()){
 const m=JSON.parse(source(CALENDAR_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','migrations','functions','production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'].sort());
 assert.equal(m.schema,'CALENDAR_ACCEPTANCE_CANDIDATE_V1');assert.equal(m.base,CALENDAR_BASE);
 for(const key of ['production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change'])assert.equal(m[key],false,key);
 assert.deepEqual(m.functions,[]);assert.deepEqual(m.migrations,[CALENDAR_MIGRATION]);
 assert.deepEqual(m.files.map(f=>f.path).sort(),CALENDAR_PATHS,'exact named Calendar scope');
 assert.deepEqual([...paths].sort(),[...CALENDAR_PATHS,CALENDAR_MANIFEST].sort(),'unknown Calendar working-tree path');
 const candidates=new Map();
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256'].sort());
  const prior=calendarPrior(row.path);assert.equal(row.before_sha256,prior===null?null:hash(prior));
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.notEqual(row.before_sha256,row.after_sha256);
  assert.equal(hash(source(row.path)),row.after_sha256,'unreviewed Calendar candidate: '+row.path);
  assert.equal(hash(raw(row.path)),row.after_sha256,'live Calendar candidate: '+row.path);candidates.set(row.path,row);
 }
 // Candidate admission is never a bypass for an unrelated baseline change.
 for(const [path,bytes] of baseline())if(!candidates.has(path)){
  assert.deepEqual(raw(path),bytes,'protected Calendar baseline: '+path);
  if(source!==raw)assert.deepEqual(Buffer.from(source(path)),bytes,'historical Calendar baseline: '+path);
 }
 const before=path=>{
  if(path===CALENDAR_MANIFEST)throw absent(path);
  const row=candidates.get(path);if(!row)return raw(path);
  assert.equal(hash(raw(path)),row.after_sha256,'live candidate changed during validation: '+path);
  const bytes=calendarPrior(path);if(bytes===null)throw absent(path);return bytes;
 };
 return {manifest:m,predecessorRead:before};
}

/** Every older release gate first checks the real Calendar patch, then sees only
 * its immutable predecessor. Custom old test errors are never silently erased. */
export function calendarPredecessorViews(source){
 const current=calendarTransition(),files=new Map(current.manifest.files.map(f=>[f.path,f]));
 const historical=source?path=>{
  const row=files.get(path);
  if(row){const bytes=source(path);if(hash(bytes)===row.after_sha256)return current.predecessorRead(path);return bytes;}
  return source(path);
 }:current.predecessorRead;
 return {predecessorRead:historical,actualPredecessorRead:current.predecessorRead,verify:()=>calendarTransition(),changedPaths:immutableChangedPaths};
}
function immutableChangedPaths(prior){return git(['diff','--no-renames','--name-only','-z',prior,CALENDAR_BASE,'--']).split('\0').filter(Boolean).sort();}
export function calendarBaselineChangedPaths(prior){
 calendarTransition();
 return immutableChangedPaths(prior);
}

