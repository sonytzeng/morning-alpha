/** Offline paid-product audit; no network, model calls, database or publication.
 * CLI: node scripts/operations/audit-stock-paid-readiness.mjs input.json output.json
 * Input: {edition:{id,evidence_cutoff,prepared_at,expires_at},packets,cards,
 * reviews:{quality,time,source_use},price_plans:[]}.
 * Each supplied review binds edition_id/cards_hash/packets_hash, status=PASS,
 * reviewed_at, expires_at and document_hash. Hashes use snapshotHash.
 * A plan binds edition_id/symbol/horizon, status=VERIFIED, currency=TWD,
 * entry_range:[low,high], wait_above, stop, invalidation, basis, evidence_ids,
 * as_of, expires_at, plus review:{status,plan_hash,reviewed_at,document_hash}.
 * Both WATCH and WAIT require a verified plan. WAIT still cannot be buy-ready.
 * plan_hash hashes the complete plan excluding its review field.
 * Supplied reviews are evidence references, not independently authenticated
 * signatures. A successful audit never grants Owner or billing authorization.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {validateAnalysisPacket} from '../../research/daily-ai-analysis.ts';
import {validateStockAnalysisClaim,validateStockAnalysisCondition} from '../../research/daily-ai-semantics.ts';
import {snapshotHash,hashValid,sourceSafe,validObservationTime,compareTime} from '../../src/features/vnext/contracts.ts';

const horizons=['SHORT','MEDIUM','LONG'];
const statuses=['WATCH','WAIT','AVOID','INSUFFICIENT'];
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const evidenceEntries=packet=>Array.isArray(packet?.evidence)?packet.evidence.filter(object):[];
const key=v=>`${v?.symbol}:${v?.horizon}`;
const atOrBefore=(a,b)=>validObservationTime(a)&&validObservationTime(b)&&compareTime(a,b)<=0;
const future=(value,now)=>validObservationTime(value)&&Date.parse(value)>now;

export async function auditStockPaidReadiness(input,now=Date.now()){
 if(!object(input)||!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw Error('PAID_AUDIT_INPUT');
 const packets=Array.isArray(input.packets)?input.packets:[],cards=Array.isArray(input.cards)?input.cards:[];
 const plans=Array.isArray(input.price_plans)?input.price_plans:[],edition=input.edition;
 const nowIso=new Date(now).toISOString(),issues=[];
 const issue=(code,card=null,detail=null)=>issues.push({code,symbol:card?.symbol??null,horizon:card?.horizon??null,detail});
 const hashes={cards:await snapshotHash(cards),packets:await snapshotHash(packets)};
 const editionValid=object(edition)&&hashValid(edition.id)&&atOrBefore(edition.evidence_cutoff,edition.prepared_at)
  &&atOrBefore(edition.prepared_at,nowIso)&&future(edition.expires_at,now)
  &&atOrBefore(edition.prepared_at,edition.expires_at);
 if(!editionValid)issue('EDITION_INVALID_OR_EXPIRED');
 const bySymbol=new Map(),cardKeys=new Set(),planKeys=new Set();
 for(const packet of packets){
  if(!object(packet)){issue('PACKET_INVALID');continue;}
  if(bySymbol.has(packet.symbol))issue('PACKET_DUPLICATE',packet);
  bySymbol.set(packet.symbol,packet);
  try{validateAnalysisPacket(packet);}catch(error){issue('PACKET_INVALID',packet,error.message);}
  if(editionValid&&packet.cutoff!==edition.evidence_cutoff)issue('PACKET_EDITION_CUTOFF',packet);
 }
 if(packets.length!==72||bySymbol.size!==72||cards.length!==216)issue('UNIVERSE_INCOMPLETE',null,{packets:packets.length,symbols:bySymbol.size,cards:cards.length,expected_symbols:72,expected_cards:216});
 const counts=Object.fromEntries(horizons.map(h=>[h,Object.fromEntries(statuses.map(s=>[s,0]))]));
 let verifiedPlans=0;
 for(const card of cards){
  if(!object(card)){issue('CARD_INVALID');continue;}
  const packet=bySymbol.get(card.symbol),id=key(card);
  if(!packet||!horizons.includes(card.horizon)||cardKeys.has(id)||packet.company!==card.company){issue('CARD_IDENTITY',card);continue;}
  cardKeys.add(id);
  if(card.classification!=='INFERENCE')issue('CARD_CLASSIFICATION',card);
  if(!statuses.includes(card.status))issue('CARD_STATUS',card);
  else counts[card.horizon][card.status]++;
  if(card.status!=='WATCH'&&card.buy_ready===true)issue('NON_ACTIONABLE_PROMOTED_TO_BUY',card);
  if(card.status==='INSUFFICIENT')issue('RESEARCH_INSUFFICIENT',card);
  if(!Array.isArray(card.gaps)||card.gaps.some(g=>!nonempty(g))||(card.status==='INSUFFICIENT'&&!card.gaps.length))issue('CARD_GAPS',card);
  for(const field of ['confirmation','invalidation'])try{
   if(!nonempty(card[field]))throw Error('EMPTY_CONDITION');
   validateStockAnalysisCondition(card[field]);
  }catch(error){issue('CARD_CONDITION',card,{field,error:error.message});}
  const evidence=new Map(evidenceEntries(packet).map(e=>[e.id,e]));
  const sources=Array.isArray(card.sources)?card.sources:[];
  const sourceIds=new Set();
  if(!sources.length)issue('CARD_SOURCE_MISSING',card);
  for(const source of sources){
   const original=evidence.get(source?.id);
   if(!object(source)||sourceIds.has(source.id)||!original||!sourceSafe(source.source)
    ||['source','kind','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash'].some(k=>(source[k]??null)!==(original[k]??null)))issue('CARD_SOURCE_BINDING',card,source?.id??null);
   sourceIds.add(source?.id);
  }
  if(!Array.isArray(card.counter_evidence))issue('RISK_REVIEW_MISSING',card);
  for(const [field,claim] of [['reason',card.reason],...(Array.isArray(card.counter_evidence)?card.counter_evidence:[]).map((c,i)=>['counter_evidence.'+i,c])]){
   if(!object(claim)||!nonempty(claim.text)||!Array.isArray(claim.evidence_ids)||!claim.evidence_ids.length
    ||new Set(claim.evidence_ids).size!==claim.evidence_ids.length||claim.evidence_ids.some(id=>!evidence.has(id)||!sourceIds.has(id))){issue('CLAIM_CITATION',card,field);continue;}
   try{validateStockAnalysisClaim(packet,claim);}catch(error){issue('CLAIM_SEMANTICS',card,{field,error:error.message});}
  }
 }
 for(const symbol of bySymbol.keys())for(const horizon of horizons)if(!cardKeys.has(`${symbol}:${horizon}`))issue('HORIZON_MISSING',{symbol,horizon});
 for(const type of ['quality','time','source_use']){
  const review=input.reviews?.[type];
  if(!object(review)||review.status!=='PASS'||!editionValid||review.edition_id!==edition.id
   ||review.cards_hash!==hashes.cards||review.packets_hash!==hashes.packets||!hashValid(review.document_hash)
   ||!atOrBefore(edition.prepared_at,review.reviewed_at)||!atOrBefore(review.reviewed_at,nowIso)
   ||!future(review.expires_at,now)||!atOrBefore(review.reviewed_at,review.expires_at))issue('BOUND_REVIEW_MISSING_OR_INVALID',null,type);
 }
 const planByKey=new Map();
 for(const plan of plans){
  if(!object(plan)){issue('PRICE_PLAN_INVALID');continue;}
  const id=key(plan);
  if(planKeys.has(id))issue('PRICE_PLAN_DUPLICATE',plan);
  planKeys.add(id);planByKey.set(id,plan);
  const card=cards.find(c=>object(c)&&key(c)===id),packet=bySymbol.get(plan.symbol);
  if(!card||!packet){issue('PRICE_PLAN_ORPHAN',plan);continue;}
  const evidence=new Map(evidenceEntries(packet).map(e=>[e.id,e]));
  const {review,...body}=plan;
  const planHash=await snapshotHash(body);
  const range=plan.entry_range;
  const valid=editionValid&&plan.edition_id===edition.id&&plan.status==='VERIFIED'&&plan.currency==='TWD'
   &&Array.isArray(range)&&range.length===2&&range.every(positive)&&range[0]<=range[1]
   &&positive(plan.wait_above)&&plan.wait_above>=range[1]&&positive(plan.stop)&&plan.stop<range[0]
   &&nonempty(plan.invalidation)&&nonempty(plan.basis)&&Array.isArray(plan.evidence_ids)&&plan.evidence_ids.length>0
   &&new Set(plan.evidence_ids).size===plan.evidence_ids.length&&plan.evidence_ids.every(id=>evidence.has(id))
   &&plan.evidence_ids.some(id=>evidence.get(id)?.kind==='PRICE')
   &&atOrBefore(edition.evidence_cutoff,plan.as_of)&&atOrBefore(plan.as_of,nowIso)
   &&future(plan.expires_at,now)&&atOrBefore(plan.as_of,plan.expires_at)&&atOrBefore(plan.expires_at,edition.expires_at)
   &&object(review)&&review.status==='PASS'&&review.plan_hash===planHash&&hashValid(review.document_hash)
   &&atOrBefore(plan.as_of,review.reviewed_at)&&atOrBefore(review.reviewed_at,nowIso)
   &&atOrBefore(review.reviewed_at,plan.expires_at);
  if(!valid)issue('PRICE_PLAN_INVALID',plan);
  else verifiedPlans++;
  if(card.status!=='WATCH'&&plan.buy_ready===true)issue('NON_ACTIONABLE_PROMOTED_TO_BUY',card);
 }
 const plannedCards=cards.filter(c=>object(c)&&['WATCH','WAIT'].includes(c.status));
 for(const card of plannedCards)if(!planByKey.has(key(card)))issue('VERIFIED_PRICE_PLAN_MISSING',card);
 if(!plans.length)issue('NO_VERIFIED_PRICE_PLANS');
 const issueCounts=Object.fromEntries([...new Set(issues.map(i=>i.code))].sort().map(code=>[code,issues.filter(i=>i.code===code).length]));
 return {schema:'MORNING_ALPHA_STOCK_PAID_READINESS_AUDIT_V1',checked_at:nowIso,edition_id:edition?.id??null,input_hashes:hashes,
  status:issues.length?'BLOCKED':'MECHANICAL_REQUIREMENTS_MET_OWNER_AND_MEMBER_E2E_REQUIRED',
  counts:{packets:packets.length,cards:cards.length,horizons:counts,cards_requiring_independent_price_plan:plannedCards.length,verified_price_plans:verifiedPlans},
  issue_counts:issueCounts,issues,
  limitations:['Supplied review documents and price-plan economics require independent review; hashes only bind the supplied records.',
   'WATCH is research interest. WAIT, AVOID and INSUFFICIENT are never buy-ready decisions.',
   'This audit does not authenticate Owner approval, grant source rights, test Premium access/payment, establish capacity or prove investment returns.'],
  authorizes_publication:false,authorizes_billing:false,model_calls:0,production_writes:0,member_published:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [inputPath,outputPath]=process.argv.slice(2);
 if(!inputPath||!outputPath)throw Error('Expected input.json output.json');
 const input=JSON.parse(await readFile(inputPath,'utf8'));
 const report=await auditStockPaidReadiness(input);
 await writeFile(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:report.status,counts:report.counts,issue_counts:report.issue_counts,authorizes_publication:false}));
}
