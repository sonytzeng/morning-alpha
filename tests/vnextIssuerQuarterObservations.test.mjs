import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseIssuerQuarterText,withIssuerQuarterObservations} from '../research/issuer-quarter-observations.ts';
import {readIssuerObservations} from '../scripts/vnext/issuer-quarter-observations.mjs';
const cutoff='2026-10-29T17:00:00Z';
const doc=()=>({symbol:'2454',period:'2026-Q2',format:'MEDIATEK_STATEMENTS',source:'https://www.mediatek.com/hubfs/MediaTek%20Assets/Pdfs/Quarterly%20Earnings%20Release/2026/Quarterly%20Earnings%20Release-2026Q2/Financial%20Statements.pdf',sha256:'a'.repeat(64),bytes:200,received_at:'2026-10-29T16:00:00Z',
 text:'MEDIATEK INC. AND SUBSIDIARIES CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME For the Second quarter of year 2026 Unit: Millions of New Taiwan dollars Yearly Comparison Sequential Comparison 2Q 2026 2Q 2025 YoY% 2Q 2026 1Q 2026 QoQ% Basic Earnings Per Share (NTD) 12.34 13.45 12.34 10.23\fFor the six months ended June 30, 2026 Basic Earnings Per Share (NTD) 22.57 25.31'});
test('direct quarter/basic EPS stays separate from YTD, receipt and publication',async()=>{
 const [f]=await parseIssuerQuarterText(doc(),cutoff);assert.equal(f.values.value,12.34);assert.equal(f.values.measurement_basis,'BASIC');assert.equal(f.values.unit,'TWD_PER_COMMON_SHARE');
 assert.equal(f.published_at,null);assert.equal(f.first_seen_at,doc().received_at);assert.equal(f.source_locator.page,1);assert.equal(f.member_publication_approved,false);assert.equal(f.source_admitted,false);
});
test('wrong period, shifted columns, YTD page and foreign issuer are rejected',async()=>{
 for(const change of [d=>d.period='2026-Q1',d=>d.text=d.text.replace('2Q 2026 2Q 2025','2Q 2025 2Q 2026'),d=>d.text=d.text.split('\f')[1],d=>d.text=d.text.replace('12.34 10.23','99.99 10.23'),d=>d.symbol='2379']){
  const d=doc();change(d);await assert.rejects(parseIssuerQuarterText(d,cutoff),/DOCUMENT_INVALID/);
 }
});
test('retrieval is neither a historical publication time nor pre-release knowledge',async()=>{
 for(const change of [d=>d.received_at='2026-10-29T18:00:00Z',d=>d.received_at='2026-06-01T00:00:00Z',d=>d.source+='?unreviewed=1',d=>d.sha256='bad',d=>d.bytes=9_000_000]){
  const d=doc();change(d);await assert.rejects(parseIssuerQuarterText(d,cutoff),/DOCUMENT_INVALID/);
 }
});
test('TIFRS reported margin selects current quarter, not the annual or adjusted table',async()=>{
 const d={...doc(),format:'MEDIATEK_RELEASE',source:doc().source.replace('Financial%20Statements','Press%20Release'),text:'Taiwan-International Financial Reporting Standards (TIFRS) Consolidated Income Statement (Percentage of Revenue) 2Q26 1Q26 2Q25 Gross profit 45.1% 46.2% 47.3%\fNon-TIFRS Consolidated Income Statement (Percentage of Revenue) 2Q26 1Q26 2Q25 Gross profit 99.9% 98.9% 97.9%'};
 const [f]=await parseIssuerQuarterText(d,cutoff);assert.equal(f.kind,'MARGIN');assert.equal(f.values.value,45.1);
 await assert.rejects(parseIssuerQuarterText({...d,text:d.text.replace('2Q26 1Q26 2Q25','2026 2025 2024')},cutoff),/DOCUMENT_INVALID/);
});
test('Realtek keeps directly reported diluted EPS and basic EPS in separate families',async()=>{
 const d={...doc(),symbol:'2379',format:'REALTEK_STATEMENTS',source:'https://www.realtek.com/images/cqfs/_.2026.FS.AllReport.ENG.IFRS.20260630.pdf',text:'REALTEK SEMICONDUCTOR CORPORATION AND SUBSIDIARIES CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME FOR THE THREE-MONTH AND SIX-MONTH PERIODS ENDED JUNE 30, 2026 AND 2025 (Expressed in thousands of New Taiwan dollars, except for earnings per share amount) Three-month periods ended June 30 Six-month periods ended June 30 2026 2025 2026 2025 Items 9750 Basic earnings per share 6(29) $ 8.12 $ 9.13 $ 17.25 $ 18.25 9850 Diluted earnings per share 6(29) $ 8.01 $ 9.01 $ 17.02 $ 18.02'};
 const f=await parseIssuerQuarterText(d,cutoff);assert.equal(f.find(x=>x.kind==='EPS').values.value,8.01);assert.equal(f.find(x=>x.kind==='EPS_BASIC_CONTEXT').values.value,8.12);assert(!f.some(x=>x.kind==='CAPEX'));
 assert.equal((await parseIssuerQuarterText({...d,text:d.text.replaceAll('-month periods',' months')},cutoff))[0].values.value,8.01);
 await assert.rejects(parseIssuerQuarterText({...d,text:d.text.replace('2026 2025 2026 2025 Items','2025 2026 2025 2026 Items')},cutoff),/DOCUMENT_INVALID/);
});
test('merging preserves original input, missing capex, and fails on duplicate or mixed EPS',async()=>{
 const f=await parseIssuerQuarterText(doc(),cutoff),input={symbol:'2454',cutoff,facts:[]},before=JSON.stringify(input);
 const merged=withIssuerQuarterObservations(input,f);assert.equal(JSON.stringify(input),before);assert.equal(merged.facts.length,1);assert(!merged.facts.some(x=>x.kind==='CAPEX'));
 assert.throws(()=>withIssuerQuarterObservations(merged,f),/MERGE_CONFLICT/);
 assert.throws(()=>withIssuerQuarterObservations({...input,cutoff:'2026-10-28T17:00:00Z'},f),/MERGE_CONFLICT/);
 const old={...f[0],period:'2026-Q1',values:{...f[0].values,measurement_basis:'DILUTED'}};
 assert.throws(()=>withIssuerQuarterObservations({...input,facts:[old]},f),/MEASUREMENT_MISMATCH/);
});
test('loader rejects tampered PDF bytes before extracting text',async()=>{
 const path=mkdtempSync(join(tmpdir(),'issuer-pdf-'));
 try{
  writeFileSync(join(path,'x.pdf'),'%PDF-tampered');writeFileSync(join(path,'receipt.json'),JSON.stringify({status:200,url:doc().source,final_url:doc().source,sha256:'a'.repeat(64),bytes:13}));
  writeFileSync(join(path,'manifest.json'),JSON.stringify({schema:'RETAINED_ISSUER_PDF_INPUTS_V1',documents:[{pdf:'x.pdf',receipt:'receipt.json',symbol:'2454',period:'2026-Q2',format:'MEDIATEK_STATEMENTS'}]}));
  await assert.rejects(readIssuerObservations(join(path,'manifest.json'),cutoff),/RECEIPT_MISMATCH/);
 }finally{rmSync(path,{recursive:true,force:true});}
});
