/** Private, offline price-candidate preparation. No network, SQL or reviewer.
 * Numbers must be supplied by a separate documented method. This checks their
 * structure and provenance binding, never their economic validity or approval.
 */
import {validateDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';
import {snapshotHash,compareTime} from '../src/features/vnext/contracts.ts';
import {validateAnalysisPacket} from './daily-ai-analysis.ts';

const fail=code=>{throw Error(code);};
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>{if(!object(v)||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail('PRICE_PREPARATION_FIELDS');};
const text=(s,max)=>{if(typeof s!=='string'||!s.trim()||s.length>max)fail('PRICE_PREPARATION_METHOD_NOTE');return s;};
const list=(v)=>{if(!Array.isArray(v)||!v.length||v.length>30)fail('PRICE_PREPARATION_METHOD_NOTE');return v.map(x=>text(x,1500));};

export async function preparePricePlanCandidate(input,now=Date.now()){
 // Own all data before hashing yields, including context and method notes.
 const owned=structuredClone(input);
 exact(owned,['edition','card','packet','body','method_note']);
 const {edition,card,packet,method_note:note}=owned;
 exact(note,['name','derivation','assumptions','limitations','source_use_scope']);
 if(note.source_use_scope!=='PRIVATE_RESEARCH_ONLY')fail('PRICE_PREPARATION_USE_SCOPE');
 text(note.name,200);text(note.derivation,6000);list(note.assumptions);list(note.limitations);
 validateAnalysisPacket(packet);
 if(!object(card)||!object(edition)||packet.symbol!==card.symbol||packet.company!==card.company
  ||compareTime(packet.cutoff,edition.evidence_cutoff)!==0||owned.body?.method!==note.name)fail('PRICE_PREPARATION_BINDING');
 for(const s of packet.evidence){
  if(compareTime(s.available_at,packet.cutoff)>0
   ||s.published_at!==null&&compareTime(s.published_at,s.available_at)>0
   ||s.first_seen_at!==undefined&&compareTime(s.first_seen_at,s.available_at)>0
   ||s.as_of!==undefined&&compareTime(s.as_of,s.available_at)>0)fail('PRICE_PREPARATION_SOURCE_TIME');
 }
 const body=validateDailyAiPricePlanBody(owned.body,{edition,card,evidence:packet.evidence},now);
 // V1 body contains only primitives/primitive arrays. Sorted top-level keys
 // therefore produce the same preimage as the existing recursive snapshotHash.
 const bodyText=JSON.stringify(Object.fromEntries(Object.keys(body).sort().map(k=>[k,body[k]])));
 const [planHash,packetHash,cardHash,methodNoteHash]=await Promise.all([
  snapshotHash(body),snapshotHash(packet),snapshotHash(card),snapshotHash(note)
 ]);
 return Object.freeze({schema:'PRIVATE_PRICE_PLAN_PREPARATION_V1',status:'STRUCTURE_CHECKED_INDEPENDENT_REVIEW_REQUIRED',
  prepared_at:new Date(now).toISOString(),edition_id:edition.id,symbol:card.symbol,horizon:card.horizon,
  body_text:bodyText,plan_hash:planHash,packet_hash:packetHash,card_hash:cardHash,method_note_hash:methodNoteHash,
  method_note:Object.freeze({...note,assumptions:Object.freeze([...note.assumptions]),limitations:Object.freeze([...note.limitations])}),
  review:null,source_use_scope:'PRIVATE_RESEARCH_ONLY',
  limitations:Object.freeze(['Prices are supplied inputs, not computed or endorsed by this preparer.',
   'The legacy body status VERIFIED is a storage schema label, not an independent review result.',
   'Packet and document hashes bind supplied content; they do not prove issuer truth, source-use rights or qualified reviewer identity.',
   'An existing edition approval never approves this price plan. Source, method, quality, timing and Owner approval remain separate.']),
  authorizes_publication:false,authorizes_billing:false,member_published:false,production_writes:0,model_calls:0});
}
