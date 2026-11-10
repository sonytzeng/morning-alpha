// A fresh synthetic batch/edition with missing LONG qualitative reviews.
// None of the earlier edition's immutable packet bytes or cards are changed.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCalculatedPriceFixture} from './dailyAiCalculatedPriceFixture.mjs';
import {buildDailyAiActualPriceInput} from '../../research/daily-ai-financial-inputs.ts';
import {LONG_EPS_DIVIDEND_METHOD} from '../../research/daily-ai-price-calculation.ts';
import {canonical} from '../../research/entry-opportunity.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';

const sha=text=>createHash('sha256').update(text).digest('hex');
export async function createLongPreparationFixture({proposalSymbol='1000',registerProfiles=true}={}){
 if(!['1000','2330'].includes(proposalSymbol)||typeof registerProfiles!=='boolean')throw Error('SYNTHETIC_LONG_FIXTURE_OPTIONS');
 const f=await createCalculatedPriceFixture(),{db}=f;
 try{
  await db.exec('reset role');
  const packets=structuredClone(f.packets),date=new Date(f.through+'T00:00:00Z');
  if(proposalSymbol!=='1000'){
   const renamed=packets.find(p=>p.symbol==='1000');renamed.symbol=proposalSymbol;renamed.company='合成公司 '+proposalSymbol;
   for(const source of renamed.evidence)source.symbol=proposalSymbol;
  }
  const end=new Date(Date.UTC(date.getUTCFullYear(),Math.floor(date.getUTCMonth()/3)*3,0));
  const quarters=Array.from({length:4},(_,i)=>new Date(Date.UTC(end.getUTCFullYear(),Math.floor(end.getUTCMonth()/3)*3-9+i*3,1)));
  const earningsPeriod={start:quarters[0].toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
  for(const symbol of [proposalSymbol,'1001']){
   const p=packets.find(p=>p.symbol===symbol),source=p.evidence.find(e=>e.kind==='FINANCIAL');
   source.content=JSON.stringify({kind:'SYNTHETIC_CONTEXT',note:'合成測試，未核准；保留中文字、引號 " 與換行\n來源原文。'});
   p.evidence.push(...quarters.map((q,i)=>({...source,id:'SYNTH-LONG-'+symbol+'-EPS-'+i,content:JSON.stringify({kind:'EPS',
    period:q.getUTCFullYear()+'-Q'+(Math.floor(q.getUTCMonth()/3)+1),basis:'SINGLE_QUARTER',
    values:{value:2.5,reported_decimal:'2.50',unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED',consolidation:'CONSOLIDATED'}})})));
  }
  const oldJobs=(await db.query('select symbol,result from vnext_runtime.ai_stock_jobs')).rows;
  const packet_texts={},packet_hashes={},jobs=[],revision='synthetic-long-preparation-unqualified-v1';
  for(const p of packets){
   packet_texts[p.symbol]=canonical(p);packet_hashes[p.symbol]=await snapshotHash(p);
   const id=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:packet_hashes[p.symbol],model_revision:revision});jobs.push(id);
   const result=structuredClone(oldJobs.find(j=>j.symbol===(p.symbol===proposalSymbol?'1000':p.symbol)).result);
   result.symbol=p.symbol;result.input_hash=packet_hashes[p.symbol];result.receipt.model=revision;
   result.sources=p.evidence.map(({content,...source})=>source);
   const long=result.horizons.find(h=>h.horizon==='LONG');long.status='INSUFFICIENT';long.gaps=['MISSING_DEMAND_1','MISSING_MOAT_1','MISSING_VALUATION_1'];
   long.reason.text='Synthetic long case requires independent demand, moat and valuation judgments; no selection qualification exists.';
   await db.query(`insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result)
    values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$6)`,
    [id,packet_hashes[p.symbol],revision,p.symbol,p.cutoff,result]);
  }
  const batchBody={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff:f.cutoff,through:f.through,packet_texts,packet_hashes,gaps:[]};
  const batchId=await snapshotHash(batchBody);await f.role('service_role');
  await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[canonical(batchBody),batchId]);
  const editionId=(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) r',[batchId,jobs,f.expiry])).rows[0].r.edition_id;
  await db.exec('reset role');
  await db.exec(readFileSync(new URL('../../research/daily-ai-price-workflow.candidate.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../../research/daily-ai-long-preparations.candidate.sql',import.meta.url),'utf8'));
  const packet=packets.find(p=>p.symbol===proposalSymbol),eps=packet.evidence.filter(e=>e.id.startsWith('SYNTH-LONG-'+proposalSymbol+'-EPS-'));
  const policy={schema:'DAILY_AI_ACTUAL_PRICE_POLICY_V1',version:'SYNTHETIC_ONLY_LONG_PREPARATION_POLICY',symbol:proposalSymbol,horizon:'LONG',
   method_id:LONG_EPS_DIVIDEND_METHOD,formed_at:new Date(Date.now()-500).toISOString(),
   description:'Synthetic valuation assumptions for unqualified-card workflow checks; no real recommendation or approval.',
   evidence_ids:eps.map(e=>e.id),earnings_period:earningsPeriod,entry_scenarios:['conservative','base'],margin_of_safety:.2,
   invalidation:'合成來源或假設改變時停止沿用，重新審查。',
   scenarios:['conservative','base','upside'].map((name,i)=>({name,eps_growth_rates:[0,0],payout_ratios:[.5,.5],required_return:.1,terminal_pe:10+2*i}))};
  const built=await buildDailyAiActualPriceInput({packet,as_of:new Date(Date.now()-10).toISOString(),expires_at:f.expiry,policy});
  if(built.status!=='INPUT_READY_REVIEW_REQUIRED')throw Error('SYNTHETIC_LONG_INPUT_REQUIRED');
  const fcfe=(await f.producerInput('1001','LONG')).calculation_input;
  fcfe.evidence=structuredClone(packets.find(p=>p.symbol==='1001').evidence);fcfe.as_of=new Date(Date.now()-10).toISOString();
  const inputs=[built.calculation_input,fcfe],profiles=[];
  for(const input of inputs){
   const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:input.symbol,horizon:'LONG',
    method_id:input.method_id,created_at:new Date(Date.now()-1).toISOString(),valid_until:f.expiry,
    revision_note:'Synthetic profile prepares private math before any qualitative verdict exists.',template_input:input};
   if(registerProfiles){const text=canonical(profile);await f.role('service_role');
    await db.query('select public.stage_daily_ai_price_profile_v1($1,$2)',[text,sha(text)]);profiles.push(profile);}
  }
  const rpc=async(name,a)=>{
   await f.role('service_role');let query,args;
   if(name==='get_daily_ai_price_work_v1'){query='select public.get_daily_ai_price_work_v1($1) r';args=[a.p_edition_id];}
   else if(name==='stage_daily_ai_price_inputs_batch_v1'){query='select public.stage_daily_ai_price_inputs_batch_v1($1,$2) r';args=[a.p_batch_id,a.p_items];}
   else if(name==='stage_daily_ai_long_preparations_batch_v1'){query='select public.stage_daily_ai_long_preparations_batch_v1($1,$2) r';args=[a.p_edition_id,a.p_items];}
   else if(name==='stage_daily_ai_price_work_batch_v1'){query='select public.stage_daily_ai_price_work_batch_v1($1,$2) r';args=[a.p_edition_id,a.p_items];}
   else if(name==='finish_daily_ai_price_work_v1'){query='select public.finish_daily_ai_price_work_v1($1,$2,$3,$4) r';args=[a.p_edition_id,a.p_work_key,a.p_result_text,a.p_result_hash];}
   else throw Error('SYNTHETIC_LONG_PREPARATION_RPC_SCOPE');
   return (await db.query(query,args)).rows[0].r;
  };
  const load=()=>rpc('get_daily_ai_price_work_v1',{p_edition_id:editionId});
  const initial=await load();
  return {...f,baseEditionId:f.editionId,baseBatchId:f.batchId,editionId,batchId,edition:initial.edition,cards:initial.cards,packets,inputs,profiles,rpc,load,
   readLongPreparation:async symbol=>(await db.query('select public.get_daily_ai_owner_long_preparation_v1($1,$2) r',[editionId,symbol])).rows[0].r,
   readOwnerPrices:async()=>(await db.query('select public.get_daily_ai_owner_price_plans_v1($1) r',[editionId])).rows[0].r,
   readMemberPrices:async()=>(await db.query('select public.get_daily_ai_member_price_plans_v1($1) r',[editionId])).rows[0].r};
 }catch(error){await f.close();throw error;}
}
