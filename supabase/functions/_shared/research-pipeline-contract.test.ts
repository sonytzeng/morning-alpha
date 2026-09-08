import { canonicalAdminReaderProjection, canonicalReportProjection, classifyResearchResult, companyEvidenceSupported, evaluateAutomaticTradingDay, researchInputFingerprint } from './research-pipeline-contract.ts';
const eq = (a: unknown,b: unknown) => { if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

Deno.test('Sep 7: public/member/LINE summary all derive from canonical STOP, raw evidence retained',()=>{
  const ai={today_quote:'台達電受惠',research_master_v2:{quality:{duplicate_claims:['x']}},line_push_copy:{one_sentence:'台達電受惠'},member_research_note_v2:{today_core_thesis:'台達電受惠'},today_beneficiary_stocks_v10:[{symbol:'2308'}]};
  const projected=canonicalReportProjection(ai,{action:'STOP',decision_mode:'blocked',generated_text:{daily_sentence:'證據不足，研究未發布。',recommendations:[]}});
  eq(projected.today_quote,'證據不足，研究未發布。');
  eq((projected.member_research_note_v2 as Record<string,unknown>).today_core_thesis,projected.today_quote);
  eq((projected.line_push_copy as Record<string,unknown>).one_sentence,projected.today_quote);
  eq(projected.research_master_v2,ai.research_master_v2);
  eq(projected.today_beneficiary_stocks_v10,[]);
});

Deno.test('Sep 7 Owner reader uses canonical revision, runtime quotes and gated recommendations, not nested legacy aliases',()=>{
  const raw={id:'report-1',summary:'台達電受惠',ai_strategy_json:{v8_daily_sentence:{sentence:'台達電受惠'},today_beneficiary_stocks_v10:[{symbol:'2308'}]}};
  const reader={report_date:'2026-09-07',revision_id:'decision-7',daily_sentence:'研究未通過證據驗證',
    v8_daily_sentence:{sentence:'研究未通過證據驗證'},premium_content_status:'blocked',
    canonical_decision:{action:'STOP',decision_mode:'blocked'},market_data_snapshots:[{symbol:'TAIEX',value:28000}],
    member_research_note_v2:{locked:true}};
  const result=canonicalAdminReaderProjection(raw,raw.ai_strategy_json,reader);
  const nested=result.ai_strategy_json as Record<string,unknown>;
  eq(result.revision_id,'decision-7');eq(nested.revision_id,'decision-7');
  eq(nested.canonical_decision,reader.canonical_decision);
  eq(nested.market_data_snapshots,reader.market_data_snapshots);
  eq(nested.v8_daily_sentence,reader.v8_daily_sentence);
  eq(result.today_beneficiary_stocks,[]);eq(nested.today_beneficiary_stocks_v10,[]);
  eq(nested.member_research_note_v2,{locked:true});eq(result.admin_source_report,raw);
  const eligible=canonicalAdminReaderProjection(raw,raw.ai_strategy_json,{...reader,premium_content_status:'eligible',today_beneficiary_stocks:[{symbol:'2317',reason:'公司事件有來源'}]});
  eq(eligible.today_beneficiary_stocks,[{symbol:'2317',reason:'公司事件有來源'}]);
});

Deno.test('Sep 1 / Sep 7: company evidence retained; industry/macro tags do not invent company beneficiaries',()=>{
  const honHai={title:'Nvidia partner Hon Hai sales climb with AI server momentum',summary:'Hon Hai reported stronger sales.',evidence_type:'market_news'};
  eq(companyEvidenceSupported({symbol:'2317',name:'鴻海',aliases:['Hon Hai','Foxconn']},honHai),true);
  eq(companyEvidenceSupported({symbol:'2308',name:'台達電',industry_code:'AI_SERVER'},honHai),false);
  for(const title of ['Fed rate decision','Gold prices rise','VIX rises','AI server industry grows'])eq(companyEvidenceSupported({symbol:'3037',name:'欣興'},{title,evidence_type:'market_news'}),false);
  eq(companyEvidenceSupported({symbol:'2330',name:'台積電'},{title:'2330',summary:'上漲',evidence_type:'market_data'}),false);
  eq(companyEvidenceSupported({symbol:'2330',name:'台積電'},{title:'台積電先進封裝需求增加',evidence_type:'market_news'}),true);
});

Deno.test('fingerprint is input-order stable; real source/engine/policy/date changes reevaluate',async()=>{
  const input={report_date:'2026-09-07',sources:{market:[{symbol:'TAIEX',value:100,captured_at:'2026-09-07T00:00:00Z'},{symbol:'TXF',value:101}]},source_version:'v1',engine_version:'v1',quality_policy:{minimum:90},previous_revision:'yesterday'};
  const original=await researchInputFingerprint(input);
  for(let i=0;i<10;i++)eq(await researchInputFingerprint({...input,sources:{market:[...input.sources.market].reverse()}}),original);
  const changed=[{...input,engine_version:'v2'},{...input,source_version:'v2'},{...input,quality_policy:{minimum:95}},{...input,report_date:'2026-09-08'},{...input,sources:{market:[{symbol:'TAIEX',value:102}]}}];
  for(const next of changed)if(await researchInputFingerprint(next)===original)throw new Error('changed effective input was cached');
  const ordered={...input,previous_revision:{recent:['newest','older']}};
  if(await researchInputFingerprint(ordered)===await researchInputFingerprint({...ordered,previous_revision:{recent:['older','newest']}}))throw new Error('ordered repeat-penalty history was incorrectly treated as a set');
});

Deno.test('Sep 4 timeout is bounded retry; Aug 28 HTTP 200 business failure and quality 409 are not success',()=>{
  eq(classifyResearchResult(504,{},1),{outcome:'FAILED',retry_after_seconds:30});
  eq(classifyResearchResult(429,{},2),{outcome:'FAILED',retry_after_seconds:60});
  eq(classifyResearchResult(504,{},3),{outcome:'FAILED',retry_after_seconds:null});
  eq(classifyResearchResult(200,{success:false},1),{outcome:'DEGRADED',retry_after_seconds:null});
  eq(classifyResearchResult(409,{error_code:'RESEARCH_QUALITY_REJECTED'},1),{outcome:'DEGRADED',retry_after_seconds:null});
  eq(classifyResearchResult(409,{error_code:'RESEARCH_IN_PROGRESS'},1),{outcome:'IN_PROGRESS',retry_after_seconds:null});
});

function completeDay(){
  const date='2026-09-07';
  return {report_date:date,today_date:date,is_trading_day:true,manual_recovery:false,
    stages:Object.fromEntries(['sources','canonical','evidence','editorial','premium','semantic','line','closing','learning','acceptance'].map(key=>[key,{report_date:date,revision_id:'revision-1',status:'PASS',completed_at:`${date}T07:30:00Z`} ])),
    delivery:{type:'daily_report',sent_at:`${date}T07:30:00+08:00`},
    checkpoints:Array.from({length:6},()=>({report_date:date,status:'SUCCEEDED',evidence:true})),failed_dispatches:0,open_dead_letters:0};
}
Deno.test('full-day chain must share date/revision; incident delivery and manual/historical recovery never count automatic',()=>{
  const good=completeDay(); eq(evaluateAutomaticTradingDay(good).automatic_stable_day,true);
  const bad=[{...good,manual_recovery:true},{...good,today_date:'2026-09-08'},
    {...good,delivery:{type:'data_incident',sent_at:good.delivery.sent_at}},
    {...good,delivery:{type:'daily_report',sent_at:'2026-09-07T08:01:00+08:00'}},
    {...good,failed_dispatches:null},{...good,stages:{...good.stages,premium:{...good.stages.premium,status:'BLOCKED'}}},
    {...good,stages:{...good.stages,canonical:{...good.stages.canonical,revision_id:'mixed'}}},
    {...good,stages:{...good.stages,editorial:{...good.stages.editorial,report_date:'2026-09-04'}}},
    {...good,checkpoints:good.checkpoints.map((row,i)=>({...row,evidence:i!==2}))}];
  for(const input of bad)eq(evaluateAutomaticTradingDay(input).automatic_stable_day,false);
  eq(evaluateAutomaticTradingDay({...good,is_trading_day:false}).status,'NOT_APPLICABLE');
});
