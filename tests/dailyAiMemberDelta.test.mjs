import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {DailyAiMemberDeltaError,eligibleDailyAiMemberCache,dailyAiMemberKnownArgs,parseDailyAiMemberDelta} from '../src/features/vnext/dailyAiMemberDelta.ts';

const now=Date.parse('2026-10-31T10:00:00Z');
const scope=(tier='premium')=>({identity:'verified-user-A',generation:1,signal:new AbortController().signal,tier,requestDate:'2026-10-31'});
const payload=(tier='premium')=>({schema:'VNEXT_AI_MEMBER_EDITION_V1',tier,business_date:'2026-10-31',research_only:true,
 edition:{id:'a'.repeat(64),edition_date:'2026-10-31',data_through:'2026-10-30',evidence_cutoff:'2026-10-31T08:00:00Z',
  prepared_at:'2026-10-31T08:05:00Z',expires_at:'2026-11-01T00:00:00Z',mode:'AS_OF_RESEARCH',forecast:false,performance_available:false},
 cards:Array.from({length:tier==='free'?3:72},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),company:'合成測試公司',
  horizon,status:'WAIT',reason:{text:'合成判斷',evidence_ids:['source-1']},confirmation:'等待證據',invalidation:'條件不符即重評',gaps:[],classification:'INFERENCE',
  ...(tier==='free'?{}:{counter_evidence:[],sources:[{id:'source-1',source:'https://www.twse.com.tw/synthetic',kind:'PRICE',
   published_at:'2026-10-30T06:00:00Z',available_at:'2026-10-30T06:00:00Z',time_basis:'PUBLISHED',first_seen_at:null,as_of:null,evidence_hash:null}]})}))).flat()});
const full=(p,s)=>({schema:'VNEXT_AI_MEMBER_DELTA_V1',mode:'FULL',user_id:s.identity,tier:p.tier,business_date:p.business_date,research_only:true,edition:p.edition,payload:p});
const unchanged=(cache)=>({schema:'VNEXT_AI_MEMBER_DELTA_V1',mode:'UNCHANGED',user_id:cache.scope.identity,tier:cache.data.tier,
 business_date:cache.data.business_date,research_only:true,edition:structuredClone(cache.data.edition)});
const cached=(s=scope())=>({scope:s,data:parseDailyAiMember(payload(s.tier),s.requestDate,now)});
const code=expected=>error=>error instanceof DailyAiMemberDeltaError&&error.code===expected;

