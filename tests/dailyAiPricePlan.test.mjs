import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {dailyAiPricePlanBody,hashDailyAiPricePlanBody,verifyDailyAiPricePlan,readDailyAiPricePlan,
 parseDailyAiMemberPricePlans,dailyAiPricePlanForCard} from '../src/features/vnext/dailyAiPricePlan.ts';

const now=Date.parse('2026-11-01T10:00:00Z'),subject='00000000-0000-0000-0000-000000000001';
const anotherSubject='00000000-0000-0000-0000-000000000002';
async function fixture(overrides={}){
 const edition={id:'a'.repeat(64),evidence_cutoff:'2026-10-31T09:00:00Z',prepared_at:'2026-10-31T10:00:00Z',expires_at:'2026-11-02T05:30:00Z',
  edition_date:'2026-10-31',data_through:'2026-10-30',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false};
 const evidence=[{id:'P1',kind:'PRICE',available_at:'2026-10-31T08:00:00Z'},
  {id:'F1',kind:'FINANCIAL',available_at:'2026-10-31T08:00:00Z'},
  {id:'N1',kind:'NEWS',available_at:'2026-10-31T08:00:00Z'}];
 const card={symbol:'2330',horizon:'LONG',status:'WAIT',company:'合成測試公司',classification:'INFERENCE',reason:{text:'測試研究',evidence_ids:['P1']},
  counter_evidence:[],confirmation:'等待新資料確認',invalidation:'基本假設失效時重評',gaps:[],sources:evidence.map(e=>({...e,source:'https://www.twse.com.tw/',published_at:'2026-10-31T07:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}))};
 const body={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:edition.id,symbol:card.symbol,horizon:card.horizon,status:'VERIFIED',currency:'TWD',
  method:'SYNTHETIC_TEST_METHOD_V1',basis:'僅測試獨立計畫綁定，不是真實股票價位',entry_range:[100,105],wait_above:105,
  stop_kind:'PRICE',stop:95,stop_evidence_ids:['P1'],invalidation:'僅為合成停止條件',evidence_ids:['P1','F1'],
  as_of:'2026-10-31T10:00:00Z',expires_at:edition.expires_at,buy_ready:false,...overrides};
 const hash=await snapshotHash(body),plan={...body,plan_hash:hash,review:{status:'PASS',plan_hash:hash,reviewed_at:'2026-10-31T11:00:00Z',document_hash:'b'.repeat(64)}};
 const research={schema:'VNEXT_AI_MEMBER_EDITION_V1',tier:'premium',business_date:'2026-11-01',research_only:true,edition,cards:[card]};
 const payload={schema:'VNEXT_AI_MEMBER_PRICE_PLANS_V1',edition_id:edition.id,tier:'premium',subject_user_id:subject,research_only:true,plans:[plan],
  source_sets:[{symbol:card.symbol,sources:card.sources.filter(source=>plan.evidence_ids.includes(source.id)).map(source=>structuredClone(source))}]};
 return {body,plan,context:{edition,card,evidence},research,payload};
}
async function rebind(plan){const hash=await hashDailyAiPricePlanBody(plan);plan.plan_hash=hash;plan.review.plan_hash=hash;}

test('legacy absence remains null and approved PRICE plans remain conditional immutable research',async()=>{
 const f=await fixture(),before=JSON.stringify(f);
 assert.equal(await verifyDailyAiPricePlan(undefined,f.context,now),null);
 assert.equal(await verifyDailyAiPricePlan(null,f.context,now),null);
 const plan=await verifyDailyAiPricePlan(f.plan,f.context,now);
 assert.deepEqual(plan,f.plan);assert.equal(plan.buy_ready,false);assert.equal(JSON.stringify(f),before);
 assert(Object.isFrozen(plan));assert(Object.isFrozen(plan.entry_range));assert(Object.isFrozen(plan.review));assert(Object.isFrozen(plan.evidence_ids));
 assert.deepEqual(dailyAiPricePlanBody(plan),f.body);assert.equal(await hashDailyAiPricePlanBody(plan),await snapshotHash(f.body));
 assert.throws(()=>{plan.entry_range[0]=1;},TypeError);
});
test('EVENT stops require a cited non-price premise and no numeric stop',async()=>{
 const valid=await fixture({stop_kind:'EVENT',stop:null,stop_evidence_ids:['F1'],invalidation:'財報證據否定研究假設時停止沿用'});
 assert.equal((await verifyDailyAiPricePlan(valid.plan,valid.context,now)).stop,null);
 for(const change of [{stop:95},{stop_evidence_ids:['P1']},{stop_evidence_ids:['N1']},{stop_kind:'OTHER'}]){
  const f=await fixture({stop_kind:'EVENT',stop:null,stop_evidence_ids:['F1'],...change});
  await assert.rejects(()=>verifyDailyAiPricePlan(f.plan,f.context,now),/AI_PRICE_PLAN_(STOP|CITATION)/);
 }
});
test('edition, symbol, horizon and research-state binding cannot be bypassed by rehashing',async()=>{
 for(const mutate of [
  f=>{f.plan.edition_id='c'.repeat(64);},f=>{f.plan.symbol='2454';},f=>{f.plan.horizon='SHORT';},
  f=>{f.context.card.status='AVOID';},f=>{f.context.card.status='INSUFFICIENT';},f=>{f.plan.buy_ready=true;},
  f=>{f.plan.status='PENDING';},f=>{f.plan.currency='USD';},
 ]){const f=await fixture();mutate(f);await rebind(f.plan);await assert.rejects(()=>verifyDailyAiPricePlan(f.plan,f.context,now),/AI_PRICE_PLAN_(IDENTITY|CONTEXT|SCOPE)/);}
});
test('invalid prices, stop positions and missing method/basis are rejected even with a matching hash',async()=>{
 for(const changes of [{entry_range:[105,100]},{entry_range:[0,105]},{entry_range:[100,Infinity]},{entry_range:[100]},
  {wait_above:104},{stop:100},{stop:-1},{stop:null},{method:' '},{basis:''},{invalidation:' '}]){
  const f=await fixture();Object.assign(f.plan,changes);
  // Non-finite values cannot form a canonical hash at all; retain the old hash
  // to assert that the price validator rejects them before hash comparison.
  try{await rebind(f.plan);}catch(error){assert.equal(error.message,'NON_CANONICAL_VALUE');}
  await assert.rejects(()=>verifyDailyAiPricePlan(f.plan,f.context,now),/AI_PRICE_PLAN_(PRICE|STOP|TEXT|HASH)/);
 }
});
test('hash tampering, unknown fields, incomplete reviews and mismatched review hashes fail closed',async()=>{
 for(const mutate of [
  f=>{f.plan.entry_range[1]=104;},f=>{f.plan.review.plan_hash='c'.repeat(64);},
  f=>{f.plan.plan_hash='not-a-hash';},f=>{f.plan.review.status='PENDING';},
  f=>{f.plan.review.document_hash='PASS';},f=>{f.plan.prompt='private';},f=>{f.plan.review.raw_provider_body='private';},
 ]){const f=await fixture();mutate(f);await assert.rejects(()=>verifyDailyAiPricePlan(f.plan,f.context,now),/AI_PRICE_PLAN_/);}
});
test('references must belong to this card and cutoff; event and stop references cannot be borrowed',async()=>{
 for(const mutate of [
  f=>{f.plan.evidence_ids=['other-symbol:P1'];},f=>{f.plan.evidence_ids=['P1','P1'];},
  f=>{f.plan.evidence_ids=['F1'];f.plan.stop_kind='EVENT';f.plan.stop=null;f.plan.stop_evidence_ids=['F1'];},
  f=>{f.plan.stop_evidence_ids=['N1'];},f=>{f.plan.stop_evidence_ids=[];},
  f=>{f.context.evidence[0].available_at='2026-10-31T09:00:00.000001Z';},
  f=>{f.context.evidence.push({...f.context.evidence[0]});},
 ]){const f=await fixture();mutate(f);await rebind(f.plan);await assert.rejects(()=>verifyDailyAiPricePlan(f.plan,f.context,now),/AI_PRICE_PLAN_(CITATION|EVIDENCE|STOP)/);}
});
test('as-of, independent review and expiry use exact chronology including microseconds',async()=>{
 for(const mutate of [
  f=>{f.plan.as_of='2026-10-31T08:59:59Z';},f=>{f.plan.as_of='2026-11-01T10:00:00.000001Z';},
  f=>{f.plan.expires_at='2026-11-01T10:00:00Z';},f=>{f.plan.expires_at='2026-11-02T05:30:00.000001Z';},
  f=>{f.plan.review.reviewed_at='2026-10-31T09:59:59Z';},f=>{f.plan.review.reviewed_at='2026-11-01T10:00:00.000001Z';},
  f=>{f.context.edition.prepared_at='2026-11-01T10:00:00.000001Z';},
 ]){const f=await fixture();mutate(f);await rebind(f.plan);await assert.rejects(()=>verifyDailyAiPricePlan(f.plan,f.context,now),/AI_PRICE_PLAN_(CHRONOLOGY|REVIEW|EDITION_EXPIRED)/);}
 const f=await fixture({expires_at:'2026-11-01T10:00:00.000001Z'});
 const plan=await verifyDailyAiPricePlan(f.plan,f.context,now);assert(plan);
 assert.equal(dailyAiPricePlanForCard({schema:'VNEXT_AI_MEMBER_PRICE_PLANS_V1',edition_id:f.context.edition.id,tier:'premium',subject_user_id:subject,research_only:true,plans:[plan]},f.context.card,f.context.edition.id,now+1),null);
});
test('verification owns inputs before asynchronous hashing and never repairs them',async()=>{
 const f=await fixture(),original=structuredClone(f.plan),operation=verifyDailyAiPricePlan(f.plan,f.context,now);
 f.plan.entry_range[0]=999;f.plan.review.status='FAIL';f.context.card.symbol='2454';
 assert.deepEqual(await operation,original);
});
test('member RPC projection binds subject, tier and edition before exposing any plan',async()=>{
 const f=await fixture(),result=await parseDailyAiMemberPricePlans(f.payload,f.research,now,subject);
 assert.equal(result.plans.length,1);assert.equal(result.subject_user_id,subject);assert.equal(result.research_only,true);assert(Object.isFrozen(result.plans));
 for(const mutate of [
  f=>{f.payload.subject_user_id=anotherSubject;},f=>{f.payload.subject_user_id='invalid';},
  f=>{f.payload.tier='owner';},f=>{f.payload.research_only=false;},f=>{f.payload.edition_id='c'.repeat(64);},
  f=>{f.payload.plans.push(structuredClone(f.plan));},f=>{f.payload.plans[0].symbol='2454';},
  f=>{f.research.cards[0].sources=null;},f=>{f.payload.extra='private';},
 ]){const changed=await fixture();mutate(changed);await assert.rejects(()=>parseDailyAiMemberPricePlans(changed.payload,changed.research,now,subject),/AI_PRICE_PLAN_/);}
});
test('Free and empty research editions accept only empty plans and cannot receive Premium prices',async()=>{
 const f=await fixture();f.research.tier='free';f.payload.tier='free';
 await assert.rejects(()=>parseDailyAiMemberPricePlans(f.payload,f.research,now,subject),/AI_PRICE_PLAN_MEMBER_SCOPE/);
 f.payload.plans=[];f.payload.source_sets=[];assert.deepEqual((await parseDailyAiMemberPricePlans(f.payload,f.research,now,subject)).plans,[]);
 f.research.edition=null;f.research.cards=[];f.payload.edition_id=null;
 assert.equal((await parseDailyAiMemberPricePlans(f.payload,f.research,now,subject)).edition_id,null);
});
test('render selection withdraws stale, wrong-account/edition or non-actionable-state plans',async()=>{
 const f=await fixture(),plans=await parseDailyAiMemberPricePlans(f.payload,f.research,now,subject),card=f.context.card,edition=f.context.edition.id;
 assert.equal(dailyAiPricePlanForCard(plans,card,edition,now,subject).buy_ready,false);
 assert.equal(dailyAiPricePlanForCard(plans,{...card,status:'WATCH'},edition,now,subject).buy_ready,false);
 assert.equal(dailyAiPricePlanForCard(plans,card,edition,now,anotherSubject),null);
 assert.equal(dailyAiPricePlanForCard(plans,card,'c'.repeat(64),now,subject),null);
 assert.equal(dailyAiPricePlanForCard(plans,{...card,status:'AVOID'},edition,now,subject),null);
 assert.equal(dailyAiPricePlanForCard(plans,card,edition,Date.parse(f.plan.expires_at),subject),null);
 assert.equal(dailyAiPricePlanForCard(null,card,edition,now,subject),null);
});
test('optional display route drops invalid raw values while strict ingestion rejects them',async()=>{
 const f=await fixture();f.plan.entry_range[0]=999;
 assert.equal(await readDailyAiPricePlan(f.plan,f.context,now),null);
 await assert.rejects(()=>verifyDailyAiPricePlan(f.plan,f.context,now),/AI_PRICE_PLAN_/);
 await assert.rejects(()=>verifyDailyAiPricePlan(undefined,f.context,NaN),/AI_PRICE_PLAN_NOW/);
});

test('price references may use an original-packet source omitted from the AI claim projection',async()=>{
 const f=await fixture(),additional={...f.research.cards[0].sources[0],id:'P2'};
 f.plan.evidence_ids.push('P2');await rebind(f.plan);f.payload.source_sets[0].sources.push(additional);
 assert(!f.research.cards[0].sources.some(source=>source.id==='P2'));
 const parsed=await parseDailyAiMemberPricePlans(f.payload,f.research,now,subject);
 assert.equal(parsed.plans.length,1);assert.equal(parsed.source_sets[0].sources.length,3);
 assert(Object.isFrozen(parsed.source_sets[0].sources[0]));
});
test('source sidecar rejects metadata drift, orphan/excess data, wrong identities and incomplete receipt basis',async()=>{
 for(const mutate of [
  f=>{f.payload.source_sets[0].sources[0].source='https://www.tpex.org.tw/';},
  f=>{f.payload.source_sets[0].sources[0].available_at='2026-10-31T09:00:00.000001Z';},
  f=>{f.payload.source_sets[0].sources[0].evidence_hash='c'.repeat(64);},
  f=>{f.payload.source_sets[0].sources.push({...f.payload.source_sets[0].sources[0],id:'unused'});},
  f=>{f.payload.source_sets[0].symbol='2454';},
  f=>{f.payload.source_sets[0].sources[0].content='unapproved raw body';},
  f=>{f.payload.source_sets[0].sources[0].published_at=null;f.payload.source_sets[0].sources[0].time_basis='OBSERVED_AFTER_RECEIPT';},
  f=>{f.payload.source_sets.push(structuredClone(f.payload.source_sets[0]));},
 ]){const f=await fixture();mutate(f);await assert.rejects(()=>parseDailyAiMemberPricePlans(f.payload,f.research,now,subject),/AI_PRICE_PLAN_/);}
 const equivalent=await fixture();equivalent.payload.source_sets[0].sources[0].available_at='2026-10-31T16:00:00.000000+08:00';
 assert.equal((await parseDailyAiMemberPricePlans(equivalent.payload,equivalent.research,now,subject)).plans.length,1);
});
