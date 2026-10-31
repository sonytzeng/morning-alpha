import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateStockAnalysisClaim} from '../research/daily-ai-semantics.ts';
import {validateAnalysisPacket} from '../research/daily-ai-analysis.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/daily-ai-mops-period-scopes.json',import.meta.url),'utf8'));
const packet=s=>structuredClone(fixture.packets[s]);
const id2454=fixture.packets['2454'].evidence.find(e=>e.id.includes('bc7ef105')).id;
const id3189=fixture.packets['3189'].evidence.find(e=>e.id.includes('5760d903')).id;
const check=(p,text,ids)=>validateStockAnalysisClaim(p,{text,evidence_ids:ids});
test('retained official scope fixtures preserve actual source content hashes and valid packet lineage',()=>{
 for(const p of Object.values(fixture.packets)){
  validateAnalysisPacket(p);
  for(const e of p.evidence.filter(e=>e.kind==='NEWS'))assert.equal(createHash('sha256').update(e.content).digest('hex'),e.evidence_hash);
 }
});
test('official company guidance remains separate from actual quarters and supports only disclosed metric lines',()=>{
 const p=packet('2454');
 for(const text of [
  '公司2026-Q4營收展望為2,101億至2,218億元，屬公司預測而非實績。',
  '公司2026-Q3實績EPS為17.50元，公司預測2026-Q4營收為2,101億至2,218億元。',
  '2026-Q4公司毛利率展望為45%上下1.5個百分點，低於2026-Q3實績46.3%。',
  '公司2026-Q4營業費用率展望為26%上下2個百分點。',
 ])assert.doesNotThrow(()=>check(p,text,[id2454]));
 for(const text of [
  '公司2026-Q4營收已實現2,101億元，但公司展望仍待確認。',
  '公司2026-Q4營收已錄得2,101億元，符合公司預估。',
  '公司2026-Q4營收已入帳2,101億元，與公司預期一致。',
  '公司2026-Q4營收展望為2,101億元，這是實際結果。',
  '公司2026-Q4營收展望為2,101億元，已非預估而是結算結果。',
  '公司2026-Q4預估資本支出100億元。',
  '公司2026-Q4營收展望為2,101億元，資本支出預估50億元。',
  '公司2026-Q4財務展望為100億元。',
  '公司2026-Q4 EPS展望為17.50元。',
  '高盛公司預估聯發科2026-Q4營收為2,101億元。',
  '台積電公司預估2026-Q4營收為2,101億元。',
  '公司2027-Q4營收展望為2,101億元。',
  '公司預估2026-Q3 EPS為17.50元。',
 ])assert.throws(()=>check(p,text,[id2454]),/AI_ANALYSIS_/);
});
test('guidance admission requires the exact cited official issuer, receipt, heading and untruncated source',()=>{
 for(const edit of [
  (e,c)=>{e.symbol='2330';},(e,c)=>{e.source='https://example.test/report';},
  (e,c)=>{c.source_metadata.company_code='2330';},(e,c)=>{c.provider='GNEWS';},
  (e,c)=>{c.source_received_at='2026-10-31T00:00:00Z';},(e,c)=>{c.excerpt_truncated=true;},
  (e,c)=>{c.title='公告召開董事會';},(e,c)=>{c.excerpt=c.excerpt.replace('2026年第四季營運展望','匯率假設');},
 ]){
  const p=packet('2454'),e=p.evidence.find(e=>e.id===id2454),c=JSON.parse(e.content);edit(e,c);e.content=JSON.stringify(c);
  assert.throws(()=>check(p,'公司2026-Q4營收展望為2,101億元。',[id2454]),/AI_ANALYSIS_/);
 }
 assert.throws(()=>check(packet('2454'),'公司2026-Q4營收展望為2,101億元。',[]),/AI_ANALYSIS_/);
});
test('YTD endpoints require a positive cumulative metric and matching local quarter without becoming monthly EPS',()=>{
 const p=packet('3189'),q2=p.evidence.find(e=>e.kind==='FINANCIAL').id;
 for(const text of [
  '2026-Q3公告明載2026-01至2026-09累計基本每股盈餘8.38元。',
  '2026-Q3財報公告列示2026-01-01至2026-09-30累計EPS8.38元。',
  '2026-Q3公告累計EPS為8.38元，不是單季。',
  '2026-Q3累計歸母淨利4,247,778仟元（2026-01至2026-09）。',
 ])assert.doesNotThrow(()=>check(p,text,[id3189]));
 for(const text of [
  '2026-01至2026-09每月EPS均為8.38元且累計數不明。',
  '2026-01至2026-09 EPS為8.38元（非累計）。',
  '2026-Q3 EPS為8.38元，不是累計。',
  '2026-Q3各月EPS均為8.38元，累計資料另列。',
  '2026-Q2公告明載2026-01至2026-09累計EPS8.38元。',
  '2026-Q2的2026-01至2026-09累計基本每股盈餘為8.38元。',
  '2026-01 EPS為8.38元。','2026-09 EPS為8.38元。',
  '2026-Q3公告2026-01至2026-09累計EPS8.38元，2026-09 EPS為8.38元。',
  '2026-Q3公告明載2026-02至2026-09累計EPS8.38元。',
 ])assert.throws(()=>check(p,text,[id3189,q2]),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 assert.throws(()=>check(p,'2026-01至2026-09累計EPS8.38元。',[q2]),/AI_ANALYSIS_/);
});
