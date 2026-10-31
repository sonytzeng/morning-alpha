import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseStockWithProvider,dailyStockAnalysisResponseFormat} from '../supabase/functions/_shared/daily-stock-ai.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {stockAiModelRevision} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';
const packet={symbol:'2330',company:'測試公司',cutoff:'2026-10-30T12:00:00Z',evidence:[{id:'E1',symbol:'2330',kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試資料，不是真實股票分析'}]};
const output={symbol:'2330',horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'等待確認',evidence_ids:['E1']},counter_evidence:[],confirmation:'等待新公告',invalidation:'新證據否定判斷',gaps:[]}))};
const result=()=>({id:'test-provider-receipt',model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:100}});
test('server adapter sends evidence once and retains usage without leaking credentials',async()=>{
 const r=await analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'test-model',fetcher:async(url,request)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(request.headers.Authorization,'Bearer test-only-key');
  const body=JSON.parse(request.body);assert.equal(JSON.parse(body.messages[1].content).symbol,'2330');
  assert.equal(body.max_tokens,6000);assert(!Object.hasOwn(body,'max_completion_tokens'));assert(!Object.hasOwn(body,'reasoning_effort'));
  assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
  assert.deepEqual(body.response_format.json_schema.schema.$defs.evidence_id.enum,['E1']);return Response.json(result());}});
 assert.equal(r.receipt.response_id,'test-provider-receipt');assert.equal(r.publication_ready,false);assert(!JSON.stringify(r).includes('test-only-key'));
});
test('provider outage, truncated output, missing usage and oversized output cannot become analysis',async()=>{
 for(const fetcher of [async()=>new Response('',{status:429}),async()=>{const r=result();r.choices[0].finish_reason='length';return Response.json(r);},async()=>{const r=result();delete r.usage;return Response.json(r);},async()=>new Response('x'.repeat(512001))]){
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'test-model',fetcher}),/STOCK_AI_/);
 }
});
test('worker cancellation aborts the actual provider fetch without returning an analysis',async()=>{
 const controller=new AbortController();let providerSignal;
 await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'test-model',signal:controller.signal,
  fetcher:async(url,request)=>{providerSignal=request.signal;controller.abort();return new Promise(()=>{});}}),/AI_ANALYSIS_ABORTED/);
 assert.equal(providerSignal.aborted,true);
});
test('strict schema lists only this owned packet IDs once and preserves full long citations',async()=>{
 const p=structuredClone(packet),long='2330:PRICE:'+ 'a'.repeat(121),other='2330:FINANCIAL:'+ 'b'.repeat(117);
 p.evidence[0].id=long;p.evidence.push({...p.evidence[0],id:other});
 const answer=structuredClone(output);for(const h of answer.horizons){h.reason.evidence_ids=[long];h.counter_evidence=[{text:'測試反面證據',evidence_ids:[other]}];}
 const r=await analyseStockWithProvider(p,{apiKey:'test-only-key',model:'gpt-4o-mini',fetcher:async(url,request)=>{
  const body=JSON.parse(request.body),format=body.response_format,schema=format.json_schema.schema;
  assert.equal(format.type,'json_schema');assert.equal(format.json_schema.strict,true);assert.deepEqual(schema.properties.symbol.enum,['2330']);
  assert.deepEqual(schema.$defs.evidence_id.enum,[long,other]);assert.equal(JSON.stringify(schema).split(long).length-1,1);
  assert.equal(schema.$defs.claim.properties.evidence_ids.items.$ref,'#/$defs/evidence_id');
  const claims=schema.$defs.claim;assert.equal(claims.additionalProperties,false);assert.deepEqual(claims.required,['text','evidence_ids']);
  assert.equal(claims.properties.text.maxLength,1500);assert.equal(claims.properties.text.minLength,1);assert.equal(claims.properties.text.pattern,'\\S');
  assert.equal(schema.properties.horizons.minItems,3);assert.equal(schema.properties.horizons.maxItems,3);
  const insufficient=schema.$defs.horizon.anyOf.find(h=>h.properties.status.enum.includes('INSUFFICIENT'));
  assert.equal(insufficient.properties.gaps.minItems,1);assert.equal(insufficient.properties.confirmation.maxLength,1500);
  const conditionPattern=new RegExp(insufficient.properties.invalidation.pattern);
  assert(conditionPattern.test('等待下一次官方公告'));assert(!conditionPattern.test('跌破1050元'));assert(!conditionPattern.test('站上１１００元'));
  assert.equal(insufficient.properties.gaps.items.pattern,'\\S');
  assert(body.messages[0].content.includes('每段理由以240字內'));const {analysis_context,...sent}=JSON.parse(body.messages[1].content);assert.deepEqual(sent,p);assert.equal(analysis_context.latest_revenue_period,null);
  return Response.json({...result(),choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]});
 }});
 assert.deepEqual(r.horizons[0].reason.evidence_ids,[long]);assert.deepEqual(r.horizons[0].counter_evidence[0].evidence_ids,[other]);
 assert.deepEqual(r.sources.map(s=>s.id),[long,other]);
 const full={...p,evidence:Array.from({length:100},(_,i)=>({...p.evidence[0],id:i.toString().padStart(3,'0')+':'+ 'x'.repeat(196)}))};
 const format=dailyStockAnalysisResponseFormat(full);assert.equal(format.json_schema.schema.$defs.evidence_id.enum.length,100);
 assert(JSON.stringify(format).length<120000);
});
test('provider transport constraints never bypass original citation, horizon, text or missing-evidence validation',async()=>{
 for(const [change,error] of [
  [r=>r.horizons[0].reason.evidence_ids=['invented'],/AI_ANALYSIS_CITATION/],
  [r=>r.horizons[0].reason.evidence_ids=['E1','E1'],/AI_ANALYSIS_CITATION/],
  [r=>r.horizons[0].reason.text='x'.repeat(1501),/AI_ANALYSIS_TEXT/],
  [r=>r.horizons[0].confirmation='   ',/AI_ANALYSIS_TEXT/],
  [r=>r.horizons[0].invalidation='',/AI_ANALYSIS_TEXT/],
  [r=>r.horizons[0].gaps=[' '],/AI_ANALYSIS_TEXT/],
  [r=>r.horizons[0].confirmation='站上1100元才確認',/AI_ANALYSIS_CONDITION_PRICE/],
  [r=>r.horizons[0].invalidation='跌破1050時失效',/AI_ANALYSIS_CONDITION_PRICE/],
  [r=>r.horizons[0].confirmation='站上一千一百元才確認',/AI_ANALYSIS_CONDITION_PRICE/],
  [r=>r.horizons[0].status='INSUFFICIENT',/AI_ANALYSIS_GAPS/],
  [r=>r.horizons[1].horizon='SHORT',/AI_ANALYSIS_HORIZONS/],
 ]){
  const answer=structuredClone(output);change(answer);
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'gpt-4o-mini',fetcher:async()=>Response.json({...result(),choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})}),error);
 }
});
test('prompt6 sends actual retained revenue months and guards period semantics without changing original packet identity',async()=>{
 const p=structuredClone(packet);p.evidence=['2023-08','2023-09','2023-10'].map((period,i)=>({...p.evidence[0],id:'R'+i,kind:'FINANCIAL',content:JSON.stringify({kind:'REVENUE',period,basis:'MONTHLY',values:{yoy_percent:3+i}})}));
 const answer=structuredClone(output);for(const h of answer.horizons)h.reason={text:'2023-10營收年增5%，僅供歷史背景。',evidence_ids:['R2']};
 const r=await analyseStockWithProvider(p,{apiKey:'test-only-key',model:'gpt-4.1',fetcher:async(url,request)=>{
  const body=JSON.parse(request.body),sent=JSON.parse(body.messages[1].content);assert.equal(body.model,'gpt-4.1');assert.equal(body.response_format.json_schema.strict,true);
  assert.equal(sent.analysis_context.latest_revenue_period,'2023-10');assert.deepEqual(sent.analysis_context.recent_revenue.map(r=>r.period),['2023-10','2023-09','2023-08']);
  assert.equal(sent.analysis_context.recent_revenue[0].values.yoy_percent,5);assert(body.messages[0].content.includes('不得把年份換成今年'));
  return Response.json({...result(),choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]});
 }});
 assert.equal(r.input_hash,await snapshotHash(p));assert.equal(r.horizons[0].reason.text,answer.horizons[0].reason.text);
 for(const [text,error] of [['2026-10營收年增5%。',/AI_ANALYSIS_FINANCIAL_PERIOD/],['營收年增5%。',/AI_ANALYSIS_FINANCIAL_PERIOD/],['預估2023-10營收年增5%。',/AI_ANALYSIS_REPORTED_FACT_AS_FORECAST/]]){
  const bad=structuredClone(answer);bad.horizons[0].reason.text=text;
  await assert.rejects(()=>analyseStockWithProvider(p,{apiKey:'test-only-key',model:'gpt-4.1',fetcher:async()=>Response.json({...result(),choices:[{finish_reason:'stop',message:{content:JSON.stringify(bad)}}]})}),error);
 }
});
test('provider refusal is sanitized and oversized evidence IDs stop before provider expense',async()=>{
 await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'gpt-4o-mini',fetcher:async()=>{
  const r=result();r.choices[0].message.refusal='private refusal prose';return Response.json(r);
 }}),/^Error: STOCK_AI_PROVIDER_REFUSAL$/);
 for(const id of ['x'.repeat(201),42,'   ']){
  const p=structuredClone(packet);p.evidence[0].id=id;let calls=0;
  await assert.rejects(()=>analyseStockWithProvider(p,{apiKey:'test-only-key',model:'gpt-4o-mini',fetcher:async()=>{calls++;assert.fail('impossible citation must not call provider');}}),/STOCK_AI_SCHEMA_EVIDENCE_IDS/);
  assert.equal(calls,0);
 }
});
test('paid candidate is awaited and retained before rejection, without allowing an observer to repair it',async()=>{
 const p=structuredClone(packet);p.evidence[0].kind='FINANCIAL';p.evidence[0].content=JSON.stringify({kind:'REVENUE',period:'2023-10',basis:'MONTHLY',values:{yoy_percent:5}});
 const bad=structuredClone(output);bad.horizons[0].reason.text='2026-10營收年增5%。';
 let recorded=null;
 await assert.rejects(()=>analyseStockWithProvider(p,{apiKey:'test-only-key',model:'gpt-4.1',
  fetcher:async()=>Response.json({...result(),choices:[{finish_reason:'stop',message:{content:JSON.stringify(bad)}}]}),
  onCandidate:async(candidate,receipt,inputHash)=>{
   await Promise.resolve();recorded={candidate:structuredClone(candidate),receipt:{...receipt},inputHash};
   candidate.horizons[0].reason.text='2023-10營收年增5%。';receipt.response_id='observer-cannot-change-receipt';
  },
 }),/AI_ANALYSIS_FINANCIAL_PERIOD/);
 assert.deepEqual(recorded.candidate,bad);assert.equal(recorded.receipt.response_id,'test-provider-receipt');assert.equal(recorded.inputHash,await snapshotHash(p));
});
test('candidate audit happens only after parse and valid receipt, and retention must settle before success',async()=>{
 let calls=0,settled=false;
 const r=await analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'gpt-4.1',fetcher:async()=>Response.json(result()),
  onCandidate:async(candidate,receipt,inputHash)=>{calls++;await Promise.resolve();settled=true;candidate.symbol='9999';receipt.model='mutated';assert.equal(inputHash,await snapshotHash(packet));}});
 assert.equal(calls,1);assert.equal(settled,true);assert.equal(r.symbol,'2330');assert.equal(r.receipt.model,'test-model');
 for(const response of [()=>{const r=result();r.choices[0].message.content='{bad';return r;},()=>{const r=result();delete r.usage;return r;}]){
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'gpt-4.1',fetcher:async()=>Response.json(response()),onCandidate:async()=>assert.fail('unparsed or receiptless body must not be audited as a candidate')}));
 }
 await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'gpt-4.1',fetcher:async()=>Response.json(result()),onCandidate:async()=>{throw Error('STOCK_AI_CANDIDATE_RETAIN_UNCONFIRMED');}}),/STOCK_AI_CANDIDATE_RETAIN_UNCONFIRMED/);
});
test('Astra low-reasoning pilot uses compatible token fields and explicit financial/horizon constraints',async()=>{
 const p=structuredClone(packet);p.evidence[0].kind='FINANCIAL';p.evidence[0].content=JSON.stringify({kind:'EPS_AS_REPORTED',period:'2026-Q2',basis:'AS_REPORTED',values:{value:1.63}});
 const answer=structuredClone(output);for(const h of answer.horizons)h.reason.text='2026-Q2 EPS原報值1.63元，單季或累計基礎仍無法確認。';
 let audited=false;
 const r=await analyseStockWithProvider(p,{apiKey:'test-only-key',model:'gpt-6-astra',onCandidate:async()=>{audited=true;},fetcher:async(url,request)=>{
  const body=JSON.parse(request.body),context=JSON.parse(body.messages[1].content).analysis_context,prompt=body.messages[0].content;
  assert.equal(body.model,'gpt-6-astra');assert.equal(body.reasoning_effort,'low');assert.equal(body.max_completion_tokens,6000);
  for(const key of ['max_tokens','temperature','top_p'])assert(!Object.hasOwn(body,key),key);
  assert.equal(body.response_format.json_schema.strict,true);assert.deepEqual(context.horizon_definitions,{SHORT:'1～10 個交易日',MEDIUM:'2～12 週',LONG:'3～18 個月'});
  assert.equal(context.financial_basis_rule,'AS_REPORTED_IS_NOT_SINGLE_QUARTER_YTD_CUMULATIVE_OR_TTM');
  assert.equal(context.gap_statement_rule,'MISSING_IN_THIS_PACKET_IS_NOT_PROOF_OF_NOT_PUBLISHED');
  assert(prompt.includes('不得把AS_REPORTED稱為單季、累計、年初至今、YTD或TTM'));assert(prompt.includes('不能因此宣稱公司尚未公布'));
  assert(prompt.includes('不得宣稱無來源的連續季數'));assert.equal(stockAiModelRevision(body.model),'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low');
  return Response.json({...result(),choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]});
 }});
 assert.equal(audited,true);assert.equal(r.horizons[0].reason.text,answer.horizons[0].reason.text);
});
