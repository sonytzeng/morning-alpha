import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const MARKET_NEWS_BASE='8500f0ec050cff4f948c43ae9e6236aa4d2a58ea';
export const MARKET_NEWS_MANIFEST='docs/operations/evidence/market-news-transition-20261008.json';
export const MARKET_NEWS_PATHS=[
 'docs/operations/market-news-persistent-degradation-20261008.md',
 'supabase/functions/_shared/market-news-acquisition.ts',
 'supabase/functions/daily-delivery-orchestrator/index.ts',
 'tests/coreProductionPreservation.test.mjs',
 'tests/fixtures/market-news-20261008.json',
 'tests/helpers/marketNewsIntegrity.mjs',
 'tests/helpers/ownerBackendIntegrity.mjs',
 'tests/lineProductionPromotionIntegrity.test.mjs',
 'tests/marketNewsAcquisition.test.mjs',
 'tests/marketNewsIntegrity.test.mjs',
 'tests/ownerBackendIntegrity.test.mjs',
 'tests/productContract.test.mjs',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const cache=new Map(),restored=new WeakSet();
export function marketNewsPrior(p){
 if(!cache.has(p)){
  const exists=execFileSync('git',['ls-tree','--name-only',MARKET_NEWS_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();
  cache.set(p,exists?execFileSync('git',['show',MARKET_NEWS_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }return cache.get(p);
}
export function marketNewsTransition(source=read){
 const m=JSON.parse(source(MARKET_NEWS_MANIFEST));
 assert.equal(m.schema_version,'MARKET_NEWS_ACQUISITION_TRANSITION_V1');assert.equal(m.base,MARKET_NEWS_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),MARKET_NEWS_PATHS,'exact named news scope');
 assert.deepEqual(m.functions,['daily-delivery-orchestrator']);assert.deepEqual(m.migrations,[]);
 for(const k of ['production_deploy_authorized','cron_change','secret_change','auth_change','rls_change',
  'quality_threshold_change','business_logic_change','historical_data_write','manual_line_send'])assert.equal(m[k],false,k);
 const seal='docs/operations/evidence/owner-backend-simple-mode-transition.json';
 assert.equal(m.predecessor_sha256,hash(marketNewsPrior(seal)));
 assert.equal(hash(source(seal)),m.predecessor_sha256,'immutable Owner Backend predecessor');
 const before=new Map();
 for(const r of m.files){const b=marketNewsPrior(r.path);
  assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));
  assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (Market News): '+r.path);before.set(r.path,b);
 }
 const predecessorRead=p=>{
  if(p===MARKET_NEWS_MANIFEST)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});
  if(!before.has(p))return source(p);const b=before.get(p);
  if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;
 };restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function marketNewsAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(MARKET_NEWS_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return marketNewsTransition(source).predecessorRead;
}
export function marketNewsChangedPaths(){return [...new Set([
 ...execFileSync('git',['diff','--name-only','-z',MARKET_NEWS_BASE,'--'],{cwd:root,encoding:'utf8'}).split('\0'),
 ...execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0'),
 ].filter(Boolean))].sort();}
