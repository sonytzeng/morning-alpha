/** Isolated PostgreSQL regression. Synthetic stage jobs are not model outputs. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DOCUMENTED_REVIEW_V2_CONTRACT as C} from '../../../research/documented-review-v2-contract.candidate.ts';
import {documentedReviewState,documentedReviewProof} from '../../../research/documented-review-replay-v2.candidate.ts';
const modulePath=process.env.MA_PGLITE_MODULE;assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const here=new URL('./',import.meta.url),research=new URL('../../../research/',here),v1=new URL('../sec-daily-integration/',here);
const read=async url=>readFile(url,'utf8'),json=async url=>JSON.parse(await read(url)),sha=s=>createHash('sha256').update(s).digest('hex');
const registry=await json(new URL('sealed-registry.json',here)),v1Registry=await json(new URL('sealed-registry.json',v1));
const candidate=await read(new URL('documented-reviews-v2.candidate.sql',here));
const live=await json(new URL('live16-baseline/functions.json',here)),stageLive=(await json(new URL('live16-baseline/stage-functions.json',here)))[0];
const seedRaw=await read('/workspace/scratch/3d0c86e17b1f/evidence/2330-long-bound-reviews-v2-new72.seed.json'),seed=JSON.parse(seedRaw);
const baseInputs=await json('/workspace/scratch/3d0c86e17b1f/evidence/current-funnel-inputs.json');
const base=baseInputs.map(i=>({...i,cutoff:seed.cutoff}));
const enrich=(inputs,reviews=true)=>inputs.map(i=>i.symbol==='2330'?{...structuredClone(i),facts:[...structuredClone(i.facts),...structuredClone(v1Registry.facts),...(reviews?structuredClone(registry.facts):[])]}:structuredClone(i));
const until=C.review_valid_until,day=t=>new Date(Date.parse(t)+8*3600000).toISOString().slice(0,10);
const secProof={schema:'DAILY_AI_SEC_RETAINED_REPLAY_V1',source_seal_sha256:v1Registry.source_seal_sha256,facts_sha256:v1Registry.facts_sha256,
 fact_ids:v1Registry.facts.map(f=>f.id).sort(),replay_basis:'RETAINED_ORIGINAL_RECEIPTS_NOT_REOBSERVED',source_refetched:false,source_admitted:false,member_publication_approved:false};
const ordinary=at=>({schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:at,responses:[],additions:[],removals:[],company_names:[],sec_replay:secProof});
const proof=(inputs,at)=>{const p=documentedReviewState(inputs,at);return {...ordinary(at),documented_review_replay:documentedReviewProof(p.state,p.observed_price)};};
const validate=async(b,i,p,at=seed.cutoff)=>(await db.query('select vnext_runtime.validate_daily_ai_financial_refresh_reviews_v2($1,$2,$3,$4::timestamptz,$5::date) r',[b,i,p,at,day(at)])).rows[0].r;
const project=async i=>(await db.query('select vnext_runtime.project_daily_stock_ai_inputs_reviews_v2($1) r',[i])).rows[0].r;
const expiry=async(payload,requested)=>(await db.query('select vnext_runtime.documented_review_edition_expiry_v2($1,$2::timestamptz) r',[payload,requested])).rows[0].r;
let phase='bootstrap',checks=0;
try{
 const priorHarness=await read(new URL('database.integration.mjs',v1)),bootstrap=priorHarness.match(/await db\.exec\(`([\s\S]*?)`\);/)[1];
 assert(!bootstrap.includes('${'));await db.exec(bootstrap);
 for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-handoff','daily-ai-member','daily-ai-use-review','daily-ai-intake','daily-ai-market-policy-v2','daily-ai-financial-refresh-v3','daily-ai-intake-performance-v4','daily-ai-intake-corrections-v5'])await db.exec(await read(new URL(name+'.candidate.sql',research)));
 for(const f of await json(new URL('live15-baseline/functions.json',v1)))await db.exec(f.definition);
 await db.exec(await read(new URL('retained-sec-daily-v1.candidate.sql',v1)));
 for(const f of [...live,stageLive])await db.exec(f.definition);
 phase='intact migration, fingerprint and replay guards';
 await db.exec(candidate);checks++;
 for(const [signature,expected] of [
  ['vnext_runtime.validate_daily_ai_financial_refresh_sec_v1(jsonb,jsonb,jsonb,timestamptz,date)','0d6cde2b2d48fd5976434bdd8a2859db0483b7b500b9d0eb45c083d37e438711'],
  ['vnext_runtime.project_daily_stock_ai_inputs_v1(jsonb)','7b3da81170bfdae84fdac26fbf88844791f4e4d795b6e687499b7a655559a977'],
  ['public.daily_stock_ai_intake_v1(text,uuid,uuid,jsonb,jsonb,text,text,jsonb,jsonb,jsonb)','a9074dcad28525d207b9b28f894c95392823ae44331446827f968d6f83e763c6'],
  ['public.stage_daily_ai_research_edition_v1(text,text[],timestamptz)','e744ae5fd8f0f31967e179ffdbdf3cc74672892564c0f6c454c8ff7847626b44'],
 ]){const actual=(await db.query("select encode(sha256(convert_to(pg_get_functiondef(to_regprocedure($1)),'UTF8')),'hex') h",[signature])).rows[0].h;assert.equal(actual,expected);checks++;}
 await assert.rejects(()=>db.exec(candidate),/ALREADY_PRESENT/);await db.exec('rollback');checks++;
 phase='reader permissions and immutable source';
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);
  await assert.rejects(()=>db.query('select public.load_daily_stock_ai_documented_reviews_v2($1,$2)',[C.source_seal_sha256,seed.cutoff]),/permission denied/);checks++;
  await assert.rejects(()=>db.query('select * from vnext_private.verified_documented_reviews_v2'),/permission denied/);checks++;
  await assert.rejects(()=>validate(base,base,null),/permission denied/);checks++;await db.exec('reset role');}
 await db.exec('set role service_role');
 const loaded=(await db.query('select public.load_daily_stock_ai_documented_reviews_v2($1,$2) r',[C.source_seal_sha256,seed.cutoff])).rows[0].r;
 assert.deepEqual(loaded,registry);checks++;
 await assert.rejects(()=>db.query('select facts_text from vnext_private.verified_documented_reviews_v2'),/permission denied/);checks++;await db.exec('reset role');
 for(const sql of ['update vnext_private.verified_documented_reviews_v2 set facts_text=facts_text','delete from vnext_private.verified_documented_reviews_v2','truncate vnext_private.verified_documented_reviews_v2']){await assert.rejects(()=>db.exec(sql),/REGISTRY_IMMUTABLE/);checks++;}
 phase='active first addition, no-proof retention, inactive removal';
 const full=enrich(base),financialOnly=enrich(base,false),p=proof(full,seed.cutoff);
 assert.equal(p.documented_review_replay.state,'ACTIVE');assert.deepEqual((await validate(base,full,p)).documented_review_replay,p.documented_review_replay);checks++;
 assert.deepEqual((await validate(full,full,ordinary(seed.cutoff))).documented_review_replay,p.documented_review_replay);checks++;
 const noReviews=await validate(base,financialOnly,ordinary(seed.cutoff));assert(!noReviews.documented_review_replay);checks++;
 for(const [label,mutate,at] of [
  ['price',i=>{i[0].x='unused';const s=i.find(x=>x.symbol==='2330');s.bars.find(b=>b.date===s.through).close=2371;},seed.cutoff],
  ['date',i=>{const s=i.find(x=>x.symbol==='2330');s.through='2026-10-29';},seed.cutoff],
  ['expired',()=>{},until],
 ]){const changed=structuredClone(financialOnly);mutate(changed);const ip=proof(changed,at);assert.notEqual(ip.documented_review_replay.state,'ACTIVE',label);
  const r=await validate(full,changed,ip,at);assert.deepEqual(r.documented_review_replay.applied_fact_ids,[]);checks++;}
 const unavailable={...ordinary(seed.cutoff),documented_review_replay:documentedReviewProof('REGISTRY_UNAVAILABLE_NOT_APPLIED',documentedReviewState(financialOnly,seed.cutoff).observed_price)};
 assert.deepEqual((await validate(full,financialOnly,unavailable)).documented_review_replay.applied_fact_ids,[]);checks++;
 for(const mutate of [
  i=>{i.find(s=>s.symbol==='2330').facts.find(f=>f.kind==='DEMAND').values.verdict='NOT_SUPPORTED';},
  i=>{i.find(s=>s.symbol==='2330').facts.push(structuredClone(registry.facts[0]));},
  i=>{i.find(s=>s.symbol==='2330').facts.find(f=>f.kind==='MOAT').source_admitted=true;},
  i=>{i.find(s=>s.symbol==='2330').facts.find(f=>f.id.startsWith('sec-quarter:')).values.value=999;},
 ]){const changed=structuredClone(full);mutate(changed);await assert.rejects(()=>validate(base,changed,p),/DRIFT|SEC_REPLAY_FACTS_NOT_EXACT/);checks++;}
 const altered=structuredClone(p);altered.documented_review_replay.applied_fact_ids=[];await assert.rejects(()=>validate(base,full,altered),/PROOF_DRIFT/);checks++;
 phase='latest as-reported projection preserves 15 facts within the company budget';
 const extraBase=structuredClone(base),s=extraBase.find(s=>s.symbol==='2330'),old=s.facts.find(f=>f.kind==='VALUATION_AS_REPORTED');
 s.facts.push({...structuredClone(old),id:'synthetic-older-quote',period:'2026-10-29'});
 const extraFull=enrich(extraBase),result=await validate(extraBase,extraFull,proof(extraFull,seed.cutoff));assert.equal(result.documented_review_replay.state,'ACTIVE');checks++;
 const projected=await project(extraFull),target=projected.find(s=>s.symbol==='2330');
 assert.equal(target.facts.filter(f=>f.kind==='VALUATION_AS_REPORTED').length,1);
 assert.equal(target.facts.filter(f=>f.id.startsWith('sec-quarter:')||f.id.startsWith('own-documented-review:')).length,15);checks++;
 const originalProjection=(await db.query('select vnext_runtime.project_daily_stock_ai_inputs_v1($1) r',[extraFull])).rows[0].r;
 for(const stock of projected.filter(s=>s.symbol!=='2330'))assert.deepEqual(stock,originalProjection.find(i=>i.symbol===stock.symbol));checks++;
 phase='real CLAIM/SOURCE retention and conservative removal without blocking the universe';
 const runId='00000000-0000-0000-0000-000000000001',revision='a'.repeat(64),companies=base.map(i=>({symbol:i.symbol,company:i.company,exchange:'TWSE'}));
 await db.query('insert into vnext_runtime.runs values($1,$2,$3,$4,now())',[runId,day(seed.cutoff),{acquired:{inputs:base,evidence_cutoff:seed.cutoff,snapshot_hash:revision}},revision]);
 await db.query('insert into vnext_runtime.source_revisions values($1,$2)',['isolated-directory',{task:{kind:'DIRECTORY'},status:'OK',payload:{rows:companies}}]);
 await db.query('insert into vnext_runtime.run_sources values($1,$2)',[runId,'isolated-directory']);
 await db.exec('set role service_role');
 const queued=(await db.query('select public.enqueue_daily_stock_ai_intake_v1() r')).rows[0].r;
 const claim=(await db.query("select public.daily_stock_ai_intake_v1('CLAIM',$1) r",[queued.intake_id])).rows[0].r;
 const sourceInputs=enrich(claim.inputs),sourceProof=proof(sourceInputs,new Date().toISOString());
 const sourced=(await db.query("select public.daily_stock_ai_intake_v1('SOURCE',$1,$2,$3,$4,null,null,$5,$6,$7) r",[queued.intake_id,claim.lease,sourceInputs,[],{},[],sourceProof])).rows[0].r;
 assert.equal(sourced.state,'SOURCED');assert.equal(sourced.inputs.find(s=>s.symbol==='2330').facts.filter(f=>f.id.startsWith('sec-quarter:')||f.id.startsWith('own-documented-review:')).length,15);checks++;
 const second=(await db.query("select public.enqueue_corrected_daily_stock_ai_intake_v5('SOURCE_POLICY_CORRECTION',$1) r",['00000000-0000-0000-0000-000000000020'])).rows[0].r;
 const nextClaim=(await db.query("select public.daily_stock_ai_intake_v1('CLAIM',$1) r",[second.intake_id])).rows[0].r;
 assert.equal(nextClaim.source_kind,'ASOF_INTAKE');assert.equal(nextClaim.source_id,queued.intake_id);
 assert.equal(nextClaim.inputs.find(s=>s.symbol==='2330').facts.filter(f=>f.id.startsWith('own-documented-review:')).length,3);checks++;
 const without=nextClaim.inputs.map(i=>({...i,facts:i.facts.filter(f=>!f.id.startsWith('own-documented-review:'))})),now=new Date().toISOString();
 const unavailableSource={...ordinary(now),documented_review_replay:documentedReviewProof('REGISTRY_UNAVAILABLE_NOT_APPLIED',documentedReviewState(without,now).observed_price)};
 const unavailableResult=(await db.query("select public.daily_stock_ai_intake_v1('SOURCE',$1,$2,$3,$4,null,null,$5,$6,$7) r",[second.intake_id,nextClaim.lease,without,[],{},[],unavailableSource])).rows[0].r;
 assert.equal(unavailableResult.state,'SOURCED');assert.equal(unavailableResult.inputs.length,72);
 assert.equal(unavailableResult.inputs.find(s=>s.symbol==='2330').facts.filter(f=>f.id.startsWith('own-documented-review:')).length,0);
 assert.equal(unavailableResult.inputs.find(s=>s.symbol==='2330').facts.filter(f=>f.id.startsWith('sec-quarter:')).length,12);checks++;
 await db.exec('reset role');
 const firstStored=(await db.query('select snapshot_hash,financial_refresh from vnext_runtime.ai_stock_intakes where id=$1',[queued.intake_id])).rows[0];
 assert.equal(firstStored.snapshot_hash,sourced.snapshot_hash);assert.equal(firstStored.financial_refresh.documented_review_replay.state,'ACTIVE');checks++;
 const secondStored=(await db.query('select financial_refresh from vnext_runtime.ai_stock_intakes where id=$1',[second.intake_id])).rows[0];
 assert.equal(secondStored.financial_refresh.documented_review_replay.state,'REGISTRY_UNAVAILABLE_NOT_APPLIED');checks++;
 phase='stage deadline clamp, exact source and quote drift';
 const payload={...seed,packets:Object.values(seed.packet_texts).map(t=>JSON.parse(t))},requested=new Date(Date.parse(seed.cutoff)+72*3600000).toISOString();
 assert.equal(new Date(await expiry(payload,requested)).toISOString(),new Date(until).toISOString());checks++;
 const sooner=new Date(Date.parse(until)-3600000).toISOString();assert.equal(new Date(await expiry(payload,sooner)).toISOString(),sooner);checks++;
 const legacy=structuredClone(payload);legacy.packets.find(p=>p.symbol==='2330').evidence=legacy.packets.find(p=>p.symbol==='2330').evidence.filter(e=>!e.id.includes('own-documented-review:'));
 assert.equal(new Date(await expiry(legacy,requested)).toISOString(),requested);checks++;
 for(const mutate of [
  b=>{const p=b.packets.find(p=>p.symbol==='2330');p.evidence=p.evidence.filter(e=>!e.id.includes(':MOAT:'));},
  b=>{const e=b.packets.find(p=>p.symbol==='2330').evidence.find(e=>e.id.includes('own-documented-review:'));e.source='https://example.test/forged';},
  b=>{const p=b.packets.find(p=>p.symbol==='2330');p.data_through='2026-11-02';},
  b=>{const e=b.packets.find(p=>p.symbol==='2330').evidence.find(e=>e.kind==='PRICE'&&JSON.parse(e.content).date==='2026-10-30');const c=JSON.parse(e.content);c.close=2371;e.content=JSON.stringify(c);},
  b=>{b.cutoff=until;},
  b=>{const p=b.packets.find(p=>p.symbol==='2330');const e=structuredClone(p.evidence.find(e=>e.id.includes('sec-quarter:')));e.id='2330:FINANCIAL:sec-quarter:2330:UNKNOWN';p.evidence.push(e);},
  b=>{const source=b.packets.find(p=>p.symbol==='2330');const other=b.packets.find(p=>p.symbol!=='2330');other.evidence.push(structuredClone(source.evidence.find(e=>e.id.includes('sec-quarter:'))));},
  b=>{const p=b.packets.find(p=>p.symbol==='2330');const e=structuredClone(p.evidence.find(e=>e.id.includes('sec-quarter:')));e.id='unrelated-id';e.source='https://example.test/alias';p.evidence.push(e);},
  b=>{let n=0;for(const p of b.packets)for(const e of p.evidence.filter(e=>e.id.includes('own-documented-review:'))){e.id='unregistered-review-alias-'+n++;e.evidence_hash='a'.repeat(64);e.content=e.content.replaceAll('own-documented-review:','\\u006fwn-documented-review:');}},
 ]){const b=structuredClone(payload);mutate(b);await assert.rejects(()=>expiry(b,requested),/DOCUMENTED_REVIEW_V2_STAGE/);checks++;}
 phase='real public staging hashes the final clamped edition without AFTER mutation';
 await db.exec('set role service_role');const stored=(await db.query('select public.store_daily_stock_ai_batch_v1($1,$2) r',[seedRaw,sha(seedRaw)])).rows[0].r;assert.equal(stored.state,'STORED');await db.exec('reset role');
 const jobs=[];
 for(const packet of payload.packets){
  const inputHash=seed.packet_hashes[packet.symbol],id=sha('ISOLATED_SYNTHETIC_STAGE:'+packet.symbol+':'+inputHash);jobs.push(id);
  const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:packet.symbol,input_hash:inputHash,cutoff:seed.cutoff,model_generated:true,
   member_published:false,publication_ready:false,receipt:{response_id:'ISOLATED_SYNTHETIC_NOT_A_MODEL_CALL',model:'offline-fixture'},
   sources:packet.evidence.map(({content,...metadata})=>metadata),horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',
    reason:{text:'隔離資料庫到期日測試固定輸出，不是實際模型研究。',evidence_ids:[packet.evidence[0].id]},counter_evidence:[],gaps:[],confirmation:'隔離測試核對資料。',invalidation:'隔離測試固定條件。'}))};
  await db.query("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,'isolated-expiry-fixture',$3,$4,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$5)",[id,inputHash,packet.symbol,seed.cutoff,result]);
 }
 await db.exec('set role service_role');const staged=(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) r',[sha(seedRaw),jobs,requested])).rows[0].r;
 assert.equal(staged.status,'STAGED_REVIEW_REQUIRED');await db.exec('reset role');checks++;
 const edition=(await db.query('select expires_at,payload,id from vnext_private.ai_research_editions where id=$1',[staged.edition_id])).rows[0];
 assert.equal(new Date(edition.expires_at).toISOString(),new Date(until).toISOString());
 const committed=(await db.query("select encode(sha256(convert_to(payload::text,'UTF8')),'hex')=id ok from vnext_private.ai_research_editions where id=$1",[staged.edition_id])).rows[0].ok;assert(committed);checks++;
 assert.equal((await db.query('select count(*) n from net.requests')).rows[0].n,0);checks++;
 console.log(JSON.stringify({result:'PASS',checks,postgres:(await db.query('show server_version')).rows[0].server_version,
  sql_sha256:sha(candidate),stage_expires_at:new Date(edition.expires_at).toISOString(),production_connections:0,http_requests:0,model_calls:0,synthetic_stage_jobs:72}));
}catch(error){console.error(JSON.stringify({phase,error:String(error.message).slice(0,3500),code:error.code,where:error.where,
 site:error.stack?.split('\n').find(l=>l.includes('database.integration.mjs'))}));process.exitCode=1;}
finally{await db.close();}
