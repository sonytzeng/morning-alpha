/** Real29 saved-source verification; no synthetic identity or permission grant. */
import assert from 'node:assert/strict';
import {auditResearchFunnel} from '../scripts/vnext/research-funnel.mjs';
import {auditFirstPublication} from '../scripts/vnext/first-publication-review.mjs';
import {auditMemberAdmission} from '../scripts/vnext/member-admission.mjs';
import {admissionSummary,approvedProjection,appendOwnerDecision} from '../src/features/vnext/publicationAdmission.ts';
import {privateDirectory,immutable} from '../scripts/vnext/foundation-history.mjs';
import {resolve} from 'node:path';
assert(!process.env.CI);globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
const e=process.env,at=e.MA_VNEXT_REVIEW_AT;assert(at);
const f=await auditResearchFunnel(e.MA_VNEXT_FOUNDATION_DIR,e.MA_VNEXT_DISPLAY_NAMES,e.MA_VNEXT_STOCK_DIR,e.MA_VNEXT_CONTEXT_DIR);
assert.equal(f.snapshot_hash,'805cfbb8ae94f0bda75a43535ceb57d314b3f1aa7fed4af12cedc0f82bcf93c3');
const review=await auditFirstPublication(f,e.MA_VNEXT_STOCK_DIR,e.MA_VNEXT_CONTEXT_DIR,at);
const {admission:a,registry}=await auditMemberAdmission(f,review,{foundation:e.MA_VNEXT_FOUNDATION_DIR,stock:e.MA_VNEXT_STOCK_DIR,context:e.MA_VNEXT_CONTEXT_DIR},at);
assert.equal(a.cards.length,29);assert.equal(new Set(review.cards.map(c=>c.reason)).size,29);
for(const c of a.cards){assert.equal(c.checks.filter(x=>x.state==='PASS').length,9);assert.equal(c.checks.filter(x=>x.state==='UNVERIFIED').length,2);assert.equal(c.quality,'INCOMPLETE');assert.equal(c.receipt_pit_valid,true);assert.equal(c.time_valid,false);assert.equal(c.matrix.find(x=>x.key==='DATA_INTEGRATION').state,'PASS');assert.equal(c.matrix.find(x=>x.key==='TIME_METADATA').state,'UNVERIFIED');assert.equal(c.owner_approval_ready,false);
 await assert.rejects(()=>appendOwnerDecision(review.cards.find(r=>r.review_hash===c.review_hash),c,[],{action:'APPROVE',reason:'CONTROL: blocked prerequisite, not actual owner decision',key:'negative-control-'+c.symbol},{verified:true,ref:'ISOLATED_NEGATIVE_CONTROL_NOT_SONY'},at),/PREREQUISITES/);
}
for(const tier of ['owner','free','premium','anonymous'])assert.deepEqual(await approvedProjection(review,a,[],{verified:tier!=='anonymous',tier},at,registry),[]);
// Independently recompute 3653 from the preserved full source records, not the
// selection metrics or generated copy. This is evidence verification, not return.
const b=registry.sources.filter(s=>s.symbol==='3653'&&s.kind==='RESEARCH_INPUT').sort((x,y)=>x.date.localeCompare(y.date)).slice(-20),last=b.at(-1),market=registry.sources.find(s=>s.symbol==='MARKET'&&s.date==='2026-10-08');
const amount=last.amount/(b.slice(0,-1).reduce((n,x)=>n+x.amount,0)/19),relative=(last.close/last.open-market.close/market.open)*100;
assert.equal(b.length,20);assert.equal(last.close,7165);assert(Math.abs(amount-1.53)<.005);assert(Math.abs(relative-6.31)<.005);
const r=review.cards.find(c=>c.symbol==='3653');assert(r.supporting.some(c=>c.text.includes('1.53')));assert(r.supporting.some(c=>c.text.includes('6.31')));assert(r.opposing.some(c=>c.text.includes('52,932')));assert(r.opposing.some(c=>c.text.includes('49,437')));
const summary=admissionSummary(a);
if(e.MA_VNEXT_ADMISSION_DIR){const dir=privateDirectory(e.MA_VNEXT_ADMISSION_DIR);immutable(resolve(dir,'admission-'+a.snapshot_hash+'.json'),a);immutable(resolve(dir,'review-'+review.snapshot_hash+'.json'),review);}
console.log(JSON.stringify({source:'REAL_RETAINED_29_OFFLINE',summary,short:1,medium:28,long:0,mechanical_checks_passed:261,independent_content_checks_pending:58,review_hash:review.snapshot_hash,admission_hash:a.snapshot_hash,funnel_hash:f.snapshot_hash,benchmark_arithmetic:'PASS',external_requests:0,production_operations:0,forward:0,outcome:0}));
