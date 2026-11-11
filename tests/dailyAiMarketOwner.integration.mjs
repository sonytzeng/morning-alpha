// Real candidate SQL + real TypeScript readers in disposable PGlite.
// All issuers/documents/rights are SYNTHETIC; no provider/production/browser use.
import assert from 'node:assert/strict';
import console from 'node:console';
const {AbortController,structuredClone}=globalThis;
import {createMarketOwnerFixture} from './helpers/dailyAiMarketOwnerFixture.mjs';
import {parseOwnerMarketCatalog,parseOwnerMarketPage,parseOwnerMarketInput,parseOwnerMarketReferences,prepareOwnerMarketSubmission,
 createOwnerMarketCommand,parseOwnerMarketMutationReceipt,parseOwnerMarketCommandReceipt,ownerMarketReady,ownerMarketPublished} from '../src/features/vnext/dailyAiMarketOwner.ts';
import {createDailyAiMarketPageRequestV2,parseDailyAiMarketPageV2,cacheDailyAiMarketPageV2} from '../src/features/vnext/dailyAiMarketPageV2.ts';
const f=await createMarketOwnerFixture();let phase=0;const pass=label=>console.log(JSON.stringify({phase:++phase,result:'PASS',label}));
const catalog=()=>f.call('get_daily_ai_owner_market_catalog_v2',{p_before:null,p_limit:20});
async function ownerPage(start=0){const raw=await f.call('get_daily_ai_owner_market_page_v2',{p_edition_id:f.editionId,p_offset:start,p_limit:30});return{raw,parsed:await parseOwnerMarketPage(raw,f.scope(),{edition_id:f.editionId,start,limit:30})};}
async function submit(body){const command=await createOwnerMarketCommand(f.scope(),'REVIEW',f.editionId,body);const raw=await f.call('submit_daily_ai_owner_market_review_v2',{p_edition_id:f.editionId,p_request_key:command.request_key,p_submission:body});return{command,raw,receipt:await parseOwnerMarketMutationReceipt(raw,f.scope(),command)};}
async function member(id,tier,cache=null){await f.identity(id);const scope={identity:id,tier,generation:1,signal:new AbortController().signal,requestDate:new Date(Date.now()+8*3600000).toISOString().slice(0,10)},query={horizon:'MEDIUM',market:'ALL',status:'ALL',search:'',sort:'STATUS_MARKET_SYMBOL_ASC',page_size:60};
 const request=await createDailyAiMarketPageRequestV2(scope,query,cache?{cache}:{}),raw=await f.call('get_daily_ai_member_market_page_v2',{p_request:request}),parsed=await parseDailyAiMarketPageV2(raw,scope,request,cache);
 return {raw,parsed,scope,request,cache:cacheDailyAiMarketPageV2(parsed,scope,request)};}
