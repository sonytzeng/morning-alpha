// Local preparation only. Produces a hash-bound Owner document; never writes a
// database, changes publication status or calls an external provider.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {canonical,evaluateCompletedSessionEntry} from '../../research/entry-opportunity.ts';
import {evaluateResearch} from '../../src/features/vnext/researchFunnel.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {parseCompletedResearch} from '../../src/features/vnext/completedResearch.ts';
const [retainedPath,analysisPath,entryInputPath,entryResultPath,editorialPath,outputPath]=process.argv.slice(2);
assert(retainedPath&&analysisPath&&entryInputPath&&entryResultPath&&editorialPath&&outputPath,'SIX_LOCAL_PATHS_REQUIRED');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const retained=read(retainedPath),analysis=read(analysisPath),entryInput=read(entryInputPath),entry=read(entryResultPath),editorial=read(editorialPath);
assert.equal(entryInput.provenance,'REAL_RETAINED');assert.equal(entryInput.evaluation_time,analysis.created_at);
assert.equal(entryInput.data_through,analysis.data_through);assert.equal(editorial.data_through,analysis.data_through);
assert.equal(editorial.evaluated_at,analysis.created_at);assert.equal(retained.inputs.length,72);
assert.deepEqual(await evaluateCompletedSessionEntry(entryInput),entry,'ENTRY_REPLAY_CHANGED');
const results=retained.inputs.flatMap(i=>['SHORT','MEDIUM','LONG'].map(h=>evaluateResearch({...i,cutoff:analysis.created_at},h)));
assert.deepEqual(results,analysis.screening.evaluations,'SCREENING_REPLAY_CHANGED');
const labels={CLOSE_NOT_SUPPORTED:'收盤表現未符合模型條件',FINANCIAL_PERIOD_MISMATCH:'財報期間口徑不一致',FINANCIAL_QUARTER_GAPS:'缺少連續且可比較的季度資料',
 INSTITUTIONAL_DIRECTION_NOT_SUPPORTED:'近十日法人累計方向未符合條件',MISSING_CAPEX_4:'缺少四季可比較資本支出',MISSING_DEMAND_1:'長期需求證據尚未完成確認',
 MISSING_EPS_4:'缺少四季可比較每股盈餘',MISSING_MARGIN_4:'缺少四季可比較毛利率',MISSING_MOAT_1:'競爭優勢證據尚未完成確認',MISSING_VALUATION_1:'估值依據尚未完成確認',
 PARTICIPATION_NOT_ELEVATED:'成交參與未達模型條件',REVENUE_TREND_NOT_SUPPORTED:'連續三個月營收成長未符合條件','VALUATION:NOT_SUPPORTED':'目前估值未通過長期條件'};
const rows=results.map(r=>{
 const input=retained.inputs.find(i=>i.symbol===r.symbol),bar=input.bars.find(b=>b.date===analysis.data_through);
 assert(bar&&bar.close>0,'CLOSE_REQUIRED');assert.equal(r.through,analysis.data_through);
 const sources=[...new Set(r.used.map(f=>f.source).filter(Boolean))];
 // Some long-term rows have no usable model evidence. Preserve the actual
 // observed quote source as context without pretending it fills those gaps.
 if(!sources.length)sources.push(bar.source||bar.source_ref);
 return {symbol:r.symbol,company:r.company,horizon:r.horizon,state:r.state,close:bar.close,reason:r.reason,confirmation:r.confirmation,
  invalidation:r.invalidation,risk:r.risk,gaps:r.reasons.map(g=>labels[g]||g),sources};
});
for(const f of editorial.focus){
 assert(rows.some(r=>r.symbol===f.symbol));
 if(f.plan){const match=entry.candidates.find(c=>c.symbol===f.symbol&&c.strategy==='BREAKOUT_CONTINUATION');
  assert.equal(match?.status,'WAIT_CONFIRMATION');assert(match.plan);
  assert(f.plan.range[0]>=match.plan.reference_range[0]&&f.plan.range[1]<=match.plan.reference_range[1]);
  assert.equal(f.plan.valid_from.slice(0,10),match.plan.not_before);assert.equal(f.plan.valid_until.slice(0,10),match.plan.expires_on);
  assert.equal(f.plan.scenario,match.plan.target);assert(f.plan.stop<=match.plan.stop&&f.plan.stop>0);
 }
}
const source_hash=await snapshotHash([retainedPath,analysisPath,entryInputPath,entryResultPath,editorialPath].map(p=>createHash('sha256').update(readFileSync(p)).digest('hex')));
const body={schema:'VNEXT_COMPLETED_RESEARCH_V1',mode:'AS_OF_RESEARCH',owner_only:true,member_published:false,forward_sample:0,outcome_sample:0,
 data_through:analysis.data_through,evaluated_at:analysis.created_at,source_hash,rows,focus:editorial.focus};
const p_text=canonical(body),p_hash=await snapshotHash(body);
await parseCompletedResearch({schema:'VNEXT_COMPLETED_OWNER_V1',owner_only:true,snapshot_text:p_text,snapshot_hash:p_hash});
writeFileSync(outputPath,JSON.stringify({p_text,p_hash},null,2)+'\n');
console.log(JSON.stringify({data_through:body.data_through,rows:rows.length,symbols:new Set(rows.map(r=>r.symbol)).size,focus:body.focus.length,bytes:Buffer.byteLength(p_text),snapshot_hash:p_hash,production_writes:0}));
