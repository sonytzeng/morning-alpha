// Every issuer, role, source, grant, review and approval in this fixture is
// SYNTHETIC. It runs the existing SQL in a fresh in-memory PostgreSQL only.
import {readFileSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical} from '../../research/entry-opportunity.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {isMarketTradingDate,previousMarketTradingDate} from '../../supabase/functions/_shared/market-session-contract.mjs';

const OWNER='00000000-0000-0000-0000-000000000101',MEMBER='00000000-0000-0000-0000-000000000102';
const PRICE_SOURCE='https://www.twse.com.tw/synthetic-calculated-price-fixture';
const FINANCIAL_SOURCE='https://www.twse.com.tw/synthetic-calculated-financial-fixture';
const NEWS_SOURCE='https://www.twse.com.tw/synthetic-calculated-news-fixture';
const ISO_SQL='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

export async function createCalculatedPriceFixture(){
 const modulePath=process.env.MA_PGLITE_MODULE;
 if(!modulePath||!isAbsolute(modulePath)||!realpathSync(modulePath).endsWith('/@electric-sql/pglite/dist/index.js'))throw Error('EXISTING_LOCAL_PGLITE_REQUIRED');
 const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
 const role=async name=>{
  if(!['anon','authenticated','service_role'].includes(name))throw Error('SYNTHETIC_ROLE');
  await db.exec('reset role;set role '+name);
 };
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   insert into auth.users values('${OWNER}'),('${MEMBER}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create schema academy_private;
   create function academy_private.access_v11() returns text language sql stable as $$select nullif(current_setting('test.tier',true),'')$$;
   create function public.is_research_owner_v1() returns boolean language sql stable as $$select auth.uid()='${OWNER}'::uuid and current_setting('test.tier',true)='owner'$$;
   create schema vnext_private;
   create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
   create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,
    storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);
   create schema vnext_runtime;
   create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;`);
  for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-member','daily-ai-use-review','daily-ai-price-plans'])
   await db.exec(readFileSync(new URL('../../research/'+name+'.candidate.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../fixtures/price-delivery-member-reader.saved.sql',import.meta.url),'utf8'));

  const started=Date.now(),cutoff=new Date(started-30*60000).toISOString(),expiry=new Date(started+2*3600000).toISOString();
  const localDay=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
  const through=isMarketTradingDate('TW',localDay)&&Date.parse(cutoff)>=Date.parse(localDay+'T17:05:00+08:00')
   ?localDay:previousMarketTradingDate('TW',localDay);
  if(!through)throw Error('SYNTHETIC_CALENDAR_SCOPE');
  const sessionClose=through+'T13:30:00+08:00';
  const availableAt=new Date(Math.max(Date.parse(cutoff)-60000,Date.parse(sessionClose))).toISOString();
  const packetTexts={},packetHashes={},packets=[],jobs=[];
  const sourceIds=symbol=>({price:'SYNTH-P-'+symbol,financial:'SYNTH-F-'+symbol,news:'SYNTH-N-'+symbol});
  for(let i=0;i<72;i++){
   const symbol=String(1000+i),ids=sourceIds(symbol);
   const packet={symbol,company:'合成計算測試公司 '+symbol,cutoff,data_through:through,data_gaps:['SYNTHETIC_CALCULATED_PRICE_FIXTURE_ONLY'],evidence:[
    {id:ids.price,symbol,kind:'PRICE',source:PRICE_SOURCE,published_at:sessionClose,available_at:availableAt,time_basis:'PUBLISHED',
     content:JSON.stringify({date:through,open:100,high:105,low:95,close:100,currency:'TWD',price_basis:'RAW_UNADJUSTED',session_scope:'SYNTHETIC_COMPLETE_SESSION'})},
    {id:ids.financial,symbol,kind:'FINANCIAL',source:FINANCIAL_SOURCE,published_at:sessionClose,available_at:availableAt,time_basis:'PUBLISHED',
     content:'SYNTHETIC_ONLY: diluted common-share earnings and cash-flow context; no actual issuer data or forecast is claimed.'},
    {id:ids.news,symbol,kind:'NEWS',source:NEWS_SOURCE,published_at:sessionClose,available_at:availableAt,time_basis:'PUBLISHED',
     content:'SYNTHETIC_ONLY: hypothetical company conditions require separate review; no real event is asserted.'},
   ]};
   packets.push(packet);packetTexts[symbol]=canonical(packet);packetHashes[symbol]=await snapshotHash(packet);
   const revision='synthetic-calculated-price-fixture-model-v1';
   const id=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:packetHashes[symbol],model_revision:revision});jobs.push(id);
   const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol,cutoff,input_hash:packetHashes[symbol],model_generated:true,
    member_published:false,publication_ready:false,receipt:{response_id:'synthetic-calculated-'+i,model:revision},
    sources:packet.evidence.map(({content,...source})=>source),
    horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:horizon==='SHORT'?'INSUFFICIENT':'WAIT',
     reason:{text:'Synthetic isolated research fixture; no real stock conclusion.',evidence_ids:[ids.price]},
     counter_evidence:[{text:'Synthetic financial and event conditions require independent review.',evidence_ids:[ids.financial,ids.news]}],
     confirmation:'Wait for verified new evidence.',invalidation:'Cancel if independently verified evidence changes.',
     gaps:horizon==='SHORT'?['SYNTHETIC_SHORT_INPUT_NOT_SUPPLIED']:[]}))};
   await db.query(`insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result)
    values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$6)`,
    [id,packetHashes[symbol],revision,symbol,cutoff,result]);
  }
  const body={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through,packet_texts:packetTexts,packet_hashes:packetHashes,gaps:[]};
  const batchId=await snapshotHash(body);await role('service_role');
  await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[canonical(body),batchId]);
  const staged=(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) r',[batchId,jobs,expiry])).rows[0].r;
  const editionId=staged.edition_id;await db.exec('reset role');
  for(const [i,source] of [PRICE_SOURCE,FINANCIAL_SOURCE,NEWS_SOURCE].entries())
   await db.query(`insert into vnext_private.source_licenses values($1,$2,'https://data.gov.tw/license',now(),$3,true,true,true,false,'Synthetic test attribution; not a real license grant')`,
    ['synthetic-calculation-grant-'+i,source,expiry]);
  await role('service_role');
  const editionReviewId=(await db.query(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,
   quality,time_status,licensing,quality_document_hash,time_document_hash,license_document_hash,reason,expires_at)
   values($1,$1,'synthetic-independent-edition-reviewer','PASS','PASS','PASS',$2,$3,$4,
   'Synthetic fixture review only; not an actual qualified signoff, commercial grant or production authorization.',$5) returning id`,
   [editionId,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),expiry])).rows[0].id;
  await db.exec('reset role');
  const e=(await db.query(`select id,payload,through::text through,to_char(cutoff at time zone 'UTC','${ISO_SQL}') cutoff,
   to_char(created_at at time zone 'UTC','${ISO_SQL}') prepared,to_char(expires_at at time zone 'UTC','${ISO_SQL}') expiry
   from vnext_private.ai_research_editions where id=$1`,[editionId])).rows[0];
  const edition={id:e.id,evidence_cutoff:e.cutoff,prepared_at:e.prepared,expires_at:e.expiry,data_through:e.through},cards=e.payload.cards;
  const identity=async tier=>{
   if(!['owner','premium','free'].includes(tier))throw Error('SYNTHETIC_IDENTITY');
   await db.exec('reset role');
   await db.query("select set_config('test.uid',$1,false),set_config('test.tier',$2,false)",[tier==='owner'?OWNER:MEMBER,tier]);
   await db.exec('set role authenticated');
  };
  const clock=async()=>(await db.query(`select to_char(clock_timestamp() at time zone 'UTC','${ISO_SQL}') at`)).rows[0].at;
  const calculationInput=(symbol,horizon,asOf)=>{
   const packet=packets.find(p=>p.symbol===symbol);if(!packet)throw Error('SYNTHETIC_SYMBOL');
   const ids=sourceIds(symbol),financial=[ids.financial];
   const common={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol,horizon,cutoff:packet.cutoff,data_through:through,
    as_of:asOf,expires_at:edition.expires_at,currency:'TWD',quote_evidence_id:ids.price,evidence:structuredClone(packet.evidence),
    assumption_basis:{available_at:packet.cutoff,description:'SYNTHETIC_ONLY: explicit test scenarios, not issuer guidance or calibrated investment assumptions.',evidence_ids:financial},
    invalidation:'合成財務與每稀釋普通股假設改變時停止使用，重新審查。'};
   const selection={entry_scenarios:['conservative','base'],margin_of_safety:0.2,stop_evidence_ids:financial};
   const dilution_basis={description:'SYNTHETIC_ONLY: each amount is per diluted common share, not reported aggregate earnings.',evidence_ids:financial};
   const start=new Date(Date.parse(through+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   const end=new Date(Date.parse(start+'T00:00:00Z')+364*86400000).toISOString().slice(0,10);
   if(horizon==='MEDIUM')return {...common,method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',parameters:{...selection,
    earnings_basis:'FORWARD_12_MONTH_DILUTED_EPS',forecast_period:{start,end},dilution_basis,
    scenarios:[{name:'conservative',eps:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:12,pe:14}]}};
   if(horizon==='LONG')return {...common,method_id:'LONG_FCFE_DISCOUNT_SCENARIOS_V1',parameters:{...selection,dilution_basis,
    cashflow_basis:'FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI',timing:'END_OF_YEAR',
    scenarios:[['conservative',10],['base',12],['upside',15]].map(([name,amount])=>({name,cashflows:[amount,amount,amount,amount,amount],
     discount_rate:0.1,terminal:{next_fcfe:amount,growth:0}}))}};
   if(horizon==='SHORT')return {...common,method_id:'SHORT_ATR_CONDITIONAL_V1',parameters:{}};
   throw Error('SYNTHETIC_HORIZON');
  };
  const producerInput=async(symbol,horizon)=>({edition,card:cards.find(c=>c.symbol===symbol&&c.horizon===horizon),
   packet:packets.find(p=>p.symbol===symbol),calculation_input:calculationInput(symbol,horizon,await clock())});
  const stageRpc=async(name,args,{signal}={})=>{
   if(signal?.aborted)throw Error('SYNTHETIC_RPC_ABORTED');
   if(name!=='stage_daily_ai_price_plan_v1'||Object.keys(args).sort().join('|')!=='p_body_text|p_plan_hash')throw Error('SYNTHETIC_RPC_SCOPE');
   await role('service_role');
   return {data:(await db.query('select public.stage_daily_ai_price_plan_v1($1,$2) r',[args.p_body_text,args.p_plan_hash])).rows[0].r,error:null};
  };
  const insertPriceReview=async(produced,states={quality:'PASS',time_status:'PASS',source_use:'PASS',methodology:'PASS'})=>{
   await role('service_role');const candidate=produced.candidate,at=await clock();
   return (await db.query(`insert into vnext_private.ai_price_plan_reviews_v1(plan_hash,reviewer_ref,quality,time_status,source_use,methodology,
    document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
    values($1,'synthetic-calculation-independent-reviewer',$2,$3,$4,$5,$6,$7,$8,$9,
    'Synthetic independent fixture review only; no real person signed or actual source rights/methodology were approved.',$10,$11) returning id`,
    [candidate.plan_hash,states.quality,states.time_status,states.source_use,states.methodology,
     await snapshotHash({scope:'SYNTHETIC_REVIEW_ONLY',plan_hash:candidate.plan_hash}),candidate.packet_hash,candidate.method_note_hash,
     await snapshotHash({cutoff,as_of:produced.calculation.as_of,expires_at:edition.expires_at}),at,edition.expires_at])).rows[0].id;
  };
  return {db,OWNER,MEMBER,editionId,batchId,edition,cards,packets,sourceIds,through,cutoff,expiry,identity,clock,producerInput,stageRpc,
   insertPriceReview,role,
   approveEdition:()=>db.query('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5)',[editionId,editionReviewId,'APPROVE','premium',randomUUID()]),
   priceAction:(produced,id,action='APPROVE')=>db.query('select public.review_daily_ai_price_plan_v1($1,$2,$3,$4)',[produced.candidate.plan_hash,id,action,randomUUID()]),
   readMember:async()=>(await db.query('select public.get_daily_ai_member_research_v1() r')).rows[0].r,
   readMemberPrices:async()=>(await db.query('select public.get_daily_ai_member_price_plans_v1($1) r',[editionId])).rows[0].r,
   readOwnerPrices:async()=>(await db.query('select public.get_daily_ai_owner_price_plans_v1($1) r',[editionId])).rows[0].r,
   close:()=>db.close()};
 }catch(error){await db.close();throw error;}
}
