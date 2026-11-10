/** Offline snapshot validation only. No model, provider, database or publication.
 * This proves declared structure/bindings/comparisons, never editorial truth or
 * source-use rights. Independent quality/time/source-use reviews remain required.
 */
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {validateAnalysisPacket} from './daily-ai-analysis.ts';
import {validateStockAnalysisClaim,validateStockAnalysisCondition} from './daily-ai-semantics.ts';
import {snapshotHash,hashValid,validObservationTime,compareTime} from '../src/features/vnext/contracts.ts';

const BODY_KEYS=['schema','provenance','author_ref','batch_id','cutoff','through','prepared_at','expires_at','packet_hashes','cards','numeric_assertions','reference_jobs','model_generated','model_calls','member_published','publication_ready'];
const CARD_KEYS=['symbol','company','horizon','status','reason','counter_evidence','confirmation','invalidation','gaps','sources','classification'];
const SOURCE_KEYS=['id','source','kind','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash'];
const ASSERTION_KEYS=['symbol','horizon','claim_path','claim_hash','text_fragment','operator','left','right','expected'];
const OPERAND_KEYS=['evidence_id','value_path','period_path','period','unit_path','unit'];
const HORIZONS=['SHORT','MEDIUM','LONG'],STATUSES=['WATCH','WAIT','AVOID','INSUFFICIENT'];
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=code=>{throw Error(code);};
const keys=(value,expected,code)=>{if(!object(value)||Object.keys(value).length!==expected.length||expected.some(k=>!Object.hasOwn(value,k)))fail(code);};
const text=(value,max,code)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail(code);return value;};
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const same=async(a,b)=>await snapshotHash(a)===await snapshotHash(b);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>typeof value==='string'&&validObservationTime(value);
const expiryBound=value=>{
 // Date supplies exact calendar/timezone arithmetic at millisecond precision;
 // restore the unchanged six-digit fraction before comparing PostgreSQL times.
 const fraction=/(?:(?:\.)(\d{1,6}))?(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1]??'';
 return new Date(Date.parse(value)+72*3600000).toISOString().replace(/\.\d{3}Z$/,'.'+fraction.padEnd(6,'0')+'Z');
};
const sourceProjection=e=>({id:e.id,source:e.source,kind:e.kind,published_at:e.published_at,available_at:e.available_at,
 time_basis:e.time_basis??'PUBLISHED',first_seen_at:e.first_seen_at??null,as_of:e.as_of??null,evidence_hash:e.evidence_hash??null});
function pathValue(value,path){
 if(!Array.isArray(path)||!path.length||path.length>12||path.some(k=>typeof k!=='string'||!k||k.length>100||['__proto__','constructor','prototype'].includes(k)))fail('OFFLINE_NUMERIC_PATH');
 let current=value;
 for(const key of path){if(!current||typeof current!=='object'||!Object.hasOwn(current,key))fail('OFFLINE_NUMERIC_PATH');current=current[key];}
 return current;
}
function claimAt(card,path){
 if(path==='reason')return card.reason;
 const match=/^counter_evidence\.(0|[1-9][0-9]?)$/.exec(path);
 if(!match||!card.counter_evidence[Number(match[1])])fail('OFFLINE_NUMERIC_CLAIM');
 return card.counter_evidence[Number(match[1])];
}
function numericTokens(text){
 // Mask declared calendar labels while retaining offsets; dates are checked by
 // the existing period validator. Holding-period/method numbers stay reviewable.
 const normalized=text.replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10)).replaceAll('．','.').replaceAll('＋','+').replaceAll('－','-');
 const masked=normalized.replace(/\b\d{4}-(?:Q[1-4]|\d\d(?:-\d\d)?)\b/g,s=>' '.repeat(s.length))
  .replace(/\d{4}年\s*(?:第\s*[1-4]季|Q[1-4]|\d{1,2}月(?:\s*\d{1,2}日)?)/g,s=>' '.repeat(s.length));
 return [...masked.matchAll(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?/g)].map(m=>({literal:m[0],value:Number(m[0].replaceAll(',','')),start:m.index,end:m.index+m[0].length}));
}
function comparison(op,left,right){
 switch(op){case'EQ':return left===right;case'NE':return left!==right;case'GT':return left>right;case'GTE':return left>=right;case'LT':return left<right;case'LTE':return left<=right;default:fail('OFFLINE_NUMERIC_OPERATOR');}
}

