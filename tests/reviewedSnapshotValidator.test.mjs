import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {validateReviewedAnalysisSnapshot} from '../research/reviewed-snapshot-validator.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const now=Date.parse('2026-11-01T13:30:00Z'),cutoff='2026-11-01T12:00:00Z';
const project=e=>({id:e.id,source:e.source,kind:e.kind,published_at:e.published_at,available_at:e.available_at,time_basis:e.time_basis??'PUBLISHED',first_seen_at:e.first_seen_at??null,as_of:e.as_of??null,evidence_hash:e.evidence_hash??null});
async function makeFixture(){
 const packet_texts={},packet_hashes={},cards=[];
 for(let i=0;i<72;i++){
  const symbol=String(1000+i),financial={id:symbol+':FINANCIAL:one',symbol,kind:'FINANCIAL',source:'https://www.twse.com.tw/synthetic-financial',published_at:'2026-11-01T11:00:00Z',available_at:'2026-11-01T11:30:00Z',content:stable({kind:'EPS',period:'2026-Q3',unit:'TWD_PER_SHARE',alternate_unit:'USD_PER_SHARE',basis:'BASIC_SINGLE_QUARTER',values:{eps:1.32}})};
  const price={...financial,id:symbol+':PRICE:one',kind:'PRICE',source:'https://www.twse.com.tw/synthetic-price',content:stable({date:'2026-10-30',close:123,prior_close:120,volume:5000})};
  const packet={symbol,company:'合成公司'+symbol,cutoff,data_through:'2026-10-30',data_gaps:['INPUT_LIMITATION'],evidence:[financial,price]};
  packet_texts[symbol]=stable(packet);packet_hashes[symbol]=sha(packet_texts[symbol]);
  for(const horizon of ['SHORT','MEDIUM','LONG'])cards.push({symbol,company:packet.company,horizon,status:horizon==='LONG'?'INSUFFICIENT':'WAIT',reason:{text:'只供隔離測試的研究推論',evidence_ids:[financial.id]},counter_evidence:[],confirmation:'等待已揭露資料確認',invalidation:'若新資料否定原論點則停止',gaps:['INPUT_LIMITATION'],sources:[project(financial)],classification:'INFERENCE'});
 }
 const batch={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through:'2026-10-30',packet_texts,packet_hashes,gaps:[]},batchText=stable(batch);
 const body={schema:'DAILY_OFFLINE_REVIEWED_ANALYSIS_V1',provenance:'OFFLINE_REVIEWED',author_ref:'offline-test-author',batch_id:sha(batchText),cutoff,through:batch.through,prepared_at:'2026-11-01T13:00:00Z',expires_at:'2026-11-01T14:00:00Z',packet_hashes,cards,numeric_assertions:[],reference_jobs:[],model_generated:false,model_calls:0,member_published:false,publication_ready:false};
 return {batch,batchText,body};
}
const original=await makeFixture(),fixture=()=>structuredClone(original),run=f=>validateReviewedAnalysisSnapshot(f.batchText,f.body,{now});
function recalc(f){f.batchText=stable(f.batch);f.body.batch_id=sha(f.batchText);f.body.packet_hashes=structuredClone(f.batch.packet_hashes);}
function changePacket(f,mutate){const packet=JSON.parse(f.batch.packet_texts['1000']);mutate(packet);f.batch.packet_texts['1000']=stable(packet);f.batch.packet_hashes['1000']=sha(f.batch.packet_texts['1000']);recalc(f);return packet;}
async function numericFixture(){
 const f=fixture(),card=f.body.cards[0];card.reason.text='2026-Q3原報EPS為1.32元，僅供本次收到後研究。';
 const operand={evidence_id:'1000:FINANCIAL:one',value_path:['values','eps'],period_path:['period'],period:'2026-Q3',unit_path:['unit'],unit:'TWD_PER_SHARE'};
 const assertion={symbol:'1000',horizon:'SHORT',claim_path:'reason',claim_hash:await snapshotHash(card.reason),text_fragment:'1.32',operator:'EQ',left:operand,right:{literal:1.32},expected:true};
 f.body.numeric_assertions=[assertion];return f;
}

