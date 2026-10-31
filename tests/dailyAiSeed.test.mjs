import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyAiSeed,canonical,snapshotHash} from '../research/build-daily-ai-seed.mjs';
import {buildDailyAiSeed as buildServerSeed} from '../research/daily-ai-seed.ts';
const inputs=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司',cutoff:'2026-10-30T12:00:00Z',through:'2026-10-30',next_session:'2026-11-02',v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},
 expected_sessions:['2026-10-30'],facts:[],bars:[{id:'bar',source:'https://www.twse.com.tw/',published_at:null,first_seen_at:'2026-10-30T12:00:00Z',available_at:'2026-10-30T12:00:00Z',as_of:'2026-10-30T05:30:00Z',evidence_hash:'a'.repeat(64),date:'2026-10-30',open:10,high:12,low:9,close:11,volume:1000,amount:11000,session_scope:'TEST'}]}));
test('seed stores canonical per-symbol packets once with exact independent hashes',async()=>{
 const seed=await buildDailyAiSeed({inputs:inputs(),cutoff:'2026-10-31T03:00:00Z'}),body=JSON.parse(seed.payload_text);
 assert.equal(body.schema,'DAILY_AI_BATCH_INPUT_V1');assert(!Object.hasOwn(body,'packets'));
 assert.equal(Object.keys(body.packet_texts).length,72);assert.equal(Object.keys(body.packet_hashes).length,72);
 assert.equal(seed.payload_text,canonical(body));assert.equal(seed.metadata.payload_hash,await snapshotHash(body));
 for(const [symbol,text] of Object.entries(body.packet_texts)){
  const packet=JSON.parse(text);assert.equal(packet.symbol,symbol);assert.equal(text,canonical(packet));assert.equal(body.packet_hashes[symbol],await snapshotHash(packet));
 }
 assert.equal(seed.metadata.model_calls,0);assert.equal(seed.metadata.production_writes,0);assert.equal(seed.metadata.published_time_unknown,72);
});
test('different cutoffs or source values yield distinct batch identities',async()=>{
 const a=await buildDailyAiSeed({inputs:inputs(),cutoff:'2026-10-31T03:00:00Z'});
 const b=await buildDailyAiSeed({inputs:inputs(),cutoff:'2026-10-31T03:01:00Z'});
 assert.notEqual(a.metadata.payload_hash,b.metadata.payload_hash);
 const changed=inputs();changed[0].bars[0].amount=12000;
 const c=await buildDailyAiSeed({inputs:changed,cutoff:'2026-10-31T03:00:00Z'});
 assert.notEqual(a.body.packet_hashes['1000'],c.body.packet_hashes['1000']);assert.equal(a.body.packet_hashes['1001'],c.body.packet_hashes['1001']);
});
test('pure server compiler matches CLI bytes and hashes while retaining intake limitations',async()=>{
 const input={inputs:inputs(),cutoff:'2026-10-31T03:00:00Z'};
 assert.deepEqual(await buildServerSeed(input),await buildDailyAiSeed(input));
 const seed=await buildServerSeed({...input,additionalGaps:['NEWS_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE','SOURCE_INGEST_FINANCIAL_YTD_FINANCIAL_RESPONSE_PERIOD_UNPROVEN']});
 for(const text of Object.values(seed.body.packet_texts)){
  const packet=JSON.parse(text);assert(packet.data_gaps.includes('NEWS_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE'));
  assert(packet.data_gaps.includes('SOURCE_INGEST_FINANCIAL_YTD_FINANCIAL_RESPONSE_PERIOD_UNPROVEN'));
 }
 const limited=await buildServerSeed({...input,additionalGaps:Array.from({length:150},(_,i)=>'SOURCE_LIMIT_'+i)});
 assert.equal(JSON.parse(limited.body.packet_texts['1000']).data_gaps.length,100);
 assert(limited.body.gaps['1000'].includes('SOURCE_ISSUE_LIMIT_DETAILS_NOT_INCLUDED'));
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>buildServerSeed({...input,signal:controller.signal}),/AI_SEED_ABORTED/);
});
test('receipt seed preserves original source identity without relabeling underlying data dates',async()=>{
 const sourceHandoff={handoff_id:'c'.repeat(64),source_run_id:'11111111-1111-4111-8111-111111111111',source_revision:'d'.repeat(64),
  source_cutoff:'2026-10-30T12:00:00Z',source_business_date:'2026-10-30',projection:'DAILY_AI_RETAINED_INPUT_PROJECTION_V1'};
 const seed=await buildServerSeed({inputs:inputs(),cutoff:'2026-10-31T03:00:00.123456Z',sourceHandoff,
  additionalGaps:['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE']});
 assert.deepEqual(seed.body.source_handoff,sourceHandoff);assert.equal(seed.body.cutoff,'2026-10-31T03:00:00.123456Z');assert.equal(seed.body.through,'2026-10-30');
 const p=JSON.parse(seed.body.packet_texts['1000']);assert.equal(p.evidence[0].available_at,'2026-10-30T12:00:00Z');assert.equal(p.evidence[0].published_at,null);
 assert.equal(p.cutoff,seed.body.cutoff);assert.equal(p.data_through,'2026-10-30');
 const changed=await buildServerSeed({inputs:inputs(),cutoff:seed.body.cutoff,sourceHandoff:{...sourceHandoff,source_revision:'e'.repeat(64)},
  additionalGaps:['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE']});
 assert.notEqual(changed.metadata.payload_hash,seed.metadata.payload_hash);assert.deepEqual(changed.body.packet_hashes,seed.body.packet_hashes);
});
test('six intake limitations plus 1600 normalized source issues remain bounded with an explicit omission gap',async()=>{
 const additionalGaps=Array.from({length:1606},(_,i)=>'SOURCE_LIMIT_'+i),seed=await buildServerSeed({inputs:inputs(),cutoff:'2026-10-31T03:00:00Z',additionalGaps});
 for(const text of Object.values(seed.body.packet_texts)){
  const packet=JSON.parse(text);assert.equal(packet.data_gaps.length,100);assert(packet.data_gaps.includes('SOURCE_ISSUE_LIMIT_DETAILS_NOT_INCLUDED'));
 }
 await assert.rejects(()=>buildServerSeed({inputs:inputs(),cutoff:'2026-10-31T03:00:00Z',additionalGaps:Array.from({length:2049},(_,i)=>'EXCESS_'+i)}),/AI_SEED_GAPS/);
});
test('mandatory global and per-stock limitations survive many ingestion issue details',async()=>{
 const mandatory=['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS',
  'NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES','MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE','NEWS_NONE_AVAILABLE_WITHIN_48H'];
 const personal=Array.from({length:20},(_,i)=>'PRICE_SOURCE_GAP_'+i);
 const additionalGaps=[...Array.from({length:1600},(_,i)=>'SOURCE_INGEST_KIND_REASON_'+i),...mandatory];
 const seed=await buildServerSeed({inputs:inputs(),cutoff:'2026-10-31T03:00:00Z',additionalGaps,gapsBySymbol:{'1000':personal}});
 const packet=JSON.parse(seed.body.packet_texts['1000']);assert.equal(packet.data_gaps.length,100);
 for(const gap of [...mandatory,...personal])assert(packet.data_gaps.includes(gap),gap);
 assert(packet.data_gaps.includes('SOURCE_ISSUE_LIMIT_DETAILS_NOT_INCLUDED'));
 assert(!JSON.parse(seed.body.packet_texts['1001']).data_gaps.includes(personal[0]));
 await assert.rejects(()=>buildServerSeed({inputs:inputs(),cutoff:'2026-10-31T03:00:00Z',gapsBySymbol:{'9999':['UNKNOWN_SYMBOL']}}),/AI_SEED_SYMBOL_GAPS/);
});
