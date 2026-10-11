/** Reviewed local artifact; no network, no publication grant, no research rewrite. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshotHash,hashValid} from '../../src/features/vnext/contracts.ts';
import {validProjectionTime} from '../../src/features/vnext/projection.ts';
export const REVIEW_FILE=new URL('../../docs/vnext/publication-review-20261011.json',import.meta.url);
export const eventTimesHash=times=>createHash('sha256').update(JSON.stringify(times.map(t=>new Date(t).toISOString()).sort())).digest('hex');
export async function reviewedRecords(review,at,document=JSON.parse(readFileSync(REVIEW_FILE,'utf8'))){
 if(document.schema!=='VNEXT_PUBLICATION_BLOCKER_REVIEW_1'||document.review_bundle_hash!==review.snapshot_hash||document.rows.length!==review.cards.length||new Set(document.rows.map(r=>r.symbol)).size!==document.rows.length||!validProjectionTime(document.reviewed_at)||Date.parse(document.reviewed_at)>Date.parse(at)||Date.parse(document.reviewed_at)<Date.parse(review.reviewed_at))throw Error('BLOCKER_REVIEW_LOCK_INVALID');
 if(document.reviewer!=='CODEX_CONTENT_REVIEW_NOT_SONY_OR_LEGAL_COUNSEL'||document.grants.length!==0)throw Error('BLOCKER_REVIEW_SCOPE_INVALID');
 const sets=document.body_sets??[],queries=document.empty_queries??[];
 if(document.source!=='https://mops.twse.com.tw/mops/#/web/t05st01'||new Set(sets.map(s=>s.symbol)).size!==sets.length||sets.some(s=>!document.rows.some(r=>r.symbol===s.symbol))||queries.some(q=>!document.rows.some(r=>r.symbol===q.symbol)))throw Error('EVENT_SET_SCOPE_INVALID');
 const records=[];
 for(const row of document.rows){
  const card=review.cards.find(c=>c.symbol===row.symbol&&c.review_hash===row.review_hash);
  if(!card||!row.methodology||!row.event_reason||!['PASS','PENDING','FAIL'].includes(row.event_result))throw Error('BLOCKER_ROW_INVALID');
  const receipts=document.receipts.filter(r=>r.symbol===row.symbol);
  if(receipts.some(r=>!hashValid(r.body_hash)||!validProjectionTime(r.first_seen_at)||!validProjectionTime(r.published_at)||Date.parse(r.published_at)>Date.parse(r.first_seen_at)||Date.parse(r.first_seen_at)>Date.parse(document.reviewed_at)||!card.evidence.some(e=>e.kind==='EVENT'&&Date.parse(e.published_at)===Date.parse(r.published_at))))throw Error('EVENT_RECEIPT_INVALID');
  const events=card.evidence.filter(e=>e.kind==='EVENT'),bodySet=sets.find(s=>s.symbol===row.symbol),emptyQueries=queries.filter(q=>q.symbol===row.symbol);
  // The set fingerprint binds the complete original index, not just the bodies selected as convenient.
  if(events.length){
   if(!bodySet||bodySet.count!==events.length||!hashValid(bodySet.body_set_hash)||bodySet.published_times_hash!==eventTimesHash(events.map(e=>e.published_at))||!validProjectionTime(bodySet.first_seen_at)||!validProjectionTime(bodySet.last_seen_at)||Date.parse(bodySet.first_seen_at)>Date.parse(bodySet.last_seen_at)||Date.parse(bodySet.last_seen_at)>Date.parse(document.reviewed_at)||events.some(e=>Date.parse(e.published_at)>Date.parse(bodySet.first_seen_at))||emptyQueries.length)throw Error('EVENT_REVIEW_INCOMPLETE');
  }else{
   const windows=emptyQueries.map(q=>q.from+'/'+q.through).sort();
   if(bodySet||row.event_necessity!=='NOT_REQUIRED_FOR_REVENUE_FLOW_OBSERVATION'||JSON.stringify(windows)!==JSON.stringify(['2026-09-01/2026-09-30','2026-10-01/2026-10-08'])||emptyQueries.some(q=>q.result!=='抱歉，我們搜尋不到符合的項目'||!validProjectionTime(q.observed_at)||Date.parse(q.observed_at)>Date.parse(document.reviewed_at)||Date.parse(q.observed_at)<Date.parse(review.reviewed_at)))throw Error('EMPTY_EVENT_QUERY_UNPROVEN');
  }
  for(const kind of ['METHODOLOGY','EVENT_CONTEXT']){
   const payload={review_bundle_hash:review.snapshot_hash,row,receipts,bodySet:bodySet??null,emptyQueries,kind,reviewed_at:document.reviewed_at,scope:document.scope};
   records.push({review_hash:card.review_hash,kind,result:kind==='METHODOLOGY'?'PASS':row.event_result,reviewer_ref:document.reviewer,reviewed_at:document.reviewed_at,document_hash:await snapshotHash(payload),document_ref:'repo:docs/vnext/publication-review-20261011.json#'+row.symbol,reason:kind==='METHODOLOGY'?row.methodology:row.event_reason});
  }
 }
 return records;
}
