import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseSecQuarterFinancials} from '../../research/sec-quarter-financials.ts';
import {loadApprovedSecDailySeed,replaySecDailyFacts} from './replay-sec-daily-source.mjs';

const cutoff='2026-10-31T09:00:00Z';
const seal=d=>({...d,bytes:Buffer.byteLength(d.body),sha256:createHash('sha256').update(d.body).digest('hex')});
async function fourQuarterFacts(){
 const facts=[];
 for(const [period,quarter,year,month,day,word,accession] of [
  ['2025-Q4',4,2025,'December',31,'fourth','000104617926000008'],
  ['2026-Q1',1,2026,'March',31,'first','000104617926000199'],
  ['2026-Q2',2,2026,'June',30,'second','000104617926000451'],
  ['2026-Q3',3,2026,'September',30,'third','000104617926000726'],
 ]){
  const y=String(year).slice(-2),previous=quarter===1?'4Q'+String(year-1).slice(-2):(quarter-1)+'Q'+y;
  const base={period,received_at:'2026-10-31T08:00:00Z'};
  const release=seal({...base,kind:'release',url:`https://www.sec.gov/Archives/edgar/data/1046179/${accession}/a${quarter}q${y}e_withguidancexfinal.htm`,
   body:`<TYPE>EX-99.1 TSMC (TWSE: 2330, NYSE: TSM) announced diluted earnings per share of NT$2.00 (US$0.30 per ADR unit) for the ${word} quarter ended ${month} ${day}, ${year}. All figures were prepared in accordance with TIFRS on a consolidated basis. Gross margin for the quarter was 60.0%, operating margin was 40.0%, and net profit margin was 35.0%.`});
  const presentation=seal({...base,kind:'presentation',url:`https://www.sec.gov/Archives/edgar/data/1046179/${accession}/a${quarter}q${y}presentatione.htm`,
   body:`<TYPE>EX-99.2 Cash Flows * Free cash flow = Cash from operating activities – Capital expenditures (In NT$ billions) ${quarter}Q${y} ${previous} ${quarter}Q${String(year-1).slice(-2)} Beginning Balance 1.00 Cash from operating activities 100.00 90.00 80.00 Capital expenditures (30.00) (25.00) (20.00) Free Cash Flow * 70.00 65.00 60.00 Guidance`});
  facts.push(...await parseSecQuarterFinancials(release,presentation,cutoff));
 }
 return facts;
}

test('daily retained replay is idempotent and never re-dates an original SEC receipt',async()=>{
 const facts=await fourQuarterFacts(),old={id:'old',kind:'EPS_AS_REPORTED',period:'2026-Q2',values:{value:9},basis:'AS_REPORTED'};
 const input={symbol:'2330',cutoff,facts:[old]},before=structuredClone(input);
 const first=await replaySecDailyFacts(input,facts);
 assert.deepEqual(input,before);assert.equal(first.added,12);assert.equal(first.retained,0);assert.equal(first.input.facts.length,13);
 const nextCutoff='2026-11-01T09:00:00Z',next={...first.input,cutoff:nextCutoff};
 // A JSON/database round trip may reorder object keys, but not their values.
 next.facts=next.facts.map(f=>Object.fromEntries(Object.entries(f).reverse()));
 const second=await replaySecDailyFacts(next,facts);
 assert.equal(second.added,0);assert.equal(second.retained,12);assert.equal(second.input.facts.length,13);
 assert.deepEqual(second.input.facts[0],next.facts[0]);
 for(const original of facts){
  const retained=second.input.facts.find(f=>f.id===original.id);
  assert.deepEqual(retained,original);assert.equal(retained.available_at,'2026-10-31T08:00:00Z');
  assert.equal(retained.source_admitted,false);assert.equal(retained.member_publication_approved,false);
 }
});

test('daily replay refuses revised, duplicated, unreviewed, admitted or future SEC observations',async()=>{
 const facts=await fourQuarterFacts(),base={symbol:'2330',cutoff,facts:[]};
 const merged=(await replaySecDailyFacts(base,facts)).input;
 for(const mutate of [
  i=>{i.facts[0].values.value=999;},
  i=>{i.facts.push(structuredClone(i.facts[0]));},
  i=>{i.facts.push({...structuredClone(i.facts[0]),id:'sec-quarter:2330:2027-Q1:EPS:unreviewed',period:'2027-Q1'});},
  i=>{i.facts[0].source_admitted=true;},
 ]){
  const changed=structuredClone(merged);mutate(changed);
  await assert.rejects(()=>replaySecDailyFacts(changed,facts),/SEC_DAILY_REPLAY_(FACT_CONFLICT|UNREVIEWED_SEC_FACT)/);
 }
 await assert.rejects(()=>replaySecDailyFacts({...base,cutoff:'2026-10-31T07:00:00Z'},facts),/MERGE_CONFLICT/);
 const other={symbol:'2454',cutoff,facts:[{id:'original'}]};
 assert.deepEqual((await replaySecDailyFacts(other,facts)).input,other);
});

test('a different source batch cannot claim the fixed reviewed SEC source seal',()=>{
 for(const raw of ['{}','{"schema":"DAILY_AI_BATCH_INPUT_V1"}','a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb'])
  assert.throws(()=>loadApprovedSecDailySeed(raw),/APPROVED_SEAL/);
});
