export type FoundationSummary={
 schema:'VNEXT_FOUNDATION_SUMMARY_V1';observed_at:string;from:string;through:string;universe:72;
 coverage:Record<'20'|'60'|'120'|'250',number>;traded_coverage:number;
 rows:{symbol:string;coverage:Record<'20'|'60'|'120'|'250',number>;gaps:{date:string;reason:string}[]}[];
 action_events:number;action_sources:number;adjusted_returns_permitted:false;
 official_facts:{EVENT:number;REVENUE:number;EPS:number};
 relations:{supplier:string;customer:string;type:string;source:string;source_date:string;scope:string}[];
 history_hash:string;sources_hash:string;old_cutoff_admissible:number[];forward_sample:0;outcome_sample:0;
 daily_acquisition_enabled:false;rights:string;member_publication:false;
};
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const count=(x:unknown,max=100000)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<=max;
export function validFoundation(x:unknown):x is FoundationSummary{
 if(!record(x)||x.schema!=='VNEXT_FOUNDATION_SUMMARY_V1'||x.universe!==72||x.member_publication!==false||x.adjusted_returns_permitted!==false||x.daily_acquisition_enabled!==false||x.forward_sample!==0||x.outcome_sample!==0||typeof x.observed_at!=='string'||!Number.isFinite(Date.parse(x.observed_at))||typeof x.from!=='string'||typeof x.through!=='string'||!record(x.coverage)||!Array.isArray(x.rows)||x.rows.length!==72||!record(x.official_facts)||!Array.isArray(x.relations)||!count(x.action_events)||!count(x.action_sources,6)||!Array.isArray(x.old_cutoff_admissible)||x.old_cutoff_admissible.length!==2||x.old_cutoff_admissible.some(n=>n!==0))return false;
 for(const key of ['history_hash','sources_hash'])if(typeof x[key]!=='string'||!/^[a-f0-9]{64}$/.test(x[key] as string))return false;
 for(const key of ['20','60','120','250'])if(!count(x.coverage[key],72))return false;
 if(!count(x.traded_coverage,72))return false;
 for(const key of ['EVENT','REVENUE','EPS'])if(!count(x.official_facts[key]))return false;
 return new Set(x.rows.map(r=>record(r)?r.symbol:null)).size===72&&x.rows.every(r=>record(r)&&typeof r.symbol==='string'&&/^\d{4}$/.test(r.symbol)&&record(r.coverage)&&['20','60','120','250'].every(k=>count((r.coverage as Record<string,unknown>)[k],Number(k)))&&Array.isArray(r.gaps)&&r.gaps.every(g=>record(g)&&typeof g.date==='string'&&typeof g.reason==='string'))&&x.relations.every(r=>record(r)&&r.supplier==='3653'&&r.customer==='2330'&&r.type==='SUPPLIER'&&r.source==='https://pr.tsmc.com/english/news/3274'&&r.source_date==='2025-11-28');
}