test('FULL parses every server tier through the existing complete member contract',()=>{
 for(const tier of ['free','premium','owner']){
  const s=scope(tier),p=payload(tier);p.raw_private_provider_receipt='not-member-data';
  const data=parseDailyAiMemberDelta(full(p,s),s,null,now);
  assert.equal(data.cards.length,tier==='free'?9:216);assert.equal(data.tier,tier);
  assert(!JSON.stringify(data).includes('not-member-data'));
 }
});
test('UNCHANGED uses exactly the validated RAM projection and preserves its original expiry',()=>{
 const c=cached(),before=structuredClone(c.data);
 assert.deepEqual(dailyAiMemberKnownArgs(c,c.scope,now),{p_known_edition_id:'a'.repeat(64),p_known_tier:'premium'});
 assert.equal(parseDailyAiMemberDelta(unchanged(c),c.scope,c,now),c.data);
 assert.deepEqual(c.data,before);assert.equal(c.data.edition.expires_at,'2026-11-01T00:00:00Z');
});
test('FULL withdrawal replaces an existing cache with the original empty-edition response',()=>{
 const c=cached(),p={...payload(),edition:null,cards:[]};
 const data=parseDailyAiMemberDelta(full(p,c.scope),c.scope,c,now);
 assert.equal(data.edition,null);assert.equal(data.cards.length,0);
 assert.deepEqual(dailyAiMemberKnownArgs({scope:c.scope,data},c.scope,now),{p_known_edition_id:null,p_known_tier:null});
});
test('no RAM or a changed Auth generation, signal, identity, tier or Taipei day cannot supply known hints',()=>{
 const c=cached();
 const changed=[{...c.scope,generation:2},{...c.scope,signal:new AbortController().signal},{...c.scope,identity:'user-B'},
  {...c.scope,tier:'free'},{...c.scope,requestDate:'2026-11-01'}];
 assert.deepEqual(dailyAiMemberKnownArgs(null,c.scope,now),{p_known_edition_id:null,p_known_tier:null});
 assert.throws(()=>parseDailyAiMemberDelta(unchanged(c),c.scope,null,now),code('CACHE_MISS'));
 for(const s of changed){
  assert.equal(eligibleDailyAiMemberCache(c,s,now),false);
  assert.deepEqual(dailyAiMemberKnownArgs(c,s,now),{p_known_edition_id:null,p_known_tier:null});
  assert.throws(()=>parseDailyAiMemberDelta(unchanged(c),s,c,now));
 }
});
test('expiry cannot be extended by UNCHANGED metadata or by a fresh response receipt',()=>{
 const c=cached(),expired=Date.parse(c.data.edition.expires_at),extended=unchanged(c);extended.edition.expires_at='2027-01-01T00:00:00Z';
 assert.equal(eligibleDailyAiMemberCache(c,c.scope,expired),false);
 assert.deepEqual(dailyAiMemberKnownArgs(c,c.scope,expired),{p_known_edition_id:null,p_known_tier:null});
 assert.throws(()=>parseDailyAiMemberDelta(unchanged(c),c.scope,c,expired),code('CACHE_MISS'));
 assert.throws(()=>parseDailyAiMemberDelta(extended,c.scope,c,now),code('CACHE_MISS'));
 assert.throws(()=>parseDailyAiMemberDelta(full(payload(),c.scope),c.scope,c,expired),/AI_MEMBER_CHRONOLOGY/);
});
test('UNCHANGED rejects altered edition metadata, extra cards/payload, unknown fields and malformed envelope',()=>{
 const c=cached();
 for(const mutate of [r=>r.edition.id='b'.repeat(64),r=>r.edition.prepared_at='2026-10-31T09:00:00Z',r=>r.edition.mode='FORWARD',
  r=>r.edition.extra='unreviewed',r=>r.cards=[],r=>r.payload=c.data,r=>r.source_use_granted=true,r=>r.research_only=false,
  r=>r.schema='UNKNOWN',r=>r.business_date='2026-10-30',r=>r.edition=null]){
  const r=unchanged(c);mutate(r);assert.throws(()=>parseDailyAiMemberDelta(r,c.scope,c,now),code('CACHE_MISS'));
 }
});
test('server user/tier mismatch and an aborted Auth scope fail as hard scope errors',()=>{
 const c=cached();
 for(const mutate of [r=>r.user_id='user-B',r=>r.tier='owner']){
  const r=unchanged(c);mutate(r);assert.throws(()=>parseDailyAiMemberDelta(r,c.scope,c,now),code('SCOPE'));
 }
 const controller=new AbortController(),s={...c.scope,signal:controller.signal};controller.abort();
 assert.throws(()=>parseDailyAiMemberDelta(full(payload(),s),s,null,now),code('SCOPE'));
});
test('FULL envelope metadata must exactly match its independently parsed complete projection',()=>{
 const s=scope();
 for(const mutate of [r=>r.edition={...r.edition,prepared_at:'2026-10-31T09:00:00Z'},r=>r.business_date='2026-10-30',r=>r.research_only=false,
  r=>r.mode='UNKNOWN',r=>r.cards=[],r=>r.schema='UNKNOWN']){
  const r=full(payload(),s);mutate(r);assert.throws(()=>parseDailyAiMemberDelta(r,s,null,now),code('CONTRACT'));
 }
 const p=payload('owner'),r=full(p,s);r.tier='premium';assert.throws(()=>parseDailyAiMemberDelta(r,s,null,now),code('SCOPE'));
});