export async function validateReviewedAnalysisSnapshot(batchPayloadText,body,{now=Date.now(),expected_batch_id=null}={}){
 if(typeof batchPayloadText!=='string'||Buffer.byteLength(batchPayloadText,'utf8')>12000000||!Number.isFinite(now))fail('OFFLINE_INPUT');
 keys(body,BODY_KEYS,'OFFLINE_SNAPSHOT_KEYS');
 if(body.schema!=='DAILY_OFFLINE_REVIEWED_ANALYSIS_V1'||body.provenance!=='OFFLINE_REVIEWED'
  ||body.model_generated!==false||body.model_calls!==0||body.member_published!==false||body.publication_ready!==false)fail('OFFLINE_PROVENANCE');
 text(body.author_ref,200,'OFFLINE_AUTHOR');
 const batch=JSON.parse(batchPayloadText),batchId=sha(batchPayloadText);
 if(!hashValid(body.batch_id)||body.batch_id!==batchId||expected_batch_id!==null&&body.batch_id!==expected_batch_id
  ||batch.schema!=='DAILY_AI_BATCH_INPUT_V1'||!object(batch.packet_texts)||!object(batch.packet_hashes)
  ||Object.keys(batch.packet_texts).length!==72||Object.keys(batch.packet_hashes).length!==72)fail('OFFLINE_BATCH_BINDING');
 if(!time(body.cutoff)||!time(body.prepared_at)||!time(body.expires_at)||body.cutoff!==batch.cutoff||body.through!==batch.through
  ||compareTime(body.cutoff,body.prepared_at)>0||compareTime(body.prepared_at,new Date(now).toISOString())>0||Date.parse(body.expires_at)<=now
  ||compareTime(body.prepared_at,body.expires_at)>=0||compareTime(body.expires_at,expiryBound(body.cutoff))>0
  ||!/^\d{4}-\d\d-\d\d$/.test(body.through)||!time(body.through+'T13:30:00+08:00')
  ||compareTime(body.through+'T13:30:00+08:00',body.cutoff)>0)fail('OFFLINE_TIME');
 if(!await same(body.packet_hashes,batch.packet_hashes))fail('OFFLINE_PACKET_HASHES');
 if(!Array.isArray(body.reference_jobs)||body.reference_jobs.length>72||new Set(body.reference_jobs).size!==body.reference_jobs.length
  ||body.reference_jobs.some(id=>typeof id!=='string'||!hashValid(id)))fail('OFFLINE_REFERENCE_JOBS');
 if(!Array.isArray(body.cards)||body.cards.length!==216||!Array.isArray(body.numeric_assertions)||body.numeric_assertions.length>4320)fail('OFFLINE_UNIVERSE');
 const packets=new Map();
 for(const [symbol,packetText] of Object.entries(batch.packet_texts)){
  if(!/^\d{4,6}$/.test(symbol)||typeof packetText!=='string'||sha(packetText)!==batch.packet_hashes[symbol])fail('OFFLINE_PACKET_COMMITMENT');
  const packet=JSON.parse(packetText);validateAnalysisPacket(packet);
  for(const e of packet.evidence)if(compareTime(e.available_at,packet.cutoff)>0
   ||e.published_at!==null&&compareTime(e.published_at,e.available_at)>0
   ||e.first_seen_at!==undefined&&compareTime(e.first_seen_at,e.available_at)>0
   ||e.as_of!==undefined&&compareTime(e.as_of,e.available_at)>0)fail('OFFLINE_EVIDENCE_TIME');
  if(packet.symbol!==symbol||packet.cutoff!==body.cutoff||packet.data_through!==body.through
   ||await snapshotHash(packet)!==batch.packet_hashes[symbol])fail('OFFLINE_PACKET_SCOPE');
  packets.set(symbol,packet);
 }
 const cards=new Map(),claims=new Map(),uncovered=new Map(),nonArabicReview=[];let sourceBindings=0;
 for(const card of body.cards){
  keys(card,CARD_KEYS,'OFFLINE_CARD_KEYS');const packet=packets.get(card.symbol),cardKey=card.symbol+':'+card.horizon;
  if(!packet||packet.company!==card.company||!HORIZONS.includes(card.horizon)||cards.has(cardKey)||!STATUSES.includes(card.status)
   ||card.classification!=='INFERENCE')fail('OFFLINE_CARD_IDENTITY');
  cards.set(cardKey,card);
  if(!Array.isArray(card.gaps)||card.gaps.length>130||card.gaps.some(g=>typeof g!=='string'||!g.trim()||g.length>1500)
   ||card.status==='INSUFFICIENT'&&!card.gaps.length||(packet.data_gaps??[]).some(g=>!card.gaps.includes(g)))fail('OFFLINE_CARD_GAPS');
  for(const field of ['confirmation','invalidation'])validateStockAnalysisCondition(text(card[field],1500,'OFFLINE_CONDITION'));
  if(!Array.isArray(card.counter_evidence)||card.counter_evidence.length>20||!Array.isArray(card.sources)||!card.sources.length)fail('OFFLINE_CARD_LISTS');
  const evidence=new Map(packet.evidence.map(e=>[e.id,e])),cited=new Set();
  for(const [path,claim]of[['reason',card.reason],...card.counter_evidence.map((c,i)=>['counter_evidence.'+i,c])]){
   keys(claim,['text','evidence_ids'],'OFFLINE_CLAIM_KEYS');text(claim.text,1500,'OFFLINE_CLAIM_TEXT');
   if(/保證獲利|穩賺|必漲|必賺/u.test(claim.text)||!Array.isArray(claim.evidence_ids)||!claim.evidence_ids.length||claim.evidence_ids.length>100
    ||new Set(claim.evidence_ids).size!==claim.evidence_ids.length||claim.evidence_ids.some(id=>typeof id!=='string'||!evidence.has(id)))fail('OFFLINE_CLAIM_CITATION');
   validateStockAnalysisClaim(packet,claim);claim.evidence_ids.forEach(id=>cited.add(id));
   const claimKey=cardKey+':'+path;claims.set(claimKey,{card,claim,path,evidence});
   uncovered.set(claimKey,numericTokens(claim.text));
   for(const m of claim.text.matchAll(/[零〇○一二三四五六七八九十百千萬億兩壹貳參肆伍陸柒捌玖拾佰仟點点]+(?:%|％|成|元|圓|塊|倍|股|張|天|日|週|月|季|年|個)/gu))
    nonArabicReview.push({code:'NON_ARABIC_NUMERIC_INDEPENDENT_REVIEW_REQUIRED',claim_key:claimKey,literal:m[0],start:m.index,end:m.index+m[0].length});
  }
  if(card.status==='WATCH'&&!card.reason.evidence_ids.some(id=>evidence.get(id).symbol===card.symbol))fail('OFFLINE_COMPANY_EVIDENCE');
  const seen=new Set();
  for(const source of card.sources){
   keys(source,SOURCE_KEYS,'OFFLINE_SOURCE_KEYS');const original=evidence.get(source.id);
   const expected=original?sourceProjection(original):null;
   if(!expected||seen.has(source.id)||!cited.has(source.id)||SOURCE_KEYS.some(key=>source[key]!==expected[key]))fail('OFFLINE_SOURCE_BINDING');
   seen.add(source.id);sourceBindings++;
  }
  if(seen.size!==cited.size)fail('OFFLINE_SOURCE_SET');
 }
 for(const symbol of packets.keys())for(const horizon of HORIZONS)if(!cards.has(symbol+':'+horizon))fail('OFFLINE_HORIZON_MISSING');
 const assertionHashes=new Set(),unitReview=[];let checkedAssertions=0;
 for(const assertion of body.numeric_assertions){
  keys(assertion,ASSERTION_KEYS,'OFFLINE_NUMERIC_ASSERTION_KEYS');
  if(['symbol','horizon','claim_path','claim_hash','text_fragment','operator'].some(key=>typeof assertion[key]!=='string'))fail('OFFLINE_NUMERIC_ASSERTION_TYPES');
  const claimKey=assertion.symbol+':'+assertion.horizon+':'+assertion.claim_path,entry=claims.get(claimKey);
  if(!entry||typeof assertion.expected!=='boolean'||!hashValid(assertion.claim_hash)||await snapshotHash(entry.claim)!==assertion.claim_hash)fail('OFFLINE_NUMERIC_CLAIM');
  text(assertion.text_fragment,1500,'OFFLINE_NUMERIC_FRAGMENT');
  const fragmentStart=entry.claim.text.indexOf(assertion.text_fragment);
  if(fragmentStart<0||entry.claim.text.indexOf(assertion.text_fragment,fragmentStart+1)>=0)fail('OFFLINE_NUMERIC_FRAGMENT');
  const assertionHash=await snapshotHash(assertion);if(assertionHashes.has(assertionHash))fail('OFFLINE_NUMERIC_DUPLICATE');assertionHashes.add(assertionHash);
  const sourceValues=[],sourceUnits=[];
  const operand=value=>{
   keys(value,OPERAND_KEYS,'OFFLINE_NUMERIC_OPERAND_KEYS');
   if(!entry.claim.evidence_ids.includes(value.evidence_id)||!entry.evidence.has(value.evidence_id))fail('OFFLINE_NUMERIC_SOURCE');
   const raw=JSON.parse(entry.evidence.get(value.evidence_id).content),number=pathValue(raw,value.value_path);
   if(!finite(number)||typeof value.period!=='string'||!value.period||pathValue(raw,value.period_path)!==value.period)fail('OFFLINE_NUMERIC_VALUE_OR_BASIS');
   if(value.unit_path===null&&value.unit===null)unitReview.push({code:'NUMERIC_UNIT_INDEPENDENT_REVIEW_REQUIRED',claim_key:claimKey,evidence_id:value.evidence_id,value_path:value.value_path});
   else if(typeof value.unit!=='string'||!value.unit||pathValue(raw,value.unit_path)!==value.unit)fail('OFFLINE_NUMERIC_VALUE_OR_BASIS');
   sourceValues.push(number);sourceUnits.push(value.unit);return number;
  };
  const left=operand(assertion.left);let right;
  if(object(assertion.right)&&Object.keys(assertion.right).length===1&&Object.hasOwn(assertion.right,'literal')){
   if(!finite(assertion.right.literal))fail('OFFLINE_NUMERIC_LITERAL');right=assertion.right.literal;
  }else right=operand(assertion.right);
  if(sourceUnits.length===2&&sourceUnits.every(unit=>unit!==null)&&sourceUnits[0]!==sourceUnits[1])fail('OFFLINE_NUMERIC_INCOMPATIBLE_UNITS');
  if(comparison(assertion.operator,left,right)!==assertion.expected)fail('OFFLINE_NUMERIC_ASSERTION_FALSE');
  const fragmentEnd=fragmentStart+assertion.text_fragment.length;
  uncovered.set(claimKey,uncovered.get(claimKey).filter(token=>!(token.start>=fragmentStart&&token.end<=fragmentEnd&&sourceValues.some(value=>value===token.value))));
  checkedAssertions++;
 }
 const numericReview=[...uncovered].flatMap(([claim_key,tokens])=>tokens.map(t=>({code:'NUMERIC_CLAIM_INDEPENDENT_REVIEW_REQUIRED',claim_key,literal:t.literal,start:t.start,end:t.end})));
 return {schema:'OFFLINE_REVIEWED_SNAPSHOT_VALIDATION_V1',status:'MECHANICAL_PASS_INDEPENDENT_REVIEW_REQUIRED',snapshot_hash:await snapshotHash(body),batch_id:batchId,
  counts:{symbols:packets.size,cards:cards.size,claims:claims.size,source_bindings:sourceBindings,numeric_assertions_verified:checkedAssertions,uncovered_numeric_literals:numericReview.length,non_arabic_numeric_claims:nonArabicReview.length,unknown_unit_assertion_operands:unitReview.length},
  numeric_review_required:numericReview.length+unitReview.length+nonArabicReview.length>0,review_required:[...numericReview,...nonArabicReview,...unitReview],independent_review_required:true,
  limitations:['Numeric assertions prove the specified JSON comparisons; an independent reviewer must verify what the prose claims mean.',
   'Literal comparison thresholds are not approved valuation or execution methods.','Reference jobs are syntax-checked here; the admission database must verify actual COMPLETE records.',
   'This does not prove source-use rights, paid-product completeness, source freshness or investment returns.'],
  authorizes_publication:false,authorizes_billing:false,model_calls:0,production_writes:0,member_published:false};
}
