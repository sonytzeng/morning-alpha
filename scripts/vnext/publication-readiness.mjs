// Offline, read-only source audit. No Production client, writes or credentials.
import {auditFoundation} from './foundation-validation.mjs';
import {sha,readPrivate} from './foundation-history.mjs';
import {publicationDossier,sourceRights,validPublicationReadiness} from '../../src/features/vnext/publicationReadiness.ts';

export function auditPublication(directory,namesPath){
 const {history:h,sources:s}=auditFoundation(directory),names=readPrivate(namesPath);
 if(names.schema!=='VNEXT_DISPLAY_NAMES_ONLY'||!Array.isArray(names.rows)||new Set(names.rows.map(n=>n.symbol)).size!==names.rows.length)throw Error('DISPLAY_NAMES_INVALID');
 const cutoff=[h.observed_at,s.observed_at].sort().at(-1),cards=[];
 for(const row of h.rows){
  const last=row.bars.at(-1),facts=[];
  if(last)facts.push({id:'price-'+row.symbol,symbol:row.symbol,kind:'PRICE_VOLUME',source:last.source_ref,
   evidence_hash:last.evidence_hash,published_at:last.published_at??null,first_seen_at:last.first_seen_at,available_at:last.available_at,
   as_of:last.as_of??null,period:last.date,summary:'官方原始收盤量價；精確發布時間及調整權益尚未全部核對。',
   values:{close:last.close},limitations:['EXACT_PUBLICATION_TIME_MISSING','CORPORATE_ACTION_CLEARANCE_INCOMPLETE']});
  for(const f of s.facts.filter(f=>f.symbol===row.symbol)){
   facts.push({id:f.kind+'-'+f.evidence_hash,symbol:row.symbol,kind:f.kind==='EVENT'?'INDUSTRY_EVENT':f.kind,
    source:f.source,evidence_hash:f.evidence_hash,published_at:f.published_at,first_seen_at:f.first_seen_at,available_at:f.available_at,
    as_of:f.as_of,period:f.period??null,summary:f.kind==='EVENT'?'官方公告存在，內容及產業影響尚未審查。':'官方已公布實績；不等於未來預估或持續趨勢。',
    // Keep the original units; no percent conversion or Actual -> Consensus.
    values:{},limitations:f.kind==='EVENT'?['EVENT_BODY_AND_IMPACT_UNREVIEWED']:['EXACT_PUBLICATION_TIME_MISSING',f.kind==='EPS'?'EPS_PERIOD_BASIS_UNVERIFIED':'MULTI_PERIOD_TREND_MISSING']});
  }
  for(const r of s.relations.filter(r=>r.supplier===row.symbol||r.customer===row.symbol))facts.push({id:'relation-'+r.evidence_hash,symbol:row.symbol,kind:'SUPPLY_CHAIN',source:r.source,evidence_hash:r.evidence_hash,
   published_at:r.published_at,first_seen_at:r.first_seen_at,available_at:r.available_at,as_of:null,period:r.source_date,
   summary:'2025年供應商獎項具名關係；不證明目前訂單、營收占比或股價影響。',values:{},limitations:['RELATION_SCOPE_NOT_CURRENT_DEMAND','EXACT_PUBLICATION_TIME_MISSING']});
  const company=names.rows.find(n=>n.symbol===row.symbol)?.stock_name;if(typeof company!=='string'||!company)throw Error('DISPLAY_NAME_MISSING');
  cards.push(...publicationDossier({symbol:row.symbol,company,sector:'',facts,coverage:row.coverage},cutoff));
 }
 const source_rights=[...new Set(cards.flatMap(c=>c.rights.map(r=>r.source)))].map(source=>({source,...sourceRights(source)}));
 const result={schema:'VNEXT_PUBLICATION_READINESS_V1',mode:'OWNER_REVIEW_ONLY',audited_at:cutoff,through:h.through,
  history_hash:sha(h),sources_hash:sha(s),universe:72,cards,eligible:{SHORT:0,MEDIUM:0,LONG:0},source_rights,
  forward_sample:0,outcome_sample:0,member_publication:false,natural_update_enabled:false};
 if(!validPublicationReadiness(result))throw Error('PUBLICATION_AUDIT_INVALID');return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const r=auditPublication(process.env.MA_VNEXT_FOUNDATION_DIR,process.env.MA_VNEXT_DISPLAY_NAMES);
 console.log(JSON.stringify({universe:r.universe,dossiers:r.cards.length,through:r.through,cutoff:r.audited_at,eligible:r.eligible,
  evidence_ready:Object.fromEntries(['SHORT','MEDIUM','LONG'].map(h=>[h,r.cards.filter(c=>c.horizon===h&&c.evidence_ready).length])),
  blockers:Object.fromEntries([...new Set(r.cards.flatMap(c=>c.blockers))].map(b=>[b,r.cards.filter(c=>c.blockers.includes(b)).length])),
  rights:Object.fromEntries(['OPEN_DATA_WITH_ATTRIBUTION','LICENSING_UNVERIFIED','RESTRICTED_CONTRACT_REQUIRED'].map(s=>[s,r.source_rights.filter(x=>x.status===s).length])),
  history_hash:r.history_hash,sources_hash:r.sources_hash,forward:0,outcome:0,production_writes:0}));
}
