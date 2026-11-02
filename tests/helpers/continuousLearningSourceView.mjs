// A narrow historical source view for the sealed V17 CLE package only.
// The caller must admit the complete CURRENT tree before and after using it.
// This view grants no current-source admission or deployment authorization.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CLE_HISTORICAL_SOURCE_BASE='7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3';
export const CLE_MARKET_SOURCE_CORRECTIONS=Object.freeze([
 Object.freeze({
  path:'supabase/functions/_shared/market-status.ts',mode:'100644',
  before_sha256:'d285910516d5ae5e0f55d8ee4314da7b7e21214b766d20cda2853fa775af0737',before_bytes:4766,
  after_sha256:'3c06d8ea29bb83de7453bbf6e542ab1c27ad11ae69e3f30067a7f5330963d5c0',after_bytes:5028,
  introduced_by:'ce1c8d0112220d071eb68013dacd3f8707126b5a',
  introduced_parent:'df79652124fcf357cabb686c2aa5339c11084b68',
 }),
 Object.freeze({
  path:'supabase/functions/_shared/market-calendar-data.json',mode:'100644',
  before_sha256:'6585353538e81881b3cecdfa5d982eb70ead06da177e449ec86c385a7ab6d232',before_bytes:1671,
  after_sha256:'18930032917a7e3695a431b57b0f53313f1289af72d61087eca3f93fff956079',after_bytes:1695,
  introduced_by:'cc9cab45ebdfc8c32b649f3fe80cbc65a3e6d872',
  introduced_parent:'7ed43ba7f476bd72bb3bc32e83d7717e1bb746b3',
 }),
]);
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
 GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,env:gitEnv,maxBuffer:1024*1024});
function physical(path){
 const target=resolve(root,path);assert.equal(relative(root,target),path,'CLE_SOURCE_VIEW_PATH');
 for(let p=dirname(target);p!==root;p=dirname(p)){const s=lstatSync(p);assert(s.isDirectory()&&!s.isSymbolicLink(),'CLE_SOURCE_VIEW_PARENT');}
 const s=lstatSync(target);assert(s.isFile()&&!s.isSymbolicLink(),'CLE_SOURCE_VIEW_REGULAR_FILE');
 return {bytes:readFileSync(target),mode:s.mode&0o111?'100755':'100644'};
}
const physicalRead=path=>physical(path).bytes,physicalMode=path=>physical(path).mode;
function archivedCorrection(row){
 assert.equal(git(['show','--no-patch','--format=%P',row.introduced_by]).toString().trim(),row.introduced_parent,'CLE_SOURCE_VIEW_COMMIT_PARENT');
 const before=git(['show',CLE_HISTORICAL_SOURCE_BASE+':'+row.path]);
 assert.equal(before.length,row.before_bytes,'CLE_SOURCE_VIEW_BEFORE_SIZE');
 assert.equal(hash(before),row.before_sha256,'CLE_SOURCE_VIEW_BEFORE_HASH');
 assert.deepEqual(git(['show',row.introduced_parent+':'+row.path]),before,'CLE_SOURCE_VIEW_INTRODUCTION_PREIMAGE');
 const after=git(['show',row.introduced_by+':'+row.path]);
 assert.equal(after.length,row.after_bytes,'CLE_SOURCE_VIEW_AFTER_SIZE');
 assert.equal(hash(after),row.after_sha256,'CLE_SOURCE_VIEW_AFTER_HASH');
 return before;
}
/** Restore only these two exact, independently identified corrections for an
 * old package. Current files remain corrected. Unknown paths and source errors
 * pass through unchanged; a historical reader cannot pose as current bytes.
 */
export function createCleHistoricalSourceView(read=physicalRead,mode=physicalMode){
 assert(arguments.length<=2,'CLE_SOURCE_VIEW_NO_CUSTOM_BASE_OR_SCOPE');
 assert.equal(typeof read,'function','CLE_SOURCE_VIEW_READER');assert.equal(typeof mode,'function','CLE_SOURCE_VIEW_MODE_READER');
 const archived=new Map(CLE_MARKET_SOURCE_CORRECTIONS.map(row=>[row.path,archivedCorrection(row)]));
 const checkedCurrent=path=>{
  const row=CLE_MARKET_SOURCE_CORRECTIONS.find(row=>row.path===path),bytes=Buffer.from(read(path));
  assert.equal(mode(path),row.mode,'CLE_SOURCE_VIEW_MODE:'+path);
  assert.equal(bytes.length,row.after_bytes,'CLE_SOURCE_VIEW_CURRENT_SIZE:'+path);
  assert.equal(hash(bytes),row.after_sha256,'CLE_SOURCE_VIEW_CURRENT_HASH:'+path);
 };
 for(const row of CLE_MARKET_SOURCE_CORRECTIONS)checkedCurrent(row.path);
 return {
  schema:'CLE_HISTORICAL_SOURCE_VIEW_V1',base:CLE_HISTORICAL_SOURCE_BASE,
  full_integration_admission:false,production_authorized:false,
  predecessorRead:path=>{
   if(!archived.has(path))return read(path);
   checkedCurrent(path);return Buffer.from(archived.get(path));
  },
 };
}
