/** Offline ONLY. Original caches and historical predictions remain immutable. */
import {auditFoundation} from './foundation-validation.mjs';
import {auditPublication} from './publication-readiness.mjs';
import {readPrivate,sha,foundationSessions} from './foundation-history.mjs';
import {HORIZONS,snapshotHash} from '../../src/features/vnext/contracts.ts';
import {evaluateResearch,publicationEligibility,summarizeFunnel,RESEARCH_FUNNEL_VERSION,verifyFunnel} from '../../src/features/vnext/researchFunnel.ts';
import {stockDossier} from '../../src/features/vnext/stockResearch.ts';
import {readStockSnapshot} from './stock-audit.mjs';

export function retainedSessionScope(bar,symbol){
 // Earlier cache adapter lacked the additive label. Only the same exact
 // already-audited STOCK_DAY resource can supply it; no broad hostname fallback.
 if(bar.session_scope)return bar.session_scope;
 try{const u=new URL(bar.source_ref);if(u.protocol==='https:'&&u.hostname==='www.twse.com.tw'&&u.pathname==='/exchangeReport/STOCK_DAY'
  &&u.searchParams.get('stockNo')===symbol&&u.searchParams.get('date')===bar.date.slice(0,7).replace('-','')+'01'
  &&u.searchParams.get('response')==='json')return 'OFFICIAL_STOCK_DAY';}catch{ /* unknown remains missing */ }
 return '';
}

export async function auditResearchFunnel(directory,namesPath,stockDirectory=null,contextDirectory=null){
 const {history:h,sources:s}=auditFoundation(directory),v1=auditPublication(directory,namesPath),names=readPrivate(namesPath);
 const stock=stockDirectory?readStockSnapshot(stockDirectory,'stock-evidence','VNEXT_REAL_STOCK_EVIDENCE_V1',sha(h)):null,context=contextDirectory?readStockSnapshot(contextDirectory,'stock-context','VNEXT_STOCK_CONTEXT_V1',sha(h)):null;
 if(Boolean(stock)!==Boolean(context))throw Error('ENRICHMENT_PAIR_REQUIRED');
 const cutoff=[h.observed_at,s.observed_at,...(stock?[stock.collected_at,context.collected_at]:[])].sort().at(-1),rows=[];
 for(const row of h.rows){
  const input={symbol:row.symbol,company:names.rows.find(n=>n.symbol===row.symbol)?.stock_name,
   cutoff,through:h.through,next_session:h.before,expected_sessions:foundationSessions(h.before),
   bars:row.bars.map(b=>({...b,id:'bar-'+row.symbol+'-'+b.date,source:b.source_ref,session_scope:retainedSessionScope(b,row.symbol)})),
   // Actual timestamps and units stay exact. Do not fill missing published/as_of
   // with first_seen, or a monthly period with a fake quarterly trend.
   facts:s.facts.filter(f=>f.symbol===row.symbol).map(f=>({...f,id:f.kind+'-'+f.evidence_hash,
    basis:f.period_basis??null,values:f.kind==='REVENUE'?{yoy_percent:f.values.revenue_yoy,mom_percent:f.values.revenue_mom}:f.values??{}})),
   v1_missing:Object.fromEntries(Object.keys(HORIZONS).map(horizon=>[horizon,v1.cards.find(c=>c.symbol===row.symbol&&c.horizon===horizon).blockers.filter(b=>b.startsWith('MISSING_'))]))};
  if(stock)input.facts=[...input.facts.filter(f=>f.kind!=='REVENUE'),...stock.rows.filter(f=>f.symbol===row.symbol)];
  for(const horizon of Object.keys(HORIZONS)){
   const research=evaluateResearch(input,horizon);
   if(stock)research.dossier=stockDossier({research,bars:input.bars,facts:stock.rows,events:context.events,benchmark:context.benchmarks,expectedSessions:input.expected_sessions,lastMonth:'2026-09'});
   const input_hash=await snapshotHash({version:RESEARCH_FUNNEL_VERSION,research});
   // No human approval, method promotion, server member identity or grant is
   // invented. Diagnostic checks qualified research only; never writes an RPC.
   const publication=publicationEligibility(research,{now:cutoff,audience:'owner',server_entitlement_verified:true,
    input_hash,approved_hash:null,approved_at:null,methodology_approved:false,quality_reviewed:false,use:'OWN_ANALYSIS',grants:[]});
   rows.push({research,publication,input_hash});
  }
 }
 const payload={schema:'VNEXT_RESEARCH_PUBLICATION_FUNNEL_V2',version:RESEARCH_FUNNEL_VERSION,through:h.through,cutoff,
  history_hash:sha(h),sources_hash:sha(s),rows,counts:Object.fromEntries(Object.keys(HORIZONS).map(h=>[h,summarizeFunnel(rows.filter(r=>r.research.horizon===h))])),
  member_publication:false,promotion:false,forward_sample:0,outcome_sample:0};
 if(stock){const per=rows.filter(r=>r.research.horizon==='SHORT').map(r=>r.research.dossier.coverage),count=fn=>per.filter(fn).length;
  const issues=[...stock.failures,...context.failures];
  payload.enrichment={evidence_hash:sha(stock),context_hash:sha(context),collected_at:cutoff,coverage:{revenue_12:count(c=>c.revenue_12),revenue_36:count(c=>c.revenue_36),revenue_202609:count(c=>c.requested_month_present),institutional_20:count(c=>c.institutional_20),financial_10:count(c=>c.financial_periods===10),cashflow_10:count(c=>c.cashflow_periods===10),comparable_eps_4:count(c=>c.comparable_eps_quarters>=4),capex_4:count(c=>c.capex_quarters>=4),event_symbols:count(c=>c.event_index>0),event_records:context.events.length,event_reviewed:0,long_complete:rows.filter(r=>r.research.horizon==='LONG'&&r.research.evaluated).length},source_failures:issues.filter(f=>f.reason!=='YOY_BASE_UNAVAILABLE').length,normalization_warnings:issues.filter(f=>f.reason==='YOY_BASE_UNAVAILABLE').length,new_facts_at_old_cutoff:[...stock.rows,...context.events].filter(f=>Date.parse(f.available_at)<=Date.parse('2026-10-08T06:33:01.624Z')).length,natural_enabled:false};
 }
 const result={...payload,snapshot_hash:await snapshotHash(payload)};if(!await verifyFunnel(result))throw Error('FUNNEL_INVALID');return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
 const r=await auditResearchFunnel(process.env.MA_VNEXT_FOUNDATION_DIR,process.env.MA_VNEXT_DISPLAY_NAMES,process.env.MA_VNEXT_STOCK_DIR,process.env.MA_VNEXT_CONTEXT_DIR);
 console.log(JSON.stringify({version:r.version,through:r.through,cutoff:r.cutoff,counts:r.counts,
  qualified:r.rows.filter(r=>r.research.state==='QUALIFIED').map(r=>({symbol:r.research.symbol,horizon:r.research.horizon})),
  history_hash:r.history_hash,sources_hash:r.sources_hash,enrichment:r.enrichment,forward:0,outcome:0,production_operations:0},null,2));
}
