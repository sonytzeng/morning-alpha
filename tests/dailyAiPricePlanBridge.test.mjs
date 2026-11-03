// Independent bridge: actual disposable PostgreSQL writes/Owner actions/getter
// output reach the real TS consumer. All values and identities are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createPricePlanFixture} from './helpers/dailyAiPricePlansFixture.mjs';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {parseDailyAiMemberPricePlans,hashDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';

test('actual SQL hash commitment, uncited packet sources, approval and revocation bridge to the strict TS consumer',
 {skip:!process.env.MA_PGLITE_MODULE},async()=>{
 const f=await createPricePlanFixture(),{db}=f;
 const role=async name=>db.exec('reset role;set role '+name);
 const clock=async()=>(await db.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`)).rows[0].at;
 try{
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../research/daily-ai-price-plans.candidate.sql',import.meta.url),'utf8'));
  await f.identity('owner');await f.approveEdition('premium');
  const refs=f.sourceIds('1000');
  const body={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:f.editionId,symbol:'1000',horizon:'LONG',status:'VERIFIED',currency:'TWD',
   method:'SYNTHETIC_BRIDGE_METHOD_V1',basis:'合成價格方法；引號「測試」與換行\n僅驗證原件承諾，無真實交易結論。',
   entry_range:[100.1,105.25],wait_above:105.25,stop_kind:'EVENT',stop:null,
   stop_evidence_ids:[refs.event],invalidation:'合成事件停止條件，資料假設失效時重評。',
   evidence_ids:[refs.uncitedPrice,refs.event],as_of:await clock(),expires_at:f.expiry,buy_ready:false};
  const text=JSON.stringify(Object.fromEntries(Object.keys(body).sort().map(key=>[key,body[key]])));
  const hash=await snapshotHash(body);
  assert.equal(createHash('sha256').update(text).digest('hex'),hash);
  const postgresJsonbHash=(await db.query(`select encode(sha256(convert_to(($1::jsonb)::text,'UTF8')),'hex') hash`,[text])).rows[0].hash;
  assert.notEqual(postgresJsonbHash,hash,'PostgreSQL jsonb::text must not masquerade as the JavaScript canonical hash.');
  await role('service_role');
  await assert.rejects(()=>db.query('select public.stage_daily_ai_price_plan_v1($1,$2)',[text,postgresJsonbHash]),/AI_PRICE_PLAN_HASH/);
  const staged=(await db.query('select public.stage_daily_ai_price_plan_v1($1,$2) r',[text,hash])).rows[0].r;
  assert.equal(staged.plan_hash,hash);assert.equal(staged.member_published,false);
  const reviewId=(await db.query(`insert into vnext_private.ai_price_plan_reviews_v1(
   plan_hash,reviewer_ref,quality,time_status,source_use,methodology,document_hash,source_document_hash,
   method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
   values($1,'independent-synthetic-bridge-reviewer','PASS','PASS','PASS','PASS',$2,$3,$4,$5,
    'Independent synthetic bridge review of quality, method, source use and chronology.',$6,$7) returning id`,
   [hash,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),'d'.repeat(64),await clock(),f.expiry])).rows[0].id;
  await f.identity('premium');
  await assert.rejects(()=>db.query('select public.review_daily_ai_price_plan_v1($1,$2,$3,$4)',[hash,reviewId,'APPROVE',randomUUID()]),/OWNER_REQUIRED/);
  await f.identity('owner');
  await db.query('select public.review_daily_ai_price_plan_v1($1,$2,$3,$4)',[hash,reviewId,'APPROVE',randomUUID()]);
  await f.identity('premium');
  const member=parseDailyAiMember(await f.readMember());
  const envelope=(await db.query('select public.get_daily_ai_member_price_plans_v1($1) r',[f.editionId])).rows[0].r;
  const rawCard=member.cards.find(card=>card.symbol==='1000'&&card.horizon==='LONG');
  assert(!rawCard.sources.some(source=>source.id===refs.uncitedPrice),'The model prose did not cite the price-plan-only source.');
  assert.equal(envelope.plans.length,1);assert.equal(envelope.source_sets.length,1);
  assert.deepEqual(new Set(envelope.source_sets[0].sources.map(source=>source.id)),new Set(body.evidence_ids));
  assert(envelope.source_sets[0].sources.every(source=>!Object.hasOwn(source,'content')));
  const plans=await parseDailyAiMemberPricePlans(envelope,member,Date.now()+1,f.MEMBER);
  assert.equal(plans.plans[0].plan_hash,hash);assert.equal(await hashDailyAiPricePlanBody(plans.plans[0]),hash);
  assert.equal(plans.plans[0].basis,body.basis);assert.equal(plans.plans[0].stop,null);assert.equal(plans.plans[0].buy_ready,false);
  assert.deepEqual(plans.plans[0].entry_range,body.entry_range);
  await assert.rejects(()=>parseDailyAiMemberPricePlans(envelope,member,Date.now()+1,f.OWNER),/AI_PRICE_PLAN_MEMBER_SCOPE/);
  const altered=structuredClone(envelope);altered.source_sets[0].sources.find(source=>source.id===refs.uncitedPrice).available_at='2099-01-01T00:00:00Z';
  await assert.rejects(()=>parseDailyAiMemberPricePlans(altered,member,Date.now()+1,f.MEMBER),/AI_PRICE_PLAN_MEMBER_SOURCE/);
  await f.identity('owner');
  await db.query('select public.review_daily_ai_price_plan_v1($1,$2,$3,$4)',[hash,reviewId,'REVOKE',randomUUID()]);
  await f.identity('premium');
  const revoked=(await db.query('select public.get_daily_ai_member_price_plans_v1($1) r',[f.editionId])).rows[0].r;
  assert.deepEqual(revoked.plans,[]);assert.deepEqual(revoked.source_sets,[]);
  assert.deepEqual((await parseDailyAiMemberPricePlans(revoked,parseDailyAiMember(await f.readMember()),Date.now()+1,f.MEMBER)).plans,[]);
 }finally{await f.close();}
});
