import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {prepareSecWorkerIndex,LIVE15_INDEX_SHA256} from './build-worker-candidate.mjs';
import {SEC_RETAINED_FACTS_SHA256,SEC_RETAINED_DOCUMENTS_SHA256} from '../../../research/sec-daily-financial-replay.candidate.ts';
const sha=s=>createHash('sha256').update(s).digest('hex');
const baseline=await readFile(new URL('./live15-baseline/supabase__functions__daily-stock-analysis-v1__index.ts',import.meta.url),'utf8');

test('worker candidate is precisely two SOURCE wiring and two erased type changes on live V15',()=>{
 assert.equal(sha(baseline),LIVE15_INDEX_SHA256);
 const candidate=prepareSecWorkerIndex(baseline);
 assert.equal(candidate.split('i?:RequestInit').length,3);
 const wiredOnly=candidate.replaceAll('i?:RequestInit','i?:Parameters<typeof fetch>[1]');
 const emit=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 assert.equal(emit(candidate),emit(wiredOnly),'both parameter annotations erase to exactly the same JavaScript');
 const restored=wiredOnly.replace("\nimport {withRetainedSecDailyFinancials} from '../../../research/sec-daily-financial-replay.candidate.ts';",'')
  .replace("refreshFinancials:withRetainedSecDailyFinancials(refreshDailyAiFinancials,(args,registrySignal)=>rpc('load_daily_stock_ai_sec_replay_v1',args,registrySignal)),",'refreshFinancials:refreshDailyAiFinancials,');
 assert.equal(restored,baseline);
 assert.equal(candidate.endsWith('\n\n'),baseline.endsWith('\n\n'));
 assert.equal(candidate.endsWith('\n'),baseline.endsWith('\n'));
 assert.throws(()=>prepareSecWorkerIndex(baseline+'\n'),/LIVE15_DRIFT/);
 assert(candidate.includes('repair_symbol'));assert(candidate.includes('autoContinue=true'));
 assert(candidate.includes('AbortSignal.any([i.signal,timeout])'));
});

test('SQL candidate seals exact source texts and changes only the pinned SOURCE validator call',async()=>{
 const sql=await readFile(new URL('./retained-sec-daily-v1.candidate.sql',import.meta.url),'utf8');
 const facts=sql.match(/\$sec_facts\$([\s\S]*?)\$sec_facts\$/)[1];
 const docs=sql.match(/\$sec_documents\$([\s\S]*?)\$sec_documents\$/)[1];
 assert.equal(sha(facts),SEC_RETAINED_FACTS_SHA256);assert.equal(sha(docs),SEC_RETAINED_DOCUMENTS_SHA256);
 assert.equal(JSON.parse(facts).length,12);assert.equal(JSON.parse(docs).length,8);
 const funcs=JSON.parse(await readFile(new URL('./live15-baseline/functions.json',import.meta.url),'utf8'));
 for(const name of ['daily_stock_ai_intake_v1','validate_daily_ai_financial_refresh_v5','project_daily_stock_ai_inputs_v1']){
  const f=funcs.find(f=>f.proname===name);assert.equal(sha(f.definition),f.definition_sha256);assert(sql.includes(f.definition_sha256));
 }
 const original=funcs.find(f=>f.proname==='daily_stock_ai_intake_v1').definition;
 const needle='vnext_runtime.validate_daily_ai_financial_refresh_v5(';
 assert.equal(original.split(needle).length,2);
 assert(sql.includes(sha(original.replace(needle,'vnext_runtime.validate_daily_ai_financial_refresh_sec_v1('))));
 assert(!/create(?:\s+or\s+replace)?\s+function\s+vnext_runtime\.validate_daily_ai_financial_refresh_v5\b/i.test(sql));
 assert(/enable row level security/i.test(sql));assert(/before update or delete or truncate/i.test(sql));
 assert(/SEC_REPLAY_PROJECTION_TRUNCATED/.test(sql));
 assert.equal((sql.match(/grant execute/gi)??[]).length,1);
 assert(/grant execute on function public\.load_daily_stock_ai_sec_replay_v1\(text,timestamptz\) to service_role;/i.test(sql));
});
