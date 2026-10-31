import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseSecQuarterFinancials,withSecQuarterFinancials} from '../research/sec-quarter-financials.ts';
const cutoff='2026-10-31T09:00:00Z';
const pair=()=>{
 const base={period:'2026-Q3',received_at:'2026-10-31T08:00:00Z'};
 const release='<TYPE>EX-99.1<div>TSMC (TWSE: 2330, NYSE: TSM) announced diluted earnings per share of NT$2.00 (US$0.30 per ADR unit) for the third quarter ended September 30, 2026. All figures were prepared in accordance with TIFRS on a consolidated basis. Gross margin for the quarter was 60.0%, operating margin was 40.0%, and net profit margin was 35.0%.</div>';
 const presentation='<TYPE>EX-99.2<div>Cash Flows * Free cash flow = Cash from operating activities – Capital expenditures (In NT$ billions) 3Q26 2Q26 3Q25 Beginning Balance 1.00 Cash from operating activities 100.00 90.00 80.00 Capital expenditures (30.00) (25.00) (20.00) Free Cash Flow * 70.00 65.00 60.00 Guidance</div>';
 return ['release','presentation'].map((kind,i)=>seal({...base,kind,url:'https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/'+(i?'a3q26presentatione.htm':'a3q26e_withguidancexfinal.htm'),body:i?presentation:release}));
};
const seal=d=>({...d,bytes:Buffer.byteLength(d.body),sha256:createHash('sha256').update(d.body).digest('hex')});
test('direct standalone EPS, margin and actual capex retain SEC provenance, units and cash-flow rounding',async()=>{
 const p=pair(),before=JSON.stringify(p),facts=await parseSecQuarterFinancials(...p,cutoff);
 assert.deepEqual(facts.map(f=>f.kind),['EPS','MARGIN','CAPEX']);assert.equal(facts[0].values.value,2);
 assert.equal(facts[0].values.measurement_basis,'DILUTED');assert.equal(facts[0].values.unit,'TWD_PER_COMMON_SHARE');
 assert.equal(facts[0].values.assurance,'ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED');
 assert.equal(facts[2].values.value,30e9);assert.equal(facts[2].values.operating_cashflow_twd,100e9);
 assert(facts.every(f=>f.basis==='SINGLE_QUARTER'&&f.source_admitted===false&&f.member_publication_approved===false&&f.published_at===null));
 assert.equal(JSON.stringify(p),before);
});
test('a filed earnings release is not relabelled audited or subsequently board-approved',async()=>{
 const p=pair();p[0]=seal({...p[0],body:p[0].body+'<p>a: 3Q2026 figures have not been approved by Board of Directors</p>'});
 const facts=await parseSecQuarterFinancials(...p,cutoff);
 assert(facts.every(f=>f.values.board_approval_at_release==='NOT_APPROVED'&&f.values.subsequent_revision_review==='NOT_PERFORMED'));
});
test('a changed raw byte, foreign host, wrong issuer, ADR EPS or cumulative period cannot become single-quarter actuals',async()=>{
 for(const mutate of [
  p=>{p[0].body+=' ';},p=>{p[0].url=p[0].url.replace('www.sec.gov','example.test');},
  p=>{p[0]=seal({...p[0],body:p[0].body.replace('TWSE: 2330','TWSE: 2454')});},
  p=>{p[0]=seal({...p[0],body:p[0].body.replace('per share of NT$','per ADR of US$')});},
  p=>{p[0]=seal({...p[0],body:p[0].body.replace('third quarter ended','nine months ended')});},
  p=>{p[0].received_at='2026-11-01T08:00:00Z';},p=>{p[1].url=p[1].url.replace('000104617926000726','000104617926000451');},
 ]){const p=pair();mutate(p);await assert.rejects(()=>parseSecQuarterFinancials(...p,cutoff));}
});
test('cash flow must use the current-quarter column, TWD billions and explicitly named capital expenditure',async()=>{
 for(const [from,to] of [['(In NT$ billions)','(In US$ billions)'],['3Q26 2Q26 3Q25','2Q26 3Q26 3Q25'],
  ['Capital expenditures (30.00)','Cash from investing activities (30.00)'],['Free Cash Flow * 70.00','Free Cash Flow * 71.00']]){
  const p=pair();p[1]=seal({...p[1],body:p[1].body.replace(from,to)});await assert.rejects(()=>parseSecQuarterFinancials(...p,cutoff));
 }
});
test('new input merge preserves old as-reported EPS and rejects duplicate or altered direct actuals',async()=>{
 const facts=await parseSecQuarterFinancials(...pair(),cutoff),old={id:'old',kind:'EPS_AS_REPORTED',period:'2026-Q2',values:{value:9},basis:'AS_REPORTED'};
 const input={symbol:'2330',cutoff,facts:[old]};const before=JSON.stringify(input),next=await withSecQuarterFinancials(input,facts);
 assert.equal(JSON.stringify(input),before);assert.deepEqual(next.facts[0],old);assert.equal(next.facts.length,4);
 await assert.rejects(()=>withSecQuarterFinancials(next,facts),/MERGE_CONFLICT/);
 const tampered=structuredClone(facts);tampered[0].values.value=999;await assert.rejects(()=>withSecQuarterFinancials(input,tampered),/FACT_DRIFT/);
 await assert.rejects(()=>withSecQuarterFinancials({...input,cutoff:'2026-10-31T07:00:00Z'},facts),/MERGE_CONFLICT/);
});
