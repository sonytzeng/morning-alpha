/** Private retained-source audit. No acquisition, Production, approval or schema write. */
import {auditFoundation} from './foundation-validation.mjs';
import {readStockSnapshot} from './stock-audit.mjs';
import {retainedSessionScope,auditResearchFunnel} from './research-funnel.mjs';
import {auditFirstPublication} from './first-publication-review.mjs';
import {admissionBundle,admissionSummary} from '../../src/features/vnext/publicationAdmission.ts';
import {privateDirectory,immutable} from './foundation-history.mjs';
import {resolve} from 'node:path';
import {reviewedRecords} from './publication-blockers.mjs';

export function retainedAdmissionRegistry(funnel,foundationDir,stockDir,contextDir){
 const {history}=auditFoundation(foundationDir);
 const stock=readStockSnapshot(stockDir,'stock-evidence','VNEXT_REAL_STOCK_EVIDENCE_V1',funnel.history_hash);
 const context=readStockSnapshot(contextDir,'stock-context','VNEXT_STOCK_CONTEXT_V1',funnel.history_hash);
 const bars=history.rows.flatMap(r=>r.bars.map(b=>({...b,id:'bar-'+r.symbol+'-'+b.date,source:b.source_ref,symbol:r.symbol,kind:'RESEARCH_INPUT',session_scope:retainedSessionScope(b,r.symbol)})));
 const benchmarks=context.benchmarks.map(b=>({...b,id:'market-'+b.date,symbol:'MARKET',kind:'BENCHMARK'}));
 return {sources:[...bars,...stock.rows,...context.events,...benchmarks],independent:[],grants:[]};
}
export async function auditMemberAdmission(funnel,review,paths,now){
 const registry=retainedAdmissionRegistry(funnel,paths.foundation,paths.stock,paths.context);
 if(paths.reviewed===true)registry.independent=await reviewedRecords(review,now);
 return {registry,admission:await admissionBundle(review,registry,now)};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
 const e=process.env,at=e.MA_VNEXT_REVIEW_AT;
 if(!at)throw Error('EXPLICIT_REVIEW_TIME_REQUIRED');
 const f=await auditResearchFunnel(e.MA_VNEXT_FOUNDATION_DIR,e.MA_VNEXT_DISPLAY_NAMES,e.MA_VNEXT_STOCK_DIR,e.MA_VNEXT_CONTEXT_DIR);
 const review=await auditFirstPublication(f,e.MA_VNEXT_STOCK_DIR,e.MA_VNEXT_CONTEXT_DIR,at);
 const {admission}=await auditMemberAdmission(f,review,{foundation:e.MA_VNEXT_FOUNDATION_DIR,stock:e.MA_VNEXT_STOCK_DIR,context:e.MA_VNEXT_CONTEXT_DIR},at);
 if(e.MA_VNEXT_ADMISSION_DIR)immutable(resolve(privateDirectory(e.MA_VNEXT_ADMISSION_DIR),'admission-'+admission.snapshot_hash+'.json'),admission);
 console.log(JSON.stringify({summary:admissionSummary(admission),funnel_hash:f.snapshot_hash,review_hash:review.snapshot_hash,admission_hash:admission.snapshot_hash,
  rows:admission.cards.map(c=>({symbol:c.symbol,horizon:c.horizon,quality:c.quality,checks:c.checks.map(x=>[x.key,x.state]),matrix:c.matrix.map(x=>[x.key,x.state]),owner_ready:c.owner_approval_ready})),forward:0,outcome:0,production_operations:0},null,2));
}
