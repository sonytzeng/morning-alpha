// All DB roles, issuers, sources, rights, reviews and Owner approvals are
// SYNTHETIC fixtures. A fresh in-memory PostgreSQL is the ONLY database used.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createPricePlanFixture} from './helpers/dailyAiPricePlansFixture.mjs';
import {preparePricePlanCandidate} from '../research/prepare-price-plan-candidate.mjs';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {parseDailyAiMemberPricePlans,hashDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';
import {parseDailyAiOwnerPricePlans} from '../src/features/vnext/dailyAiOwnerPricePlans.ts';
import {DAILY_AI_PRICE_PRECISION_PENDING} from '../src/features/vnext/dailyAiPriceDisplay.ts';
import {renderPriceDelivery,renderOwnerPriceDelivery} from './priceDeliveryUiHarness.mjs';

if(!process.env.MA_PGLITE_MODULE||!isAbsolute(process.env.MA_PGLITE_MODULE)||!realpathSync(process.env.MA_PGLITE_MODULE).endsWith('/@electric-sql/pglite/dist/index.js'))throw Error('EXISTING_LOCAL_PGLITE_REQUIRED');
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_INTEGRATION');};
const resultDir=process.env.MA_PRICE_INTEGRATION_RESULTS_DIR;
const sourceRoot=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
if(!resultDir||!isAbsolute(resultDir)||resolve(resultDir)===sourceRoot||resolve(resultDir).startsWith(sourceRoot+sep))throw Error('NEW_RESULT_DIRECTORY_OUTSIDE_SOURCE_REQUIRED');
mkdirSync(resultDir,{recursive:false});const output=pathToFileURL(resolve(resultDir)+sep);
const phases=[],archive=[];
const receipt={scope:'SYNTHETIC_ONLY_NEW_CROSS_CANDIDATE_INTEGRATION',started_at_utc:new Date().toISOString(),node:process.version,
 engine:'PGlite 0.3.14; fresh in-memory database; no remote connection',phases,real_reviews:0,formal_writes:0,formal_rpc_calls:0,production_e2e:false};
const save=(name,data)=>writeFileSync(new URL(name,output),JSON.stringify(data,null,2)+'\n');
const phase=async(name,fn)=>{const start=new Date().toISOString();try{const facts=await fn();phases.push({name,status:'PASS',started_at:start,ended_at:new Date().toISOString(),facts});console.log('PASS '+name);}catch(error){phases.push({name,status:'FAIL',started_at:start,error:String(error),stack:error.stack});throw error;}};
let f;
try{
 f=await createPricePlanFixture();const {db}=f;
 const role=async name=>db.exec('reset role;set role '+name);
 const clock=async()=>(await db.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`)).rows[0].at;
 const events=async()=>{await db.exec('reset role');return Number((await db.query('select count(*) n from vnext_private.ai_price_plan_publication_events_v1')).rows[0].n);};
 const project=async()=>{await f.identity('premium');const research=parseDailyAiMember(await f.readMember());
  const raw=(await db.query('select public.get_daily_ai_member_price_plans_v1($1) r',[f.editionId])).rows[0].r;
  return {data:research,plans:await parseDailyAiMemberPricePlans(raw,research,Date.now()+2,f.MEMBER),subject:f.MEMBER,raw};};
 let edition,cards;const prepared=[],reviewIds=new Map();
 const prepare=async(symbol,horizon,numbers={entry_range:[100.1,105.25],wait_above:105.25,stop:99.99})=>{
  const card=cards.find(c=>c.symbol===symbol&&c.horizon===horizon),packet=f.packets.find(p=>p.symbol===symbol),refs=f.sourceIds(symbol);
  const input={edition,card,packet,body:{schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:f.editionId,symbol,horizon,status:'VERIFIED',currency:'TWD',
   method:'SYNTHETIC_INTEGRATION_METHOD',basis:'僅供隔離整合測試；不是正式行情或股票評價。',...numbers,stop_kind:'PRICE',stop_evidence_ids:[refs.uncitedPrice],
   invalidation:'合成條件改變時停止參考。',evidence_ids:[refs.uncitedPrice,refs.event],as_of:await clock(),expires_at:edition.expires_at,buy_ready:false},
   method_note:{name:'SYNTHETIC_INTEGRATION_METHOD',derivation:'Numbers supplied solely for integration fixtures; no valuation method is endorsed.',
    assumptions:['Synthetic fixtures only; no actual reviewer, price precision or exchange tick approval.'],limitations:['Cannot validate genuine data, source rights or economic assumptions.'],source_use_scope:'PRIVATE_RESEARCH_ONLY'}};
  const candidate=await preparePricePlanCandidate(input,Date.now()+2);archive.push({input,candidate});save('synthetic-private-candidates.json',archive);
  // Restore actual persisted bytes before crossing the existing SQL boundary.
  const restored=JSON.parse(readFileSync(new URL('synthetic-private-candidates.json',output),'utf8')).at(-1);
  assert.equal(createHash('sha256').update(restored.candidate.body_text).digest('hex'),candidate.plan_hash);
  assert.equal(await snapshotHash(restored.input.packet),candidate.packet_hash);
  assert.equal(await snapshotHash(restored.input.card),candidate.card_hash);
  assert.equal(await snapshotHash(restored.input.method_note),candidate.method_note_hash);
  assert.equal(restored.candidate.review,null);assert.equal(restored.candidate.authorizes_publication,false);
  await role('service_role');
  const staged=(await db.query('select public.stage_daily_ai_price_plan_v1($1,$2) r',[restored.candidate.body_text,candidate.plan_hash])).rows[0].r;
  assert.equal(staged.member_published,false);
  await db.exec('reset role');const stored=(await db.query('select body_text,body from vnext_private.ai_price_plans_v1 where plan_hash=$1',[candidate.plan_hash])).rows[0];
  assert.equal(stored.body_text,candidate.body_text);assert.deepEqual(stored.body,JSON.parse(candidate.body_text));
  return candidate;
 };
 const review=async(candidate,states={quality:'PASS',time_status:'PASS',source_use:'PASS',methodology:'PASS'})=>{
  await role('service_role');const at=await clock();
  return (await db.query(`insert into vnext_private.ai_price_plan_reviews_v1(plan_hash,reviewer_ref,quality,time_status,source_use,methodology,
   document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
   values($1,'SYNTHETIC_INDEPENDENT_REVIEWER_NOT_A_REAL_APPOINTMENT',$2,$3,$4,$5,$6,$7,$8,$9,
    'SYNTHETIC fixture review only; no person signed, no source grant or methodology approved in production.',$10,$11) returning id`,
   [candidate.plan_hash,states.quality,states.time_status,states.source_use,states.methodology,'a'.repeat(64),'b'.repeat(64),candidate.method_note_hash,'d'.repeat(64),at,edition.expires_at])).rows[0].id;
 };
 const act=async(candidate,id,action='APPROVE')=>db.query('select public.review_daily_ai_price_plan_v1($1,$2,$3,$4)',[candidate.plan_hash,id,action,randomUUID()]);

 await phase('saved Member definition and source contracts resolve in the new isolated engine',async()=>{
  await db.exec('reset role');await db.exec(readFileSync(new URL('../research/daily-ai-price-plans.candidate.sql',import.meta.url),'utf8'));
  const saved=readFileSync(new URL('./fixtures/price-delivery-member-reader.saved.sql',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(saved).digest('hex'),'3de5d70f077eca9acb95ba5be4d413f33a7a88c750718ad06b211a1349f460b5');
  await db.exec(saved);
  const def=(await db.query("select pg_get_functiondef('public.get_daily_ai_member_research_v1()'::regprocedure) def")).rows[0].def;
  assert.equal(def,saved,'Saved catalog definition must roundtrip without rewriting a gate.');
  const e=(await db.query(`select id,payload, to_char(cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cutoff,
   to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') prepared,
   to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') expiry from vnext_private.ai_research_editions where id=$1`,[f.editionId])).rows[0];
  edition={id:e.id,evidence_cutoff:e.cutoff,prepared_at:e.prepared,expires_at:e.expiry};cards=e.payload.cards;
  return {member_definition_sha256:createHash('sha256').update(def).digest('hex'),analysis_origin_fallback_present:def.includes('MODEL_GENERATED')};
 });
 await phase('unreviewed preparer output survives private file and SQL storage but never becomes member prices',async()=>{
  for(const symbol of ['1000','1001'])for(const horizon of ['SHORT','MEDIUM','LONG'])prepared.push(await prepare(symbol,horizon));
  await f.identity('owner');const owner=await parseDailyAiOwnerPricePlans((await db.query('select public.get_daily_ai_owner_price_plans_v1($1) r',[f.editionId])).rows[0].r,f.editionId,f.OWNER,Date.now()+2);
  assert.equal(owner.plans.length,6);assert(owner.plans.every(p=>p.review===null&&!p.can_approve));
  const preview=renderOwnerPriceDelivery(owner);assert.equal(preview.approveButtons.length,2);assert(preview.approveButtons.every(b=>b.props.disabled));assert(preview.text.includes('NT$100.1～105.25'));
  await assert.rejects(()=>act(prepared[0],randomUUID()));assert.equal(await events(),0);
  const projection=await project();assert.equal(projection.data.edition,null);assert.equal(projection.plans.plans.length,0);
  save('unreviewed-owner.json',owner);return {private_candidates:6,price_reviews:0,price_publications:0,member_prices:0};
 });
 await phase('edition approval and browser identity cannot approve or register prepared numeric sidecars',async()=>{
  await f.identity('owner');await f.approveEdition('premium');const projection=await project();assert(projection.data.edition);assert.equal(projection.plans.plans.length,0);
  assert.equal(projection.data.edition.analysis_origin,'MODEL_GENERATED');
  await assert.rejects(()=>db.query('select public.stage_daily_ai_price_plan_v1($1,$2)',[prepared[0].body_text,prepared[0].plan_hash]),/permission denied/);
  const ui=renderPriceDelivery({...projection,horizon:'SHORT'});assert.equal(ui.firstTwoPriceFields.length,0);ui.close();
  return {research_visible:true,member_prices:0,browser_stage_denied:true};
 });
 await phase('pending independent review and missing source rights fail closed after new preparation',async()=>{
  const pending=await review(prepared[0],{quality:'PASS',time_status:'PASS',source_use:'PENDING',methodology:'PENDING'});
  await f.identity('owner');await assert.rejects(()=>act(prepared[0],pending),/AI_PRICE_PLAN_PREREQUISITES/);assert.equal(await events(),0);
  await db.exec('reset role');await db.query("update vnext_private.source_licenses set commercial_allowed=false where id='synthetic-plan-grant-0'");
  await assert.rejects(()=>review(prepared[0]),/AI_PRICE_PLAN_RIGHTS/);assert.equal(await events(),0);
  const withheld=await project();assert.equal(withheld.plans.plans.length,0);
  await db.exec('reset role');await db.query("update vnext_private.source_licenses set commercial_allowed=true where id='synthetic-plan-grant-0'");
  for(const item of prepared)reviewIds.set(item.plan_hash,await review(item));
  assert.equal((await project()).plans.plans.length,0,'Review alone is never Owner approval.');
  return {pending_owner_action_denied:true,missing_rights_review_denied:true,review_without_owner_member_prices:0};
 });
 await phase('synthetic independent reviews plus explicit synthetic Owner gate reach the real parser and three-horizon UI',async()=>{
  await f.identity('premium');await assert.rejects(()=>act(prepared[0],reviewIds.get(prepared[0].plan_hash)),/OWNER_REQUIRED/);
  await f.identity('owner');for(const item of prepared)await act(item,reviewIds.get(item.plan_hash));
  const projection=await project();assert.equal(projection.plans.plans.length,6);
  for(const p of projection.plans.plans){assert.equal(await hashDailyAiPricePlanBody(p),p.plan_hash);assert.equal(p.buy_ready,false);}
  assert(projection.raw.source_sets.every(s=>s.sources.every(e=>!Object.hasOwn(e,'content'))));
  for(const horizon of ['SHORT','MEDIUM','LONG']){const ui=renderPriceDelivery({...projection,horizon});ui.selectTwo();
   for(const visible of [...ui.firstTwoCards,ui.comparison]){assert(visible.includes('NT$100.1～105.25'));assert(visible.includes('NT$99.99'));}ui.close();}
  save('synthetic-approved-projection.json',projection);
  return {synthetic_prices:6,periods_rendered:['SHORT','MEDIUM','LONG'],raw_source_content_leaked:false,real_signoffs:0};
 });
 await phase('replacement candidates suppress old prices; extra decimals and floating tails stay hidden even after synthetic approval',async()=>{
  const replacements=[await prepare('1000','SHORT',{entry_range:[0.1+0.2,0.31],wait_above:0.32,stop:0.29}),
   await prepare('1001','SHORT',{entry_range:[100.001,100.004],wait_above:100.0041,stop:99.999})];
  const pending=await project();assert.equal(pending.plans.plans.filter(p=>p.horizon==='SHORT').length,0);
  for(const item of replacements){const id=await review(item);await f.identity('owner');await act(item,id);}
  const projection=await project();assert.equal(projection.plans.plans.length,6);const before=JSON.stringify(projection);
  const ui=renderPriceDelivery({...projection,horizon:'SHORT'});ui.selectTwo();assert.equal(ui.firstTwoPriceFields.length,0);
  for(const visible of [...ui.firstTwoCards,ui.comparison]){assert(visible.includes(DAILY_AI_PRICE_PRECISION_PENDING));assert(!visible.includes('NT$'));}
  assert.equal(JSON.stringify(projection),before);ui.close();
  assert.equal(projection.plans.plans.find(p=>p.symbol==='1000'&&p.horizon==='SHORT').entry_range[0],0.30000000000000004);
  save('synthetic-precision-held-projection.json',projection);
  await f.identity('owner');const owner=await parseDailyAiOwnerPricePlans((await db.query('select public.get_daily_ai_owner_price_plans_v1($1) r',[f.editionId])).rows[0].r,f.editionId,f.OWNER,Date.now()+2);
  const preview=renderOwnerPriceDelivery(owner);assert(preview.text.includes(DAILY_AI_PRICE_PRECISION_PENDING));assert(!preview.text.includes('NT$'));assert(preview.raw.some(s=>s.includes('0.30000000000000004')));assert(preview.raw.some(s=>s.includes('100.001')));save('synthetic-precision-owner.json',owner);
  return {unreviewed_replacement_old_prices_hidden:true,accepted_high_precision_values_preserved:true,short_numeric_ui_fields:0,rounding_applied:false,tick_assumptions:0};
 });
 await phase('revoking a prepared and rendered plan removes its numeric UI without reviving an older version',async()=>{
  const item=prepared.find(p=>p.symbol==='1000'&&p.horizon==='MEDIUM');await f.identity('owner');await act(item,reviewIds.get(item.plan_hash),'REVOKE');
  const projection=await project();assert(!projection.plans.plans.some(p=>p.plan_hash===item.plan_hash));
  const ui=renderPriceDelivery({...projection,horizon:'MEDIUM'});ui.selectTwo();assert(!ui.firstTwoCards[0].includes('NT$'));assert(ui.firstTwoCards[1].includes('NT$100.1～105.25'));ui.close();
  return {revoked_plan_absent:true,other_plan_unchanged:true};
 });
 receipt.status='PASS';receipt.passed_phases=phases.length;
}catch(error){receipt.status='FAIL';receipt.error=String(error);receipt.stack=error.stack;process.exitCode=1;console.error(error);}
finally{if(f)await f.close();receipt.finished_at_utc=new Date().toISOString();save('INTEGRATION_RECEIPT.json',receipt);}
