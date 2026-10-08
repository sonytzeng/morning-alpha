/** Offline review of immutable local public-data cache; never produces a prediction. */
import {readdir,readFile,lstat,realpath,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {historySessions,auditHistory} from './entry-history.ts';
import {retrospectiveShapes} from './entry-official-history.ts';
import {v2Bars} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const cache=await realpath(process.env.MA_ENTRY_HISTORY_CACHE_DIR),fixture=await realpath(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR);
for(const dir of [cache,fixture])if(dir===root||dir.startsWith(root+'/')||((await lstat(dir)).mode&0o077))throw Error('PRIVATE_DIRECTORY_REQUIRED');
async function read(path){const s=await lstat(path);if(s.isSymbolicLink()||(s.mode&0o077))throw Error('PRIVATE_FILE_REQUIRED');return JSON.parse(await readFile(path,'utf8'));}
const files=await readdir(cache),histories=[],exactTpex=[];
for(const name of files.filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){const c=await read(resolve(cache,name));if(c.digest!==hash(c.data))throw Error('CACHE_HASH_MISMATCH');if(c.data.bars)histories.push(c.data);if(c.data.daily)exactTpex.push(...c.data.daily);}
const actionName=files.filter(n=>/^action-audit-\d+\.json$/.test(n)).sort().at(-1);if(!actionName)throw Error('ACTION_AUDIT_REQUIRED');
const actions=await read(resolve(cache,actionName)),p=await read(resolve(fixture,'2026-10-08.json'));
const symbols=p.input.data.universe.filter(r=>r.is_active).map(r=>r.symbol),end=historySessions('2026-10-08',120).at(-1),start=historySessions('2026-10-08',120)[0];
const shapeCounts={},shapes=[],sourceComparisons=[],coverage={};
for(const symbol of symbols){
 const isTpex=histories.some(h=>h.symbol===symbol&&h.exchange==='TPEX')||exactTpex.some(r=>r.symbol===symbol);
 const sourceBars=isTpex?exactTpex.filter(r=>r.symbol===symbol&&r.bar).map(r=>r.bar):histories.filter(h=>h.symbol===symbol).flatMap(h=>h.bars);
 const bars=sourceBars.filter(b=>b.date>=start&&b.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
 const availableAt=new Date().toISOString();coverage[symbol]=Object.fromEntries([20,60,120].map(n=>[n,auditHistory(bars,'2026-10-08',availableAt,n)]));
 const actionDates=actions.events.filter(e=>e.symbol===symbol).map(e=>e.effective_date);
 const result=coverage[symbol][120].complete?retrospectiveShapes(bars,actionDates,actions.complete_action_clearance):
  {scope:'EX_POST_PRICE_SHAPE_SEARCH_NOT_STRATEGY_VALIDATION',hits:[],strategy_validation:'HISTORY_INCOMPLETE',forward_sample:0,outcome_sample:0};
 shapes.push({symbol,...result});for(const hit of result.hits)shapeCounts[hit.shape]=(shapeCounts[hit.shape]??0)+1;
 for(const date of ['2026-10-07','2026-10-08']){
  const old=await read(resolve(fixture,date+'.json')),retained=v2Bars(old.input,symbol),diffs=[];let compared=0;
  for(const a of retained){const b=bars.find(x=>x.date===a.date);if(!b)continue;compared++;
   for(const field of ['open','high','low','close','volume','amount'])if(a[field]!==b[field])diffs.push({date:a.date,field});}
  sourceComparisons.push({symbol,retained_date:date,compared,exact_value_differences:diffs,retained_modified:false,
   resolution:diffs.length?'SOURCE_RECONCILIATION_REQUIRED_NO_SUBSTITUTION':'EXACT_VALUES_MATCH'});
 }
}
const report={schema:'ENTRY_HISTORY_REVIEW_V1',observed_at:new Date().toISOString(),coverage:Object.fromEntries([20,60,120].map(n=>[n,Object.values(coverage).filter(c=>c[n].complete).length])),
 source_fixture_sha256:hash(p),original_input_sha256:p.original_input_sha256,
 sourceComparisons,shape_counts:shapeCounts,shapes,coverage_detail:coverage,complete_action_clearance:actions.complete_action_clearance,
 real_strategy_outcomes:'UNVERIFIED',forward_sample:0,outcome_sample:0,production_writes:0,
 evidence_gap:['AS_OF_LONG_HISTORY_LOCKS','POINT_IN_TIME_THEME_PEERS','COMPLETE_CORPORATE_ACTION_COVERAGE','EXECUTABLE_PRICE_ORDER_AND_FILL_EVIDENCE']};
const output=resolve(cache,'review-'+Date.now()+'.json');await writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({audit:output,coverage:report.coverage,shape_counts:shapeCounts,
 source_comparison_pairs:sourceComparisons.length,source_pairs_with_differences:sourceComparisons.filter(x=>x.exact_value_differences.length).length,
 compared_bars:sourceComparisons.reduce((s,r)=>s+r.compared,0),value_differences:sourceComparisons.reduce((s,r)=>s+r.exact_value_differences.length,0),
 real_strategy_outcomes:report.real_strategy_outcomes,forward_sample:0,outcome_sample:0,production_writes:0}));
