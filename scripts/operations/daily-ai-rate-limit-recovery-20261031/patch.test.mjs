import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareRateLimitRecoveryIndex,rateLimitRecoveryPatchReceipt,sha256} from './build-worker-patch.mjs';

const live=JSON.parse(readFileSync(new URL('../../../build/sec-documented-reviews-v2/live16-files.json',import.meta.url),'utf8'));
const index=live.files.find(f=>f.name==='supabase/functions/daily-stock-analysis-v1/index.ts').content;
const prepare=(value=index,baseSha256=sha256(value))=>prepareRateLimitRecoveryIndex(value,{baseSha256});
const handler=readFileSync(new URL('../../../supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-handler.ts',import.meta.url),'utf8');
const runner=readFileSync(new URL('../../../supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-runner.ts',import.meta.url),'utf8');

test('fresh V16 receives a reversible recovery route before overlapping citation-repair selectors',()=>{
 const candidate=prepare(),receipt=rateLimitRecoveryPatchReceipt(index,candidate);
 assert(candidate.indexOf("Object.hasOwn(input,'recovery_symbol')")<candidate.indexOf("Object.hasOwn(input,'repair_symbol')"));
 assert.equal((candidate.match(/handleDailyStockRateLimitRecovery\(req/g)??[]).length,1);
 assert.equal((candidate.match(/runStoredStockAiRateLimitRecovery\(packets/g)??[]).length,1);
 assert(candidate.includes("model='gpt-6-astra'"));assert(candidate.includes('withRetainedSecDailyFinancials'));
 assert.equal(receipt.full_integration_admission,false);assert.equal(receipt.production_change_performed,false);
 assert.equal(receipt.base_index_sha256,sha256(index));assert.equal(receipt.candidate_index_sha256,sha256(candidate));
});
test('composition keeps a separately reviewed V2 adapter byte for byte',()=>{
 const composed=index.replace('const autoContinue=true;','const autoContinue=true;\n// synthetic separately reviewed source adapter\nconst retainedV2Marker="preserved";');
 const candidate=prepare(composed);assert(candidate.includes('const retainedV2Marker="preserved";'));
 assert(candidate.includes('withRetainedSecDailyFinancials'));assert(candidate.includes('repair_symbol'));
});
test('unknown, changed, duplicated and already patched bases fail closed',()=>{
 assert.throws(()=>prepareRateLimitRecoveryIndex(index),/BASELINE_DRIFT/);
 assert.throws(()=>prepare(index+'\n',sha256(index)),/BASELINE_DRIFT/);
 assert.throws(()=>prepare(index.replace("Object.hasOwn(input,'repair_symbol')","Object.hasOwn(input,'different_symbol')")),/CALLSITE_DRIFT/);
 assert.throws(()=>prepare(index+"\nimport {handleDailyStockCitationRepair} from './repair-handler.ts';"),/CALLSITE_DRIFT/);
 assert.throws(()=>prepare(prepare()),/CALLSITE_DRIFT/);
});
test('normal continuation dispatches only a single actual success, never a provider or semantic failure',()=>{
 const candidate=prepare(),condition=candidate.match(/if\((autoContinue&&summary.requires_next_checkpoint[^\n]+)\)\{/)[1];
 const shouldContinue=new Function('autoContinue','summary','return '+condition);
 const summary={requires_next_checkpoint:true,model_calls:1,batch_id:'a'.repeat(64),counts:{COMPLETE:1,FAILED:0}};
 assert.equal(shouldContinue(true,summary),true);
 for(const failed of [{...summary,counts:{COMPLETE:0,FAILED:1}},{...summary,counts:{}},{...summary,counts:undefined},
  {...summary,model_calls:0},{...summary,model_calls:2},{...summary,requires_next_checkpoint:false}])assert.equal(shouldContinue(true,failed),false);
 assert.equal(shouldContinue(false,summary),false);
});
test('recovery source retains original provider implementation and does not enable citation repair or continuation',()=>{
 assert(runner.includes("model:'gpt-6-astra'"));assert(runner.includes("+':recovery-1'"));
 assert(runner.includes('maxStocks:1,onlySymbol:selector.recovery_symbol'));
 assert(runner.includes("ports.rpc('daily_stock_ai_rate_limit_recovery_job_v1'"));
 assert(!/citationRepair:|allFactsCitationRepair:/.test(runner));
 assert(handler.includes('automatic_continuation:false,requires_next_checkpoint:false,member_published:false'));
 assert(!/dispatch_daily|stage_daily|approve_daily/.test(handler));
});
