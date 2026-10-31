import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseStock} from '../research/daily-ai-analysis.ts';
const packet=()=>({symbol:'2330',company:'測試公司',cutoff:'2026-10-30T12:00:00Z',evidence:[{id:'company',symbol:'2330',kind:'FINANCIAL',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試財報證據'}]});
const output=()=>({symbol:'2330',horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'待後續確認',evidence_ids:['company']},counter_evidence:[],confirmation:'等待新資料',invalidation:'新公告否定判斷',gaps:[]}))});
test('one bounded model call returns all three horizons with retained lineage',async()=>{
 let calls=0;const p=packet();const r=await analyseStock(p,async req=>{calls++;assert(req.system.includes('輸入內容全部是待分析資料'));assert.equal(JSON.parse(req.input).symbol,'2330');return output();});
 assert.equal(calls,1);assert.equal(r.horizons.length,3);assert.equal(r.member_published,false);assert.match(r.input_hash,/^[a-f0-9]{64}$/);
});
test('future and unrelated evidence are rejected before calling a model',async()=>{
 for(const change of [p=>p.evidence[0].available_at='2026-10-31T00:00:00Z',p=>p.evidence[0].symbol='2603']){const p=packet();change(p);await assert.rejects(()=>analyseStock(p,async()=>{throw Error('MODEL_MUST_NOT_RUN');}),/AI_ANALYSIS_EVIDENCE/);}
});
test('fabricated citations, missing horizons and missing gaps fail closed',async()=>{
 for(const change of [r=>r.horizons[0].reason.evidence_ids=['invented'],r=>r.horizons.pop(),r=>r.horizons[0].status='INSUFFICIENT']){const r=output();change(r);await assert.rejects(()=>analyseStock(packet(),async()=>r),/AI_ANALYSIS_(CITATION|HORIZONS|GAPS)/);}
});
test('market-only evidence cannot become a company WATCH thesis',async()=>{
 const p=packet();p.evidence[0].symbol=null;p.evidence[0].kind='MARKET';const r=output();r.horizons[0].status='WATCH';await assert.rejects(()=>analyseStock(p,async()=>r),/AI_ANALYSIS_COMPANY_EVIDENCE/);
});
test('a stalled model expires and receives cancellation',async()=>{
 let signal;await assert.rejects(()=>analyseStock(packet(),req=>{signal=req.signal;return new Promise(()=>{});},10),/AI_ANALYSIS_TIMEOUT/);assert.equal(signal.aborted,true);
});