try{
 for(const id of [f.premium,f.free]){await f.identity(id);await assert.rejects(catalog(),/OWNER_REQUIRED/);await assert.rejects(()=>f.call('submit_daily_ai_owner_market_review_v2',{p_edition_id:f.editionId,p_request_key:f.randomUUID(),p_submission:f.submission()}),/OWNER_REQUIRED/);}
 for(const role of ['anon','service_role']){await f.identity(null,role);await assert.rejects(catalog(),/permission denied/);}
 await f.identity(f.owner);assert.equal(parseOwnerMarketCatalog(await catalog(),f.scope()).editions[0].id,f.editionId);
 await f.db.exec('reset role');await f.db.query('update auth.users set is_anonymous=true where id=$1',[f.owner]);await f.identity(f.owner);await assert.rejects(catalog(),/OWNER_REQUIRED/);
 await f.db.exec('reset role');await f.db.query('update auth.users set is_anonymous=false where id=$1',[f.owner]);await f.identity(f.owner);
 pass('private edition discovery requires identity, effective owner access and Owner role; anonymous/stale/service callers denied');

 const first=await ownerPage(),second=await ownerPage(30),third=await ownerPage(60);assert.equal(first.parsed.total,72);assert.equal(first.parsed.cards.length,30);assert.equal(second.parsed.cards.length,30);assert.equal(third.parsed.cards.length,12);
 assert.equal(new Set([...first.parsed.cards,...second.parsed.cards,...third.parsed.cards].map(c=>c.market+':'+c.symbol+':'+c.horizon)).size,72);
 assert.equal(first.parsed.coverage.reduce((n,m)=>n+m.analysed_count,0),24);assert.equal(first.parsed.rights_ready,false);assert.equal(first.parsed.review,null);
 const rawInput=await f.call('get_daily_ai_owner_market_input_v2',{p_edition_id:f.editionId,p_security_id:f.issuer}),input=await parseOwnerMarketInput(rawInput,f.scope(),second.parsed,f.issuer);
 const rawRefs=await f.call('get_daily_ai_owner_market_references_v2',{p_plan_hash:f.plan.plan_hash,p_security_id:f.issuer}),references=await parseOwnerMarketReferences(rawRefs,f.scope(),second.parsed,input);
 assert.equal(references[0].summary.median,120);assert.equal(references[0].sources.length,6);assert.equal(references[0].summary.methodology_approved,false);
 const corrupt=structuredClone(rawInput);corrupt.packet_text=corrupt.packet_text.replace('SYNTHETIC','FORGED');await assert.rejects(parseOwnerMarketInput(corrupt,f.scope(),second.parsed,f.issuer),/INPUT_HASH/);
 const changed=structuredClone(rawRefs);changed.references[0].reference.price_scenarios[1]=121;await assert.rejects(parseOwnerMarketReferences(changed,f.scope(),second.parsed,input),/REFERENCE_HASH/);
 const before=await member(f.premium,'premium');assert.equal(before.parsed.edition,null);await f.identity(f.owner);
 pass('72 private cards page as 30/30/12; single-stock raw input and full reference hashes verified; unpublished member stays empty');

 const body=prepareOwnerMarketSubmission(f.submission(),f.editionId);
 for(const change of [v=>v.documents[0].status=null,v=>v.documents[0].document_url='javascript:alert(1)',v=>v.documents[0].notes='',v=>v.documents[3].kind='QUALITY',v=>v.reviewer_ref='IMPERSONATED_OWNER']){
  const invalid=structuredClone(body);change(invalid);await assert.rejects(()=>f.call('submit_daily_ai_owner_market_review_v2',{p_edition_id:f.editionId,p_request_key:f.randomUUID(),p_submission:invalid}),/MARKET_OWNER_REVIEW_/);
 }
 const pending=await submit(body);assert.equal(pending.receipt.member_published,false);const replay=await f.call('submit_daily_ai_owner_market_review_v2',{p_edition_id:f.editionId,p_request_key:pending.command.request_key,p_submission:body});assert.equal(replay.replayed,true);assert.equal(replay.review_id,pending.receipt.review_id);
 const revised={...body,reason:'SYNTHETIC changed request must not reuse a persisted identifier.'};await assert.rejects(()=>f.call('submit_daily_ai_owner_market_review_v2',{p_edition_id:f.editionId,p_request_key:pending.command.request_key,p_submission:revised}),/REPLAY_CONFLICT/);
 const after=(await ownerPage()).parsed;assert.equal(after.review.reviewer_ref,'OWNER:'+f.owner);assert.deepEqual(Object.values(after.review.statuses),Array(4).fill('PENDING'));assert.equal(after.review.documents.length,4);assert.equal(ownerMarketReady(after),false);
 await assert.rejects(()=>f.call('review_daily_ai_market_edition_v2',{p_edition_id:f.editionId,p_review_id:after.review.id,p_action:'APPROVE',p_audience:'premium',p_request_key:f.randomUUID()}),/MARKET_PUBLICATION_NOT_READY/);
 pass('manual decisions/URLs/notes required; server binds reviewer, hashes all four documents and replays only the exact request');

 const unknown=await createOwnerMarketCommand(f.scope(),'REVIEW',f.editionId,body),notRecorded=await f.call('get_daily_ai_owner_market_command_v2',{p_request_key:unknown.request_key});assert.equal((await parseOwnerMarketCommandReceipt(notRecorded,f.scope(),unknown)).state,'NOT_RECORDED');
 const saved=await f.call('get_daily_ai_owner_market_command_v2',{p_request_key:pending.command.request_key});assert.equal((await parseOwnerMarketCommandReceipt(saved,f.scope(),pending.command)).state,'RECORDED');
 const wrongIntent={...pending.command,request_hash:'f'.repeat(64)};await assert.rejects(parseOwnerMarketCommandReceipt(saved,f.scope(),wrongIntent),/RECEIPT_SCOPE/);
 const allPass=await submit(prepareOwnerMarketSubmission(f.submission({QUALITY:'PASS',TIME:'PASS',SOURCE_USE:'PASS',METHODOLOGY:'PASS'}),f.editionId));
 const noRights=(await ownerPage()).parsed;assert.equal(noRights.rights_ready,false);assert.equal(noRights.source_use.approved,0);assert.equal(ownerMarketReady(noRights),false);
 await assert.rejects(()=>f.call('review_daily_ai_market_edition_v2',{p_edition_id:f.editionId,p_review_id:allPass.receipt.review_id,p_action:'APPROVE',p_audience:'free',p_request_key:f.randomUUID()}),/MARKET_PUBLICATION_NOT_READY/);
 pass('unknown acknowledgement is reconciled read-only; four PASS does not fabricate source licenses or member publication');

 await f.grantSyntheticRights();const ready=(await ownerPage()).parsed;assert.equal(ownerMarketReady(ready),true);assert.equal(ownerMarketPublished(ready),false);
 const pubBody={edition_id:f.editionId,review_id:ready.review.id,action:'APPROVE',audience:'free'},pubCommand=await createOwnerMarketCommand(f.scope(),'APPROVE',f.editionId,pubBody);
 const pub=await f.call('review_daily_ai_market_edition_v2',{p_edition_id:f.editionId,p_review_id:ready.review.id,p_action:'APPROVE',p_audience:'free',p_request_key:pubCommand.request_key});await parseOwnerMarketMutationReceipt(pub,f.scope(),pubCommand);
 assert.equal(ownerMarketPublished((await ownerPage()).parsed),true);const pubSaved=await f.call('get_daily_ai_owner_market_command_v2',{p_request_key:pubCommand.request_key});assert.equal((await parseOwnerMarketCommandReceipt(pubSaved,f.scope(),pubCommand)).kind,'APPROVE');
 const paid=await member(f.premium,'premium');assert.equal(paid.parsed.cards.length,24);assert.equal(paid.parsed.cards.find(c=>c.symbol==='1000').research_reference.median,120);
 const free=await member(f.free,'free');assert.equal(free.parsed.cards.length,3);assert(free.parsed.cards.every(c=>c.research_reference===null&&c.sources===null));
 pass('separate Owner approval plus live rights exposes hash-bound reference to paid members; fixed free summaries strip it');

 await f.identity(f.owner);const newest=await submit(prepareOwnerMarketSubmission(f.submission({QUALITY:'FAIL',TIME:'PASS',SOURCE_USE:'PASS',METHODOLOGY:'PASS'}),f.editionId));
 assert.equal((await member(f.premium,'premium')).parsed.edition,null);await f.identity(f.owner);
 await assert.rejects(()=>f.call('review_daily_ai_market_edition_v2',{p_edition_id:f.editionId,p_review_id:ready.review.id,p_action:'APPROVE',p_audience:'free',p_request_key:f.randomUUID()}),/MARKET_REVIEW_SUPERSEDED/);
 const revoked=await f.call('review_daily_ai_market_edition_v2',{p_edition_id:f.editionId,p_review_id:newest.receipt.review_id,p_action:'REVOKE',p_audience:'free',p_request_key:f.randomUUID()});assert.equal(revoked.action,'REVOKE');assert.equal((await member(f.premium,'premium')).parsed.edition,null);
 await f.identity(f.owner);const final=await submit(prepareOwnerMarketSubmission({...f.submission({QUALITY:'PASS',TIME:'PASS',SOURCE_USE:'PASS',METHODOLOGY:'PASS'}),reason:'SYNTHETIC new review only to verify the explicit feature rollback.'},f.editionId));
 await f.call('review_daily_ai_market_edition_v2',{p_edition_id:f.editionId,p_review_id:final.receipt.review_id,p_action:'APPROVE',p_audience:'free',p_request_key:f.randomUUID()});
 pass('new FAIL supersedes old approval; stale review cannot publish; explicit revoke hides member edition');

 const cached=await member(f.premium,'premium');await f.db.exec('reset role');const counts=()=>f.db.query(`select(select count(*)from vnext_market.captures)captures,(select count(*)from vnext_market.price_input_pools)pools,(select count(*)from vnext_market.price_references)refs,(select count(*)from vnext_market.stock_results)stocks,(select count(*)from vnext_market.cards)cards,(select count(*)from vnext_market.reviews)reviews,(select count(*)from vnext_market.publication_events)publications`);
 const beforeRollback=(await counts()).rows[0];await f.executeFile('daily-ai-market-references.rollback.sql');assert.deepEqual((await counts()).rows[0],beforeRollback);
 await f.identity(f.premium);const rollbackRequest=await createDailyAiMarketPageRequestV2(cached.scope,cached.request.query,{cache:cached.cache}),rawAfter=await f.call('get_daily_ai_member_market_page_v2',{p_request:rollbackRequest});
 assert.equal(rawAfter.mode,'FULL');const parsedAfter=await parseDailyAiMarketPageV2(rawAfter,cached.scope,rollbackRequest,cached.cache);assert(parsedAfter.cards.every(c=>c.research_reference===null));
 const freeAfter=await member(f.free,'free');assert(freeAfter.parsed.cards.every(c=>c.research_reference===null));
 await f.identity(null,'service_role');await assert.rejects(()=>f.call(f.preparedPool.rpc,f.preparedPool.args),/permission denied/);
 await f.identity(f.owner);await assert.rejects(()=>f.call('get_daily_ai_owner_market_references_v2',{p_plan_hash:f.plan.plan_hash,p_security_id:f.issuer}),/permission denied/);
 pass('reference rollback preserves all immutable records; forces cached FULL without references; extra stage/read grants removed');
 await f.db.exec('reset role');await f.executeFile('daily-ai-market-owner-review.rollback.sql');await f.executeFile('daily-ai-market-v2.rollback.sql');assert.deepEqual((await counts()).rows[0],beforeRollback);
 await f.identity(f.owner);await assert.rejects(catalog(),/AI_MARKET_OWNER_DISABLED/);
 await assert.rejects(()=>f.call('submit_daily_ai_owner_market_review_v2',{p_edition_id:f.editionId,p_request_key:f.randomUUID(),p_submission:body}),/permission denied/);
 const retained=await f.call('get_daily_ai_owner_market_command_v2',{p_request_key:pending.command.request_key});assert.equal((await parseOwnerMarketCommandReceipt(retained,f.scope(),pending.command)).state,'RECORDED');
 await f.identity(f.premium);await assert.rejects(()=>f.call('get_daily_ai_member_market_page_v2',{p_request:rollbackRequest}),/AI_MARKET_PAGE_V2_DISABLED/);
 await f.identity(null,'service_role');await assert.rejects(()=>f.call('claim_daily_ai_market_shard_v2',{p_plan_hash:f.plan.plan_hash,p_worker_ref:'SYNTHETIC_DISABLED',p_request_key:f.randomUUID()}),/permission denied/);
 await f.db.exec('reset role');const rls=(await f.db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='vnext_market.owner_review_requests'::regclass")).rows[0];assert.deepEqual(rls,{relrowsecurity:true,relforcerowsecurity:true});
 pass('whole V2 rollback stops stage/publication, keeps private RLS and data, signals explicit V1 fallback, and preserves pending-command readback');
 console.log(JSON.stringify({result:'PASS',phases:phase,synthetic:true,stocks:24,cards:72,external_calls:0,browser_acceptance:false}));
}finally{await f.close();}
