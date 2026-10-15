/** Offline retained-source review; no acquisition, DB, public API or write. */
import {auditResearchFunnel} from './research-funnel.mjs';
import {readStockSnapshot} from './stock-audit.mjs';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {privateDirectory,immutable} from './foundation-history.mjs';
import {resolve} from 'node:path';
import {reviewResearch,REVIEW_VERSION,verifyReviewBundle,reviewSummary} from '../../src/features/vnext/publicationReview.ts';
export async function auditFirstPublication(funnel,stockDir,contextDir,reviewedAt){
 const stock=readStockSnapshot(stockDir,'stock-evidence','VNEXT_REAL_STOCK_EVIDENCE_V1',funnel.history_hash);
 const context=readStockSnapshot(contextDir,'stock-context','VNEXT_STOCK_CONTEXT_V1',funnel.history_hash);
 const cards=[];
 for(const row of funnel.rows.filter(r=>r.research.state==='QUALIFIED'))cards.push(await reviewResearch(row,stock.rows,context.events,reviewedAt,context.benchmarks));
 const payload={schema:'VNEXT_FIRST_PUBLICATION_REVIEW_V1',version:REVIEW_VERSION,funnel_hash:funnel.snapshot_hash,reviewed_at:reviewedAt,cards,forward_sample:0,outcome_sample:0,production_enabled:false};
 const result={...payload,snapshot_hash:await snapshotHash(payload)};
 if(!await verifyReviewBundle(result,funnel.snapshot_hash))throw Error('REVIEW_BUNDLE_INVALID');
 return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
 const funnel=await auditResearchFunnel(process.env.MA_VNEXT_FOUNDATION_DIR,process.env.MA_VNEXT_DISPLAY_NAMES,process.env.MA_VNEXT_STOCK_DIR,process.env.MA_VNEXT_CONTEXT_DIR);
 const review=await auditFirstPublication(funnel,process.env.MA_VNEXT_STOCK_DIR,process.env.MA_VNEXT_CONTEXT_DIR,process.env.MA_VNEXT_REVIEW_AT||new Date().toISOString());
 if(process.env.MA_VNEXT_REVIEW_DIR)immutable(resolve(privateDirectory(process.env.MA_VNEXT_REVIEW_DIR),'review-'+review.snapshot_hash+'.json'),review);
 console.log(JSON.stringify({summary:reviewSummary(review.cards),snapshot_hash:review.snapshot_hash,funnel_hash:review.funnel_hash,reviewed_at:review.reviewed_at,cards:review.cards.map(c=>({symbol:c.symbol,company:c.company,horizon:c.horizon,reason:c.reason,supporting:c.supporting.map(x=>x.text),opposing:c.opposing.map(x=>x.text),financial:c.financial.map(x=>x.text),events:c.events.map(x=>x.text),quality_failed:c.quality.checks.filter(x=>!x.pass).map(x=>x.key),publication:c.publication.blockers,review_hash:c.review_hash})),network_requests:0,production_operations:0},null,2));
}