test('exact 72x3 offline snapshot passes mechanical checks without model or publication claims',async()=>{
 const f=fixture(),before=stable(f),r=await run(f);assert.equal(r.counts.symbols,72);assert.equal(r.counts.cards,216);assert.equal(r.status,'MECHANICAL_PASS_INDEPENDENT_REVIEW_REQUIRED');assert.equal(r.authorizes_publication,false);assert.equal(r.independent_review_required,true);assert.equal(r.model_calls,0);assert.equal(stable(f),before);
});
test('model-generated or buy-ready snapshots cannot enter the offline route',async()=>{
 for(const field of ['model_generated','member_published','publication_ready']){const f=fixture();f.body[field]=true;await assert.rejects(()=>run(f),/OFFLINE_PROVENANCE/);}
 const f=fixture();f.body.model_calls=1;await assert.rejects(()=>run(f),/OFFLINE_PROVENANCE/);
});
test('unknown body fields and missing author are rejected',async()=>{
 let f=fixture();f.body.receipt={response_id:'invented'};await assert.rejects(()=>run(f),/SNAPSHOT_KEYS/);
 f=fixture();f.body.author_ref=' ';await assert.rejects(()=>run(f),/OFFLINE_AUTHOR/);
});
test('batch hash and caller expected batch commitment must match exact bytes',async()=>{
 let f=fixture();f.body.batch_id='a'.repeat(64);await assert.rejects(()=>run(f),/BATCH_BINDING/);
 f=fixture();await assert.rejects(()=>validateReviewedAnalysisSnapshot(f.batchText,f.body,{now,expected_batch_id:'b'.repeat(64)}),/BATCH_BINDING/);
});
test('partial universe and duplicate horizon fail',async()=>{
 let f=fixture();f.body.cards.pop();await assert.rejects(()=>run(f),/UNIVERSE/);
 f=fixture();f.body.cards[215]=structuredClone(f.body.cards[0]);await assert.rejects(()=>run(f),/CARD_IDENTITY/);
});
test('numeric assertion admission cap rejects more than 4320 declarations before processing',async()=>{
 const f=fixture();f.body.numeric_assertions=Array.from({length:4321},()=>({}));await assert.rejects(()=>run(f),/OFFLINE_UNIVERSE/);
});
test('packet hash, exact symbol/cutoff, and evidence availability stay bound',async()=>{
 let f=fixture();f.body.packet_hashes['1000']='f'.repeat(64);await assert.rejects(()=>run(f),/PACKET_HASHES/);
 f=fixture();f.batch.packet_texts['1000']+=' ';recalc(f);await assert.rejects(()=>run(f),/PACKET_COMMITMENT/);
 f=fixture();changePacket(f,p=>p.evidence[0].available_at='2026-11-01T12:00:00.000001Z');await assert.rejects(()=>run(f),/OFFLINE_EVIDENCE_TIME/);
});
test('future preparation, expiry renewal, missing time, and relative SQL-style times fail',async()=>{
 for(const [field,value]of[['prepared_at','2026-11-01T15:00:00Z'],['expires_at','2026-11-05T12:00:00Z'],['prepared_at',null],['expires_at','now']]){const f=fixture();f.body[field]=value;await assert.rejects(()=>run(f),/OFFLINE_TIME/);}
});
test('the 72-hour expiry bound preserves cutoff microseconds and rejects one microsecond beyond it',async()=>{
 for(const preciseCutoff of ['2026-11-01T12:00:00.123456Z','2026-11-01T20:00:00.123456+08:00']){
  const f=fixture();f.body.cutoff=preciseCutoff;f.batch.cutoff=preciseCutoff;
  for(const symbol of Object.keys(f.batch.packet_texts)){const p=JSON.parse(f.batch.packet_texts[symbol]);p.cutoff=preciseCutoff;f.batch.packet_texts[symbol]=stable(p);f.batch.packet_hashes[symbol]=sha(f.batch.packet_texts[symbol]);}
  recalc(f);f.body.expires_at='2026-11-04T12:00:00.123456Z';assert.equal((await run(f)).authorizes_publication,false);
  f.body.expires_at='2026-11-04T12:00:00.123457Z';await assert.rejects(()=>run(f),/OFFLINE_TIME/);
 }
});
test('company identity, source metadata, raw source leakage, and unknown citation fail',async()=>{
 let f=fixture();f.body.cards[0].company='另一家公司';await assert.rejects(()=>run(f),/CARD_IDENTITY/);
 f=fixture();f.body.cards[0].sources[0].available_at='2026-11-01T10:00:00Z';await assert.rejects(()=>run(f),/SOURCE_BINDING/);
 f=fixture();f.body.cards[0].sources[0].content='private raw text';await assert.rejects(()=>run(f),/SOURCE_KEYS/);
 f=fixture();f.body.cards[0].reason.evidence_ids=['1001:FINANCIAL:one'];await assert.rejects(()=>run(f),/CLAIM_CITATION/);
});
test('an uncited source cannot be smuggled into the published card source list',async()=>{
 const f=fixture(),packet=JSON.parse(f.batch.packet_texts['1000']);f.body.cards[0].sources.push(project(packet.evidence[1]));await assert.rejects(()=>run(f),/SOURCE_BINDING/);
});
test('packet omissions and numeric trading conditions cannot be silently removed or added',async()=>{
 let f=fixture();f.body.cards[0].gaps=[];await assert.rejects(()=>run(f),/CARD_GAPS/);
 f=fixture();f.body.cards[0].confirmation='站上123元';await assert.rejects(()=>run(f),/AI_ANALYSIS_CONDITION_PRICE/);
});
test('reference jobs are opaque unique hash references, never fake receipts',async()=>{
 const f=fixture();f.body.reference_jobs=['a'.repeat(64),'a'.repeat(64)];await assert.rejects(()=>run(f),/REFERENCE_JOBS/);
 f.body.reference_jobs=[{receipt:'fake'}];await assert.rejects(()=>run(f),/REFERENCE_JOBS/);
});
test('declared financial periods reuse the original semantic guard',async()=>{
 const f=fixture();f.body.cards[0].reason.text='2026-Q2原報EPS為1.32元。';await assert.rejects(()=>run(f),/AI_ANALYSIS_FINANCIAL_PERIOD/);
});
test('an exact source numeric assertion is recomputed, but never grants publication',async()=>{
 const f=await numericFixture(),r=await run(f);assert.equal(r.counts.numeric_assertions_verified,1);assert.equal(r.counts.uncovered_numeric_literals,0);assert.equal(r.authorizes_publication,false);assert.equal(r.independent_review_required,true);
});
test('uncovered quoted numbers explicitly require independent review',async()=>{
 const f=await numericFixture();f.body.numeric_assertions=[];const r=await run(f);assert.equal(r.numeric_review_required,true);assert.equal(r.counts.uncovered_numeric_literals,1);assert.equal(r.review_required[0].literal,'1.32');
});
test('fullwidth and Chinese numeric claims cannot evade independent numerical review',async()=>{
 let f=fixture();f.body.cards[0].reason.text='本次資料列示１．３２，仍待核對。';let r=await run(f);assert.equal(r.numeric_review_required,true);assert(r.review_required.some(i=>i.literal==='1.32'));
 f=fixture();f.body.cards[0].reason.text='依來源每股一元，仍需核對。';r=await run(f);assert.equal(r.numeric_review_required,true);assert(r.review_required.some(i=>i.literal==='一元'));
});
test('forged numerical value, claim hash, cited source, or basis is rejected',async()=>{
 let f=await numericFixture();f.body.numeric_assertions[0].right.literal=1.9;await assert.rejects(()=>run(f),/NUMERIC_ASSERTION_FALSE/);
 f=await numericFixture();f.body.numeric_assertions[0].claim_hash='f'.repeat(64);await assert.rejects(()=>run(f),/NUMERIC_CLAIM/);
 f=await numericFixture();f.body.numeric_assertions[0].left.evidence_id='1001:FINANCIAL:one';await assert.rejects(()=>run(f),/NUMERIC_SOURCE/);
 f=await numericFixture();f.body.numeric_assertions[0].left.period='2026-Q2';await assert.rejects(()=>run(f),/NUMERIC_VALUE_OR_BASIS/);
 f=await numericFixture();f.body.numeric_assertions[0].left.unit='USD_PER_SHARE';await assert.rejects(()=>run(f),/NUMERIC_VALUE_OR_BASIS/);
});
test('numeric assertion identifiers cannot alias strings through number or object coercion',async()=>{
 for(const [field,value]of[['symbol',1000],['horizon',['SHORT']],['claim_path',['reason']],['claim_hash',['a'.repeat(64)]],['text_fragment',1.32],['operator',['EQ']]]){
  const f=await numericFixture();f.body.numeric_assertions[0][field]=value;await assert.rejects(()=>run(f),/OFFLINE_NUMERIC_ASSERTION_TYPES/);
 }
});
test('unsafe property paths, nonfinite/string numeric content, and unrelated text fragments fail',async()=>{
 let f=await numericFixture();f.body.numeric_assertions[0].left.value_path=['__proto__','x'];await assert.rejects(()=>run(f),/NUMERIC_PATH/);
 f=await numericFixture();changePacket(f,p=>{const raw=JSON.parse(p.evidence[0].content);raw.values.eps='1.32';p.evidence[0].content=stable(raw);});await assert.rejects(()=>run(f),/NUMERIC_VALUE_OR_BASIS/);
 f=await numericFixture();f.body.numeric_assertions[0].right.literal=Infinity;await assert.rejects(()=>run(f),/NUMERIC_LITERAL|NON_CANONICAL_VALUE/);
 f=await numericFixture();f.body.numeric_assertions[0].text_fragment='not in claim';await assert.rejects(()=>run(f),/NUMERIC_FRAGMENT/);
});
test('different known currency units cannot be treated as comparable numbers',async()=>{
 const f=await numericFixture(),a=f.body.numeric_assertions[0];a.right={...structuredClone(a.left),unit_path:['alternate_unit'],unit:'USD_PER_SHARE'};await assert.rejects(()=>run(f),/NUMERIC_INCOMPATIBLE_UNITS/);
});
test('raw price units can remain unknown, but require unit review instead of fabricated units',async()=>{
 const f=fixture(),card=f.body.cards[0],packet=JSON.parse(f.batch.packet_texts['1000']);card.reason={text:'2026-10-30收盤123，僅供收到後研究。',evidence_ids:['1000:PRICE:one']};card.sources=[project(packet.evidence[1])];
 f.body.numeric_assertions=[{symbol:'1000',horizon:'SHORT',claim_path:'reason',claim_hash:await snapshotHash(card.reason),text_fragment:'123',operator:'EQ',left:{evidence_id:'1000:PRICE:one',value_path:['close'],period_path:['date'],period:'2026-10-30',unit_path:null,unit:null},right:{literal:123},expected:true}];
 const r=await run(f);assert.equal(r.counts.numeric_assertions_verified,1);assert.equal(r.counts.unknown_unit_assertion_operands,1);assert.equal(r.numeric_review_required,true);assert(r.review_required.some(i=>i.code==='NUMERIC_UNIT_INDEPENDENT_REVIEW_REQUIRED'));
});
test('a literal method threshold is not counted as source-proven numeric coverage',async()=>{
 const f=await numericFixture(),card=f.body.cards[0];card.reason.text='2026-Q3原報EPS為1.32元，與方法門檻1比較。';const a=f.body.numeric_assertions[0];a.claim_hash=await snapshotHash(card.reason);a.text_fragment='1.32元，與方法門檻1';a.operator='GT';a.right.literal=1;
 const r=await run(f);assert.equal(r.counts.uncovered_numeric_literals,1);assert(r.review_required.some(i=>i.literal==='1'));
});
test('duplicate numeric assertions are not counted as additional verification',async()=>{
 const f=await numericFixture();f.body.numeric_assertions.push(structuredClone(f.body.numeric_assertions[0]));await assert.rejects(()=>run(f),/NUMERIC_DUPLICATE/);
});
