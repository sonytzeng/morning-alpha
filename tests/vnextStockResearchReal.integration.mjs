// Private, offline actual-source assertions. No copied Provider payloads in Git/CI.
import assert from 'node:assert/strict';
import {auditResearchFunnel} from '../scripts/vnext/research-funnel.mjs';
import {verifyFunnel,projectQualifiedResearch} from '../src/features/vnext/researchFunnel.ts';
import {researchRunPlan} from '../src/features/vnext/stockResearch.ts';
assert(!process.env.CI,'PRIVATE_REAL_AUDIT_NOT_CI');
globalThis.fetch=()=>{throw Error('OFFLINE_NO_NETWORK');};
const r=await auditResearchFunnel(process.env.MA_VNEXT_FOUNDATION_DIR,process.env.MA_VNEXT_DISPLAY_NAMES,process.env.MA_VNEXT_STOCK_DIR,process.env.MA_VNEXT_CONTEXT_DIR);
assert(await verifyFunnel(r));
assert.equal(r.history_hash,'7b21dbe4b3cfd50371cd791d3988d24c1e137db1d397e50c41dbe0cc2274d4aa');
assert.equal(r.sources_hash,'ad8e4fb00b79a5d749194172c0c5c875e1a37902cb8ba374b4397a4e6af0fe9a');
assert.equal(r.enrichment.evidence_hash,'7c288adb6bdd38e9d865127a2aa4ccbe0cbd582ef1bd4277327ef8ac42e09956');
assert.equal(r.enrichment.context_hash,'a245cf8c33d67f2b08190bb9215b2619c331805a027563457b99a08e1c851eb2');
assert.deepEqual(Object.values(r.counts).map(c=>[c.scanned,c.evaluated,c.qualified,c.rejected,c.insufficient,c.publication_eligible]),[[72,72,1,71,0,0],[72,72,28,44,0,0],[72,0,0,0,72,0]]);
assert.deepEqual(r.enrichment.coverage,{revenue_12:72,revenue_36:72,revenue_202609:58,institutional_20:72,financial_10:72,cashflow_10:72,comparable_eps_4:0,capex_4:0,event_symbols:65,event_records:468,event_reviewed:0,long_complete:0});
assert.equal(r.enrichment.source_failures,0);assert.equal(r.enrichment.normalization_warnings,28);
assert.equal(r.enrichment.new_facts_at_old_cutoff,0);
const short=r.rows.find(x=>x.research.horizon==='SHORT'&&x.research.state==='QUALIFIED').research;
assert.equal(short.symbol,'3653');assert.equal(short.company,'健策');
assert.equal(short.dossier.prices.date,'2026-10-08');assert.equal(short.dossier.prices.close,7165);
assert(short.dossier.opposing.some(s=>s.includes('投信')&&s.includes('52,932')));
assert(short.dossier.opposing.some(s=>s.includes('注意交易')));
assert.equal(short.dossier.adjusted_return,null);
assert.equal(r.rows.filter(x=>x.research.horizon==='SHORT'&&x.research.dossier.latest_revenue_month==='2026-08').length,14);
for(const row of r.rows){
 assert.equal(row.publication.eligible,false);assert.equal(row.publication.checked,row.research.state==='QUALIFIED');
 if(row.publication.checked)assert.deepEqual(row.publication.categories,['APPROVAL','LICENSING','QUALITY','TIME']);
 for(const e of row.research.dossier.sources){assert(Date.parse(e.available_at)<=Date.parse(r.cutoff));assert(Date.parse(e.first_seen_at)<=Date.parse(e.available_at));}
 assert.equal(row.research.mode,'RETAINED_SNAPSHOT_REVIEW_NOT_FORWARD');
}
for(const audience of ['free','premium'])assert.deepEqual(await projectQualifiedResearch(r.rows,row=>({now:r.cutoff,audience,server_entitlement_verified:true,input_hash:row.input_hash,approved_hash:null,approved_at:null,methodology_approved:false,quality_reviewed:false,use:'OWN_ANALYSIS',grants:[]})),[]);
const altered=structuredClone(r);altered.rows[0].research.dossier.coverage.revenue_months=99;assert.equal(await verifyFunnel(altered),false);
const plan=await researchRunPlan({session:r.through,cutoff:r.cutoff,version:r.version,evidenceHash:r.snapshot_hash,coreComplete:true,coreBusy:false,existingLocks:[]});
assert.equal(plan.enabled,false);assert.equal(plan.core_awaits_research,false);assert.equal(plan.outcome_link.producer_enabled,false);
assert.equal(r.forward_sample,0);assert.equal(r.outcome_sample,0);
console.log(JSON.stringify({evidence:'REAL_OFFLINE_NOT_INVESTMENT_VALIDATION',counts:r.counts,enrichment:r.enrichment,source_hashes:'UNCHANGED',network_requests:0,production_operations:0,forward:0,outcome:0}));
